import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuizSessionsController } from './quiz-sessions.controller';
import { QuizSessionsService } from './quiz-sessions.service';
import { StartQuizSessionDto, SubmitSessionAnswersDto } from './dto/quiz-sessions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('QuizSessionsController', () => {
  let controller: QuizSessionsController;

  const mockQuizSessionsService = {
    startSession: jest.fn(),
    getSessionStatus: jest.fn(),
    submitSession: jest.fn(),
    autoSubmitSession: jest.fn(),
  };

  const answers: SubmitSessionAnswersDto = {
    answers: [{ questionId: 'q-1', answer: [0] } as any],
    passThreshold: 70,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuizSessionsController],
      providers: [{ provide: QuizSessionsService, useValue: mockQuizSessionsService }],
    }).compile();

    controller = module.get<QuizSessionsController>(QuizSessionsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('requires JWT auth on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, QuizSessionsController)).toEqual([JwtAuthGuard]);
  });

  describe('startSession', () => {
    it('starts a session for the current user', async () => {
      mockQuizSessionsService.startSession.mockResolvedValue({ id: 'session-1' });

      const res = await controller.startSession('lesson-1', { durationMinutes: 30 }, 'user-1');

      expect(mockQuizSessionsService.startSession).toHaveBeenCalledWith('lesson-1', 'user-1', {
        durationMinutes: 30,
      });
      expect(res).toEqual({ id: 'session-1' });
    });

    it.each([0, 181, 1.5])('rejects durationMinutes=%p', async (durationMinutes) => {
      const dto = plainToInstance(StartQuizSessionDto, { durationMinutes });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('durationMinutes');
    });
  });

  describe('getSessionStatus', () => {
    it('returns status scoped to the current user', async () => {
      mockQuizSessionsService.getSessionStatus.mockResolvedValue({ remainingSeconds: 120 });

      const res = await controller.getSessionStatus('session-1', 'user-1');

      expect(mockQuizSessionsService.getSessionStatus).toHaveBeenCalledWith('session-1', 'user-1');
      expect(res).toEqual({ remainingSeconds: 120 });
    });

    it('propagates ForbiddenException for a session owned by another user', async () => {
      mockQuizSessionsService.getSessionStatus.mockRejectedValue(new ForbiddenException());

      await expect(controller.getSessionStatus('session-1', 'intruder')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('submitSession', () => {
    it('submits answers and returns the score', async () => {
      mockQuizSessionsService.submitSession.mockResolvedValue({ score: 100, passed: true });

      const res = await controller.submitSession('session-1', answers, 'user-1');

      expect(mockQuizSessionsService.submitSession).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        answers,
      );
      expect(res).toEqual({ score: 100, passed: true });
    });

    it('rejects a payload without an answers array', async () => {
      const dto = plainToInstance(SubmitSessionAnswersDto, { answers: 'nope' });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('answers');
    });
  });

  describe('autoSubmitSession', () => {
    it('auto-submits answers for the current user', async () => {
      mockQuizSessionsService.autoSubmitSession.mockResolvedValue({ score: 0, autoSubmitted: true });

      const res = await controller.autoSubmitSession('session-1', answers, 'user-1');

      expect(mockQuizSessionsService.autoSubmitSession).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        answers,
      );
      expect(res).toEqual({ score: 0, autoSubmitted: true });
    });
  });
});
