"use strict";

const express = require("express");
const db = require("./db");
const sec = require("./security");
const totp = require("./totp");
const QRCode = require("qrcode");
const { sendSmsCode, sendEmailCode, SMS_PROVIDER } = require("./sms");
const wsLayer = require("./ws");

const router = express.Router();

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = sec.sessionUser(token);
  if (!user) return res.status(401).json({ error: "Oturum geçersiz veya süresi doldu." });
  if (!sec.rateLimit(`user:${user.id}`, 600, 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla istek. Lütfen daha sonra tekrar deneyin." });
  }
  req.user = user;
  req.token = token;
  next();
}

function requireVerified(req, res, next) {
  if (!req.user.phone_verified) {
    return res.status(403).json({ error: "Numara doğrulaması gerekli. SMS kodunu onaylayın." });
  }
  next();
}

const ip = (req) => (req.ip || req.socket.remoteAddress || "").toString();

function clientDevice(req) {
  const ua = req.headers["user-agent"] || "";
  const deviceId = String(req.headers["x-nab-device"] || "").slice(0, 120);
  return { ua, hash: sec.deviceHash(ua, deviceId) };
}

function lockResponse(res, subject) {
  const lockMs = sec.isLocked(subject);
  if (lockMs <= 0) return false;
  res.status(429).json({ error: `Çok fazla başarısız deneme. ${Math.max(1, Math.ceil(lockMs / 60000))} dakika sonra tekrar deneyin.` });
  return true;
}

router.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!sec.rateLimit(`ip:${ip(req)}`, 300, 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla istek. Lütfen daha sonra tekrar deneyin." });
  }
  next();
});
router.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

router.post("/auth/request-code", (req, res) => {
  const phone = sec.normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: "Geçerli bir telefon numarası girin (örn. +90 5xx xxx xx xx)." });
  if (!sec.rateLimit(`sms:${phone}`, 3, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla kod istendi. 10 dakika sonra tekrar deneyin." });
  }
  const existing = db.prepare("SELECT id, password_hash FROM users WHERE phone = ?").get(phone);
  const purpose = existing && existing.password_hash ? "login" : "register";
  const code = sec.generateCode();
  sec.storeCode("sms_codes", phone, code, purpose, 5 * 60 * 1000);

  sendSmsCode(phone, code).then((r) => {
    res.json({
      sent: r.delivered,
      purpose,
      provider: SMS_PROVIDER,
      message: r.delivered ? "Kod gönderildi." : "SMS gönderilemedi, lütfen tekrar deneyin.",
    });
  });
});

router.post("/auth/resend-code", (req, res) => {
  const phone = sec.normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: "Geçerli bir telefon numarası girin." });
  if (!sec.rateLimit(`sms:${phone}`, 3, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla kod istendi. 10 dakika sonra tekrar deneyin." });
  }
  const existing = db.prepare("SELECT id, password_hash FROM users WHERE phone=?").get(phone);
  const purpose = existing && existing.password_hash ? "login" : "register";
  const code = sec.generateCode();
  sec.storeCode("sms_codes", phone, code, purpose, 5 * 60 * 1000);
  sendSmsCode(phone, code).then((r) => {
    res.json({
      sent: r.delivered,
      purpose,
      provider: SMS_PROVIDER,
      message: r.delivered ? "Kod gönderildi." : "SMS gönderilemedi, lütfen tekrar deneyin.",
    });
  }).catch((err) => {
    console.error("[sms] Kod gönderilemedi:", err.message);
    res.status(502).json({ error: "SMS gönderilemedi, lütfen tekrar deneyin." });
  });
});

