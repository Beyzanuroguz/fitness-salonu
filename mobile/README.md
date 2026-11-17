# FORM CLUB mobil paket (Capacitor 8.6.2)

Bu klasör iOS ve Android uygulama kabuğudur. Backend (`server.js`, `backend/`, SQLite)
pakete **dahil edilmez**. Kök `package.json` değişmez; bağımlılıklar yalnızca `mobile/`
içine kurulur.

> **Doğrulama durumu:** Kamera, QR okutma, PWA kurulumu ve native paketler henüz
> **gerçek iPhone/Android cihazda denenmedi**.
>
> Bu makinede JDK, Android SDK ve tam Xcode yok. Bu yüzden APK ve IPA derlenmedi.
> Doğrulananlar:
> - `npm test` (yapılandırma, paketleme, gizlilik)
> - `cap sync` (her iki mod)
> - `cap doctor`

## İki çalışma modu

| Mod | Web dosyaları | API | Durum |
| --- | --- | --- | --- |
| `remote` (varsayılan) | Sunucudan, `server.url` | Aynı köken, mevcut çerez oturumu | Backend değişikliği gerekmez. Pilot için hazır. |
| `bundled` | Uygulama içinde (`build/web`, `public/` kopyası) | `FORMCLUB_API_URL` | Mobil taraf hazır. **Backend desteği gelmeden çalışmaz.** |

Capacitor belgeleri `server.url` seçeneğini canlı yeniden yükleme için önerir. Apple,
yalnızca web sitesini saran uygulamaları 4.2 kuralıyla reddedebilir. Mağaza için hedef
`bundled` moddur.

### Komutlar

```bash
cd mobile
npm install
npm test

# remote
FORMCLUB_SERVER_URL=https://salon.example npm run sync

# bundled (backend desteği geldikten sonra)
FORMCLUB_API_URL=https://api.salon.example npm run sync:bundled

npm run open:ios        # Xcode gerekir
npm run open:android    # Android Studio + JDK gerekir
npm run doctor
```

| Değişken | Açıklama |
| --- | --- |
| `FORMCLUB_MODE` | `remote` (varsayılan) veya `bundled`. `sync:bundled` bunu kendisi ayarlar. |
| `FORMCLUB_SERVER_URL` | `remote` modu için sunucunun `https://` adresi. Sorgu (`?…`), `#`, kullanıcı adı veya şifre içeremez. Verilmezse yalnızca `www/index.html` kurulum sayfası açılır. |
| `FORMCLUB_API_URL` | `bundled` modu için API'nin `https://` kökeni. Uygulamaya `runtime-config.js` olarak yazılır. |
| `FORMCLUB_APP_ID` | Mağaza paket kimliği. Varsayılan `com.formclub.app` yalnızca yer tutucudur. Bu kimlik `cap add` sırasında native projelere yazılır; değişirse Xcode ve Gradle tarafında da güncelleyin. |
| `FORMCLUB_ALLOW_CLEARTEXT=1` | Yalnızca yerel ağda `http://` ile geliştirme için. Kamera HTTP üzerinde çalışmaz. |

## Gömülü mimari: web tarafında hazır olanlar

- `public/runtime-config.js` uygulama ayarını tanımlar: `window.FORMCLUB_CONFIG = { apiBase, native }`.
  - Web sunucusundaki dosyada `apiBase: ''`. Davranış aynı kalır: aynı köken, çerez oturumu.
  - `scripts/bundle-web.js` yalnızca paket kopyasında bu dosyayı `{ apiBase: FORMCLUB_API_URL, native: true }` ile değiştirir.
- `app.js`, `v8.js` ve `v9/v9.js` API çağrılarının başına `apiBase` ekler. `apiBase` doluysa istekler `credentials: 'include'` ile gider.
- `native: true` olduğunda service worker kaydedilmez. `sw.js` ve `v9/sw.js` pakete kopyalanmaz.
- Paketleme yalnızca `public/` klasörünü okur. `.sqlite`, `.db`, `.env`, `.pem` ve `.key` dosyası bulursa durur.
- Uygulamanın yerel kökenleri:
  - Android: `https://localhost` (`androidScheme: 'https'`)
  - iOS: `capacitor://localhost`

### Backend ekibinin yapması gerekenler (bu dalda değiştirilmedi)

- **CORS:** Yalnızca bu iki köken izinli olmalı ve `Access-Control-Allow-Credentials: true` dönmeli:
  - `https://localhost`
  - `capacitor://localhost`
- **Oturum:** Bugünkü çerez `SameSite=Strict`, bu yüzden çapraz kökende gönderilmez. iOS WKWebView ayrıca üçüncü taraf çerezleri kısıtlar. Önerilen çözüm: native istemci için kısa ömürlü `Authorization: Bearer` token ve yenileme akışı. Mevcut CSRF/köken kontrolü bu istemciyi de kapsamalı.
- **CSP:** `connect-src` yalnızca web sunucusu içindir. Paket sayfalarına ayrıca CSP meta etiketi eklenmeli; `connect-src` değeri API kökeni olmalı.

## Native ayarlar

- **iOS** `ios/App/App/Info.plist`: `NSCameraUsageDescription` var. Proje Swift Package Manager kullanır; CocoaPods gerekmez.
- **Android** `AndroidManifest.xml`:
  - `android.permission.CAMERA` izni var.
  - `android.hardware.camera` isteğe bağlı (`required="false"`), kamerasız cihazlara da kurulabilir.
  - Capacitor `BridgeWebChromeClient`, sayfadaki kamera isteğini çalışma anında izin sorusuna çevirir.
- **Güvenlik:** `allowMixedContent: false`, `webContentsDebuggingEnabled: false`, `loggingBehavior: 'production'`.

## Kalan eksikler

- Gerçek cihazda test (iPhone Safari, Android Chrome, iki native kabuk):
  - Kamera izni verildiğinde ve reddedildiğinde
  - Fener
  - QR kodunun süresinin dolması
  - Çevrimdışı ekran
  - Ana ekrana ekleme
- APK ve IPA derlemesi: JDK, Android SDK ve tam Xcode gerekli.
- Mağaza hazırlığı:
  - Gerçek paket kimliği
  - İkon ve açılış ekranı (kaynak: `public/v9/icons/`)
  - İmzalama sertifikaları
  - Gizlilik politikası
  - App Store veri gizliliği ve Google Play veri güvenliği formları
  - Uygulama içi hesap silme politikası
- `bundled` mod için yukarıdaki backend işleri.
- Push bildirimi yok. Bildirimler yalnızca uygulama açıkken sorgulanır.
