// Ports the "## Hesaplama Kuralları" rules from Finans.md into code, so the web app
// computes the exact same numbers KAI computes by hand in chat.
//
// Rules encoded here (mirrors Finans.md verbatim):
// 1. Hesap bakiyesi = açılış bakiyesi + gelir − gider ± transfer (per account, per currency).
// 2. Kalan borç = başlangıç − doğrulanmış borç ödemeleri (Yön = "Borç Ödemesi").
// 3. Hedef ilerlemesi = bağlı hesap bakiyesi / hedef tutarı (or bağlı borç ödenen tutar).
// 4. Farklı para birimleri ASLA birleştirilmez — her zaman ayrı gösterilir.
// 5. Bu Ay Gelir/Gider yalnızca Yön = Gelir/Gider satırlarından hesaplanır. Transfer Çıkış/
//    Giriş (hesaplar arası transfer, verilen borç, masraf iadesi) sayılmaz.

const {
  splitSections,
  splitSubsections,
  parseKeyValueLines,
  parseFirstTable,
  parseTLNumber,
  parseISODate,
  istanbulTodayUTCDate,
} = require("./mdUtils");

function parseAccounts(section) {
  const blocks = splitSubsections(section["Hesaplar"] || []);
  return blocks
    .filter((b) => b.title !== "Varsayılan Hesaplar")
    .map((b) => {
      const kv = parseKeyValueLines(b.lines);
      const balances = {};
      for (const [key, val] of Object.entries(kv)) {
        const m = key.match(/^Açılış bakiyesi(?:\s*\(([A-Z]{3})\))?$/i);
        if (m) {
          const currency = m[1] || ((kv["Para birimi"] || "TRY").match(/[A-Z]{3}/) || ["TRY"])[0];
          const amt = parseTLNumber(val);
          if (amt != null) balances[currency] = (balances[currency] || 0) + amt;
        }
      }
      // Fallback: single-currency accounts store "Para birimi: TRY" + one "Açılış bakiyesi: X"
      if (Object.keys(balances).length === 0 && kv["Açılış bakiyesi"] != null) {
        const cur = (kv["Para birimi"] || "TRY").match(/[A-Z]{3}/);
        balances[cur ? cur[0] : "TRY"] = parseTLNumber(kv["Açılış bakiyesi"]) || 0;
      }
      return {
        name: b.title,
        // İşlem Geçmişi's "Hesap" column uses the short name (e.g. "Ana Hesap"), while the
        // heading here may carry a parenthetical suffix (e.g. "Ana Hesap (Banka/Kart)").
        matchName: b.title.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        tur: kv["Tür"] || "",
        paraBirimi: kv["Para birimi"] || "",
        multi: /çoklu/i.test(kv["Para birimi"] || ""),
        acilisBakiyeleri: balances,
        acilisTarihi: kv["Açılış tarihi"] || null,
        durum: kv["Durum"] || "Aktif",
      };
    });
}

function parseTransactions(section) {
  const rows = parseFirstTable(section["İşlem Geçmişi"] || []);
  return rows
    .map((r) => ({
      id: r["İşlem ID"],
      tarih: r["Tarih"],
      yon: r["Yön"],
      tutar: parseTLNumber(r["Tutar"]) || 0,
      paraBirimi: (r["Para Birimi"] || "TRY").trim(),
      kategori: r["Kategori"] || "",
      altKategori: r["Alt Kategori"] || "",
      hesap: (r["Hesap"] || "").trim(),
      odemeYontemi: r["Ödeme Yöntemi"] || "",
      baglanti: r["Bağlantı"] || "",
      not: r["Not"] || "",
    }))
    .filter((t) => t.id);
}

