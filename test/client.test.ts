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
