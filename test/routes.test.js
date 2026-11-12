"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nabapp-test-"));
process.env.NABAPP_DATA_DIR = dataDir;
process.env.NABAPP_SECRET = "test-secret-that-is-long-enough-for-tests";

const express = require("express");
const db = require("../server/db");
const sec = require("../server/security");
const wsLayer = require("../server/ws");
const { router } = require("../server/routes");

const app = express();
app.use(express.json());
app.use("/api", router);
let server;
let baseUrl;
let token;
let userId;
const testContactPhone = `+1555555${String(100 + Math.floor(Math.random() * 100)).padStart(4, "0")}`;

before(async () => {
  db.prepare(
    "INSERT INTO users (phone, display_name, password_hash, phone_verified, created_at) VALUES (?,?,?,1,?)"
  ).run("+905301234567", "Test User", sec.hashPassword("test-password"), Date.now());
  userId = db.prepare("SELECT id FROM users WHERE phone=?").get("+905301234567").id;
  token = sec.createSession(userId, "test", "127.0.0.1");

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("sessions do not expire from inactivity by default", async () => {
  assert.equal(sec.SESSION_IDLE_MS, 0);
  db.prepare("UPDATE sessions SET last_active=? WHERE token_hash=?")
    .run(Date.now() - 24 * 60 * 60 * 1000, sec.sha256(token));
  const response = await fetch(`${baseUrl}/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
});

test("SMS codes issued for existing users verify against the login purpose", async () => {
  const requested = await fetch(`${baseUrl}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+905301234567" }),
  });
  const requestBody = await requested.json();
  assert.equal(requestBody.purpose, "login");
  // Sağlayıcı yapılandırılmadığında geliştirme modu kodları konsola yazar; gönderim başarılı sayılır.
  // Kod asla HTTP yanıtına eklenmez.
  assert.equal(requestBody.sent, true);
  assert.equal(requestBody.devCode, undefined);

  // Gerçek sağlayıcı olmadığından doğrulama yolunu bilinen bir kodla test ediyoruz.
  const knownCode = "123456";
  sec.storeCode("sms_codes", "+905301234567", knownCode, "login", 5 * 60 * 1000);

  const verified = await fetch(`${baseUrl}/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+905301234567", code: knownCode }),
  });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).isNew, false);
});

test("screen-lock reauthentication verifies password and consumes a recovery code once", async () => {
  const headers = {
    Authorization: ["Be", "arer"].join("") + " " + token,
    "Content-Type": "application/json",
  };
  const unauthenticated = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-password" }),
  });
  assert.equal(unauthenticated.status, 401);

  const wrongPassword = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(wrongPassword.status, 401);

  const passwordOnly = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "test-password" }),
  });
  assert.equal(passwordOnly.status, 200);

  db.prepare("UPDATE users SET twofa_enabled=1, twofa_secret=? WHERE id=?").run("JBSWY3DPEHPK3PXP", userId);
  const missingSecondFactor = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "test-password" }),
  });
  assert.equal(missingSecondFactor.status, 401);
  assert.equal((await missingSecondFactor.json()).twofaRequired, true);

  const recoveryCode = "ABCD1234";
  db.prepare("INSERT INTO twofa_recovery (user_id, code_hash) VALUES (?,?)")
    .run(userId, sec.sha256(recoveryCode));
  const wrongPasswordRecovery = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "wrong-password", twofaCode: recoveryCode }),
  });
  assert.equal(wrongPasswordRecovery.status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM twofa_recovery WHERE user_id=?").get(userId).count, 1);

  const unlocked = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "test-password", twofaCode: recoveryCode }),
  });
  assert.equal(unlocked.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM twofa_recovery WHERE user_id=?").get(userId).count, 0);

  const reusedRecoveryCode = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "test-password", twofaCode: recoveryCode }),
  });
  assert.equal(reusedRecoveryCode.status, 401);
  db.prepare("UPDATE users SET twofa_enabled=0, twofa_secret=NULL WHERE id=?").run(userId);
});

test("contacts require a verified session and support CRUD", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const unauthenticated = await fetch(`${baseUrl}/contacts`);
  assert.equal(unauthenticated.status, 401);

  db.prepare(
    "INSERT INTO users (phone, display_name, settings, last_seen, phone_verified, created_at) VALUES (?,?,?, ?,1,?)"
  ).run(testContactPhone, "Contact User", JSON.stringify({ lastSeen: false }), 1234, Date.now());
  const created = await fetch(`${baseUrl}/contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: testContactPhone, nickname: "Friend" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).contact.nickname, "Friend");

  const listed = await fetch(`${baseUrl}/contacts`, { headers });
  const listBody = await listed.json();
  assert.equal(listBody.contacts.length, 1);
  assert.equal(listBody.contacts[0].phone, testContactPhone);
  assert.equal(listBody.contacts[0].lastSeen, null);

  db.prepare("UPDATE users SET settings=? WHERE phone=?")
    .run(JSON.stringify({ lastSeen: true, avatarVisibility: "selected", avatarVisibleTo: ["+905301234567"] }), testContactPhone);
  db.prepare("UPDATE users SET avatar_url=?, about=? WHERE phone=?")
    .run("data:image/png;base64,aGVsbG8=", "Bir test açıklaması", testContactPhone);
  const visibleListed = await fetch(`${baseUrl}/contacts`, { headers });
  const visibleContact = (await visibleListed.json()).contacts[0];
  assert.equal(visibleContact.lastSeen, 1234);
  assert.equal(visibleContact.about, "Bir test açıklaması");
  assert.equal(visibleContact.avatarUrl, "data:image/png;base64,aGVsbG8=");
  db.prepare("UPDATE users SET settings=? WHERE phone=?")
    .run(JSON.stringify({ lastSeen: false, avatarVisibility: "selected", avatarVisibleTo: ["+905301234569"] }), testContactPhone);
  const hiddenListed = await fetch(`${baseUrl}/contacts`, { headers });
  const hiddenContact = (await hiddenListed.json()).contacts[0];
  assert.equal(hiddenContact.lastSeen, null);
  assert.equal(hiddenContact.avatarUrl, null);

  const groupResponse = await fetch(`${baseUrl}/groups`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Test group", members: [testContactPhone] }),
  });
  assert.equal(groupResponse.status, 201);
  const group = (await groupResponse.json()).group;
  assert.equal(group.members.length, 2);
  const listedGroups = await fetch(`${baseUrl}/groups`, { headers });
  assert.equal((await listedGroups.json()).groups[0].name, "Test group");

  const patched = await fetch(`${baseUrl}/contacts/${encodeURIComponent(testContactPhone)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ nickname: "Best friend" }),
  });
  assert.equal(patched.status, 200);

  const deleted = await fetch(`${baseUrl}/contacts/${encodeURIComponent(testContactPhone)}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/contacts`, { headers })).json()).contacts.length, 0);
});

test("the account can save itself as a named contact for a private notes chat", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = await fetch(`${baseUrl}/contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+905301234567", nickname: "Kendime notlar" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).contact.nickname, "Kendime notlar");

  const listed = await fetch(`${baseUrl}/contacts`, { headers });
  assert.equal((await listed.json()).contacts[0].phone, "+905301234567");

  const deleted = await fetch(`${baseUrl}/contacts/%2B905301234567`, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
});

test("profile edits and avatar visibility preferences are persisted", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const updated = await fetch(`${baseUrl}/me`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      about: "Test profil açıklaması",
      avatarUrl: "data:image/png;base64,aGVsbG8=",
      settings: { avatarVisibility: "selected", avatarVisibleTo: ["+1 555 555 0100"] },
    }),
  });
  assert.equal(updated.status, 200);
  const { user } = await updated.json();
  assert.equal(user.about, "Test profil açıklaması");
  assert.equal(user.avatarUrl, "data:image/png;base64,aGVsbG8=");
  assert.equal(user.settings.avatarVisibility, "selected");
  assert.deepEqual(user.settings.avatarVisibleTo, ["+15555550100"]);
});

