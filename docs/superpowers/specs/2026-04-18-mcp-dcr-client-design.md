# MCP Dynamic Client Registration Client — Design

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation plan

## Problem

Build a TypeScript MCP client that dynamically self-registers to an MCP server using RFC 7591 Dynamic Client Registration (DCR), then uses the negotiated `client_id` to run an OAuth authorization-code flow and establish an authenticated MCP session on behalf of a user.

Deliverables:

1. Working proof of concept that a reviewer can run end-to-end against a real third-party MCP server (Linear).
2. Full test coverage using a local spec-compliant MCP server as the test backend.
3. A written POV on when this approach shines and where it falls short.

## Requirements

### Functional

- CLI with three commands against any DCR-enabled MCP server URL:
  - `login <server>` — discovery → DCR → OAuth authorization-code + PKCE → persist tokens
  - `tools <server>` — list tools the authenticated session exposes
  - `call <server> <tool> [--arg=value ...]` — invoke a tool and print its result
- Subsequent commands reuse stored tokens; refresh transparently when expired; fall back to full re-auth only when the refresh token is rejected.
- One transparent refresh-and-retry when an MCP request returns 401 mid-session.

### Non-functional

- Demonstrable against `mcp.linear.app` end-to-end.
- Demonstrable offline against the bundled local server.
- Full test coverage (target: 100% lines/branches on `src/`).
- Single `npm install && npm start -- login ...` path for the reviewer.
- Bearer tokens stored with `0600` perms; atomic writes.

### Out of scope

- OS keychain integration (called out as a production gap in `POV.md`).
- File-level locking for concurrent CLI invocations.
- Support for MCP servers without DCR (explicit error: this client is DCR-only).
- Interactive REPL (listed as a stretch goal if time remains after tests).
- Logout / whoami commands.

## Architecture

### Module breakdown

```
src/
  discovery.ts      Fetch /.well-known/oauth-protected-resource (from MCP server)
                    and /.well-known/oauth-authorization-server (from AS).
                    Returns: { authorizationEndpoint, tokenEndpoint, registrationEndpoint, ... }

  registration.ts   DCR (RFC 7591): POST client metadata to registration endpoint.
                    Returns: { clientId, clientSecret? }

  oauth.ts          PKCE + authorization-code flow. Generates verifier/challenge,
                    invokes a browserOpener (injectable), runs a loopback HTTP
                    server on a random localhost port, exchanges code for tokens.
                    No MCP knowledge.

  tokens.ts         Load/save tokens to ~/.config/mcp-dcr-client/<server-hash>.json.
                    Includes refresh logic: if access token expired, use refresh
                    token to mint a new one before signaling failure.

  client.ts         Orchestrator. Client.connect(serverUrl) ties modules together:
                    discovery → registration → load-or-acquire-token → MCP session.
                    Wraps @modelcontextprotocol/sdk's HTTP transport with an
                    Authorization header and one refresh-and-retry on 401.

  cli.ts            Thin CLI (commander): login, tools, call.
                    Parses args, calls into Client, formats results and errors.

  errors.ts         Custom error classes (see Error Handling).
```

### Why this shape

Each file maps to one concept from the spec. A reviewer reading `registration.ts` sees DCR cleanly, not buried in a 400-line orchestrator. Discovery, registration, OAuth, and token storage are pure-ish — inputs to outputs — which makes them trivial to unit-test against the local server. `client.ts` is the only module that knows about all pieces; the CLI is dumb.

Per-server token storage (keyed by `sha256(server_url).slice(0,16)`) means the client can be authenticated to multiple MCP servers simultaneously without conflict.

## Data flow: the auth dance

First-time flow:

```
 1. Client → MCP server: unauthenticated request                          (client.ts)
 2. Server → Client: 401 + WWW-Authenticate header pointing at metadata
 3. Client → MCP server: GET /.well-known/oauth-protected-resource        (discovery.ts)
       ← { authorization_servers: [as_url], resource: <canonical url> }
 4. Client → AS: GET /.well-known/oauth-authorization-server              (discovery.ts)
       ← { authorization_endpoint, token_endpoint, registration_endpoint }
 5. Client → AS: POST registration_endpoint                               (registration.ts)
       { client_name, redirect_uris: ["http://127.0.0.1:<port>/cb"],
         grant_types, token_endpoint_auth_method, ... }
       ← { client_id, [client_secret] }
 6. Client: generate PKCE verifier + S256 challenge, random state         (oauth.ts)
 7. Client: spin up loopback HTTP server on a random free port            (oauth.ts)
 8. Client: browserOpener → authorization_endpoint?
       client_id, redirect_uri, response_type=code, scope,
       code_challenge, code_challenge_method=S256, state,
       resource=<mcp server url>
 9. User authenticates and consents in browser
10. Browser → loopback: GET /cb?code=...&state=...                        (oauth.ts)
       Loopback returns "you can close this tab" HTML
11. Client → AS: POST token_endpoint                                      (oauth.ts)
       { grant_type=authorization_code, code, code_verifier,
         redirect_uri, client_id, resource=<mcp server url> }
       ← { access_token, refresh_token, expires_in }
12. Client: persist registration + tokens atomically                      (tokens.ts)
13. Client → MCP server: requests with Authorization: Bearer ...          (client.ts)
```

