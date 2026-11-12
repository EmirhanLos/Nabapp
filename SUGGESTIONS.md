# Nabapp Proje Önerileri

Bu belge Nabapp projesinin genel iyileştirmeleri, deployment ve operasyon önerilerini içerir.

## Ortam Değişkenleri

### Gerekli Değişkenler
```bash
# Güvenlik
NABAPP_SECRET=your-secret-key-here

# SMS (Netgsm REST v2; production requires an active account)
NABAPP_SMS_PROVIDER=netgsm
NETGSM_USERCODE=your-netgsm-usercode
NETGSM_PASSWORD=your-netgsm-password
NETGSM_HEADER=your-approved-sender-header

# E-posta (SMTP sağlayıcınızın bilgileri)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Sunucu
PORT=3000
NODE_ENV=production

# CORS (İsteğe bağlı)
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### .env Örneği
```bash
# .env.example
NABAPP_SECRET=change-this-in-production
PORT=3000
NODE_ENV=development
```

## Deployment Rehberleri

### Docker Deployment

**Dockerfile oluşturun:**
```dockerfile
FROM node:18-alpine
WORKDIR /app

# Bağımlılıkları kopyala
COPY package*.json ./
RUN npm ci --only=production

# Uygulamayı kopyala
COPY . .

# Veritabanı dizini oluştur
RUN mkdir -p /app/data

# Port aç
EXPOSE 3000

# Uygulamayı başlat
CMD ["node", "server/index.js"]
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  nabapp:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NABAPP_SECRET=${NABAPP_SECRET}
      - PORT=3000
      - NODE_ENV=production
    volumes:
      - nabapp-data:/app/data
    restart: unless-stopped

volumes:
  nabapp-data:
```

**Deployment:**
```bash
docker build -t nabapp .
docker run -p 3000:3000 -e NABAPP_SECRET=your-secret nabapp
```

### Cloud Platform Deployment

**Heroku:**
```bash
# Heroku CLI ile
heroku create nabapp
heroku addons:add heroku-postgresql  # İsteğe bağlı
heroku config:set NABAPP_SECRET=$(openssl rand -base64 32)
git push heroku main
```

**Render.com:**
- Render dashboard üzerinden yeni web service ekle
- GitHub repository bağla
- Environment variables ekle
- Build command: `npm install`
- Start command: `node server/index.js`

**AWS (EC2):**
```bash
# EC2 instance oluştur
# SSH ile bağlan
ssh -i your-key.pem ec2-user@your-instance

# Node.js ve npm kur
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Projeyi clone et
git clone https://github.com/yourusername/nabapp.git
cd nabapp

# Bağımlılıkları kur
npm install --production

# PM2 ile çalıştır
npm install -g pm2
pm2 start server/index.js --name nabapp
pm2 startup
pm2 save
```

### CI/CD Pipeline

**GitHub Actions:**
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test  # Test varsa
      - name: Deploy to production
        run: |
          # Deployment scripti
          ssh deploy@server 'cd /app && git pull && npm install --production && pm2 restart nabapp'
```

## Ek güvenlik ve kullanıcı odaklı öneriler

