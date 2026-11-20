import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentStatus, RefundStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { RefundsService } from './refunds.service';

describe('RefundsService', () => {
  let service: RefundsService;

  const mockPrisma: any = {
    enrollment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    refund: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };

  const mockStellar = { getTransactionStatus: jest.fn() };

  const enrollment = (overrides: Record<string, unknown> = {}) => ({
    id: 'e1',
    studentId: 's1',
    status: EnrollmentStatus.ACTIVE,
    enrolledAt: new Date(),
    amountPaid: 100,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a partial refund within the eligibility window', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment());
      mockPrisma.refund.findFirst.mockResolvedValue(null);
      mockPrisma.refund.create.mockResolvedValue({ id: 'r1' });

      await service.create('s1', { enrollmentId: 'e1', reason: 'x', requestedAmount: 40 } as any);

      expect(mockPrisma.refund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ requestedAmount: 40, isPartial: true }),
      });
    });

    it('rejects a missing enrollment', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      await expect(service.create('s1', { enrollmentId: 'e1' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects an enrollment owned by another student', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment({ studentId: 'other' }));
      await expect(service.create('s1', { enrollmentId: 'e1' } as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects an already refunded enrollment or an in-progress refund', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(
        enrollment({ status: EnrollmentStatus.REFUNDED }),
      );
      await expect(service.create('s1', { enrollmentId: 'e1' } as any)).rejects.toThrow(
        ConflictException,
      );

      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(enrollment());
      mockPrisma.refund.findFirst.mockResolvedValueOnce({ id: 'r0' });
      await expect(service.create('s1', { enrollmentId: 'e1' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects requests after the 14-day window', async () => {
      const enrolledAt = new Date();
      enrolledAt.setDate(enrolledAt.getDate() - 15);
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment({ enrolledAt }));
      mockPrisma.refund.findFirst.mockResolvedValue(null);

      await expect(service.create('s1', { enrollmentId: 'e1' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a requested amount above the amount paid', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment());
      mockPrisma.refund.findFirst.mockResolvedValue(null);

      await expect(
        service.create('s1', { enrollmentId: 'e1', requestedAmount: 150 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('forbids non-admins from reading a refund they do not own', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({ id: 'r1', studentId: 'other' });
      await expect(service.findOne('r1', 's1', UserRole.STUDENT)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets admins read any refund', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({ id: 'r1', studentId: 'other' });
      await expect(service.findOne('r1', 'admin', UserRole.ADMIN)).resolves.toEqual({
        id: 'r1',
        studentId: 'other',
      });
    });
  });

  describe('approve / reject', () => {
    it('approves a pending refund', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({
        id: 'r1',
        status: RefundStatus.PENDING,
        enrollmentId: 'e1',
        requestedAmount: 100,
      });
      mockPrisma.enrollment.findUniqueOrThrow.mockResolvedValue(enrollment());

      await service.approve('r1', 'admin', {} as any);

      expect(mockPrisma.refund.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({
          status: RefundStatus.APPROVED,
          approvedAmount: 100,
          isPartial: false,
        }),
      });
    });

    it('rejects an approved amount above the requested amount', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({
        id: 'r1',
        status: RefundStatus.PENDING,
        enrollmentId: 'e1',
        requestedAmount: 50,
      });
      mockPrisma.enrollment.findUniqueOrThrow.mockResolvedValue(enrollment());

      await expect(service.approve('r1', 'admin', { approvedAmount: 60 } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('only reviews PENDING refunds', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({ id: 'r1', status: RefundStatus.REJECTED });
      await expect(service.reject('r1', 'admin', { reason: 'no' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('process', () => {
    it('refuses to process a refund that is not APPROVED', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({ id: 'r1', status: RefundStatus.PENDING });
      await expect(service.process('r1', 'admin', { txHash: 'h' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a failed on-chain transaction', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({ id: 'r1', status: RefundStatus.APPROVED });
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: false });

      await expect(service.process('r1', 'admin', { txHash: 'h' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks the enrollment REFUNDED on a full refund', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({
        id: 'r1',
        status: RefundStatus.APPROVED,
        enrollmentId: 'e1',
        approvedAmount: 100,
      });
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.enrollment.findUniqueOrThrow.mockResolvedValue(enrollment());
      mockPrisma.refund.update.mockResolvedValue({ id: 'r1', status: RefundStatus.PROCESSED });

      const result = await service.process('r1', 'admin', { txHash: 'h' } as any);

      expect(mockPrisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EnrollmentStatus.REFUNDED },
      });
      expect(result).toEqual({ id: 'r1', status: RefundStatus.PROCESSED });
    });

    it('leaves the enrollment untouched on a partial refund', async () => {
      mockPrisma.refund.findUnique.mockResolvedValue({
        id: 'r1',
        status: RefundStatus.APPROVED,
        enrollmentId: 'e1',
        approvedAmount: 40,
      });
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.enrollment.findUniqueOrThrow.mockResolvedValue(enrollment());

      await service.process('r1', 'admin', { txHash: 'h' } as any);

      expect(mockPrisma.enrollment.update).not.toHaveBeenCalled();
    });
  });
});
