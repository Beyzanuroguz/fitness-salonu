# FORM CLUB QR destekli Dolap Yönetimi V1 (SIMULATION ONLY)

Dal: `feature/locker-qr-v1`. Taban: `feature/render-demo-turnstiles` `1f78558` (birleşik turnike ve Render demo dalı).

**Bu modül gerçek elektronik kilit, turnike motoru, röle veya donanım komutu üretmez ve çalıştırmaz.**
Yalnızca dolap tahsis kaydı tutar. `TURNSTILE_ENABLED=0` güvenlik bayrağı ve Render demo ayarları değişmedi.

## Ekranlar

### Yönetici: menüde Giriş ve bildirimler › Dolap Yönetimi

- Boş, Dolu, Bakımda, Pasif ve açık uyarı sayıları.
- Dolap kartları: ad, durum, QR kodu, atanmış üye ve tahsis saati. Tümü / Boş / Dolu / Bakımda / Pasif filtresi.
- **Dolap ekle**: yeni dolap `Dolap 21`, `Dolap 22` … adıyla ve yeni QR kimliğiyle eklenir (en fazla 200).
- **Yazdır** / **Tüm QR kodlarını yazdır**: her kod ayrı sayfaya basılır.
- **Üye ata**: boş dolaba üye atar (resepsiyon). Sebep zorunlu.
- **Manuel boşalt**: dolu dolabın tahsisini bitirir. Sebep zorunlu.
- **Bakıma al**, **Pasif yap**, **Kullanıma aç**. Sebep zorunlu. Dolu dolap önce boşaltılmalı.
- **QR yenile**: eski basılı kod geçersiz olur. Sebep zorunlu. Mevcut tahsis korunur.
- **Uyarılar: dolapla çıkış**: turnikeden çıkan ama dolabı hâlâ üzerinde görünen üyeler. "Uyarıyı kapat" ile not
  eklenerek kapatılır. Üye dolabı bırakınca veya yönetici boşaltınca uyarı kendiliğinden kapanır.
- **Dolap işlem kayıtları**: son 200 işlem. Zaman, dolap, üye, işlem, sonuç, aktör (kullanıcı adı ve rol),
  sebep veya ret nedeni.

### Üye: menüde Genel › Dolap QR Tara ve Genel › Dolabım

- Telefon alt çubuğunda artık **Turnike** ve **Dolabım** öne çıkar. Eski "QR kodum" (`#entry`) menüde durur
  ve çalışır; yöneticinin "QR okut" (`#scan`) akışı değişmedi.
- **Dolap QR Tara**: içeride/dışarıda durumu, mevcut dolap, kamera ile tarama. Dışarıdaysa
  "Önce turnike girişi" uyarısı ve Turnike QR Tara bağlantısı gösterilir.
- **Dolabım**: dolap adı, tahsis saati, "Dolabı bırak" (ikinci adımda "Evet, bırak" onayı), dolap geçmişi.
  Yönetici notları ve diğer kullanıcı adları üyeye gösterilmez.
- **Turnike QR Tara** ekranı: üye içerideyken dolabı varsa "Çıkmadan önce bırakmayı unutma" notu. Dolapla
  çıkışta "Dolabın hâlâ sende" uyarısı ve Dolabım bağlantısı.
- Kamera: turnike tarayıcısıyla aynı altyapı (`/turnstiles/qr-camera.js`). Android Chrome'da yerel
  `BarcodeDetector`, iPhone Safari'de uygulamayla gelen `jsQR`. HTTPS yoksa, izin reddedilirse, kamera yoksa,
  tarayıcı desteklemiyorsa veya bağlantı yoksa Türkçe açıklama gösterilir.

## Çalışma mantığı

1. QR içeriği `FORMCLUB-LOCKER:1:<32 hex>`. Yalnızca dolabın genel kimliğidir: üye bilgisi, sır veya kilit açma
   yetkisi taşımaz. Turnike kodu (`FORMCLUB-GATE:1:`) dolap ekranında okutulursa yönlendirme mesajı çıkar.
