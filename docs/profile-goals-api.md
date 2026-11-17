# Kalori profili ve Nutrition+ hedef API sözleşmesi

Durum: **Uygulandı ve izole SQLite ile test edildi.** `public/energy.js` ve
`backend/nutrition-plus.js` aynı saf hesaplama kurallarını kullanır. Profil ve
Nutrition+ kalori hedefi aynı SQLite transaction'ında kaydedilir. Eski taslak
`/api/v9/nutrition/profile` kullanılmaz; eski QR/rapor/V8 endpointleri korunur.

## Uçlar

| Yöntem | Yol | Sonuç |
|---|---|---|
| GET | `/api/nutrition-plus/profile` | `{profile: Profile veya null, goals: Goals veya null}` |
| PATCH | `/api/nutrition-plus/profile` | Kısmi profil güncelleme; sunucu hesaplar ve `{profile,goals}` onaylar |
| GET/PATCH/DELETE | `/api/nutrition-plus/goals` | Mevcut Nutrition+ hedef sözleşmesi; profil ile eşleşir |

Kimlik cookie oturumundan gelir. Üye, eğitmen ve yönetici yalnız kendi `user.id`
profilini görebilir. Başka kimlik gönderme 403; profil PATCH'inde tanınmayan alan
400. GET bulunmayan profil için 404 değil, 200/null döner. CSRF, JSON Content-Type,
CSP, SameSite=Strict/HttpOnly/Secure ve `Cache-Control: no-store` korunur.
CORS genişletilmez. Bundled mobil modun yayın blokajı devam eder.

```json
{
  "age": 30,
  "sex": "female",
  "height_cm": 168,
  "weight_kg": 64.5,
  "activity": "moderate",
  "goal": "maintain",
  "pregnancy": false,
  "medical": false,
  "target_mode": "manual",
  "manual_kcal": 1900
}
```

| Alan | Doğrulama |
|---|---|
| age | 18–100, tam sayı; manuel modda boş bırakılabilir |
| height_cm | 100–250; manuel modda boş bırakılabilir |
| weight_kg | 30–350; manuel modda boş bırakılabilir |
| sex | female/male; manuel modda boş olabilir, otomatikte gereklidir |
| activity | sedentary/light/moderate/active/very_active |
| goal | lose/maintain/gain |
| pregnancy, medical | Boolean; true ise otomatik hesap uygulanmaz |
| target_mode | auto/manual; hedef kaldırıldıktan sonra sunucu unset döndürür |
| manual_kcal | 800–6000 tam sayı; Nutrition+ mevcut hedef aralığıyla uyumlu |
| updated_at | Sunucu üretir; istemciden kabul edilmez |

Otomatik modda tüm gerekli ölçüler, yetişkin aralığı ve hesaplamanın uygulanabilirliği
sunucuda doğrulanır. VKİ <17, hamilelik/emzirme ve enerji hesabını etkileyen sağlık
durumu otomatik hedefi engeller. Uygun olmayan otomatik hesap 422; geçersiz tip,
aralık/enum 400 döner ve kayıt yapılmaz. Manuel hedef açık kullanıcı seçimidir;
standart hesap uygulanamasa bile geçerli aralıkta seçilebilir.

BMR = 10×kg + 6.25×cm − 5×yaş + (erkek 5 / kadın −161).
TDEE = BMR × aktivite katsayısı (1.2/1.375/1.55/1.725/1.9).
Hedef farkları lose −300, maintain 0, gain +300 kcal. Genel tahmindir; tıbbi veya
kişisel diyet önerisi olarak sunulmaz. Hesaplanan hedef Nutrition+ aralığının
dışındaysa sessizce kırpılmaz, kayıt reddedilir.

## Senkronizasyon ve kayıt doğruluğu

- Profil `np_energy_profiles` içinde kullanıcıya özel tutulur; şema yalnız seçili
  DB ile uygulama açıldığında eklenir. Bu çalışma gerçek müşteri DB'sini açmadı.
- Profil PATCH'inde bulunmayan alanlar korunur. Manuel moddaki boy/kilo/yaş/aktivite
  değişikliği manuel kcal'yi değiştirmez. Auto seçilince manuel değer silinmez;
  manuel moda geri dönüldüğünde aynı değer kullanılabilir.
- Profil kaydı aynı transaction'da `np_goals.kcal` değerini günceller; mevcut makro
  hedefleri korunur. İstemcinin gönderdiği hesaplanmış kcal'ye güvenilmez.
- Nutrition+ hedef formu kaydettiğinde mevcut profil manual moda geçer; ölçüler
  korunur. Hedef silindiğinde profil unset olur; ölçüler ve önceki manuel değer
  kalır ama eski otomatik hedef kayıtlıymış gibi kullanılmaz.
- Aynı kökenli Nutrition+ iframe'inden hedef değişikliği geldiğinde ana kabuk
  origin ve iframe source denetiminden sonra veriyi sunucudan yeniden okur;
  mesaj içindeki kalori değeri güvenilir veri olarak kullanılmaz.
- Ekran yalnız sunucunun profil onayından sonra “Hesabına kaydedildi” der. Hata,
  değişmiş taslak veya eksik sunucu desteği kaydedilmiş sayılmaz. Eksik API için
  eski-client fallback yalnız bellektedir; sessionStorage'a sağlık profili yazılmaz.
- Çıkış gerçek POST `/api/logout` isteğidir. Başarısız istekte oturum kapatılmış
  gibi gösterilmez. Başarılı çıkış belleği ve modülleri temizler; başka hesabın
  oturumu açılırsa önceki bekleyen profil yanıtları yeni hesaba uygulanmaz.

## Kanıtlar / sınırlar

`test/energy-profile.test.js`: otomatik/manüel, kısmi güncelleme, Nutrition+
eşleşmesi, silme, geçersiz hesapta kayıt yapmama, hesap izolasyonu ve yeni geçici
SQLite dosyasını kapatıp açtıktan sonra kalıcılık.
`test/energy-profile-http.test.js`: gerçek HTTP oturumu/CSRF/no-store, rol
izolasyonu, statik dosyalar ve logout sonrası 401.
`mobile/test/unified-ux.test.js`: menü/çekmece, kayıt dürüstlüğü, kalori formu,
gerçek çıkış isteği, başarısız çıkış ve Nutrition+ adresi.

Tüm ana ve mobil paket: **145/145 PASS**. Gerçek tarayıcı yerleşimi, fiziksel
cihaz/kamera, mağaza, canlı TLS/proxy ve hukuki sağlık verisi süreçleri bu yerel
testlerle doğrulanmış sayılmaz.
