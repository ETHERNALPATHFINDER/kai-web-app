// Ports Görevler.md's simplified logic (no scoring/streaks — see "## Kurallar") into code:
// Bugün / Tarihi Belirsiz / Yaklaşanlar / Ertelenenler (dünden kalan, kapatılmamış) /
// Sonuç Bekleyenler / Rutinler / Günlük Tamamlanma (tamamlanan/planlanan oranı, no weighting).
//
// Day boundary is always computed in Europe/Istanbul time (see istanbulTodayUTCDate in
// mdUtils.js) — the server this runs on may be in a different timezone/UTC, and comparing
// against raw server-UTC "today" would shift the day boundary by a few hours and
// misclassify tasks near midnight.

const {
  splitSections,
  splitSubsections,
  parseKeyValueLines,
  parseFirstTable,
  parseISODate,
  istanbulTodayUTCDate,
} = require("./mdUtils");

function parseTasks(section) {
  return parseFirstTable(section["Görevler"] || []).map((r) => ({
    id: r["ID"],
    baslik: r["Başlık"],
    alan: r["Alan"],
    oncelik: r["Öncelik"],
    durum: r["Durum"],
    planlananTarih: r["Planlanan Tarih"],
    planlananSaat: r["Planlanan Saat"],
    ertelemeSayisi: r["Erteleme Sayısı"],
    tamamlanmaTarihi: r["Tamamlanma Tarihi"],
    not: r["Not"],
  }));
}

function parseOpenLoops(section) {
  const blocks = splitSubsections(section["Sonuç Bekleyenler"] || []).map((b) => {
    const kv = parseKeyValueLines(b.lines);
    return {
      title: b.title,
      bekleyenBilgi: kv["Bekleyen Bilgi"] || null,
      not: kv["Not"] || null,
    };
  });
  // Guard against the same open loop being listed twice under an identical heading
  // (e.g. a copy/paste mistake while editing Görevler.md by hand).
  const seen = new Set();
  return blocks.filter((b) => {
    const key = b.title.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseRoutines(section) {
  return splitSubsections(section["Rutinler"] || []).map((b) => {
    const kv = parseKeyValueLines(b.lines);
    return { name: b.title, bugun: kv["Bugün"] || "Veri eksik", seri: kv["Seri"] || "Veri eksik" };
  });
}

function parseCompletionLog(section) {
  return parseFirstTable(section["Günlük Tamamlanma"] || []).map((r) => ({
    tarih: r["Tarih"],
    planlanan: r["Planlanan"],
    tamamlanan: r["Tamamlanan"],
    oran: r["Oran"],
  }));
}

function sameUTCDate(a, b) {
  return a && b && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function daysBetweenUTCDates(earlier, later) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

// "HH:MM" (or missing) -> sortable minute-of-day, undated/untimed sorts after timed entries.
function timeSortKey(saat) {
  if (!saat) return 24 * 60 + 1;
  const m = String(saat).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 24 * 60 + 1;
  return (+m[1]) * 60 + (+m[2]);
}

function buildGunlukViewModel(markdown, asOf = new Date()) {
  const section = splitSections(markdown);
  const tasks = parseTasks(section);
  const openLoops = parseOpenLoops(section);
  const routines = parseRoutines(section);
  const completionLog = parseCompletionLog(section);

  const today = istanbulTodayUTCDate(asOf);
  const active = tasks.filter((t) => t.durum !== "Tamamlandı" && t.durum !== "İptal Edildi" && t.durum !== "Sonuç Bekleniyor");
  const waitingResult = tasks.filter((t) => t.durum === "Sonuç Bekleniyor");

  const bugun = [];
  const belirsizTarih = []; // no planlanan tarih at all — NOT assumed to be "today"
  const yaklasanlar = [];
  const ertelenenler = []; // planlanan tarih < today, still open

  for (const t of [...active, ...waitingResult]) {
    const d = parseISODate(t.planlananTarih);
    if (!d) {
      belirsizTarih.push(t);
      continue;
    }
    if (sameUTCDate(d, today)) bugun.push(t);
    else if (d < today) ertelenenler.push({ ...t, gecikmeGun: daysBetweenUTCDates(d, today) });
    else yaklasanlar.push(t);
  }

  yaklasanlar.sort((a, b) => {
    const da = parseISODate(a.planlananTarih);
    const db = parseISODate(b.planlananTarih);
    if (da.getTime() !== db.getTime()) return da - db;
    return timeSortKey(a.planlananSaat) - timeSortKey(b.planlananSaat);
  });
  ertelenenler.sort((a, b) => b.gecikmeGun - a.gecikmeGun); // most overdue first

  // "Bugün planlanan X görevden Y'si tamamlandı" — denominator is only tasks whose
  // planlananTarih is today (any status except İptal Edildi); numerator is the subset
  // of those already Tamamlandı. Tasks without a date, or planned for another day, never
  // count here even if they happen to get completed today.
  const planlananBugunTumu = tasks.filter((t) => {
    if (!t.planlananTarih || t.durum === "İptal Edildi") return false;
    const d = parseISODate(t.planlananTarih);
    return d && sameUTCDate(d, today);
  });
  const tamamlananSayisi = planlananBugunTumu.filter((t) => t.durum === "Tamamlandı").length;

  return {
    generatedAt: new Date().toISOString(),
    bugun,
    belirsizTarih,
    yaklasanlar,
    ertelenenler,
    sonucBekleyenler: openLoops,
    routines,
    completionLog,
    bugunOzet: {
      planlanan: planlananBugunTumu.length,
      tamamlanan: tamamlananSayisi,
    },
  };
}

module.exports = { buildGunlukViewModel };
