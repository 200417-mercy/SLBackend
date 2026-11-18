import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FraudDetectionService } from './fraud-detection.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FraudFlagStatus, FraudRiskLevel } from '@prisma/client';

describe('FraudDetectionService', () => {
  let service: FraudDetectionService;
  let prisma: any;
  let config: any;

  const mockConfig = {
    get: jest.fn((key: string, defaultValue: number) => {
      const configMap: Record<string, number> = {
        FRAUD_WINDOW_HOURS: 1,
        FRAUD_MAX_ENROLLMENTS_PER_WINDOW: 3,
        FRAUD_MAX_DAILY_ENROLLMENTS: 10,
        FRAUD_MAX_ACTIVE_ENROLLMENTS: 20,
        FRAUD_HIGH_AMOUNT_THRESHOLD_USDC: 500,
        FRAUD_HIGH_RISK_SCORE_THRESHOLD: 70,
        FRAUD_CRITICAL_SCORE_THRESHOLD: 90,
      };
      return configMap[key] ?? defaultValue;
    }),
  };

  const mockPrisma = {
    enrollment: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    enrollmentFraudFlag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<FraudDetectionService>(FraudDetectionService);
    prisma = module.get(PrismaService);
    config = module.get(ConfigService);
    jest.clearAllMocks();
  });

  describe('processFraudCheck', () => {
    const enrollmentId = 'enrollment-1';
    const studentId = 'student-1';
    const courseId = 'course-1';
    const amountPaid = 100;

    it('should allow enrollment when score is below high threshold', async () => {
      mockPrisma.$transaction.mockResolvedValue([0, 0, 0, 0]);

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.action).toBe('ALLOW');
      expect(result.score).toBeLessThan(70);
      expect(result.flagId).toBeUndefined();
    });

    it('should flag enrollment when score is between high and critical thresholds', async () => {
      mockPrisma.$transaction.mockResolvedValue([3, 0, 0, 0]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 70,
        status: FraudFlagStatus.OPEN,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.action).toBe('FLAG');
      expect(result.flagId).toBeDefined();
      expect(result.riskLevel).toBe(FraudRiskLevel.HIGH);
    });

    it('should hold enrollment when score meets or exceeds critical threshold', async () => {
      mockPrisma.$transaction.mockResolvedValue([10, 0, 0, 1]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 95,
        status: FraudFlagStatus.HELD,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.action).toBe('HOLD');
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.riskLevel).toBe(FraudRiskLevel.CRITICAL);
    });

    it('should detect rapid repeat purchases within time window', async () => {
      mockPrisma.$transaction.mockResolvedValue([3, 0, 0, 0]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 40,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.reasons).toContain('RAPID_REPEAT_PURCHASE');
    });

    it('should detect high daily volume', async () => {
      mockPrisma.$transaction.mockResolvedValue([0, 10, 0, 0]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 25,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.reasons).toContain('HIGH_DAILY_VOLUME');
    });

    it('should detect prior fraud history', async () => {
      mockPrisma.$transaction.mockResolvedValue([0, 0, 0, 1]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 35,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(result.reasons).toContain('PRIOR_FRAUD_HISTORY');
    });

    it('should detect high amount anomaly', async () => {
      mockPrisma.$transaction.mockResolvedValue([0, 0, 0, 0]);
      mockPrisma.enrollmentFraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        riskScore: 15,
      });

      const result = await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        600, // above 500 threshold
      );

      expect(result.reasons).toContain('HIGH_AMOUNT_ANOMALY');
    });

    it('should not persist flag when action is ALLOW', async () => {
      mockPrisma.$transaction.mockResolvedValue([0, 0, 0, 0]);

      await service.processFraudCheck(
        enrollmentId,
        studentId,
        courseId,
        amountPaid,
      );

      expect(mockPrisma.enrollmentFraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('getFraudReviewQueue', () => {
    it('should return paginated fraud flags ordered by risk score descending', async () => {
      const mockFlags = [
        {
          id: 'flag-1',
          riskScore: 95,
          riskLevel: FraudRiskLevel.CRITICAL,
          status: FraudFlagStatus.OPEN,
          createdAt: new Date(),
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockFlags, 1]);

      const result = await service.getFraudReviewQueue({}, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should filter by status', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.getFraudReviewQueue({ status: FraudFlagStatus.OPEN }, 1, 20);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should filter by risk level', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.getFraudReviewQueue(
        { riskLevel: FraudRiskLevel.CRITICAL },
        1,
        20,
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('getFlagById', () => {
    it('should return fraud flag with related data', async () => {
      const mockFlag = {
        id: 'flag-1',
        riskScore: 85,
        riskLevel: FraudRiskLevel.HIGH,
        status: FraudFlagStatus.OPEN,
        enrollment: {
          course: { id: 'course-1', title: 'React Course' },
          student: { id: 'student-1', name: 'John' },
        },
      };

      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(mockFlag);

      const result = await service.getFlagById('flag-1');

      expect(result.id).toBe('flag-1');
      expect(result.enrollment.course.title).toBe('React Course');
    });

    it('should throw NotFoundException if flag does not exist', async () => {
      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(null);

      await expect(service.getFlagById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reviewFlag', () => {
    const flagId = 'flag-1';
    const adminId = 'admin-1';

    it('should clear a fraud flag', async () => {
      const mockFlag = {
        id: flagId,
        status: FraudFlagStatus.OPEN,
      };

      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.enrollmentFraudFlag.update.mockResolvedValue({
        ...mockFlag,
        status: FraudFlagStatus.CLEARED,
      });

      const result = await service.reviewFlag(flagId, adminId, {
        decision: 'CLEARED',
        reviewNotes: 'False positive',
      });

      expect(result.status).toBe(FraudFlagStatus.CLEARED);
      expect(mockPrisma.enrollmentFraudFlag.update).toHaveBeenCalledWith({
        where: { id: flagId },
        data: expect.objectContaining({
          status: FraudFlagStatus.CLEARED,
          reviewedById: adminId,
        }),
      });
    });

    it('should confirm a fraud flag', async () => {
      const mockFlag = {
        id: flagId,
        status: FraudFlagStatus.OPEN,
      };

      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.enrollmentFraudFlag.update.mockResolvedValue({
        ...mockFlag,
        status: FraudFlagStatus.CONFIRMED,
      });

      const result = await service.reviewFlag(flagId, adminId, {
        decision: 'CONFIRMED',
      });

      expect(result.status).toBe(FraudFlagStatus.CONFIRMED);
    });

    it('should throw NotFoundException if flag does not exist', async () => {
      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(null);

      await expect(
        service.reviewFlag(flagId, adminId, { decision: 'CLEARED' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if flag is not reviewable', async () => {
      const mockFlag = {
        id: flagId,
        status: FraudFlagStatus.CLEARED,
      };

      mockPrisma.enrollmentFraudFlag.findUnique.mockResolvedValue(mockFlag);

      await expect(
        service.reviewFlag(flagId, adminId, { decision: 'CLEARED' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStudentRiskProfile', () => {
    const studentId = 'student-1';

    it('should return student risk profile with aggregated flags', async () => {
      const mockFlags = [
        {
          id: 'flag-1',
          riskScore: 85,
          riskLevel: FraudRiskLevel.HIGH,
          status: FraudFlagStatus.OPEN,
          createdAt: new Date(),
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockFlags, 1, 0]);

      const result = await service.getStudentRiskProfile(studentId);

      expect(result.studentId).toBe(studentId);
      expect(result.totalFlags).toBe(1);
      expect(result.confirmedFraud).toBe(1);
      expect(result.heldCount).toBe(0);
      expect(result.maxRiskScore).toBe(85);
    });

    it('should return low risk for student with no flags', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0, 0]);

      const result = await service.getStudentRiskProfile(studentId);

      expect(result.totalFlags).toBe(0);
      expect(result.maxRiskScore).toBe(0);
      expect(result.overallRisk).toBe(FraudRiskLevel.LOW);
    });

    it('should calculate max risk score from all flags', async () => {
      const mockFlags = [
        { riskScore: 85, riskLevel: FraudRiskLevel.HIGH },
        { riskScore: 45, riskLevel: FraudRiskLevel.MEDIUM },
        { riskScore: 95, riskLevel: FraudRiskLevel.CRITICAL },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockFlags as any, 2, 1]);

      const result = await service.getStudentRiskProfile(studentId);

      expect(result.maxRiskScore).toBe(95);
    });
  });
});
