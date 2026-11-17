# FORM CLUB — Fitness Salonu MVP

**Tek repository**, **sıfır npm bağımlılığı**. Node.js 26 ile doğrudan çalışır.

## Başlatma

```bash
node server.js
```

Tarayıcıda **http://localhost:3000** adresini açın.

## İçerik

- Yönetici: özet, üyeler, paket/hak düzenleme, haftalık dersler, ödeme kaydı ve tahsilat, eğitmenler, duyurular, raporlar
- Üye: kişisel üyelik özeti, ders rezervasyonu, bekleme listesi, iptal, gelişim geçmişi, demo QR giriş
- Eğitmen: dersler, katılımcı listesi, geldi/gelmedi yoklaması ve ders hakkı düşümü
- Veri: Node.js yerleşik `node:sqlite` kullanılarak `fitness.sqlite` içinde kalıcı tutulur.

**Önemli:** Bu sürüm, yerel demo/MVP'dir. Rol seçimi gerçek kimlik doğrulaması değildir. QR kod görseli gerçek okunabilir QR değildir. Gerçek müşteri verileriyle internete açık biçimde kullanmayın. Canlıya çıkmadan önce giriş/oturum, yetkilendirme, KVKK, güvenlik, yedekleme ve gerçek QR doğrulama eklenmelidir.

## Repo ve veriler

`fitness.sqlite` ve WAL dosyaları `.gitignore` içindedir; üyelerin özel bilgileri GitHub'a yüklenmez. Veritabanı projenin içinde yerel olarak kalır; düzenli yedek gereklidir. Başlangıç verileri örnektir ve ilk açılışta otomatik oluşturulur.

## Komutlar

```bash
node -v
node server.js
```

`node:sqlite` Node.js 26 sürümünde kullanılabilir. Portu değiştirmek için `PORT=3001 node server.js`.

## V8 beslenme backend'i

V8 API'leri mevcut `fc_session` oturumunu kullanır. Yeni tablolar (`v8_foods`,
`v8_food_logs`) V7 tablolarından ayrıdır; V7 besin kayıtları taşınmaz, değiştirilmez.
V7 arayüzü ve `/api/v6/*` sözleşmeleri korunur. V8 arayüz bağlantısı bu backend
çalışmasına dahil değildir. V8'de yönetici dahil her hesap yalnızca kendi ürün ve
beslenme kayıtlarını okuyabilir, ekleyebilir ve silebilir; kullanıcı kimliği
istekten alınmaz. Eski V7 yönetici beslenme ekranı kendi mevcut yetkileriyle çalışır,
V8 tablolarına erişmez.

### İzole geliştirme ve test

Ana uygulamanın `fitness.sqlite` dosyasını kullanmadan geliştirmek için:

```bash
FITNESS_DB_PATH=/tmp/form-club-v8-dev.sqlite PORT=3001 node server.js
node --test
```

Testler `:memory:` SQLite kullanır; gerçek veritabanı açılmaz. HTTP testleri geçici
bir yerel port gerektirir. `NODE_ENV=test` ayarında açıkça ayrı `FITNESS_DB_PATH`
verilmesi zorunludur; uygulamanın varsayılan veritabanı yolu reddedilir.
Standart `node server.js` komutu mevcut veritabanını kullanmaya devam eder ve
V8 tablolarını ekler; gerçek veritabanında bu komutu çalıştırmadan önce ayrıca
dağıtım planlanmalıdır.

### API sözleşmesi

Tüm uçlar `/api/v8` altında ve oturum gerektirir. Mevcut HTTP sözleşmesiyle
uyumlu olarak başarılı yanıtlar `200`, doğrulama hataları `400`, oturumsuz erişim
`401`, başka kullanıcı kimliği gönderme `403`, bulunamayan/başkasına ait kaynak
`404`, eksik kaynak besin verisi `422`, harici servis hataları `502` döndürür.

| Yöntem ve yol | Girdi / davranış |
| --- | --- |
| `GET /foods/search?q=yulaf` | Open Food Facts'te arama; `products` içinde ad, dört adet 100 gram değeri ve kaynak bilgisi döner. |
| `POST /foods/select` | `{"source_id":"3017620422003"}`; ürünü kaynaktan tekrar okur, değerleri otomatik doldurur ve kullanıcıya ait ürünü kaydeder. Yanıttaki `id` porsiyon kaydında kullanılır. İstemcinin gönderdiği besin değerlerine güvenilmez. |
| `POST /foods` | `name`, `kcal_100g`, `protein_100g`, `carbs_100g`, `fat_100g`; manuel ürün oluşturur. Dört değer de zorunludur, kaynak `manual` olarak saklanır. |
| `GET /foods` | Yalnızca oturumdaki kullanıcının seçtiği veya manuel eklediği ürünler. |
| `POST /food-logs` | `{"product_id":1,"grams":150,"consumed_on":"2026-11-16"}`; gram cinsinden porsiyon kaydı. |
| `DELETE /food-logs/:id` | Yalnızca kullanıcının kendi kaydını siler. |
| `GET /nutrition/history?period=daily&date=2026-11-16` | `period`: `daily`, `weekly`, `monthly`. Kayıtlar, porsiyon makroları, günlük dağılım, dönem toplamları ve günlük kalori ortalaması. |
| `POST /nutrition/bmi` | `{"height_cm":180,"weight_kg":80}` → `{"bmi":24.69}`. |
| `POST /nutrition/estimate` | Aşağıdaki parametrelerle VKİ, bazal metabolizma, koruma ve hedef kalori tahmini. |

Kalori tahmini örneği:

```json
{
  "age": 30,
  "height_cm": 180,
  "weight_kg": 80,
  "sex": "male",
  "activity": "moderate",
  "goal": "maintain"
}
```

Mifflin–St Jeor formülü cinsiyet parametresi gerektirir (`male` / `female`).
Bu hesap 18–100 yaş içindir. Aktivite seçenekleri: `sedentary` (1.2), `light`
(1.375), `moderate` (1.55), `active` (1.725), `very_active` (1.9).
`goal`: `lose` (koruma kalorisinden 300 kcal çıkar), `maintain` veya `gain`
(300 kcal ekle). Bunlar sabit uygulama varsayımlarıdır; sonuç `estimated:true`
ile döner ve kişisel beslenme reçetesi değildir.

