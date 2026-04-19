import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { makeTempDir } from './helpers.js';
import { startServer, type FixtureServer } from './fixtures/server.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

let server: FixtureServer;
let configDir: string;
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '..', 'bin', 'mcp-dcr-client');
// Reuse the fake-browser.mjs from T17 (lives in test/fixtures/)
const browserShim = resolve(here, 'fixtures', 'fake-browser.mjs');

beforeAll(async () => {
  server = await startServer({ autoApprove: true });
  configDir = await makeTempDir();
});

afterAll(async () => {
  await server.close();
});

describe('E2E: compiled CLI against fixture server', () => {
  it('login → tools → call sequence works end-to-end', async () => {
    const env = {
      MCPDCR_CONFIG_DIR: configDir,
      BROWSER: `node ${browserShim}`,
    };

    const login = await execa(cliPath, ['login', `${server.baseUrl}/mcp`], { env, reject: false });
    expect(login.exitCode).toBe(0);
    expect(login.stdout).toMatch(/Logged in/);

    const tools = await execa(cliPath, ['tools', `${server.baseUrl}/mcp`], { env, reject: false });
    expect(tools.exitCode).toBe(0);
    expect(tools.stdout).toMatch(/echo/);
    expect(tools.stdout).toMatch(/add/);

    const call = await execa(cliPath, ['call', `${server.baseUrl}/mcp`, 'echo', '--text=hello'], {
      env,
      reject: false,
    });
    expect(call.exitCode).toBe(0);
    expect(call.stdout).toContain('hello');
  });
});
