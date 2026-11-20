import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockQueueService = {
  getJobStatus: jest.fn(),
  getQueueMetrics: jest.fn(),
  getDeadLetterJobs: jest.fn(),
  requeueDeadLetterJob: jest.fn(),
};

const mockPrisma = {
  $transaction: jest.fn(),
};

describe('QueueController (Issue #406) - Unit Tests for Queue Endpoints', () => {
  let controller: QueueController;
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueController,
        { provide: QueueService, useValue: mockQueueService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<QueueController>(QueueController);
    service = module.get<QueueService>(QueueService);
    jest.clearAllMocks();
  });

  describe('QueueController.getJobStatus', () => {
    it('should get job status successfully', async () => {
      const jobId = 'job-123';
      const userId = 'user-1';

      mockQueueService.getJobStatus.mockResolvedValue({ id: jobId, status: 'completed', progress: 100 });

      const result = await controller.getJobStatus(jobId, userId);
      expect(result).toBeDefined();
      expect(mockQueueService.getJobStatus).toHaveBeenCalledWith(jobId, userId);
    });

    it('should throw NotFoundException for non-existent job', async () => {
      mockQueueService.getJobStatus.mockResolvedValue(null);

      await expect(controller.getJobStatus('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('QueueController.getQueueMetrics', () => {
    it('should return queue metrics', async () => {
      const userId = 'user-1';

      mockQueueService.getQueueMetrics.mockResolvedValue({
        totalJobs: 100,
        completed: 80,
        failed: 15,
        pending: 5,
      });

      const result = await controller.getQueueMetrics(userId);
      expect(result).toBeDefined();
      expect(mockQueueService.getQueueMetrics).toHaveBeenCalledWith(userId);
    });
  });

  describe('QueueController.getDeadLetterJobs', () => {
    it('should return dead letter jobs', async () => {
      const userId = 'user-1';

      mockQueueService.getDeadLetterJobs.mockResolvedValue([
        { id: 'job-1', queue: 'high-priority', error: 'timeout' },
        { id: 'job-2', queue: 'low-priority', error: 'validation' },
      ]);

      const result = await controller.getDeadLetterJobs(userId);
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should return empty list when no dead letter jobs', async () => {
      mockQueueService.getDeadLetterJobs.mockResolvedValue([]);

      const result = await controller.getDeadLetterJobs(userId);
      expect(result).toEqual([]);
    });
  });

  describe('QueueController.requeueDeadLetterJob', () => {
    it('should requeue a dead letter job successfully', async () => {
      const queueName = 'high-priority';
      const jobId = 'job-1';

      mockQueueService.requeueDeadLetterJob.mockResolvedValue({ id: jobId, queue: queueName, requeued: true });

      const result = await controller.requeueDeadLetterJob(queueName, jobId);
      expect(result).toBeDefined();
      expect(mockQueueService.requeueDeadLetterJob).toHaveBeenCalledWith(queueName, jobId);
    });

    it('should throw NotFoundException for non-existent dead letter job', async () => {
      mockQueueService.requeueDeadLetterJob.mockResolvedValue(null);

      await expect(controller.requeueDeadLetterJob('high-priority', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});