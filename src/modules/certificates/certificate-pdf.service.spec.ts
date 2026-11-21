import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateTemplatesService } from './certificate-templates.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CertificateRenderData,
  CertificateTemplateConfig,
} from './certificate-template.types';

const ACTIVE_TEMPLATE: CertificateTemplateConfig = {
  id: 'tmpl-active',
  name: 'Baking Landscape',
  category: 'Baking',
  branding: {
    organizationName: 'SorobanLard Academy',
    primaryColor: '#7C2D12',
    secondaryColor: '#F59E0B',
  },
  layout: {
    orientation: 'LANDSCAPE',
    titleText: 'Certificate of Completion',
    bodyText: 'Awarded to {{studentName}} for completing {{courseTitle}}.',
    showIssueDate: true,
    showCertificateId: true,
  },
  signatures: [{ name: 'Chef Amina', label: 'Head of Culinary' }],
  isActive: true,
  createdById: 'admin-1',
  activatedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

const validRenderData: CertificateRenderData = {
  studentName: 'Chinedu Okafor',
  courseTitle: 'Artisan Bread',
  certificateId: 'CERT-BAKE-001',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
};

describe('CertificatePdfService', () => {
  let pdfService: CertificatePdfService;
  let templatesService: CertificateTemplatesService;

  const mockPrisma = {
    certificateTemplate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockTemplates = {
    getActiveTemplateForCategory: jest.fn(),
    renderPdf: jest.fn(),
  };

  describe('with mocked CertificateTemplatesService', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CertificatePdfService,
          { provide: CertificateTemplatesService, useValue: mockTemplates },
        ],
      }).compile();

      pdfService = module.get(CertificatePdfService);
      templatesService = module.get(CertificateTemplatesService);
      jest.clearAllMocks();
    });

    it('should be defined', () => {
      expect(pdfService).toBeDefined();
    });

    describe('getActiveTemplate()', () => {
      it('delegates to CertificateTemplatesService and returns active template', async () => {
        mockTemplates.getActiveTemplateForCategory.mockResolvedValue(ACTIVE_TEMPLATE);

        const result = await pdfService.getActiveTemplate('Baking');

        expect(mockTemplates.getActiveTemplateForCategory).toHaveBeenCalledWith('Baking');
        expect(result).toEqual(ACTIVE_TEMPLATE);
      });

      it('propagates NotFoundException when no active template exists', async () => {
        mockTemplates.getActiveTemplateForCategory.mockRejectedValue(
          new NotFoundException('No active template found'),
        );

        await expect(pdfService.getActiveTemplate('Woodworking')).rejects.toThrow(
          NotFoundException,
        );
        expect(mockTemplates.getActiveTemplateForCategory).toHaveBeenCalledWith('Woodworking');
      });
    });

    describe('renderForCategory()', () => {
      it('validates data, fetches active template, and renders PDF buffer', async () => {
        const fakePdf = Buffer.from('%PDF-1.4 test buffer');
        mockTemplates.getActiveTemplateForCategory.mockResolvedValue(ACTIVE_TEMPLATE);
        mockTemplates.renderPdf.mockResolvedValue(fakePdf);

        const result = await pdfService.renderForCategory('Baking', validRenderData);

        expect(mockTemplates.getActiveTemplateForCategory).toHaveBeenCalledWith('Baking');
        expect(mockTemplates.renderPdf).toHaveBeenCalledWith(ACTIVE_TEMPLATE, {
          ...validRenderData,
          category: 'Baking',
        });
        expect(result).toBe(fakePdf);
      });

      it('preserves data.category when explicitly provided in render data', async () => {
        const fakePdf = Buffer.from('%PDF-1.4 test buffer');
        mockTemplates.getActiveTemplateForCategory.mockResolvedValue(ACTIVE_TEMPLATE);
        mockTemplates.renderPdf.mockResolvedValue(fakePdf);

        const dataWithCategory: CertificateRenderData = {
          ...validRenderData,
          category: 'Pastry Arts',
        };

        await pdfService.renderForCategory('Baking', dataWithCategory);

        expect(mockTemplates.renderPdf).toHaveBeenCalledWith(ACTIVE_TEMPLATE, {
          ...dataWithCategory,
          category: 'Pastry Arts',
        });
      });

      it('propagates NotFoundException if active template is not found', async () => {
        mockTemplates.getActiveTemplateForCategory.mockRejectedValue(
          new NotFoundException('No active template found for category Photography'),
        );

        await expect(
          pdfService.renderForCategory('Photography', validRenderData),
        ).rejects.toThrow(NotFoundException);
        expect(mockTemplates.renderPdf).not.toHaveBeenCalled();
      });
    });

    describe('render data validation (validateRenderData)', () => {
      it('rejects when studentName is missing', async () => {
        const invalidData = { ...validRenderData, studentName: '' };

        await expect(pdfService.renderForCategory('Baking', invalidData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: studentName',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });

      it('rejects when studentName contains only whitespace', async () => {
        const invalidData = { ...validRenderData, studentName: '   ' };

        await expect(pdfService.renderForCategory('Baking', invalidData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: studentName',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });

      it('rejects when courseTitle is missing', async () => {
        const invalidData = { ...validRenderData, courseTitle: '' };

        await expect(pdfService.renderForCategory('Baking', invalidData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: courseTitle',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });

      it('rejects when certificateId is missing or whitespace', async () => {
        const invalidData = { ...validRenderData, certificateId: '  \t  ' };

        await expect(pdfService.renderForCategory('Baking', invalidData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: certificateId',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });

      it('rejects when issuedAt is missing', async () => {
        const invalidData = { ...validRenderData, issuedAt: undefined as any };

        await expect(pdfService.renderForCategory('Baking', invalidData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: issuedAt',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });

      it('lists all missing fields when multiple are absent or empty', async () => {
        const emptyData = {
          studentName: '',
          courseTitle: '   ',
          certificateId: '',
          issuedAt: null as any,
        };

        await expect(pdfService.renderForCategory('Baking', emptyData)).rejects.toThrow(
          new BadRequestException(
            'Certificate render data is missing required fields: studentName, courseTitle, certificateId, issuedAt',
          ),
        );
        expect(mockTemplates.getActiveTemplateForCategory).not.toHaveBeenCalled();
      });
    });
  });

  describe('with real CertificateTemplatesService & mock PrismaService', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CertificatePdfService,
          CertificateTemplatesService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      pdfService = module.get(CertificatePdfService);
      templatesService = module.get(CertificateTemplatesService);
      jest.clearAllMocks();
    });

    it('loads the active template for the course category from database', async () => {
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue(ACTIVE_TEMPLATE);

      const template = await pdfService.getActiveTemplate('Baking');

      expect(template.id).toBe('tmpl-active');
      expect(template.branding.organizationName).toBe('SorobanLard Academy');
      expect(mockPrisma.certificateTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            category: { equals: 'Baking', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('renders a real certificate PDF buffer using PDFKit and active template', async () => {
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue(ACTIVE_TEMPLATE);

      const buffer = await pdfService.renderForCategory('Baking', validRenderData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
      expect(buffer.length).toBeGreaterThan(200);
    });

    it('rejects an active template that fails required-field validation', async () => {
      mockPrisma.certificateTemplate.findFirst.mockResolvedValue({
        ...ACTIVE_TEMPLATE,
        branding: {},
        layout: {},
        signatures: [],
      });

      await expect(pdfService.getActiveTemplate('Baking')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