router.post("/auth/verify-code", (req, res) => {
  const phone = sec.normalizePhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  if (!phone || !/^\d{4,8}$/.test(code)) return res.status(400).json({ error: "Numara ve kod zorunlu." });
  const subject = `verify:${phone}`;
  if (lockResponse(res, subject)) return;
  if (!sec.rateLimit(`verify:${phone}`, 10, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla deneme. Biraz bekleyin." });
  }
  const existingUser = db.prepare("SELECT id, password_hash FROM users WHERE phone=?").get(phone);
  const purpose = existingUser && existingUser.password_hash ? "login" : "register";
  const result = sec.verifyCode("sms_codes", phone, code, purpose);
  if (!result.ok) {
    const { lockedMs } = sec.registerFailure(subject);
    sec.logEvent(existingUser ? existingUser.id : null, "verify_code_failed", "Hatalı SMS doğrulama kodu.", ip(req), req.headers["user-agent"] || "");
    if (lockedMs > 0) {
      return res.status(429).json({ error: `Çok fazla hatalı kod. ${Math.max(1, Math.ceil(lockedMs / 60000))} dakika sonra tekrar deneyin.` });
    }
    return res.status(400).json({ error: result.error });
  }
  sec.clearFailures(subject);

  let user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  const isNew = !user || !user.password_hash;
  if (!user) {
    db.prepare("INSERT INTO users (phone, display_name, phone_verified, created_at) VALUES (?,?,1,?)")
      .run(phone, phone, Date.now());
    user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  } else {
    db.prepare("UPDATE users SET phone_verified = 1 WHERE id = ?").run(user.id);
    user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  }
  const flowToken = isNew ? sec.createSession(user.id, "registration-flow", ip(req)) : null;
  res.json({ flowToken, isNew, phoneVerified: true });
});

router.post("/auth/complete", (req, res) => {
  const flow = sec.sessionUser(req.body.flowToken || "");
  if (!flow) return res.status(401).json({ error: "Doğrulama oturumu geçersiz. Kodu tekrar isteyin." });
  const { displayName, password, identityPub, identitySignPub, signedPrekeyPub, signedPrekeySig, prekeys } = req.body;

  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: "En az 2 karakterlik bir ad girin." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 1024) {
    return res.status(400).json({ error: "Parola en az 8 karakter olmalı (anahtar yedeğinizi korur)." });
  }
  if (!isPublicP256Key(identityPub) || !isPublicP256Key(identitySignPub) ||
      !isPublicP256Key(signedPrekeyPub) ||
      typeof signedPrekeySig !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signedPrekeySig)) {
    return res.status(400).json({ error: "Şifreleme anahtarları eksik." });
  }
  if (prekeys !== undefined && prekeys !== null && !validPrekeys(prekeys, true)) {
    return res.status(400).json({ error: "En fazla 200 geçerli prekey gönderilebilir." });
  }

  db.prepare(`UPDATE users SET display_name=?, password_hash=?, identity_pub=?, identity_sign_pub=?,
              signed_prekey_pub=?, signed_prekey_sig=? WHERE id=?`).run(
    displayName.trim(), sec.hashPassword(password),
    JSON.stringify(identityPub), JSON.stringify(identitySignPub),
    JSON.stringify(signedPrekeyPub), signedPrekeySig, flow.id
  );
  if (Array.isArray(prekeys) && prekeys.length) uploadPrekeys(flow.id, prekeys);

  sec.destroySession(req.body.flowToken);
  const dev = clientDevice(req);
  const device = sec.registerDevice(flow.id, dev.hash, dev.ua.slice(0, 80), dev.ua);
  const token = sec.createSession(flow.id, dev.ua, ip(req), dev.hash);
  sec.logEvent(flow.id, "register_complete", "Kayıt tamamlandı; cihaz eklendi.", ip(req), dev.ua);
  res.json({
    token,
    user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(flow.id), false, { id: flow.id }),
    device: { id: device.id, isNew: device.isNew },
  });
});

