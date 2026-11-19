import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { WebhookSignatureMiddleware } from './webhook-signature.middleware';

describe('WebhookSignatureMiddleware', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"event":"ping"}');
  const config = { get: jest.fn((key: string) => (key === 'WEBHOOK_SECRET' ? secret : undefined)) };
  const middleware = new WebhookSignatureMiddleware(
    config as unknown as ConfigService,
    new Reflector(),
  );

  const request = (signature: string) =>
    ({
      method: 'POST',
      originalUrl: '/api/v1/webhooks',
      headers: { 'x-webhook-signature': signature },
      rawBody: body,
    }) as any;

  it('accepts a valid signature', () => {
    const valid = createHmac('sha256', secret).update(body).digest('hex');
    const next = jest.fn();
    middleware.use(request(`sha256=${valid}`), {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects an invalid signature of the same length', () => {
    const valid = createHmac('sha256', secret).update(body).digest('hex');
    const forged = (valid[0] === 'a' ? 'b' : 'a') + valid.slice(1);
    expect(forged).toHaveLength(valid.length);
    const next = jest.fn();
    expect(() => middleware.use(request(forged), {} as any, next)).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });
});