- Ekran kilidi / kısa boşta kalma zamanlayıcısı ekleyin; cihazın arka plana geçmesi ya da 5-10 dakika hareketsizlik sonrası tekrar parola gerekmeli.
- "Güvenli cihaz" onayı ekleyin: yalnızca tanınan cihazlardan giriş kabul edilsin, yeni cihazda e-posta/SMS doğrulama ve cihaz etiketi zorunlu olsun.
- Mesaj silme ve görüntüleme zamanlaması için açıkça görünür "kaybolan mesaj" önizleme ekleyin; kullanıcıların yanlışlıkla kalıcı silme yapmasının önüne geçin.
- Bildirim tercihlerinde sadece "sessiz" mod değil, "sadece kişiler / sadece önemli kişiler / tüm bildirimler" seçenekleri sunun.
- Mesaj meta verilerini azaltın: gönderim cihazı, konum, kullanım istatistikleri ve çağrı kayıtları gibi gereksiz verileri yalnızca ihtiyaç olduğunda saklayın.
- Dosya paylaşımında MIME türü ve boyut doğrulaması yapın; PDF/ZIP gibi dosyaların zararlı içerik taşıyabileceğini düşünerek tarama opsiyonunu ekleyin.
- Hesap kurtarma da "yeniden kullanılabilir kurtarma kodları" ve "istisnai çıkış" adımları ekleyin; kullanıcıların yanlışlıkla hesabı kilitlemmeleri gerekiyor.
- Mobil arayüzde "geri dön" ve "tüm sohbetler" erişimi daha net hale getirilerek kullanıcı kaybı azaltılmalıdır.
- Kullanıcı güvenini artırmak için her yeni cihaz girişinde kısa bir “bu cihazı güveniyor musun?” onayı ve cihaz etiketi onaylama ekleyin.
- Doğrulama ekranlarında güvenlik notları daha net yazılmalı; örneğin “Kod yalnızca 5 dakika geçerlidir” ya da “Bu kodu kimseyle paylaşma” gibi mesajlar eklenmeli.
- Kayıt sırasında parola gücü göstergesi ve güvenlik ipuçları ekleyin; kullanıcı zayıf şifreler kullanmamalı.
- Mesaj listesinde gizlilik göstergeleri ekleyin: şifrelenmiş, doğrulanmış, kurtarma kodu aktif, cihaz güvenliği gibi küçük etiketler gerekiyor.
- Varsayılan olarak “yapılandırılmamış” ayarlar yerine güvenlik odaklı önerilen ayarlar (ör. son görünme kapalı, bildirimler kısmen açık) uygulanabilir.
- Gürültüyü azaltmak için yalnızca gerekli izinler istenmeli; kamera, mikrofon ve konum izinleri açıkça açıklanmalı.
- Yönetim panelinde güvenlik olayları için kısa özetler dursun: “son 7 günde yeni oturum”, “beklenmeyen giriş denemesi”, “anahtar değişikliği” gibi bilgiler yazmalı.

## Çok Kritik Güvenlik ve Kullanıcı Odaklı Öneriler (öz-eleştiri ve kendi önerimle)

Aşağıdaki beş öneri, mevcut UI güvenliği bir seviye öteye taşıyıp ürünün gerçekten güvenilir ve kullanıcı dostu olması gerekiyor. Mesajlaşma ürünlerinde güvenlik sorunları çoğu zaman arayüzde değil, kullanıcı davranışının yönlendirilmesinde ve güvenlik kararlarının önüne geçilmemesinde ortaya çıkar. Bu yüzden önerilerim sadece “görsel” değil, kullanıcı psikolojisin de ve ürün güvenliğin de önemli.

### 1) Varsayılan olarak "güvenli oturum" politikası ve zorunlu cihaz onayı
- Neden kritik: Mevcut tasarım güven hissi için önemli ama bir saldırgan yeni bir cihazdan giriş yaparsa sistemin “güvenli mi, değil mi?” kararını netleştirmesi gerekiyor. SMS tek başına yeterli değil; kullanıcı yanlışlıkla güvenli olmayan cihazlardan giriş yapabilir.
- Kendi eleştirim: Benim önceki yaklaşımım, güvenlik önemini “güvenli cihaz etiketi” ile açıklamaya çalıştı. Bu iyi bir başlangıç ama gerçek üretim güvenliği için yalnızca arayüz yeterli değil; sunucu tarafında cihaz güveni ve oturum kısıtlaması gerekiyor.
- Kendi önerim: Her yeni cihazda otomatik olarak “Bu cihaz güvenli mi?” onayı sorulmalı; kullanıcı cihaz etiketini seçmeli ve 24 saat içinde onaylanmayan cihazlar girişe izin vermemeli. Ayrıca “güvenli cihaz” listesindeki cihazların tek tek devre dışı bırakılabilir olması şart olmalı.
- Uygulama: Sunucuya `trusted_devices` tablosu eklenmeli; cihaz kimliği, kullanıcı ajanı, son giriş zamanı, güven durumu, son giriş yeri ve ip bilgileri kaydedilmeli. Yeni cihaz girişinde, kullanıcıya 2 adımlı doğrulama veya anahtar doğrulaması zorunlu hale getirilmeli.

