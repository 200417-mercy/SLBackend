import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { LeaderboardScope } from './dto/leaderboard-query.dto';

const mockSnapshots = [
  {
    userId: 'user-1',
    rank: 1,
    points: 500,
    previousRank: 2,
    user: { name: 'Alice', avatarUrl: 'https://cdn.example.com/alice.png', stellarAddress: 'GALICE123' },
  },
  {
    userId: 'user-2',
    rank: 2,
    points: 350,
    previousRank: 1,
    user: { name: 'Bob', avatarUrl: null, stellarAddress: 'GBOB456' },
  },
];

const mockCourse = { id: 'course-1' };

// tx object passed inside $transaction callbacks
const mockTx = {
  leaderboardSnapshot: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockPrisma = {
  leaderboardSnapshot: {
    findMany: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  course: {
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockCache = {
  buildKey: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  invalidateNamespace: jest.fn(),
};

describe('[#337] LeaderboardService', () => {
  let service: LeaderboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    jest.clearAllMocks();
  });

  describe('getLeaderboard()', () => {
    it('returns paginated leaderboard data on a cache miss', async () => {
      mockCache.buildKey.mockReturnValue('leaderboard:global:1:10');
      mockCache.get.mockResolvedValue(null);
      mockPrisma.leaderboardSnapshot.findMany.mockResolvedValue(mockSnapshots);
      mockPrisma.leaderboardSnapshot.count.mockResolvedValue(2);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.getLeaderboard({
        scope: LeaderboardScope.GLOBAL,
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.scope).toBe(LeaderboardScope.GLOBAL);
      expect(result.data[0].userId).toBe('user-1');
      expect(result.data[0].currentRank).toBe(1);
      expect(result.data[0].points).toBe(500);
      expect(result.data[0].rankChange).toBe(1); // previousRank(2) - rank(1)

      expect(mockPrisma.leaderboardSnapshot.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.leaderboardSnapshot.count).toHaveBeenCalledTimes(1);
      expect(mockCache.set).toHaveBeenCalledWith('leaderboard:global:1:10', expect.any(Object), 300);
    });

    it('throws BadRequestException when scope is COURSE and courseId is missing', async () => {
      await expect(
        service.getLeaderboard({ scope: LeaderboardScope.COURSE }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.leaderboardSnapshot.findMany).not.toHaveBeenCalled();
    });

    it('returns cached result without hitting the database on a cache hit', async () => {
      const cachedPayload = {
        data: mockSnapshots.map((s) => ({
          userId: s.userId,
          name: s.user.name,
          avatarUrl: s.user.avatarUrl,
          points: s.points,
          currentRank: s.rank,
          previousRank: s.previousRank,
          rankChange: s.previousRank - s.rank,
        })),
        total: 2,
        page: 1,
        limit: 10,
        scope: LeaderboardScope.GLOBAL,
        courseId: null,
      };

      mockCache.buildKey.mockReturnValue('leaderboard:global:1:10');
      mockCache.get.mockResolvedValue(cachedPayload);

      const result = await service.getLeaderboard({
        scope: LeaderboardScope.GLOBAL,
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(cachedPayload);
      expect(mockPrisma.leaderboardSnapshot.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.leaderboardSnapshot.count).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });
  });

  describe('recalculateRankings()', () => {
    beforeEach(() => {
      // $transaction executes the callback immediately with mockTx
      mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx),
      );

      mockTx.leaderboardSnapshot.findMany.mockResolvedValue([]);
      mockTx.leaderboardSnapshot.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.leaderboardSnapshot.createMany.mockResolvedValue({ count: 2 });

      // calculateStudentPoints -> prisma.user.findMany
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          name: 'Alice',
          avatarUrl: 'https://cdn.example.com/alice.png',
          stellarAddress: 'GALICE123',
          enrollments: [{ status: 'COMPLETED', progressPercent: 100, lessonProgress: [{ id: 'lp-1' }, { id: 'lp-2' }] }],
          assignments: [{ id: 'a-1' }],
          examAttempts: [{ score: 90 }],
        },
        {
          id: 'user-2',
          name: 'Bob',
          avatarUrl: null,
          stellarAddress: 'GBOB456',
          enrollments: [{ status: 'IN_PROGRESS', progressPercent: 50, lessonProgress: [{ id: 'lp-3' }] }],
          assignments: [],
          examAttempts: [],
        },
      ]);

      mockPrisma.course.findMany.mockResolvedValue([mockCourse]);
      mockCache.invalidateNamespace.mockResolvedValue(undefined);
    });

    it('deletes old snapshots, creates new ranked snapshots, and invalidates the cache', async () => {
      const result = await service.recalculateRankings();

      // $transaction called once for global + once per course
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);

      // Inside each transaction: findMany (old ranks) → deleteMany → createMany
      expect(mockTx.leaderboardSnapshot.findMany).toHaveBeenCalled();
      expect(mockTx.leaderboardSnapshot.deleteMany).toHaveBeenCalled();
      expect(mockTx.leaderboardSnapshot.createMany).toHaveBeenCalled();

      // Snapshots are written with ascending rank (rank: 1, rank: 2 …)
      const createManyCall = mockTx.leaderboardSnapshot.createMany.mock.calls[0][0];
      expect(createManyCall.data[0].rank).toBe(1);

      expect(mockCache.invalidateNamespace).toHaveBeenCalledWith('leaderboard');
      expect(result).toEqual({ status: 'recalculated', coursesCount: 1 });
    });
  });

  describe('handlePeriodicRecalculation()', () => {
    it('delegates to recalculateRankings', async () => {
      const spy = jest
        .spyOn(service, 'recalculateRankings')
        .mockResolvedValue({ status: 'recalculated', coursesCount: 0 });

      await service.handlePeriodicRecalculation();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
