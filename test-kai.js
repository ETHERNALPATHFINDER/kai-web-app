// Regression tests for the KAI chat feature: lib/kaiSchema.js (structured-output validation),
// lib/kaiActions.js (policy fetch, table read/write, duplicate detection, orchestration),
// lib/githubWrite.js (sha-guarded compare-and-swap writes), and lib/geminiClient.js (the active
// AI provider for Personal v1 — request/response shape only, see section F).
//
// The AI provider is never actually called over the network here (no network in this sandbox,
// and it would make the suite non-deterministic) — instead, each scenario 1-9 injects the
// *decision* a correctly-behaving model call would produce for that message, and asserts the
// server does the right thing with it. That's the real boundary this project can test
// deterministically: given a structured decision, does validation/dedup/writing behave safely?
// Whether the model itself follows the policy is governed by the system prompt built in
// buildSystemPrompt(), which is also checked directly below. Section F separately checks that
// lib/geminiClient.js builds the right request and parses the right response shape, with
// global.fetch mocked — same technique as the sha-conflict tests in sections 8-9.
//
// Run with: node test-kai.js
const assert = require("assert");

const { validateDecision } = require("./lib/kaiSchema");
const kaiActions = require("./lib/kaiActions");
const { safeUpdateFile } = require("./lib/githubWrite");
const geminiClient = require("./lib/geminiClient");

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
// Fixtures — small, realistic excerpts of Finans.md / Görevler.md / Bilgi.md.
// Not the full real files; just enough structure for the table-editing logic to work against.
// ---------------------------------------------------------------------------

function finansFixture() {
  return [
    "# Finans",
    "",
    "## Hesaplar",
    "",
    "### Ana Hesap (Banka/Kart)",
    "- Bakiye: 5.000 TRY",
    "",
    "## İşlem Geçmişi",
    "",
    "| İşlem ID | Tarih | Yön | Tutar | Para Birimi | Kategori | Alt Kategori | Hesap | Ödeme Yöntemi | Bağlantı | Not |",
    "|---|---|---|---:|---|---|---|---|---|---|---|",
    "| 001 | 2026-08-04 | Gider | 320 | TRY | Yeme-İçme | Kahve | Ana Hesap | Kart (Enpara) | — | — |",
    "| 002 | 2026-08-05 | Gelir | 10.000 | TRY | İş Geliri | Maaş Avansı | Ana Hesap | Havale/EFT | — | — |",
    "",
    "## Borçlar",
    "",
    "### Motosiklet Borcu",
    "- Kalan: 84.000 TRY",
    "",
  ].join("\n");
}

function gorevlerFixture() {
  return [
    "# Görevler",
    "",
    "## Görevler",
    "",
    "| ID | Başlık | Alan | Öncelik | Durum | Planlanan Tarih | Planlanan Saat | Erteleme Sayısı | Tamamlanma Tarihi | Not |",
    "|---|---|---|---|---|---|---|---|---|---|",
    "| 001 | Motor Tamiri | Kişisel/Araç | Yüksek | Tamamlandı | 2026-08-05 | — | 0 | 2026-08-06 | Usta 2.500 TL istedi |",
    "| 003 | Ctrip Politikasını Aktifleştir | Otel | Yüksek | Bekliyor | 2026-08-06 | — | 0 | — | — |",
    "",
    "## Sonuç Bekleyenler",
    "",
    "*Bir görev tamamlandığında...*",
    "",
  ].join("\n");
}

