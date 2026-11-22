import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscountType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

describe('CouponsService', () => {
  let service: CouponsService;

  const mockPrisma = {
    coupon: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    couponRedemption: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const baseCoupon = {
    id: 'coupon-1',
    code: 'SAVE20',
    discountType: DiscountType.PERCENTAGE,
    discountValue: '20',
    maxRedemptions: null,
    minOrderAmount: null,
    expiresAt: null,
    courseId: null,
    isActive: true,
    redemptionCount: 0,
    createdAt: new Date(),
    createdById: 'admin-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb) =>
      Array.isArray(cb) ? Promise.all(cb) : Promise.resolve(cb(mockPrisma)),
    );
  });

  describe('create()', () => {
    const dto: CreateCouponDto = {
      code: 'SAVE20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
    };

    it('creates a new coupon with valid percentage discount', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      mockPrisma.coupon.create.mockResolvedValue({
        ...baseCoupon,
        createdBy: { id: 'admin-1', name: 'Admin', role: 'ADMIN' },
      });

      await expect(service.create('admin-1', dto)).resolves.toMatchObject({
        code: 'SAVE20',
        discountType: DiscountType.PERCENTAGE,
      });

      expect(mockPrisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'SAVE20',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 20,
          }),
        }),
      );
    });

    it('creates a coupon with fixed discount', async () => {
      const fixedDto: CreateCouponDto = {
        code: 'FIXED10',
        discountType: DiscountType.FIXED,
        discountValue: 10.5,
      };
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      mockPrisma.coupon.create.mockResolvedValue({
        ...baseCoupon,
        code: 'FIXED10',
        discountType: DiscountType.FIXED,
        discountValue: '10.5',
      });

      await expect(service.create('admin-1', fixedDto)).resolves.toBeTruthy();
    });

    it('converts code to uppercase and trims whitespace', async () => {
      const lowerDto: CreateCouponDto = {
        code: '  save20  ',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
      };
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      mockPrisma.coupon.create.mockResolvedValue(baseCoupon);

      await service.create('admin-1', lowerDto);

      expect(mockPrisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'SAVE20' }),
        }),
      );
    });

    it('throws ConflictException if code already exists', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(baseCoupon);

      await expect(service.create('admin-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException if code format is invalid', async () => {
      const badDto: CreateCouponDto = {
        code: 'AB',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
      };

      await expect(service.create('admin-1', badDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if discount value is zero', async () => {
      const zeroDto: CreateCouponDto = {
        code: 'ZERO',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 0,
      };

      await expect(service.create('admin-1', zeroDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if percentage exceeds 100', async () => {
      const tooHighDto: CreateCouponDto = {
        code: 'TOOHIGH',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 150,
      };

      await expect(service.create('admin-1', tooHighDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if minOrderAmount is negative', async () => {
      const negativeDto: CreateCouponDto = {
        code: 'NEGATIVE',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        minOrderAmount: -5,
      };

      await expect(service.create('admin-1', negativeDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if maxRedemptions is negative', async () => {
      const negativeDto: CreateCouponDto = {
        code: 'NEG',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        maxRedemptions: -1,
      };

      await expect(service.create('admin-1', negativeDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if expiresAt is in the past', async () => {
      const pastDto: CreateCouponDto = {
        code: 'PAST',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      };

      await expect(service.create('admin-1', pastDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if courseId does not exist', async () => {
      const courseDto: CreateCouponDto = {
        code: 'COURSE20',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        courseId: 'missing-course',
      };
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.create('admin-1', courseDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates coupon with optional fields', async () => {
      const fullDto: CreateCouponDto = {
        code: 'FULL',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        maxRedemptions: 100,
        minOrderAmount: 50,
        expiresAt: new Date(Date.now() + 86400000), // tomorrow
        courseId: 'course-1',
        isActive: false,
      };
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      mockPrisma.coupon.create.mockResolvedValue({
        ...baseCoupon,
        code: 'FULL',
        maxRedemptions: 100,
        minOrderAmount: '50',
        isActive: false,
      });

      await expect(service.create('admin-1', fullDto)).resolves.toBeTruthy();
    });
  });

  describe('findAll()', () => {
    it('returns paginated coupons', async () => {
      const coupons = [baseCoupon, { ...baseCoupon, id: 'coupon-2' }];
      mockPrisma.$transaction.mockResolvedValue([coupons, 2]);

      const result = await service.findAll(1, 20);

      expect(result.data).toEqual(coupons);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('filters by isActive when provided', async () => {
      mockPrisma.$transaction.mockResolvedValue([[baseCoupon], 1]);

      await service.findAll(1, 20, true);

      const transactionArgs = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArgs).toHaveLength(2);
    });

    it('handles pagination correctly', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 50]);

      await service.findAll(3, 10);

      // Transaction should include findMany with skip: 20, take: 10
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findOne()', () => {
    it('returns coupon with relations', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue({
        ...baseCoupon,
        createdBy: { id: 'admin-1', name: 'Admin', role: 'ADMIN' },
        _count: { redemptions: 5 },
      });

      await expect(service.findOne('coupon-1')).resolves.toMatchObject({
        id: 'coupon-1',
        code: 'SAVE20',
      });
    });

    it('throws NotFoundException if coupon does not exist', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByCode()', () => {
    it('returns coupon by code', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(baseCoupon);

      await expect(service.findByCode('SAVE20')).resolves.toEqual(baseCoupon);
      expect(mockPrisma.coupon.findUnique).toHaveBeenCalledWith({
        where: { code: 'SAVE20' },
      });
    });

    it('converts code to uppercase before lookup', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(baseCoupon);

      await service.findByCode('  save20  ');

      expect(mockPrisma.coupon.findUnique).toHaveBeenCalledWith({
        where: { code: 'SAVE20' },
      });
    });

    it('throws NotFoundException if code does not exist', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);

      await expect(service.findByCode('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update()', () => {
    const dto: UpdateCouponDto = { discountValue: 25 };

    it('updates coupon fields', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue({
        ...baseCoupon,
        createdBy: { id: 'admin-1', name: 'Admin', role: 'ADMIN' },
        _count: { redemptions: 0 },
      });
      mockPrisma.coupon.update.mockResolvedValue({
        ...baseCoupon,
        discountValue: '25',
      });

      await expect(service.update('coupon-1', dto)).resolves.toMatchObject({
        discountValue: '25',
      });
    });

    it('validates discount value constraints', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue({
        ...baseCoupon,
        createdBy: {}, _count: { redemptions: 0 },
      });

      await expect(
        service.update('coupon-1', { discountValue: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if coupon does not exist', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivate()', () => {
    it('sets isActive to false', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue({
        ...baseCoupon,
        createdBy: {}, _count: { redemptions: 0 },
      });
      mockPrisma.coupon.update.mockResolvedValue({
        ...baseCoupon,
        isActive: false,
      });

      await service.deactivate('coupon-1');

      expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: { isActive: false },
      });
    });
  });
});
