const crypto = require("node:crypto");

function requireStrongSecret(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }

  const normalized = value.trim().toLowerCase();
  if (/^(change[-_ ]?me|replace[-_ ]?with|your[-_ ]?(secret|key)|example|placeholder|password|secret)([-_ ]|$)/i.test(normalized)) {
    throw new Error("JWT_SECRET must not be a placeholder value");
  }

  const frequencies = new Map();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) || 0) + 1);
  }
  const distinctCharacters = frequencies.size;
  const length = value.length;
  const entropy = [...frequencies.values()].reduce((total, count) => {
    const probability = count / length;
    return total - probability * Math.log2(probability);
  }, 0);

  if (distinctCharacters < 10 || entropy < 3) {
    throw new Error("JWT_SECRET must have sufficient character diversity and entropy");
  }
  return value;
}

function parseAllowedOrigins(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(",");
  const origins = entries.map((item) => String(item).trim()).filter(Boolean);
  if (origins.length === 0) throw new Error("CORS_ORIGINS must contain at least one exact origin");

  for (const origin of origins) {
    if (origin.includes("*")) {
      throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards");
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS contains an invalid origin");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards");
    }
  }
  return [...new Set(origins)];
}

function hashResetToken(token) {
  if (typeof token !== "string" || token.length < 1) throw new Error("Reset token is required");
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function matchesResetToken(token, storedHash) {
  if (typeof token !== "string" || typeof storedHash !== "string" || !/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }
  const supplied = Buffer.from(hashResetToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
}

module.exports = { requireStrongSecret, parseAllowedOrigins, hashResetToken, matchesResetToken };
