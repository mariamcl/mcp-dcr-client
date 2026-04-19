import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState, startCallbackServer } from '../src/oauth.js';
import { createHash } from 'node:crypto';
import { runOAuthFlow, refreshTokens } from '../src/oauth.js';
import { register } from '../src/registration.js';
import { discover } from '../src/discovery.js';
import { TokenExchangeFailed } from '../src/errors.js';
import { inject } from 'vitest';

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
