/**
 * Nabapp uçtan uca şifreleme (E2E) — saf WebCrypto, bağımlılık yok.
 */
"use strict";

const enc = new TextEncoder();
const dec = new TextDecoder();
let currentChatSessionKey = null; // Ram-based geçici oturum anahtarı

/* ---------- temel yardımcılar ---------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function hkdf(ikm, salt, info, length = 32) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256",
      salt: typeof salt === "string" ? enc.encode(salt) : salt,
      info: enc.encode(info) }, key, length * 8);
  return new Uint8Array(bits);
}

async function ecdh(privateJwk, publicJwk) {
  const priv = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", namedCurve: "P-256", public: pub }, priv, 256);
  return new Uint8Array(bits);
}

async function genPair() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { priv: kp.privateKey, pub: kp.publicKey, privJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), pubJwk: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}

/* ---------- kimlik ve ön anahtarlar ---------- */
async function generateIdentity() {
  const identity = await genPair();
  const signedPrekey = await genPair();
  const signing = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const identitySign = {
    privJwk: await crypto.subtle.exportKey("jwk", signing.privateKey),
    pubJwk: await crypto.subtle.exportKey("jwk", signing.publicKey),
  };
  const signedPrekeySig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signing.privateKey,
    enc.encode(canonicalJwk(signedPrekey.pubJwk))
  );
  return { identity, signedPrekey, identitySign, signedPrekeySig: b64(signedPrekeySig) };
}

async function verifySignedPrekey(bundle) {
  if (!bundle || !isPublicP256Jwk(bundle.identitySignPub) ||
      !isPublicP256Jwk(bundle.signedPrekeyPub) || typeof bundle.signedPrekeySig !== "string") {
    throw new Error("İmzalı anahtar paketi eksik veya geçersiz.");
  }
  const key = await crypto.subtle.importKey(
    "jwk", bundle.identitySignPub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, unb64(bundle.signedPrekeySig),
    enc.encode(canonicalJwk(bundle.signedPrekeyPub))
  );
  if (!valid) throw new Error("Ön anahtar imzası geçersiz; sohbet başlatılmadı.");
  return true;
}

async function identityFingerprint(identityPub, identitySignPub) {
  if (!isPublicP256Jwk(identityPub) || !isPublicP256Jwk(identitySignPub)) {
    throw new Error("Kimlik anahtarı geçersiz.");
  }
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", enc.encode(`${canonicalJwk(identityPub)}.${canonicalJwk(identitySignPub)}`)
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("").match(/.{1,4}/g).join(" ");
}

function canonicalJwk(jwk) {
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

function isPublicP256Jwk(jwk) {
  return Boolean(jwk && jwk.kty === "EC" && jwk.crv === "P-256" &&
    typeof jwk.x === "string" && typeof jwk.y === "string" &&
    !("d" in jwk));
}

async function generatePrekeyBatch(startId, count = 50) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const pair = await genPair();
    out.push({ keyId: startId + i, publicKey: pair.pubJwk, privateKey: pair.privJwk });
  }
  return out;
}

/* ---------- X3DH: oturum kurulumu ---------- */
async function establishSession(bundle, myIdentity) {
  await verifySignedPrekey(bundle);
  const EK = await genPair();
  const dh1 = await ecdh(myIdentity.privJwk, bundle.signedPrekeyPub);
  const dh2 = await ecdh(EK.privJwk, bundle.identityPub);
  const dh3 = await ecdh(EK.privJwk, bundle.signedPrekeyPub);
  const ikm = concat([dh1, dh2, dh3]);
  let sk = await hkdf(ikm, new Uint8Array(32), "nabapp-x3dh");

  if (bundle.oneTimePrekey) {
    const dh4 = await ecdh(EK.privJwk, bundle.oneTimePrekey.publicKey);
    sk = await hkdf(concat([dh1, dh2, dh3, dh4]), new Uint8Array(32), "nabapp-x3dh");
  }

  const myRatchet = EK;
  const d = await ecdh(myRatchet.privJwk, bundle.signedPrekeyPub);
  const rootKey = await hkdf(concat([sk, d]), new Uint8Array(32), "nabapp-root-init");
  const ratchetPubHex = jwkX(myRatchet.pubJwk);
  const sendChain = await hkdf(rootKey, ratchetPubHex, "chain");

  return {
    role: "initiator",
    session: {
      rootKey, sendChain,
      recvChain: null, myRatchet, theirRatchetPub: null,
      nSend: 0, nRecv: 0, skipped: {},
      lastHeaderPub: null,
    },
    setup: { ephemeralPub: EK.pubJwk, oneTimeKeyId: bundle.oneTimePrekey ? bundle.oneTimePrekey.keyId : null },
  };
}

