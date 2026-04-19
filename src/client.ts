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
    private accessToken: string,
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
    const browserOpener =
      opts.browserOpener ??
      (async (url: string) => {
        const open = (await import('open')).default;
        await open(url);
      });

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

  async listTools(): Promise<ToolDescriptor[]> {
    const result = await this.rpc('tools/list', {});
    return (result as { tools: ToolDescriptor[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    return content.map((c) => c.text ?? '').join('');
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const doRequest = async (token: string) => {
      return fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    };

    let res = await doRequest(this.accessToken);
    if (res.status === 401) {
      this.accessToken = await getValidAccessToken(this.serverUrl, this.endpoints, this.configDir);
      res = await doRequest(this.accessToken);
    }
    const text = await res.text();
    if (!res.ok) throw new MCPRequestFailed(res.status, text);
    const parsed = JSON.parse(text) as { result?: unknown; error?: { message: string } };
    if (parsed.error) throw new MCPRequestFailed(res.status, parsed.error.message);
    return parsed.result;
  }
}
