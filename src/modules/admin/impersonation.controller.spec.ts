import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StartImpersonationDto } from './dto/start-impersonation.dto';

describe('ImpersonationController (Issue #407) - Unit Tests for Endpoints', () => {
  let controller: ImpersonationController;
  let service: ImpersonationService;

  const mockPrisma = {
    impersonation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockService = {
    startImpersonation: jest.fn(),
    getAuditTrail: jest.fn(),
    verifySession: jest.fn(),
    endSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpersonationController,
        { provide: ImpersonationService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<ImpersonationController>(ImpersonationController);
    service = module.get<ImpersonationService>(ImpersonationService);
    jest.clearAllMocks();
  });

  describe('ImpersonationController.startImpersonation', () => {
    it('should start impersonation successfully with valid admin and dto', async () => {
      const dto: StartImpersonationDto = {
        targetUserId: 'user-1',
        durationMinutes: 30,
      };

      mockService.startImpersonation.mockResolvedValue({ id: 'session-1', ...dto });

      const result = await controller.startImpersonation('admin-1', dto);
      expect(result).toBeDefined();
      expect(mockService.startImpersonation).toHaveBeenCalledWith('admin-1', dto);
    });

    it('should reject impersonation with invalid duration', async () => {
      const dto: StartImpersonationDto = {
        targetUserId: 'user-1',
        durationMinutes: -1,
      };

      await expect(controller.startImpersonation('admin-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('should reject impersonation for non-admin user', async () => {
      const dto: StartImpersonationDto = {
        targetUserId: 'user-1',
        durationMinutes: 30,
      };

      await expect(controller.startImpersonation('student-1', dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('ImpersonationController.getAuditTrail', () => {
    it('should return audit trail with pagination', async () => {
      mockService.getAuditTrail.mockResolvedValue([
        { id: 'log-1', action: 'start', userId: 'admin-1' },
        { id: 'log-2', action: 'end', userId: 'admin-1' },
      ]);

      const result = await controller.getAuditTrail({ page: 1, limit: 10 });
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should return empty list when no audits exist', async () => {
      mockService.getAuditTrail.mockResolvedValue([]);

      const result = await controller.getAuditTrail({ page: 1, limit: 10 });
      expect(result).toEqual([]);
    });
  });

  describe('ImpersonationController.verifySession', () => {
    it('should verify active session', async () => {
      mockService.verifySession.mockResolvedValue({ id: 'session-1', active: true });

      const result = await controller.verifySession('session-1');
      expect(result).toBeDefined();
      expect(mockService.verifySession).toHaveBeenCalledWith('session-1');
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockService.verifySession.mockResolvedValue(null);

      await expect(controller.verifySession('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('ImpersonationController.endSession', () => {
    it('should end session successfully', async () => {
      mockService.endSession.mockResolvedValue({ id: 'session-1', ended: true });

      const result = await controller.endSession('session-1', 'admin-1');
      expect(result).toBeDefined();
      expect(mockService.endSession).toHaveBeenCalledWith('session-1', 'admin-1');
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockService.endSession.mockResolvedValue(null);

      await expect(controller.endSession('nonexistent', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });
});