router.post("/auth/login", (req, res) => {
  const phone = sec.normalizePhone(req.body.phone);
  const subject = `login:${phone || ip(req)}`;
  if (lockResponse(res, subject)) return;
  const user = phone ? db.prepare("SELECT * FROM users WHERE phone = ?").get(phone) : null;
  const genericError = "Numara veya parola hatalı.";
  const ua = req.headers["user-agent"] || "";

  const fail = (payload = { error: genericError }) => {
    const { lockedMs } = sec.registerFailure(subject);
    sec.logEvent(user ? user.id : null, "login_failed", `Başarısız giriş denemesi: ${phone || "bilinmeyen numara"}`, ip(req), ua);
    if (lockedMs > 0) {
      return res.status(429).json({ error: `Çok fazla başarısız deneme. ${Math.max(1, Math.ceil(lockedMs / 60000))} dakika sonra tekrar deneyin.` });
    }
    return res.status(401).json(payload);
  };

  if (!user || !user.password_hash || !user.phone_verified) return fail();
  if (!sec.rateLimit(`login:${user.id}`, 8, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla başarısız deneme. 10 dakika bekleyin." });
  }
  const password = typeof req.body.password === "string" && req.body.password.length <= 1024 ? req.body.password : "";
  if (!sec.verifyPassword(password, user.password_hash)) return fail();

  if (user.twofa_enabled) {
    const code = String(req.body.twofaCode || "").trim();
    if (!code) return res.status(401).json({ error: "2FA kodu gerekli.", twofaRequired: true });
    const recoveryRow = db.prepare("SELECT * FROM twofa_recovery WHERE user_id=?").all(user.id);
    const matchesRecovery = recoveryRow.some((r) => r.code_hash === sec.sha256(code.toUpperCase()));
    const validTotp = totp.verifyTotp(user.twofa_secret, code);
    if (!validTotp && !matchesRecovery) return fail({ error: "2FA kodu hatalı.", twofaRequired: true });
    if (matchesRecovery) db.prepare("DELETE FROM twofa_recovery WHERE code_hash=?").run(sec.sha256(code.toUpperCase()));
  }

  sec.clearFailures(subject);
  db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(Date.now(), user.id);
  const dev = clientDevice(req);
  const device = sec.registerDevice(user.id, dev.hash, dev.ua.slice(0, 80), dev.ua);
  const token = sec.createSession(user.id, dev.ua, ip(req), dev.hash);
  sec.logEvent(user.id, "login_success", device.isNew ? "Yeni cihazdan giriş." : "Bilinen cihazdan giriş.", ip(req), dev.ua);
  res.json({ token, user: publicUser(user, false, { id: user.id }), device: { id: device.id, isNew: device.isNew } });
});

router.post("/auth/reauthenticate", auth, requireVerified, (req, res) => {
  const subject = `reauth:${req.user.id}`;
  const ua = req.headers["user-agent"] || "";
  if (lockResponse(res, subject)) return;
  if (!sec.rateLimit(`reauth:${req.user.id}`, 8, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla doğrulama denemesi. 10 dakika sonra tekrar deneyin." });
  }
  const password = typeof req.body.password === "string" && req.body.password.length <= 1024
    ? req.body.password
    : "";
  if (!sec.verifyPassword(password, req.user.password_hash)) {
    const { lockedMs } = sec.registerFailure(subject);
    sec.logEvent(req.user.id, "reauth_failed", "Ekran kilidi doğrulaması başarısız (parola).", ip(req), ua);
    if (lockedMs > 0) {
      return res.status(429).json({ error: `Çok fazla hatalı deneme. ${Math.max(1, Math.ceil(lockedMs / 60000))} dakika sonra tekrar deneyin.` });
    }
    return res.status(401).json({ error: "Parola hatalı." });
  }

  if (req.user.twofa_enabled) {
    const rawCode = typeof req.body.twofaCode === "string" && req.body.twofaCode.length <= 64
      ? req.body.twofaCode
      : "";
    const code = rawCode.trim();
    if (!code) return res.status(401).json({ error: "2FA veya kurtarma kodu gerekli.", twofaRequired: true });
    if (totp.verifyTotp(req.user.twofa_secret, code)) {
      sec.clearFailures(subject);
      return res.json({ ok: true });
    }
    const recoveryCodeHash = sec.sha256(code.toUpperCase());
    const consumed = db.prepare("DELETE FROM twofa_recovery WHERE user_id=? AND code_hash=?")
      .run(req.user.id, recoveryCodeHash);
    if (consumed.changes) {
      sec.clearFailures(subject);
      return res.json({ ok: true });
    }
    sec.registerFailure(subject);
    sec.logEvent(req.user.id, "reauth_failed", "Ekran kilidi doğrulaması başarısız (2FA).", ip(req), ua);
    return res.status(401).json({ error: "2FA veya kurtarma kodu hatalı.", twofaRequired: true });
  }

  sec.clearFailures(subject);
  res.json({ ok: true });
});

router.post("/auth/logout", auth, (req, res) => {
  sec.destroySession(req.token);
  sec.logEvent(req.user.id, "logout", "Oturum kapatıldı.", ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true });
});

router.get("/me", auth, (req, res) => res.json({ user: publicUser(req.user, true, { id: req.user.id }) }));

router.patch("/me", auth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const previousSettings = safeJson(u.settings) || {};
  if (typeof b.displayName === "string" && b.displayName.trim().length >= 2) {
    db.prepare("UPDATE users SET display_name=? WHERE id=?").run(b.displayName.trim().slice(0, 60), u.id);
  }
  if (typeof b.about === "string") db.prepare("UPDATE users SET about=? WHERE id=?").run(b.about.slice(0, 200), u.id);
  if (typeof b.avatarColor === "string" && /^#[0-9a-f]{6}$/i.test(b.avatarColor)) {
    db.prepare("UPDATE users SET avatar_color=? WHERE id=?").run(b.avatarColor, u.id);
  }
  if (typeof b.avatarUrl === "string") {
    const value = b.avatarUrl.trim();
    if (value === "") {
      db.prepare("UPDATE users SET avatar_url=NULL WHERE id=?").run(u.id);
    } else if (value.length <= 400_000 && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) {
      db.prepare("UPDATE users SET avatar_url=? WHERE id=?").run(value, u.id);
    } else {
      return res.status(400).json({ error: "Profil fotoğrafı geçersiz veya çok büyük (en fazla ~300 KB)." });
    }
  }
  if (b.settings && typeof b.settings === "object" && !Array.isArray(b.settings)) {
    const clean = { ...b.settings };
    if ("avatarVisibility" in clean) {
      const allowed = ["everyone", "contacts", "selected", "nobody"];
      clean.avatarVisibility = allowed.includes(clean.avatarVisibility) ? clean.avatarVisibility : "everyone";
    }
    if ("avatarVisibleTo" in clean) {
      clean.avatarVisibleTo = Array.isArray(clean.avatarVisibleTo)
        ? clean.avatarVisibleTo.map((entry) => sec.normalizePhone(entry)).filter(Boolean).slice(0, 200)
        : [];
    }
    const merged = { ...JSON.parse(u.settings || "{}"), ...clean };
    db.prepare("UPDATE users SET settings=? WHERE id=?").run(JSON.stringify(merged), u.id);
    if ("lastSeen" in clean && previousSettings.lastSeen !== merged.lastSeen) {
      wsLayer.broadcastPresence();
    }
  }
  const updated = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  res.json({ user: publicUser(updated, true, { id: updated.id }) });
});

