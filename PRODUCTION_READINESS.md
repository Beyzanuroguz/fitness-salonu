# FORM CLUB V9 Unified — üretime hazırlık

Değerlendirme: 17 Kasım 2026. Dal: `integration/v9`; başlangıç: `2c50d92`.
Karar: **Canlı ticari kullanıma henüz onay verilmedi.** PASS yalnızca aşağıdaki
kanıtın kapsamını belirtir; canlı sistem sertifikası veya bağımsız penetrasyon testi değildir.
Bu çalışma canlıya dağıtım yapmadı, gerçek `fitness.sqlite` dosyasını açmadı/değiştirmedi.

## Güvenlik kanıtları

| Madde | Durum | Kanıt / sınır |
|---|---|---|
| V1–V9 birleşik giriş, menüler, V7/V8 regresyonu | PASS | `test/integration.test.js`, `test/dashboard.test.js`, `test/server.test.js`, `tests/v8-api.test.js`; önceki testler korunuyor. |
| Parola saklama | PASS | `server.js`: rastgele 128 bit salt, scrypt 64 bayt, timingSafeEqual; sahte kullanıcı için de scrypt. İstek parolası 256 karakterle sınırlı. Mevcut parolalar değiştirilmedi. |
| Oturum sırları | PASS | Rastgele 256 bit cookie; DB'de SHA-256 özeti; 12 saat süre; login mevcut cookie oturumunu iptal ediyor; logout iptal ediyor. `test/security.test.js`, `test/v9.test.js`. Diğer cihaz oturumları login sırasında iptal edilmez. |
| HttpOnly / SameSite / Secure | PASS | HTTP yanıt testinde HttpOnly, SameSite=Strict, Path=/, Secure; logout aynı bayrakları kullanır. Üretim COOKIE_SECURE=1 olmadan açılmaz. Gerçek TLS aktarımı ayrı test edilmelidir. |
| CSRF / CORS | PASS | `backend/security.js`, operasyon ve HTTP testleri: JSON Content-Type zorunlu, tam Origin eşleşmesi (şema dahil), cross-site ve same-site kardeş origin reddi, CORS izin başlığı yok, OPTIONS reddi. Origin bulunmayan JSON istemcilerine izin var; HTML formu JSON gönderemez, tarayıcı cross-origin JSON için izin verilmeyen preflight gerekir. |
| Giriş / API rate limit | PASS | Kaynak socket başına giriş+setup 20/15 dakika, API 600/dakika; 10.000 anahtar üst sınırı, süre aşımı testi, HTTP 429 testi. X-Forwarded-For güvenilmez; değiştirmek sınırı aşmaz. Bellek içi ve süreç başına; restart sıfırlar. |
| Proxy / yük altında rate limit | NOT TESTED | Aynı proxy üzerinden gelen kullanıcılar uygulamada aynı kotayı paylaşır. Nginx örneği gerçek IP bazlı ilave sınır koyar. Gerçek trafik yük testi ve kota ayarı yayın kapısıdır; çoklu süreç desteklenmiyor. |
| Rol / kayıt izolasyonu | PASS | Üye kendi durum/beslenme/hatırlatma verisi; eğitmen kendi ders/yoklama/raporu; admin rapor seçimi ayrı uç. HTTP ve contract/regresyon testleri. |
| QR yetkisi, tekrar kullanım, iptal, süre | PASS | `test/v9.test.js`, `tests/v9-contract.test.js`: yalnızca yönetici doğrular; eğitmen ve üye reddi, 60 saniye, tek kullanım, oturum iptali. |
| SQL injection | PASS | İncelenen sorgular parametreli; member PATCH sütun adları sabit allowlist. Login SQL payload ve V8/V9 sınır testleri. Bu, bağımsız tüm giriş noktaları pentesti değildir. |
| XSS / içerik politikası | PASS | Markup kaçış testi; sayısal alan doğrulama/kaçış; script-src self, object-src none, base-uri none, frame-ancestors self; inline JS/iframe onload kaldırıldı. CSS inline gereksinimi nedeniyle style-src unsafe-inline var; script için yok. |
| Canlı tarayıcıda CSP uyumu | NOT TESTED | Node testleri HTML ve başlıkları doğrular; gerçek tarayıcı konsolu, kamera, QR decoder ve PWA altında CSP smoke testi yapılmalı. |
| Kişisel verinin önbelleğe alınmaması | PASS | API no-store; kök SW açık statik allowlist, API/query bypass; logout bellek temizliği. `test/integration.test.js`, V9 PWA testleri. |
| Sırların hata loguna sızması | PASS | SQL hata ayrıntıları istemciye verilmez; stderr yalnız event/requestId/status; başlangıç DB yolu yazmaz; activity yeni kayıtlarda detay tutmaz. Testte SQL constraint yanıtı ve proses stdout kontrolü. Eski activity kayıtları silinmedi; eski logların kişisel veri içeriği ayrıca yönetilmeli. |
| Log toplama / alarm | NOT TESTED | systemd journal örneği var; merkezi alarm, erişim politikası ve saklama süresi işletmeci tarafından kurulmalı. Proxy error logları da URL içerebilir: erişimi kısıtlayın ve saklama süresini belirleyin. |
| İlk yönetici ele geçirme / demo veri | PASS | Üretimde HTTP setup kapalı, boş DB'ye demo veri yazılmaz; geçici üretim prosesi testi. İlk admin yerel CLI ile oluşturulur. |
| MFA, hesap kapatma ve parola kurtarma | FAIL | Kullanıcı yaşam döngüsü için ürün akışı yok. Yönetici hesapları için MFA / erişim iptali / kurtarma prosedürü ticari yayından önce tamamlanmalı. |
| Dış besin servisi | PASS | Sabit Open Food Facts hostları, sunucu timeout, veri doğrulaması ve hata testleri `test/nutrition.test.js`. Gerçek sağlayıcı SLA'sı ve canlı erişimi doğrulanmadı. |
| KVKK ve sağlık verisi süreçleri | NOT TESTED | Aydınlatma, açık rıza/hukuki dayanak, sağlık verisi erişimi, silme/retention, veri işleyen sözleşmesi, yurt dışı aktarım ve ihlal prosedürleri hukuk/işletmeci değerlendirmesi bekliyor. Yayın engeli. |
| Gerçek ödeme doğrulaması | NOT TESTED | Mevcut ödeme ekranı yönetici tarafından tutulan manuel kayıt; ödeme sağlayıcısı, imzalı webhook, mutabakat ve iade doğrulaması yok. Otomatik tahsilat ürünü olarak sunulamaz. |

