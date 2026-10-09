# Jira QA Asistanı — Proje Planı

## Context
Jira'daki test/QA süreçleri bugün elle yürüyor: yeni gelen maddeleri okumak, developer'dan bilgi istemek, test case yazıp takip etmek, sonuç raporlamak, maddeyi kapatmak ve canlı çıkış sonrası release'i kapatmak (her maddeyi tek tek statü değiştirme + yorum + release kapatma + ekibe haber). Bu iş yavaş, hataya açık ve unutulabiliyor.

Hedef: **localhost'ta çalışan, tek kullanıcılı, estetik bir web uygulaması**. Jira Cloud ile REST API üzerinden konuşur, Teams'e bildirim gönderir. **Uygulama hiçbir AI servisine bağlanmaz**: madde analizi ve test case üretimi Claude Code sohbetinde yapılır, sonuç sürümlü bir JSON sözleşmesiyle uygulamaya aktarılır. **Jira'ya yazan her işlem kullanıcı onayından geçer.** Veritabanı yok; veri proje içindeki `data/` klasöründe JSON dosyalarında tutulur (repository arayüzü arkasında, ileride değiştirilebilir). Başka biri repo'yu alıp `.env` doldurup `npm install && npm run dev` ile kendi PC'sinde kullanabilir.

Klasör şu an boş — sıfırdan kurulum.

## Netleşen kararlar
| Konu | Karar |
|---|---|
| Jira | Jira Cloud, REST v3, e-posta + API token (Basic auth). MCP yalnızca geliştirme sırasında bilgi keşfi için; uygulama MCP kullanmaz. |
| Teams | Kademeli: Faz 1 Workflows (Power Automate) webhook → kanal; Faz 2 (opsiyonel) Microsoft Graph → kişi/sohbet/kanal. `Notifier` arayüzü arkasında. |
| AI | **API anahtarı yok** (şirket politikası). Analiz Claude Code sohbetinde `/jira-analiz KEY` ile yapılır → `data/analyses/KEY.json` (şema: `src/domain/analysis/schema.ts`, JSON Schema: `docs/schemas/issue-analysis.schema.json`) → arayüz doğrulayıp gösterir. Başka yerde üretilen JSON arayüze yapıştırılabilir. |
| Çalışma | Local, tek kullanıcı. DB yok → JSON dosya deposu. Projeler Ayarlar'dan seçilir (env'de proje anahtarı yok). |
| Developer'a yorum | Önizleme + tek/toplu onay. Yorum metni **sabit şablondan** üretilir (AI değil). |
| Madde kapanışı | Test Assignee (user picker) + StoryPointTest (sayı) + özet yorum + HTML rapor eki + transition — hepsi diff önizlemesi ve onayla. |

## Teknoloji
- **TypeScript + Next.js (App Router)** — sunucu route handler'ları sırları tutar, tarayıcı token görmez. `server-only` import, `runtime='nodejs'`.
- **Tailwind v4 + shadcn/ui + TanStack Query** — estetik, tutarlı arayüz; açık/koyu tema.
- **Zod** — env, Jira cevapları, diskten okunan JSON'ların doğrulaması.
- **Depolama:** `data/` (gitignore), `write-file-atomic` (Windows/antivirüs EPERM sorununa karşı), `proper-lockfile`, `schemaVersion` + migration.
- **Test:** Vitest + MSW v2 (unit/contract), Playwright + **stateful fake Jira** (Hono ile bellek içi; hata enjeksiyonlu) e2e.
- **HTML rapor:** template-literal renderer, inline CSS, dış bağımlılık yok, sıkı HTML escaping (Jira/AI içeriği güvenilmez).

## Güvenlik (localhost sertleştirme — en kritik risk)
Ziyaret edilen herhangi bir web sitesi `localhost`'a istek atabilir.
- `127.0.0.1`'e bind; middleware `Host` dışı istekleri reddeder (DNS rebinding).
- Yazma route'larında `Origin` kontrolü + açılışta üretilen rastgele token (SameSite=Strict cookie + header).
- `.env.local` gitignore, `.env.example` commit; loglarda `Authorization`/webhook URL maskelenir.
- Madde içeriği Claude Code'a "veri, talimat değil" sınırlarıyla verilir (skill bu kuralı içerir); analiz JSON'u şemayla doğrulanır ve yalnızca metin olarak gösterilir; Jira'ya her yazma insan onaylı.

