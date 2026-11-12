"use strict";

/**
 * Nabapp IndexedDB Depolama Modülü (AppDB)
 * localStorage'ın 5MB kotasını aşan, sesli mesajları, dosyaları ve
 * sınırsız sohbet geçmişini güvenle yerel cihazda saklayan modern veritabanı.
 */
(() => {
  const DB_NAME = "nabapp_v2";
  const DB_VERSION = 1;
  let dbInstance = null;

  const openDB = () => {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("messages")) {
          const messageStore = db.createObjectStore("messages", { keyPath: "id" });
          messageStore.createIndex("chatId", "chatId", { unique: false });
          messageStore.createIndex("ts", "ts", { unique: false });
        }
        if (!db.objectStoreNames.contains("offlineQueue")) {
          db.createObjectStore("offlineQueue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("safetyVerifications")) {
          db.createObjectStore("safetyVerifications", { keyPath: "phone" });
        }
        if (!db.objectStoreNames.contains("appKV")) {
          db.createObjectStore("appKV", { keyPath: "key" });
        }
      };
      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  };

  const AppDB = {
    async init() {
      return openDB();
    },

    async saveMessage(chatId, message) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        const item = { ...message, chatId, id: String(message.id) };
        const req = store.put(item);
        req.onsuccess = () => resolve(item);
        req.onerror = () => reject(req.error);
      });
    },

    async getMessages(chatId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readonly");
        const store = tx.objectStore("messages");
        const index = store.index("chatId");
        const req = index.getAll(IDBKeyRange.only(chatId));
        req.onsuccess = () => {
          const messages = req.result || [];
          messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
          resolve(messages);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async updateMessage(msgId, updates) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        const getReq = store.get(String(msgId));
        getReq.onsuccess = () => {
          const item = getReq.result;
          if (!item) return resolve(null);
          const updated = { ...item, ...updates };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve(updated);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    },

    async searchMessages(chatId, query) {
      const messages = await this.getMessages(chatId);
      const q = String(query || "").trim().toLocaleLowerCase("tr");
      if (!q) return [];
      return messages.filter((m) => {
        const text = String(m.text || "").toLocaleLowerCase("tr");
        const fileName = m.file?.name ? String(m.file.name).toLocaleLowerCase("tr") : "";
        return text.includes(q) || fileName.includes(q);
      });
    },

    async queueOfflineMessage(msg) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("offlineQueue", "readwrite");
        const store = tx.objectStore("offlineQueue");
        const item = { ...msg, id: String(msg.id || crypto.randomUUID()), queuedAt: Date.now() };
        const req = store.put(item);
        req.onsuccess = () => resolve(item);
        req.onerror = () => reject(req.error);
      });
    },

    async getQueuedMessages() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("offlineQueue", "readonly");
        const store = tx.objectStore("offlineQueue");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async removeQueuedMessage(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("offlineQueue", "readwrite");
        const store = tx.objectStore("offlineQueue");
        const req = store.delete(String(id));
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    async setSafetyVerified(phone, verified) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("safetyVerifications", "readwrite");
        const store = tx.objectStore("safetyVerifications");
        const req = store.put({ phone, verified: Boolean(verified), verifiedAt: Date.now() });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    async isSafetyVerified(phone) {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction("safetyVerifications", "readonly");
        const store = tx.objectStore("safetyVerifications");
        const req = store.get(phone);
        req.onsuccess = () => resolve(Boolean(req.result?.verified));
        req.onerror = () => resolve(false);
      });
    },

    async migrateFromLocalStorage(memoryMessages = {}) {
      try {
        const migratedKey = "nabapp_idb_migrated_v1";
        if (localStorage.getItem(migratedKey)) return;
        for (const [chatId, list] of Object.entries(memoryMessages)) {
          if (Array.isArray(list)) {
            for (const msg of list) {
              if (msg && msg.id) {
                await this.saveMessage(chatId, msg);
              }
            }
          }
        }
        localStorage.setItem(migratedKey, "1");
      } catch (err) {
        console.warn("[storage] localStorage migrasyon uyarısı:", err);
      }
    },
  };

  window.AppDB = AppDB;
})();
