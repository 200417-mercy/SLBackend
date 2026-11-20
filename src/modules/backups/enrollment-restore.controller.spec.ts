import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentRestoreController } from './enrollment-restore.controller';
import { EnrollmentRestoreService } from './enrollment-restore.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RestoreEnrollmentsDto } from './dto/restore-enrollments.dto';

describe('EnrollmentRestoreController (Issue #205) - Unit Tests for Endpoints', () => {
  let controller: EnrollmentRestoreController;
  let service: EnrollmentRestoreService;

  const mockPrisma = {
    enrollmentRestore: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockService = {
    restore: jest.fn(),
    listReports: jest.fn(),
    getReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentRestoreController,
        { provide: EnrollmentRestoreService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<EnrollmentRestoreController>(EnrollmentRestoreController);
    service = module.get<EnrollmentRestoreService>(EnrollmentRestoreService);
    jest.clearAllMocks();
  });

  describe('EnrollmentRestoreController.restore', () => {
    it('should restore enrollments successfully', async () => {
      const dto: RestoreEnrollmentsDto = {
        backupId: 'backup-1',
        enrollments: [],
      };

      mockService.restore.mockResolvedValue({ id: 'restore-1', ...dto });

      const result = await controller.restore('admin-1', dto);
      expect(result).toBeDefined();
      expect(mockService.restore).toHaveBeenCalledWith('admin-1', dto);
    });

    it('should reject restore with missing backupId', async () => {
      const dto: RestoreEnrollmentsDto = {
        enrollments: [],
      };

      await expect(controller.restore('admin-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('EnrollmentRestoreController.listReports', () => {
    it('should return list of restore reports', async () => {
      mockService.listReports.mockResolvedValue([{ id: 'report-1' }]);

      const result = await controller.listReports();
      expect(result).toBeDefined();
      expect(mockService.listReports).toHaveBeenCalled();
    });

    it('should return empty list when no reports exist', async () => {
      mockService.listReports.mockResolvedValue([]);

      const result = await controller.listReports();
      expect(result).toEqual([]);
    });
  });

  describe('EnrollmentRestoreController.getReport', () => {
    it('should return a restore report by id', async () => {
      mockService.getReport.mockResolvedValue({ id: 'report-1', data: 'report data' });

      const result = await controller.getReport('report-1');
      expect(result).toBeDefined();
      expect(mockService.getReport).toHaveBeenCalledWith('report-1');
    });

    it('should throw NotFoundException for non-existent report', async () => {
      mockService.getReport.mockResolvedValue(null);

      await expect(controller.getReport('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});