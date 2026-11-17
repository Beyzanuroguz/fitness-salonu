# FORM CLUB Nutrition+ — birleşik API ve arayüz

Dal: `feature/nutrition-plus`. Backend koruma commit'i `ab5f06e`; arayüz kaynağı
`feature/nutrition-ui` / `d661406`. Kaydedilmemiş backend ve ilk ekran çalışması
korundu. Ana uygulamanın Beslenme menüsü `/nutrition/?embedded=1` ekranını açar;
doğrudan kullanım adresi `/nutrition/`.

## API ve veri sahipliği

Tüm uçlar `/api/nutrition-plus` altında mevcut cookie oturumu, CSRF ve no-store
başlıklarıyla çalışır. Her kişisel işlem oturumdaki `user.id` ile sınırlıdır.
Yönetici dahil başka hesaplar kullanıcının besinlerine, favorilerine, günlüklerine,
tariflerine veya hedeflerine erişemez. Mevcut rol menüleri korunur; eğitmen başka
üyenin beslenme dosyasını göremez. Eğitmen doğrudan Nutrition+ kullanırsa kendi
hesabının koleksiyonuyla çalışır. V6/V8 tabloları ve endpointleri değiştirilmedi.
Eski günlükler kendiliğinden yeni koleksiyona taşınmaz.

| Yöntem / yol | Gerçek destek |
|---|---|
| GET `/search?q=...` | Open Food Facts, 2–100 karakter, en fazla 5 sonuç |
| GET `/barcode?code=...` | Ürün ve kaynak/baz bilgisi; koleksiyona yazmadan okur |
| POST `/select` | `{code}`; sağlayıcıdan yeniden doğrulanan kullanıcıya özel anlık görüntü |
| GET `/foods?filter=...` | `all`, `favorites`, `recent`, `recipes`; kullanıcıya özel |
| POST `/foods` | `{name,basis:'g'/'ml',nutrients:{kcal,protein,carbs,fat}}`; elle girilmiş etiket olarak işaretlenir; eksikler null |
| PATCH `/foods/:id/favorite` | `{favorite:true/false}`; kalıcı favoriler |
| POST `/recipes` | `{name,ingredients:[{food_id,amount,unit}],yield_grams,portions}`; gram için eski `{food_id,grams}` de çalışır; malzemeler saklanır ve makrolar sunucuda hesaplanır |
| POST `/logs` | `{food_id,amount,unit,meal,day}`; `g`/`ml`, `breakfast/lunch/dinner/snack`; eski gram girdisi veya bilinen porsiyon sayısı desteklenir |
| DELETE `/logs/:id` | Yalnız kullanıcının kaydını siler |
| GET `/history?date=YYYY-MM-DD&period=...` | `daily/weekly/monthly`; öğünler, amount/unit, bilinen toplamlar ve eksik alan sayıları |
| GET/PATCH/DELETE `/goals` | Hesaba özel kalıcı kcal/protein/carbs/fat hedefleri; kullanıcı tarafından belirlenir, tıbbi öneri değildir |

Yeni tablolar `np_foods`, `np_logs`, `np_goals`; eski np_logs tablolarına `unit`
sütunu eklenir (eski kayıtlar g). Bu şema işlemleri yalnız seçili DB ile uygulama
başladığında çalışır. Bu görevde gerçek `fitness.sqlite` açılmadı veya değiştirilmedi;
testler :memory: ya da testlere ait geçici dizinlerde çalıştı.

## Besin doğruluğu ve birimler

Kaynak Open Food Facts'tır; API anahtarı veya FatSecret entegrasyonu yoktur. Ürün
seçimi istemciden gelen makrolara güvenmez. Manuel ürünler açıkça elle girilmiş,
tarifler malzemelerden hesaplanmış olarak gösterilir. Önizleme yalnız localhost'ta
`?preview=mock` ile isteyerek açılır ve kalıcı örnek-veri uyarısı taşır; sağlayıcı
hatasında örnek ürünlere geçilmez. Native/deployed host üzerinde mock modu açılmaz.

