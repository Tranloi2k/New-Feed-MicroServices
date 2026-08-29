const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateEmail(email) {
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return "A valid email address is required";
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password must not exceed 72 UTF-8 bytes";
  }
  return null;
}

export function optionalText(value, { field, maxLength }) {
  if (value === undefined) return { present: false };
  if (value !== null && typeof value !== "string") {
    return { error: `${field} must be a string or null` };
  }
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maxLength) {
    return { error: `${field} must not exceed ${maxLength} characters` };
  }
  return { present: true, value: normalized };
}

export function optionalHttpUrl(value) {
  const text = optionalText(value, { field: "avatarUrl", maxLength: 2048 });
  if (text.error || !text.value) return text;
  try {
    const url = new URL(text.value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return { error: "avatarUrl must be a valid HTTP(S) URL" };
  }
  return text;
}

export function positiveInteger(value, field = "id") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { error: `${field} must be a positive integer` };
  }
  return { value: parsed };
}

export function pagination(query = {}) {
  const rawLimit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    return { error: "limit must be an integer between 1 and 50" };
  }
  const cursor = query.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 512)) {
    return { error: "cursor must be a string no longer than 512 characters" };
  }
  return { limit: rawLimit, cursor: cursor || null };
}