function parseDebts(section) {
  return splitSubsections(section["Borçlar"] || []).map((b) => {
    const kv = parseKeyValueLines(b.lines);
    return {
      name: b.title,
      tur: kv["Tür"] || "",
      alacakli: kv["Alacaklı"] || "",
      baslangicTutari: parseTLNumber(kv["Başlangıç tutarı"]),
      paraBirimi: (kv["Para birimi"] || "TRY").trim(),
      baslangicTarihi: kv["Başlangıç tarihi"] || null,
      vadeTarihi: kv["Vade tarihi"] || null,
      planlananAylikOdeme: kv["Planlanan aylık ödeme"] || null,
      oncelik: kv["Öncelik"] || "",
      durum: kv["Durum"] || "Aktif",
    };
  });
}

function parseReceivables(section) {
  return splitSubsections(section["Alacaklar"] || []).map((b) => {
    const kv = parseKeyValueLines(b.lines);
    const amounts = [];
    for (const [key, val] of Object.entries(kv)) {
      const m = key.match(/^Tutar(?:\s*\(([A-Z]{3})\))?$/i);
      if (m) {
        const amt = parseTLNumber(val);
        const curFromVal = String(val).match(/[A-Z]{3}/);
        const currency = m[1] || (curFromVal ? curFromVal[0] : "TRY");
        if (amt != null) amounts.push({ tutar: amt, paraBirimi: currency });
      }
    }
    const durum = kv["Durum"] || "Aktif";
    return {
      name: b.title,
      yakinlik: kv["Yakınlık"] || "",
      tutarlar: amounts,
      odemeTarihi: kv["Ödeme tarihi"] || null,
      durum,
      kapandi: /kapand/i.test(durum),
      not: kv["Not"] || "",
    };
  });
}

function parseGoals(section) {
  return splitSubsections(section["Finansal Hedefler"] || []).map((b) => {
    const kv = parseKeyValueLines(b.lines);
    return {
      name: b.title,
      oncelik: kv["Öncelik"] || "",
      hedefTutar: parseTLNumber(kv["Hedef tutar"]),
      hedefTutarRaw: kv["Hedef tutar"] || "",
      paraBirimi: (kv["Para birimi"] || "").replace(/[^A-Z]/g, "") || null,
      hedefTarih: kv["Hedef tarih"] || kv["Seyahat tarihi"] || null,
      bagliHesap: kv["Bağlı hesap"] || null,
      bagliBorc: kv["Bağlı borç"] || null,
      durum: kv["Durum"] || "Aktif",
    };
  });
}

function parseSubscriptions(section) {
  return parseFirstTable(section["Abonelikler ve Düzenli Ödemeler"] || []).map((r) => ({
    ad: r["Ad"],
    tutar: parseTLNumber(r["Tutar"]),
    paraBirimi: r["Para Birimi"],
    periyot: r["Periyot"],
    siradakiOdeme: r["Sıradaki Ödeme"],
    hesap: r["Hesap"],
    kategori: r["Kategori"],
    durum: r["Durum"],
  }));
}

function computeAccountBalances(accounts, transactions) {
  return accounts.map((acc) => {
    const balances = { ...acc.acilisBakiyeleri };
    let lastTx = null;
    for (const t of transactions) {
      if (t.hesap !== acc.name && t.hesap !== acc.matchName) continue;
      const cur = t.paraBirimi || "TRY";
      if (!(cur in balances)) balances[cur] = 0;
      if (t.yon === "Gelir" || t.yon === "Transfer Giriş") balances[cur] += t.tutar;
      else if (t.yon === "Gider" || t.yon === "Transfer Çıkış") balances[cur] -= t.tutar;
      const d = parseISODate(t.tarih);
      if (d && (!lastTx || d > lastTx)) lastTx = d;
    }
    // JSON üzerinden /api/finans'a giden ViewModel'de Date nesnesi bırakılmaz — res.json()
    // zaten Date'i örtük olarak ISO string'e çevirir, burada da aynı sözleşmeyi baştan
    // sağlarsak yerel (Node içi) kullanım ile HTTP üzerinden gelen veri arasında tip farkı
    // oluşmaz (bkz. public/finans.js'te bu alanı tüketen kod).
    return { ...acc, bakiyeler: balances, sonIslemTarihi: lastTx ? lastTx.toISOString() : null };
  });
}

