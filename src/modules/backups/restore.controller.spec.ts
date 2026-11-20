import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RestoreController } from './restore.controller';
import { RestoreService } from './restore.service';
import { RestoreCoursesDto } from './dto/restore-course.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('RestoreController', () => {
  let controller: RestoreController;

  const mockRestoreService = {
    requestRestore: jest.fn(),
    listJobs: jest.fn(),
    getStatus: jest.fn(),
    executeJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestoreController],
      providers: [{ provide: RestoreService, useValue: mockRestoreService }],
    }).compile();

    controller = module.get<RestoreController>(RestoreController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('restore', () => {
    it('requests a restore on behalf of the admin', async () => {
      const dto = { courses: [{} as any], overwriteExisting: false } as RestoreCoursesDto;
      mockRestoreService.requestRestore.mockResolvedValue({ id: 'job-1', status: 'PENDING' });

      const res = await controller.restore('admin-1', dto);

      expect(mockRestoreService.requestRestore).toHaveBeenCalledWith('admin-1', dto);
      expect(res).toEqual({ id: 'job-1', status: 'PENDING' });
    });

    it('rejects an empty courses array', async () => {
      const dto = plainToInstance(RestoreCoursesDto, { courses: [] });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('courses');
    });
  });

  describe('listJobs', () => {
    it('passes pagination through', async () => {
      mockRestoreService.listJobs.mockResolvedValue({ data: [] });

      await controller.listJobs({ page: 3, limit: 10 });

      expect(mockRestoreService.listJobs).toHaveBeenCalledWith(3, 10);
    });

    it('defaults to page 1 and limit 20', async () => {
      mockRestoreService.listJobs.mockResolvedValue({ data: [] });

      await controller.listJobs({});

      expect(mockRestoreService.listJobs).toHaveBeenCalledWith(1, 20);
    });
  });

  describe('getStatus', () => {
    it('returns the job status', async () => {
      mockRestoreService.getStatus.mockResolvedValue({ id: 'job-1', progress: 50 });

      await expect(controller.getStatus('job-1')).resolves.toEqual({ id: 'job-1', progress: 50 });
      expect(mockRestoreService.getStatus).toHaveBeenCalledWith('job-1');
    });

    it('propagates NotFoundException for an unknown job', async () => {
      mockRestoreService.getStatus.mockRejectedValue(new NotFoundException());

      await expect(controller.getStatus('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('runJob', () => {
    it('executes the job', async () => {
      mockRestoreService.executeJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

      const res = await controller.runJob('job-1');

      expect(mockRestoreService.executeJob).toHaveBeenCalledWith('job-1');
      expect(res).toEqual({ id: 'job-1', status: 'COMPLETED' });
    });
  });

  describe('access control', () => {
    it('requires JWT auth and the ADMIN role on the controller', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, RestoreController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, RestoreController)).toEqual([UserRole.ADMIN]);
    });

    it.each([UserRole.STUDENT, UserRole.INSTRUCTOR])('RolesGuard rejects %s', (role) => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => RestoreController.prototype.runJob,
        getClass: () => RestoreController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
