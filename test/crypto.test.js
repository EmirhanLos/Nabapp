"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const webcrypto = require("node:crypto").webcrypto;

const context = vm.createContext({
  window: {},
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
});
vm.runInContext(fs.readFileSync(require.resolve("../public/crypto.js"), "utf8"), context);
const NabCrypto = context.window.NabCrypto;

test("X3DH and ratchet exchange decrypt in both directions", async () => {
  const alice = await NabCrypto.generateIdentity();
  const bob = await NabCrypto.generateIdentity();
  const oneTimeKeys = await NabCrypto.generatePrekeyBatch(1, 1);
  const initiated = await NabCrypto.establishSession({
    identityPub: bob.identity.pubJwk,
    identitySignPub: bob.identitySign.pubJwk,
    signedPrekeyPub: bob.signedPrekey.pubJwk,
    signedPrekeySig: bob.signedPrekeySig,
    oneTimePrekey: { keyId: oneTimeKeys[0].keyId, publicKey: oneTimeKeys[0].publicKey },
  }, alice.identity);

  const first = await NabCrypto.ratchetSend(initiated.session, "hello");
  const firstHeader = {
    ...first.header,
    ephemeralPub: initiated.setup.ephemeralPub,
    identityPub: alice.identity.pubJwk,
    identitySignPub: alice.identitySign.pubJwk,
    signedPrekeyPub: alice.signedPrekey.pubJwk,
    signedPrekeySig: alice.signedPrekeySig,
    oneTimeKeyId: initiated.setup.oneTimeKeyId,
  };
  const accepted = await NabCrypto.acceptSession(
    firstHeader, bob.identity, bob.signedPrekey.privJwk, oneTimeKeys[0].privateKey
  );
  assert.equal(await NabCrypto.ratchetRecv(accepted.session, firstHeader, first.ciphertext), "hello");

  const reply = await NabCrypto.ratchetSend(accepted.session, "reply");
  assert.equal(await NabCrypto.ratchetRecv(initiated.session, reply.header, reply.ciphertext), "reply");
});

test("signed prekeys reject tampering and identity fingerprints are stable", async () => {
  const identity = await NabCrypto.generateIdentity();
  const bundle = {
    identitySignPub: identity.identitySign.pubJwk,
    signedPrekeyPub: identity.signedPrekey.pubJwk,
    signedPrekeySig: identity.signedPrekeySig,
  };
  assert.equal(await NabCrypto.verifySignedPrekey(bundle), true);
  const fingerprint = await NabCrypto.identityFingerprint(identity.identity.pubJwk, identity.identitySign.pubJwk);
  assert.equal(fingerprint, await NabCrypto.identityFingerprint(identity.identity.pubJwk, identity.identitySign.pubJwk));
  await assert.rejects(NabCrypto.verifySignedPrekey({
    ...bundle,
    signedPrekeyPub: (await NabCrypto.generateIdentity()).signedPrekey.pubJwk,
  }), /imzası geçersiz/);
});

test("password-protected key backup round-trips and rejects a wrong password", async () => {
  const backup = await NabCrypto.encryptBackup({ secret: "private-key-material" }, "correct horse");
  assert.equal((await NabCrypto.decryptBackup(backup, "correct horse")).secret, "private-key-material");
  await assert.rejects(NabCrypto.decryptBackup(backup, "wrong password"));
});