2. Üye kodu okutunca `POST /api/lockers/claim` gönderilir: kod ve her okutma için yeni `idempotency_key`.
3. Sunucu tek bir `BEGIN IMMEDIATE` işlemi içinde sırayla kontrol eder:
   - Aynı anahtar aynı istekle geldiyse kayıtlı sonucu döner (`replayed: true`). Aynı anahtar farklı bir
     istekle gelirse `409` döner; sahte "başarılı" yanıt verilmez.
   - Kod geçersiz / yenilenmiş → ret. Dolap bakımda veya pasif → ret.
   - Üye **`gate_presence` tablosuna göre içeride değilse** → `not_inside` reddi. İçeride/dışarıda bilgisi
     yalnızca turnike modülünün `gate_presence` tablosundan okunur; ikinci bir durum sistemi yoktur.
   - Üyelik `Aktif` ve bitiş tarihi İstanbul saatine göre bugün veya sonrası olmalı.
   - Üyenin zaten dolabı varsa → `has_locker`. Dolap başkasındaysa → `occupied`.
   - Geçerse tahsis kaydı oluşturulur.
4. Üye bırakma: `POST /api/lockers/me/release` (`confirm: true`, `assignment_id`, `idempotency_key`).
   `assignment_id` onaylanan tahsistir; eski bir sekmeden gelen istek daha yeni bir tahsisi bırakamaz (`409`).
5. Çıkış: turnike çıkışı **asla engellenmez**. Çıkış kaydı ve `gate_presence` güncellemesi yapılır, dolap
   tahsisi korunur, `locker_alerts` tablosuna yönetici uyarısı ve dolap loguna `exit_warning` eklenir. Bu dolap
   yazımları bir `SAVEPOINT` içinde çalışır; hata verseler bile turnike çıkışı kaydedilir.
6. Tablolar:
   - `lockers`: ad (UNIQUE), QR kodu (UNIQUE, 32 hex), durum (`available` / `maintenance` / `inactive`).
     "Dolu" durumu saklanmaz; aktif tahsisten türetilir.
   - `locker_assignments`: dolap, üye, kaynak (üye/yönetici), başlatan, başlangıç, bitiş, bitiren, bitiş nedeni.
     Kısmi UNIQUE indeksler: dolap başına bir aktif tahsis, üye başına bir aktif tahsis.
   - `locker_events`: tüm işlemler (ret dahil). Aktör kullanıcı ve rolü, işlem, sonuç, ret nedeni, yönetici
     sebebi (`note`), ayrıntı, istek anahtarı ve parmak izi, zaman. `UNIQUE(actor_user_id, idempotency_key)`.
   - `locker_alerts`: dolapla çıkış uyarıları ve kapatılma bilgisi (kim, ne zaman, not).
7. API ve roller:

   | Yöntem | Yol | Rol |
   | --- | --- | --- |
   | GET | `/api/lockers/me` | üye (yalnız kendi) |
   | POST | `/api/lockers/claim` | üye |
   | POST | `/api/lockers/me/release` | üye |
   | GET | `/api/lockers` | yönetici |
   | POST | `/api/lockers` | yönetici (dolap ekle) |
   | PATCH | `/api/lockers/:id` | yönetici (`status`, `reason`) |
   | POST | `/api/lockers/:id/rotate` | yönetici (`reason`) |
   | POST | `/api/lockers/:id/assign` | yönetici (`member_id`, `reason`) |
   | POST | `/api/lockers/:id/release` | yönetici (`assignment_id`, `reason`) |
   | POST | `/api/lockers/alerts/:id/resolve` | yönetici (`note` isteğe bağlı) |

   Eğitmenin dolap ekranı ve yetkisi yoktur. Rol kontrolü girdi doğrulamasından önce yapılır.
8. Mevcut korumalar geçerli: oturum çerezi, CSRF kaynak denetimi (`Origin`, `Sec-Fetch-Site`), JSON zorunluluğu,
   CSP, `no-store`, genel API sınırı (dakikada 600). Ek sınırlar: üye başına dakikada 20 dolap işlemi, yönetici
   başına dakikada 120 dolap yönetim işlemi. Aşılırsa `429`.
9. Eşzamanlılık: `BEGIN IMMEDIATE` yazma kilidi + kısmi UNIQUE indeksler. Test, iki ayrı SQLite bağlantısından
   (iki worker thread) aynı anda aynı dolaba istek gönderir; tam olarak biri kazanır, diğeri `occupied` alır.

## Ret nedenleri (ekranda Türkçe)

