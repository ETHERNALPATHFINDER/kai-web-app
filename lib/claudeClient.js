// Minimal wrapper around the Claude Messages API. No SDK dependency — plain `fetch`, matching
// the project's zero-new-dependency rule.
//
// The model is never allowed to answer in free text. `tool_choice` forces it to call the
// single `record_decision` tool, so the only thing it can ever produce is the structured
// object below — never a rewritten Markdown file, never file content. The result still goes
// through lib/kaiSchema.js's validateDecision() before anything is trusted.

const RECORD_DECISION_TOOL = {
  name: "record_decision",
  description:
    "Kullanıcının mesajını sistem promptundaki Kayıt Karar Politikası'na göre sınıflandırır ve " +
    "tek bir yapılandırılmış karar döner. Asla serbest metin, Markdown veya dosya içeriği üretme " +
    "— yalnızca bu şemaya uyan alanları doldur.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["finance_expense", "finance_income", "task_create", "task_update", "clarify_question", "none"],
      },
      amount: { type: "number", description: "finance_expense/finance_income için tutar" },
      currency: { type: "string", description: "örn. TRY" },
      category: { type: "string" },
      subcategory: { type: "string" },
      account: { type: "string", description: "örn. Ana Hesap, Nakit" },
      title: { type: "string", description: "task_create/task_update için görev başlığı" },
      area: { type: "string", description: "task_create için alan, örn. Kişisel/Araç, Otel" },
      priority: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:MM" },
      target_task_id: { type: "string", description: "task_update için biliniyorsa görev ID'si" },
      change_type: {
        type: "string",
        enum: ["postpone", "cancel", "note", "amount", "date", "time"],
      },
      new_value: { type: "string", description: "task_update için yeni değer" },
      question: { type: "string", description: "clarify_question için kullanıcıya sorulacak tek kısa soru" },
      reply: {
        type: "string",
        description: "Kullanıcıya gösterilecek kısa Türkçe cevap. Her action için zorunlu, her zaman doldurulur.",
      },
    },
    required: ["action", "reply"],
  },
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

async function getStructuredDecision({ systemPrompt, recentHistory, message }) {
  const { ANTHROPIC_API_KEY, CLAUDE_MODEL } = process.env;
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY env değişkeni eksik. Vercel proje ayarlarından ekle.");
  }

  const messages = [
    ...(recentHistory || []).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.text || "").slice(0, 2000),
    })),
    { role: "user", content: String(message || "").slice(0, 2000) },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: [RECORD_DECISION_TOOL],
      tool_choice: { type: "tool", name: "record_decision" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API hatası (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const toolUse = (json.content || []).find((b) => b.type === "tool_use" && b.name === "record_decision");
  if (!toolUse) {
    throw new Error("Claude structured decision döndürmedi.");
  }
  return toolUse.input;
}

module.exports = { getStructuredDecision, RECORD_DECISION_TOOL, DEFAULT_MODEL };
