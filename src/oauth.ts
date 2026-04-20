import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AuthorizationDenied, StateMismatch, TokenExchangeFailed } from './errors.js';
import { register } from './registration.js';
import type { OAuthEndpoints } from './discovery.js';

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
      const safeError = error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorization failed</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f7f7f8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      color: #111;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.07);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .icon {
      font-size: 3rem;
      color: #ef4444;
      margin-bottom: 1rem;
      line-height: 1;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: .5rem;
    }
    .caption {
      font-size: .875rem;
      color: #6b7280;
      margin-bottom: 1.25rem;
    }
    .error-code {
      display: inline-block;
      font-size: .75rem;
      font-family: ui-monospace, 'Cascadia Code', monospace;
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: .3rem .65rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x2717;</div>
    <h1>Authorization failed</h1>
    <p class="caption">You can close this tab.</p>
    <span class="error-code">${safeError}</span>
  </div>
</body>
</html>`);
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
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You're logged in</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f7f7f8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      color: #111;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.07);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .icon {
      font-size: 3rem;
      color: #16a34a;
      margin-bottom: 1rem;
      line-height: 1;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: .5rem;
    }
    .caption {
      font-size: .875rem;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x2713;</div>
    <h1>Logged in</h1>
    <p class="caption">You can close this tab.</p>
  </div>
</body>
</html>`);
    resolveCode(code);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      /* c8 ignore next 4 -- defensive guard; server.address() is always an object after listen */
      if (typeof addr !== 'object' || !addr) {
        reject(new Error('Failed to get address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}/cb`;
      resolve({
        url,
        waitForCode: () => codePromise,
        /* c8 ignore next -- server.close error callback only fires on Node.js internal errors */
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

export interface OAuthFlowResult {
  tokens: Tokens;
  clientId: string;
}

export interface RunOAuthFlowParams {
  endpoints: OAuthEndpoints;
  clientId: string;
  resource: string;
  browserOpener: (url: string) => Promise<void>;
  /** If true, re-register with the loopback URL once we know the port. */
  registerDynamicRedirect?: boolean;
  scope?: string;
  /** Timeout in ms for the callback (default: 5 minutes). */
  timeoutMs?: number;
}

export async function runOAuthFlow(params: RunOAuthFlowParams): Promise<OAuthFlowResult> {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const cb = await startCallbackServer(state);
  try {
    let clientId = params.clientId;
    if (params.registerDynamicRedirect && params.endpoints.registrationEndpoint) {
      const reg = await register(params.endpoints.registrationEndpoint, {
        redirectUris: [cb.url],
        clientName: 'mcp-dcr-client',
        serverUrl: params.resource,
      });
      clientId = reg.clientId;
    }

    const authUrl = new URL(params.endpoints.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', cb.url);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('resource', params.resource);
    if (params.scope) authUrl.searchParams.set('scope', params.scope);

    await params.browserOpener(authUrl.toString());

    const timeoutMs = params.timeoutMs ?? 5 * 60_000;
    const code = await Promise.race([
      cb.waitForCode(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('OAuth callback timed out')), timeoutMs).unref(),
      ),
    ]);

    const tokens = await exchangeCodeForTokens({
      tokenEndpoint: params.endpoints.tokenEndpoint,
      code,
      codeVerifier: verifier,
      redirectUri: cb.url,
      clientId,
      resource: params.resource,
    });
    return { tokens, clientId };
  } finally {
    await cb.close();
  }
}

interface ExchangeParams {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  resource: string;
}

async function exchangeCodeForTokens(params: ExchangeParams): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    resource: params.resource,
  });
  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TokenExchangeFailed(res.status, text);
  }
  let parsed: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenExchangeFailed(res.status, `malformed JSON: ${text}`);
  }
  if (!parsed.access_token) {
    throw new TokenExchangeFailed(res.status, 'response missing access_token');
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in ?? 3600,
    scope: parsed.scope,
  };
}

export async function refreshTokens(params: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
}): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TokenExchangeFailed(res.status, text);
  }
  let parsed: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenExchangeFailed(res.status, `malformed JSON: ${text}`);
  }
  if (!parsed.access_token) {
    throw new TokenExchangeFailed(res.status, 'response missing access_token');
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in ?? 3600,
    scope: parsed.scope,
  };
}
