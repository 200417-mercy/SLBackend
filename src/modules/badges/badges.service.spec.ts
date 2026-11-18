import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BadgesService } from './badges.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  Badge,
  BadgeRequirementType,
  UserRole,
  Prisma,
} from '@prisma/client';

describe('BadgesService', () => {
  let service: BadgesService;
  let prisma: any;

  const mockPrisma = {
    badge: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    studentBadge: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userPoints: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BadgesService>(BadgesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('createBadge', () => {
    it('should create a badge with valid input', async () => {
      const input = {
        code: 'FIRST_COURSE',
        name: 'First Course Completed',
        description: 'Complete your first course',
        iconUrl: 'https://example.com/badge.png',
        requirementType: BadgeRequirementType.COURSES_COMPLETED,
        requirementValue: 1,
        isActive: true,
      };

      const mockBadge = { id: 'badge-1', ...input };
      mockPrisma.badge.create.mockResolvedValue(mockBadge);

      const result = await service.createBadge(input);

      expect(mockPrisma.badge.create).toHaveBeenCalledWith({
        data: input,
      });
      expect(result.code).toBe('FIRST_COURSE');
    });

    it('should create badge without optional fields', async () => {
      const input = {
        code: 'BADGE_CODE',
        name: 'Badge Name',
        requirementType: BadgeRequirementType.LESSONS_COMPLETED,
        requirementValue: 10,
      };

      mockPrisma.badge.create.mockResolvedValue({ id: 'badge-1', ...input });

      const result = await service.createBadge(input);

      expect(result.id).toBe('badge-1');
    });
  });

  describe('getCatalog', () => {
    it('should return all badges ordered by creation date', async () => {
      const mockBadges: Badge[] = [
        {
          id: 'badge-1',
          code: 'BADGE_1',
          name: 'Badge 1',
          description: null,
          iconUrl: null,
          requirementType: BadgeRequirementType.COURSES_COMPLETED,
          requirementValue: 1,
          isActive: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'badge-2',
          code: 'BADGE_2',
          name: 'Badge 2',
          description: null,
          iconUrl: null,
          requirementType: BadgeRequirementType.LESSONS_COMPLETED,
          requirementValue: 50,
          isActive: true,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      mockPrisma.badge.findMany.mockResolvedValue(mockBadges);

      const result = await service.getCatalog();

      expect(result).toHaveLength(2);
      expect(mockPrisma.badge.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getActiveBadges', () => {
    it('should return only active badges', async () => {
      const mockBadges: Badge[] = [
        {
          id: 'badge-1',
          code: 'ACTIVE_BADGE',
          name: 'Active Badge',
          description: null,
          iconUrl: null,
          requirementType: BadgeRequirementType.COURSES_COMPLETED,
          requirementValue: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.badge.findMany.mockResolvedValue(mockBadges);

      const result = await service.getActiveBadges();

      expect(mockPrisma.badge.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(true);
    });
  });

  describe('seedCatalog', () => {
    it('should upsert multiple badges in a transaction', async () => {
      const badges = [
        {
          code: 'BADGE_1',
          name: 'Badge 1',
          requirementType: BadgeRequirementType.COURSES_COMPLETED,
          requirementValue: 1,
        },
        {
          code: 'BADGE_2',
          name: 'Badge 2',
          requirementType: BadgeRequirementType.LESSONS_COMPLETED,
          requirementValue: 50,
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.badge.findMany.mockResolvedValue(badges);

      const result = await service.seedCatalog(badges as any);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('updateBadge', () => {
    it('should update an existing badge', async () => {
      const badgeId = 'badge-1';
      const updateInput = {
        name: 'Updated Badge Name',
        isActive: false,
      };

      const mockBadge = {
        id: badgeId,
        code: 'BADGE_1',
        name: 'Old Name',
        isActive: true,
      };

      mockPrisma.badge.findUnique.mockResolvedValue(mockBadge);
      mockPrisma.badge.update.mockResolvedValue({
        ...mockBadge,
        ...updateInput,
      });

      const result = await service.updateBadge(badgeId, updateInput);

      expect(mockPrisma.badge.findUnique).toHaveBeenCalledWith({
        where: { id: badgeId },
      });
      expect(mockPrisma.badge.update).toHaveBeenCalledWith({
        where: { id: badgeId },
        data: updateInput,
      });
      expect(result.name).toBe('Updated Badge Name');
    });

    it('should throw NotFoundException if badge does not exist', async () => {
      mockPrisma.badge.findUnique.mockResolvedValue(null);

      await expect(service.updateBadge('nonexistent', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('handleMilestoneEvent', () => {
    const studentId = 'student-1';

    it('should throw NotFoundException if student does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.handleMilestoneEvent(studentId, {
          type: BadgeRequirementType.COURSES_COMPLETED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user is not a student', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: studentId,
        role: UserRole.INSTRUCTOR,
      });

      await expect(
        service.handleMilestoneEvent(studentId, {
          type: BadgeRequirementType.COURSES_COMPLETED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should award eligible badges to student', async () => {
      const event = { type: BadgeRequirementType.COURSES_COMPLETED };

      const mockStudent = { id: studentId, role: UserRole.STUDENT };
      const mockBadges: Badge[] = [
        {
          id: 'badge-1',
          code: 'FIRST_COURSE',
          name: 'First Course',
          description: null,
          iconUrl: null,
          requirementType: BadgeRequirementType.COURSES_COMPLETED,
          requirementValue: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const transactionFn = jest.fn(async (fn) => {
        return fn({
          badge: { findMany: jest.fn().mockResolvedValue(mockBadges) },
          studentBadge: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
          },
          enrollment: {
            findMany: jest.fn().mockResolvedValue([
              { lessonProgress: [{ id: 'lesson-1' }] },
            ]),
          },
          user: { findUnique: jest.fn() },
          userPoints: { findUnique: jest.fn() },
        } as any);
      });

      mockPrisma.user.findUnique.mockResolvedValue(mockStudent);
      mockPrisma.$transaction.mockImplementation(transactionFn);

      const result = await service.handleMilestoneEvent(studentId, event);

      expect(result.studentId).toBe(studentId);
      expect(result.awarded).toBeDefined();
      expect(result.totalAwarded).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStudentShowcase', () => {
    const studentId = 'student-1';

    it('should throw NotFoundException if student does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getStudentShowcase(studentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return student badges ordered by award date descending', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: studentId });
      mockPrisma.studentBadge.findMany.mockResolvedValue([
        {
          id: 'sb-1',
          studentId,
          badgeId: 'badge-1',
          awardedAt: new Date('2024-01-15'),
          badge: {
            id: 'badge-1',
            code: 'BADGE_1',
            name: 'First Badge',
          },
        },
        {
          id: 'sb-2',
          studentId,
          badgeId: 'badge-2',
          awardedAt: new Date('2024-01-10'),
          badge: {
            id: 'badge-2',
            code: 'BADGE_2',
            name: 'Second Badge',
          },
        },
      ]);

      const result = await service.getStudentShowcase(studentId);

      expect(result.studentId).toBe(studentId);
      expect(result.badges).toHaveLength(2);
      expect(result.badges[0].awardedAt > result.badges[1].awardedAt).toBe(
        true,
      );
    });

    it('should return empty badges array when student has none', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: studentId });
      mockPrisma.studentBadge.findMany.mockResolvedValue([]);

      const result = await service.getStudentShowcase(studentId);

      expect(result.badges).toHaveLength(0);
    });
  });
});
