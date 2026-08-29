import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { findUserById, toInternalUser } from "../services/userService.js";
import { logger } from "../utils/logger.js";
import {
  isValidUsername,
  normalizeUsernameInput,
} from "../utils/username.js";
import {
  clearSessionCookies,
  issueSession,
  revokeSession,
  rotateSession,
  setSessionCookies,
} from "../services/tokenService.js";
import { getBcryptRounds } from "../config/env.js";
import {
  normalizeEmail,
  optionalText,
  positiveInteger,
  validateEmail,
  validatePassword,
} from "../utils/validation.js";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("invalid-password", 10);

// Signup
export async function signup(req, res) {
  try {
    let { username, email, password, fullName } = req.body;
    username = normalizeUsernameInput(username);
    email = normalizeEmail(email);

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email and password are required",
      });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({
        success: false,
        message:
          "Username must be 3–30 characters: letters, numbers, underscore only",
      });
    }

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    const fullNameValue = optionalText(fullName, { field: "fullName", maxLength: 100 });
    if (emailError || passwordError || fullNameValue.error) {
      return res.status(400).json({
        success: false,
        message: emailError || passwordError || fullNameValue.error,
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: { equals: email, mode: "insensitive" } },
        ],
      },
      select: { username: true, email: true },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          existingUser.username === username
            ? "Username already exists"
            : "Email already exists",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, getBcryptRounds());

    // Create the user and its first refresh session atomically.
    const session = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
          fullName: fullNameValue.value,
        },
      });
      return issueSession(user, tx);
    });
    const { user } = session;

    setSessionCookies(res, session);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    logger.error("signup.failed", { error });
    const duplicate = error.code === "P2002";
    res.status(duplicate ? 409 : 500).json({
      success: false,
      message: duplicate ? "Username or email already exists" : "Failed to create user",
    });
  }
}

// Login
export async function login(req, res) {
  try {
    const { email: rawIdentifier, password } = req.body;
    const identifier = normalizeEmail(rawIdentifier);

    if (!identifier || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: { equals: identifier, mode: "insensitive" } },
        ],
      },
    });

    const isValidPassword = await bcrypt.compare(
      password,
      user?.passwordHash || DUMMY_PASSWORD_HASH
    );

    if (!user || !isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    setSessionCookies(res, await issueSession(user));

    res.json({
      success: true,
      message: "Login successful",
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    logger.error("login.failed", { error });
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
}

// Logout
export async function logout(req, res) {
  try {
    await revokeSession(req.cookies?.refresh_token);
  } catch (error) {
    logger.error("logout.revocation_failed", { error });
  }
  clearSessionCookies(res);
  res.json({
    success: true,
    message: "Logout successful",
  });
}

export async function refresh(req, res) {
  try {
    const session = await rotateSession(req.cookies?.refresh_token);
    if (!session) {
      clearSessionCookies(res);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    setSessionCookies(res, session);
    return res.json({
      success: true,
      message: "Session refreshed",
      data: {
        userId: session.user.id,
        username: session.user.username,
        email: session.user.email,
        fullName: session.user.fullName,
      },
    });
  } catch (error) {
    logger.error("session.refresh_failed", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to refresh session",
    });
  }
}

// Get current user (identity from API Gateway JWT → X-User-Id)
export async function getCurrentUser(req, res) {
  try {
    const userId = req.user.userId;

    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error("user.current_lookup_failed", { error, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}

// Internal API: Get user by ID (for service-to-service calls)
export async function getUserById(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) {
      return res.status(400).json({ success: false, message: parsedId.error });
    }
    const userId = parsedId.value;

    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: toInternalUser(user),
    });
  } catch (error) {
    logger.error("user.internal_lookup_failed", { error, userId: req.params.id });
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}
