"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const webcrypto = require("node:crypto").webcrypto;
const { createAccountStorage } = require("../public/account-storage.js");
const { unlockCandidates } = require("../public/identity-backup.js");

const context = vm.createContext({ window: {}, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob });
vm.runInContext(fs.readFileSync(require.resolve("../public/crypto.js"), "utf8"), context);
const { encryptBackup, decryptBackup } = context.window.NabCrypto;

/** localStorage/sessionStorage davranışını taklit eden bellek içi depo. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

/** Aynı tarayıcı profilini (localStorage) ve bir sekmeyi (sessionStorage) temsil eder. */
function createProfile() {
  const local = new MemoryStorage();
  const openTab = () => createAccountStorage({ local, session: new MemoryStorage() });
  return { local, openTab };
}

test("aynı profilde iki hesap oturum ve anahtar yedeğini birbirine dokunmaz", () => {
  const { openTab } = createProfile();
  const tab = openTab();

  tab.writeToken("+905336619749", "token-a");
  tab.writeToken("+12025550102", "token-b");
  assert.equal(tab.readToken("+905336619749"), "token-a");
  assert.equal(tab.readToken("+12025550102"), "token-b");

  tab.writeIdentity(1, { encrypted: true, backup: { salt: "s1", blob: "b1" } });
  tab.writeIdentity(2, { encrypted: true, backup: { salt: "s2", blob: "b2" } });
  assert.deepEqual(tab.readIdentity(1).backup, { salt: "s1", blob: "b1" });
  assert.deepEqual(tab.readIdentity(2).backup, { salt: "s2", blob: "b2" });

  // Bir hesabın oturumu kapatıldığında diğer hesap etkilenmez.
  tab.removeToken("+905336619749");
  assert.equal(tab.readToken("+905336619749"), null);
  assert.equal(tab.readToken("+12025550102"), "token-b");
});

test("iki sekme aynı profilde ayrı hesapların oturumunu kullanır", () => {
  const { openTab } = createProfile();
  const tabOne = openTab();
  const tabTwo = openTab();

  tabOne.writeToken("+905336619749", "token-a");
  tabTwo.writeToken("+12025550102", "token-b");

  assert.equal(tabOne.currentToken(), "token-a");
  assert.equal(tabTwo.currentToken(), "token-b");
  assert.equal(tabOne.tabAccount(), "+905336619749");
  assert.equal(tabTwo.tabAccount(), "+12025550102");
});

test("eski tek oturum yuvası hesabın yuvasına taşınır", () => {
  const { local, openTab } = createProfile();
  const tab = openTab();
  local.setItem("nabapp-token", "legacy-token");

  assert.equal(tab.currentToken(), "legacy-token");
  tab.adoptLegacyToken("+905336619749", "legacy-token");

  assert.equal(tab.readToken("+905336619749"), "legacy-token");
  assert.equal(local.getItem("nabapp-token"), null);
  assert.equal(tab.currentToken(), "legacy-token");
});

test("hesaba bağlı olmayan sekme eski yuvadaki oturumu kullanmaz", () => {
  const { local, openTab } = createProfile();
  const tab = openTab();
  local.setItem("nabapp-token", "legacy-token");
  tab.writeToken("+12025550102", "token-b");

  // Bağlı hesabın oturumu varsa eski yuvadaki başka hesabın belirteci kullanılmaz.
  assert.equal(tab.currentToken(), "token-b");
});

test("eski tek anahtar yuvası yalnızca sahibi için aday olarak sunulur", () => {
  const { local, openTab } = createProfile();
  const tab = openTab();
  local.setItem("nabapp-identity", JSON.stringify({ encrypted: true, backup: { salt: "s", blob: "b" } }));

  const candidates = tab.identityCandidates(1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].slot, "legacy");
  assert.equal(tab.readIdentity(1), null, "hesap yuvası henüz oluşmadı");
});

test("hesap yuvası varsa eski yuva ikinci aday olmaz", () => {
  const { local, openTab } = createProfile();
  const tab = openTab();
  tab.writeIdentity(1, { encrypted: true, backup: { salt: "s1", blob: "b1" } });
  local.setItem("nabapp-identity", JSON.stringify({ encrypted: true, backup: { salt: "s2", blob: "b2" } }));

  const candidates = tab.identityCandidates(1);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].slot, "account");
  assert.equal(candidates[1].slot, "legacy");
});

