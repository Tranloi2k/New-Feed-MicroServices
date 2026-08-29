const seconds = (value) => value * 1000;
const minutes = (value) => value * 60 * 1000;

export const restRateLimits = {
  conversationCreate: [{ windowMs: minutes(1), maxRequests: 10 }],
  history: [{ windowMs: minutes(1), maxRequests: 60 }],
  sync: [{ windowMs: minutes(1), maxRequests: 60 }],
};

export const socketRateLimits = {
  messageSend: [
    { windowMs: seconds(10), maxRequests: 30 },
    { windowMs: minutes(5), maxRequests: 300 },
  ],
  typing: [{ windowMs: seconds(10), maxRequests: 10 }],
  presencePing: [{ windowMs: seconds(20), maxRequests: 1 }],
};
