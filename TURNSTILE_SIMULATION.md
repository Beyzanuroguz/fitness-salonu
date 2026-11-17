# FORM CLUB sanal turnikeler (SIMULATION ONLY)

Dal: `feature/turnstile-qr-v1`, taban `integration/v9` `6fc3e56`.

**Bu modül gerçek kapı, turnike, röle veya donanım komutu üretmez ve çalıştırmaz.** Yalnızca
giriş/çıkış kaydı tutar. Render demo ve fiziksel donanım için kullanılan `TURNSTILE_ENABLED`
bayrağına bağlı değildir. Bu bayrağa dokunulmadı, demo güvenlik ayarları da değişmedi.

## Ekranlar

- **Yönetici: menüde Giriş ve bildirimler › Turnikeler.**
  - Turnike 1, 2 ve 3'ün QR kodları gösterilir. Her kod tek tek ya da hepsi birlikte
    yazdırılabilir; her kod ayrı sayfaya basılır.
  - İçerideki kişi sayısı, içeridekilerin listesi ve son 50 geçiş görünür. Geçişler
    başarılı ve reddedilen olarak, ret nedeniyle birlikte listelenir.
  - Her turnike için "Pasif yap / Aktif yap" ve "QR kimliğini yenile" vardır.
    Kimlik yenilenince eski basılı kod geçersiz olur.
  - Ekran 10 saniyede bir kendini yeniler.
- **Üye: menüde Genel › Turnike QR Tara.**
  - Telefon kamerası açılır. Okuyucu olarak tarayıcı destekliyorsa yerel
    `BarcodeDetector`, desteklemiyorsa uygulamayla gelen `jsQR` kullanılır.
  - Ekranda üyenin "salonda / dışarıda" durumu ve kendi geçiş geçmişi görünür.
  - Anlaşılır hata mesajı gösterilen durumlar: kamera izni reddi, kamera yok, desteklenmeyen
    tarayıcı, HTTPS olmayan adres, çevrimdışı ve oturumun kapanması.
- Mevcut üye QR kodu (`#entry`) ve yöneticinin QR okutma (`#scan`) akışı değişmedi.

## Çalışma mantığı

1. QR içeriği `FORMCLUB-GATE:1:<32 hex>` biçimindedir. Yalnızca turnikenin genel kimliğidir:
   üye bilgisi, sır ya da geçiş yetkisi taşımaz.
2. Üye kodu okutunca uygulama `POST /api/turnstiles/scan` isteğini gönderir. İstekte kod ve
   her okutma için yeni bir `idempotency_key` bulunur. İstek geçerli oturum çerezi, CSRF
   kaynak denetimi ve JSON zorunluluğuyla gider. QR'ı okumak tek başına geçiş sayılmaz.
3. Sunucu tek bir `BEGIN IMMEDIATE` işlemi içinde şunları yapar:
   - Aynı anahtar daha önce geldiyse kayıtlı sonucu döner (`replayed: true`). Ağ kopması
     sonrası tekrar göndermek çift kayıt oluşturmaz.
   - Kod tanınmıyorsa, yenilenmişse ya da turnike pasifse reddeder.
   - Son başarılı geçişin üzerinden 20 saniye geçmediyse `too_soon` ile reddeder.
     Bu, peş peşe okumaların giriş/çıkış döngüsü yaratmasını engeller.
   - Üye **dışarıdaysa GİRİŞ** kaydeder. Bunun için üyelik `Aktif` olmalı ve bitiş tarihi
     İstanbul saatine göre bugün ya da sonrası olmalı.
   - Üye **içerideyse ÇIKIŞ** kaydeder. Üyelik bitmiş olsa bile çıkış engellenmez.
4. Tablolar:
   - `gate_turnstiles`: turnike kimliği, adı, QR kodu ve aktiflik durumu.
   - `gate_presence`: üyenin içeride mi dışarıda mı olduğu.
   - `gate_events`: üye, turnike, yön, zaman, sonuç, ret nedeni ve istek anahtarı.
     `UNIQUE(user_id, idempotency_key)` kısıtı vardır.
5. Ders rezervasyonları, ders hakkı düşümü ve mevcut `checkins` tablosu kullanılmaz;
   turnike geçişleri bunlardan ayrı tutulur.
