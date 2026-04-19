import { DiscoveryFailed } from './errors.js';

export interface OAuthEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  resource: string;
}

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

export async function discover(serverUrl: string): Promise<OAuthEndpoints> {
  const origin = new URL(serverUrl).origin;
  const prMetadata = await fetchJson<ProtectedResourceMetadata>(
    `${origin}/.well-known/oauth-protected-resource`,
    serverUrl,
  );
  if (!prMetadata.authorization_servers?.length) {
    throw new DiscoveryFailed(serverUrl, 'protected-resource metadata has no authorization_servers');
  }

  const asUrl = prMetadata.authorization_servers[0];
  if (!asUrl) {
    throw new DiscoveryFailed(serverUrl, 'authorization_servers[0] is empty');
  }
  const asMetadata = await fetchJson<AuthorizationServerMetadata>(
    `${new URL(asUrl).origin}/.well-known/oauth-authorization-server`,
    serverUrl,
  );

  if (!asMetadata.authorization_endpoint || !asMetadata.token_endpoint) {
    throw new DiscoveryFailed(serverUrl, 'AS metadata missing required endpoints');
  }

  return {
    issuer: asMetadata.issuer,
    authorizationEndpoint: asMetadata.authorization_endpoint,
    tokenEndpoint: asMetadata.token_endpoint,
    registrationEndpoint: asMetadata.registration_endpoint,
    resource: prMetadata.resource,
  };
}

async function fetchJson<T>(url: string, serverUrl: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new DiscoveryFailed(serverUrl, `network error fetching ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new DiscoveryFailed(serverUrl, `HTTP ${res.status} from ${url}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new DiscoveryFailed(serverUrl, `malformed JSON from ${url}`);
  }
}
