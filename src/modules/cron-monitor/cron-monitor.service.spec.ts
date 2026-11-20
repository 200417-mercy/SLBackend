import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CronJobStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronMonitorService } from './cron-monitor.service';

describe('CronMonitorService', () => {
  let service: CronMonitorService;

  const mockPrisma = {
    cronJobRun: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronMonitorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CronMonitorService>(CronMonitorService);
    jest.clearAllMocks();

    mockPrisma.cronJobRun.create.mockResolvedValue({
      id: 'run-1',
      jobName: 'test-job',
      status: CronJobStatus.RUNNING,
      startedAt: new Date(),
    });
    mockPrisma.cronJobRun.update.mockResolvedValue({});
  });

  describe('start()', () => {
    it('creates a RUNNING run record and returns a handle', async () => {
      const handle = await service.start('test-job');

      expect(mockPrisma.cronJobRun.create).toHaveBeenCalledWith({
        data: { jobName: 'test-job', status: CronJobStatus.RUNNING },
      });
      expect(handle.success).toEqual(expect.any(Function));
      expect(handle.fail).toEqual(expect.any(Function));
      expect(handle.skip).toEqual(expect.any(Function));
    });

    it('records a SUCCESS finish with message and metadata', async () => {
      const handle = await service.start('test-job');

      await handle.success('Processed 3 rows', { rows: 3 });

      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CronJobStatus.SUCCESS,
          message: 'Processed 3 rows',
          error: null,
          metadata: { rows: 3 },
          finishedAt: expect.any(Date),
          durationMs: expect.any(Number),
        }),
      });
    });

    it('records a FAILED finish using the Error message', async () => {
      const handle = await service.start('test-job');

      await handle.fail(new Error('boom'));

      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CronJobStatus.FAILED,
          error: 'boom',
          message: null,
        }),
      });
    });

    it('stringifies non-Error failures', async () => {
      const handle = await service.start('test-job');

      await handle.fail({ reason: 'nope' });

      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CronJobStatus.FAILED,
          error: '[object Object]',
        }),
      });
    });

    it('defaults the skip message to "skipped"', async () => {
      const handle = await service.start('test-job');

      await handle.skip();

      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CronJobStatus.SKIPPED,
          message: 'skipped',
        }),
      });
    });
  });

  describe('run()', () => {
    it('records success and returns the callback result', async () => {
      const result = await service.run('test-job', async () => 42);

      expect(result).toBe(42);
      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CronJobStatus.SUCCESS }),
        }),
      );
    });

    it('records failure and rethrows the error', async () => {
      const error = new Error('job failed');

      await expect(
        service.run('test-job', async () => {
          throw error;
        }),
      ).rejects.toThrow('job failed');

      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CronJobStatus.FAILED,
            error: 'job failed',
          }),
        }),
      );
    });

    it('skips the callback when skipIf returns true', async () => {
      const callback = jest.fn();

      const result = await service.run('test-job', callback, {
        skipIf: () => true,
      });

      expect(callback).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(mockPrisma.cronJobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CronJobStatus.SKIPPED,
            message: 'skipIf condition was true',
          }),
        }),
      );
    });

    it('runs the callback if skipIf is false', async () => {
      const callback = jest.fn().mockResolvedValue('done');

      const result = await service.run('test-job', callback, {
        skipIf: async () => false,
      });

      expect(result).toBe('done');
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.cronJobRun.findMany.mockResolvedValue([{ id: 'run-1' }]);
      mockPrisma.cronJobRun.count.mockResolvedValue(1);
    });

    it('applies pagination defaults and a 90-day lower bound', async () => {
      const result = await service.findAll({});

      expect(mockPrisma.cronJobRun.findMany).toHaveBeenCalledWith({
        where: {
          startedAt: {
            gte: expect.any(Date),
          },
        },
        skip: 0,
        take: 50,
        orderBy: { startedAt: 'desc' },
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('clamps page to at least 1 and limit to at most 200', async () => {
      const result = await service.findAll({ page: -3, limit: 999 });

      expect(mockPrisma.cronJobRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 200 }),
      );
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(200);
    });

    it('passes job name, status, and date filters through', async () => {
      await service.findAll({
        jobName: 'cleanup',
        status: CronJobStatus.FAILED,
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-02-01T00:00:00.000Z',
        page: 2,
        limit: 10,
      });

      const args = mockPrisma.cronJobRun.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        jobName: 'cleanup',
        status: CronJobStatus.FAILED,
        startedAt: {
          gte: new Date('2024-01-01T00:00:00.000Z'),
          lte: new Date('2024-02-01T00:00:00.000Z'),
        },
      });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
    });
  });

  describe('findOne()', () => {
    it('returns the run when found', async () => {
      mockPrisma.cronJobRun.findUnique.mockResolvedValue({ id: 'run-1' });

      await expect(service.findOne('run-1')).resolves.toEqual({ id: 'run-1' });
    });

    it('throws NotFoundException when the run does not exist', async () => {
      mockPrisma.cronJobRun.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats()', () => {
    it('aggregates per-job totals, durations, and last success/failure', async () => {
      const now = new Date();
      mockPrisma.cronJobRun.findMany.mockResolvedValue([
        {
          jobName: 'job-a',
          status: CronJobStatus.SUCCESS,
          durationMs: 100,
          startedAt: new Date(now.getTime() - 1000),
          error: null,
        },
        {
          jobName: 'job-a',
          status: CronJobStatus.SUCCESS,
          durationMs: 300,
          startedAt: new Date(now.getTime() - 2000),
          error: null,
        },
        {
          jobName: 'job-a',
          status: CronJobStatus.FAILED,
          durationMs: null,
          startedAt: new Date(now.getTime() - 500),
          error: 'boom',
        },
        {
          jobName: 'job-a',
          status: CronJobStatus.SKIPPED,
          durationMs: null,
          startedAt: new Date(now.getTime() - 200),
          error: null,
        },
        {
          jobName: 'job-b',
          status: CronJobStatus.SUCCESS,
          durationMs: 50,
          startedAt: new Date(now.getTime() - 300),
          error: null,
        },
        {
          jobName: 'job-b',
          status: CronJobStatus.RUNNING,
          durationMs: null,
          startedAt: new Date(now.getTime() - 100),
          error: null,
        },
      ]);

      const result = await service.getStats();

      expect(result.map((r) => r.jobName)).toEqual(['job-a', 'job-b']);

      const jobA = result[0];
      expect(jobA.total).toBe(4);
      expect(jobA.success).toBe(2);
      expect(jobA.failed).toBe(1);
      expect(jobA.skipped).toBe(1);
      expect(jobA.successRate).toBe(66.7);
      expect(jobA.avgDurationMs).toBe(200);
      expect(jobA.lastError).toBe('boom');
      expect(jobA.lastFailure).toEqual(new Date(now.getTime() - 500));
      expect(jobA.lastSuccess).toEqual(new Date(now.getTime() - 1000));

      const jobB = result[1];
      expect(jobB.total).toBe(2);
      expect(jobB.running).toBe(1);
      expect(jobB.successRate).toBe(100);
      expect(jobB.avgDurationMs).toBe(50);
    });

    it('returns an empty array when there are no runs', async () => {
      mockPrisma.cronJobRun.findMany.mockResolvedValue([]);

      await expect(service.getStats()).resolves.toEqual([]);
    });
  });

  describe('stale run handling', () => {
    it('findStaleRuns queries RUNNING runs older than the threshold', async () => {
      mockPrisma.cronJobRun.findMany.mockResolvedValue([]);

      await service.findStaleRuns(15);

      const args = mockPrisma.cronJobRun.findMany.mock.calls[0][0];
      expect(args.where.status).toBe(CronJobStatus.RUNNING);
      expect(args.where.startedAt.lt).toEqual(expect.any(Date));
      expect(args.orderBy).toEqual({ startedAt: 'asc' });
    });

    it('markStaleRunsFailed is a no-op when there are no stale runs', async () => {
      mockPrisma.cronJobRun.findMany.mockResolvedValue([]);

      await expect(service.markStaleRunsFailed()).resolves.toEqual({ marked: 0 });
      expect(mockPrisma.cronJobRun.updateMany).not.toHaveBeenCalled();
    });

    it('markStaleRunsFailed marks stale runs as FAILED', async () => {
      mockPrisma.cronJobRun.findMany.mockResolvedValue([
        { id: 'run-1' },
        { id: 'run-2' },
      ]);
      mockPrisma.cronJobRun.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markStaleRunsFailed(10);

      expect(mockPrisma.cronJobRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['run-1', 'run-2'] } },
        data: expect.objectContaining({
          status: CronJobStatus.FAILED,
          finishedAt: expect.any(Date),
          error: expect.stringContaining('threshold: 10 min'),
        }),
      });
      expect(result).toEqual({ marked: 2, ids: ['run-1', 'run-2'] });
    });
  });

  describe('purgeOldRuns()', () => {
    it('deletes runs older than the retention window', async () => {
      mockPrisma.cronJobRun.deleteMany.mockResolvedValue({ count: 7 });

      const result = await service.purgeOldRuns(30);

      const args = mockPrisma.cronJobRun.deleteMany.mock.calls[0][0];
      expect(args.where.startedAt.lt).toEqual(expect.any(Date));
      expect(result).toEqual({ deleted: 7 });
    });
  });
});
