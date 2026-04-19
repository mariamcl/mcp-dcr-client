import { describe, it, expect, beforeEach } from 'vitest';
import { stat, writeFile, mkdir } from 'node:fs/promises';
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
