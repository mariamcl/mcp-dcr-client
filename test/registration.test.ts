import { describe, it, expect, inject, afterEach } from 'vitest';
import { register } from '../src/registration.js';
import { RegistrationFailed } from '../src/errors.js';
import { startServer, type FixtureServer } from './fixtures/server.js';

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
        redirectUris: [],
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

describe('register edge cases (mode-controlled fixture)', () => {
  let fixture: FixtureServer;

  afterEach(async () => {
    if (fixture) {
      fixture.state.mode = 'normal';
      await fixture.close();
    }
  });

  it('throws RegistrationFailed when response body is malformed JSON', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'register_malformed_json';
    await expect(
      register(`${fixture.baseUrl}/register`, {
        redirectUris: ['http://127.0.0.1:9999/cb'],
        clientName: 'test',
        serverUrl: `${fixture.baseUrl}/mcp`,
      }),
    ).rejects.toBeInstanceOf(RegistrationFailed);
  });

  it('throws RegistrationFailed when response is valid JSON but missing client_id', async () => {
    fixture = await startServer({ autoApprove: true });
    fixture.state.mode = 'register_no_client_id';
    await expect(
      register(`${fixture.baseUrl}/register`, {
        redirectUris: ['http://127.0.0.1:9999/cb'],
        clientName: 'test',
        serverUrl: `${fixture.baseUrl}/mcp`,
      }),
    ).rejects.toBeInstanceOf(RegistrationFailed);
  });
});
