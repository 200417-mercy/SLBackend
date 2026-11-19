import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';

describe('BadgesController (Issue #409) - Unit Tests for Endpoints', () => {
  let controller: BadgesController;
  let service: BadgesService;

  const mockPrisma = {
    badge: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockService = {
    getCatalog: jest.fn(),
    getActiveBadges: jest.fn(),
    createBadge: jest.fn(),
    seedCatalog: jest.fn(),
    updateBadge: jest.fn(),
    handleMilestoneEvent: jest.fn(),
    getStudentShowcase: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesController,
        { provide: BadgesService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<BadgesController>(BadgesController);
    service = module.get<BadgesService>(BadgesService);
    jest.clearAllMocks();
  });

  describe('BadgesController.getCatalog', () => {
    it('should return list of badges catalog', async () => {
      mockService.getCatalog.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

      const result = await controller.getCatalog();
      expect(result).toBeDefined();
      expect(mockService.getCatalog).toHaveBeenCalled();
    });

    it('should return active badges catalog', async () => {
      mockService.getActiveBadges.mockResolvedValue([{ id: 'b1' }]);

      const result = await controller.getActiveBadges();
      expect(result).toBeDefined();
      expect(mockService.getActiveBadges).toHaveBeenCalled();
    });
  });

  describe('BadgesController.createBadge', () => {
    it('should create a badge successfully with valid inputs', async () => {
      const dto: CreateBadgeDto = {
        code: 'TEST123',
        name: 'Test Badge',
        description: 'A test badge',
        iconUrl: 'https://example.com/icon.png',
        requirementType: 'COURSE_COMPLETION',
        requirementValue: 1,
        isActive: true,
      };

      mockService.createBadge.mockResolvedValue({ id: 'badge-1', ...dto });

      const result = await controller.createBadge(dto);
      expect(result).toBeDefined();
      expect(mockService.createBadge).toHaveBeenCalledWith(dto);
    });

    it('should reject creation with invalid code', async () => {
      const dto: CreateBadgeDto = {
        code: '',
        name: 'Test Badge',
      };

      await expect(controller.createBadge(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('BadgesController.updateBadge', () => {
    it('should update a badge successfully', async () => {
      mockService.updateBadge.mockResolvedValue({ id: 'b1', code: 'updated' });

      const result = await controller.updateBadge('b1', { code: 'updated' });
      expect(result.code).toBe('updated');
    });

    it('should throw NotFoundException for non-existent badge', async () => {
      mockService.updateBadge.mockResolvedValue(null);

      await expect(controller.updateBadge('nonexistent', { code: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('BadgesController.handleMilestone', () => {
    it('should process milestone successfully', async () => {
      mockService.handleMilestoneEvent.mockResolvedValue({ id: 'milestone-1' });

      const result = await controller.handleMilestone('student-1', { type: 'COURSE_COMPLETION' });
      expect(result).toBeDefined();
      expect(mockService.handleMilestoneEvent).toHaveBeenCalledWith('student-1', { type: 'COURSE_COMPLETION' });
    });
  });

  describe('BadgesController.getStudentShowcase', () => {
    it('should return student showcase', async () => {
      mockService.getStudentShowcase.mockResolvedValue([{ id: 'b1' }]);

      const result = await controller.getStudentShowcase('student-1');
      expect(result).toBeDefined();
      expect(mockService.getStudentShowcase).toHaveBeenCalledWith('student-1');
    });
  });
});