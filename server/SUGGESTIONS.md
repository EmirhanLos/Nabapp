# Backend Suggestions for Nabapp

Bu belge Nabapp backend'in güvenlik, performans ve kod kalitesi iyileştirmeleri için öneriler içerir.

## Güvenlik İyileştirmeleri

### Yüksek Öncelik
- **Helmet Middleware Ekle**: HTTP güvenlik başlıklarını ayarla (CSP, HSTS, X-Frame-Options vb.)
  ```javascript
  const helmet = require('helmet');
  app.use(helmet());
  ```

- **CSRF Koruması Uygula**: Durum değiştiren istekler için CSRF tokenları kullan
  ```javascript
  const csrf = require('csurf');
  const csrfProtection = csrf({ cookie: true });
  ```

- **İstek Gövdesi Doğrulama**: `express-validator` veya `joi` ile tüm gelen verileri doğrula
  ```javascript
  const { body, validationResult } = require('express-validator');
  router.post('/auth/login', [
    body('phone').isMobilePhone(),
    body('password').isLength({ min: 8 })
  ], (req, res) => { /* ... */ });
  ```

- **CORS Yapılandırma**: `cors` paketi ile katı origin beyaz liste kullan
  ```javascript
  const cors = require('cors');
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));
  ```

- **Uygun Günlük Kaydı**: `winston` veya `pino` ile yapılandırılmış loglama
  ```javascript
  const winston = require('winston');
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.File({ filename: 'combined.log' })]
  });
  ```

### Orta Öncelik
- **API Sürümleme**: Sürümlü API rotaları (örn. `/api/v1/`, `/api/v2/`)
- **İstek İmzası Doğrulama**: Hassas işlemler için istek imzalarını doğrula
- **Cihaz Parmak İzi**: Şüpheli giriş denemelerini tespit etmek için cihazları takip et
- **IP Beyaz Liste**: Yönetici uç noktaları veya hassas işlemler için
- **Kullanıcı Bazlı Hız Sınırlama**: Kullanıcı ID'sine göre daha ayrıntılı hız sınırlama

## Performans ve Ölçeklenebilirlik

### Yüksek Öncelik
- **Yanıt Sıkıştırma**: `compression` middleware kullan
  ```javascript
  const compression = require('compression');
  app.use(compression());
  ```

- **Önbelleleme Katmanı Ekle**: Redis şunlar için kullan:
  - Hız sınırlama depolama
  - Kullanıcı varlığı takibi
  - Oturum yönetimi
  - Mesaj teslim durumu
  ```javascript
  const redis = require('redis');
  const client = redis.createClient();
  ```

- **Güçlü Kapanım İşleme**: SIGTERM/SIGINT işleyerek bağlantıları düzgünce kapat
  ```javascript
  process.on('SIGTERM', async () => {
    await closeDatabase();
    await closeRedis();
    server.close();
  });
  ```

### Orta Öncelik
- **Sağlık Kontrol Uç Noktası**: Yük dengeleyiciler için `/health` uç noktası
- **Veritabanı Yedekleme Zamanlaması**: Otomatik SQLite yedeklemeleri
- **İstek Zaman Aşımı**: Tüm istekler için makul zaman aşımları
- **WebSocket Bağlantısı Keep-Alive**: WebSocket için HTTP keep-alive yapılandır
- **Metrik Toplama**: İzleme için Prometheus veya benzeri

## Kod Kalitesi

### Yüksek Öncelik
- **TypeScript'e Geçiş**: Kod tabanında tip güvenliği ekle
  ```json
  {
    "devDependencies": {
      "typescript": "^5.0.0",
      "@types/node": "^20.0.0",
      "@types/express": "^4.17.0"
    }
  }
  ```

- **Kapsamlı Hata İşleme**: Merkezi hata işleme middleware
  ```javascript
  class AppError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
      this.isOperational = true;
    }
  }
  ```

- **Girdi Temizleme**: Kullanıcı içeriği için `DOMPurify` veya benzeri kullan
- **API Dokümantasyonu**: `swagger-ui-express` ile Swagger/OpenAPI
  ```javascript
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./swagger.json');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  ```

