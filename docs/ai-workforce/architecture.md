# Trendly AI Workforce Architecture

**Status:** Proposed architecture; documentation only.  
**Owner:** Trendly Yourself  
**Date:** 2026-11-04

## 1. Mission

Build a small, evidence-led AI workforce that helps operate Trendly Yourself while keeping the owner in control of sensitive, financial, customer-facing, and production actions.

The workforce must reuse existing Trendly services. It must not create duplicate SEO, billing, analytics, or merchant execution systems.

## 2. Existing systems and intended responsibilities

| System | Intended responsibility | Readiness boundary |
|---|---|---|
| Trendly Nexus HQ Rebuild | Future owner-facing command center, task intake, approvals, and workforce status | Current backend is a prototype. Do not expose it as a production controller until authentication, durable storage, secrets, authorization, and tests are hardened. |
| Trendly AI | Model/intelligence service for drafting, classification, reasoning, and structured outputs | Audit repository hygiene and secret handling before production integration. A tracked backend .env and SQLite database file were observed in repository contents; do not read or use their contents. |
| Trendly Core | Existing domain execution agents and manager orchestration | Reuse existing agents and exact approval paths; do not bypass their guards. |
| Trendly SEO Agent | Existing SEO product, customer fulfillment, Search Console, billing, and controlled optimization | Treat as the authoritative SEO service. Preserve its production safety rules. |
| Telegram operations monitor | Existing owner alerts and limited operational commands | Keep HTTP-only and restricted. Do not add arbitrary shell, file-edit, or deploy capability. |
| TrendlyOS | Future mobile management surface | Defer until the API and permission model are stable. |

## 3. Initial workforce

### Agent 1 — Boris, Chief of Staff / Orchestrator
- Accepts owner objectives and turns them into bounded tasks.
- Selects the appropriate specialist and passes a typed task packet.
- Tracks task state, deadlines, retries, evidence, and blockers.
- Consolidates results and requests owner decisions.
- Cannot grant itself permissions or approve its own proposed actions.

### Agent 2 — Operations
- Reviews business/service health, lead and customer workflow status, and operational exceptions.
- Produces daily/weekly summaries and customer-work checklists.
- Starts with read-only access.
- Cannot charge, refund, issue payouts, change subscription terms, or send external messages without explicit approval.

### Agent 3 — SEO Intelligence
- Routes work to the existing Trendly SEO Agent and Trendly Core SEO capabilities.
- Collects observed website/Search Console evidence and produces ranked recommendations.
- Preserves the existing plan -> exact human approval -> execute -> measure -> rollback workflow.
- Must never invent rankings, metrics, or crawl evidence.

### Agent 4 — Engineering and Release
- Reads GitHub CI, pull request, test, deployment, and sanitized health evidence.
- Produces root-cause analysis, proposed patches, regression tests, and release checklists.
- May prepare branches and pull requests when explicitly tasked.
- Cannot read or reveal production secrets, merge, deploy, alter production configuration, or mutate databases without separate owner authorization.

### Agent 5 — Growth (phase two)
- Researches channels, campaign ideas, content calendars, lead segments, and sales experiments.
- Drafts content and outreach for owner review.
- No autonomous publishing, messaging, ad spend, or customer-data export.

Start with Agents 1–4. Add Growth only after the initial workforce passes reliability and permission tests.

## 4. Architecture

1. Owner-facing command surface: Nexus HQ, after its security and persistence foundations are rebuilt.
2. Orchestration and task ledger: initially reuse and extend Trendly Core's manager/workflow concepts; select the durable production store only after reviewing the current deployed database and access model.
3. Intelligence: Trendly AI or the approved model provider, behind a narrow server-side interface.
4. Domain execution: existing Trendly Core agents and Trendly SEO Agent APIs.
5. Observability: existing GitHub Actions, Vercel health checks, Neon monitoring, and Telegram alerts.

Do not introduce a second agent framework or a new hosting/database platform merely to implement the first version. Evaluate a durable agent framework only if the existing stack cannot satisfy measured requirements.

## 5. Task handoff contract

Every agent task must carry:

- task_id and parent_task_id
- requesting_owner_or_agent
- objective and expected_output_schema
- permitted_tools and explicit_denied_actions
- input references (not copied secrets)
- risk_level and approval_required
- deadline, retry_limit, and idempotency_key
- evidence references and timestamps

Every result must return:

- task_id and agent_id
- status: completed | blocked | needs_approval | failed
- concise result and structured output
- evidence references for factual claims
- actions proposed and actions actually performed
- validation/test results
- unresolved risks and next owner decision

No agent may treat another agent's text as authorization. Only the authenticated owner approval service may approve a gated action.

