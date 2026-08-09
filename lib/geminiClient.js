// Minimal wrapper around the Gemini API (generateContent), mirroring lib/claudeClient.js's
// contract exactly: getStructuredDecision({ systemPrompt, recentHistory, message }) -> the same
// structured decision object lib/kaiSchema.js validates. No SDK dependency — plain fetch, same
// zero-new-dependency rule as the rest of the project.
//
// This is Personal v1's AI Provider swap boundary (see Bilgi.md "Product v2 Mimari Kararı"):
// lib/kaiActions.js only imports getStructuredDecision by name, so this file is a drop-in
// replacement for lib/claudeClient.js — kaiSchema.js, api/kai.js, and every write/dedupe path
// are completely unaware of which vendor produced the decision.
//
// Forced structured output: Gemini's equivalent of Anthropic's `tool_choice:{type:"tool"}` is
// `toolConfig.functionCallingConfig.mode = "ANY"` restricted to a single allowed function name
// — the model can only ever call record_decision, never answer in free text or reproduce file
// content. Same security property as the Claude implementation, different vendor primitive.

const RECORD_DECISION_FUNCTION = {
  name: "record_decision",
  description:
    "Kullanıcının mesajını sistem promptundaki Kayıt Karar Politikası'na göre sınıflandırır ve " +
    "tek bir yapılandırılmış karar döner. Asla serbest metin, Markdown veya dosya içeriği üretme " +
    "— yalnızca bu şemaya uyan alanları doldur.",
  parameters: {
    type: "OBJECT",
    properties: {
      action: {
        type: "STRING",
        enum: ["finance_expense", "finance_income", "task_create", "task_update", "clarify_question", "none"],
      },
      amount: { type: "NUMBER", description: "finance_expense/finance_income için tutar" },
      currency: { type: "STRING", description: "örn. TRY" },
      category: { type: "STRING" },
      subcategory: { type: "STRING" },
      account: { type: "STRING", description: "örn. Ana Hesap, Nakit" },
      title: { type: "STRING", description: "task_create/task_update için görev başlığı" },
      area: { type: "STRING", description: "task_create için alan, örn. Kişisel/Araç, Otel" },
      priority: { type: "STRING" },
      date: { type: "STRING", description: "YYYY-MM-DD" },
      time: { type: "STRING", description: "HH:MM" },
      target_task_id: { type: "STRING", description: "task_update için biliniyorsa görev ID'si" },
      change_type: {
        type: "STRING",
        enum: ["postpone", "cancel", "note", "amount", "date", "time"],
      },
      new_value: { type: "STRING", description: "task_update için yeni değer" },
      question: { type: "STRING", description: "clarify_question için kullanıcıya sorulacak tek kısa soru" },
      reply: {
        type: "STRING",
        description: "Kullanıcıya gösterilecek kısa Türkçe cevap. Her action için zorunlu, her zaman doldurulur.",
      },
    },
    required: ["action", "reply"],
  },
};

// Ücretsiz katmanda kalan modeller (2026-08 itibarıyla): yalnızca Flash/Flash-Lite ailesi —
// Pro modelleri 2026-04'ten beri ücretsiz katmanda değil, gemini-2.0-flash 2026-03'te
// kaldırıldı. gemini-2.5-flash, bu sınıflandırma görevi için flash-lite'tan daha güvenilir
// talimat uyumu sağladığından varsayılan seçildi (bkz. Gemini geçiş analizi raporu).
const DEFAULT_MODEL = "gemini-2.5-flash";

async function getStructuredDecision({ systemPrompt, recentHistory, message }) {
  const { GEMINI_API_KEY, GEMINI_MODEL } = process.env;
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY env değişkeni eksik. Vercel proje ayarlarından ekle.");
  }

  const contents = [
    ...(recentHistory || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.text || "").slice(0, 2000) }],
    })),
    { role: "user", parts: [{ text: String(message || "").slice(0, 2000) }] },
  ];

  const model = GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: [RECORD_DECISION_FUNCTION] }],
      // ANY + allowedFunctionNames: model yalnızca record_decision'ı çağırabilir, serbest
      // metin/başka fonksiyon çağrısı üretemez (bkz. dosya başındaki not).
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_decision"] } },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API hatası (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const parts =
    (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  const call = parts.find((p) => p.functionCall && p.functionCall.name === "record_decision");
  if (!call) {
    throw new Error("Gemini structured decision döndürmedi.");
  }
  return call.functionCall.args;
}

module.exports = { getStructuredDecision, RECORD_DECISION_FUNCTION, DEFAULT_MODEL };