### Orta Öncelik
- **Test Paketi Uygula**: Jest veya Mocha ile birim ve entegrasyon testleri
  ```javascript
  describe('Authentication', () => {
    test('should login with valid credentials', async () => {
      // test implementation
    });
  });
  ```

- **CI/CD Yapılandırması**: Otomatik test için GitHub Actions veya GitLab CI
- **Linting Ekle**: Güvenlik kuralları ile ESLint
- **Pre-commit Hooks**: Kod kalitesi kontrolleri için Husky
- **Kod Kapsamı Ekle**: Minimum kapsam eşikleri ayarla

## Özellik İyileştirmeleri

### Yüksek Öncelik
- **Mesaj Teslim Durumu Takibi**: Gönderildi, teslim edildi, okundu durumlarını takip et
- **Push Bildirimleri Uygula**: FCM (Firebase) veya APNS kullan
  ```javascript
  const admin = require('firebase-admin');
  const message = {
    notification: { title: 'New message', body: '...' },
    token: user.fcmToken
  };
  ```

- **Mesaj Okuma Alındısı**: Mesajların ne zaman okunduğunu takip et
- **Mesaj Arama**: Mesajlar için tam metin arama

### Orta Öncelik
- **Grup Sohbet Desteği**: Sohbetlerde birden fazla katılımcıya izin ver
- **Mesaj Tepkileri**: Mesajlara emoji tepkileri ekle
- **Dosya Yükleme Doğrulama**: Katı dosya türü ve boyut sınırları uygula
- **Mesaj Düzenleme/Silme**: Kullanıcıların gönderilen mesajları düzenlemesine veya silmesine izin ver
- **Sesli Mesajlar**: Sesli mesaj kaydı ve oynatma desteği
- **Video Mesajlar**: Kısa video klipler için destek
- **Konum Paylaşımı**: Canlı veya statik konum paylaş
- **Rehber Senkronizasyonu**: Cihazdan rehber senkronizasyonu (gizlilik kontrolleri ile)

## Veritabanı İyileştirmeleri

### Öneriler
- **Veritabanı İndeksleri Ekle**: Sorguları uygun indekslerle optimize et
  ```sql
  CREATE INDEX idx_messages_created ON messages(created_at DESC);
  CREATE INDEX idx_users_phone ON users(phone);
  ```

- **Veri Saklama Politikası Uygula**: Eski mesajları/çevrimdışı kuyruğunu otomatik sil
- **Veritabanı Göç Sistemi Ekle**: Şema değişiklikleri için göç aracı kullan
- **Veritabanı Yedekleme**: Otomatik yedeklemeler ve rotasyon
- **Sorgu Optimizasyonu**: Yavaş sorguları analiz et ve optimize et

## WebSocket İyileştirmeleri

### Öneriler
- **Yeniden Bağlanma Mantığı Üret**: Üstel geri çekme ile otomatik yeniden bağlanma
- **Mesaj Kuyruğu Ekle**: Kullanıcı çevrimdışıyken teslim edilmeyen mesajları sakla
- **Heartbeat/Ping-Pong Uygula**: Ölü bağlantıları tespit et
- **Bağlantı Durumu Takibi**: Bağlantı kalitesi metriklerini takip et
- **Mesaj Onayı Uygula**: Mesaj teslim onayı sağla

## İzleme ve Gözlemlenebilirlik

### Öneriler
- **Uygulama Performans İzleme**: New Relic, Datadog veya benzeri kullan
- **Hata Takibi Ekle**: Hata izleme için Sentry kullan
- **Log Agregasyonu**: ELK stack veya benzeri ile logları merkezeleştir
- **Uyarı Sistemi**: Kritik hatalar için uyarılar ayarla
- **Çevrimiçilik İzleme**: API uç noktalarının dış izleme

## Dağıtım

### Öneriler
- **Uygulamayı Dockerlaştır**: Konteynerli dağıtım için Dockerfile oluştur
  ```dockerfile
  FROM node:18-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --only=production
  COPY . .
  EXPOSE 3000
  CMD ["node", "server/index.js"]
  ```

