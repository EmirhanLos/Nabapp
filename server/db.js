/**
 * Nabapp — Veritabanı katmanı (SQLite)
 * Yalnızca hesap/kimlik ve P2P sinyalleşmesi için gereken meta veri tutulur:
 * kullanıcılar, oturumlar, kişiler, gruplar, ön anahtarlar, doğrulama kodları, 2FA.
 * MESAJ İÇERİĞİ, DOSYA, FOTOĞRAF veya SES SUNUCUDA SAKLANMAZ.
 */
"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Varsayılan konum mevcut dağıtımlarla uyumludur; konteynerlerde NABAPP_DATA_DIR kullanılır.
const DATA_DIR = process.env.NABAPP_DATA_DIR || "E:\\nabapp-data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "nabapp.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,             -- E.164 biçimi: +905321234567
  display_name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#292a31',
  password_hash TEXT,                     -- scrypt(salt:hash) — cihaz anahtar yedeğini korumak için
  phone_verified INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  twofa_enabled INTEGER NOT NULL DEFAULT 0,
  twofa_secret TEXT,                       -- TOTP paylaşılan sırrı (base32)
  identity_pub TEXT,                       -- X3DH kimlik açık anahtarı (JWK)
  signed_prekey_pub TEXT,
  signed_prekey_sig TEXT,
  identity_sign_pub TEXT,
  last_seen INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',     -- JSON: bildirim, okundu bilgisi vb.
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,             -- SHA-256(token)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_info TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_ip TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sms_codes (
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,                 -- HMAC-SHA256(phone, code)
  purpose TEXT NOT NULL DEFAULT 'register',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prekeys (        -- tek kullanımlık ön anahtarlar (X3DH)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, key_id)
);

CREATE TABLE IF NOT EXISTS twofa_recovery (  -- 2FA kurtarma kodları (hash'li)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, contact_user_id)
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS device_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, device_id)
);

CREATE TABLE IF NOT EXISTS device_trust (     -- sunucu tarafı cihaz güveni
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, device_hash)
);

CREATE TABLE IF NOT EXISTS security_events (  -- güvenlik olay günlüğü
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_guard (       -- kaba kuvvet koruması
  subject TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
`);

// Eski sürümlerden kalan mesaj tabloları mimari gereği kaldırılır:
// sunucuda artık hiçbir mesaj/tepki içeriği saklanmaz.
db.exec("DROP TABLE IF EXISTS message_reactions");
db.exec("DROP TABLE IF EXISTS messages");

const userColumns = db.pragma("table_info(users)");
if (!userColumns.some((column) => column.name === "identity_sign_pub")) {
  db.exec("ALTER TABLE users ADD COLUMN identity_sign_pub TEXT");
}
if (!userColumns.some((column) => column.name === "avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
}

const sessionColumns = db.pragma("table_info(sessions)");
if (!sessionColumns.some((column) => column.name === "last_active")) {
  db.exec("ALTER TABLE sessions ADD COLUMN last_active INTEGER NOT NULL DEFAULT 0");
}
if (!sessionColumns.some((column) => column.name === "device_hash")) {
  db.exec("ALTER TABLE sessions ADD COLUMN device_hash TEXT NOT NULL DEFAULT ''");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_id, device_hash)");

module.exports = db;
