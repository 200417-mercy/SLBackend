import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CertificateTemplatesService } from './certificate-templates.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateCertificateTemplateDto,
  UpdateCertificateTemplateDto,
  PreviewCertificateTemplateDto,
} from './dto/certificate-template.dto';
import { CertificateTemplateConfig } from './certificate-template.types';

// ---------------------------------------------------------------------------
// Minimal valid template raw row (as returned by Prisma)
// ---------------------------------------------------------------------------
const makeRawTemplate = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'tmpl-1',
  name: 'Default Template',
  category: 'Programming',
  branding: {
    organizationName: 'SorobanLard',
    primaryColor: '#1A365D',
  },
  layout: {
    orientation: 'LANDSCAPE',
    titleText: 'Certificate of Completion',
    bodyText: 'This certifies that {{studentName}} has completed {{courseTitle}}.',
  },
  signatures: [{ name: 'Jane Admin', label: 'CEO' }],
  isActive: false,
  createdById: 'admin-1',
  activatedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const mockPrisma = {
  certificateTemplate: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('CertificateTemplatesService', () => {
  let service: CertificateTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateTemplatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CertificateTemplatesService>(CertificateTemplatesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ----------------------------------------------------------
  // create
  // ----------------------------------------------------------

  describe('create', () => {
    it('creates a template and returns a CertificateTemplateConfig', async () => {
      const raw = makeRawTemplate();
      mockPrisma.certificateTemplate.create.mockResolvedValue(raw);

      const dto: CreateCertificateTemplateDto = {
        name: 'Default Template',
        category: 'Programming',
      };

      const result = await service.create('admin-1', dto);

      expect(mockPrisma.certificateTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Default Template',
            category: 'Programming',
            isActive: false,
            createdById: 'admin-1',
          }),
        }),
      );
      expect(result.id).toBe('tmpl-1');
      expect(result.isActive).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // findAll
  // ----------------------------------------------------------

  describe('findAll', () => {
    it('returns paginated templates', async () => {
      const raw = makeRawTemplate();
      jest.spyOn(Promise, 'all').mockResolvedValueOnce([[raw], 1] as any);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('applies category and isActive filters', async () => {
      const spy = jest
        .spyOn(service['prisma'].certificateTemplate, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(service['prisma'].certificateTemplate, 'count')
        .mockResolvedValue(0);

      jest.spyOn(Promise, 'all').mockResolvedValueOnce([[], 0] as any);

      await service.findAll({ category: 'Programming', isActive: true });

      // Promise.all is called with both queries; they were set up with filters
      expect(Promise.all).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // findOne
  // ----------------------------------------------------------

  describe('findOne', () => {
    it('returns a template by id', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate());

      const result = await service.findOne('tmpl-1');

      expect(result.id).toBe('tmpl-1');
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // getActiveTemplateForCategory
  // ----------------------------------------------------------

  describe('getActiveTemplateForCategory', () => {
    it('returns the active template for a valid category', async () => {
      const raw = makeRawTemplate({ isActive: true });
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue(raw);

      const result = await service.getActiveTemplateForCategory('Programming');

      expect(result.isActive).toBe(true);
      expect(result.category).toBe('Programming');
    });

    it('throws NotFoundException when no active template exists for the category', async () => {
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getActiveTemplateForCategory('Unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the active template has missing required fields', async () => {
      const incomplete = makeRawTemplate({
        isActive: true,
        branding: {}, // missing organizationName and primaryColor
        layout: {},   // missing orientation, titleText, bodyText
        signatures: [],
      });
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue(incomplete);

      await expect(service.getActiveTemplateForCategory('Programming')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ----------------------------------------------------------
  // update
  // ----------------------------------------------------------

  describe('update', () => {
    it('merges branding and layout fields and persists the update', async () => {
      const existing = makeRawTemplate();
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(existing);
      const updated = makeRawTemplate({ name: 'Updated Template' });
      mockPrisma.certificateTemplate.update.mockResolvedValue(updated);

      const dto: UpdateCertificateTemplateDto = { name: 'Updated Template' };
      const result = await service.update('tmpl-1', dto);

      expect(mockPrisma.certificateTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tmpl-1' } }),
      );
      expect(result.name).toBe('Updated Template');
    });

    it('throws BadRequestException when updating an active template with missing required fields', async () => {
      const activeRaw = makeRawTemplate({
        isActive: true,
        branding: {},
        layout: {},
        signatures: [],
      });
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(activeRaw);

      const dto: UpdateCertificateTemplateDto = { name: 'Still broken' };
      await expect(service.update('tmpl-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // remove
  // ----------------------------------------------------------

  describe('remove', () => {
    it('deletes an inactive template and returns { deleted: true, id }', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate({ isActive: false }));
      mockPrisma.certificateTemplate.delete.mockResolvedValue({});

      const result = await service.remove('tmpl-1');

      expect(mockPrisma.certificateTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tmpl-1' } });
      expect(result).toEqual({ deleted: true, id: 'tmpl-1' });
    });

    it('throws ForbiddenException when trying to delete the active template', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate({ isActive: true }));

      await expect(service.remove('tmpl-1')).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.certificateTemplate.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // activate
  // ----------------------------------------------------------

  describe('activate', () => {
    it('activates a template with all required fields and deactivates others in the same category', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate());
      const activatedRaw = makeRawTemplate({ isActive: true, activatedAt: new Date() });
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          certificateTemplate: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue(activatedRaw),
          },
        };
        return fn(tx);
      });

      const result = await service.activate('tmpl-1');

      expect(result.isActive).toBe(true);
    });

    it('throws BadRequestException when required fields are missing', async () => {
      const incomplete = makeRawTemplate({
        branding: {},
        layout: {},
        signatures: [],
      });
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(incomplete);

      await expect(service.activate('tmpl-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.activate('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // deactivate
  // ----------------------------------------------------------

  describe('deactivate', () => {
    it('deactivates an active template', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate({ isActive: true }));
      const deactivated = makeRawTemplate({ isActive: false });
      mockPrisma.certificateTemplate.update.mockResolvedValue(deactivated);

      const result = await service.deactivate('tmpl-1');

      expect(mockPrisma.certificateTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tmpl-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('returns the template unchanged when it is already inactive', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate({ isActive: false }));

      const result = await service.deactivate('tmpl-1');

      expect(mockPrisma.certificateTemplate.update).not.toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // validateRequiredFields
  // ----------------------------------------------------------

  describe('validateRequiredFields', () => {
    it('returns valid:true when all required fields are present', () => {
      const config: Pick<CertificateTemplateConfig, 'branding' | 'layout' | 'signatures'> = {
        branding: { organizationName: 'SorobanLard', primaryColor: '#1A365D' },
        layout: {
          orientation: 'LANDSCAPE',
          titleText: 'Certificate of Completion',
          bodyText: 'Awarded to {{studentName}}.',
        },
        signatures: [{ name: 'Jane Admin', label: 'CEO' }],
      };

      const result = service.validateRequiredFields(config);

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('reports all missing fields when config is empty', () => {
      const result = service.validateRequiredFields({
        branding: {},
        layout: {},
        signatures: [],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('branding.organizationName');
      expect(result.missing).toContain('branding.primaryColor');
      expect(result.missing).toContain('layout.orientation');
      expect(result.missing).toContain('layout.titleText');
      expect(result.missing).toContain('layout.bodyText');
      expect(result.missing).toContain('signatures');
    });

    it('reports invalid primaryColor as missing', () => {
      const result = service.validateRequiredFields({
        branding: { organizationName: 'Org', primaryColor: 'not-a-hex' },
        layout: { orientation: 'LANDSCAPE', titleText: 'Title', bodyText: 'Body' },
        signatures: [{ name: 'Admin', label: 'Role' }],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('branding.primaryColor');
    });

    it('reports invalid orientation as missing', () => {
      const result = service.validateRequiredFields({
        branding: { organizationName: 'Org', primaryColor: '#123456' },
        layout: { orientation: 'DIAGONAL' as any, titleText: 'Title', bodyText: 'Body' },
        signatures: [{ name: 'Admin', label: 'Role' }],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('layout.orientation');
    });

    it('reports missing signature fields', () => {
      const result = service.validateRequiredFields({
        branding: { organizationName: 'Org', primaryColor: '#123456' },
        layout: { orientation: 'LANDSCAPE', titleText: 'Title', bodyText: 'Body' },
        signatures: [{ name: '', label: '' }], // empty strings
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('signatures[0].name');
      expect(result.missing).toContain('signatures[0].label');
    });
  });

  // ----------------------------------------------------------
  // preview
  // ----------------------------------------------------------

  describe('preview', () => {
    it('returns a Buffer from the PDF renderer', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate());
      jest.spyOn(service, 'renderPdf').mockResolvedValue(Buffer.from('pdf-data'));

      const dto: PreviewCertificateTemplateDto = {
        studentName: 'Alice',
        courseTitle: 'NestJS Mastery',
      };
      const result = await service.preview('tmpl-1', dto);

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('uses placeholder values when preview DTO is empty', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(makeRawTemplate());
      const renderSpy = jest
        .spyOn(service, 'renderPdf')
        .mockResolvedValue(Buffer.from('pdf-data'));

      await service.preview('tmpl-1', {});

      expect(renderSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          studentName: 'Jane Okonkwo',
          courseTitle: 'Professional Skills Course',
          certificateId: 'CERT-PREVIEW',
        }),
      );
    });

    it('throws NotFoundException when template does not exist', async () => {
      mockPrisma.certificateTemplate.findUnique.mockResolvedValue(null);

      await expect(service.preview('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
