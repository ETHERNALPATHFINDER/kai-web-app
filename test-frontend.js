// Regression tests for the shared frontend layer (public/app.js) and, end-to-end, for
// public/finans.js actually calling those escaping helpers when it renders real markdown
// data. No external test framework or DOM library — only Node's own `assert` and `vm`
// modules (same "zero dependency" approach as test-gunluk.js / test-finans.js).
//
// Two layers of testing here:
//   A) Pure-function checks — require public/app.js directly in this process and call
//      KAI.escapeHtml / KAI.nav / KAI.freshness / KAI.renderErrorHtml. Safe because none
//      of those touch `document`/`localStorage`/`fetch` unless actually invoked.
//   B) End-to-end render check — run public/app.js + public/finans.js inside a small
//      vm sandbox (fake document/localStorage/fetch) with a malicious ViewModel, then
//      inspect the HTML that finans.js actually produced.
//
// Run with: node test-frontend.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const KAI = require("./public/app.js");
const { buildFinansViewModel } = require("./lib/finansEngine");
const { buildGunlukViewModel } = require("./lib/gunlukEngine");

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
// A) Pure-function checks (public/app.js's KAI object)
// ---------------------------------------------------------------------------

// --- escapeHtml: <script> and &<>"' characters ---
{
  const malicious = `<script>alert(1)</script>`;
  const escaped = KAI.escapeHtml(malicious);
  check(
    "escapeHtml <script> etiketini metne çeviriyor, tarayıcıda çalıştırılabilir kalmıyor",
    !escaped.includes("<script>") && escaped.includes("&lt;script&gt;")
  );
}
{
  const escaped = KAI.escapeHtml(`Yemek & <İçecek> "test" 'test'`);
  check(
    "escapeHtml &, <, >, \", ' karakterlerinin tümünü kaçırıyor",
    escaped === `Yemek &amp; &lt;İçecek&gt; &quot;test&quot; &#39;test&#39;`
  );
}

// --- nav(): tek ortak fonksiyon, iki sayfada da doğru sekmeyi işaretliyor ---
{
  const navFinans = KAI.nav("finans");
  const navGunluk = KAI.nav("gunluk");
  check(
    "nav('finans') Finans sekmesini 'active' işaretliyor, Günlük'ü işaretlemiyor",
    /class="active">Finans/.test(navFinans) && !/class="active">Günlük/.test(navFinans)
  );
  check(
    "nav('gunluk') Günlük sekmesini 'active' işaretliyor, Finans'ı işaretlemiyor",
    /class="active">Günlük/.test(navGunluk) && !/class="active">Finans/.test(navGunluk)
  );
  check(
    "Her iki çağrı da aynı topnav/tabs iskeletini üretiyor (tek ortak fonksiyon)",
    navFinans.includes('class="topnav"') && navGunluk.includes('class="topnav"') && navFinans.includes("Yenile") && navGunluk.includes("Yenile")
  );
}

// --- nav("kai"): üçüncü sekme eklendi, mevcut iki sekmenin davranışını bozmuyor ---
{
  const navKai = KAI.nav("kai");
  check(
    "nav('kai') KAI sekmesini 'active' işaretliyor, Finans/Günlük'ü işaretlemiyor",
    /class="active">KAI/.test(navKai) && !/class="active">Finans/.test(navKai) && !/class="active">Günlük/.test(navKai)
  );
  check(
    "nav() her üç çağrıda da KAI, Finans, Günlük linklerinin hepsini içeriyor",
    ["finans", "gunluk", "kai"].every((active) => {
      const html = KAI.nav(active);
      return html.includes(">KAI<") && html.includes(">Finans<") && html.includes(">Günlük<");
    })
  );
  check("pageWrapClass('kai') 'wrap narrow' konteynerini kullanıyor (Günlük ile aynı)", KAI.pageWrapClass("kai") === "wrap narrow");
}

