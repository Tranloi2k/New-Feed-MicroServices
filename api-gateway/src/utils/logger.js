// Simple console logger for API Gateway
// Production: Use Winston or similar

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const currentLevel = levels[process.env.LOG_LEVEL] || levels.info;

function log(level, ...args) {
    if (levels[level] <= currentLevel) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        console.log(prefix, ...args);
    }
}

export const logger = {
    error: (...args) => log("error", ...args),
    warn: (...args) => log("warn", ...args),
    info: (...args) => log("info", ...args),
    debug: (...args) => log("debug", ...args),
};
