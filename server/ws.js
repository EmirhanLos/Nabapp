/**
 * WebSocket katmanı — YALNIZCA P2P (WebRTC) sinyalleşmesi ve çevrimiçi durum bilgisi.
 * Sunucu SİNYAL dışında hiçbir şey taşımaz: mesajlar, dosyalar, fotoğraflar, ses
 * kayıtları, tepkiler ve okundu bilgileri doğrudan WebRTC DataChannel üzerinden
 * cihazdan cihaza akar. Sunucu hiçbir kullanıcı içeriğini saklamaz veya iletmez.
 */
"use strict";

const WebSocket = require("ws");
const db = require("./db");
const sec = require("./security");

/** phone(normalize) -> { userId, sockets:Set } */
const presence = new Map();
const activeSessions = new Map(); // Tek Oturum Kontrolü

function attach(wsServer) {
  const heartbeat = setInterval(() => {
    for (const ws of wsServer.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wsServer.on("close", () => clearInterval(heartbeat));

  wsServer.on("connection", async (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token") || "";
    const user = sec.sessionUser(token);
    if (!user) return ws.close(4001, "Yetkisiz");

    const phone = user.phone;

    // Tek oturum kontrolü - Eski bağlantıyı kapat
    if (activeSessions.has(user.id)) {
      const oldWs = activeSessions.get(user.id);
      if (oldWs.readyState === WebSocket.OPEN) oldWs.close(4009, "Başka bir cihazdan giriş yapıldı.");
    }
    activeSessions.set(user.id, ws);

    if (!presence.has(phone)) presence.set(phone, { userId: user.id, sockets: new Set() });
    const entry = presence.get(phone);
    entry.sockets.add(ws);
    ws.nabappPhone = phone;
    ws.isAlive = true;

    db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(Date.now(), user.id);
    broadcastPresence();

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", (err) => console.error("[ws] Bağlantı hatası:", err.message));
    ws.on("message", (raw) => {
      if (!sec.rateLimit(`ws:${user.id}`, 600, 60 * 1000)) {
        ws.close(4008, "Çok fazla WebSocket isteği");
        return;
      }
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
      const targetPhone = sec.normalizePhone(msg.to);
      const target = targetPhone ? presence.get(targetPhone) : null;
      switch (msg.type) {
        case "signal":
          if (target && targetPhone !== phone && msg.signal && typeof msg.signal === "object" &&
              validSignal(msg.signal, msg.callId) &&
              db.prepare(
                `SELECT 1 FROM contacts
                 WHERE (owner_id=? AND contact_user_id=?) OR (owner_id=? AND contact_user_id=?)`
              ).get(user.id, target.userId, target.userId, user.id)) {
            sendToMany(target.sockets, { type: "signal", from: phone, signal: msg.signal, callId: msg.callId });
          }
          break;
        case "ping":
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    });

    ws.on("close", () => {
      entry.sockets.delete(ws);
      if (activeSessions.get(user.id) === ws) {
          activeSessions.delete(user.id);
      }
      if (!entry.sockets.size) {
        db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(Date.now(), entry.userId);
        presence.delete(phone);
      }
      broadcastPresence();
    });
  });
}

function sendToMany(sockets, payload, ack) {
  let delivered = false;
  const data = JSON.stringify(payload);
  for (const s of sockets) if (s.readyState === WebSocket.OPEN) { s.send(data); delivered = true; }
  if (ack) ack(delivered);
}

function validSignal(signal, callId) {
  if (typeof callId !== "string" || callId.length > 64 ||
      !["offer", "answer", "candidate", "hangup"].includes(signal.type)) return false;
  if (signal.type === "offer" || signal.type === "answer") {
    return signal.description && typeof signal.description.sdp === "string" &&
      signal.description.sdp.length <= 100_000;
  }
  if (signal.type === "candidate") {
    return signal.candidate && typeof signal.candidate.candidate === "string" &&
      signal.candidate.candidate.length <= 4_000;
  }
  return true;
}

function broadcastPresence() {
  for (const entry of presence.values()) {
    const contacts = db.prepare(
      `SELECT u.phone, u.settings, u.last_seen AS lastSeen FROM contacts c
       JOIN users u ON u.id=c.contact_user_id WHERE c.owner_id=?`
    ).all(entry.userId);
    const online = [];
    const lastSeen = {};
    contacts.forEach((contact) => {
      try {
        if (JSON.parse(contact.settings || "{}").lastSeen !== true) return;
      } catch {
        return;
      }
      if (presence.has(contact.phone)) online.push(contact.phone);
      else if (Number.isFinite(contact.lastSeen) && contact.lastSeen > 0) lastSeen[contact.phone] = contact.lastSeen;
    });
    const data = JSON.stringify({ type: "presence", online, lastSeen });
    for (const s of entry.sockets) if (s.readyState === WebSocket.OPEN) s.send(data);
  }
}

module.exports = { attach, presence, broadcastPresence };