router.post("/password/change", auth, requireVerified, (req, res) => {
  const { current, next } = req.body;
  if (typeof current !== "string" || current.length > 1024 || !sec.verifyPassword(current, req.user.password_hash)) {
    sec.logEvent(req.user.id, "password_change_failed", "Parola değiştirme başarısız (mevcut parola hatalı).", ip(req), req.headers["user-agent"] || "");
    return res.status(401).json({ error: "Mevcut parola hatalı." });
  }
  if (typeof next !== "string" || next.length < 8 || next.length > 1024) return res.status(400).json({ error: "Yeni parola en az 8 karakter olmalı." });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(sec.hashPassword(next), req.user.id);
  sec.logEvent(req.user.id, "password_changed", "Parola değiştirildi.", ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true });
});

router.post("/2fa/setup", auth, requireVerified, (req, res) => {
  const secret = totp.newSecret();
  db.prepare("UPDATE users SET twofa_secret=? WHERE id=?").run(secret, req.user.id);
  res.json({ secret, otpauth: totp.otpauthUrl(secret, req.user.phone) });
});

router.get("/2fa/qr", auth, requireVerified, async (req, res, next) => {
  try {
    const user = db.prepare("SELECT twofa_secret, phone FROM users WHERE id=?").get(req.user.id);
    if (!user || !user.twofa_secret) return res.status(400).json({ error: "Önce 2FA kurulumunu başlatın." });
    const dataUrl = await QRCode.toDataURL(totp.otpauthUrl(user.twofa_secret, user.phone));
    res.json({ dataUrl });
  } catch (err) {
    next(err);
  }
});

