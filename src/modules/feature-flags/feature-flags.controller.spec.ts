import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    evaluate: jest.fn(),
    evaluateAll: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [{ provide: FeatureFlagsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(FeatureFlagsController);
  });

  it('CRUD routes delegate to the service', () => {
    const createDto = { key: 'new_flow', enabled: false } as any;
    const updateDto = { enabled: true } as any;
    controller.create(createDto);
    controller.findAll();
    controller.findOne('new_flow');
    controller.update('new_flow', updateDto);
    controller.remove('new_flow');

    expect(mockService.create).toHaveBeenCalledWith(createDto);
    expect(mockService.findAll).toHaveBeenCalled();
    expect(mockService.findOne).toHaveBeenCalledWith('new_flow');
    expect(mockService.update).toHaveBeenCalledWith('new_flow', updateDto);
    expect(mockService.remove).toHaveBeenCalledWith('new_flow');
  });

  it('enable and disable delegate with the key', () => {
    controller.enable('new_flow');
    controller.disable('new_flow');
    expect(mockService.enable).toHaveBeenCalledWith('new_flow');
    expect(mockService.disable).toHaveBeenCalledWith('new_flow');
  });

  it('evaluate uses the caller identity when no override is given', () => {
    controller.evaluate('new_flow', 'user-1', UserRole.STUDENT, {} as any);
    expect(mockService.evaluate).toHaveBeenCalledWith('new_flow', {
      userId: 'user-1',
      role: UserRole.STUDENT,
    });
  });

  it('evaluateAll prefers query overrides', () => {
    controller.evaluateAll('user-1', UserRole.STUDENT, { userId: 'user-2', role: 'INSTRUCTOR' } as any);
    expect(mockService.evaluateAll).toHaveBeenCalledWith({ userId: 'user-2', role: 'INSTRUCTOR' });
  });

  describe('guard wiring', () => {
    const adminRoutes = ['create', 'findAll', 'findOne', 'update', 'remove', 'enable', 'disable'];

    it('admin routes use JwtAuthGuard, RolesGuard and ADMIN role', () => {
      for (const method of adminRoutes) {
        const handler = (FeatureFlagsController.prototype as any)[method];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
      }
    });

    it('evaluation routes require JwtAuthGuard only', () => {
      for (const method of ['evaluate', 'evaluateAll']) {
        const handler = (FeatureFlagsController.prototype as any)[method];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      }
    });
  });
});


