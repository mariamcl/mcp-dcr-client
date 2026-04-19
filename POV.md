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

[YOU — fill in 2-3 things you didn't expect when building this. Examples to consider:
- Two-stage discovery (RS metadata then AS metadata) isn't obvious from the spec on first read
- Loopback URL must be registered dynamically per-port; otherwise the redirect_uri match fails
- Linear's specific quirks (only fillable after T21 verification)
- How the MCP SDK's auth helpers compared to hand-rolling
- Anything about the LLM workflow that surprised you (good or bad)
- Specific things you thought would be hard but weren't, or vice versa]

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

[YOU — write 1-2 paragraphs about the actual experience building this with Claude Code / Codex / similar. Honest take. Things to consider:
- What the LLM workflow let you do faster
- Where it surprised you (good or bad)
- What you'd want to see improve
- Whether the discipline of brainstorm → plan → execute (vs vibes coding) was worth it for this scope
- Whether you'd reach for this approach for the next takehome / next project / production work]
