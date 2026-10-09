# QA Asistanı

Jira test ve release süreçlerini hızlandıran, **kendi bilgisayarınızda** çalışan web uygulaması.

- **Genel Bakış:** testte bekleyen, sırada ve beklemedeki maddeleriniz; her maddenin kaç gündür o statüde olduğu; dikkat gerekenler ve son 8 haftanın verimi.
- **Haftalık Rapor:** hafta hafta kapattığınız maddeler ve StoryPointTest eforu, bulduğunuz buglar, beklemeye aldıklarınız, size gelenler. Not ekleyip kaydedebilir, Markdown olarak kopyalayabilir ya da Teams'e gönderebilirsiniz.
- **Gelen Kutusu:** size atanan açık maddeler. Son 24 saatte gelenler, analizi bekleyenler ve bilgi talebi gerekenler ayrı filtrelenir.
- **Developer bilgi talebi:** component'i ve yorumu olmayan maddelerde, Developer alanındaki kişiyi etiketleyen hazır bir yorum taslağı oluşur. Siz onaylarsınız; aynı maddeye asla iki kez yazılmaz.
- **Test Takibi:** Claude Code'da üretilen test case'leri ekranda Başarılı / Başarısız / Bloke / Atlandı olarak işaretlersiniz. Sonuçtan estetik bir **HTML rapor** oluşur.
- **Madde kapatma:** rapor eki, özet yorum, Test Assignee, StoryPointTest ve statü geçişi tek bir sihirbazda yapılır. Önce önizleme gösterilir, sonra onayınızla uygulanır.
- **Release'ler:** çıkmamış paketler, gecikmiş ve yaklaşan çıkışlar, uzun süredir testte bekleyen maddeler ve testçide bekleyen maddeler.
- **Release kapatma:** ya hepsi ya hiçbiri. Kurallara uymayan bir durum varsa işlem başlamaz; ortada bir adım başarısız olursa yapılanlar geri alınır. Sonuç Teams'e bildirilir.

Bir AI servisine bağlanmaz ve API anahtarı gerektirmez. Analizler Claude Code sohbetinde üretilir. Veritabanı yoktur; veriler `data/` klasöründe JSON olarak tutulur ve git'e girmez.

Plan ve aşamalar: [docs/PLAN.md](docs/PLAN.md)

## Kurulum

Gereken: Node.js 22.12+ (24 önerilir).

```bash
npm install
copy .env.example .env.local      # macOS/Linux: cp .env.example .env.local
```

`.env.local` dosyasını doldurun. **`.env.example` dosyasına gerçek değer yazmayın:** o yalnızca şablondur, git'e girer ve uygulama onu okumaz.

| Değişken | Açıklama |
|---|---|
| `JIRA_BASE_URL` | `https://sirketiniz.atlassian.net` |
| `JIRA_EMAIL` | Token'ı oluşturduğunuz **Atlassian hesabının** e-postası |
| `JIRA_API_TOKEN` | https://id.atlassian.com/manage-profile/security/api-tokens |
| `DATA_DIR` | Opsiyonel; varsayılan `./data` |

```bash
npm run dev        # http://127.0.0.1:3000
```

Ardından **Ayarlar** sayfasında:
1. Bağlantı testinin yeşil olduğunu görün.
2. Alan eşlemesini kontrol edin: Developer, Test Assignee, StoryPointTest.
3. **Proje ekle** ile takip edeceğiniz projeleri Jira'dan seçin. To be Deployed, Completed ve "testte" statülerini eşleyin.
4. İsterseniz Teams hedefi ekleyin (aşağıya bakın).
5. Kaydedin.

### Teams bildirimleri

Uygulama Teams'e **İş Akışları (Workflows) web kancası** ile gönderir; IT onayı gerekmez. Üç hedef türü var:

| Tür | Ne zaman | Kurulum |
|---|---|---|
| **Kanal** | Bir ekip kanalına | Kanalın ⋯ menüsü → İş Akışları → aramaya `web kancası` → adında "kanal" geçen şablon |
| **Sohbet** | Sabit bir grup sohbetine | Sohbetin ⋯ menüsü → İş Akışları → `web kancası` → adında "sohbet" geçen şablon |
| **Kişiler** | Her gönderimde seçtiğiniz kişilere | Bir kez kurulan genel akış (adımlar Ayarlar'da, hedef türü "Kişiler" seçilince görünür) |

**Kişiler** türünde uygulama karta ek olarak seçilen kişilerin e-postalarını (`recipients`) gönderir. Akış listedeki her kişiye kartı Workflows botu sohbetinden ayrı ayrı iletir. Kişiler yalnızca Ayarlar → **Teams kişileri** listesinden seçilebilir; bir gönderimde en fazla 50 kişi. Her Kişiler hedefinin uygulamanın ürettiği bir **akış anahtarı** vardır (`x-qa-key` başlığı); akış bunu, alıcı sayısını ve şirket alan adını kontrol eder. Adres ve anahtar şifre gibidir. E-posta, kişinin Teams'te kullandığı kurumsal adres olmalı.

Şirket ağı HTTPS trafiğini kendi sertifikasıyla inceliyorsa, uygulama Windows'un güvendiği sertifikaları otomatik olarak kullanır.

### "Jira kimlik doğrulaması başarısız" (401)

- `JIRA_EMAIL`, token'ı oluşturan Atlassian hesabının e-postası olmalı. Şirket e-postanız ile Atlassian e-postanız farklı olabilir; id.atlassian.com'daki profilinize bakın.
- Token kopyalanırken eksik kalmış ya da token iptal edilmiş olabilir; yeni bir token oluşturup deneyin.
- `.env.local`'i değiştirdikten sonra uygulamayı yeniden başlatın.

## Madde analizi (Claude Code)

VS Code'da Claude Code'u bu klasörde açın ve yazın:

```
/jira-analiz PROJ-123
```

Claude:
1. Maddeyi Jira'dan okur (`npm run jira:issue -- PROJ-123`, salt okuma).
2. Özet, risk, açık soru ve test case'leri `data/analyses/PROJ-123.json` dosyasına yazar.
3. Dosyayı şemaya göre doğrular (`npm run analysis -- validate PROJ-123`).

Sonuç **Test Takibi** ekranında görünür. Uygulamadaki her "Analiz" düğmesi bu komutu panoya kopyalar. Başka bir yerde (ör. claude.ai) ürettiğiniz JSON'u **JSON yapıştır** ile ekleyebilirsiniz.

JSON sözleşmesi: [src/domain/analysis/schema.ts](src/domain/analysis/schema.ts) (kaynak) → [docs/schemas/issue-analysis.schema.json](docs/schemas/issue-analysis.schema.json) (`npm run analysis -- schema` ile üretilir).

## Komutlar

| Komut | İş |
|---|---|
| `npm run dev` | Geliştirme sunucusu (yalnızca 127.0.0.1) |
| `npm run build` / `npm start` | Production derleme ve çalıştırma |
| `npm test` | Birim, sözleşme ve sahte Jira ile akış testleri |
| `npm run typecheck` | TypeScript denetimi |
| `npm run jira:issue -- KEY` | Maddeyi Markdown olarak yazdırır |
| `npm run analysis -- path\|validate KEY` | Analiz dosyasının yolunu yazdırır / dosyayı doğrular |
| `npm run analysis -- schema` | JSON Schema dosyasını yeniden üretir |

## Durum ve yapılacaklar

Otomatik testler (`npm test`, 207 test) sahte bir Jira'ya karşı çalışır. Gerçek Jira ile uçtan uca deneme henüz yapılmadı. Aşağıdaki listeyi sırayla uygulayın; Jira'ya yazan adımları ilk kez **test amaçlı bir madde ve release** üzerinde deneyin.

### 1. Kurulum ve bağlantı
- [ ] `.env.local` doldurulmuş: klasik API token (*Create API token*, scope'lu olan değil) ve token'ı oluşturan hesabın e-postası
- [ ] `npm run dev` → Ayarlar → **Jira bağlantısı** yeşil, adınız görünüyor
- [ ] Alan eşlemesi doğru: Developer, Test Assignee, StoryPointTest
- [ ] **Proje ekle** ile proje eklendi; To be Deployed, Completed ve "testte" statüleri doğru; **Kaydet**
- [ ] (Opsiyonel) Teams hedefi eklendi; deneme kartı kanala/sohbete düştü
- [ ] (Opsiyonel) Kişiler akışı kuruldu, kişi listesi dolduruldu; seçilen kişilere deneme kartı ayrı ayrı geldi

### 2. Gelen Kutusu
- [ ] Size atanmış açık maddeler listeleniyor; "Yeni" rozetleri son 24 saattekilerde
- [ ] Bilgi talebi kuyruğunda yalnızca component'i ve yorumu olmayan maddeler var
- [ ] Önemsiz bir maddede bilgi talebi gönderildi → Jira'da Developer etiketli tek yorum; aynı madde tekrar gönderildiğinde ikinci yorum yok

### 3. Test Takibi ve madde kapatma
- [ ] Claude Code'da `/jira-analiz MADDE-NO` → analiz Test Takibi'nde görünüyor
- [ ] Case'ler işaretlenip not eklendi; sayfa yenilenince sonuçlar korunuyor
- [ ] **Rapor** ile HTML rapor açılıyor; açık ve koyu temada okunaklı
- [ ] **Testi tamamla** → önizleme doğru → onay → Jira'da rapor eki, özet yorum, Test Assignee, StoryPointTest ve statü güncellendi

### 4. Release'ler
- [ ] Release kartları, tarih rozetleri (gecikmiş / yaklaşıyor) ve "testte bekleyen" tablosu doğru
- [ ] Release detayında maddeler "hazır değil / To be Deployed / Completed" olarak gruplanıyor

### 5. Release kapatma (test release'i ile)
- [ ] Farklı statüde madde olan release: önizleme açılıyor, **Release'i kapat** pasif
- [ ] Uygun release: önizleme → onay → maddeler Completed, her birine yorum, release *released*, Teams kartı geldi
- [ ] Önizleme açıkken Jira'da bir maddenin statüsü değiştirilince onay reddediliyor ("önizlemeyi yenileyin")

### Açık işler
- [ ] Claude Code proje izin kuralları (`.claude/settings.json`: `.env*` okuma ve ağ komutlarını yasaklama) — karar bekliyor
- [ ] Gerçek Jira ile deneme sonrası çıkan hataların düzeltilmesi ve tasarım geri bildirimleri
- [ ] (Opsiyonel) Microsoft Graph ile sohbetleri/kişileri Teams'ten listeleme ve kendi adınıza gönderme — IT'nin Azure uygulama onayı gerekir

## Güvenlik

- Sunucu yalnızca `127.0.0.1`'e bağlanır. Başka sitelerden gelen istekler reddedilir: yabancı Host, yabancı Origin, CSRF token'sız yazma ve iframe içine gömme.
- Jira token'ı ve Teams webhook adresleri yalnızca sunucu tarafında kullanılır; tarayıcıya, loglara ve hata mesajlarına girmez.
- Jira'ya yazan her işlem önce önizlenir ve onayınızla çalışır.
- Jira madde içeriği Claude'a "veri" olarak verilir. Veri bloğu her çalıştırmada rastgele bir kimlikle işaretlenir; içerikteki talimatlar uygulanmaz.