function computeDebtRemaining(debts, transactions) {
  return debts.map((d) => {
    const paid = transactions
      .filter((t) => t.yon === "Borç Ödemesi" && t.baglanti && t.baglanti.includes(d.name))
      .reduce((s, t) => s + t.tutar, 0);
    const kalan = d.baslangicTutari != null ? d.baslangicTutari - paid : null;
    const oran = d.baslangicTutari ? Math.round((paid / d.baslangicTutari) * 100) : 0;
    return { ...d, odenenTutar: paid, kalanTutar: kalan, odenenOran: oran };
  });
}

// "Bu Ay" = the calendar month of `asOf` (server's current date by default).
function computeMonthlyFlow(transactions, asOf = new Date()) {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const inMonth = (t) => {
    const d = parseISODate(t.tarih);
    return d && d.getUTCFullYear() === y && d.getUTCMonth() === m;
  };
  const byCurrency = {};
  let gelirTRY = 0;
  let giderTRY = 0;
  for (const t of transactions.filter(inMonth)) {
    if (t.yon !== "Gelir" && t.yon !== "Gider") continue; // transfers/alacak/iade excluded per rule
    const cur = t.paraBirimi || "TRY";
    byCurrency[cur] = byCurrency[cur] || { gelir: 0, gider: 0 };
    if (t.yon === "Gelir") {
      byCurrency[cur].gelir += t.tutar;
      if (cur === "TRY") gelirTRY += t.tutar;
    } else {
      byCurrency[cur].gider += t.tutar;
      if (cur === "TRY") giderTRY += t.tutar;
    }
  }
  return { gelirTRY, giderTRY, netTRY: gelirTRY - giderTRY, byCurrency };
}

function computeGoalProgress(goals, accountBalances, debts) {
  return goals.map((g) => {
    if (g.bagliBorc) {
      const debt = debts.find((d) => d.name === g.bagliBorc);
      if (debt && debt.baslangicTutari) {
        const pct = Math.max(0, Math.min(100, Math.round((debt.odenenTutar / debt.baslangicTutari) * 100)));
        return { ...g, ilerlemeYuzde: pct, mevcutTutar: debt.odenenTutar, hedefGosterim: debt.baslangicTutari };
      }
    }
    if (g.bagliHesap && g.hedefTutar) {
      const acc = accountBalances.find((a) => a.name === g.bagliHesap || a.matchName === g.bagliHesap);
      const cur = g.paraBirimi || "TRY";
      const mevcut = acc ? acc.bakiyeler[cur] || 0 : 0;
      const pct = Math.max(0, Math.min(100, Math.round((mevcut / g.hedefTutar) * 100)));
      return { ...g, ilerlemeYuzde: pct, mevcutTutar: mevcut, hedefGosterim: g.hedefTutar };
    }
    return { ...g, ilerlemeYuzde: null, mevcutTutar: null, hedefGosterim: g.hedefTutar };
  });
}

function computeTotalAssets(accountBalances) {
  const totals = {};
  for (const acc of accountBalances) {
    for (const [cur, amt] of Object.entries(acc.bakiyeler)) {
      totals[cur] = (totals[cur] || 0) + amt;
    }
  }
  return totals;
}