### 2) Hesap kurtarma ve kilitlenme senaryolarını kullanıcı dostu, ama sağlam hale getirmek
- Neden kritik: Mesajlaşma uygulamalarında hesabın yanlışlıkla kilitlenmesi büyük kullanıcı kaybına neden olur. Heasbı kurtarma ne kadar kolay olursa, güvenlik açıkları da o kadar artar.
- Kendi eleştirim: Önceki fikirler, GSM doğrulama ve güvenlik notlarına odaklandı; ancak “hesabı geri almak” işini hem kullanıcı dostu hem de güvenli sağlayan bir yapının eksik olduğunu kabul ediyorum. Basit bir “kurtarma kodu” yetmez, durumun okur yazarlığı da önemlidir.
- Kendi önerim: Kurtarma akışında en az 3 seçenek sunulmalı: güvenli cihazla geri dön, SMS kodu ile doğrula, yedek kurtarma kodu ile geri al. Bu seçenekler kullanıcıya net şekilde açıklanmalı; yanlış bir seçim sonrası hesabı kalıcı olarak kilitleyen bir durum olmamalı.
- Uygulama: `recovery_methods` ve `recovery_events` kaydı eklenmeli; güvenlik anormalliğinde kullanıcıya “Bu işlemi ben yaptım mı?” sorusu sorulmalı. Hesap kiliti durumunda kullanıcıya 15 dakikalık güvenli geri dönüş penceresi sağlanmalı.

### 3) Kullanıcıya “güvenli mesaj” ve “silme” davranışı konusunda net, yumuşak ama net bir rehberlik vermek
- Neden kritik: Mesaj silme, kendi kendine imha, “yalnızca bu cihazda görünür” gibi davranışlar kullanıcı için kafa karışıklığına sebep olabilir. Güvenli ürünler sadece teknik güvenlik değil, davranışsal netlik sunar.
- Kendi eleştirim: Benim önceki önerilerde bu konu kısmen “gizlilik göstergeleri” olarak kaldı. Oysa kullanıcıların yanlışlıkla kalıcı mesaj silmesi veya yanlış paylaşımı yapması, güvenlik sorunlarından daha sık görülen bir sorundur.
- Kendi önerim: Her mesaj için “silme”, “görünürlük süresi”, “gönderim doğrulaması” ve “alıcı doğrulaması” gibi seçenekler açıkça sunulmalı. Örneğin, kullanıcı “Bu mesajı 30 saniye sonra sil” gibi bir seçeneği seçtiğinde, uygulama hem önizleme hem de doğrulama göstermeli.
- Uygulama: `message_lifecycle` yapısı kurulmalı; mesajın “kalıcı”, “geçici”, “son kullanma” gibi state'i kullanıcı anlamlı bir şekilde görmeli. Silme işleminden önce 2 adımlı onay ve “Bu mesajın silinmesi geri alınamaz” uyarısı eklenmeli.

### 4) Dosya paylaşımı için güvenlik taraması ve izinler katmanı eklemek
- Neden kritik: Son kullanıcı için fotoğraf, belge ve dosya paylaşımı önemlidir bu yüzden kolay paylaşılmalılar ama Phishing, zararlı ek, kötü amaçlı zip veya verilere erişim istemek için kullanılabilir. “Kolay” bağlantı, güvenlik için pahalı olabilir.
- Kendi eleştirim: Daha önce dosya ekleme kısmına odaklandım ama gerçek güvenliği “büyük dosya kabul etme” ya da “MIME doğrulama” gibi basit kontrolerle sınırladım. Bu yeterli değil; dosya durumunda güvenlik katmanına ihtiyaç var.
- Kendi önerim: Gönderim öncesinde dosya tipi, boyut, şifrelenme durumu ve tehlike skoru kontrol edilmeli. Ayrıca kullanıcıya neden izin istendiği açıkça anlatılmalı; örneğin “Bu dosya mikrofonunuza erişmeyecek, yalnızca paylaşım için kullanılacak.”
- Uygulama: `file_policy` modülünde MIME kontrolü, hash karşılaştırması, anti-virus/heuristic scanning ve dosya önizleme kısıtlamaları yapılmalı. Görsel eklerin exif metadata'sı temizlenmeli; alınan dosyalar için “tehlikeli içerik” işaretlemesi eklenmeli.

