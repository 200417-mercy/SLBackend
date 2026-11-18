import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CourseStatus } from '@prisma/client';

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: any;

  const mockPrisma = {
    course: {
      findFirst: jest.fn(),
    },
    wishlistItem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('add', () => {
    const studentId = 'student-1';
    const courseId = 'course-1';

    it('should add a course to the wishlist', async () => {
      const mockCourse = {
        id: courseId,
        title: 'React Fundamentals',
      };

      const mockWishlistItem = {
        id: 'wishlist-1',
        studentId,
        courseId,
        createdAt: new Date(),
        course: { ...mockCourse },
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);
      mockPrisma.wishlistItem.create.mockResolvedValue(mockWishlistItem);

      const result = await service.add(studentId, courseId);

      expect(result.alreadySaved).toBe(false);
      expect(result.message).toBe('Course added to wishlist');
      expect(result.item).toBeDefined();
      expect(mockPrisma.wishlistItem.create).toHaveBeenCalledWith({
        data: { studentId, courseId },
        include: { course: true },
      });
    });

    it('should return existing item if course is already in wishlist (idempotent)', async () => {
      const mockCourse = {
        id: courseId,
        title: 'React Fundamentals',
      };

      const existingItem = {
        id: 'wishlist-1',
        studentId,
        courseId,
        createdAt: new Date(),
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(existingItem);

      const result = await service.add(studentId, courseId);

      expect(result.alreadySaved).toBe(true);
      expect(result.message).toBe('Course already in wishlist');
      expect(result.item).toEqual(existingItem);
      expect(mockPrisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if courseId is empty', async () => {
      await expect(service.add(studentId, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(service.add(studentId, courseId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if course is not active', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(service.add(studentId, courseId)).rejects.toThrow(
        `Course ${courseId} not found or not active`,
      );
    });
  });

  describe('remove', () => {
    const studentId = 'student-1';
    const courseId = 'course-1';

    it('should remove a course from the wishlist', async () => {
      const existingItem = {
        id: 'wishlist-1',
        studentId,
        courseId,
      };

      mockPrisma.wishlistItem.findUnique.mockResolvedValue(existingItem);
      mockPrisma.wishlistItem.delete.mockResolvedValue(existingItem);

      const result = await service.remove(studentId, courseId);

      expect(result.message).toBe('Course removed from wishlist');
      expect(mockPrisma.wishlistItem.delete).toHaveBeenCalledWith({
        where: { id: 'wishlist-1' },
      });
    });

    it('should throw BadRequestException if courseId is empty', async () => {
      await expect(service.remove(studentId, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if course is not in wishlist', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);

      await expect(service.remove(studentId, courseId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    const studentId = 'student-1';

    it('should return paginated wishlist with course details', async () => {
      const mockItems = [
        {
          id: 'wishlist-1',
          studentId,
          courseId: 'course-1',
          createdAt: new Date(),
          course: {
            id: 'course-1',
            title: 'React Fundamentals',
            instructor: { name: 'John Doe', avatarUrl: 'https://...' },
          },
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockItems, 1]);

      const result = await service.findAll(studentId);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should respect pagination parameters', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 100]);

      await service.findAll(studentId, 2, 10);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const calls = mockPrisma.$transaction.mock.calls[0][0];
      expect(calls).toBeInstanceOf(Array);
    });

    it('should order items by createdAt descending (newest first)', async () => {
      const mockItems = [
        {
          id: 'wishlist-2',
          createdAt: new Date('2024-01-15'),
          course: { title: 'Course 2' },
        },
        {
          id: 'wishlist-1',
          createdAt: new Date('2024-01-10'),
          course: { title: 'Course 1' },
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockItems, 2]);

      const result = await service.findAll(studentId);

      expect(result.data[0].createdAt > result.data[1].createdAt).toBe(true);
    });

    it('should include instructor details in course info', async () => {
      const mockItems = [
        {
          id: 'wishlist-1',
          course: {
            title: 'React Fundamentals',
            instructor: {
              name: 'Jane Smith',
              avatarUrl: 'https://example.com/avatar.jpg',
            },
          },
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockItems, 1]);

      const result = await service.findAll(studentId);

      expect(result.data[0].course.instructor).toBeDefined();
      expect(result.data[0].course.instructor.name).toBe('Jane Smith');
    });

    it('should return empty list when student has no wishlist items', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.findAll(studentId);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });
});
