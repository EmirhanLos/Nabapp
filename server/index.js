/**
 * Nabapp sunucu giriş noktası.
 * Çalıştırma:  npm install && npm start   →  http://localhost:3000
 */
"use strict";

require("dotenv/config");

const path = require("path");
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const compression = require("compression");
const swaggerUi = require("swagger-ui-express");
const { WebSocketServer } = require("ws");
const openapi = require("./openapi.json");
const { router } = require("./routes");
const wsLayer = require("./ws");
const db = require("./db");
const { SMS_PROVIDER } = require("./sms");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  // Sıkılaştırılmış güvenlik başlıkları
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
  permissionsPolicy: {
    features: {
      geolocation: ["'self'"],
      payment: ["'none'"],
      usb: ["'none'"],
      camera: ["'self'"],
      microphone: ["'self'"],
    },
  },
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  let sameOrigin = false;
  try { sameOrigin = new URL(origin).host === req.headers.host; } catch {}
  const allowed = allowedOrigins.length ? allowedOrigins.includes(origin) : sameOrigin;
  if (!allowed) return res.status(403).json({ error: "Bu origin için erişime izin verilmiyor." });
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Nab-Device");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(compression());
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    if (req.body === undefined) req.body = {};
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "İstek gövdesi bir JSON nesnesi olmalı." });
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: 0 }));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Nabapp API" }));

app.use("/api", router);
app.use("/api/v1", router);

// Hata yakalayıcı
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    level: "error",
    message: "API request failed",
    method: req.method,
    route: req.route ? req.route.path : "unmatched",
    error: err.message,
    timestamp: new Date().toISOString(),
  }));
  res.status(500).json({ error: "Sunucu hatası." });
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 8 * 1024 * 1024,
  verifyClient: ({ origin, req }, done) => {
    if (!origin) return done(true);
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch {}
    const allowed = allowedOrigins.length ? allowedOrigins.includes(origin) : sameOrigin;
    done(allowed, 403, "Origin not allowed");
  },
});
wsLayer.attach(wss);
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV === "production" && (!process.env.NABAPP_SECRET || process.env.NABAPP_SECRET.length < 32)) {
  throw new Error("Üretim ortamında en az 32 karakterlik NABAPP_SECRET zorunludur.");
}
if (process.env.NODE_ENV === "production" &&
    (SMS_PROVIDER !== "netgsm" || !process.env.NETGSM_USERCODE || !process.env.NETGSM_PASSWORD || !process.env.NETGSM_HEADER)) {
  throw new Error("Üretimde SMS için NABAPP_SMS_PROVIDER=netgsm ve Netgsm kimlik bilgileri zorunludur.");
}
server.listen(PORT, () => {
  console.log(`\n  Nabapp sunucusu çalışıyor  →  http://localhost:${PORT}`);
  if (SMS_PROVIDER === "netgsm") {
    console.log("  SMS modu: Netgsm (gerçek gönderim etkin).\n");
  } else {
    console.log("  SMS modu: geliştirme — doğrulama kodları konsola yazılır.");
    console.log("  Gerçek SMS için NABAPP_SMS_PROVIDER=netgsm ve Netgsm bilgilerini .env dosyasına ekleyin.\n");
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} alındı; bağlantılar kapatılıyor.`);
  for (const client of wss.clients) client.close(1001, "Sunucu kapanıyor");
  wss.close();
  server.close((err) => {
    if (err) {
      console.error("[server] HTTP sunucusu kapatılamadı:", err.message);
      process.exitCode = 1;
    }
    db.close();
  });
  setTimeout(() => {
    console.error("[server] Kapanma zaman aşımına uğradı.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
