const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";

app.use(cors());
app.use(express.json());

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]");
  }

  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2)
  );
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = header.split(" ")[1];

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "TrendlyNexusHQ API",
  });
});

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const users = loadUsers();

    const existingUser = users.find(
      (user) => user.email === normalizedEmail
    );

    if (existingUser) {
      return res.status(409).json({
        message: "An account with that email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = {
      id: Date.now().toString(),
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    saveUsers(users);

    res.status(201).json({
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      message: "Registration failed",
    });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const users = loadUsers();

    const user = users.find(
      (item) => item.email === normalizedEmail
    );

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = createToken(user);

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Login failed",
    });
  }
});

app.post("/auth/forgot-password", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      message: "Email is required",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const users = loadUsers();

  const user = users.find(
    (item) => item.email === normalizedEmail
  );

  if (!user) {
    return res.json({
      message:
        "If an account exists for that email, a reset request has been created.",
    });
  }

  const resetToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      purpose: "password-reset",
    },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

  user.resetToken = resetToken;
  user.resetTokenExpires = Date.now() + 15 * 60 * 1000;

  saveUsers(users);

  console.log(
    `Password reset link: http://localhost:5173/reset-password?email=${encodeURIComponent(
      user.email
    )}&token=${encodeURIComponent(resetToken)}`
  );

  res.json({
    message:
      "If an account exists for that email, a reset request has been created.",
  });
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({
        message: "Email, token, and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const users = loadUsers();

    const user = users.find(
      (item) =>
        item.email === normalizedEmail &&
        item.resetToken === token
    );

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token",
      });
    }

    if (
      !user.resetTokenExpires ||
      Date.now() > user.resetTokenExpires
    ) {
      return res.status(400).json({
        message: "Invalid or expired reset token",
      });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (
        decoded.purpose !== "password-reset" ||
        decoded.email !== user.email
      ) {
        throw new Error("Invalid reset token");
      }
    } catch {
      return res.status(400).json({
        message: "Invalid or expired reset token",
      });
    }

    user.passwordHash = await bcrypt.hash(
      newPassword,
      12
    );

    delete user.resetToken;
    delete user.resetTokenExpires;

    saveUsers(users);

    res.json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Password reset error:", error);

    res.status(500).json({
      message: "Password reset failed",
    });
  }
});

app.post("/auth/passkey/login", (req, res) => {
  res.status(501).json({
    message: "Passkey login is not implemented yet",
  });
});

app.post("/auth/passkey/register", (req, res) => {
  res.status(501).json({
    message: "Passkey registration is not implemented yet",
  });
});

app.get("/projects", authenticate, (req, res) => {
  res.json([
    {
      id: "project-1",
      title: "Trendly Nexus",
      description:
        "TrendlyNexusHQ automation platform",
      status: "active",
    },
  ]);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `TrendlyNexusHQ API running on port ${PORT}`
  );
});
