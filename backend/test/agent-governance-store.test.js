const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentGovernanceStore, hashAgentCredential } = require("../agent-governance-store");

function fakePool() {
  const state = { identities: [], audit: [], hold: false, queries: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      if (sql.includes("INSERT INTO agent_service_identities")) {
        const row = { id: "identity-1", agent_id: params[0], expires_at: params[3] };
        state.identities.push({ ...row, hash: params[1] });
        return { rows: [row] };
      }
      if (sql.includes("SELECT id, agent_id FROM agent_service_identities WHERE credential_hash")) {
        const row = state.identities.find((item) => item.hash === params[0]);
        return { rows: row ? [{ id: row.id, agent_id: row.agent_id }] : [] };
      }
      if (sql.includes("INSERT INTO agent_owner_approvals")) return { rows: [{ id: "owner-approval-1" }] };
      if (sql.includes("INSERT INTO agent_audit_events")) { state.audit.push({ sql, params }); return { rows: [] }; }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          state.queries.push({ sql, params });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
          if (sql.includes("SELECT id, agent_id FROM agent_service_identities WHERE id=")) {
            const row = state.identities.find((item) => item.id === params[0] && item.agent_id === params[1]);
            return { rows: row ? [{ id: row.id, agent_id: row.agent_id }] : [] };
          }
          if (sql.includes("FROM agent_compliance_holds")) return { rows: state.hold ? [{ id: "hold-1" }] : [] };
          if (sql.includes("INSERT INTO agent_audit_events")) { state.audit.push({ sql, params }); return { rows: [] }; }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  return pool;
}

test("identity provisioning stores only a one-way credential hash and returns secret once", async () => {
  const pool = fakePool();
  const store = createAgentGovernanceStore(pool);
  const result = await store.provisionIdentity({ agentId: "addy", label: "Addy service" });
  assert.equal(result.identity.agent_id, "addy");
  assert.equal(pool.state.identities[0].hash, hashAgentCredential(result.secret));
  assert.notEqual(pool.state.identities[0].hash, result.secret);
  assert.equal((await store.authenticateToken(result.secret)).id, "addy");
  assert.equal(await store.authenticateToken("wrong-token"), null);
});

test("unknown identities cannot be provisioned", async () => {
  const store = createAgentGovernanceStore(fakePool());
  await assert.rejects(store.provisionIdentity({ agentId: "root", label: "bad" }), /Unknown agent/);
});

test("authorization rechecks identity and writes an audit event transactionally", async () => {
  const pool = fakePool();
  const store = createAgentGovernanceStore(pool);
  await store.provisionIdentity({ agentId: "addy", label: "Addy" });
  const identity = { id: "addy", identityId: "identity-1" };
  const result = await store.authorizeAction({ identity, action: "workspace.read", scope: "repo:readme", environment: "sandbox", correlationId: "req-1" });
  assert.equal(result.allowed, true);
  assert.equal(pool.state.audit.length, 1);
  assert.ok(pool.state.queries.some((entry) => entry.sql === "BEGIN"));
  assert.ok(pool.state.queries.some((entry) => entry.sql === "COMMIT"));
});

test("active compliance hold blocks agent action and records denial", async () => {
  const pool = fakePool();
  pool.state.hold = true;
  const store = createAgentGovernanceStore(pool);
  await store.provisionIdentity({ agentId: "addy", label: "Addy" });
  const result = await store.authorizeAction({
    identity: { id: "addy", identityId: "identity-1" },
    action: "workspace.read", scope: "repo:readme", environment: "sandbox", correlationId: "req-hold",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "compliance_hold_active");
  assert.equal(pool.state.audit.length, 1);
});

test("owner approvals require an independently verified owner subject and short expiry", async () => {
  const pool = fakePool();
  const now = new Date("2026-11-16T20:00:00Z");
  const store = createAgentGovernanceStore(pool, {
    now: () => now,
    isOwnerSubject: async (subject) => subject === "verified-owner-subject",
  });
  await assert.rejects(store.issueOwnerApproval({
    owner: { subject: "untrusted" }, action: "repository.merge", scope: "release:1",
    environment: "sandbox", reason: "reviewed", expiresAt: new Date(now.getTime() + 60_000),
  }), /owner authorization required/);
  await assert.rejects(store.issueOwnerApproval({
    owner: { subject: "verified-owner-subject" }, action: "production.change", scope: "release:1",
    environment: "production", reason: "missing explicit flag", expiresAt: new Date(now.getTime() + 60_000),
  }), /explicitly authorize/);
  const approval = await store.issueOwnerApproval({
    owner: { subject: "verified-owner-subject" }, action: "repository.merge", scope: "release:1",
    environment: "sandbox", reason: "reviewed", expiresAt: new Date(now.getTime() + 60_000),
  });
  assert.equal(approval.id, "owner-approval-1");
  await assert.rejects(store.issueOwnerApproval({
    owner: { subject: "verified-owner-subject" }, action: "repository.merge", scope: "release:1",
    environment: "sandbox", reason: "too long", expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  }), /permitted lifetime/);
});