### 5) Kullanıcı güvenini artmasına sebep olabilecek güvenlik eğitimi ve “güvenli kullanım” asistanı
- Neden kritik: En yüksek güvenlik risklerinden biri, kullanıcıların güvenlik seçeneklerini anlamadan kabul etmesidir. “Güvenlik iyi görünüyor” ama kullanıcı ne yapması gerektiğini bilmiyorsa sistem yine de zayıftır.
- Kendi eleştirim: Ben, güvenlik önerilerini çoğu zaman ara yüzde bıraktım; oysa güvenlik ürünleri kullanıcı eğitimi olmadan sadece ‘süslü’ görünür. Bu yüzden konsept olarak önemli ama davranışsal olarak zayıf olabilir.
- Kendi önerim: Uygulama ilk açıldığında kullanıcıya 30–60 saniyelik “güvenli kullanım asistanı” sunulmalı. Bu asistan kısa notlar vermeli: “Şahsi cihazını kullan”, “Tek cihazda 2FA aktif tut”, “Korkmana sebep olabilecek iletilerde kod isteme”, “Hesabın parolasını kimseyle paylaşma”.
- Uygulama: `security_assistant` modülü, onboarding durumu içinde kontekstli uyarılar durur. Her güvenlik ayarı için kısa, anlaşılır açıklama ve “neden önemli?” alanı eklenmeli. Böylece güvenlik kararları teknik değil, davranışsal olarak da doğrulanır.

## İzleme ve Loglama

### Winston Loglama Kurulumu

**Gelişmiş loglama:**
```javascript
// server/logger.js
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

### Uygulama Performans İzleme (APM)

**New Relic:**
```bash
npm install newrelic
```

```javascript
// newrelic.js
exports.config = {
  app_name: ['Nabapp'],
  license_key: 'your-license-key',
  logging: {
    level: 'info'
  }
};
```

### Hata Takibi (Sentry)

```bash
npm install @sentry/node
```

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://example@sentry.io/project-id",
  tracesSampleRate: 1.0,
});
```

## Yedekleme ve Kurtarma

### Veritabanı Yedekleme

**Otomatik yedekleme scripti:**
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/nabapp"
DATA_DIR="/app/data"

mkdir -p $BACKUP_DIR

# SQLite yedekleme
cp $DATA_DIR/nabapp.db $BACKUP_DIR/nabapp_$DATE.db

# 7 günden eski yedekleri sil
find $BACKUP_DIR -name "nabapp_*.db" -mtime +7 -delete

echo "Backup completed: nabapp_$DATE.db"
```

**Cron job ile otomatik yedekleme:**
```bash
# Her gün saat 02:00'de yedekle
0 2 * * * /path/to/backup.sh >> /var/log/nabapp-backup.log 2>&1
```

### Kurtarma Prosedürü

**Veritabanı geri yükleme:**
```bash
# Hizmeti durdur
pm2 stop nabapp

# Yedeği kopyala
cp /backups/nabapp/nabapp_20240105_020000.db /app/data/nabapp.db

