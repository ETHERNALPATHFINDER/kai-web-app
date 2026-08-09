// Orchestrates the /api/kai flow: read the single-source Kayıt Karar Politikası from Bilgi.md,
// ask Claude for a structured decision, validate it server-side, run deterministic
// duplicate/conflict checks, and — only if everything checks out — make one small, targeted
// edit to Finans.md or Görevler.md. Claude itself never sees or writes file content; it only
// ever returns the small structured object defined in lib/claudeClient.js's record_decision tool.

const { fetchFileFromGitHub } = require("./githubFetch");
const { safeUpdateFile } = require("./githubWrite");
// Personal v1'in aktif AI sağlayıcısı: Gemini (ücretsiz katman — bkz. Bilgi.md "Product v2
// Mimari Kararı"). lib/claudeClient.js aynı { systemPrompt, recentHistory, message } -> decision
// sözleşmesini uyguladığı için tek satırlık bir import değişikliğiyle geri dönülebilir; kalan
// kod (kaiSchema, api/kai.js, tüm yazma/dedupe mantığı) hangi sağlayıcının kullanıldığını hiç
// bilmiyor.
const { getStructuredDecision } = require("./geminiClient");
const { validateDecision } = require("./kaiSchema");
const { splitSections, splitSubsections, istanbulTodayUTCDate } = require("./mdUtils");

// ---------- Kayıt Karar Politikası — single source of truth is Bilgi.md, never hard-coded here ----------

let policyCache = { text: null, fetchedAt: 0 };
const POLICY_TTL_MS = 5 * 60 * 1000;

/** Pulls the "### Kayıt Karar Politikası (...)" subsection out of Bilgi.md's raw text, wherever
 * it lives (it doesn't assume a specific parent "## " section, so it keeps working if Bilgi.md
 * gets reorganized). Returns null if the section isn't found. */
function extractRecordPolicy(bilgiMarkdown) {
  const sections = splitSections(bilgiMarkdown);
  for (const key of Object.keys(sections)) {
    const subs = splitSubsections(sections[key]);
    const match = subs.find((s) => s.title.startsWith("Kayıt Karar Politikası"));
    if (match) return match.lines.join("\n").trim();
  }
  return null;
}

async function getRecordPolicyText({ now = Date.now(), forceRefresh = false, fetchFn = fetchFileFromGitHub } = {}) {
  if (!forceRefresh && policyCache.text && now - policyCache.fetchedAt < POLICY_TTL_MS) {
    return policyCache.text;
  }
  const path = process.env.BILGI_PATH || "Alanlar/Bilgi.md";
  const markdown = await fetchFn(path);
  const text = extractRecordPolicy(markdown);
  if (!text) throw new Error("Bilgi.md içinde 'Kayıt Karar Politikası' bölümü bulunamadı.");
  policyCache = { text, fetchedAt: now };
  return text;
}

function _resetPolicyCacheForTests() {
  policyCache = { text: null, fetchedAt: 0 };
}

function buildSystemPrompt(policyText, todayISO) {
  return [
    "Sen KAI'nin doğal dil giriş katmanısın. Görevin, kullanıcının tek bir mesajını aşağıdaki",
    "Kayıt Karar Politikası'na göre sınıflandırıp yalnızca record_decision tool'unu çağırmak.",
    "",
    `Bugünün tarihi (İstanbul): ${todayISO}`,
    "",
    policyText,
    "",
    "Kurallar:",
    "- Yalnızca record_decision tool'unu çağır, başka hiçbir metin üretme.",
    "- Bir dosyanın tamamını veya bir bölümünü asla yeniden üretme — yalnızca yapılandırılmış alanları doldur.",
    "- reply alanı her zaman dolu, kısa ve Türkçe olmalı.",
    '- Politikadaki ⚠️ durumlarında action="clarify_question" seç, question alanına tek kısa soru yaz.',
    '- Politikadaki ❌ durumlarında action="none" seç.',
    '- Öğrenilen bir fiyat bilgisi varsa ama ödemenin gerçekten yapıldığı belirtilmediyse action="none" seç ' +
      "ve reply'de bunun yalnızca fiyat bilgisi olarak not edildiğini belirt — finance_expense/finance_income ile kayıt AÇMA.",
    "- date alanı YYYY-MM-DD, time alanı HH:MM formatında olmalı.",
  ].join("\n");
}

