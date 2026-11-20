jest.mock('speakeasy', () => ({
  generateSecret: jest.fn(),
  totp: { verify: jest.fn() },
}));
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
}));

import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import * as qrcode from 'qrcode';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TwoFactorService } from './two-factor.service';

const mockGenerateSecret = speakeasy.generateSecret as jest.Mock;
const mockVerifyTotp = speakeasy.totp.verify as jest.Mock;
const mockToDataURL = qrcode.toDataURL as jest.Mock;

const hashRecoveryCode = (code: string) =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfig = {
    get: jest.fn((key: string, defaultValue?: string) => defaultValue),
  };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    stellarAddress: 'GABC123',
    twoFactorEnabled: false,
    twoFactorEnabledAt: null,
    twoFactorSecret: null,
    twoFactorRecoveryCodes: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
    mockToDataURL.mockResolvedValue('data:image/png;base64,qr');
  });

  describe('generateSecret()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.generateSecret('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects users that already enabled 2FA', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorEnabled: true,
      });

      await expect(service.generateSecret('user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockGenerateSecret).not.toHaveBeenCalled();
    });

    it('stores the secret and returns the QR enrollment payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockGenerateSecret.mockReturnValue({
        base32: 'BASE32SECRET',
        otpauth_url: 'otpauth://totp/SorobanLard:user@example.com',
      });

      const result = await service.generateSecret('user-1');

      expect(mockGenerateSecret).toHaveBeenCalledWith({
        length: 20,
        name: 'SorobanLard (user@example.com)',
        issuer: 'SorobanLard',
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { twoFactorSecret: 'BASE32SECRET' },
      });
      expect(mockToDataURL).toHaveBeenCalledWith(
        'otpauth://totp/SorobanLard:user@example.com',
      );
      expect(result).toEqual({
        secret: 'BASE32SECRET',
        otpauthUrl: 'otpauth://totp/SorobanLard:user@example.com',
        qrCodeDataUrl: 'data:image/png;base64,qr',
      });
    });

    it('falls back to the stellar address when no email is present', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        email: null,
      });
      mockGenerateSecret.mockReturnValue({
        base32: 'BASE32SECRET',
        otpauth_url: 'otpauth://totp/test',
      });

      await service.generateSecret('user-1');

      expect(mockGenerateSecret).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SorobanLard (GABC123)' }),
      );
    });
  });

  describe('enable()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.enable('missing', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('requires a generated secret first', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.enable('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects enabling twice', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'BASE32SECRET',
      });

      await expect(service.enable('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid TOTP code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
      });
      mockVerifyTotp.mockReturnValue(false);

      await expect(service.enable('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('enables 2FA and returns ten hashed recovery codes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
      });
      mockVerifyTotp.mockReturnValue(true);

      const result = await service.enable('user-1', '123456');

      expect(mockVerifyTotp).toHaveBeenCalledWith({
        secret: 'BASE32SECRET',
        encoding: 'base32',
        token: '123456',
        window: 1,
      });
      expect(result.enabled).toBe(true);
      expect(result.recoveryCodes).toHaveLength(10);
      result.recoveryCodes.forEach((code) => {
        expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
      });

      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData.twoFactorEnabled).toBe(true);
      expect(updateData.twoFactorEnabledAt).toEqual(expect.any(Date));
      expect(updateData.twoFactorRecoveryCodes).toHaveLength(10);
      updateData.twoFactorRecoveryCodes.forEach((hashed, index) => {
        expect(hashed).toBe(hashRecoveryCode(result.recoveryCodes[index]));
        expect(hashed).not.toBe(result.recoveryCodes[index]);
      });
    });
  });

  describe('disable()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.disable('missing', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects users that do not have 2FA enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.disable('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'BASE32SECRET',
      });
      mockVerifyTotp.mockReturnValue(false);

      await expect(service.disable('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('disables 2FA and clears secrets after a valid TOTP code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'BASE32SECRET',
      });
      mockVerifyTotp.mockReturnValue(true);

      await expect(service.disable('user-1', '123456')).resolves.toEqual({
        enabled: false,
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          twoFactorEnabled: false,
          twoFactorEnabledAt: null,
          twoFactorSecret: null,
          twoFactorRecoveryCodes: [],
        },
      });
    });
  });

  describe('getStatus()', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getStatus('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the enabled state', async () => {
      const enabledAt = new Date();
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorEnabledAt: enabledAt,
      });

      await expect(service.getStatus('user-1')).resolves.toEqual({
        enabled: true,
        enabledAt,
      });
    });
  });

  describe('verifyLoginCode()', () => {
    it('returns false when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyLoginCode('missing', '123456')).resolves.toBe(
        false,
      );
    });

    it('returns false when the user has no secret', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.verifyLoginCode('user-1', '123456')).resolves.toBe(
        false,
      );
    });

    it('accepts a valid TOTP code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
      });
      mockVerifyTotp.mockReturnValue(true);

      await expect(service.verifyLoginCode('user-1', '123456')).resolves.toBe(
        true,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('returns false for an unknown code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
        twoFactorRecoveryCodes: [hashRecoveryCode('AAAAA-BBBBB')],
      });
      mockVerifyTotp.mockReturnValue(false);

      await expect(service.verifyLoginCode('user-1', 'WRONG-CODE')).resolves.toBe(
        false,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('consumes a valid single-use recovery code', async () => {
      const recovery = 'ABCDE-12345';
      const otherRecovery = 'FGHIJ-67890';
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
        twoFactorRecoveryCodes: [
          hashRecoveryCode(recovery),
          hashRecoveryCode(otherRecovery),
        ],
      });
      mockVerifyTotp.mockReturnValue(false);

      await expect(service.verifyLoginCode('user-1', recovery)).resolves.toBe(
        true,
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          twoFactorRecoveryCodes: [hashRecoveryCode(otherRecovery)],
        },
      });
    });

    it('normalizes case and whitespace before hashing recovery codes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        twoFactorSecret: 'BASE32SECRET',
        twoFactorRecoveryCodes: [hashRecoveryCode('ABCDE-12345')],
      });
      mockVerifyTotp.mockReturnValue(false);

      await expect(
        service.verifyLoginCode('user-1', ' abcde-12345 '),
      ).resolves.toBe(true);
    });
  });
});
