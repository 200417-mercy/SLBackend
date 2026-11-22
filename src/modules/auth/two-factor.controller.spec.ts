import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RoleThrottlerGuard } from '../../common/guards/role-throttler.guard';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';

describe('TwoFactorController', () => {
  let controller: TwoFactorController;
  const twoFactorService = {
    generateSecret: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    getStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorController],
      providers: [{ provide: TwoFactorService, useValue: twoFactorService }],
    })
      .overrideGuard(RoleThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(TwoFactorController);
  });

  it('returns setup data for the current user', async () => {
    const setup = {
      secret: 'secret',
      otpauthUrl: 'otpauth://',
      qrCodeDataUrl: 'data:image/png',
    };
    twoFactorService.generateSecret.mockResolvedValue(setup);

    await expect(controller.setup('user-1')).resolves.toBe(setup);
    expect(twoFactorService.generateSecret).toHaveBeenCalledWith('user-1');
  });

  it('enables 2FA with the submitted code and returns recovery codes', async () => {
    const result = { enabled: true, recoveryCodes: ['ABCDE-FGHIJ'] };
    twoFactorService.enable.mockResolvedValue(result);

    await expect(controller.enable('user-1', { code: '123456' })).resolves.toBe(
      result,
    );
    expect(twoFactorService.enable).toHaveBeenCalledWith('user-1', '123456');
  });

  it('passes an invalid code rejection through when enabling 2FA', async () => {
    twoFactorService.enable.mockRejectedValue(
      new UnauthorizedException('Invalid code'),
    );

    await expect(
      controller.enable('user-1', { code: '000000' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('disables 2FA after the submitted verification code', async () => {
    const result = { enabled: false };
    twoFactorService.disable.mockResolvedValue(result);

    await expect(
      controller.disable('user-1', { code: '123456' }),
    ).resolves.toBe(result);
    expect(twoFactorService.disable).toHaveBeenCalledWith('user-1', '123456');
  });

  it('returns status data for the current user', async () => {
    const status = { enabled: true, enabledAt: new Date('2026-01-01') };
    twoFactorService.getStatus.mockResolvedValue(status);

    await expect(controller.status('user-1')).resolves.toBe(status);
    expect(twoFactorService.getStatus).toHaveBeenCalledWith('user-1');
  });

  it('forbids a student role from the controller route', () => {
    const guard = new RolesGuard(new Reflector());
    const handler = controller.setup;
    const context = {
      getHandler: () => handler,
      getClass: () => TwoFactorController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: UserRole.STUDENT } }),
      }),
    } as any;

    expect(guard.canActivate(context)).toBe(false);
  });
});