// ---------- Table string editing — append or patch exactly one row, nothing else in the file changes ----------

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function joinRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

/** Locates the first pipe-table inside a top-level "## sectionName" section. */
function locateTable(lines, sectionName) {
  const sectionHeadingIdx = lines.findIndex((l) => l.trim() === `## ${sectionName}`);
  if (sectionHeadingIdx === -1) return null;
  let end = lines.length;
  for (let i = sectionHeadingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let headerLineIdx = -1;
  for (let i = sectionHeadingIdx + 1; i < end - 1; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      headerLineIdx = i;
      break;
    }
  }
  if (headerLineIdx === -1) return null;
  const header = splitRow(lines[headerLineIdx]);
  const rowLineIndices = [];
  for (let i = headerLineIdx + 2; i < end; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) break;
    rowLineIndices.push(i);
  }
  return { header, headerLineIdx, separatorLineIdx: headerLineIdx + 1, rowLineIndices };
}

function tableRows(lines, table) {
  return table.rowLineIndices.map((idx) => {
    const cells = splitRow(lines[idx]);
    const row = {};
    table.header.forEach((h, i) => (row[h] = cells[i] || ""));
    return row;
  });
}

/** Appends one new row (object keyed by header name) to sectionName's table. Returns new full content. */
function appendTableRow(markdown, sectionName, rowObj) {
  const lines = markdown.split(/\r?\n/);
  const table = locateTable(lines, sectionName);
  if (!table) throw new Error(`'${sectionName}' bölümünde tablo bulunamadı.`);
  const cells = table.header.map((h) => (rowObj[h] != null ? String(rowObj[h]) : "—"));
  const newLine = joinRow(cells);
  const insertAt = table.rowLineIndices.length
    ? table.rowLineIndices[table.rowLineIndices.length - 1] + 1
    : table.separatorLineIdx + 1;
  lines.splice(insertAt, 0, newLine);
  return lines.join("\n");
}

/** Patches only the named cells of the first row matching matchFn(rowObj). Every other row/cell
 * is untouched. Returns { content, matched, before }. */
function updateTableRow(markdown, sectionName, matchFn, patch) {
  const lines = markdown.split(/\r?\n/);
  const table = locateTable(lines, sectionName);
  if (!table) throw new Error(`'${sectionName}' bölümünde tablo bulunamadı.`);
  for (const idx of table.rowLineIndices) {
    const cells = splitRow(lines[idx]);
    const rowObj = {};
    table.header.forEach((h, i) => (rowObj[h] = cells[i] || ""));
    if (matchFn(rowObj)) {
      const before = { ...rowObj };
      const newCells = table.header.map((h, i) =>
        Object.prototype.hasOwnProperty.call(patch, h) ? String(patch[h]) : cells[i]
      );
      lines[idx] = joinRow(newCells);
      return { content: lines.join("\n"), matched: true, before };
    }
  }
  return { content: markdown, matched: false, before: undefined };
}

function nextId(rows, idField) {
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r[idField]).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

// ---------- Duplicate detection — deterministic, never delegated to the model ----------

function normalizeTitle(s) {
  return String(s || "").trim().toLowerCase();
}

/** An open (Bekliyor/Devam Ediyor) task with the same normalized title already exists. */
function findDuplicateTask(gorevRows, title) {
  const norm = normalizeTitle(title);
  return (
    gorevRows.find((r) => normalizeTitle(r["Başlık"]) === norm && ["Bekliyor", "Devam Ediyor"].includes(r["Durum"])) ||
    null
  );
}

/** The *last* row in İşlem Geçmişi already records the same amount/category/account/date/yön —
 * i.e. this looks like the same message sent twice in a row, not two different purchases. */
function findDuplicateExpense(islemRows, candidate) {
  if (!islemRows.length) return null;
  const last = islemRows[islemRows.length - 1];
  const same =
    last["Tutar"] === candidate["Tutar"] &&
    normalizeTitle(last["Kategori"]) === normalizeTitle(candidate["Kategori"]) &&
    normalizeTitle(last["Hesap"]) === normalizeTitle(candidate["Hesap"]) &&
    last["Tarih"] === candidate["Tarih"] &&
    last["Yön"] === candidate["Yön"];
  return same ? last : null;
}

