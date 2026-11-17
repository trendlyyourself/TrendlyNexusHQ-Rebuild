"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAgentAction, createAgentPolicyMiddleware, AGENTS } = require("../agent-policy");

const scopedGrant = { verified: true, grantId: "grant-1", scope: "issue:42" };
const ownerApproval = { verified: true, approvalId: "owner-1", scope: "release:7", productionExplicit: true };
const irisApproval = { verified: true, approvalId: "iris-1" };

test("registers exactly the six governed roles", () => {
  assert.deepEqual(AGENTS, ["addy", "iris", "donny", "axel", "camden", "boris"]);
});

test("denies unknown agents, unknown actions, and ungranted cross-role actions", () => {
  assert.equal(evaluateAgentAction({ agent: "unknown", action: "workspace.read" }).allowed, false);
  assert.equal(evaluateAgentAction({ agent: "axel", action: "engineering.write" }).reason, "role_not_granted");
  assert.equal(evaluateAgentAction({ agent: "boris", action: "task.delegate" }).reason, "role_not_granted");
});

test("Addy can delegate only with a verified, matching scoped grant", () => {
  assert.equal(evaluateAgentAction({ agent: "addy", action: "engineering.write", scope: "issue:42" }).reason,
    "verified_scoped_delegation_required");
  assert.equal(evaluateAgentAction({ agent: "addy", action: "engineering.write", scope: "issue:42", grant: scopedGrant }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "addy", action: "engineering.write", scope: "issue:43", grant: scopedGrant }).allowed, false);
});

test("Iris can stop work but cannot grant owner-reserved authority", () => {
  assert.equal(evaluateAgentAction({ agent: "iris", action: "compliance.stop" }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "iris", action: "production.change" }).reason,
    "role_not_granted");
});

test("Iris cannot lift a compliance hold without a verified scoped reapproval record", () => {
  assert.equal(evaluateAgentAction({ agent: "iris", action: "compliance.reapprove", scope: "finding:9" }).reason,
    "verified_reapproval_record_required");
  assert.equal(evaluateAgentAction({ agent: "iris", action: "compliance.reapprove", scope: "finding:9",
    irisApproval }).allowed, true);
});

test("compliance hold blocks every non-Iris role", () => {
  assert.equal(evaluateAgentAction({ agent: "addy", action: "workspace.read", complianceHold: true }).reason,
    "compliance_hold_active");
  assert.equal(evaluateAgentAction({ agent: "iris", action: "compliance.review", complianceHold: true }).allowed, true);
});

test("Donny's security scans require a specifically approved sandbox target and scope", () => {
  assert.equal(evaluateAgentAction({ agent: "donny", action: "security.scan", environment: "production",
    scope: "read-only scan", sandboxTarget: { approved: true, identifier: "sandbox-a" } }).reason,
    "security_testing_sandbox_only");
  assert.equal(evaluateAgentAction({ agent: "donny", action: "security.scan", environment: "sandbox",
    scope: "read-only scan" }).reason, "explicit_sandbox_target_approval_required");
  assert.equal(evaluateAgentAction({ agent: "donny", action: "security.scan", environment: "sandbox",
    scope: "read-only scan", sandboxTarget: { approved: true, identifier: "sandbox-a" } }).allowed, true);
});

test("Camden cannot send customer communications without Iris voice approval and scope", () => {
  assert.equal(evaluateAgentAction({ agent: "camden", action: "customer.support.send", scope: "ticket:8" }).reason,
    "iris_voice_check_required");
  assert.equal(evaluateAgentAction({ agent: "camden", action: "customer.support.send", scope: "ticket:8",
    irisApproval }).allowed, true);
});

test("Axel and Boris remain recommendation/advisory roles", () => {
  assert.equal(evaluateAgentAction({ agent: "axel", action: "strategy.recommend" }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "axel", action: "operations.execute" }).allowed, false);
  assert.equal(evaluateAgentAction({ agent: "boris", action: "oversight.recommend" }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "boris", action: "engineering.write" }).allowed, false);
});

test("owner-reserved actions require Addy, verified owner approval, matching scope, and Iris approval", () => {
  assert.equal(evaluateAgentAction({ agent: "addy", action: "repository.merge", scope: "release:7",
    ownerApproval, irisApproval, environment: "staging" }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "addy", action: "repository.merge", scope: "release:7",
    ownerApproval, environment: "staging" }).reason, "iris_compliance_approval_required");
  assert.equal(evaluateAgentAction({ agent: "addy", action: "repository.merge", scope: "other",
    ownerApproval, irisApproval, environment: "staging" }).reason, "verified_owner_approval_required");
  assert.equal(evaluateAgentAction({ agent: "camden", action: "repository.merge",
    ownerApproval, irisApproval }).reason, "role_not_granted");
});

test("production changes require explicitly scoped owner approval and Iris approval", () => {
  assert.equal(evaluateAgentAction({ agent: "addy", action: "production.change", scope: "release:7",
    environment: "production", ownerApproval, irisApproval }).allowed, true);
  assert.equal(evaluateAgentAction({ agent: "addy", action: "production.change", scope: "release:7",
    environment: "production", ownerApproval }).reason, "iris_compliance_approval_required");
  assert.equal(evaluateAgentAction({ agent: "addy", action: "production.change", scope: "release:7",
    environment: "production", ownerApproval: { ...ownerApproval, productionExplicit: false }, irisApproval }).reason,
    "explicit_production_approval_required");
});

test("middleware fails closed when trusted approval verification fails", async () => {
  const middleware = createAgentPolicyMiddleware({
    resolveApproval: async () => { throw new Error("store unavailable"); },
    resolveGrant: async () => null,
  });
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await middleware({ agent: { id: "addy" }, agentAction: "workspace.read" }, response, () => {
    throw new Error("next must not run");
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "Agent policy verification unavailable");
});

test("middleware denies unverified caller-supplied authority", async () => {
  const middleware = createAgentPolicyMiddleware({
    resolveApproval: async () => null,
    resolveGrant: async () => null,
  });
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  let nextCalled = false;
  await middleware({ agent: { id: "addy" }, agentAction: "engineering.write",
    agentPolicyContext: { scope: "issue:42", grant: { verified: true } } }, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});
