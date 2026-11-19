import { Test, TestingModule } from '@nestjs/testing';
import { ReportStatus, ReportTargetType, UserRole } from '@prisma/client';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('ReportsController', () => {
  let controller: ReportsController;

  const mockService = {
    create: jest.fn(),
    findMine: jest.fn(),
    findOneForReporter: jest.fn(),
    adminFindAll: jest.fn(),
    adminTopReportedTargets: jest.fn(),
    getCountForTarget: jest.fn(),
    adminFindOne: jest.fn(),
    adminUpdateStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('create delegates with the reporter id and dto', async () => {
    const dto = { targetId: 'c1' } as any;
    await controller.create('user-1', dto);
    expect(mockService.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('findMine passes status, page and limit', async () => {
    await controller.findMine('user-1', { status: ReportStatus.PENDING, page: 2, limit: 5 } as any);
    expect(mockService.findMine).toHaveBeenCalledWith('user-1', ReportStatus.PENDING, 2, 5);
  });

  it('findOneMine delegates with the report and reporter ids', async () => {
    await controller.findOneMine('r1', 'user-1');
    expect(mockService.findOneForReporter).toHaveBeenCalledWith('r1', 'user-1');
  });

  it('adminFindAll maps the query into filters', async () => {
    await controller.adminFindAll({
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.COURSE,
      page: 1,
      limit: 10,
    } as any);
    expect(mockService.adminFindAll).toHaveBeenCalledWith(
      { status: ReportStatus.PENDING, targetType: ReportTargetType.COURSE, category: undefined, severity: undefined },
      1,
      10,
    );
  });

  it('admin routes delegate to the service', async () => {
    await controller.adminTopTargets({ limit: 3 } as any);
    expect(mockService.adminTopReportedTargets).toHaveBeenCalledWith(3);

    await controller.adminTargetCount(ReportTargetType.COURSE, 'c1');
    expect(mockService.getCountForTarget).toHaveBeenCalledWith(ReportTargetType.COURSE, 'c1');

    await controller.adminFindOne('r1');
    expect(mockService.adminFindOne).toHaveBeenCalledWith('r1');

    const dto = { status: ReportStatus.RESOLVED } as any;
    await controller.adminUpdateStatus('r1', 'admin-1', dto);
    expect(mockService.adminUpdateStatus).toHaveBeenCalledWith('r1', 'admin-1', dto);
  });

  it('protects the controller with JwtAuthGuard', () => {
    expect(Reflect.getMetadata('__guards__', ReportsController)).toContain(JwtAuthGuard);
  });

  it('requires RolesGuard and ADMIN on every admin route', () => {
    const adminRoutes = [
      'adminFindAll',
      'adminTopTargets',
      'adminTargetCount',
      'adminFindOne',
      'adminUpdateStatus',
    ] as const;
    for (const route of adminRoutes) {
      const handler = ReportsController.prototype[route];
      expect(Reflect.getMetadata('__guards__', handler)).toContain(RolesGuard);
      expect(Reflect.getMetadata('roles', handler)).toContain(UserRole.ADMIN);
    }
  });

  it('does not require ADMIN on reporter routes', () => {
    for (const route of ['create', 'findMine', 'findOneMine'] as const) {
      expect(Reflect.getMetadata('roles', ReportsController.prototype[route])).toBeUndefined();
    }
  });
});
