import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { QueryTagsDto } from './dto/query-tags.dto';

describe('TagsService', () => {
  let service: TagsService;

  const mockPrisma = {
    tag: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    courseTag: {
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn(mockPrisma)),
  };

  const mockAuditLog = {
    createEntry: jest.fn(),
  };

  const baseTag = {
    id: 'tag-1',
    name: 'web-design',
    label: 'Web Design',
    usageCount: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<TagsService>(TagsService);
    jest.clearAllMocks();
    mockAuditLog.createEntry.mockResolvedValue({});
  });

  describe('create()', () => {
    it('creates a new tag with normalised slug', async () => {
      const dto: CreateTagDto = { label: 'Web Design' };
      mockPrisma.tag.findUnique.mockResolvedValue(null);
      mockPrisma.tag.create.mockResolvedValue(baseTag);

      await expect(service.create('admin-1', dto)).resolves.toEqual(baseTag);
      expect(mockPrisma.tag.create).toHaveBeenCalledWith({
        data: { name: 'web-design', label: 'Web Design' },
      });
      expect(mockAuditLog.createEntry).toHaveBeenCalledWith('admin-1', {
        action: AuditAction.TAG_CREATED,
        targetType: AuditTargetType.TAG,
        targetId: 'tag-1',
        metadata: { name: 'web-design', label: 'Web Design' },
      });
    });

    it('throws ConflictException if tag with same normalised name exists', async () => {
      const dto: CreateTagDto = { label: 'Web Design' };
      mockPrisma.tag.findUnique.mockResolvedValue(baseTag);

      await expect(service.create('admin-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.tag.create).not.toHaveBeenCalled();
    });

    it('normalises labels with special characters', async () => {
      const dto: CreateTagDto = { label: 'UI/UX & Branding' };
      const created = { ...baseTag, name: 'ui-ux-branding', label: 'UI/UX & Branding' };
      mockPrisma.tag.findUnique.mockResolvedValue(null);
      mockPrisma.tag.create.mockResolvedValue(created);

      await service.create('admin-1', dto);
      expect(mockPrisma.tag.create).toHaveBeenCalledWith({
        data: { name: 'ui-ux-branding', label: 'UI/UX & Branding' },
      });
    });
  });

  describe('findAll()', () => {
    it('returns paginated tags sorted by usage count', async () => {
      const tags = [baseTag, { ...baseTag, id: 'tag-2', usageCount: 3 }];
      mockPrisma.tag.findMany.mockResolvedValue(tags);
      mockPrisma.tag.count.mockResolvedValue(2);

      const query: QueryTagsDto = { page: 1, limit: 20 };
      const result = await service.findAll(query);

      expect(result.data).toEqual(tags);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(mockPrisma.tag.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ usageCount: 'desc' }, { label: 'asc' }],
        skip: 0,
        take: 20,
        include: { _count: { select: { courses: true } } },
      });
    });

    it('filters tags by search term', async () => {
      mockPrisma.tag.findMany.mockResolvedValue([baseTag]);
      mockPrisma.tag.count.mockResolvedValue(1);

      await service.findAll({ search: 'design' });

      expect(mockPrisma.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { label: { contains: 'design', mode: 'insensitive' } },
        }),
      );
    });

    it('handles pagination correctly', async () => {
      mockPrisma.tag.findMany.mockResolvedValue([]);
      mockPrisma.tag.count.mockResolvedValue(50);

      await service.findAll({ page: 3, limit: 10 });

      expect(mockPrisma.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  describe('findOne()', () => {
    it('returns the tag with course count and relations', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue({
        ...baseTag,
        _count: { courses: 5 },
        courses: [],
      });

      await expect(service.findOne('tag-1')).resolves.toMatchObject({
        id: 'tag-1',
        name: 'web-design',
      });
      expect(mockPrisma.tag.findUnique).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        include: expect.objectContaining({
          _count: { select: { courses: true } },
        }),
      });
    });

    it('throws NotFoundException when tag does not exist', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update()', () => {
    it('updates tag label and audit logs the change', async () => {
      const dto: UpdateTagDto = { label: 'Web Development' };
      const updated = { ...baseTag, label: 'Web Development', name: 'web-development' };
      mockPrisma.tag.findUnique.mockResolvedValueOnce(baseTag).mockResolvedValueOnce(null);
      mockPrisma.tag.update.mockResolvedValue(updated);

      await expect(service.update('tag-1', 'admin-1', dto)).resolves.toEqual(updated);
      expect(mockPrisma.tag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { label: 'Web Development', name: 'web-development' },
      });
      expect(mockAuditLog.createEntry).toHaveBeenCalled();
    });

    it('throws NotFoundException if tag does not exist', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', 'admin-1', { label: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if new name conflicts with existing tag', async () => {
      const existing = { ...baseTag, id: 'tag-2' };
      mockPrisma.tag.findUnique.mockResolvedValueOnce(baseTag).mockResolvedValueOnce(existing);

      await expect(
        service.update('tag-1', 'admin-1', { label: 'Web Design' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove()', () => {
    it('deletes tag and audit logs the action', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(baseTag);
      mockPrisma.tag.delete.mockResolvedValue(baseTag);

      await expect(service.remove('tag-1', 'admin-1')).resolves.toEqual({
        message: 'Tag deleted',
      });
      expect(mockPrisma.tag.delete).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
      });
      expect(mockAuditLog.createEntry).toHaveBeenCalledWith('admin-1', {
        action: AuditAction.TAG_DELETED,
        targetType: AuditTargetType.TAG,
        targetId: 'tag-1',
        metadata: expect.any(Object),
      });
    });

    it('throws NotFoundException if tag does not exist', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('attachToCourse()', () => {
    it('attaches tag to course and increments usage count', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(baseTag);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      mockPrisma.courseTag.findFirst.mockResolvedValue(null);
      mockPrisma.courseTag.create.mockResolvedValue({});
      mockPrisma.tag.update.mockResolvedValue({ ...baseTag, usageCount: 6 });

      await service.attachToCourse('tag-1', 'admin-1', { courseId: 'course-1' });

      expect(mockPrisma.courseTag.create).toHaveBeenCalledWith({
        data: { courseId: 'course-1', tagId: 'tag-1' },
      });
      expect(mockPrisma.tag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { usageCount: { increment: 1 } },
      });
    });

    it('throws ConflictException if tag already attached', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(baseTag);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      mockPrisma.courseTag.findFirst.mockResolvedValue({ courseId: 'course-1', tagId: 'tag-1' });

      await expect(
        service.attachToCourse('tag-1', 'admin-1', { courseId: 'course-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('detachFromCourse()', () => {
    it('detaches tag from course and decrements usage count', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(baseTag);
      mockPrisma.courseTag.delete.mockResolvedValue({});
      mockPrisma.tag.update.mockResolvedValue({ ...baseTag, usageCount: 4 });

      await service.detachFromCourse('tag-1', 'course-1', 'admin-1');

      expect(mockPrisma.courseTag.delete).toHaveBeenCalledWith({
        where: { courseId_tagId: { courseId: 'course-1', tagId: 'tag-1' } },
      });
      expect(mockPrisma.tag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { usageCount: { decrement: 1 } },
      });
    });
  });

  describe('findByCourse()', () => {
    it('returns all tags attached to a course', async () => {
      const courseTags = [
        { tag: baseTag },
        { tag: { ...baseTag, id: 'tag-2', label: 'JavaScript' } },
      ];
      mockPrisma.courseTag.findMany.mockResolvedValue(courseTags);

      const result = await service.findByCourse('course-1');

      expect(result).toEqual([baseTag, courseTags[1].tag]);
      expect(mockPrisma.courseTag.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        include: { tag: true },
        orderBy: { tag: { label: 'asc' } },
      });
    });
  });
});
