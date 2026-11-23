import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;

  const mockPrisma = {
    invoice: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
    },
  };

  const mockStellar = {
    getTransactionStatus: jest.fn(),
  };

  const mockNotifications = {
    sendInvoiceEmail: jest.fn(),
  };

  const baseEnrollment = {
    id: 'enrollment-1',
    studentId: 'student-1',
    courseId: 'course-1',
    amountPaid: '100.00',
    txHash: 'tx-hash-123',
    student: {
      id: 'student-1',
      name: 'John Doe',
      email: 'john@example.com',
      stellarAddress: 'GABC123',
    },
    course: {
      id: 'course-1',
      title: 'Introduction to Blockchain',
    },
  };

  const baseInvoice = {
    id: 'invoice-1',
    invoiceNumber: 1001,
    enrollmentId: 'enrollment-1',
    studentId: 'student-1',
    courseId: 'course-1',
    amount: '100.00',
    txHash: 'tx-hash-123',
    emailSent: false,
    issuedAt: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    jest.clearAllMocks();
  });

  describe('generateForEnrollment()', () => {
    it('returns existing invoice if already generated', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(baseInvoice);

      await expect(
        service.generateForEnrollment('enrollment-1'),
      ).resolves.toEqual(baseInvoice);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('creates new invoice for valid enrollment with successful transaction', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.invoice.create.mockResolvedValue(baseInvoice);
      mockNotifications.sendInvoiceEmail.mockResolvedValue(true);
      mockPrisma.invoice.update.mockResolvedValue({
        ...baseInvoice,
        emailSent: true,
      });

      const result = await service.generateForEnrollment('enrollment-1');

      expect(result).toMatchObject({
        enrollmentId: 'enrollment-1',
        studentId: 'student-1',
        courseId: 'course-1',
      });
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith({
        data: {
          enrollmentId: 'enrollment-1',
          studentId: 'student-1',
          courseId: 'course-1',
          amount: '100.00',
          txHash: 'tx-hash-123',
        },
      });
    });

    it('sends invoice email to student if email exists', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.invoice.create.mockResolvedValue(baseInvoice);
      mockNotifications.sendInvoiceEmail.mockResolvedValue(true);
      mockPrisma.invoice.update.mockResolvedValue({
        ...baseInvoice,
        emailSent: true,
      });

      await service.generateForEnrollment('enrollment-1');

      expect(mockNotifications.sendInvoiceEmail).toHaveBeenCalledWith(
        'john@example.com',
        1001,
        'Introduction to Blockchain',
        expect.any(Buffer),
      );
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { emailSent: true },
      });
    });

    it('skips email if student has no email address', async () => {
      const enrollmentNoEmail = {
        ...baseEnrollment,
        student: { ...baseEnrollment.student, email: null },
      };
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollmentNoEmail);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.invoice.create.mockResolvedValue(baseInvoice);

      await service.generateForEnrollment('enrollment-1');

      expect(mockNotifications.sendInvoiceEmail).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if enrollment does not exist', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.generateForEnrollment('missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if payment amount is zero', async () => {
      const zeroAmountEnrollment = { ...baseEnrollment, amountPaid: '0' };
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(zeroAmountEnrollment);

      await expect(
        service.generateForEnrollment('enrollment-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if payment amount is negative', async () => {
      const negativeAmountEnrollment = { ...baseEnrollment, amountPaid: '-10' };
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        negativeAmountEnrollment,
      );

      await expect(
        service.generateForEnrollment('enrollment-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if transaction was unsuccessful', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: false });

      await expect(
        service.generateForEnrollment('enrollment-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('handles enrollment without txHash', async () => {
      const noTxEnrollment = { ...baseEnrollment, txHash: null };
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(noTxEnrollment);
      mockPrisma.invoice.create.mockResolvedValue({
        ...baseInvoice,
        txHash: null,
      });
      mockNotifications.sendInvoiceEmail.mockResolvedValue(true);
      mockPrisma.invoice.update.mockResolvedValue({
        ...baseInvoice,
        txHash: null,
        emailSent: true,
      });

      await expect(
        service.generateForEnrollment('enrollment-1'),
      ).resolves.toBeTruthy();
      expect(mockStellar.getTransactionStatus).not.toHaveBeenCalled();
    });

    it('uses stellar address as fallback when student name is null', async () => {
      const noNameEnrollment = {
        ...baseEnrollment,
        student: { ...baseEnrollment.student, name: null },
      };
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(noNameEnrollment);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.invoice.create.mockResolvedValue(baseInvoice);
      mockNotifications.sendInvoiceEmail.mockResolvedValue(true);
      mockPrisma.invoice.update.mockResolvedValue({
        ...baseInvoice,
        emailSent: true,
      });

      await service.generateForEnrollment('enrollment-1');

      // The PDF should contain stellar address instead of name
      expect(mockNotifications.sendInvoiceEmail).toHaveBeenCalled();
    });

    it('does not update emailSent if email sending fails', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockStellar.getTransactionStatus.mockResolvedValue({ successful: true });
      mockPrisma.invoice.create.mockResolvedValue(baseInvoice);
      mockNotifications.sendInvoiceEmail.mockResolvedValue(false);

      await service.generateForEnrollment('enrollment-1');

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });
  });
});
