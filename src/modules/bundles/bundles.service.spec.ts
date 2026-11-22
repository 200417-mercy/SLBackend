import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BundlesService } from './bundles.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateBundleDto } from './dto/create-bundle.dto';
import { EnrollBundleDto } from './dto/enroll-bundle.dto';

const mockPrisma = {
  course: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  bundle: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  bundleEnrollment: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  enrollment: {
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('BundlesService', () => {
  let service: BundlesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BundlesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BundlesService>(BundlesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ----------------------------------------------------------
  // create
  // ----------------------------------------------------------

  describe('create', () => {
    const instructorId = 'inst-1';
    const instructorAddress = 'GINSTR1';

    const courses = [
      { id: 'c1', instructorAddress, price: 50 },
      { id: 'c2', instructorAddress, price: 60 },
    ];

    const dto: CreateBundleDto = {
      title: 'Starter Pack',
      courseIds: ['c1', 'c2'],
      price: 79.99,
    };

    it('creates a bundle when all courses belong to the instructor and price is valid', async () => {
      mockPrisma.course.findMany.mockResolvedValue(courses);
      const bundle = { id: 'bundle-1', ...dto, instructorAddress };
      mockPrisma.bundle.create.mockResolvedValue(bundle);

      const result = await service.create(instructorId, instructorAddress, dto);

      expect(mockPrisma.bundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instructorAddress,
            title: dto.title,
            price: dto.price,
          }),
        }),
      );
      expect(result).toEqual(bundle);
    });

    it('throws NotFoundException when one or more course IDs are not found', async () => {
      mockPrisma.course.findMany.mockResolvedValue([courses[0]]); // only 1 of 2 found

      await expect(service.create(instructorId, instructorAddress, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.bundle.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a course belongs to a different instructor', async () => {
      const mixedCourses = [
        courses[0],
        { id: 'c2', instructorAddress: 'OTHER_ADDR', price: 60 },
      ];
      mockPrisma.course.findMany.mockResolvedValue(mixedCourses);

      await expect(service.create(instructorId, instructorAddress, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when bundle price is not less than individual total', async () => {
      const expensiveDto: CreateBundleDto = { ...dto, price: 110 }; // 50+60=110, not less than
      mockPrisma.course.findMany.mockResolvedValue(courses);

      await expect(service.create(instructorId, instructorAddress, expensiveDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when bundle price equals individual total', async () => {
      const equalDto: CreateBundleDto = { ...dto, price: 110 };
      mockPrisma.course.findMany.mockResolvedValue(courses);

      await expect(service.create(instructorId, instructorAddress, equalDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ----------------------------------------------------------
  // findAll
  // ----------------------------------------------------------

  describe('findAll', () => {
    it('returns paginated bundles without an instructor filter', async () => {
      const bundles = [{ id: 'bundle-1' }];
      mockPrisma.$transaction.mockResolvedValue([bundles, 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual(bundles);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20 });
    });

    it('passes instructorAddress filter through to the query', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ instructorAddress: 'GINSTR1', page: 1, limit: 10 });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // findOne
  // ----------------------------------------------------------

  describe('findOne', () => {
    it('returns a bundle by id', async () => {
      const bundle = { id: 'bundle-1', isActive: true, courses: [], instructor: {} };
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await service.findOne('bundle-1');

      expect(result).toEqual(bundle);
    });

    it('throws NotFoundException when bundle does not exist', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // enroll
  // ----------------------------------------------------------

  describe('enroll', () => {
    const studentId = 'student-1';
    const bundleId = 'bundle-1';

    const course1 = { id: 'c1', price: 50 };
    const course2 = { id: 'c2', price: 60 };

    const bundle = {
      id: bundleId,
      isActive: true,
      price: 79.99,
      courses: [{ course: course1 }, { course: course2 }],
      instructor: {},
      _count: { enrollments: 0 },
    };

    const dto: EnrollBundleDto = { txHash: 'tx-hash-123', amountPaid: 79.99 };

    it('enrolls a student and creates per-course enrollments', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue(null);

      const bundleEnrollmentResult = { id: 'be-1', bundleId, studentId };
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          bundleEnrollment: { create: jest.fn().mockResolvedValue(bundleEnrollmentResult) },
          enrollment: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
          course: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.enroll(studentId, bundleId, dto);

      expect(result).toEqual(bundleEnrollmentResult);
    });

    it('throws BadRequestException when bundle is inactive', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue({ ...bundle, isActive: false });

      await expect(service.enroll(studentId, bundleId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when student is already enrolled', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue({ id: 'existing-be' });

      await expect(service.enroll(studentId, bundleId, dto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when amountPaid is less than bundle price', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue(null);

      const shortDto: EnrollBundleDto = { txHash: 'tx-hash-123', amountPaid: 10 };
      await expect(service.enroll(studentId, bundleId, shortDto)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on a concurrent duplicate enrollment (P2002)', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue(null);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0', meta: {} },
      );
      mockPrisma.$transaction.mockRejectedValue(p2002Error);

      await expect(service.enroll(studentId, bundleId, dto)).rejects.toThrow(ConflictException);
    });

    it('skips course stats increment when student is already enrolled in a course (count = 0)', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(bundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue(null);

      const bundleEnrollmentResult = { id: 'be-1', bundleId, studentId };
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txCourseUpdate = jest.fn();
        const tx = {
          bundleEnrollment: { create: jest.fn().mockResolvedValue(bundleEnrollmentResult) },
          enrollment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) }, // already enrolled
          course: { update: txCourseUpdate },
        };
        const result = await fn(tx);
        expect(txCourseUpdate).not.toHaveBeenCalled();
        return result;
      });

      await service.enroll(studentId, bundleId, dto);
    });

    it('throws NotFoundException when bundle does not exist', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(null);

      await expect(service.enroll(studentId, bundleId, dto)).rejects.toThrow(NotFoundException);
    });
  });
});
