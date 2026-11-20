import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
    },
    adminAuditLog: {
      create: jest.fn(),
    },
  };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    stellarAddress: 'GABC123',
    role: 'STUDENT',
    isBanned: false,
    bannedAt: null,
    banReason: null,
    isSuspended: false,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockPrisma.adminAuditLog.create.mockResolvedValue({});
  });

  describe('findById()', () => {
    it('returns the user with related data', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.findById('user-1')).resolves.toEqual(baseUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: {
          enrollments: expect.objectContaining({ take: 10 }),
          certificates: expect.any(Object),
          coursesCreated: expect.objectContaining({ take: 10 }),
        },
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByAddress()', () => {
    it('returns the user with the given stellar address', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.findByAddress('GABC123')).resolves.toEqual(baseUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { stellarAddress: 'GABC123' },
      });
    });

    it('throws NotFoundException when the address is unknown', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findByAddress('GUNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile()', () => {
    it('updates and returns the profile', async () => {
      const updated = { ...baseUser, name: 'New Name' };
      mockPrisma.user.update.mockResolvedValue(updated);

      await expect(
        service.updateProfile('user-1', { name: 'New Name' }),
      ).resolves.toEqual(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New Name' },
      });
    });

    it('maps Prisma P2002 errors to a ConflictException', async () => {
      mockPrisma.user.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.updateProfile('user-1', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows unrelated Prisma errors', async () => {
      const error = { code: 'P2025' };
      mockPrisma.user.update.mockRejectedValue(error);

      await expect(
        service.updateProfile('user-1', { name: 'x' }),
      ).rejects.toBe(error);
    });
  });

  describe('getInstructorStats()', () => {
    it('sums enrollments and revenue across instructor courses', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'c1', totalRevenue: '100.50', _count: { enrollments: 3 } },
        { id: 'c2', totalRevenue: 49.5, _count: { enrollments: 2 } },
      ]);

      const result = await service.getInstructorStats('GINSTRUCTOR');

      expect(mockPrisma.course.findMany).toHaveBeenCalledWith({
        where: { instructorAddress: 'GINSTRUCTOR' },
        include: { _count: { select: { enrollments: true } } },
      });
      expect(result.totalCourses).toBe(2);
      expect(result.totalStudents).toBe(5);
      expect(result.totalRevenue).toBe(150);
    });

    it('returns zeroed stats when the instructor has no courses', async () => {
      mockPrisma.course.findMany.mockResolvedValue([]);

      const result = await service.getInstructorStats('GINSTRUCTOR');

      expect(result).toEqual({
        totalCourses: 0,
        totalStudents: 0,
        totalRevenue: 0,
        courses: [],
      });
    });
  });

  describe('banUser()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.banUser('missing', 'admin-1', 'spam'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an already banned user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
      });

      await expect(
        service.banUser('user-1', 'admin-1', 'spam'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to ban admin users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'ADMIN',
      });

      await expect(
        service.banUser('user-1', 'admin-1', 'spam'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('bans the user, clears suspension, and writes an audit log', async () => {
      const banned = { ...baseUser, isBanned: true };
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPrisma.user.update.mockResolvedValue(banned);

      const result = await service.banUser(
        'user-1',
        'admin-1',
        'abusive behaviour',
        '127.0.0.1',
      );

      expect(result).toEqual(banned);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          isBanned: true,
          bannedAt: expect.any(Date),
          banReason: 'abusive behaviour',
          isSuspended: false,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'admin-1',
          action: AuditAction.USER_BANNED,
          targetType: AuditTargetType.USER,
          targetId: 'user-1',
          ipAddress: '127.0.0.1',
          metadata: expect.objectContaining({
            reason: 'abusive behaviour',
            userEmail: baseUser.email,
            stellarAddress: baseUser.stellarAddress,
          }),
        }),
      });
    });
  });

  describe('unbanUser()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.unbanUser('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a user that is not banned', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(
        service.unbanUser('user-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('unbans the user and writes an audit log', async () => {
      const unbanned = { ...baseUser, isBanned: false };
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
        banReason: 'spam',
        bannedAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue(unbanned);

      const result = await service.unbanUser('user-1', 'admin-1', 'appeal upheld');

      expect(result).toEqual(unbanned);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isBanned: false, bannedAt: null, banReason: null },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: AuditAction.USER_UNBANNED,
          metadata: expect.objectContaining({
            reason: 'appeal upheld',
            previousBanReason: 'spam',
          }),
        }),
      });
    });
  });

  describe('suspendUser()', () => {
    const futureDate = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.suspendUser('missing', 'admin-1', 'spam', futureDate()),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to suspend a banned user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
      });

      await expect(
        service.suspendUser('user-1', 'admin-1', 'spam', futureDate()),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to suspend an already suspended user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isSuspended: true,
      });

      await expect(
        service.suspendUser('user-1', 'admin-1', 'spam', futureDate()),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to suspend admin users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'ADMIN',
      });

      await expect(
        service.suspendUser('user-1', 'admin-1', 'spam', futureDate()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a suspension end date in the past', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(
        service.suspendUser(
          'user-1',
          'admin-1',
          'spam',
          new Date(Date.now() - 1000),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('suspends the user and writes an audit log', async () => {
      const until = futureDate();
      const suspended = { ...baseUser, isSuspended: true, suspendedUntil: until };
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPrisma.user.update.mockResolvedValue(suspended);

      const result = await service.suspendUser('user-1', 'admin-1', 'spam', until);

      expect(result).toEqual(suspended);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          isSuspended: true,
          suspendedAt: expect.any(Date),
          suspendedUntil: until,
          suspensionReason: 'spam',
        }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: AuditAction.USER_SUSPENDED,
          metadata: expect.objectContaining({
            reason: 'spam',
            suspendedUntil: until.toISOString(),
          }),
        }),
      });
    });
  });

  describe('unsuspendUser()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.unsuspendUser('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a user that is not suspended', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(
        service.unsuspendUser('user-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lifts the suspension and writes an audit log', async () => {
      const unsuspended = { ...baseUser, isSuspended: false };
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isSuspended: true,
        suspensionReason: 'spam',
        suspendedAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue(unsuspended);

      const result = await service.unsuspendUser('user-1', 'admin-1', 'resolved');

      expect(result).toEqual(unsuspended);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          isSuspended: false,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: AuditAction.USER_UNSUSPENDED,
          metadata: expect.objectContaining({
            reason: 'resolved',
            previousSuspensionReason: 'spam',
          }),
        }),
      });
    });
  });

  describe('checkAccountStatus()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.checkAccountStatus('missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('auto-unsuspends a user whose suspension has expired', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isSuspended: true,
        suspendedAt: new Date(Date.now() - 10_000),
        suspendedUntil: new Date(Date.now() - 1000),
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.checkAccountStatus('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          isSuspended: false,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
      expect(result).toEqual({
        isActive: true,
        isBanned: false,
        isSuspended: false,
      });
    });

    it('reports an active account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      const result = await service.checkAccountStatus('user-1');

      expect(result.isActive).toBe(true);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('reports a banned account as inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isBanned: true,
        banReason: 'spam',
      });

      const result = await service.checkAccountStatus('user-1');

      expect(result.isActive).toBe(false);
      expect(result.isBanned).toBe(true);
      expect(result.banReason).toBe('spam');
    });

    it('reports an unexpired suspension as inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        isSuspended: true,
        suspendedUntil: new Date(Date.now() + 60_000),
        suspensionReason: 'spam',
      });

      const result = await service.checkAccountStatus('user-1');

      expect(result.isActive).toBe(false);
      expect(result.isSuspended).toBe(true);
    });
  });
});
