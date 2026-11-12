"use strict";

(() => {
  const APP_PERMISSIONS_KEY = "nabapp-app-permissions-v1";
  const CHAT_SETTINGS_KEY = "nabapp-chat-settings-v1";
  const SCREEN_LOCK_KEY = "nabapp-screen-lock-v1";
  const SCREEN_LOCKED_KEY = "nabapp-screen-locked";
  const THEME_KEY = "nabapp-theme";
  const THEME_COLORS = { light: "#f4f0e8", dark: "#14120e" };
  const createScopedId = (kind, ownerId, peerId) => {
    const scope = [ownerId, peerId].map((value) => {
      const digits = String(value ?? "").replace(/\D/g, "");
      return digits ? BigInt(digits).toString(36) : "0";
    }).join("_");
    const random = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${kind}_${scope}_${random}`;
  };
  const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const readTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return prefersDark() ? "dark" : "light";
  };
  const applyTheme = (theme) => {
    const resolved = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolved);
    const meta = document.getElementById("meta-theme-color");
    if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
    return resolved;
  };
  const AccountStorage = window.NabAccountStorage.createAccountStorage({
    local: localStorage,
    session: sessionStorage,
  });
  const getToken = () => AccountStorage.currentToken();
  const setToken = (token, phone) => AccountStorage.writeToken(phone, token);
  const clearToken = () => {
    AccountStorage.removeToken(AccountStorage.activeAccount());
    AccountStorage.removeLegacyToken();
  };
  const hasEncryptedIdentityBackup = (userId) => AccountStorage.hasEncryptedIdentity(userId);
  const missingIdentityError = () => {
    const error = new Error("Bu cihazda bu hesabın şifreleme anahtarları yok. Ayarlar → ŞİFRELEME ANAHTARLARI bölümünden yedek dosyasını geri yükle.");
    error.code = "identity_missing";
    return error;
  };
  const byId = (id) => document.getElementById(id);
  const safeJson = (value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return null; }
  };
  const parseFilePayload = (value) => {
    const parsed = safeJson(value);
    if (!parsed || parsed.kind !== "file" || typeof parsed.name !== "string" ||
        typeof parsed.data !== "string" || parsed.data.length > 5_600_000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.data)) return null;
    return {
      name: parsed.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180),
      type: typeof parsed.type === "string" ? parsed.type.slice(0, 120) : "",
      data: parsed.data,
    };
  };
  const fileSignatureMatches = async (file, extension) => {
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const starts = (...signature) => signature.every((byte, index) => bytes[index] === byte);
    const ascii = (text, offset = 0) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    switch (extension) {
      case "png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
      case "jpg":
      case "jpeg": return starts(0xff, 0xd8, 0xff);
      case "gif": return ascii("GIF87a") || ascii("GIF89a");
      case "webp": return ascii("RIFF") && ascii("WEBP", 8);
      case "mp4": return ascii("ftyp", 4);
      case "webm": return starts(0x1a, 0x45, 0xdf, 0xa3);
      case "pdf": return ascii("%PDF-");
      case "zip":
      case "docx":
      case "xlsx":
      case "pptx": return starts(0x50, 0x4b, 0x03, 0x04);
      case "doc":
      case "xls":
      case "ppt": return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
      case "rtf": return ascii("{\\rtf");
      case "txt": return true;
      default: return false;
    }
  };
  const parseExpiringPayload = (value) => {
    const parsed = safeJson(value);
    if (!parsed || parsed.kind !== "ephemeral-message" || parsed.version !== 1 ||
        typeof parsed.text !== "string" || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= 0) return null;
    return { text: parsed.text, expiresAt: parsed.expiresAt };
  };
  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };
  const escapeInitials = (name = "") => {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2)).toLocaleUpperCase("tr");
  };
  const formatTime = (ts = Date.now()) => {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
  };
  const portraitSource = (seed, initials, color) => {
    const hue = (String(seed || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) * 47 + 212) % 360;
    const baseColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color : `hsl(${hue} 12% 34%)`;
    const text = String(initials || "?").replace(/[<>&]/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${baseColor}"/><stop offset="1" stop-color="hsl(${hue} 10% 12%)"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(%23g)"/><text x="48" y="50" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="'Instrument Sans', system-ui, sans-serif" font-weight="600" font-size="28">${text}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };
  const avatarSource = (user) => user.avatarUrl ||
    portraitSource(user.phone, escapeInitials(user.displayName), user.avatarColor);

  const UI = {
    _activeChatPhone: null,
    _currentPage: "chats",
    _toastTimer: null,
    _online: new Set(),
    _typing: new Set(),
    _searchTimer: null,
    _messageUrls: [],
    _messageExpiryTimer: null,
    _initialized: false,
    _chatLoadToken: 0,
    _screenLockTimer: null,
    _screenLockBound: false,
    elements: {},
    getAppPermissions() {
      try {
        const saved = JSON.parse(localStorage.getItem(APP_PERMISSIONS_KEY) || "{}");
        return {
          location: { enabled: saved.location?.enabled !== false, granted: saved.location?.granted },
          camera: { enabled: saved.camera?.enabled !== false, granted: saved.camera?.granted },
          files: { enabled: saved.files?.enabled !== false, granted: saved.files?.granted },
        };
      } catch {
        return {
          location: { enabled: true },
          camera: { enabled: true },
          files: { enabled: true },
        };
      }
    },
    setAppPermissions(permissions) {
      localStorage.setItem(APP_PERMISSIONS_KEY, JSON.stringify(permissions));
    },
    getChatSettings() {
      try { return JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) || "{}"); }
      catch { return {}; }
    },
    getChatDisappearing(chatId) {
      const value = this.getChatSettings()[chatId];
      return ["off", "30s", "1m", "1h"].includes(value) ? value : "off";
    },
    setChatDisappearing(chatId, value) {
      const settings = this.getChatSettings();
      settings[chatId] = value;
      localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(settings));
    },
    getSensitiveMessageRetentionWindow(chatId) {
      const map = { off: 0, "30s": 30_000, "1m": 60_000, "1h": 3_600_000 };
      return map[this.getChatDisappearing(chatId)] || 0;
    },
    async requestAppPermission(kind) {
      const permissions = this.getAppPermissions();
      const permission = permissions[kind];
      if (!permission || !permission.enabled) {
        this.showToast(`${kind === "location" ? "Konum" : kind === "camera" ? "Kamera" : "Dosya"} izni ayarlardan kapalı.`);
        return false;
      }
      if (permission.granted === undefined) {
        const label = kind === "location" ? "konumunu paylaşmak" : kind === "camera" ? "kamerayı kullanmak" : "dosya seçmek";
        const accepted = window.confirm(`Nabapp ${label} için izin istiyor. Seçimin bu cihazda saklanır. İzin verilsin mi?`);
        permissions[kind] = { ...permission, granted: accepted };
        this.setAppPermissions(permissions);
      }
      if (!permissions[kind].granted) {
        this.showToast("İzin verilmedi. İzni yeniden istemek için Ayarlar bölümünden kapatıp açın.");
        return false;
      }
      return true;
    },
    async showIncomingNotification(title, body) {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const options = { body, icon: "/icon.svg", badge: "/icon.svg", tag: "nabapp-message", renotify: true };
      const registration = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration()
        : null;
      if (registration) await registration.showNotification(title, options);
      else new Notification(title, options);
    },
    getSecurityState() {
      const savedLockTimeout = localStorage.getItem(SCREEN_LOCK_KEY);
      const configuredLock = savedLockTimeout === null ? "5m" : ({
        "0": "off",
        "300000": "5m",
        "600000": "10m",
        "1800000": "30m",
      }[savedLockTimeout] || "5m");
      const defaults = {
        screenLock: configuredLock,
        notificationProfile: "all",
        recoveryMethod: "trusted-device",
        fileSafety: "warn",
        privacySummary: "low",
      };
      try {
        const parsed = JSON.parse(localStorage.getItem("nabapp-security-state-v1") || "{}");
        const state = { ...defaults, ...parsed };
        if (!["off", "5m", "10m", "30m"].includes(state.screenLock)) state.screenLock = defaults.screenLock;
        if (!["warn", "block", "allow"].includes(state.fileSafety)) state.fileSafety = defaults.fileSafety;
        if (!["all", "silent"].includes(state.notificationProfile)) state.notificationProfile = defaults.notificationProfile;
        return state;
      } catch {
        return { ...defaults };
      }
    },
    getScreenLockTimeout() {
      const map = { off: 0, "5m": 300_000, "10m": 600_000, "30m": 1_800_000 };
      return map[this.getSecurityState().screenLock] ?? 300_000;
    },
    setSecurityState(partial) {
      const next = { ...this.getSecurityState(), ...partial };
      localStorage.setItem("nabapp-security-state-v1", JSON.stringify(next));
      return next;
    },
    getTheme() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    },
    setTheme(theme) {
      localStorage.setItem(THEME_KEY, theme === "dark" ? "dark" : "light");
      applyTheme(theme);
      return this.getTheme();
    },
    clearSensitiveState() {
      Store.identity = null;
      Store.authenticatedPassword = null;
      Store.identityBackupPassword = null;
      Store.sessions = {};
      Store.messages = {};
      Store.contacts = [];
      Store.groups = [];
      Store.unread = {};
      this._activeChatPhone = null;
      clearTimeout(this._messageExpiryTimer);
      this._messageUrls.forEach((url) => URL.revokeObjectURL(url));
      this._messageUrls = [];
      document.body.classList.remove("chat-open");
      this.elements.messages?.replaceChildren();
      this.elements.chatContent?.classList.add("hidden");
      this.elements.chatEmpty?.classList.remove("hidden");
    },
    showMobileOnboarding() {
      const modal = byId("onboarding-modal");
      if (!modal || localStorage.getItem("nabapp-onboarding-seen") === "1") return;
      if (!this.isMobileLayout()) {
        localStorage.setItem("nabapp-onboarding-seen", "1");
        return;
      }
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      const close = byId("onboarding-close");
      const start = byId("onboarding-start-button");
      const finish = () => {
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        localStorage.setItem("nabapp-onboarding-seen", "1");
      };
      close?.addEventListener("click", finish, { once: true });
      start?.addEventListener("click", () => {
        finish();
        this.activatePage("settings");
      }, { once: true });
    },
    startScreenLockMonitor() {
      if (!this._screenLockBound) {
        this._screenLockBound = true;
        ["mousemove", "keydown", "touchstart", "pointerdown", "scroll", "click"].forEach((eventName) => {
          document.addEventListener(eventName, () => this.refreshScreenLockTimer(), { passive: true });
        });
        document.addEventListener("visibilitychange", () => {
          clearTimeout(this._screenLockTimer);
          if (!document.hidden) this.refreshScreenLockTimer();
        });
        window.addEventListener("storage", (event) => {
          if (event.key === SCREEN_LOCKED_KEY && event.newValue === "1") Auth.lockScreen(true);
        });
      }
      this.refreshScreenLockTimer();
    },
    refreshScreenLockTimer() {
      clearTimeout(this._screenLockTimer);
      if (!getToken() || document.hidden || localStorage.getItem(SCREEN_LOCKED_KEY) === "1") return;
      const timeoutMs = this.getScreenLockTimeout();
      if (timeoutMs <= 0) return;
      this._screenLockTimer = setTimeout(() => {
        if (getToken() && !document.hidden) Auth.lockScreen();
      }, timeoutMs);
    },
    pruneExpiredMessages() {
      const now = Date.now();
      Object.entries(Store.messages).forEach(([phone, messages]) => {
        const kept = messages.filter((message) => !message.expiresAt || now < message.expiresAt);
        const expiredUnread = messages.filter((message) =>
          message.expiresAt && now >= message.expiresAt && message.side === "theirs" &&
          !message.read && this._activeChatPhone !== phone).length;
        if (expiredUnread) Store.unread[phone] = Math.max(0, (Store.unread[phone] || 0) - expiredUnread);
        Store.messages[phone] = kept;
      });
    },
    scheduleMessageExpiry() {
      clearTimeout(this._messageExpiryTimer);
      const nextExpiry = Object.values(Store.messages).flat().reduce((soonest, message) =>
        message.expiresAt && message.expiresAt < soonest ? message.expiresAt : soonest, Infinity);
      if (!Number.isFinite(nextExpiry)) return;
      this._messageExpiryTimer = setTimeout(() => {
        this.pruneExpiredMessages();
        this.renderChatList();
        if (this._activeChatPhone) this.renderMessages(this._activeChatPhone);
      }, Math.max(0, nextExpiry - Date.now()));
    },
    showToast(message, type = "info") {
      if (type === "error") console.error(message);
      const toast = this.elements.toast;
      toast.textContent = message;
      toast.classList.add("visible");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
    },
    updatePresence(phones, lastSeenByPhone = {}) {
      const previousOnline = this._online;
      this._online = new Set(phones || []);
      Store.contacts.forEach((contact) => {
        const timestamp = Number(lastSeenByPhone[contact.phone]);
        if (previousOnline.has(contact.phone) !== this._online.has(contact.phone) ||
            Object.prototype.hasOwnProperty.call(lastSeenByPhone, contact.phone)) {
          this._typing.delete(contact.phone);
        }
        contact.lastSeen = !this._online.has(contact.phone) && Number.isFinite(timestamp) && timestamp > 0
          ? timestamp
          : null;
      });
      if (this._activeChatPhone && !this._activeChatPhone.startsWith("group:")) this.updateChatStatus(this._activeChatPhone);
      this.renderChatList();
    },
    showTyping(phone, on) {
      if (on) {
        this._typing.add(phone);
      } else {
        this._typing.delete(phone);
      }
      if (phone === this._activeChatPhone) this.updateChatStatus(phone);
    },
    updateChatStatus(phone) {
      const contact = Store.contacts.find((item) => item.phone === phone);
      this.elements.chatStatus.textContent = phone === Store.me.phone ? "Kendine notlar · bu cihazda saklanır" :
        this._typing.has(phone) ? "yazıyor…" : this._online.has(phone) ? "çevrimiçi" :
          (contact && contact.lastSeen ? `son görülme ${new Date(contact.lastSeen).toLocaleString("tr-TR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
          })}` : "çevrimdışı veya durumu gizli");
    },
    updateReceipt(phone, msgId, kind) {
      if (!phone || msgId == null) return;
      const message = (Store.messages[phone] || []).find((item) => String(item.id) === String(msgId));
      if (!message) return;
      message.status = kind;
      if (window.AppDB) window.AppDB.updateMessage(msgId, { status: kind }).catch(() => {});
      if (this._activeChatPhone === phone) this.renderMessages(phone);
    },
    init() {
      if (this._initialized) return;
      this._initialized = true;
      window.addEventListener("error", (event) => {
        console.error("Beklenmeyen arayüz hatası:", event.error || event.message);
        this.showToast("Uygulamada beklenmeyen bir hata oluştu.", "error");
      });
      window.addEventListener("unhandledrejection", (event) => {
        console.error("İşlenmeyen asenkron hata:", event.reason);
        this.showToast("İstek tamamlanamadı.", "error");
      });
      applyTheme(readTheme());
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(readTheme());
      });
      const e = this.elements = {
        auth: byId("auth-screen"), app: byId("app-screen"), list: byId("conversation-list"),
        count: byId("chat-count"), empty: byId("empty-state"), emptyNewChat: byId("empty-new-chat"),
        search: byId("search-input"), chatPanel: byId("chat-panel"), chatEmpty: byId("chat-empty"),
        chatContent: byId("chat-content"), chatName: byId("chat-name"), chatAvatar: byId("chat-avatar"),
        chatStatus: byId("chat-status"), chatLoadProgress: byId("chat-load-progress"),
        messages: byId("messages-area"), form: byId("message-form"), input: byId("message-input"),
        fileInput: byId("file-input"), cameraInput: byId("camera-input"), toast: byId("toast"), modal: byId("modal-backdrop"),
        identity: byId("identity-input"), utility: byId("utility-view"), home: byId("home-view"),
        recordButton: byId("record-button"),
        chatSearchBar: byId("chat-search-bar"), chatSearchInput: byId("chat-search-input"),
        chatSearchCount: byId("chat-search-count"),
        keyWarning: byId("key-warning"),
      };
      byId("phone-form").addEventListener("submit", (event) => {
        event.preventDefault();
        Auth.requestCode(byId("phone-input").value);
      });
      byId("code-form").addEventListener("submit", (event) => {
        event.preventDefault();
        Auth.verifyCode(byId("otp-input").value);
      });
      byId("register-form").addEventListener("submit", (event) => {
        event.preventDefault();
        Auth.completeRegister(byId("display-name-input").value, byId("register-password-input").value, byId("confirm-password-input").value);
      });
      const registerPasswordInput = byId("register-password-input");
      if (registerPasswordInput) {
        registerPasswordInput.addEventListener("input", () => {
          const meter = document.querySelector("#register-password-meter .password-meter-fill");
          const text = document.querySelector("#register-password-meter small");
          if (!meter || !text) return;
          const value = registerPasswordInput.value;
          const score = Math.min(100, Math.max(0, value.length * 10 + (/[A-Z]/.test(value) ? 15 : 0) + (/[0-9]/.test(value) ? 15 : 0) + (/[!@#$%^&*]/.test(value) ? 10 : 0)));
          meter.style.width = `${value ? Math.min(100, score) : 0}%`;
          let color = "#b23a2e";
          let label = "Zayıf";
          if (score >= 75) { color = "#2f7d5b"; label = "Güçlü"; }
          else if (score >= 45) { color = "#a97a24"; label = "Orta"; }
          meter.style.background = color;
          text.textContent = value ? `Parola gücü: ${label}` : "En az 8 karakter, harf ve rakam kombinasyonu önerilir.";
        });
      }
      byId("twofa-form").addEventListener("submit", (event) => {
        event.preventDefault();
        Auth.login(byId("login-password-input").value, byId("totp-input").value);
      });
      byId("resend-btn").addEventListener("click", () => Auth.resendCode());
      byId("lock-form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (Auth._backupRecoveryPending) {
          Auth.unlockPreviousBackup(byId("lock-backup-password").value);
        } else {
          Auth.unlockScreen(byId("lock-password-input").value, byId("lock-twofa-input").value);
        }
      });
      e.list.addEventListener("click", (event) => {
        const row = event.target.closest("[data-phone]");
        if (row?.dataset.groupId) this.openGroup(row.dataset.groupId);
        else if (row) this.openChat(row.dataset.phone);
      });
      e.search.addEventListener("input", () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.renderChatList(), 160);
      });
      byId("chat-search-toggle").addEventListener("click", () => this.toggleChatSearch());
      byId("chat-search-close").addEventListener("click", () => this.toggleChatSearch(false));
      e.chatSearchInput.addEventListener("input", () => this.runChatSearch(e.chatSearchInput.value));
      window.addEventListener("online", () => this.showToast("İnternet bağlantısı yeniden kuruldu.", "success"));
      window.addEventListener("offline", () => this.showToast("İnternet bağlantısı yok. Mesajlar yerel kaydedilecek.", "error"));
      e.search.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && this.matchesPhone(e.search.value) && !e.list.querySelector(".conversation-row")) this.startNewChat(e.search.value);
      });
      e.emptyNewChat.addEventListener("click", () => this.startNewChat(e.search.value));
      e.form.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = e.input.value.trim();
        if (!text) return;
        const chatId = this._activeChatPhone;
        WS.sendTyping(chatId, false);
        WS.sendMessage(chatId, text).then(() => { e.input.value = ""; e.input.style.height = "auto"; }).catch((error) => this.showToast(error.message, "error"));
      });
      e.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          e.form.requestSubmit();
        }
      });
      e.input.addEventListener("input", () => {
        e.input.style.height = "auto";
        e.input.style.height = `${Math.min(e.input.scrollHeight, 120)}px`;
        if (this._activeChatPhone) WS.sendTyping(this._activeChatPhone, Boolean(e.input.value.trim()));
      });
      e.input.addEventListener("blur", () => {
        if (this._activeChatPhone) WS.sendTyping(this._activeChatPhone, false);
      });
      byId("close-chat").addEventListener("click", () => this.closeChat());
      byId("new-chat-button").addEventListener("click", () => this.openNewChat());
      byId("new-group-button").addEventListener("click", () => this.createGroup());
      byId("welcome-new-chat").addEventListener("click", () => this.openNewChat());
      byId("modal-close").addEventListener("click", () => this.closeNewChat());
      byId("start-chat-button").addEventListener("click", () => this.startNewChat(e.identity.value, byId("nickname-input").value));
      e.identity.addEventListener("keydown", (event) => { if (event.key === "Enter") this.startNewChat(e.identity.value, byId("nickname-input").value); });
      e.modal.addEventListener("click", (event) => { if (event.target === e.modal) this.closeNewChat(); });
      
      byId("chat-info-button").addEventListener("click", () => {
        const contact = Store.contacts.find((item) => item.phone === this._activeChatPhone);
        if (!contact) return;
        getDisplayName(contact.phone).then(name => {
           window.alert(`${name} · ${contact.phone}\n\nHakkımda: ${contact.about || "Belirtilmedi"}`);
           const action = window.prompt("Sohbet adı değiştirmek için 1'e, Kullanıcıyı engellemek için 2'ye, Sohbeti temizlemek için 3'e basın:");
           if(action === '1'){
               const nickname = window.prompt("Sohbet adı", contact.nickname || contact.displayName);
               if (nickname === null) return;
               API.patchContact(contact.phone, { nickname }).then(() => {
                   contact.nickname = nickname.trim() || null;
                   contact.displayName = contact.nickname || contact.originalName;
                   this.openChat(contact.phone);
                   this.renderChatList();
               }).catch((error) => this.showToast(error.message, "error"));
           } else if(action === '2'){
               blockUser(contact.phone).then(() => this.showToast('Kullanıcı engellendi.'));
           } else if(action === '3'){
               deleteEntireChat(contact.phone).then(() => {
                   this.showToast('Sohbet temizlendi.');
                   Store.messages[contact.phone] = [];
                   this.renderMessages(contact.phone);
               });
           }
        });
      });
      document.querySelectorAll(".attach-button").forEach((button) => button.addEventListener("click", async () => {
        if (!await this.requestAppPermission("files")) return;
        e.fileInput.accept = button.dataset.fileType;
        e.fileInput.click();
      }));
      e.fileInput.addEventListener("change", async () => {
        const files = Array.from(e.fileInput.files || []);
        for (const file of files) {
          try { await this.sendFile(file); }
          catch (error) { this.showToast(error.message, "error"); }
        }
        e.fileInput.value = "";
      });
      byId("camera-button").addEventListener("click", async () => {
        if (!await this.requestAppPermission("camera")) return;
        e.cameraInput.click();
      });
      e.cameraInput.addEventListener("change", async () => {
        const file = e.cameraInput.files && e.cameraInput.files[0];
        e.cameraInput.value = "";
        if (!file) return;
        try { await this.sendFile(file, true); }
        catch (error) { this.showToast(error.message, "error"); }
      });
      byId("location-button").addEventListener("click", () => this.shareLocation());
      byId("disappearing-toggle").addEventListener("click", () => this.cycleChatDisappearing());
      e.recordButton.addEventListener("click", () => this.showToast("Ses kaydı aktarımı henüz desteklenmiyor."));
      byId("audio-call").addEventListener("click", () => Calls.start(false));
      byId("video-call").addEventListener("click", () => Calls.start(true));
      byId("hangup-call").addEventListener("click", () => Calls.end(true));
      document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => {
        if (this.isMobileLayout()) this.closeChat();
        this.activatePage(item.dataset.page);
      }));
      document.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          e.search.focus();
        }
        if (event.key === "Escape") {
          if (this.elements.chatSearchBar && !this.elements.chatSearchBar.classList.contains("hidden")) {
            this.toggleChatSearch(false);
            return;
          }
          this.closeChat();
          this.closeNewChat();
        }
      });
      window.addEventListener("resize", () => { if (!this.isMobileLayout()) document.body.classList.remove("chat-open"); });
      this.renderChatList();
      this.activatePage("chats");
    },
    isMobileLayout() { return window.matchMedia("(max-width: 760px)").matches; },
    matchesPhone(value) { return String(value || "").replace(/\D/g, "").length >= 7; },
    renderChatList() {
      if (!this.elements.list) return;
      const query = this.elements.search.value.trim().toLocaleLowerCase("tr");
      this.pruneExpiredMessages();
      this.scheduleMessageExpiry();
      const contacts = Store.contacts.filter((contact) => {
        const messages = Store.messages[contact.phone] || [];
        const last = messages.at(-1);
        const history = messages.map((message) => message.text).join(" ");
        const haystack = `${contact.displayName} ${contact.phone} ${last ? last.text : ""} ${history}`.toLocaleLowerCase("tr");
        return haystack.includes(query);
      }).sort((a, b) => ((Store.messages[b.phone] || []).at(-1)?.ts || 0) - ((Store.messages[a.phone] || []).at(-1)?.ts || 0));
      const groups = Store.groups.filter((group) => {
        const key = `group:${group.id}`;
        const haystack = `${group.name} ${(Store.messages[key] || []).map((item) => item.text).join(" ")}`.toLocaleLowerCase("tr");
        return haystack.includes(query);
      });
      this.elements.list.replaceChildren();
      contacts.forEach((contact) => {
        const messages = Store.messages[contact.phone] || [];
        const last = messages.at(-1);
        const row = document.createElement("button");
        row.type = "button";
        row.className = `conversation-row${contact.phone === this._activeChatPhone ? " active" : ""}`;
        row.dataset.phone = contact.phone;
        row.setAttribute("aria-label", `${contact.displayName}, ${contact.phone}`);
        const avatar = document.createElement("img");
        avatar.className = "portrait-avatar";
        avatar.loading = "lazy";
        avatar.src = avatarSource(contact);
        avatar.alt = "";
        const main = document.createElement("span");
        main.className = "conversation-main";
        const top = document.createElement("span");
        top.className = "conversation-top";
        const name = document.createElement("span");
        name.className = "conversation-name";
        name.textContent = contact.displayName;
        const time = document.createElement("time");
        time.className = "conversation-time";
        time.textContent = last ? formatTime(last.ts) : "";
        top.append(name, time);
        const bottom = document.createElement("span");
        bottom.className = "conversation-bottom";
        const preview = document.createElement("span");
        preview.className = "conversation-preview";
        preview.textContent = last ? `${last.side === "mine" ? "Siz: " : ""}${last.text}` : "Henüz mesaj yok";
        bottom.append(preview);
        const unreadCount = Store.unread[contact.phone] || 0;
        if (unreadCount) {
          const unread = document.createElement("span");
          unread.className = "unread-count";
          unread.textContent = String(unreadCount);
          bottom.append(unread);
        }
        main.append(top, bottom);
        const phone = document.createElement("span");
        phone.className = "conversation-phone";
        phone.textContent = contact.phone;
        main.append(phone);
        row.append(avatar, main);
        this.elements.list.append(row);
      });
      groups.forEach((group) => {
        const key = `group:${group.id}`;
        const messages = Store.messages[key] || [];
        const last = messages.at(-1);
        const row = document.createElement("button");
        row.type = "button";
        row.className = `conversation-row${key === this._activeChatPhone ? " active" : ""}`;
        row.dataset.groupId = String(group.id);
        row.setAttribute("aria-label", `${group.name}, grup sohbeti`);
        const avatar = document.createElement("span");
        avatar.className = "chat-avatar";
        avatar.textContent = "◎";
        const main = document.createElement("span");
        main.className = "conversation-main";
        const top = document.createElement("span");
        top.className = "conversation-top";
        const name = document.createElement("span");
        name.className = "conversation-name";
        name.textContent = group.name;
        const time = document.createElement("time");
        time.className = "conversation-time";
        time.textContent = last ? formatTime(last.ts) : "";
        top.append(name, time);
        const preview = document.createElement("span");
        preview.className = "conversation-preview";
        preview.textContent = last ? last.text : `${group.members.length} üye`;
        main.append(top, preview);
        row.append(avatar, main);
        this.elements.list.append(row);
      });
      this.elements.count.textContent = String(Store.contacts.length + Store.groups.length).padStart(2, "0");
      this.elements.empty.classList.toggle("hidden", contacts.length + groups.length > 0);
      this.elements.empty.querySelector("strong").textContent = query ? "Sonuç bulunamadı" : "Henüz sohbetin yok";
      this.elements.emptyNewChat.classList.toggle("hidden", contacts.length + groups.length !== 0 || !this.matchesPhone(this.elements.search.value));
    },
    showChatLoading(label = "Bağlanıyor…") {
      const token = ++this._chatLoadToken;
      const progress = this.elements.chatLoadProgress;
      const text = byId("chat-load-text");
      const status = byId("chat-load-status");
      if (!progress || !text || !status) return;
      this.elements.chatContent.classList.add("hidden");
      this.elements.chatEmpty.classList.add("hidden");
      status.classList.remove("hidden");
      text.textContent = label;
      progress.style.width = "12%";
      const tick = () => {
        if (token !== this._chatLoadToken) return;
        const next = Math.min(parseFloat(progress.style.width || "0") + 18, 100);
        progress.style.width = `${next}%`;
        if (next >= 100) {
          status.classList.add("hidden");
          this.elements.chatContent.classList.remove("hidden");
          return;
        }
        setTimeout(tick, 120);
      };
      setTimeout(tick, 140);
    },
    hideChatLoading() {
      this._chatLoadToken += 1;
      const status = byId("chat-load-status");
      if (status) status.classList.add("hidden");
      this.elements.chatContent.classList.remove("hidden");
    },
    renderMessages(phone) {
      this.updateKeyWarning();
      const contact = Store.contacts.find((item) => item.phone === phone);
      const group = phone.startsWith("group:") ? Store.groups.find((item) => String(item.id) === phone.slice(6)) : null;
      const messages = (Store.messages[phone] || []).filter((message) => !message.expiresAt || Date.now() < message.expiresAt);
      Store.messages[phone] = messages;
      this._messageUrls.forEach((url) => URL.revokeObjectURL(url));
      this._messageUrls = [];
      this.elements.messages.replaceChildren();
      if (messages.length) {
        const date = document.createElement("div");
        date.className = "message-date";
        date.textContent = "BUGÜN";
        this.elements.messages.append(date);
      }
      messages.forEach((message) => {
        const row = document.createElement("div");
        row.className = `message-row ${message.side === "mine" ? "mine" : "theirs"}`;
        row.dataset.messageId = String(message.id);
        if (message.side !== "mine") {
          const avatar = document.createElement("img");
          avatar.className = "message-initial";
          avatar.src = contact ? avatarSource(contact) : portraitSource(phone, escapeInitials(group ? group.name : phone), "");
          avatar.alt = "";
          row.append(avatar);
        }
        const content = document.createElement("div");
        content.className = "message-content";
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        if (message.file) {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(message.file.data), (char) => char.charCodeAt(0))], { type: message.file.type || "application/octet-stream" }));
          this._messageUrls.push(link.href);
          link.download = message.file.name;
          link.textContent = `Dosyayı indir: ${message.file.name}`;
          bubble.append(link);
        } else {
          const locationMatch = /^Konum: (https:\/\/maps\.google\.com\/\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))$/.exec(message.text);
          if (locationMatch) {
            const link = document.createElement("a");
            link.href = locationMatch[1];
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Konumu haritada aç";
            bubble.append(link);
          } else {
            bubble.textContent = message.text;
          }
        }
        const stamp = document.createElement("time");
        stamp.className = "message-time";
        stamp.textContent = formatTime(message.ts);
        if (message.expiresAt) {
          const expiry = document.createElement("span");
          expiry.className = "message-expiry";
          expiry.textContent = " · süreli";
          expiry.title = "Bu mesaj belirlenen sürede sohbet görünümünden kaldırılır.";
          stamp.append(expiry);
        }
        if (message.side === "mine") {
          const status = document.createElement("span");
          status.className = "message-status";
          status.textContent = message.status === "read" || message.status === "delivered" ? "✓✓" :
            message.status === "queued" ? "◷" : message.status === "sent" ? "✓" :
              message.status === "failed" ? "!" : "";
          status.setAttribute("aria-label", message.status === "read" ? "Okundu" :
            message.status === "delivered" ? "Teslim edildi" :
              message.status === "queued" ? "Bu cihazda sırada; henüz teslim edilmedi." :
                message.status === "failed" ? "Gönderilemedi" : "Gönderildi");
          stamp.append(" ", status);
        }
        
        const deleteTrigger = document.createElement("button");
        deleteTrigger.type = "button";
        deleteTrigger.className = "reaction-trigger";
        deleteTrigger.textContent = "🗑";
        deleteTrigger.title = "Sil";
        deleteTrigger.addEventListener("click", () => {
             const forEveryone = window.confirm("Herkesten silinsin mi? (İptal dersen sadece senden silinir)");
             deleteMessage(message.id, message.side === 'mine', forEveryone).then(() => {
                 this.showToast('Mesaj silindi');
                 Store.messages[phone] = Store.messages[phone].filter(m => m.id !== message.id);
                 this.renderMessages(phone);
             });
        });
        stamp.append(" ", deleteTrigger);

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "reaction-trigger";
        trigger.textContent = "☺";
        trigger.setAttribute("aria-label", "Tepki ekle");
        trigger.addEventListener("click", () => this.openReactionPicker(content, phone, message.id));
        stamp.append(" ", trigger);
        content.append(bubble, stamp);
        const reactions = message.reactions || {};
        const reactionCounts = new Map();
        Object.values(reactions).forEach((emoji) => reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1));
        if (reactionCounts.size) {
          const chipRow = document.createElement("div");
          chipRow.className = "message-reactions";
          reactionCounts.forEach((count, emoji) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `reaction-chip${reactions[Store.me.phone] === emoji ? " mine" : ""}`;
            chip.textContent = count > 1 ? `${emoji} ${count}` : emoji;
            chip.setAttribute("aria-label", `${emoji} tepkisi, ${count} kişi`);
            chip.addEventListener("click", () => {
              const mine = (message.reactions || {})[Store.me.phone];
              WS.sendReaction(phone, message.id, mine === emoji ? null : emoji);
            });
            chipRow.append(chip);
          });
          content.append(chipRow);
        }
        row.append(content);
        this.elements.messages.append(row);
      });
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      if (this.elements.chatSearchBar && !this.elements.chatSearchBar.classList.contains("hidden") && this.elements.chatSearchInput.value.trim()) {
        this.runChatSearch(this.elements.chatSearchInput.value);
      }
    },
    openReactionPicker(anchor, chatId, msgId) {
      const alreadyOpen = anchor.querySelector(".reaction-picker");
      document.querySelectorAll(".reaction-picker").forEach((node) => node.remove());
      if (alreadyOpen) return;
      const picker = document.createElement("div");
      picker.className = "reaction-picker";
      ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "✅"].forEach((emoji) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "reaction-option";
        option.textContent = emoji;
        option.setAttribute("aria-label", `${emoji} tepkisi ver`);
        option.addEventListener("click", () => WS.sendReaction(chatId, msgId, emoji));
        picker.append(option);
      });
      anchor.append(picker);
    },
    toggleChatSearch(force) {
      const bar = this.elements.chatSearchBar;
      if (!bar) return;
      const show = force === undefined ? bar.classList.contains("hidden") : Boolean(force);
      bar.classList.toggle("hidden", !show);
      if (show) {
        this.elements.chatSearchInput.focus();
      } else {
        this.elements.chatSearchInput.value = "";
        this.runChatSearch("");
      }
    },
    runChatSearch(query) {
      const normalized = String(query || "").trim().toLocaleLowerCase("tr");
      let matches = 0;
      let firstMatch = null;
      this.elements.messages.querySelectorAll(".message-row").forEach((row) => {
        const bubble = row.querySelector(".message-bubble");
        const hit = Boolean(normalized) && (bubble ? bubble.textContent.toLocaleLowerCase("tr").includes(normalized) : false);
        row.classList.toggle("search-hit", hit);
        if (hit) {
          matches += 1;
          if (!firstMatch) firstMatch = row;
        }
      });
      if (this.elements.chatSearchCount) {
        this.elements.chatSearchCount.textContent = normalized ? (matches ? `${matches} sonuç` : "sonuç yok") : "";
      }
      if (firstMatch) firstMatch.scrollIntoView({ block: "nearest" });
    },
    updateDisappearingToggle(chatId) {
      const button = byId("disappearing-toggle");
      if (!button) return;
      const value = this.getChatDisappearing(chatId);
      const labels = { off: "Kapalı", "30s": "30 sn", "1m": "1 dk", "1h": "1 saat" };
      button.textContent = labels[value];
      button.title = `Kaybolan mesajlar: ${labels[value]}`;
      button.setAttribute("aria-label", `Kaybolan mesajlar: ${labels[value]}. Değiştirmek için seçin.`);
    },
    cycleChatDisappearing() {
      const chatId = this._activeChatPhone;
      if (!chatId) return;
      const choices = ["off", "30s", "1m", "1h"];
      const current = this.getChatDisappearing(chatId);
      const next = choices[(choices.indexOf(current) + 1) % choices.length];
      this.setChatDisappearing(chatId, next);
      this.updateDisappearingToggle(chatId);
      const labels = { off: "Kapalı", "30s": "30 saniye", "1m": "1 dakika", "1h": "1 saat" };
      this.showToast(`Bu sohbette kaybolan mesajlar: ${labels[next]}`);
    },
    openChat(phone) {
      const contact = Store.contacts.find((item) => item.phone === phone);
      if (!contact) return;
      const previousChat = this._activeChatPhone;
      if (previousChat && previousChat !== phone && !previousChat.startsWith("group:")) {
        WS.sendTyping(previousChat, false);
        P2P.drop(previousChat, false);
      }
      this.toggleChatSearch(false);
      this._activeChatPhone = phone;
      
      if(window.initChatEncryption){
         window.initChatEncryption(contact.identityPub);
      }

      P2P.ensureConnected(phone);
      this.elements.chatName.textContent = contact.displayName;
      const avatar = document.createElement("img");
      avatar.alt = "";
      avatar.src = avatarSource(contact);
      this.elements.chatAvatar.replaceChildren(avatar);
      this.updateChatStatus(phone);
      this.elements.chatPanel.setAttribute("aria-label", `${contact.displayName} ile sohbet`);
      byId("audio-call").disabled = phone === Store.me.phone;
      byId("video-call").disabled = phone === Store.me.phone;
      this.updateDisappearingToggle(phone);
      this.showChatLoading(`${contact.displayName} yükleniyor…`);
      Store.unread[phone] = 0;
      setTimeout(() => {
        (Store.messages[phone] || []).forEach((message) => {
          if (message.side === "theirs" && !message.read && message.id != null) {
            message.read = true;
            if (window.AppDB) window.AppDB.updateMessage(message.id, { read: true }).catch(() => {});
            WS.sendReceipt(phone, message.id, "read");
          }
        });
        this.renderMessages(phone);
        this.renderChatList();
        this.hideChatLoading();
        this.elements.chatEmpty.classList.add("hidden");
        if (this.isMobileLayout()) document.body.classList.add("chat-open");
      }, 420);
    },
    openGroup(groupId) {
      const group = Store.groups.find((item) => String(item.id) === String(groupId));
      if (!group) return;
      const previousChat = this._activeChatPhone;
      if (previousChat && !previousChat.startsWith("group:")) {
        WS.sendTyping(previousChat, false);
        P2P.drop(previousChat, false);
      }
      this.toggleChatSearch(false);
      const key = `group:${group.id}`;
      this._activeChatPhone = key;
      
      if(window.initChatEncryption){
         window.initChatEncryption(group.identityPub);
      }

      this.elements.chatName.textContent = group.name;
      this.elements.chatAvatar.textContent = "◎";
      this.elements.chatStatus.textContent = `${group.members.length} üye · uçtan uca şifreli`;
      this.elements.chatPanel.setAttribute("aria-label", `${group.name} grup sohbeti`);
      byId("audio-call").disabled = true;
      byId("video-call").disabled = true;
      this.updateDisappearingToggle(key);
      this.showChatLoading(`${group.name} yükleniyor…`);
      Store.unread[key] = 0;
      setTimeout(() => {
        this.renderMessages(key);
        this.renderChatList();
        this.hideChatLoading();
        this.elements.chatEmpty.classList.add("hidden");
        if (this.isMobileLayout()) document.body.classList.add("chat-open");
      }, 420);
    },
    async createGroup() {
      const name = window.prompt("Grup adı");
      if (!name) return;
      const phones = window.prompt("Gruba eklenecek kişi telefonlarını virgülle ayırarak yazın (önce kişilerinizi ekleyin).");
      if (!phones) return;
      try {
        const result = await API.createGroup(name, phones.split(",").map((phone) => phone.trim()).filter(Boolean));
        Store.groups.unshift(result.group);
        this.renderChatList();
        this.openGroup(result.group.id);
      } catch (error) { this.showToast(error.message, "error"); }
    },
    async sendFile(file, fromCamera = false) {
      if (!this._activeChatPhone) throw new Error("Önce bir sohbet açın.");
      if (!await this.requestAppPermission(fromCamera ? "camera" : "files")) {
        throw new Error("Dosya gönderimi için izin gerekli.");
      }
      if (file.size > 4 * 1024 * 1024) throw new Error("Dosya en fazla 4 MB olabilir.");
      const extension = file.name.split(".").pop().toLocaleLowerCase("en");
      const supportedTypes = new Set([
        "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "pdf",
        "doc", "docx", "txt", "rtf", "xls", "xlsx", "ppt", "pptx", "zip",
      ]);
      if (!supportedTypes.has(extension)) throw new Error("Bu dosya türü güvenlik nedeniyle desteklenmiyor.");
      if (!await fileSignatureMatches(file, extension)) {
        throw new Error("Dosya içeriği uzantısıyla eşleşmiyor veya okunamıyor.");
      }
      const riskyTypes = new Set(["zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf"]);
      const policy = this.getSecurityState().fileSafety;
      if (riskyTypes.has(extension) && policy === "block") {
        throw new Error("Güvenlik ayarınız bu dosya türünü göndermeyi engelliyor.");
      }
      if (riskyTypes.has(extension) && policy === "warn" &&
          !window.confirm(`${file.name} etkin veya sıkıştırılmış içerik taşıyabilir. Yalnızca güvendiğiniz alıcılara gönderin. Devam edilsin mi?`)) {
        throw new Error("Dosya gönderimi iptal edildi.");
      }
      if (this._activeChatPhone.startsWith("group:") &&
          !Store.groups.some((group) => `group:${group.id}` === this._activeChatPhone)) {
        throw new Error("Grup bulunamadı.");
      }
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(bytesToBase64(new Uint8Array(reader.result)));
        reader.onerror = () => reject(new Error("Dosya okunamadı."));
        reader.readAsArrayBuffer(file);
      });
      const payload = JSON.stringify({ kind: "file", name: file.name.slice(0, 180), type: file.type, data });
      await WS.sendMessage(this._activeChatPhone, payload);
    },
    async shareLocation() {
      if (!this._activeChatPhone) return this.showToast("Önce bir sohbet açın.");
      if (!await this.requestAppPermission("location")) return;
      if (!navigator.geolocation) return this.showToast("Bu tarayıcı konum paylaşımını desteklemiyor.", "error");
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0,
          });
        });
        const { latitude, longitude } = position.coords;
        await WS.sendMessage(this._activeChatPhone, `Konum: https://maps.google.com/?q=${latitude},${longitude}`);
      } catch (error) {
        this.showToast(error.message || "Konum alınamadı. Tarayıcı konum iznini kontrol edin.", "error");
      }
    },
    closeChat() {
      this._chatLoadToken += 1;
      document.body.classList.remove("chat-open");
      if (this._activeChatPhone && !this._activeChatPhone.startsWith("group:")) {
        WS.sendTyping(this._activeChatPhone, false);
        P2P.drop(this._activeChatPhone, false);
      }
      this._activeChatPhone = null;
      
      if(window.exitChat){
         window.exitChat();
      }

      this.elements.chatContent.classList.add("hidden");
      this.elements.chatEmpty.classList.remove("hidden");
      this.renderChatList();
      const status = byId("chat-load-status");
      if (status) status.classList.add("hidden");
    },
    openNewChat() {
      this.elements.modal.classList.remove("hidden");
      this.elements.identity.value = "";
      byId("nickname-input").value = "";
      requestAnimationFrame(() => this.elements.identity.focus());
    },
    closeNewChat() { this.elements.modal.classList.add("hidden"); },
    async startNewChat(value, nickname = "") {
      const rawPhone = String(value || "").trim().replace(/[^\d+]/g, "");
      const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
      if (!this.matchesPhone(phone)) {
        this.showToast("Geçerli bir telefon numarası girin.");
        this.elements.identity.focus();
        return;
      }
      try {
        let contact = Store.contacts.find((item) => item.phone === phone);
        if (!contact) {
          try {
            const result = await API.addContact(phone, nickname.trim());
            contact = Store.addContact(result.contact);
          } catch (error) {
            if (error.status !== 409) throw error;
            const result = await API.getContacts();
            Store.contacts = (result.contacts || []).map((item) => ({
              ...item,
              originalName: item.displayName,
              displayName: item.nickname || item.displayName,
            }));
            contact = Store.contacts.find((item) => item.phone === phone);
            if (!contact) throw error;
          }
        }
        this.closeNewChat();
        this.activatePage("chats");
        this.openChat(contact.phone);
      } catch (error) { this.showToast(error.message, "error"); }
    },
    activatePage(page) {
      this._currentPage = page;
      const utilityPage = page !== "chats";
      document.body.classList.toggle("utility-page-open", utilityPage);
      if (utilityPage) this.closeChat();
      document.querySelectorAll(".nav-item").forEach((item) => {
        const active = item.dataset.page === page;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      this.elements.home.classList.toggle("hidden", page !== "chats");
      this.elements.utility.classList.toggle("hidden", page === "chats");
      const heading = document.querySelector(".section-heading h1");
      heading.firstChild.textContent = page === "chats" ? "Sohbetler " : page === "settings" ? "Ayarlar " : "Profil ";
      if (page === "settings") this.renderSettingsPage();
      if (page === "profile") this.renderProfilePage();
      this.updateKeyWarning();
      this.renderChatList();
    },
    updateKeyWarning() {
      const strip = this.elements && this.elements.keyWarning;
      if (!strip) return;
      strip.classList.toggle("hidden", Boolean(Store.identity));
    },
    exportIdentityBackup() {
      const userId = Store.me ? Store.me.id : null;
      const saved = AccountStorage.readIdentity(userId);
      if (!saved || !saved.backup) {
        this.showToast("Bu cihazda dışa aktarılacak şifreli anahtar yedeği yok.", "error");
        return;
      }
      const payload = {
        format: "nabapp-identity-backup",
        version: 1,
        userId,
        phone: Store.me ? Store.me.phone : null,
        createdAt: new Date().toISOString(),
        encrypted: true,
        backup: saved.backup,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const digits = (Store.me && Store.me.phone ? Store.me.phone : "hesap").replace(/\D/g, "");
      link.download = `nabapp-anahtar-yedegi-${digits}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showToast("Şifreli anahtar yedeği indirildi. Dosyayı güvenli bir yerde sakla.");
    },

    async importIdentityBackup(file, password) {
      if (!file) throw new Error("Yedek dosyası seçilmedi.");
      if (typeof password !== "string" || !password) throw new Error("Yedeği açmak için parolayı gir.");
      let payload;
      try { payload = JSON.parse(await file.text()); }
      catch { throw new Error("Yedek dosyası okunamadı."); }
      if (!payload || payload.format !== "nabapp-identity-backup" || !payload.backup) {
        throw new Error("Bu dosya Nabapp anahtar yedeği değil.");
      }
      const userId = Store.me ? Store.me.id : null;
      if (payload.userId != null && userId != null && Number(payload.userId) !== Number(userId)) {
        throw new Error("Bu yedek başka bir hesaba ait. Doğru hesapla giriş yapıp tekrar dene.");
      }
      const unlocked = await window.NabIdentityBackup.unlock(
        { encrypted: true, backup: payload.backup }, [password], userId, window.NabCrypto.decryptBackup
      );
      if (!unlocked.identity) throw new Error("Yedek dosyası bu hesaba ait değil.");
      await Store.saveIdentity(unlocked.identity, Store.authenticatedPassword || password);
      Store.identityLoadError = null;
      await Store.loadStoredMessages();
      P2P.sync().catch(() => {});
      this.renderSettingsPage();
      this.showToast("Şifreleme anahtarları geri yüklendi.");
    },

    renderBrowserAccounts() {
      const section = this.section("HESAPLAR");
      const notice = document.createElement("p");
      notice.className = "utility-lede";
      notice.textContent = "Bir tarayıcıda aynı anda tek hesap açık olur. Bu cihazdaki diğer hesapların anahtarları ayrı ayrı saklanır; hesap değiştirdiğinde silinmez.";
      const list = document.createElement("div");
      list.className = "account-list";
      section.append(notice, list);
      const current = Store.me ? Store.me.phone : null;
      const rows = [];
      for (const phone of AccountStorage.listAccounts()) {
        const isCurrent = phone === current;
        const row = document.createElement("div");
        row.className = "account-row";
        const label = document.createElement("span");
        label.textContent = phone;
        row.append(label);
        if (isCurrent) {
          const badge = document.createElement("span");
          badge.className = "account-current";
          badge.textContent = "açık olan hesap";
          row.append(badge);
        } else {
          row.append(this.actionButton("Bu hesaba geç", () => {
            AccountStorage.bindAccount(phone);
            window.location.reload();
          }));
        }
        list.append(row);
        rows.push({ phone, label, isCurrent });
      }
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "utility-lede";
        empty.textContent = "Bu tarayıcıda açık oturumu olan başka hesap yok.";
        list.append(empty);
      }
      (async () => {
        for (const row of rows) {
          try {
            const result = await API.getUserByPhone(row.phone);
            const name = result.user.displayName || row.phone;
            row.label.textContent = `${name} · ${row.phone}${row.isCurrent ? " (açık olan hesap)" : ""}`;
          } catch {}
        }
      })();
      return section;
    },
    async renderSettingsPage() {
      const root = this.elements.utility;
      if (root.querySelector(".settings-accordion")) {
        this._settingsOpenSections = new Set(
          [...root.querySelectorAll(".settings-accordion[open]")].map((item) => item.dataset.settingsKey),
        );
      }
      root.replaceChildren();
      root.append(this.pageHeader("TERCİHLERİN", "Hesap ve gizlilik ayarları"));
      const profile = this.section("PROFİL");
      const securityBanner = document.createElement("div");
      securityBanner.className = "security-banner";
      const securityHeader = document.createElement("div");
      securityHeader.className = "security-banner-header";
      const securityTitle = document.createElement("strong");
      securityTitle.textContent = "Güvenli kullanım";
      const securityBadge = document.createElement("span");
      securityBadge.className = "status-badge good";
      securityBadge.textContent = "Şifreleme açık";
      securityHeader.append(securityTitle, securityBadge);
      const securityPills = document.createElement("div");
      securityPills.className = "security-pills";
      ["Anahtar doğrulaması", "Uçtan uca şifreleme", "Ekran kilidi"].forEach((label) => {
        const pill = document.createElement("span");
        pill.className = "security-pill";
        pill.textContent = label;
        securityPills.append(pill);
      });
      securityBanner.append(securityHeader, securityPills);
      profile.append(securityBanner);
      const profileCard = document.createElement("div");
      profileCard.className = "profile-card";
      const avatar = document.createElement("img");
      avatar.className = "portrait-avatar";
      avatar.src = avatarSource(Store.me);
      avatar.alt = "";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = Store.me.displayName;
      const phone = document.createElement("p");
      phone.textContent = Store.me.phone;
      identity.append(name, phone);
      profileCard.append(avatar, identity);
      profile.append(profileCard);

      const recommendations = this.section("GÜVENLİK VE KULLANICI ÖNERİLERİ");
      const recommendationGrid = document.createElement("div");
      recommendationGrid.className = "security-grid";

      const securityState = this.getSecurityState();
      const makeSegmentedTile = (title, description, options, activeValue, onChange, badgeText = "Etkin") => {
        const tile = document.createElement("div");
        tile.className = "security-tile";
        const head = document.createElement("div");
        head.className = "security-tile-head";
        const heading = document.createElement("strong");
        heading.textContent = title;
        const badge = document.createElement("span");
        badge.className = "status-badge good";
        badge.textContent = badgeText;
        head.append(heading, badge);
        const body = document.createElement("div");
        body.className = "security-tile-body";
        const copy = document.createElement("p");
        copy.textContent = description;
        const segmented = document.createElement("div");
        segmented.className = "segmented-options";
        segmented.setAttribute("role", "group");
        segmented.setAttribute("aria-label", title);
        options.forEach((option) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `segment${option.value === activeValue ? " active" : ""}`;
          button.setAttribute("aria-pressed", String(option.value === activeValue));
          button.textContent = option.label;
          button.addEventListener("click", () => {
            options.forEach((item) => {
              const node = segmented.querySelectorAll(".segment")[options.indexOf(item)];
              if (node) {
                node.classList.toggle("active", item.value === option.value);
                node.setAttribute("aria-pressed", String(item.value === option.value));
              }
            });
            onChange(option.value);
          });
          segmented.append(button);
        });
        body.append(copy, segmented);
        tile.append(head, body);
        return tile;
      };

      const themeTile = makeSegmentedTile(
        "Tema",
        "Arayüz görünümünü açık veya koyu olarak seç. Tercih yalnızca bu cihazda saklanır.",
        [
          { label: "Açık", value: "light" },
          { label: "Koyu", value: "dark" },
        ],
        this.getTheme(),
        (value) => {
          this.setTheme(value);
          this.showToast(`Tema: ${value === "dark" ? "Koyu" : "Açık"}`);
        },
        "Görünüm"
      );
      recommendationGrid.append(themeTile);

      const screenLockTile = makeSegmentedTile(
        "Ekran kilidi",
        "Boşta kalma süresi dolduğunda tekrar parola isteyerek cihaz güvenliğini korur.",
        [
          { label: "Kapalı", value: "off" },
          { label: "5 dk", value: "5m" },
          { label: "10 dk", value: "10m" },
          { label: "30 dk", value: "30m" },
        ],
        securityState.screenLock,
        (value) => {
          const map = { off: 0, "5m": 300000, "10m": 600000, "30m": 1800000 };
          localStorage.setItem(SCREEN_LOCK_KEY, String(map[value] ?? 300000));
          this.setSecurityState({ screenLock: value });
          this.refreshScreenLockTimer();
          this.showToast(`Ekran kilidi: ${value === "off" ? "Kapalı" : value === "5m" ? "5 dk" : value === "10m" ? "10 dk" : "30 dk"}`);
        },
        securityState.screenLock === "off" ? "Kapalı" : "Açık"
      );
      recommendationGrid.append(screenLockTile);

      const notificationProfileTile = makeSegmentedTile(
        "Bildirim profili",
        "Hepsi seçiliyken, bildirim tercihin ve tarayıcı iznin açıksa yeni mesaj bildirimi gösterilir. Sessiz tüm sohbetleri susturur.",
        [
          { label: "Hepsi", value: "all" },
          { label: "Sessiz", value: "silent" },
        ],
        securityState.notificationProfile === "silent" ? "silent" : "all",
        (value) => {
          this.setSecurityState({ notificationProfile: value });
          this.showToast(`Bildirim profili: ${value === "all" ? "Hepsi" : "Sessiz"}`);
        },
        "Özel"
      );
      recommendationGrid.append(notificationProfileTile);

      const twofaTile = document.createElement("div");
      twofaTile.className = "security-tile";
      const twofaHead = document.createElement("div");
      twofaHead.className = "security-tile-head";
      const twofaTitle = document.createElement("strong");
      twofaTitle.textContent = "İki adımlı doğrulama";
      const twofaStatusBadge = document.createElement("span");
      twofaStatusBadge.className = `status-badge ${Store.me.twofaEnabled ? "good" : "warning"}`;
      twofaStatusBadge.textContent = Store.me.twofaEnabled ? "Etkin" : "Kapalı";
      twofaHead.append(twofaTitle, twofaStatusBadge);
      const twofaBody = document.createElement("div");
      twofaBody.className = "security-tile-body";
      const twofaText = document.createElement("p");
      twofaText.textContent = Store.me.twofaEnabled
        ? "Oturum açarken ve ekran kilidini kaldırırken parola yanında doğrulama kodu gerekir."
        : "Bu hesapta 2FA kapalı. Etkinleştirme ve kurtarma kodlarını yönetmek için hesap ayarlarına git.";
      twofaBody.append(twofaText, this.actionButton("2FA ayarlarına git", () => {
        byId("twofa-settings").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      }));
      twofaTile.append(twofaHead, twofaBody);
      recommendationGrid.append(twofaTile);

      const fileSafetyTile = makeSegmentedTile(
        "Dosya güvenlik politikası",
        "Dosyaları gönderirken riskli türlerde uyarı ver, engelle veya gönderime izin ver. Her dosya türü ve boyutu yine kontrol edilir.",
        [
          { label: "Uyarı", value: "warn" },
          { label: "Engelle", value: "block" },
          { label: "İzin ver", value: "allow" },
        ],
        securityState.fileSafety,
        (value) => {
          this.setSecurityState({ fileSafety: value });
          this.showToast(`Dosya politikası: ${value === "warn" ? "Uyarı" : value === "block" ? "Engelle" : "İzin ver"}`);
        },
        "Kontrol"
      );
      recommendationGrid.append(fileSafetyTile);
      
      const backupTile = makeSegmentedTile(
          "Otomatik Yedekleme",
          "Mesajlarınızı ne sıklıkla yedeklemek istediğinizi seçin.",
          [
              {label: "Hiç", value: "Hiç bir zaman"},
              {label: "Günlük", value: "Günlük"},
              {label: "Haftalık", value: "Haftalık"},
              {label: "Aylık", value: "Aylık"}
          ],
          localStorage.getItem("nabapp-backup-freq") || "Hiç bir zaman",
          (value) => {
              localStorage.setItem("nabapp-backup-freq", value);
              scheduleBackup(value);
              this.showToast(`Yedekleme sıklığı: ${value}`);
          },
          "Yedek"
      );
      recommendationGrid.append(backupTile);

      const privacySummary = document.createElement("div");
      privacySummary.className = "security-tile";
      const privacyHead = document.createElement("div");
      privacyHead.className = "security-tile-head";
      const privacyTitle = document.createElement("strong");
      privacyTitle.textContent = "Gizlilik özeti";
      const privacyBadge = document.createElement("span");
      privacyBadge.className = "status-badge";
      privacyBadge.textContent = "Bilgi";
      privacyHead.append(privacyTitle, privacyBadge);
      const privacyBody = document.createElement("div");
      privacyBody.className = "security-tile-body";
      const privacyText = document.createElement("p");
      privacyText.textContent = "Mesaj içerikleri uçtan uca şifrelenir. Hesap oturumlarının yönetimi için IP ve tarayıcı bilgisi sunucuda tutulur.";
      const privacyList = document.createElement("ul");
      privacyList.className = "meta-list";
      ["Konum yalnızca sen gönderdiğinde sohbete paylaşılır", "Sohbet araması geçici olarak tarayıcı belleğinde yapılır", "Oturum IP/tarayıcı bilgisi sunucuda güvenlik amacıyla saklanır"].forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        privacyList.append(item);
      });
      privacyBody.append(privacyText, privacyList);
      privacySummary.append(privacyHead, privacyBody);
      recommendationGrid.append(privacySummary);

      const securityEvents = document.createElement("div");
      securityEvents.className = "security-tile";
      const eventsHead = document.createElement("div");
      eventsHead.className = "security-tile-head";
      const eventsTitle = document.createElement("strong");
      eventsTitle.textContent = "Oturum özeti";
      const eventsBadge = document.createElement("span");
      eventsBadge.className = "status-badge good";
      eventsBadge.textContent = "Yükleniyor";
      eventsHead.append(eventsTitle, eventsBadge);
      const eventsBody = document.createElement("div");
      eventsBody.className = "security-tile-body";
      const eventsList = document.createElement("ul");
      eventsList.className = "meta-list";
      ["Oturum bilgileri yükleniyor…"].forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        eventsList.append(item);
      });
      eventsBody.append(eventsList);
      securityEvents.append(eventsHead, eventsBody);
      recommendationGrid.append(securityEvents);
      API.getSessions().then(({ sessions }) => {
        const recentSessions = (sessions || []).filter((session) => Date.now() - session.created_at < 7 * 24 * 60 * 60 * 1000);
        eventsBadge.textContent = "Güncel";
        eventsBadge.className = "status-badge";
        eventsList.replaceChildren();
        [
          `Son 7 günde açılan oturum: ${recentSessions.length}`,
          `Hesaptaki etkin oturum: ${(sessions || []).length}`,
        ].forEach((line) => {
          const item = document.createElement("li");
          item.textContent = line;
          eventsList.append(item);
        });
      }).catch((error) => {
        eventsBadge.textContent = "Alınamadı";
        eventsBadge.className = "status-badge warning";
        eventsList.replaceChildren();
        const item = document.createElement("li");
        item.textContent = `Oturum bilgileri yüklenemedi: ${error.message}`;
        eventsList.append(item);
      });

      const permissions = document.createElement("div");
      permissions.className = "security-tile";
      const permissionsHead = document.createElement("div");
      permissionsHead.className = "security-tile-head";
      const permissionsTitle = document.createElement("strong");
      permissionsTitle.textContent = "İzinler";
      const permissionsBadge = document.createElement("span");
      permissionsBadge.className = "status-badge";
      permissionsBadge.textContent = "Bu cihazda";
      permissionsHead.append(permissionsTitle, permissionsBadge);
      const permissionsBody = document.createElement("div");
      permissionsBody.className = "security-tile-body";
      const permissionsText = document.createElement("p");
      permissionsText.textContent = "İzinleri kapatıp açabilirsin. İlk kullanımda bir kez sorulur ve seçimin bu cihazda saklanır.";
      permissionsBody.append(permissionsText);
      const permissionState = this.getAppPermissions();
      [
        ["location", "Konuma erişim izni", "Konumunu sohbette göndermek için"],
        ["camera", "Kameraya erişim izni", "Fotoğraf çekmek veya görüntülü arama için"],
        ["files", "Dosyalara erişim izni", "Sohbette dosya seçip göndermek için"],
      ].forEach(([key, title, description]) => {
        const row = document.createElement("div");
        row.className = "settings-row";
        const copy = document.createElement("div");
        copy.className = "settings-row-copy";
        const label = document.createElement("strong");
        label.textContent = title;
        const detail = document.createElement("span");
        detail.textContent = description;
        copy.append(label, detail);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toggle";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-label", title);
        toggle.setAttribute("aria-checked", String(permissionState[key].enabled));
        toggle.addEventListener("click", () => {
          const next = toggle.getAttribute("aria-checked") !== "true";
          permissionState[key] = { enabled: next };
          this.setAppPermissions(permissionState);
          toggle.setAttribute("aria-checked", String(next));
        });
        row.append(copy, toggle);
        permissionsBody.append(row);
      });
      permissions.append(permissionsHead, permissionsBody);
      recommendationGrid.append(permissions);

      recommendations.append(recommendationGrid);
      root.append(recommendations);

      const nameField = this.field("Görünen ad", "text", Store.me.displayName, { maxlength: 60 });
      const aboutField = this.field("Hakkımda", "text", Store.me.about || "", { maxlength: 200, multiline: true });
      const saveProfile = async (input, key) => {
        const value = input.value.trim();
        if (key === "displayName" && value.length < 2) return this.showToast("Ad en az 2 karakter olmalı.");
        try {
          const data = await API.patchMe({ [key]: value });
          Store.me = data.user;
          this.showToast("Profil güncellendi.");
        } catch (error) { this.showToast(error.message, "error"); }
      };
      nameField.input.addEventListener("change", () => saveProfile(nameField.input, "displayName"));
      aboutField.input.addEventListener("change", () => saveProfile(aboutField.input, "about"));
      profile.append(nameField.wrapper, aboutField.wrapper);

      const photoWrapper = document.createElement("div");
      photoWrapper.className = "field-group utility-field";
      const photoLabel = document.createElement("label");
      photoLabel.textContent = "Profil fotoğrafı";
      const photoInput = document.createElement("input");
      photoInput.type = "file";
      photoInput.accept = "image/png,image/jpeg,image/webp,image/gif";
      photoInput.className = "hidden";
      photoInput.setAttribute("aria-label", "Profil fotoğrafı seç");
      photoWrapper.append(photoLabel, this.actionButton("Fotoğraf seç", async () => {
        if (await this.requestAppPermission("files")) photoInput.click();
      }), photoInput);
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files && photoInput.files[0];
        photoInput.value = "";
        if (!file) return;
        if (file.size > 290 * 1024) return this.showToast("Fotoğraf en fazla 290 KB olabilir.", "error");
        try {
          const avatarUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Fotoğraf okunamadı."));
            reader.readAsDataURL(file);
          });
          const result = await API.patchMe({ avatarUrl });
          Store.me = result.user;
          avatar.src = avatarSource(Store.me);
          this.showToast("Profil fotoğrafı güncellendi.");
        } catch (error) { this.showToast(error.message, "error"); }
      });
      photoWrapper.append(this.actionButton("Fotoğrafı kaldır", async () => {
        try {
          const result = await API.patchMe({ avatarUrl: "" });
          Store.me = result.user;
          avatar.src = avatarSource(Store.me);
          this.showToast("Profil fotoğrafı kaldırıldı.");
        } catch (error) { this.showToast(error.message, "error"); }
      }));
      profile.append(photoWrapper);

      const visibilityWrapper = document.createElement("div");
      visibilityWrapper.className = "field-group utility-field";
      const visibilityLabel = document.createElement("label");
      visibilityLabel.textContent = "Profil fotoğrafımı kimler görebilir?";
      const visibility = document.createElement("select");
      [
        ["everyone", "Tüm Nabapp kullanıcıları"],
        ["contacts", "Yalnızca kayıtlı kişilerim"],
        ["selected", "Yalnızca seçtiklerim"],
        ["nobody", "Hiç kimse"],
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        visibility.append(option);
      });
      const currentSettings = Store.me.settings || {};
      visibility.value = ["everyone", "contacts", "selected", "nobody"].includes(currentSettings.avatarVisibility)
        ? currentSettings.avatarVisibility
        : "everyone";
      visibilityLabel.append(visibility);
      const selectedContacts = document.createElement("div");
      selectedContacts.className = "avatar-visibility-contacts";
      const saveAvatarVisibility = async () => {
        const avatarVisibleTo = [...selectedContacts.querySelectorAll("input:checked")].map((input) => input.value);
        try {
          const result = await API.patchMe({
            settings: { avatarVisibility: visibility.value, avatarVisibleTo },
          });
          Store.me = result.user;
          this.showToast("Profil fotoğrafı gizliliği güncellendi.");
        } catch (error) { this.showToast(error.message, "error"); }
      };
      Store.contacts.forEach((contact) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = contact.phone;
        checkbox.checked = Array.isArray(currentSettings.avatarVisibleTo) &&
          currentSettings.avatarVisibleTo.includes(contact.phone);
        checkbox.addEventListener("change", saveAvatarVisibility);
        label.append(checkbox, document.createTextNode(`${contact.displayName} · ${contact.phone}`));
        selectedContacts.append(label);
      });
      if (!Store.contacts.length) {
        const empty = document.createElement("p");
        empty.className = "utility-lede";
        empty.textContent = "Önce kişilere numara ekle.";
        selectedContacts.append(empty);
      }
      selectedContacts.hidden = visibility.value !== "selected";
      visibility.addEventListener("change", () => {
        selectedContacts.hidden = visibility.value !== "selected";
        saveAvatarVisibility();
      });
      visibilityWrapper.append(visibilityLabel, selectedContacts);
      profile.append(visibilityWrapper);
      root.append(profile);
      root.append(this.renderBrowserAccounts());

      const keySection = this.section("ŞİFRELEME ANAHTARLARI");
      const keyNotice = document.createElement("p");
      keyNotice.className = "utility-lede";
      const keyActions = document.createElement("div");
      keyActions.className = "settings-actions";
      if (!Store.identity) {
        keyNotice.textContent = "Bu cihazda bu hesabın şifreleme anahtarları yok; anahtar olmadan mesaj gönderemezsin. Hesabını ilk kayıt yaptığın cihazdan şifreli yedeği dışa aktarıp buradan geri yükle.";
        const keyPassword = this.field("Anahtar yedeği parolası", "password", "", { autocomplete: "current-password" });
        const importInput = document.createElement("input");
        importInput.type = "file";
        importInput.accept = "application/json,.json";
        importInput.className = "hidden";
        importInput.addEventListener("change", async () => {
          const file = importInput.files && importInput.files[0];
          importInput.value = "";
          if (!file) return;
          try {
            await this.importIdentityBackup(file, keyPassword.input.value);
          } catch (error) { this.showToast(error.message, "error"); }
        });
        keySection.append(keyNotice, keyPassword.wrapper, keyActions);
        keyActions.append(
          this.actionButton("Anahtar yedeğini aç", async () => {
            try {
              await Store.unlockIdentity(keyPassword.input.value);
              await Store.loadStoredMessages();
              P2P.sync().catch(() => {});
              this.renderSettingsPage();
              this.showToast("Şifreleme anahtarları açıldı.");
            } catch (error) { this.showToast(error.message, "error"); }
          }),
          this.actionButton("Yedek dosyasından geri yükle", () => importInput.click())
        );
        keySection.append(importInput);
      } else {
        keyNotice.textContent = "Şifreleme anahtarların bu cihazda hesap parolanla şifrelenerek saklanıyor. Yedeği dosya olarak dışa aktarıp başka bir cihazda geri yükleyebilirsin.";
        keyActions.append(this.actionButton("Anahtar yedeğini dışa aktar", () => this.exportIdentityBackup()));
        keySection.append(keyNotice, keyActions);
      }
      root.append(keySection);

      const email = this.section("E-POSTA");
      const emailState = document.createElement("p");
      emailState.className = "utility-lede";
      emailState.textContent = Store.me.email ? `${Store.me.email} · ${Store.me.emailVerified ? "Doğrulandı" : "Doğrulanmadı"}` : "Hesabına bağlı e-posta adresi yok.";
      emailState.className = `utility-lede status-badge ${Store.me.emailVerified ? "good" : "warning"}`;
      email.append(emailState);
      const emailField = this.field("E-posta adresi", "email", Store.me.email || "", { autocomplete: "email" });
      const emailCode = this.field("E-posta doğrulama kodu", "text", "", { inputmode: "numeric", autocomplete: "one-time-code" });
      const emailActions = document.createElement("div");
      emailActions.className = "settings-actions";
      emailActions.append(this.actionButton("Kod gönder", async () => {
        try {
          const result = await API.requestEmail(emailField.input.value);
          this.showToast(result.sent ? "Doğrulama kodu gönderildi." : "E-posta gönderilemedi, lütfen tekrar deneyin.");
        } catch (error) { this.showToast(error.message, "error"); }
      }), this.actionButton("Doğrula", async () => {
        try {
          await API.verifyEmail(emailCode.input.value);
          const result = await API.getMe();
          Store.me = result.user;
          this.renderSettingsPage();
          this.showToast("E-posta doğrulandı.");
        } catch (error) { this.showToast(error.message, "error"); }
      }));
      if (Store.me.email) emailActions.append(this.actionButton("E-postayı kaldır", async () => {
        try {
          await API.deleteEmail();
          Store.me.email = null;
          Store.me.emailVerified = false;
          this.renderSettingsPage();
          this.showToast("E-posta kaldırıldı.");
        } catch (error) { this.showToast(error.message, "error"); }
      }));
      email.append(emailField.wrapper, emailCode.wrapper, emailActions);
      root.append(email);

      const twofa = this.section("İKİ ADIMLI DOĞRULAMA");
      twofa.id = "twofa-settings";
      const twofaBadge = document.createElement("p");
      twofaBadge.className = `status-badge ${Store.me.twofaEnabled ? "good" : "warning"}`;
      twofaBadge.textContent = Store.me.twofaEnabled ? "Etkin" : "Devre dışı";
      twofa.append(twofaBadge);
      if (!Store.me.twofaEnabled) {
        const start = this.actionButton("2FA kurulumunu başlat", async () => {
          try {
            const setup = await API.setup2FA();
            this.renderTwofaSetup(twofa, setup);
          } catch (error) { this.showToast(error.message, "error"); }
        });
        twofa.append(start);
      } else {
        const password = this.field("Parola", "password", "", { autocomplete: "current-password" });
        const code = this.field("Doğrulayıcı kodu", "text", "", { autocomplete: "one-time-code" });
        const disable = this.actionButton("2FA'yı devre dışı bırak", async () => {
          try {
            await API.disable2FA(password.input.value, code.input.value);
            const result = await API.getMe();
            Store.me = result.user;
            this.renderSettingsPage();
            this.showToast("İki adımlı doğrulama kapatıldı.");
          } catch (error) { this.showToast(error.message, "error"); }
        });
        twofa.append(password.wrapper, code.wrapper, disable);
      }
      root.append(twofa);

      const privacy = this.section("BİLDİRİMLER VE GİZLİLİK");
      const settings = Store.me.settings || {};
      [
        ["notifications", "Bildirimler", "Mesaj bildirimleri tercihi"],
        ["lastSeen", "Son görülme", "Son görülme bilgisini paylaş"],
      ].forEach(([key, title, description]) => {
        const row = document.createElement("div");
        row.className = "settings-row";
        const copy = document.createElement("div");
        copy.className = "settings-row-copy";
        const strong = document.createElement("strong");
        strong.textContent = title;
        const small = document.createElement("span");
        small.textContent = description;
        copy.append(strong, small);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toggle";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-label", title);
        toggle.setAttribute("aria-checked", String(Boolean(settings[key])));
        toggle.addEventListener("click", async () => {
          const next = toggle.getAttribute("aria-checked") !== "true";
          if (key === "notifications" && next) {
            if (!("Notification" in window)) {
              this.showToast("Bu tarayıcı masaüstü bildirimlerini desteklemiyor.");
              return;
            }
            let permission;
            try { permission = await Notification.requestPermission(); }
            catch (error) {
              this.showToast(`Tarayıcı bildirim izni alınamadı: ${error.message}`, "error");
              return;
            }
            if (permission !== "granted") {
              this.showToast("Tarayıcı bildirim izni verilmedi.");
              return;
            }
          }
          const previousValue = Store.me.settings?.[key];
          Store.me.settings = { ...(Store.me.settings || {}), [key]: next };
          toggle.setAttribute("aria-checked", String(next));
          try {
            const result = await API.patchMe({ settings: { [key]: next } });
            Store.me = result.user;
          } catch (error) {
            Store.me.settings = { ...(Store.me.settings || {}), [key]: previousValue };
            toggle.setAttribute("aria-checked", String(!next));
            this.showToast(error.message, "error");
          }
        });
        row.append(copy, toggle);
        privacy.append(row);
      });

      root.append(privacy);

      const passwordSection = this.section("PAROLA DEĞİŞTİR");
      const currentPassword = this.field("Mevcut parola", "password", "", { autocomplete: "current-password" });
      const newPassword = this.field("Yeni parola", "password", "", { minlength: 8, autocomplete: "new-password" });
      const confirmPassword = this.field("Yeni parola tekrarı", "password", "", { minlength: 8, autocomplete: "new-password" });
      const passwordStrength = this.createPasswordStrengthMeter();
      newPassword.input.addEventListener("input", () => this.updatePasswordStrength(passwordStrength, newPassword.input.value));
      passwordSection.append(currentPassword.wrapper, newPassword.wrapper, passwordStrength.wrapper, confirmPassword.wrapper);
      passwordSection.append(this.actionButton("Parolayı değiştir", async () => {
        if (newPassword.input.value !== confirmPassword.input.value) return this.showToast("Yeni parolalar eşleşmiyor.");
        try {
          await API.changePassword(currentPassword.input.value, newPassword.input.value);
          if (Store.identity) await Store.saveIdentity(Store.identity, newPassword.input.value);
          currentPassword.input.value = newPassword.input.value = confirmPassword.input.value = "";
          this.showToast("Parola değiştirildi.");
        } catch (error) { this.showToast(error.message, "error"); }
      }));
      root.append(passwordSection);

      const sessions = this.section("GÜVENİLİR CİHAZLAR");
      const sessionNotice = document.createElement("p");
      sessionNotice.className = "utility-lede";
      sessionNotice.textContent = "Telefon numaranla giriş yapılan tüm cihaz oturumları burada görünür. İstemediğin oturumları sonlandırabilirsin.";
      const sessionList = document.createElement("div");
      sessionList.className = "settings-card";
      sessionList.textContent = "Oturumlar yükleniyor…";
      sessions.append(sessionNotice, sessionList);
      sessions.append(this.actionButton("Tüm oturumları sonlandır", async () => {
        if (!window.confirm("Tüm oturumlar sonlandırılacak ve bu hesaptan çıkış yapılacak. Devam edilsin mi?")) return;
        try { await API.revokeAllSessions(); Auth.logout(false); }
        catch (error) { this.showToast(error.message, "error"); }
      }));
      root.append(sessions);
      try {
        const result = await API.getSessions();
        sessionList.replaceChildren();
        if (!result.sessions.length) sessionList.textContent = "Etkin oturum bulunamadı.";
        result.sessions.forEach((session) => {
          const row = document.createElement("div");
          row.className = "session-row";
          const info = document.createElement("span");
          info.className = "device-info";
          info.textContent = session.device_info || "Bilinmeyen cihaz";
          const date = document.createElement("time");
          date.textContent = session.lastActive
            ? `Son etkinlik ${new Date(session.lastActive).toLocaleString("tr-TR")}`
            : session.created_at ? new Date(session.created_at).toLocaleString("tr-TR") : "";
          row.append(info, date);
          if (!session.id.startsWith(result.currentHash)) {
            row.append(this.actionButton("Sonlandır", async () => {
              try {
                await API.revokeSession(session.id);
                await this.renderSettingsPage();
                this.showToast("Oturum sonlandırıldı.");
              } catch (error) { this.showToast(error.message, "error"); }
            }));
          } else {
            const current = document.createElement("span");
            current.className = "settings-value";
            current.textContent = "Bu cihaz";
            row.append(current);
          }
          sessionList.append(row);
        });
      } catch (error) { sessionList.textContent = error.message; }

      const danger = document.createElement("section");
      danger.className = "danger-zone";
      const dangerTitle = document.createElement("strong");
      dangerTitle.textContent = "Hesabı sil";
      const dangerCopy = document.createElement("p");
      dangerCopy.className = "utility-lede";
      dangerCopy.textContent = "Bu işlem hesabını ve sunucudaki hesabına bağlı verileri kalıcı olarak siler.";
      const deletePassword = this.field("Parolan", "password", "", { autocomplete: "current-password" });
      danger.append(dangerTitle, dangerCopy, deletePassword.wrapper);
      danger.append(this.actionButton("Hesabı kalıcı sil", async () => {
        if (!window.confirm("Hesabın kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misin?")) return;
        try { await API.deleteAccount(deletePassword.input.value); Auth.logout(false, true); }
        catch (error) { this.showToast(error.message, "error"); }
      }));
      root.append(danger);
      this.organizeSettingsSections(root);
    },
    organizeSettingsSections(root) {
      const sections = [...root.children].filter((item) =>
        item.matches("section") && !item.classList.contains("settings-accordion"),
      );
      sections.forEach((section, index) => {
        const danger = section.classList.contains("danger-zone");
        const heading = danger
          ? section.querySelector(":scope > strong")
          : section.querySelector(":scope > .settings-section-title");
        if (!heading) return;
        const title = heading.textContent.trim();
        const key = `${index}-${title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/g, "-")}`;
        const accordion = document.createElement("details");
        accordion.className = `settings-accordion${danger ? " danger-accordion" : ""}`;
        accordion.dataset.settingsKey = key;
        accordion.open = this._settingsOpenSections
          ? this._settingsOpenSections.has(key)
          : index === 0;
        const summary = document.createElement("summary");
        summary.textContent = title.toLocaleLowerCase("tr-TR").replace(/^./u, (letter) => letter.toLocaleUpperCase("tr-TR"));
        const content = document.createElement("div");
        content.className = "settings-accordion-content";
        [...section.children].forEach((child) => {
          if (child !== heading) content.append(child);
        });
        accordion.append(summary, content);
        section.replaceWith(accordion);
        accordion.addEventListener("toggle", () => {
          if (!this._settingsOpenSections) this._settingsOpenSections = new Set();
          if (accordion.open) this._settingsOpenSections.add(key);
          else this._settingsOpenSections.delete(key);
        });
      });
    },
    renderTwofaSetup(container, setup) {
      container.querySelectorAll(".twofa-setup").forEach((item) => item.remove());
      const box = document.createElement("div");
      box.className = "twofa-setup";
      const help = document.createElement("p");
      help.className = "utility-lede";
      help.textContent = "Doğrulayıcı uygulamanla bu QR kodunu tara veya gizli anahtarı kullan.";
      const qr = document.createElement("div");
      qr.className = "qr-code-wrapper";
      const image = document.createElement("img");
      image.alt = "İki adımlı doğrulama kurulum QR kodu";
      qr.append(image);
      const secret = document.createElement("p");
      secret.className = "utility-lede";
      secret.textContent = `Gizli anahtar: ${setup.secret}`;
      const code = this.field("Doğrulayıcı kodu", "text", "", { inputmode: "numeric", autocomplete: "one-time-code" });
      box.append(help, qr, secret, code.wrapper);
      API.get2FAQr().then((result) => { image.src = result.dataUrl; }).catch((error) => {
        qr.replaceChildren();
        qr.textContent = `QR kodu yüklenemedi: ${error.message}`;
      });
      box.append(this.actionButton("Kurulumu onayla", async () => {
        try {
          const result = await API.enable2FA(code.input.value);
          Store.me.twofaEnabled = true;
          const recovery = document.createElement("div");
          recovery.className = "settings-card";
          const title = document.createElement("p");
          title.className = "utility-lede";
          title.textContent = "Kurtarma kodlarını güvenli bir yerde sakla; bu kodlar tekrar gösterilmez.";
          recovery.append(title);
          result.recovery.forEach((value) => {
            const item = document.createElement("div");
            item.className = "session-row";
            item.textContent = value;
            recovery.append(item);
          });
          Store.me.twofaEnabled = true;
          const recoverySection = this.section("KURTARMA KODLARI");
          recoverySection.append(recovery);
          this.renderSettingsPage();
          this.elements.utility.append(recoverySection);
          this.organizeSettingsSections(this.elements.utility);
          this.showToast("İki adımlı doğrulama etkinleştirildi.");
        } catch (error) { this.showToast(error.message, "error"); }
      }));
      container.append(box);
    },
    async renderProfilePage() {
      const root = this.elements.utility;
      root.replaceChildren();
      root.append(this.pageHeader("KİŞİSEL ALANIN", "Profilin"));
      const card = document.createElement("div");
      card.className = "profile-card";
      const avatar = document.createElement("img");
      avatar.className = "portrait-avatar";
      avatar.src = avatarSource(Store.me);
      avatar.alt = "";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = Store.me.displayName;
      const phone = document.createElement("p");
      phone.textContent = Store.me.phone;
      details.append(name, phone);
      card.append(avatar, details);
      root.append(card);
      const info = document.createElement("div");
      info.className = "settings-card";
      const rows = [
        ["Hakkımda", Store.me.about || "Belirtilmedi"],
        ["E-posta", Store.me.email ? `${Store.me.email}${Store.me.emailVerified ? " · Doğrulandı" : " · Doğrulanmadı"}` : "Bağlı değil"],
        ["İki adımlı doğrulama", Store.me.twofaEnabled ? "Etkin" : "Devre dışı"],
      ];
      rows.forEach(([title, value]) => {
        const row = document.createElement("div");
        row.className = "settings-row";
        const copy = document.createElement("div");
        copy.className = "settings-row-copy";
        const strong = document.createElement("strong");
        strong.textContent = title;
        const span = document.createElement("span");
        span.textContent = value;
        copy.append(strong, span);
        row.append(copy);
        info.append(row);
      });
      root.append(info);
      root.append(this.actionButton("Ayarları aç", () => this.activatePage("settings")));
      root.append(this.actionButton("Oturumu kapat", () => Auth.logout()));
    },
    pageHeader(eyebrowText, titleText) {
      const header = document.createElement("div");
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = eyebrowText;
      const title = document.createElement("h2");
      title.textContent = titleText;
      const lede = document.createElement("p");
      lede.className = "utility-lede";
      lede.textContent = Store.me.displayName;
      header.append(eyebrow, title, lede);
      return header;
    },
    section(title) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.className = "settings-section-title";
      heading.textContent = title;
      section.append(heading);
      return section;
    },
    createPasswordStrengthMeter() {
      const wrapper = document.createElement("div");
      wrapper.className = "password-meter";
      const label = document.createElement("div");
      label.className = "password-meter-label";
      label.textContent = "Parola gücü";
      const bar = document.createElement("div");
      bar.className = "password-meter-bar";
      const fill = document.createElement("span");
      fill.className = "password-meter-fill";
      bar.append(fill);
      const hint = document.createElement("small");
      hint.textContent = "En az 8 karakter, harf ve rakam kombinasyonu önerilir.";
      wrapper.append(label, bar, hint);
      return { wrapper, fill, hint };
    },
    updatePasswordStrength(meter, value) {
      const score = Math.min(100, Math.max(0, value.length * 10 + (/[A-Z]/.test(value) ? 15 : 0) + (/[0-9]/.test(value) ? 15 : 0) + (/[!@#$%^&*]/.test(value) ? 10 : 0)));
      const normalized = value ? Math.min(100, score) : 0;
      meter.fill.style.width = `${normalized}%`;
      let color = "#b23a2e";
      let text = "Zayıf";
      if (normalized >= 75) { color = "#2f7d5b"; text = "Güçlü"; }
      else if (normalized >= 45) { color = "#a97a24"; text = "Orta"; }
      meter.fill.style.background = color;
      meter.hint.textContent = value ? `Parola gücü: ${text}` : "En az 8 karakter, harf ve rakam kombinasyonu önerilir.";
    },
    field(labelText, type, value, options = {}) {
      const wrapper = document.createElement("div");
      wrapper.className = "field-group utility-field";
      const id = `field-${Math.random().toString(36).slice(2)}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = labelText;
      const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
      if (!options.multiline) input.type = type;
      input.id = id;
      input.value = value || "";
      Object.entries(options).forEach(([key, setting]) => {
        if (!["multiline"].includes(key)) input.setAttribute(key, String(setting));
      });
      wrapper.append(label, input);
      return { wrapper, input };
    },
    actionButton(label, callback) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "soft-button utility-action";
      button.textContent = label;
      button.addEventListener("click", callback);
      return button;
    },
  };

  const API = {
    async call(method, path, body) {
      const headers = { "Content-Type": "application/json" };
      if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
      const response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && getToken() && data.error === "Oturum geçersiz veya süresi doldu.") Auth.expired();
      if (!response.ok) {
        const error = new Error(data.error || `İstek başarısız (${response.status}).`);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    },
    getMe() { return this.call("GET", "/me"); },
    patchMe(data) { return this.call("PATCH", "/me", data); },
    getUserByPhone(phone) { return this.call("GET", `/users/by-phone/${encodeURIComponent(phone)}`); },
    getKeyBundle(phone) { return this.call("GET", `/keys/bundle/${encodeURIComponent(phone)}`); },
    requestCode(phone) { return this.call("POST", "/auth/request-code", { phone }); },
    resendCode(phone) { return this.call("POST", "/auth/resend-code", { phone }); },
    verifyCode(phone, code) { return this.call("POST", "/auth/verify-code", { phone, code }); },
    completeAuth(data) { return this.call("POST", "/auth/complete", data); },
    login(phone, password, twofaCode) { return this.call("POST", "/auth/login", { phone, password, twofaCode }); },
    reauthenticate(password, twofaCode) { return this.call("POST", "/auth/reauthenticate", { password, twofaCode }); },
    logout() { return this.call("POST", "/auth/logout"); },
    setup2FA() { return this.call("POST", "/2fa/setup", {}); },
    get2FAQr() { return this.call("GET", "/2fa/qr"); },
    enable2FA(code) { return this.call("POST", "/2fa/enable", { code }); },
    disable2FA(password, code) { return this.call("POST", "/2fa/disable", { password, code }); },
    requestEmail(email) { return this.call("POST", "/email/request", { email }); },
    verifyEmail(code) { return this.call("POST", "/email/verify", { code }); },
    deleteEmail() { return this.call("DELETE", "/email"); },
    changePassword(current, next) { return this.call("POST", "/password/change", { current, next }); },
    getSessions() { return this.call("GET", "/sessions"); },
    revokeSession(id) { return this.call("DELETE", `/sessions/${encodeURIComponent(id)}`); },
    revokeAllSessions() { return this.call("POST", "/sessions/revoke-all", {}); },
    deleteAccount(password) { return this.call("POST", "/account/delete", { password }); },
    getContacts() { return this.call("GET", "/contacts"); },
    addContact(phone, nickname) { return this.call("POST", "/contacts", { phone, nickname }); },
    deleteContact(phone) { return this.call("DELETE", `/contacts/${encodeURIComponent(phone)}`); },
    patchContact(phone, data) { return this.call("PATCH", `/contacts/${encodeURIComponent(phone)}`, data); },
    getGroups() { return this.call("GET", "/groups"); },
    createGroup(name, members) { return this.call("POST", "/groups", { name, members }); },
  };

  const Store = {
    me: null,
    authenticatedPassword: null,
    identityBackupPassword: null,
    identityLoadError: null,
    contacts: [],
    groups: [],
    sessions: {},
    messages: {},
    unread: {},
    identity: null,
    trustedKeyMap() {
      return AccountStorage.readTrustedKeys(this.me ? this.me.id : null);
    },
    async trustContactKey(phone, identityPub, identitySignPub) {
      const fingerprint = await window.NabCrypto.identityFingerprint(identityPub, identitySignPub);
      const trusted = this.trustedKeyMap();
      const saved = trusted[phone];
      if (saved && (saved.fingerprint !== fingerprint ||
          JSON.stringify(saved.identityPub) !== JSON.stringify(identityPub) ||
          JSON.stringify(saved.identitySignPub) !== JSON.stringify(identitySignPub))) {
        throw new Error("Kişinin doğrulanmış şifreleme anahtarı değişti. Güvenlik için mesaj engellendi; anahtarı yüz yüze doğrulayın.");
      }
      if (!saved) {
        trusted[phone] = { fingerprint, identityPub, identitySignPub };
        AccountStorage.writeTrustedKeys(this.me ? this.me.id : null, trusted);
      }
      return fingerprint;
    },
    async init(identityPassword) {
      const result = await API.getMe();
      this.me = result.user;
      const token = getToken();
      if (token) AccountStorage.adoptLegacyToken(this.me.phone, token);
      this.authenticatedPassword = typeof identityPassword === "string" && identityPassword
        ? identityPassword
        : null;
      this.identityBackupPassword = null;
      this.identityLoadError = null;
      const contactsResult = await API.getContacts();
      this.contacts = (contactsResult.contacts || []).map((item) => ({
        ...item,
        originalName: item.displayName,
        displayName: item.nickname || item.displayName,
      }));
      const groupsResult = await API.getGroups();
      this.groups = groupsResult.groups || [];
      try {
        const passwords = this.authenticatedPassword ? [this.authenticatedPassword, ""] : [identityPassword];
        const unlocked = await this.loadIdentity(passwords);
        this.identity = unlocked.identity;
        if (this.identity && this.authenticatedPassword) {
          await this.saveIdentity(this.identity, this.authenticatedPassword);
          if (unlocked.password === "") {
            UI.showToast("Eski anahtar yedeği güvenli biçimde onarıldı ve hesap parolanla yeniden şifrelendi.");
          }
        }
      } catch (error) {
        this.identity = null;
        this.identityLoadError = error;
        if (error.code === "decrypt_failed") {
          UI.showToast("Cihazdaki anahtar yedeği açılamadı. Hesap parolanı daha önce değiştirdiysen önceki parolan gerekebilir.", "error");
        } else if (error.code === "invalid_backup") {
          UI.showToast("Cihazdaki anahtar yedeği okunamıyor. Yedeği silme; destek için bu hata bilgisini sakla.", "error");
        } else if (error.code === "account_mismatch") {
          UI.showToast("Cihazdaki anahtar yedeği başka bir hesaba ait; yedek korunuyor.", "error");
        }
      }
      if (!this.identity && !this.identityLoadError && window.NabCrypto) {
        UI.showToast("Bu cihazda bu hesabın şifreleme anahtarları yok. Ayarlar → ŞİFRELEME ANAHTARLARI bölümünden yedek dosyasını geri yükleyebilirsin.");
      }
      UI.updateKeyWarning();
      await this.loadStoredMessages();
    },
    chatIds() {
      const ids = this.contacts.map((contact) => contact.phone);
      for (const group of this.groups) ids.push(`group:${group.id}`);
      return ids;
    },
    async loadStoredMessages() {
      if (!window.AppDB) return;
      for (const chatId of this.chatIds()) {
        try {
          const stored = await window.AppDB.getMessages(chatId);
          if (stored && stored.length) this.messages[chatId] = stored;
        } catch (error) { console.warn("[store] Yerel mesajlar okunamadı.", error); }
      }
      this.unread = {};
      for (const [chatId, list] of Object.entries(this.messages)) {
        const count = list.filter((message) => message.side === "theirs" && !message.read).length;
        if (count) this.unread[chatId] = count;
      }
    },
    addContact(user) {
      const contact = {
        id: user.id,
        phone: user.phone,
        originalName: user.displayName || user.phone,
        nickname: user.nickname || null,
        displayName: user.nickname || user.displayName || user.phone,
        about: user.about || "",
        avatarColor: user.avatarColor || "",
        avatarUrl: user.avatarUrl || null,
        lastSeen: user.lastSeen || null,
      };
      if (!this.contacts.some((item) => item.phone === contact.phone)) this.contacts.push(contact);
      return contact;
    },
    async loadIdentity(passwords) {
      const userId = this.me ? this.me.id : null;
      const candidates = AccountStorage.identityCandidates(userId);
      if (!candidates.length) return { identity: null, password: null };
      const unlocked = await window.NabIdentityBackup.unlockCandidates(
        candidates, passwords, userId, window.NabCrypto.decryptBackup);
      if (unlocked.identity && unlocked.slot === "legacy") {
        AccountStorage.writeIdentity(userId, unlocked.saved);
      }
      return unlocked;
    },
    async unlockIdentity(password) {
      if (typeof password !== "string" || !password) throw new Error("Anahtar yedeği parolasını gir.");
      const unlocked = await this.loadIdentity([password]);
      if (!unlocked.identity) throw new Error("Bu cihazda bu hesap için geçerli anahtar yedeği bulunamadı.");
      await this.saveIdentity(unlocked.identity, this.authenticatedPassword || password);
      this.identityLoadError = null;
    },
    async saveIdentity(data, password) {
      const backupPassword = typeof password === "string" && password
        ? password
        : this.authenticatedPassword || this.identityBackupPassword;
      if (typeof backupPassword !== "string" || !backupPassword) {
        throw new Error("Şifreleme anahtarı yedeklenmedi: önce hesap parolanla kilit aç.");
      }
      const userId = data && data.userId != null ? data.userId : (this.me ? this.me.id : null);
      if (userId == null) throw new Error("Şifreleme anahtarı yedeklenmedi: hesap kimliği bilinmiyor.");
      const backup = await window.NabCrypto.encryptBackup(data, backupPassword);
      this.identity = data;
      AccountStorage.writeIdentity(userId, { encrypted: true, backup });
      this.identityBackupPassword = backupPassword;
    },
    clearIdentity() {
      this.identity = null;
      this.authenticatedPassword = null;
      this.identityBackupPassword = null;
      AccountStorage.removeIdentity(this.me ? this.me.id : null);
    },
    addMessage(phone, message) {
      if (!this.messages[phone]) this.messages[phone] = [];
      this.messages[phone] = this.messages[phone].filter((item) => !item.expiresAt || Date.now() < item.expiresAt);
      if (message.expiresAt && Date.now() >= message.expiresAt) return;
      this.messages[phone].push(message);
      if (window.AppDB && message.id != null) window.AppDB.saveMessage(phone, message).catch(() => {});
      if (UI._activeChatPhone !== phone) this.unread[phone] = (this.unread[phone] || 0) + 1;
    },
  };

  const Auth = {
    _phone: "",
    _flowToken: "",
    _busy: false,
    setError(id, message) { byId(id).textContent = message || ""; },
    clearErrors() { document.querySelectorAll(".auth-error").forEach((node) => { node.textContent = ""; }); },
    showStep(id) {
      document.querySelectorAll(".auth-step").forEach((step) => step.classList.toggle("active", step.id === id));
      const step = byId(id);
      const input = step && step.querySelector("input");
      if (input) setTimeout(() => input.focus(), 0);
      if (id === "step-phone") this.renderKnownAccounts();
    },
    renderKnownAccounts() {
      const box = byId("known-accounts");
      if (!box) return;
      const phones = AccountStorage.listAccounts();
      box.textContent = "";
      if (!phones.length) { box.classList.add("hidden"); return; }
      box.classList.remove("hidden");
      const title = document.createElement("p");
      title.className = "utility-lede";
      title.textContent = "Bu tarayıcıda açık oturumu olan hesaplar:";
      box.append(title);
      for (const phone of phones) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "soft-button";
        button.textContent = phone;
        button.addEventListener("click", () => {
          const field = byId("phone-input");
          field.value = phone;
          field.focus();
        });
        box.append(button);
      }
    },
    async requestCode(phone) {
      this.clearErrors();
      this._phone = phone.trim();
      try {
        const result = await API.requestCode(this._phone);
        if (!result.sent) throw new Error(result.message || "SMS gönderilemedi.");
        this.showStep("step-code");
      } catch (error) { this.setError("phone-error", error.message); }
    },
    async resendCode() {
      try {
        const result = await API.resendCode(this._phone);
        if (!result.sent) throw new Error(result.message || "SMS gönderilemedi.");
        UI.showToast("Yeni kod gönderildi.");
      } catch (error) { this.setError("code-error", error.message); }
    },
    async verifyCode(code) {
      this.clearErrors();
      try {
        const result = await API.verifyCode(this._phone, code);
        this._flowToken = result.flowToken;
        if (result.isNew) this.showStep("step-register");
        else this.showStep("step-2fa");
      } catch (error) { this.setError("code-error", error.message); }
    },
    async completeRegister(displayName, password, confirmation) {
      this.clearErrors();
      if (password !== confirmation) return this.setError("register-error", "Parolalar eşleşmiyor.");
      if (!window.NabCrypto) return this.setError("register-error", "Şifreleme bileşeni yüklenemedi. Sayfayı yenileyin.");
      try {
        const generated = await window.NabCrypto.generateIdentity();
        const prekeys = await window.NabCrypto.generatePrekeyBatch(1, 50);
        const response = await API.completeAuth({
          flowToken: this._flowToken,
          displayName: displayName.trim(),
          password,
          identityPub: generated.identity.pubJwk,
          identitySignPub: generated.identitySign.pubJwk,
          signedPrekeyPub: generated.signedPrekey.pubJwk,
          signedPrekeySig: generated.signedPrekeySig,
          prekeys: prekeys.map(({ keyId, publicKey }) => ({ keyId, publicKey })),
        });
        await Store.saveIdentity({
          userId: response.user.id,
          identity: { privJwk: generated.identity.privJwk, pubJwk: generated.identity.pubJwk },
          identitySign: generated.identitySign,
          signedPrekey: { privJwk: generated.signedPrekey.privJwk, pubJwk: generated.signedPrekey.pubJwk },
          signedPrekeySig: generated.signedPrekeySig,
          prekeys: prekeys.map(({ keyId, privateKey }) => ({ keyId, privateKey })),
        }, password);
        setToken(response.token, response.user.phone);
        const others = AccountStorage.listAccounts().filter((phone) => phone !== response.user.phone);
        await this.finishLogin(password);
        if (others.length) {
          UI.showToast("Bu tarayıcıda başka bir hesabın oturumu da kayıtlı. Aynı anda iki hesap açık tutma; Ayarlar → HESAPLAR bölümünden hesap değiştirebilirsin.");
        }
      } catch (error) { this.setError("register-error", error.message); }
    },
    async login(password, twofaCode) {
      this.clearErrors();
      try {
        const result = await API.login(this._phone, password, twofaCode);
        setToken(result.token, result.user.phone);
        await this.finishLogin(password);
      } catch (error) {
        this.setError("twofa-error", error.message);
        if (error.data && error.data.twofaRequired) byId("totp-input").focus();
      }
    },
    async finishLogin(identityPassword) {
      byId("auth-screen").hidden = true;
      byId("app-screen").classList.remove("hidden");
      try {
        await Store.init(identityPassword);
        this._phone = Store.me.phone;
        UI.init();
        localStorage.removeItem(SCREEN_LOCKED_KEY);
        localStorage.removeItem("nabapp-lock-password");
        UI.showMobileOnboarding();
        UI.startScreenLockMonitor();
        WS.connect();
        UI.renderChatList();
        UI.activatePage("chats");
      } catch (error) {
        clearToken();
        byId("app-screen").classList.add("hidden");
        byId("auth-screen").hidden = false;
        this.showStep("step-phone");
        this.setError("phone-error", error.message);
      }
    },
    lockScreen(force = false) {
      if (!getToken() || (!force && localStorage.getItem(SCREEN_LOCKED_KEY) === "1")) return;
      localStorage.setItem(SCREEN_LOCKED_KEY, "1");
      clearTimeout(UI._screenLockTimer);
      WS.close();
      Calls.end(false);
      UI.clearSensitiveState();
      byId("app-screen").classList.add("hidden");
      byId("auth-screen").hidden = false;
      this.showStep("step-lock");
      byId("lock-password-input").value = "";
      byId("lock-twofa-input").value = "";
      byId("lock-password-input").focus();
    },
    async unlockScreen(password, twofaCode) {
      try {
        await API.reauthenticate(password, twofaCode);
        await Store.init(password);
        if (!Store.identity) {
          UI.showToast(hasEncryptedIdentityBackup(Store.me ? Store.me.id : null)
            ? "Bu cihazdaki şifreleme anahtarı bu hesapla açılamadı. Ayarlar → ŞİFRELEME ANAHTARLARI bölümünden eski parolayla açabilirsin."
            : "Bu cihazda bu hesabın şifreleme anahtarları yok. Ayarlar → ŞİFRELEME ANAHTARLARI bölümünden yedek dosyasını geri yükle.", "error");
        }
        this._phone = Store.me.phone;
        localStorage.removeItem(SCREEN_LOCKED_KEY);
        this.clearErrors();
        byId("auth-screen").hidden = true;
        byId("app-screen").classList.remove("hidden");
        UI.renderChatList();
        UI.activatePage("chats");
        UI.startScreenLockMonitor();
        WS.connect();
        byId("lock-password-input").value = "";
        byId("lock-twofa-input").value = "";
      } catch (error) {
        WS.close();
        UI.clearSensitiveState();
        this.setError("lock-error", error.message);
        if (error.data && error.data.twofaRequired) byId("lock-twofa-input").focus();
      }
    },
    expired() {
      clearToken();
      localStorage.removeItem(SCREEN_LOCKED_KEY);
      localStorage.removeItem("nabapp-lock-password");
      WS.close();
      Calls.end(false);
      UI.clearSensitiveState();
      byId("app-screen").classList.add("hidden");
      byId("auth-screen").hidden = false;
      this._phone = "";
      this.showStep("step-phone");
      this.setError("phone-error", "Oturumun sona erdi. Yeniden giriş yap.");
    },
    async logout(remote = true, clearIdentity = false) {
      try {
        if (remote && getToken()) await API.logout();
      } catch (error) {
        console.warn("Sunucu oturumu kapatılamadı; bu cihazdaki oturum yine de temizleniyor.", error);
      }
      clearToken();
      localStorage.removeItem(SCREEN_LOCKED_KEY);
      localStorage.removeItem("nabapp-lock-password");
      if (clearIdentity) Store.clearIdentity();
      WS.close();
      window.location.reload();
    },
  };

  const Calls = {
    peer: null,
    stream: null,
    callId: null,
    peerPhone: null,
    pendingCandidates: [],
    async start(video) {
      const peerPhone = UI._activeChatPhone;
      if (!peerPhone || peerPhone.startsWith("group:")) {
        UI.showToast("Şu anda bire bir sohbetlerde arama yapılabilir.");
        return;
      }
      if (video && !await UI.requestAppPermission("camera")) return;
      if (!WS._ws || WS._ws.readyState !== WebSocket.OPEN) {
        UI.showToast("Arama için çevrimiçi bağlantı gerekli.");
        return;
      }
      try {
        this.callId = createScopedId("c", Store.me.id, peerPhone);
        this.peerPhone = peerPhone;
        await this.setupPeer(video);
        const description = await this.peer.createOffer();
        await this.peer.setLocalDescription(description);
        WS.send("signal", { to: peerPhone, callId: this.callId, signal: { type: "offer", description } });
        this.show("Aranıyor…");
      } catch (error) {
        await this.end(false);
        UI.showToast(`Arama başlatılamadı: ${error.message}`, "error");
      }
    },
    async setupPeer(video) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      this.peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.peerPhone = this.peerPhone || UI._activeChatPhone;
      this.peer.onicecandidate = (event) => {
        if (event.candidate) WS.send("signal", {
          to: this.peerPhone, callId: this.callId, signal: { type: "candidate", candidate: event.candidate },
        });
      };
      this.peer.ontrack = (event) => { byId("remote-video").srcObject = event.streams[0]; };
      this.peer.onconnectionstatechange = () => {
        if (this.peer?.connectionState === "connected") this.show("Bağlandı");
        if (["failed", "disconnected"].includes(this.peer?.connectionState)) this.show("Bağlantı kesildi; TURN sunucusu gerekebilir.");
      };
      this.stream.getTracks().forEach((track) => this.peer.addTrack(track, this.stream));
      byId("local-video").srcObject = this.stream;
    },
    async handleSignal(message) {
      const signal = message.signal || {};
      if (signal.type === "offer") {
        if (this.peer || !window.confirm(`${message.from} sizi arıyor. Arama kabul edilsin mi?`)) {
          WS.send("signal", { to: message.from, callId: message.callId, signal: { type: "hangup" } });
          return;
        }
        try {
          this.callId = message.callId;
          this.peerPhone = message.from;
          const video = Boolean(signal.description?.sdp?.includes("m=video"));
          if (video && !await UI.requestAppPermission("camera")) {
            WS.send("signal", { to: message.from, callId: message.callId, signal: { type: "hangup" } });
            await this.end(false);
            return;
          }
          await this.setupPeer(video);
          await this.peer.setRemoteDescription(signal.description);
          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);
          await this.flushCandidates();
          WS.send("signal", { to: this.peerPhone, callId: this.callId, signal: { type: "answer", description: answer } });
          this.show("Arama bağlanıyor…");
        } catch (error) {
          await this.end(true);
          UI.showToast(`Arama kabul edilemedi: ${error.message}`, "error");
        }
      } else if (signal.type === "answer" && this.peer && message.callId === this.callId) {
        await this.peer.setRemoteDescription(signal.description);
        await this.flushCandidates();
      } else if (signal.type === "candidate" && this.peer && message.callId === this.callId) {
        if (this.peer.remoteDescription) await this.peer.addIceCandidate(signal.candidate);
        else this.pendingCandidates.push(signal.candidate);
      } else if (signal.type === "hangup" && message.callId === this.callId) {
        await this.end(false);
        UI.showToast("Arama sonlandırıldı.");
      }
    },
    async flushCandidates() {
      for (const candidate of this.pendingCandidates.splice(0)) await this.peer.addIceCandidate(candidate);
    },
    show(status) {
      byId("call-status").textContent = status;
      byId("call-overlay").classList.remove("hidden");
    },
    async end(notifyPeer) {
      if (notifyPeer && this.peerPhone && this.callId) {
        WS.send("signal", { to: this.peerPhone, callId: this.callId, signal: { type: "hangup" } });
      }
      if (this.peer) this.peer.close();
      if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
      this.peer = null;
      this.stream = null;
      this.callId = null;
      this.peerPhone = null;
      this.pendingCandidates = [];
      byId("local-video").srcObject = null;
      byId("remote-video").srcObject = null;
      byId("call-overlay").classList.add("hidden");
    },
  };

  const P2P = {
    _peers: new Map(),
    _retiredSessions: new Map(),
    _ice: [{ urls: "stun:stun.l.google.com:19302" }],

    peer(phone, sessionId) {
      let entry = this._peers.get(phone);
      if (entry && sessionId && entry.sessionId !== sessionId) {
        this.drop(phone, false);
        entry = null;
      }
      if (entry) return entry;
      const pc = new RTCPeerConnection({ iceServers: this._ice });
      const contactId = Store.contacts.find((item) => item.phone === phone)?.id || phone;
      entry = {
        pc, channel: null, pending: [], connecting: false, retryTimer: null,
        sessionId: sessionId || createScopedId("s", Store.me.id, contactId),
      };
      this._peers.set(phone, entry);
      pc.onicecandidate = (event) => {
        if (event.candidate) WS.send("signal", {
          to: phone, callId: entry.sessionId,
          signal: { purpose: "data", type: "candidate", candidate: event.candidate },
        });
      };
      pc.ondatachannel = (event) => this.bind(phone, entry, event.channel);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          entry.connecting = false;
          clearTimeout(entry.retryTimer);
          this.flush(phone);
        }
        else if (pc.connectionState === "failed" || pc.connectionState === "closed") this.drop(phone, true);
      };
      return entry;
    },

    bind(phone, entry, channel) {
      entry.channel = channel;
      channel.onopen = () => {
        entry.connecting = false;
        clearTimeout(entry.retryTimer);
        this.flush(phone);
      };
      channel.onclose = () => {
        if (entry.channel === channel) {
          entry.channel = null;
          UI.showTyping(phone, false);
        }
      };
      channel.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        WS.handlePeerData(phone, data);
      };
    },

    shouldInitiate(phone) { return Boolean(Store.me) && Store.me.phone < phone; },

    async ensureConnected(phone) {
      if (!this.shouldInitiate(phone)) return false;
      const entry = this.peer(phone);
      if (entry.channel && entry.channel.readyState === "open") return true;
      if (entry.connecting) return false;
      entry.connecting = true;
      if (!entry.channel) this.bind(phone, entry, entry.pc.createDataChannel("nabapp", { ordered: true }));
      const retry = () => {
        clearTimeout(entry.retryTimer);
        entry.retryTimer = setTimeout(() => {
          if (this._peers.get(phone) !== entry || UI._activeChatPhone !== phone ||
              entry.channel && entry.channel.readyState === "open") return;
          this.drop(phone, false);
          this.ensureConnected(phone);
        }, 20_000);
      };
      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        if (!WS.send("signal", { to: phone, callId: entry.sessionId, signal: { purpose: "data", type: "offer", description: entry.pc.localDescription } })) {
          entry.connecting = false;
          retry();
          return false;
        }
        retry();
        return true;
      } catch (error) {
        entry.connecting = false;
        console.warn("[p2p] Teklif oluşturulamadı:", error);
        retry();
        return false;
      }
    },

    async handleSignal(message) {
      const phone = message.from;
      const signal = message.signal || {};
      if (UI._activeChatPhone !== phone || typeof message.callId !== "string") return;
      if (this._retiredSessions.get(phone)?.has(message.callId)) return;
      let entry = this._peers.get(phone);
      if (signal.type === "offer") {
        entry = this.peer(phone, message.callId);
      } else if (signal.type === "candidate" && !entry) {
        entry = this.peer(phone, message.callId);
      } else if (!entry || entry.sessionId !== message.callId) {
        return;
      }
      try {
        if (signal.type === "offer") {
          await entry.pc.setRemoteDescription(signal.description);
          await this.flushCandidates(entry);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          WS.send("signal", { to: phone, callId: entry.sessionId, signal: { purpose: "data", type: "answer", description: entry.pc.localDescription } });
        } else if (signal.type === "answer") {
          if (entry.pc.signalingState === "have-local-offer") {
            await entry.pc.setRemoteDescription(signal.description);
            await this.flushCandidates(entry);
          }
        } else if (signal.type === "candidate") {
          if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(signal.candidate);
          else entry.pending.push(signal.candidate);
        }
      } catch (error) {
        console.warn("[p2p] Sinyal işlenemedi:", error);
        this.drop(phone, false);
      }
    },

    async flushCandidates(entry) {
      for (const candidate of entry.pending.splice(0)) {
        try { await entry.pc.addIceCandidate(candidate); } catch {}
      }
    },

    send(phone, payload) {
      const entry = this._peers.get(phone);
      const channel = entry && entry.channel;
      if (channel && channel.readyState === "open") {
        try { channel.send(JSON.stringify(payload)); return true; }
        catch (error) { console.warn("[p2p] Gönderilemedi:", error); }
      }
      return false;
    },

    async flush(phone) {
      if (!window.AppDB) return;
      let queued = [];
      try { queued = await window.AppDB.getQueuedMessages(); } catch { return; }
      for (const item of queued) {
        if (item.toPhone !== phone) continue;
        const ok = this.send(phone, {
          type: "envelope", from: Store.me.phone, to: phone, msgId: item.msgId,
          groupId: item.groupId ?? null, ciphertext: item.ciphertext,
          ratchetHeader: item.ratchetHeader, ts: item.ts,
        });
        if (ok) {
          await window.AppDB.removeQueuedMessage(item.id);
          UI.updateReceipt(item.chatId || phone, item.msgId, "sent");
        }
      }
    },

    async sync() {
      const phone = UI._activeChatPhone;
      if (phone && !phone.startsWith("group:") && UI._online.has(phone)) await this.ensureConnected(phone);
    },

    drop(phone, reconnect) {
      const entry = this._peers.get(phone);
      if (!entry) return;
      clearTimeout(entry.retryTimer);
      if (!this._retiredSessions.has(phone)) this._retiredSessions.set(phone, new Set());
      const retired = this._retiredSessions.get(phone);
      retired.add(entry.sessionId);
      if (retired.size > 32) retired.delete(retired.values().next().value);
      try { entry.pc.close(); } catch {}
      this._peers.delete(phone);
      UI.showTyping(phone, false);
      if (reconnect && UI._activeChatPhone === phone) setTimeout(() => this.ensureConnected(phone), 2000);
    },
  };

  const WS = {
    _ws: null,
    _retryDelay: 1000,
    _retryTimer: null,
    _manualClose: false,
    connect() {
      if (!getToken() || this._ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this._ws.readyState)) return;
      this._manualClose = false;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = this._ws = new WebSocket(`${scheme}//${location.host}/ws?token=${encodeURIComponent(getToken())}`);
      socket.addEventListener("open", async () => {
        this._retryDelay = 1000;
        try { await P2P.sync(); } catch (error) { console.warn(error); }
      });
      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", () => {
        if (this._manualClose || !getToken()) return;
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.connect(), this._retryDelay);
        this._retryDelay = Math.min(this._retryDelay * 2, 30000);
      });
      socket.addEventListener("error", () => socket.close());
    },
    close() {
      this._manualClose = true;
      clearTimeout(this._retryTimer);
      if (this._ws) this._ws.close();
      this._ws = null;
    },
    send(type, payload) {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
      this._ws.send(JSON.stringify({ type, ...payload }));
      return true;
    },
    async sendToPhone(toPhone, plaintext, msgId, groupId = null) {
      const identity = Store.identity;
      if (!identity) throw missingIdentityError();
      let entry = Store.sessions[toPhone];
      if (!entry) {
        const bundle = await API.getKeyBundle(toPhone);
        await Store.trustContactKey(toPhone, bundle.identityPub, bundle.identitySignPub);
        const sessionInfo = await window.NabCrypto.establishSession({
          identityPub: bundle.identityPub,
          identitySignPub: bundle.identitySignPub,
          signedPrekeyPub: bundle.signedPrekeyPub,
          signedPrekeySig: bundle.signedPrekeySig,
          oneTimePrekey: bundle.oneTimePrekey,
        }, identity.identity);
        entry = Store.sessions[toPhone] = { session: sessionInfo.session, setup: sessionInfo.setup };
      }
      const encrypted = await window.NabCrypto.ratchetSend(entry.session, plaintext);
      const header = { ...encrypted.header };
      if (entry.setup) {
        header.ephemeralPub = entry.setup.ephemeralPub;
        header.identityPub = identity.identity.pubJwk;
        header.identitySignPub = identity.identitySign.pubJwk;
        header.signedPrekeyPub = identity.signedPrekey.pubJwk;
        header.signedPrekeySig = identity.signedPrekeySig;
        header.oneTimeKeyId = entry.setup.oneTimeKeyId;
        entry.setup = null;
      }
      const contact = Store.contacts.find((item) => item.phone === toPhone);
      const chatId = groupId == null ? toPhone : `group:${groupId}`;
      const envelope = {
        type: "envelope", from: Store.me.phone, msgId, groupId,
        ciphertext: encrypted.ciphertext, ratchetHeader: header, ts: Date.now(),
      };
      if (P2P.send(toPhone, envelope)) return { contact, queued: false };
      
      if (window.AppDB) {
        await window.AppDB.queueOfflineMessage({
          toPhone, chatId, msgId, groupId,
          ciphertext: encrypted.ciphertext, ratchetHeader: header, ts: envelope.ts,
        });
      }
      P2P.ensureConnected(toPhone);
      return { contact, queued: true };
    },
    async sendMessage(chatId, plaintext) {
      const retentionMs = UI.getSensitiveMessageRetentionWindow(chatId);
      const expiresAt = retentionMs > 0 ? Date.now() + retentionMs : null;
      if (chatId.startsWith("group:")) {
        const groupId = Number(chatId.slice(6));
        const group = Store.groups.find((item) => item.id === groupId);
        if (!group) throw new Error("Grup bulunamadı.");
        const msgId = createScopedId("m", Store.me.id, groupId);
        const recipients = group.members.filter((member) => member.id !== Store.me.id);
        const payload = expiresAt
          ? JSON.stringify({ kind: "ephemeral-message", version: 1, text: plaintext, expiresAt })
          : plaintext;
        const results = await Promise.all(recipients.map((member) => this.sendToPhone(member.phone, payload, msgId, groupId)));
        const file = parseFilePayload(plaintext);
        Store.addMessage(chatId, {
          id: msgId, side: "mine", text: file ? `Dosya: ${file.name}` : plaintext,
          file, ts: Date.now(), status: results.some((result) => result.queued) ? "queued" : "sent", expiresAt,
        });
        if (navigator.vibrate) navigator.vibrate(15);
        UI.renderMessages(chatId);
        UI.renderChatList();
        return;
      }
      const msgId = createScopedId("m", Store.me.id, chatId);
      const payload = expiresAt
        ? JSON.stringify({ kind: "ephemeral-message", version: 1, text: plaintext, expiresAt })
        : plaintext;
      if (chatId === Store.me.phone) {
        const file = parseFilePayload(plaintext);
        Store.addMessage(chatId, {
          id: msgId, side: "mine",
          text: file ? `Dosya: ${file.name}` : plaintext,
          file, ts: Date.now(), status: "sent", expiresAt,
        });
        UI.renderMessages(chatId);
        UI.renderChatList();
        return;
      }
      const result = await this.sendToPhone(chatId, payload, msgId);
      const file = parseFilePayload(plaintext);
      Store.addMessage(chatId, {
        id: msgId, side: "mine", text: file ? `Dosya: ${file.name}` : plaintext,
        file, ts: Date.now(), status: result.queued ? "queued" : "sent", expiresAt,
      });
      if (result.queued) {
        UI.showToast("Mesaj bu cihazda sıraya alındı. Teslim için iki hesabın da açık ve çevrimiçi olması gerekir.");
      }
      if (navigator.vibrate) navigator.vibrate(15);
      UI.renderMessages(chatId);
      UI.renderChatList();
    },
    sendTyping(to, on) {
      if (to === Store.me.phone) return;
      P2P.send(to, { type: "typing", from: Store.me.phone, to, on });
    },
    async receiveEnvelope(message) {
      const phone = message.from;
      const contact = Store.contacts.find((item) => item.phone === phone);
      const groupId = message.groupId == null ? null : Number(message.groupId);
      let group = groupId === null ? null : Store.groups.find((item) => item.id === groupId);
      if (groupId !== null && !group) {
        const result = await API.getGroups();
        Store.groups = result.groups || [];
        group = Store.groups.find((item) => item.id === groupId);
      }
      if (groupId !== null && !group) throw new Error("Mesaj üyesi olmadığınız bir gruba ait.");
      if (!contact && groupId === null) {
        if (message.fromName) Store.addContact({ phone, displayName: message.fromName });
        else throw new Error("Gönderen kişi listende yok.");
      }
      const identity = Store.identity;
      if (!identity) throw missingIdentityError();
      const header = safeJson(message.ratchetHeader);
      if (!header || !header.ratchetPub) throw new Error("Şifreli mesaj başlığı geçersiz.");
      let entry = Store.sessions[phone];
      if (!entry) {
        await Store.trustContactKey(phone, header.identityPub, header.identitySignPub);
        const oneTimeKey = header.oneTimeKeyId == null ? null : (identity.prekeys || []).find((key) => key.keyId === header.oneTimeKeyId);
        if (header.oneTimeKeyId != null && !oneTimeKey) throw new Error("Bu cihazdaki tek kullanımlık anahtar bulunamadı.");
        const accepted = await window.NabCrypto.acceptSession(
          header,
          identity.identity,
          identity.signedPrekey.privJwk,
          oneTimeKey ? oneTimeKey.privateKey : null
        );
        if (oneTimeKey) {
          identity.prekeys = identity.prekeys.filter((key) => key.keyId !== oneTimeKey.keyId);
          Store.saveIdentity(identity).catch(() => {});
        }
        entry = Store.sessions[phone] = { session: accepted.session, setup: null };
      }
      const text = await window.NabCrypto.ratchetRecv(entry.session, header, message.ciphertext);
      const expiring = parseExpiringPayload(text);
      const content = expiring ? expiring.text : text;
      const expired = Boolean(expiring && Date.now() >= expiring.expiresAt);
      const chatId = groupId === null ? phone : `group:${groupId}`;
      const file = parseFilePayload(content);
      Store.addMessage(chatId, {
        id: message.msgId || createScopedId("m", Store.me.id, phone), side: "theirs",
        text: file ? `Dosya: ${file.name}` : content, file, ts: message.ts || Date.now(),
        expiresAt: expiring?.expiresAt ?? null,
      });
      if (UI._activeChatPhone === chatId) UI.renderMessages(chatId);
      UI.renderChatList();
      if (!expired && UI.getSecurityState().notificationProfile !== "silent" &&
          UI._activeChatPhone !== chatId && Store.me.settings?.notifications &&
          "Notification" in window && Notification.permission === "granted") {
        UI.showIncomingNotification(
          group ? group.name : contact ? contact.displayName : message.fromName || phone,
          file ? `Dosya: ${file.name}` : text,
        ).catch((error) => {
          console.error("Bildirim gösterilemedi:", error);
          UI.showToast("Mesaj bildirimi gösterilemedi.", "error");
        });
      }
      if (message.msgId) {
        this.sendReceipt(phone, message.msgId, "delivered");
        if (UI._activeChatPhone === chatId) this.sendReceipt(phone, message.msgId, "read");
      }
    },
    sendReceipt(to, msgId, kind) {
      P2P.send(to, { type: "receipt", from: Store.me.phone, msgId, kind });
    },
    _chatOfMessage(msgId) {
      for (const [chatId, list] of Object.entries(Store.messages)) {
        if (list.some((item) => String(item.id) === String(msgId))) return chatId;
      }
      return null;
    },
    sendReaction(chatId, msgId, emoji) {
      const message = (Store.messages[chatId] || []).find((item) => String(item.id) === String(msgId));
      if (message) {
        message.reactions = message.reactions || {};
        if (emoji) message.reactions[Store.me.phone] = emoji;
        else delete message.reactions[Store.me.phone];
        if (window.AppDB) window.AppDB.updateMessage(msgId, { reactions: message.reactions }).catch(() => {});
      }
      const payload = { type: "reaction", from: Store.me.phone, msgId, emoji: emoji || null, chatId };
      if (chatId.startsWith("group:")) {
        const group = Store.groups.find((item) => String(item.id) === chatId.slice(6));
        (group ? group.members : []).forEach((member) => {
          if (member.id !== Store.me.id) P2P.send(member.phone, payload);
        });
      } else {
        P2P.send(chatId, payload);
      }
      if (UI._activeChatPhone === chatId) UI.renderMessages(chatId);
    },
    applyReaction(phone, data) {
      const sender = data.from || phone;
      for (const [chatId, list] of Object.entries(Store.messages)) {
        const message = list.find((item) => String(item.id) === String(data.msgId));
        if (!message) continue;
        message.reactions = message.reactions || {};
        if (data.emoji) message.reactions[sender] = data.emoji;
        else delete message.reactions[sender];
        if (window.AppDB) window.AppDB.updateMessage(data.msgId, { reactions: message.reactions }).catch(() => {});
        if (UI._activeChatPhone === chatId) UI.renderMessages(chatId);
        return;
      }
    },
    handlePeerData(phone, data) {
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "envelope":
          this.receiveEnvelope({ ...data, from: phone })
            .catch((error) => UI.showToast(`Mesaj çözülemedi: ${error.message}`, "error"));
          break;
        case "typing": UI.showTyping(phone, Boolean(data.on)); break;
        case "receipt": UI.updateReceipt(this._chatOfMessage(data.msgId) || data.chatId || phone, data.msgId, data.kind || "delivered"); break;
        case "reaction": this.applyReaction(phone, data); break;
        case "DELETE_MSG": 
          if(data.targetId) {
             const chatId = this._chatOfMessage(data.targetId) || phone;
             Store.messages[chatId] = (Store.messages[chatId]||[]).filter(m => m.id !== data.targetId);
             if(window.AppDB) window.AppDB.deleteMessage(data.targetId).catch(()=>{});
             if(UI._activeChatPhone === chatId) UI.renderMessages(chatId);
          }
          break;
        default: break;
      }
    },
    async handleMessage(event) {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      switch (message.type) {
        case "presence":
          UI.updatePresence(message.online, message.lastSeen || {});
          P2P.sync().catch(() => {});
          break;
        case "pong": break;
        case "signal":
          if (message.signal && message.signal.purpose === "data") {
            P2P.handleSignal(message).catch((error) => console.error("[p2p] Sinyal hatası:", error));
          } else {
            Calls.handleSignal(message).catch((error) => {
              console.error("[call] Signaling failed:", error);
              UI.showToast("Arama sinyali işlenemedi.", "error");
            });
          }
          break;
      }
    },
  };

  async function start() {
    UI.init();
    localStorage.removeItem("nabapp-lock-password");
    if (getToken()) {
      let session = null;
      try { session = await API.getMe(); }
      catch {
        clearToken();
        localStorage.removeItem(SCREEN_LOCKED_KEY);
      }
      if (session) {
        Store.me = session.user;
        Auth._phone = session.user.phone;
        AccountStorage.adoptLegacyToken(session.user.phone, getToken());
        if (localStorage.getItem(SCREEN_LOCKED_KEY) === "1" ||
            hasEncryptedIdentityBackup(session.user.id)) {
          byId("auth-screen").hidden = false;
          byId("app-screen").classList.add("hidden");
          Auth.showStep("step-lock");
          return;
        }
        byId("auth-screen").hidden = true;
        byId("app-screen").classList.remove("hidden");
        try {
          await Store.init();
          WS.connect();
          UI.startScreenLockMonitor();
          UI.renderChatList();
          UI.activatePage("chats");
        } catch (error) {
          clearToken();
          byId("app-screen").classList.add("hidden");
          byId("auth-screen").hidden = false;
          Auth.setError("phone-error", error.message);
          Auth.showStep("step-phone");
        }
      } else {
        byId("auth-screen").hidden = false;
        byId("app-screen").classList.add("hidden");
        Auth.showStep("step-phone");
      }
    } else {
      byId("auth-screen").hidden = false;
      byId("app-screen").classList.add("hidden");
      Auth.showStep("step-phone");
    }
  }

  async function getDisplayName(number) {
    if(window.AppDB){
        try{
            const contact = await window.AppDB.getContact(number);
            return (contact && contact.name) ? contact.name : number;
        }catch(e){ return number; }
    }
    return number;
  }

  async function blockUser(number) {
     if(window.AppDB){
         await window.AppDB.addBlockedUser({ number });
     }
  }

  async function unblockUser(number) {
     if(window.AppDB){
         await window.AppDB.removeBlockedUser(number);
     }
  }

  async function deleteEntireChat(number) {
     if(window.AppDB){
         await window.AppDB.deleteChatHistory(number);
     }
  }

  async function deleteMessage(messageId, isMine, deleteForEveryone) {
    if(window.AppDB) await window.AppDB.deleteMessage(messageId); 

    if (isMine && deleteForEveryone) {
        if(UI._activeChatPhone) {
            P2P.send(UI._activeChatPhone, {
                type: 'DELETE_MSG',
                targetId: messageId
            });
        }
    }
  }

  const backupIntervals = {
    'Günlük': 86400000,
    'Haftalık': 604800000,
    'Aylık': 2592000000,
    'Yıllık': 31536000000
  };

  function scheduleBackup(userPreference) {
    if (userPreference === 'Hiç bir zaman') return;
    setInterval(async () => {
        if(window.exportIndexedDB){
           const backupData = await window.exportIndexedDB();
           if(window.saveToLocalFile) window.saveToLocalFile(backupData); 
        }
    }, backupIntervals[userPreference]);
  }

  const currentPref = localStorage.getItem("nabapp-backup-freq") || "Hiç bir zaman";
  scheduleBackup(currentPref);

  start();
})();