Subsequent runs skip steps 1–5 and 9–10 whenever stored credentials exist; they go straight from "load tokens" to step 13, refreshing the access token first if it has expired.

### Two non-obvious spec details

- **Resource indicators (RFC 8707).** The `resource=<mcp server url>` parameter in steps 8 and 11 binds the issued token to a specific MCP server. Without it, a malicious server could trick a user into authorizing a token that is also valid against a different server. The latest MCP auth spec requires this; Linear enforces it. Included from the start.
- **Two-stage discovery.** The MCP server does not host its own OAuth endpoints — it points at a separate authorization server via `/.well-known/oauth-protected-resource`. That is why there are two `.well-known` lookups. Easy to miss on a first read of the spec.

## Token storage and refresh

### File layout

```
~/.config/mcp-dcr-client/
  <sha256(server_url).slice(0,16)>.json    one file per MCP server
```

### File contents

```json
{
  "serverUrl": "https://mcp.linear.app/sse",
  "registration": {
    "clientId": "...",
    "clientSecret": "...",
    "registeredAt": "2026-04-18T..."
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": "2026-04-18T...",
    "scope": "..."
  }
}
```

Storing the registration alongside tokens means a subsequent run with a valid registration but expired access token skips discovery and DCR entirely — it goes straight to refresh. That is the realistic happy path for repeat use.

### Permissions and atomicity

- File mode `0600`; directory mode `0700`.
- Atomic writes: write to `<name>.tmp`, then `fs.rename` to the final path. A crash mid-write cannot corrupt the active file.

### Refresh logic (`tokens.ts`)

`getValidAccessToken(serverUrl, oauthEndpoints)`:

1. Load the file. If absent → throw `NoStoredCredentials`.
2. If `accessToken` not expiring within the next 30 seconds → return it.
3. Otherwise, POST `grant_type=refresh_token` to `token_endpoint`. On success, persist the new token pair and return the access token.
4. On refresh failure (`invalid_grant` or 401) → delete the file, throw `RefreshFailed`.

Plus a mid-request safety net in `client.ts`: if the MCP server returns 401 during a tool call (token revoked server-side), force a refresh and retry once; then surface the error.

### Explicit non-goals (flagged in POV.md)

- **No OS keychain.** Real CLIs should use Keychain / Secret Service / DPAPI via a library like `keytar`. File + `0600` is what `gh` and `gcloud` do and is appropriate for a takehome demo.
- **No file locking.** Two simultaneous invocations refreshing the token may clobber each other; the next run will refresh again. Acceptable for a CLI; would matter for a long-running daemon.

## Local spec-compliant test server

