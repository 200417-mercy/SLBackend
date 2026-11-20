import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DripScheduleService } from './drip-schedule.service';

describe('DripScheduleService', () => {
  let service: DripScheduleService;

  const mockPrisma = {
    course: { findUnique: jest.fn() },
    courseDripConfig: { upsert: jest.fn() },
    lessonDripConfig: { upsert: jest.fn() },
    lesson: { findUnique: jest.fn(), findMany: jest.fn() },
    enrollment: { findMany: jest.fn(), findUnique: jest.fn() },
    enrollmentLessonUnlock: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = { notifyUser: jest.fn() };

  const ownedCourse = {
    id: 'course-1',
    instructorAddress: 'GINSTRUCTOR',
    instructor: { id: 'instructor-1' },
  };

  const makeEnrollment = (overrides: Record<string, any> = {}) => ({
    id: 'enrollment-1',
    studentId: 'student-1',
    courseId: 'course-1',
    enrolledAt: new Date('2024-01-01T00:00:00.000Z'),
    status: 'ACTIVE',
    dripUnlocks: [],
    course: {
      id: 'course-1',
      dripConfig: { enabled: false, dripIntervalDays: 1 },
      modules: [
        {
          id: 'module-1',
          title: 'Module 1',
          position: 1,
          lessons: [
            {
              id: 'lesson-1',
              title: 'Lesson 1',
              position: 1,
              isFree: false,
              dripConfig: null,
            },
            {
              id: 'lesson-2',
              title: 'Lesson 2',
              position: 2,
              isFree: false,
              dripConfig: null,
            },
          ],
        },
      ],
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DripScheduleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<DripScheduleService>(DripScheduleService);
    jest.clearAllMocks();
    mockPrisma.enrollmentLessonUnlock.upsert.mockResolvedValue({});
    mockPrisma.enrollmentLessonUnlock.update.mockResolvedValue({});
    mockNotifications.notifyUser.mockResolvedValue(undefined);
  });

  describe('configureCourseDrip()', () => {
    it('throws NotFoundException when the course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.configureCourseDrip('course-1', 'GINSTRUCTOR', { enabled: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller does not own the course', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);

      await expect(
        service.configureCourseDrip('course-1', 'GOTHER', { enabled: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('upserts config with defaults and re-syncs active enrollments', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.courseDripConfig.upsert.mockResolvedValue({
        courseId: 'course-1',
        enabled: true,
        dripIntervalDays: 3,
      });
      mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'enrollment-1' }]);
      const syncSpy = jest
        .spyOn(service, 'calculateAndSyncUnlockSchedule')
        .mockResolvedValue(undefined);

      const result = await service.configureCourseDrip('course-1', 'GINSTRUCTOR', {
        enabled: true,
        dripIntervalDays: 3,
      });

      expect(mockPrisma.courseDripConfig.upsert).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        update: { enabled: true, dripIntervalDays: 3 },
        create: {
          courseId: 'course-1',
          enabled: true,
          dripIntervalDays: 3,
        },
      });
      expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-1', status: 'ACTIVE' },
        select: { id: true },
      });
      expect(syncSpy).toHaveBeenCalledWith('enrollment-1');
      expect(result).toEqual({
        courseId: 'course-1',
        enabled: true,
        dripIntervalDays: 3,
      });
    });

    it('defaults dripIntervalDays to 1 when omitted', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.courseDripConfig.upsert.mockResolvedValue({});
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      await service.configureCourseDrip('course-1', 'instructor-1', { enabled: false });

      expect(mockPrisma.courseDripConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { enabled: false, dripIntervalDays: 1 },
          create: { courseId: 'course-1', enabled: false, dripIntervalDays: 1 },
        }),
      );
    });
  });

  describe('configureLessonDrip()', () => {
    it('throws NotFoundException when the lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.configureLessonDrip('lesson-1', 'GINSTRUCTOR', { delayDays: 2 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller does not own the course', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 'lesson-1',
        module: { courseId: 'course-1' },
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);

      await expect(
        service.configureLessonDrip('lesson-1', 'GOTHER', { delayDays: 2 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('parses unlockDate and re-syncs active enrollments', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 'lesson-1',
        module: { courseId: 'course-1' },
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.lessonDripConfig.upsert.mockResolvedValue({ id: 'config-1' });
      mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'enrollment-1' }]);
      const syncSpy = jest
        .spyOn(service, 'calculateAndSyncUnlockSchedule')
        .mockResolvedValue(undefined);

      const result = await service.configureLessonDrip('lesson-1', 'GINSTRUCTOR', {
        delayDays: 4,
        unlockDate: '2024-05-01T00:00:00.000Z',
      });

      const unlockDate = new Date('2024-05-01T00:00:00.000Z');
      expect(mockPrisma.lessonDripConfig.upsert).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1' },
        update: { delayDays: 4, unlockDate },
        create: { lessonId: 'lesson-1', delayDays: 4, unlockDate },
      });
      expect(syncSpy).toHaveBeenCalledWith('enrollment-1');
      expect(result).toEqual({ id: 'config-1' });
    });

    it('defaults delayDays to 0 and unlockDate to null', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 'lesson-1',
        module: { courseId: 'course-1' },
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.lessonDripConfig.upsert.mockResolvedValue({});
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      await service.configureLessonDrip('lesson-1', 'GINSTRUCTOR', {});

      expect(mockPrisma.lessonDripConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { delayDays: 0, unlockDate: null },
          create: { lessonId: 'lesson-1', delayDays: 0, unlockDate: null },
        }),
      );
    });
  });

  describe('getCourseDripConfig()', () => {
    it('throws NotFoundException when the course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.getCourseDripConfig('course-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the course with drip config and ordered modules', async () => {
      const course = { id: 'course-1', dripConfig: null, modules: [] };
      mockPrisma.course.findUnique.mockResolvedValue(course);

      await expect(service.getCourseDripConfig('course-1')).resolves.toEqual(course);
      expect(mockPrisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        include: {
          dripConfig: true,
          modules: {
            orderBy: { position: 'asc' },
            include: {
              lessons: {
                orderBy: { position: 'asc' },
                include: { dripConfig: true },
              },
            },
          },
        },
      });
    });
  });

  describe('calculateAndSyncUnlockSchedule()', () => {
    it('throws NotFoundException when the enrollment does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.calculateAndSyncUnlockSchedule('missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('unlocks every lesson immediately when drip is disabled', async () => {
      const enrollment = makeEnrollment();
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      await service.calculateAndSyncUnlockSchedule('enrollment-1');

      expect(mockPrisma.enrollmentLessonUnlock.upsert).toHaveBeenCalledTimes(2);
      for (const call of mockPrisma.enrollmentLessonUnlock.upsert.mock.calls) {
        expect(call[0].update.unlockAt).toEqual(enrollment.enrolledAt);
      }
    });

    it('paces lessons sequentially using the course interval', async () => {
      const enrollment = makeEnrollment();
      enrollment.course.dripConfig = { enabled: true, dripIntervalDays: 2 };
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      await service.calculateAndSyncUnlockSchedule('enrollment-1');

      const first = mockPrisma.enrollmentLessonUnlock.upsert.mock.calls[0][0];
      const second = mockPrisma.enrollmentLessonUnlock.upsert.mock.calls[1][0];

      expect(first.update.unlockAt).toEqual(enrollment.enrolledAt);
      expect(second.update.unlockAt).toEqual(
        new Date(enrollment.enrolledAt.getTime() + 2 * 24 * 60 * 60 * 1000),
      );
    });

    it('honours a lesson-specific unlock date', async () => {
      const enrollment = makeEnrollment();
      enrollment.course.dripConfig = { enabled: true, dripIntervalDays: 1 };
      enrollment.course.modules[0].lessons[1].dripConfig = {
        delayDays: 0,
        unlockDate: new Date('2024-06-01T00:00:00.000Z'),
      };
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      await service.calculateAndSyncUnlockSchedule('enrollment-1');

      const second = mockPrisma.enrollmentLessonUnlock.upsert.mock.calls[1][0];
      expect(second.update.unlockAt).toEqual(new Date('2024-06-01T00:00:00.000Z'));
    });

    it('honours a lesson-specific delay in days', async () => {
      const enrollment = makeEnrollment();
      enrollment.course.dripConfig = { enabled: true, dripIntervalDays: 1 };
      enrollment.course.modules[0].lessons[1].dripConfig = {
        delayDays: 5,
        unlockDate: null,
      };
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      await service.calculateAndSyncUnlockSchedule('enrollment-1');

      const second = mockPrisma.enrollmentLessonUnlock.upsert.mock.calls[1][0];
      expect(second.update.unlockAt).toEqual(
        new Date(enrollment.enrolledAt.getTime() + 5 * 24 * 60 * 60 * 1000),
      );
    });

    it('skips lessons that have an instructor override', async () => {
      const enrollment = makeEnrollment({
        dripUnlocks: [{ lessonId: 'lesson-1', isOverridden: true }],
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      await service.calculateAndSyncUnlockSchedule('enrollment-1');

      expect(mockPrisma.enrollmentLessonUnlock.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.enrollmentLessonUnlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enrollmentId_lessonId: {
              enrollmentId: 'enrollment-1',
              lessonId: 'lesson-2',
            },
          },
        }),
      );
    });
  });

  describe('validateLessonAccess()', () => {
    const lesson = {
      id: 'lesson-1',
      isFree: false,
      module: { courseId: 'course-1', course: { id: 'course-1' } },
    };

    it('throws NotFoundException when the lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows free preview lessons without enrollment', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...lesson, isFree: true });

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).resolves.toEqual({ allowed: true, reason: 'free_preview' });
      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the student is not enrolled', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows access when the unlock time has passed', async () => {
      const unlockAt = new Date(Date.now() - 1000);
      mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        dripUnlocks: [{ lessonId: 'lesson-1', unlockAt, isOverridden: false }],
      });

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).resolves.toEqual({ allowed: true, unlockAt });
    });

    it('allows access to an overridden unlock even before its date', async () => {
      const unlockAt = new Date(Date.now() + 60_000);
      mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        dripUnlocks: [{ lessonId: 'lesson-1', unlockAt, isOverridden: true }],
      });

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).resolves.toEqual({ allowed: true, unlockAt });
    });

    it('rejects a locked lesson with its next unlock date', async () => {
      const unlockAt = new Date(Date.now() + 60_000);
      mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        dripUnlocks: [{ lessonId: 'lesson-1', unlockAt, isOverridden: false }],
      });

      await expect(
        service.validateLessonAccess('student-1', 'lesson-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'Lesson Locked',
          nextUnlockDate: unlockAt,
        }),
      });
    });

    it('calculates a missing schedule and allows access once unlocked', async () => {
      const unlockAt = new Date(Date.now() - 1000);
      mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        dripUnlocks: [],
      });
      const syncSpy = jest
        .spyOn(service, 'calculateAndSyncUnlockSchedule')
        .mockResolvedValue(undefined);
      mockPrisma.enrollmentLessonUnlock.findUnique.mockResolvedValue({
        lessonId: 'lesson-1',
        unlockAt,
        isOverridden: false,
      });

      const result = await service.validateLessonAccess('student-1', 'lesson-1');

      expect(syncSpy).toHaveBeenCalledWith('enrollment-1');
      expect(result).toEqual({ allowed: true, unlockAt });
    });
  });

  describe('isLessonUnlocked()', () => {
    it('defaults to unlocked when no schedule record exists', async () => {
      mockPrisma.enrollmentLessonUnlock.findUnique.mockResolvedValue(null);

      await expect(
        service.isLessonUnlocked('enrollment-1', 'lesson-1'),
      ).resolves.toBe(true);
    });

    it('returns false before the unlock date', async () => {
      mockPrisma.enrollmentLessonUnlock.findUnique.mockResolvedValue({
        unlockAt: new Date(Date.now() + 60_000),
        isOverridden: false,
      });

      await expect(
        service.isLessonUnlocked('enrollment-1', 'lesson-1'),
      ).resolves.toBe(false);
    });

    it('returns true after the unlock date', async () => {
      mockPrisma.enrollmentLessonUnlock.findUnique.mockResolvedValue({
        unlockAt: new Date(Date.now() - 1000),
        isOverridden: false,
      });

      await expect(
        service.isLessonUnlocked('enrollment-1', 'lesson-1'),
      ).resolves.toBe(true);
    });

    it('returns true for an overridden unlock', async () => {
      mockPrisma.enrollmentLessonUnlock.findUnique.mockResolvedValue({
        unlockAt: new Date(Date.now() + 60_000),
        isOverridden: true,
      });

      await expect(
        service.isLessonUnlocked('enrollment-1', 'lesson-1'),
      ).resolves.toBe(true);
    });
  });

  describe('overrideInstructorDrip()', () => {
    it('throws NotFoundException when the enrollment does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.overrideInstructorDrip('GINSTRUCTOR', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the instructor does not own the course', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        courseId: 'course-1',
        course: ownedCourse,
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);

      await expect(
        service.overrideInstructorDrip('GOTHER', 'enrollment-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('overrides a single lesson when a lessonId is provided', async () => {
      const overrideAt = new Date('2024-07-01T00:00:00.000Z');
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        courseId: 'course-1',
        course: ownedCourse,
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.enrollmentLessonUnlock.upsert.mockResolvedValue({
        lessonId: 'lesson-1',
        isOverridden: true,
      });

      const result = await service.overrideInstructorDrip(
        'GINSTRUCTOR',
        'enrollment-1',
        'lesson-1',
        overrideAt,
      );

      expect(mockPrisma.enrollmentLessonUnlock.upsert).toHaveBeenCalledWith({
        where: {
          enrollmentId_lessonId: {
            enrollmentId: 'enrollment-1',
            lessonId: 'lesson-1',
          },
        },
        update: {
          isOverridden: true,
          overriddenBy: 'GINSTRUCTOR',
          unlockAt: overrideAt,
        },
        create: {
          enrollmentId: 'enrollment-1',
          lessonId: 'lesson-1',
          isOverridden: true,
          overriddenBy: 'GINSTRUCTOR',
          unlockAt: overrideAt,
        },
      });
      expect(result).toEqual({ lessonId: 'lesson-1', isOverridden: true });
    });

    it('bulk overrides every lesson when no lessonId is provided', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        courseId: 'course-1',
        course: ownedCourse,
      });
      mockPrisma.course.findUnique.mockResolvedValue(ownedCourse);
      mockPrisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1' },
        { id: 'lesson-2' },
      ]);

      const result = await service.overrideInstructorDrip(
        'GINSTRUCTOR',
        'enrollment-1',
      );

      expect(mockPrisma.lesson.findMany).toHaveBeenCalledWith({
        where: { module: { courseId: 'course-1' } },
        select: { id: true },
      });
      expect(mockPrisma.enrollmentLessonUnlock.upsert).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        success: true,
        count: 2,
        overrideUnlockAt: expect.any(Date),
      });
    });
  });

  describe('getStudentDripSchedule()', () => {
    it('throws NotFoundException when the enrollment does not exist', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentDripSchedule('student-1', 'course-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('builds the lesson schedule and next unlock date', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const enrollment = makeEnrollment();
      enrollment.course.modules[0].lessons[0].isFree = true;
      enrollment.course.dripConfig = { enabled: true, dripIntervalDays: 1 };
      enrollment.dripUnlocks = [
        { lessonId: 'lesson-1', unlockAt: past, isOverridden: false },
        { lessonId: 'lesson-2', unlockAt: future, isOverridden: false },
      ];
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      const result = await service.getStudentDripSchedule('student-1', 'course-1');

      expect(result.courseId).toBe('course-1');
      expect(result.isDripEnabled).toBe(true);
      expect(result.nextUnlockDate).toEqual(future);
      expect(result.schedule).toHaveLength(2);
      expect(result.schedule[0]).toEqual(
        expect.objectContaining({ lessonId: 'lesson-1', isUnlocked: true }),
      );
      expect(result.schedule[1]).toEqual(
        expect.objectContaining({ lessonId: 'lesson-2', isUnlocked: false }),
      );
    });

    it('treats overridden lessons as unlocked', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const enrollment = makeEnrollment();
      enrollment.dripUnlocks = [
        { lessonId: 'lesson-1', unlockAt: future, isOverridden: true },
        { lessonId: 'lesson-2', unlockAt: future, isOverridden: true },
      ];
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      const result = await service.getStudentDripSchedule('student-1', 'course-1');

      expect(result.nextUnlockDate).toBeNull();
      expect(result.schedule.every((l) => l.isUnlocked)).toBe(true);
    });

    it('falls back to enrolledAt when an unlock record is missing', async () => {
      const enrollment = makeEnrollment();
      enrollment.dripUnlocks = [];
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment);

      const result = await service.getStudentDripSchedule('student-1', 'course-1');

      expect(result.schedule[0].unlockAt).toEqual(enrollment.enrolledAt);
      expect(result.schedule[0].isUnlocked).toBe(true);
    });
  });

  describe('notifyNewlyUnlockedLessons()', () => {
    it('notifies students and marks unlocks as notified', async () => {
      mockPrisma.enrollmentLessonUnlock.findMany.mockResolvedValue([
        {
          id: 'unlock-1',
          lessonId: 'lesson-1',
          enrollment: {
            studentId: 'student-1',
            course: { title: 'Course 1' },
          },
          lesson: { title: 'Lesson 1' },
        },
      ]);

      await service.notifyNewlyUnlockedLessons();

      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        'LESSON_UNLOCKED',
        'New Lesson Unlocked! 🔓',
        expect.stringContaining('Lesson 1'),
        { lessonId: 'lesson-1', courseTitle: 'Course 1' },
      );
      expect(mockPrisma.enrollmentLessonUnlock.update).toHaveBeenCalledWith({
        where: { id: 'unlock-1' },
        data: { notifiedAt: expect.any(Date) },
      });
    });

    it('continues processing when one notification fails', async () => {
      mockPrisma.enrollmentLessonUnlock.findMany.mockResolvedValue([
        {
          id: 'unlock-1',
          lessonId: 'lesson-1',
          enrollment: { studentId: 'student-1', course: { title: 'Course 1' } },
          lesson: { title: 'Lesson 1' },
        },
        {
          id: 'unlock-2',
          lessonId: 'lesson-2',
          enrollment: { studentId: 'student-2', course: { title: 'Course 1' } },
          lesson: { title: 'Lesson 2' },
        },
      ]);
      mockNotifications.notifyUser
        .mockRejectedValueOnce(new Error('email down'))
        .mockResolvedValueOnce(undefined);

      await service.notifyNewlyUnlockedLessons();

      expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
      expect(mockPrisma.enrollmentLessonUnlock.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.enrollmentLessonUnlock.update).toHaveBeenCalledWith({
        where: { id: 'unlock-2' },
        data: { notifiedAt: expect.any(Date) },
      });
    });
  });
});