function bilgiFixture() {
  return [
    "# Bilgi",
    "",
    "## Sistem Geliştirme Felsefesi (Standing, 2026-08-05)",
    "",
    "Bazı önsöz metni burada.",
    "",
    "### Kayıt Karar Politikası (Standing, 2026-08-07)",
    "",
    "**✅ Kaydedilecek konuşmalar**",
    "- Kesin karar + zaman ifadesi → tarihli görev.",
    "- Ödemenin gerçekten yapıldığı bilgisi → Finans.md'ye gider kaydı.",
    "",
    "**❌ Hiç kaydedilmeyecek konuşmalar**",
    "- Öğrenilen fiyat bilgisi, ödeme yapılmadıysa → tek başına Finans kaydı OLUŞTURMAZ.",
    "",
    "## Kişiler",
    "",
    "- Örnek kişi notu.",
    "",
  ].join("\n");
}

/** Minimal in-memory stand-in for githubWrite.safeUpdateFile's contract, used for the
 * functional (non-sha) scenarios. The real sha-conflict/retry mechanics are tested separately
 * below against the actual lib/githubWrite.js module. */
function makeFakeStore(files) {
  const store = { ...files };
  const calls = [];
  const safeUpdateFileFn = async (path, mutateFn) => {
    const content = store[path];
    const newContent = mutateFn(content);
    calls.push(path);
    if (newContent === content) return { written: false };
    store[path] = newContent;
    return { written: true };
  };
  const fetchFileFn = async (path) => store[path];
  return { store, calls, safeUpdateFileFn, fetchFileFn };
}

function freshStore() {
  return makeFakeStore({
    "Alanlar/Finans.md": finansFixture(),
    "Alanlar/Görevler.md": gorevlerFixture(),
    "Alanlar/Bilgi.md": bilgiFixture(),
  });
}

const FIXED_NOW = new Date("2026-08-07T10:00:00Z"); // Europe/Istanbul: 2026-08-07 13:00

