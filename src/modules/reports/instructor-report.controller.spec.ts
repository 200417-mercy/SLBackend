import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { InstructorReportController } from './instructor-report.controller';
import { InstructorReportService } from './instructor-report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('InstructorReportController', () => {
  let controller: InstructorReportController;

  const mockService = { getReport: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstructorReportController],
      providers: [{ provide: InstructorReportService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<InstructorReportController>(InstructorReportController);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates getReport to the service with the instructor id and query', async () => {
    const query = { from: '2026-01-01', to: '2026-02-01' } as any;
    mockService.getReport.mockResolvedValue({ instructorId: 'inst-1' });

    const result = await controller.getReport('inst-1', query);

    expect(mockService.getReport).toHaveBeenCalledWith('inst-1', query);
    expect(result).toEqual({ instructorId: 'inst-1' });
  });

  it('applies JwtAuthGuard and RolesGuard and requires ADMIN', () => {
    const guards = Reflect.getMetadata('__guards__', InstructorReportController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata('roles', InstructorReportController)).toContain(UserRole.ADMIN);
  });
});
