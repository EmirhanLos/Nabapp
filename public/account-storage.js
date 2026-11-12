/**
 * Nabapp — hesap bazlı oturum ve anahtar yedeği depolaması.
 *
 * Sorun: oturum belirteci (`nabapp-token`) ve şifreli anahtar yedeği
 * (`nabapp-identity`) tarayıcı profilinde TEK global yuvalarda tutuluyordu.
 * Aynı profilde ikinci bir hesaba kayıt olmak veya giriş yapmak, ilk hesabın
 * yedeğini sessizce siliyordu. Sonraki `Store.init()` çağrısında yedek "başka
 * hesaba ait" hatası veriyor, `Store.identity` null kalıyor ve mesaj gönderme
 * "şifreleme anahtarları yok" hatasıyla düşüyordu.
 *
 * Çözüm: her hesap kendi yuvasına sahiptir.
 *   nabapp-session-v2:<phone>   → { token }
 *   nabapp-identity-v2:<userId> → şifreli anahtar yedeği
 *   nabapp-trusted-v2:<userId>  → doğrulanmış kişi anahtarları (pinned)
 * Aktif hesap önce sekmeye (sessionStorage), sonra profile (localStorage)
 * bağlanır; böylece aynı tarayıcıda iki hesap birbirinin oturumunu veya
 * anahtar yedeğini ezmez.
 *
 * Eski tek yuvalar ilk kullanımda sahibinin hesap yuvasına taşınır; taşıma
 * yalnızca yedek çözüldüğünde ve `userId` eşleştiğinde yapılır, başka
 * hesaba ait yedekler silinmez.
 */
"use strict";

