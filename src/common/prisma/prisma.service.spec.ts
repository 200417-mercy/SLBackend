import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

const mockConfiguredDatabaseUrl = 'postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30';

describe('PrismaService (Issue #405) - Unit Tests for Prisma Configuration', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  describe('PrismaService.configuredDatabaseUrl', () => {
    it('should configure database URL with connection_limit when not present', () => {
      const result = PrismaService.configuredDatabaseUrl(
        'postgresql://user:pass@host:5432/db'
      );
      expect(result).toBeDefined();
      expect(result).toContain('connection_limit=20');
    });

    it('should configure database URL with pool_timeout when not present', () => {
      const result = PrismaService.configuredDatabaseUrl(
        'postgresql://user:pass@host:5432/db?connection_limit=20'
      );
      expect(result).toBeDefined();
      expect(result).toContain('pool_timeout=30');
    });

    it('should return undefined when no database URL provided', () => {
      const result = PrismaService.configuredDatabaseUrl(undefined);
      expect(result).toBeUndefined();
    });

    it('should not override existing connection_limit in URL', () => {
      const result = PrismaService.configuredDatabaseUrl(
        'postgresql://user:pass@host:5432/db?connection_limit=50'
      );
      expect(result).toBeDefined();
      expect(result).toContain('connection_limit=50');
    });
  });

  describe('PrismaService onModuleInit', () => {
    it('should connect to database on module init', async () => {
      const connectSpy = jest.spyOn(service, '$connect');
      await service.onModuleInit();
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe('PrismaService onModuleDestroy', () => {
    it('should disconnect from database on module destroy', async () => {
      const disconnectSpy = jest.spyOn(service, '$disconnect');
      await service.onModuleDestroy();
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});