# Trendly Nexus HQ — Agent permission enforcement

Status: **implementation proposal on an isolated branch; not merged or deployed**.

## Scope

This module establishes a deny-by-default policy boundary for the six governed roles:
Addy, Iris, Donny, Axel, Camden, and Boris. It does not create model agents, grant credentials, activate schedules, or connect external systems.

## Role boundaries

| Role | Allowed action classes | Explicit exclusions |
|---|---|---|
| Addy | Workspace read, task delegation, scoped engineering read/write, scoped operational execution | Cannot self-grant; owner-reserved actions require verified owner approval, exact scope, and Iris approval |
| Iris | Compliance review, stop, re-review/reapproval | Cannot authorize owner-reserved actions or replace Alex's approval |
| Donny | Security review, verification, scans | Scans only on explicitly approved sandbox targets and named scope; never production or third-party targets |
| Axel | Research read, strategic recommendations | No execution, writes, purchases, external commitments, or authority over Donny |
| Camden | People operations, customer-support drafts and sends | Writes require scoped delegation; sends require verified Iris voice approval and exact scope |
| Boris | Independent oversight review and recommendations | No command, execution, credentials, or permission-granting authority |

## Owner-reserved action classes

Production changes, database mutations/permission changes, repository merges, deployments/promotions/rollbacks, live-payment configuration/transactions, access permission changes, and external commitments are reserved to Alex.

The policy permits an agent execution path only when all of the following are supplied by trusted server-side resolvers: Addy is the actor; an owner approval record is verified; the approval scope exactly matches the requested scope; Iris approval is independently verified; and any production-specific flag is explicit. A request payload must never be treated as an approval record.

## Enforcement contract

- Unknown agents/actions and ungranted role/action pairs are denied.
- Compliance holds deny all non-Iris actions.
- Donny's scan requires environment `sandbox`, a specifically approved target identifier, and a non-empty test scope.
- Camden customer sends require a verified Iris approval and a non-empty communication scope.
- Addy engineering/operations and Camden people updates require a verified delegated grant whose scope exactly matches the requested scope.
- Approval/grant resolver errors fail closed with HTTP 503; denied actions return HTTP 403.
- Agent identity must be derived from authenticated server-side state, not request-body input.
- The policy module deliberately does not treat a caller-provided `verified: true` field as proof. The middleware must be wired to trusted approval/grant stores before use.

## Current integration limitation — do not overstate readiness

The current backend has authentication and a projects endpoint, but no agent runtime, authenticated agent identity provider, owner-approval store, Iris approval store, delegated-grant store, or agent action routes. Therefore this branch adds a tested central policy engine and middleware contract, **not a claim that deployed agents are now restricted**. Do not expose agent execution routes until trusted resolvers and authenticated service identities are implemented and tested.

## Required next implementation gates

1. Implement durable owner approvals, Iris compliance decisions/holds, and scoped delegation records with immutable audit events.
2. Add authenticated service identities for each agent; no shared agent identity and no client-supplied role claims.
3. Wire every agent tool/action entrypoint through this middleware; prohibit direct provider/tool calls outside the guarded dispatcher.
4. Add integration tests for tampering, replay, expiry, scope mismatch, cross-agent impersonation, concurrent compliance stop, and audit integrity.
5. Run the complete backend test suite and security checks.
6. Review the PR; merge and deploy only after separate explicit owner authorization.

## Milestones

- Implemented: policy module, middleware contract, and unit tests on this branch.
- Tested: pending CI execution and full-suite evidence.
- Merged: not authorized.
- Deployed: not authorized.
- Production verified: not authorized.
