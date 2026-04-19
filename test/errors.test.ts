import { describe, it, expect } from 'vitest';
import {
  DiscoveryFailed,
  RegistrationFailed,
  AuthorizationDenied,
  TokenExchangeFailed,
  NoStoredCredentials,
  RefreshFailed,
  MCPRequestFailed,
  StateMismatch,
} from '../src/errors.js';

describe('errors', () => {
  it('DiscoveryFailed carries server URL and cause', () => {
    const err = new DiscoveryFailed('https://x.example/mcp', 'metadata 404');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DiscoveryFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.message).toContain('https://x.example/mcp');
    expect(err.message).toContain('metadata 404');
  });

  it('RegistrationFailed carries server URL and AS response body', () => {
    const err = new RegistrationFailed('https://x.example/mcp', 400, 'invalid_redirect_uri');
    expect(err.name).toBe('RegistrationFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.status).toBe(400);
    expect(err.body).toBe('invalid_redirect_uri');
  });

  it('AuthorizationDenied carries the OAuth error code', () => {
    const err = new AuthorizationDenied('access_denied', 'User clicked deny');
    expect(err.name).toBe('AuthorizationDenied');
    expect(err.errorCode).toBe('access_denied');
    expect(err.errorDescription).toBe('User clicked deny');
  });

  it('TokenExchangeFailed carries status + body', () => {
    const err = new TokenExchangeFailed(400, 'invalid_grant');
    expect(err.name).toBe('TokenExchangeFailed');
    expect(err.status).toBe(400);
    expect(err.body).toBe('invalid_grant');
  });

  it('NoStoredCredentials carries server URL', () => {
    const err = new NoStoredCredentials('https://x.example/mcp');
    expect(err.name).toBe('NoStoredCredentials');
    expect(err.serverUrl).toBe('https://x.example/mcp');
  });

  it('RefreshFailed carries server URL and reason', () => {
    const err = new RefreshFailed('https://x.example/mcp', 'invalid_grant');
    expect(err.name).toBe('RefreshFailed');
    expect(err.serverUrl).toBe('https://x.example/mcp');
    expect(err.reason).toBe('invalid_grant');
  });

  it('MCPRequestFailed carries status + body', () => {
    const err = new MCPRequestFailed(401, 'Unauthorized');
    expect(err.name).toBe('MCPRequestFailed');
    expect(err.status).toBe(401);
    expect(err.body).toBe('Unauthorized');
  });

  it('StateMismatch indicates CSRF defense triggered', () => {
    const err = new StateMismatch();
    expect(err.name).toBe('StateMismatch');
    expect(err.message).toMatch(/state/i);
  });
});
