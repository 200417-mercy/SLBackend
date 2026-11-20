import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('TagsController', () => {
  let controller: TagsController;
  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findByCourse: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    merge: jest.fn(),
    attachToCourse: jest.fn(),
    detachFromCourse: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [{ provide: TagsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(TagsController);
  });

  it('create passes adminId and dto', () => {
    const dto = { label: 'Welding' } as any;
    const tag = { id: 't1', label: 'Welding', slug: 'welding' };
    mockService.create.mockReturnValue(tag);

    expect(controller.create('admin-1', dto)).toBe(tag);
    expect(mockService.create).toHaveBeenCalledWith('admin-1', dto);
  });

  it('findAll passes the query through', () => {
    const query = { search: 'weld', page: 1, limit: 20 } as any;
    controller.findAll(query);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });

  it('findByCourse and findOne delegate with their ids', () => {
    controller.findByCourse('course-1');
    controller.findOne('t1');
    expect(mockService.findByCourse).toHaveBeenCalledWith('course-1');
    expect(mockService.findOne).toHaveBeenCalledWith('t1');
  });

  it('update and remove pass the id and adminId', () => {
    const dto = { label: 'Plumbing' } as any;
    controller.update('t1', 'admin-1', dto);
    controller.remove('t1', 'admin-1');
    expect(mockService.update).toHaveBeenCalledWith('t1', 'admin-1', dto);
    expect(mockService.remove).toHaveBeenCalledWith('t1', 'admin-1');
  });

  it('merge, attach and detach delegate with the right arguments', () => {
    const mergeDto = { sourceTagIds: ['t2'] } as any;
    const attachDto = { courseId: 'course-1' } as any;
    controller.merge('t1', 'admin-1', mergeDto);
    controller.attachToCourse('t1', 'admin-1', attachDto);
    controller.detachFromCourse('t1', 'course-1', 'admin-1');
    expect(mockService.merge).toHaveBeenCalledWith('t1', 'admin-1', mergeDto);
    expect(mockService.attachToCourse).toHaveBeenCalledWith('t1', 'admin-1', attachDto);
    expect(mockService.detachFromCourse).toHaveBeenCalledWith('t1', 'course-1', 'admin-1');
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, TagsController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    });

    it('limits write routes to ADMIN', () => {
      const writeRoutes = ['create', 'update', 'remove', 'merge', 'attachToCourse', 'detachFromCourse'];
      for (const method of writeRoutes) {
        const handler = (TagsController.prototype as any)[method];
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
      }
    });

    it('RolesGuard rejects a student creating a tag', () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => TagsController.prototype.create,
        getClass: () => TagsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.STUDENT } }) }),
      } as any;

      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
