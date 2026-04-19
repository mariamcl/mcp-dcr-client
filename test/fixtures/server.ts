import express, { type Express } from 'express';
import type { Server } from 'node:http';

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
  state: {
    clients: Map<string, { redirectUris: string[]; clientName?: string }>;
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
        state: { clients },
      });
    });
    server.on('error', reject);
  });
}
