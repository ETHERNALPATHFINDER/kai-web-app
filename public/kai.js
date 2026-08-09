// public/kai.js — minimal natural-language chat tab. Sends each message to /api/kai, which
// classifies it against the Kayıt Karar Politikası and (only when appropriate) makes a single,
// safe, targeted edit to Finans.md or Görevler.md on the server. This file only ever renders
// plain escaped text bubbles and handles the input/send button — no markdown rendering, no
// extra UI beyond message history + input + Gönder.
//
// Chat history: last few messages only, kept in localStorage (no database, per spec).

const HISTORY_KEY = "kai_chat_history";
const HISTORY_LIMIT = 10;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_LIMIT) : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch (e) {
    // localStorage dolu/erişilemez olabilir — sohbet geçmişi kaybolur ama uygulama çökmez.
  }
}

function bubbleHtml(msg) {
  const who = msg.role === "assistant" ? "kai" : "user";
  return `<div class="chat-bubble ${who}">${KAI.escapeHtml(msg.text)}</div>`;
}

function loadKai() {
  render(loadHistory());
  bind();

  function render(hist) {
    document.getElementById("app").innerHTML = `
      <div class="${KAI.pageWrapClass("kai")}">
        ${KAI.nav("kai")}
        <div class="chat-card">
          <div class="chat-history" id="kai-chat-history">
            ${hist.length ? hist.map(bubbleHtml).join("") : '<div class="empty">KAI’ye yaz, başlayalım.</div>'}
          </div>
          <div class="chat-input-bar">
            <input id="kai-chat-input" type="text" placeholder="KAI’ye yaz…" autocomplete="off" />
            <button id="kai-chat-send">Gönder</button>
          </div>
        </div>
      </div>
    `;
    const historyEl = document.getElementById("kai-chat-history");
    if (historyEl) historyEl.scrollTop = historyEl.scrollHeight;
  }

  function bind() {
    const input = document.getElementById("kai-chat-input");
    const send = document.getElementById("kai-chat-send");
    if (!input || !send) return;
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    input.focus();
  }

  async function submit() {
    const input = document.getElementById("kai-chat-input");
    const text = input ? input.value.trim() : "";
    if (!text) return;

    let history = loadHistory();
    history.push({ role: "user", text });
    saveHistory(history);
    render(history);
    bind();

    const sendBtn = document.getElementById("kai-chat-send");
    if (sendBtn) sendBtn.disabled = true;

    try {
      const res = await KAI.authFetch("/api/kai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, recentHistory: history.slice(-HISTORY_LIMIT) }),
      });
      history = loadHistory();
      history.push({ role: "assistant", text: res && res.reply ? res.reply : "…" });
      saveHistory(history);
      render(history);
      bind();
    } catch (err) {
      KAI.handleViewError(err, "kai");
    }
  }
}

KAI.ensureLoggedIn(loadKai);
