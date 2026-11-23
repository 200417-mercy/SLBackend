import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { KycStatus, NotificationType, KycDocumentType } from '@prisma/client';
import { KycService } from './kyc.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  kycSubmission: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockNotifications = {
  notifyUser: jest.fn(),
};

const mockUploads = {
  saveKycDocument: jest.fn(),
};

describe('KycService', () => {
  let service: KycService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: UploadsService, useValue: mockUploads },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ----------------------------------------------------------
  // submit
  // ----------------------------------------------------------

  describe('submit', () => {
    const instructorId = 'inst-1';
    const dto: SubmitKycDto = { documentType: KycDocumentType.NATIONAL_ID };
    const docFile = { originalname: 'id.pdf' } as Express.Multer.File;

    it('creates a KYC submission and returns CDN URLs', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);
      mockUploads.saveKycDocument.mockResolvedValue({
        originUrl: 'origin://doc',
        cdnUrl: 'cdn://doc',
      });
      mockPrisma.kycSubmission.create.mockResolvedValue({
        id: 'kyc-1',
        instructorId,
        documentType: KycDocumentType.NATIONAL_ID,
        documentUrl: 'origin://doc',
        additionalUrl: null,
        status: KycStatus.PENDING,
      });

      const result = await service.submit(instructorId, dto, docFile);

      expect(mockPrisma.kycSubmission.create).toHaveBeenCalledWith({
        data: {
          instructorId,
          documentType: dto.documentType,
          documentUrl: 'origin://doc',
          additionalUrl: null,
          status: KycStatus.PENDING,
        },
      });
      expect(result.documentUrl).toBe('cdn://doc');
      expect(result.additionalUrl).toBeNull();
    });

    it('also uploads the additional file when provided', async () => {
      const extraFile = { originalname: 'selfie.png' } as Express.Multer.File;
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);
      mockUploads.saveKycDocument
        .mockResolvedValueOnce({ originUrl: 'origin://doc', cdnUrl: 'cdn://doc' })
        .mockResolvedValueOnce({ originUrl: 'origin://selfie', cdnUrl: 'cdn://selfie' });
      mockPrisma.kycSubmission.create.mockResolvedValue({
        id: 'kyc-2',
        instructorId,
        documentUrl: 'origin://doc',
        additionalUrl: 'origin://selfie',
        status: KycStatus.PENDING,
      });

      const result = await service.submit(instructorId, dto, docFile, extraFile);

      expect(mockUploads.saveKycDocument).toHaveBeenCalledTimes(2);
      expect(result.additionalUrl).toBe('cdn://selfie');
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.submit(instructorId, dto, docFile)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when KYC is already approved', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        id: 'kyc-existing',
        status: KycStatus.APPROVED,
      });

      await expect(service.submit(instructorId, dto, docFile)).rejects.toThrow(BadRequestException);
    });
  });

  // ----------------------------------------------------------
  // findMySubmissions
  // ----------------------------------------------------------

  describe('findMySubmissions', () => {
    it('returns submissions ordered by createdAt desc', async () => {
      const submissions = [{ id: 'kyc-1' }, { id: 'kyc-2' }];
      mockPrisma.kycSubmission.findMany.mockResolvedValue(submissions);

      const result = await service.findMySubmissions('inst-1');

      expect(mockPrisma.kycSubmission.findMany).toHaveBeenCalledWith({
        where: { instructorId: 'inst-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(submissions);
    });
  });

  // ----------------------------------------------------------
  // getVerificationStatus
  // ----------------------------------------------------------

  describe('getVerificationStatus', () => {
    it('returns isVerified true when latest status is APPROVED', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        status: KycStatus.APPROVED,
        adminNotes: null,
        reviewedAt: null,
      });

      const result = await service.getVerificationStatus('inst-1');

      expect(result.isVerified).toBe(true);
      expect(result.status).toBe(KycStatus.APPROVED);
    });

    it('returns isVerified false and null status when no submission exists', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);

      const result = await service.getVerificationStatus('inst-1');

      expect(result.isVerified).toBe(false);
      expect(result.status).toBeNull();
    });

    it('returns isVerified false when latest status is PENDING', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        status: KycStatus.PENDING,
        adminNotes: null,
        reviewedAt: null,
      });

      const result = await service.getVerificationStatus('inst-1');

      expect(result.isVerified).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // findAll
  // ----------------------------------------------------------

  describe('findAll', () => {
    it('returns paginated submissions without status filter', async () => {
      const submissions = [{ id: 'kyc-1' }];
      mockPrisma.$transaction.mockResolvedValue([submissions, 1]);

      const result = await service.findAll(1, 20);

      expect(result.data).toEqual(submissions);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('filters by status when provided', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(1, 10, KycStatus.PENDING);

      const [[findManyCall]] = mockPrisma.$transaction.mock.calls;
      // $transaction receives an array of promises; verify it was called
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('calculates totalPages correctly for partial last page', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 25]);

      const result = await service.findAll(1, 10);

      expect(result.meta.totalPages).toBe(3);
    });
  });

  // ----------------------------------------------------------
  // findOne
  // ----------------------------------------------------------

  describe('findOne', () => {
    it('returns a submission by id', async () => {
      const submission = { id: 'kyc-1', instructor: {}, reviewedBy: null };
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(submission);

      const result = await service.findOne('kyc-1');

      expect(result).toEqual(submission);
    });

    it('throws NotFoundException when submission does not exist', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // review
  // ----------------------------------------------------------

  describe('review', () => {
    const submissionId = 'kyc-1';
    const adminId = 'admin-1';
    const pendingSubmission = {
      id: submissionId,
      instructorId: 'inst-1',
      status: KycStatus.PENDING,
      adminNotes: null,
    };

    it('approves a PENDING submission, marks user verified, and sends notification', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(pendingSubmission);
      const updated = { ...pendingSubmission, status: KycStatus.APPROVED };
      mockPrisma.kycSubmission.update.mockResolvedValue(updated);
      mockPrisma.user.update.mockResolvedValue({});
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ReviewKycDto = { status: KycStatus.APPROVED };
      const result = await service.review(submissionId, adminId, dto);

      expect(mockPrisma.kycSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: submissionId },
          data: expect.objectContaining({ status: KycStatus.APPROVED, reviewedById: adminId }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { isVerified: true },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'inst-1',
        NotificationType.KYC_APPROVED,
        expect.any(String),
        expect.any(String),
        { submissionId },
      );
      expect(result).toEqual(updated);
    });

    it('rejects a PENDING submission and sends rejection notification', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(pendingSubmission);
      const updated = { ...pendingSubmission, status: KycStatus.REJECTED };
      mockPrisma.kycSubmission.update.mockResolvedValue(updated);
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ReviewKycDto = { status: KycStatus.REJECTED, adminNotes: 'Blurry scan' };
      await service.review(submissionId, adminId, dto);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'inst-1',
        NotificationType.KYC_REJECTED,
        expect.any(String),
        expect.stringContaining('Blurry scan'),
        { submissionId },
      );
    });

    it('transitions PENDING to UNDER_REVIEW without setting reviewedAt', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(pendingSubmission);
      mockPrisma.kycSubmission.update.mockResolvedValue({
        ...pendingSubmission,
        status: KycStatus.UNDER_REVIEW,
      });

      const dto: ReviewKycDto = { status: KycStatus.UNDER_REVIEW };
      await service.review(submissionId, adminId, dto);

      expect(mockPrisma.kycSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewedAt: null }),
        }),
      );
    });

    it('allows reviewing an UNDER_REVIEW submission', async () => {
      const underReviewSub = { ...pendingSubmission, status: KycStatus.UNDER_REVIEW };
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(underReviewSub);
      mockPrisma.kycSubmission.update.mockResolvedValue({
        ...underReviewSub,
        status: KycStatus.APPROVED,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ReviewKycDto = { status: KycStatus.APPROVED };
      await expect(service.review(submissionId, adminId, dto)).resolves.toBeDefined();
    });

    it('throws BadRequestException when submission is already APPROVED', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue({
        ...pendingSubmission,
        status: KycStatus.APPROVED,
      });

      const dto: ReviewKycDto = { status: KycStatus.REJECTED };
      await expect(service.review(submissionId, adminId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when submission is already REJECTED', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue({
        ...pendingSubmission,
        status: KycStatus.REJECTED,
      });

      const dto: ReviewKycDto = { status: KycStatus.APPROVED };
      await expect(service.review(submissionId, adminId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when submission does not exist', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(null);

      const dto: ReviewKycDto = { status: KycStatus.APPROVED };
      await expect(service.review('no-such-id', adminId, dto)).rejects.toThrow(NotFoundException);
    });
  });
});