test("turning off last seen immediately removes the online presence indicator", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const target = db.prepare("SELECT id FROM users WHERE phone=?").get(testContactPhone);
  db.prepare("INSERT INTO contacts (owner_id, contact_user_id, created_at) VALUES (?,?,?)")
    .run(target.id, userId, Date.now());
  db.prepare("UPDATE users SET settings=? WHERE id=?")
    .run(JSON.stringify({ lastSeen: true }), userId);

  const received = [];
  const targetSocket = { readyState: 1, send: (payload) => received.push(JSON.parse(payload)) };
  const currentSocket = { readyState: 1, send: (payload) => received.push(JSON.parse(payload)) };
  wsLayer.presence.set("+905301234567", { userId, sockets: new Set([currentSocket]) });
  wsLayer.presence.set(testContactPhone, { userId: target.id, sockets: new Set([targetSocket]) });
  try {
    const updated = await fetch(`${baseUrl}/me`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ settings: { lastSeen: false } }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(received.at(-1), { type: "presence", online: [], lastSeen: {} });

    db.prepare("UPDATE users SET settings=?, last_seen=? WHERE id=?")
      .run(JSON.stringify({ lastSeen: true }), 1234, target.id);
    db.prepare("INSERT OR IGNORE INTO contacts (owner_id, contact_user_id, created_at) VALUES (?,?,?)")
      .run(userId, target.id, Date.now());
    wsLayer.presence.delete(testContactPhone);
    received.length = 0;
    wsLayer.broadcastPresence();
    assert.deepEqual(received.at(-1), {
      type: "presence", online: [], lastSeen: { [testContactPhone]: 1234 },
    });
  } finally {
    wsLayer.presence.clear();
  }
});

test("all login sessions are listed and can be individually closed", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const secondToken = sec.createSession(userId, "Second test device", "127.0.0.2", "test-device-2");
  const secondSessionId = sec.sha256(secondToken);
  const listed = await fetch(`${baseUrl}/sessions`, { headers });
  const sessions = (await listed.json()).sessions;
  assert.ok(sessions.some((session) => session.id === secondSessionId));
  assert.ok(sessions.some((session) => session.device_info === "test"));

  const closed = await fetch(`${baseUrl}/sessions/${secondSessionId}`, { method: "DELETE", headers });
  assert.equal(closed.status, 200);
  const afterClose = await fetch(`${baseUrl}/sessions`, { headers });
  assert.equal((await afterClose.json()).sessions.some((session) => session.id === secondSessionId), false);
});

test("message relay endpoints no longer exist on the server", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const post = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toPhone: "+905301234568",
      ciphertext: "opaque-ciphertext",
      ratchetHeader: { n: 1 },
      msgId: "test-message-1",
    }),
  });
  assert.equal(post.status, 404);
  const pending = await fetch(`${baseUrl}/messages/pending`, { headers });
  assert.equal(pending.status, 404);
  const ack = await fetch(`${baseUrl}/messages/ack`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ids: [1] }),
  });
  assert.equal(ack.status, 404);
  // Sunucuda mesaj içeriği tutan tablo kalmadı.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert.equal(tables.includes("messages"), false);
  assert.equal(tables.includes("message_reactions"), false);
});
