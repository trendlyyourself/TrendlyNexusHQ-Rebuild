"use strict";

function createAgentAuthenticationMiddleware(store) {
  if (!store || typeof store.authenticateToken !== "function") {
    throw new TypeError("Trusted agent identity store required");
  }
  return async function authenticateAgent(req, res, next) {
    const header = req.headers && req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Agent authentication required" });
    }
    try {
      const identity = await store.authenticateToken(header.slice(7));
      if (!identity) return res.status(401).json({ error: "Invalid or expired agent credential" });
      // This server-owned identity is the sole source of agent role/authority.
      req.agent = identity;
      return next();
    } catch {
      return res.status(503).json({ error: "Agent identity verification unavailable" });
    }
  };
}

function createAgentActionGuard({ store, action, scopeResolver, environmentResolver, sandboxTargetResolver }) {
  if (!store || typeof store.authorizeAction !== "function" || typeof scopeResolver !== "function") {
    throw new TypeError("Trusted governance store and server-side scope resolver required");
  }
  return async function guardAgentAction(req, res, next) {
    try {
      if (!req.agent || !req.agent.identityId) return res.status(401).json({ error: "Agent authentication required" });
      const scope = await scopeResolver(req);
      const environment = environmentResolver ? await environmentResolver(req) : "unknown";
      const sandboxTargetId = sandboxTargetResolver ? await sandboxTargetResolver(req) : undefined;
      const decision = await store.authorizeAction({
        identity: req.agent, action, scope, environment, sandboxTargetId,
        correlationId: req.id || req.headers["x-request-id"] || require("node:crypto").randomUUID(),
      });
      req.agentPolicyDecision = decision;
      if (!decision.allowed) return res.status(403).json({ error: "Agent action denied", code: decision.reason });
      return next();
    } catch {
      return res.status(503).json({ error: "Agent governance verification unavailable" });
    }
  };
}

async function runGuardedAgentAction({ req, action, scope, environment, store, execute }) {
  if (!req || !req.agent || !req.agent.identityId || !store || typeof execute !== "function") {
    throw new TypeError("Authenticated agent, governance store, and action executor required");
  }
  const correlationId = req.id || req.headers["x-request-id"] || require("node:crypto").randomUUID();
  const decision = await store.authorizeAction({ identity: req.agent, action, scope, environment, correlationId });
  if (!decision.allowed) {
    const error = new Error("Agent action denied: " + decision.reason);
    error.code = "AGENT_ACTION_DENIED";
    throw error;
  }
  try {
    const result = await execute();
    await store.recordActionOutcome({ identity: req.agent, action, scope, environment, correlationId, outcome: "success" });
    return result;
  } catch (error) {
    await store.recordActionOutcome({
      identity: req.agent, action, scope, environment, correlationId, outcome: "failure",
      errorCode: typeof error.code === "string" ? error.code.slice(0, 80) : "execution_error",
    });
    throw error;
  }
}

module.exports = { createAgentAuthenticationMiddleware, createAgentActionGuard, runGuardedAgentAction };