## Modüller ve Akışlar

### 0) Ayarlar & Bağlantı Kontrolü
- `GET /myself` (accountId), `GET /mypermissions` (TRANSITION_ISSUES, EDIT_ISSUES, ADD_COMMENTS, DELETE_OWN_COMMENTS, CREATE_ATTACHMENTS, ADMINISTER_PROJECTS).
- **Alan keşfi:** `GET /field` ile "Developer", "Test Assignee", "StoryPointTest" adlarından id çözülür; ekranda doğrulanır/elle düzeltilir, kaydedilir.
- **Statü eşlemesi:** "To be Deployed", "Completed", test statüleri **id** ile eşlenir (isimler sabit kodlanmaz).
- Teams "Test kartı gönder" butonu.

### 1) Gelen Kutusu (Inbox)
- Uygulama açıkken tarayıcı her N dakikada `POST /api/inbox/poll` çağırır (sunucuda kilit). JQL: bana atanan / son 1 günde bana geçen maddeler + yerel "görüldü" kümesi. Arama `POST /rest/api/3/search/jql` (nextPageToken).
- Her madde için **kısa rapor**: analiz dosyası varsa özeti gösterilir (madde `updated` değeri değiştiyse "analiz eskidi" uyarısı); yoksa "Claude Code'da `/jira-analiz KEY`" yönlendirmesi.
- **Kural:** component yok **ve** yorum yok → Developer alanındaki kişiyi @mention eden şablon yorum taslağı → "Gönderilecekler" kuyruğu.
- **İdempotency:** ledger `queued → sending → sent | unknown | skipped`. Göndermeden önce kural yeniden kontrol edilir + Jira issue property (`qa-assistant.devRequest`) kontrolü; yorum `properties` ile işaretlenir. Aynı maddeye asla iki kez yazılmaz.

### 2) Test Case & Takip Ekranı
- Test case'ler Claude Code'da üretilen analiz JSON'undan gelir (✅ M0'da görüntüleme hazır). Her case'de `sourceRefs` (kabul kriteri/alan alıntısı); kaynaksız olanlar `assumption: true` ve arayüzde "Varsayım" etiketli.
- Kullanıcı düzenler, ekler, siler; ön koşul/adımlar/beklenen sonuç/test verisi alanları.
- Çalıştırma: her case **Başarılı / Başarısız / Bloke / Atlandı** + not; ilerleme çubuğu.
- Bitince **estetik standalone .html sonuç raporu** (özet kartları, case tablosu, notlar, ortam bilgisi).
- **Kapanış sihirbazı (diff önizlemeli, onaylı):** HTML'i ek olarak yükle → özet yorum → Test Assignee + StoryPointTest doldur → transition. Alan transition ekranındaysa transition ile, değilse önce `PUT /issue` (editmeta kontrolü); ikisinde de yoksa işlem bloke ve nedeni gösterilir.

### 3) Release Panosu
- Versiyon listesi (`GET /project/{key}/version`, sayfalı): canlıya çıkmamış, tarihi yaklaşan, gecikmiş.
- Uyarılar: **uzun süredir testte bekleyen** (changelog bulkfetch ile statüye son giriş zamanı), **testçi üzerinde bekleyen**, açık maddeler.
- Release içerik özeti; madde bazında drill-down (analizi olan maddelerin özeti gösterilir).

### 4) Release Kapatma Sihirbazı (ya hepsi ya hiçbiri)
**Akış:** Release seç → Önizleme (ne yapılacak) → Onay → Çalıştır → Sonuç + Teams bildirimi.

**Kurallar:**
| Durum | Sonuç |
|---|---|
| To be Deployed + Completed karışık | ✔ To be Deployed → Completed, yorum, release kapat, Teams |
| Hepsi To be Deployed | ✔ Aynı işlem |
| Hepsi Completed | ✔ Maddelere dokunulmaz; release kapat, Teams |
| 1 madde bile farklı statüde | ✖ Önizleme görülür, işlem başlatılamaz |
| Pakette hiç madde yok | ✖ Başlatılamaz |
| To be Deployed maddede Completed'a geçiş yok / zorunlu alan karşılanamıyor | ✖ Başlatılamaz |
| Önizleme ile onay arasında statü değişti / madde eklendi-çıkarıldı | ✖ Başlatılamaz |
| Yetki eksik (versiyon yönetimi vb.) | ✖ Başlatılamaz |

