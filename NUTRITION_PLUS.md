# FORM CLUB Nutrition+ — V9.5

Nutrition+ ana uygulamanın Beslenme sekmesindedir. Koyu/neon yeşil ekran mobil önceliklidir. V8 ekranı, VKİ/enerji tahminleri, V6/V8 tabloları ve API sözleşmeleri korunur; Nutrition+ başlığından V8'e erişilir. Eski günlükler otomatik aktarılmaz. QR, üyelik, ödeme ve oturum kodu değiştirilmemiştir.

## Veri ve mahremiyet

Yeni `np_foods` ve `np_logs` tabloları yalnızca uygulama başlatıldığında seçili veritabanında oluşturulur. Bu geliştirme sırasında gerçek veritabanıyla uygulama başlatılmamıştır. Her okuma/yazma oturumdaki `user.id` ile sınırlandırılır; başka kullanıcıların kayıtlarını yöneticiler de göremez. API yanıtları `no-store` kullanır. Günlükler, favoriler ve tarifler localStorage/IndexedDB/service worker önbelleğine yazılmaz. PWA yalnızca statik ekran dosyalarını önbelleğe alır. Çevrimdışıyken günlük okunamaz veya yazılamaz.

Kaynak Open Food Facts'tır. Arama yalnızca form gönderildiğinde yapılır; beş sonuç gösterilir. Ürün detayları barkodla sunucudan alınır. Ürün seçerken istemcinin besin değerlerine güvenilmez. Yanıtlar beş dakika süreyle, en fazla 150 kayıt olarak bellekte saklanır; eşzamanlı aynı istekler birleştirilir. Nutrition+ süreç başına dakikada 8 arama ve 12 ürün isteği sınırlar. Birden fazla sunucu sürecinde ortak rate limiter gerekir. Mevcut V8 sağlayıcı istemcisi ayrı kalır.

