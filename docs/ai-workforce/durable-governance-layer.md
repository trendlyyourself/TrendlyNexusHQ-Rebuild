# Durable agent governance layer

Status: **implemented in an isolated feature branch; not merged, deployed, or connected to a live database.**

## Components

- `backend/migrations/001_agent_governance.sql` defines PostgreSQL records for per-agent service identities, owner approvals, Iris decisions and compliance holds, scoped delegated grants, approved sandbox targets, and audit events.
- `backend/agent-governance-store.js` is a PostgreSQL-pool adapter. It provisions one-time service credentials (only SHA-256 hashes are stored), authenticates/revokes identities, issues and consumes scoped approvals, records Iris decisions/holds, manages delegated grants, and writes authorization/outcome audit events.
- `backend/agent-auth.js` authenticates an individual service identity, attaches the identity from trusted server-side lookup, and exposes route guards and a guarded action executor.
- `backend/agent-policy.js` remains the deny-by-default role/action policy.

## Authority and safeguards

- The six service identities are distinct: Addy, Iris, Donny, Axel, Camden, and Boris. A request body cannot select its own agent identity.
- Owner approvals are accepted only when the application supplies an `isOwnerSubject` verifier bound to the authenticated owner identity. Approval records are exact-action, exact-scope, exact-environment, single-use, and expire within 15 minutes.
- Production approvals must explicitly set `productionExplicit=true`; every production action is denied otherwise.
- Iris decisions are issued only from an authenticated Iris service identity. Iris can approve a compliance gate, create a hold, and reapprove a matching scope; Iris cannot create owner approvals.
- Addy may delegate bounded, expiring grants to Camden for `people.update`. Owner-issued grants can authorize Addy's scoped engineering/operations actions. Grants have a bounded use count and can be revoked.
- Donny scans require a separately approved sandbox target, exact target scope, and sandbox environment.
- Approval/grant consumption and the authorization audit event occur in one database transaction with row locks, preventing a successful authorization from reusing a consumed record.
- Audit events are append-only at the SQL trigger layer. Database privileges must additionally prevent the application role from UPDATE, DELETE, or TRUNCATE on the audit table.
- Store/database failures fail closed. No agent-facing route may bypass the guarded dispatcher.

## Integration contract

The backend currently has no agent execution runtime or agent action routes. The new middleware/store are reusable enforcement primitives, not proof that all future tools are already guarded. Every future action route must:
1. Authenticate with `createAgentAuthenticationMiddleware(store)`.
2. Derive action scope and environment server-side; never trust request-body role, scope, approval, or environment claims.
3. Use `createAgentActionGuard` for a route whose scope is independently resolved, or `runGuardedAgentAction` around the actual tool call.
4. Never expose raw database access, provider credentials, or an alternate unguarded tool dispatcher to agents.
5. Record and review authorization plus outcome events by correlation ID.

## Database and identity bootstrap

The migration is code only. It has **not** been run against Neon or any other database. The adapter accepts a trusted node-postgres-compatible pool, but the backend package currently does not configure a database pool. Before integration, the owner must select/authorize a non-production database branch and the runtime connection method. Apply the migration only there after review.

The store's `isOwnerSubject` callback is mandatory for owner-only operations; it must validate the current authenticated human owner session, not a request field or a hard-coded email. Identity provisioning returns each secret once. Secrets must be delivered through an approved secret manager and never committed, logged, or placed in Notion. No credentials have been provisioned.

## Verification status

- Unit tests cover the policy engine, identity middleware, guarded dispatch behavior, hashed credential storage, authorization transaction/audit path, compliance-hold denial, and owner-verifier requirements.
- PostgreSQL migration and locking behavior still require execution against a disposable, non-production PostgreSQL instance.
- No agent runtime is activated; no provider/tool credentials or schedules are configured.
- Merge, deployment, production/database changes, and live payments remain outside this implementation.
