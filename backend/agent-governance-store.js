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
          "SELECT id FROM agent_iris_decisions WHERE decision=$1 AND scope=$2 AND (action=$3 OR action IS NULL) AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>$4) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
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

  async function createComplianceHold({ irisSubject, scope, reason, evidenceRef }) {
    if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Hold reason required");
    return withTransaction(async (client) => {
      const hold = await client.query(
        "INSERT INTO agent_compliance_holds (iris_subject, scope, reason, evidence_ref) VALUES ($1,$2,$3,$4) RETURNING id",
        [irisSubject, scope || "*", reason.trim(), evidenceRef || null]
      );
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.hold','iris','compliance.stop',$1,'hold',$2,$3,$4::jsonb)",
        [scope || "*", reason.trim(), crypto.randomUUID(), JSON.stringify({ holdId: hold.rows[0].id, evidenceRef: evidenceRef || null })]
      );
      return hold.rows[0];
    });
  }

  async function liftComplianceHold({ holdId, irisSubject, reapprovalDecisionId }) {
    return withTransaction(async (client) => {
      const decision = await client.query(
        "SELECT id, scope FROM agent_iris_decisions WHERE id=$1 AND decision='reapprove' AND iris_subject=$2 FOR UPDATE",
        [reapprovalDecisionId, irisSubject]
      );
      if (!decision.rows[0]) throw new Error("Verified Iris reapproval required");
      const result = await client.query(
        "UPDATE agent_compliance_holds SET lifted_at=$2, lifted_by=$3, lift_decision_id=$4 WHERE id=$1 AND lifted_at IS NULL AND (scope='*' OR scope=$5) RETURNING id",
        [holdId, now(), irisSubject, reapprovalDecisionId, decision.rows[0].scope]
      );
      if (!result.rows[0]) throw new Error("Hold not found or reapproval scope mismatch");
      await client.query(
        "INSERT INTO agent_audit_events (event_type, actor_agent, action, scope, decision, reason, correlation_id, details) VALUES ('compliance.hold_lifted','iris','compliance.reapprove',$1,'lifted','Iris reapproval recorded',$2,$3::jsonb)",
        [decision.rows[0].scope, crypto.randomUUID(), JSON.stringify({ holdId, reapprovalDecisionId })]
      );
      return result.rows[0];
    });
  }

  return Object.freeze({
    provisionIdentity, authenticateToken, authorizeAction, recordActionOutcome,
    createComplianceHold, liftComplianceHold,
  });
}

module.exports = { createAgentGovernanceStore, hashAgentCredential: sha256, compareAgentCredentialHash: sameHash };
