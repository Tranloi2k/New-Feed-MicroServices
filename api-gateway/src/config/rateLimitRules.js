/**
 * Rate Limit Rules Configuration
 * Using Leaky Bucket Algorithm
 * 
 * Each rule defines:
 * - windowMs: Time window in milliseconds
 * - maxRequests: Maximum requests allowed in the window
 * - message: Error message when limit exceeded
 */

export const rateLimitRules = {
    // Default rule for all endpoints
    default: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 100,
        message: "Quá nhiều requests. Vui lòng thử lại sau.",
    },

    // Authentication endpoints
    auth: {
        // Login endpoint - stricter limit
        login: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 5, // Only 5 login attempts
            message:
                "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.",
        },

        // Register endpoint
        register: {
            windowMs: 60 * 60 * 1000, // 1 hour
            maxRequests: 3, // Only 3 registration attempts
            message: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ.",
        },

        // Refresh token endpoint
        refresh: {
            windowMs: 5 * 60 * 1000, // 5 minutes
            maxRequests: 10,
            message: "Quá nhiều lần refresh token. Vui lòng thử lại sau.",
        },

        // Default for other auth endpoints
        default: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 20,
            message: "Quá nhiều requests đến auth service. Vui lòng thử lại sau.",
        },
    },

    // Post endpoints
    posts: {
        // Create post
        create: {
            windowMs: 60 * 60 * 1000, // 1 hour
            maxRequests: 10, // 10 posts per hour
            message: "Bạn đã tạo quá nhiều bài viết. Vui lòng thử lại sau 1 giờ.",
        },

        // List posts (expensive operation)
        list: {
            windowMs: 1 * 60 * 1000, // 1 minute
            maxRequests: 30,
            message: "Quá nhiều requests. Vui lòng thử lại sau.",
        },

        // Default for other post endpoints
        default: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 50,
            message: "Quá nhiều requests đến post service. Vui lòng thử lại sau.",
        },
    },

    // Comment endpoints
    comments: {
        // Create comment
        create: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 30, // 30 comments per 15 minutes
            message: "Bạn đã comment quá nhiều. Vui lòng thử lại sau.",
        },

        // Default for other comment endpoints
        default: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 60,
            message: "Quá nhiều requests đến comment service. Vui lòng thử lại sau.",
        },
    },

    // Media upload endpoints
    media: {
        // Upload endpoint - very strict
        upload: {
            windowMs: 60 * 60 * 1000, // 1 hour
            maxRequests: 20, // 20 uploads per hour
            message: "Bạn đã upload quá nhiều file. Vui lòng thử lại sau 1 giờ.",
        },

        // Default for other media endpoints
        default: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100,
            message: "Quá nhiều requests đến media service. Vui lòng thử lại sau.",
        },
    },
};

/**
 * Get rate limit rule for a specific endpoint
 * @param {string} path - Request path (e.g., "/api/auth/login")
 * @returns {Object} Rate limit rule
 */
export function getRateLimitRule(path) {
    // Extract service and action from path
    // Path format: /api/{service}/{action}
    const parts = path.split("/").filter(Boolean);

    if (parts.length < 2) {
        return rateLimitRules.default;
    }

    const service = parts[1]; // e.g., "auth", "posts", "comments"
    const action = parts[2]; // e.g., "login", "register", "create"

    // Check if we have rules for this service
    if (!rateLimitRules[service]) {
        return rateLimitRules.default;
    }

    const serviceRules = rateLimitRules[service];

    // Check if we have a specific rule for this action
    if (action && serviceRules[action]) {
        return serviceRules[action];
    }

    // Return service default or global default
    return serviceRules.default || rateLimitRules.default;
}