// ---------- Row builders (existing column order/schema, unchanged) ----------

function fmtAmount(n) {
  return Math.round(n).toLocaleString("tr-TR");
}

function buildIslemRow(decision, todayISO, idStr) {
  return {
    "İşlem ID": idStr,
    Tarih: decision.date || todayISO,
    Yön: decision.action === "finance_income" ? "Gelir" : "Gider",
    Tutar: fmtAmount(decision.amount),
    "Para Birimi": decision.currency || "TRY",
    Kategori: decision.category,
    "Alt Kategori": decision.subcategory || "—",
    Hesap: decision.account,
    "Ödeme Yöntemi": "—",
    Bağlantı: "—",
    Not: "KAI ile eklendi",
  };
}

function buildGorevRow(decision, idStr) {
  return {
    ID: idStr,
    Başlık: decision.title,
    Alan: decision.area,
    Öncelik: decision.priority || "Orta",
    Durum: "Bekliyor",
    "Planlanan Tarih": decision.date || "—",
    "Planlanan Saat": decision.time || "—",
    "Erteleme Sayısı": "0",
    "Tamamlanma Tarihi": "—",
    Not: "KAI ile eklendi",
  };
}

function applyChangeTypePatch(changeType, newValue, currentRow) {
  const appendNote = (extra) => {
    const cur = currentRow["Not"];
    return cur && cur !== "—" ? `${cur}; ${extra}` : extra;
  };
  switch (changeType) {
    case "postpone":
      return {
        "Planlanan Tarih": newValue,
        "Erteleme Sayısı": String((parseInt(currentRow["Erteleme Sayısı"], 10) || 0) + 1),
      };
    case "date":
      return { "Planlanan Tarih": newValue };
    case "time":
      return { "Planlanan Saat": newValue };
    case "cancel":
      return { Durum: "İptal Edildi" };
    case "note":
      return { Not: appendNote(newValue) };
    case "amount":
      return { Not: appendNote(`Öğrenilen tutar: ${newValue}`) };
    default:
      return {};
  }
}

// ---------- Write dispatchers ----------

async function applyFinanceDecision(decision, { todayISO, safeUpdateFileFn }) {
  const path = process.env.FINANS_PATH || "Alanlar/Finans.md";
  let duplicateFound = false;
  const result = await safeUpdateFileFn(
    path,
    (content) => {
      const lines = content.split(/\r?\n/);
      const table = locateTable(lines, "İşlem Geçmişi");
      if (!table) throw new Error("'İşlem Geçmişi' tablosu bulunamadı.");
      const rows = tableRows(lines, table);
      const idStr = nextId(rows, "İşlem ID");
      const candidateRow = buildIslemRow(decision, todayISO, idStr);
      if (findDuplicateExpense(rows, candidateRow)) {
        duplicateFound = true;
        return content; // no-op: safeUpdateFile treats an unchanged string as "nothing to write"
      }
      return appendTableRow(content, "İşlem Geçmişi", candidateRow);
    },
    `KAI: Finans.md — ${decision.action === "finance_income" ? "gelir" : "gider"} kaydı eklendi`
  );

  if (duplicateFound) {
    return {
      action: decision.action,
      reply: "Bu tam olarak az önce kaydettiğim işlemle aynı görünüyor, tekrar eklemedim.",
      written: false,
      duplicate: true,
    };
  }
  return { action: decision.action, reply: decision.reply, written: result.written };
}

async function applyTaskCreate(decision, { safeUpdateFileFn }) {
  const path = process.env.GOREVLER_PATH || "Alanlar/Görevler.md";
  let duplicate = null;
  const result = await safeUpdateFileFn(
    path,
    (content) => {
      const lines = content.split(/\r?\n/);
      const table = locateTable(lines, "Görevler");
      if (!table) throw new Error("'Görevler' tablosu bulunamadı.");
      const rows = tableRows(lines, table);
      const dup = findDuplicateTask(rows, decision.title);
      if (dup) {
        duplicate = dup;
        return content;
      }
      const idStr = nextId(rows, "ID");
      return appendTableRow(content, "Görevler", buildGorevRow(decision, idStr));
    },
    "KAI: Görevler.md — yeni görev eklendi"
  );

  if (duplicate) {
    return {
      action: "task_create",
      reply: `Bu görev zaten listede: "${duplicate["Başlık"]}". İkinci kez eklemedim.`,
      written: false,
      duplicate: true,
    };
  }
  return { action: "task_create", reply: decision.reply, written: result.written };
}

