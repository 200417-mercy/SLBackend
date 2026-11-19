import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CourseAutosaveController } from './course-autosave.controller';
import { CourseAutosaveService } from './course-autosave.service';
import { AutosaveCourseDto } from './dto/autosave-course.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CourseAutosaveController', () => {
  let controller: CourseAutosaveController;

  const mockService = {
    autosave: jest.fn(),
    getRecoveredDraft: jest.fn(),
    getDraftById: jest.fn(),
    discardDraft: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseAutosaveController],
      providers: [{ provide: CourseAutosaveService, useValue: mockService }],
    }).compile();

    controller = module.get<CourseAutosaveController>(CourseAutosaveController);
    jest.clearAllMocks();
  });

  it('autosave passes user id, address and dto', async () => {
    const dto = { data: { title: 'Draft' } } as AutosaveCourseDto;
    mockService.autosave.mockResolvedValue({ id: 'd1', version: 1 });

    expect(await controller.autosave('u1', 'GADDR', dto)).toEqual({ id: 'd1', version: 1 });
    expect(mockService.autosave).toHaveBeenCalledWith('u1', 'GADDR', dto);
  });

  it('getRecoveredDraft passes the optional courseId', async () => {
    mockService.getRecoveredDraft.mockResolvedValue(null);

    expect(await controller.getRecoveredDraft('u1')).toBeNull();
    expect(mockService.getRecoveredDraft).toHaveBeenCalledWith('u1', undefined);

    await controller.getRecoveredDraft('u1', 'c1');
    expect(mockService.getRecoveredDraft).toHaveBeenCalledWith('u1', 'c1');
  });

  it('getDraftById passes draft id then user id', async () => {
    mockService.getDraftById.mockResolvedValue({ id: 'd1' });

    expect(await controller.getDraftById('d1', 'u1')).toEqual({ id: 'd1' });
    expect(mockService.getDraftById).toHaveBeenCalledWith('d1', 'u1');
  });

  it('discardDraft passes draft id then user id', async () => {
    mockService.discardDraft.mockResolvedValue({ deleted: true });

    expect(await controller.discardDraft('d1', 'u1')).toEqual({ deleted: true });
    expect(mockService.discardDraft).toHaveBeenCalledWith('d1', 'u1');
  });

  it('is guarded and restricted to INSTRUCTOR and ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CourseAutosaveController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CourseAutosaveController)).toEqual([UserRole.INSTRUCTOR, UserRole.ADMIN]);
  });

  it('rejects an autosave body without data or with version below 1', async () => {
    const dto = plainToInstance(AutosaveCourseDto, { title: 'x', version: 0 });
    const props = (await validate(dto)).map((e) => e.property);

    expect(props).toEqual(expect.arrayContaining(['data', 'version']));
  });
});
