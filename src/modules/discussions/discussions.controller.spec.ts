import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { DiscussionsController } from './discussions.controller';
import { CommentModerationService } from './comment-moderation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('DiscussionsController', () => {
  let controller: DiscussionsController;

  const mockService = {
    createComment: jest.fn(),
    findCommentsForDiscussion: jest.fn(),
    findCommentById: jest.fn(),
    findFlaggedComments: jest.fn(),
    getModerationSummary: jest.fn(),
    moderateComment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscussionsController],
      providers: [{ provide: CommentModerationService, useValue: mockService }, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<DiscussionsController>(DiscussionsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('route delegation', () => {
    it('createComment passes the user id and dto', async () => {
      const dto = { discussionId: 'd1', content: 'hi' } as any;
      mockService.createComment.mockResolvedValue({ id: 'c1' });

      await expect(controller.createComment('u1', dto)).resolves.toEqual({ id: 'c1' });
      expect(mockService.createComment).toHaveBeenCalledWith('u1', dto);
    });

    it('findCommentsForDiscussion passes the discussion id', async () => {
      mockService.findCommentsForDiscussion.mockResolvedValue([]);

      await controller.findCommentsForDiscussion('d1');
      expect(mockService.findCommentsForDiscussion).toHaveBeenCalledWith('d1');
    });

    it('findComment passes the comment id', async () => {
      await controller.findComment('c1');
      expect(mockService.findCommentById).toHaveBeenCalledWith('c1');
    });

    it('findFlaggedComments delegates', async () => {
      await controller.findFlaggedComments();
      expect(mockService.findFlaggedComments).toHaveBeenCalled();
    });

    it('getModerationSummary delegates', async () => {
      await controller.getModerationSummary();
      expect(mockService.getModerationSummary).toHaveBeenCalled();
    });

    it('moderateComment passes the id and dto', async () => {
      const dto = { status: 'APPROVED' } as any;
      await controller.moderateComment('c1', dto);
      expect(mockService.moderateComment).toHaveBeenCalledWith('c1', dto);
    });
  });

  describe('Guard and Role Decorators', () => {
    const proto = DiscussionsController.prototype;
    const guardsOf = (fn: unknown) => Reflect.getMetadata('__guards__', fn) ?? [];

    it('createComment requires JwtAuthGuard only', () => {
      expect(guardsOf(proto.createComment)).toEqual([JwtAuthGuard]);
      expect(Reflect.getMetadata('roles', proto.createComment)).toBeUndefined();
    });

    it('public read routes have no guards', () => {
      expect(guardsOf(proto.findCommentsForDiscussion)).toEqual([]);
      expect(guardsOf(proto.findComment)).toEqual([]);
    });

    it.each(['findFlaggedComments', 'getModerationSummary', 'moderateComment'] as const)(
      '%s requires JwtAuthGuard, RolesGuard and ADMIN',
      (method) => {
        expect(guardsOf(proto[method])).toEqual([JwtAuthGuard, RolesGuard]);
        expect(Reflect.getMetadata('roles', proto[method])).toEqual([UserRole.ADMIN]);
      },
    );
  });
});
