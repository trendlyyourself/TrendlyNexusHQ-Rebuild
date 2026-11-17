"use strict";

const crypto = require("node:crypto");
const { AGENTS, OWNER_RESERVED_ACTIONS, evaluateAgentAction } = require("./agent-policy");

const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const sameHash = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
};

function createAgentGovernanceStore(pool, options = {}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("A trusted PostgreSQL pool is required");
  const now = options.now || (() => new Date());

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function provisionIdentity({ agentId, label, expiresAt }) {
    if (!AGENTS.includes(agentId)) throw new TypeError("Unknown agent identity");
    if (typeof label !== "string" || !label.trim()) throw new TypeError("Identity label is required");
    const secret = crypto.randomBytes(32).toString("base64url");
    const result = await pool.query(
      "INSERT INTO agent_service_identities (agent_id, credential_hash, label, expires_at) VALUES ($1,$2,$3,$4) RETURNING id, agent_id, expires_at",
      [agentId, sha256(secret), label.trim(), expiresAt || null]
    );
    return { identity: result.rows[0], secret };
  }

  async function authenticateToken(token) {
    if (typeof token !== "string" || token.length < 32 || token.length > 512) return null;
    const result = await pool.query(
      "SELECT id, agent_id FROM agent_service_identities WHERE credential_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2) LIMIT 1",
      [sha256(token), now()]
    );
    const identity = result.rows[0];
    if (!identity) return null;
    await pool.query("UPDATE agent_service_identities SET last_used_at = $2 WHERE id = $1", [identity.id, now()]);
    return Object.freeze({ id: identity.agent_id, identityId: identity.id });
  }

  async function authorizeAction({ identity, action, scope, environment = "unknown", sandboxTargetId, correlationId }) {
    if (!identity || !AGENTS.includes(identity.id) || !identity.identityId) throw new TypeError("Authenticated agent identity required");
    if (typeof correlationId !== "string" || !correlationId.trim()) throw new TypeError("Correlation ID required");

    return withTransaction(async (client) => {
      // Lock the identity row to ensure it has not been revoked since authentication.
      const activeIdentity = await client.query(
        "SELECT id, agent_id FROM agent_service_identities WHERE id=$1 AND agent_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $3) FOR UPDATE",
        [identity.identityId, identity.id, now()]
      );
      if (!activeIdentity.rows[0]) throw new Error("Agent identity revoked or expired");

      const hold = await client.query(
        "SELECT id FROM agent_compliance_holds WHERE lifted_at IS NULL AND (scope='*' OR scope=$1) LIMIT 1 FOR UPDATE",
        [scope || ""]
      );
      const complianceHold = hold.rows.length > 0;

      let ownerApproval = null, irisApproval = null, grant = null, sandboxTarget = null;
      let approvalId = null, irisDecisionId = null, grantId = null;

      if (OWNER_RESERVED_ACTIONS.includes(action)) {
        const owner = await client.query(
          "SELECT id, production_explicit FROM agent_owner_approvals WHERE action=$1 AND scope=$2 AND environment=$3 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>$4 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [action, scope, environment, now()]
        );
        if (owner.rows[0]) {
          approvalId = owner.rows[0].id;
          ownerApproval = { verified: true, approvalId, scope, productionExplicit: owner.rows[0].production_explicit };
        }
        const iris = await client.query(
          "SELECT id FROM agent_iris_decisions WHERE decision='approve' AND action=$1 AND scope=$2 AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>$3) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [action, scope, now()]
        );
        if (iris.rows[0]) {
          irisDecisionId = iris.rows[0].id;
          irisApproval = { verified: true, approvalId: irisDecisionId };
        }
      } else if (action === "customer.support.send" || action === "compliance.reapprove") {
        const decision = await client.query(
          "SELECT id FROM agent_iris_decisions WHERE decision=$1 AND scope=$2 AND action=$3 AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>$4) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [action === "compliance.reapprove" ? "reapprove" : "approve", scope, action, now()]
        );
        if (decision.rows[0]) {
          irisDecisionId = decision.rows[0].id;
          irisApproval = { verified: true, approvalId: irisDecisionId };
        }
      }

      if (["engineering.write", "operations.execute", "people.update"].includes(action)) {
        const delegated = await client.query(
          "SELECT id FROM agent_delegated_grants WHERE grantee_agent=$1 AND action=$2 AND scope=$3 AND revoked_at IS NULL AND expires_at>$4 AND use_count<max_uses ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [identity.id, action, scope, now()]
        );
        if (delegated.rows[0]) {
          grantId = delegated.rows[0].id;
          grant = { verified: true, grantId, scope };
        }
      }

      if (action === "security.scan" && sandboxTargetId) {
        const target = await client.query(
          "SELECT target_id, scope FROM agent_sandbox_targets WHERE target_id=$1 AND environment='sandbox' AND scope=$2 AND revoked_at IS NULL AND expires_at>$3 LIMIT 1",
          [sandboxTargetId, scope, now()]
        );
        if (target.rows[0]) sandboxTarget = { approved: true, identifier: target.rows[0].target_id };
      }

      const decision = evaluateAgentAction({
        agent: identity.id, action, scope, environment, complianceHold,
        ownerApproval, irisApproval, grant, sandboxTarget,
      });

      if (decision.allowed) {
        if (approvalId) await client.query("UPDATE agent_owner_approvals SET consumed_at=$2 WHERE id=$1", [approvalId, now()]);
        if (irisDecisionId) await client.query("UPDATE agent_iris_decisions SET consumed_at=$2 WHERE id=$1", [irisDecisionId, now()]);
        if (grantId) await client.query("UPDATE agent_delegated_grants SET use_count=use_count+1 WHERE id=$1", [grantId]);
      }

      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, actor_identity_id, action, scope, environment, decision, reason, approval_id, iris_decision_id, grant_id, correlation_id, details) VALUES ('action.authorization', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",
        [identity.id, identity.identityId, action || null, scope || null, environment, decision.allowed ? "allow" : "deny",
          decision.reason, approvalId, irisDecisionId, grantId, correlationId, JSON.stringify({ sandboxTargetId: sandboxTargetId || null })]
      );
      return Object.freeze({ ...decision, approvalId, irisDecisionId, grantId, correlationId });
    });
  }

  async function recordActionOutcome({ identity, action, scope, environment, correlationId, outcome, errorCode }) {
    if (!identity || !identity.identityId || !correlationId) throw new TypeError("Audit context required");
    if (!["success", "failure"].includes(outcome)) throw new TypeError("Invalid action outcome");
    await pool.query(
      "INSERT INTO agent_audit_events (event_type, actor_agent, actor_identity_id, action, scope, environment, decision, reason, correlation_id, details) VALUES ('action.outcome',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
      [identity.id, identity.identityId, action, scope || null, environment || "unknown", outcome,
        outcome === "success" ? "completed" : "execution_failed", correlationId, JSON.stringify({ errorCode: errorCode || null })]
    );
  }


  function requireIdentity(identity, expected) {
    if (!identity || identity.id !== expected || !identity.identityId) {
      throw new Error("Authenticated " + expected + " identity required");
    }
  }

  function requireFutureExpiry(expiresAt, maxMs) {
    const value = new Date(expiresAt);
    const delta = value.getTime() - now().getTime();
    if (!Number.isFinite(delta) || delta <= 0 || delta > maxMs) {
      throw new TypeError("Expiry must be in the future and within the permitted lifetime");
    }
    return value;
  }

  async function issueOwnerApproval({ owner, action, scope, environment, reason, expiresAt, productionExplicit = false }) {
    if (!owner || typeof owner.subject !== "string" || typeof options.isOwnerSubject !== "function" ||
        !(await options.isOwnerSubject(owner.subject))) {
      throw new Error("Authenticated owner authorization required");
    }
    if (!OWNER_RESERVED_ACTIONS.includes(action) || typeof scope !== "string" || !scope.trim() ||
        typeof environment !== "string" || !environment.trim() || typeof reason !== "string" || !reason.trim()) {
      throw new TypeError("Exact owner approval action, scope, environment, and reason are required");
    }
    if (environment === "production" && productionExplicit !== true) {
      throw new Error("Production approval must explicitly authorize the production environment");
    }
    const expiry = requireFutureExpiry(expiresAt, 15 * 60 * 1000);
    const result = await pool.query(
      "INSERT INTO agent_owner_approvals (owner_subject, action, scope, environment, production_explicit, reason, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, action, scope, environment, expires_at",
      [owner.subject, action, scope, environment, productionExplicit === true, reason.trim(), expiry]
    );
    await pool.query(
      "INSERT INTO agent_audit_events (event_type, action, scope, environment, decision, reason, correlation_id, details) VALUES ('owner.approval_issued',$1,$2,$3,'approved',$4,$5,$6::jsonb)",
      [action, scope, environment, reason.trim(), crypto.randomUUID(), JSON.stringify({ approvalId: result.rows[0].id, ownerSubject: owner.subject })]
    );
    return result.rows[0];
  }

  async function recordIrisDecision({ identity, decision, action, scope, reason, evidenceRef, expiresAt }) {
    requireIdentity(identity, "iris");
    if (!["approve", "reapprove", "hold", "reject"].includes(decision) ||
        typeof scope !== "string" || !scope.trim() || typeof reason !== "string" || !reason.trim()) {
      throw new TypeError("Iris decision, exact scope, and reason are required");
    }
    if (decision === "approve" && OWNER_RESERVED_ACTIONS.includes(action) && !action) {
      throw new TypeError("Owner-reserved approval must name its action");
    }
    if (["approve", "reapprove"].includes(decision) && !expiresAt) {
      throw new TypeError("Iris approvals and reapprovals must expire");
    }
    const expiry = expiresAt ? requireFutureExpiry(expiresAt, 24 * 60 * 60 * 1000) : null;
    return withTransaction(async (client) => {
      const inserted = await client.query(
        "INSERT INTO agent_iris_decisions (iris_subject, decision, action, scope, reason, evidence_ref, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [identity.identityId, decision, action || null, scope, reason.trim(), evidenceRef || null, expiry]
      );
      if (decision === "hold") {
        const hold = await client.query(
          "INSERT INTO agent_compliance_holds (iris_subject, scope, reason, evidence_ref) VALUES ($1,$2,$3,$4) RETURNING id",
          [identity.identityId, scope, reason.trim(), evidenceRef || null]
        );
        await client.query(
          "INSERT INTO agent_audit_events (event_type, actor_agent, actor_identity_id, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.hold','iris',$1,'compliance.stop',$2,'hold',$3,$4,$5::jsonb)",
          [identity.identityId, scope, reason.trim(), crypto.randomUUID(), JSON.stringify({ holdId: hold.rows[0].id, irisDecisionId: inserted.rows[0].id, evidenceRef: evidenceRef || null })]
        );
      } else {
        await client.query(
          "INSERT INTO agent_audit_events (event_type, actor_agent, actor_identity_id, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.decision','iris',$1,$2,$3,$4,$5,$6,$7::jsonb)",
          [identity.identityId, action || "compliance.review", scope, decision, reason.trim(), crypto.randomUUID(), JSON.stringify({ irisDecisionId: inserted.rows[0].id, evidenceRef: evidenceRef || null })]
        );
      }
      return inserted.rows[0];
    });
  }

  async function issueDelegatedGrant({ grantor, granteeAgent, action, scope, reason, expiresAt, maxUses = 1 }) {
    const isOwner = grantor && typeof grantor.subject === "string" &&
      typeof options.isOwnerSubject === "function" && await options.isOwnerSubject(grantor.subject);
    const isAddy = grantor && grantor.id === "addy" && grantor.identityId;
    if (!isOwner && !isAddy) throw new Error("Authenticated owner or Addy grantor required");
    if (!["addy", "camden"].includes(granteeAgent) ||
        (granteeAgent === "camden" && !isAddy) ||
        (granteeAgent === "addy" && !isOwner)) {
      throw new Error("Grantor is not authorized for this delegation");
    }
    const permitted = granteeAgent === "addy"
      ? ["engineering.write", "operations.execute"]
      : ["people.update"];
    if (!permitted.includes(action) || typeof scope !== "string" || !scope.trim() ||
        typeof reason !== "string" || !reason.trim() || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      throw new TypeError("Delegation must have an allowed action, exact scope, reason, and bounded use count");
    }
    const expiry = requireFutureExpiry(expiresAt, 30 * 24 * 60 * 60 * 1000);
    const grantorSubject = isOwner ? grantor.subject : grantor.identityId;
    const result = await pool.query(
      "INSERT INTO agent_delegated_grants (grantor_subject, grantee_agent, action, scope, reason, expires_at, max_uses) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, grantee_agent, action, scope, expires_at, max_uses",
      [grantorSubject, granteeAgent, action, scope, reason.trim(), expiry, maxUses]
    );
    await pool.query(
      "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('delegation.issued',$1,'task.delegate',$2,'granted',$3,$4,$5::jsonb)",
      [isAddy ? "addy" : null, scope, reason.trim(), crypto.randomUUID(), JSON.stringify({ grantId: result.rows[0].id, granteeAgent, action, maxUses })]
    );
    return result.rows[0];
  }

  async function approveSandboxTarget({ owner, targetId, scope, expiresAt }) {
    if (!owner || typeof owner.subject !== "string" || typeof options.isOwnerSubject !== "function" ||
        !(await options.isOwnerSubject(owner.subject))) {
      throw new Error("Authenticated owner authorization required");
    }
    if (typeof targetId !== "string" || !targetId.trim() || typeof scope !== "string" || !scope.trim()) {
      throw new TypeError("Sandbox target identifier and scope are required");
    }
    const expiry = requireFutureExpiry(expiresAt, 24 * 60 * 60 * 1000);
    const result = await pool.query(
      "INSERT INTO agent_sandbox_targets (target_id, environment, approved_by, scope, expires_at) VALUES ($1,'sandbox',$2,$3,$4) RETURNING id, target_id, scope, expires_at",
      [targetId.trim(), owner.subject, scope, expiry]
    );
    await pool.query(
      "INSERT INTO agent_audit_events (event_type, action, scope, environment, decision, reason, correlation_id, details) VALUES ('sandbox.target_approved','security.scan',$1,'sandbox','approved','Owner approved scoped sandbox target',$2,$3::jsonb)",
      [scope, crypto.randomUUID(), JSON.stringify({ targetId: result.rows[0].target_id, approvalId: result.rows[0].id })]
    );
    return result.rows[0];
  }


  async function revokeAgentIdentity({ owner, identityId, reason }) {
    if (!owner || typeof owner.subject !== "string" || typeof options.isOwnerSubject !== "function" ||
        !(await options.isOwnerSubject(owner.subject))) throw new Error("Authenticated owner authorization required");
    if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Revocation reason required");
    return withTransaction(async (client) => {
      const result = await client.query(
        "UPDATE agent_service_identities SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id, agent_id",
        [identityId, now()]
      );
      if (!result.rows[0]) throw new Error("Active identity not found");
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, decision, reason, correlation_id, details) VALUES ('identity.revoked',NULL,'access.permission_change','revoked',$1,$2,$3::jsonb)",
        [reason.trim(), crypto.randomUUID(), JSON.stringify({ identityId, agentId: result.rows[0].agent_id, ownerSubject: owner.subject })]
      );
      return result.rows[0];
    });
  }

  async function revokeDelegatedGrant({ grantor, grantId, reason }) {
    const isOwner = grantor && typeof grantor.subject === "string" &&
      typeof options.isOwnerSubject === "function" && await options.isOwnerSubject(grantor.subject);
    const isAddy = grantor && grantor.id === "addy" && grantor.identityId;
    if (!isOwner && !isAddy) throw new Error("Authenticated owner or Addy required");
    if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Revocation reason required");
    return withTransaction(async (client) => {
      const result = await client.query(
        "UPDATE agent_delegated_grants SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL AND ($3::boolean OR grantor_subject=$4) RETURNING id, grantee_agent, action, scope",
        [grantId, now(), Boolean(isOwner), isAddy ? grantor.identityId : grantor.subject]
      );
      if (!result.rows[0]) throw new Error("Grant not found or grantor not authorized");
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('delegation.revoked',$1,'task.delegate',$2,'revoked',$3,$4,$5::jsonb)",
        [isAddy ? "addy" : null, result.rows[0].scope, reason.trim(), crypto.randomUUID(), JSON.stringify({ grantId, granteeAgent: result.rows[0].grantee_agent, action: result.rows[0].action })]
      );
      return result.rows[0];
    });
  }

  async function createComplianceHold({ identity, scope, reason, evidenceRef }) {
    requireIdentity(identity, "iris");
    if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Hold reason required");
    return withTransaction(async (client) => {
      const hold = await client.query(
        "INSERT INTO agent_compliance_holds (iris_subject, scope, reason, evidence_ref) VALUES ($1,$2,$3,$4) RETURNING id",
        [identity.identityId, scope || "*", reason.trim(), evidenceRef || null]
      );
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.hold','iris','compliance.stop',$1,'hold',$2,$3,$4::jsonb)",
        [scope || "*", reason.trim(), crypto.randomUUID(), JSON.stringify({ holdId: hold.rows[0].id, evidenceRef: evidenceRef || null })]
      );
      return hold.rows[0];
    });
  }

  async function liftComplianceHold({ identity, holdId, reapprovalDecisionId }) {
    requireIdentity(identity, "iris");
    return withTransaction(async (client) => {
      const decision = await client.query(
        "SELECT id, scope FROM agent_iris_decisions WHERE id=$1 AND decision='reapprove' AND iris_subject=$2 FOR UPDATE",
        [reapprovalDecisionId, identity.identityId]
      );
      if (!decision.rows[0]) throw new Error("Verified Iris reapproval required");
      const result = await client.query(
        "UPDATE agent_compliance_holds SET lifted_at=$2, lifted_by=$3, lift_decision_id=$4 WHERE id=$1 AND lifted_at IS NULL AND scope=$5 RETURNING id",
        [holdId, now(), identity.identityId, reapprovalDecisionId, decision.rows[0].scope]
      );
      if (!result.rows[0]) throw new Error("Hold not found or reapproval scope mismatch");
      await client.query("UPDATE agent_iris_decisions SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL", [reapprovalDecisionId, now()]);
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.hold_lifted','iris','compliance.reapprove',$1,'lifted','Iris reapproval recorded',$2,$3::jsonb)",
        [decision.rows[0].scope, crypto.randomUUID(), JSON.stringify({ holdId, reapprovalDecisionId })]
      );
      return result.rows[0];
    });
  }

  return Object.freeze({
    provisionIdentity, authenticateToken, authorizeAction, recordActionOutcome,
    issueOwnerApproval, recordIrisDecision, issueDelegatedGrant, approveSandboxTarget,
    revokeAgentIdentity, revokeDelegatedGrant, createComplianceHold, liftComplianceHold,
  });
}

module.exports = { createAgentGovernanceStore, hashAgentCredential: sha256, compareAgentCredentialHash: sameHash };
