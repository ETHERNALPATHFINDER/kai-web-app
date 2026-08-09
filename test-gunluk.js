// Scenario tests for lib/gunlukEngine.js. Not a formal test framework — just asserts
// against fixed fixtures so the 10 requested scenarios have a documented, reproducible
// result. Run with: node test-gunluk.js
const assert = require("assert");
const { buildGunlukViewModel } = require("./lib/gunlukEngine");
const { istanbulTodayUTCDate } = require("./lib/mdUtils");
// escapeHtml's single canonical implementation now lives in public/app.js (the UI layer) —
// see lib/mdUtils.js's note on why the server-side engines never need to escape anything.
const { escapeHtml } = require("./public/app.js");

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

const TASK_HEADER = `| ID | Başlık | Alan | Öncelik | Durum | Planlanan Tarih | Planlanan Saat | Erteleme Sayısı | Tamamlanma Tarihi | Not |
|---|---|---|---|---|---|---|---|---|---|`;

function md({ taskRows = [], openLoops = "", routines = "", asOfDate }) {
  return `# Görevler

## Görevler

${TASK_HEADER}
${taskRows.join("\n")}

## Sonuç Bekleyenler

${openLoops}

## Rutinler

${routines}

## Günlük Tamamlanma

| Tarih | Planlanan | Tamamlanan | Oran |
|---|---:|---:|---:|
`;
}

// Fixed reference instant: 2026-08-10 10:00 UTC = 13:00 Istanbul (mid-day, no edge effects).
const ASOF = new Date("2026-08-10T10:00:00Z");
const TODAY = "2026-08-10";
const YESTERDAY = "2026-08-09";
const TOMORROW = "2026-08-11";

// --- 1. Hiç görev yok ---
{
  const vm = buildGunlukViewModel(md({ taskRows: [] }), ASOF);
  check("1. Hiç görev yok -> bugün/yaklaşan/ertelenen boş", vm.bugun.length === 0 && vm.yaklasanlar.length === 0 && vm.ertelenenler.length === 0 && vm.bugunOzet.planlanan === 0);
}