// --- authFetch(url, options): yeni options parametresi mevcut GET çağrılarını bozmuyor ---
{
  const sandbox = {
    localStorage: { getItem: () => "test-key", setItem() {}, removeItem() {} },
    fetch: async (url, opts) => {
      check("authFetch options vermeden çağrıldığında fetch'e yalnızca headers gönderiyor (GET varsayılan)", !opts.method);
      check("authFetch mevcut x-app-key header'ını hâlâ ekliyor", opts.headers["x-app-key"] === "test-key");
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    },
    module: { exports: {} },
    navigator: {},
    window: { addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8"), sandbox, { filename: "app.js" });
  // Fire-and-forget: the assertions above run synchronously inside the injected fetch.
  sandbox.module.exports.authFetch("/api/finans");
}

// --- renderErrorHtml(): her iki ekranda da hata mesajını escape ediyor ---
{
  const malicious = { message: `<img src=x onerror="alert(1)">` };
  const finansHtml = KAI.renderErrorHtml(malicious, "finans");
  const gunlukHtml = KAI.renderErrorHtml(malicious, "gunluk");
  check(
    "renderError (Finans) hata mesajını escape ediyor",
    !finansHtml.includes("<img") && finansHtml.includes("&lt;img")
  );
  check(
    "renderError (Günlük) hata mesajını escape ediyor",
    !gunlukHtml.includes("<img") && gunlukHtml.includes("&lt;img")
  );
  check("renderError (Günlük) doğru 'wrap narrow' konteynerini kullanıyor", gunlukHtml.includes('class="wrap narrow"'));
  check("renderError (Finans) doğru 'wrap' konteynerini kullanıyor", /class="wrap"/.test(finansHtml) && !finansHtml.includes("wrap narrow"));
}

// --- freshness(): 59dk / 60dk / 24 saat sınırları ---
{
  const now = Date.parse("2026-08-10T12:00:00Z");
  const isoMinutesAgo = (min) => new Date(now - min * 60000).toISOString();

  const at59 = KAI.freshness(isoMinutesAgo(59), now);
  check("59 dakika önce -> Güncel (dotClass boş)", at59.statusLabel === "Güncel" && at59.dotClass === "");

  const at60 = KAI.freshness(isoMinutesAgo(60), now);
  check("60 dakika önce -> artık 'bayat' (stale) sınırına giriyor", at60.statusLabel === "Bir süredir yenilenmedi" && at60.dotClass === "stale");

  const at1439 = KAI.freshness(isoMinutesAgo(24 * 60 - 1), now);
  check("23 saat 59 dakika önce -> hâlâ 'bayat' (error değil)", at1439.statusLabel === "Bir süredir yenilenmedi" && at1439.dotClass === "stale");

  const at1440 = KAI.freshness(isoMinutesAgo(24 * 60), now);
  check("Tam 24 saat önce -> 'Eski veri' (error) sınırına giriyor", at1440.statusLabel === "Eski veri" && at1440.dotClass === "error");
}

// ---------------------------------------------------------------------------
// B) End-to-end: public/finans.js gerçekten esc() çağırıyor mu? (vm sandbox)
// ---------------------------------------------------------------------------

function makeSandbox(viewModel) {
  const store = { kai_app_key: "test-key" }; // pre-authed, skip the login screen
  const appEl = { innerHTML: "" };
  const bodyEl = { innerHTML: "" };
  const sandbox = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    navigator: {},
    location: { reload() {} },
    document: {
      body: bodyEl,
      getElementById: (id) => (id === "app" ? appEl : null),
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => viewModel }),
  };
  sandbox.window = sandbox; // "window.addEventListener" (unused here since navigator={} skips it)
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  const appSrc = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
  vm.runInContext(appSrc, sandbox, { filename: "app.js" });
  const finansSrc = fs.readFileSync(path.join(__dirname, "public", "finans.js"), "utf8");
  vm.runInContext(finansSrc, sandbox, { filename: "finans.js" });
  return { sandbox, appEl };
}

async function renderFinansEndToEnd(viewModel) {
  const { appEl } = makeSandbox(viewModel);
  // Flush the ensureLoggedIn -> authFetch -> .then(renderFinans) promise chain.
  await new Promise((r) => setTimeout(r, 20));
  return appEl.innerHTML;
}

