# mcp-dcr-client

A TypeScript MCP client demonstrating **Dynamic Client Registration (RFC 7591)** + **OAuth 2.1 + PKCE** against any DCR-enabled MCP server.

Registers itself dynamically — no pre-registered client_id, no shared secrets baked into the binary. The client discovers, registers, authenticates, and starts using tools, all from one URL.

## Quick start

Requires Node 20+.

```bash
npm install
npm run build

# Authenticate against a real MCP server (Linear, etc.)
./bin/mcp-dcr-client login https://mcp.linear.app/sse
./bin/mcp-dcr-client tools https://mcp.linear.app/sse
./bin/mcp-dcr-client describe https://mcp.linear.app/sse <tool>
./bin/mcp-dcr-client call https://mcp.linear.app/sse <tool> --arg=value
```

`describe` pretty-prints the input schema for a single tool — required and optional parameters, their types, and descriptions — so you can see what arguments a tool accepts without reading the full `tools` output.

## Try it offline against the bundled fixture server

```bash
# Terminal 1: start the local spec-compliant server (interactive approve mode)
npm run build
node --import tsx test/fixtures/server-cli.ts --port 3030

# Terminal 2: hit it
./bin/mcp-dcr-client login http://127.0.0.1:3030/mcp
./bin/mcp-dcr-client tools http://127.0.0.1:3030/mcp
./bin/mcp-dcr-client call http://127.0.0.1:3030/mcp echo --text=hello
```

## How it works

The auth dance:

```
1. Client GETs MCP server unauthenticated → 401 + WWW-Authenticate
2. Client GETs /.well-known/oauth-protected-resource → list of authorization servers
3. Client GETs /.well-known/oauth-authorization-server → authorize/token/registration endpoints
4. Client POSTs to /register with its metadata → fresh client_id (DCR)
5. Client generates PKCE verifier + state, opens browser to /authorize
6. User logs in, AS redirects to http://127.0.0.1:<port>/cb with ?code=&state=
7. Client's loopback HTTP server captures the code
8. Client POSTs to /token (with code + verifier + resource indicator) → access + refresh tokens
9. Tokens persisted to ~/.config/mcp-dcr-client/<sha256(server_url)>.json (mode 0600)
10. Client makes authenticated MCP calls with Authorization: Bearer ...
```

See `docs/superpowers/specs/2026-04-18-mcp-dcr-client-design.md` for the full design.

## Architecture

| Module | Responsibility |
|---|---|
| `src/discovery.ts` | Two-stage `.well-known` discovery |
| `src/registration.ts` | Dynamic Client Registration (RFC 7591) |
| `src/oauth.ts` | PKCE primitives, loopback callback server, token exchange, refresh |
| `src/tokens.ts` | Persistent storage with auto-refresh |
| `src/client.ts` | Orchestrator + MCP session |
| `src/cli.ts` | Three commands: `login`, `tools`, `call` |
| `src/errors.ts` | Typed error classes per failure mode |

## Tests

```bash
npm test         # run all
npm run coverage # with coverage report (target: 100% on src/)
```

Tests run against a bundled spec-compliant local MCP server (`test/fixtures/server.ts`) so they're hermetic and fast. Plus one end-to-end subprocess test that exercises the compiled CLI binary.

## Token storage

Tokens are stored at `~/.config/mcp-dcr-client/<sha256(server_url).slice(0,16)>.json` with file mode `0600` (owner read/write only). Each server gets its own file, so you can be authenticated to multiple MCP servers simultaneously.

Files are written atomically (write to `.tmp`, then `rename`). On token refresh failure, the file is deleted and you're prompted to re-login.

## License

MIT