## Operasyon kanıtları

| Madde | Durum | Kanıt / sınır |
|---|---|---|
| Üretim yapılandırması | PASS | `backend/security.js`: geçerli PORT, HTTPS PUBLIC_ORIGIN, Secure cookie, mutlak özel DB yolu; `.env.example`. Varsayılan HOST 127.0.0.1; forward header ile HTTPS güveni üretilmez. |
| HTTPS / sertifika / firewall | NOT TESTED | `deploy/nginx.conf.example` hazırlık dosyası; gerçek sertifika zinciri, yönlendirme, dışarıya kapalı Node portu ve HSTS tarayıcı davranışı test edilmedi. Yayın engeli. |
| Health endpoint | PASS | GET `/healthz`: DB SELECT 1, minimum JSON, no-store, 200/503; kapalı DB testi. Yazılabilirlik, disk doluluğu ve harici servis kontrolü içermez. |
| Graceful shutdown | PASS | SIGTERM/SIGINT: yeni bağlantıları durdurur, istekleri bekler, 10 sn sonra bağlantıları kapatır, SQLite kapanır; geçici üretim prosesinin SIGTERM sonrası exit 0 ve integrity_check testi. Gerçek proxy altında uzun istek/drain testi bekliyor. |
| SQLite dayanıklılık | PASS | WAL, foreign_keys ON, synchronous FULL, busy_timeout 5000. Tek süreç/yerel disk hedefi. NFS/çoklu node yok. |
| WAL tutarlı yedek / geri yükleme | PASS | `scripts/database.js` SQLite online backup API; WAL açıkken commit edilmiş veri, sonradan yazılan kayıt farkı, integrity_check, FK kontrolü, restore'da oturum/QR iptali, kaynak değişmeme testi. Hedef üzerine yazılmaz. |
| Yedek gizliliği | PASS | Ara dizin 0700, snapshot 0600; dosya+üst dizin fsync; atomik exclusive link ile yayın. Yerel POSIX filesystem gerekir. Şifreleme sağlamaz. |
| Yedek planlama, dış kopya ve felaket tatbikatı | NOT TESTED | Şifreli offsite saklama, cron/timer, alarm ve saklama politikası canlıda kurulmadı. Yayın engeli; aşağıdaki prosedür zorunlu. |
| Gerçek verinin korunması | PASS | Tüm testler :memory: veya os.tmpdir altındaki yeni SQLite dosyalarıyla; gerçek DB için restore/backup çalıştırılmadı. Gerçek veri üzerinde migration/purge yok. |
| Git / sır hijyeni | PASS | `git ls-files` içinde DB, backup, .env veya anahtar dosyası yok; `.gitignore` DB/WAL/SHM, dotenv, yedek, anahtar ve logları dışlar. Çalışma ağacında özel anahtar imza taraması yapıldı. Geçmişin tümü için uzman secret scanner çalıştırılmadı. |
| Gerçek mobil kamera | NOT TESTED | iOS/Android izinleri, HTTPS kamera, QR tarama ve düşük ışık test edilmedi. |
| PWA kurulumu / güncelleme | NOT TESTED | Manifest, icon, allowlist, API cache bypass Node testleri PASS; gerçek iOS/Android kurulumu, servis çalışanı geçişi ve çevrimdışı UX test edilmedi. |
| Web Push | FAIL | Arka plan push yok; bildirimler açık uygulamada polling ile gelir. Ürünün vaatlerine göre kapsam kararı gerekir. |
| Boş kurulumun operasyonel verileri | FAIL | Demo seed üretimde kapatıldı. Yeni salon için eğitmen/paket başlangıç verisi ve kullanıcı işe alım akışı ayrıca hazırlanmalı; mevcut gerçek veri otomatik dönüştürülmez. |

