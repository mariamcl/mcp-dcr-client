import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../src/oauth.js';
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
