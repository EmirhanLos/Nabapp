"use strict";

require("dotenv/config");

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY || "";
if (!/^[\da-f]{64}$/i.test(encryptionKey)) {
  throw new Error("BACKUP_ENCRYPTION_KEY 64 karakterlik hex anahtar olmalı.");
}

const backupDir = process.env.NABAPP_BACKUP_DIR ||
  path.join(process.env.NABAPP_DATA_DIR || "E:\\nabapp-data", "backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(backupDir, `nabapp-${timestamp}.db.enc`);
const temporaryDb = path.join(backupDir, `.nabapp-${process.pid}.db.tmp`);

async function createBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  try {
    await db.backup(temporaryDb);
    const plaintext = fs.readFileSync(temporaryDb);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const backup = Buffer.concat([Buffer.from("NABAPP1"), iv, cipher.getAuthTag(), ciphertext]);
    fs.writeFileSync(backupFile, backup, { flag: "wx", mode: 0o600 });

    const retentionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(backupDir)) {
      if (!/^nabapp-.*\.db\.enc$/.test(name)) continue;
      const file = path.join(backupDir, name);
      if (fs.statSync(file).mtimeMs < retentionCutoff) fs.unlinkSync(file);
    }
    console.log(`Encrypted backup created: ${backupFile}`);
  } finally {
    if (fs.existsSync(temporaryDb)) fs.unlinkSync(temporaryDb);
    db.close();
  }
}

createBackup().catch((err) => {
  console.error("[backup] Backup failed:", err.message);
  process.exitCode = 1;
});