async function run() {
  process.env.FINANS_PATH = "Alanlar/Finans.md";
  process.env.GOREVLER_PATH = "Alanlar/Görevler.md";
  process.env.BILGI_PATH = "Alanlar/Bilgi.md";

  // -------------------------------------------------------------------------
  // A) lib/kaiSchema.js — validateDecision()
  // -------------------------------------------------------------------------
  {
    const v = validateDecision({ action: "finance_expense", amount: 450, currency: "TRY", category: "Yeme-İçme", account: "Ana Hesap", reply: "ok" });
    check("validateDecision geçerli finance_expense'i kabul ediyor", v.valid === true);
  }
  {
    const v = validateDecision({ action: "finance_expense", amount: -5, currency: "TRY", category: "x", account: "y", reply: "ok" });
    check("validateDecision negatif amount'u reddediyor", v.valid === false && v.errors.some((e) => e.includes("amount")));
  }
  {
    const v = validateDecision({ action: "task_create", title: "X", area: "Y", date: "07-08-2026", reply: "ok" });
    check("validateDecision yanlış tarih formatını reddediyor (YYYY-MM-DD bekleniyor)", v.valid === false);
  }
  {
    const v = validateDecision({ action: "task_update", change_type: "postpone", new_value: "2026-08-10", reply: "ok" });
    check("validateDecision task_update için hedef (id veya title) olmadan reddediyor", v.valid === false);
  }
  {
    const v = validateDecision({ action: "clarify_question", reply: "ok" });
    check("validateDecision clarify_question için question alanı yoksa reddediyor", v.valid === false);
  }
  {
    const v = validateDecision({ action: "none", reply: "Bu bir fikir, kayıt açmadım." });
    check("validateDecision none aksiyonunu kabul ediyor (ekstra alan gerektirmiyor)", v.valid === true);
  }
  {
    const v = validateDecision("bir string, obje değil");
    check("validateDecision obje olmayan girdiyi reddediyor, hata fırlatmıyor", v.valid === false);
  }

  // -------------------------------------------------------------------------
  // B) Sistem promptu — tek kaynak Bilgi.md, fiyat/ödeme ayrımı talimatı içeriyor
  // -------------------------------------------------------------------------
  {
    const policy = kaiActions.extractRecordPolicy(bilgiFixture());
    check("extractRecordPolicy Bilgi.md'den 'Kayıt Karar Politikası' bölümünü buluyor", policy && policy.includes("✅ Kaydedilecek"));
    const prompt = kaiActions.buildSystemPrompt(policy, "2026-08-07");
    check(
      "Sistem promptu, ödemesi yapılmamış fiyat bilgisinin finance_expense açmaması talimatını içeriyor",
      /ödemenin gerçekten yapıldığı belirtilmediyse action="none"/.test(prompt)
    );
    check("Sistem promptu bugünün tarihini içeriyor", prompt.includes("2026-08-07"));
    check("Sistem promptu politika metnini olduğu gibi (yeniden yazmadan) gömüyor", prompt.includes("Öğrenilen fiyat bilgisi, ödeme yapılmadıysa"));
  }

  // -------------------------------------------------------------------------
  // 1) "Bugün 450 TL kahveye ödedim." -> finance_expense, güvenli ekleme
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = {
      action: "finance_expense",
      amount: 450,
      currency: "TRY",
      category: "Yeme-İçme",
      subcategory: "Kahve",
      account: "Ana Hesap",
      reply: "450 TRY kahve gideri Ana Hesap'a kaydedildi.",
    };
    const result = await kaiActions.handleMessage(
      { message: "Bugün 450 TL kahveye ödedim.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("1) finance_expense kararı yazıldı olarak dönüyor", result.written === true && result.action === "finance_expense");
    check("1) İşlem Geçmişi'ne yeni satır (003) eklendi, mevcut satırlar korundu", store["Alanlar/Finans.md"].includes("| 003 | 2026-08-07 | Gider | 450 | TRY | Yeme-İçme | Kahve | Ana Hesap | — | — | KAI ile eklendi |") && store["Alanlar/Finans.md"].includes("| 001 | 2026-08-04") && store["Alanlar/Finans.md"].includes("| 002 | 2026-08-05"));
    check("1) Görevler.md dosyasına dokunulmadı", store["Alanlar/Görevler.md"] === gorevlerFixture());
  }

  // -------------------------------------------------------------------------
  // 2) "Motor tamiri 3500 TL tuttu." -> ödeme doğrulanmadan finance_expense oluşturulmuyor
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    // Doğru davranan bir Claude çağrısının bu mesaj için döneceği karar: sadece fiyat bilgisi,
    // ödeme henüz yapılmadı -> action "none" (bkz. Kayıt Karar Politikası'ndaki ❌ maddesi).
    const decision = { action: "none", reply: "3.500 TL fiyat bilgisi not edildi. Ödeme henüz kaydedilmedi." };
    const result = await kaiActions.handleMessage(
      { message: "Motor tamiri 3500 TL tuttu.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("2) action 'none' olarak işleniyor, hiçbir şey yazılmıyor", result.action === "none" && result.written === false);
    check("2) Finans.md içeriği hiç değişmedi (yeni satır yok)", store["Alanlar/Finans.md"] === finansFixture());
  }

  // -------------------------------------------------------------------------
  // 3) "Yarın 14:00 avukatla görüşeceğim." -> task_create
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = {
      action: "task_create",
      title: "Avukatla Görüş",
      area: "Kişisel",
      date: "2026-08-08",
      time: "14:00",
      reply: "Yarın 14:00 için avukat görüşmesi eklendi.",
    };
    const result = await kaiActions.handleMessage(
      { message: "Yarın 14:00 avukatla görüşeceğim.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("3) task_create yazıldı olarak dönüyor", result.written === true && result.action === "task_create");
    check(
      "3) Görevler.md'ye yeni satır (004) eklendi, doğru tarih/saat/durum ile",
      store["Alanlar/Görevler.md"].includes("| 004 | Avukatla Görüş | Kişisel | Orta | Bekliyor | 2026-08-08 | 14:00 | 0 | — | KAI ile eklendi |")
    );
    check("3) Mevcut görev satırları (001, 003) korundu", store["Alanlar/Görevler.md"].includes("| 001 |") && store["Alanlar/Görevler.md"].includes("| 003 |"));
  }

  // -------------------------------------------------------------------------
  // 4) "Belki sonbaharda Moskova'ya giderim." -> none, hiçbir kayıt yok
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = { action: "none", reply: "Bu henüz kesinleşmiş bir plan değil." };
    const result = await kaiActions.handleMessage(
      { message: "Belki sonbaharda Moskova'ya giderim.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("4) action 'none', written false", result.action === "none" && result.written === false);
    check("4) Finans.md ve Görevler.md hiç değişmedi", store["Alanlar/Finans.md"] === finansFixture() && store["Alanlar/Görevler.md"] === gorevlerFixture());
  }

  // -------------------------------------------------------------------------
  // 5) Belirsiz niyet -> clarify_question, tek kısa soru, kayıt yok
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = { action: "clarify_question", question: "Bunu görev olarak ekleyeyim mi?", reply: "Bunu görev olarak ekleyeyim mi?" };
    const result = await kaiActions.handleMessage(
      { message: "Bir ara bankaya uğramam lazım.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("5) clarify_question, kullanıcıya tek kısa soru dönüyor", result.action === "clarify_question" && result.reply === "Bunu görev olarak ekleyeyim mi?");
    check("5) written false, hiçbir dosya değişmedi", result.written === false && store["Alanlar/Görevler.md"] === gorevlerFixture());
  }

  // -------------------------------------------------------------------------
  // 6) Mevcut görev tarih değişikliği -> task_update, yeni satır açılmıyor
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = {
      action: "task_update",
      target_task_id: "003",
      change_type: "postpone",
      new_value: "2026-08-10",
      reply: "Ctrip görevi 10 Ağustos'a ertelendi.",
    };
    const result = await kaiActions.handleMessage(
      { message: "Ctrip görevini 10 Ağustos'a ertele.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("6) task_update yazıldı olarak dönüyor", result.written === true && result.action === "task_update");
    const updated = store["Alanlar/Görevler.md"];
    check(
      "6) Yalnızca 003'ün Planlanan Tarih ve Erteleme Sayısı hücreleri değişti",
      updated.includes("| 003 | Ctrip Politikasını Aktifleştir | Otel | Yüksek | Bekliyor | 2026-08-10 | — | 1 | — | — |")
    );
    check("6) Satır 001 hiç değişmedi, yeni satır (004) açılmadı", updated.includes("| 001 | Motor Tamiri") && !updated.includes("| 004 |"));
  }

  // -------------------------------------------------------------------------
  // 7) Duplicate görev -> ikinci kayıt açılmıyor
  // -------------------------------------------------------------------------
  {
    const { store, safeUpdateFileFn, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const decision = {
      action: "task_create",
      title: "Ctrip Politikasını Aktifleştir", // 003 ile aynı, hâlâ "Bekliyor"
      area: "Otel",
      reply: "Ctrip görevi eklendi.",
    };
    const result = await kaiActions.handleMessage(
      { message: "Ctrip görevini ekle.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn, now: FIXED_NOW }
    );
    check("7) duplicate tespit edildi, written false", result.written === false && result.duplicate === true);
    check("7) Görevler.md'ye ikinci bir satır eklenmedi", store["Alanlar/Görevler.md"] === gorevlerFixture());
  }

  // -------------------------------------------------------------------------
  // 8) GitHub SHA conflict -> bir kez yeniden oku, tekrar dene, başarılı ol
  // -------------------------------------------------------------------------
  {
    const path = "Alanlar/Görevler.md";
    const calls = [];
    const originalFetch = global.fetch;
    let getCount = 0;
    global.fetch = async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      calls.push(method);
      if (method === "GET") {
        getCount += 1;
        // İkinci GET'te dosyanın GitHub'da değiştiğini simüle et (farklı sha + farklı içerik).
        const sha = getCount === 1 ? "sha-v1" : "sha-v2";
        const content = getCount === 1 ? "eski içerik" : "güncel içerik (başka biri değiştirdi)";
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: Buffer.from(content, "utf8").toString("base64"), sha, encoding: "base64" }),
        };
      }
      // PUT
      const body = JSON.parse(opts.body);
      if (body.sha === "sha-v1") {
        return { ok: false, status: 409, text: async () => "conflict" };
      }
      return { ok: true, status: 200, json: async () => ({ commit: { sha: "new-sha" } }) };
    };
    process.env.GITHUB_TOKEN = "fake-read-token";
    process.env.GITHUB_WRITE_TOKEN = "fake-write-token";
    process.env.GITHUB_OWNER = "ETHERNALPATHFINDER";
    process.env.GITHUB_REPO = "kai-vault-data";
    process.env.GITHUB_BRANCH = "main";

    let result;
    try {
      result = await safeUpdateFile(path, (content) => content + " + eklendi", "test commit");
    } finally {
      global.fetch = originalFetch;
    }
    check("8) İlk PUT conflict (409) sonrası bir kez daha okuyup yeniden yazdı", result.written === true && result.retried === true);
    check("8) GET/PUT sırası tam olarak GET,PUT,GET,PUT (yalnızca bir retry)", calls.join(",") === "GET,PUT,GET,PUT");
  }

  // -------------------------------------------------------------------------
  // 9) İkinci conflict -> yazma yapılmaz, kullanıcıya kısa hata döner
  // -------------------------------------------------------------------------
  {
    const path = "Alanlar/Görevler.md";
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: Buffer.from("içerik", "utf8").toString("base64"), sha: "sha-x", encoding: "base64" }),
        };
      }
      return { ok: false, status: 409, text: async () => "conflict" }; // her PUT çakışıyor
    };

    let threw = false;
    try {
      await safeUpdateFile(path, (content) => content + " + değişiklik");
    } catch (err) {
      threw = true;
      check("9) İkinci conflict'te safeUpdateFile hata fırlatıyor (sessizce üzerine yazmıyor)", err.code === "SHA_CONFLICT" || /conflict|SHA/i.test(err.message));
    } finally {
      global.fetch = originalFetch;
    }
    check("9) safeUpdateFile gerçekten hata fırlattı (yazma başarısız sayıldı)", threw === true);

    // api/kai.js'in gördüğü davranış: handleMessage bu hatayı yakalar, kullanıcıya kısa ve
    // güvenli bir mesajla döner — asla ham hata/stack trace döndürmez, asla yazma yapmaz.
    const { store, fetchFileFn } = freshStore();
    kaiActions._resetPolicyCacheForTests();
    const alwaysConflicts = async () => {
      const err = new Error("SHA_CONFLICT");
      err.code = "SHA_CONFLICT";
      throw err;
    };
    const decision = { action: "task_create", title: "Yeni Görev", area: "Otel", reply: "Eklendi." };
    const result = await kaiActions.handleMessage(
      { message: "Bir görev daha ekle.", recentHistory: [] },
      { fetchDecisionFn: async () => decision, fetchFileFn, safeUpdateFileFn: alwaysConflicts, now: FIXED_NOW }
    );
    check("9) handleMessage hatayı yutuyor, written false ve kısa Türkçe reply dönüyor", result.written === false && typeof result.reply === "string" && result.reply.length > 0 && !!result.error);
  }

  // -------------------------------------------------------------------------
  // F) lib/geminiClient.js — istek şekli (forced function call) ve yanıt ayrıştırma
  // -------------------------------------------------------------------------
  {
    const originalFetch = global.fetch;
    let capturedUrl = null;
    let capturedBody = null;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: "record_decision", args: { action: "none", reply: "test" } } }],
              },
            },
          ],
        }),
      };
    };
    process.env.GEMINI_API_KEY = "fake-gemini-key";
    delete process.env.GEMINI_MODEL;

    let decision;
    try {
      decision = await geminiClient.getStructuredDecision({
        systemPrompt: "sistem promptu",
        recentHistory: [{ role: "user", text: "önceki mesaj" }],
        message: "yeni mesaj",
      });
    } finally {
      global.fetch = originalFetch;
    }

    check("F) Varsayılan model (gemini-2.5-flash) URL'de kullanılıyor", capturedUrl.includes("gemini-2.5-flash:generateContent"));
    check("F) x-goog-api-key header'ı ile kimlik doğrulanıyor, URL'de key yok", !capturedUrl.includes("fake-gemini-key"));
    check(
      "F) toolConfig ANY modunda ve yalnızca record_decision'a izin veriyor (model serbest metin üretemiyor)",
      capturedBody.toolConfig.functionCallingConfig.mode === "ANY" &&
        capturedBody.toolConfig.functionCallingConfig.allowedFunctionNames.length === 1 &&
        capturedBody.toolConfig.functionCallingConfig.allowedFunctionNames[0] === "record_decision"
    );
    check(
      "F) Geçmiş mesajlar 'model'/'user' rolleriyle contents'e ekleniyor, sistem promptu ayrı gönderiliyor",
      capturedBody.systemInstruction.parts[0].text === "sistem promptu" &&
        capturedBody.contents[0].role === "user" &&
        capturedBody.contents[capturedBody.contents.length - 1].parts[0].text === "yeni mesaj"
    );
    check("F) functionCall.args doğrudan decision objesi olarak dönüyor", decision.action === "none" && decision.reply === "test");
  }
  {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "serbest metin, functionCall yok" }] } }] }),
    });
    process.env.GEMINI_API_KEY = "fake-gemini-key";
    let threw = false;
    try {
      await geminiClient.getStructuredDecision({ systemPrompt: "x", recentHistory: [], message: "y" });
    } catch (err) {
      threw = true;
      check("F) functionCall yoksa (model serbest metin dönerse) açık bir hata fırlatılıyor", /structured decision/i.test(err.message));
    } finally {
      global.fetch = originalFetch;
    }
    check("F) functionCall eksikken gerçekten hata fırlatıldı", threw === true);
  }
  {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    let threw = false;
    try {
      await geminiClient.getStructuredDecision({ systemPrompt: "x", recentHistory: [], message: "y" });
    } catch (err) {
      threw = true;
      check("F) GEMINI_API_KEY eksikken ağa hiç istek atmadan açık hata veriyor", /GEMINI_API_KEY/.test(err.message));
    } finally {
      if (original) process.env.GEMINI_API_KEY = original;
    }
    check("F) API key eksikken gerçekten hata fırlatıldı", threw === true);
  }

  // -------------------------------------------------------------------------
  // 10) Finans/Günlük mevcut engine'leri ve export şekilleri bozulmadı
  // -------------------------------------------------------------------------
  {
    const { buildFinansViewModel } = require("./lib/finansEngine");
    const { buildGunlukViewModel } = require("./lib/gunlukEngine");
    check("10) finansEngine.buildFinansViewModel hâlâ fonksiyon (kai özelliği dokunmadı)", typeof buildFinansViewModel === "function");
    check("10) gunlukEngine.buildGunlukViewModel hâlâ fonksiyon (kai özelliği dokunmadı)", typeof buildGunlukViewModel === "function");
    // finansEngine kendi gerçek örnek verisiyle hâlâ hatasız çalışıyor mu — hızlı bir duman testi.
    const vm = buildFinansViewModel(finansFixture());
    check("10) finansEngine küçük bir fixture ile hâlâ hatasız ViewModel üretiyor", vm && typeof vm === "object");
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  if (fail > 0) process.exitCode = 1;
}

run();
