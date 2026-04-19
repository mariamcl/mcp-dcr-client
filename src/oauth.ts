import { randomBytes, createHash } from 'node:crypto';

export function generateCodeVerifier(): string {
  // 32 bytes → 43 char base64url, satisfies RFC 7636 (min 43, max 128)
  return randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return randomBytes(16).toString('base64url');
}
