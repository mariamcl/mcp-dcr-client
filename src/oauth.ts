import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AuthorizationDenied, StateMismatch } from './errors.js';

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

export interface CallbackServer {
  url: string;
  waitForCode: () => Promise<string>;
  close: () => Promise<void>;
}

export async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Attach a catch handler to suppress unhandled rejection warnings until user attaches handler
  codePromise.catch(() => {});

  const server: Server = createServer((req, res) => {
    if (!req.url || !req.url.startsWith('/cb')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description') ?? undefined;

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization failed</h1><p>You can close this tab.</p>');
      rejectCode(new AuthorizationDenied(error, errorDescription));
      return;
    }
    if (!code || !state) {
      res.writeHead(400);
      res.end('missing code or state');
      return;
    }
    if (state !== expectedState) {
      res.writeHead(400);
      res.end('state mismatch');
      rejectCode(new StateMismatch());
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Logged in</h1><p>You can close this tab.</p>');
    resolveCode(code);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr !== 'object' || !addr) {
        reject(new Error('Failed to get address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}/cb`;
      resolve({
        url,
        waitForCode: () => codePromise,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}
