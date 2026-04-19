import { describe, it, expect, afterEach } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState, startCallbackServer } from '../src/oauth.js';
import { createHash } from 'node:crypto';
import { runOAuthFlow, refreshTokens } from '../src/oauth.js';
import { register } from '../src/registration.js';
import { discover } from '../src/discovery.js';
import { TokenExchangeFailed } from '../src/errors.js';
import { inject } from 'vitest';
import { startServer, type FixtureServer } from './fixtures/server.js';

describe('PKCE + state primitives', () => {
  it('generateCodeVerifier returns 43-128 chars of base64url', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generateCodeVerifier returns different values each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it('generateCodeChallenge is SHA256(verifier) base64url', () => {
    const verifier = 'test-verifier-string-must-be-long-enough-for-pkce-spec';
    const challenge = generateCodeChallenge(verifier);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('generateState returns a random base64url string', () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
    expect(generateState()).not.toBe(s);
  });
});

describe('startCallbackServer', () => {
  it('resolves with the code when callback hits with matching state', async () => {
    const { url, waitForCode, close } = await startCallbackServer('expected-state');
    try {
      const callbackUrl = new URL(url);
      callbackUrl.searchParams.set('code', 'abc123');
      callbackUrl.searchParams.set('state', 'expected-state');
      const codePromise = waitForCode();
      await fetch(callbackUrl.toString());
      const code = await codePromise;
      expect(code).toBe('abc123');
    } finally {
      await close();
    }
  });

  it('rejects with StateMismatch when state does not match', async () => {
    const { url, waitForCode, close } = await startCallbackServer('expected-state');
    try {
      const callbackUrl = new URL(url);
      callbackUrl.searchParams.set('code', 'abc123');
      callbackUrl.searchParams.set('state', 'wrong');
      const codePromise = waitForCode();
      await fetch(callbackUrl.toString()).catch(() => {});
      await expect(codePromise).rejects.toThrow(/state/i);
    } finally {
      await close();
    }
  });

  it('rejects with AuthorizationDenied when callback has ?error=', async () => {
    const { url, waitForCode, close } = await startCallbackServer('s');
    try {
      const callbackUrl = new URL(url);
      callbackUrl.searchParams.set('error', 'access_denied');
      callbackUrl.searchParams.set('error_description', 'User denied');
      callbackUrl.searchParams.set('state', 's');
      const codePromise = waitForCode();
      await fetch(callbackUrl.toString()).catch(() => {});
      await expect(codePromise).rejects.toMatchObject({ name: 'AuthorizationDenied' });
    } finally {
      await close();
    }
  });

  it('ignores stray requests before the real callback', async () => {
    const { url, waitForCode, close } = await startCallbackServer('s');
    try {
      await fetch(url.replace('/cb', '/favicon.ico')).catch(() => {});

      const callbackUrl = new URL(url);
      callbackUrl.searchParams.set('code', 'abc');
      callbackUrl.searchParams.set('state', 's');
      const codePromise = waitForCode();
      await fetch(callbackUrl.toString());
      const code = await codePromise;
      expect(code).toBe('abc');
    } finally {
      await close();
    }
  });

  it('returns 400 when code or state is missing from callback', async () => {
    const { url, close } = await startCallbackServer('s');
    try {
      // Hit /cb without code or state
      const res = await fetch(url);
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });
});

const baseUrl = inject('fixtureBaseUrl');

describe('runOAuthFlow', () => {
  it('completes the full PKCE flow against the fixture server', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);

    // Custom browserOpener that just GETs the URL with redirect:manual and
    // follows the 302 to the loopback
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`expected 302 from authorize, got ${res.status}`);
      await fetch(loc);
    };

    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: `${baseUrl}/mcp`,
      browserOpener: opener,
      registerDynamicRedirect: true,
    });

    expect(result.tokens.accessToken).toMatch(/^at-/);
    expect(result.tokens.refreshToken).toMatch(/^rt-/);
    expect(result.tokens.expiresIn).toBe(3600);
    expect(result.clientId).toMatch(/^dyn-/);
  });

  it('throws when the AS rejects the authorize request', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    // Use a random unregistered client_id to provoke rejection;
    // opener won't follow because there's no 302 (the AS returns 400)
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      // Don't follow anything; the loopback never gets a callback
      void res;
    };

    await expect(
      runOAuthFlow({
        endpoints,
        clientId: 'unregistered-client',
        resource: `${baseUrl}/mcp`,
        browserOpener: opener,
        registerDynamicRedirect: false,
        timeoutMs: 200,
      }),
    ).rejects.toThrow();
  });
});

