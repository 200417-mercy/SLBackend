import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiscountType,
  ReferralRewardKind,
  ReferralRewardStatus,
  ReferralStatus,
} from '@prisma/client';

import { ReferralsService } from './referrals.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const REFERRER_ID = 'user-ref';
const CODE = 'HAMP-AABBCC';
const REFERRAL_CODE_ID = 'rc-1';
const REFERRAL_ID = 'ref-1';
const REWARD_ID = 'rw-1';
const ENROLLMENT_ID = 'enr-1';

const mockReferralCode = {
  id: REFERRAL_CODE_ID,
  userId: REFERRER_ID,
  code: CODE,
  isActive: true,
  totalSignups: 0,
  totalConversions: 0,
};

const mockUser = {
  id: REFERRER_ID,
  name: 'Alice Referrer',
  stellarAddress: 'GREFEXA',
};

const mockReferral = {
  id: REFERRAL_ID,
  referralCodeId: REFERRAL_CODE_ID,
  referrerId: REFERRER_ID,
  referredUserId: USER_ID,
  status: ReferralStatus.SIGNED_UP,
  convertedAt: null,
  enrollmentId: null,
  signedUpAt: new Date(),
  rewards: [],
};

const mockReward = {
  id: REWARD_ID,
  referralId: REFERRAL_ID,
  beneficiaryId: USER_ID,
  kind: ReferralRewardKind.REFEREE,
  discountType: DiscountType.PERCENTAGE,
  discountValue: 10,
  status: ReferralRewardStatus.ISSUED,
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days out
  redeemedAt: null,
  enrollmentId: null,
  createdAt: new Date(),
};

const mockRewardRuleRow = {
  id: 'default',
  referrerDiscountPercent: 15,
  refereeDiscountPercent: 10,
  rewardExpiryDays: 90,
  maxRewardsPerReferrer: 50,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPrisma = {
  referralRewardRule: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  referralCode: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  referral: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  referralReward: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string, def: unknown) => def),
};

