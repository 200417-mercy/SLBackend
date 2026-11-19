import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EnrollmentRestoreController } from './enrollment-restore.controller';
import { EnrollmentRestoreService } from './enrollment-restore.service';
import { RestoreEnrollmentsDto } from './dto/restore-enrollments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('EnrollmentRestoreController', () => {
  let controller: EnrollmentRestoreController;

  const mockEnrollmentRestoreService = {
    restore: jest.fn(),
    listReports: jest.fn(),
    getReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentRestoreController],
      providers: [{ provide: EnrollmentRestoreService, useValue: mockEnrollmentRestoreService }],
    }).compile();

    controller = module.get<EnrollmentRestoreController>(EnrollmentRestoreController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('restore', () => {
    it('restores enrollments on behalf of the admin', async () => {
      const dto = { enrollments: [{} as any] } as RestoreEnrollmentsDto;
      const result = { id: 'report-1', restored: 1, failed: [] };
      mockEnrollmentRestoreService.restore.mockResolvedValue(result);

      const res = await controller.restore('admin-1', dto);

      expect(mockEnrollmentRestoreService.restore).toHaveBeenCalledWith('admin-1', dto);
      expect(res).toEqual(result);
    });

    it('rejects an empty enrollments array and an unknown conflict strategy', async () => {
      const dto = plainToInstance(RestoreEnrollmentsDto, {
        enrollments: [],
        conflictStrategy: 'DELETE_ALL',
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual(
        expect.arrayContaining(['enrollments', 'conflictStrategy']),
      );
    });
  });

  describe('listReports', () => {
    it('returns all reports', () => {
      mockEnrollmentRestoreService.listReports.mockReturnValue([{ id: 'report-1' }]);

      expect(controller.listReports()).toEqual([{ id: 'report-1' }]);
    });
  });

  describe('getReport', () => {
    it('returns the report when it exists', () => {
      mockEnrollmentRestoreService.getReport.mockReturnValue({ id: 'report-1' });

      expect(controller.getReport('report-1')).toEqual({ id: 'report-1' });
      expect(mockEnrollmentRestoreService.getReport).toHaveBeenCalledWith('report-1');
    });

    it('throws NotFoundException when the report is missing', () => {
      mockEnrollmentRestoreService.getReport.mockReturnValue(undefined);

      expect(() => controller.getReport('missing')).toThrow(NotFoundException);
    });
  });

  describe('access control', () => {
    it('requires JWT auth and the ADMIN role on the controller', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, EnrollmentRestoreController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, EnrollmentRestoreController)).toEqual([UserRole.ADMIN]);
    });

    it.each([UserRole.STUDENT, UserRole.INSTRUCTOR])('RolesGuard rejects %s', (role) => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => EnrollmentRestoreController.prototype.restore,
        getClass: () => EnrollmentRestoreController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
