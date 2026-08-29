const service = "auth-service";

function write(level, event, context = {}) {
  const error = context.error;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    ...context,
    ...(error instanceof Error && {
      error: { name: error.name, message: error.message },
    }),
  };
  const output = JSON.stringify(payload);
  if (level === "error") console.error(output);
  else console.log(output);
}

export const logger = {
  info: (event, context) => write("info", event, context),
  warn: (event, context) => write("warn", event, context),
  error: (event, context) => write("error", event, context),
};
