import express, { type Express } from 'express';
import type { Server } from 'node:http';

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
  state: {
    clients: Map<string, { redirectUris: string[]; clientName?: string }>;
    codes: Map<string, { clientId: string; codeChallenge: string; redirectUri: string; resource: string; scope?: string }>;
    refreshTokens: Map<string, { clientId: string; scope?: string; resource: string }>;
    accessTokens: Map<string, { clientId: string; scope?: string; resource: string; expiresAt: number }>;
  };
}

export interface FixtureOptions {
  port?: number;
  autoApprove?: boolean;
}

export async function startServer(opts: FixtureOptions = {}): Promise<FixtureServer> {
  const app: Express = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Will be set after listen
  let baseUrl = '';

  // In-memory store of registered clients
  const clients = new Map<string, { redirectUris: string[]; clientName?: string }>();

  // In-memory authorization codes: code → { clientId, codeChallenge, redirectUri, resource, scope }
  const codes = new Map<
    string,
    { clientId: string; codeChallenge: string; redirectUri: string; resource: string; scope?: string }
  >();
  // In-memory tokens
  const refreshTokens = new Map<string, { clientId: string; scope?: string; resource: string }>();
  const accessTokens = new Map<string, { clientId: string; scope?: string; resource: string; expiresAt: number }>();

  // GET /authorize — auto-approve in test mode, render approve page otherwise
  app.get('/authorize', (req, res) => {
    const {
      response_type,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
      resource,
      scope,
    } = req.query as Record<string, string | undefined>;

    if (response_type !== 'code') {
      res.status(400).send('unsupported_response_type');
      return;
    }
    if (!client_id || !redirect_uri || !code_challenge || !state || !resource) {
      res.status(400).send('missing required parameters');
      return;
    }
    if (code_challenge_method !== 'S256') {
      res.status(400).send('unsupported code_challenge_method');
      return;
    }
    const client = clients.get(client_id);
    if (!client) {
      res.status(400).send('unknown client_id');
      return;
    }
    if (!client.redirectUris.includes(redirect_uri)) {
      res.status(400).send('invalid_redirect_uri');
      return;
    }

    const code = `code-${Math.random().toString(36).slice(2, 14)}`;
    codes.set(code, {
      clientId: client_id,
      codeChallenge: code_challenge,
      redirectUri: redirect_uri,
      resource,
      scope,
    });

    if (opts.autoApprove) {
      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      url.searchParams.set('state', state);
      res.redirect(302, url.toString());
      return;
    }

    res.send(`<!doctype html>
<html><body>
<h1>Authorize ${client.clientName ?? client_id}?</h1>
<form method="POST" action="/authorize/approve">
  <input type="hidden" name="code" value="${code}">
  <input type="hidden" name="redirect_uri" value="${redirect_uri}">
  <input type="hidden" name="state" value="${state}">
  <button type="submit">Approve</button>
</form>
</body></html>`);
  });

  app.post('/authorize/approve', (req, res) => {
    const { code, redirect_uri, state } = req.body as Record<string, string>;
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  });

  // POST /token — supports authorization_code + refresh_token grants
  app.post('/token', async (req, res) => {
    const grantType = req.body.grant_type as string | undefined;
    if (grantType === 'authorization_code') {
      const { code, code_verifier, redirect_uri, client_id, resource } = req.body as Record<
        string,
        string
      >;
      const entry = codes.get(code);
      if (!entry) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'unknown code' });
        return;
      }
      codes.delete(code);
      if (entry.clientId !== client_id) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch' });
        return;
      }
      if (entry.redirectUri !== redirect_uri) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return;
      }
      if (entry.resource !== resource) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'resource mismatch' });
        return;
      }
      // Verify PKCE: SHA256(verifier) base64url == challenge
      const { createHash } = await import('node:crypto');
      const computed = createHash('sha256').update(code_verifier).digest('base64url');
      if (computed !== entry.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verifier mismatch' });
        return;
      }
      const accessToken = `at-${Math.random().toString(36).slice(2, 18)}`;
      const refreshToken = `rt-${Math.random().toString(36).slice(2, 18)}`;
      accessTokens.set(accessToken, {
        clientId: client_id,
        scope: entry.scope,
        resource: entry.resource,
        expiresAt: Date.now() + 3600_000,
      });
      refreshTokens.set(refreshToken, {
        clientId: client_id,
        scope: entry.scope,
        resource: entry.resource,
      });
      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: entry.scope,
      });
      return;
    }
    if (grantType === 'refresh_token') {
      const { refresh_token, client_id } = req.body as Record<string, string>;
      const entry = refreshTokens.get(refresh_token);
      if (!entry || entry.clientId !== client_id) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'unknown refresh_token' });
        return;
      }
      // Rotate: invalidate old refresh, issue new pair
      refreshTokens.delete(refresh_token);
      const accessToken = `at-${Math.random().toString(36).slice(2, 18)}`;
      const newRefresh = `rt-${Math.random().toString(36).slice(2, 18)}`;
      accessTokens.set(accessToken, { ...entry, expiresAt: Date.now() + 3600_000 });
      refreshTokens.set(newRefresh, entry);
      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRefresh,
        scope: entry.scope,
      });
      return;
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  // /.well-known/oauth-protected-resource (issued by the MCP resource server)
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
    });
  });

  // /.well-known/oauth-authorization-server (issued by the AS)
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  app.post('/register', (req, res) => {
    const { redirect_uris, client_name } = req.body as {
      redirect_uris?: string[];
      client_name?: string;
    };
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' });
      return;
    }
    const clientId = `dyn-${Math.random().toString(36).slice(2, 12)}`;
    clients.set(clientId, { redirectUris: redirect_uris, clientName: client_name });
    res.status(201).json({
      client_id: clientId,
      redirect_uris,
      client_name,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr !== 'object' || !addr) {
        reject(new Error('Failed to get server address'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        state: { clients, codes, refreshTokens, accessTokens },
      });
    });
    server.on('error', reject);
  });
}
