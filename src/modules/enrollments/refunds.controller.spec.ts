import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefundStatus, UserRole } from '@prisma/client';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('RefundsController', () => {
  let controller: RefundsController;
  const mockRefundsService = {
    create: jest.fn(),
    findByStudent: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    process: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [{ provide: RefundsService, useValue: mockRefundsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RefundsController);
  });

  it('create delegates with the student id and dto', () => {
    const dto = { enrollmentId: 'enr-1', reason: 'cancelled' } as CreateRefundDto;
    const refund = { id: 'ref-1', status: RefundStatus.PENDING };
    mockRefundsService.create.mockReturnValue(refund);

    expect(controller.create('stu-1', dto)).toBe(refund);
    expect(mockRefundsService.create).toHaveBeenCalledWith('stu-1', dto);
  });

  it('findMy passes page and limit', () => {
    mockRefundsService.findByStudent.mockReturnValue({ data: [], total: 0 });
    controller.findMy('stu-1', { page: 2, limit: 5 } as any);
    expect(mockRefundsService.findByStudent).toHaveBeenCalledWith('stu-1', 2, 5);
  });

  it('findOne passes id, user id and role', () => {
    controller.findOne('ref-1', 'u-1', UserRole.STUDENT);
    expect(mockRefundsService.findOne).toHaveBeenCalledWith('ref-1', 'u-1', UserRole.STUDENT);
  });

  it('findAll maps the query to service options', () => {
    controller.findAll({ status: RefundStatus.PENDING, page: 1, limit: 10 } as any);
    expect(mockRefundsService.findAll).toHaveBeenCalledWith({
      status: RefundStatus.PENDING,
      page: 1,
      limit: 10,
    });
  });

  it.each(['approve', 'reject', 'process'] as const)('%s delegates with id, admin id and dto', (method) => {
    const dto = { note: 'x' } as any;
    const result = { id: 'ref-1' };
    mockRefundsService[method].mockReturnValue(result);

    expect((controller as any)[method]('ref-1', 'admin-1', dto)).toBe(result);
    expect(mockRefundsService[method]).toHaveBeenCalledWith('ref-1', 'admin-1', dto);
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, RefundsController)).toEqual([JwtAuthGuard]);
    });

    it.each(['findAll', 'approve', 'reject', 'process'])('%s is restricted to ADMIN', (method) => {
      const handler = RefundsController.prototype[method as keyof RefundsController];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });

    it('RolesGuard rejects a student calling approve', () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => RefundsController.prototype.approve,
        getClass: () => RefundsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.STUDENT } }) }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  it('rejects a create payload without enrollmentId or reason', async () => {
    const errors = await validate(plainToInstance(CreateRefundDto, { enrollmentId: '', reason: '' }));
    expect(errors.map((e) => e.property).sort()).toEqual(['enrollmentId', 'reason']);
  });
});
