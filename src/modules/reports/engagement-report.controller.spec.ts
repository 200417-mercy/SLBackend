import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { EngagementReportController } from './engagement-report.controller';
import { EngagementReportService } from './engagement-report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('EngagementReportController', () => {
  let controller: EngagementReportController;

  const mockService = {
    getReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EngagementReportController],
      providers: [{ provide: EngagementReportService, useValue: mockService }, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<EngagementReportController>(EngagementReportController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getReport delegates to the service with the query', async () => {
    const query = { inactiveDays: 14 } as any;
    const expected = { students: [] };
    mockService.getReport.mockResolvedValue(expected);

    await expect(controller.getReport(query)).resolves.toEqual(expected);
    expect(mockService.getReport).toHaveBeenCalledWith(query);
  });

  describe('Guard and Role Decorators', () => {
    it('applies JwtAuthGuard and RolesGuard at the class level', () => {
      const guards = Reflect.getMetadata('__guards__', EngagementReportController);
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    });

    it('requires ADMIN or INSTRUCTOR role', () => {
      const roles = Reflect.getMetadata('roles', EngagementReportController);
      expect(roles).toEqual([UserRole.ADMIN, UserRole.INSTRUCTOR]);
    });
  });
});
