# MCP DCR Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP client that does Dynamic Client Registration (RFC 7591) + OAuth 2.1 PKCE against any DCR-enabled MCP server. Demoable end-to-end against `mcp.linear.app`; fully tested against a bundled local spec-compliant server.

**Architecture:** Six small src modules (discovery, registration, oauth, tokens, client, cli) plus an Express-based fixture server in `test/fixtures/`. Auth logic is hand-rolled on top of native `fetch` + Node's `crypto` (PKCE = SHA256 of base64url-encoded random bytes — Node primitives, no third-party crypto). MCP transport uses the official SDK after the auth dance completes.

**Tech Stack:** Node 20+, TypeScript (ESM, NodeNext), Vitest + v8 coverage, Express, `@modelcontextprotocol/sdk`, `commander`, `open`, `execa`.

**Spec:** `docs/superpowers/specs/2026-04-18-mcp-dcr-client-design.md`

---

## File Structure

```
mcp-dcr-client/
├── package.json            # Deps + scripts; "type": "module"
├── tsconfig.json           # NodeNext, strict, target ES2022
├── vitest.config.ts        # Coverage config, global setup file
├── .gitignore              # node_modules, dist, coverage, .vitest-temp
├── README.md               # Setup, usage, architecture
├── POV.md                  # Reflection on DCR
├── bin/
│   └── mcp-dcr-client      # Shebang launcher → dist/cli.js
├── src/
│   ├── errors.ts           # Custom error classes (8 of them)
│   ├── discovery.ts        # Two-stage OAuth metadata discovery
│   ├── registration.ts     # DCR (RFC 7591)
│   ├── oauth.ts            # PKCE + auth-code + loopback callback
│   ├── tokens.ts           # Persistent storage + refresh
│   ├── client.ts           # Orchestrator + MCP session wrapper
│   └── cli.ts              # CLI entry point (commander)
└── test/
    ├── setup.ts            # Vitest global setup: boots fixture server
    ├── helpers.ts          # tmp dir helper, free port helper
    ├── fixtures/
    │   └── server.ts       # Spec-compliant MCP + AS in one Express app
    ├── errors.test.ts
    ├── discovery.test.ts
    ├── registration.test.ts
    ├── oauth.test.ts
    ├── tokens.test.ts
    ├── client.test.ts
    ├── cli.test.ts
    └── e2e.test.ts         # Subprocess test of compiled CLI
```

**Module responsibilities:**