- Eksik enerji/makrolar null kalır, sıfır uydurulmaz. UI bilinmeyenleri belirtir;
  günlük ve grafik toplamları bilinen katkıların toplamıdır, tam tüketim değildir.
  Şeker/lif/tuz bu backend sürümünde kaynak sözleşmesine alınmadı; UI bunları
  bilinmiyor olarak gösterir. Bunların hedefleri desteklenmez.
- OFF `_100g` alanları kaynak şemasında 100 g veya 100 ml anlamına gelebilir.
  Açık `100ml` bilgisi ya da 100g/100ml etiketiyle beraber kaynak hacim birimi varsa
  hacim bazı seçilir. Belirsiz/çelişkili baz günlüğe alınmaz. Gram↔ml yoğunluğu
  varsayılmaz. Kaynak porsiyon birimi bazla eşleşiyorsa kullanılır; cl/l→ml yalnız
  aynı fiziksel boyutta dönüşümdür. Bilinmeyen porsiyon miktarı tahmin edilmez.
- Sıvı malzemeli tarif için ölçülmüş hazır tarif ağırlığı g cinsinden zorunludur;
  sıvı hacimlerinin toplamı gram sayılmaz. Backend malzemelerin miktar/birim ve
  kaynak anlık görüntülerini saklar. Makrolar malzeme kayıtlarından hesaplanır;
  eksik bir malzeme makrosu tarifte de bilinmiyor kalır.
- Arama cache'i yalnız halka açık sağlayıcı yanıtları için 5 dakika / 150 kayıtlık
  süreç belleğindedir. Eşzamanlı aynı istekler birleşir; süreç başına dakikada
  8 arama ve 12 ürün isteği sınırı vardır. Çoklu süreçte ortak limiter gerekir.
- Günlük, hedef ve kişisel koleksiyonlar browser storage'a yazılmaz. Preview/fallback
  durum yalnız bellektedir. PWA sadece statik Nutrition+ dosyalarını cache'ler;
  API istekleri bypass edilir. Çevrimdışıyken kişisel veri okunamaz/yazılamaz.