**"Ya hepsi ya hiçbiri" nasıl sağlanır** (Jira'da transaction yok):
1. **Preflight:** yukarıdaki tüm kurallar + yetkiler + geri dönüş (Completed → To be Deployed) geçişinin varlığı (workflow okunabiliyorsa doğrulanır, okunamıyorsa "geri alma garanti değil" uyarısı ve açık onay kutusu).
2. **Parmak izi:** `sha256(version{released,releaseDate} + sıralı [issueId,statusId])`. Onay anında taze veriyle (`reconcileIssues` + `relatedIssueCounts`) yeniden hesaplanır; fark varsa bloke.
3. **Journal:** `data/journal/{runId}.json` — her adımdan önce `pending`, sonra `done` + dönen id'ler.
4. **Sıra:** her madde için (sırayla) son anda statüyü yeniden oku → transition → yorum. Hepsi başarılıysa → versiyonu released yap → journal `committed`.
5. **Hata olursa telafi (rollback), ters sırayla:** unrelease → yorumları sil → ters transition. Geri alınamayan adım varsa linkli "manuel müdahale" listesi.
6. **Çökme kurtarma:** açılışta `running` journal varsa engelleyici banner; Jira'nın gerçek durumu kontrol edilir, kullanıcı **Devam et** veya **Geri al** seçer (otomatik yapılmaz).
7. **Teams** yalnızca başarıdan sonra, ayrı ve yeniden denenebilir outbox ile; Teams hatası Jira'yı geri almaz.

**Retry politikası:** okumalarda 429/5xx → `Retry-After` / exponential backoff. Yazmalarda yalnızca 429 tekrar denenir; timeout/5xx'te adım `unknown` işaretlenip Jira'nın gerçek durumu okunur — körlemesine tekrar gönderilmez.

### 5) Teams Bildirimleri
- Faz 1: Workflows webhook'a Adaptive Card (release adı, kapatılan madde listesi, linkler, sonuç). Webhook URL'i sır olarak tutulur; kayıtlı hedefler (kanal adı → URL) Ayarlar'da.
- Faz 2 (opsiyonel): Graph, `@azure/msal-node` (auth code + PKCE, delegated `ChannelMessage.Send`, `Chat.ReadWrite`) → kişi/sohbet/kanal seçimi. IT/admin onayı gerekebilir.

## Klasör Yapısı (`src/`)
```
app/            (pages)/inbox, issues/[key]/tests, releases, releases/[id]/close, settings
                api/**  (ince route handler'lar)   middleware.ts (localhost guard)
lib/config      Zod ile doğrulanan env
lib/http        fetch + retry + eşzamanlılık limiti + log maskeleme
lib/jira        client, search, fields, comments, transitions, attachments, versions, changelog, adf/{build,toText}, schemas
lib/teams       notifier, webhook, graph, cards
lib/store       repository arayüzleri, json-repository (atomic write, lock, migration)
domain/         analysis (schema, store) · inbox (rules, ledger) · testrun · report (HTML) · release-dashboard · release-close (preflight, fingerprint, plan, executor, journal, rollback, recovery)
test/           fake-jira/, fixtures/, e2e/
scripts/        jira-issue.ts (maddeyi Markdown olarak yazdırır) · analysis.ts (path / validate / schema)
.claude/skills/ jira-analiz (Claude Code komutu)
```
Domain katmanı Jira'ya yalnızca arayüz üzerinden erişir → saf, test edilebilir.

## Durum (2026-10-07)
- **Tüm aşamalar (M0–M7) uygulandı.** M8 (Microsoft Graph ile kişiye/sohbete mesaj) opsiyonel olarak bekliyor; şu an Teams bildirimleri Workflows webhook ile kanala gidiyor.
- **Tasarım değişiklikleri:**
  - API anahtarı yok: analizler Claude Code'da `/jira-analiz` ile üretiliyor.
  - `JIRA_PROJECT_KEYS` kaldırıldı: projeler Ayarlar'da Jira'dan seçiliyor ve statü eşlemesi proje bazında tutuluyor.
- **Arayüz baştan tasarlandı:**
  - Koyu kenar çubuğu, açık/koyu tema, istatistik kartları, adım göstergeli sihirbazlar, bildirimler.
  - Sayfalar: Genel Bakış, Gelen Kutusu, Test Takibi, Haftalık Rapor, Release'ler, Release Kapat, Ayarlar.
- **Ağ:** şirket ağı TLS denetimi yapıyorsa Windows sertifika deposu otomatik kullanılıyor (`src/lib/server/system-ca.ts`).
- **Güvenlik:** Jira geçersiz kimlikle bazı uçlarda anonim cevap verdiği için, Jira'dan okuyan her akış önce `/myself` ile oturumu doğruluyor.
- **Testler:** 143 test. Sahte Jira ile release kapatmanın tüm kuralları, geri alma ve çökme kurtarma; bilgi talebinin idempotency'si; rapor XSS kontrolü; Teams adres doğrulaması.
- **İkinci inceleme turu (2026-10-08):** Code Reviewer ve Security Reviewer'ın bulgularının tamamı uygulandı:
  - Release kapatma: eşzamanlılık kilidi; çalışan kapatmanın altından geri alma engellendi; geri almada planlanan tarih geri yükleniyor; bildirim hatası tamamlanmış kapatmayı bozmuyor; geri alması eksik kalan kayıt yeni kapatmayı engelliyor ("Tekrar geri al" / "Elle düzelttim").
  - Bilgi talebi: atomik gönderim hakkı (mükerrer yorum yok); yalnızca bana atanmış açık maddeler; önizlenen developer değiştiyse gönderilmiyor; 50'lik parçalar.
  - Madde kapatma: tekrar denemede rapor/yorum ikinci kez gitmiyor; yeniden kapatma açık onay istiyor; test ekranındaki son değişiklik sayfadan ayrılırken kaybolmuyor.
  - Teams kartlarında ham linkler tıklanamaz; görseller yalnızca Atlassian sunucularından (CSP).
  - Testler: 160.
- **2026-10-09:** Gerçek Jira bağlantısı çalışıyor (401 çözüldü). Teams hedeflerine tür eklendi: **Kanal** ya da **Sohbet** (Workflows "Send webhook alerts to a channel / chat" şablonları). Gönderirken listeden seçiliyor; eski kayıtlar kanal sayılıyor. Ayrıca **Kişiler** türü: tek bir genel Power Automate akışı, uygulama `recipients` e-posta listesini gönderir, akış her kişiye Flow bot ile iletir; kişiler Ayarlar'daki kişi listesinden seçilir (en fazla 50, deneme kartı 3) ve seçim Jira'ya dokunmadan önce doğrulanır; akış `x-qa-key` anahtarını, alıcı sayısını ve alan adını doğrular. Graph (M8) yalnızca Teams'ten listeleme/kendi adına gönderme için gerekirse. Testler: 174. Code + Security Reviewer bulguları uygulandı.
- **Genel Bakış panosu, ilk sürüm (2026-10-09):** son 24 saat sayıları, 14 günlük proje trendi, dağılımlar. Aynı gün kaldırıldı (aşağıya bakın).
- **Pano yeniden tasarımı + Haftalık Rapor (2026-10-09):** Gerçek Jira (OZE) incelendi: worklog hiç kullanılmıyor, efor = StoryPointTest; akış Coding → Test → (Completed | To be Deployed | Paused); test sırasında assignee testçiye geçiyor; "Paused" yoğun kullanılıyor (QA'ya atanmış 44 madde). Buna göre:
  - Pano QA'nın günlük sorularına göre: Testte bekleyen (gecikenler), Sırada, Beklemede, Bu hafta kapattığım (SP ile). Altında aşama sekmeli **iş kuyruğu** (statüde kaç gün, en uzun bekleyen üstte), sade "Dikkat gerekenler" listesi, son 8 haftanın verimi, release'ler. Proje geneli 24 saat/14 gün sayıları, öncelik ve durum dağılımları kaldırıldı (kişisel takip için gürültüydü; öncelik %89 Medium).
  - Bekleme süresi changelog'dan (`lastStatusChange`) hesaplanıyor; `statuscategorychangedate` Coding → Test gibi aynı kategorideki geçişlerde değişmediği için yanlış sonuç veriyordu.
  - **Haftalık Rapor** (`/reports`, `src/domain/weekly/`): ISO hafta seçimi; kullanıcının kendi statü geçişlerinden kapattıklarım (done kategorisine geçiş; done → done ve iptal sayılmaz), geri gönderdiklerim, beklemeye aldıklarım, başladıklarım; açtığım Bug'lar; bana atananlar; efor toplamı ve efor eksik maddeler; günlük hareket; önceki haftaya göre değişim. Not alanı, kaydetme (`data/weekly-reports.json`), Markdown kopyalama, Teams'e gönderme (onaylı). Rapor geçmişi tablosu son 12 hafta. Jira'ya yazmaz.
  - Testler: 207. Code + Security Reviewer bulguları uygulandı.
- **Açık karar:** Claude Code için proje izin kuralları (`.claude/settings.json`: `.env*` okuma ve ağ komutlarını yasaklama) kullanıcı onayı bekliyor.

## Teslim Aşamaları ve OMC Rol Dağılımı
Her aşama: **Architect** (tasarım/arayüz) → **Executor** (kod) → **Test Engineer** (test yazar/çalıştırır) → **Code Reviewer** → **Security Reviewer** (Jira'ya yazan ve sır taşıyan aşamalarda zorunlu) → **Verifier** (kabul kriterleri).

| Aşama | Kapsam | Doğrulama |
|---|---|---|
| M0 | Proje iskeleti, env, Jira client, localhost guard, Ayarlar + bağlantı/yetki/alan/statü keşfi | retry/pagination/429 (MSW); Host/Origin reddi |
| M1 | Inbox (salt okuma) + analiz özeti ve "analiz eskidi" uyarısı | JQL, şema, eskime kontrolü |
| M2 | Developer yorum kuyruğu + idempotency | çift onay, POST sonrası çökme, mevcut işaret, gönderimde kural tekrar kontrolü |
| M3 | Test case düzenleme/çalıştırma (Başarılı/Başarısız/Bloke/Atlandı) + HTML rapor | rapor snapshot, XSS fixture'ları |
| M4 | Kapanış sihirbazı (ek, yorum, alanlar, transition) | fake-Jira e2e: alan transition ekranında / edit ekranında / hiçbirinde |
| M5 | Release panosu | sabit saatle uyarı hesapları |
| M6 | Teams webhook | kart JSON snapshot, outbox retry |
| M7a | Release kapatma — **yalnızca önizleme (dry-run)** | tüm bloke kuralları, parmak izi kayması |
| M7b | Çalıştırma + journal + rollback + kurtarma | her k. adımda hata enjeksiyonu ve process kill → tamamen geri alınmış ya da devam ettirilebilir |
| M8 | Graph (opsiyonel) | — |

Önerilen sıra: M0 → M1 → M7a → M7b → M6 → M2 → M3 → M4 → M5 (release kapatma en çok zaman kazandıran ve en riskli iş; erken ve güvenli şekilde ele alınır). Gerçek projeye dokunmadan önce, mümkünse ücretsiz bir Jira Cloud sandbox'ında aynı workflow ile denenir.

## Başlamadan önce kullanıcıdan gerekenler
- Jira site adresi (`xxx.atlassian.net`), e-posta, API token (id.atlassian.com → Security → API tokens), proje anahtar(lar)ı.
- Teams'te bildirim gidecek kanal(lar) için Workflows webhook URL'i ("Post to a channel when a webhook request is received" şablonu).
- (Not: claude.ai Atlassian Rovo bağlayıcısı bu oturumda yetkilendirilmemiş; geliştirme sırasında alan/statü keşfi için yetkilendirilirse faydalı, ama M0'daki keşif ekranı bunu zaten uygulama içinden yapar.)

## Doğrulama (uçtan uca)
1. `npm run test` — Vitest unit/contract (MSW ile Jira/Teams sahte cevapları).
2. `npm run test:e2e` — Playwright + fake Jira: inbox → yorum onayı → test çalıştırma → rapor → kapanış; release kapatma için tüm ✔/✖ senaryoları ve her adımda hata enjeksiyonu ile rollback.
3. Gerçek Jira'da manuel smoke: Ayarlar bağlantı kontrolü yeşil; bir test release'i için dry-run önizleme; onaylı çalıştırma; Teams'te kartın geldiğinin görülmesi.
4. Her aşama sonunda OMC `security-reviewer` + `code-reviewer` incelemesi, `verifier` ile kabul kriterleri kontrolü.
