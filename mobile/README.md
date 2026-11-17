# FORM CLUB mobil paket (Capacitor 8.6.2)

Bu klasör iOS ve Android uygulama kabuğudur. Backend (`server.js`, `backend/`, SQLite)
pakete **dahil edilmez**. Uygulama, yayındaki FORM CLUB sunucusunu HTTPS üzerinden açar.
Kök `package.json` değişmez; bağımlılıklar yalnızca `mobile/` içine kurulur.

## Neden uzak sunucu adresi?

Web uygulaması oturumu aynı kökenli çerezle tutar ve API'ye göreli `/api/...` adresleriyle
gider. Dosyalar uygulamanın içine gömülürse köken `capacitor://localhost` olur; bu durumda
CORS, `SameSite=None; Secure` çerez veya token tabanlı oturum gibi backend değişiklikleri
gerekir. Bu yüzden 1. aşamada kabuk `server.url` ile gerçek sunucuyu açar.

Capacitor belgeleri `server.url` seçeneğini canlı yeniden yükleme için önerir. Mağaza
sürümünden önce 2. aşamadaki seçenek ayrıca değerlendirilmelidir.

## Kurulum

```bash
cd mobile
npm install
FORMCLUB_SERVER_URL=https://salon-adresi.example npm run sync
npm run open:ios        # Xcode gerekir
npm run open:android    # Android Studio + JDK gerekir
npm test                # yapılandırma ve gizlilik testleri
```

| Değişken | Açıklama |
| --- | --- |
| `FORMCLUB_SERVER_URL` | Sunucunun `https://` adresi. Sorgu, `#`, kullanıcı adı veya şifre içeremez. Verilmezse uygulama yalnızca "Sunucu adresi yapılandırılmadı" sayfasını açar. |
| `FORMCLUB_APP_ID` | Mağaza paket kimliği. Varsayılan `com.formclub.app` yer tutucudur; yayından önce değiştirin. Kimlik `cap add` sırasında native projelere yazıldığı için değişince platformları yeniden oluşturun veya Xcode/Gradle içinde de güncelleyin. |
| `FORMCLUB_ALLOW_CLEARTEXT=1` | Yalnızca yerel ağda `http://` geliştirme sunucusu için (`localhost`, `10.x`, `192.168.x`, `172.16-31.x`, `.local`). Kamera HTTP üzerinde çalışmaz. |

`scripts/configure.js` adresi doğrular ve `www/runtime-config.js` dosyasını üretir (git dışı).
Bağlantı kesilince `www/offline.html` açılır.

## Native ayarlar (eklendi)

- iOS `ios/App/App/Info.plist`: `NSCameraUsageDescription` (QR okutma için kamera).
- Android `AndroidManifest.xml`: `android.permission.CAMERA` ve
  `android.hardware.camera` (`required="false"`). Capacitor `BridgeWebChromeClient`,
  WebView kamera isteğinde çalışma zamanı iznini ister.
- Android: `allowMixedContent: false`, `webContentsDebuggingEnabled: false`.
- iOS projesi Swift Package Manager kullanır; CocoaPods gerekmez.

## Aşamalı plan

1. **Pilot (hazır):** `server.url` kabuğu, kamera izinleri, çevrimdışı/kurulum sayfaları.
   Cihazda deneme için Xcode ve Android Studio gerekir.
2. **Mağaza hazırlığı:**
   - İkon ve açılış ekranı üretimi. Kaynak: `public/v9/icons/`.
   - Gerçek paket kimliği, imzalama sertifikaları ve gizlilik politikası adresi.
   - App Store veri gizliliği formu ve Google Play veri güvenliği formu.
3. **Gömülü web dosyaları (opsiyonel, backend işi gerekir):**
   - Backend tarafında CORS ve kimlik doğrulama değişikliği gerekir.
   - Uygulamada yapılandırılabilir bir API taban adresi gerekir.
   - Bu aşama Apple 4.2 "yalnızca web sitesi sarmalayıcı" reddi riskini azaltır.
4. **Bildirimler (opsiyonel):** bugün bildirimler yalnızca uygulama açıkken sorgulanır.
   Push için `@capacitor/push-notifications` ve backend tarafında APNs/FCM gerekir.

## Kalan gereksinimler

- **Sunucu (backend ekibi):**
  - HTTPS ve HSTS.
  - `.webmanifest` için `application/manifest+json` MIME türü. Şu an `application/octet-stream` dönüyor.
  - Statik dosyalar için `Cache-Control` başlığı.
  - `Permissions-Policy: camera=(self)`.
- **Uygulama mağazaları:** Apple, hesap oluşturan uygulamalarda uygulama içi hesap silme
  ister. Bugün hesapları yönetici açıyor; politika gözden geçirilmeli.
- **iOS WKWebView:** service worker yalnızca App-Bound Domains ile çalışır. Kabuk bunu
  gerektirmez; çevrimdışı sayfa native `errorPath` ile gösterilir.
- **Derleme:** Bu makinede JDK, Android SDK ve tam Xcode kurulu olmadığı için APK veya
  IPA derlemesi doğrulanmadı.