router.post("/2fa/enable", auth, requireVerified, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user.twofa_secret) return res.status(400).json({ error: "Önce 2FA kurulumunu başlatın." });
  if (!totp.verifyTotp(user.twofa_secret, req.body.code)) {
    return res.status(400).json({ error: "Doğrulayıcı kodu hatalı. Tekrar deneyin." });
  }
  db.prepare("UPDATE users SET twofa_enabled=1 WHERE id=?").run(user.id);
  const recovery = [];
  db.prepare("DELETE FROM twofa_recovery WHERE user_id=?").run(user.id);
  const ins = db.prepare("INSERT INTO twofa_recovery (user_id, code_hash) VALUES (?,?)");
  for (let i = 0; i < 8; i++) {
    const code = require("crypto").randomBytes(5).toString("hex").toUpperCase();
    recovery.push(code);
    ins.run(user.id, sec.sha256(code));
  }
  sec.logEvent(user.id, "2fa_enabled", "İki adımlı doğrulama etkinleştirildi.", ip(req), req.headers["user-agent"] || "");
  res.json({ enabled: true, recovery });
});

router.post("/2fa/disable", auth, requireVerified, (req, res) => {
  const { password, code } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!sec.verifyPassword(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "Parola hatalı." });
  }
  if (user.twofa_enabled && !totp.verifyTotp(user.twofa_secret, code)) {
    return res.status(400).json({ error: "Doğrulayıcı kodu hatalı." });
  }
  db.prepare("UPDATE users SET twofa_enabled=0, twofa_secret=NULL WHERE id=?").run(user.id);
  db.prepare("DELETE FROM twofa_recovery WHERE user_id=?").run(user.id);
  sec.logEvent(user.id, "2fa_disabled", "İki adımlı doğrulama devre dışı bırakıldı.", ip(req), req.headers["user-agent"] || "");
  res.json({ enabled: false });
});

router.post("/email/request", auth, requireVerified, (req, res) => {
  const rawEmail = (req.body || {}).email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Geçerli bir e-posta girin." });
  if (!sec.rateLimit(`email:${req.user.id}`, 3, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Çok fazla istek. 10 dakika sonra tekrar deneyin." });
  }
  const code = sec.generateCode();
  sec.storeCode("email_codes", email, code, null, 5 * 60 * 1000, req.user.id);
  db.prepare("UPDATE users SET email=?, email_verified=0 WHERE id=?").run(email, req.user.id);
  sendEmailCode(email, code).then((r) => {
    res.json({ sent: r.delivered });
  }).catch((err) => {
    console.error("[email] Kod gönderilemedi:", err.message);
    res.status(502).json({ error: "E-posta gönderilemedi, lütfen tekrar deneyin." });
  });
});

router.post("/email/verify", auth, requireVerified, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user.email) return res.status(400).json({ error: "Önce e-posta adresinizi girin." });
  const result = sec.verifyCode("email_codes", user.email, String(req.body.code || ""));
  if (!result.ok) return res.status(400).json({ error: result.error });
  db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  sec.logEvent(user.id, "email_verified", "E-posta adresi doğrulandı.", ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true, email: user.email });
});

router.delete("/email", auth, requireVerified, (req, res) => {
  db.prepare("UPDATE users SET email=NULL, email_verified=0 WHERE id=?").run(req.user.id);
  sec.logEvent(user.id, "email_removed", "E-posta adresi kaldırıldı.", ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true });
});

function uploadPrekeys(userId, prekeys) {
  const ins = db.prepare("INSERT OR REPLACE INTO prekeys (user_id, key_id, public_key) VALUES (?,?,?)");
  const tx = db.transaction((rows) => rows.forEach((p) => ins.run(userId, Number(p.keyId), JSON.stringify(p.publicKey))));
  tx(prekeys);
}

router.post("/keys/prekeys", auth, requireVerified, (req, res) => {
  const prekeys = (req.body || {}).prekeys;
  if (!validPrekeys(prekeys, false)) {
    return res.status(400).json({ error: "1-200 geçerli prekey içeren bir dizi gerekli." });
  }
  uploadPrekeys(req.user.id, prekeys);
  res.json({ ok: true, count: prekeys.length });
});

