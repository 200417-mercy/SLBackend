import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VirusScanService } from './virus-scan.service';

jest.mock('clamscan', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue({ scanBuffer: jest.fn() }),
  }));
});

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    const config: Record<string, unknown> = {
      VIRUS_SCAN_ENABLED: true,
      CLAMD_HOST: '127.0.0.1',
      CLAMD_PORT: 3310,
      CLAMD_TIMEOUT: 5000,
      VIRUS_SCAN_MAX_RETRIES: 3,
    };
    return key in config ? config[key] : defaultValue;
  }),
};

describe('VirusScanService (#332)', () => {
  let service: VirusScanService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VirusScanService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VirusScanService>(VirusScanService);
    jest.clearAllMocks();
  });

  describe('onModuleInit()', () => {
    it('initializes clamscan when VIRUS_SCAN_ENABLED is true', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          VIRUS_SCAN_ENABLED: true,
          CLAMD_HOST: '127.0.0.1',
          CLAMD_PORT: 3310,
          CLAMD_TIMEOUT: 5000,
          VIRUS_SCAN_MAX_RETRIES: 3,
        };
        return key in config ? config[key] : defaultValue;
      });

      await service.onModuleInit();

      expect((service as any).isEnabled).toBe(true);
      expect((service as any).clamscan).toBeDefined();
      expect((service as any).clamscan.scanBuffer).toBeDefined();
    });

    it('sets isEnabled=false without calling NodeClam when VIRUS_SCAN_ENABLED is false', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'VIRUS_SCAN_ENABLED') return false;
        return defaultValue;
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NodeClam = require('clamscan');
      NodeClam.mockClear();

      await service.onModuleInit();

      expect((service as any).isEnabled).toBe(false);
      expect(NodeClam).not.toHaveBeenCalled();
    });

    it('sets isEnabled=false when NodeClam.init throws', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'VIRUS_SCAN_ENABLED') return true;
        return defaultValue;
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NodeClam = require('clamscan');
      NodeClam.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('ClamAV connection refused')),
      }));

      await service.onModuleInit();

      expect((service as any).isEnabled).toBe(false);
    });
  });

  describe('scanFile()', () => {
    const fileId = 'file-abc-123';
    const buffer = Buffer.from('fake file content');

    it('sets status clean and returns without throwing when scanner is bypassed (isEnabled=false)', async () => {
      (service as any).isEnabled = false;
      (service as any).clamscan = null;

      await expect(service.scanFile(fileId, buffer)).resolves.toBeUndefined();

      const result = (service as any).results.get(fileId);
      expect(result.status).toBe('clean');
      expect(result.details).toBe('Scanner bypassed');
    });

    it('sets status clean when file is not infected', async () => {
      const mockScanBuffer = jest.fn().mockResolvedValue({ isInfected: false, viruses: [] });
      (service as any).isEnabled = true;
      (service as any).clamscan = { scanBuffer: mockScanBuffer };

      await expect(service.scanFile(fileId, buffer)).resolves.toBeUndefined();

      const result = (service as any).results.get(fileId);
      expect(result.status).toBe('clean');
      expect(mockScanBuffer).toHaveBeenCalledWith(buffer);
    });

    it('throws BadRequestException when file is infected', async () => {
      const mockScanBuffer = jest
        .fn()
        .mockResolvedValue({ isInfected: true, viruses: ['Trojan.Generic'] });
      (service as any).isEnabled = true;
      (service as any).clamscan = { scanBuffer: mockScanBuffer };

      await expect(service.scanFile(fileId, buffer)).rejects.toThrow(BadRequestException);
      await expect(service.scanFile(fileId, buffer)).rejects.toThrow(
        'Malware detected in uploaded file',
      );

      const result = (service as any).results.get(fileId);
      expect(result.status).toBe('infected');
      expect(result.details).toBe('Trojan.Generic');
    });

    it('throws BadRequestException after exhausting all retries when scan keeps failing', async () => {
      const scanError = new Error('ClamAV scan timeout');
      const mockScanBuffer = jest.fn().mockRejectedValue(scanError);
      (service as any).isEnabled = true;
      (service as any).clamscan = { scanBuffer: mockScanBuffer };

      // Patch setTimeout to avoid actual delays in the retry backoff
      jest.useFakeTimers();
      const scanPromise = service.scanFile(fileId, buffer);
      // Drain all pending timers/microtasks across retry iterations
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        jest.runAllTimers();
      }
      await expect(scanPromise).rejects.toThrow(BadRequestException);
      await expect(Promise.reject(await scanPromise.catch((e) => e))).rejects.toThrow(
        'File scanning failed due to safety timeout',
      );
      jest.useRealTimers();

      expect(mockScanBuffer).toHaveBeenCalledTimes(3);
      const result = (service as any).results.get(fileId);
      expect(result.status).toBe('error');
      expect(result.attempts).toBe(3);
    }, 15000);
  });

  describe('getScanStatus()', () => {
    it('returns undefined for an unknown fileId', () => {
      expect(service.getScanStatus('nonexistent-file')).toBeUndefined();
    });

    it('returns the ScanResult after scanFile is called', async () => {
      const fileId = 'file-status-check';
      const buffer = Buffer.from('some content');
      const mockScanBuffer = jest.fn().mockResolvedValue({ isInfected: false, viruses: [] });
      (service as any).isEnabled = true;
      (service as any).clamscan = { scanBuffer: mockScanBuffer };

      await service.scanFile(fileId, buffer);

      const result = service.getScanStatus(fileId);
      expect(result).toBeDefined();
      expect(result!.fileId).toBe(fileId);
      expect(result!.status).toBe('clean');
      expect(result!.completedAt).toBeInstanceOf(Date);
    });
  });
});
