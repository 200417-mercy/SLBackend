import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CoursesService } from '../courses/courses.service';
import { EventsService, EVENT_POLLER_CHECKPOINT_KEY } from './events.service';

describe('EventsService', () => {
  let service: EventsService;

  const mockPrisma = {
    eventPollerCheckpoint: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    chainEvent: {
      create: jest.fn(),
    },
    course: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    enrollment: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    certificate: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStellar = {
    getLatestLedger: jest.fn(),
    fetchContractEvents: jest.fn(),
  };

  const mockNotifications = { notifyUser: jest.fn() };
  const mockCourses = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: CoursesService, useValue: mockCourses },
      ],
    }).compile();

    service = module.get(EventsService);
    jest.clearAllMocks();
    mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
    mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.chainEvent.create.mockResolvedValue({});
    mockPrisma.course.update.mockResolvedValue({});
    mockPrisma.course.findUnique.mockResolvedValue({ id: 'COURSE-1' });
    mockPrisma.enrollment.create.mockResolvedValue({});
    mockPrisma.enrollment.update.mockResolvedValue({});
    mockPrisma.enrollment.findUnique.mockResolvedValue({ id: 'ENROLL-1' });
    mockPrisma.certificate.create.mockResolvedValue({});
    mockPrisma.certificate.update.mockResolvedValue({});
    mockPrisma.certificate.findUnique.mockResolvedValue({ id: 'CERT-1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'USER-1' });
    mockPrisma.user.update.mockResolvedValue({});
    mockNotifications.notifyUser.mockResolvedValue(undefined);
  });

  describe('onModuleInit — resume from checkpoint', () => {
    it('resumes from the persisted ledger instead of the chain tip', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 4242,
      });
      mockStellar.getLatestLedger.mockResolvedValue(9999);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(4242);
      expect(status.resumedFromCheckpoint).toBe(true);
    });

    it('cold-starts near the chain tip and writes an initial checkpoint when none exists', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(1000);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(990); // 1000 - COLD_START_LOOKBACK
      expect(status.resumedFromCheckpoint).toBe(false);
      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: EVENT_POLLER_CHECKPOINT_KEY },
        }),
      );
    });

    it('ignores a checkpoint that points past the chain tip (stale / wrong network)', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 50_000,
      });
      mockStellar.getLatestLedger.mockResolvedValue(1000);

      await service.onModuleInit();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(990);
      expect(status.resumedFromCheckpoint).toBe(false);
    });
  });

  describe('pollEvents — checkpoint writes after each poll', () => {
    beforeEach(async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(100);
      await service.onModuleInit();
      jest.clearAllMocks();
      mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.chainEvent.create.mockResolvedValue({});
    });

    it('advances and persists the ledger after processing events', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([
        { ledger: 105, topic: ['course_registered'], value: 'COURSE-1', txHash: 'a' },
        { ledger: 107, topic: ['course_registered'], value: 'COURSE-2', txHash: 'b' },
      ]);

      await service.pollEvents();

      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastProcessedLedger: 108 }),
        }),
      );
      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(108);
    });

    it('still writes a checkpoint when a poll finds no events', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([]);

      await service.pollEvents();

      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('pollEvents — checkpoint write failures do not block polling', () => {
    beforeEach(async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(100);
      await service.onModuleInit();
      jest.clearAllMocks();
      mockPrisma.chainEvent.create.mockResolvedValue({});
    });

    it('swallows the write error, records the failure and keeps advancing in memory', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([
        { ledger: 110, topic: ['course_registered'], value: 'COURSE-1', txHash: 'a' },
      ]);
      mockPrisma.eventPollerCheckpoint.upsert.mockRejectedValue(new Error('db down'));
      mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.pollEvents()).resolves.not.toThrow();

      const status = await service.getCheckpointStatus();
      expect(status.consecutiveWriteFailures).toBe(1);
      expect(status.lastWriteError).toContain('db down');
      expect(status.healthy).toBe(false);
      // in-memory progress is not lost
      expect(status.lastProcessedLedger).toBe(111);
    });

    it('recovers (failure counter resets) once a later write succeeds', async () => {
      mockStellar.fetchContractEvents.mockResolvedValue([]);
      mockPrisma.eventPollerCheckpoint.upsert
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({});
      mockPrisma.eventPollerCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      await service.pollEvents();
      expect((await service.getCheckpointStatus()).consecutiveWriteFailures).toBe(1);

      await service.pollEvents();
      const status = await service.getCheckpointStatus();
      expect(status.consecutiveWriteFailures).toBe(0);
      expect(status.healthy).toBe(true);
    });
  });

  describe('getCheckpointStatus', () => {
    it('reports the persisted ledger from the database', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue({
        key: EVENT_POLLER_CHECKPOINT_KEY,
        lastProcessedLedger: 777,
        lastPolledAt: new Date('2026-08-27T00:00:00Z'),
      });

      const status = await service.getCheckpointStatus();
      expect(status.persistedLedger).toBe(777);
      expect(status.key).toBe(EVENT_POLLER_CHECKPOINT_KEY);
    });
  });

  describe('onModuleInit — failure paths', () => {
    it('falls back to ledger 1 when getLatestLedger throws and still persists a checkpoint', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockRejectedValue(new Error('horizon down'));

      await expect(service.onModuleInit()).resolves.not.toThrow();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(1);
      expect(status.resumedFromCheckpoint).toBe(false);
      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: EVENT_POLLER_CHECKPOINT_KEY },
        }),
      );
    });

    it('cold-starts when loadCheckpoint rejects', async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockRejectedValue(
        new Error('db unavailable'),
      );
      mockStellar.getLatestLedger.mockResolvedValue(1000);

      await expect(service.onModuleInit()).resolves.not.toThrow();

      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(990);
      expect(status.resumedFromCheckpoint).toBe(false);
    });
  });

  describe('pollEvents — fetch failures', () => {
    beforeEach(async () => {
      mockPrisma.eventPollerCheckpoint.findUnique.mockResolvedValue(null);
      mockStellar.getLatestLedger.mockResolvedValue(100);
      await service.onModuleInit();
      jest.clearAllMocks();
      mockPrisma.eventPollerCheckpoint.upsert.mockResolvedValue({});
      mockPrisma.chainEvent.create.mockResolvedValue({});
    });

    it('logs the error, still writes a checkpoint and leaves the in-memory ledger unchanged', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockStellar.fetchContractEvents.mockRejectedValue(new Error('rpc boom'));

      await expect(service.pollEvents()).resolves.not.toThrow();

      expect(loggerSpy).toHaveBeenCalled();
      expect(mockPrisma.eventPollerCheckpoint.upsert).toHaveBeenCalledTimes(1);
      const status = await service.getCheckpointStatus();
      expect(status.lastProcessedLedger).toBe(90);
      loggerSpy.mockRestore();
    });
  });

  describe('processEvent — dispatch', () => {
    const baseEvent = (name: string, value: string, txHash = 'tx-1') => ({
      ledger: 101,
      topic: [name],
      value,
      txHash,
    });

    it('handles course_registered by updating the course', async () => {
      await service.processEvent(baseEvent('course_registered', 'COURSE-1'));

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'COURSE-1' } }),
      );
    });

    it('handles course_approved by updating the course', async () => {
      await service.processEvent(baseEvent('course_approved', 'COURSE-1'));

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'COURSE-1' } }),
      );
    });

    it('handles course_paused by updating the course', async () => {
      await service.processEvent(baseEvent('course_paused', 'COURSE-1'));

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'COURSE-1' } }),
      );
    });

    it('handles course_archived by updating the course', async () => {
      await service.processEvent(baseEvent('course_archived', 'COURSE-1'));

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'COURSE-1' } }),
      );
    });

    it('handles student_enrolled by creating an enrollment', async () => {
      await service.processEvent(baseEvent('student_enrolled', 'COURSE-1'));

      expect(mockPrisma.enrollment.create).toHaveBeenCalled();
    });

    it('handles course_completed by updating the enrollment', async () => {
      await service.processEvent(baseEvent('course_completed', 'COURSE-1'));

      expect(mockPrisma.enrollment.update).toHaveBeenCalled();
    });

    it('handles certificate_issued by creating a certificate and notifying the student', async () => {
      await service.processEvent(baseEvent('certificate_issued', 'COURSE-1'));

      expect(mockPrisma.certificate.create).toHaveBeenCalled();
      expect(mockNotifications.notifyUser).toHaveBeenCalled();
    });

    it('handles certificate_revoked by setting the revoked flag', async () => {
      await service.processEvent(baseEvent('certificate_revoked', 'CERT-1'));

      expect(mockPrisma.certificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'CERT-1' },
          data: expect.objectContaining({ revoked: true }),
        }),
      );
    });

    it('logs a warning and does not throw for an unknown event name', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        service.processEvent(baseEvent('totally_unknown', 'X')),
      ).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalled();
      expect(mockPrisma.course.update).not.toHaveBeenCalled();
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
      expect(mockPrisma.certificate.create).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('processEvent — handler error branches', () => {
    const baseEvent = (name: string, value: string, txHash = 'tx-1') => ({
      ledger: 101,
      topic: [name],
      value,
      txHash,
    });

    it('catches and logs a prisma.course.update rejection', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockPrisma.course.update.mockRejectedValue(new Error('update failed'));

      await expect(
        service.processEvent(baseEvent('course_approved', 'COURSE-1')),
      ).resolves.not.toThrow();

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });

    it('notifies the student and records the txHash on certificate_issued', async () => {
      mockPrisma.certificate.create.mockResolvedValue({
        id: 'CERT-1',
        studentId: 'USER-1',
      });

      await service.processEvent(
        baseEvent('certificate_issued', 'COURSE-1', 'tx-abc'),
      );

      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'USER-1',
        expect.anything(),
      );
      expect(mockPrisma.certificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ txHash: 'tx-abc' }),
        }),
      );
    });

    it('sets the revoked flag on certificate_revoked', async () => {
      await service.processEvent(baseEvent('certificate_revoked', 'CERT-1'));

      expect(mockPrisma.certificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'CERT-1' },
          data: expect.objectContaining({ revoked: true }),
        }),
      );
    });
  });
});
