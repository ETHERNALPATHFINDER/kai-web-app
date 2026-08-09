// Scenario tests for lib/finansEngine.js — covers the simplification pass:
// Son İşlemler capped at 10, Finansal Hedefler split into real-data vs. missing,
// Veri Uyarıları limited to genuine issues. Run with: node test-finans.js
const { buildFinansViewModel } = require("./lib/finansEngine");

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

const HESAPLAR = `### Ana Hesap
- Tür: Banka
- Para birimi: TRY
- Açılış bakiyesi: 1.000 TRY
- Açılış tarihi: 2026-01-01
- Durum: Aktif
`;

function txRows(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const id = String(i).padStart(3, "0");
    rows.push(`| ${id} | 2026-08-0${(i % 9) + 1} | Gider | 10 | TRY | Test | Test | Ana Hesap | Kart | — | — |`);
  }
  return rows;
}

function md({ txCount = 0, debtBlock = "", goalsBlock = "", extraTxRows = [] }) {
  return `# Finans

## Hesaplar

${HESAPLAR}

## İşlem Geçmişi

| İşlem ID | Tarih | Yön | Tutar | Para Birimi | Kategori | Alt Kategori | Hesap | Ödeme Yöntemi | Bağlantı | Not |
|---|---|---|---:|---|---|---|---|---|---|---|
${[...txRows(txCount), ...extraTxRows].join("\n")}

## Borçlar

${debtBlock}

## Alacaklar

## Finansal Hedefler

${goalsBlock}

## Abonelikler ve Düzenli Ödemeler

| Ad | Tutar | Para Birimi | Periyot | Sıradaki Ödeme | Hesap | Kategori | Durum |
|---|---:|---|---|---|---|---|---|

## Hesaplama Kuralları
`;
}

const ASOF = new Date("2026-08-10T10:00:00Z");

// --- Son İşlemler cap ---
{
  const vm = buildFinansViewModel(md({ txCount: 15 }), ASOF);
  check("Son İşlemler 15 kayıttan yalnızca 10'unu gösteriyor", vm.sonIslemler.length === 10);
}
{
  const vm = buildFinansViewModel(md({ txCount: 3 }), ASOF);
  check("3 işlem varsa 3'ü de gösteriliyor (10'a tamamlanmıyor)", vm.sonIslemler.length === 3);
}

// --- Finansal Hedefler split ---
{
  const goalsBlock = `### Borç kapatma
- Öncelik: 1
- Hedef tutar: 10.000 TRY
- Para birimi: TRY
- Hedef tarih: 2026-12-01
- Bağlı hesap: Ana Hesap
- Durum: Aktif

### Belirsiz hedef A
- Öncelik: 2
- Hedef tutar: Veri eksik
- Para birimi: —
- Hedef tarih: Veri eksik
- Durum: Aktif

### Belirsiz hedef B
- Öncelik: 3
- Hedef tutar: Veri eksik
- Para birimi: —
- Hedef tarih: Veri eksik
- Durum: Aktif
`;
  const vm = buildFinansViewModel(md({ goalsBlock }), ASOF);
  check(
    "Gerçek tutarlı hedef 'goals' kartlarında, belirsizler 'goalsMissingNames' tek listede",
    vm.goals.length === 1 &&
      vm.goals[0].name === "Borç kapatma" &&
      vm.goalsMissingNames.length === 2 &&
      vm.goalsMissingNames.includes("Belirsiz hedef A") &&
      vm.goalsMissingNames.includes("Belirsiz hedef B")
  );
}

// --- Veri Uyarıları: bilinçli ertelenen alanlar artık uyarı üretmiyor ---
{
  const debtBlock = `### Test Borcu
- Tür: Kişisel
- Alacaklı: Biri
- Başlangıç tutarı: 5.000 TRY
- Para birimi: TRY
- Başlangıç tarihi: 2026-01-01
- Kalan tutar: 5.000 TRY
- Ödenen oran: %0
- Planlanan aylık ödeme: Veri eksik
- Öncelik: Orta
- Durum: Aktif
`;
  const goalsBlock = `### Belirsiz hedef
- Öncelik: 1
- Hedef tutar: Veri eksik
- Para birimi: —
- Hedef tarih: Veri eksik
- Durum: Aktif
`;
  const vm = buildFinansViewModel(md({ debtBlock, goalsBlock }), ASOF);
  check(
    "Bilinçli ertelenen alanlar (aylık ödeme eksik, hedef tutarı eksik) artık Veri Uyarıları'nda YOK",
    vm.warnings.length === 0
  );
}

// --- Veri Uyarıları: gerçek sorun (vadesi geçmiş borç) hâlâ üretiliyor ---
{
  const debtBlock = `### Vadesi Geçen Borç
- Tür: Kişisel
- Alacaklı: Biri
- Başlangıç tutarı: 1.000 TRY
- Para birimi: TRY
- Başlangıç tarihi: 2026-01-01
- Vade tarihi: 2026-08-01
- Kalan tutar: 1.000 TRY
- Ödenen oran: %0
- Öncelik: Yüksek
- Durum: Aktif
`;
  const vm = buildFinansViewModel(md({ debtBlock }), ASOF); // ASOF = 2026-08-10, vade 2026-08-01 geçti
  check(
    "Vadesi geçmiş, hâlâ kalan tutarı olan borç için uyarı ÜRETİLİYOR",
    vm.warnings.length === 1 && /vadesi geçti/i.test(vm.warnings[0])
  );
}

// --- Veri Uyarıları: tanımsız hesaba referans veren işlem ---
{
  const extraTxRows = [`| 099 | 2026-08-05 | Gider | 50 | TRY | Test | Test | Var Olmayan Hesap | Kart | — | — |`];
  const vm = buildFinansViewModel(md({ extraTxRows }), ASOF);
  check(
    "Tanımsız hesaba referans veren işlem 'çelişkili kayıt' uyarısı üretiyor",
    vm.warnings.some((w) => /Tanımsız hesaba/.test(w) && w.includes("099"))
  );
}

// --- Regresyon: gömülü tarih içeren "Açık bırakıldı" metni sahte hedef tutarı üretmemeli ---
// Gerçek vakada "Hedef tutar: Açık bırakıldı (bilinçli olarak, 2026-08-04)" satırı, eski
// parseTLNumber digit-stripping mantığıyla ".2026-08-04" gibi bir parça yakalayıp
// parseFloat(".2026-08-04") -> 0.2026 sahte sayısını üretiyordu. Bu test o regresyonu kilitler.
{
  const goalsBlock = `### Gelir çeşitlendirme
- Öncelik: Belirtilmedi
- Hedef tutar: Açık bırakıldı (bilinçli olarak, 2026-08-04)
- Para birimi: —
- Hedef tarih: Açık bırakıldı
- Durum: Aktif
`;
  const vm = buildFinansViewModel(md({ goalsBlock }), ASOF);
  check(
    "Gömülü '2026-08-04' tarihi sahte hedef tutarı (örn. 0.2026) üretmiyor — hedef 'goalsMissingNames'e düşüyor",
    vm.goals.length === 0 && vm.goalsMissingNames.length === 1 && vm.goalsMissingNames[0] === "Gelir çeşitlendirme"
  );
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
process.exit(fail ? 1 : 0);
