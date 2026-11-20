import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { FraudFlagStatus, FraudRiskLevel, UserRole } from '@prisma/client';
import { FraudController } from './fraud.controller';
import { FraudDetectionService } from './fraud-detection.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('FraudController', () => {
  let controller: FraudController;

  const mockFraudDetection = {
    getFraudReviewQueue: jest.fn(),
    getStudentRiskProfile: jest.fn(),
    getFlagById: jest.fn(),
    reviewFlag: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FraudController],
      providers: [{ provide: FraudDetectionService, useValue: mockFraudDetection }],
    }).compile();

    controller = module.get<FraudController>(FraudController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getQueue', () => {
    it('passes filters and pagination to the service', async () => {
      const queue = { data: [{ id: 'flag-1' }], meta: { total: 1, page: 2, limit: 5 } };
      mockFraudDetection.getFraudReviewQueue.mockResolvedValue(queue);

      const res = await controller.getQueue({
        status: FraudFlagStatus.OPEN,
        riskLevel: FraudRiskLevel.HIGH,
        page: 2,
        limit: 5,
      } as any);

      expect(mockFraudDetection.getFraudReviewQueue).toHaveBeenCalledWith(
        { status: FraudFlagStatus.OPEN, riskLevel: FraudRiskLevel.HIGH },
        2,
        5,
      );
      expect(res).toEqual(queue);
    });

    it('passes undefined filters when no query is given', async () => {
      mockFraudDetection.getFraudReviewQueue.mockResolvedValue({ data: [] });

      await controller.getQueue(undefined as any);

      expect(mockFraudDetection.getFraudReviewQueue).toHaveBeenCalledWith(
        { status: undefined, riskLevel: undefined },
        undefined,
        undefined,
      );
    });
  });

  describe('getStudentProfile', () => {
    it('returns the student risk profile', async () => {
      mockFraudDetection.getStudentRiskProfile.mockResolvedValue({ totalFlags: 3 });

      const res = await controller.getStudentProfile('student-1');

      expect(mockFraudDetection.getStudentRiskProfile).toHaveBeenCalledWith('student-1');
      expect(res).toEqual({ totalFlags: 3 });
    });
  });

  describe('getFlag', () => {
    it('returns a single flag', async () => {
      mockFraudDetection.getFlagById.mockResolvedValue({ id: 'flag-1' });

      await expect(controller.getFlag('flag-1')).resolves.toEqual({ id: 'flag-1' });
      expect(mockFraudDetection.getFlagById).toHaveBeenCalledWith('flag-1');
    });

    it('propagates NotFoundException for an unknown flag', async () => {
      mockFraudDetection.getFlagById.mockRejectedValue(new NotFoundException());

      await expect(controller.getFlag('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reviewFlag', () => {
    it('forwards flag id, admin id and decision', async () => {
      const dto = { decision: 'CONFIRMED' as const, reviewNotes: 'card testing' };
      mockFraudDetection.reviewFlag.mockResolvedValue({ id: 'flag-1', status: 'CONFIRMED' });

      const res = await controller.reviewFlag('flag-1', 'admin-1', dto);

      expect(mockFraudDetection.reviewFlag).toHaveBeenCalledWith('flag-1', 'admin-1', dto);
      expect(res).toEqual({ id: 'flag-1', status: 'CONFIRMED' });
    });
  });

  describe('access control', () => {
    it('requires JWT auth and the ADMIN role on the controller', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, FraudController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, FraudController)).toEqual([UserRole.ADMIN]);
    });

    it.each([UserRole.STUDENT, UserRole.INSTRUCTOR])('RolesGuard rejects %s', (role) => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => FraudController.prototype.reviewFlag,
        getClass: () => FraudController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
