"use strict";

(function attachIdentityBackup(root) {
  function backupError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validateIdentity(identity, userId) {
    if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
        identity.userId == null || !identity.identity?.privJwk ||
        !identity.identitySign?.privJwk || !identity.signedPrekey?.privJwk) {
      throw backupError("invalid_backup", "Cihazdaki anahtar yedeği eksik veya bozuk.");
    }
    if (identity.userId !== userId) {
      throw backupError("account_mismatch", "Bu cihazdaki anahtar yedeği başka bir hesaba ait.");
    }
    return identity;
  }

  async function unlock(saved, passwords, userId, decryptBackup) {
    if (saved == null) return { identity: null, password: null };
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      throw backupError("invalid_backup", "Cihazdaki anahtar yedeği okunamıyor.");
    }

    if (saved.encrypted !== true) {
      return { identity: validateIdentity(saved, userId), password: null };
    }

    const backup = saved.backup;
    if (!backup || typeof backup !== "object" ||
        typeof backup.salt !== "string" || !backup.salt ||
        typeof backup.blob !== "string" || !backup.blob) {
      throw backupError("invalid_backup", "Cihazdaki anahtar yedeği eksik veya bozuk.");
    }

    const candidates = [...new Set((Array.isArray(passwords) ? passwords : [passwords])
      .filter((password) => typeof password === "string"))];
    if (!candidates.length) {
      throw backupError("password_required", "Anahtar yedeği parolasını gir.");
    }

    let decryptionFailed = false;
    for (const password of candidates) {
      let identity;
      try {
        identity = await decryptBackup(backup, password);
      } catch {
        decryptionFailed = true;
        continue;
      }
      return { identity: validateIdentity(identity, userId), password };
    }

    if (decryptionFailed) {
      throw backupError("decrypt_failed", "Anahtar yedeği bu parolayla açılamadı.");
    }
    throw backupError("invalid_backup", "Cihazdaki anahtar yedeği eksik veya bozuk.");
  }

  /**
   * Birden fazla yuva adayını sırayla dener.
   *
   * - "account_mismatch": aday başka bir hesaba ait. Bu aday atlanır ve SİLİNMEZ;
   *   başka hesabın yedeği bozulmaz.
   * - Hesabın kendi yuvasındaki hata yetkilidir ve kullanıcıya gösterilir.
   * - Eski tek yuvadaki hata yalnızca bilgilendiricidir; bu hesap için yedek
   *   yok sonucuna dönüşür (başka hesabın yedeği olabilir).
   *
   * Dönüş: { identity, password, slot, saved } — identity null ise bu cihazda
   * bu hesap için kullanılabilir yedek yoktur.
   */
  async function unlockCandidates(candidates, passwords, userId, decryptBackup) {
    if (!Array.isArray(candidates) || !candidates.length) {
      return { identity: null, password: null, slot: null, saved: null };
    }
    let accountError = null;
    let legacyError = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const saved = candidate.saved !== undefined ? candidate.saved : candidate;
      const slot = candidate.slot || null;
      try {
        const unlocked = await unlock(saved, passwords, userId, decryptBackup);
        return { ...unlocked, slot, saved };
      } catch (error) {
        if (slot === "account") {
          if (!accountError) accountError = error;
        } else if (!legacyError) {
          legacyError = error;
        }
      }
    }
    if (accountError) throw accountError;
    if (legacyError && legacyError.code === "account_mismatch") {
      // Eski tek yuva başka bir hesaba ait: bu hesap için yedek bulunamadı.
      return { identity: null, password: null, slot: null, saved: null, reason: "account_mismatch" };
    }
    if (legacyError) throw legacyError;
    return { identity: null, password: null, slot: null, saved: null };
  }

  const api = { unlock, unlockCandidates };
  root.NabIdentityBackup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
