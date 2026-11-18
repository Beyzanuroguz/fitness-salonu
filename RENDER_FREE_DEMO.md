# FORM CLUB: Render Free demo

**Bu dosya bir hazırlıktır; dağıtım yapılmadı.** Dal: `feature/render-free-demo`, taban:
`integration/v9` `6fc3e56`. GitHub'a push ve Render'da servis oluşturma adımlarını proje
sahibi kendisi onaylayıp yapar.

## Demo nasıl çalışır

- `APP_ENV=render-demo` modu yalnızca bu demo içindir. `NODE_ENV=production` güvenliğini
  zorunlu kılar: HTTPS köken, `Secure; HttpOnly; SameSite=Strict` oturum çerezi, CSRF köken
  denetimi, CSP, HSTS, CORS başlığı yok. Bunlar üretimle aynıdır.
- **Kalıcı disk yoktur. Veriler kalıcı değildir.** Sunucu her başladığında
  `FITNESS_DB_PATH` (`/tmp/formclub-demo/demo.sqlite`) sıfırdan oluşturulur ve yalnızca
  sentetik üyeler, eğitmenler, dersler, ödemeler ve ölçümlerle doldurulur.
  Şu durumlarda tüm değişiklikler silinir:
  - Render Free servisi 15 dakika trafik almayınca uyur; ilk istekte yeniden başlar.
  - Her yeniden dağıtım ve her yeniden başlatma.
- Sentetik kayıtlar `@example.com` adresli kurgusal kişilerdir. Uygulamada "DEMO ortamı"
  duyurusu görünür. **Gerçek müşteri, ödeme veya sağlık verisi girilmemelidir.**
- Sunucu, `FITNESS_DB_PATH` konumunda demo işareti (`demo_environment`) taşımayan bir
  veritabanı bulursa onu silmez; başlamayı reddeder. Repo içindeki `fitness.sqlite` yolu
  da reddedilir. Gerçek veritabanı Render'a yüklenmez.
- Herkese açık `/api/setup` kapalıdır (üretim modu). Yönetici, eğitmen ve üye hesapları
  yalnızca Render'da gizli ortam değişkeni olarak girilen şifrelerle her açılışta oluşturulur.
- `PAYMENTS_ENABLED`, `SMS_ENABLED`, `EMAIL_ENABLED`, `TURNSTILE_ENABLED` değerleri `0`
  olmazsa sunucu başlamaz. Bu sürümde gerçek ödeme, SMS, e-posta veya fiziksel turnike
  entegrasyonu zaten yoktur. Nutrition+ barkod araması Open Food Facts'e dışarı istek atar;
  bu ödeme veya mesaj göndermez.
- Üç sanal turnike (`TURNSTILE_SIMULATION.md`) yalnızca kayıt tutan bir simülasyondur.
  Gerçek kapı veya röle komutu yoktur. `TURNSTILE_ENABLED=0` zorunluluğu değişmedi;
  sanal turnikeler bu bayrağa bağlı değildir.
- **Turnike QR kimlikleri her yeniden başlatmada değişir.** Uyku, yeniden dağıtım veya
  yeniden başlatma sonrasında basılı kodlar çalışmaz. Kodları Turnikeler ekranından yeniden
  açın.
- Arama motorları için `X-Robots-Tag: noindex` ve `/robots.txt` `Disallow: /` döner.

## Gerekli ortam değişkenleri

| Değişken | Değer | Not |
| --- | --- | --- |
| `NODE_VERSION` | `24` | `node:sqlite` için Node 24 |
| `NODE_ENV` | `production` | |
| `APP_ENV` | `render-demo` | |
| `HOST` | `0.0.0.0` | Render dış trafiği bu adresten iletir |
| `COOKIE_SECURE` | `1` | |
| `FITNESS_DB_PATH` | `/tmp/formclub-demo/demo.sqlite` | geçici, her açılışta silinir |
| `DEMO_SYNTHETIC_ONLY` | `1` | |
| `PAYMENTS_ENABLED`, `SMS_ENABLED`, `EMAIL_ENABLED`, `TURNSTILE_ENABLED` | `0` | |
| `DEMO_ADMIN_PASSWORD` | **gizli** | en az 16 karakter |
| `DEMO_TEACHER_PASSWORD` | **gizli** | en az 16 karakter, diğerlerinden farklı |
| `DEMO_MEMBER_PASSWORD` | **gizli** | en az 16 karakter, diğerlerinden farklı |