[Open Food Facts API belgeleri](https://openfoodfacts.github.io/openfoodfacts-server/api/) ve kaynak ürün bağlantıları esas alınmıştır. V8 ile uyumlu v2 ürün API'si kullanılır; v3 geçişi ileride değerlendirilebilir. `OFF_USER_AGENT` ile işletmeci iletişim bilgisini içeren uygulama tanımlayıcısı yapılandırılabilir. Kaynak atfı ODbL-1.0 / DbCL-1.0'dır; ürün resmi kullanılmaz.

Eksik enerji/makrolar `null` olarak saklanır; sıfır kabul edilmez. Geçersiz veya hacim bazlı etiket değerlerinden gram hesabı yapılmaz. Eksik makro içeren ürünlerin bilinen alanları kaydedilebilir; toplamlar `known` ve `missing` alanlarıyla döner, ekran yıldızla eksik toplamı belirtir. Tariflerde tek bir malzemede bile eksik makro varsa tarifin ilgili makrosu bilinmiyor kalır. Etiket verisinden farklı tahmin alanları kullanılmaz.

Porsiyon gramı yalnızca kaynak açıkça gram cinsinden bildiriyorsa kullanılır. Diğer ürünlerde kullanıcı doğrudan gram girer. Tarifler malzeme gramları ve kullanıcının bildirdiği hazır tarif ağırlığı üzerinden hesaplanır; porsiyon ağırlığı hazır ağırlık / porsiyon sayısıdır. Kayıtlı ürünler ve tarifler değişmez anlık görüntülerdir. Kaynak zamanı ile alım zamanı gösterilir; bilinmeyen kaynak zamanı açıkça belirtilir. Günlük hesapları yuvarlama öncesi değerlerle toplanır. Grafiklerde kcal/protein/karbonhidrat/yağ seçilebilir; hafta pazartesi başlar, ay gerçek takvime göre hesaplanır.

FatSecret istemcisi eklenmedi ve hiçbir anahtar kullanılmadı. Gelecekte yalnızca geçerli erişim bilgisi ve uygun lisans doğrulandığında eklenmelidir.

## API

Tüm uçlar `/api/nutrition-plus` altında, mevcut cookie oturumu ve CSRF denetimiyle çalışır.

| Yöntem / yol | Girdi / davranış |
| --- | --- |
| GET `/search?q=...` | 2–100 karakter; kaynak ürün adları ve barkodları |
| GET `/barcode?code=...` | 8–14 rakam; besinler, gram bazının uygunluğu, porsiyon, kaynak ve zamanlar |
| POST `/select` | `{code}`; kaynaktan ürün anlık görüntüsü kaydeder |
| GET `/foods?filter=...` | `all`, `favorites`, `recent`, `recipes`; yalnızca kendi koleksiyonu |
| PATCH `/foods/:id/favorite` | `{favorite:true/false}` |
| POST `/recipes` | `{name,ingredients:[{food_id,grams}],yield_grams,portions}` |
| POST `/logs` | `{food_id,grams,meal,day}` veya gram yerine `portions`; öğün `breakfast/lunch/dinner/snack` |
| DELETE `/logs/:id` | Kendi günlük kaydını siler |
| GET `/history?date=YYYY-MM-DD&period=...` | `daily/weekly/monthly`; günlük seri, öğün kayıtları, bilinen toplam ve eksik sayıları |

## Doğrulama — 17 Kasım 2026

`NODE_ENV=test FITNESS_DB_PATH=:memory: node --test test/*.test.js tests/*.test.js mobile/test/*.test.js`

Sonuç: **96 test geçti, 0 başarısız, 0 atlanan**. HTTP testlerinin geçici portları sandbox dışında çalıştırıldı. Veritabanları bellek içi veya testlere ait geçici dizinlerdedir. Kapsam: mevcut V8, QR, güvenlik, oturum/CSRF, ödeme/rapor sözleşmeleri, PWA ve mobil regresyonları; Nutrition+ sahiplik sınırları, porsiyon/öğünler, artık yıl/hafta geçişi, eksik makro, tarif, favori/son tüketilen, kaynak arızası, istemci verisine güvenmeme, HTTP erişimi ve temel VM ekran etkileşimleri.

Gerçek Open Food Facts servisiyle 2026-11-17 12:10 UTC'de, bellek içi SQLite kullanan Nutrition+ modülü üzerinden doğrulandı:

- `nutella` araması: 5 gerçek sonuç.
- Barkod `3017620422003`: Nutella; 100 g için 539 kcal, protein 6,3 g, karbonhidrat 57,5 g, yağ 30,9 g.
- Gerçek ürünün seçilip kaydedilmesi ve 30 g ara öğün hesabı: 161,7 kcal / 1,89 g protein / 17,25 g karbonhidrat / 9,27 g yağ.
- Kaynak güncellemesi `2026-11-17T08:07:47.000Z`; kaynak porsiyon gramı yok, tahmin edilmedi.

Gerçek `fitness.sqlite` SHA-1 başlangıç ve son kontrolde aynı: `27bca8ca772162f333ca2bc3078959926acab7af`. WAL/SHM dosyalarının özeti değişti; `lsof` bunları ayrı Node PID 12167'nin açık tuttuğunu gösterdi. Geliştirme/test süreçleri gerçek SQLite dosyasını açmadı; aktif kullanıcı sürecine müdahale edilmedi.

## Kalan doğrulamalar ve sınırlar

- Tarayıcı kontrol sunucusu kullanılamadığından görsel mobil/masaüstü kontrolü tamamlanamadı. VM etkileşim testi görsel kontrolün yerine geçmez.
- Kamera yalnızca `BarcodeDetector` ve kamera API'si bulunan cihazlarda çalışır; destek/izin yoksa elle barkod girilir. Fiziksel cihaz, iOS/Android kamera ve izin akışları doğrulanmadı. Evrensel barkod decoder / native tarama eklentisi eklenmedi.
- FatSecret entegrasyonu yoktur. Canlı sağlayıcı kesintisi, eksik ürün ve kaynak doğruluğu sınırlamaları devam eder.
- Eksik makrolar, bilinmeyen porsiyon gramları ve sıvıların yoğunluğu tahmin edilmez. Eksik verili toplamlar tam tüketimi temsil etmez.
- Günlük kaydı silinebilir; tarif düzenleme/silme ve geçmiş günlük kaydı düzenleme bu sürümde bulunmaz. Yeni tarif oluşturulabilir, günlük kaydı silinip yeniden eklenebilir.
- Yerel mobil paketleme/mevcut testler geçmiştir; mağaza derlemesi veya fiziksel cihaz yayını yapılmadı.

Yalnızca `feature/nutrition-plus` dalında commit hedeflenmiştir. `integration/v9` veya `main` üzerinde merge/push yapılmaz.
