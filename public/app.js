// Shared helpers for both pages: login gate, fetch-with-key, Turkish number/date formatting,
// and shared UI chrome (top nav, error screen, "veri ne kadar taze" classification) — so
// finans.js and gunluk.js don't each keep their own copy of the same markup/logic.
// Storage note: this is a standalone hosted app (not a Cowork artifact), so localStorage
// is fine here — it just remembers the app key on this device so you don't retype it.

const KAI = (() => {
  const KEY_STORAGE = "kai_app_key";

  function getKey() {
    return localStorage.getItem(KEY_STORAGE) || "";
  }

  function setKey(k) {
    localStorage.setItem(KEY_STORAGE, k);
  }

  function clearKey() {
    localStorage.removeItem(KEY_STORAGE);
  }

  // `options` is optional and additive — existing GET call sites (finans.js/gunluk.js) that
  // only ever pass a url are completely unaffected; kai.js is the only caller that passes a
  // method/body to POST a chat message.
  async function authFetch(url, options = {}) {
    const headers = Object.assign({ "x-app-key": getKey() }, options.headers || {});
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      clearKey();
      throw new Error("__UNAUTHORIZED__");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `İstek başarısız (${res.status})`);
    }
    return res.json();
  }

  function fmtTRY(n, currency = "TRY") {
    if (n == null || Number.isNaN(n)) return "—";
    const formatted = Math.round(n).toLocaleString("tr-TR");
    return `${formatted} ${currency}`;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  // The single canonical HTML-escaping implementation for the whole project. Server-side
  // engines (lib/finansEngine.js, lib/gunlukEngine.js) never produce HTML — they return
  // plain ViewModel objects — so escaping only ever needs to happen once, here, at render
  // time in the UI layer. Both finans.js and gunluk.js call this via KAI.escapeHtml.
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (x) => String(x).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Top bar shared by all three pages — identical markup, only the active tab differs.
  function nav(active) {
    return `
    <div class="topnav">
      <div class="tabs">
        <a href="/kai.html" class="${active === "kai" ? "active" : ""}">KAI</a>
        <a href="/index.html" class="${active === "finans" ? "active" : ""}">Finans</a>
        <a href="/gunluk.html" class="${active === "gunluk" ? "active" : ""}">Günlük</a>
      </div>
      <button class="refresh-btn" onclick="location.reload()">Yenile</button>
    </div>
  `;
  }

  // Günlük Merkezi and the KAI chat both use the narrower "wrap narrow" container; Finans
  // Merkezi (wider cards/grids) uses "wrap".
  function pageWrapClass(active) {
    return active === "gunluk" || active === "kai" ? "wrap narrow" : "wrap";
  }

  // "Veri ne kadar taze?" — same classification used by both status bars.
  // Eşikler: 60 dakikaya kadar Güncel, 24 saate kadar bayat ("stale"), sonrası eski/hata ("error").
  function freshness(generatedAtISO, now = Date.now()) {
    const ageMin = (now - new Date(generatedAtISO).getTime()) / 60000;
    const dotClass = ageMin < 60 ? "" : ageMin < 24 * 60 ? "stale" : "error";
    const statusLabel = ageMin < 60 ? "Güncel" : ageMin < 24 * 60 ? "Bir süredir yenilenmedi" : "Eski veri";
    return { ageMin, dotClass, statusLabel };
  }

  // Pure markup builder (no DOM access) so it can be unit-tested directly.
  function renderErrorHtml(err, active) {
    const message = escapeHtml(err && err.message ? err.message : err);
    return `
    <div class="${pageWrapClass(active)}">
      ${nav(active)}
      <div class="card"><div class="empty">Bir hata oluştu: ${message}</div></div>
    </div>`;
  }

  function renderError(err, active) {
    document.getElementById("app").innerHTML = renderErrorHtml(err, active);
  }

  // Shared catch-clause behavior for both pages' initial data fetch: an expired/missing
  // key re-prompts for login, anything else renders the (escaped) error screen.
  function handleViewError(err, active) {
    if (String(err && err.message) === "__UNAUTHORIZED__") {
      ensureLoggedIn(() => location.reload());
    } else {
      renderError(err, active);
    }
  }

  function ensureLoggedIn(onReady) {
    const key = getKey();
    if (key) {
      onReady();
      return;
    }
    renderLoginScreen(onReady);
  }

  function renderLoginScreen(onSuccess) {
    // Renders into the existing #app container (not document.body) so #app is never
    // removed from the DOM — finans.js/gunluk.js's ensureLoggedIn callback does
    // document.getElementById("app").innerHTML = ... right after login, and that
    // element must still exist for it to run.
    const root = document.getElementById("app");
    root.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <h1>KAI</h1>
          <p>Devam etmek için erişim anahtarını gir.</p>
          <input id="kai-key-input" type="password" placeholder="Erişim anahtarı" autocomplete="off" />
          <button id="kai-key-submit">Giriş yap</button>
          <div class="login-error" id="kai-key-error"></div>
        </div>
      </div>
    `;
    const input = document.getElementById("kai-key-input");
    const submit = document.getElementById("kai-key-submit");
    const doSubmit = () => {
      const val = input.value.trim();
      if (!val) return;
      setKey(val);
      onSuccess(true);
    };
    submit.addEventListener("click", doSubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSubmit();
    });
    input.focus();
  }

  return {
    getKey,
    setKey,
    clearKey,
    authFetch,
    fmtTRY,
    fmtDate,
    fmtDateTime,
    escapeHtml,
    ensureLoggedIn,
    nav,
    pageWrapClass,
    freshness,
    renderError,
    renderErrorHtml,
    handleViewError,
  };
})();

// `typeof navigator !== "undefined"` guard (instead of a bare `"serviceWorker" in navigator`)
// is needed so this file can also be `require()`-d from Node test scripts without throwing —
// browsers always define `navigator`, so real-world behavior here is unchanged.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Browsers throttle automatic service worker update checks to roughly once every
        // 24 hours, so an already-installed user could stay on an old cached bundle for a
        // full day after a new deploy. update() forces a real check on every page load,
        // bypassing that throttle, without touching install/activate/fetch logic in sw.js.
        registration.update().catch(() => {});
      })
      .catch(() => {});

    // Once a new service worker takes control (after skipWaiting + clients.claim in
    // sw.js), reload the tab exactly once so the page picks up the freshly-fetched files
    // immediately instead of requiring a manual refresh. `reloaded` guards against a
    // reload loop if controllerchange were to fire more than once in the same page life.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

// Node-only export path, used by test-*.js to unit-test the shared helpers above directly.
// Browsers never define `module`, so this branch never runs there.
if (typeof module !== "undefined" && module.exports) {
  module.exports = KAI;
}