## Kurulum ve dağıtım planı (uygulanmadı)

1. Staging için ayrı makine, özel DB dizini ve ayrı alan adı oluşturun. Canlı DB'yi
   staging'e taşımayın; anonim/test veri kullanın. Bu çalışma Node v26.10.0 ile
   doğrulandı. Yayında güvenlik yamaları güncel desteklenen Node sürümünü seçip
   bu sürümle aynı test takımını yeniden çalıştırın; node:sqlite backup gerekli.
2. Tek bir formclub OS kullanıcısı; `/var/lib/formclub` 0700, DB 0600; repo ve
   `public` içinde DB/backup bulundurmayın. Var olan DB izinleri otomatik değişmez.
   Environment dosyasını repo dışında `/etc/formclub/formclub.env` altında 0600
   tutun; `.env.example` kopyalanıp alan adı/yollar değiştirilir. Node .env'yi
   otomatik yüklemez; systemd EnvironmentFile veya `node --env-file=...` kullanın.
3. Sürümü yeni `/opt/formclub/releases/<SHA>` dizinine koyun; `current` bir symlink
   olsun. DB ayrı kalır. İlk boş kurulumda uygulamayı yalnız loopback üzerinde
   başlatıp şemayı oluşturun, durdurun, ilk admini yerel terminalde oluşturun.
   `scripts/create-admin.js` kullanıcı adını argv, 14–256 karakter parolayı stdin
   üzerinden alır. Parolayı shell geçmişine/argv/env/loglara yazmayın:

   ```sh
   read -r -s admin_password
   printf '%s' "$admin_password" | FITNESS_DB_PATH=/var/lib/formclub/fitness.sqlite node scripts/create-admin.js yonetici
   unset admin_password
   ```

   Bu komutlar canlıda bu çalışma tarafından çalıştırılmadı. Terminalinizde `read -s`
   desteğini doğrulayın; varsayılan/örnek admin parolası yoktur. HTTP setup üretimde
   kapalı olduğundan provisioning bitmeden proxy'yi dışarıya açmayın.
4. `deploy/formclub.service.example` ve `deploy/nginx.conf.example` dosyalarını
   yollar/domain/sertifikalar için uyarlayın. Nginx syntax/config testi ve systemd
   doğrulaması canlıda yapılmalı. Node portunu dış dünyaya kapatın; proxy dışında
   erişim olmamalı. Proxy API/HTML/cache yapmaz. Uygulama X-Forwarded-For'a güvenmez;
   proxy arkasında uygulama kotası ortak olduğundan yük testi zorunludur.
5. Yayından önce aşağıdaki yedek prosedürünü çalıştırın ve restore tatbikatını
   ayrı dizinde doğrulayın. staging'de login→üye QR→admin doğrulama→logout,
   eğitmen izolasyonu, beslenme ve analitik, CSRF/CSP, gerçek telefon kamera/PWA
   testlerini tamamlayın. KVKK/ödeme/MFA yayın kapıları kapatılmadan ticari açılış yok.
