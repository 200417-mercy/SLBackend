import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  DisputeStatus,
  DisputeReferenceType,
  NotificationType,
} from '@prisma/client';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FileDisputeDto } from './dto/file-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

const mockPrisma = {
  dispute: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  enrollment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockNotifications = {
  notifyUser: jest.fn(),
};

describe('DisputesService', () => {
  let service: DisputesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<DisputesService>(DisputesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ----------------------------------------------------------
  // file
  // ----------------------------------------------------------

  describe('file', () => {
    const studentId = 'student-1';
    const enrollmentId = 'enroll-1';

    const dto: FileDisputeDto = {
      referenceType: DisputeReferenceType.ENROLLMENT,
      referenceId: enrollmentId,
      subject: 'Course content mismatch',
      description: 'The advertised content does not match what was delivered.',
    };

    it('files a dispute for a valid ENROLLMENT reference', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: enrollmentId,
        studentId,
      });
      const created = { id: 'disp-1', ...dto, filedById: studentId, status: DisputeStatus.OPEN };
      mockPrisma.dispute.create.mockResolvedValue(created);

      const result = await service.file(studentId, dto);

      expect(mockPrisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { id: enrollmentId },
      });
      expect(mockPrisma.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filedById: studentId,
            status: DisputeStatus.OPEN,
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('files a dispute for a valid PAYMENT reference', async () => {
      const paymentDto: FileDisputeDto = {
        ...dto,
        referenceType: DisputeReferenceType.PAYMENT,
        referenceId: 'tx-hash-abc',
      };
      mockPrisma.enrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        studentId,
        txHash: 'tx-hash-abc',
      });
      mockPrisma.dispute.create.mockResolvedValue({ id: 'disp-2', status: DisputeStatus.OPEN });

      await service.file(studentId, paymentDto);

      expect(mockPrisma.enrollment.findFirst).toHaveBeenCalledWith({
        where: { txHash: 'tx-hash-abc', studentId },
      });
      expect(mockPrisma.dispute.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when enrollment reference does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.file(studentId, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dispute.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when enrollment belongs to a different student', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: enrollmentId,
        studentId: 'other-student',
      });

      await expect(service.file(studentId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when PAYMENT txHash is not found for this student', async () => {
      const paymentDto: FileDisputeDto = {
        ...dto,
        referenceType: DisputeReferenceType.PAYMENT,
        referenceId: 'missing-tx',
      };
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);

      await expect(service.file(studentId, paymentDto)).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // findAll
  // ----------------------------------------------------------

  describe('findAll', () => {
    it('returns paginated disputes without a status filter', async () => {
      const disputes = [{ id: 'disp-1' }, { id: 'disp-2' }];
      mockPrisma.$transaction.mockResolvedValue([disputes, 2]);

      const result = await service.findAll(1, 20);

      expect(result.data).toEqual(disputes);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('calculates totalPages correctly for a partial last page', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 25]);

      const result = await service.findAll(1, 10);

      expect(result.meta.totalPages).toBe(3);
    });

    it('passes status filter to the query', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(1, 10, DisputeStatus.OPEN);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // findOne
  // ----------------------------------------------------------

  describe('findOne', () => {
    it('returns a dispute by id', async () => {
      const dispute = { id: 'disp-1', filedBy: {}, resolvedBy: null };
      mockPrisma.dispute.findUnique.mockResolvedValue(dispute);

      const result = await service.findOne('disp-1');

      expect(result).toEqual(dispute);
    });

    it('throws NotFoundException when dispute does not exist', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue(null);

      await expect(service.findOne('no-such-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // findMyDisputes
  // ----------------------------------------------------------

  describe('findMyDisputes', () => {
    it('returns paginated disputes for the authenticated student', async () => {
      const disputes = [{ id: 'disp-1' }];
      mockPrisma.$transaction.mockResolvedValue([disputes, 1]);

      const result = await service.findMyDisputes('student-1', 1, 20);

      expect(result.data).toEqual(disputes);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20 });
    });
  });

  // ----------------------------------------------------------
  // markUnderReview
  // ----------------------------------------------------------

  describe('markUnderReview', () => {
    it('transitions an OPEN dispute to UNDER_REVIEW', async () => {
      const dispute = { id: 'disp-1', status: DisputeStatus.OPEN, filedBy: {}, resolvedBy: null };
      mockPrisma.dispute.findUnique.mockResolvedValue(dispute);
      const updated = { ...dispute, status: DisputeStatus.UNDER_REVIEW };
      mockPrisma.dispute.update.mockResolvedValue(updated);

      const result = await service.markUnderReview('disp-1');

      expect(mockPrisma.dispute.update).toHaveBeenCalledWith({
        where: { id: 'disp-1' },
        data: { status: DisputeStatus.UNDER_REVIEW },
      });
      expect(result.status).toBe(DisputeStatus.UNDER_REVIEW);
    });

    it('throws BadRequestException when dispute is not OPEN', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        id: 'disp-1',
        status: DisputeStatus.UNDER_REVIEW,
        filedBy: {},
        resolvedBy: null,
      });

      await expect(service.markUnderReview('disp-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ----------------------------------------------------------
  // resolve
  // ----------------------------------------------------------

  describe('resolve', () => {
    const adminId = 'admin-1';
    const openDispute = {
      id: 'disp-1',
      filedById: 'student-1',
      subject: 'Content mismatch',
      status: DisputeStatus.OPEN,
      filedBy: {},
      resolvedBy: null,
    };

    it('resolves an OPEN dispute and sends a notification', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue(openDispute);
      const updated = { ...openDispute, status: DisputeStatus.RESOLVED };
      mockPrisma.dispute.update.mockResolvedValue(updated);
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ResolveDisputeDto = {
        status: DisputeStatus.RESOLVED,
        adminNotes: 'Partial refund issued.',
      };
      const result = await service.resolve('disp-1', adminId, dto);

      expect(mockPrisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'disp-1' },
          data: expect.objectContaining({
            status: DisputeStatus.RESOLVED,
            resolvedById: adminId,
          }),
        }),
      );
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.DISPUTE_RESOLVED,
        expect.any(String),
        expect.stringContaining('Partial refund issued.'),
        { disputeId: 'disp-1', status: DisputeStatus.RESOLVED },
      );
      expect(result).toEqual(updated);
    });

    it('rejects an OPEN dispute', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue(openDispute);
      mockPrisma.dispute.update.mockResolvedValue({ ...openDispute, status: DisputeStatus.REJECTED });
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ResolveDisputeDto = { status: DisputeStatus.REJECTED, adminNotes: 'No merit.' };
      const result = await service.resolve('disp-1', adminId, dto);

      expect(result.status).toBe(DisputeStatus.REJECTED);
    });

    it('transitions UNDER_REVIEW dispute to RESOLVED', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        ...openDispute,
        status: DisputeStatus.UNDER_REVIEW,
      });
      mockPrisma.dispute.update.mockResolvedValue({
        ...openDispute,
        status: DisputeStatus.RESOLVED,
      });
      mockNotifications.notifyUser.mockResolvedValue(undefined);

      const dto: ResolveDisputeDto = { status: DisputeStatus.RESOLVED, adminNotes: 'Done.' };
      await expect(service.resolve('disp-1', adminId, dto)).resolves.toBeDefined();
    });

    it('throws BadRequestException for an invalid status transition from RESOLVED', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        ...openDispute,
        status: DisputeStatus.RESOLVED,
      });

      const dto: ResolveDisputeDto = { status: DisputeStatus.REJECTED, adminNotes: 'Re-open attempt.' };
      await expect(service.resolve('disp-1', adminId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an invalid transition from REJECTED', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue({
        ...openDispute,
        status: DisputeStatus.REJECTED,
      });

      const dto: ResolveDisputeDto = { status: DisputeStatus.RESOLVED, adminNotes: 'Override.' };
      await expect(service.resolve('disp-1', adminId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when dispute does not exist', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue(null);

      const dto: ResolveDisputeDto = { status: DisputeStatus.RESOLVED, adminNotes: 'N/A' };
      await expect(service.resolve('no-such-id', adminId, dto)).rejects.toThrow(NotFoundException);
    });
  });
});