Located at `test/fixtures/server/`. A single Express application implementing both the MCP server and its authorization server in one process. Used as the test backend for all suites; also runnable by hand for offline demos.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /mcp` (no auth) | 401 + `WWW-Authenticate` pointing at the metadata URL |
| `GET /.well-known/oauth-protected-resource` | Lists itself as the AS |
| `GET /.well-known/oauth-authorization-server` | OAuth metadata: `authorization_endpoint`, `token_endpoint`, `registration_endpoint` |
| `POST /register` | DCR: accepts any client metadata, returns a generated `client_id` |
| `GET /authorize` | Validates PKCE challenge, state, resource. Auto-redirects in test mode; serves a one-button Approve page in offline-demo mode |
| `POST /token` | `authorization_code` (validates PKCE verifier) and `refresh_token` grants |
| `POST /mcp` (auth) | Real MCP JSON-RPC; exposes two tools: `echo(text)` and `add(a, b)` |

A CLI flag (`--auto-approve`) switches the `/authorize` behavior between test-mode auto-redirect and interactive approve-page. Tests run with it on.

### Driving the auth flow in tests without a real browser

`oauth.ts` accepts a `browserOpener: (url: string) => Promise<void>` as a dependency (default: the `open` package). Tests inject an opener that performs `fetch(url, { redirect: 'manual' })` and follows the single 302 back to the loopback. Production code path is unchanged; no test-only branches in production code.

### Why a real local server instead of mocks

Tests exercise the real HTTP dance — real PKCE, real state validation, real token refresh. If the spec interpretation is wrong, tests catch it; mocks would only confirm the same wrong thing twice. Cost is roughly 150 lines of Express; benefit is confidence that the client actually implements the spec.

## Testing strategy

- **Framework:** Vitest with v8 coverage reporter.
- **Shared backend:** global `beforeAll` boots the local server on a random free port; `afterAll` shuts it down. Each test gets a fresh temp directory for token storage.
- **Coverage target:** 100% lines/branches on `src/`; `test/fixtures/` does not need full coverage.

### Per-module focus

| Module | What to cover |
|---|---|
| `discovery.ts` | Happy path; 404 on either `.well-known`; malformed JSON; missing required fields |
| `registration.ts` | Successful DCR; AS rejects registration (4xx); metadata lacks `registration_endpoint` |
| `oauth.ts` | Full flow with injected `browserOpener`; **state mismatch (CSRF defense)**; invalid PKCE verifier; callback arrives with `?error=access_denied`; token endpoint returns error; stray loopback request before the real callback |
| `tokens.ts` | Save/load round-trip; file is `0600`; atomic-write (mock `fs.rename` to throw, assert no corruption); refresh success → new tokens persisted; refresh fails with `invalid_grant` → file deleted, `RefreshFailed` thrown; no file → `NoStoredCredentials` |
| `client.ts` | First connect end-to-end; second connect reuses stored creds (no browser); MCP returns 401 mid-call → transparent refresh + retry; refresh-then-retry failure → error surfaced |
| `cli.ts` | Each subcommand wired correctly; argument parsing; errors → friendly stderr + non-zero exit |

### End-to-end test

One subprocess-level test that boots the local server, runs the compiled CLI via `execa`, and exercises `login` → `tools` → `call`. Catches packaging bugs that unit tests cannot.

## Error handling

Custom error classes (one per failure mode) in `src/errors.ts`:

```
DiscoveryFailed         bad metadata, network failure
RegistrationFailed      DCR rejected, or no registration_endpoint
AuthorizationDenied     user denied, or AS returned ?error=
TokenExchangeFailed     token endpoint returned 4xx
NoStoredCredentials     first run for this server
RefreshFailed           refresh token rejected; re-login needed
MCPRequestFailed        authenticated MCP call failed
```

Each carries the server URL, HTTP status where applicable, and any error body the AS returned — so the CLI can surface "Linear's auth server said: invalid_redirect_uri" instead of a generic failure.

### CLI error presentation

```
$ mcp-dcr-client tools https://mcp.linear.app/sse
✗ No stored credentials for mcp.linear.app
  Run: mcp-dcr-client login https://mcp.linear.app/sse
```

```
$ mcp-dcr-client login https://mcp.example.com/mcp
✗ Server doesn't support Dynamic Client Registration.
  Its authorization server metadata has no `registration_endpoint`.
  This client only works with DCR-enabled servers.
```

PKCE state validation is enforced at every step; tests cover the mismatch case explicitly.

## Deliverables

- **Source** (`src/`): six modules as described above.
- **Tests** (`test/`): per-module suites plus one end-to-end subprocess test, using the local fixture server.
- **Local fixture server** (`test/fixtures/server/`): spec-compliant; also usable standalone for offline demo.
- **README.md**: setup, how to run against Linear, how to run against the local server, architecture section with a sequence diagram of the auth dance.
- **POV.md**: when DCR shines (dynamic enterprise tool onboarding, no pre-registration), where it falls short (AS discoverability, trust assumptions, consent fatigue), what surprised me during implementation, what would need to change for production use (keychain, file locking, telemetry, scope handling).
- **GitHub repo:** public, pushed to `github.com/mariamcl/mcp-dcr-client`.

## Dependencies

Runtime:

- `@modelcontextprotocol/sdk` — MCP client transport and JSON-RPC framing
- `openid-client` (or `oauth4webapi`) — PKCE + authorization-code flow primitives; avoid hand-rolling crypto
- `open` — invoke the browser
- `commander` — CLI argument parsing

Dev:

- `typescript`, `vitest`, `@vitest/coverage-v8`
- `express` — local fixture server
- `execa` — end-to-end subprocess test

## Risks and open questions

- **Linear DCR compatibility.** The plan assumes `mcp.linear.app` supports DCR per the current MCP auth spec. If it does not, swap to a Cloudflare-hosted MCP server or note the limitation. To be verified in the first hour of implementation.
- **MCP SDK auth surface.** The official SDK is evolving; if it starts imposing its own DCR flow by the time of implementation, this design keeps the auth logic separate enough that we can adapt.
- **Resource-indicator support in `openid-client`.** RFC 8707 support needs to be confirmed in the chosen OAuth library; if missing, the library is still useful for PKCE primitives and we add the `resource` parameter manually.
