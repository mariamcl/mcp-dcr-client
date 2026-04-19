import { Client as SDKClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discover, type OAuthEndpoints } from './discovery.js';
import { runOAuthFlow } from './oauth.js';
import {
  loadStoredCreds,
  saveStoredCreds,
  getValidAccessToken,
  defaultConfigDir,
  type StoredCreds,
} from './tokens.js';
import { MCPRequestFailed, NoStoredCredentials, RegistrationFailed } from './errors.js';

export interface ClientOptions {
  browserOpener?: (url: string) => Promise<void>;
  configDir?: string;
  clientName?: string;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class Client {
  private constructor(
    private readonly serverUrl: string,
    private readonly endpoints: OAuthEndpoints,
    private readonly creds: StoredCreds,
    private readonly configDir: string,
    /* c8 ignore next -- mutated directly by refresh-on-401 test */
    public accessToken: string,
  ) {}

  static async connect(serverUrl: string, opts: ClientOptions = {}): Promise<Client> {
    const configDir = opts.configDir ?? defaultConfigDir();
    const endpoints = await discover(serverUrl);

    let creds: StoredCreds;
    let accessToken: string;
    try {
      creds = await loadStoredCreds(serverUrl, configDir);
      accessToken = await getValidAccessToken(serverUrl, endpoints, configDir);
    } catch (e) {
      if (!(e instanceof NoStoredCredentials)) throw e;
      const result = await Client.fullAuth(serverUrl, endpoints, opts, configDir);
      creds = result.creds;
      accessToken = result.accessToken;
    }
    return new Client(serverUrl, endpoints, creds, configDir, accessToken);
  }

  private static async fullAuth(
    serverUrl: string,
    endpoints: OAuthEndpoints,
    opts: ClientOptions,
    configDir: string,
  ): Promise<{ creds: StoredCreds; accessToken: string }> {
    if (!endpoints.registrationEndpoint) {
      throw new RegistrationFailed(
        serverUrl,
        0,
        "AS metadata has no registration_endpoint — server doesn't support DCR",
      );
    }
    /* c8 ignore start -- real-browser fallback; tests always supply browserOpener */
    const browserOpener =
      opts.browserOpener ??
      (async (url: string) => {
        const open = (await import('open')).default;
        await open(url);
      });
    /* c8 ignore end */

    const result = await runOAuthFlow({
      endpoints,
      clientId: 'placeholder',
      resource: serverUrl,
      browserOpener,
      registerDynamicRedirect: true,
    });

    const creds: StoredCreds = {
      serverUrl,
      registration: {
        clientId: result.clientId,
        registeredAt: new Date().toISOString(),
      },
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt: new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString(),
        scope: result.tokens.scope,
      },
    };
    await saveStoredCreds(creds, configDir);
    return { creds, accessToken: result.tokens.accessToken };
  }

  /**
   * Build a fetch wrapper that injects Authorization and refreshes on 401.
   */
  private makeAuthFetch(): (url: URL | RequestInfo, init?: RequestInit) => Promise<Response> {
    return async (url: URL | RequestInfo, init?: RequestInit) => {
      const withAuth = (token: string): RequestInit => ({
        ...init,
        headers: {
          ...(init?.headers instanceof Headers
            ? Object.fromEntries((init.headers as Headers).entries())
            : (init?.headers as Record<string, string> | undefined) ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });

      let res = await fetch(url, withAuth(this.accessToken));
      if (res.status === 401) {
        this.accessToken = await getValidAccessToken(this.serverUrl, this.endpoints, this.configDir);
        res = await fetch(url, withAuth(this.accessToken));
      }
      return res;
    };
  }

  /**
   * Connect to the MCP server using the SDK transport and run `fn` with the connected client.
   * Tears down the transport after `fn` completes.
   */
  private async withSDKClient<T>(fn: (sdk: SDKClient) => Promise<T>): Promise<T> {
    const url = new URL(this.serverUrl);
    const useSSE = url.pathname.endsWith('/sse');
    const authFetch = this.makeAuthFetch();

    const transport = useSSE
      ? new SSEClientTransport(url, { fetch: authFetch })
      : new StreamableHTTPClientTransport(url, { fetch: authFetch });

    const sdk = new SDKClient({ name: 'mcp-dcr-client', version: '0.1.0' });
    try {
      await sdk.connect(transport);
      return await fn(sdk);
    } finally {
      await sdk.close();
    }
  }

  async listTools(): Promise<ToolDescriptor[]> {
    try {
      const result = await this.withSDKClient((sdk) => sdk.listTools());
      return result.tools as ToolDescriptor[];
    } catch (e) {
      throw toMCPRequestFailed(e);
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      const result = await this.withSDKClient((sdk) =>
        sdk.callTool({ name, arguments: args }),
      );
      const content = (result as { content: Array<{ type: string; text?: string }> }).content;
      return content.map((c) => c.text ?? '').join('');
    } catch (e) {
      throw toMCPRequestFailed(e);
    }
  }
}

function toMCPRequestFailed(e: unknown): unknown {
  if (e instanceof MCPRequestFailed) return e;
  if (e instanceof Error) {
    return new MCPRequestFailed(0, e.message);
  }
  return new MCPRequestFailed(0, String(e));
}