| Kod | Mesaj |
| --- | --- |
| `invalid_code` | Bu bir FORM CLUB dolap QR kodu değil. |
| `gate_code` | Bu bir turnike kodu. Turnike için "Turnike QR Tara" ekranını kullan. |
| `unknown_code` | Dolap QR kodu geçersiz veya yenilenmiş. |
| `maintenance` | Bu dolap bakımda. |
| `inactive` | Bu dolap kullanım dışı (pasif). |
| `not_inside` | Dolap almak için önce turnikeden giriş yapmalısın. |
| `membership` | Aktif üyelik gerekli. |
| `already_yours` | Bu dolap zaten sana ayrılmış. |
| `has_locker` | Zaten bir dolabın var. |
| `occupied` | Bu dolap dolu. |
| `no_locker` | Üzerinde kayıtlı dolap yok. |

## Sınırlamalar

- **Sabit QR kopyalanabilir.** Okutma fiziksel konum kanıtı değildir. Kod sızarsa "QR yenile" kullanın.
- Dolap kaydı fiziksel kilidi açmaz veya kilitlemez; gerçek kilit entegrasyonu bu sürümün kapsamı dışında.
- Çevrimdışıyken dolap alınamaz veya bırakılamaz; onay sunucudadır.
- Fiziksel iPhone / Android cihazda kamera testi yapılmadı. Otomatik testler gerçek kodlayıcıyla üretilen QR'ı
  `jsQR` ile çözer, kamera kullanmaz.
- Turnike ekranı kendi kamera kodunu korur (geriye dönük uyumluluk için değiştirilmedi); dolap ekranı aynı
  mantığın paylaşılan kopyasını (`qr-camera.js`) kullanır.
- **Render Free demosunda dolap QR kimlikleri, tahsisler, uyarılar ve tüm dolap logları her yeniden
  başlatmada sıfırlanır.** Demo geçici SQLite kullanır. Servis uyuyup uyandığında, yeniden dağıtıldığında ya da
  yeniden başladığında 20 dolap yeni QR kimlikleriyle yeniden oluşturulur. Basılı demo kodları "geçersiz veya
  yenilenmiş" hatası verir. Bu not demoda yönetici ekranında da gösterilir.

## Demo test senaryosu

1. Yönetici: Dolap Yönetimi'ni açın, 20 dolap ve "Boş 20" görünmeli. Dolap 3'ü yazdırın veya ekranda açın.
2. Üye (HTTPS telefon): Dolap QR Tara'da Dolap 3'ü okutun → "Dolap almak için önce turnikeden giriş yapmalısın".
3. Turnike QR Tara ile girin, sonra Dolap 3'ü okutun → "Dolap 3 senin". Dolabım'da tahsis saati görünür.
4. Başka bir üye hesabıyla Dolap 3'ü okutun → "Bu dolap dolu".
5. Üye 20 saniye sonra turnikeden çıkın → "ÇIKIŞ kaydedildi" ve "Dolabın hâlâ sende" uyarısı. Yönetici ekranında
   uyarı ve "Dolu" Dolap 3 görünür.
6. Dolabım › Dolabı bırak › Evet, bırak → dolap boşalır, uyarı kapanır.
7. Yönetici: bir dolabı sebep yazarak bakıma alın; üye okutunca "Bu dolap bakımda". Kayıtlarda sebep, zaman ve
   yönetici kullanıcı adı görünür.

## Testler

- `test/lockers.test.js` (11 test): 20 dolap ve benzersiz QR, QR'da kişisel veri olmaması, turnike girişi şartı,
  üyelik doğrulaması, üye ve dolap başına tek aktif tahsis, idempotency ve anahtar kötüye kullanımı, iki
  bağlantıdan gerçek eşzamanlı tahsis, DB kısıtları, bırakma ve onay, eski sekme koruması, yetki sınırları,
  yönetici müdahaleleri (sebep, aktör, zaman), bakım/pasif, QR yenileme, çıkış uyarıları ve savepoint, hız
  sınırı, QR çözme, HTTP (oturum, CSRF, JSON, CSP, eşzamanlı istek), menü ve arayüz.
- `test/render-demo.test.js`: demo hesaplarıyla dolap akışı ve yeniden başlatmada sıfırlanma.
- Çalıştırma: `npm test` (ana + mobil paket), `cd mobile && node --test test/`.
