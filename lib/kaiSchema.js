// Server-side validation for the structured decision Claude's record_decision tool returns.
// Claude's output is never trusted directly — every field is checked here before anything
// is allowed to touch Finans.md or Görevler.md. If validation fails, the caller (api/kai.js /
// lib/kaiActions.js) falls back to a safe "none" response instead of writing anything.

const ACTIONS = [
  "finance_expense",
  "finance_income",
  "task_create",
  "task_update",
  "clarify_question",
  "none",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHANGE_TYPES = ["postpone", "cancel", "note", "amount", "date", "time"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Returns { valid: boolean, errors: string[] }. Never throws. */
function validateDecision(decision) {
  const errors = [];

  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return { valid: false, errors: ["decision bir obje değil"] };
  }
  if (!ACTIONS.includes(decision.action)) {
    return { valid: false, errors: [`geçersiz action: ${decision.action}`] };
  }
  if (!isNonEmptyString(decision.reply)) {
    errors.push("reply eksik veya boş");
  }
  if (decision.date != null && decision.date !== "" && !DATE_RE.test(decision.date)) {
    errors.push("date formatı geçersiz (YYYY-MM-DD bekleniyor)");
  }
  if (decision.time != null && decision.time !== "" && !TIME_RE.test(decision.time)) {
    errors.push("time formatı geçersiz (HH:MM bekleniyor)");
  }

  switch (decision.action) {
    case "finance_expense":
    case "finance_income": {
      if (typeof decision.amount !== "number" || !Number.isFinite(decision.amount) || decision.amount <= 0) {
        errors.push("amount geçersiz (pozitif bir sayı olmalı)");
      }
      if (!isNonEmptyString(decision.currency)) errors.push("currency eksik");
      if (!isNonEmptyString(decision.category)) errors.push("category eksik");
      if (!isNonEmptyString(decision.account)) errors.push("account eksik");
      break;
    }
    case "task_create": {
      if (!isNonEmptyString(decision.title)) errors.push("title eksik");
      if (!isNonEmptyString(decision.area)) errors.push("area eksik");
      break;
    }
    case "task_update": {
      const hasTarget = isNonEmptyString(decision.target_task_id) || isNonEmptyString(decision.title);
      if (!hasTarget) errors.push("task_update için target_task_id veya title gerekli");
      if (!CHANGE_TYPES.includes(decision.change_type)) {
        errors.push(`change_type geçersiz: ${decision.change_type}`);
      }
      if (!isNonEmptyString(decision.new_value)) errors.push("new_value eksik");
      break;
    }
    case "clarify_question": {
      if (!isNonEmptyString(decision.question)) errors.push("question eksik");
      break;
    }
    case "none":
      break; // no extra fields required
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { ACTIONS, CHANGE_TYPES, DATE_RE, TIME_RE, validateDecision };
