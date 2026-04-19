export class DiscoveryFailed extends Error {
  readonly name = 'DiscoveryFailed';
  constructor(public serverUrl: string, public reason: string) {
    super(`Discovery failed for ${serverUrl}: ${reason}`);
  }
}

export class RegistrationFailed extends Error {
  readonly name = 'RegistrationFailed';
  constructor(public serverUrl: string, public status: number, public body: string) {
    super(`DCR failed for ${serverUrl}: HTTP ${status} ${body}`);
  }
}

export class AuthorizationDenied extends Error {
  readonly name = 'AuthorizationDenied';
  constructor(public errorCode: string, public errorDescription?: string) {
    super(`Authorization denied: ${errorCode}${errorDescription ? ` — ${errorDescription}` : ''}`);
  }
}

export class TokenExchangeFailed extends Error {
  readonly name = 'TokenExchangeFailed';
  constructor(public status: number, public body: string) {
    super(`Token exchange failed: HTTP ${status} ${body}`);
  }
}

export class NoStoredCredentials extends Error {
  readonly name = 'NoStoredCredentials';
  constructor(public serverUrl: string) {
    super(`No stored credentials for ${serverUrl}`);
  }
}

export class RefreshFailed extends Error {
  readonly name = 'RefreshFailed';
  constructor(public serverUrl: string, public reason: string) {
    super(`Token refresh failed for ${serverUrl}: ${reason}`);
  }
}

export class MCPRequestFailed extends Error {
  readonly name = 'MCPRequestFailed';
  constructor(public status: number, public body: string) {
    super(`MCP request failed: HTTP ${status} ${body}`);
  }
}

export class StateMismatch extends Error {
  readonly name = 'StateMismatch';
  constructor() {
    super('OAuth state parameter did not match — possible CSRF attempt');
  }
}
