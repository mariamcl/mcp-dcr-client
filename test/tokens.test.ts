import { describe, it, expect, beforeEach, inject } from 'vitest';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { makeTempDir } from './helpers.js';
import {
  loadStoredCreds,
  saveStoredCreds,
  deleteStoredCreds,
  fileForServer,
  type StoredCreds,
} from '../src/tokens.js';
import { NoStoredCredentials, RefreshFailed } from '../src/errors.js';
import { discover } from '../src/discovery.js';
import { runOAuthFlow } from '../src/oauth.js';
import { getValidAccessToken } from '../src/tokens.js';

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

  it('atomic write: stray .tmp file does not surface as loaded creds', async () => {
    await mkdir(configDir, { recursive: true });
    const path = fileForServer(sample.serverUrl, configDir);
    await writeFile(path + '.tmp', '{"partial":', { mode: 0o600 });
    await expect(loadStoredCreds(sample.serverUrl, configDir)).rejects.toBeInstanceOf(
      NoStoredCredentials,
    );
  });
});

describe('getValidAccessToken (refresh)', () => {
  const baseUrl = inject('fixtureBaseUrl');

  async function freshCreds(): Promise<StoredCreds> {
    const endpoints = await discover(`${baseUrl}/mcp`);
    const opener = async (url: string) => {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      if (loc) await fetch(loc);
    };
    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: `${baseUrl}/mcp`,
      browserOpener: opener,
      registerDynamicRedirect: true,
    });
    return {
      serverUrl: `${baseUrl}/mcp`,
      registration: { clientId: result.clientId, registeredAt: new Date().toISOString() },
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt: new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString(),
      },
    };
  }

  it('returns access token when not expired', async () => {
    const creds = await freshCreds();
    await saveStoredCreds(creds, configDir);
    const endpoints = await discover(`${baseUrl}/mcp`);
    const at = await getValidAccessToken(creds.serverUrl, endpoints, configDir);
    expect(at).toBe(creds.tokens.accessToken);
  });

  it('refreshes when access token expired and persists new tokens', async () => {
    const creds = await freshCreds();
    creds.tokens.expiresAt = new Date(Date.now() - 1000).toISOString();
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
