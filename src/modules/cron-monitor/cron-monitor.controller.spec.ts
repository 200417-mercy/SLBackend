import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CronMonitorController } from './cron-monitor.controller';
import { CronMonitorService } from './cron-monitor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CronMonitorController', () => {
  let controller: CronMonitorController;
  const mockService = {
    findAll: jest.fn(),
    getStats: jest.fn(),
    findStaleRuns: jest.fn(),
    markStaleRunsFailed: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CronMonitorController],
      providers: [{ provide: CronMonitorService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(CronMonitorController);
  });

  it('findAll passes the query through', () => {
    const query = { page: 1, limit: 10 } as any;
    const result = { data: [], total: 0 };
    mockService.findAll.mockReturnValue(result);

    expect(controller.findAll(query)).toBe(result);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });

  it('getStats delegates to the service', () => {
    const stats = [{ jobName: 'cleanup', successRate: 1 }];
    mockService.getStats.mockReturnValue(stats);

    expect(controller.getStats()).toBe(stats);
  });

  it('findStale parses thresholdMinutes as an integer', () => {
    controller.findStale('45');
    expect(mockService.findStaleRuns).toHaveBeenCalledWith(45);
  });

  it('findStale passes undefined when thresholdMinutes is omitted', () => {
    controller.findStale();
    expect(mockService.findStaleRuns).toHaveBeenCalledWith(undefined);
  });

  it('markStaleFailed parses thresholdMinutes and delegates', () => {
    const result = { count: 2 };
    mockService.markStaleRunsFailed.mockReturnValue(result);

    expect(controller.markStaleFailed('10')).toBe(result);
    expect(mockService.markStaleRunsFailed).toHaveBeenCalledWith(10);
  });

  it('findOne delegates with the id', () => {
    controller.findOne('run-1');
    expect(mockService.findOne).toHaveBeenCalledWith('run-1');
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CronMonitorController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    });

    it('restricts the controller to ADMIN role', () => {
      expect(Reflect.getMetadata(ROLES_KEY, CronMonitorController)).toEqual([UserRole.ADMIN]);
    });

    it('RolesGuard rejects a non-admin user', () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => CronMonitorController.prototype.getStats,
        getClass: () => CronMonitorController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.STUDENT } }) }),
      } as any;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
