import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CertificateShareService } from './certificate-share.service';

const mockPrisma = {
  certificate: { findUnique: jest.fn() },
  certificateShare: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

let configValues: Record<string, string | undefined>;

const mockConfig = {
  get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
};

const DEFAULT_CONFIG: Record<string, string> = {
  PUBLIC_API_URL: 'https://api.sorobanlard.test/api/v1/',
  FRONTEND_URL: 'https://sorobanlard.test/',
  PLATFORM_NAME: 'SorobanLard',
};

const certificate = {
  id: 'CERT-ABC123',
  studentId: 'student-1',
  courseId: 'course-1',
  courseTitle: 'Professional Tailoring',
  instructorAddress: 'GINSTRUCTOR',
  txHash: null,
  isRevoked: false,
  issuedAt: new Date('2026-08-15T10:00:00.000Z'),
  student: { name: 'Jane Doe' },
  course: { thumbnailUrl: 'https://cdn.sorobanlard.test/tailoring.png' },
};

const share = {
  id: 'share-1',
  certificateId: certificate.id,
  token: 'public-token',
  viewCount: 4,
  certificate,
};

describe('CertificateShareService', () => {
  let service: CertificateShareService;

  beforeEach(async () => {
    configValues = { ...DEFAULT_CONFIG };
    jest.clearAllMocks();
    mockPrisma.certificate.findUnique.mockReset();
    mockPrisma.certificateShare.findUnique.mockReset();
    mockPrisma.certificateShare.upsert.mockReset();
    mockPrisma.certificateShare.update.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateShareService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(CertificateShareService);
  });

  describe('generateShareLink()', () => {
    it('creates an idempotent share link with LinkedIn and Open Graph metadata', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(certificate);
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(mockPrisma.certificate.findUnique).toHaveBeenCalledWith({
        where: { id: certificate.id },
        include: {
          student: { select: { name: true } },
          course: { select: { thumbnailUrl: true } },
        },
      });
      expect(mockPrisma.certificateShare.upsert).toHaveBeenCalledWith({
        where: { certificateId: certificate.id },
        create: {
          certificateId: certificate.id,
          token: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
        },
        update: {},
      });
      expect(result.certificateId).toBe(certificate.id);
      expect(result.shareUrl).toBe(
        'https://api.sorobanlard.test/api/v1/certificates/share/public-token',
      );
      expect(result.verificationUrl).toBe(
        'https://sorobanlard.test/certificates/verify/CERT-ABC123',
      );
      expect(result.viewCount).toBe(4);

      const linkedin = new URL(result.linkedinUrl);
      expect(linkedin.origin + linkedin.pathname).toBe(
        'https://www.linkedin.com/profile/add',
      );
      expect(Object.fromEntries(linkedin.searchParams)).toEqual({
        startTask: 'CERTIFICATION_NAME',
        name: 'Professional Tailoring',
        organizationName: 'SorobanLard',
        issueYear: '2026',
        issueMonth: '8',
        certUrl: result.shareUrl,
        certId: certificate.id,
      });
      expect(result.linkedinMetadata).toEqual({
        certificationName: 'Professional Tailoring',
        issuingOrganization: 'SorobanLard',
        issueYear: 2026,
        issueMonth: 8,
        credentialId: certificate.id,
        credentialUrl: result.shareUrl,
      });
      expect(result.openGraph).toEqual({
        title: 'Jane Doe earned a certificate in Professional Tailoring',
        description:
          "Verify Jane Doe's SorobanLard certificate for Professional Tailoring.",
        type: 'website',
        url: result.shareUrl,
        image: certificate.course.thumbnailUrl,
      });
    });

    it('uses a placeholder holder name and the configured fallback image', async () => {
      configValues.CERTIFICATE_SHARE_IMAGE_URL =
        'https://cdn.sorobanlard.test/default-share.png';
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...certificate,
        student: { name: null },
        course: { thumbnailUrl: null },
      });
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(result.openGraph.title).toBe(
        'A SorobanLard learner earned a certificate in Professional Tailoring',
      );
      expect(result.openGraph.description).toBe(
        "Verify A SorobanLard learner's SorobanLard certificate for Professional Tailoring.",
      );
      expect(result.openGraph.image).toBe(
        'https://cdn.sorobanlard.test/default-share.png',
      );
    });

    it('omits the image when neither the course nor the config provides one', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...certificate,
        course: { thumbnailUrl: null },
      });
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(result.openGraph).not.toHaveProperty('image');
    });

    it('uses the configured platform name when provided', async () => {
      configValues.PLATFORM_NAME = 'SorobanLard Academy';
      mockPrisma.certificate.findUnique.mockResolvedValue(certificate);
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(result.linkedinMetadata.issuingOrganization).toBe(
        'SorobanLard Academy',
      );
      expect(new URL(result.linkedinUrl).searchParams.get('organizationName')).toBe(
        'SorobanLard Academy',
      );
    });

    it('rejects a missing certificate', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(null);

      await expect(
        service.generateShareLink('missing', 'student-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.certificateShare.upsert).not.toHaveBeenCalled();
    });

    it("rejects sharing another student's certificate", async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(certificate);

      await expect(
        service.generateShareLink(certificate.id, 'student-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.certificateShare.upsert).not.toHaveBeenCalled();
    });

    it('rejects a revoked certificate', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...certificate,
        isRevoked: true,
      });

      await expect(
        service.generateShareLink(certificate.id, 'student-1'),
      ).rejects.toThrow(GoneException);
      expect(mockPrisma.certificateShare.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getShareMetadata()', () => {
    it('returns share metadata without recording a view', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue(share);

      const result = await service.getShareMetadata(share.token);

      expect(mockPrisma.certificateShare.findUnique).toHaveBeenCalledWith({
        where: { token: share.token },
        include: {
          certificate: {
            include: {
              student: { select: { name: true } },
              course: { select: { thumbnailUrl: true } },
            },
          },
        },
      });
      expect(mockPrisma.certificateShare.update).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          certificateId: certificate.id,
          shareUrl:
            'https://api.sorobanlard.test/api/v1/certificates/share/public-token',
          viewCount: 4,
        }),
      );
      expect(result).not.toHaveProperty('html');
    });

    it('rejects an unknown token', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue(null);

      await expect(service.getShareMetadata('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a revoked certificate', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue({
        ...share,
        certificate: { ...certificate, isRevoked: true },
      });

      await expect(service.getShareMetadata(share.token)).rejects.toThrow(
        GoneException,
      );
    });
  });

  describe('renderSharePage()', () => {
    it('increments the view counter and renders Open Graph metadata', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue(share);
      mockPrisma.certificateShare.update.mockResolvedValue({
        ...share,
        viewCount: 5,
      });

      const result = await service.renderSharePage(share.token);

      expect(mockPrisma.certificateShare.update).toHaveBeenCalledWith({
        where: { id: share.id },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: expect.any(Date),
        },
      });
      expect(result.viewCount).toBe(5);
      expect(result.html).toContain('<title>Jane Doe earned a certificate in Professional Tailoring</title>');
      expect(result.html).toContain('<meta property="og:type" content="website">');
      expect(result.html).toContain('<meta property="og:image"');
      expect(result.html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(result.html).toContain('<link rel="canonical"');
      expect(result.html).toContain('Verify this certificate');
    });

    it('escapes HTML-special characters in the rendered metadata', async () => {
      const unsafeCertificate = {
        ...certificate,
        courseTitle: '<script>alert("x")</script> & Training',
        student: { name: "O'Brien <b>" },
      };
      mockPrisma.certificateShare.findUnique.mockResolvedValue({
        ...share,
        certificate: unsafeCertificate,
      });
      mockPrisma.certificateShare.update.mockResolvedValue({
        ...share,
        viewCount: 5,
      });

      const result = await service.renderSharePage(share.token);

      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).toContain('&quot;x&quot;');
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('O&#39;Brien &lt;b&gt;');
      expect(result.openGraph.title).toContain('<script>');
    });

    it('omits the og:image tag when no image is available', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue({
        ...share,
        certificate: { ...certificate, course: { thumbnailUrl: null } },
      });
      mockPrisma.certificateShare.update.mockResolvedValue({
        ...share,
        viewCount: 5,
      });

      const result = await service.renderSharePage(share.token);

      expect(result.html).not.toContain('og:image');
    });

    it('rejects an unknown token without recording a view', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue(null);

      await expect(service.renderSharePage('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.certificateShare.update).not.toHaveBeenCalled();
    });

    it('does not count a view after the certificate is revoked', async () => {
      mockPrisma.certificateShare.findUnique.mockResolvedValue({
        ...share,
        certificate: { ...certificate, isRevoked: true },
      });

      await expect(service.renderSharePage(share.token)).rejects.toThrow(
        GoneException,
      );
      expect(mockPrisma.certificateShare.update).not.toHaveBeenCalled();
    });
  });

  describe('share URL construction', () => {
    it('falls back to APP_BASE_URL and API_PREFIX when PUBLIC_API_URL is absent', async () => {
      delete configValues.PUBLIC_API_URL;
      configValues.APP_BASE_URL = 'https://app.sorobanlard.test/';
      configValues.API_PREFIX = '/api/v2/';
      mockPrisma.certificate.findUnique.mockResolvedValue(certificate);
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(result.shareUrl).toBe(
        'https://app.sorobanlard.test/api/v2/certificates/share/public-token',
      );
    });

    it('uses localhost defaults when no URL configuration is provided', async () => {
      delete configValues.PUBLIC_API_URL;
      delete configValues.APP_BASE_URL;
      delete configValues.API_PREFIX;
      delete configValues.FRONTEND_URL;
      delete configValues.CORS_ORIGIN;
      mockPrisma.certificateShare.findUnique.mockResolvedValue(share);

      const result = await service.getShareMetadata(share.token);

      expect(result.shareUrl).toBe(
        'http://localhost:3000/api/v1/certificates/share/public-token',
      );
      expect(result.verificationUrl).toBe(
        'http://localhost:3001/certificates/verify/CERT-ABC123',
      );
    });

    it('falls back to CORS_ORIGIN when FRONTEND_URL is absent', async () => {
      delete configValues.FRONTEND_URL;
      configValues.CORS_ORIGIN = 'https://cors.sorobanlard.test/';
      mockPrisma.certificateShare.findUnique.mockResolvedValue(share);

      const result = await service.getShareMetadata(share.token);

      expect(result.verificationUrl).toBe(
        'https://cors.sorobanlard.test/certificates/verify/CERT-ABC123',
      );
    });

    it('URL-encodes the share token and certificate id', async () => {
      const specialToken = 'token with spaces/+&';
      const specialCertificate = {
        ...certificate,
        id: 'CERT/A B',
      };
      mockPrisma.certificateShare.findUnique.mockResolvedValue({
        ...share,
        token: specialToken,
        certificate: specialCertificate,
      });

      const result = await service.getShareMetadata(specialToken);

      expect(result.shareUrl).toBe(
        `https://api.sorobanlard.test/api/v1/certificates/share/${encodeURIComponent(specialToken)}`,
      );
      expect(result.verificationUrl).toBe(
        `https://sorobanlard.test/certificates/verify/${encodeURIComponent(specialCertificate.id)}`,
      );
      expect(result.linkedinMetadata.credentialUrl).toBe(result.shareUrl);
    });

    it('uses the default platform name when none is configured', async () => {
      delete configValues.PLATFORM_NAME;
      mockPrisma.certificate.findUnique.mockResolvedValue(certificate);
      mockPrisma.certificateShare.upsert.mockResolvedValue(share);

      const result = await service.generateShareLink(certificate.id, 'student-1');

      expect(result.linkedinMetadata.issuingOrganization).toBe('SorobanLard');
      expect(new URL(result.linkedinUrl).searchParams.get('organizationName')).toBe(
        'SorobanLard',
      );
    });
  });
});
