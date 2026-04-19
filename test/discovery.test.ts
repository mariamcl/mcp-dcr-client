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
