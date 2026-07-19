# HaberX Telegram Haber Botu

Seçili haber kaynaklarını yaklaşık 60 saniyede bir kontrol eder. Yeni bulunan haberleri **başlık + bağlantı + kaynak** biçiminde `@HaberXOfficial` kanalında paylaşır ve aynı bağlantıyı tekrar göndermez.

## 1. Telegram ayarı

1. `@Haberxofficial_Bot` botunu `@HaberXOfficial` kanalına yönetici ekleyin.
2. **Mesajları yayınlama** iznini açın.
3. BotFather tokenini kimseyle paylaşmayın.

## 2. Bilgisayarda çalıştırma

Node.js 20 veya daha yeni bir sürüm kurulu olmalıdır.

```bash
npm install
```

`.env.example` dosyasının kopyasını `.env` adıyla oluşturun ve tokeni girin. Windows PowerShell'de çalıştırmak için:

```powershell
$env:TELEGRAM_BOT_TOKEN="BOTFATHER_TOKENINIZ"
$env:TELEGRAM_CHANNEL="@HaberXOfficial"
npm start
```

İlk açılışta mevcut haberler yalnızca kaydedilir; kanala gönderilmez. Bundan sonra yayımlanan yeni haberler otomatik gönderilir.

## 3. Kesintisiz çalıştırma

Botun anlık paylaşım yapması için programın 7/24 açık bir sunucuda çalışması gerekir. Docker destekleyen bir serviste şu gizli ortam değişkenlerini tanımlayın:

- `TELEGRAM_BOT_TOKEN`: BotFather tokeniniz
- `TELEGRAM_CHANNEL`: `@HaberXOfficial`
- `CHECK_INTERVAL_SECONDS`: `60`
- `MAX_POSTS_PER_CYCLE`: `10`

Kalıcı disk kullanıyorsanız `/app/data` dizinine bağlayın. Kalıcı disk olmazsa servis yeniden başladığında mevcut haberleri tekrar göndermez; ilk taramada yeniden kaydeder.

## Ücretsiz GitHub Actions kurulumu

Projeyi bir GitHub deposuna yükleyin. Depoda **Settings → Secrets and variables → Actions** bölümüne girip şu iki Repository Secret'ı oluşturun:

- `TELEGRAM_BOT_TOKEN`: BotFather'ın verdiği yeni token
- `TELEGRAM_CHANNEL`: `@HaberXOfficial`

Ardından **Actions → HaberX Otomatik Haber Botu → Run workflow** ile ilk çalıştırmayı başlatın. `.github/workflows/haberx.yml` dosyasındaki zamanlayıcı bundan sonra yaklaşık 5 dakikada bir otomatik çalışır. GitHub zamanlanmış işlerin başlangıcını yoğunluğa göre geciktirebilir; bu yöntem ücretsizdir fakat 60 saniyelik gerçek zaman garantisi vermez.

## Kaynaklar

Sözcü, Habertürk, Anadolu Ajansı, DHA, T24, TRT Haber, soL Haber ve Cumhuriyet etkindir. Sistem resmî RSS adreslerini öncelikli kullanır; RSS bulunmayan kaynaklarda yalnızca başlık ve bağlantı tespit eder.

Not: Bazı siteler RSS isteklerine zaman zaman 503/404 yanıtı verebilir. Bot bu durumda aynı kaynağın yedek RSS adresini veya haber sayfasını otomatik kullanır.

İHA, web sitesindeki abonelik/kullanım kısıtlaması nedeniyle varsayılan olarak kapalıdır. Yazılı kullanım veya abonelik izni alındıktan sonra `src/sources.js` içindeki lisanslı kaynak etkinleştirilebilir.

## Sorun giderme

- `chat not found`: Bot kanala yönetici eklenmemiş veya kanal kullanıcı adı yanlış.
- `not enough rights`: Bota mesaj yayınlama izni verilmemiş.
- `Unauthorized`: BotFather tokeni yanlış veya iptal edilmiş.
- Bir kaynak çalışmıyorsa site RSS adresini ya da HTML yapısını değiştirmiş olabilir.
