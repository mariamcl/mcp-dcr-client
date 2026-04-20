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
    /**
     * Test-only mode flags for edge-case routes:
     * - 'normal'                  – default behaviour
     * - 'pr_empty_servers'        – /.well-known/oauth-protected-resource returns {} (no authorization_servers)
     * - 'pr_empty_as_url'         – /.well-known/oauth-protected-resource returns authorization_servers: ['']
     * - 'as_missing_endpoints'    – /.well-known/oauth-authorization-server omits authorization_endpoint
     * - 'register_malformed_json' – /register returns malformed JSON with 200
     * - 'register_no_client_id'   – /register returns valid JSON without client_id
     * - 'token_malformed_json'    – /token returns malformed JSON with 200
     * - 'token_no_access_token'   – /token returns valid JSON without access_token
     */
    mode: string;
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

  // Test-only mode flag – mutate via fixture.state.mode before a request
  let mode = 'normal';

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

    const clientLabel = escapeHtml(client.clientName ?? client_id);
    const safeCode = escapeHtml(code);
    const safeRedirectUri = escapeHtml(redirect_uri);
    const safeState = escapeHtml(state ?? '');

    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${clientLabel}</title>
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
      max-width: 420px;
    }
    .badge {
      display: inline-block;
      font-size: .7rem;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #6b7280;
      background: #f3f4f6;
      border-radius: 4px;
      padding: .2rem .5rem;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: .5rem;
    }
    .subtitle {
      font-size: .875rem;
      color: #6b7280;
      margin-bottom: 1.75rem;
    }
    .meta {
      background: #f9fafb;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: .85rem 1rem;
      margin-bottom: 1.75rem;
      font-size: .8rem;
      color: #6b7280;
      word-break: break-all;
    }
    .meta strong { color: #374151; display: block; margin-bottom: .2rem; }
    .meta + .meta { margin-top: -.75rem; }
    button[type="submit"] {
      width: 100%;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: .8rem 1rem;
      font-size: .95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s;
    }
    button[type="submit"]:hover { background: #333; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Demo fixture</span>
    <h1>Authorize ${clientLabel}?</h1>
    <p class="subtitle">This is a local fixture server used for offline testing.</p>
    <div class="meta">
      <strong>Redirect URI</strong>${safeRedirectUri}
    </div>
    <div class="meta">
      <strong>State</strong>${safeState}
    </div>
    <form method="POST" action="/authorize/approve">
      <input type="hidden" name="code" value="${safeCode}">
      <input type="hidden" name="redirect_uri" value="${safeRedirectUri}">
      <input type="hidden" name="state" value="${safeState}">
      <button type="submit">Approve</button>
    </form>
  </div>
</body>
</html>`);
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
    if (mode === 'token_malformed_json') {
      res.status(200).set('Content-Type', 'application/json').send('{not valid json');
      return;
    }
    if (mode === 'token_no_access_token') {
      res.status(200).json({ token_type: 'Bearer', expires_in: 3600 }); // no access_token
      return;
    }
    if (mode === 'token_error_response') {
      res.status(400).json({ error: 'server_error', error_description: 'forced test error' });
      return;
    }
    if (mode === 'token_no_expires_in') {
      // Return valid token response but without expires_in field
      const accessToken2 = `at-${Math.random().toString(36).slice(2, 18)}`;
      const refreshToken2 = `rt-${Math.random().toString(36).slice(2, 18)}`;
      res.json({ access_token: accessToken2, refresh_token: refreshToken2, token_type: 'Bearer' });
      return;
    }
    if (mode === 'refresh_no_refresh_token') {
      // Return a refresh response without a refresh_token (non-rotating server)
      const grantType = req.body.grant_type as string | undefined;
      if (grantType === 'refresh_token') {
        const accessToken3 = `at-${Math.random().toString(36).slice(2, 18)}`;
        res.json({ access_token: accessToken3, token_type: 'Bearer', expires_in: 3600 });
        return;
      }
    }
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

  // GET /mcp without Authorization → 401 with WWW-Authenticate
  app.get('/mcp', (_req, res) => {
    res.status(401).set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    ).end();
  });

  // POST /mcp — minimal MCP JSON-RPC for tools/list and tools/call
  app.post('/mcp', (req, res) => {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      ).end();
      return;
    }
    const token = auth.slice('Bearer '.length);
    const tokenInfo = accessTokens.get(token);
    if (!tokenInfo || tokenInfo.expiresAt < Date.now()) {
      res.status(401).end();
      return;
    }

    const { id, method, params } = req.body as {
      id: string | number;
      method: string;
      params?: Record<string, unknown>;
    };

    if (method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture-mcp', version: '0.0.0' },
        },
      });
      return;
    }
    if (method === 'tools/list') {
      const toolsList = mode === 'tools_no_description'
        ? [{ name: 'nodesc', inputSchema: { type: 'object' } }] // tool without description field
        : [
            {
              name: 'echo',
              description: 'Echoes back its text input',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
            {
              name: 'add',
              description: 'Adds two numbers',
              inputSchema: {
                type: 'object',
                properties: { a: { type: 'number' }, b: { type: 'number' } },
                required: ['a', 'b'],
              },
            },
            {
              // tool with optional args, array type, description, and missing type
              name: 'search',
              description: 'Search for things',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'The search query' },
                  limit: { type: 'number' },
                },
                // no required → all optional
              },
            },
          ];
      res.json({ jsonrpc: '2.0', id, result: { tools: toolsList } });
      return;
    }
    if (method === 'tools/call') {
      const name = (params as { name: string }).name;
      const args = (params as { arguments: Record<string, unknown> }).arguments;
      if (name === 'echo') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: String(args.text) }] },
        });
        return;
      }
      if (name === 'add') {
        const sum = Number(args.a) + Number(args.b);
        res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: String(sum) }] },
        });
        return;
      }
      if (name === 'search') {
        const query = args.query ? String(args.query) : '(none)';
        const limit = args.limit ? Number(args.limit) : 10;
        res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `searched for "${query}" (limit ${limit})` }] },
        });
        return;
      }
      res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } });
      return;
    }
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
  });

  // /.well-known/oauth-protected-resource (issued by the MCP resource server)
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    if (mode === 'pr_empty_servers') {
      res.json({ resource: `${baseUrl}/mcp` }); // no authorization_servers key
      return;
    }
    if (mode === 'pr_empty_as_url') {
      res.json({ resource: `${baseUrl}/mcp`, authorization_servers: [''] });
      return;
    }
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
    });
  });

  // /.well-known/oauth-authorization-server (issued by the AS)
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    if (mode === 'as_missing_endpoints') {
      // Return metadata that intentionally omits authorization_endpoint and token_endpoint
      res.json({ issuer: baseUrl, registration_endpoint: `${baseUrl}/register` });
      return;
    }
    if (mode === 'as_malformed_json') {
      res.status(200).set('Content-Type', 'application/json').send('{not valid json');
      return;
    }
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
    if (mode === 'register_malformed_json') {
      res.status(200).set('Content-Type', 'application/json').send('{not valid json');
      return;
    }
    if (mode === 'register_no_client_id') {
      res.status(201).json({ redirect_uris: ['http://127.0.0.1/cb'] }); // no client_id
      return;
    }
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
        state: {
          clients,
          codes,
          refreshTokens,
          accessTokens,
          get mode() { return mode; },
          set mode(v: string) { mode = v; },
        },
      });
    });
    server.on('error', reject);
  });
}
