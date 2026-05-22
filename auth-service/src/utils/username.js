const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

export function isValidUsername(username) {
  return typeof username === "string" && USERNAME_RE.test(username);
}

export function normalizeUsernameInput(username) {
  if (typeof username !== "string") return "";
  return username.trim().toLowerCase();
}