async function acceptSession(header, myIdentity, mySignedPrekeyPriv, oneTimePriv) {
  await verifySignedPrekey(header);
  const EK = header.ephemeralPub;
  const dh1 = await ecdh(mySignedPrekeyPriv, header.identityPub);
  const dh2 = await ecdh(myIdentity.privJwk, EK);
  const dh3 = await ecdh(mySignedPrekeyPriv, EK);
  let ikm = concat([dh1, dh2, dh3]);
  if (oneTimePriv) {
    const dh4 = await ecdh(oneTimePriv, EK);
    ikm = concat([ikm, dh4]);
  }
  const sk = await hkdf(ikm, new Uint8Array(32), "nabapp-x3dh");

  const d = await ecdh(mySignedPrekeyPriv, EK);
  const rootKey = await hkdf(concat([sk, d]), new Uint8Array(32), "nabapp-root-init");
  const ratchetPubHex = jwkX(EK);
  const recvChain = await hkdf(rootKey, ratchetPubHex, "chain");

  return {
    session: {
      rootKey, sendChain: null, recvChain,
      myRatchet: null, theirRatchetPub: EK,
      nSend: 0, nRecv: 0, skipped: {}, lastHeaderPub: ratchetPubHex,
    },
  };
}

/* ---------- Double Ratchet: şifrele / çöz ---------- */
async function ratchetSend(session, plaintext) {
  if (!session.sendChain) {
    session.myRatchet = session.myRatchet || (await genPair());
    if (!session.theirRatchetPub) throw new Error("Karşı tarafın anahtarı bilinmiyor");
    const d = await ecdh(session.myRatchet.privJwk, session.theirRatchetPub);
    session.rootKey = await hkdf(session.rootKey, d, "root-ratchet");
    session.sendChain = await hkdf(session.rootKey, jwkX(session.myRatchet.pubJwk), "chain");
    session.nSend = 0;
  }
  const pubHex = jwkX(session.myRatchet.pubJwk);
  const mk = await hkdf(session.sendChain, String(session.nSend), "msg:" + pubHex, 64);
  const aesKey = mk.slice(0, 32), nonce = mk.slice(32, 44);
  const keyObj = await crypto.subtle.importKey("raw", aesKey, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, keyObj, enc.encode(plaintext));

  const header = { ratchetPub: session.myRatchet.pubJwk, n: session.nSend, ephemeralPub: null };
  session.nSend += 1;
  return { header, ciphertext: b64(ct), pubHex, n: header.n };
}