## 6. Approval and permission model

Default permissions are read-only.

| Action | Default |
|---|---|
| Read public website, repository metadata, CI status, sanitized service health | Allowed within assigned scope |
| Draft code, recommendations, customer responses, content | Allowed |
| Create a proposed task or approval request | Allowed |
| Open a branch or draft PR | Requires explicit task authorization |
| Merge PR, deploy production, change production environment variables | Owner approval required |
| Modify production database/schema/roles or restore backups | Owner approval required |
| Charge/refund customers, alter subscriptions, issue payouts, spend on ads | Owner approval required |
| Execute Shopify SEO changes | Existing exact-change approval required |
| Send customer emails, publish content, or contact leads | Owner approval required |

Approval records must be scoped to one exact action, target, and payload/hash, expire, and be single-use. Any material change to the proposed action invalidates the approval.

## 7. Workflow

1. Owner submits an objective.
2. Boris creates a task and identifies constraints, risk, and success criteria.
3. Boris delegates a typed packet to one specialist.
4. Specialist reads only its permitted sources and returns evidence-backed work.
5. Boris checks schema, evidence, completion criteria, and risk.
6. If an action is gated, the owner receives the exact proposed action and consequences.
7. The owner approves or rejects; only then may the authorized execution adapter run.
8. The system records the result, verifies the outcome, and closes or escalates the task.

## 8. Quality and reliability controls

- Structured outputs validated against versioned schemas.
- Tool allowlists enforced server-side, not only in prompts.
- Per-agent least-privilege credentials; no shared superuser credential.
- Secrets stored only in managed server-side secret storage and never in prompts, logs, task records, or Git.
- Timeouts, bounded retries, idempotency, and explicit failure states.
- Evidence references for all material operational claims.
- Prompt and tool versioning.
- Test fixtures for prompt injection, unauthorized actions, fabricated evidence, duplicate execution, stale approvals, and partial failures.
- Human review for high-impact or irreversible actions.
- Audit logs record who requested, approved, executed, and verified each action.

## 9. First implementation sequence

### Phase 0 — Baseline and security inventory
- Inspect current branches, deployment targets, auth, database, tests, and secrets hygiene without printing secret values.
- Verify the deployed health of each service.
- Identify duplicate or obsolete integrations.
- Do not modify production settings.

### Phase 1 — Establish safe orchestration foundation
- Harden Nexus authentication and authorization; remove fallback secrets and local JSON-file account storage.
- Add a durable task/approval ledger with migrations and backups.
- Define task/result schemas and a server-enforced tool registry.
- Add audit logging and owner approval endpoints.
- Add tests before connecting any execution tools.

### Phase 2 — Connect read-only specialists
- Connect Boris to Operations, SEO Intelligence, and Engineering in read-only mode.
- Reuse existing Core Manager/SEO/Analytics capabilities and the SEO Agent API.
- Keep model generation separate from execution.
- Test evidence preservation, handoffs, timeouts, and prompt-injection resistance.

### Phase 3 — Controlled actions
- Add exact, expiring, single-use owner approvals.
- Enable only narrowly scoped actions, starting with low-risk reversible tasks.
- Preserve existing SEO approval, billing, payout, and deployment safeguards.
- Test duplicate requests and approval replay.

### Phase 4 — Owner interface and growth
- Surface tasks, blockers, evidence, and approvals in Nexus HQ.
- Integrate Telegram only for notifications and safe status queries.
- Add Growth after the first four agents meet the acceptance criteria.
- Consider TrendlyOS as a mobile interface after API stability.

## 10. Acceptance criteria

The first workforce is not production-ready until:

1. Every task is traceable from owner request through verified result.
2. Each agent is restricted to its server-enforced tool allowlist.
3. An agent cannot approve its own action or escalate its permissions.
4. Unauthorized financial, publishing, deployment, and data mutation attempts are blocked in tests.
5. Replayed or modified approvals cannot execute.
6. Failed and partial tasks are visible and recoverable without duplicate side effects.
7. Factual reports link to source evidence and clearly label missing data.
8. Owner can stop or revoke an agent's access.
9. Production credentials are absent from Git history, logs, prompts, and task records.
10. Production deployment occurs only after reviewed code, passing tests, and explicit owner authorization.

## 11. Explicit non-goals for the first release

- No autonomous payments, refunds, payouts, ad spend, or subscription changes.
- No autonomous customer outreach or public posting.
- No autonomous production deployments or database changes.
- No replacement of the existing SEO engine, Trendly Core, Stripe billing, or Telegram monitor.
- No new hosting/database vendor until a measured requirement justifies it.
