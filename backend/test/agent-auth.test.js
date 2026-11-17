const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentAuthenticationMiddleware, createAgentActionGuard, runGuardedAgentAction } = require("../agent-auth");

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("agent auth derives identity only from trusted credential lookup", async () => {
  const store = { authenticateToken: async (token) => token === "valid-secret-token-value-long-enough"
    ? Object.freeze({ id: "addy", identityId: "identity-1" }) : null };
  const middleware = createAgentAuthenticationMiddleware(store);
  const res = response();
  let called = false;
  await middleware({ headers: { authorization: "Bearer valid-secret-token-value-long-enough" } }, res, () => { called = true; });
  assert.equal(called, true);
  assert.deepEqual(res.body, null);
  const denied = response();
  await middleware({ headers: { authorization: "Bearer invalid" } }, denied, () => assert.fail("must deny"));
  assert.equal(denied.statusCode, 401);
});

test("agent auth fails closed when identity storage is unavailable", async () => {
  const middleware = createAgentAuthenticationMiddleware({ authenticateToken: async () => { throw new Error("db down"); } });
  const res = response();
  await middleware({ headers: { authorization: "Bearer valid-secret-token-value-long-enough" } }, res, () => assert.fail("must stop"));
  assert.equal(res.statusCode, 503);
});

test("action guard uses server-side scope and records deny before next", async () => {
  let seen;
  const store = { authorizeAction: async (input) => { seen = input; return { allowed: false, reason: "compliance_hold_active" }; } };
  const guard = createAgentActionGuard({ store, action: "engineering.write", scopeResolver: async () => "repo:private#branch:feature" });
  const req = { agent: { id: "addy", identityId: "identity-1" }, body: { scope: "attacker-scope" }, headers: {} };
  const res = response();
  await guard(req, res, () => assert.fail("must not continue"));
  assert.equal(seen.scope, "repo:private#branch:feature");
  assert.equal(res.statusCode, 403);
});

test("guarded action records success and failure outcomes", async () => {
  const outcomes = [];
  const store = {
    authorizeAction: async () => ({ allowed: true }),
    recordActionOutcome: async (event) => outcomes.push(event.outcome),
  };
  const req = { agent: { id: "addy", identityId: "identity-1" }, headers: {} };
  assert.equal(await runGuardedAgentAction({ req, action: "workspace.read", scope: "repo", environment: "sandbox", store, execute: async () => "ok" }), "ok");
  await assert.rejects(runGuardedAgentAction({ req, action: "workspace.read", scope: "repo", environment: "sandbox", store, execute: async () => { throw Object.assign(new Error("failure"), { code: "FAIL" }); } }), /failure/);
  assert.deepEqual(outcomes, ["success", "failure"]);
});

test("guarded action does not execute when authorization is denied", async () => {
  let executed = false;
  const store = { authorizeAction: async () => ({ allowed: false, reason: "compliance_hold_active" }) };
  const req = { agent: { id: "addy", identityId: "identity-1" }, headers: {} };
  await assert.rejects(runGuardedAgentAction({ req, action: "engineering.write", scope: "repo", environment: "sandbox", store, execute: async () => { executed = true; } }), { code: "AGENT_ACTION_DENIED" });
  assert.equal(executed, false);
});
