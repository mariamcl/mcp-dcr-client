import { describe, it, expect, inject, afterEach } from 'vitest';
import { discover } from '../src/discovery.js';
import { DiscoveryFailed } from '../src/errors.js';
import { startServer, type FixtureServer } from './fixtures/server.js';

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

describe('discover edge cases (mode-controlled fixture)', () => {
  let fixture: FixtureServer;

  afterEach(async () => {
    if (fixture) {
      fixture.state.mode = 'normal';
      await fixture.close();
    }
  });

  it('throws DiscoveryFailed when protected-resource metadata has no authorization_servers', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'pr_empty_servers';
    await expect(discover(`${fixture.baseUrl}/mcp`)).rejects.toBeInstanceOf(DiscoveryFailed);
  });

  it('throws DiscoveryFailed when authorization_servers[0] is empty string', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'pr_empty_as_url';
    await expect(discover(`${fixture.baseUrl}/mcp`)).rejects.toBeInstanceOf(DiscoveryFailed);
  });

  it('throws DiscoveryFailed when AS metadata lacks required endpoints', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'as_missing_endpoints';
    await expect(discover(`${fixture.baseUrl}/mcp`)).rejects.toBeInstanceOf(DiscoveryFailed);
  });

  it('throws DiscoveryFailed when AS metadata response is malformed JSON', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'as_malformed_json';
    await expect(discover(`${fixture.baseUrl}/mcp`)).rejects.toBeInstanceOf(DiscoveryFailed);
  });
});
