# KAI Web App — Kurulum Rehberi

Bu klasör, Cowork içindeki "KAI — Finans Merkezi" ve "KAI — Günlük Merkezi" panellerinin
telefondan erişilebilen, canlı veri okuyan bir versiyonudur. Cowork'teki artifact'ler statik
anlık görüntüydü (sadece "güncelle" dediğinde yenileniyordu); bu uygulama her açıldığında
`Alanlar/Finans.md` ve `Alanlar/Görevler.md` dosyalarının GitHub'daki son halini okur ve
sayıları yeniden hesaplar.

Kod tamamen hazır. Aşağıdaki adımlar yalnızca **hesap/hosting kurulumu** — bunlar senin
yapman gereken tek seferlik işler (ben senin adına hesap oluşturamam veya şifre giremem).

---

## Mimari (özet)

```
Obsidian Vault (Mac'in)  --[Obsidian Git eklentisi, otomatik push]-->  Özel GitHub deposu
                                                                              |
                                                                    [GitHub API, token ile]
                                                                              v
                                                          Vercel serverless fonksiyonlar (bu klasördeki api/)
                                                                              |
                                                                    [JSON, canlı hesaplanmış]
                                                                              v
                                                       Telefonundaki PWA (public/ klasörü, ana ekrana eklenebilir)
```

Sen Görevler.md/Finans.md'ye normal şekilde (KAI ile sohbet ederek) yazmaya devam ediyorsun.
Obsidian Git değişiklikleri otomatik GitHub'a gönderiyor. Uygulama her açıldığında en son
veriyi GitHub'dan çekip yeniden hesaplıyor — statik değil, gerçekten canlı.

---

## A) Veri deposu: özel bir GitHub reposu oluştur

1. github.com → sağ üstten **New repository**.
2. İsim: `kai-vault-data` (istediğin ismi verebilirsin).
3. **Private** seç. Public YAPMA — Finans.md gerçek bakiye/borç bilgisi içeriyor.
4. "Create repository" — boş repo yeterli, README eklemene gerek yok.

## B) Obsidian Git eklentisini kur ve bu repoya bağla

1. Obsidian → Settings → Community plugins → Browse → **"Obsidian Git"** ara, kur, etkinleştir.
2. Vault'unun olduğu klasörde bir git reposu başlat (eklenti bunu ilk çalıştırmada senden ister)
   ve remote olarak yukarıda oluşturduğun `kai-vault-data` reposunu ekle.
3. Obsidian Git ayarlarında **"Auto backup interval"** değerini örn. `10` dakika yap
   (veya "Commit and push on file save" gibi bir seçenek varsa onu aç — daha az gecikme).
4. Command Palette (Cmd+P) → **"Obsidian Git: Commit and push"** çalıştırarak ilk senkronu elle tetikle.

Not: Vault'un tamamını senkronlamak istemiyorsan, Obsidian Git'in "Files to sync" / include-path
ayarından yalnızca `Alanlar/Finans.md` ve `Alanlar/Görevler.md` dosyalarını (veya `Alanlar/`
klasörünü) senkrona dahil edebilirsin.

## C) Salt-okunur bir GitHub erişim anahtarı (token) oluştur

1. github.com → sağ üstten profil resmi → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Repository access:** "Only select repositories" → `kai-vault-data` seç.
3. **Permissions** → **Repository permissions** → **Contents** → **Read-only** yap. Başka
   hiçbir izin verme.
4. Generate → token'ı kopyala (`github_pat_...` ile başlar). Bu token'ı bir daha
   göremeyeceksin, güvenli bir yere not al (örn. şifre yöneticine).

## D) Uygulamayı Vercel'e deploy et

1. Terminalde bu klasöre gir: `cd kai-web-app`
2. Vercel CLI ile deploy et (hesabın yoksa `vercel` seni tarayıcıdan ücretsiz kayıt/login
   akışına yönlendirir):
   ```
   npx vercel
   ```
   Sorulara varsayılan cevaplarla geçebilirsin ("Set up and deploy?" → yes, proje adı
   önerileni kabul et, framework "Other" / "No framework" seç).
3. İlk deploy bittiğinde bir URL verecek (örn. `https://kai-web-app-xxxx.vercel.app`) — ama
   henüz env değişkenleri eksik olduğu için API hata verecek, normal.
4. vercel.com → projen → **Settings** → **Environment Variables** → şunları ekle:

   | Key | Value |
   |---|---|
   | `GITHUB_TOKEN` | (C adımındaki token) |
   | `GITHUB_OWNER` | GitHub kullanıcı adın |
   | `GITHUB_REPO` | `kai-vault-data` |
   | `GITHUB_BRANCH` | `main` (reponun varsayılan dalı farklıysa onu yaz) |
   | `FINANS_PATH` | `Alanlar/Finans.md` (opsiyonel, varsayılan zaten bu) |
   | `GOREVLER_PATH` | `Alanlar/Görevler.md` (opsiyonel, varsayılan zaten bu) |
   | `APP_KEY` | kendi seçtiğin bir parola (örn. rastgele 20 karakter) |

5. Env değişkenlerini ekledikten sonra yeniden deploy et: `npx vercel --prod`

### KAI sekmesi için ek env değişkenleri