describe('refreshTokens', () => {
  it('exchanges a refresh token for new tokens (rotation)', async () => {
    // Get an initial refresh token via the full flow
    const endpoints = await discover(`${baseUrl}/mcp`);
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    const initial = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: `${baseUrl}/mcp`,
      browserOpener: opener,
      registerDynamicRedirect: true,
    });
    expect(initial.tokens.refreshToken).toBeDefined();

    const refreshed = await refreshTokens({
      tokenEndpoint: endpoints.tokenEndpoint,
      refreshToken: initial.tokens.refreshToken!,
      clientId: initial.clientId,
    });
    expect(refreshed.accessToken).toMatch(/^at-/);
    expect(refreshed.accessToken).not.toBe(initial.tokens.accessToken);
    expect(refreshed.refreshToken).toMatch(/^rt-/);
    expect(refreshed.refreshToken).not.toBe(initial.tokens.refreshToken);
  });

  it('throws TokenExchangeFailed on invalid refresh token', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    await expect(
      refreshTokens({
        tokenEndpoint: endpoints.tokenEndpoint,
        refreshToken: 'totally-bogus',
        clientId: 'whatever',
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });
});

describe('runOAuthFlow with scope', () => {
  it('includes scope in auth URL when scope is provided', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    const opener = async (url: string) => {
      // Verify scope is in the URL
      expect(url).toContain('scope=openid');
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`expected 302 from authorize, got ${res.status}`);
      await fetch(loc);
    };
    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: `${baseUrl}/mcp`,
      browserOpener: opener,
      registerDynamicRedirect: true,
      scope: 'openid',
    });
    expect(result.tokens.accessToken).toMatch(/^at-/);
  });
});

describe('token endpoint edge cases (mode-controlled fixture)', () => {
  let fixture: FixtureServer;

  afterEach(async () => {
    if (fixture) {
      fixture.state.mode = 'normal';
      await fixture.close();
    }
  });

  it('throws TokenExchangeFailed (refreshTokens) when /token returns malformed JSON', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'token_malformed_json';
    await expect(
      refreshTokens({
        tokenEndpoint: `${fixture.baseUrl}/token`,
        refreshToken: 'any',
        clientId: 'any',
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });

  it('throws TokenExchangeFailed (refreshTokens) when /token response lacks access_token', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'token_no_access_token';
    await expect(
      refreshTokens({
        tokenEndpoint: `${fixture.baseUrl}/token`,
        refreshToken: 'any',
        clientId: 'any',
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });

  it('throws TokenExchangeFailed (exchangeCodeForTokens) when /token returns malformed JSON on code exchange', async () => {
    fixture = await startServer({ autoApprove: true });
    const endpoints = await discover(`${fixture.baseUrl}/mcp`);
    const opener = async (url: string) => {
      // Let the fixture auto-approve and redirect to the loopback
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    // Switch to malformed JSON mode AFTER the authorize redirect is in-flight
    // but we need it active when /token is called — since autoApprove redirects synchronously
    // we set the mode before calling runOAuthFlow and let opener trigger the callback
    fixture.state.mode = 'token_malformed_json';
    await expect(
      runOAuthFlow({
        endpoints,
        clientId: 'placeholder',
        resource: `${fixture.baseUrl}/mcp`,
        browserOpener: opener,
        registerDynamicRedirect: true,
        timeoutMs: 3000,
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });

  it('throws TokenExchangeFailed (exchangeCodeForTokens) when /token response lacks access_token on code exchange', async () => {
    fixture = await startServer({ autoApprove: true });
    const endpoints = await discover(`${fixture.baseUrl}/mcp`);
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    fixture.state.mode = 'token_no_access_token';
    await expect(
      runOAuthFlow({
        endpoints,
        clientId: 'placeholder',
        resource: `${fixture.baseUrl}/mcp`,
        browserOpener: opener,
        registerDynamicRedirect: true,
        timeoutMs: 3000,
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });

  it('uses default expiresIn=3600 when /token response omits expires_in (refreshTokens)', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'token_no_expires_in';
    const result = await refreshTokens({
      tokenEndpoint: `${fixture.baseUrl}/token`,
      refreshToken: 'any',
      clientId: 'any',
    });
    expect(result.expiresIn).toBe(3600); // default fallback
    expect(result.accessToken).toMatch(/^at-/);
  });

  it('uses default expiresIn=3600 when /token response omits expires_in (exchangeCodeForTokens)', async () => {
    fixture = await startServer({ autoApprove: true });
    const endpoints = await discover(`${fixture.baseUrl}/mcp`);
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    fixture.state.mode = 'token_no_expires_in';
    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: `${fixture.baseUrl}/mcp`,
      browserOpener: opener,
      registerDynamicRedirect: true,
      timeoutMs: 3000,
    });
    expect(result.tokens.expiresIn).toBe(3600);
  });

  it('throws TokenExchangeFailed (exchangeCodeForTokens) when /token returns non-ok status', async () => {
    fixture = await startServer({ autoApprove: true });
    const endpoints = await discover(`${fixture.baseUrl}/mcp`);
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    fixture.state.mode = 'token_error_response';
    await expect(
      runOAuthFlow({
        endpoints,
        clientId: 'placeholder',
        resource: `${fixture.baseUrl}/mcp`,
        browserOpener: opener,
        registerDynamicRedirect: true,
        timeoutMs: 3000,
      }),
    ).rejects.toBeInstanceOf(TokenExchangeFailed);
  });
});
