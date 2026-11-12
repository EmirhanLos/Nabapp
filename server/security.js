/**
 * Güvenlik yardımcıları: şifre hash'i (scrypt), token üretimi,
 * kod hash'i (HMAC), hız sınırlama (rate limit).
 */
"use strict";

const crypto = require("crypto");
const db = require("./db");

const APP_SECRET = process.env.NABAPP_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.NABAPP_SECRET) console.warn("[security] NABAPP_SECRET ortam değişkeni ayarlanmamış. Üretimde sabit bir değer verin.");
let rateLimitCalls = 0;

// Oturum boşta kalma (idle) süresi. 0 => devre dışı.
const configuredIdle = Number(process.env.SESSION_IDLE_MINUTES);
const IDLE_MINUTES = Number.isFinite(configuredIdle) && configuredIdle >= 0 ? configuredIdle : 0;
const SESSION_IDLE_MS = IDLE_MINUTES * 60 * 1000;
// Üretimde NABAPP_SECRET ortam değişkeni ile sabit bir değer verin;
// aksi halde her yeniden başlatmada SMS kodu hash'leri geçersizleşir.

/* ---------- Şifre hash'i (scrypt) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split(":");
    if (scheme !== "scrypt") return false;
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

/* ---------- Oturum tokenları ---------- */
function createSession(userId, deviceInfo, ip, deviceHash = "") {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const configuredDays = Number(process.env.SESSION_DAYS);
  const SESSION_DAYS = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  const expires = now + 1000 * 60 * 60 * 24 * SESSION_DAYS;
  db.prepare(`INSERT INTO sessions (token_hash,user_id,device_info,created_at,expires_at,last_ip,last_active,device_hash)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(sha256(token), userId, String(deviceInfo || "").slice(0, 200), now, expires, ip || "", now, String(deviceHash || ""));
  return token;
}

function sessionUser(token) {
  if (!token) return null;
  const hash = sha256(token);
  const row = db.prepare(
    `SELECT u.*, s.expires_at, s.last_active, s.device_hash FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).get(hash);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  const lastActive = row.last_active || row.expires_at;
  if (SESSION_IDLE_MS > 0 && lastActive && now - lastActive > SESSION_IDLE_MS) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    logEvent(row.id, "session_idle_timeout", "Oturum boşta kalma süresi aşıldı.", "", "");
    return null;
  }
  if (!row.last_active || now - row.last_active > 60_000) {
    db.prepare("UPDATE sessions SET last_active = ? WHERE token_hash = ?").run(now, hash);
  }
  return row;
}

function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

function destroyAllSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function destroySessionsForDevice(userId, deviceHash) {
  if (!deviceHash) return 0;
  return db.prepare("DELETE FROM sessions WHERE user_id = ? AND device_hash = ?").run(userId, deviceHash).changes;
}

/* ---------- Cihaz güveni ---------- */
function deviceHash(userAgent, deviceId) {
  return sha256(`${String(userAgent || "").slice(0, 300)}|${String(deviceId || "").slice(0, 120)}`).slice(0, 32);
}

function registerDevice(userId, dHash, label, userAgent) {
  const now = Date.now();
  const existing = db.prepare("SELECT id FROM device_trust WHERE user_id=? AND device_hash=?").get(userId, dHash);
  if (existing) {
    db.prepare("UPDATE device_trust SET last_seen=? WHERE id=?").run(now, existing.id);
    return { id: existing.id, isNew: false };
  }
  const inserted = db.prepare(
    `INSERT INTO device_trust (user_id, device_hash, label, user_agent, first_seen, last_seen, approved)
     VALUES (?,?,?,?,?,?,0)`
  ).run(userId, dHash, String(label || "").slice(0, 80), String(userAgent || "").slice(0, 300), now, now);
  return { id: inserted.lastInsertRowid, isNew: true };
}

function listDevices(userId) {
  return db.prepare(
    `SELECT id, device_hash AS deviceHash, label, first_seen AS firstSeen, last_seen AS lastSeen, approved
     FROM device_trust WHERE user_id=? ORDER BY last_seen DESC`
  ).all(userId);
}

function approveDevice(userId, deviceId) {
  return db.prepare("UPDATE device_trust SET approved=1 WHERE id=? AND user_id=?").run(Number(deviceId), userId).changes;
}

function removeDevice(userId, deviceId) {
  const row = db.prepare("SELECT device_hash FROM device_trust WHERE id=? AND user_id=?").get(Number(deviceId), userId);
  if (!row) return { removed: 0, sessions: 0 };
  const removed = db.prepare("DELETE FROM device_trust WHERE id=? AND user_id=?").run(Number(deviceId), userId).changes;
  const sessions = destroySessionsForDevice(userId, row.device_hash);
  return { removed, sessions };
}

