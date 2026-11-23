import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthGuard', () => {
  const googleAuth = {
    consumeOAuthState: jest.fn(),
    createOAuthState: jest.fn(),
  } as unknown as GoogleAuthService;
  let guard: GoogleAuthGuard;

  const callbackContext = (state?: string, cookie = 'expected-state') => {
    const request = {
      path: '/api/v1/auth/google/callback',
      query: state ? { state } : {},
      headers: { cookie: `google_oauth_state=${cookie}` },
    };
    const response = { clearCookie: jest.fn() };
    const http = {
      getRequest: () => request,
      getResponse: () => response,
    };
    return {
      context: { switchToHttp: () => http } as unknown as ExecutionContext,
      response,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new GoogleAuthGuard(googleAuth);
    (googleAuth.consumeOAuthState as jest.Mock).mockReturnValue(true);
  });

  it('rejects a callback with missing state before Passport runs', () => {
    const { context } = callbackContext();

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(googleAuth.consumeOAuthState).not.toHaveBeenCalled();
  });

  it('rejects a callback whose state does not match the browser cookie', () => {
    const { context } = callbackContext('attacker-state');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(googleAuth.consumeOAuthState).not.toHaveBeenCalled();
  });

  it('rejects a state that is not present in the server state store', () => {
    (googleAuth.consumeOAuthState as jest.Mock).mockReturnValue(false);
    const { context } = callbackContext('expected-state');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(googleAuth.consumeOAuthState).toHaveBeenCalledWith('expected-state');
  });
});
