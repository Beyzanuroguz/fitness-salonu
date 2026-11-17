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
> - Önceki mobil dalda `cap sync` (her iki mod) raporlandı; bu merge sırasında yeniden çalıştırılmadı.
> - Önceki mobil dalda `cap doctor` raporlandı; bu merge sırasında yeniden çalıştırılmadı.

## İki çalışma modu

| Mod | Web dosyaları | API | Durum |
| --- | --- | --- | --- |
| `remote` (varsayılan) | Sunucudan, `server.url` | Aynı köken, mevcut çerez oturumu | Güvenli aynı köken korunur; gerçek cihaz kabulü bekliyor. |
| `bundled` | Uygulama içinde (`build/web`, `public/` kopyası) | `FORMCLUB_API_URL` | Deneysel paketleme altyapısı. **Yayın BLOKE; giriş/QR desteklenmiyor.** |

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

### Bundled yayın durumu: BLOKE / deneysel

Bundled mod Android `https://localhost` veya iOS `capacitor://localhost` kökeninden
HTTPS API kökenine çağrı yapar. `credentials: include` mevcut `SameSite=Strict`
cookie'yi çapraz site kullanımına açmaz. Mevcut backend bu kökenlere CORS izni
vermez, POST isteklerini CSRF sınırında reddeder. Bu merge backend CORS, CSP veya
cookie korumalarını gevşetmez. Giriş, QR ve diğer kişisel API akışları bundled
modda desteklenmiyor; staging/production build env ile bundled mod reddedilir.

Paketleme testi yalnız dosya üretimini doğrular, çalışan oturum akışı değildir.
Yerel bundle için meta CSP/connect-src tasarımı, güvenli native kimlik doğrulama
ve yenileme/iptal mimarisi, WebView cookie politikası ve bağımsız güvenlik incelemesi
henüz yapılmadı. CORS localhost kökenlerine topluca açılarak bu engel gizlenmemeli.
Remote pilot aynı HTTPS kökeni ve mevcut HttpOnly/Secure/Strict cookie ile devam eder.

1. **Pilot altyapısı (yerel testler başarılı; cihaz doğrulaması bekliyor):** `server.url` kabuğu, kamera izinleri, çevrimdışı/kurulum sayfaları.
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
## Native ayarlar

- **iOS** `ios/App/App/Info.plist`: `NSCameraUsageDescription` var. Proje Swift Package Manager kullanır; CocoaPods gerekmez.
- **Android** `AndroidManifest.xml`:
  - `android.permission.CAMERA` izni var.
  - `android.hardware.camera` isteğe bağlı (`required="false"`), kamerasız cihazlara da kurulabilir.
  - Capacitor `BridgeWebChromeClient`, sayfadaki kamera isteğini çalışma anında izin sorusuna çevirir.
- **Güvenlik:** `allowMixedContent: false`, `webContentsDebuggingEnabled: false`, `loggingBehavior: 'none'`.

- **Sunucu (backend ekibi):**
  - HTTPS ve HSTS.
  - `.webmanifest`: `application/manifest+json` V9.5 HTTP testlerinde doğrulandı.
  - Statik dosyalar: `public, max-age=0, must-revalidate`; kişisel API ve hatalar `no-store`.
  - `Permissions-Policy: camera=(self), microphone=(), geolocation=()` HTTP testlerinde doğrulandı.
- **Uygulama mağazaları:** Apple, hesap oluşturan uygulamalarda uygulama içi hesap silme
  ister. Bugün hesapları yönetici açıyor; politika gözden geçirilmeli.
- **iOS WKWebView:** service worker yalnızca App-Bound Domains ile çalışır. Kabuk bunu
  gerektirmez; çevrimdışı sayfa native `errorPath` ile gösterilir.
- **Derleme:** Bu makinede JDK, Android SDK ve tam Xcode kurulu olmadığı için APK veya
  IPA derlemesi doğrulanmadı.


## V9.5 güvenli staging bağlantısı

[Staging kurulumu](../deploy/STAGING.md) ve [yayın kapıları](../PRODUCTION_READINESS.md).
`staging.env.example` yalnızca yapılandırma örneğidir; runtime-config veya native
projelerde üretilmiş canlı adresler commit edilmez. Örnek dosyayı repo dışında
saklayıp düzenleyin; Node `--env-file` seçeneğiyle configure çalıştırılabilir:

```sh
node --env-file=/etc/formclub-staging/mobile.env scripts/configure.js
```

`cap sync` sırasında da aynı env dosyasını/süreç değişkenlerini kullanın; farklı env
ile sync çalıştırmak başka adres üretebilir. Native platform dosyaları yeniden sync
ve gerçek cihazda test edilmeden mağaza paketi hazır kabul edilmez.

- `FORMCLUB_BUILD_ENV=staging`: HTTPS adresi ve eşleşen
  `FORMCLUB_EXPECTED_ORIGIN`, ayrı `.staging` paket kimliği zorunlu.
- `FORMCLUB_BUILD_ENV=production`: HTTPS + beklenen köken zorunlu; bu ayar mağaza
  onayı sağlamaz. Staging/release modunda cleartext opt-in bile reddedilir.
- Yalnızca kök sunucu kökeni desteklenir; `/app` alt dizini, kullanıcı bilgisi,
  token/query/hash içeren adresler reddedilir. Derleme hatası ham URL'yi loglamaz.
- Kabuk gerçek HTTPS sayfasını açar. Göreli API istekleri aynı kökenlidir; backend
  `capacitor://localhost` veya `https://localhost` CORS erişimini açmaz.
  SameSite=Strict/HttpOnly/Secure korunur. Gömülü web→cross-origin API mimarisi
  bu sürümün kapsamı değildir.
- Ek `allowNavigation` host izni kaldırıldı; yabancı kökenlerin native bridge'e
  alınması istenmez. Native logging `none`; mixed content/debug kapalı.
- Beklenen köken kontrolü derleme hatalarını yakalar; sertifika pinning değildir.
  TLS doğrulaması WebView/OS'ye aittir. Gerçek cihaz cookie, kamera ve yönlendirme
  davranışları henüz doğrulanmadı.

Capacitor `server.url` canlı yeniden yükleme/pilot kullanımına yöneliktir;
[resmî yapılandırma belgesi](https://capacitorjs.com/docs/config) bu seçeneği üretim
kullanımı için önermiyor. App Store/Play üretim mimarisi ve onayı hâlâ yayın kapısıdır.
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
