import { BadRequestException } from '@nestjs/common';
import { createUploadOptions } from './upload-options';

describe('createUploadOptions', () => {
  const originalLimit = process.env.MAX_FILE_SIZE_MB;

  afterEach(() => {
    if (originalLimit === undefined) delete process.env.MAX_FILE_SIZE_MB;
    else process.env.MAX_FILE_SIZE_MB = originalLimit;
  });

  it('sets the configured global size limit and permits listed MIME types', () => {
    process.env.MAX_FILE_SIZE_MB = '12';
    const options = createUploadOptions(['application/pdf']);
    const callback = jest.fn();

    expect(options.limits.fileSize).toBe(12 * 1024 * 1024);
    options.fileFilter(
      {},
      { mimetype: 'application/pdf' } as Express.Multer.File,
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects MIME types outside the allow-list', () => {
    const options = createUploadOptions(['application/pdf']);
    const callback = jest.fn();

    options.fileFilter(
      {},
      { mimetype: 'application/octet-stream' } as Express.Multer.File,
      callback,
    );
    expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
  });
});
