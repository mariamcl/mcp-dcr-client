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