test("doğrulanmış kişi anahtarları hesaba özeldir", () => {
  const { openTab } = createProfile();
  const tab = openTab();
  tab.writeTrustedKeys(1, { "+12025550102": { fingerprint: "aaaa" } });
  tab.writeTrustedKeys(2, { "+12025550102": { fingerprint: "bbbb" } });

  assert.equal(tab.readTrustedKeys(1)["+12025550102"].fingerprint, "aaaa");
  assert.equal(tab.readTrustedKeys(2)["+12025550102"].fingerprint, "bbbb");
});

/* ---------- bildirilen hatanın regresyon testi ---------- */

const identityOf = (userId) => ({
  userId,
  identity: { privJwk: "priv", pubJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } },
  identitySign: { privJwk: "sign-priv", pubJwk: { kty: "EC", crv: "P-256", x: "sx", y: "sy" } },
  signedPrekey: { privJwk: "sp-priv", pubJwk: { kty: "EC", crv: "P-256", x: "px", y: "py" } },
  signedPrekeySig: "sig",
});

test("aynı profilde ikinci hesap kaydolduğunda ilk hesabın anahtarları korunur", async () => {
  const { openTab } = createProfile();
  const tabA = openTab();
  const tabB = openTab();

  // Hesap A kaydolur: anahtar yedeği A'nın kendi yuvasına yazılır.
  const backupA = await encryptBackup(identityOf(1), "parola-a");
  tabA.writeIdentity(1, { encrypted: true, backup: backupA });
  tabA.writeToken("+12025550101", "token-a");

  // Aynı tarayıcı profilinde ikinci hesap kaydolur (eski hata senaryosu).
  const backupB = await encryptBackup(identityOf(2), "parola-b");
  tabB.writeIdentity(2, { encrypted: true, backup: backupB });
  tabB.writeToken("+12025550102", "token-b");

  // A'nın yedeği bozulmamış olmalı.
  assert.equal(JSON.stringify(tabA.readIdentity(1).backup), JSON.stringify(backupA));

  // A yeniden başlatıldığında (Store.init) anahtarı açılabilmeli.
  const unlocked = await unlockCandidates(
    tabA.identityCandidates(1), ["parola-a"], 1, decryptBackup
  );
  assert.equal(unlocked.identity.userId, 1);
});

test("hesap değiştirildiğinde diğer hesabın anahtarları yerinde kalır", async () => {
  const { openTab } = createProfile();
  const tab = openTab();

  // Hesap A kaydolur.
  const backupA = await encryptBackup(identityOf(1), "parola-a");
  tab.writeIdentity(1, { encrypted: true, backup: backupA });
  tab.writeToken("+12025550101", "token-a");

  // Aynı tarayıcıda hesap B'ye geçilir (bir tarayıcıda tek hesap açık kuralı).
  const backupB = await encryptBackup(identityOf(2), "parola-b");
  tab.writeIdentity(2, { encrypted: true, backup: backupB });
  tab.writeToken("+12025550102", "token-b");
  assert.equal(tab.currentToken(), "token-b");

  // Hesap A'ya geri dönülür: oturum ve anahtarlar yerinde.
  tab.bindAccount("+12025550101");
  assert.equal(tab.currentToken(), "token-a");
  const unlocked = await unlockCandidates(
    tab.identityCandidates(1), ["parola-a"], 1, decryptBackup
  );
  assert.equal(unlocked.identity.userId, 1);
  assert.equal(JSON.stringify(tab.readIdentity(2).backup), JSON.stringify(backupB));
});

test("sürüm öncesi tek yuvadaki yedek sahibinin hesabına taşınır", async () => {  const { local, openTab } = createProfile();
  const tab = openTab();
  const backup = await encryptBackup(identityOf(1), "parola-a");
  local.setItem("nabapp-identity", JSON.stringify({ encrypted: true, backup }));

  const unlocked = await unlockCandidates(
    tab.identityCandidates(1), ["parola-a"], 1, decryptBackup
  );
  assert.equal(unlocked.identity.userId, 1);
  assert.equal(unlocked.slot, "legacy");

  // Hesabın kendi yuvasına kopyalanır (uygulamanın yaptığı taşıma).
  tab.writeIdentity(1, unlocked.saved);
  assert.equal(JSON.stringify(tab.readIdentity(1).backup), JSON.stringify(backup));

  // Taşımadan sonra da yedek açılabilir olmalı.
  const again = await unlockCandidates(
    tab.identityCandidates(1), ["parola-a"], 1, decryptBackup
  );
  assert.equal(again.identity.userId, 1);
});
