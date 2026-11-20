import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CdnController, InvalidateCacheDto } from './cdn.controller';
import { CdnService } from './cdn.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CdnController', () => {
  let controller: CdnController;

  const mockCdnService = {
    invalidateCache: jest.fn(),
    listInvalidationRequests: jest.fn(),
    getInvalidationRequest: jest.fn(),
    validateSignedUrl: jest.fn(),
    resolveWithOriginFallback: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CdnController],
      providers: [{ provide: CdnService, useValue: mockCdnService }],
    }).compile();

    controller = module.get<CdnController>(CdnController);
    jest.clearAllMocks();
  });

  it('invalidate passes the paths', async () => {
    mockCdnService.invalidateCache.mockResolvedValue({ id: 'inv-1' });

    expect(await controller.invalidate({ paths: ['/a.mp4'] })).toEqual({ id: 'inv-1' });
    expect(mockCdnService.invalidateCache).toHaveBeenCalledWith(['/a.mp4']);
  });

  it('listInvalidations delegates to service', () => {
    mockCdnService.listInvalidationRequests.mockReturnValue([]);

    expect(controller.listInvalidations()).toEqual([]);
  });

  it('getInvalidation returns the request when found', () => {
    mockCdnService.getInvalidationRequest.mockReturnValue({ id: 'inv-1' });

    expect(controller.getInvalidation('inv-1')).toEqual({ id: 'inv-1' });
    expect(mockCdnService.getInvalidationRequest).toHaveBeenCalledWith('inv-1');
  });

  it('getInvalidation throws NotFoundException when missing', () => {
    mockCdnService.getInvalidationRequest.mockReturnValue(undefined);

    expect(() => controller.getInvalidation('missing')).toThrow(NotFoundException);
  });

  it('validateSignedUrl passes the url', () => {
    mockCdnService.validateSignedUrl.mockReturnValue({ valid: true });

    expect(controller.validateSignedUrl({ url: 'https://cdn.example/x' })).toEqual({ valid: true });
    expect(mockCdnService.validateSignedUrl).toHaveBeenCalledWith('https://cdn.example/x');
  });

  it('resolve passes cdn and origin urls', async () => {
    mockCdnService.resolveWithOriginFallback.mockResolvedValue({ url: 'https://cdn.example/x' });

    await controller.resolve({ cdnUrl: 'https://cdn.example/x', originUrl: 'http://origin.example/x' });
    expect(mockCdnService.resolveWithOriginFallback).toHaveBeenCalledWith(
      'https://cdn.example/x',
      'http://origin.example/x',
    );
  });

  it('is guarded and restricted to ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CdnController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CdnController)).toEqual([UserRole.ADMIN]);
  });

  it('rejects an empty invalidation path list', async () => {
    const dto = plainToInstance(InvalidateCacheDto, { paths: [] });

    expect((await validate(dto)).map((e) => e.property)).toContain('paths');
  });
});
