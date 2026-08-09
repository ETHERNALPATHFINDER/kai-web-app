const esc = KAI.escapeHtml;

function renderFinans(vm) {
  const root = document.getElementById("app");
  const { dotClass, statusLabel } = KAI.freshness(vm.generatedAt);

  const anaHesap = vm.accounts.find((a) => a.name.startsWith("Ana Hesap"));
  const nakit = vm.accounts.find((a) => a.name === "Nakit");

  const currencyLine = (obj) =>
    Object.entries(obj)
      .filter(([, v]) => v)
      .map(([cur, v]) => `${KAI.fmtTRY(v, cur)}`)
      .join(" · ");

  root.innerHTML = `
    <div class="wrap">
      ${KAI.nav("finans")}
      <div class="title">KAI — Finans Merkezi</div>
      <div class="statusbar">
        <div class="status-left"><span class="dot ${dotClass}"></span><span class="status-label">${statusLabel}</span></div>
        <div class="status-meta">Son yenileme: ${KAI.fmtDateTime(vm.generatedAt)} · Kaynak: Alanlar/Finans.md (GitHub)</div>
      </div>

      <div class="section">
        <div class="section-title">Özet</div>
        <div class="grid grid-5">
          <div class="card">
            <div class="summary-label">Kullanılabilir Bakiye</div>
            <div class="summary-value">${KAI.fmtTRY(vm.kullanilabilirBakiye)}</div>
            <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:#9a9aa2;">
              <span>Enpara: ${KAI.fmtTRY(anaHesap ? anaHesap.bakiyeler.TRY || 0 : 0)}</span>
              <span>Nakit: ${KAI.fmtTRY(nakit ? nakit.bakiyeler.TRY || 0 : 0)}</span>
            </div>
            <div class="summary-sub">Günlük kullanılabilir toplam para</div>
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#7d7d85;">
              Toplam varlıklar: ${currencyLine(vm.totalAssets) || "—"}
            </div>
          </div>
          <div class="card">
            <div class="summary-label">Toplam Borç</div>
            <div class="summary-value">${vm.debts.map((d) => KAI.fmtTRY(d.kalanTutar, d.paraBirimi)).join(" + ") || "—"}</div>
            <div class="summary-sub">${vm.debts.length} açık borç · para birimleri toplanmadı</div>
          </div>
          <div class="card">
            <div class="summary-label">Bu Ay Gelir</div>
            <div class="summary-value">${KAI.fmtTRY(vm.monthlyFlow.gelirTRY)}</div>
            <div class="summary-sub">Yalnızca gerçek gelir satırları</div>
          </div>
          <div class="card">
            <div class="summary-label">Bu Ay Gider</div>
            <div class="summary-value">${KAI.fmtTRY(vm.monthlyFlow.giderTRY)}</div>
            <div class="summary-sub">Borç verilenler ve iade bekleyenler hariç</div>
          </div>
          <div class="card">
            <div class="summary-label">Net Nakit Akışı</div>
            <div class="summary-value">${vm.monthlyFlow.netTRY >= 0 ? "+" : ""}${KAI.fmtTRY(vm.monthlyFlow.netTRY)}</div>
            <div class="summary-sub">Gelir − Gider (bu ay)</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Hesaplar</div>
        <div class="grid grid-3">
          ${vm.accounts
            .map(
              (a) => `
            <div class="card">
              <div class="acc-name">${esc(a.name)}</div>
              <div class="acc-type">${esc(a.tur)}${a.durum ? " · " + esc(a.durum) : ""}</div>
              <div class="acc-row"><span class="k">Bakiye</span><span class="v">${currencyLine(a.bakiyeler) || "0"}</span></div>
              <div class="acc-row"><span class="k">Son işlem</span><span class="v ${a.sonIslemTarihi ? "" : "missing"}">${
                a.sonIslemTarihi ? KAI.fmtDate(a.sonIslemTarihi) : "İşlem kaydı yok"
              }</span></div>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Borçlar</div>
        <div class="grid grid-2">
          ${
            vm.debts.length
              ? vm.debts
                  .map(
                    (d) => `
            <div class="card">
              <div class="debt-name">${esc(d.name)}</div>
              <div class="debt-sub">${esc(d.tur)} · Alacaklı: ${esc(d.alacakli)}${d.oncelik ? " · Öncelik: " + esc(d.oncelik) : ""}</div>
              <div class="debt-amounts">
                <div><div class="lbl">Başlangıç</div><div class="big">${KAI.fmtTRY(d.baslangicTutari, d.paraBirimi)}</div></div>
                <div style="text-align:right"><div class="lbl">Kalan</div><div class="big">${KAI.fmtTRY(d.kalanTutar, d.paraBirimi)}</div></div>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${d.odenenOran}%"></div></div>
              <div class="goal-meta"><span>Ödenen: %${d.odenenOran}</span><span>Aylık ödeme: ${esc(d.planlananAylikOdeme || "Veri eksik")}</span></div>
            </div>`
                  )
                  .join("")
              : `<div class="card"><div class="empty">Açık borç yok.</div></div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Alacaklar <span style="text-transform:none;letter-spacing:0;color:#5f5f68;font-weight:400;">(sana borçlu olanlar)</span></div>
        <div class="grid grid-2">
          ${
            vm.receivables.length
              ? vm.receivables
                  .map(
                    (r) => `
            <div class="card">
              <div class="debt-name">${esc(r.name)}</div>
              <div class="debt-sub">${esc(r.yakinlik)}</div>
              <div class="debt-amounts">
                ${r.tutarlar.map((t) => `<div><div class="lbl">Alacak</div><div class="big">${KAI.fmtTRY(t.tutar, t.paraBirimi)}</div></div>`).join("")}
              </div>
              <div class="goal-meta"><span>Ödeme tarihi: ${esc(r.odemeTarihi || "Veri eksik")}</span><span>Durum: Aktif</span></div>
            </div>`
                  )
                  .join("")
              : `<div class="card"><div class="empty">Açık alacak yok.</div></div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Finansal Hedefler</div>
        ${
          vm.goals.length
            ? `<div class="grid grid-2">
                ${vm.goals
                  .map(
                    (g) => `
                  <div class="card">
                    <div class="goal-head">
                      <div class="goal-name">${esc(g.name)}</div>
                      <div class="badge">${g.oncelik ? "Öncelik " + esc(g.oncelik) : ""}</div>
                    </div>
                    ${
                      g.ilerlemeYuzde != null
                        ? `<div class="progress-track"><div class="progress-fill" style="width:${g.ilerlemeYuzde}%"></div></div>
                           <div class="goal-meta"><span>%${g.ilerlemeYuzde} (${KAI.fmtTRY(g.mevcutTutar, g.paraBirimi || "TRY")} / ${KAI.fmtTRY(
                            g.hedefGosterim,
                            g.paraBirimi || "TRY"
                          )})</span><span>${esc(g.hedefTarih || "")}</span></div>`
                        : `<div class="progress-track"></div><div class="goal-meta"><span>${g.hedefGosterim ? KAI.fmtTRY(g.hedefGosterim, g.paraBirimi || "TRY") : ""}</span><span>${esc(g.hedefTarih || "")}</span></div>`
                    }
                  </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          vm.goalsMissingNames && vm.goalsMissingNames.length
            ? `<div style="font-size:12px;color:#7d7d85;margin-top:${vm.goals.length ? "12px" : "0"};">Henüz belirlenmemiş hedefler: ${vm.goalsMissingNames.map(esc).join(", ")}</div>`
            : ""
        }
      </div>

      <div class="section">
        <div class="section-title">Son İşlemler</div>
        ${vm.sonIslemler
          .map((t) => {
            const isTransfer = t.yon.startsWith("Transfer");
            const color = isTransfer ? "#c8c8ce" : t.yon === "Gelir" ? "#30d158" : "#ff453a";
            const sign = t.yon === "Gelir" || t.yon === "Transfer Giriş" ? "+" : t.yon === "Gider" || t.yon === "Transfer Çıkış" ? "-" : "";
            return `
            <div class="pay-item">
              <div>
                <div class="pay-name">${esc(t.altKategori || t.kategori)}</div>
                <div class="pay-meta">${esc(t.kategori)}${t.hesap ? " · " + esc(t.hesap) : ""}${t.not ? " · " + esc(t.not) : ""}</div>
              </div>
              <div>
                <div class="pay-amount" style="color:${color};">${sign}${KAI.fmtTRY(t.tutar, t.paraBirimi)}</div>
                <div class="pay-date">${KAI.fmtDate(t.tarih)}</div>
              </div>
            </div>`;
          })
          .join("")}
      </div>

      <div class="section">
        <div class="section-title">Yaklaşan Ödemeler</div>
        ${
          vm.upcoming.length
            ? vm.upcoming
                .map(
                  (u) => `
          <div class="pay-item">
            <div><div class="pay-name">${esc(u.ad)}</div><div class="pay-meta">${esc(u.tur)}</div></div>
            <div><div class="pay-amount">${KAI.fmtTRY(u.tutar, u.paraBirimi)}</div><div class="pay-date">${KAI.fmtDate(u.tarih)}</div></div>
          </div>`
                )
                .join("")
            : `<div class="card"><div class="empty">Yaklaşan ödeme yok.</div></div>`
        }
      </div>

      ${
        vm.warnings.length
          ? `<div class="section">
              <div class="section-title">Veri Uyarıları</div>
              ${vm.warnings.map((w) => `<div class="warn-item"><span class="warn-dot">●</span><span class="warn-text">${esc(w)}</span></div>`).join("")}
            </div>`
          : ""
      }

      <footer>
        Bu görünüm Alanlar/Finans.md dosyasının GitHub'daki son haline göre canlı hesaplanır. Her sayfa yenilemesinde yeniden okunur.<br>
        Yenilemek için yukarıdaki "Yenile" düğmesini kullan veya sayfayı yenile.
      </footer>
    </div>
  `;
}

KAI.ensureLoggedIn(() => {
  document.getElementById("app").innerHTML = `<div class="loading-state">Yükleniyor…</div>`;
  KAI.authFetch("/api/finans")
    .then(renderFinans)
    .catch((err) => KAI.handleViewError(err, "finans"));
});