const mockNotifications = {
  notifyUser: jest.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ReferralsService (Issue #336)', () => {
  let service: ReferralsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    jest.clearAllMocks();
  });

  // ── getRewardRules ──────────────────────────────────────────────────────

  describe('getRewardRules()', () => {
    it('returns persisted rules when a row exists', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
      const rules = await service.getRewardRules();
      expect(rules.referrerDiscountPercent).toBe(15);
      expect(rules.refereeDiscountPercent).toBe(10);
      expect(rules.rewardExpiryDays).toBe(90);
      expect(rules.maxRewardsPerReferrer).toBe(50);
    });

    it('falls back to .env defaults when no row is stored', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(null);
      mockConfig.get.mockImplementation((key: string, def: unknown) => def);
      const rules = await service.getRewardRules();
      expect(rules.referrerDiscountPercent).toBe(10);
      expect(rules.refereeDiscountPercent).toBe(10);
    });

    it('falls back to .env defaults on a Prisma error', async () => {
      mockPrisma.referralRewardRule.findUnique.mockRejectedValue(new Error('DB error'));
      const rules = await service.getRewardRules();
      expect(rules).toBeDefined();
      expect(typeof rules.referrerDiscountPercent).toBe('number');
    });
  });

  // ── updateRewardRules ───────────────────────────────────────────────────

  describe('updateRewardRules()', () => {
    it('upserts new rules and returns the updated record', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
      mockPrisma.referralRewardRule.upsert.mockResolvedValue({
        ...mockRewardRuleRow,
        referrerDiscountPercent: 20,
      });
      const rules = await service.updateRewardRules({ referrerDiscountPercent: 20 });
      expect(mockPrisma.referralRewardRule.upsert).toHaveBeenCalledTimes(1);
      expect(rules.referrerDiscountPercent).toBe(20);
    });

    it('carries forward unchanged fields when only one field is supplied', async () => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
      mockPrisma.referralRewardRule.upsert.mockResolvedValue(mockRewardRuleRow);
      await service.updateRewardRules({ rewardExpiryDays: 60 });
      const upsertCall = mockPrisma.referralRewardRule.upsert.mock.calls[0][0];
      expect(upsertCall.update.referrerDiscountPercent).toBe(15);
    });
  });

  // ── getOrCreateCode ─────────────────────────────────────────────────────

  describe('getOrCreateCode()', () => {
    it('returns existing code without creating a new one', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(mockReferralCode);
      const result = await service.getOrCreateCode(REFERRER_ID);
      expect(result).toEqual(mockReferralCode);
      expect(mockPrisma.referralCode.create).not.toHaveBeenCalled();
    });

    it('creates a new code when none exists', async () => {
      mockPrisma.referralCode.findUnique
        .mockResolvedValueOnce(null) // userId lookup
        .mockResolvedValueOnce(null); // uniqueness check
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.referralCode.create.mockResolvedValue(mockReferralCode);
      const result = await service.getOrCreateCode(REFERRER_ID);
      expect(mockPrisma.referralCode.create).toHaveBeenCalledTimes(1);
      expect(result.userId).toBe(REFERRER_ID);
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getOrCreateCode('no-such-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── validateCode ────────────────────────────────────────────────────────

  describe('validateCode()', () => {
    beforeEach(() => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
    });

    it('returns valid response with referrer info and discount percents', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        ...mockReferralCode,
        user: { id: REFERRER_ID, name: 'Alice', stellarAddress: null },
      });
      const result = await service.validateCode(CODE.toLowerCase());
      expect(result.valid).toBe(true);
      expect(result.code).toBe(CODE);
      expect(result.referrer.id).toBe(REFERRER_ID);
      expect(typeof result.refereeDiscountPercent).toBe('number');
    });

    it('throws NotFoundException for an unknown code', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      await expect(service.validateCode('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for an inactive code', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        ...mockReferralCode,
        isActive: false,
        user: { id: REFERRER_ID, name: 'Alice', stellarAddress: null },
      });
      await expect(service.validateCode(CODE)).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when user validates their own code", async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        ...mockReferralCode,
        user: { id: REFERRER_ID, name: 'Alice', stellarAddress: null },
      });
      await expect(service.validateCode(CODE, REFERRER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── trackSignup ─────────────────────────────────────────────────────────

  describe('trackSignup()', () => {
    beforeEach(() => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
      mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({
          referral: { create: jest.fn().mockResolvedValue(mockReferral) },
          referralCode: { update: jest.fn().mockResolvedValue(mockReferralCode) },
          referralReward: { create: jest.fn().mockResolvedValue(mockReward) },
        }),
      );
    });

    it('creates a referral and returns it', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      mockPrisma.referralCode.findUnique.mockResolvedValue(mockReferralCode);
      const result = await service.trackSignup(USER_ID, CODE);
      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when user is already referred', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(mockReferral);
      await expect(service.trackSignup(USER_ID, CODE)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for an unknown referral code', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      await expect(service.trackSignup(USER_ID, 'BADCODE')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when user uses their own code", async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      mockPrisma.referralCode.findUnique.mockResolvedValue({
        ...mockReferralCode,
        userId: USER_ID,
      });
      await expect(service.trackSignup(USER_ID, CODE)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── trackConversion ─────────────────────────────────────────────────────

  describe('trackConversion()', () => {
    beforeEach(() => {
      mockPrisma.referralRewardRule.findUnique.mockResolvedValue(mockRewardRuleRow);
    });

    it('returns null when user was not referred', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(null);
      const result = await service.trackConversion(USER_ID, ENROLLMENT_ID);
      expect(result).toBeNull();
    });

    it('returns referral without DB writes when already converted (idempotent)', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue({
        ...mockReferral,
        status: ReferralStatus.CONVERTED,
      });
      const result = await service.trackConversion(USER_ID, ENROLLMENT_ID);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(result?.status).toBe(ReferralStatus.CONVERTED);
    });

    it('converts the referral and issues a referrer reward below maxRewardsPerReferrer', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(mockReferral);
      mockPrisma.referralReward.count.mockResolvedValue(0); // below cap

      const convertedReferral = {
        ...mockReferral,
        status: ReferralStatus.CONVERTED,
        convertedAt: new Date(),
        enrollmentId: ENROLLMENT_ID,
      };

      mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({
          referral: { update: jest.fn().mockResolvedValue(convertedReferral) },
          referralCode: { update: jest.fn().mockResolvedValue(mockReferralCode) },
          referralReward: { create: jest.fn().mockResolvedValue(mockReward) },
        }),
      );

      const result = await service.trackConversion(USER_ID, ENROLLMENT_ID);
      expect(result?.status).toBe(ReferralStatus.CONVERTED);
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        REFERRER_ID,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('does not issue a referrer reward when cap is reached', async () => {
      mockPrisma.referral.findUnique.mockResolvedValue(mockReferral);
      mockPrisma.referralReward.count.mockResolvedValue(50); // at cap

      const convertedReferral = { ...mockReferral, status: ReferralStatus.CONVERTED };
      const txReferralUpdate = jest.fn().mockResolvedValue(convertedReferral);
      const txRewardCreate = jest.fn();

      mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({
          referral: { update: txReferralUpdate },
          referralCode: { update: jest.fn().mockResolvedValue(mockReferralCode) },
          referralReward: { create: txRewardCreate },
        }),
      );

      await service.trackConversion(USER_ID, ENROLLMENT_ID);
      expect(txRewardCreate).not.toHaveBeenCalled();
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    });
  });

  // ── redeemReward ────────────────────────────────────────────────────────

  describe('redeemReward()', () => {
    it('marks the reward as REDEEMED and sets redeemedAt', async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue(mockReward);
      const updated = { ...mockReward, status: ReferralRewardStatus.REDEEMED };
      mockPrisma.referralReward.update.mockResolvedValue(updated);
      const result = await service.redeemReward(USER_ID, REWARD_ID, ENROLLMENT_ID);
      expect(result.status).toBe(ReferralRewardStatus.REDEEMED);
      expect(mockPrisma.referralReward.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: REWARD_ID },
          data: expect.objectContaining({ status: ReferralRewardStatus.REDEEMED }),
        }),
      );
    });

    it('throws NotFoundException when reward does not exist', async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue(null);
      await expect(
        service.redeemReward(USER_ID, 'missing', ENROLLMENT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when reward belongs to another user", async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue({
        ...mockReward,
        beneficiaryId: 'other-user',
      });
      await expect(
        service.redeemReward(USER_ID, REWARD_ID, ENROLLMENT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when reward is not ISSUED', async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue({
        ...mockReward,
        status: ReferralRewardStatus.REDEEMED,
      });
      await expect(
        service.redeemReward(USER_ID, REWARD_ID, ENROLLMENT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('expires and throws BadRequestException for an expired reward', async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue({
        ...mockReward,
        expiresAt: new Date('2000-01-01'),
      });
      mockPrisma.referralReward.update.mockResolvedValue({
        ...mockReward,
        status: ReferralRewardStatus.EXPIRED,
      });
      await expect(
        service.redeemReward(USER_ID, REWARD_ID, ENROLLMENT_ID),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.referralReward.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ReferralRewardStatus.EXPIRED },
        }),
      );
    });
  });

  // ── previewReward ───────────────────────────────────────────────────────

  describe('previewReward()', () => {
    beforeEach(() => {
      mockPrisma.referralReward.updateMany.mockResolvedValue({ count: 0 });
    });

    it('calculates the correct discount amount and final price', async () => {
      mockPrisma.referralReward.findUnique.mockResolvedValue(mockReward); // 10%
      const preview = await service.previewReward(USER_ID, 100, REWARD_ID);
      expect(preview.valid).toBe(true);
      expect(preview.discountAmount).toBe(10);
      expect(preview.finalPrice).toBe(90);
      expect(preview.originalPrice).toBe(100);
    });

    it('throws NotFoundException when no usable reward exists and no rewardId given', async () => {
      mockPrisma.referralReward.findFirst.mockResolvedValue(null);
      await expect(service.previewReward(USER_ID, 100)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deactivateCode ──────────────────────────────────────────────────────

  describe('deactivateCode()', () => {
    it('deactivates the user referral code', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(mockReferralCode);
      mockPrisma.referralCode.update.mockResolvedValue({ ...mockReferralCode, isActive: false });
      const result = await service.deactivateCode(REFERRER_ID);
      expect(result.isActive).toBe(false);
      expect(mockPrisma.referralCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws NotFoundException when no code found', async () => {
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      await expect(service.deactivateCode(REFERRER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
