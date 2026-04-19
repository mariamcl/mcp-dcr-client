import express, { type Express } from 'express';
import type { Server } from 'node:http';

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
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
      });
    });
    server.on('error', reject);
  });
}