(function attachAccountStorage(root) {
  const SESSION_PREFIX = "nabapp-session-v2:";
  const IDENTITY_PREFIX = "nabapp-identity-v2:";
  const TRUSTED_PREFIX = "nabapp-trusted-v2:";
  const LEGACY_TOKEN_KEY = "nabapp-token";
  const LEGACY_IDENTITY_KEY = "nabapp-identity";
  const LEGACY_TRUSTED_KEY = "nabapp-trusted-keys-v1";
  const ACTIVE_ACCOUNT_KEY = "nabapp-active-account";
  const TAB_ACCOUNT_KEY = "nabapp-tab-account";

  function parse(raw) {
    if (typeof raw !== "string" || !raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function createAccountStorage({ local, session }) {
    if (!local || !session) throw new Error("accountStorage: local ve session deposu gerekli.");
    const readJson = (store, key) => parse(store.getItem(key));

    const api = {
      /* ---------- hesap bağı ---------- */
      tabAccount() { return session.getItem(TAB_ACCOUNT_KEY) || null; },
      activeAccount() { return api.tabAccount() || local.getItem(ACTIVE_ACCOUNT_KEY) || null; },
      bindAccount(phone) {
        if (!phone) return;
        session.setItem(TAB_ACCOUNT_KEY, phone);
        local.setItem(ACTIVE_ACCOUNT_KEY, phone);
      },
      unbindAccount(phone) {
        if (phone && api.activeAccount() !== phone) return;
        session.removeItem(TAB_ACCOUNT_KEY);
        local.removeItem(ACTIVE_ACCOUNT_KEY);
      },

      /* ---------- oturum belirteci ---------- */
      readToken(phone) {
        if (!phone) return null;
        const entry = readJson(local, SESSION_PREFIX + phone);
        return entry && typeof entry.token === "string" && entry.token ? entry.token : null;
      },
      writeToken(phone, token) {
        if (!phone || typeof token !== "string" || !token) return null;
        local.setItem(SESSION_PREFIX + phone, JSON.stringify({ token, updatedAt: Date.now() }));
        api.bindAccount(phone);
        return token;
      },
      removeToken(phone) {
        if (!phone) return;
        local.removeItem(SESSION_PREFIX + phone);
        if (api.activeAccount() === phone) api.unbindAccount(phone);
      },
      readLegacyToken() { return local.getItem(LEGACY_TOKEN_KEY) || null; },
      removeLegacyToken() { local.removeItem(LEGACY_TOKEN_KEY); },
      /** Bağlı hesabın belirteci; hesap bağlı değilse yalnızca eski tek yuva. */
      currentToken() {
        const phone = api.activeAccount();
        if (phone) return api.readToken(phone);
        return api.readLegacyToken();
      },
      /** Eski tek yuvadaki oturumu hesap yuvasına taşır (giriş/oturum geri yükleme). */
      adoptLegacyToken(phone, token) {
        if (!phone || !token) return null;
        if (!api.readToken(phone)) api.writeToken(phone, token);
        else api.bindAccount(phone);
        if (api.readLegacyToken() === token) local.removeItem(LEGACY_TOKEN_KEY);
        return api.readToken(phone);
      },

      /* ---------- şifreli anahtar yedeği ---------- */
      readIdentity(userId) {
        if (userId == null) return null;
        return readJson(local, IDENTITY_PREFIX + userId);
      },
      writeIdentity(userId, payload) {
        if (userId == null || !payload) return null;
        local.setItem(IDENTITY_PREFIX + userId, JSON.stringify(payload));
        return payload;
      },
      removeIdentity(userId) {
        if (userId != null) local.removeItem(IDENTITY_PREFIX + userId);
      },
      readLegacyIdentity() { return readJson(local, LEGACY_IDENTITY_KEY); },
      removeLegacyIdentity() { local.removeItem(LEGACY_IDENTITY_KEY); },
      /**
       * Açılacak yedek adayları, öncelik sırasıyla:
       *   1) hesaba ait yuva, 2) eski tek yuva (başka hesaba aitse dokunulmaz).
       */
      identityCandidates(userId) {
        const candidates = [];
        const own = api.readIdentity(userId);
        if (own) candidates.push({ slot: "account", saved: own });
        const legacy = api.readLegacyIdentity();
        if (legacy && (!own || JSON.stringify(legacy) !== JSON.stringify(own))) {
          candidates.push({ slot: "legacy", saved: legacy });
        }
        return candidates;
      },
      hasEncryptedIdentity(userId) {
        const own = api.readIdentity(userId);
        if (own) return Boolean(own.encrypted && own.backup);
        const legacy = api.readLegacyIdentity();
        return Boolean(legacy && legacy.encrypted && legacy.backup);
      },
      hasAnyEncryptedIdentity() {
        const legacy = api.readLegacyIdentity();
        if (legacy && legacy.encrypted && legacy.backup) return true;
        for (let index = 0; index < local.length; index += 1) {
          const key = local.key(index);
          if (!key || !key.startsWith(IDENTITY_PREFIX)) continue;
          const entry = readJson(local, key);
          if (entry && entry.encrypted && entry.backup) return true;
        }
        return false;
      },

      /* ---------- doğrulanmış kişi anahtarları ---------- */
      readTrustedKeys(userId) {
        if (userId == null) return {};
        const own = readJson(local, TRUSTED_PREFIX + userId);
        if (own && typeof own === "object") return own;
        const legacy = readJson(local, LEGACY_TRUSTED_KEY);
        return legacy && typeof legacy === "object" ? legacy : {};
      },
      writeTrustedKeys(userId, keys) {
        if (userId == null || !keys) return null;
        local.setItem(TRUSTED_PREFIX + userId, JSON.stringify(keys));
        return keys;
      },
      removeTrustedKeys(userId) {
        if (userId != null) local.removeItem(TRUSTED_PREFIX + userId);
      },

      /* ---------- tanılama ---------- */
      listAccounts() {
        const accounts = [];
        for (let index = 0; index < local.length; index += 1) {
          const key = local.key(index);
          if (!key || !key.startsWith(SESSION_PREFIX)) continue;
          accounts.push(key.slice(SESSION_PREFIX.length));
        }
        return accounts;
      },
      /** Bu cihazda anahtar yedeği saklanan hesap kimlikleri. */
      listIdentityAccounts() {
        const accounts = [];
        for (let index = 0; index < local.length; index += 1) {
          const key = local.key(index);
          if (!key || !key.startsWith(IDENTITY_PREFIX)) continue;
          accounts.push(key.slice(IDENTITY_PREFIX.length));
        }
        return accounts;
      },
    };

    return api;
  }

  const api = { createAccountStorage, SESSION_PREFIX, IDENTITY_PREFIX, TRUSTED_PREFIX };
  root.NabAccountStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