Bunlar yalnızca yeni "KAI" sohbet sekmesi için gerekli — Finans/Günlük bu değişkenler
olmadan da eskisi gibi çalışmaya devam eder.

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | aistudio.google.com'dan alınan Gemini API anahtarın (Personal v1'in aktif sağlayıcısı — ücretsiz katman, bkz. aşağıdaki not) |
| `GITHUB_WRITE_TOKEN` | Aşağıdaki adımla oluşturulan, yalnızca `kai-vault-data`'ya **Contents: Read and write** izniyle scoped ayrı bir fine-grained token — C adımındaki salt-okunur token'la **karıştırma**, o token'ın izni değiştirilmez |
| `BILGI_PATH` | `Alanlar/Bilgi.md` (opsiyonel, varsayılan zaten bu) |
| `GEMINI_MODEL` | opsiyonel, varsayılan `gemini-2.5-flash` |

**Gemini ücretsiz katman notu:** Ücretsiz katmanda gönderilen mesajlar Google tarafından
ürün geliştirme/insan incelemesi için kullanılabilir (ücretli katmanda kullanılmaz). Sıfır
maliyet karşılığında bilinçli kabul edilen bir ödünleşim — Kayıt Karar Politikası analizinde
detaylandırıldı. Anthropic/Claude'a geri dönmek istersen `lib/kaiActions.js`'teki tek
`require("./geminiClient")` satırını `require("./claudeClient")` ile değiştirip
`ANTHROPIC_API_KEY` env değişkenini eklemen yeterli — `lib/claudeClient.js` hâlâ projede,
aynı sözleşmeyle duruyor.

`GITHUB_WRITE_TOKEN` oluşturmak için C adımındakiyle aynı yolu izle, tek fark: adım 3'te
**Contents** iznini **Read-only** yerine **Read and write** seç. Bu token'ı yalnızca Vercel
environment variable olarak gir — tarayıcıya hiçbir zaman gönderilmez, sohbette de
paylaşman istenmez.

## E) Telefona kur

1. Vercel URL'sini telefonunda taraycıda aç (iPhone: Safari, Android: Chrome — **başka
   tarayıcı kullanma**, "ana ekrana ekle" özelliği en iyi bu ikisinde çalışır).
2. Karşına çıkan ekrana **D adımında belirlediğin `APP_KEY`'i** gir.
3. iPhone: Paylaş düğmesi → **"Ana Ekrana Ekle"**. Android: sağ üst menü → **"Uygulamayı
   yükle"** / **"Ana ekrana ekle"**.
4. Artık ana ekranında gerçek bir uygulama gibi ikon var — açtığında tarayıcı çubuğu olmadan,
   tam ekran açılıyor.

---

## Günlük kullanım

- Finans/Görevler ile ilgili her şeyi KAI ile sohbet ederek bildirmeye devam et — hiçbir
  şey değişmedi.
- Obsidian Git birkaç dakikada bir (veya elle "Commit and push" ile) GitHub'a gönderiyor.
- Telefondaki uygulamayı her açtığında / yenilediğinde en güncel veriyi görürsün — Cowork'te
  "güncelle" demene gerek yok, bu app tamamen ayrı ve otomatik.
- Cowork'teki iki panel (`kai-finans-merkezi`, `kai-gunluk-merkezi`) hâlâ duruyor ve eskisi
  gibi çalışıyor — bu web app onların yerine geçmiyor, ek bir erişim yolu.

## Güvenlik notu

`APP_KEY` basit bir korumadır — kurumsal seviye güvenlik değildir. Linki kimseyle paylaşma.
Daha güçlü koruma istersen: Vercel'in kendi "Password Protection" özelliği (ücretli plan) ya
da tüm siteyi Cloudflare Access arkasına almak gibi seçenekler var; istersen bunu da
kurabiliriz.

## Testler

Harici bağımlılık yok — hepsi Node'un kendi `assert` (ve `test-frontend.js` için `vm`)
modülünü kullanır. Üç test dosyası var:

```
node test-gunluk.js      # lib/gunlukEngine.js — 10 senaryo (Bugün/Yaklaşanlar/Ertelenenler/
                          # Sonuç Bekleyenler/Rutinler/İstanbul gün sınırı)
node test-finans.js      # lib/finansEngine.js — Son İşlemler sınırı, Finansal Hedefler
                          # ayrımı, Veri Uyarıları, gömülü-tarih regresyonu
node test-frontend.js    # public/app.js + public/finans.js — HTML escaping (XSS), ortak
                          # nav()/renderError(), veri tazeliği sınıflandırması, login ekranı
                          # DOM regresyonu, sonIslemTarihi tip güvenliği (JSON round-trip)
node test-sw.js           # public/sw.js — network-first + cache fallback stratejisi,
                          # /api/* için cache'e hiç girmeme
node test-kai.js          # api/kai.js + lib/kaiActions.js + lib/kaiSchema.js + lib/githubWrite.js
                          # + lib/geminiClient.js — structured output doğrulama, Kayıt Karar
                          # Politikası tek-kaynak okuma, güvenli tablo ekleme/güncelleme,
                          # duplicate tespiti, GitHub sha conflict/retry, Gemini istek/yanıt şekli
```

## Bir şey bozulursa / format değişirse

`lib/finansEngine.js` ve `lib/gunlukEngine.js`, Finans.md ve Görevler.md'nin **şu anki**
başlık/alan isimlerine göre yazıldı (örn. "Açılış bakiyesi", "Bağlı hesap" gibi Türkçe
etiketler). İleride bu dosyaların yapısını (bölüm başlıkları, alan adları) değiştirirsen,
bu iki parser dosyasının da güncellenmesi gerekir — bunu gelecekteki bir KAI sohbetinde
benden isteyebilirsin, kod küçük ve okunur tutuldu.
