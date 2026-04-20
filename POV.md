# A POV on MCP Dynamic Client Registration

## When this approach shines

DCR + OAuth 2.1 lets an MCP client connect to a server it's never seen before, with no pre-registered credentials, no shared API keys, no out-of-band setup. For an enterprise context, this is genuinely transformative: a user can paste an MCP server URL into Claude (or any DCR-aware client) and immediately start using it, with their own identity, scoped to their own permissions, mediated by their company's IdP.

The most interesting use case is **dynamic enterprise tool onboarding**. The IT admin doesn't have to know about every MCP server employees might want to use. The user clicks "connect," authenticates against the server's IdP (which may be the company's IdP via SAML/OIDC federation), and the integration is live. No pre-registered "Claude OAuth app" per service. No shared client secrets. No support ticket.

It's also the right shape for **multi-tenant integrations**. Each user's tokens are scoped to that user; a malicious client_id can't escalate to other users' data because the token itself is bound to the user's authenticated session. The client_id is essentially throwaway — it identifies the *installation*, not the user.

## Where it falls short

**AS discoverability is fragile.** The two-stage `.well-known` flow (resource server → authorization server) assumes well-behaved servers. In practice, many "MCP servers with OAuth" out there don't fully implement the latest auth spec, don't return `WWW-Authenticate` correctly, or split their RS and AS in ways the spec didn't fully anticipate. Production clients need fallback strategies and clear error UX for the "this server says it does OAuth, but..." cases.

**Trust assumptions.** DCR means *anyone* can register a client. The whole protection model relies on the user actively recognizing that they're authorizing the right tool, on a properly-validated AS, with a sensible scope. Phishing and consent fatigue are real risks. Real-world deployments will need consent UX that's harder to abuse than a generic "Allow access?" page — and the client itself doesn't help here, because by definition the AS doesn't know who the client is in advance.

**Resource indicators are the load-bearing security primitive.** RFC 8707 prevents tokens from being reused across servers, but lots of ASes don't enforce them yet. Without enforcement, a malicious MCP server can socially-engineer a user into authorizing a token that's also valid against a different MCP server they happen to use. This POC includes the `resource` parameter from the start, but it's only useful if the AS bothers to bind tokens to it.

## What surprised me

**The loopback HTTP server pattern was new to me.** I hadn't realized the OAuth flow for native clients (anything that isn't a web app) requires the client itself to spin up a tiny local HTTP server *just* to catch the redirect from the browser. Two round trips to the authorization server — one through the user's browser to `/authorize`, one straight from the client to `/token` — instead of the single request/response I'd have sketched from scratch. And the client has to play two roles simultaneously: outbound HTTP requester *and* local HTTP server. Once you see why (the AS can't redirect a browser back to a CLI process without something to redirect *to*), it makes sense, but it's not the shape I'd have predicted.

**Linear uses SSE transport, not the simple "POST JSON-RPC" shape I'd assumed.** My first attempt to call a tool against `mcp.linear.app/sse` returned 404 — the `/sse` path expects a GET to open an event stream, not a POST. Real-world MCP servers right now are mid-migration between SSE and the newer Streamable HTTP transport, and a naive client that hard-codes one or the other won't work universally. Switching to the official MCP SDK's transports (which handle both) was the fix.

**Some OAuth providers only expose OIDC discovery (`/.well-known/openid-configuration`), not the OAuth-specific `/.well-known/oauth-authorization-server`.** The two documents are nearly identical for the fields we care about, so a robust client should fall back to the OIDC one. Mine doesn't yet — that's noted in the production gaps section.

**The MCP SDK has a Client + transports but almost no auth glue.** I hand-rolled discovery, DCR, PKCE, the loopback callback server, and token storage because the SDK doesn't expose helpers for any of that yet — it stops at "give me an authenticated transport and I'll do JSON-RPC over it." Hand-rolling was actually fine for understanding the spec, but I'd expect more of this to move into the SDK as the auth spec stabilizes.

## Production gaps

What I'd add before shipping this for real:

- **OS keychain integration** via `keytar` (Keychain / Secret Service / DPAPI) instead of file storage with `0600`. The current approach matches `gh` and `gcloud` but a serious enterprise tool should encrypt tokens at rest.
- **File locking** for concurrent invocations. Two CLI invocations refreshing the same token simultaneously may clobber each other; the next run would just refresh again, but a long-running daemon would get worse failure modes.
- **Telemetry**, with care. Auth failure modes are exactly the place where good observability separates "broken integration" from "fixed in 5 minutes." Need to be careful not to leak tokens or PII.
- **Scope handling.** This POC requests no specific scopes; production should let users choose, or at least surface the requested scopes during consent.
- **Token rotation / revocation.** The spec supports refresh-token rotation (we exercise this against the fixture); we don't exercise revocation. Production should support `POST /revoke` (RFC 7009) on logout.
- **`WWW-Authenticate` fallback.** Current discovery assumes `/.well-known/oauth-protected-resource` is at the server's origin. The spec also lets servers signal it via the `WWW-Authenticate` header on a 401 — more robust to follow that, especially for servers behind reverse proxies that strip well-known paths.
- **Per-user credential isolation.** This POC keys credentials by server URL hash. A multi-user system would also key by user identity (or store per-user-account directories).

## On using LLM-driven dev tools

The pace was the biggest surprise — a project I'd budget a full weekend for came together in one focused session. What I found interesting was that I still found ways to improve the final product. A tool on the fixture server (`search`) had been wired into the `tools/list` response without a matching `tools/call` handler — easy to miss, obvious once I tried calling it. I added a `describe` CLI subcommand to print a tool's input schema, so I'd stop guessing arg names. I added stricter error handling on positional args.

The shape that worked for me: I drove the solution and asked Claude to explain *what* it was doing — the auth dance, why the loopback exists, why SSE caused our 404 — at the moments I wanted to understand. I didn't have to sit there googling answers to my own questions; the explanations came in the same conversation as the work.