/* ---------- Güvenlik olay günlüğü ---------- */
function logEvent(userId, kind, detail = "", ip = "", userAgent = "") {
  try {
    db.prepare(`INSERT INTO security_events (user_id, kind, detail, ip, user_agent, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(userId || null, String(kind).slice(0, 60), String(detail || "").slice(0, 300),
        String(ip || "").slice(0, 60), String(userAgent || "").slice(0, 300), Date.now());
  } catch (err) {
    console.error("[security] Olay kaydedilemedi:", err.message);
  }
}

function listEvents(userId, limit = 100) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db.prepare(
    `SELECT id, kind, detail, ip, created_at AS createdAt
     FROM security_events WHERE user_id=? ORDER BY created_at DESC LIMIT ?`
  ).all(userId, capped);
}

/* ---------- Kaba kuvvet koruması (artan gecikmeli hesap kilidi) ---------- */
function isLocked(subject) {
  const row = db.prepare("SELECT locked_until FROM auth_guard WHERE subject=?").get(subject);
  if (!row) return 0;
  const remaining = row.locked_until - Date.now();
  return remaining > 0 ? remaining : 0;
}

function registerFailure(subject, max = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const row = db.prepare("SELECT * FROM auth_guard WHERE subject=?").get(subject);
  if (!row || now - row.window_start > windowMs) {
    db.prepare(`INSERT INTO auth_guard (subject, failures, locked_until, window_start) VALUES (?,1,0,?)
                ON CONFLICT(subject) DO UPDATE SET failures=1, locked_until=0, window_start=?`)
      .run(subject, now, now);
    return { lockedMs: 0, failures: 1 };
  }
  const failures = row.failures + 1;
  let lockedUntil = 0;
  if (failures >= max) {
    const block = Math.min(Math.floor(failures / max), 6);
    lockedUntil = now + block * 15 * 60 * 1000;
  }
  db.prepare("UPDATE auth_guard SET failures=?, locked_until=? WHERE subject=?").run(failures, lockedUntil, subject);
  return { lockedMs: Math.max(lockedUntil - now, 0), failures };
}

function clearFailures(subject) {
  db.prepare("DELETE FROM auth_guard WHERE subject=?").run(subject);
}

/* ---------- Tek kullanımlık kodlar (SMS / e-posta) ---------- */
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function codeHash(subject, code) {
  return crypto.createHmac("sha256", APP_SECRET).update(`${subject}:${code}`).digest("hex");
}

function storeCode(table, subject, code, purpose, ttlMs, userId) {
  const now = Date.now();
  if (table === "sms_codes") {
    db.prepare("DELETE FROM sms_codes WHERE phone = ? AND purpose = ?").run(subject, purpose);
    db.prepare(`INSERT INTO sms_codes (phone, code_hash, purpose, attempts, expires_at, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(subject, codeHash(subject, code), purpose, 0, now + ttlMs, now);
  } else {
    db.prepare("DELETE FROM email_codes WHERE user_id = ?").run(userId);
    db.prepare(`INSERT INTO email_codes (user_id, email, code_hash, expires_at)
                VALUES (?,?,?,?)`).run(userId, subject, codeHash(subject, code), now + ttlMs);
  }
}

function verifyCode(table, subject, code, purpose) {
  let row;
  if (table === "sms_codes") {
    row = db.prepare("SELECT * FROM sms_codes WHERE phone = ? AND purpose = ?").get(subject, purpose || "register");
  } else {
    row = db.prepare("SELECT * FROM email_codes WHERE email = ?").get(subject);
  }
  if (!row) return { ok: false, error: "Kod bulunamadı. Yeni kod isteyin." };
  if (row.expires_at < Date.now()) return { ok: false, error: "Kodun süresi doldu. Yeni kod isteyin." };
  if (row.attempts >= 5) return { ok: false, error: "Çok fazla deneme. Yeni kod isteyin." };
  const ok = crypto.timingSafeEqual(Buffer.from(codeHash(subject, code)), Buffer.from(row.code_hash));
  if (!ok) {
    if (table === "sms_codes") db.prepare("UPDATE sms_codes SET attempts = attempts + 1 WHERE phone = ? AND purpose = ?").run(subject, purpose || "register");
    return { ok: false, error: "Kod hatalı." };
  }
  db.prepare(table === "sms_codes" ? "DELETE FROM sms_codes WHERE phone = ?" : "DELETE FROM email_codes WHERE email = ?").run(subject);
  return { ok: true };
}

/* ---------- Hız sınırlama ---------- */
function rateLimit(bucket, max, windowMs) {
  const now = Date.now();
  rateLimitCalls += 1;
  if (rateLimitCalls % 100 === 0) {
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - 24 * 60 * 60 * 1000);
  }
  const row = db.prepare("SELECT * FROM rate_limits WHERE bucket = ?").get(bucket);
  if (!row || now - row.window_start > windowMs) {
    db.prepare(`INSERT INTO rate_limits (bucket, count, window_start) VALUES (?,1,?)
                ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = ?`)
      .run(bucket, now, now);
    return true;
  }
  if (row.count >= max) return false;
  db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").run(bucket);
  return true;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/* ---------- Telefon normalizasyonu (E.164) ---------- */
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : "+" + digits;
}

module.exports = {
  APP_SECRET, SESSION_IDLE_MS, hashPassword, verifyPassword, createSession, sessionUser,
  destroySession, destroyAllSessions, destroySessionsForDevice, generateCode, codeHash, storeCode,
  verifyCode, rateLimit, sha256, normalizePhone,
  deviceHash, registerDevice, listDevices, approveDevice, removeDevice,
  logEvent, listEvents, isLocked, registerFailure, clearFailures,
};
