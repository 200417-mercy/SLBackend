import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let service: SessionsService;

  const mockPrisma: any = {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createSession', () => {
    it('stores device metadata with a parsed device label', async () => {
      await service.createSession({
        userId: 'u1',
        jti: 'j1',
        expiresAt: new Date(Date.now() + 60_000),
        meta: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
          ipAddress: '1.2.3.4',
        },
      });

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          jti: 'j1',
          ipAddress: '1.2.3.4',
          deviceLabel: 'Chrome on Windows',
        }),
      });
    });

    it('leaves the device label empty without a user agent', async () => {
      await service.createSession({ userId: 'u1', jti: 'j1', expiresAt: new Date() });
      expect(mockPrisma.session.create.mock.calls[0][0].data.deviceLabel).toBeUndefined();
    });
  });

  describe('isSessionActive', () => {
    it('is true for an unrevoked, unexpired session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.isSessionActive('j1')).resolves.toBe(true);
    });

    it('is false for missing, revoked or expired sessions', async () => {
      mockPrisma.session.findUnique.mockResolvedValueOnce(null);
      await expect(service.isSessionActive('j1')).resolves.toBe(false);

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.isSessionActive('j1')).resolves.toBe(false);

      mockPrisma.session.findUnique.mockResolvedValueOnce({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.isSessionActive('j1')).resolves.toBe(false);
    });
  });

  it('touchLastActive swallows database errors', async () => {
    mockPrisma.session.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.touchLastActive('j1')).resolves.toBeUndefined();
  });

  it('listSessions flags the current session', async () => {
    mockPrisma.session.findMany.mockResolvedValue([
      { id: 's1', jti: 'j1' },
      { id: 's2', jti: 'j2' },
    ]);

    const result = await service.listSessions('u1', 'j2');

    expect(result.map((s) => s.isCurrent)).toEqual([false, true]);
  });

  describe('revokeSession', () => {
    it('throws NotFoundException for an unknown session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);
      await expect(service.revokeSession('u1', 's1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for another user', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({ id: 's1', userId: 'other' });
      await expect(service.revokeSession('u1', 's1')).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent for an already revoked session', async () => {
      const revokedAt = new Date();
      mockPrisma.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', revokedAt });

      const result = await service.revokeSession('u1', 's1');

      expect(result).toEqual({ id: 's1', revoked: true, revokedAt });
      expect(mockPrisma.session.update).not.toHaveBeenCalled();
    });

    it('revokes an active session', async () => {
      const revokedAt = new Date();
      mockPrisma.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', revokedAt: null });
      mockPrisma.session.update.mockResolvedValue({ id: 's1', revokedAt });

      await expect(service.revokeSession('u1', 's1')).resolves.toEqual({
        id: 's1',
        revoked: true,
        revokedAt,
      });
    });
  });

  it('revokeAllExceptCurrent excludes the current jti', async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.revokeAllExceptCurrent('u1', 'j1');

    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null, jti: { not: 'j1' } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toEqual({ revoked: true, revokedCount: 2 });
  });
});
