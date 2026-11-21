import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import { CdnService } from './cdn.service';
import { UploadsService } from './uploads.service';
import { VirusScanService } from './virus-scan.service';
import { VideoTranscodeService } from './video-transcode.service';
import { VideoThumbnailService } from './video-thumbnail.service';

jest.mock('clamscan', () => {
  return jest.fn().mockImplementation(() => {
    return {
      init: jest.fn().mockResolvedValue({
        scanBuffer: jest.fn(),
      }),
    };
  });
});

jest.mock('fs');

describe('UploadsService (CDN integration)', () => {
  let service: UploadsService;
  let cdn: CdnService;

  beforeEach(async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
    (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        CdnService,
        {
          provide: VirusScanService,
          useValue: {
            scanFile: jest.fn().mockResolvedValue(undefined),
            getScanStatus: jest.fn(),
          },
        },
        {
          provide: VideoTranscodeService,
          useValue: { enqueueTranscode: jest.fn() },
        },
        { provide: VideoThumbnailService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const map: Record<string, string | number> = {
                UPLOAD_DIR: './uploads',
                CDN_BASE_URL: 'https://cdn.sorobanlard.com',
                CDN_ORIGIN_BASE_URL: 'http://localhost:3000',
                CDN_SIGNING_SECRET: 'test-secret',
                CDN_SIGNED_URL_TTL_SECONDS: 3600,
              };
              return map[key] !== undefined ? map[key] : defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(UploadsService);
    cdn = module.get(CdnService);
    jest.clearAllMocks();
  });

  it('returns CDN URLs when saving a public file', async () => {
    const file = {
      originalname: 'thumb.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    const result = await service.saveFile(file, 'thumbnails');

    expect(result.originUrl).toMatch(/^\/uploads\/thumbnails\//);
    expect(result.cdnUrl).toMatch(/^https:\/\/cdn\.sorobanlard\.com\/uploads\/thumbnails\//);
    expect(result.url).toBe(result.cdnUrl);
    expect(result.visibility).toBe('public');
  });

  it('returns signed CDN URLs for KYC documents', async () => {
    const file = {
      originalname: 'id.pdf',
      mimetype: 'application/pdf',
      size: 2048,
      buffer: Buffer.from('pdf'),
    } as Express.Multer.File;

    const result = await service.saveKycDocument(file, 'instructor-1');

    expect(result.visibility).toBe('private');
    expect(result.cdnUrl).toContain('signature=');
    expect(cdn.validateSignedUrl(result.cdnUrl).valid).toBe(true);
  });

  it('rejects disallowed MIME types', async () => {
    const file = {
      originalname: 'x.exe',
      mimetype: 'application/octet-stream',
      size: 10,
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    await expect(service.saveKycDocument(file, 'id')).rejects.toThrow(BadRequestException);
  });
});

describe('UploadsService', () => {
  let service: UploadsService;
  let cdn: CdnService;
  let virusScan: { scanFile: jest.Mock; getScanStatus: jest.Mock };
  let videoTranscode: {
    validateVideoFormat: jest.Mock;
    addTranscodeJob: jest.Mock;
    extractThumbnail: jest.Mock;
  };
  let videoThumbnail: Record<string, jest.Mock>;

  const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      originalname: 'file.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('x'),
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
    (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);

    virusScan = {
      scanFile: jest.fn().mockResolvedValue(undefined),
      getScanStatus: jest.fn(),
    };
    videoTranscode = {
      validateVideoFormat: jest.fn(),
      addTranscodeJob: jest.fn().mockResolvedValue('job-123'),
      extractThumbnail: jest.fn().mockResolvedValue('/uploads/thumbnails/thumb.jpg'),
    };
    videoThumbnail = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        CdnService,
        { provide: VirusScanService, useValue: virusScan },
        { provide: VideoTranscodeService, useValue: videoTranscode },
        { provide: VideoThumbnailService, useValue: videoThumbnail },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const map: Record<string, string | number> = {
                UPLOAD_DIR: './uploads',
                CDN_BASE_URL: 'https://cdn.sorobanlard.com',
                CDN_ORIGIN_BASE_URL: 'http://localhost:3000',
                CDN_SIGNING_SECRET: 'test-secret',
                CDN_SIGNED_URL_TTL_SECONDS: 3600,
              };
              return map[key] !== undefined ? map[key] : defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(UploadsService);
    cdn = module.get(CdnService);
    jest.clearAllMocks();
  });

  describe('validateFile (via saveKycDocument)', () => {
    it('rejects a missing file', async () => {
      await expect(
        service.saveKycDocument(undefined as unknown as Express.Multer.File, 'id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a file over 10 MB', async () => {
      const file = makeFile({ size: 10 * 1024 * 1024 + 1 });

      await expect(service.saveKycDocument(file, 'id')).rejects.toThrow(BadRequestException);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects a disallowed MIME type', async () => {
      const file = makeFile({ mimetype: 'application/octet-stream' });

      await expect(service.saveKycDocument(file, 'id')).rejects.toThrow(BadRequestException);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('saveFile', () => {
    it('scans, writes the file and returns public CDN URLs', async () => {
      const file = makeFile();

      const result = await service.saveFile(file, 'thumbnails');

      expect(virusScan.scanFile).toHaveBeenCalledWith(file.buffer);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.originUrl).toMatch(/^\/uploads\/thumbnails\//);
      expect(result.cdnUrl).toMatch(/^https:\/\/cdn\.sorobanlard\.com\/uploads\/thumbnails\//);
      expect(result.url).toBe(result.cdnUrl);
      expect(result.visibility).toBe('public');
    });
  });

  describe('saveKycDocument', () => {
    it('returns private signed CDN URLs', async () => {
      const file = makeFile({ originalname: 'id.pdf', mimetype: 'application/pdf' });

      const result = await service.saveKycDocument(file, 'instructor-1');

      expect(virusScan.scanFile).toHaveBeenCalledWith(file.buffer);
      expect(result.visibility).toBe('private');
      expect(result.cdnUrl).toContain('signature=');
      expect(cdn.validateSignedUrl(result.cdnUrl).valid).toBe(true);
    });
  });

  describe('saveVideo', () => {
    it('rejects a missing file', async () => {
      await expect(
        service.saveVideo(undefined as unknown as Express.Multer.File, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates format validation and propagates its error', async () => {
      const file = makeFile({ originalname: 'clip.mp4', mimetype: 'video/mp4' });
      videoTranscode.validateVideoFormat.mockImplementation(() => {
        throw new BadRequestException('Unsupported video format');
      });

      await expect(service.saveVideo(file, 'user-1')).rejects.toThrow(BadRequestException);
      expect(videoTranscode.validateVideoFormat).toHaveBeenCalledWith(file);
      expect(videoTranscode.addTranscodeJob).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('enqueues a transcode job, extracts a thumbnail and returns the result', async () => {
      const file = makeFile({ originalname: 'clip.mp4', mimetype: 'video/mp4' });

      const result = await service.saveVideo(file, 'user-1');

      expect(videoTranscode.validateVideoFormat).toHaveBeenCalledWith(file);
      expect(virusScan.scanFile).toHaveBeenCalledWith(file.buffer);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(videoTranscode.addTranscodeJob).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(videoTranscode.extractThumbnail).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: expect.any(String) }),
      );
      expect(result.jobId).toBe('job-123');
      expect(result.originUrl).toMatch(/^\/uploads\/videos\//);
      expect(result.thumbnail).toBe('/uploads/thumbnails/thumb.jpg');
    });

    it('propagates a virus-scan rejection without writing the file', async () => {
      const file = makeFile({ originalname: 'clip.mp4', mimetype: 'video/mp4' });
      virusScan.scanFile.mockRejectedValue(new BadRequestException('Virus detected'));

      await expect(service.saveVideo(file, 'user-1')).rejects.toThrow(BadRequestException);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(videoTranscode.addTranscodeJob).not.toHaveBeenCalled();
    });
  });

  describe('getDeliveryUrls', () => {
    it('returns public URLs for public files', () => {
      const result = service.getDeliveryUrls('/uploads/thumbnails/thumb.jpg', 'public');

      expect(result.cdnUrl).toMatch(/^https:\/\/cdn\.sorobanlard\.com\/uploads\/thumbnails\//);
      expect(result.cdnUrl).not.toContain('signature=');
      expect(result.visibility).toBe('public');
    });

    it('returns signed URLs for private files', () => {
      const result = service.getDeliveryUrls('/uploads/kyc/id.pdf', 'private');

      expect(result.cdnUrl).toContain('signature=');
      expect(cdn.validateSignedUrl(result.cdnUrl).valid).toBe(true);
      expect(result.visibility).toBe('private');
    });
  });
});
