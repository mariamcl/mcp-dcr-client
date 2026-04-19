import { RegistrationFailed } from './errors.js';

export interface RegisterParams {
  redirectUris: string[];
  clientName: string;
  serverUrl: string;
}

export interface Registration {
  clientId: string;
  clientSecret?: string;
}

export async function register(
  registrationEndpoint: string,
  params: RegisterParams,
): Promise<Registration> {
  let res: Response;
  try {
    res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: params.redirectUris,
        client_name: params.clientName,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
  } catch (e) {
    throw new RegistrationFailed(params.serverUrl, 0, `network error: ${(e as Error).message}`);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new RegistrationFailed(params.serverUrl, res.status, body);
  }

  let parsed: { client_id?: string; client_secret?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RegistrationFailed(params.serverUrl, res.status, `malformed JSON: ${body}`);
  }

  if (!parsed.client_id) {
    throw new RegistrationFailed(params.serverUrl, res.status, 'response missing client_id');
  }

  return { clientId: parsed.client_id, clientSecret: parsed.client_secret };
}