Tarihler gerçek takvim tarihi olarak doğrulanır (`YYYY-MM-DD`). Haftalar pazartesi
başlar, aylar takvim ayıdır. Ortalamalar toplam kalorinin dönemin **tüm günlerine**
bölümüdür; kayıtsız günler sıfırdır. Devam eden dönemlerde gelecekteki kayıtsız
günler de bu paydaya dahildir. Tarih verilmezse UTC'de bugünün tarihi kullanılır;
Türkiye yerel günü isteniyorsa istemci `date` göndermelidir. Protein, karbonhidrat
ve yağ gramdır. Toplamlar yuvarlanmamış değerlerden hesaplanıp iki haneye yuvarlanır.

### Kaynak ve izlenebilirlik

Gerçek ürünler [Open Food Facts](https://world.openfoodfacts.org) üzerinden,
[resmi API belgelerine](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
ve [besin alanları şemasına](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/)
göre alınır. Her seçimde `source`, `source_id`, `source_url`, `source_license`
(`ODbL-1.0`) ve `retrieved_at` saklanır. Kaynakta sonradan değişen değerler mevcut
kayıtları değiştirmez; her seçim ayrı bir besin değerleri kopyasıdır. Veri yeniden
dağıtımında [Open Food Facts kullanım koşulları](https://world.openfoodfacts.org/terms-of-use)
ve kaynak atfı korunmalıdır.

Open Food Facts, ürün etiketlerinden topluluk tarafından derlenen açık bir
veritabanıdır; her ürün bağımsız laboratuvar doğrulaması taşımaz. Eksik, negatif
veya sınır dışı değerler sıfırla doldurulmaz, ürün elenir. Yalnızca kaynağın
`nutrition_data_per=100g` olarak bildirdiği ürünler kabul edilir; sıvılar için
hacimden grama yoğunluk dönüşümü yapılmaz. Ağ erişimi gerekir; kaynak hatalarında
uydurma/demo sonuç üretilmez. Aramalar 60 saniye, en fazla 100 arama terimi için
bellekte önbelleğe alınır; kaynak çağrıları 10 saniyede zaman aşımına uğrar.

Tahmin formülü kaynağı: [Mifflin ve ark., 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/).

### Doğrulama kapsamı

`node --test`: manuel ürün/porsiyon, makro toplamları, silme, kullanıcı ve yönetici
izolasyonu, hatalı girdiler, artık yıl ve yıl sınırları, boş dönemler, haftalık/aylık
ortalamalar, kaynak verisi eşleme ve hata yönetimi, VKİ/kalori hesabı, HTTP
giriş/çıkış ve V7 durum/CRM/ayar/besin uçları için kontroller. Harici servis testte
taklit edilir; testlerin geçmesi internet erişimine bağlı değildir.

### Frontend istek / yanıt örnekleri

Aynı origin'de oturum açıldıktan sonra çağrılarda `credentials: 'same-origin'`
kullanılır. Yazma isteklerinde `Content-Type: application/json` gönderilir.
Aşağıdaki kimlikler örnektir; sonraki istekte önceki yanıttan alınan gerçek `id`
kullanılmalıdır. `user_id` veya `member_id` göndermeye gerek yoktur.

```js
const response = await fetch('/api/v8/foods', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Örnek manuel ürün',
    kcal_100g: 100, protein_100g: 10, carbs_100g: 10, fat_100g: 2
  })
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
// data.id: porsiyon kaydında kullanılacak product_id
```

**Arama** — `GET /api/v8/foods/search?q=nutella`

```json
{
  "products": [{
    "name": "Nutella",
    "kcal_100g": 539, "protein_100g": 6.3, "carbs_100g": 57.5, "fat_100g": 30.9,
    "source": "Open Food Facts", "source_id": "3017620422003",
    "source_url": "https://world.openfoodfacts.org/product/3017620422003",
    "source_license": "ODbL-1.0", "retrieved_at": "2026-11-16T12:00:00.000Z"
  }],
  "attribution": "Open Food Facts — ODbL-1.0"
}
```

Kaynak arama sonuçlarını değiştirebilir; isim/değerler bu örnekle sabit değildir.
`products: []` geçerli bir boş arama yanıtıdır. Sıvı olduğu açıkça belirtilen
ürünler (`product_quantity_unit` veya `serving_quantity_unit`: `ml`, `cl`, `l`)
grama çevrilmeden elenir.

**Ürün seçimi** — `POST /api/v8/foods/select`

İstek:

```json
{"source_id":"3017620422003"}
```

Yanıt; otomatik doldurulacak değerler:

```json
{
  "id": 1, "user_id": 2, "name": "Nutella",
  "kcal_100g": 539, "protein_100g": 6.3, "carbs_100g": 57.5, "fat_100g": 30.9,
  "source": "Open Food Facts", "source_id": "3017620422003",
  "source_url": "https://world.openfoodfacts.org/product/3017620422003",
  "source_license": "ODbL-1.0", "retrieved_at": "2026-11-16T12:00:00.000Z"
}
```

**Manuel ürün** — `POST /api/v8/foods`

İstek:

```json
{"name":"Örnek manuel ürün","kcal_100g":100,"protein_100g":10,"carbs_100g":10,"fat_100g":2}
```

Yanıt:

```json
{
  "id": 2, "user_id": 2, "name": "Örnek manuel ürün",
  "kcal_100g": 100, "protein_100g": 10, "carbs_100g": 10, "fat_100g": 2,
  "source": "manual", "source_id": null, "source_url": null,
  "source_license": null, "retrieved_at": null
}
```

**Kayıtlı ürünler** — `GET /api/v8/foods`: Yukarıdaki ürün nesnelerinden oluşan
JSON dizisi döner (ürün yoksa `[]`). Son eklenen ilk gelir. Manuel üründe kalori
0–1000 kcal, makroların her biri 0–100 g; ad 2–200 karakter olmalıdır. Arama terimi
2–100 karakter, dış kaynak barkodu 8–14 rakam olmalıdır.

**Porsiyon ekleme** — `POST /api/v8/food-logs`

İstek ve yanıt:

```json
{"product_id":2,"grams":150,"consumed_on":"2026-11-16"}
```

```json
{"id":1}
```

`product_id` pozitif tam sayı ve kullanıcıya ait olmalıdır; `grams` 0.01–5000
gramdır. `consumed_on` zorunludur. Aynı güne birden fazla porsiyon eklenebilir.

**Porsiyon silme** — `DELETE /api/v8/food-logs/1`

Gövde gerekmez; yanıt:

```json
{"ok":true}
```

**Günlük geçmiş** — `GET /api/v8/nutrition/history?period=daily&date=2026-11-16`

Yukarıdaki 150 gram manuel ürün kaydının yanıtı:

```json
{
  "period": "daily", "start": "2026-11-16", "end": "2026-11-16", "days": 1,
  "average_daily_kcal": 150,
  "totals": {"kcal":150,"protein":15,"carbs":15,"fat":3},
  "daily": [{"date":"2026-11-16","kcal":150,"protein":15,"carbs":15,"fat":3}],
  "logs": [{
    "id": 1, "user_id": 2, "product_id": 2, "grams": 150,
    "consumed_on": "2026-11-16", "created_at": "2026-11-16 12:00:00",
    "name": "Örnek manuel ürün", "source": "manual", "source_url": null,
    "kcal_100g": 100, "protein_100g": 10, "carbs_100g": 10, "fat_100g": 2,
    "nutrients": {"kcal":150,"protein":15,"carbs":15,"fat":3}
  }]
}
```

**Haftalık geçmiş** — `GET /api/v8/nutrition/history?period=weekly&date=2026-11-16`

Aynı şemayla `period: "weekly"`, `start: "2026-11-16"`, `end: "2026-11-22"`,
`days: 7`, `average_daily_kcal: 21.43` döner. `daily` dizisinde 7 gün bulunur;
diğer altı günün değerleri sıfırdır. `logs` ve `totals` yalnızca bu haftayı kapsar.

**Aylık geçmiş** — `GET /api/v8/nutrition/history?period=monthly&date=2026-11-16`

Aynı şemayla `period: "monthly"`, `start: "2026-11-01"`, `end: "2026-11-30"`,
`days: 30`, `average_daily_kcal: 5` döner. `daily` dizisinde 30 gün bulunur.
`logs` tarih, ardından kimlik sırasındadır. Boş dönemde `logs: []`, tüm toplamlar
ve ortalama `0` döner; `daily` takvim günlerini sıfırlarla içerir.

**VKİ** — `POST /api/v8/nutrition/bmi`

```json
{"height_cm":180,"weight_kg":80}
```

```json
{"bmi":24.69}
```

VKİ giriş aralığı: boy 50–250 cm, kilo 1–500 kg. Formül: `kg / (cm / 100)²`.

**Enerji tahmini** — `POST /api/v8/nutrition/estimate`

```json
{"age":30,"height_cm":180,"weight_kg":80,"sex":"male","activity":"moderate","goal":"maintain"}
```

```json
{
  "bmi":24.69, "bmr":1780, "maintenance_kcal":2759,
  "target_kcal":2759, "formula":"Mifflin-St Jeor", "estimated":true
}
```

Enerji tahmininde yaş 18–100 tam sayı, boy 100–250 cm, kilo 30–350 kg olmalıdır.
Örnekte `goal: "lose"` için hedef 2459, `goal: "gain"` için 3059 kcal olur.
Kaloriler kcal/gün birimindedir. Cinsiyet, aktivite ve hedef zorunludur.

**Hata yanıtı** — Örneğin sıfır gram kaydı `400` döndürür:

```json
{"error":"Sayısal değer aralık dışında"}
```

Frontend hata metnine göre koşul kurmamalı, HTTP durum kodunu kullanmalıdır.
Kaynak servisin kullanılamadığı `502` durumunda manuel ürün ekleme kullanılabilir.


### Canlı kaynak kontrolü ve hata davranışı

16 Kasım 2026 kontrolünde eski `/cgi/search.pl` ve `/api/v2/search` uçları
HTTP **503** ile HTML bakım sayfası döndürdü; yanıt zaman aşımı değildi.
Bu nedenle V8 araması resmi `https://search.openfoodfacts.org/search` servisini
kullanır (`q`, `page_size=5`). Bu servis canlı kontrolde HTTP **200** döndürdü.
Arama indeksinin besin temeli alanı eksik olabildiğinden en fazla beş barkodun
ayrıntısı `/api/v2/product/:barcode` üzerinden ayrıca okunur. API yalnızca
bu ayrıntılardan doğrulanmış ürünleri döndürür; eksik değerlere varsayım yapmaz.
Arama bu nedenle en fazla beş ürün döndürür; uygun besin verisi olmayanlar elenir.

Barkod sorgusu ayrı bir istektir; `3017620422003` ürün sorgusu canlı kontrolde
HTTP **200** döndürdü. `/foods/select` her zaman barkod servisini yeniden sorgular.
Her kaynak isteği `User-Agent: FORM-CLUB/8.0 (nutrition integration;
https://world.openfoodfacts.org)` ve **10 saniye** timeout kullanır. Arama ve
paralel ürün ayrıntısı aşamaları nedeniyle toplam arama süresi daha uzun olabilir.
Frontend arama alanında debounce kullanmalıdır.

HTTP kaynak hatası, ağ bağlantısı, zaman aşımı ve geçersiz JSON ayrı ve anlaşılır
Türkçe mesajlarla `502` olarak döner. Örneğin HTTP 503 için:

```json
{"error":"Besin kaynağına erişilemiyor (HTTP 503). Lütfen daha sonra deneyin veya manuel ürün ekleyin."}
```

Başarısız kaynak isteği ürün kaydetmez, sahte besin verisi döndürmez ve başarılı
boş arama gibi gösterilmez. Testler kaynak hatalarını ve zaman aşımını mock
yanıtlarla denetler; gerçek kullanıcı veritabanı kullanılmaz.


---

# V8 Frontend Notları

# FORM CLUB — Fitness Salonu MVP

**Tek repository**, **sıfır npm bağımlılığı**. Node.js 26 ile doğrudan çalışır.

## Başlatma

```bash
node server.js
```

Tarayıcıda **http://localhost:3000** adresini açın.

## İçerik

- Yönetici: özet, üyeler, paket/hak düzenleme, haftalık dersler, ödeme kaydı ve tahsilat, eğitmenler, duyurular, raporlar
- Üye: kişisel üyelik özeti, ders rezervasyonu, bekleme listesi, iptal, gelişim geçmişi, demo QR giriş
- Eğitmen: dersler, katılımcı listesi, geldi/gelmedi yoklaması ve ders hakkı düşümü
- Veri: Node.js yerleşik `node:sqlite` kullanılarak `fitness.sqlite` içinde kalıcı tutulur.

**Önemli:** Bu sürüm, yerel demo/MVP'dir. Rol seçimi gerçek kimlik doğrulaması değildir. QR kod görseli gerçek okunabilir QR değildir. Gerçek müşteri verileriyle internete açık biçimde kullanmayın. Canlıya çıkmadan önce giriş/oturum, yetkilendirme, KVKK, güvenlik, yedekleme ve gerçek QR doğrulama eklenmelidir.

## Repo ve veriler

`fitness.sqlite` ve WAL dosyaları `.gitignore` içindedir; üyelerin özel bilgileri GitHub'a yüklenmez. Veritabanı projenin içinde yerel olarak kalır; düzenli yedek gereklidir. Başlangıç verileri örnektir ve ilk açılışta otomatik oluşturulur.

## Komutlar

```bash
node -v
node server.js
```

`node:sqlite` Node.js 26 sürümünde kullanılabilir. Portu değiştirmek için `PORT=3001 node server.js`.

## V8 Beslenme ve sağlık (`/v8.html`)

- Aranabilir besin/ürün kataloğu (Türkçe karakter duyarsız), gram veya porsiyon ile otomatik kalori ve makro hesabı
- Günlük beslenme günlüğü, haftalık/aylık kalori grafikleri, günlük ve haftalık ortalama kartları
- VKİ (DSÖ sınıflaması) ve Mifflin-St Jeor ile tahmini günlük enerji ihtiyacı (bilgiler kaydedilmez)
- Yalnızca mevcut V6 uç noktalarını kullanır: `/api/v6/foods`, `/api/v6/food-logs`. Örnek besin değeri içermez; ürünler ambalaj etiketinden girilir.

```bash
node --test tests/
```


---

# Yönetici Dashboard Geliştirmeleri

# FORM CLUB — Fitness Salonu MVP

**Tek repository**, **sıfır npm bağımlılığı**. Node.js 26 ile doğrudan çalışır.

## Başlatma

```bash
node server.js
```

Tarayıcıda **http://localhost:3000** adresini açın.

## İçerik

- Yönetici: özet, üyeler, paket/hak düzenleme, haftalık dersler, ödeme kaydı ve tahsilat, eğitmenler, duyurular, raporlar
- Üye: kişisel üyelik özeti, ders rezervasyonu, bekleme listesi, iptal, gelişim geçmişi, demo QR giriş
- Eğitmen: dersler, katılımcı listesi, geldi/gelmedi yoklaması ve ders hakkı düşümü
- Veri: Node.js yerleşik `node:sqlite` kullanılarak `fitness.sqlite` içinde kalıcı tutulur.

**Önemli:** Bu sürüm, yerel demo/MVP'dir. Rol seçimi gerçek kimlik doğrulaması değildir. QR kod görseli gerçek okunabilir QR değildir. Gerçek müşteri verileriyle internete açık biçimde kullanmayın. Canlıya çıkmadan önce giriş/oturum, yetkilendirme, KVKK, güvenlik, yedekleme ve gerçek QR doğrulama eklenmelidir.

## Repo ve veriler

`fitness.sqlite` ve WAL dosyaları `.gitignore` içindedir; üyelerin özel bilgileri GitHub'a yüklenmez. Veritabanı projenin içinde yerel olarak kalır; düzenli yedek gereklidir. Başlangıç verileri örnektir ve ilk açılışta otomatik oluşturulur.

## Komutlar

```bash
node -v
node server.js
```

`node:sqlite` Node.js 26 sürümünde kullanılabilir. Portu değiştirmek için `PORT=3001 node server.js`.

## V8 beslenme backend'i

V8 API'leri mevcut `fc_session` oturumunu kullanır. Yeni tablolar (`v8_foods`,
`v8_food_logs`) V7 tablolarından ayrıdır; V7 besin kayıtları taşınmaz, değiştirilmez.
V7 arayüzü ve `/api/v6/*` sözleşmeleri korunur. V8 arayüz bağlantısı bu backend
çalışmasına dahil değildir. V8'de yönetici dahil her hesap yalnızca kendi ürün ve
beslenme kayıtlarını okuyabilir, ekleyebilir ve silebilir; kullanıcı kimliği
istekten alınmaz. Eski V7 yönetici beslenme ekranı kendi mevcut yetkileriyle çalışır,
V8 tablolarına erişmez.

### İzole geliştirme ve test

Ana uygulamanın `fitness.sqlite` dosyasını kullanmadan geliştirmek için:

```bash
FITNESS_DB_PATH=/tmp/form-club-v8-dev.sqlite PORT=3001 node server.js
node --test
```

Testler `:memory:` SQLite kullanır; gerçek veritabanı açılmaz. HTTP testleri geçici
bir yerel port gerektirir. `NODE_ENV=test` ayarında açıkça ayrı `FITNESS_DB_PATH`
verilmesi zorunludur; uygulamanın varsayılan veritabanı yolu reddedilir.
Standart `node server.js` komutu mevcut veritabanını kullanmaya devam eder ve
V8 tablolarını ekler; gerçek veritabanında bu komutu çalıştırmadan önce ayrıca
dağıtım planlanmalıdır.

### API sözleşmesi

Tüm uçlar `/api/v8` altında ve oturum gerektirir. Mevcut HTTP sözleşmesiyle
uyumlu olarak başarılı yanıtlar `200`, doğrulama hataları `400`, oturumsuz erişim
`401`, başka kullanıcı kimliği gönderme `403`, bulunamayan/başkasına ait kaynak
`404`, eksik kaynak besin verisi `422`, harici servis hataları `502` döndürür.

| Yöntem ve yol | Girdi / davranış |
| --- | --- |
| `GET /foods/search?q=yulaf` | Open Food Facts'te arama; `products` içinde ad, dört adet 100 gram değeri ve kaynak bilgisi döner. |
| `POST /foods/select` | `{"source_id":"3017620422003"}`; ürünü kaynaktan tekrar okur, değerleri otomatik doldurur ve kullanıcıya ait ürünü kaydeder. Yanıttaki `id` porsiyon kaydında kullanılır. İstemcinin gönderdiği besin değerlerine güvenilmez. |
| `POST /foods` | `name`, `kcal_100g`, `protein_100g`, `carbs_100g`, `fat_100g`; manuel ürün oluşturur. Dört değer de zorunludur, kaynak `manual` olarak saklanır. |
| `GET /foods` | Yalnızca oturumdaki kullanıcının seçtiği veya manuel eklediği ürünler. |
| `POST /food-logs` | `{"product_id":1,"grams":150,"consumed_on":"2026-11-16"}`; gram cinsinden porsiyon kaydı. |
| `DELETE /food-logs/:id` | Yalnızca kullanıcının kendi kaydını siler. |
| `GET /nutrition/history?period=daily&date=2026-11-16` | `period`: `daily`, `weekly`, `monthly`. Kayıtlar, porsiyon makroları, günlük dağılım, dönem toplamları ve günlük kalori ortalaması. |
| `POST /nutrition/bmi` | `{"height_cm":180,"weight_kg":80}` → `{"bmi":24.69}`. |
| `POST /nutrition/estimate` | Aşağıdaki parametrelerle VKİ, bazal metabolizma, koruma ve hedef kalori tahmini. |

Kalori tahmini örneği:

```json
{
  "age": 30,
  "height_cm": 180,
  "weight_kg": 80,
  "sex": "male",
  "activity": "moderate",
  "goal": "maintain"
}
```

Mifflin–St Jeor formülü cinsiyet parametresi gerektirir (`male` / `female`).
Bu hesap 18–100 yaş içindir. Aktivite seçenekleri: `sedentary` (1.2), `light`
(1.375), `moderate` (1.55), `active` (1.725), `very_active` (1.9).
`goal`: `lose` (koruma kalorisinden 300 kcal çıkar), `maintain` veya `gain`
(300 kcal ekle). Bunlar sabit uygulama varsayımlarıdır; sonuç `estimated:true`
ile döner ve kişisel beslenme reçetesi değildir.

Tarihler gerçek takvim tarihi olarak doğrulanır (`YYYY-MM-DD`). Haftalar pazartesi
başlar, aylar takvim ayıdır. Ortalamalar toplam kalorinin dönemin **tüm günlerine**
bölümüdür; kayıtsız günler sıfırdır. Devam eden dönemlerde gelecekteki kayıtsız
günler de bu paydaya dahildir. Tarih verilmezse UTC'de bugünün tarihi kullanılır;
Türkiye yerel günü isteniyorsa istemci `date` göndermelidir. Protein, karbonhidrat
ve yağ gramdır. Toplamlar yuvarlanmamış değerlerden hesaplanıp iki haneye yuvarlanır.

### Kaynak ve izlenebilirlik

Gerçek ürünler [Open Food Facts](https://world.openfoodfacts.org) üzerinden,
[resmi API belgelerine](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
ve [besin alanları şemasına](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/)
göre alınır. Her seçimde `source`, `source_id`, `source_url`, `source_license`
(`ODbL-1.0`) ve `retrieved_at` saklanır. Kaynakta sonradan değişen değerler mevcut
kayıtları değiştirmez; her seçim ayrı bir besin değerleri kopyasıdır. Veri yeniden
dağıtımında [Open Food Facts kullanım koşulları](https://world.openfoodfacts.org/terms-of-use)
ve kaynak atfı korunmalıdır.

Open Food Facts, ürün etiketlerinden topluluk tarafından derlenen açık bir
veritabanıdır; her ürün bağımsız laboratuvar doğrulaması taşımaz. Eksik, negatif
veya sınır dışı değerler sıfırla doldurulmaz, ürün elenir. Yalnızca kaynağın
`nutrition_data_per=100g` olarak bildirdiği ürünler kabul edilir; sıvılar için
hacimden grama yoğunluk dönüşümü yapılmaz. Ağ erişimi gerekir; kaynak hatalarında
uydurma/demo sonuç üretilmez. Aramalar 60 saniye, en fazla 100 arama terimi için
bellekte önbelleğe alınır; kaynak çağrıları 10 saniyede zaman aşımına uğrar.

Tahmin formülü kaynağı: [Mifflin ve ark., 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/).

### Doğrulama kapsamı

`node --test`: manuel ürün/porsiyon, makro toplamları, silme, kullanıcı ve yönetici
izolasyonu, hatalı girdiler, artık yıl ve yıl sınırları, boş dönemler, haftalık/aylık
ortalamalar, kaynak verisi eşleme ve hata yönetimi, VKİ/kalori hesabı, HTTP
giriş/çıkış ve V7 durum/CRM/ayar/besin uçları için kontroller. Harici servis testte
taklit edilir; testlerin geçmesi internet erişimine bağlı değildir.

### Frontend istek / yanıt örnekleri

Aynı origin'de oturum açıldıktan sonra çağrılarda `credentials: 'same-origin'`
kullanılır. Yazma isteklerinde `Content-Type: application/json` gönderilir.
Aşağıdaki kimlikler örnektir; sonraki istekte önceki yanıttan alınan gerçek `id`
kullanılmalıdır. `user_id` veya `member_id` göndermeye gerek yoktur.

```js
const response = await fetch('/api/v8/foods', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Örnek manuel ürün',
    kcal_100g: 100, protein_100g: 10, carbs_100g: 10, fat_100g: 2
  })
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
// data.id: porsiyon kaydında kullanılacak product_id
```

**Arama** — `GET /api/v8/foods/search?q=nutella`

```json
{
  "products": [{
    "name": "Nutella",
    "kcal_100g": 539, "protein_100g": 6.3, "carbs_100g": 57.5, "fat_100g": 30.9,
    "source": "Open Food Facts", "source_id": "3017620422003",
    "source_url": "https://world.openfoodfacts.org/product/3017620422003",
    "source_license": "ODbL-1.0", "retrieved_at": "2026-11-16T12:00:00.000Z"
  }],
  "attribution": "Open Food Facts — ODbL-1.0"
}
```

Kaynak arama sonuçlarını değiştirebilir; isim/değerler bu örnekle sabit değildir.
`products: []` geçerli bir boş arama yanıtıdır. Sıvı olduğu açıkça belirtilen
ürünler (`product_quantity_unit` veya `serving_quantity_unit`: `ml`, `cl`, `l`)
grama çevrilmeden elenir.

**Ürün seçimi** — `POST /api/v8/foods/select`

İstek:

```json
{"source_id":"3017620422003"}
```

Yanıt; otomatik doldurulacak değerler:

```json
{
  "id": 1, "user_id": 2, "name": "Nutella",
  "kcal_100g": 539, "protein_100g": 6.3, "carbs_100g": 57.5, "fat_100g": 30.9,
  "source": "Open Food Facts", "source_id": "3017620422003",
  "source_url": "https://world.openfoodfacts.org/product/3017620422003",
  "source_license": "ODbL-1.0", "retrieved_at": "2026-11-16T12:00:00.000Z"
}
```

**Manuel ürün** — `POST /api/v8/foods`

İstek:

```json
{"name":"Örnek manuel ürün","kcal_100g":100,"protein_100g":10,"carbs_100g":10,"fat_100g":2}
```

Yanıt:

```json
{
  "id": 2, "user_id": 2, "name": "Örnek manuel ürün",
  "kcal_100g": 100, "protein_100g": 10, "carbs_100g": 10, "fat_100g": 2,
  "source": "manual", "source_id": null, "source_url": null,
  "source_license": null, "retrieved_at": null
}
```

**Kayıtlı ürünler** — `GET /api/v8/foods`: Yukarıdaki ürün nesnelerinden oluşan
JSON dizisi döner (ürün yoksa `[]`). Son eklenen ilk gelir. Manuel üründe kalori
0–1000 kcal, makroların her biri 0–100 g; ad 2–200 karakter olmalıdır. Arama terimi
2–100 karakter, dış kaynak barkodu 8–14 rakam olmalıdır.

**Porsiyon ekleme** — `POST /api/v8/food-logs`

İstek ve yanıt:

```json
{"product_id":2,"grams":150,"consumed_on":"2026-11-16"}
```

```json
{"id":1}
```

`product_id` pozitif tam sayı ve kullanıcıya ait olmalıdır; `grams` 0.01–5000
gramdır. `consumed_on` zorunludur. Aynı güne birden fazla porsiyon eklenebilir.

**Porsiyon silme** — `DELETE /api/v8/food-logs/1`

Gövde gerekmez; yanıt:

```json
{"ok":true}
```

**Günlük geçmiş** — `GET /api/v8/nutrition/history?period=daily&date=2026-11-16`

Yukarıdaki 150 gram manuel ürün kaydının yanıtı:

```json
{
  "period": "daily", "start": "2026-11-16", "end": "2026-11-16", "days": 1,
  "average_daily_kcal": 150,
  "totals": {"kcal":150,"protein":15,"carbs":15,"fat":3},
  "daily": [{"date":"2026-11-16","kcal":150,"protein":15,"carbs":15,"fat":3}],
  "logs": [{
    "id": 1, "user_id": 2, "product_id": 2, "grams": 150,
    "consumed_on": "2026-11-16", "created_at": "2026-11-16 12:00:00",
    "name": "Örnek manuel ürün", "source": "manual", "source_url": null,
    "kcal_100g": 100, "protein_100g": 10, "carbs_100g": 10, "fat_100g": 2,
    "nutrients": {"kcal":150,"protein":15,"carbs":15,"fat":3}
  }]
}
```

**Haftalık geçmiş** — `GET /api/v8/nutrition/history?period=weekly&date=2026-11-16`

Aynı şemayla `period: "weekly"`, `start: "2026-11-16"`, `end: "2026-11-22"`,
`days: 7`, `average_daily_kcal: 21.43` döner. `daily` dizisinde 7 gün bulunur;
diğer altı günün değerleri sıfırdır. `logs` ve `totals` yalnızca bu haftayı kapsar.

**Aylık geçmiş** — `GET /api/v8/nutrition/history?period=monthly&date=2026-11-16`

Aynı şemayla `period: "monthly"`, `start: "2026-11-01"`, `end: "2026-11-30"`,
`days: 30`, `average_daily_kcal: 5` döner. `daily` dizisinde 30 gün bulunur.
`logs` tarih, ardından kimlik sırasındadır. Boş dönemde `logs: []`, tüm toplamlar
ve ortalama `0` döner; `daily` takvim günlerini sıfırlarla içerir.

**VKİ** — `POST /api/v8/nutrition/bmi`

```json
{"height_cm":180,"weight_kg":80}
```

```json
{"bmi":24.69}
```

VKİ giriş aralığı: boy 50–250 cm, kilo 1–500 kg. Formül: `kg / (cm / 100)²`.

**Enerji tahmini** — `POST /api/v8/nutrition/estimate`

```json
{"age":30,"height_cm":180,"weight_kg":80,"sex":"male","activity":"moderate","goal":"maintain"}
```

```json
{
  "bmi":24.69, "bmr":1780, "maintenance_kcal":2759,
  "target_kcal":2759, "formula":"Mifflin-St Jeor", "estimated":true
}
```

Enerji tahmininde yaş 18–100 tam sayı, boy 100–250 cm, kilo 30–350 kg olmalıdır.
Örnekte `goal: "lose"` için hedef 2459, `goal: "gain"` için 3059 kcal olur.
Kaloriler kcal/gün birimindedir. Cinsiyet, aktivite ve hedef zorunludur.

**Hata yanıtı** — Örneğin sıfır gram kaydı `400` döndürür:

```json
{"error":"Sayısal değer aralık dışında"}
```

Frontend hata metnine göre koşul kurmamalı, HTTP durum kodunu kullanmalıdır.
Kaynak servisin kullanılamadığı `502` durumunda manuel ürün ekleme kullanılabilir.


### Canlı kaynak kontrolü ve hata davranışı

16 Kasım 2026 kontrolünde eski `/cgi/search.pl` ve `/api/v2/search` uçları
HTTP **503** ile HTML bakım sayfası döndürdü; yanıt zaman aşımı değildi.
Bu nedenle V8 araması resmi `https://search.openfoodfacts.org/search` servisini
kullanır (`q`, `page_size=5`). Bu servis canlı kontrolde HTTP **200** döndürdü.
Arama indeksinin besin temeli alanı eksik olabildiğinden en fazla beş barkodun
ayrıntısı `/api/v2/product/:barcode` üzerinden ayrıca okunur. API yalnızca
bu ayrıntılardan doğrulanmış ürünleri döndürür; eksik değerlere varsayım yapmaz.
Arama bu nedenle en fazla beş ürün döndürür; uygun besin verisi olmayanlar elenir.

Barkod sorgusu ayrı bir istektir; `3017620422003` ürün sorgusu canlı kontrolde
HTTP **200** döndürdü. `/foods/select` her zaman barkod servisini yeniden sorgular.
Her kaynak isteği `User-Agent: FORM-CLUB/8.0 (nutrition integration;
https://world.openfoodfacts.org)` ve **10 saniye** timeout kullanır. Arama ve
paralel ürün ayrıntısı aşamaları nedeniyle toplam arama süresi daha uzun olabilir.
Frontend arama alanında debounce kullanmalıdır.

HTTP kaynak hatası, ağ bağlantısı, zaman aşımı ve geçersiz JSON ayrı ve anlaşılır
Türkçe mesajlarla `502` olarak döner. Örneğin HTTP 503 için:

```json
{"error":"Besin kaynağına erişilemiyor (HTTP 503). Lütfen daha sonra deneyin veya manuel ürün ekleyin."}
```

Başarısız kaynak isteği ürün kaydetmez, sahte besin verisi döndürmez ve başarılı
boş arama gibi gösterilmez. Testler kaynak hatalarını ve zaman aşımını mock
yanıtlarla denetler; gerçek kullanıcı veritabanı kullanılmaz.

## Yönetici ana sayfası — ortak dashboard

Ana uygulamada yönetici girişi **Genel bakış** sayfasını açar. `/v7.html` genel
bakışı da aynı `dashboard.js` / `dashboard.css` bileşenini kullanır. Üstte aktif
üye, seçili ayın tahsilatı, tüm bekleyen ödemeler, bugünkü girişler ve 7 gün içinde
bitecek aktif üyelikler bulunur. Ortada tahsilat ve yoklama devamlılığı; altta ders
doluluğu, ödeme düzeni ve yaklaşan bitiş listesi gösterilir.

- Kaynaklar mevcut `/api/me`, `/api/state`, `/api/v6/analytics` uçlarıdır. Yeni
  endpoint veya veritabanı değişikliği yoktur; dashboard veri yazmaz.
- Aylık görünüm seçilen ayın günlerini önceki ayla; yıllık görünüm seçilen yılın
  aylarını önceki yılla karşılaştırır. Yıl/ay seçilebilir, karşılaştırma kapatılabilir.
  Yıllık görünümde ay seçimi üstteki aylık tahsilat kartına uygulanır.
- Devam eden dönem önceki dönemin tamamıyla karşılaştırılır. Henüz gelmemiş
  günler/aylar ve var olmayan takvim günleri sıfır gibi gösterilmez. Sıfır,
  API kayıtlarında işlem bulunmayan geçmiş dönemdir. İşlenmiş yoklama yoksa
  devamlılık yüzdesi yerine “Veri yok” gösterilir.
- Devamlılık = geldi / (geldi + gelmedi). Doluluk = toplam dolu kontenjan /
  toplam kontenjan; derslerin yüzdelerinin basit ortalaması alınmaz.
- Ders API'si son 30 günden itibaren, en fazla 10.000 ders döndürür. Eski dönem
  dolulukları tam geçmiş değildir; ekranda kısmi tarihçe uyarısı gösterilir.
  Önceki dönem dolulukları da yalnızca erişilebilir kayıtlarla ve kapsam etiketiyle
  sunulur. İptal/bekleme listesi dolu kontenjana dahil değildir.
- Ödeme düzeninde payda seçilen dönemde vadeli tüm ödemelerdir. Ödeme tarihi
  eksik bir kayıt zamanında ödendi kabul edilmez; ayrıca listelenir. Tahsilat
  grafiklerinde mevcut analitik API'siyle uyumlu olarak ödeme tarihi eksikse
  vade tarihi kullanılır. Analitik yükleme hatası sıfır veriye dönüştürülmez;
  hata mesajı ve kullanılamayan grafik durumu gösterilir.
- Mobilde kartlar tek/iki kolona iner. Uzun grafik ve tablolar kendi alanlarında
  yatay kaydırılır. Grafiklerin erişilebilir tablo karşılıkları ve etiketli,
  klavyeyle kullanılabilen dönem kontrolleri vardır.

Doğrulama: `node --test`. Dashboard testleri hesapları, artık yıl/yıl geçişini,
API hatasını, güvenli metin çıktısını, yönetici girişi sonrası varsayılan ekranı,
filtre değişikliklerini ve ortak V7 entegrasyonunu kontrol eder. V8 beslenme
backend testleri de aynı komutta korunmuştur. Chrome görsel testi bu çalışma
kapsamında kullanıcı isteğiyle atlanmıştır. Testler yalnızca bellek veritabanı
kullanır; localhost:3000 sunucusu ve gerçek SQLite dosyaları kullanılmaz.

## V9 backend: QR giriş, hatırlatmalar ve eğitmen raporları

Yeni API'ler mevcut `fc_session` oturumunu, HttpOnly/SameSite cookie ayarlarını,
aynı kaynak kontrolünü ve JSON boyut sınırını kullanır. Üretimde HTTPS ile
`COOKIE_SECURE=1` kullanın. Yeni tablolar eklenir; mevcut kayıtlar taşınmaz.
Testler gerçek `fitness.sqlite` dosyasını açmaz.

| Uç nokta | Yetki ve davranış |
| --- | --- |
| `POST /api/v9/qr` gövde `{}` | Aktif üyeliği olan üye kendi QR içeriğini alır: `{token, expires_at, expires_in:60}`. `expires_at` Unix milisaniyedir. İstemci token'ı QR olarak gösterir; bu uç nokta resim üretmez. Yeni kod önceki kodu iptal eder. |
| `POST /api/v9/qr/verify` gövde `{ "token": "..." }` | Yalnızca yönetici tarar. Üyenin rolü, üyelik durumu, bitiş tarihi ve kodun üretildiği oturum yeniden denetlenir. Başarılı yanıtta `checkin_id`, `member_id`, `ok` döner. |
| `GET /api/v9/reminders` | Yalnızca üyenin kendi uygulama içi hatırlatmaları: gelecek 24 saatteki rezervasyonlu dersler, 7 gün içinde bitecek veya bitmiş üyelik ve 7 gün içinde vadesi gelecek veya gecikmiş bekleyen ödemeler. |
| `POST /api/v9/reminders/read` gövde `{ "id": "..." }` | Kendi güncel hatırlatmasını okundu işaretler; tekrar çağrı güvenlidir. |
| `GET /api/v9/teacher/reports/monthly?month=2028-02` | Yalnızca oturumdaki eğitmenin dersleri. Ay verilmezse İstanbul'daki güncel ay kullanılır. Başka eğitmen kimliğiyle kapsam genişletilemez. |

QR içeriği 32 rastgele bayttan oluşan hex token'dır. Veritabanında yalnızca SHA-256
özeti tutulur. Süre dolumu `now >= expires_at` sınırında uygulanır; tüketim ve
check-in aynı SQLite `BEGIN IMMEDIATE` işlemi içinde yapılır. Tekrar kullanım giriş
oluşturmaz. Oturum silinince ona bağlı QR de silinir. QR kodu oturum açma yerine
geçmez. Eski `POST /api/checkins` artık yalnızca yöneticiler içindir; üyeler bu
uç noktadan QR doğrulamasını atlayamaz. QR salon girişidir, ders yoklaması veya
ders hakkı tüketimi yapmaz.

Hatırlatmalar istek sırasında mevcut kayıtlardan hesaplanır; iptal edilen dersler,
ödenen borçlar ve yenilenen üyelikler sonraki okumada güncellenir. Okunma bilgisi
kullanıcıya özel saklanır. Harici bildirim, e-posta veya zamanlanmış görev yoktur.
Tarihler ve offsetsiz ders saatleri `Europe/Istanbul` esasına göre değerlendirilir.

Aylık rapor `class_count`, `capacity`, `booked`, `attended`, `marked`,
`attendance_percent`, `occupancy_percent` ve ders bazında `classes` döndürür.
Doluluk `reserved + attended` / toplam kapasite; katılım `attended` /
`attended + absent` olarak hesaplanır. İptal ve bekleme listesi sayılmaz.
Ders sayısı planlanmış tüm dersleri içerir; payda sıfırsa yüzde `null` döner.
Boş ayda sayılar sıfırdır. Ay filtresi ders başlangıç tarihine uygulanır.

Hatalar: oturumsuz `401`, yetkisiz/aktif olmayan üyelik `403`, geçersiz girdi
`400`, bulunmayan hatırlatma `404`, süresi geçmiş/kullanılmış/geçersiz QR `422`.
QR ve oturum token'larını URL, günlük veya analitik sistemlerine yazmayın.

Doğrulama: `node --test test/*.test.js tests/*.test.js`.


### Birleşik V1–V9 uygulama

Ana giriş `/` adresindedir. Yönetici, eğitmen ve üye aynı oturum ekranını kullanır;
menüler hesap rolüne göre açılır. Eski V7/V8/V9 adresleri ana uygulamaya yönlenir.
Beslenme ekranı V8 günlük, besin ekleme, analiz ve sağlık sayfalarını; QR,
bildirimler ve eğitmen raporları V9 modülünü aynı uygulama içinde açar.
QR doğrulama sunucuda yalnızca yöneticiye açıktır. Eğitmen kendi raporunu,
yönetici seçtiği eğitmenin raporunu görebilir.

Kök PWA çalışanı yalnızca açıkça listelenmiş statik dosyaları önbelleğe alır.
API yanıtları `no-store` kullanır; kişisel veriler, QR ve oturum bilgileri
Cache Storage'a yazılmaz. Çevrimdışı kabuk açılır, kişisel işlemler bağlantı ister.
Bildirimler uygulama açıkken sorgulanır; arka plan Web Push desteği yoktur.

Doğrulama: `NODE_ENV=test FITNESS_DB_PATH=:memory: node --test test/*.test.js tests/*.test.js`.
HTTP testleri geçici yerel port, V8 süreç testi geçici dizinde SQLite kullanır.


Üretim güvenliği, yayın kapıları, SQLite yedek/geri dönüş ve rollback adımları:
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Canlı ticari yayın onayı henüz verilmedi.

V9.5 bağımsız sentetik staging kurulumu ve mobil HTTPS yapılandırması:
[deploy/STAGING.md](deploy/STAGING.md).

## Nutrition+ (V9.5 devamı)

Ana uygulamanın Beslenme sekmesi artık kişisel Nutrition+ ekranını açar. Mevcut V8 ekranına bu ekrandaki bağlantıyla erişilir. Open Food Facts arama/barkod, gram-porsiyon, öğün günlüğü, dönem grafikleri, favori/son tüketilen ve tarifler için API sözleşmeleri, 96 testin sonucu, gerçek API doğrulaması ve kalan sınırlar: [NUTRITION_PLUS.md](NUTRITION_PLUS.md).

Nutrition+ birleşik ekranı `/nutrition/` adresindedir; ana uygulamanın Beslenme
menüsü aynı ekranı açar. Varsayılan adapter `/api/nutrition-plus` kullanır; eski
V8 endpointleri korunur. Güncel sözleşme, canlı kaynak kanıtı ve açık eksikler:
[NUTRITION_PLUS.md](NUTRITION_PLUS.md).
