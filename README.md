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
