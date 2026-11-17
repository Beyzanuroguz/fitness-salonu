# V9.5 bağımsız staging hazırlığı

Bu dosya bir prosedürdür; canlıya dağıtım yapılmadı. Staging'e müşteri DB'si,
yedekleri, cookie'leri veya müşteri verilerinin anonimleştirilmemiş kopyası taşınmaz.
Ayrı OS kullanıcısı, veri dizini, DNS/TLS, env dosyası ve mobil paket kimliği kullanın.
Canlı SQLite dosyasına hiçbir komut yöneltmeyin.

1. `deploy/staging.env.example` dosyasını repo dışında
   `/etc/formclub-staging/staging.env` olarak 0600 izinle hazırlayın. Domain'i size
   ait staging HTTPS kökeniyle değiştirin. `/var/lib/formclub-staging` parent dizinini
   staging kullanıcısı için 0700 hazırlayın; `data` alt dizini henüz mevcut olmamalı.
   Repo, üretim dizini ve müşteri DB yollarını kullanmayın.
2. Staging kullanıcısı olarak, sürüm dizininden:

   ```sh
   node --env-file=/etc/formclub-staging/staging.env scripts/prepare-staging.js
   ```

   Araç yalnız YENİ dizin ve `staging.sqlite` oluşturur. Kaynak/import parametresi
   yoktur, mevcut dizini/veriyi değiştirmez. Sentetik bir üye, eğitmen ve ders
   üretir; hesap/parola oluşturmaz. Hata olursa kısmi dizin korunur: inceleyin ve
   yeniden deneme için başka yeni dizin seçin; `reset/clean` veya canlı DB silme yok.
3. `scripts/create-admin.js` ile ayrı test yöneticisi açın. Parolayı stdin'den,
   terminal gizli girişinden verin; argv/env/geçmişe yazmayın. `.env` otomatik
   yüklenmez; aynı env dosyası gerekir. Yönetici arayüzünden sentetik üyeye bağlı
   üye ve eğitmene bağlı eğitmen test hesaplarını ayrı parolalarla oluşturun.
4. `APP_ENV=staging`, `NODE_ENV=production`, Secure cookie ve HTTPS PUBLIC_ORIGIN
   zorunludur. Başlatma, staging marker dosyasını ve onun kökenini, özel DB yolunu,
   symlink/hardlink ayrımını kontrol eder. Marker bir güvenlik sandbox'ı değildir:
   yetkili operatörün sonradan müşteri verisi kopyalamasını engellemez. Bunu yapmayın.
5. `formclub-staging.service.example` ve `nginx.staging.conf.example` ayrı kullanıcı,
   port 3101, domain, sertifika ve dizinlerle hazırlanmıştır. İşletim sisteminize
   göre uyarlayın ve syntax testlerini yapın; örnekler burada servise kurulmadı.
   Node yalnız loopback'te, dış port firewall ile kapalı olmalı. Reverse proxy
   HTTPS sonlandırır; backend forwarded header'a güvenerek CORS/cookie gevşetmez.
   Nginx host doğrulaması ve varsayılan vhost reddi kurulumda doğrulanmalı.
6. Staging yanıtlarında `X-Robots-Tag: noindex, nofollow, noarchive` var; bu erişim
   kontrolü değildir. Staging'i VPN/IP allowlist ile sınırlayın. Uygulamaya müşteri
   hesabı eklemeyin. Ortak uygulama IP rate limitini ve proxy limitini yükte ölçün.
7. Mobilde `mobile/staging.env.example` kullanın. `FORMCLUB_EXPECTED_ORIGIN` backend
   PUBLIC_ORIGIN ile aynı HTTPS kökeni, APP_ID ayrı `.staging` olmalı. Native sync
   adımına aynı env aktarılmalı; üretilmiş runtime adreslerini Git'e eklemeyin. Mevcut native projeler
   appId değişkeniyle otomatik yeniden adlandırılmaz; ayrı Xcode target/Gradle
   applicationId kurulumu ve binary kimlik kontrolü yapılmadan staging paketini
   üretim uygulaması yanında kurulabilir saymayın.
8. Kabul testi: HTTPS sertifika zinciri/HTTP yönlendirme, GET `/healthz` 200,
   manifest `application/manifest+json`, HTML/JS/SW revalidation başlıkları,
   login Secure/HttpOnly/Strict cookie, logout, üye QR→yalnız admin doğrulama,
   eğitmen izolasyonu, beslenme ve kamera izin reddi/izin kabulü, çevrimdışı hata
   ve geri bağlanma, iOS/Android PWA kurulum/güncelleme. Gerçek cihazda test
   edilmedikçe bu maddeler başarılı işaretlenmez.

Yerel otomasyon:

```sh
NODE_ENV=test FITNESS_DB_PATH=:memory: node --test test/*.test.js tests/*.test.js mobile/test/*.test.js
git diff --check
```

Testte staging yalnız geçici OS dizininde üretilir. Aynı HTTPS Origin başlığıyla
loopback HTTP proxy hop'u taklit edilir; bu gerçek TLS veya native WebView testi değildir.
Staging lifecycle: yeni sentetik ortam→yerel admin provisioning→login→üye QR→admin
verify→logout ve SIGTERM otomasyonda doğrulanır.

Staging rollback: servisi durdurun, önceki staging release'e dönün; test verisi
bozulursa yeni ayrı dizinle sentetik ortam hazırlayın. Canlı DB veya müşteri yedeği
ile staging'i onarmayın. Gerçek yedek/rollback planı `PRODUCTION_READINESS.md` içindedir.
