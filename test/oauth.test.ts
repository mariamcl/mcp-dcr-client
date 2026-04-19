import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState, startCallbackServer } from '../src/oauth.js';
import { createHash } from 'node:crypto';

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
