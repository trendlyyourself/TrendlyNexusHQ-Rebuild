"use strict";

// Central deny-by-default policy for Trendly's six named roles.
// This module is deliberately independent of any model/provider integration.
// Callers MUST derive actor identity from authenticated server-side state and
// must resolve ownerApproval.verified from a trusted approval record, never
// from request-body fields supplied by an agent or client.

const AGENTS = Object.freeze(["addy", "iris", "donny", "axel", "camden", "boris"]);

const OWNER_RESERVED_ACTIONS = new Set([
  "production.change",
  "database.mutate",
  "database.permission_change",
  "repository.merge",
  "deployment.promote",
  "deployment.rollback",
  "payment.live_configure",
  "payment.live_transaction",
  "access.permission_change",
  "external.commitment",
]);

const ROLE_ACTIONS = Object.freeze({
  addy: new Set(["workspace.read", "task.delegate", "engineering.read", "engineering.write", "operations.execute", "production.change", "database.mutate", "database.permission_change", "repository.merge", "deployment.promote", "deployment.rollback", "payment.live_configure", "payment.live_transaction", "access.permission_change", "external.commitment"]),
  iris: new Set(["workspace.read", "compliance.review", "compliance.stop", "compliance.reapprove"]),
  donny: new Set(["workspace.read", "security.review", "security.verify", "security.scan"]),
  axel: new Set(["workspace.read", "research.read", "strategy.recommend"]),
  camden: new Set(["workspace.read", "people.read", "people.update", "customer.support.draft", "customer.support.send"]),
  boris: new Set(["workspace.read", "oversight.review", "oversight.recommend"]),
});

const NON_PRODUCTION_ACTIONS = new Set([
  "task.delegate", "engineering.read", "engineering.write", "operations.execute",
  "compliance.review", "compliance.stop", "compliance.reapprove",
  "security.review", "security.verify", "security.scan",
  "research.read", "strategy.recommend", "people.read", "people.update",
  "customer.support.draft", "customer.support.send", "oversight.review", "oversight.recommend",
]);

function deny(reason) {
  return Object.freeze({ allowed: false, reason });
}

function allow(reason) {
  return Object.freeze({ allowed: true, reason });
}

function evaluateAgentAction(input = {}) {
  const {
    agent,
    action,
    environment = "unknown",
    scope,
    grant,
    ownerApproval,
    irisApproval,
    sandboxTarget,
    complianceHold = false,
  } = input;

  if (!AGENTS.includes(agent)) return deny("unknown_agent");
  if (typeof action !== "string" || !action) return deny("missing_action");
  if (!ROLE_ACTIONS[agent].has(action)) return deny("role_not_granted");
  if (complianceHold && agent !== "iris") return deny("compliance_hold_active");

  // Iris can stop work and conduct compliance review, but cannot approve
  // owner-reserved actions or convert a stop into owner authorization.
  if (agent === "iris" && OWNER_RESERVED_ACTIONS.has(action)) {
    return deny("iris_cannot_grant_owner_authority");
  }

  if (action === "security.scan") {
    if (environment !== "sandbox") return deny("security_testing_sandbox_only");
    if (!sandboxTarget || sandboxTarget.approved !== true ||
        typeof sandboxTarget.identifier !== "string" || !sandboxTarget.identifier.trim()) {
      return deny("explicit_sandbox_target_approval_required");
    }
    if (!scope || typeof scope !== "string" || !scope.trim()) {
      return deny("explicit_test_scope_required");
    }
  }

  if (action === "compliance.reapprove") {
    if (!irisApproval || irisApproval.verified !== true || !irisApproval.approvalId ||
        typeof scope !== "string" || !scope.trim()) {
      return deny("verified_reapproval_record_required");
    }
  }

  if (action === "customer.support.send") {
    if (agent !== "camden") return deny("customer_communication_role_required");
    if (!irisApproval || irisApproval.verified !== true || !irisApproval.approvalId) {
      return deny("iris_voice_check_required");
    }
    if (!scope || typeof scope !== "string" || !scope.trim()) {
      return deny("customer_communication_scope_required");
    }
  }

  if (action === "engineering.write" || action === "operations.execute" || action === "people.update") {
    if (!grant || grant.verified !== true || !grant.grantId || !grant.scope ||
        typeof scope !== "string" || !scope.trim() || grant.scope !== scope) {
      return deny("verified_scoped_delegation_required");
    }
    if (environment === "production") return deny("production_action_owner_approval_required");
  }

  if (OWNER_RESERVED_ACTIONS.has(action)) {
    if (agent !== "addy") return deny("owner_reserved_action");
    if (!ownerApproval || ownerApproval.verified !== true || !ownerApproval.approvalId ||
        !ownerApproval.scope || typeof scope !== "string" || ownerApproval.scope !== scope) {
      return deny("verified_owner_approval_required");
    }
    if (action === "production.change" && environment !== "production") {
      return deny("production_environment_mismatch");
    }
    if (environment === "production" && !ownerApproval.productionExplicit) {
      return deny("explicit_production_approval_required");
    }
    if (!irisApproval || irisApproval.verified !== true || !irisApproval.approvalId) {
      return deny("iris_compliance_approval_required");
    }
    return allow("owner_approved_scoped_action");
  }

  if (NON_PRODUCTION_ACTIONS.has(action) && environment === "production" &&
      !["workspace.read", "engineering.read", "compliance.review"].includes(action)) {
    return deny("non_production_role_action_blocked_in_production");
  }

  return allow("role_action_allowed");
}

function createAgentPolicyMiddleware(options = {}) {
  const resolveApproval = options.resolveApproval;
  const resolveGrant = options.resolveGrant;
  if (typeof resolveApproval !== "function" || typeof resolveGrant !== "function") {
    throw new TypeError("Trusted approval and grant resolvers are required");
  }

  return async function agentPolicyMiddleware(req, res, next) {
    try {
      const agent = req.agent && req.agent.id;
      const action = req.agentAction;
      const context = req.agentPolicyContext || {};
      const [ownerApproval, irisApproval, grant] = await Promise.all([
        resolveApproval({ req, agent, action, scope: context.scope }),
        options.resolveIrisApproval
          ? options.resolveIrisApproval({ req, agent, action, scope: context.scope })
          : Promise.resolve(null),
        resolveGrant({ req, agent, action, scope: context.scope }),
      ]);
      const decision = evaluateAgentAction({
        agent, action, scope: context.scope, environment: context.environment,
        sandboxTarget: context.sandboxTarget, complianceHold: context.complianceHold,
        ownerApproval, irisApproval, grant,
      });
      req.agentPolicyDecision = decision;
      if (!decision.allowed) return res.status(403).json({ error: "Agent action denied", code: decision.reason });
      return next();
    } catch {
      return res.status(503).json({ error: "Agent policy verification unavailable" });
    }
  };
}

module.exports = {
  AGENTS,
  OWNER_RESERVED_ACTIONS: Object.freeze([...OWNER_RESERVED_ACTIONS]),
  ROLE_ACTIONS,
  evaluateAgentAction,
  createAgentPolicyMiddleware,
};