6. Onaylı sürümde current symlink'ini yeni release'e yöneltin, servis restart,
   `/healthz`, login ve QR smoke testi yapın. Sağlık ve 429/5xx alarmlarını izleyin.
   PWA güncellemesinde tüm açık uygulama sekmelerini kapatıp yeniden açın;
   kök worker cache sürümü artırılmıştır. Bu dağıtımda otomatik skipWaiting yoktur.

## Yedekleme ve geri dönüş prosedürü

SQLite API kaynağı: [Node SQLite backup](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).
CSRF tasarım kaynağı: [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

- Canlı WAL kullanan DB'yi `cp fitness.sqlite` ile yedeklemeyin; açık bağlantıda
  commit'ler WAL'da olabilir. WAL/SHM dosyalarını canlıyken silmeyin.
- Özel, uygulama dışı, 0700 bir yedek dizinini önceden hazırlayın. `node scripts/database.js
  backup /var/lib/formclub/fitness.sqlite /secure-backups/formclub-UNIQUE.sqlite`
  yeni dosya oluşturur. Var olan hedefi, bozuk snapshot'ı veya aynı kaynak/hedefi reddeder.
  Online backup üretim açıkken çalışabilir; kaynak readOnly açılır, henüz commit
  edilmemiş işlemler snapshot'a girmez. Farklı dosyasisteminde hedef/ara dizin aynı
  üst dizinde oluşturulur. Başarısızlık halinde exit code kontrol edilmeli.
- Zamanlayıcı: her gün ve her sürüm öncesi benzersiz hedefle çalıştırın; başarısız
  exit kodunda alarm. Öneri: RPO ≤24 saat, RTO ≤1 saat; işletmeci doğrulamalıdır.
  7 günlük + 4 haftalık + 3 aylık rotasyon örnektir; KVKK saklama politikasına göre
  karar verin. Otomatik silme bu araçta yoktur. Yerel ve şifreli offsite kopya,
  anahtarların ayrı saklanması ve erişim denetimi kurulmalıdır.
- Tatbikat: `node scripts/database.js restore /secure-backups/SNAPSHOT.sqlite
  /isolated-test/RESTORED.sqlite` yalnız **yeni** hedef oluşturur; integrity/FK
  kontrolü yapar ve geri dönen eski session/QR kayıtlarını iptal eder. Mevcut hedef
  veya hedef-WAL/SHM varsa durur. Kaynak snapshot değişmez. Restore birleştirme
  yapmaz; snapshot sonrasındaki işlemler yeni hedefte yoktur.
- Gerçek geri dönüş ayrı insan kararıdır: yazmaları bakım moduyla durdurun, servisi
  SIGTERM ile kapatın; mevcut DB/WAL/SHM dosyalarına dokunmadan yeni mutlak yola
  restore edin. FITNESS_DB_PATH'i yeni dosyaya ayarlayın, izinleri ve sürüm/şema
  uyumunu doğrulayın, servisi başlatıp health/login/QR/üye sayıları/son ödemeleri
  kontrol edin. Eski DB dosyalarını olay incelemesi ve veri kurtarma için koruyun.
- Kod rollback: servisi durdurup current symlink'ini önceki release'e döndürün;
  bu sürümde yıkıcı şema migration'ı yoktur. Önceki sürüm güvenlik düzeltmelerini
  kaybedeceğinden dış erişimi bakım modunda tutun. DB rollback yalnız kod rollback
  yetmiyorsa, onaylı restore ile ayrı dosyaya yapılır; snapshot sonrası ödeme ve
  rezervasyonları mutabakat yapmadan ticari kullanımı tekrar açmayın.

## Yerel doğrulama

```sh
NODE_ENV=test FITNESS_DB_PATH=:memory: node --test test/*.test.js tests/*.test.js
git diff --check
```

Son çalıştırma: **63/63 PASS**, 0 fail/skip. HTTP testleri geçici yerel port,
SQLite testleri bellek veya geçici dizin kullanır. `test/operations.test.js` gerçek
WAL/restore ve production SIGTERM; `test/security.test.js` cookie/CSRF/CORS/login
rate limit, hata redaksiyonu, XSS kaçışı ve health 200/503 kontrollerini ekler.
`git diff --check` başarılı. Sunucu dağıtımı, push veya main merge yapılmadı.

Sıradaki aşama: bağımsız staging güvenlik incelemesi ve gerçek mobil tarayıcı
kabul testleri; eş zamanlı olarak MFA/hesap yaşam döngüsü, KVKK, ödeme kapsamı,
yeni salon kurulumu ve şifreli offsite yedek/alarmların tamamlanması.