İsteğe bağlı değişkenler:
- `DEMO_ADMIN_USERNAME`, `DEMO_TEACHER_USERNAME`, `DEMO_MEMBER_USERNAME`. Varsayılanlar:
  `demo-admin`, `demo-teacher`, `demo-member`.
- `PUBLIC_ORIGIN`. Verilmezse Render'ın kendi koyduğu `RENDER_EXTERNAL_URL` kullanılır
  (`https://<servis>.onrender.com`). Özel alan adı bağlanırsa `PUBLIC_ORIGIN=https://alanadi`
  girilmelidir; aksi halde formlar "Geçersiz kaynak" hatası verir.
- `PORT`'u girmeyin; Render kendisi verir.

Güçlü şifre üretmek için: `openssl rand -base64 24`. Şifreleri Git'e, sohbete veya e-postaya
yazmayın; yöneticinize ayrı ve güvenli bir kanaldan iletin.

## Kurulum adımları

1. `feature/render-free-demo` dalını GitHub'daki depoya push edin (bu hazırlıkta push yapılmadı).
2. Render'da GitHub hesabını bağlayın: **New > Blueprint**, depoyu seçin.
   `render.yaml` okunur, `formclub-demo` adlı **Free** web servisi önerilir.
3. Render üç gizli şifreyi sorar (`sync: false`). Değerleri girin.
4. **Apply** ile servisi oluşturun. Ücretli plan, disk veya ek hizmet seçmeyin.

Blueprint yerine panelden elle kurulum (**New > Web Service**):

| Alan | Değer |
| --- | --- |
| Branch | `feature/render-free-demo` |
| Runtime | Node |
| Build Command | `node -e "require('node:sqlite')"` |
| Start Command | `node server.js` |
| Instance Type | Free |
| Health Check Path | `/healthz` |
| Environment | yukarıdaki tablo |

## Doğrulama

1. `https://<servis>.onrender.com/healthz` adresi `{"status":"ok"}` döndürmeli.
2. `demo-admin`, `demo-teacher` ve `demo-member` hesaplarıyla ayrı ayrı giriş yapın.
   Her rol kendi menüsünü görmeli. Üye yalnızca kendi kaydını görmeli.
3. Çıkış yapınca oturum kapanmalı.

## Bilinen sınırlar

- Free servis uyuduktan sonra ilk açılış yaklaşık bir dakika sürebilir. Bu arada yapılan
  bütün değişiklikler silinmiş olur.
- Giriş deneme sınırı istemci soketine göre tutulur. Render proxy'si arkasında tüm
  ziyaretçiler aynı sınırı paylaşabilir: 15 dakikada 20 hatalı denemeden sonra giriş geçici
  olarak kilitlenir.
- Fiziksel cihazda kamera/QR testi yapılmadı. Kamera HTTPS gerektirir; `onrender.com`
  HTTPS sağlar.
- Bu mod üretim için değildir. Üretim kurulumunun kalıcı ve korumalı disk şartları
  (`PRODUCTION_READINESS.md`, `deploy/`) değişmedi.
- **Sanal dolaplar (`LOCKER_MANAGEMENT.md`) de geçicidir.** Her yeniden başlatmada 20 dolap
  yeni QR kimlikleriyle yeniden kurulur; tahsisler, uyarılar ve dolap logları silinir. Basılı
  demo dolap kodları geçersiz olur; Dolap Yönetimi ekranından yeniden yazdırın.
