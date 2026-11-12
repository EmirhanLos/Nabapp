"use strict";

const https = require("https");
const nodemailer = require("nodemailer");

const PROVIDER = process.env.NABAPP_SMS_PROVIDER || "dev";
const SMS_TEMPLATE = process.env.SMS_VERIFICATION_TEMPLATE ||
  "Nabapp doğrulama kodunuz: {code}. Kod 5 dakika geçerlidir. Güvenliğiniz için bu kodu kimseyle paylaşmayın.";
const EMAIL_SUBJECT = process.env.EMAIL_VERIFICATION_SUBJECT || "Nabapp e-posta doğrulama kodunuz";
const EMAIL_TEMPLATE = process.env.EMAIL_VERIFICATION_TEMPLATE ||
  "Merhaba,\n\nNabapp hesabınızı doğrulamak için kodunuz: {code}\nBu kod 5 dakika geçerlidir. Güvenliğiniz için kodunuzu kimseyle paylaşmayın.\n\nBu isteği siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.";

function formatCodeMessage(template, code) {
  return template.replaceAll("{code}", code);
}

function sendViaNetgsm(phone, message) {
  const usercode = process.env.NETGSM_USERCODE;
  const password = process.env.NETGSM_PASSWORD;
  const msgheader = process.env.NETGSM_HEADER;
  if (!usercode || !password || !msgheader) {
    return Promise.reject(new Error("Netgsm ayarları eksik (NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER)."));
  }

  const payload = JSON.stringify({
    msgheader,
    messages: [{ msg: message, no: phone.replace(/\D/g, "") }],
    encoding: "TR",
  });
  const auth = Buffer.from(`${usercode}:${password}`).toString("base64");

  return new Promise((resolve, reject) => {
    const req = https.request("https://api.netgsm.com.tr/sms/rest/v2/send", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Netgsm HTTP ${res.statusCode}`));
        }
        let result;
        try {
          result = JSON.parse(data);
        } catch {
          return reject(new Error("Netgsm geçersiz yanıt döndürdü."));
        }
        if (result.code !== "00") {
          return reject(new Error(`Netgsm SMS gönderimini kabul etmedi (${String(result.code || "bilinmeyen yanıt")}).`));
        }
        resolve(result);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Netgsm isteği zaman aşımına uğradı.")));
    req.end(payload);
  });
}

async function sendSmsCode(phone, code) {
  const message = formatCodeMessage(SMS_TEMPLATE, code);
  if (PROVIDER !== "netgsm") {
    // Geçici geliştirme modu: gerçek SMS sağlayıcısı yapılandırılana kadar
    // doğrulama kodu yalnızca sunucu konsoluna yazılır (HTTP yanıtına asla eklenmez).
    console.log(`[sms][dev] ${phone} → doğrulama kodu: ${code} (5 dk geçerli)`);
    return { delivered: true, dev: true };
  }
  try {
    await sendViaNetgsm(phone, message);
    return { delivered: true };
  } catch (err) {
    console.error("[sms] Netgsm gönderimi başarısız:", err.message);
    return { delivered: false };
  }
}

async function sendEmailCode(email, code) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    // Geçici geliştirme modu: SMTP yapılandırılana kadar doğrulama kodu
    // yalnızca sunucu konsoluna yazılır (HTTP yanıtına asla eklenmez).
    console.log(`[email][dev] ${email} → doğrulama kodu: ${code} (5 dk geçerli)`);
    return { delivered: true, dev: true };
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to: email,
      subject: EMAIL_SUBJECT,
      text: formatCodeMessage(EMAIL_TEMPLATE, code),
    });
    return { delivered: true };
  } catch (err) {
    console.error("[email] SMTP hatası:", err.message);
    return { delivered: false };
  }
}

module.exports = {
  sendSmsCode,
  sendEmailCode,
  SMS_PROVIDER: PROVIDER,
  formatCodeMessage,
};
