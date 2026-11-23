import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, NotificationType, UserRole } from '@prisma/client';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;

  const mockPrisma = {
    lesson: {
      findUnique: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    assignmentSubmission: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockLesson = {
    id: 'lesson-1',
    title: 'Intro Lesson',
    module: {
      id: 'module-1',
      course: {
        id: 'course-1',
        instructorAddress: 'GINSTRUCTOR123',
        instructor: { id: 'instructor-user-1' },
      },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create()', () => {
    const createData = {
      title: 'Make a sourdough loaf',
      description: 'Document your hydration and baking process',
      instructions: 'Take 3 photos',
    };

    it('creates an assignment when user is instructor by instructorAddress', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.assignment.create.mockResolvedValue({
        id: 'assignment-1',
        lessonId: 'lesson-1',
        ...createData,
      });

      const result = await service.create(
        'lesson-1',
        createData,
        'GINSTRUCTOR123',
        UserRole.INSTRUCTOR,
      );

      expect(mockPrisma.lesson.findUnique).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        include: {
          module: {
            include: {
              course: { include: { instructor: { select: { id: true } } } },
            },
          },
        },
      });
      expect(mockPrisma.assignment.create).toHaveBeenCalledWith({
        data: { lessonId: 'lesson-1', ...createData },
      });
      expect(result.id).toBe('assignment-1');
    });

    it('creates an assignment when user is instructor by instructor.id', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.assignment.create.mockResolvedValue({
        id: 'assignment-1',
        lessonId: 'lesson-1',
        ...createData,
      });

      const result = await service.create(
        'lesson-1',
        createData,
        'instructor-user-1',
        UserRole.INSTRUCTOR,
      );

      expect(result.id).toBe('assignment-1');
      expect(mockPrisma.assignment.create).toHaveBeenCalled();
    });

    it('creates an assignment when user is ADMIN even if not the instructor', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.assignment.create.mockResolvedValue({
        id: 'assignment-1',
        lessonId: 'lesson-1',
        ...createData,
      });

      const result = await service.create(
        'lesson-1',
        createData,
        'admin-user-id',
        UserRole.ADMIN,
      );

      expect(result.id).toBe('assignment-1');
      expect(mockPrisma.assignment.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing-lesson', createData, 'GINSTRUCTOR123', UserRole.INSTRUCTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if non-admin is not the course instructor', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

      await expect(
        service.create('lesson-1', createData, 'unauthorized-user', UserRole.INSTRUCTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.assignment.create).not.toHaveBeenCalled();
    });
  });

  describe('findByLesson()', () => {
    it('returns assignment with student submission details for a lesson', async () => {
      const mockAssignment = {
        id: 'assignment-1',
        lessonId: 'lesson-1',
        title: 'Bake bread',
        submissions: [
          {
            id: 'sub-1',
            student: { name: 'Alice', stellarAddress: 'GALICE' },
          },
        ],
      };
      mockPrisma.assignment.findUnique.mockResolvedValue(mockAssignment);

      const result = await service.findByLesson('lesson-1');

      expect(mockPrisma.assignment.findUnique).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1' },
        include: {
          submissions: {
            include: {
              student: { select: { name: true, stellarAddress: true } },
            },
          },
        },
      });
      expect(result).toEqual(mockAssignment);
    });

    it('throws NotFoundException if assignment does not exist for lesson', async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(null);

      await expect(service.findByLesson('unknown-lesson')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submit()', () => {
    const submissionResult = {
      id: 'sub-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      submissionUrl: 'https://files.sorobanlard.test/bread.jpg',
      notes: 'Crust was golden brown',
      status: AssignmentStatus.SUBMITTED,
      assignment: {
        id: 'assignment-1',
        title: 'Bake bread',
        lesson: {
          module: {
            course: {
              instructorAddress: 'GINSTRUCTOR123',
            },
          },
        },
      },
    };

    it('creates a new submission and sends a notification to the instructor', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);
      mockPrisma.assignmentSubmission.upsert.mockResolvedValue(submissionResult);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'instructor-user-id' });

      const result = await service.submit(
        'student-1',
        'assignment-1',
        'https://files.sorobanlard.test/bread.jpg',
        'Crust was golden brown',
      );

      expect(mockPrisma.assignmentSubmission.findUnique).toHaveBeenCalledWith({
        where: {
          assignmentId_studentId: {
            assignmentId: 'assignment-1',
            studentId: 'student-1',
          },
        },
      });
      expect(mockPrisma.assignmentSubmission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignmentId_studentId: {
              assignmentId: 'assignment-1',
              studentId: 'student-1',
            },
          },
          create: {
            assignmentId: 'assignment-1',
            studentId: 'student-1',
            submissionUrl: 'https://files.sorobanlard.test/bread.jpg',
            notes: 'Crust was golden brown',
            status: AssignmentStatus.SUBMITTED,
          },
        }),
      );
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { stellarAddress: 'GINSTRUCTOR123' },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'instructor-user-id',
        NotificationType.ASSIGNMENT_SUBMITTED,
        'New assignment submission',
        'A student has submitted the assignment "Bake bread". Please review.',
        { assignmentId: 'assignment-1', studentId: 'student-1' },
      );
      expect(result).toEqual(submissionResult);
    });

    it('allows resubmission if existing submission was not approved', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: AssignmentStatus.REJECTED,
      });
      mockPrisma.assignmentSubmission.upsert.mockResolvedValue(submissionResult);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.submit(
        'student-1',
        'assignment-1',
        'https://files.sorobanlard.test/bread-v2.jpg',
      );

      expect(result).toEqual(submissionResult);
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if existing submission is already approved', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: AssignmentStatus.APPROVED,
      });

      await expect(
        service.submit('student-1', 'assignment-1', 'https://files.sorobanlard.test/bread.jpg'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.assignmentSubmission.upsert).not.toHaveBeenCalled();
    });
  });

  describe('review()', () => {
    const mockSubmissionToReview = {
      id: 'sub-1',
      studentId: 'student-1',
      assignmentId: 'assignment-1',
      assignment: {
        id: 'assignment-1',
        title: 'Bake bread',
        lesson: {
          module: {
            course: {
              instructorAddress: 'GINSTRUCTOR123',
              instructor: { id: 'instructor-user-1' },
            },
          },
        },
      },
    };

    it('approves a submission and notifies student when reviewer is course instructor address', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(mockSubmissionToReview);
      mockPrisma.assignmentSubmission.update.mockResolvedValue({
        id: 'sub-1',
        status: AssignmentStatus.APPROVED,
        feedback: 'Excellent crumb structure!',
      });

      const result = await service.review(
        'sub-1',
        'GINSTRUCTOR123',
        true,
        'Excellent crumb structure!',
        UserRole.INSTRUCTOR,
      );

      expect(mockPrisma.assignmentSubmission.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: AssignmentStatus.APPROVED,
          feedback: 'Excellent crumb structure!',
          reviewedAt: expect.any(Date),
        },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.ASSIGNMENT_APPROVED,
        'Assignment approved! 🎉',
        'Your assignment "Bake bread" has been approved. Great work!',
        { assignmentId: 'assignment-1', submissionId: 'sub-1' },
      );
      expect(result.status).toBe(AssignmentStatus.APPROVED);
    });

    it('rejects a submission and notifies student when reviewer is course instructor by id', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(mockSubmissionToReview);
      mockPrisma.assignmentSubmission.update.mockResolvedValue({
        id: 'sub-1',
        status: AssignmentStatus.REJECTED,
        feedback: 'Underbaked inside',
      });

      const result = await service.review(
        'sub-1',
        'instructor-user-1',
        false,
        'Underbaked inside',
        UserRole.INSTRUCTOR,
      );

      expect(mockPrisma.assignmentSubmission.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: AssignmentStatus.REJECTED,
          feedback: 'Underbaked inside',
          reviewedAt: expect.any(Date),
        },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.ASSIGNMENT_REJECTED,
        'Assignment needs revision',
        'Your assignment "Bake bread" needs revision. Feedback: Underbaked inside',
        { assignmentId: 'assignment-1', submissionId: 'sub-1' },
      );
      expect(result.status).toBe(AssignmentStatus.REJECTED);
    });

    it('allows ADMIN to review even if not the course instructor', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(mockSubmissionToReview);
      mockPrisma.assignmentSubmission.update.mockResolvedValue({
        id: 'sub-1',
        status: AssignmentStatus.APPROVED,
      });

      const result = await service.review(
        'sub-1',
        'admin-user-id',
        true,
        'Approved by admin',
        UserRole.ADMIN,
      );

      expect(result.status).toBe(AssignmentStatus.APPROVED);
      expect(mockPrisma.assignmentSubmission.update).toHaveBeenCalled();
    });

    it('throws NotFoundException if submission does not exist', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);

      await expect(
        service.review('missing-sub', 'GINSTRUCTOR123', true, 'good', UserRole.INSTRUCTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.assignmentSubmission.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if non-admin reviewer is not the instructor', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(mockSubmissionToReview);

      await expect(
        service.review('sub-1', 'other-user', true, 'good', UserRole.INSTRUCTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.assignmentSubmission.update).not.toHaveBeenCalled();
    });
  });

  describe('findSubmissionsByStudent()', () => {
    it('returns submissions for a student ordered by submittedAt desc', async () => {
      const mockSubmissions = [
        { id: 'sub-1', studentId: 'student-1', submittedAt: new Date() },
      ];
      mockPrisma.assignmentSubmission.findMany.mockResolvedValue(mockSubmissions);

      const result = await service.findSubmissionsByStudent('student-1');

      expect(mockPrisma.assignmentSubmission.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        include: { assignment: { include: { lesson: true } } },
        orderBy: { submittedAt: 'desc' },
      });
      expect(result).toEqual(mockSubmissions);
    });
  });

  describe('findPendingForInstructor()', () => {
    const mockPendingSubmissions = [
      { id: 'sub-1', status: AssignmentStatus.SUBMITTED },
      { id: 'sub-2', status: AssignmentStatus.SUBMITTED },
    ];

    it('returns paginated pending submissions with default page 1 and limit 20', async () => {
      mockPrisma.assignmentSubmission.findMany.mockResolvedValue(mockPendingSubmissions);
      mockPrisma.assignmentSubmission.count.mockResolvedValue(2);

      const result = await service.findPendingForInstructor('GINSTRUCTOR123');

      expect(mockPrisma.assignmentSubmission.findMany).toHaveBeenCalledWith({
        where: {
          status: AssignmentStatus.SUBMITTED,
          assignment: {
            lesson: {
              module: {
                course: { instructorAddress: 'GINSTRUCTOR123' },
              },
            },
          },
        },
        include: {
          assignment: { include: { lesson: true } },
          student: { select: { name: true, stellarAddress: true } },
        },
        orderBy: { submittedAt: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: mockPendingSubmissions,
        meta: {
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      });
    });

    it('calculates custom pagination offset and totalPages correctly', async () => {
      mockPrisma.assignmentSubmission.findMany.mockResolvedValue(mockPendingSubmissions);
      mockPrisma.assignmentSubmission.count.mockResolvedValue(25);

      const result = await service.findPendingForInstructor('GINSTRUCTOR123', 2, 10);

      expect(mockPrisma.assignmentSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    it('clamps page number to at least 1 and limit between 1 and 100', async () => {
      mockPrisma.assignmentSubmission.findMany.mockResolvedValue([]);
      mockPrisma.assignmentSubmission.count.mockResolvedValue(0);

      const result = await service.findPendingForInstructor('GINSTRUCTOR123', -5, 500);

      expect(mockPrisma.assignmentSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 100,
        }),
      );
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 0,
      });
    });
  });
});