router.get("/keys/bundle/:phone", auth, requireVerified, (req, res) => {
  const phone = sec.normalizePhone(req.params.phone);
  const user = phone ? db.prepare("SELECT * FROM users WHERE phone=? AND phone_verified=1").get(phone) : null;
  if (!user) return res.status(404).json({ error: "Bu numara Nabapp kullanıcısı değil veya doğrulanmamış." });
  const oneTime = db.prepare("SELECT * FROM prekeys WHERE user_id=? AND used=0 ORDER BY key_id LIMIT 1").get(user.id);
  if (oneTime) db.prepare("UPDATE prekeys SET used=1 WHERE id=?").run(oneTime.id);
  res.json({
    user: publicUser(user, false, { id: req.user.id, phone: req.user.phone, isContact: false }),
    identityPub: safeJson(user.identity_pub),
    identitySignPub: safeJson(user.identity_sign_pub),
    signedPrekeyPub: safeJson(user.signed_prekey_pub),
    signedPrekeySig: user.signed_prekey_sig,
    oneTimePrekey: oneTime ? { keyId: oneTime.key_id, publicKey: safeJson(oneTime.public_key) } : null,
  });
});

router.get("/users/by-phone/:phone", auth, requireVerified, (req, res) => {
  const phone = sec.normalizePhone(req.params.phone);
  const user = phone ? db.prepare("SELECT * FROM users WHERE phone=? AND phone_verified=1").get(phone) : null;
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  res.json({ user: publicUser(user, false, { id: req.user.id, phone: req.user.phone, isContact: false }) });
});

router.get("/contacts", auth, requireVerified, (req, res) => {
  const viewer = { id: req.user.id, phone: req.user.phone, isContact: true };
  const contacts = db.prepare(
    `SELECT u.id, u.phone, u.display_name AS displayName, u.about, u.avatar_color AS avatarColor,
            u.avatar_url AS avatarUrl, c.nickname, u.last_seen AS lastSeen, u.settings
     FROM contacts c JOIN users u ON u.id=c.contact_user_id
     WHERE c.owner_id=? ORDER BY COALESCE(c.nickname, u.display_name) COLLATE NOCASE`
  ).all(req.user.id).map((contact) => withContactPrivacy(contact, viewer));
  res.json({ contacts });
});

router.post("/contacts", auth, requireVerified, (req, res) => {
  const body = req.body || {};
  const phone = sec.normalizePhone(body.phone);
  if (!phone) return res.status(400).json({ error: "Geçerli bir telefon numarası girin." });
  const user = db.prepare("SELECT id FROM users WHERE phone=? AND phone_verified=1").get(phone);
  if (!user) return res.status(404).json({ error: "Bu numara Nabapp kullanıcısı değil veya doğrulanmamış." });
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 60) || null : null;
  try {
    db.prepare("INSERT INTO contacts (owner_id, contact_user_id, nickname, created_at) VALUES (?,?,?,?)")
      .run(req.user.id, user.id, nickname, Date.now());
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Bu kişi zaten listenizde." });
    throw err;
  }
  const contact = db.prepare(
    `SELECT u.id, u.phone, u.display_name AS displayName, u.about, u.avatar_color AS avatarColor,
            u.avatar_url AS avatarUrl, c.nickname, u.last_seen AS lastSeen, u.settings
     FROM contacts c JOIN users u ON u.id=c.contact_user_id
     WHERE c.owner_id=? AND c.contact_user_id=?`
  ).get(req.user.id, user.id);
  const viewer = { id: req.user.id, phone: req.user.phone, isContact: true };
  res.status(201).json({ contact: withContactPrivacy(contact, viewer) });
});

router.delete("/contacts/:phone", auth, requireVerified, (req, res) => {
  const phone = sec.normalizePhone(req.params.phone);
  if (!phone) return res.status(400).json({ error: "Geçerli bir telefon numarası girin." });
  const result = db.prepare(
    "DELETE FROM contacts WHERE owner_id=? AND contact_user_id=(SELECT id FROM users WHERE phone=?)"
  ).run(req.user.id, phone);
  if (!result.changes) return res.status(404).json({ error: "Kişi bulunamadı." });
  res.json({ ok: true });
});

router.patch("/contacts/:phone", auth, requireVerified, (req, res) => {
  const phone = sec.normalizePhone(req.params.phone);
  const nickname = (req.body || {}).nickname;
  if (!phone) return res.status(400).json({ error: "Geçerli bir telefon numarası girin." });
  if (typeof nickname !== "string" || nickname.trim().length > 60) {
    return res.status(400).json({ error: "Takma ad 60 karakteri geçmemeli." });
  }
  const result = db.prepare(
    `UPDATE contacts SET nickname=?
     WHERE owner_id=? AND contact_user_id=(SELECT id FROM users WHERE phone=?)`
  ).run(nickname.trim() || null, req.user.id, phone);
  if (!result.changes) return res.status(404).json({ error: "Kişi bulunamadı." });
  res.json({ ok: true });
});

