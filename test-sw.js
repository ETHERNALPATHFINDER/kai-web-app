// Regression tests for public/sw.js's fetch strategy: network-first + cache fallback for
// the static app shell, network-only (never cached) for /api/*. No external dependency —
// a small in-memory Service Worker API stub (self/caches/fetch), same "zero dependency"
// approach as the other test-*.js files. Run with: node test-sw.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

function makeCachesStub() {
  const stores = new Map(); // cacheName -> Map(url -> response)
  return {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (urls) => {
          for (const u of urls) store.set(u, { _from: "install-cache", url: u });
        },
        put: async (request, response) => {
          store.set(typeof request === "string" ? request : request.url, response);
        },
        match: async (request) => store.get(typeof request === "string" ? request : request.url),
      };
    },
    match: async (request) => {
      const url = typeof request === "string" ? request : request.url;
      for (const store of stores.values()) {
        if (store.has(url)) return store.get(url);
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
}

function loadSW(fetchImpl) {
  const listeners = {};
  const sandbox = {
    console,
    URL, // sw.js "new URL(event.request.url)" kullanıyor — Node global'i sandbox'a taşınmalı
    self: {
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: makeCachesStub(),
    fetch: fetchImpl,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8"), sandbox, { filename: "sw.js" });
  return { listeners, sandbox };
}

function fakeFetchEvent(url) {
  const ev = {
    request: { url, clone() { return this; } },
    result: null,
    respondWith(promise) {
      ev.result = Promise.resolve(promise);
    },
  };
  return ev;
}

(async () => {
  // --- 1) Online: ağdaki güncel dosya, eski cache'teki değil, tercih ediliyor ---
  {
    const { listeners, sandbox } = loadSW(async () => ({ ok: true, status: 200, _from: "network-v2", clone() { return this; } }));
    const cache = await sandbox.caches.open("kai-shell-v1");
    await cache.put({ url: "https://x/finans.js" }, { _from: "stale-cache-v1" }); // önceki deploy'dan kalan eski sürüm

    const event = fakeFetchEvent("https://x/finans.js");
    listeners.fetch(event);
    const res = await event.result;
    check("Online durumda ağdaki güncel dosya tercih ediliyor (eski cache değil)", res._from === "network-v2");
  }

  // --- 2) Başarılı network cevabı cache'i güncelliyor ---
  {
    const { listeners, sandbox } = loadSW(async () => ({ ok: true, status: 200, _from: "network-fresh", clone() { return { ...this }; } }));
    const event = fakeFetchEvent("https://x/app.js");
    listeners.fetch(event);
    await event.result;
    const cached = await sandbox.caches.match({ url: "https://x/app.js" });
    check("Başarılı network cevabı cache'e yazılıyor (offline fallback için güncelleniyor)", !!cached && cached._from === "network-fresh");
  }

  // --- 3) Network başarısız olduğunda cache fallback çalışıyor ---
  {
    const { listeners, sandbox } = loadSW(async () => {
      throw new Error("offline / network error");
    });
    const cache = await sandbox.caches.open("kai-shell-v1");
    await cache.put({ url: "https://x/gunluk.js" }, { _from: "cached-fallback" });

    const event = fakeFetchEvent("https://x/gunluk.js");
    listeners.fetch(event);
    const res = await event.result;
    check("Network başarısız olunca cache fallback devreye giriyor, hata fırlatılmıyor", !!res && res._from === "cached-fallback");
  }

  // --- 4) /api/* hiç cache'e alınmıyor, SW araya girmiyor (network-only korunuyor) ---
  {
    const { listeners, sandbox } = loadSW(async () => ({ ok: true, status: 200, clone() { return this; } }));
    const event = fakeFetchEvent("https://x/api/finans");
    listeners.fetch(event);
    check("/api/* isteğinde respondWith hiç çağrılmıyor (SW müdahale etmiyor, tarayıcı varsayılanı çalışır)", event.result === null);
    const cachedApi = await sandbox.caches.match({ url: "https://x/api/finans" });
    check("/api/* asla cache'e yazılmıyor", cachedApi === undefined);
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  process.exit(fail ? 1 : 0);
})();