// --- 2. Bugün için tek görev ---
{
  const rows = [`| 001 | Tek Görev | Otel | Yüksek | Bekliyor | ${TODAY} | — | 0 | — | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  check("2. Bugün için tek görev -> bugün listesinde 1, planlanan=1", vm.bugun.length === 1 && vm.bugun[0].baslik === "Tek Görev" && vm.bugunOzet.planlanan === 1);
}

// --- 3. Tarihsiz görev ---
{
  const rows = [`| 001 | Tarihsiz İş | Otel | Orta | Bekliyor | — | — | 0 | — | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  check(
    "3. Tarihsiz görev -> Bugün'e girmiyor, Tarihi Belirsiz'e giriyor",
    vm.bugun.length === 0 && vm.belirsizTarih.length === 1 && vm.belirsizTarih[0].baslik === "Tarihsiz İş"
  );
}

// --- 4. Geçmiş tarihli açık görev ---
{
  const rows = [`| 001 | Eski İş | Otel | Yüksek | Bekliyor | ${YESTERDAY} | — | 0 | — | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  check(
    "4. Geçmiş tarihli açık görev -> ertelenenler'de, gecikmeGun=1",
    vm.ertelenenler.length === 1 && vm.ertelenenler[0].gecikmeGun === 1
  );
}

// --- 5. Gelecek tarihli görev ---
{
  const rows = [
    `| 001 | Uzak İş | Otel | Orta | Bekliyor | 2026-08-20 | — | 0 | — | — |`,
    `| 002 | Yakın İş | Otel | Orta | Bekliyor | ${TOMORROW} | 09:00 | 0 | — | — |`,
  ];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  check(
    "5. Gelecek tarihli görevler -> yaklaşanlar'da, en yakın tarih önce sıralı",
    vm.yaklasanlar.length === 2 && vm.yaklasanlar[0].baslik === "Yakın İş" && vm.yaklasanlar[1].baslik === "Uzak İş"
  );
}

// --- 6. Tamamlanmış görev ---
{
  const rows = [`| 001 | Bitti | Otel | Yüksek | Tamamlandı | ${TODAY} | — | 0 | ${TODAY} | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  check(
    "6. Tamamlanmış görev -> bugün listesinde YOK (Tamamlandı hariç tutulur), ozet 1/1",
    vm.bugun.length === 0 && vm.bugunOzet.planlanan === 1 && vm.bugunOzet.tamamlanan === 1
  );
}

// --- 7. Sonuç bekleyen görev ---
{
  const rows = [`| 001 | Motor Tamiri | Kişisel | Yüksek | Sonuç Bekleniyor | ${TODAY} | — | 0 | — | Ustada |`];
  const openLoops = `### 001 — Motor Tamiri
- Bekleyen Bilgi: Ücret ne kadar?
- Not: Ustada.
`;
  const vm = buildGunlukViewModel(md({ taskRows: rows, openLoops }), ASOF);
  check(
    "7. Sonuç bekleyen görev -> bugün'de durum rozetiyle görünür, Sonuç Bekleyenler'de 1 kayıt (dup yok)",
    vm.bugun.length === 1 && vm.bugun[0].durum === "Sonuç Bekleniyor" && vm.sonucBekleyenler.length === 1
  );
}

// --- 7b. Aynı başlık iki kez Sonuç Bekleyenler'de -> dedupe ---
{
  const openLoops = `### 001 — Motor Tamiri
- Bekleyen Bilgi: Ücret ne kadar?

### 001 — Motor Tamiri
- Bekleyen Bilgi: Ücret ne kadar? (kopya)
`;
  const vm = buildGunlukViewModel(md({ taskRows: [], openLoops }), ASOF);
  check("7b. Sonuç Bekleyenler'de yinelenen başlık tekilleştiriliyor", vm.sonucBekleyenler.length === 1);
}

// --- 8. Boş rutin listesi ---
{
  const vm = buildGunlukViewModel(md({ taskRows: [], routines: "" }), ASOF);
  check("8. Boş rutin listesi -> routines = []", vm.routines.length === 0);
}

// --- 9. Türkçe karakterli görev başlığı (+ HTML-özel karakterler) ---
{
  const rows = [`| 001 | Öğle Yemeği & <Fiyat> Görüşmesi İçin Şişli'ye Gitmeliyim | Otel | Orta | Bekliyor | ${TODAY} | — | 0 | — | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), ASOF);
  const raw = vm.bugun[0] && vm.bugun[0].baslik;
  check("9a. Türkçe karakterler parser'da bozulmadan korunuyor", raw === "Öğle Yemeği & <Fiyat> Görüşmesi İçin Şişli'ye Gitmeliyim", raw);
  const escaped = escapeHtml(raw);
  check(
    "9b. escapeHtml <, & karakterlerini kaçırıyor (XSS/render kırılması engellenir)",
    escaped.includes("&lt;Fiyat&gt;") && escaped.includes("Yemeği &amp;") && escaped.includes("Şişli")
  );
}

// --- 10. İstanbul saat diliminde gün sınırı ---
{
  // 2026-08-06 23:59 Istanbul (UTC+3) = 2026-08-06 20:59 UTC -> Istanbul calendar day is still 08-06.
  const beforeMidnight = istanbulTodayUTCDate(new Date("2026-08-06T20:59:00Z"));
  check(
    "10a. 20:59 UTC (23:59 İstanbul) hâlâ 06.08 -> gün henüz değişmedi",
    beforeMidnight.toISOString().slice(0, 10) === "2026-08-06"
  );

  // 2026-08-07 00:01 Istanbul = 2026-08-06 21:01 UTC -> Istanbul calendar day already 08-07.
  const afterMidnight = istanbulTodayUTCDate(new Date("2026-08-06T21:01:00Z"));
  check(
    "10b. 21:01 UTC (00:01 İstanbul) zaten 07.08 -> gün değişti (UTC gün sınırından 3 saat önce)",
    afterMidnight.toISOString().slice(0, 10) === "2026-08-07"
  );

  // End-to-end: a task planned for 08-07 should already show as "today" at 21:05 UTC
  // (00:05 Istanbul on the 7th) even though the UTC calendar date is still the 6th.
  const rows = [`| 001 | Gece Yarısı Testi | Otel | Orta | Bekliyor | 2026-08-07 | — | 0 | — | — |`];
  const vm = buildGunlukViewModel(md({ taskRows: rows }), new Date("2026-08-06T21:05:00Z"));
  check(
    "10c. UTC gün sınırından önce ama İstanbul gün sınırından sonra -> görev 'Bugün'e düşer, 'Yaklaşanlar'a değil",
    vm.bugun.length === 1 && vm.yaklasanlar.length === 0
  );
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
process.exit(fail ? 1 : 0);
