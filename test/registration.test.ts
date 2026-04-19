import { describe, it, expect, inject } from 'vitest';
import { register } from '../src/registration.js';
import { RegistrationFailed } from '../src/errors.js';

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
