/**
 * TOTP (RFC 6238) — Google Authenticator / Authy uyumlu 2FA.
 * Bağımlılık yok: base32 + HMAC-SHA1 tabanlı saf Node implementasyonu.
 */
"use strict";

const crypto = require("crypto");

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | B32_ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

/** @param secretBase32 base32 sırrı @param token kullanıcıdan gelen 6 haneli kod */
function verifyTotp(secretBase32, token, windowSteps = 1, stepSeconds = 30) {
  if (!/^\d{6}$/.test(token || "")) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let i = -windowSteps; i <= windowSteps; i++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, counter + i)), Buffer.from(token))) return true;
  }
  return false;
}

function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** Kimlik doğrulayıcıya eklenecek URL */
function otpauthUrl(secret, phone) {
  return `otpauth://totp/Nabapp:${encodeURIComponent(phone)}?secret=${secret}&issuer=Nabapp&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { verifyTotp, newSecret, otpauthUrl, base32Decode };