- **Ortam Değişkeni Doğrulama Ekle**: Başlangıçta gerekli env varları doğrula
- **Sağlık Kontrolleri Uygula**: Kubernetes/Docker sağlık kontrol uç noktaları
- **Geri Alma Stratejisi Ekle**: Dağıtımlar için kolay geri alma mekanizması
- **Mavi-Yeşil Dağıtım Uygula**: Sıfır kesinti süresi dağıtımlar

## Güvenlik Denetim Kontrol Listesi

- [ ] Tüm API uç noktaları kimlik doğrulama gerektirir (herkese açık olanlar hariç)
- [ ] Tüm herkese açık uç noktalarda hız sınırlama uygulanır
- [ ] SQL enjeksiyon koruması yerinde
- [ ] XSS koruması uygulanır
- [ ] Durum değiştiren istekler için CSRF tokenları kullanılır
- [ ] Güvenlik başlıkları yapılandırılır (helmet)
- [ ] Gizli bilgiler loglanmaz
- [ ] Parolalar güçlü algoritma ile hashlenir (scrypt iyi)
- [ ] Oturum tokenlarının süresi vardır
- [ ] Üretimde HTTPS zorunlu tutulur
- [ ] Girdi doğrulama uygulanır
- [ ] Dosya yüklemeleri doğrulanır
- [ ] Bağımlılıklar düzenli olarak güncellenir
- [ ] Düzenli güvenlik denetimi yapılır

## Performans Optimizasyonu Kontrol Listesi

- [ ] Yanıt sıkıştırma etkin
- [ ] Veritabanı sorguları optimize edilmiş
- [ ] Uygun yerlerde önbellekleme uygulanır
- [ ] Statik varlıklar için CDN kullanılır
- [ ] WebSocket bağlantıları verimli yönetilir
- [ ] Bellek kullanımı izlenir
- [ ] CPU kullanımı izlenir
- [ ] Veritabanı bağlantı havuzu yapılandırılır
- [ ] Tüm dış istekler için zaman aşımları ayarlanır
- [ ] Yük testi yapılır

## Uygulama Önceliği

1. **Aşama 1 (Acil)**: Güvenlik başlıkları, girdi doğrulama, loglama
2. **Aşama 2 (Kısa vadeli)**: Sıkıştırma, önbellekleme, TypeScript geçişi
3. **Aşama 3 (Orta vadeli)**: Test paketi, API dokümantasyonu, izleme
4. **Aşama 4 (Uzun vadeli)**: Özellik iyileştirmeleri, performans optimizasyonu

## Yeni ve gerçekçi güvenlik önerileri

- **Cihaz güvenini sunucuya taşı:** Yerel tarayıcı etiketini hesap güveni sayma. Cihaz kaydı için rastgele, geri alınabilir bir kimlik; yeni cihazda doğrulama; cihaz başına oturum iptali ve kayıp cihaz kurtarma akışı tasarla.
- **Çevrimdışı kuyruk saklamasını sınırla:** E2E şifreli mesaj içeriğini sunucu okuyamaz; bu nedenle süreli mesaj için doğrulanmış, şifre dışı bir sona erme zamanı ve periyodik kuyruk temizliği gerekir. Süre dolan mesajın API ve WebSocket teslimini de reddet.
- **Oturum denetimini gerçek verilere dayandır:** Giriş/çıkış ve oturum iptali olaylarını hassas içerik veya tam token kaydetmeden zaman, kullanıcı ve cihaz oturumu ile kaydet; liste ve güvenlik özetleri aynı kaynaktan beslensin.
- **Yeniden doğrulamayı sınırlı ve tüketilebilir kıl:** Hassas ekran kilidi açma, parola değişikliği ve 2FA kapatma gibi işlemlerde parola ve 2FA iste; kurtarma kodlarını atomik olarak bir kez tüket ve kullanıcı bazında deneme sınırı uygula.
- **Gizlilik saklama süresi belirle:** IP, user-agent, kod denemeleri ve çevrimdışı şifreli kuyruğun saklama/temizleme sürelerini tanımla; yedekleme ve log politikalarını da aynı sürelerle uyumlu tut.
