import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseAutosaveController } from './course-autosave.controller';
import { CourseAutosaveService } from './course-autosave.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AutosaveCourseDto } from './dto/autosave-course.dto';

describe('CourseAutosaveController (Issue #203) - Unit Tests for Endpoints', () => {
  let controller: CourseAutosaveController;
  let service: CourseAutosaveService;

  const mockPrisma = {
    courseAutosave: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockService = {
    autosave: jest.fn(),
    getRecoveredDraft: jest.fn(),
    getDraftById: jest.fn(),
    discardDraft: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseAutosaveController,
        { provide: CourseAutosaveService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<CourseAutosaveController>(CourseAutosaveController);
    service = module.get<CourseAutosaveService>(CourseAutosaveService);
    jest.clearAllMocks();
  });

  describe('CourseAutosaveController.autosave', () => {
    it('should autosave course edits successfully', async () => {
      const dto: AutosaveCourseDto = {
        courseId: 'course-1',
        content: 'edited content',
        version: 1,
      };

      mockService.autosave.mockResolvedValue({ id: 'auto-1', ...dto });

      const result = await controller.autosave('user-1', 'address-1', dto);
      expect(result).toBeDefined();
      expect(mockService.autosave).toHaveBeenCalledWith('user-1', 'address-1', dto);
    });

    it('should reject autosave with missing courseId', async () => {
      const dto: AutosaveCourseDto = {
        content: 'edited content',
      };

      await expect(controller.autosave('user-1', 'address-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('CourseAutosaveController.getRecoveredDraft', () => {
    it('should return recovered draft successfully', async () => {
      mockService.getRecoveredDraft.mockResolvedValue({ id: 'draft-1', content: 'recovered content' });

      const result = await controller.getRecoveredDraft('user-1', 'course-1');
      expect(result).toBeDefined();
      expect(mockService.getRecoveredDraft).toHaveBeenCalledWith('user-1', 'course-1');
    });

    it('should return null draft when none exists', async () => {
      mockService.getRecoveredDraft.mockResolvedValue(null);

      const result = await controller.getRecoveredDraft('user-1', 'course-1');
      expect(result).toEqual(null);
    });
  });

  describe('CourseAutosaveController.getDraftById', () => {
    it('should return draft by ID successfully', async () => {
      mockService.getDraftById.mockResolvedValue({ id: 'draft-1', content: 'draft content' });

      const result = await controller.getDraftById('draft-1', 'user-1');
      expect(result).toBeDefined();
      expect(mockService.getDraftById).toHaveBeenCalledWith('draft-1', 'user-1');
    });

    it('should throw NotFoundException for non-existent draft', async () => {
      mockService.getDraftById.mockResolvedValue(null);

      await expect(controller.getDraftById('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('CourseAutosaveController.discardDraft', () => {
    it('should discard draft successfully', async () => {
      mockService.discardDraft.mockResolvedValue({ id: 'draft-1' });

      const result = await controller.discardDraft('draft-1', 'user-1');
      expect(result).toBeDefined();
      expect(mockService.discardDraft).toHaveBeenCalledWith('draft-1', 'user-1');
    });
  });
});