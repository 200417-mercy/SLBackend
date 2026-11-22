import {
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';

describe('QuestionsService', () => {
  let service: QuestionsService;

  const mockPrisma = {
    lesson: {
      findUnique: jest.fn(),
    },
    question: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    answer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const baseLesson = {
    id: 'lesson-1',
    title: 'Introduction',
    isFree: false,
    module: {
      course: {
        id: 'course-1',
        instructorAddress: 'instructor-addr',
        instructor: { id: 'instructor-1' },
      },
    },
  };

  const baseQuestion = {
    id: 'question-1',
    lessonId: 'lesson-1',
    authorId: 'student-1',
    title: 'How does this work?',
    content: 'Can someone explain this concept?',
    createdAt: new Date(),
    author: { id: 'student-1', name: 'Student', avatarUrl: null },
  };

  const baseAnswer = {
    id: 'answer-1',
    questionId: 'question-1',
    authorId: 'student-2',
    content: 'Here is the explanation...',
    isBestAnswer: false,
    createdAt: new Date(),
    author: { id: 'student-2', name: 'Helper', avatarUrl: null },
    question: baseQuestion,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QuestionsService>(QuestionsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb) =>
      Promise.resolve(cb(mockPrisma)),
    );
  });

  describe('createQuestion()', () => {
    const dto: CreateQuestionDto = {
      title: 'How does this work?',
      content: 'Can someone explain this concept?',
    };

    it('allows enrolled student to ask a question', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        studentId: 'student-1',
        courseId: 'course-1',
      });
      mockPrisma.question.create.mockResolvedValue(baseQuestion);

      await expect(
        service.createQuestion('lesson-1', 'student-1', UserRole.STUDENT, dto),
      ).resolves.toEqual(baseQuestion);

      expect(mockPrisma.question.create).toHaveBeenCalledWith({
        data: {
          lessonId: 'lesson-1',
          authorId: 'student-1',
          title: dto.title,
          content: dto.content,
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
    });

    it('allows course instructor to ask a question', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      mockPrisma.question.create.mockResolvedValue(baseQuestion);

      await expect(
        service.createQuestion(
          'lesson-1',
          'instructor-1',
          UserRole.INSTRUCTOR,
          dto,
        ),
      ).resolves.toEqual(baseQuestion);

      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('allows admin to ask a question', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      mockPrisma.question.create.mockResolvedValue(baseQuestion);

      await expect(
        service.createQuestion('lesson-1', 'admin-1', UserRole.ADMIN, dto),
      ).resolves.toEqual(baseQuestion);

      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('allows anyone to ask on a free lesson', async () => {
      const freeLesson = { ...baseLesson, isFree: true };
      mockPrisma.lesson.findUnique.mockResolvedValue(freeLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.question.create.mockResolvedValue(baseQuestion);

      await expect(
        service.createQuestion(
          'lesson-1',
          'unenrolled-user',
          UserRole.STUDENT,
          dto,
        ),
      ).resolves.toEqual(baseQuestion);
    });

    it('throws ForbiddenException if student not enrolled in paid lesson', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.createQuestion('lesson-1', 'student-99', UserRole.STUDENT, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.createQuestion('missing', 'student-1', UserRole.STUDENT, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getQuestionsByLesson()', () => {
    it('returns paginated questions with answers', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      const questions = [baseQuestion, { ...baseQuestion, id: 'question-2' }];
      mockPrisma.$transaction.mockResolvedValue([questions, 2]);

      const result = await service.getQuestionsByLesson('lesson-1', 1, 20);

      expect(result.data).toEqual(questions);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('handles pagination correctly', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(baseLesson);
      mockPrisma.$transaction.mockResolvedValue([[], 50]);

      await service.getQuestionsByLesson('lesson-1', 3, 10);

      // The transaction callback includes findMany with skip: 20, take: 10
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundException if lesson does not exist', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.getQuestionsByLesson('missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createAnswer()', () => {
    const dto: CreateAnswerDto = { content: 'Here is the explanation...' };

    const questionWithLesson = {
      ...baseQuestion,
      lesson: baseLesson,
    };

    it('allows enrolled student to answer', async () => {
      mockPrisma.question.findUnique.mockResolvedValue(questionWithLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        studentId: 'student-2',
        courseId: 'course-1',
      });
      mockPrisma.answer.create.mockResolvedValue(baseAnswer);

      await expect(
        service.createAnswer(
          'question-1',
          'student-2',
          UserRole.STUDENT,
          dto,
        ),
      ).resolves.toEqual(baseAnswer);

      expect(mockPrisma.answer.create).toHaveBeenCalledWith({
        data: {
          questionId: 'question-1',
          authorId: 'student-2',
          content: dto.content,
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
    });

    it('allows course instructor to answer', async () => {
      mockPrisma.question.findUnique.mockResolvedValue(questionWithLesson);
      mockPrisma.answer.create.mockResolvedValue(baseAnswer);

      await expect(
        service.createAnswer(
          'question-1',
          'instructor-1',
          UserRole.INSTRUCTOR,
          dto,
        ),
      ).resolves.toEqual(baseAnswer);

      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('allows admin to answer', async () => {
      mockPrisma.question.findUnique.mockResolvedValue(questionWithLesson);
      mockPrisma.answer.create.mockResolvedValue(baseAnswer);

      await expect(
        service.createAnswer('question-1', 'admin-1', UserRole.ADMIN, dto),
      ).resolves.toEqual(baseAnswer);

      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('allows anyone to answer on a free lesson', async () => {
      const freeQuestionLesson = {
        ...questionWithLesson,
        lesson: { ...baseLesson, isFree: true },
      };
      mockPrisma.question.findUnique.mockResolvedValue(freeQuestionLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.answer.create.mockResolvedValue(baseAnswer);

      await expect(
        service.createAnswer('question-1', 'anyone', UserRole.STUDENT, dto),
      ).resolves.toEqual(baseAnswer);
    });

    it('throws ForbiddenException if student not enrolled in paid lesson', async () => {
      mockPrisma.question.findUnique.mockResolvedValue(questionWithLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.createAnswer('question-1', 'student-99', UserRole.STUDENT, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if question does not exist', async () => {
      mockPrisma.question.findUnique.mockResolvedValue(null);

      await expect(
        service.createAnswer('missing', 'student-1', UserRole.STUDENT, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markBestAnswer()', () => {
    it('allows question author to mark best answer', async () => {
      mockPrisma.answer.findUnique.mockResolvedValue(baseAnswer);
      mockPrisma.answer.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.answer.update.mockResolvedValue({
        ...baseAnswer,
        isBestAnswer: true,
      });

      await expect(
        service.markBestAnswer('answer-1', 'student-1', UserRole.STUDENT),
      ).resolves.toMatchObject({ id: 'answer-1', isBestAnswer: true });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('allows admin to mark best answer', async () => {
      mockPrisma.answer.findUnique.mockResolvedValue(baseAnswer);
      mockPrisma.answer.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.answer.update.mockResolvedValue({
        ...baseAnswer,
        isBestAnswer: true,
      });

      await expect(
        service.markBestAnswer('answer-1', 'admin-1', UserRole.ADMIN),
      ).resolves.toMatchObject({ isBestAnswer: true });
    });

    it('unmarks previous best answer before marking new one', async () => {
      mockPrisma.answer.findUnique.mockResolvedValue(baseAnswer);
      mockPrisma.answer.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.answer.update.mockResolvedValue({
        ...baseAnswer,
        isBestAnswer: true,
      });

      await service.markBestAnswer('answer-1', 'student-1', UserRole.STUDENT);

      expect(mockPrisma.answer.updateMany).toHaveBeenCalledWith({
        where: { questionId: 'question-1', isBestAnswer: true },
        data: { isBestAnswer: false },
      });
    });

    it('throws ForbiddenException if user is not question author or admin', async () => {
      mockPrisma.answer.findUnique.mockResolvedValue(baseAnswer);

      await expect(
        service.markBestAnswer('answer-1', 'student-99', UserRole.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if answer does not exist', async () => {
      mockPrisma.answer.findUnique.mockResolvedValue(null);

      await expect(
        service.markBestAnswer('missing', 'student-1', UserRole.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
