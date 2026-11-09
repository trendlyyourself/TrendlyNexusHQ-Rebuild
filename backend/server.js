require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");

const {
  requireStrongSecret,
  parseAllowedOrigins,
  hashResetToken,
  matchesResetToken,
} = require("./security");

const DEFAULT_USERS_FILE = path.join(__dirname, "data", "users.json");

function createSmtpSender(env) {
  return async function sendResetEmail({ to, resetUrl }) {
    const host = env.SMTP_HOST;
    const port = Number(env.SMTP_PORT || 587);
    const from = env.EMAIL_FROM;
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Password reset email transport is not configured");
    }

    const auth = env.SMTP_USER && env.SMTP_PASSWORD
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
      : undefined;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: String(env.SMTP_SECURE || "").toLowerCase() === "true",
      auth,
    });

    await transporter.sendMail({
      from,
      to,
      subject: "Reset your Trendly Nexus password",
      text: "Use this one-time link within 15 minutes to reset your password:\n\n" + resetUrl,
    });
  };
}

function loadUsers(usersFile) {
  const directory = path.dirname(usersFile);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, "[]", { mode: 0o600 });
  }
  const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  if (!Array.isArray(users)) throw new Error("User store must contain an array");
  return users;
}

function saveUsers(usersFile, users) {
  const directory = path.dirname(usersFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = usersFile + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, usersFile);
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const jwtSecret = requireStrongSecret(options.jwtSecret === undefined ? env.JWT_SECRET : options.jwtSecret);
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins === undefined ? env.CORS_ORIGINS : options.allowedOrigins);
  if (env.NODE_ENV === "production" && allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("CORS_ORIGINS must use HTTPS in production");
  }
  const frontendUrl = options.frontendUrl || env.FRONTEND_URL;
  if (!frontendUrl) throw new Error("FRONTEND_URL must be configured");
  const parsedFrontendUrl = new URL(frontendUrl);
  if (!["http:", "https:"].includes(parsedFrontendUrl.protocol)) {
    throw new Error("FRONTEND_URL must use HTTP or HTTPS");
  }
  if (env.NODE_ENV === "production" && parsedFrontendUrl.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTPS in production");
  }

  const usersFile = options.usersFile || DEFAULT_USERS_FILE;
  const sendResetEmail = options.sendResetEmail || createSmtpSender(env);
  const app = express();

  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
  }));
  app.use(express.json({ limit: "32kb" }));

  function createToken(user) {
    const tokenVersion = Number.isSafeInteger(user.tokenVersion) && user.tokenVersion >= 0
      ? user.tokenVersion
      : 0;
    return jwt.sign({ id: user.id, email: user.email, tokenVersion }, jwtSecret, { expiresIn: "7d" });
  }

  function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }
    try {
      const payload = jwt.verify(header.slice(7), jwtSecret);
      const currentUser = loadUsers(usersFile).find((user) => user.id === payload.id);
      const currentVersion = currentUser && Number.isSafeInteger(currentUser.tokenVersion) && currentUser.tokenVersion >= 0
        ? currentUser.tokenVersion
        : 0;
      if (!currentUser || payload.tokenVersion !== currentVersion) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }
      req.user = { id: currentUser.id, email: currentUser.email };
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  }

  app.get("/", (req, res) => {
    res.json({ status: "online", service: "TrendlyNexusHQ API" });
  });

  app.post("/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required" });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: "Password must be between 8 and 128 characters" });
    }

    try {
      const users = loadUsers(usersFile);
      if (users.some((user) => user.email === email)) {
        return res.status(409).json({ message: "An account with that email already exists" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      users.push({
        id: crypto.randomUUID(),
        email,
        passwordHash,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
      });
      saveUsers(usersFile, users);
      return res.status(201).json({ message: "Account created successfully" });
    } catch {
      console.error("Registration failed");
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required" });
    }

    try {
      const users = loadUsers(usersFile);
      const user = users.find((item) => item.email === email);
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      return res.json({
        message: "Login successful",
        token: createToken(user),
        user: { id: user.id, email: user.email },
      });
    } catch {
      console.error("Login failed");
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/auth/forgot-password", async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ message: "Email is required" });

    try {
      const users = loadUsers(usersFile);
      const user = users.find((item) => item.email === email);
      if (user) {
        const rawToken = crypto.randomBytes(32).toString("base64url");
        user.resetTokenHash = hashResetToken(rawToken);
        user.resetTokenExpires = Date.now() + 15 * 60 * 1000;
        delete user.resetToken;
        saveUsers(usersFile, users);

        const resetUrl = new URL("/reset-password", parsedFrontendUrl);
        resetUrl.searchParams.set("email", user.email);
        resetUrl.searchParams.set("token", rawToken);
        try {
          await sendResetEmail({ to: user.email, resetUrl: resetUrl.toString() });
        } catch {
          delete user.resetTokenHash;
          delete user.resetTokenExpires;
          saveUsers(usersFile, users);
          console.error("Password reset email delivery failed");
        }
      }
    } catch {
      console.error("Password reset request failed");
    }

    return res.json({
      message: "If an account exists for that email, a reset request has been created.",
    });
  });

  app.post("/auth/reset-password", async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const token = req.body && req.body.token;
    const newPassword = req.body && req.body.newPassword;
    if (!email || typeof token !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ message: "Email, token, and new password are required" });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ message: "Password must be between 8 and 128 characters" });
    }

    try {
      const users = loadUsers(usersFile);
      const user = users.find((item) => item.email === email);
      if (
        !user ||
        !user.resetTokenHash ||
        !Number.isFinite(user.resetTokenExpires) ||
        Date.now() >= user.resetTokenExpires ||
        !matchesResetToken(token, user.resetTokenHash)
      ) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.tokenVersion = (Number.isSafeInteger(user.tokenVersion) && user.tokenVersion >= 0 ? user.tokenVersion : 0) + 1;
      delete user.resetTokenHash;
      delete user.resetTokenExpires;
      delete user.resetToken;
      saveUsers(usersFile, users);
      return res.json({ message: "Password updated successfully" });
    } catch {
      console.error("Password reset failed");
      return res.status(500).json({ message: "Password reset failed" });
    }
  });

  app.post("/auth/passkey/login", (req, res) => {
    res.status(501).json({ message: "Passkey login is not implemented yet" });
  });
  app.post("/auth/passkey/register", (req, res) => {
    res.status(501).json({ message: "Passkey registration is not implemented yet" });
  });

  app.get("/projects", authenticate, (req, res) => {
    res.json([{
      id: "project-1",
      title: "Trendly Nexus",
      description: "TrendlyNexusHQ automation platform",
      status: "active",
    }]);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log("TrendlyNexusHQ API listening on configured port");
  });
}

module.exports = { createApp, loadUsers, saveUsers };
