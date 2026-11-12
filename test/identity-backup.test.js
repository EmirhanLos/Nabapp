"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const webcrypto = require("node:crypto").webcrypto;

const { unlockCandidates } = require("../public/identity-backup.js");

const context = vm.createContext({
  window: {},
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
});
vm.runInContext(fs.readFileSync(require.resolve("../public/crypto.js"), "utf8"), context);
const { encryptBackup, decryptBackup } = context.window.NabCrypto;

const identityOf = (userId) => ({
  userId,
  identity: { privJwk: "priv", pubJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } },
  identitySign: { privJwk: "sign-priv", pubJwk: { kty: "EC", crv: "P-256", x: "sx", y: "sy" } },
  signedPrekey: { privJwk: "sp-priv", pubJwk: { kty: "EC", crv: "P-256", x: "px", y: "py" } },
  signedPrekeySig: "sig",
});

async function encryptedSlot(userId, password = "hesap-parolasi") {
  const backup = await encryptBackup(identityOf(userId), password);
  return { encrypted: true, backup };
}

test("hesabın kendi yuvası eski tek yuvadan önce kullanılır", async () => {
  const account = await encryptedSlot(1);
  const legacy = await encryptedSlot(2);
  const unlocked = await unlockCandidates(
    [{ slot: "account", saved: account }, { slot: "legacy", saved: legacy }],
    ["hesap-parolasi"], 1, decryptBackup
  );
  assert.equal(unlocked.identity.userId, 1);
  assert.equal(unlocked.slot, "account");
});

test("başka hesaba ait eski yuva atlanır ve yedek silinmez", async () => {
  const legacy = await encryptedSlot(2);
  const before = JSON.parse(JSON.stringify(legacy.backup));
  const unlocked = await unlockCandidates(
    [{ slot: "legacy", saved: legacy }], ["hesap-parolasi"], 1, decryptBackup
  );
  assert.equal(unlocked.identity, null);
  assert.equal(unlocked.reason, "account_mismatch");
  assert.equal(JSON.stringify(legacy.backup), JSON.stringify(before), "başka hesabın yedeği bozulmadı");
});

test("hesabın kendi yuvasında parola hatası kullanıcıya bildirilir", async () => {
  const account = await encryptedSlot(1);
  await assert.rejects(
    unlockCandidates([{ slot: "account", saved: account }], ["yanlis-parola"], 1, decryptBackup),
    (error) => error.code === "decrypt_failed"
  );
});

test("eski tek yuvadaki yedek sahibinin hesabında açılır", async () => {
  const legacy = await encryptedSlot(1);
  const unlocked = await unlockCandidates(
    [{ slot: "legacy", saved: legacy }], ["hesap-parolasi"], 1, decryptBackup
  );
  assert.equal(unlocked.identity.userId, 1);
  assert.equal(unlocked.slot, "legacy");
  assert.equal(unlocked.saved.backup.blob, legacy.backup.blob);
});

test("aday yoksa anahtar yok sonucu döner", async () => {
  const unlocked = await unlockCandidates([], ["hesap-parolasi"], 1, decryptBackup);
  assert.equal(unlocked.identity, null);
  assert.equal(unlocked.password, null);
});
