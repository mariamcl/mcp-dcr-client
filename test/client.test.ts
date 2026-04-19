import { describe, it, expect, beforeEach, inject } from 'vitest';
import { makeTempDir } from './helpers.js';
import { Client } from '../src/client.js';
import { saveStoredCreds, loadStoredCreds, type StoredCreds } from '../src/tokens.js';

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
    const creds = await loadStoredCreds(`${baseUrl}/mcp`, configDir);
    expect(creds.registration.clientId).toMatch(/^dyn-/);
    expect(creds.tokens.accessToken).toMatch(/^at-/);
  });
});

describe('Client reuse and refresh', () => {
  it('second connect reuses stored credentials without browser', async () => {
    await Client.connect(`${baseUrl}/mcp`, { browserOpener: opener, configDir });
    let openerCalled = false;
    const failOpener = async () => {
      openerCalled = true;
      throw new Error('opener should not be called on reuse');
    };
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: failOpener,
      configDir,
    });
    expect(openerCalled).toBe(false);
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('transparent refresh + retry on 401 mid-call', async () => {
    const client = await Client.connect(`${baseUrl}/mcp`, {
      browserOpener: opener,
      configDir,
    });
    const stored = await loadStoredCreds(`${baseUrl}/mcp`, configDir);
    // Mark the on-disk expiresAt in the past so getValidAccessToken refreshes
    stored.tokens.expiresAt = new Date(Date.now() - 1000).toISOString();
    await saveStoredCreds(stored, configDir);
    // Force a 401 from the in-memory client by invalidating its current accessToken
    (client as unknown as { accessToken: string }).accessToken = 'definitely-invalid-token';
    const result = await client.callTool('echo', { text: 'after-refresh' });
    expect(result).toBe('after-refresh');
  });
});