Kaynak belgeleri:
[OFF alan tanımları](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/html/data-fields.txt),
[beslenme veri modeli](https://openfoodfacts.github.io/documentation/docs/Product-Opener/dev/explain-nutrition-data/).
ODbL-1.0 / DbCL-1.0 atfı ve ürün kaynak bağlantıları korunur. Topluluk etiket verisi
laboratuvar doğrulaması değildir.

## Test kanıtları — 17 Kasım 2026

```sh
NODE_ENV=test FITNESS_DB_PATH=:memory: node --test test/*.test.js tests/*.test.js mobile/test/*.test.js
git diff --check
```

**125/125 PASS**, 0 başarısız/atlanan. Eski V8 adapter'ı açık `contract:'v8'`
seçimiyle regresyon testinde korunur; yeni ekranın varsayılan adapter'ı Nutrition+.
Yeni sözleşme testleri: ürün seçimi/lookup, kaynak makrolarına güven, gram/ml,
favoriler, öğünler, tarif malzemeleri ve null yayılımı, hedef kalıcılığı/silme,
üye/eğitmen/yönetici arasında sahiplik izolasyonu. HTTP testi oturum/CSRF/cache,
hedefler, manuel ml kayıtları ve `/nutrition/` dosyalarını doğrular. Mevcut QR,
PWA, güvenlik, staging, mobil ve V8 testleri de geçti.

Canlı OFF kontrolü bu görevde **2026-11-17 12:30:26 UTC**'de, bellek içi SQLite ile
çalıştı: `nutella` araması 5 sonuç; seçilen `0009800800049` —
`Hazelnut Spread + Breadsticks`; kaynak 100 g bazında 500 kcal, protein
7.69230769230769 g, karbonhidrat 65.3846153846154 g, yağ 25 g döndürdü.
Kaynak güncelleme zamanı `2026-11-14T16:15:34.000Z`. Bu değerler canlı kontrol
kaydıdır; kodda örnek veya varsayılan besin değeri olarak kullanılmaz.

## Tarayıcı test adresi ve kalan eksikler

Önceki entegrasyon kontrolünde açılmış geçici sunucu (bu incelemede başlatılmadı): `http://127.0.0.1:52110/nutrition/`.
İlk olarak `http://127.0.0.1:52110/` üzerinden yalnız test yöneticisi hesabı
oluşturup Beslenme menüsüne gidilebilir. Veritabanı tamamen bellektedir; sunucu
kapanınca test hesapları ve kayıtlar kaybolur. Gerçek salon sunucusu kullanılmadı.

- Browser erişim host'u kullanılamadığı için görsel/gerçek tarayıcı kontrolü
  NOT TESTED. HTTP/VM testleri görsel doğrulamanın yerine geçmez.
- Fiziksel kamera ve iOS/Android barkod testleri yapılmadı. BarcodeDetector yoksa
  veya izin reddedilirse elle barkod kullanılır; native/evirensel decoder yok.
- Vücut ölçümü geçmişi yeni UI'da desteklenmiyor; açık eksik özellik durumu var.
  Kalori/VKİ tahmini mevcut V8 hesap API'sine bağlıdır ve tahmin olarak etiketlenir.
- Tarif düzenleme/silme, geçmiş günlük düzenleme ve eski V8 günlüklerini taşıma yok.
- Ürün bazının/porsiyonunun bilinmediği durumda kayıt engellenir. Sıvı↔kütle
  dönüşümü için kullanıcı verisi uydurulmaz.
- Mağaza/gerçek cihaz yayını yapılmadı. Remote mod aynı HTTPS kökeninde kalır;
  bundled mod farklı kökenden Strict cookie/CORS nedeniyle hâlâ yayına bloke.
- Mevcut ticari yayın kapıları (KVKK, MFA/hesap yaşam döngüsü, ödeme doğrulaması,
  gerçek HTTPS/proxy, offsite yedek/alarmlar) kapanmadı.

Yalnız `feature/nutrition-plus` üzerinde commit; integration/v9 veya main'e merge,
GitHub push veya canlı dağıtım yok.


## Birleştirme sonrası sözleşme incelemesi

`70000b4` üzerindeki tüm dosyalar ve `ab5f06e` korundu; dosya silme/reset/clean
uygulanmadı. Beslenme menüsü `/nutrition/?embedded=1` adresine bağlı kalır.
Yeni ekrandan V8 beslenme/VKİ ekranına bağlantı eklendi.

Arama indeksi ürünün gram/ml bazını döndürmediğinden, arama sonucunu açmak önce
salt okunur barkod detayını getirir. Miktar ve porsiyon formu gerçek baz öğrenildikten
sonra açılır; bu okuma ürün kaydetmez. Tarif kaydında kaynak ürünün birimi değişmişse
miktar sessizce başka birime çevrilmez, kullanıcıdan yeniden girmesi istenir.
Desteklenmeyen baza sahip ürünler öğüne/tarife eklenemez. Kaynak alım/güncelleme
zamanları ve saklanmış tarif malzemelerinin kaynakları ürün detayında gösterilir.
Geçersiz kaynak tarihleri “Bilinmiyor” olarak kalır.

Kalıcılık ayrıca test için oluşturulmuş geçici SQLite dosyası kapatılıp yeniden
açılarak doğrulandı: favoriler, akşam öğünü, kalori/makro hedefleri, tarif malzemeleri,
porsiyon ağırlığı ve eksik makrolar korunur; diğer hesap bunları göremez.
Tüm ana ve mobil paket: **125 test geçti, 0 başarısız/atlanan**. HTTP testleri
geçici portlar için sandbox dışında, yalnız izole DB ile çalıştırıldı.
`git diff --check` ve staged diff denetimi uygulandı.
Gerçek `fitness.sqlite` dosyasının SHA-1 özeti değişmedi:
`27bca8ca772162f333ca2bc3078959926acab7af`.

Bu son inceleme yeni canlı API veya görsel tarayıcı kanıtı üretmez; yukarıdaki
canlı API kayıtları önceki kontrollerin kanıtlarıdır. Fiziksel kamera, görsel mobil
kontrol, ölçüm geçmişi, tarif düzenleme/silme ve V8 veri aktarımı sınırlamaları sürer.