// Only genuine, actionable issues — never a nag about a field the user consciously chose
// to leave open (e.g. "hedef tutarı henüz belirlenmedi", "aylık ödeme planı yok"). Those
// are deliberate decisions, not data problems, and are surfaced elsewhere (Finansal
// Hedefler's "Henüz belirlenmemiş hedefler" line) without warning styling.
function buildWarnings({ debts, transactions, accounts, asOf }) {
  const warnings = [];
  const today = istanbulTodayUTCDate(asOf);

  // Vadesi geçmiş borç — gerçekten aksiyon gerektiren durum.
  for (const d of debts) {
    if (!d.vadeTarihi) continue;
    const vade = parseISODate(d.vadeTarihi);
    if (vade && vade < today && d.kalanTutar > 0) {
      warnings.push(`${d.name}'nun vadesi geçti (${d.vadeTarihi}) — hâlâ ${d.kalanTutar} ${d.paraBirimi} kalan borç var`);
    }
  }

  // Çelişkili kayıt — İşlem Geçmişi'nde Hesaplar bölümünde karşılığı olmayan bir hesap adı.
  const knownNames = new Set();
  for (const a of accounts) {
    knownNames.add(a.name);
    knownNames.add(a.matchName);
  }
  const unknownAccountIds = transactions.filter((t) => t.hesap && !knownNames.has(t.hesap)).map((t) => t.id);
  if (unknownAccountIds.length) {
    warnings.push(`Tanımsız hesaba referans veren işlem(ler) var (İşlem ${unknownAccountIds.join(", ")}) — Hesaplar bölümünde eşleşme bulunamadı`);
  }

  return warnings;
}

function buildFinansViewModel(markdown, asOf = new Date()) {
  const section = splitSections(markdown);
  const accounts = parseAccounts(section);
  const transactions = parseTransactions(section);
  const debtsRaw = parseDebts(section);
  const receivables = parseReceivables(section).filter((r) => !r.kapandi);
  const goalsRaw = parseGoals(section);
  const subscriptions = parseSubscriptions(section);

  const accountBalances = computeAccountBalances(accounts, transactions);
  const debts = computeDebtRemaining(debtsRaw, transactions);
  const monthlyFlow = computeMonthlyFlow(transactions, asOf);
  const goalsComputed = computeGoalProgress(goalsRaw, accountBalances, debts);
  // Goals with a real, measurable target become cards; goals whose amount is still
  // consciously undecided collapse into one plain (non-warning) line instead of N empty cards.
  // Based on the parsed number (hedefTutar), not the raw text — Finans.md phrases "not
  // decided yet" multiple ways ("Veri eksik", "Açık bırakıldı", ...) and free text can
  // contain misleading digits (dates), so the already-parsed value is the reliable signal.
  const goals = goalsComputed.filter((g) => g.hedefTutar != null);
  const goalsMissingNames = goalsComputed.filter((g) => g.hedefTutar == null).map((g) => g.name);
  const totalAssets = computeTotalAssets(accountBalances);
  const warnings = buildWarnings({ debts, transactions, accounts: accountBalances, asOf });

  const anaHesap = accountBalances.find((a) => a.name.startsWith("Ana Hesap"));
  const nakit = accountBalances.find((a) => a.name === "Nakit");
  const kullanilabilirBakiye =
    (anaHesap ? anaHesap.bakiyeler["TRY"] || 0 : 0) + (nakit ? nakit.bakiyeler["TRY"] || 0 : 0);

  const sonIslemler = [...transactions]
    .sort((a, b) => {
      const da = parseISODate(a.tarih);
      const db = parseISODate(b.tarih);
      if (da && db && da.getTime() !== db.getTime()) return db - da;
      return (b.id || "").localeCompare(a.id || "");
    })
    .slice(0, 10);

  const upcoming = [
    ...subscriptions.map((s) => ({
      ad: s.ad,
      tutar: s.tutar,
      paraBirimi: s.paraBirimi,
      tarih: s.siradakiOdeme,
      tur: "Abonelik",
    })),
    ...debts
      .filter((d) => d.vadeTarihi)
      .map((d) => ({
        ad: `${d.name} — Vade`,
        tutar: d.kalanTutar,
        paraBirimi: d.paraBirimi,
        tarih: d.vadeTarihi,
        tur: "Borç",
      })),
  ].sort((a, b) => (parseISODate(a.tarih) || 0) - (parseISODate(b.tarih) || 0));

  return {
    generatedAt: new Date().toISOString(),
    accounts: accountBalances,
    kullanilabilirBakiye,
    totalAssets,
    monthlyFlow,
    debts,
    receivables,
    goals,
    goalsMissingNames,
    subscriptions,
    upcoming,
    sonIslemler,
    warnings,
  };
}

module.exports = { buildFinansViewModel };
