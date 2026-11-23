import { BadRequestException } from '@nestjs/common';
import { FileFilterCallback } from 'multer';

const DEFAULT_MAX_FILE_SIZE_MB = 500;

export function createUploadOptions(allowedMimeTypes: readonly string[]) {
  const configuredSize = Number(process.env.MAX_FILE_SIZE_MB);
  const maxFileSizeMb =
    Number.isFinite(configuredSize) && configuredSize > 0
      ? configuredSize
      : DEFAULT_MAX_FILE_SIZE_MB;

  return {
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (
      _request: unknown,
      file: Express.Multer.File,
      callback: FileFilterCallback,
    ) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        callback(new BadRequestException('Unsupported file type'));
        return;
      }
      callback(null, true);
    },
  };
}