6. Rol sınırları:
   - Yalnızca üye okutma yapabilir.
   - Turnike listesi, aktif/pasif yapma ve kod yenileme yalnızca yöneticiye açıktır.
   - Üye yalnızca kendi geçişlerini görür.
   - Eğitmenin turnike ekranı yoktur.
7. Mevcut korumalar değişmedi: CSP, CSRF, oturum çerezi, `no-store` önbellek ayarı ve genel
   API sınırı (dakikada 600). Bunlara ek olarak kullanıcı başına dakikada 20 okutma sınırı
   konuldu; aşılırsa `429` döner.

## Sınırlamalar (yöneticiye ekranda da gösterilir)

- **Sabit QR kopyalanabilir.** Fotoğraf veya ekran görüntüsüyle salon dışından okutulabilir.
  Okutma fiziksel konum kanıtı değildir; yalnızca oturum açmış üyenin beyanını kaydeder.
  Kod sızarsa "QR kimliğini yenile" ile eskisini geçersiz kılın.
- Çevrimdışıyken geçiş yapılamaz, çünkü onay sunucudadır.
- iOS Safari'de `BarcodeDetector` yoktur; bu cihazlarda `jsQR` kullanılır, okuma daha yavaştır.
- Fiziksel cihazda kamera testi yapılmadı. Otomatik testler gerçek kodlayıcıyla üretilen
  QR'ı `jsQR` ile çözer, kamera kullanmaz.
- **Render Free demosunda turnike QR kimlikleri her yeniden başlatmada değişir.** Demo
  geçici SQLite kullanır. Servis uyuyup uyandığında, yeniden dağıtıldığında ya da yeniden
  başladığında veritabanı sıfırdan kurulur, üç turnikeye yeni QR kimliği verilir ve tüm
  geçiş kayıtları silinir. Önceden basılmış veya ekran görüntüsü alınmış kodlar "geçersiz
  veya yenilenmiş" hatası verir. Demoda kodları her oturumda Turnikeler ekranından yeniden
  açın ya da yazdırın.

## Demo test senaryosu

1. Yönetici olarak Turnikeler ekranını açın. Üç QR kodu yazdırın ya da ekranda açık bırakın.
2. Üye telefonunda (HTTPS) Turnike QR Tara ekranını açın, "Kamerayı aç"a dokunun ve
   **Turnike 2**'yi okutun. Ekranda "GİRİŞ kaydedildi" görünmeli.
3. Hemen Turnike 2'yi yeniden okutun. "Az önce geçiş yaptın" reddi görünmeli; durum değişmemeli.
4. 20 saniye sonra **Turnike 1**'i okutun. "ÇIKIŞ kaydedildi" görünmeli.
5. Yönetici ekranında iki başarılı kayıt ve bir ret görünmeli; içerideki kişi sayısı 0 olmalı.
6. Turnike 3 ile aynı adımları tekrarlayın.
7. Turnike 3'ü pasif yapıp okutun: "Bu turnike şu an kapalı" görünmeli.
8. Turnike 1'in QR kimliğini yenileyin. Eski kodun fotoğrafını okutun: "geçersiz veya
   yenilenmiş" görünmeli.

## Donanım entegrasyonu için kalanlar

- Kapı denetleyicisi ya da röle sürücüsü: ayrı bir servis yazılmalı ve
  `TURNSTILE_ENABLED=1` bayrağının arkasında tutulmalı. Kimlik doğrulaması karşılıklı TLS ya
  da imzalı istekle yapılmalı. Komut başarısız olursa geçiş kaydı geri alınmalı.
- Konum kanıtı için seçenekler: sabit QR yerine turnike ekranında birkaç saniyede bir değişen
  QR (TOTP), NFC/BLE ya da turnike tarafında okuyucu (üyenin dinamik QR'ı mevcut `#entry`
  akışıyla okutulur).
- Gün sonu "içeride kalanlar" temizliği ve yöneticinin elle çıkış yapabilmesi.
- Geçiş kayıtlarının saklama süresi ve KVKK aydınlatma metni.
- Gerçek cihaz testleri: iOS Safari, Android Chrome, düşük ışık, basılı kodun boyutu ve
  okuma mesafesi.
