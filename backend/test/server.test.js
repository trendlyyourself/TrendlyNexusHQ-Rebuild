const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await callback("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function makeApp(usersFile, overrides = {}) {
  return createApp({
    jwtSecret: "R7v!mQ2#xL9@pT4$kN8^cB6&zF1*wH5",
    allowedOrigins: ["http://localhost:5173"],
    frontendUrl: "https://localhost:5173",
    usersFile,
    sendResetEmail: async () => {},
    ...overrides,
  });
}

test("API refuses to start without a strong JWT secret or explicit CORS origins", () => {
  assert.throws(() => createApp({ jwtSecret: "weak", allowedOrigins: ["http://localhost:5173"], frontendUrl: "http://localhost:5173" }), /32 bytes/);
  assert.throws(() => createApp({ jwtSecret: "x".repeat(32), allowedOrigins: [], frontendUrl: "http://localhost:5173" }), /CORS_ORIGINS/);
  assert.throws(() => createApp({ env: { NODE_ENV: "production" }, jwtSecret: "x".repeat(32), allowedOrigins: ["http://localhost:5173"], frontendUrl: "https://localhost:5173" }), /HTTPS in production/);
});

test("registration, login, and one-time hashed password reset work without logging token data", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-security-"));
  const usersFile = path.join(directory, "users.json");
  let deliveredUrl = "";
  const app = makeApp(usersFile, {
    sendResetEmail: async ({ to, resetUrl }) => {
      assert.equal(to, "user@example.com");
      deliveredUrl = resetUrl;
    },
  });

  try {
    await withServer(app, async (base) => {
      const register = await fetch(base + "/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "User@Example.com", password: "initial-password" }),
      });
      assert.equal(register.status, 201);

      const login = await fetch(base + "/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "initial-password" }),
      });
      assert.equal(login.status, 200);
      const oldLoginPayload = await login.json();
      const oldAccessToken = oldLoginPayload.token;
      assert.ok(oldAccessToken);

      const forgot = await fetch(base + "/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      });
      assert.equal(forgot.status, 200);
      assert.ok(deliveredUrl);
      const resetUrl = new URL(deliveredUrl);
      const token = resetUrl.searchParams.get("token");
      assert.ok(token);

      const storedUsers = JSON.parse(fs.readFileSync(usersFile, "utf8"));
      assert.equal(storedUsers[0].resetToken, undefined);
      assert.match(storedUsers[0].resetTokenHash, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(storedUsers).includes(token), false);

      const reset = await fetch(base + "/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", token, newPassword: "replacement-password" }),
      });
      assert.equal(reset.status, 200);

      const oldSession = await fetch(base + "/projects", {
        headers: { authorization: "Bearer " + oldAccessToken },
      });
      assert.equal(oldSession.status, 401);

      const replay = await fetch(base + "/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", token, newPassword: "another-password" }),
      });
      assert.equal(replay.status, 400);

      const newLogin = await fetch(base + "/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "replacement-password" }),
      });
      assert.equal(newLogin.status, 200);
      const newLoginPayload = await newLogin.json();
      const newSession = await fetch(base + "/projects", {
        headers: { authorization: "Bearer " + newLoginPayload.token },
      });
      assert.equal(newSession.status, 200);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CORS allows only configured origins", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cors-"));
  const app = makeApp(path.join(directory, "users.json"));
  try {
    await withServer(app, async (base) => {
      const allowed = await fetch(base + "/", { headers: { Origin: "http://localhost:5173" } });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
      const denied = await fetch(base + "/", { headers: { Origin: "https://untrusted.example" } });
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("failed email delivery clears the reset token instead of persisting an unusable credential", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-mail-failure-"));
  const usersFile = path.join(directory, "users.json");
  let attemptedUrl = "";
  const app = makeApp(usersFile, {
    sendResetEmail: async ({ resetUrl }) => {
      attemptedUrl = resetUrl;
      throw new Error("simulated mail failure");
    },
  });

  try {
    await withServer(app, async (base) => {
      const register = await fetch(base + "/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "initial-password" }),
      });
      assert.equal(register.status, 201);

      const forgot = await fetch(base + "/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      });
      assert.equal(forgot.status, 200);
      assert.ok(attemptedUrl);

      const storedUsers = JSON.parse(fs.readFileSync(usersFile, "utf8"));
      assert.equal(storedUsers[0].resetTokenHash, undefined);
      assert.equal(storedUsers[0].resetToken, undefined);
      assert.equal(JSON.stringify(storedUsers).includes(new URL(attemptedUrl).searchParams.get("token")), false);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
