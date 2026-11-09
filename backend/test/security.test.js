const test = require("node:test");
const assert = require("node:assert/strict");
const {
  requireStrongSecret,
  parseAllowedOrigins,
  hashResetToken,
  matchesResetToken,
} = require("../security");

test("JWT secret rejects short, placeholder, and low-diversity values", () => {
  assert.throws(() => requireStrongSecret("short"), /32 bytes/);
  assert.throws(() => requireStrongSecret("x".repeat(32)), /character diversity and entropy/);
  assert.throws(() => requireStrongSecret("replace-with-a-unique-random-secret-of-at-least-32-characters"), /placeholder/);
  const secret = "R7v!mQ2#xL9@pT4$kN8^cB6&zF1*wH5";
  assert.equal(requireStrongSecret(secret), secret);
});

test("CORS origins are exact, unique HTTP(S) origins", () => {
  assert.deepEqual(
    parseAllowedOrigins("https://app.example.com,http://localhost:5173,https://app.example.com"),
    ["https://app.example.com", "http://localhost:5173"]
  );
});

test("CORS rejects wildcards, paths, and non-HTTP protocols", () => {
  assert.throws(() => parseAllowedOrigins("*"), /exact HTTP\(S\) origins/);
  assert.throws(() => parseAllowedOrigins("https://example.com/path"), /exact HTTP\(S\) origins/);
  assert.throws(() => parseAllowedOrigins("file://example.com"), /exact HTTP\(S\) origins/);
  assert.throws(() => parseAllowedOrigins(""), /at least one exact origin/);
});

test("reset token hashes are one-way and deterministic", () => {
  const token = "test-reset-token";
  const digest = hashResetToken(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(hashResetToken(token), digest);
});

test("reset token comparison is safe and rejects wrong or malformed hashes", () => {
  const token = "random-one-time-token";
  const digest = hashResetToken(token);
  assert.equal(matchesResetToken(token, digest), true);
  assert.equal(matchesResetToken("different-token", digest), false);
  assert.equal(matchesResetToken(token, "not-a-hash"), false);
});
