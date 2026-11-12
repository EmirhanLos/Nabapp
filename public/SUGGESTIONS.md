# Frontend Suggestions for Nabapp

Bu belge Nabapp frontend'in güvenlik, performans, UX ve kod kalitesi iyileştirmeleri için öneriler içerir.

## Güvenlik İyileştirmeleri

### Yüksek Öncelik
- **İçerik Güvenlik Politikası (CSP)** Uygula:
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
  ```

- **XSS Koruması Ekle**: Kullanıcı tarafından eklenen içerik için sanitize et
  ```javascript
  import DOMPurify from 'dompurify';
  const clean = DOMPurify.sanitize(userInput);
  ```

- **Güvenli localStorage İşleme**: Hassas verileri şifreleyerek sakla
  ```javascript
  const encrypted = CryptoJS.AES.encrypt(data, secretKey).toString();
  localStorage.setItem('key', encrypted);
  ```

- **Cihaz Tabanlı Şifreleme**: Yerel verileri cihaz anahtarıyla şifrele
  ```javascript
  // Web Crypto API kullan
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  ```

- **Token Yenileme Mekanizması**: Otomatik token yenileme
  ```javascript
  async function refreshToken() {
    const response = await fetch('/api/auth/refresh', {
      headers: { Authorization: `Bearer ${oldToken}` }
    });
    const { token } = await response.json();
    localStorage.setItem('token', token);
  }
  ```

### Orta Öncelik
- **HTTP Strict Transport Security (HSTS)**: HTTPS zorla
- **X-Frame-Options**: Clickjacking koruması
- **Subresource Integrity (SRI)**: Harici scriptlerin bütünlüğünü doğrula
- **Referrer Policy**: Referrer bilgisini kontrol et
- **Secure Cookies**: HTTPS için güvenli çerezler

## Performans İyileştirmeleri

### Yüksek Öncelik
- **Lazy Loading Uygula**: Sohbetleri tembel yükle
  ```javascript
  const lazyLoad = (element) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Yükle
          observer.unobserve(element);
        }
      });
    });
    observer.observe(element);
  };
  ```

- **Virtual Scrolling Ekle**: Mesaj listeleri için
  ```javascript
  import { useVirtualizer } from '@tanstack/react-virtual';
  // Büyük listeler için sanal kaydırma
  ```

- **Service Worker Uygula**: Çevrimdışı destek
  ```javascript
  // service-worker.js
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open('nabapp-v1').then((cache) => {
        return cache.addAll(['/', '/app.js', '/styles.css']);
      })
    );
  });
  ```

- **Göndermeden Önce Sıkıştırma Resimleri**: Dosya boyutunu azalt
  ```javascript
  async function compressImage(file) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    // Sıkıştırma mantığı
  }
  ```

- **Optimistik UI Güncellemeleri**: UI'ı hemen güncelle, arka planda sync et
  ```javascript
  function sendMessage(text) {
    // UI'ı hemen güncelle
    addMessageToUI({ text, status: 'sending' });
    // API çağrısı
    fetch('/api/messages', { /* ... */ });
  }
  ```

- **İstek Debouncing**: Arama ve diğer girdiler için
  ```javascript
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  ```

### Orta Öncelik
- **Code Splitting**: Kodu parçalara böl
  ```javascript
  const ChatModule = lazy(() => import('./ChatModule'));
  ```

- **Tree Shaking**: Kullanılmayan kodları kaldır
- **Asset Optimization**: Görselleri optimize et (WebP formatı)
- **Bundle Size Monitoring**: Bundle boyutunu izle
- **Critical CSS**: Kritik CSS'i inline et
- **Preload Resources**: Önemli kaynakları önceden yükle

## UX İyileştirmeleri

### Yüksek Öncelik
- **Gerçek Zamanlı Yazma Göstergeleri**:
  ```javascript
  // WebSocket ile yazma durumu
  socket.on('typing', ({ from, on }) => {
    if (on) showTypingIndicator(from);
    else hideTypingIndicator(from);
  });
  ```

- **Mesaj Okuma Alındısı**: Gönderilen, teslim edildi, okundu durumları
  ```javascript
  <div class="message-status">
    <span class="icon-sent">✓</span>
    <span class="icon-delivered">✓✓</span>
    <span class="icon-read">✓✓</span>
  </div>
  ```

- **Mesaj Durumu Göstergeleri**: Gönderildi, teslim edildi, okundu
- **Pull-to-Refresh**: Yenilemek için aşağı çek
  ```javascript
  let startY;
  container.addEventListener('touchstart', (e) => startY = e.touches[0].pageY);
  container.addEventListener('touchmove', (e) => {
    const y = e.touches[0].pageY - startY;
    if (y > 100) refreshChats();
  });
  ```

- **Kaydırma Jestleri**: Eylemler için kaydırma hareketleri
  ```javascript
  let touchStartX;
  message.addEventListener('touchstart', (e) => touchStartX = e.touches[0].clientX);
  message.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (diff > 50) showReplyOptions();
    if (diff < -50) showDeleteOptions();
  });
  ```

- **Haptik Geri Bildirim**: Dokunsal geri bildirim
  ```javascript
  function hapticFeedback() {
    if (navigator.vibrate) navigator.vibrate(50);
  }
  ```

- **Koyu/Açık Tema Geçişi**: Tema seçimi
  ```javascript
  function toggleTheme() {
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  }
  ```

- **Mesaj Arama**: Mesajlarda arama
  ```javascript
  function searchMessages(query) {
    return chats.flatMap(chat =>
      chat.messages.filter(msg => msg.text.includes(query))
    );
  }
  ```

- **Mesaj Tepki/Emoji Desteği**: Mesajlara emoji ekle
  ```javascript
  function addReaction(messageId, emoji) {
    // React ekle API çağrısı
  }
  ```

### Orta Öncelik
- **Mesaj İletme**: Mesajları başkalarına ilet
- **Mesaj Düzenleme/Silme**: Gönderilen mesajları düzenle/sil
- **Mesaj Yanıtla**: Mesajları yanıtla
- **Rehber Grupları/Favoriler**: Kişileri grupla
- **Sohbet Bazlı Bildirimleri Sustur**: Bildirimleri sustur
- **Arşivlenmiş Sohbetler**: Sohbetleri arşivle
- **Mesajları Kopyala**: Metni kopyala
- **Mesajları Öne Çıkar**: Önemli mesajları işaretle
- **Mention Sistemi**: Kullanıcıları etiketle (@kullanıcı)
- **Spam Filtresi**: İstenmeyen mesajları filtrele
- **Okunmamış Mesaj Sayısı**: Okunmamış mesajları göster
- **Son Görülme Ayarı**: Son görülme paylaşımını kontrol et
- **Profil Resmi Yükleme**: Profil resmini yükle ve değiştir
- **Durum Mesajı**: Durum/ayarla mesajı ekle
- **Sohbet Duvar Kağıdı**: Sohbet arka planını değiştir
- **Sesli Arama**: WebRTC ile sesli arama
- **Görüntülü Arama**: WebRTC ile görüntülü arama
- **Ekran Paylaşımı**: Ekran paylaşımı desteği
- **Dosya Önizleme**: Dosyaları önizle
- **Konum Paylaşımı**: Canlı konum paylaş
- **QR Kod ile Kişi Ekle**: QR kod ile kişi ekle
- **Grup Bilgileri**: Grup üyelerini ve bilgilerini göster
- **Yönetici Hakları**: Grup yöneticisi hakları
- **Mesaj Bildirimleri**: Tarayıcı bildirimleri
- **Sesli Mesaj Önizleme**: Sesli mesajı hızlı önizle
- **Video Önizleme**: Videoyu hızlı önizle
- **GIF Desteği**: GIF gönderme ve gösterme
- **Sticker Desteği**: Sticker gönderme
- **Voice-to-Text**: Sesli mesajı metne çevir
- **Otomatik Çeviri**: Mesajları otomatik çevir
- **Emoji Picker**: Gelişmiş emoji seçici
- **Klavye Kısayolları**: Klavye kısayolları
- **Karanlık Mod Animasyonu**: Tema geçiş animasyonu
- **Skeleton Loading**: Yükleme animasyonu
- **Error Boundaries**: Hata sınırları
- **Yeniden Bağlanma Göstergesi**: Bağlantı durumu göster
- **İnternet Bağlantısı Durumu**: Bağlantı durumunu göster
- **Veri Kullanımı İstatistikleri**: Veri kullanımını göster
- **Depolama Kullanımı**: Depolama kullanımını göster
- **Uygulama Boyutu İstatistikleri**: Uygulama boyutunu göster

## Kod Kalitesi

### Yüksek Öncelik
- **TypeScript'e Geçiş**: Tip güvenliği ekle
  ```typescript
  interface Message {
    id: string;
    text: string;
    sender: 'mine' | 'theirs';
    timestamp: number;
  }
  ```

- **State Management Uygula**: Redux veya Zustand
  ```javascript
  import { create } from 'zustand';
  const useChatStore = create((set) => ({
    chats: [],
    addChat: (chat) => set((state) => ({ chats: [...state.chats, chat] }))
  }));
  ```

- **Kapsamlı Hata Sınırları**: React Error Boundaries
  ```javascript
  class ErrorBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError(error) {
      return { hasError: true };
    }
    render() {
      if (this.state.hasError) return <ErrorFallback />;
      return this.props.children;
    }
  }
  ```

- **Bileşen Tabanlı Mimari**: Bileşenleri modüler hale getir
  ```javascript
  // components/MessageBubble.js
  export function MessageBubble({ message }) {
    return <div className="bubble">{message.text}</div>;
  }
  ```

### Orta Öncelik
- **E2E Testleri**: Playwright veya Cypress
  ```javascript
  test('can send a message', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.fill('#message-input', 'Hello');
    await page.click('.send-button');
    await expect(page.locator('.message-bubble')).toContainText('Hello');
  });
  ```

- **Unit Testleri**: Jest veya Vitest
  ```javascript
  test('sendMessage should add message to chat', () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.sendMessage('Hello'));
    expect(result.current.chats[0].messages).toHaveLength(1);
  });
  ```

- **PWA Manifest Uygula**: Progressive Web App
  ```json
  {
    "name": "Nabapp",
    "short_name": "Nabapp",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#07080c",
    "theme_color": "#07080c"
  }
  ```

- **Erişilebilirlik İyileştirmeleri**: ARIA etiketleri, klavye navigasyonu
  ```html
  <button aria-label="Send message" role="button">
    <svg>...</svg>
  </button>
  ```

- **Linting**: ESLint ve Prettier
  ```json
  {
    "extends": ["eslint:recommended", "plugin:react/recommended"],
    "rules": {
      "no-unused-vars": "error",
      "react/prop-types": "off"
    }
  }
  ```

- **Code Splitting**: Kodu dinamik import ile böl
  ```javascript
  const ChatView = React.lazy(() => import('./ChatView'));
  ```

- **Bundle Analyzer**: Bundle boyutunu analiz et
  ```javascript
  const withBundleAnalyzer = require('@next/bundle-analyzer')();
  ```

## Responsive Design

### Öneriler
- **Mobile-First Design**: Önce mobil tasarım
- **Touch-Optimized UI**: Dokunmatik optimizasyonu
- **Adaptive Layout**: Adaptif düzen
- **Fluid Typography**: Akışkan tipografi
- **Responsive Images**: Duyarlı görseller
- **Viewport Meta Tag**: Viewport meta etiketi
- **Orientation Change**: Yönlendirme değişikliği desteği
- **Safe Area Insets**: Güvenli alan iç boşlukları

## Animasyonlar ve Görsel Geri Bildirim

### Öneriler
- **Smooth Transitions**: Yumuşak geçişler
- **Loading States**: Yükleme durumları
- **Micro-interactions**: Mikro olaylar
- **Animation Performance**: Animasyon performansı
- **GPU Acceleration**: GPU hızlandırma
- **Animation Libraries**: Framer Motion veya GSAP
  ```javascript
  import { motion } from 'framer-motion';
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3 }}
  >
    Message
  </motion.div>
  ```

## Erişilebilirlik (Accessibility)

### Öneriler
- **ARIA Labels**: ARIA etiketleri
- **Keyboard Navigation**: Klavye navigasyonu
- **Screen Reader Support**: Ekran okuyucu desteği
- **Focus Management**: Odak yönetimi
- **Color Contrast**: Renk kontrastı
- **Text Scaling**: Metin ölçekleme
- **Reduced Motion**: Azaltılmış hareket desteği
- **Alt Text**: Alt metin
- **Semantic HTML**: Anlamsal HTML

## İzleme ve Analitik

### Öneriler
- **Error Tracking**: Hata takibi (Sentry)
  ```javascript
  import * as Sentry from '@sentry/browser';
  Sentry.init({ dsn: 'YOUR_DSN' });
  ```

- **User Analytics**: Kullanıcı analitiği
- **Performance Monitoring**: Performans izleme
- **A/B Testing**: A/B testi
- **Feature Flags**: Özellik bayrakları
- **User Feedback**: Kullanıcı geri bildirimi

## Uygulama Önceliği

1. **Aşama 1 (Acil)**: CSP, XSS koruması, güvenli localStorage
2. **Aşama 2 (Kısa vadeli)**: Lazy loading, service worker, optimistik UI
3. **Aşama 3 (Orta vadeli)**: TypeScript, state management, testler
4. **Aşama 4 (Uzun vadeli)**: Gelişmiş UX özellikleri, animasyonlar

## Test Kontrol Listesi

- [ ] Tüm önemli kullanıcı akışları test edilir
- [ ] Erişilebilirlik testleri yapılır
- [ ] Performans testleri yapılır
- [ ] Cross-browser testleri yapılır
- [ ] Mobile testleri yapılır
- [ ] Güvenlik testleri yapılır
- [ ] Ağ koşulları test edilir (yavaş ağ, çevrimdışı)
- [ ] Geri bildirim mekanizmaları test edilir

## Yeni, uygulanabilir güvenlik ve tasarım önerileri

Bu başlıklar ürün davranışına doğrudan bağlanmalıdır; örnek sayaç, sahte güven puanı veya yalnızca arayüzde çalışan güvenlik anahtarı olarak sunulmamalıdır.

- **Oturum kilidi ve yeniden doğrulama:** Parolayı tarayıcı depolamasında tutma. Kilit açılırken sunucu parolasını, hesapta 2FA açıksa tek kullanımlık kodu doğrulasın; kilitliyken çözülmüş mesajlar ve medya URL'leri bellekten temizlensin.
- **Gerçek dosya politikası:** Uzantı ve boyut sınırlarını gönderme anında zorunlu uygula; arşiv/Office türlerini uyarı, engelleme veya açık izin tercihine bağla. MIME ve içerik imzası uyuşmazlıklarını da ayrıca denetle.
- **Gerçek oturum özeti:** Güvenlik olayları kartı sabit örnek sayılar göstermesin; yalnızca sunucudan gelen oturumları saysın ve erişilemiyorsa açık hata göstersin.
- **Süreli mesaj protokolü:** Son kullanma bilgisini E2E şifreli içerikle alıcıya taşı ve iki istemcide de süresi dolan içeriği gösterme. İstemci tarafı saklama, teslim edilmeyen sunucu kuyruğunun otomatik silindiği anlamına gelmez; bunun için sunucu saklama politikası gerekir.
- **Cihaz güveninin sınırı:** Tarayıcıda saklanan etiketleri “güvenilir cihaz” diye adlandırma. Gerçek cihaz güveni isteniyorsa sunucuda cihaz kimliği, doğrulama, oturum iptali ve kurtarma akışı gerekir.
- **Erişilebilir ayar kontrolleri:** Segmented kontrollerde `aria-pressed` ve grup adı kullan; kullanıcı tercihlerini gerçek uygulama akışına bağlamadan etkin olarak göstermeme.
