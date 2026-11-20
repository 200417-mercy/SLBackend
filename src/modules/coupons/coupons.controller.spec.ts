import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@prisma/client';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CouponsController', () => {
  let controller: CouponsController;
  const mockCouponsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    getRedemptions: jest.fn(),
    validate: jest.fn(),
    redeem: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [{ provide: CouponsService, useValue: mockCouponsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(CouponsController);
  });

  it('create delegates with the user id and dto', () => {
    const dto = { code: 'SAVE20' } as any;
    const coupon = { id: 'c-1', code: 'SAVE20' };
    mockCouponsService.create.mockReturnValue(coupon);

    expect(controller.create('u-1', dto)).toBe(coupon);
    expect(mockCouponsService.create).toHaveBeenCalledWith('u-1', dto);
  });

  it('findAll passes page, limit and isActive', () => {
    controller.findAll({ page: 1, limit: 20, isActive: true } as any);
    expect(mockCouponsService.findAll).toHaveBeenCalledWith(1, 20, true);
  });

  it('findOne, update and deactivate delegate by id', () => {
    const dto = { maxUses: 5 } as any;
    controller.findOne('c-1');
    controller.update('c-1', dto);
    controller.deactivate('c-1');
    expect(mockCouponsService.findOne).toHaveBeenCalledWith('c-1');
    expect(mockCouponsService.update).toHaveBeenCalledWith('c-1', dto);
    expect(mockCouponsService.deactivate).toHaveBeenCalledWith('c-1');
  });

  it('getRedemptions passes id, page and limit', () => {
    controller.getRedemptions('c-1', { page: 3, limit: 10 } as any);
    expect(mockCouponsService.getRedemptions).toHaveBeenCalledWith('c-1', 3, 10);
  });

  it('validate returns the discounted price from the service', () => {
    const dto = { code: 'SAVE20', courseId: 'course-1', originalPrice: 50 } as ValidateCouponDto;
    const result = { valid: true, finalPrice: 40 };
    mockCouponsService.validate.mockReturnValue(result);

    expect(controller.validate('u-1', dto)).toBe(result);
    expect(mockCouponsService.validate).toHaveBeenCalledWith('u-1', dto);
  });

  it('redeem unpacks the body', () => {
    controller.redeem('u-1', { couponId: 'c-1', courseId: 'course-1', discountAmount: 10 });
    expect(mockCouponsService.redeem).toHaveBeenCalledWith('u-1', 'c-1', 'course-1', 10);
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CouponsController)).toEqual([JwtAuthGuard]);
    });

    it.each(['create', 'findAll', 'findOne', 'update', 'deactivate', 'getRedemptions'])(
      '%s is restricted to ADMIN and INSTRUCTOR',
      (method) => {
        const handler = CouponsController.prototype[method as keyof CouponsController];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN, UserRole.INSTRUCTOR]);
      },
    );

    it('RolesGuard rejects a student creating a coupon', () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => CouponsController.prototype.create,
        getClass: () => CouponsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.STUDENT } }) }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  it('rejects a validate payload with a non-positive price', async () => {
    const errors = await validate(
      plainToInstance(ValidateCouponDto, { code: 'SAVE20', courseId: 'course-1', originalPrice: 0 }),
    );
    expect(errors.map((e) => e.property)).toEqual(['originalPrice']);
  });
});