router.get("/groups", auth, requireVerified, (req, res) => {
  const groups = db.prepare(
    `SELECT g.id, g.name, g.created_by AS createdBy, g.created_at AS createdAt
     FROM chat_groups g JOIN group_members mine ON mine.group_id=g.id
     WHERE mine.user_id=? ORDER BY g.created_at DESC`
  ).all(req.user.id).map((group) => ({
    ...group,
    members: db.prepare(
      `SELECT u.id, u.phone, u.display_name AS displayName, gm.role
       FROM group_members gm JOIN users u ON u.id=gm.user_id
       WHERE gm.group_id=? ORDER BY gm.created_at`
    ).all(group.id),
  }));
  res.json({ groups });
});

router.post("/groups", auth, requireVerified, (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const phones = req.body.members;
  if (!name || name.length > 80 || !Array.isArray(phones) || phones.length < 1 || phones.length > 49 ||
      phones.some((phone) => typeof phone !== "string")) {
    return res.status(400).json({ error: "Grup adı ve 1-49 geçerli kişi gerekli." });
  }
  const memberIds = new Set([req.user.id]);
  const findUser = db.prepare("SELECT id FROM users WHERE phone=? AND phone_verified=1");
  const isContact = db.prepare("SELECT 1 FROM contacts WHERE owner_id=? AND contact_user_id=?");
  for (const rawPhone of phones) {
    const phone = sec.normalizePhone(rawPhone);
    const user = phone ? findUser.get(phone) : null;
    if (!user || user.id === req.user.id || !isContact.get(req.user.id, user.id)) {
      return res.status(400).json({ error: "Gruba yalnızca doğrulanmış kişileriniz eklenebilir." });
    }
    memberIds.add(user.id);
  }
  if (memberIds.size < 2) return res.status(400).json({ error: "Grup en az iki kişiden oluşmalı." });
  const createGroup = db.transaction(() => {
    const result = db.prepare("INSERT INTO chat_groups (name, created_by, created_at) VALUES (?,?,?)")
      .run(name, req.user.id, Date.now());
    const insertMember = db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?,?,?,?)"
    );
    for (const userId of memberIds) {
      insertMember.run(result.lastInsertRowid, userId, userId === req.user.id ? "admin" : "member", Date.now());
    }
    return result.lastInsertRowid;
  });
  const id = createGroup();
  res.status(201).json({
    group: {
      id, name, createdBy: req.user.id,
      members: db.prepare(
        `SELECT u.id, u.phone, u.display_name AS displayName, gm.role
         FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=?`
      ).all(id),
    },
  });
});

router.get("/sessions", auth, (req, res) => {
  const rows = db.prepare(
    "SELECT token_hash AS id, device_info, created_at, last_active AS lastActive, last_ip, expires_at, device_hash AS deviceHash FROM sessions WHERE user_id=?"
  ).all(req.user.id);
  res.json({ sessions: rows, currentHash: sec.sha256(req.token).slice(0, 12) });
});

router.delete("/sessions/:id", auth, requireVerified, (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[\da-f]{64}$/i.test(id)) return res.status(400).json({ error: "Oturum kimliği geçersiz." });
  const result = db.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?").run(id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Oturum bulunamadı." });
  res.json({ ok: true });
});

router.post("/sessions/revoke-all", auth, (req, res) => {
  sec.destroyAllSessions(req.user.id);
  res.json({ ok: true });
});

router.post("/account/delete", auth, (req, res) => {
  const password = typeof req.body.password === "string" && req.body.password.length <= 1024 ? req.body.password : "";
  if (!sec.verifyPassword(password, req.user.password_hash)) {
    return res.status(401).json({ error: "Parola hatalı." });
  }
  db.prepare("DELETE FROM users WHERE id=?").run(req.user.id);
  res.json({ ok: true });
});

router.get("/config/webrtc", auth, (req, res) => {
  const iceServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || ""
    });
  }
  return res.json({ iceServers });
});

