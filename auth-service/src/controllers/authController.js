import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import {
  cacheUser,
  getCachedUserExists,
  cacheUserExists,
  invalidateUserExists,
} from "../services/cacheService.js";

// Signup
export async function signup(req, res) {
  try {
    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email and password are required",
      });
    }

    // Check if user exists (with cache)
    let existingUser = null;

    // Check cache first
    const usernameExists = await getCachedUserExists(username);
    const emailExists = await getCachedUserExists(email);

    if (usernameExists === true || emailExists === true) {
      // Cache hit - user exists
      existingUser = { username: usernameExists ? username : null, email: emailExists ? email : null };
    } else if (usernameExists === false && emailExists === false) {
      // Cache hit - user doesn't exist
      existingUser = null;
    } else {
      // Cache miss - query database
      existingUser = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
      });

      // Cache the result
      await cacheUserExists(username, !!existingUser && existingUser.username === username);
      await cacheUserExists(email, !!existingUser && existingUser.email === email);
    }

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
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        fullName,
      },
    });

    // Invalidate existence cache for this username/email
    await invalidateUserExists([username, email]);

    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set cookie
    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create user",
    });
  }
}

// Login
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: email }, { email }] },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set cookie
    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
}

// Logout
export function logout(req, res) {
  res.clearCookie("access_token");
  res.json({
    success: true,
    message: "Logout successful",
  });
}

// Get current user
export async function getCurrentUser(req, res) {
  try {
    const userId = parseInt(req.headers["x-user-id"]);

    // Import cache functions at top of this function
    const { getCachedUser, cacheUser: cacheSingleUser } = await import("../services/cacheService.js");

    // Try cache first
    let user = await getCachedUser(userId);

    if (!user) {
      // Cache miss - query database
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          bio: true,
          isPrivate: true,
          createdAt: true,
        },
      });

      // Cache for future requests
      if (user) {
        await cacheSingleUser(userId, user);
      }
    }

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
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}

// Internal API: Get user by ID (for service-to-service calls)
export async function getUserById(req, res) {
  try {
    const userId = parseInt(req.params.id);

    // Import cache functions at top of this function
    const { getCachedUser, cacheUser: cacheSingleUser } = await import("../services/cacheService.js");

    // Try cache first
    let user = await getCachedUser(userId);

    if (!user) {
      // Cache miss - query database
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          bio: true,
          isPrivate: true,
        },
      });

      // Cache for future requests
      if (user) {
        await cacheSingleUser(userId, user);
      }
    }

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
    console.error("Get user by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}