# Hizmeti başlat
pm2 start nabapp
```

## Güvenlik Denetim Kontrol Listesi

### Genel Güvenlik
- [ ] Tüm ortam değişkenleri güvenli (gizli değil)
- [ ] HTTPS zorunlu (SSL/TLS sertifikası)
- [ ] Güvenlik başlıkları yapılandırılmış (helmet)
- [ ] Rate limiting aktif
- [ ] Input validation yapılmış
- [ ] SQL injection koruması
- [ ] XSS koruması
- [ ] CSRF koruması
- [ ] Güvenli şifre hashleme (scrypt kullanılıyor ✓)
- [ ] Session yönetimi güvenli
- [ ] Dosya yükleme sınırları
- [ ] API rate limiting
- [ ] Loglarda gizli bilgiler yok

### Veritabanı Güvenliği
- [ ] Veritabanı dosyası güvenli dizinde
- [ ] Veritabanı yedekleri şifreli
- [ ] Erişim hakları kısıtlı
- [ ] Hassas veriler şifreli

### Network Güvenliği
- [ ] Firewall yapılandırılmış
- [ ] Sadece gerekli portlar açık
- [ ] DDoS koruması
- [ ] IP whitelisting (gerekirse)

## Performans Optimizasyonu

### Sunucu Optimizasyonu
- [ ] Response compression aktif
- [ ] Static assets CDN'de
- [ ] Database indexing yapılmış
- [ ] Connection pooling
- [ ] Caching (Redis) kullanılıyor
- [ ] Load balancing (üretim için)
- [ ] HTTP/2 aktif
- [ ] Keep-alive connections

### İstemci Optimizasyonu
- [ ] Code splitting
- [ ] Lazy loading
- [ ] Image optimization
- [ ] Bundle size minimize
- [ ] Service worker
- [ ] Browser caching

### Monitoring
- [ ] CPU kullanımı izleniyor
- [ ] Memory kullanımı izleniyor
- [ ] Response time izleniyor
- [ ] Error rate izleniyor
- [ ] Uptime monitoring
- [ ] Alert sistemi

## Operasyon Prosedürleri

### Günlük Bakım
- Logları incele
- Disk kullanımını kontrol et
- Backup'ları doğrula
- Error loglarını incele
- Sistem kaynaklarını izle

### Haftalık Bakım
- Bağımlılıkları güncelle
- Güvenlik patch'lerini uygula
- Performans metriklerini incele
- Yedekleme test et
- Capacity planning

### Aylık Bakım
- Full güvenlik denetimi
- Sürüm güncellemeleri
- Disaster recovery test
- Cost analysis
- Raporlama

## Acil Durum Prosedürleri

### Sunucu Çökmesi
1. Hizmeti yeniden başlat: `pm2 restart nabapp`
2. Logları incele
3. Kaynağı belirle
4. Çözüm uygula
5. Monitor et

### Veritabanı Bozulması
1. Hizmeti durdur
2. Son yedeği geri yükle
3. Hizmeti başlat
4. Veri bütünlüğünü kontrol et
5. Logları incele

### DDoS Saldırısı
1. Rate limiting'i sıkılaştır
2. Cloudflare veya benzeri aktive et
3. IP'leri bloke et
4. İlgili otoriteye bildir
5. Monitor et

### Veri İhlali
1. Etkilenen sistemleri izole et
2. Kaynağı belirle
3. Logları koru
3. Kullanıcıları bilgilendir
4. Yasal gereklilikleri yerine getir
5. Gelecekteki önlemler al

## Kaynaklar

### Dokümantasyon
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [OWASP Security Guidelines](https://owasp.org/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

### Araçlar
- PM2: Process Manager
- Winston: Logging
- Sentry: Error Tracking
- New Relic: APM
- Docker: Containerization
- GitHub Actions: CI/CD

### Topluluk
- Node.js Discord
- Stack Overflow
- GitHub Issues
- Reddit r/node

## İletişim ve Destek

Sorular veya öneriler için:
- GitHub Issues: https://github.com/yourusername/nabapp/issues
- Email: support@nabapp.com
- Discord: https://discord.gg/nabapp

## Yeni güvenlik ve kullanıcı deneyimi önerileri

- **Cihaz güvenini gerçek oturumlarla eşleştir:** Tarayıcıda görünen etiketleri güvenlik onayı sayma; yeni cihazları sunucuda kaydet, doğrula ve oturum iptalini çalışır hale getir.
- **Gizlilik durumunu dürüstçe göster:** Şifreleme, oturum meta verisi ve cihaz içi saklama kapsamını ayrı ayrı açıkla; sunucunun okuyamadığı mesaj için server-side tarama veya silme iddiası kurma.
- **Süreli mesajlarda iki taraflı yaşam döngüsü kur:** Son kullanma süresini E2E şifreli içerikle taşı, alıcıda süresi dolan mesajı ve bildirimi gösterme; çevrimdışı kuyruk için ayrıca sunucu temizliği tasarla.
- **Oturum kilidini yeniden doğrula:** Parola ya da 2FA kodunu localStorage'da tutmadan sunucuda doğrula; kilitte çözülmüş anahtarları, mesajları ve nesne URL'lerini bellekten bırak.
- **Güvenlik kontrollerini ölçülebilir tut:** Ayarları gerçek davranışa bağla; olay sayısı, cihaz durumu veya risk puanı bulunmuyorsa sahte değer yerine açıkça “bilgi yok” göster.
- **Tasarımda erişilebilir varsayılanlar:** Klavye odağını görünür tut, durumları yalnızca renkle anlatma ve animasyon/otomatik kaydırma davranışında kullanıcının azaltılmış hareket tercihini uygula.

## Uygulanan öneriler — "Şifreleme anahtarı yok" hatası (2026-11-12)

Kullanıcılar birbirlerine mesaj atarken **"Bu cihazda şifreleme anahtarları yok; mesaj gönderilemiyor"** hatası çıkıyordu. Kök neden, sunucu olay günlüğüyle doğrulandı: aynı tarayıcı profilinde ikinci bir hesaba kayıt olmak, ilk hesabın oturumunu ve şifreli anahtar yedeğini sessizce siliyordu (`nabapp-token` ve `nabapp-identity` tek global yuvalardaydı). İlk hesap bir sonraki başlatmada "yedek başka hesaba ait" hatası alıyor, `Store.identity` null kalıyor ve mesaj gönderme bu hatayla düşüyordu.

1. **Hesap bazlı oturum ve anahtar yedeği izolasyonu** (`public/account-storage.js`)
   - Her hesap kendi yuvasına sahip: `nabapp-session-v2:<phone>`, `nabapp-identity-v2:<userId>`, `nabapp-trusted-v2:<userId>`.
   - Aktif hesap önce sekmeye (`sessionStorage`), sonra profile (`localStorage`) bağlanır; iki sekmede iki hesap birbirinin belirtecini kullanmaz.
   - Sürüm öncesi tek yuvalar sahibinin hesabına taşınır; **başka hesaba ait yedekler atlanır ve silinmez** (`account_mismatch` artık yıkıcı değil).
   - Doğrulanmış kişi anahtarları (pinned fingerprint) da hesaba özeldir; hesaplar birbirinin güven deposunu zehileyemez.
   - **Tek tarayıcıda tek hesap kuralı:** Ayarlar → HESAPLAR bölümü bu tarayıcıdaki hesapları listeler, açık olanı işaretler ve tek tıkla hesap değiştirir (anahtarlar silinmez, kendi yuvasında kalır). Giriş ekranı aynı hesapları tek tıkla doldurulabilir listeler; ikinci hesap kaydedilirken "başka hesap açık" uyarısı verilir.

2. **Cihaz anahtarı kurtarma akışı ve hatayı yönlendirme**
   - Ayarlar → ŞİFRELEME ANAHTARLARI bölümü **"Anahtar yedeğini dışa aktar"** (şifreli dosya) ve **"Yedek dosyasından geri yükle"** seçenekleri sunar; yeni cihaz artık çıkmaz yolda değildir. Dışa aktarılan dosyada yalnızca parola-şifreli blob vardır; sunucu özel anahtarları hiçbir zaman görmez.
   - Anahtarı olmayan hesapta sohbet ekranında "Anahtarları geri yükle" uyarı şeridi görünür ve hata mesajı kurtarma adresine yönlendirir.
   - Ekran kilidi sırasında bellekte temizlenen anahtarlar gönderim ortasında "anahtar yok" hatası üretmesin diye gönderim boyunca sabitlenir; kilit ekranı artık kullanıcıyı hapsolmaz.
   - Regresyon testleri: `test/account-storage.test.js`, `test/identity-backup.test.js`.
