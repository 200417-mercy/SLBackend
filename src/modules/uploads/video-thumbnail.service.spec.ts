import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoThumbnailService, ThumbnailResult } from './video-thumbnail.service';
import * as fs from 'fs';
import * as ffmpeg from 'fluent-ffmpeg';

jest.mock('fs');
jest.mock('fluent-ffmpeg');

const UPLOAD_DIR = './uploads';
const FALLBACK_PATH = './uploads/thumbnails/fallback-thumbnail.jpg';
const FALLBACK_URL = '/uploads/thumbnails/fallback-thumbnail.jpg';

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'UPLOAD_DIR') return UPLOAD_DIR;
    if (key === 'FALLBACK_THUMBNAIL_PATH') return FALLBACK_PATH;
    return defaultValue;
  }),
};

/** Builds a fluent-ffmpeg chain mock. The `triggerEvent` callback is called
 *  after `.on` is registered, so callers can decide whether to fire 'end'
 *  or 'error' synchronously. */
function buildFfmpegChain(triggerEvent: (chain: any) => void) {
  const chain: any = {
    seekInput: jest.fn().mockReturnThis(),
    frames: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event: string, cb: (...args: any[]) => void) {
      chain._handlers = chain._handlers ?? {};
      chain._handlers[event] = cb;
      return chain;
    }),
    run: jest.fn().mockImplementation(function () {
      triggerEvent(chain);
    }),
  };
  return chain;
}

describe('#251 VideoThumbnailService', () => {
  let service: VideoThumbnailService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // fs stubs — existsSync returns true so ensureDir / ensureFallbackThumbnail
    // skip their write paths during service construction.
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock) = jest.fn();
    (fs.unlinkSync as jest.Mock) = jest.fn();
    (fs.writeFileSync as jest.Mock) = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoThumbnailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VideoThumbnailService>(VideoThumbnailService);
  });

  // ----------------------------------------------------------------
  // validateTimestamp
  // ----------------------------------------------------------------
  describe('validateTimestamp()', () => {
    it('accepts boundary value 0', () => {
      expect(() => service.validateTimestamp(0)).not.toThrow();
    });

    it('accepts mid-range value 5', () => {
      expect(() => service.validateTimestamp(5)).not.toThrow();
    });

    it('accepts boundary value 600', () => {
      expect(() => service.validateTimestamp(600)).not.toThrow();
    });

    it('throws BadRequestException for a negative timestamp', () => {
      expect(() => service.validateTimestamp(-1)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for NaN', () => {
      expect(() => service.validateTimestamp(NaN)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when timestamp exceeds 600', () => {
      expect(() => service.validateTimestamp(601)).toThrow(BadRequestException);
    });
  });

  // ----------------------------------------------------------------
  // extractThumbnail
  // ----------------------------------------------------------------
  describe('extractThumbnail()', () => {
    it('returns a non-fallback ThumbnailResult when ffmpeg fires the end event', async () => {
      (ffmpeg as unknown as jest.Mock).mockImplementation(() =>
        buildFfmpegChain((chain) => {
          chain._handlers?.['end']?.();
        }),
      );

      const result: ThumbnailResult = await service.extractThumbnail(
        '/videos/lesson.mp4',
        'lesson-abc',
        5,
      );

      expect(result.isFallback).toBe(false);
      expect(result.thumbnailUrl).toMatch(/^\/uploads\/thumbnails\/thumb-lesson-abc-/);
      expect(result.thumbnailPath).toMatch(/thumbnails[\\/]thumb-lesson-abc-/);
    });

    it('returns a fallback ThumbnailResult when ffmpeg fires the error event', async () => {
      (ffmpeg as unknown as jest.Mock).mockImplementation(() =>
        buildFfmpegChain((chain) => {
          chain._handlers?.['error']?.(new Error('ffmpeg extraction failed'));
        }),
      );

      const result: ThumbnailResult = await service.extractThumbnail(
        '/videos/lesson.mp4',
        'lesson-abc',
        5,
      );

      expect(result.isFallback).toBe(true);
      expect(result.thumbnailUrl).toBe(FALLBACK_URL);
      expect(result.thumbnailPath).toBe(FALLBACK_PATH);
    });
  });

  // ----------------------------------------------------------------
  // resolveThumbnailUrl
  // ----------------------------------------------------------------
  describe('resolveThumbnailUrl()', () => {
    it('returns the stored URL when one is provided', () => {
      const url = '/uploads/thumbnails/thumb-lesson-123.jpg';
      expect(service.resolveThumbnailUrl(url)).toBe(url);
    });

    it('returns the fallback URL when null is passed', () => {
      expect(service.resolveThumbnailUrl(null)).toBe(FALLBACK_URL);
    });

    it('returns the fallback URL when an empty string is passed', () => {
      expect(service.resolveThumbnailUrl('')).toBe(FALLBACK_URL);
    });

    it('returns the fallback URL when a whitespace-only string is passed', () => {
      expect(service.resolveThumbnailUrl('   ')).toBe(FALLBACK_URL);
    });
  });

  // ----------------------------------------------------------------
  // deleteThumbnail
  // ----------------------------------------------------------------
  describe('deleteThumbnail()', () => {
    it('calls fs.unlinkSync when the file exists and is not the fallback', () => {
      const thumbPath = `${UPLOAD_DIR}/thumbnails/thumb-lesson-xyz.jpg`;
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      service.deleteThumbnail(thumbPath);

      expect(fs.unlinkSync).toHaveBeenCalledWith(thumbPath);
    });

    it('silently skips deletion when the file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() =>
        service.deleteThumbnail(`${UPLOAD_DIR}/thumbnails/missing.jpg`),
      ).not.toThrow();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('silently skips deletion for the fallback thumbnail path', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      service.deleteThumbnail(FALLBACK_PATH);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
