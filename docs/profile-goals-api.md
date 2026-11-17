# Kalori profili ve hedef API sözleşmesi (öneri)

Durum: **Taslak.** Frontend (`public/energy.js`) bu sözleşmeye göre yazıldı. Backend henüz
uygulamadı. Sunucu desteği gelene kadar arayüz profili yalnızca o sekmenin
`sessionStorage` alanında tutar ve kullanıcıya "hesabına kaydedilmedi" der. Hiçbir zaman
"kaydedildi" göstermez.

## Uç noktalar

Kimlik her zaman mevcut `fc_session` oturumundan alınır. İstek gövdesinde `user_id` veya
`member_id` kabul edilmez; gönderilirse ve oturumla uyuşmazsa `403` döner (mevcut V8/V9 kuralı).
Her hesap (yönetici dahil) yalnızca kendi profilini okur ve yazar.

| Yöntem | Yol | Gövde | Başarılı yanıt |
| --- | --- | --- | --- |
| `GET` | `/api/v9/nutrition/profile` | – | `200 {"profile": Profile \| null}` |
| `PATCH` | `/api/v9/nutrition/profile` | `ProfileInput` (kısmi olabilir) | `200 {"profile": Profile}` |

- Yol `/api/v9/` altında. Bu yolun mevcut yönlendiricisi tanımsız uçlarda `404 {"error":"API bulunamadı"}`
  döndürür. Frontend `404`, `405` ve `501` yanıtlarını "sunucu desteği yok" olarak yorumlar.
  Bu nedenle uç uygulandığında **profil yoksa 404 değil, `200 {"profile": null}` dönmelidir.**
- `PATCH`, mevcut CSRF korumasıyla uyumludur: `Content-Type: application/json` zorunlu,
  `Origin`/`Sec-Fetch-Site` aynı köken olmalı (`backend/security.js` `guard`).
- `PUT` kullanılmaz; `guard` yalnızca `GET`, `POST`, `PATCH`, `DELETE` kabul eder.

## Veri modeli

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
  "manual_kcal": 1900,
  "updated_at": "2026-11-17T09:30:00.000Z"
}
```

| Alan | Tür | Kural |
| --- | --- | --- |
| `age` | tam sayı \| null | 18–100. 18 altı saklanabilir ama hesap yapılmaz (frontend engeller). |
| `sex` | `"female"` \| `"male"` \| null | Yalnızca Mifflin–St Jeor sabiti için hesaplama parametresi. |
| `height_cm` | sayı \| null | 100–250 |
| `weight_kg` | sayı \| null | 30–350 |
| `activity` | enum | `sedentary` 1.2, `light` 1.375, `moderate` 1.55, `active` 1.725, `very_active` 1.9 |
| `goal` | enum | `lose` −300, `maintain` 0, `gain` +300 kcal (`/api/v8/nutrition/estimate` ile aynı) |
| `pregnancy`, `medical` | boolean | `true` ise standart hesap uygulanmaz; hedef yalnızca manuel olabilir. |
| `target_mode` | `"auto"` \| `"manual"` | |
| `manual_kcal` | tam sayı \| null | 1000–6000. `target_mode` `auto` olsa bile **silinmez**. |
| `updated_at` | ISO 8601 | Sunucu yazar. |

### Manuel hedefin korunması (zorunlu)

- Sunucu, `PATCH` gövdesinde bulunmayan alanları **değiştirmemelidir** (kısmi güncelleme).
- Ölçü (`weight_kg`, `height_cm`, `age`, `activity`, `goal`) değişince `target_mode` ve
  `manual_kcal` otomatik olarak değiştirilmemeli ya da sıfırlanmamalıdır.
- `target_mode` yalnızca kullanıcı açıkça `auto` gönderdiğinde değişir; bu durumda da
  `manual_kcal` saklanmaya devam eder ki kullanıcı manuel moda dönünce değeri geri gelsin.

### Doğrulama hataları

`400 {"error": "<Türkçe açıklama>"}`: aralık dışı sayı, bilinmeyen enum, `manual` modda
geçersiz `manual_kcal`. Frontend bu mesajı "Kaydedilemedi: …" olarak gösterir.

## Hesaplama (bilgi amaçlı)

Hedef sunucuda saklanmak zorunda değildir; frontend her zaman profilden hesaplar:

- BMR = 10 × kg + 6,25 × cm − 5 × yaş + (erkek +5, kadın −161)
- TDEE = BMR × aktivite katsayısı
- Otomatik hedef = TDEE + hedef farkı
- Uygulanmayan durumlar: 18 yaş altı, 100 yaş üstü, hamilelik/emzirme, enerji ihtiyacını
  etkileyen sağlık durumu, VKİ < 17. VKİ ≥ 40 ve BMR altı hedefler uyarı verir.

Sonuç genel bir tahmindir; tıbbi veya kişisel beslenme önerisi olarak sunulmaz.

## Gizlilik

- Yanıtlar `Cache-Control: no-store` ile döner (mevcut `security.headers`).
- Service worker'lar `/api/` isteklerini önbelleğe almaz.
- Çıkışta frontend `sessionStorage` içeriğini temizler.
- Yöneticinin başka bir üyenin profilini görmesi bu sözleşmede **yoktur**; gerekirse ayrı ve
  yetki denetimli bir uç olarak tasarlanmalıdır.