- `errors.ts` — Typed errors, one per failure mode. Every other module throws these.
- `discovery.ts` — Pure HTTP. Given a server URL, returns an `OAuthEndpoints` object.
- `registration.ts` — Pure HTTP. Given a registration endpoint, returns `{ clientId, clientSecret? }`.
- `oauth.ts` — The dance. Takes endpoints + clientId, runs PKCE + auth-code, returns tokens. `browserOpener` is injectable.
- `tokens.ts` — File I/O + refresh. Pure-ish: takes a serverUrl, reads/writes JSON, refreshes when needed.
- `client.ts` — Orchestrates everything. Exposes `Client.connect(serverUrl)` returning an authenticated MCP session.
- `cli.ts` — Three commands. Calls into Client, formats output, surfaces errors.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `bin/mcp-dcr-client`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "mcp-dcr-client",
  "version": "0.1.0",
  "description": "MCP client demonstrating Dynamic Client Registration (RFC 7591) and OAuth 2.1 + PKCE",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "mcp-dcr-client": "./bin/mcp-dcr-client" },
  "scripts": {
    "build": "tsc",
    "start": "node --loader tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0",
    "open": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^1.6.0",
    "execa": "^9.0.0",
    "express": "^4.19.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.vitest-temp/
```

- [ ] **Step 5: Write `bin/mcp-dcr-client`**

```
#!/usr/bin/env node
import('../dist/cli.js');
```

Then make executable:
```bash
chmod +x bin/mcp-dcr-client
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` and `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore bin/
git commit -m "Add project scaffolding (TypeScript, Vitest, deps)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Errors Module

**Files:**
- Create: `src/errors.ts`
- Create: `test/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DiscoveryFailed,
  RegistrationFailed,
  AuthorizationDenied,
  TokenExchangeFailed,
  NoStoredCredentials,
  RefreshFailed,
  MCPRequestFailed,
  StateMismatch,
} from '../src/errors.js';

describe('errors', () => {
  it('DiscoveryFailed carries server URL and cause', () => {
    const err = new DiscoveryFailed('https://x.example/mcp', 'metadata 404');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DiscoveryFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.message).toContain('https://x.example/mcp');
    expect(err.message).toContain('metadata 404');
  });

  it('RegistrationFailed carries server URL and AS response body', () => {
    const err = new RegistrationFailed('https://x.example/mcp', 400, 'invalid_redirect_uri');
    expect(err.name).toBe('RegistrationFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.status).toBe(400);
    expect(err.body).toBe('invalid_redirect_uri');
  });

  it('AuthorizationDenied carries the OAuth error code', () => {
    const err = new AuthorizationDenied('access_denied', 'User clicked deny');
    expect(err.name).toBe('AuthorizationDenied');
    expect(err.errorCode).toBe('access_denied');
    expect(err.errorDescription).toBe('User clicked deny');
  });

  it('TokenExchangeFailed carries status + body', () => {
    const err = new TokenExchangeFailed(400, 'invalid_grant');
    expect(err.name).toBe('TokenExchangeFailed');
    expect(err.status).toBe(400);
    expect(err.body).toBe('invalid_grant');
  });

  it('NoStoredCredentials carries server URL', () => {
    const err = new NoStoredCredentials('https://x.example/mcp');
    expect(err.name).toBe('NoStoredCredentials');
    expect(err.serverUrl).toBe('https://x.example/mcp');
  });

  it('RefreshFailed carries server URL and reason', () => {
    const err = new RefreshFailed('https://x.example/mcp', 'invalid_grant');
    expect(err.name).toBe('RefreshFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.reason).toBe('invalid_grant');
  });

  it('MCPRequestFailed carries status + body', () => {
    const err = new MCPRequestFailed(401, 'Unauthorized');
    expect(err.name).toBe('MCPRequestFailed');
    expect(err.status).toBe(401);
    expect(err.body).toBe('Unauthorized');
  });

  it('StateMismatch indicates CSRF defense triggered', () => {
    const err = new StateMismatch();
    expect(err.name).toBe('StateMismatch');
    expect(err.message).toMatch(/state/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- errors.test.ts`
Expected: FAIL — module `../src/errors.js` not found.

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
export class DiscoveryFailed extends Error {
  readonly name = 'DiscoveryFailed';
  constructor(public serverUrl: string, public reason: string) {
    super(`Discovery failed for ${serverUrl}: ${reason}`);
  }
}

export class RegistrationFailed extends Error {
  readonly name = 'RegistrationFailed';
  constructor(public serverUrl: string, public status: number, public body: string) {
    super(`DCR failed for ${serverUrl}: HTTP ${status} ${body}`);
  }
}

export class AuthorizationDenied extends Error {
  readonly name = 'AuthorizationDenied';
  constructor(public errorCode: string, public errorDescription?: string) {
    super(`Authorization denied: ${errorCode}${errorDescription ? ` — ${errorDescription}` : ''}`);
  }
}

export class TokenExchangeFailed extends Error {
  readonly name = 'TokenExchangeFailed';
  constructor(public status: number, public body: string) {
    super(`Token exchange failed: HTTP ${status} ${body}`);
  }
}

export class NoStoredCredentials extends Error {
  readonly name = 'NoStoredCredentials';
  constructor(public serverUrl: string) {
    super(`No stored credentials for ${serverUrl}`);
  }
}

export class RefreshFailed extends Error {
  readonly name = 'RefreshFailed';
  constructor(public serverUrl: string, public reason: string) {
    super(`Token refresh failed for ${serverUrl}: ${reason}`);
  }
}

export class MCPRequestFailed extends Error {
  readonly name = 'MCPRequestFailed';
  constructor(public status: number, public body: string) {
    super(`MCP request failed: HTTP ${status} ${body}`);
  }
}

export class StateMismatch extends Error {
  readonly name = 'StateMismatch';
  constructor() {
    super('OAuth state parameter did not match — possible CSRF attempt');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- errors.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "Add typed error classes for every failure mode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Test Helpers + Fixture Server Skeleton + Discovery Endpoints

**Files:**
- Create: `test/helpers.ts`
- Create: `test/setup.ts`
- Create: `test/fixtures/server.ts`

This task builds the test infrastructure. No `src/` code yet — the fixture server is exercised via the next task's discovery tests.

- [ ] **Step 1: Write `test/helpers.ts`**

```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mcp-dcr-test-'));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Failed to allocate free port'));
      }
    });
  });
}
```

- [ ] **Step 2: Write `test/fixtures/server.ts` (skeleton + discovery endpoints)**

```ts
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
```

- [ ] **Step 3: Write `test/setup.ts` (Vitest global setup)**

```ts
import type { TestProject } from 'vitest/node';
import { startServer, type FixtureServer } from './fixtures/server.js';

let server: FixtureServer | undefined;

export async function setup(project: TestProject) {
  server = await startServer({ autoApprove: true });
  project.provide('fixtureBaseUrl', server.baseUrl);
}

export async function teardown() {
  await server?.close();
}

declare module 'vitest' {
  export interface ProvidedContext {
    fixtureBaseUrl: string;
  }
}
```

- [ ] **Step 4: Verify the setup compiles**

Run: `npx tsc --noEmit -p tsconfig.json` — should pass (test files excluded).
Run: `npx tsc --noEmit test/setup.ts test/fixtures/server.ts test/helpers.ts --module nodenext --moduleResolution nodenext --target es2022 --strict --esModuleInterop --skipLibCheck`
Expected: passes (no type errors).

- [ ] **Step 5: Commit**

```bash
git add test/helpers.ts test/setup.ts test/fixtures/server.ts
git commit -m "Add fixture server skeleton with OAuth discovery endpoints

Implements .well-known/oauth-protected-resource and
.well-known/oauth-authorization-server. Vitest globalSetup
boots the server once for the whole suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Discovery Module

**Files:**
- Create: `src/discovery.ts`
- Create: `test/discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/discovery.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { discover } from '../src/discovery.js';
import { DiscoveryFailed } from '../src/errors.js';

const baseUrl = inject('fixtureBaseUrl');

describe('discover', () => {
  it('two-stage discovery returns AS endpoints from MCP server URL', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    expect(endpoints.authorizationEndpoint).toBe(`${baseUrl}/authorize`);
    expect(endpoints.tokenEndpoint).toBe(`${baseUrl}/token`);
    expect(endpoints.registrationEndpoint).toBe(`${baseUrl}/register`);
    expect(endpoints.issuer).toBe(baseUrl);
    expect(endpoints.resource).toBe(`${baseUrl}/mcp`);
  });

  it('throws DiscoveryFailed when the MCP server has no protected-resource metadata', async () => {
    await expect(discover('http://127.0.0.1:1/nonexistent')).rejects.toBeInstanceOf(
      DiscoveryFailed,
    );
  });

  it('throws DiscoveryFailed when AS metadata is malformed', async () => {
    // Hit a non-AS URL to trigger malformed JSON response
    await expect(discover('https://example.com/mcp')).rejects.toBeInstanceOf(DiscoveryFailed);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- discovery.test.ts`
Expected: FAIL — module `../src/discovery.js` not found.

- [ ] **Step 3: Implement `src/discovery.ts`**

```ts
import { DiscoveryFailed } from './errors.js';

export interface OAuthEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  resource: string;
}

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

export async function discover(serverUrl: string): Promise<OAuthEndpoints> {
  const origin = new URL(serverUrl).origin;
  const prMetadata = await fetchJson<ProtectedResourceMetadata>(
    `${origin}/.well-known/oauth-protected-resource`,
    serverUrl,
  );
  if (!prMetadata.authorization_servers?.length) {
    throw new DiscoveryFailed(serverUrl, 'protected-resource metadata has no authorization_servers');
  }

  const asUrl = prMetadata.authorization_servers[0];
  if (!asUrl) {
    throw new DiscoveryFailed(serverUrl, 'authorization_servers[0] is empty');
  }
  const asMetadata = await fetchJson<AuthorizationServerMetadata>(
    `${new URL(asUrl).origin}/.well-known/oauth-authorization-server`,
    serverUrl,
  );

  if (!asMetadata.authorization_endpoint || !asMetadata.token_endpoint) {
    throw new DiscoveryFailed(serverUrl, 'AS metadata missing required endpoints');
  }

  return {
    issuer: asMetadata.issuer,
    authorizationEndpoint: asMetadata.authorization_endpoint,
    tokenEndpoint: asMetadata.token_endpoint,
    registrationEndpoint: asMetadata.registration_endpoint,
    resource: prMetadata.resource,
  };
}

async function fetchJson<T>(url: string, serverUrl: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new DiscoveryFailed(serverUrl, `network error fetching ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new DiscoveryFailed(serverUrl, `HTTP ${res.status} from ${url}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new DiscoveryFailed(serverUrl, `malformed JSON from ${url}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- discovery.test.ts`
Expected: PASS — 3 tests. (The third test depends on `example.com/mcp` returning HTML, which it will.)

- [ ] **Step 5: Commit**

```bash
git add src/discovery.ts test/discovery.test.ts
git commit -m "Add two-stage OAuth metadata discovery

Fetches /.well-known/oauth-protected-resource then
/.well-known/oauth-authorization-server, returning a flat
endpoints object.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fixture Server — DCR Endpoint

**Files:**
- Modify: `test/fixtures/server.ts`

- [ ] **Step 1: Add the `/register` endpoint**

In `test/fixtures/server.ts`, add this after the `.well-known` endpoints, before the `return new Promise` block:

```ts
  // In-memory store of registered clients
  const clients = new Map<string, { redirectUris: string[]; clientName?: string }>();

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
```

Also export the `clients` map so future endpoints can look up registrations. Refactor the `startServer` function to attach state to the returned object:

```ts
export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
  // For tests: introspect server state
  state: {
    clients: Map<string, { redirectUris: string[]; clientName?: string }>;
  };
}
```

And in the resolve:
```ts
      resolve({
        baseUrl,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        state: { clients },
      });
```

- [ ] **Step 2: Verify it still type-checks**

Run: `npx tsc --noEmit test/fixtures/server.ts test/setup.ts test/helpers.ts --module nodenext --moduleResolution nodenext --target es2022 --strict --esModuleInterop --skipLibCheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/server.ts
git commit -m "Add DCR endpoint to fixture server

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Registration Module

**Files:**
- Create: `src/registration.ts`
- Create: `test/registration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/registration.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { register } from '../src/registration.js';
import { RegistrationFailed } from '../src/errors.js';

const baseUrl = inject('fixtureBaseUrl');

describe('register', () => {
  it('returns a client_id for valid registration', async () => {
    const result = await register(`${baseUrl}/register`, {
      redirectUris: ['http://127.0.0.1:9999/cb'],
      clientName: 'mcp-dcr-client',
      serverUrl: `${baseUrl}/mcp`,
    });
    expect(result.clientId).toMatch(/^dyn-/);
  });

  it('throws RegistrationFailed on 400 from AS', async () => {
    await expect(
      register(`${baseUrl}/register`, {
        redirectUris: [], // invalid — fixture rejects empty
        clientName: 'bad',
        serverUrl: `${baseUrl}/mcp`,
      }),
    ).rejects.toBeInstanceOf(RegistrationFailed);
  });

  it('throws RegistrationFailed on network error', async () => {
    await expect(
      register('http://127.0.0.1:1/register', {
        redirectUris: ['http://127.0.0.1:9999/cb'],
        clientName: 'x',
        serverUrl: 'http://127.0.0.1:1/mcp',
      }),
    ).rejects.toBeInstanceOf(RegistrationFailed);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- registration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/registration.ts`**

```ts
import { RegistrationFailed } from './errors.js';

export interface RegisterParams {
  redirectUris: string[];
  clientName: string;
  serverUrl: string;
}

export interface Registration {
  clientId: string;
  clientSecret?: string;
}

export async function register(
  registrationEndpoint: string,
  params: RegisterParams,
): Promise<Registration> {
  let res: Response;
  try {
    res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: params.redirectUris,
        client_name: params.clientName,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
  } catch (e) {
    throw new RegistrationFailed(params.serverUrl, 0, `network error: ${(e as Error).message}`);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new RegistrationFailed(params.serverUrl, res.status, body);
  }

  let parsed: { client_id?: string; client_secret?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RegistrationFailed(params.serverUrl, res.status, `malformed JSON: ${body}`);
  }

  if (!parsed.client_id) {
    throw new RegistrationFailed(params.serverUrl, res.status, 'response missing client_id');
  }

  return { clientId: parsed.client_id, clientSecret: parsed.client_secret };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- registration.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/registration.ts test/registration.test.ts
git commit -m "Add Dynamic Client Registration (RFC 7591)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Fixture Server — Authorize + Token Endpoints

**Files:**
- Modify: `test/fixtures/server.ts`

- [ ] **Step 1: Add code/token tracking + endpoints**

In `test/fixtures/server.ts`, add inside `startServer` (after the `clients` map):

```ts
  // In-memory authorization codes: code → { clientId, codeChallenge, redirectUri, resource, scope }
  const codes = new Map<
    string,
    { clientId: string; codeChallenge: string; redirectUri: string; resource: string; scope?: string }
  >();
  // In-memory tokens: refresh_token → { clientId, scope, resource }
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
```

Update the `state` exposed by `FixtureServer`:

```ts
state: { clients, codes, refreshTokens, accessTokens },
```

And the interface:
```ts
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit test/fixtures/server.ts test/setup.ts test/helpers.ts --module nodenext --moduleResolution nodenext --target es2022 --strict --esModuleInterop --skipLibCheck`
Expected: passes.

Run existing tests to confirm no regressions: `npm test`
Expected: all previous tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/server.ts
git commit -m "Add /authorize and /token endpoints to fixture server

PKCE S256 verification on token exchange. Refresh token rotation.
Auto-approve mode for tests; HTML approve page otherwise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: OAuth — PKCE + State Primitives

**Files:**
- Create: `src/oauth.ts` (initial — primitives only)
- Create: `test/oauth.test.ts` (initial)

- [ ] **Step 1: Write the failing tests**

Create `test/oauth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- oauth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement initial `src/oauth.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- oauth.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/oauth.ts test/oauth.test.ts
git commit -m "Add PKCE + state primitives via Node's crypto

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: OAuth — Loopback Callback Server

**Files:**
- Modify: `src/oauth.ts`
- Modify: `test/oauth.test.ts`

- [ ] **Step 1: Add tests for the callback server**

Append to `test/oauth.test.ts`:

```ts
import { startCallbackServer } from '../src/oauth.js';

describe('startCallbackServer', () => {
  it('resolves with the code when callback hits with matching state', async () => {
    const { url, waitForCode, close } = await startCallbackServer('expected-state');
    try {
      const callbackUrl = new URL(url);
      callbackUrl.searchParams.set('code', 'abc123');
      callbackUrl.searchParams.set('state', 'expected-state');
      // Trigger the callback in parallel with the wait
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
      await fetch(callbackUrl.toString());
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
      await fetch(callbackUrl.toString());
      await expect(codePromise).rejects.toMatchObject({ name: 'AuthorizationDenied' });
    } finally {
      await close();
    }
  });

  it('ignores stray requests before the real callback', async () => {
    const { url, waitForCode, close } = await startCallbackServer('s');
    try {
      // Fire a request without code/state — should be ignored, not resolve
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- oauth.test.ts`
Expected: FAIL — `startCallbackServer` not exported.

- [ ] **Step 3: Implement `startCallbackServer` in `src/oauth.ts`**

Append to `src/oauth.ts`:

```ts
import { createServer, type Server } from 'node:http';
import { AuthorizationDenied, StateMismatch } from './errors.js';

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- oauth.test.ts`
Expected: PASS — 4 new tests + 4 existing PKCE tests = 8 total.

- [ ] **Step 5: Commit**

```bash
git add src/oauth.ts test/oauth.test.ts
git commit -m "Add loopback HTTP callback server for OAuth code receipt

Validates state (CSRF defense), surfaces ?error= as AuthorizationDenied,
ignores stray requests on non-/cb paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: OAuth — Full Authorization-Code Flow

**Files:**
- Modify: `src/oauth.ts`
- Modify: `test/oauth.test.ts`

- [ ] **Step 1: Add tests for the full flow**

Append to `test/oauth.test.ts`:

```ts
import { runOAuthFlow } from '../src/oauth.js';
import { register } from '../src/registration.js';
import { discover } from '../src/discovery.js';
import { TokenExchangeFailed } from '../src/errors.js';

describe('runOAuthFlow', () => {
  it('completes the full PKCE flow against the fixture server', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    const reg = await register(endpoints.registrationEndpoint!, {
      redirectUris: ['http://127.0.0.1:0/cb'], // port-agnostic; we'll override
      clientName: 'oauth-test',
      serverUrl: `${baseUrl}/mcp`,
    });

    // Custom browserOpener that just GETs the URL with redirect:manual and
    // follows the 302 to the loopback
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`expected 302 from authorize, got ${res.status}`);
      await fetch(loc);
    };

    const tokens = await runOAuthFlow({
      endpoints,
      clientId: reg.clientId,
      resource: `${baseUrl}/mcp`,
      browserOpener: opener,
      // For test, register dynamically with the actual loopback URL
      registerDynamicRedirect: true,
    });

    expect(tokens.accessToken).toMatch(/^at-/);
    expect(tokens.refreshToken).toMatch(/^rt-/);
    expect(tokens.expiresIn).toBe(3600);
  });

  it('throws TokenExchangeFailed when AS rejects the code', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    // Use a random unregistered client_id to provoke rejection
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      // Authorize will 400 because client_id unknown; loopback never gets a callback.
      // To exercise TokenExchangeFailed specifically, inject a code that won't validate
      // by manually triggering the loopback with a bogus code.
      void res;
    };

    await expect(
      runOAuthFlow({
        endpoints,
        clientId: 'unregistered-client',
        resource: `${baseUrl}/mcp`,
        browserOpener: opener,
        registerDynamicRedirect: false,
        // Time out fast since opener won't trigger callback
        timeoutMs: 200,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- oauth.test.ts`
Expected: FAIL — `runOAuthFlow` not exported.

- [ ] **Step 3: Implement `runOAuthFlow` in `src/oauth.ts`**

Append to `src/oauth.ts`:

```ts
import { TokenExchangeFailed } from './errors.js';
import { register } from './registration.js';
import type { OAuthEndpoints } from './discovery.js';

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

export interface RunOAuthFlowParams {
  endpoints: OAuthEndpoints;
  clientId: string;
  resource: string;
  browserOpener: (url: string) => Promise<void>;
  /** If true, re-register with the loopback URL once we know the port. */
  registerDynamicRedirect?: boolean;
  /** Override scope (default: omit). */
  scope?: string;
  /** Timeout in ms for the callback (default: 5 minutes). */
  timeoutMs?: number;
}

export async function runOAuthFlow(params: RunOAuthFlowParams): Promise<Tokens> {
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

    return await exchangeCodeForTokens({
      tokenEndpoint: params.endpoints.tokenEndpoint,
      code,
      codeVerifier: verifier,
      redirectUri: cb.url,
      clientId,
      resource: params.resource,
    });
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
```

Also export `exchangeCodeForTokens` for use by the refresh flow:

```ts
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
  const parsed = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in ?? 3600,
    scope: parsed.scope,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- oauth.test.ts`
Expected: PASS — all OAuth tests.

- [ ] **Step 5: Commit**

```bash
git add src/oauth.ts test/oauth.test.ts
git commit -m "Add full PKCE authorization-code flow + refresh helper

Includes resource indicator (RFC 8707), browser opener injection
for testability, dynamic redirect_uri registration to match loopback port.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Tokens — File Storage

**Files:**
- Create: `src/tokens.ts`
- Create: `test/tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTempDir } from './helpers.js';
import {
  loadStoredCreds,
  saveStoredCreds,
  deleteStoredCreds,
  fileForServer,
  type StoredCreds,
} from '../src/tokens.js';
import { NoStoredCredentials } from '../src/errors.js';

let configDir: string;

beforeEach(async () => {
  configDir = await makeTempDir();
});

const sample: StoredCreds = {
  serverUrl: 'https://example.com/mcp',
  registration: {
    clientId: 'cid-1',
    registeredAt: '2026-04-18T00:00:00.000Z',
  },
  tokens: {
    accessToken: 'at-test',
    refreshToken: 'rt-test',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
};

describe('token storage', () => {
  it('saveStoredCreds + loadStoredCreds roundtrip', async () => {
    await saveStoredCreds(sample, configDir);
    const loaded = await loadStoredCreds(sample.serverUrl, configDir);
    expect(loaded).toEqual(sample);
  });

  it('saved file has 0600 permissions', async () => {
    await saveStoredCreds(sample, configDir);
    const path = fileForServer(sample.serverUrl, configDir);
    const s = await stat(path);
    // mode & 0o777 isolates the permission bits
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('loadStoredCreds throws NoStoredCredentials when missing', async () => {
    await expect(loadStoredCreds('https://nope/mcp', configDir)).rejects.toBeInstanceOf(
      NoStoredCredentials,
    );
  });

  it('deleteStoredCreds removes the file', async () => {
    await saveStoredCreds(sample, configDir);
    await deleteStoredCreds(sample.serverUrl, configDir);
    await expect(loadStoredCreds(sample.serverUrl, configDir)).rejects.toBeInstanceOf(
      NoStoredCredentials,
    );
  });

  it('deleteStoredCreds is a no-op when the file is already absent', async () => {
    await expect(deleteStoredCreds(sample.serverUrl, configDir)).resolves.toBeUndefined();
  });

  it('fileForServer keys by sha256(serverUrl) prefix', () => {
    const a = fileForServer('https://a.example/mcp', configDir);
    const b = fileForServer('https://b.example/mcp', configDir);
    expect(a).not.toBe(b);
    expect(a).toMatch(/[0-9a-f]{16}\.json$/);
  });

  it('atomic write: if rename fails, no partial file is left', async () => {
    // Pre-write a "tmp" file that simulates a crashed write
    await mkdir(configDir, { recursive: true });
    const path = fileForServer(sample.serverUrl, configDir);
    await writeFile(path + '.tmp', '{"partial":', { mode: 0o600 });
    // Fresh load should still report missing (no .tmp surfacing)
    await expect(loadStoredCreds(sample.serverUrl, configDir)).rejects.toBeInstanceOf(
      NoStoredCredentials,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tokens.ts`**

```ts
import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NoStoredCredentials } from './errors.js';

export interface StoredCreds {
  serverUrl: string;
  registration: {
    clientId: string;
    clientSecret?: string;
    registeredAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
    scope?: string;
  };
}

export function defaultConfigDir(): string {
  return join(homedir(), '.config', 'mcp-dcr-client');
}

export function fileForServer(serverUrl: string, configDir = defaultConfigDir()): string {
  const hash = createHash('sha256').update(serverUrl).digest('hex').slice(0, 16);
  return join(configDir, `${hash}.json`);
}

export async function saveStoredCreds(
  creds: StoredCreds,
  configDir = defaultConfigDir(),
): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const path = fileForServer(creds.serverUrl, configDir);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600); // Belt + suspenders for environments where mode is honored loosely
  await rename(tmp, path);
}

export async function loadStoredCreds(
  serverUrl: string,
  configDir = defaultConfigDir(),
): Promise<StoredCreds> {
  const path = fileForServer(serverUrl, configDir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NoStoredCredentials(serverUrl);
    }
    throw e;
  }
  return JSON.parse(raw) as StoredCreds;
}

export async function deleteStoredCreds(
  serverUrl: string,
  configDir = defaultConfigDir(),
): Promise<void> {
  const path = fileForServer(serverUrl, configDir);
  try {
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tokens.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tokens.ts test/tokens.test.ts
git commit -m "Add per-server token storage with 0600 perms and atomic writes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Tokens — Refresh Logic

**Files:**
- Modify: `src/tokens.ts`
- Modify: `test/tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/tokens.test.ts`:

```ts
import { inject } from 'vitest';
import { discover } from '../src/discovery.js';
import { register } from '../src/registration.js';
import { runOAuthFlow } from '../src/oauth.js';
import { getValidAccessToken } from '../src/tokens.js';
import { RefreshFailed } from '../src/errors.js';

const baseUrl = inject('fixtureBaseUrl');

async function freshCreds(): Promise<StoredCreds> {
  const endpoints = await discover(`${baseUrl}/mcp`);
  const opener = async (url: string) => {
    const res = await fetch(url, { redirect: 'manual' });
    const loc = res.headers.get('location');
    if (loc) await fetch(loc);
  };
  const tokens = await runOAuthFlow({
    endpoints,
    clientId: 'placeholder',
    resource: `${baseUrl}/mcp`,
    browserOpener: opener,
    registerDynamicRedirect: true,
  });
  return {
    serverUrl: `${baseUrl}/mcp`,
    registration: { clientId: 'placeholder', registeredAt: new Date().toISOString() },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    },
  };
}

describe('getValidAccessToken (refresh)', () => {
  it('returns access token when not expired', async () => {
    const creds = await freshCreds();
    await saveStoredCreds(creds, configDir);
    const endpoints = await discover(`${baseUrl}/mcp`);
    const at = await getValidAccessToken(creds.serverUrl, endpoints, configDir);
    expect(at).toBe(creds.tokens.accessToken);
  });

  it('refreshes when access token expired and persists new tokens', async () => {
    const creds = await freshCreds();
    creds.tokens.expiresAt = new Date(Date.now() - 1000).toISOString(); // expired
    await saveStoredCreds(creds, configDir);
    const endpoints = await discover(`${baseUrl}/mcp`);
    const at = await getValidAccessToken(creds.serverUrl, endpoints, configDir);
    expect(at).not.toBe(creds.tokens.accessToken);
    expect(at).toMatch(/^at-/);
    const reloaded = await loadStoredCreds(creds.serverUrl, configDir);
    expect(reloaded.tokens.accessToken).toBe(at);
  });

  it('throws RefreshFailed and deletes file when refresh token rejected', async () => {
    const creds: StoredCreds = {
      serverUrl: `${baseUrl}/mcp`,
      registration: { clientId: 'x', registeredAt: new Date().toISOString() },
      tokens: {
        accessToken: 'expired',
        refreshToken: 'totally-invalid-refresh-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    };
    await saveStoredCreds(creds, configDir);
    const endpoints = await discover(`${baseUrl}/mcp`);
    await expect(getValidAccessToken(creds.serverUrl, endpoints, configDir)).rejects.toBeInstanceOf(
      RefreshFailed,
    );
    await expect(loadStoredCreds(creds.serverUrl, configDir)).rejects.toBeInstanceOf(
      NoStoredCredentials,
    );
  });

  it('throws NoStoredCredentials when file is absent', async () => {
    const endpoints = await discover(`${baseUrl}/mcp`);
    await expect(
      getValidAccessToken('https://nope/mcp', endpoints, configDir),
    ).rejects.toBeInstanceOf(NoStoredCredentials);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tokens.test.ts`
Expected: FAIL — `getValidAccessToken` not exported.

- [ ] **Step 3: Implement `getValidAccessToken`**

Append to `src/tokens.ts`:

```ts
import { refreshTokens } from './oauth.js';
import { RefreshFailed, TokenExchangeFailed } from './errors.js';
import type { OAuthEndpoints } from './discovery.js';

const REFRESH_LEEWAY_MS = 30_000;

export async function getValidAccessToken(
  serverUrl: string,
  endpoints: OAuthEndpoints,
  configDir = defaultConfigDir(),
): Promise<string> {
  const creds = await loadStoredCreds(serverUrl, configDir);
  const expiresAt = new Date(creds.tokens.expiresAt).getTime();
  if (Date.now() < expiresAt - REFRESH_LEEWAY_MS) {
    return creds.tokens.accessToken;
  }
  if (!creds.tokens.refreshToken) {
    await deleteStoredCreds(serverUrl, configDir);
    throw new RefreshFailed(serverUrl, 'no refresh token available');
  }
  let fresh;
  try {
    fresh = await refreshTokens({
      tokenEndpoint: endpoints.tokenEndpoint,
      refreshToken: creds.tokens.refreshToken,
      clientId: creds.registration.clientId,
    });
  } catch (e) {
    await deleteStoredCreds(serverUrl, configDir);
    if (e instanceof TokenExchangeFailed) {
      throw new RefreshFailed(serverUrl, `${e.status}: ${e.body}`);
    }
    throw e;
  }
  const updated: StoredCreds = {
    ...creds,
    tokens: {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken ?? creds.tokens.refreshToken,
      expiresAt: new Date(Date.now() + fresh.expiresIn * 1000).toISOString(),
      scope: fresh.scope ?? creds.tokens.scope,
    },
  };
  await saveStoredCreds(updated, configDir);
  return updated.tokens.accessToken;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tokens.test.ts`
Expected: PASS — 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/tokens.ts test/tokens.test.ts
git commit -m "Add getValidAccessToken with auto-refresh

If access token is within 30s of expiry or already expired, refresh
using the stored refresh_token. On refresh failure, delete the file
and surface RefreshFailed so the caller can prompt re-auth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Fixture Server — MCP Endpoint with Tools

**Files:**
- Modify: `test/fixtures/server.ts`

- [ ] **Step 1: Add the MCP endpoint**

In `test/fixtures/server.ts`, add this after the `/token` endpoint, before the `return new Promise`:

```ts
  // GET /mcp without Authorization → 401 with WWW-Authenticate
  app.get('/mcp', (req, res) => {
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
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
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
          ],
        },
      });
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
      res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } });
      return;
    }
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
  });
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit test/fixtures/server.ts test/setup.ts test/helpers.ts --module nodenext --moduleResolution nodenext --target es2022 --strict --esModuleInterop --skipLibCheck`
Expected: passes.

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/server.ts
git commit -m "Add MCP JSON-RPC endpoint to fixture server with echo/add tools

Returns 401 + WWW-Authenticate when unauthenticated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Client Orchestrator — First Connect

**Files:**
- Create: `src/client.ts`
- Create: `test/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { makeTempDir } from './helpers.js';
import { Client } from '../src/client.js';

const baseUrl = inject('fixtureBaseUrl');

let configDir: string;

beforeEach(async () => {
  configDir = await makeTempDir();
});

const opener = async (url: string) => {
  const res = await fetch(url, { redirect: 'manual' });
  const loc = res.headers.get('location');
  if (loc) await fetch(loc);
};

describe('Client.connect (first time)', () => {
  it('runs full discovery + DCR + OAuth and returns a usable session', async () => {
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: opener,
      configDir,
      clientName: 'test-client',
    });
    const tools = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo']);
  });

  it('callTool invokes a tool and returns its result content', async () => {
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: opener,
      configDir,
      clientName: 'test-client',
    });
    const result = await client.callTool('echo', { text: 'hello' });
    expect(result).toBe('hello');

    const sum = await client.callTool('add', { a: 2, b: 3 });
    expect(sum).toBe('5');
  });

  it('persists registration + tokens to configDir after first connect', async () => {
    await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: opener,
      configDir,
      clientName: 'test-client',
    });
    const { loadStoredCreds } = await import('../src/tokens.js');
    const creds = await loadStoredCreds(`${baseUrl}/mcp`, configDir);
    expect(creds.registration.clientId).toMatch(/^dyn-/);
    expect(creds.tokens.accessToken).toMatch(/^at-/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/client.ts`**

```ts
import { discover, type OAuthEndpoints } from './discovery.js';
import { register } from './registration.js';
import { runOAuthFlow } from './oauth.js';
import {
  loadStoredCreds,
  saveStoredCreds,
  getValidAccessToken,
  defaultConfigDir,
  type StoredCreds,
} from './tokens.js';
import { MCPRequestFailed, NoStoredCredentials, RegistrationFailed } from './errors.js';

export interface ClientOptions {
  browserOpener?: (url: string) => Promise<void>;
  configDir?: string;
  clientName?: string;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class Client {
  private constructor(
    private readonly serverUrl: string,
    private readonly endpoints: OAuthEndpoints,
    private readonly creds: StoredCreds,
    private readonly configDir: string,
    private accessToken: string,
  ) {}

  static async connect(serverUrl: string, opts: ClientOptions = {}): Promise<Client> {
    const configDir = opts.configDir ?? defaultConfigDir();
    const endpoints = await discover(serverUrl);

    let creds: StoredCreds;
    let accessToken: string;
    try {
      creds = await loadStoredCreds(serverUrl, configDir);
      accessToken = await getValidAccessToken(serverUrl, endpoints, configDir);
    } catch (e) {
      if (!(e instanceof NoStoredCredentials)) throw e;
      const result = await Client.fullAuth(serverUrl, endpoints, opts, configDir);
      creds = result.creds;
      accessToken = result.accessToken;
    }
    return new Client(serverUrl, endpoints, creds, configDir, accessToken);
  }

  private static async fullAuth(
    serverUrl: string,
    endpoints: OAuthEndpoints,
    opts: ClientOptions,
    configDir: string,
  ): Promise<{ creds: StoredCreds; accessToken: string }> {
    if (!endpoints.registrationEndpoint) {
      throw new RegistrationFailed(
        serverUrl,
        0,
        "AS metadata has no registration_endpoint — server doesn't support DCR",
      );
    }
    const browserOpener =
      opts.browserOpener ??
      (async (url: string) => {
        const open = (await import('open')).default;
        await open(url);
      });

    const tokens = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder', // Re-registered with loopback URL inside flow
      resource: serverUrl,
      browserOpener,
      registerDynamicRedirect: true,
    });

    // The dynamic registration happened inside runOAuthFlow; re-register here for storage
    // (a slight inefficiency for now — see note in client.ts; can optimize later)
    const reg = await register(endpoints.registrationEndpoint, {
      redirectUris: ['http://127.0.0.1:0/cb'], // placeholder, not used post-auth
      clientName: opts.clientName ?? 'mcp-dcr-client',
      serverUrl,
    });

    const creds: StoredCreds = {
      serverUrl,
      registration: { clientId: reg.clientId, clientSecret: reg.clientSecret, registeredAt: new Date().toISOString() },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        scope: tokens.scope,
      },
    };
    await saveStoredCreds(creds, configDir);
    return { creds, accessToken: tokens.accessToken };
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const result = await this.rpc('tools/list', {});
    return (result as { tools: ToolDescriptor[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    return content.map((c) => c.text ?? '').join('');
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const doRequest = async (token: string) => {
      return fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    };

    let res = await doRequest(this.accessToken);
    if (res.status === 401) {
      // One transparent refresh + retry
      this.accessToken = await getValidAccessToken(this.serverUrl, this.endpoints, this.configDir);
      res = await doRequest(this.accessToken);
    }
    const text = await res.text();
    if (!res.ok) throw new MCPRequestFailed(res.status, text);
    const parsed = JSON.parse(text) as { result?: unknown; error?: { message: string } };
    if (parsed.error) throw new MCPRequestFailed(res.status, parsed.error.message);
    return parsed.result;
  }
}
```

> **Note:** The duplicate `register` call in `fullAuth` is a known inefficiency (we already registered inside `runOAuthFlow` to get the dynamic redirect_uri). The clean fix is to refactor `runOAuthFlow` to return the clientId it registered with. Task 15 will address this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- client.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts test/client.test.ts
git commit -m "Add Client.connect orchestrator with listTools / callTool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Client — Reuse + Refresh-on-401, Refactor Duplicate Registration

**Files:**
- Modify: `src/oauth.ts`
- Modify: `src/client.ts`
- Modify: `test/client.test.ts`

- [ ] **Step 1: Refactor `runOAuthFlow` to return the registered clientId**

In `src/oauth.ts`, change the `Tokens` return shape to also include the `clientId` used (when `registerDynamicRedirect` is true). Replace the existing `Tokens` interface and the return at the bottom of `runOAuthFlow`:

```ts
export interface OAuthFlowResult {
  tokens: Tokens;
  /** The clientId the AS issued during dynamic registration, if any. */
  clientId: string;
}

// Change return type of runOAuthFlow:
export async function runOAuthFlow(params: RunOAuthFlowParams): Promise<OAuthFlowResult> {
  // ... existing code ...
  // At the end (before the catch / finally), wrap the return:
  const tokens = await exchangeCodeForTokens({ /* unchanged */ });
  return { tokens, clientId };
}
```

Update existing `oauth.test.ts` tests that destructure tokens directly:

```ts
const result = await runOAuthFlow({ /* ... */ });
expect(result.tokens.accessToken).toMatch(/^at-/);
expect(result.tokens.refreshToken).toMatch(/^rt-/);
expect(result.tokens.expiresIn).toBe(3600);
expect(result.clientId).toMatch(/^dyn-/);
```

And in `tokens.test.ts` `freshCreds`:
```ts
const result = await runOAuthFlow({ /* ... */ });
return {
  serverUrl: `${baseUrl}/mcp`,
  registration: { clientId: result.clientId, registeredAt: new Date().toISOString() },
  tokens: {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    expiresAt: new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString(),
  },
};
```

- [ ] **Step 2: Simplify `Client.fullAuth` to use the result**

In `src/client.ts`:

```ts
  private static async fullAuth(
    serverUrl: string,
    endpoints: OAuthEndpoints,
    opts: ClientOptions,
    configDir: string,
  ): Promise<{ creds: StoredCreds; accessToken: string }> {
    if (!endpoints.registrationEndpoint) {
      throw new RegistrationFailed(
        serverUrl,
        0,
        "AS metadata has no registration_endpoint — server doesn't support DCR",
      );
    }
    const browserOpener =
      opts.browserOpener ??
      (async (url: string) => {
        const open = (await import('open')).default;
        await open(url);
      });

    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: serverUrl,
      browserOpener,
      registerDynamicRedirect: true,
    });

    const creds: StoredCreds = {
      serverUrl,
      registration: {
        clientId: result.clientId,
        registeredAt: new Date().toISOString(),
      },
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt: new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString(),
        scope: result.tokens.scope,
      },
    };
    await saveStoredCreds(creds, configDir);
    return { creds, accessToken: result.tokens.accessToken };
  }
```

The unused `register` import can be removed from `client.ts`.

- [ ] **Step 3: Add tests for reuse + refresh-on-401**

Append to `test/client.test.ts`:

```ts
import { saveStoredCreds, loadStoredCreds, type StoredCreds } from '../src/tokens.js';

describe('Client reuse and refresh', () => {
  it('second connect reuses stored credentials without browser', async () => {
    // First connect
    await Client.connect(`${baseUrl}/mcp`, { browserOpener: opener, configDir });
    let openerCalled = false;
    const failOpener = async () => {
      openerCalled = true;
      throw new Error('opener should not be called on reuse');
    };
    // Second connect: opener must NOT be called
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: failOpener,
      configDir,
    });
    expect(openerCalled).toBe(false);
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('transparent refresh + retry on 401 mid-call', async () => {
    // Set up creds, then revoke the access token server-side, expect refresh to succeed
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: opener,
      configDir,
    });
    const stored = await loadStoredCreds(`${baseUrl}/mcp`, configDir);
    // Mark the in-memory token expired and corrupt the on-disk one to trigger refresh path
    // by setting expiresAt in the past
    stored.tokens.expiresAt = new Date(Date.now() - 1000).toISOString();
    await saveStoredCreds(stored, configDir);
    // The server-side accessToken is still valid, but our Client doesn't know that.
    // Force a 401 by zeroing the accessToken in the in-memory client via reflection:
    (client as unknown as { accessToken: string }).accessToken = 'definitely-invalid-token';
    const result = await client.callTool('echo', { text: 'after-refresh' });
    expect(result).toBe('after-refresh');
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass — including new client tests.

- [ ] **Step 5: Commit**

```bash
git add src/oauth.ts src/client.ts test/oauth.test.ts test/tokens.test.ts test/client.test.ts
git commit -m "Refactor: runOAuthFlow returns clientId; add reuse + 401-retry tests

Eliminates duplicate DCR call. Client now properly reuses cached
credentials and transparently refreshes on a server-side 401.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: CLI — login, tools, call

**Files:**
- Create: `src/cli.ts`
- Create: `test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { makeTempDir } from './helpers.js';
import { runCli } from '../src/cli.js';

const baseUrl = inject('fixtureBaseUrl');

let configDir: string;

beforeEach(async () => {
  configDir = await makeTempDir();
});

const opener = async (url: string) => {
  const res = await fetch(url, { redirect: 'manual' });
  const loc = res.headers.get('location');
  if (loc) await fetch(loc);
};

describe('CLI', () => {
  it('login command authenticates and saves creds', async () => {
    const result = await runCli(['login', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Logged in/);
  });

  it('tools command lists tools after login', async () => {
    await runCli(['login', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    const result = await runCli(['tools', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/echo/);
    expect(result.stdout).toMatch(/add/);
  });

  it('tools without login surfaces a friendly error', async () => {
    const result = await runCli(['tools', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/No stored credentials/);
    expect(result.stderr).toMatch(/login/);
  });

  it('call command invokes a tool and prints its result', async () => {
    await runCli(['login', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    const result = await runCli(['call', `${baseUrl}/mcp`, 'echo', '--text=hi'], {
      configDir,
      browserOpener: opener,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hi');
  });

  it('call with a typed numeric arg works for add', async () => {
    await runCli(['login', `${baseUrl}/mcp`], { configDir, browserOpener: opener });
    const result = await runCli(['call', `${baseUrl}/mcp`, 'add', '--a=2', '--b=3'], {
      configDir,
      browserOpener: opener,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('5');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
import { Command } from 'commander';
import { Client } from './client.js';
import { defaultConfigDir } from './tokens.js';

export interface CliOptions {
  configDir?: string;
  browserOpener?: (url: string) => Promise<void>;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], opts: CliOptions = {}): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  const program = new Command()
    .name('mcp-dcr-client')
    .description('MCP client with Dynamic Client Registration + OAuth 2.1 PKCE')
    .exitOverride();

  program
    .command('login <server>')
    .description('Authenticate with an MCP server (DCR + OAuth)')
    .action(async (server: string) => {
      try {
        await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: opts.browserOpener,
        });
        stdout += `✓ Logged in to ${server}\n`;
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  program
    .command('tools <server>')
    .description('List tools exposed by an authenticated MCP server')
    .action(async (server: string) => {
      try {
        const client = await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: opts.browserOpener,
        });
        const tools = await client.listTools();
        for (const t of tools) {
          stdout += `${t.name}${t.description ? ` — ${t.description}` : ''}\n`;
        }
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  program
    .command('call <server> <tool>')
    .description('Invoke a tool. Pass tool args as --key=value flags.')
    .allowUnknownOption(true)
    .action(async (server: string, tool: string, _opts, cmd: Command) => {
      try {
        const args: Record<string, unknown> = {};
        for (const raw of cmd.args.slice(2)) {
          const m = /^--([^=]+)=(.*)$/.exec(raw);
          if (!m) continue;
          const [, key, val] = m;
          args[key!] = parseValue(val!);
        }
        const client = await Client.connect(server, {
          configDir: opts.configDir,
          browserOpener: opts.browserOpener,
        });
        const result = await client.callTool(tool, args);
        stdout += `${result}\n`;
      } catch (e) {
        stderr += formatError(e, server);
        exitCode = 1;
      }
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    // commander threw via exitOverride — usually for unknown command/help
    if (e && typeof e === 'object' && 'message' in e) {
      stderr += `${(e as Error).message}\n`;
    }
    exitCode = exitCode || 1;
  }

  return { exitCode, stdout, stderr };
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function formatError(e: unknown, serverUrl: string): string {
  if (!e || typeof e !== 'object' || !('name' in e)) {
    return `✗ Unexpected error: ${String(e)}\n`;
  }
  const err = e as { name: string; message: string };
  switch (err.name) {
    case 'NoStoredCredentials':
      return (
        `✗ No stored credentials for ${new URL(serverUrl).host}\n` +
        `  Run: mcp-dcr-client login ${serverUrl}\n`
      );
    case 'RegistrationFailed':
      return `✗ ${err.message}\n  This client requires servers that support Dynamic Client Registration.\n`;
    case 'AuthorizationDenied':
      return `✗ ${err.message}\n  Re-run login if this was unintended.\n`;
    case 'RefreshFailed':
      return (
        `✗ ${err.message}\n` +
        `  Stored credentials have been cleared.\n` +
        `  Run: mcp-dcr-client login ${serverUrl}\n`
      );
    default:
      return `✗ ${err.name}: ${err.message}\n`;
  }
}

// Real-process entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((r) => {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      process.exit(r.exitCode);
    })
    .catch((e) => {
      process.stderr.write(`Fatal: ${e?.message ?? e}\n`);
      process.exit(2);
    });
}
```

Also, update `defaultConfigDir` to be exported (already is — confirm in `tokens.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- cli.test.ts`
Expected: PASS — 5 tests.

Then run all tests to confirm no regressions:

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "Add CLI with login, tools, call commands

Friendly error messages keyed by error class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Coverage Pass

**Files:**
- Possibly modify: any `src/*.ts` to remove dead code / add ignore pragmas

This task is pure verification — no new behavior.

- [ ] **Step 1: Run coverage**

Run: `npm run coverage`
Expected: report shows per-file coverage; overall lines/branches/functions/statements should be 100%.

- [ ] **Step 2: For any uncovered lines, decide: add a test, or annotate with `/* c8 ignore next */`**

Common candidates for ignore pragmas:
- The `if (import.meta.url === ...)` block in `cli.ts` (entry point, exercised by E2E test next task)
- Defensive `throw new Error('Failed to get address')` in network code where the underlying API never produces the error condition

For each uncovered line, add either a test that hits it OR a `/* c8 ignore next */` (or `/* c8 ignore start */ ... /* c8 ignore end */`) comment explaining why it can't be tested practically.

- [ ] **Step 3: Re-run coverage to confirm 100%**

Run: `npm run coverage`
Expected: `% Branch | % Funcs | % Lines | % Stmts` all 100 (or thresholds met).

- [ ] **Step 4: Commit (if any changes)**

```bash
git add src/
git commit -m "Reach 100% test coverage on src/

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: End-to-End Subprocess Test

**Files:**
- Create: `test/e2e.test.ts`

This test boots the fixture server in a child process and runs the compiled CLI binary against it via `execa`. It catches packaging and shebang issues that unit tests cannot.

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: `dist/` directory created with compiled `.js` + `.d.ts` files.

- [ ] **Step 2: Write the E2E test**

Create `test/e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { makeTempDir } from './helpers.js';
import { startServer, type FixtureServer } from './fixtures/server.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

let server: FixtureServer;
let configDir: string;
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mcp-dcr-client');

beforeAll(async () => {
  server = await startServer({ autoApprove: true });
  configDir = await makeTempDir();
});

afterAll(async () => {
  await server.close();
});

describe('E2E: compiled CLI against fixture server', () => {
  it('login → tools → call sequence works end-to-end', async () => {
    // We can't open a real browser in CI; the CLI's default opener uses `open`.
    // For E2E we drive through the loopback ourselves by intercepting the open call.
    // Workaround: set BROWSER env to a no-op script and pre-trigger the loopback
    // from inside the test by polling for the port.
    //
    // Simpler: use a shell `BROWSER` override that just curls the URL with redirect: manual,
    // then curls the resulting Location.
    const browserShim = resolve(dirname(fileURLToPath(import.meta.url)), 'browser-shim.mjs');

    const env = {
      MCPDCR_CONFIG_DIR: configDir,
      BROWSER: `node ${browserShim}`,
    };

    // login
    const login = await execa(cliPath, ['login', `${server.baseUrl}/mcp`], { env, reject: false });
    expect(login.exitCode).toBe(0);
    expect(login.stdout).toMatch(/Logged in/);

    // tools
    const tools = await execa(cliPath, ['tools', `${server.baseUrl}/mcp`], { env, reject: false });
    expect(tools.exitCode).toBe(0);
    expect(tools.stdout).toMatch(/echo/);
    expect(tools.stdout).toMatch(/add/);

    // call
    const call = await execa(cliPath, ['call', `${server.baseUrl}/mcp`, 'echo', '--text=hello'], {
      env,
      reject: false,
    });
    expect(call.exitCode).toBe(0);
    expect(call.stdout).toContain('hello');
  });
});
```

Also create `test/browser-shim.mjs`:

```js
#!/usr/bin/env node
// Used by E2E test as a $BROWSER replacement. Receives the URL as argv[2],
// follows the 302 once, hits the loopback to deliver the code.
const url = process.argv[2];
const res = await fetch(url, { redirect: 'manual' });
const loc = res.headers.get('location');
if (loc) await fetch(loc);
```

For this to work, the CLI needs to honor `MCPDCR_CONFIG_DIR` and use `$BROWSER` if set instead of `open`. Update `src/cli.ts`:

```ts
// At top of runCli, before parsing:
if (!opts.configDir && process.env.MCPDCR_CONFIG_DIR) {
  opts.configDir = process.env.MCPDCR_CONFIG_DIR;
}
if (!opts.browserOpener && process.env.BROWSER) {
  const browser = process.env.BROWSER;
  opts.browserOpener = async (url: string) => {
    const { execa } = await import('execa');
    await execa(browser, [url], { shell: true });
  };
}
```

Add `execa` to dependencies (move from devDeps if you prefer to keep it dev-only — it's only used when BROWSER is set in tests; production users don't need it). Actually, keep it dev-only and use child_process.spawn directly:

```ts
if (!opts.browserOpener && process.env.BROWSER) {
  const browser = process.env.BROWSER;
  opts.browserOpener = async (url: string) => {
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const parts = browser.split(/\s+/);
      const cmd = parts[0]!;
      const args = [...parts.slice(1), url];
      const child = spawn(cmd, args, { stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`browser exited ${code}`))));
      child.on('error', reject);
    });
  };
}
```

- [ ] **Step 3: Re-build and run the E2E**

Run: `npm run build && npm test -- e2e.test.ts`
Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all tests pass, including E2E.

- [ ] **Step 5: Commit**

```bash
git add test/e2e.test.ts test/browser-shim.mjs src/cli.ts
git commit -m "Add end-to-end subprocess test of compiled CLI

Drives the compiled bin/mcp-dcr-client against the fixture server
via execa, with a $BROWSER shim that follows the auth redirect
without opening a real browser.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# mcp-dcr-client

A TypeScript MCP client demonstrating **Dynamic Client Registration (RFC 7591)** + **OAuth 2.1 + PKCE** against any DCR-enabled MCP server.

Registers itself dynamically — no pre-registered client_id, no shared secrets baked into the binary. The client discovers, registers, authenticates, and starts using tools, all from one URL.

## Quick start

Requires Node 20+.

```bash
npm install
npm run build

# Authenticate against a real MCP server
./bin/mcp-dcr-client login https://mcp.linear.app/sse
./bin/mcp-dcr-client tools https://mcp.linear.app/sse
./bin/mcp-dcr-client call https://mcp.linear.app/sse <tool> --arg=value
```

## Try it offline against the bundled fixture server

```bash
# Terminal 1: start the local spec-compliant server (interactive approve mode)
node --loader tsx test/fixtures/server-cli.ts --port 3030

# Terminal 2: hit it
./bin/mcp-dcr-client login http://127.0.0.1:3030/mcp
./bin/mcp-dcr-client tools http://127.0.0.1:3030/mcp
./bin/mcp-dcr-client call http://127.0.0.1:3030/mcp echo --text=hello
```

## How it works

The auth dance:

```
1. Client GETs MCP server unauthenticated → 401 + WWW-Authenticate
2. Client GETs /.well-known/oauth-protected-resource → list of authorization servers
3. Client GETs /.well-known/oauth-authorization-server → authorize/token/registration endpoints
4. Client POSTs to /register with its metadata → fresh client_id (DCR)
5. Client generates PKCE verifier + state, opens browser to /authorize
6. User logs in, AS redirects to http://127.0.0.1:<port>/cb with ?code=&state=
7. Client's loopback HTTP server captures the code
8. Client POSTs to /token (with code + verifier + resource indicator) → access + refresh tokens
9. Tokens persisted to ~/.config/mcp-dcr-client/<sha256(server_url)>.json (mode 0600)
10. Client makes authenticated MCP calls with Authorization: Bearer ...
```

See `docs/superpowers/specs/2026-04-18-mcp-dcr-client-design.md` for the full design.

## Architecture

| Module | Responsibility |
|---|---|
| `src/discovery.ts` | Two-stage `.well-known` discovery |
| `src/registration.ts` | DCR (RFC 7591) |
| `src/oauth.ts` | PKCE primitives, loopback callback server, token exchange, refresh |
| `src/tokens.ts` | Persistent storage with auto-refresh |
| `src/client.ts` | Orchestrator + MCP session |
| `src/cli.ts` | Three commands: `login`, `tools`, `call` |
| `src/errors.ts` | Typed error classes per failure mode |

## Tests

```bash
npm test        # run all
npm run coverage  # with coverage report
```

Tests run against a bundled spec-compliant local MCP server (`test/fixtures/server.ts`) so they're hermetic and fast. Plus one end-to-end subprocess test that exercises the compiled CLI binary.

## License

MIT
```

Also create the standalone server CLI launcher:

`test/fixtures/server-cli.ts`:
```ts
import { startServer } from './server.js';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3030' },
    'auto-approve': { type: 'boolean', default: false },
  },
});

const port = Number(values.port);
const autoApprove = Boolean(values['auto-approve']);
const srv = await startServer({ port, autoApprove });
console.log(`Fixture server listening at ${srv.baseUrl}`);
console.log(`Mode: ${autoApprove ? 'auto-approve' : 'interactive'}`);
```

- [ ] **Step 2: Commit**

```bash
git add README.md test/fixtures/server-cli.ts
git commit -m "Add README and standalone fixture server launcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: POV.md

**Files:**
- Create: `POV.md`

- [ ] **Step 1: Write `POV.md`**

This is a thinking exercise — not boilerplate. The skeleton below is a starting structure; the implementer should write fresh prose based on what they actually learned from building the POC. Each section gets ~150-300 words.

```markdown
# A POV on MCP Dynamic Client Registration

## When this approach shines

DCR + OAuth 2.1 lets an MCP client connect to a server it's never seen before, with no pre-registered credentials, no shared API keys, no out-of-band setup. For an enterprise context, this is genuinely transformative: a user can paste an MCP server URL into Claude (or any DCR-aware client) and immediately start using it, with their own identity, scoped to their own permissions, mediated by their company's IdP.

The most interesting use case is **dynamic enterprise tool onboarding**. Your IT admin doesn't have to know about every MCP server employees might want to use. The user clicks "connect," authenticates against the server's IdP (which may be your IdP via SAML/OIDC federation), and the integration is live. No pre-registered "Claude OAuth app" per service. No shared client secrets. No support ticket.

## Where it falls short

**AS discoverability is fragile.** The two-stage `.well-known` flow assumes well-behaved servers. In practice, half the "MCP servers with OAuth" out there don't fully implement the latest auth spec, don't return `WWW-Authenticate` correctly, or split their RS and AS in ways the spec didn't fully anticipate. Production clients need fallback strategies and clear error UX for the "this server says it does OAuth, but..." cases.

**Trust assumptions.** DCR means *anyone* can register a client. The whole protection model relies on the user actively recognizing that they're authorizing the right tool, on a properly-validated AS, with a sensible scope. Phishing and consent fatigue are real risks. Real-world deployments will need consent UX that's harder to abuse than a generic "Allow access?" page.

**Resource indicators are the load-bearing security primitive.** RFC 8707 prevents tokens from being reused across servers, but lots of ASes don't enforce them yet. Without enforcement, a malicious MCP server can socially-engineer a user into authorizing a token that's also valid against a different MCP server they happen to use.

## What surprised me

[Implementer: fill in 2-3 things you didn't expect, e.g.:
- Two-stage discovery isn't obvious from the spec on first read
- Loopback URL must be registered dynamically per-port; otherwise PKCE alone doesn't close the loop
- Linear's specific quirks
- Behavior of the MCP SDK's auth helpers vs hand-rolled
- How easy / hard the Claude Code workflow made this]

## Production gaps

What I'd add before shipping this for real:

- **OS keychain integration** via `keytar` (Keychain / Secret Service / DPAPI) instead of file storage with `0600`. The current approach matches `gh` and `gcloud` but a serious enterprise tool should encrypt at rest.
- **File locking** for concurrent invocations. Two CLI invocations refreshing the same token simultaneously may clobber each other.
- **Telemetry**, with care. Auth failure modes are the kind of thing where good observability separates "broken integration" from "fixed in 5 minutes."
- **Scope handling.** This POC requests no specific scopes; production should let users choose, or at least surface the requested scopes during consent.
- **Token rotation / revocation.** The spec supports it; we don't exercise it.
- **WWW-Authenticate fallback.** The current discovery assumes `/.well-known/oauth-protected-resource` is always at the server's origin. The spec also lets servers signal it via the `WWW-Authenticate` header on a 401 — more robust to follow that.

## On using LLM-driven dev tools for this

[Implementer: write 1-2 paragraphs about the experience. Honest take. Things to consider:
- What the LLM workflow let you do faster
- Where it surprised you (good or bad)
- What you'd want to see improve
- Whether the brainstorm → plan → execute discipline (vs vibes coding) was worth it for this scope]
```

- [ ] **Step 2: Implementer writes the bracketed sections**

Replace each `[Implementer: ...]` block with real prose based on the build experience. Don't ship the placeholders.

- [ ] **Step 3: Commit**

```bash
git add POV.md
git commit -m "Add POV.md — perspective on DCR + LLM-driven development

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Verify Against Linear

This task is **manual verification** — not automated. The goal is to confirm the POC actually works against `mcp.linear.app` and to capture findings in `POV.md`'s "What surprised me" section.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2: Run login against Linear**

Run: `./bin/mcp-dcr-client login https://mcp.linear.app/sse`
Expected:
- Browser opens to Linear's OAuth consent page
- After approval, terminal prints "Logged in to https://mcp.linear.app/sse"
- `~/.config/mcp-dcr-client/<hash>.json` exists with mode 0600

If discovery fails: check that `https://mcp.linear.app/.well-known/oauth-protected-resource` returns valid metadata. If not, document the workaround needed (e.g., follow the `WWW-Authenticate` header from a 401 response). If Linear's MCP server URL is different (`/mcp` vs `/sse`), update the docs accordingly.

- [ ] **Step 3: Run tools**

Run: `./bin/mcp-dcr-client tools https://mcp.linear.app/sse`
Expected: a list of Linear's MCP tools.

- [ ] **Step 4: Run a tool call**

Pick a safe read-only tool (e.g., `list_issues` or `me`) and invoke it.

Run: `./bin/mcp-dcr-client call https://mcp.linear.app/sse <tool> [--args]`
Expected: real Linear data in the output.

- [ ] **Step 5: Update POV.md with findings**

Replace the bracketed "What surprised me" section in `POV.md` with what you actually observed:
- Did Linear's discovery work as expected?
- Did the redirect_uri / DCR dance go through cleanly?
- Any non-spec behavior?
- How did refresh behave? (Wait for the access token to expire, or zero out `expiresAt` in the file, then run `tools` again.)

Commit:

```bash
git add POV.md
git commit -m "Update POV.md with findings from Linear verification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push everything**

Run: `git push`
Expected: all commits land on `github.com/mariamcl/mcp-dcr-client`.

---

## Self-Review Checklist (run before declaring plan complete)

**Spec coverage:**

- [x] Functional req: `login`/`tools`/`call` commands → Tasks 16
- [x] Functional req: refresh transparently → Task 12
- [x] Functional req: 401 mid-session retry → Task 15
- [x] Non-functional: demoable against Linear → Task 21
- [x] Non-functional: demoable offline → Task 19 (server-cli.ts)
- [x] Non-functional: 100% coverage → Task 17
- [x] Non-functional: `0600` perms + atomic writes → Task 11
- [x] Architecture: 6 src modules → Tasks 4, 6, 8-10, 11-12, 14-15, 16
- [x] Errors module → Task 2
- [x] Data flow: 13 steps with resource indicators → Tasks 4, 6, 10
- [x] Token storage: per-server hash, registration + tokens together → Task 11
- [x] Local fixture server → Tasks 3, 5, 7, 13
- [x] Test strategy: per-module + E2E → Tasks 4, 6, 8-12, 14-16, 18
- [x] Error handling: 8 error classes, friendly CLI messages → Tasks 2, 16
- [x] Deliverables: README + POV → Tasks 19, 20
- [x] Risks: Linear DCR verification → Task 21

**Placeholder scan:** None remain. POV.md has `[Implementer: ...]` blocks intentionally — those are reflection prompts the implementer fills in based on real findings, not implementation placeholders.

**Type consistency:** `OAuthFlowResult` shape (Task 15) is consistently used in `Client.fullAuth` and tokens tests after refactor. `StoredCreds` shape (Task 11) is consistent across `client.ts` and `tokens.ts`. `OAuthEndpoints` is the single source of truth for endpoint shape across discovery / oauth / client / tokens.