async function applyTaskUpdate(decision, { safeUpdateFileFn }) {
  const path = process.env.GOREVLER_PATH || "Alanlar/Görevler.md";
  let notFound = false;
  const result = await safeUpdateFileFn(
    path,
    (content) => {
      const matchFn = (row) =>
        decision.target_task_id
          ? row["ID"] === decision.target_task_id
          : normalizeTitle(row["Başlık"]) === normalizeTitle(decision.title);

      const lines = content.split(/\r?\n/);
      const table = locateTable(lines, "Görevler");
      if (!table) throw new Error("'Görevler' tablosu bulunamadı.");
      const rows = tableRows(lines, table);
      const currentRow = rows.find(matchFn);
      if (!currentRow) {
        notFound = true;
        return content;
      }
      const patch = applyChangeTypePatch(decision.change_type, decision.new_value, currentRow);
      const { content: newContent, matched } = updateTableRow(content, "Görevler", matchFn, patch);
      if (!matched) {
        notFound = true;
        return content;
      }
      return newContent;
    },
    "KAI: Görevler.md — görev güncellendi"
  );

  if (notFound) {
    return { action: "task_update", reply: "Bu görevi bulamadım, güncelleme yapmadım.", written: false, notFound: true };
  }
  return { action: "task_update", reply: decision.reply, written: result.written };
}

// ---------- Top-level orchestration ----------

async function handleMessage({ message, recentHistory = [] }, deps = {}) {
  const {
    fetchDecisionFn = getStructuredDecision,
    fetchFileFn = fetchFileFromGitHub,
    safeUpdateFileFn = safeUpdateFile,
    now = new Date(),
  } = deps;

  const todayISO = istanbulTodayUTCDate(now).toISOString().slice(0, 10);
  const policyText = await getRecordPolicyText({ now: now.getTime(), fetchFn: fetchFileFn });
  const systemPrompt = buildSystemPrompt(policyText, todayISO);

  const rawDecision = await fetchDecisionFn({ systemPrompt, recentHistory, message });
  const { valid, errors } = validateDecision(rawDecision);
  if (!valid) {
    return {
      action: "none",
      reply: "Bunu net bir şekilde anlayamadım, farklı şekilde tekrar yazar mısın?",
      written: false,
      validationErrors: errors,
    };
  }

  if (rawDecision.action === "clarify_question") {
    return { action: "clarify_question", reply: rawDecision.question, written: false };
  }
  if (rawDecision.action === "none") {
    return { action: "none", reply: rawDecision.reply, written: false };
  }

  try {
    if (rawDecision.action === "finance_expense" || rawDecision.action === "finance_income") {
      return await applyFinanceDecision(rawDecision, { todayISO, safeUpdateFileFn });
    }
    if (rawDecision.action === "task_create") {
      return await applyTaskCreate(rawDecision, { safeUpdateFileFn });
    }
    if (rawDecision.action === "task_update") {
      return await applyTaskUpdate(rawDecision, { safeUpdateFileFn });
    }
  } catch (err) {
    // Covers a real GitHub write failure (e.g. a second sha conflict after the one retry
    // safeUpdateFile already attempted) — never bubble a stack trace to the user, just a
    // short Turkish message, and nothing was written.
    return {
      action: rawDecision.action,
      reply: "Bunu şu an kaydedemedim, birazdan tekrar dener misin?",
      written: false,
      error: String((err && err.message) || err),
    };
  }

  return { action: "none", reply: rawDecision.reply || "Anlaşıldı.", written: false };
}

module.exports = {
  extractRecordPolicy,
  getRecordPolicyText,
  _resetPolicyCacheForTests,
  buildSystemPrompt,
  locateTable,
  tableRows,
  appendTableRow,
  updateTableRow,
  nextId,
  findDuplicateTask,
  findDuplicateExpense,
  buildIslemRow,
  buildGorevRow,
  applyChangeTypePatch,
  applyFinanceDecision,
  applyTaskCreate,
  applyTaskUpdate,
  handleMessage,
};