async function ratchetRecv(session, header, ciphertext) {
  const pubHex = jwkX(header.ratchetPub);
  const skippedKey = `${pubHex}:${header.n}`;
  let mk = session.skipped[skippedKey];
  if (mk) { delete session.skipped[skippedKey]; }
  else {
    if (session.lastHeaderPub !== pubHex) {
      const theirPub = header.ratchetPub;
      if (!session.myRatchet) session.myRatchet = await genPair();
      const d = await ecdh(session.myRatchet.privJwk, theirPub);
      session.rootKey = await hkdf(session.rootKey, d, "root-ratchet");
      session.recvChain = await hkdf(session.rootKey, pubHex, "chain");
      session.lastHeaderPub = pubHex;
      session.nRecv = 0;
    }
    if (!session.recvChain) throw new Error("Oturum henüz kurulmamış");
    if (header.n > session.nRecv) {
      for (let i = session.nRecv; i < header.n; i++) {
        session.skipped[`${pubHex}:${i}`] = await hkdf(session.recvChain, String(i), "msg:" + pubHex, 64);
      }
    }
    mk = await hkdf(session.recvChain, String(header.n), "msg:" + pubHex, 64);
    session.nRecv = Math.max(session.nRecv, header.n + 1);
  }
  const aesKey = mk.slice(0, 32), nonce = mk.slice(32, 44);
  const keyObj = await crypto.subtle.importKey("raw", aesKey, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, keyObj, unb64(ciphertext));
  return dec.decode(pt);
}

/* ---------- yardımcılar ---------- */
function concat(arrays) {
  const total = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function jwkX(pubJwk) { return (pubJwk && pubJwk.x) ? pubJwk.x : ""; }

async function encryptBackup(dataObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const keyBits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, base, 352);
  const aesKey = keyBits.slice(0, 32), nonce = keyBits.slice(32, 44);
  const keyObj = await crypto.subtle.importKey("raw", aesKey, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, keyObj, enc.encode(JSON.stringify(dataObj)));
  return { salt: b64(salt), blob: b64(ct) };
}

async function decryptBackup(backup, password) {
  const salt = unb64(backup.salt);
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const keyBits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, base, 352);
  const aesKey = keyBits.slice(0, 32), nonce = keyBits.slice(32, 44);
  const keyObj = await crypto.subtle.importKey("raw", aesKey, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, keyObj, unb64(backup.blob));
  return JSON.parse(dec.decode(pt));
}

async function computeSafetyNumber(myKey, peerKey) {
  const k1 = typeof myKey === "string" ? myKey : JSON.stringify(myKey);
  const k2 = typeof peerKey === "string" ? peerKey : JSON.stringify(peerKey);
  const sorted = [k1, k2].sort().join("::");
  const hashBuf = await crypto.subtle.digest("SHA-512", enc.encode(sorted));
  const bytes = new Uint8Array(hashBuf);
  const chunks = [];
  for (let i = 0; i < 12; i++) {
    const slice = bytes.slice(i * 4, i * 4 + 4);
    const num = ((slice[0] << 24) | (slice[1] << 16) | (slice[2] << 8) | slice[3]) >>> 0;
    chunks.push(String(num % 100000).padStart(5, "0"));
  }
  return chunks;
}

// Yeni Eklenen Chat Oturumu Güvenlik Mantıkları
window.initChatEncryption = async function(peerPublicKey) {
   if(peerPublicKey){
      try{
         const EK = await genPair();
         currentChatSessionKey = await ecdh(EK.privJwk, peerPublicKey);
      }catch(e){
         console.warn('Geçici oturum anahtarı oluşturulamadı:', e);
      }
   }
}

window.exitChat = function() {
   currentChatSessionKey = null; // Ram üzerinden temizle
}

window.NabCrypto = {
  generateIdentity, generatePrekeyBatch, establishSession, acceptSession,
  ratchetSend, ratchetRecv, encryptBackup, decryptBackup, b64, unb64, jwkX,
  verifySignedPrekey, identityFingerprint, computeSafetyNumber,
};

window.NabCrypto.generateIdentityKey = window.NabCrypto.generateIdentity;
window.NabCrypto.x3dhInitiate = window.NabCrypto.establishSession;
window.NabCrypto.x3dhAccept = window.NabCrypto.acceptSession;
window.NabCrypto.ratchetEncrypt = window.NabCrypto.ratchetSend;
window.NabCrypto.ratchetDecrypt = window.NabCrypto.ratchetRecv;
window.NabCrypto.backupEncrypt = window.NabCrypto.encryptBackup;
window.NabCrypto.backupDecrypt = window.NabCrypto.decryptBackup;