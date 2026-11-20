import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { DisputeStatus, UserRole } from '@prisma/client';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('DisputesController', () => {
  let controller: DisputesController;
  const mockService = {
    file: jest.fn(),
    findMyDisputes: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    markUnderReview: jest.fn(),
    resolve: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DisputesController],
      providers: [{ provide: DisputesService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DisputesController);
  });

  it('file passes studentId and dto', () => {
    const dto = { enrollmentId: 'e1', reason: 'Not delivered' } as any;
    const dispute = { id: 'd1', status: DisputeStatus.OPEN };
    mockService.file.mockReturnValue(dispute);

    expect(controller.file('student-1', dto)).toBe(dispute);
    expect(mockService.file).toHaveBeenCalledWith('student-1', dto);
  });

  it('findMy passes page and limit from the query', () => {
    controller.findMy('student-1', { page: 2, limit: 5 } as any);
    expect(mockService.findMyDisputes).toHaveBeenCalledWith('student-1', 2, 5);
  });

  it('findAll passes page, limit and status', () => {
    controller.findAll({ page: 1, limit: 10, status: DisputeStatus.OPEN } as any);
    expect(mockService.findAll).toHaveBeenCalledWith(1, 10, DisputeStatus.OPEN);
  });

  it('findAll handles a missing query', () => {
    controller.findAll(undefined as any);
    expect(mockService.findAll).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('markUnderReview and resolve delegate with the right arguments', () => {
    const dto = { resolution: 'Refund issued' } as any;
    controller.markUnderReview('d1');
    controller.resolve('d1', 'admin-1', dto);
    expect(mockService.markUnderReview).toHaveBeenCalledWith('d1');
    expect(mockService.resolve).toHaveBeenCalledWith('d1', 'admin-1', dto);
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, DisputesController)).toEqual([JwtAuthGuard]);
    });

    it('protects admin routes with RolesGuard and ADMIN role', () => {
      for (const method of ['findAll', 'findOne', 'markUnderReview', 'resolve']) {
        const handler = (DisputesController.prototype as any)[method];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
      }
    });

    it('RolesGuard rejects a student resolving a dispute', () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => DisputesController.prototype.resolve,
        getClass: () => DisputesController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.STUDENT } }) }),
      } as any;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
