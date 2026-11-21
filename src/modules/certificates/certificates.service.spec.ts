import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationType } from '@prisma/client';
import { CertificatesService } from './certificates.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExamsService } from '../exams/exams.service';
import {
  CERTIFICATE_PDF_QUEUE,
  CERTIFICATE_PDF_JOB,
} from '../../common/queue/queue.constants';

describe('CertificatesService', () => {
  let service: CertificatesService;

  const mockPrisma = {
    enrollment: {
      findUnique: jest.fn(),
    },
    certificate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStellar = {
    issueCertificateOnChain: jest.fn(),
    verifyCertificateOnChain: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockExams = {
    hasPassedExam: jest.fn(),
  };

  const mockPdfQueue = {
    add: jest.fn(),
  };

  const mockEnrollment = {
    id: 'enroll-1',
    studentId: 'student-1',
    courseId: 'course-1',
    status: 'COMPLETED',
    course: {
      id: 'course-1',
      title: 'Professional Tailoring',
      instructorAddress: 'GINSTRUCTOR123',
    },
    student: {
      id: 'student-1',
      name: 'Jane Doe',
      stellarAddress: 'GSTUDENT123',
    },
  };

  const mockCertificate = {
    id: 'CERT-ABC123456789',
    studentId: 'student-1',
    courseId: 'course-1',
    courseTitle: 'Professional Tailoring',
    instructorAddress: 'GINSTRUCTOR123',
    isRevoked: false,
    isFraudHeld: false,
    revokedAt: null,
    revokeReason: null,
    issuanceStatus: 'ISSUED',
    issuanceAttempts: 1,
    student: { id: 'student-1', name: 'Jane Doe', stellarAddress: 'GSTUDENT123' },
    course: {
      title: 'Professional Tailoring',
      instructor: { name: 'Chef John', stellarAddress: 'GINSTRUCTOR123' },
    },
    revokedBy: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificatesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ExamsService, useValue: mockExams },
        { provide: getQueueToken(CERTIFICATE_PDF_QUEUE), useValue: mockPdfQueue },
      ],
    }).compile();

    service = module.get<CertificatesService>(CertificatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('issue()', () => {
    it('successfully issues a certificate, queues PDF generation, triggers on-chain issuance, and notifies student', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockExams.hasPassedExam.mockResolvedValue(true);
      mockPrisma.certificate.findFirst.mockResolvedValue(null);
      mockPrisma.certificate.create.mockResolvedValue(mockCertificate);
      mockPdfQueue.add.mockResolvedValue({ id: 'job-1' });
      mockStellar.issueCertificateOnChain.mockResolvedValue({ txHash: '0xabc' });
      mockPrisma.certificate.update.mockResolvedValue(mockCertificate);
      mockNotifications.notifyUser.mockResolvedValue({});

      const result = await service.issue('admin-1', 'student-1', 'course-1');

      expect(mockPrisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { studentId_courseId: { studentId: 'student-1', courseId: 'course-1' } },
        include: { course: true, student: true },
      });
      expect(mockExams.hasPassedExam).toHaveBeenCalledWith('student-1', 'course-1');
      expect(mockPrisma.certificate.findFirst).toHaveBeenCalledWith({
        where: { studentId: 'student-1', courseId: 'course-1' },
      });
      expect(mockPrisma.certificate.create).toHaveBeenCalledWith({
        data: {
          id: expect.stringMatching(/^CERT-[A-F0-9]{12}$/),
          studentId: 'student-1',
          courseId: 'course-1',
          courseTitle: 'Professional Tailoring',
          instructorAddress: 'GINSTRUCTOR123',
        },
        include: { student: true, course: true },
      });
      expect(mockPdfQueue.add).toHaveBeenCalledWith(
        CERTIFICATE_PDF_JOB,
        { certificateId: expect.any(String) },
        expect.objectContaining({ jobId: expect.any(String), attempts: 5 }),
      );
      expect(mockStellar.issueCertificateOnChain).toHaveBeenCalled();
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.CERTIFICATE_ISSUED,
        '🎓 Certificate Issued!',
        expect.stringContaining('Professional Tailoring'),
        expect.objectContaining({ courseId: 'course-1' }),
      );
      expect(result).toEqual({ ...mockCertificate, pdfStatus: 'queued' });
    });

    it('throws NotFoundException if enrollment not found', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.issue('admin-1', 'student-1', 'course-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.certificate.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if enrollment is not COMPLETED', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        ...mockEnrollment,
        status: 'ACTIVE',
      });

      await expect(service.issue('admin-1', 'student-1', 'course-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.certificate.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if required exam has not been passed', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockExams.hasPassedExam.mockResolvedValue(false);

      await expect(service.issue('admin-1', 'student-1', 'course-1')).rejects.toThrow(
        new ForbiddenException(
          'Student has not passed the required certification exam for this course',
        ),
      );
      expect(mockPrisma.certificate.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if certificate already issued for enrollment', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockExams.hasPassedExam.mockResolvedValue(true);
      mockPrisma.certificate.findFirst.mockResolvedValue(mockCertificate);

      await expect(service.issue('admin-1', 'student-1', 'course-1')).rejects.toThrow(
        new ForbiddenException('Certificate already issued for this enrollment'),
      );
      expect(mockPrisma.certificate.create).not.toHaveBeenCalled();
    });

    it('marks certificate as FAILED on-chain after retry exhaustion without blocking issue completion', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);
      mockExams.hasPassedExam.mockResolvedValue(true);
      mockPrisma.certificate.findFirst.mockResolvedValue(null);
      mockPrisma.certificate.create.mockResolvedValue(mockCertificate);
      mockPdfQueue.add.mockResolvedValue({ id: 'job-1' });

      // Simulate Stellar failure on all 3 attempts
      mockStellar.issueCertificateOnChain.mockRejectedValue(new Error('Stellar RPC unavailable'));
      mockPrisma.certificate.update.mockResolvedValue(mockCertificate);

      const result = await service.issue('admin-1', 'student-1', 'course-1');

      expect(mockStellar.issueCertificateOnChain).toHaveBeenCalledTimes(3);
      expect(mockPrisma.certificate.update).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        data: expect.objectContaining({
          issuanceStatus: 'FAILED',
          issuanceAttempts: 3,
          lastIssuanceError: 'Stellar RPC unavailable',
        }),
      });
      expect(result.pdfStatus).toBe('queued');
      expect(mockNotifications.notifyUser).toHaveBeenCalled();
    });
  });

  describe('retryPendingIssuances()', () => {
    it('retries on-chain issuance for pending and failed certificates', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([
        { id: 'CERT-1' },
        { id: 'CERT-2' },
      ]);
      mockStellar.issueCertificateOnChain.mockResolvedValue({ txHash: '0x123' });
      mockPrisma.certificate.update.mockResolvedValue(mockCertificate);

      await service.retryPendingIssuances();

      expect(mockPrisma.certificate.findMany).toHaveBeenCalledWith({
        where: { issuanceStatus: { in: ['PENDING', 'FAILED'] }, isRevoked: false },
        select: { id: true },
        take: 50,
      });
      expect(mockStellar.issueCertificateOnChain).toHaveBeenCalledWith('CERT-1');
      expect(mockStellar.issueCertificateOnChain).toHaveBeenCalledWith('CERT-2');
    });

    it('returns early when there are no pending or failed issuances', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([]);

      await service.retryPendingIssuances();

      expect(mockStellar.issueCertificateOnChain).not.toHaveBeenCalled();
    });
  });

  describe('updateTxHash()', () => {
    it('updates txHash and marks issuanceStatus as ISSUED', async () => {
      mockPrisma.certificate.update.mockResolvedValue({
        ...mockCertificate,
        txHash: '0xnewtxhash',
        issuanceStatus: 'ISSUED',
      });

      const result = await service.updateTxHash('CERT-1', '0xnewtxhash');

      expect(mockPrisma.certificate.update).toHaveBeenCalledWith({
        where: { id: 'CERT-1' },
        data: { txHash: '0xnewtxhash', issuanceStatus: 'ISSUED' },
      });
      expect(result.txHash).toBe('0xnewtxhash');
    });
  });

  describe('findByStudent()', () => {
    it('returns certificates for a student ordered by issuedAt desc', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([mockCertificate]);

      const result = await service.findByStudent('student-1');

      expect(mockPrisma.certificate.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        include: { course: { include: { instructor: { select: { name: true } } } } },
        orderBy: { issuedAt: 'desc' },
      });
      expect(result).toEqual([mockCertificate]);
    });
  });

  describe('findById()', () => {
    it('returns certificate details when found', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(mockCertificate);

      const result = await service.findById('CERT-ABC123456789');

      expect(mockPrisma.certificate.findUnique).toHaveBeenCalledWith({
        where: { id: 'CERT-ABC123456789' },
        include: {
          student: { select: { id: true, name: true, stellarAddress: true } },
          course: { include: { instructor: { select: { name: true, stellarAddress: true } } } },
          revokedBy: { select: { id: true, name: true, email: true } },
        },
      });
      expect(result).toEqual(mockCertificate);
    });

    it('throws NotFoundException when certificate does not exist', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-cert')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verify()', () => {
    it('returns VALID status when certificate exists, is not revoked or held, and is verified on-chain', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(mockCertificate);
      mockStellar.verifyCertificateOnChain.mockResolvedValue(true);

      const result = await service.verify('CERT-ABC123456789');

      expect(mockStellar.verifyCertificateOnChain).toHaveBeenCalledWith('CERT-ABC123456789');
      expect(result).toEqual({
        status: 'VALID',
        valid: true,
        certificate: mockCertificate,
      });
    });

    it('throws GoneException with REVOKED status when certificate is marked revoked in DB', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...mockCertificate,
        isRevoked: true,
        revokedAt: new Date('2026-08-01T00:00:00.000Z'),
        revokeReason: 'Plagiarism',
      });

      try {
        await service.verify('CERT-ABC123456789');
        fail('Should have thrown GoneException');
      } catch (err) {
        expect(err).toBeInstanceOf(GoneException);
        expect((err as GoneException).getResponse()).toEqual({
          status: 'REVOKED',
          valid: false,
          reason: 'Certificate has been revoked',
          revokedAt: expect.any(Date),
          revokeReason: 'Plagiarism',
          certificate: null,
        });
      }
      expect(mockStellar.verifyCertificateOnChain).not.toHaveBeenCalled();
    });

    it('throws GoneException with FRAUD_HELD status when certificate is held for fraud', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...mockCertificate,
        isFraudHeld: true,
      });

      try {
        await service.verify('CERT-ABC123456789');
        fail('Should have thrown GoneException');
      } catch (err) {
        expect(err).toBeInstanceOf(GoneException);
        expect((err as GoneException).getResponse()).toEqual({
          status: 'FRAUD_HELD',
          valid: false,
          reason: 'Certificate is held pending fraud investigation',
          certificate: null,
        });
      }
      expect(mockStellar.verifyCertificateOnChain).not.toHaveBeenCalled();
    });

    it('throws GoneException when certificate is not valid on-chain', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(mockCertificate);
      mockStellar.verifyCertificateOnChain.mockResolvedValue(false);

      try {
        await service.verify('CERT-ABC123456789');
        fail('Should have thrown GoneException');
      } catch (err) {
        expect(err).toBeInstanceOf(GoneException);
        expect((err as GoneException).getResponse()).toEqual({
          status: 'REVOKED',
          valid: false,
          reason: 'Certificate not found or revoked on-chain',
          certificate: null,
        });
      }
    });

    it('throws NotFoundException if certificate is not found', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(null);

      await expect(service.verify('missing-cert')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revoke()', () => {
    it('revokes certificate, records admin audit details, and notifies student', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue(mockCertificate);
      mockPrisma.certificate.update.mockResolvedValue({
        ...mockCertificate,
        isRevoked: true,
        revokedById: 'admin-1',
        revokeReason: 'Fraudulent activity',
        revokedAt: new Date(),
      });

      const result = await service.revoke(
        'CERT-ABC123456789',
        'admin-1',
        'Fraudulent activity',
      );

      expect(mockPrisma.certificate.update).toHaveBeenCalledWith({
        where: { id: 'CERT-ABC123456789' },
        data: {
          isRevoked: true,
          revokedById: 'admin-1',
          revokedAt: expect.any(Date),
          revokeReason: 'Fraudulent activity',
        },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.CERTIFICATE_REVOKED,
        'Certificate Revoked',
        'Your certificate for "Professional Tailoring" has been revoked. Reason: Fraudulent activity',
        { certificateId: 'CERT-ABC123456789', reason: 'Fraudulent activity' },
      );
      expect(result.isRevoked).toBe(true);
    });

    it('revokes certificate without reason and provides default course title if missing', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...mockCertificate,
        course: null,
      });
      mockPrisma.certificate.update.mockResolvedValue({
        ...mockCertificate,
        isRevoked: true,
        revokedById: 'admin-1',
        revokeReason: null,
      });

      await service.revoke('CERT-ABC123456789', 'admin-1');

      expect(mockPrisma.certificate.update).toHaveBeenCalledWith({
        where: { id: 'CERT-ABC123456789' },
        data: {
          isRevoked: true,
          revokedById: 'admin-1',
          revokedAt: expect.any(Date),
          revokeReason: null,
        },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.CERTIFICATE_REVOKED,
        'Certificate Revoked',
        'Your certificate for "your course" has been revoked.',
        { certificateId: 'CERT-ABC123456789', reason: undefined },
      );
    });

    it('throws ForbiddenException if certificate is already revoked', async () => {
      mockPrisma.certificate.findUnique.mockResolvedValue({
        ...mockCertificate,
        isRevoked: true,
      });

      await expect(service.revoke('CERT-ABC123456789', 'admin-1')).rejects.toThrow(
        new ForbiddenException('Certificate already revoked'),
      );
      expect(mockPrisma.certificate.update).not.toHaveBeenCalled();
    });
  });
});
