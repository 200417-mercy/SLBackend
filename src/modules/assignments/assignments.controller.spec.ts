import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('AssignmentsController', () => {
  let controller: AssignmentsController;

  const mockService = {
    findByLesson: jest.fn(),
    create: jest.fn(),
    submit: jest.fn(),
    review: jest.fn(),
    findSubmissionsByStudent: jest.fn(),
    findPendingForInstructor: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssignmentsController],
      providers: [{ provide: AssignmentsService, useValue: mockService }, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AssignmentsController>(AssignmentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('route delegation', () => {
    it('findByLesson passes the lesson id', async () => {
      mockService.findByLesson.mockResolvedValue({ id: 'a1' });

      await expect(controller.findByLesson('l1')).resolves.toEqual({ id: 'a1' });
      expect(mockService.findByLesson).toHaveBeenCalledWith('l1');
    });

    it('create passes lessonId, dto, user id and role', async () => {
      const dto = { lessonId: 'l1', title: 'Build it' } as any;

      await controller.create(dto, 'u1', UserRole.INSTRUCTOR);
      expect(mockService.create).toHaveBeenCalledWith('l1', dto, 'u1', UserRole.INSTRUCTOR);
    });

    it('submit passes student, assignment, url and notes', async () => {
      await controller.submit('a1', 's1', { submissionUrl: 'https://x.test/repo', notes: 'n' });
      expect(mockService.submit).toHaveBeenCalledWith('s1', 'a1', 'https://x.test/repo', 'n');
    });

    it('review passes approval, feedback and role', async () => {
      const dto = { approved: true, feedback: 'good' } as any;

      await controller.review('sub1', 'i1', UserRole.ADMIN, dto);
      expect(mockService.review).toHaveBeenCalledWith('sub1', 'i1', true, 'good', UserRole.ADMIN);
    });

    it('mySubmissions passes the student id', async () => {
      await controller.mySubmissions('s1');
      expect(mockService.findSubmissionsByStudent).toHaveBeenCalledWith('s1');
    });

    it('pendingReviews passes address and pagination', async () => {
      await controller.pendingReviews('GADDR', { page: 2, limit: 5 } as any);
      expect(mockService.findPendingForInstructor).toHaveBeenCalledWith('GADDR', 2, 5);
    });
  });

  describe('Guard and Role Decorators', () => {
    const proto = AssignmentsController.prototype;

    it('applies JwtAuthGuard at the class level', () => {
      expect(Reflect.getMetadata('__guards__', AssignmentsController)).toEqual([JwtAuthGuard]);
    });

    it.each(['create', 'review', 'pendingReviews'] as const)(
      '%s requires RolesGuard with INSTRUCTOR or ADMIN',
      (method) => {
        expect(Reflect.getMetadata('__guards__', proto[method])).toEqual([RolesGuard]);
        expect(Reflect.getMetadata('roles', proto[method])).toEqual([
          UserRole.INSTRUCTOR,
          UserRole.ADMIN,
        ]);
      },
    );

    it.each(['findByLesson', 'submit', 'mySubmissions'] as const)(
      '%s has no role restriction',
      (method) => {
        expect(Reflect.getMetadata('roles', proto[method])).toBeUndefined();
      },
    );
  });
});