(async () => {
  const maliciousVm = {
    generatedAt: new Date().toISOString(),
    kullanilabilirBakiye: 1000,
    totalAssets: { TRY: 1000 },
    monthlyFlow: { gelirTRY: 0, giderTRY: 0, netTRY: 0 },
    accounts: [
      {
        name: `<script>alert('acc')</script>`,
        matchName: `<script>alert('acc')</script>`,
        tur: `Banka & Kart`,
        durum: `Aktif`,
        bakiyeler: { TRY: 100 },
        sonIslemTarihi: null,
      },
    ],
    debts: [
      {
        name: `<img src=x onerror=alert('debt')>`,
        tur: "Kişisel",
        alacakli: `<b>Alacaklı</b>`,
        oncelik: "Yüksek",
        baslangicTutari: 100,
        kalanTutar: 100,
        paraBirimi: "TRY",
        odenenOran: 0,
        planlananAylikOdeme: `<i>Veri eksik</i>`,
      },
    ],
    receivables: [
      { name: `<svg onload=alert('recv')>`, yakinlik: `<u>test</u>`, tutarlar: [{ tutar: 10, paraBirimi: "TRY" }], odemeTarihi: null },
    ],
    goals: [
      {
        name: `<script>alert('goal')</script>`,
        oncelik: "1",
        ilerlemeYuzde: 50,
        mevcutTutar: 50,
        hedefGosterim: 100,
        paraBirimi: "TRY",
        hedefTarih: `<b>2026</b>`,
      },
    ],
    goalsMissingNames: [`<script>alert('missing')</script>`],
    sonIslemler: [
      {
        id: "001",
        tarih: "2026-08-10",
        yon: "Gider",
        tutar: 10,
        paraBirimi: "TRY",
        kategori: `<script>alert('kat')</script>`,
        altKategori: `<script>alert('alt')</script>`,
        hesap: `<script>alert('hesap')</script>`,
        not: `<script>alert('not')</script>`,
      },
    ],
    upcoming: [{ ad: `<script>alert('up')</script>`, tur: "Abonelik", tutar: 5, paraBirimi: "TRY", tarih: "2026-09-01" }],
    warnings: [`<script>alert('warn')</script>`],
  };

  const html = await renderFinansEndToEnd(maliciousVm);

  check(
    "Finans ekranı: render sonrası çıktıda çalıştırılabilir <script> etiketi YOK",
    !html.includes("<script>alert"),
    "html: " + html.slice(0, 200)
  );
  check("Finans ekranı: hesap adı escape edilmiş", html.includes("&lt;script&gt;alert(&#39;acc&#39;)&lt;/script&gt;"));
  check("Finans ekranı: hesap türü içindeki '&' escape edilmiş", html.includes("Banka &amp; Kart"));
  check("Finans ekranı: borç adı (img onerror) escape edilmiş", !html.includes("<img src=x onerror") && html.includes("&lt;img src=x onerror"));
  check("Finans ekranı: alacaklı escape edilmiş", html.includes("&lt;b&gt;Alacaklı&lt;/b&gt;"));
  check("Finans ekranı: hedef adı escape edilmiş", html.includes("&lt;script&gt;alert(&#39;goal&#39;)&lt;/script&gt;"));
  check("Finans ekranı: 'Henüz belirlenmemiş hedefler' listesindeki isim escape edilmiş", html.includes("&lt;script&gt;alert(&#39;missing&#39;)&lt;/script&gt;"));
  check("Finans ekranı: işlem adı/notu/hesabı escape edilmiş", html.includes("&lt;script&gt;alert(&#39;kat&#39;)") && html.includes("&lt;script&gt;alert(&#39;not&#39;)") && html.includes("&lt;script&gt;alert(&#39;hesap&#39;)"));
  check("Finans ekranı: uyarı metni escape edilmiş", html.includes("&lt;script&gt;alert(&#39;warn&#39;)&lt;/script&gt;"));
  check("Finans ekranı: yaklaşan ödeme adı escape edilmiş", html.includes("&lt;script&gt;alert(&#39;up&#39;)&lt;/script&gt;"));

  // -------------------------------------------------------------------------
  // C) Login ekranı regresyonu — renderLoginScreen artık document.body yerine
  //    #app'in içine render ediyor mu, ve gerçek bir buton tıklamasıyla akış
  //    tamamlanabiliyor mu? (Production'da tespit edilen sessiz çökme hatası.)
  //    Bu sandbox, önceki B) testinden farklı olarak localStorage'a önceden
  //    key koymuyor — böylece gerçek login ekranı gerçekten render edilir ve
  //    gerçek bir "tıklama" simüle edilir.
  // -------------------------------------------------------------------------

  function makeLoginSandbox(fetchImpl) {
    const store = {}; // key yok -> login ekranı gerçekten render edilmeli
    const registry = new Map();
    let bodyInnerHTMLSet = false;

    function registerIdsFrom(html) {
      const re = /id="([\w-]+)"/g;
      let m;
      while ((m = re.exec(html))) {
        if (m[1] !== "app") registry.set(m[1], makeFakeElement(m[1]));
      }
    }

    function makeFakeElement(id) {
      const el = { id, value: "", _listeners: {}, addEventListener(type, fn) {
        (this._listeners[type] = this._listeners[type] || []).push(fn);
      }, focus() {} };
      let html = "";
      Object.defineProperty(el, "innerHTML", {
        get() { return html; },
        set(v) { html = v; registerIdsFrom(v); },
      });
      return el;
    }

    const appEl = makeFakeElement("app");
    registry.set("app", appEl);

    const bodyEl = {};
    let bodyHtml = "";
    Object.defineProperty(bodyEl, "innerHTML", {
      get() { return bodyHtml; },
      set(v) { bodyHtml = v; bodyInnerHTMLSet = true; registerIdsFrom(v); },
    });

    const sandbox = {
      console,
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      navigator: {},
      location: { reload() {} },
      document: { body: bodyEl, getElementById: (id) => registry.get(id) || null },
      fetch: fetchImpl,
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8"), sandbox, { filename: "app.js" });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "finans.js"), "utf8"), sandbox, { filename: "finans.js" });

    return {
      appEl,
      registry,
      bodyTouched: () => bodyInnerHTMLSet,
      typeInto(id, value) {
        const el = registry.get(id);
        if (el) el.value = value;
      },
      click(id) {
        const el = registry.get(id);
        const handlers = (el && el._listeners.click) || [];
        handlers.forEach((fn) => fn({}));
      },
    };
  }

  // --- 1) Login ekranı render edildikten sonra #app DOM'da kalıyor mu? ---
  {
    const { appEl, registry, bodyTouched } = makeLoginSandbox(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    check("Login ekranı render edildikten sonra #app DOM'da kalıyor (artık document.body silinmiyor)", registry.get("app") === appEl);
    check("Login formu elemanları (#kai-key-input, #kai-key-submit) oluşturuldu", registry.has("kai-key-input") && registry.has("kai-key-submit"));
    check("renderLoginScreen document.body.innerHTML'i HİÇ kullanmıyor (regresyonun kök nedeni giderildi)", !bodyTouched());
  }

  // --- 2) Doğru APP_KEY: tıklama -> #app üzerinden devam -> authFetch tetiklenir -> Finans render edilir ---
  {
    let fetchCalled = false;
    const financeVm = {
      generatedAt: new Date().toISOString(),
      kullanilabilirBakiye: 0,
      totalAssets: {},
      monthlyFlow: { gelirTRY: 0, giderTRY: 0, netTRY: 0 },
      accounts: [],
      debts: [],
      receivables: [],
      goals: [],
      goalsMissingNames: [],
      sonIslemler: [],
      upcoming: [],
      warnings: [],
    };
    const { appEl, click, typeInto, bodyTouched } = makeLoginSandbox(async (url) => {
      if (String(url).includes("/api/finans")) {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => financeVm };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    typeInto("kai-key-input", "dogru-anahtar");
    click("kai-key-submit");
    await new Promise((r) => setTimeout(r, 20));
    check("Doğru APP_KEY: Giriş Yap tıklanınca callback #app üzerinden hatasız devam ediyor", appEl.innerHTML.length > 0);
    check("Doğru APP_KEY: authFetch(/api/finans) gerçekten tetikleniyor", fetchCalled);
    check("Doğru APP_KEY: Finans ekranı sonunda render ediliyor", appEl.innerHTML.includes("Finans Merkezi"));
    check("Doğru APP_KEY akışında da document.body.innerHTML hiç kullanılmadı", !bodyTouched());
  }

  // --- 3) Yanlış APP_KEY: 401 sonrası çökme yok, kullanıcı tekrar login ekranına yönlendiriliyor ---
  {
    const { appEl, click, typeInto, bodyTouched, registry } = makeLoginSandbox(async (url) => {
      if (String(url).includes("/api/finans")) return { ok: false, status: 401, json: async () => ({ error: "Yetkisiz" }) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    typeInto("kai-key-input", "yanlis-anahtar");
    let threw = null;
    try {
      click("kai-key-submit");
    } catch (e) {
      threw = e;
    }
    await new Promise((r) => setTimeout(r, 20));
    check("Yanlış APP_KEY: tıklama sırasında JS hatası fırlatılmıyor (eski 'hiçbir tepki yok' hatası giderildi)", !threw, threw && threw.message);
    check(
      "Yanlış APP_KEY: kullanıcı görünür şekilde login ekranına geri yönlendiriliyor (bir tepki var)",
      registry.has("kai-key-input") && appEl.innerHTML.includes("kai-key-input")
    );
    check("Yanlış APP_KEY akışında da document.body.innerHTML hiç kullanılmadı", !bodyTouched());
  }
  // Not: mevcut kodda "yanlış anahtar" için ayrı bir metin mesajı (#kai-key-error içi) hiç
  // doldurulmuyor — kullanıcı yalnızca login ekranına geri döner. Bu, bu turun kapsamındaki
  // tek fonksiyon (renderLoginScreen'in hedef DOM'u) dışında, önceden var olan ayrı bir
  // durum; onay kapsamı dışında olduğu için değiştirilmedi.

  // -------------------------------------------------------------------------
  // D) Tarih tipi güvenliği — production hatası: "a.sonIslemTarihi.toISOString
  //    is not a function". Kök neden: finansEngine.js bir Date nesnesini
  //    ViewModel'e koyuyordu; JSON üzerinden gelince bu string'e dönüşüyor,
  //    ama finans.js hâlâ Date bekleyip .toISOString() çağırıyordu. Bu blok
  //    hem düzeltmeyi (frontend artık .toISOString() çağırmıyor, engine artık
  //    Date değil ISO string/null üretiyor) hem de aynı sınıftaki olası tip
  //    hatalarını (null, geçersiz tarih, gerçek JSON round-trip) doğrular.
  // -------------------------------------------------------------------------

  function baseFinansVm(accountOverrides) {
    return {
      generatedAt: new Date().toISOString(),
      kullanilabilirBakiye: 0,
      totalAssets: {},
      monthlyFlow: { gelirTRY: 0, giderTRY: 0, netTRY: 0 },
      accounts: [{ name: "Test Hesap", tur: "Banka", durum: "Aktif", bakiyeler: { TRY: 100 }, ...accountOverrides }],
      debts: [],
      receivables: [],
      goals: [],
      goalsMissingNames: [],
      sonIslemler: [],
      upcoming: [],
      warnings: [],
    };
  }

  // --- 1) sonIslemTarihi bir Date nesnesiyken çöküyor mu? ---
  {
    const html = await renderFinansEndToEnd(baseFinansVm({ sonIslemTarihi: new Date("2026-08-06T00:00:00Z") }));
    check(
      "sonIslemTarihi Date nesnesiyken Finans ekranı çökmüyor (hata banner'ı YOK)",
      !html.includes("Bir hata oluştu"),
      "html: " + html.slice(0, 300)
    );
  }

  // --- 2) sonIslemTarihi ISO string iken doğru formatlanıyor mu? ---
  {
    const html = await renderFinansEndToEnd(baseFinansVm({ sonIslemTarihi: "2026-08-06T00:00:00.000Z" }));
    check(
      "sonIslemTarihi ISO string iken çökmüyor ve doğru tarih (06.08.2026) render ediliyor",
      !html.includes("Bir hata oluştu") && html.includes("06.08.2026")
    );
  }

  // --- 3) sonIslemTarihi null iken "İşlem kaydı yok" gösteriliyor mu? ---
  {
    const html = await renderFinansEndToEnd(baseFinansVm({ sonIslemTarihi: null }));
    check("sonIslemTarihi null iken çökmüyor, 'İşlem kaydı yok' gösteriliyor", !html.includes("Bir hata oluştu") && html.includes("İşlem kaydı yok"));
  }

  // --- 4) sonIslemTarihi geçersiz bir değerken çöküyor mu? ---
  {
    const html = await renderFinansEndToEnd(baseFinansVm({ sonIslemTarihi: "gecersiz-tarih" }));
    check("sonIslemTarihi geçersiz bir string iken çökmüyor (hata banner'ı YOK)", !html.includes("Bir hata oluştu"));
  }

  // --- 5) & 7) Gerçek engine çıktısı, gerçek JSON.stringify/parse round-trip'ten sonra render ediliyor mu? ---
  // (api/finans.js'in res.json(viewModel) ile yaptığı serileştirmeyi birebir simüle eder.)
  {
    const md = `# Finans

## Hesaplar

### Ana Hesap
- Tür: Banka
- Para birimi: TRY
- Açılış bakiyesi: 1.000 TRY
- Açılış tarihi: 2026-01-01
- Durum: Aktif

## İşlem Geçmişi

| İşlem ID | Tarih | Yön | Tutar | Para Birimi | Kategori | Alt Kategori | Hesap | Ödeme Yöntemi | Bağlantı | Not |
|---|---|---|---:|---|---|---|---|---|---|---|
| 001 | 2026-08-06 | Gider | 50 | TRY | Test | Test | Ana Hesap | Kart | — | — |

## Borçlar

## Alacaklar

## Finansal Hedefler

## Abonelikler ve Düzenli Ödemeler

| Ad | Tutar | Para Birimi | Periyot | Sıradaki Ödeme | Hesap | Kategori | Durum |
|---|---:|---|---|---|---|---|---|

## Hesaplama Kuralları
`;
    const realVm = buildFinansViewModel(md, new Date("2026-08-10T10:00:00Z"));
    check(
      "Engine artık sonIslemTarihi'ni Date değil ISO string/null olarak üretiyor",
      realVm.accounts[0].sonIslemTarihi === null || typeof realVm.accounts[0].sonIslemTarihi === "string"
    );
    // JSON.stringify -> JSON.parse: tam olarak /api/finans'ın res.json() ile yaptığı şey.
    const roundTripped = JSON.parse(JSON.stringify(realVm));
    const html = await renderFinansEndToEnd(roundTripped);
    check(
      "Gerçek Finans ViewModel'i JSON round-trip'ten sonra hatasız render ediliyor",
      !html.includes("Bir hata oluştu") && html.includes("06.08.2026"),
      "html: " + html.slice(0, 300)
    );
  }

  // --- 6) Aynı JSON round-trip Günlük ViewModel için de sorunsuz mu? ---
  {
    function makeGunlukSandbox(viewModel) {
      const store = { kai_app_key: "test-key" };
      const appEl = { innerHTML: "" };
      const bodyEl = { innerHTML: "" };
      const sandbox = {
        console,
        localStorage: {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: (k) => { delete store[k]; },
        },
        navigator: {},
        location: { reload() {} },
        document: { body: bodyEl, getElementById: (id) => (id === "app" ? appEl : null) },
        fetch: async () => ({ ok: true, status: 200, json: async () => viewModel }),
      };
      sandbox.window = sandbox;
      sandbox.window.addEventListener = () => {};
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8"), sandbox, { filename: "app.js" });
      vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "gunluk.js"), "utf8"), sandbox, { filename: "gunluk.js" });
      return appEl;
    }

    const gunlukMd = `# Görevler

## Görevler

| ID | Başlık | Alan | Öncelik | Durum | Planlanan Tarih | Planlanan Saat | Erteleme Sayısı | Tamamlanma Tarihi | Not |
|---|---|---|---|---|---|---|---|---|---|
| 001 | Test Görevi | Otel | Orta | Bekliyor | 2026-08-10 | — | 0 | — | — |

## Sonuç Bekleyenler

## Rutinler

## Günlük Tamamlanma

| Tarih | Planlanan | Tamamlanan | Oran |
|---|---:|---:|---:|
`;
    const realGunlukVm = buildGunlukViewModel(gunlukMd, new Date("2026-08-10T10:00:00Z"));
    const roundTrippedGunluk = JSON.parse(JSON.stringify(realGunlukVm));
    const gunlukAppEl = makeGunlukSandbox(roundTrippedGunluk);
    await new Promise((r) => setTimeout(r, 20));
    check(
      "Gerçek Günlük ViewModel'i JSON round-trip'ten sonra hatasız render ediliyor (aynı sınıf hata yok)",
      !gunlukAppEl.innerHTML.includes("Bir hata oluştu") && gunlukAppEl.innerHTML.includes("Test Görevi"),
      "html: " + gunlukAppEl.innerHTML.slice(0, 300)
    );
  }

  // -------------------------------------------------------------------------
  // E) Service worker migration — public/app.js'in kayıt akışı: register()
  //    sonrası registration.update() (24 saatlik otomatik kontrol throttle'ını
  //    aşmak için) ve controllerchange sonrası TEK SEFERLİK reload (sonsuz
  //    döngü koruması ile).
  // -------------------------------------------------------------------------

  function loadAppForSWTest({ supportsSW = true, registerImpl } = {}) {
    const windowListeners = {};
    const controllerChangeListeners = [];
    let reloadCount = 0;
    const navigatorObj = supportsSW
      ? {
          serviceWorker: {
            register: registerImpl,
            addEventListener: (type, fn) => {
              if (type === "controllerchange") controllerChangeListeners.push(fn);
            },
          },
        }
      : {};
    const sandbox = {
      console,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      navigator: navigatorObj,
      location: { reload: () => { reloadCount++; } },
      document: { body: {}, getElementById: () => null },
      // Top-level `const KAI = ...` in app.js isn't exposed as a property on the vm
      // context global (that's normal let/const scoping, not a bug) — but app.js's own
      // `module.exports = KAI` line at the bottom is, as long as a CommonJS-shaped
      // `module` object is present, exactly like it would be under real Node `require()`.
      module: { exports: {} },
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = (type, fn) => {
      windowListeners[type] = fn;
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8"), sandbox, { filename: "app.js" });
    return { windowListeners, controllerChangeListeners, getReloadCount: () => reloadCount, sandbox };
  }

  // --- 1) register() başarılı olunca registration.update() çağrılıyor mu? ---
  {
    let updateCalled = false;
    const registration = { update: async () => { updateCalled = true; } };
    const { windowListeners } = loadAppForSWTest({ registerImpl: async () => registration });
    windowListeners.load(); // "load" olayını tetikle
    await new Promise((r) => setTimeout(r, 20));
    check("register() başarılı olunca registration.update() çağrılıyor (24 saatlik throttle aşılıyor)", updateCalled);
  }

  // --- 2) & 3) controllerchange sonrası reload yalnızca BİR kez oluyor, birden çok tetiklense bile döngü olmuyor ---
  {
    const registration = { update: async () => {} };
    const { windowListeners, controllerChangeListeners, getReloadCount } = loadAppForSWTest({
      registerImpl: async () => registration,
    });
    windowListeners.load();
    await new Promise((r) => setTimeout(r, 20));
    check("controllerchange dinleyicisi kaydedildi", controllerChangeListeners.length === 1);
    // Gerçek tarayıcıda olağan olmasa da, savunma amaçlı: aynı olay art arda birden çok
    // kez tetiklense bile reload sayısı asla 1'i geçmemeli (sonsuz döngü koruması).
    for (let i = 0; i < 5; i++) controllerChangeListeners[0]();
    check(
      "controllerchange 5 kez tetiklense bile sayfa yalnızca 1 kez yenileniyor (sonsuz reload döngüsü yok)",
      getReloadCount() === 1
    );
  }

  // --- 4) service worker desteklenmeyen tarayıcıda uygulama çökmeden çalışmaya devam ediyor mu? ---
  {
    let threw = null;
    let windowListenersResult;
    let sandboxResult;
    try {
      const { windowListeners, sandbox } = loadAppForSWTest({ supportsSW: false, registerImpl: async () => ({ update: async () => {} }) });
      windowListenersResult = windowListeners;
      sandboxResult = sandbox;
    } catch (e) {
      threw = e;
    }
    check("SW desteklenmeyen tarayıcıda app.js yüklenirken hata fırlatılmıyor", !threw, threw && threw.message);
    check(
      "SW desteklenmeyen tarayıcıda service worker kaydı hiç denenmiyor ('load' dinleyicisi eklenmedi)",
      windowListenersResult && windowListenersResult.load === undefined
    );
    check(
      "SW desteklenmeyen tarayıcıda uygulamanın geri kalanı (KAI.escapeHtml) normal çalışmaya devam ediyor",
      !!(sandboxResult && sandboxResult.module.exports && sandboxResult.module.exports.escapeHtml("<b>") === "&lt;b&gt;")
    );
  }

  // --- 5) registration.update() reddedilirse (hata) uygulama çökmeden devam ediyor mu? ---
  {
    let threw = null;
    const registration = { update: async () => { throw new Error("update failed"); } };
    try {
      const { windowListeners, controllerChangeListeners } = loadAppForSWTest({ registerImpl: async () => registration });
      windowListeners.load();
      await new Promise((r) => setTimeout(r, 20));
      check("registration.update() reddedilse bile controllerchange dinleyicisi hâlâ kayıtlı", controllerChangeListeners.length === 1);
    } catch (e) {
      threw = e;
    }
    check("registration.update() reddedilirse (hata) uygulama çökmüyor", !threw, threw && threw.message);
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  process.exit(fail ? 1 : 0);
})();
