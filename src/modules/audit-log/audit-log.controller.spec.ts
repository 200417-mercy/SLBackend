import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

describe('AuditLogController (Issue #408) - Unit Tests for Endpoints', () => {
  let controller: AuditLogController;
  let service: AuditLogService;

  const mockPrisma = {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockService = {
    findAll: jest.fn(),
    exportAuditLogCsv: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogController,
        { provide: AuditLogService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    service = module.get<AuditLogService>(AuditLogService);
    jest.clearAllMocks();
  });

  describe('AuditLogController.findAll', () => {
    it('should return paginated audit logs', async () => {
      mockService.findAll.mockResolvedValue([{ id: 'log1' }, { id: 'log2' }]);

      const result = await controller.findAll({ page: 1, limit: 20 });
      expect(result).toBeDefined();
      expect(mockService.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    it('should return empty list when no logs exist', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll({ page: 1, limit: 20 });
      expect(result).toEqual([]);
    });
  });

  describe('AuditLogController.exportCsv', () => {
    it('should export audit logs as CSV', async () => {
      const csv = 'id,timestamp,action\nlog1,2026-01-01,create';
      const rowCount = 1;
      mockService.exportAuditLogCsv.mockResolvedValue({ csv, rowCount });

      const result = await controller.exportCsv({ page: 1, limit: 20 });
      expect(result).toEqual({ csv, rowCount });
      expect(mockService.exportAuditLogCsv).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    it('should return empty CSV when no logs exist', async () => {
      mockService.exportAuditLogCsv.mockResolvedValue({ csv: '', rowCount: 0 });

      const result = await controller.exportCsv({ page: 1, limit: 20 });
      expect(result).toEqual({ csv: '', rowCount: 0 });
    });
  });
});