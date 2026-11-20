import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RevenueReportController } from './revenue-report.controller';
import { RevenueReportService } from './revenue-report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('RevenueReportController', () => {
  let controller: RevenueReportController;

  const mockService = {
    generate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RevenueReportController],
      providers: [{ provide: RevenueReportService, useValue: mockService }, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<RevenueReportController>(RevenueReportController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('generate delegates to the service with the query', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-01-31', format: 'json' } as any;
    const expected = { total: 0, instructors: [] };
    mockService.generate.mockResolvedValue(expected);

    await expect(controller.generate(query)).resolves.toEqual(expected);
    expect(mockService.generate).toHaveBeenCalledWith(query);
  });

  describe('Guard and Role Decorators', () => {
    it('applies JwtAuthGuard and RolesGuard at the class level', () => {
      const guards = Reflect.getMetadata('__guards__', RevenueReportController);
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    });

    it('requires ADMIN role only', () => {
      const roles = Reflect.getMetadata('roles', RevenueReportController);
      expect(roles).toEqual([UserRole.ADMIN]);
    });
  });
});