router.get("/devices", auth, (req, res) => {
  const currentHash = req.user.device_hash || "";
  const devices = sec.listDevices(req.user.id).map((device) => ({
    id: device.id,
    label: device.label || "Bilinmeyen cihaz",
    firstSeen: device.firstSeen,
    lastSeen: device.lastSeen,
    approved: !!device.approved,
    current: currentHash !== "" && device.deviceHash === currentHash,
  }));
  res.json({ devices });
});

router.post("/devices/:id/approve", auth, requireVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Cihaz kimliği geçersiz." });
  if (!sec.approveDevice(req.user.id, id)) return res.status(404).json({ error: "Cihaz bulunamadı." });
  sec.logEvent(req.user.id, "device_approved", `Cihaz onaylandı (#${id}).`, ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true });
});

router.delete("/devices/:id", auth, requireVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Cihaz kimliği geçersiz." });
  const result = sec.removeDevice(req.user.id, id);
  if (!result.removed) return res.status(404).json({ error: "Cihaz bulunamadı." });
  sec.logEvent(req.user.id, "device_removed", `Cihaz kaldırıldı (#${id}); ${result.sessions} oturum kapatıldı.`, ip(req), req.headers["user-agent"] || "");
  res.json({ ok: true, sessions: result.sessions });
});

router.get("/security/events", auth, (req, res) => {
  res.json({ events: sec.listEvents(req.user.id, req.query.limit) });
});

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function isPublicP256Key(key) {
  return Boolean(key && typeof key === "object" && !Array.isArray(key) &&
    key.kty === "EC" && key.crv === "P-256" &&
    typeof key.x === "string" && key.x.length === 43 &&
    typeof key.y === "string" && key.y.length === 43);
}

function validPrekeys(prekeys, allowEmpty) {
  return Array.isArray(prekeys) && prekeys.length <= 200 && (allowEmpty || prekeys.length > 0) &&
    prekeys.every((key) => key && typeof key === "object" && !Array.isArray(key) &&
      Number.isSafeInteger(Number(key.keyId)) && Number(key.keyId) >= 0 &&
      isPublicP256Key(key.publicKey));
}

function publicUser(u, includeSettings = false, viewer = null) {
  const settings = safeJson(u.settings) || {};
  const isSelf = viewer && viewer.id === u.id;
  
  let showAvatar = isSelf;
  if (!showAvatar && viewer) {
    const visibility = settings.avatarVisibility || "everyone";
    if (visibility === "everyone") {
      showAvatar = true;
    } else if (visibility === "contacts") {
      showAvatar = !!viewer.isContact;
    } else if (visibility === "selected") {
      const allowed = Array.isArray(settings.avatarVisibleTo) ? settings.avatarVisibleTo : [];
      showAvatar = allowed.includes(viewer.phone);
    }
  }

  const base = {
    id: u.id,
    phone: u.phone,
    displayName: u.display_name,
    about: u.about,
    avatarColor: u.avatar_color,
    avatarUrl: showAvatar ? u.avatar_url : null,
    phoneVerified: !!u.phone_verified,
    email: u.email,
    emailVerified: !!u.email_verified,
    twofaEnabled: !!u.twofa_enabled,
    lastSeen: settings.lastSeen === true ? u.last_seen : null,
  };
  if (includeSettings) base.settings = settings;
  return base;
}

function withContactPrivacy(contact, viewer = null) {
  const { settings, ...publicContact } = contact;
  const s = safeJson(settings) || {};
  
  let showAvatar = viewer && viewer.id === contact.id;
  if (!showAvatar && viewer) {
    const visibility = s.avatarVisibility || "everyone";
    if (visibility === "everyone") {
      showAvatar = true;
    } else if (visibility === "contacts") {
      showAvatar = !!viewer.isContact;
    } else if (visibility === "selected") {
      const allowed = Array.isArray(s.avatarVisibleTo) ? s.avatarVisibleTo : [];
      showAvatar = allowed.includes(viewer.phone);
    }
  }

  return {
    ...publicContact,
    avatarUrl: showAvatar ? contact.avatarUrl : null,
    lastSeen: s.lastSeen === true ? contact.lastSeen : null
  };
}

module.exports = { router, auth, requireVerified, publicUser };