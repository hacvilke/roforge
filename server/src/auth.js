// Auth: scrypt-hashed users (JSON file store) + HMAC-signed session tokens.
//
// MVP design: self-service login (first login with a username+password
// creates the account). This is fine for a personal/team self-host. For a
// public hosted service, swap `login` for Roblox OAuth — see docs/SECURITY.md.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { HttpError } from "./util.js";

const USERS_FILE = path.join(config.dataDir, "users.json");

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveUsers(users) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}
function verifyPassword(password, rec) {
  const computed = crypto.scryptSync(String(password), Buffer.from(rec.salt, "hex"), 64);
  const stored = Buffer.from(rec.hash, "hex");
  return computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(crypto.createHmac("sha256", config.hmacSecret).update(payload).digest());
  return `rf1.${payload}.${sig}`;
}

export function issueToken(username) {
  const now = Date.now();
  return sign({ u: username, iat: now, exp: now + config.tokenTtlMs });
}

export function verifyToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "rf1") return null;
  const expected = b64url(crypto.createHmac("sha256", config.hmacSecret).update(parts[1]).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return { username: payload.u, exp: payload.exp };
}

export function authenticate(req) {
  const h = String(req.headers["authorization"] || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const user = verifyToken(m[1].trim());
  if (!user) return null;
  return loadUsers()[user.username] ? user : null;
}

export function requireUser(req) {
  const user = authenticate(req);
  if (!user) {
    throw new HttpError(
      "Unauthorized — pass 'Authorization: Bearer <token>' (get a token via POST /v1/auth/login)",
      401,
      "UNAUTHORIZED"
    );
  }
  return user;
}

export function login(username, password) {
  username = String(username || "").trim();
  if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    throw new HttpError("Username must be 2-32 chars: letters, digits, _ . -", 400, "BAD_USERNAME");
  }
  if (typeof password !== "string" || password.length < config.passwordMinLen) {
    throw new HttpError(`Password must be at least ${config.passwordMinLen} characters`, 400, "BAD_PASSWORD");
  }
  const users = loadUsers();
  if (users[username]) {
    if (!verifyPassword(password, users[username])) {
      throw new HttpError("Invalid username or password", 401, "BAD_CREDENTIALS");
    }
  } else {
    const h = hashPassword(password);
    users[username] = { salt: h.salt, hash: h.hash, createdAt: new Date().toISOString() };
    saveUsers(users);
  }
  const now = Date.now();
  return {
    token: issueToken(username),
    username,
    tokenType: "Bearer",
    expiresInMs: config.tokenTtlMs,
    expiresAt: new Date(now + config.tokenTtlMs).toISOString(),
  };
}
