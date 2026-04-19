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
  await chmod(tmp, 0o600);
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
