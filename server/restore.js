"use strict";

require("dotenv/config");

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const backupFile = process.argv[2];
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY || "";
if (process.env.NABAPP_RESTORE_CONFIRM !== "YES") {
  throw new Error("Geri yüklemeyi onaylamak için NABAPP_RESTORE_CONFIRM=YES ayarlayın.");
}
if (!backupFile) throw new Error("Kullanım: npm run restore -- <encrypted-backup-file>");
if (!/^[\da-f]{64}$/i.test(encryptionKey)) {
  throw new Error("BACKUP_ENCRYPTION_KEY 64 karakterlik hex anahtar olmalı.");
}

const dataDir = process.env.NABAPP_DATA_DIR || "E:\\nabapp-data";
const databaseFile = path.join(dataDir, "nabapp.db");
const temporaryFile = `${databaseFile}.${process.pid}.restore.tmp`;
const previousFile = path.join(
  dataDir,
  `nabapp-pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db.enc`
);
const ivOffset = 7;
const tagOffset = ivOffset + 12;

function encrypt(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from("NABAPP1"), iv, cipher.getAuthTag(), ciphertext]);
}

function restore() {
  const contents = fs.readFileSync(path.resolve(backupFile));
  if (contents.length < tagOffset + 16 || contents.subarray(0, 7).toString() !== "NABAPP1") {
    throw new Error("Yedek dosyası biçimi tanınmıyor veya bozuk.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encryptionKey, "hex"),
    contents.subarray(ivOffset, tagOffset)
  );
  decipher.setAuthTag(contents.subarray(tagOffset, tagOffset + 16));
  const decrypted = Buffer.concat([
    decipher.update(contents.subarray(tagOffset + 16)),
    decipher.final(),
  ]);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(temporaryFile, decrypted, { flag: "wx", mode: 0o600 });

  const checkDb = new Database(temporaryFile, { readonly: true });
  let integrity;
  try { integrity = checkDb.pragma("integrity_check", { simple: true }); }
  finally { checkDb.close(); }
  if (integrity !== "ok") {
    fs.unlinkSync(temporaryFile);
    throw new Error(`Yedek bütünlük kontrolünü geçemedi: ${integrity}`);
  }

  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = databaseFile + suffix;
    if (fs.existsSync(sidecar) && fs.statSync(sidecar).size > 0) {
      fs.unlinkSync(temporaryFile);
      throw new Error(`Etkin SQLite ${suffix} dosyası bulundu; sunucuyu durdurup tekrar deneyin.`);
    }
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  let movedPrevious = false;
  try {
    if (fs.existsSync(databaseFile)) {
      fs.writeFileSync(previousFile, encrypt(fs.readFileSync(databaseFile)), { flag: "wx", mode: 0o600 });
      fs.renameSync(databaseFile, `${databaseFile}.${process.pid}.previous`);
      movedPrevious = true;
    }
    fs.renameSync(temporaryFile, databaseFile);
    if (movedPrevious) fs.unlinkSync(`${databaseFile}.${process.pid}.previous`);
  } catch (err) {
    if (movedPrevious && !fs.existsSync(databaseFile)) {
      fs.renameSync(`${databaseFile}.${process.pid}.previous`, databaseFile);
    }
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw err;
  }
  console.log(`Database restored. Previous encrypted database retained at: ${movedPrevious ? previousFile : "(none)"}`);
}

try {
  restore();
} catch (err) {
  if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  console.error("[restore] Restore failed:", err.message);
  process.exitCode = 1;
}
