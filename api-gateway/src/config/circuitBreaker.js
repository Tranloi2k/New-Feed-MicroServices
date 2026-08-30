export const defaultCircuitBreakerOptions = {
  timeout: 10_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 10_000,
  volumeThreshold: 5,
};

export const serviceCircuitBreakerOptions = {
  auth: { timeout: 5_000, resetTimeout: 20_000 },
  post: {},
  comment: {},
  notification: {},
  chat: {},
  media: {
    // Must outlast media-service's own 45s Cloudinary timeout so a stalled
    // upload returns that service's JSON error instead of a proxy failure.
    timeout: 60_000,
    errorThresholdPercentage: 60,
    resetTimeout: 45_000,
  },
};

export function getCircuitBreakerOptions(serviceName) {
  return {
    ...defaultCircuitBreakerOptions,
    ...(serviceCircuitBreakerOptions[serviceName] || {}),
  };
}

export function createFallbackResponse(serviceName) {
  return {
    success: false,
    error: "SERVICE_UNAVAILABLE",
    message: `${serviceName} is temporarily unavailable. Please try again later.`,
    service: serviceName,
    timestamp: new Date().toISOString(),
  };
}
