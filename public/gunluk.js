const esc = KAI.escapeHtml;

function taskMeta(t) {
  // Small "saat · öncelik · alan" line — only the parts that actually have data.
  const parts = [];
  if (t.planlananSaat && t.planlananSaat !== "—") parts.push(esc(t.planlananSaat));
  if (t.oncelik) parts.push(esc(t.oncelik));
  if (t.alan) parts.push(esc(t.alan));
  return parts.join(" · ");
}

function taskRow(t, opts = {}) {
  const statusColor = t.durum === "Tamamlandı" ? "#30d158" : t.durum === "Sonuç Bekleniyor" ? "#0a84ff" : "#7d7d85";
  const showStatus = opts.showStatus !== false;
  const meta = taskMeta(t);
  return `
    <div class="routine-row" style="${opts.first ? "border-top:none;" : ""} align-items:flex-start;">
      <div>
        <div class="routine-name">${esc(t.baslik)}</div>
        ${meta ? `<div style="font-size:11px;color:#7d7d85;margin-top:2px;">${meta}</div>` : ""}
      </div>
      ${showStatus ? `<span class="routine-status" style="color:${statusColor};font-style:normal;white-space:nowrap;">${esc(t.durum)}</span>` : ""}
    </div>`;
}

function renderGunluk(vm) {
  const root = document.getElementById("app");
  const { dotClass, statusLabel } = KAI.freshness(vm.generatedAt);

  root.innerHTML = `
    <div class="wrap narrow">
      ${KAI.nav("gunluk")}
      <div class="title">KAI — Günlük Merkezi</div>
      <div class="statusbar">
        <div class="status-left"><span class="dot ${dotClass}"></span><span class="status-label">${statusLabel}</span></div>
        <div class="status-meta">Son yenileme: ${KAI.fmtDateTime(vm.generatedAt)} · Kaynak: Alanlar/Görevler.md (GitHub)</div>
      </div>

      <div class="section">
        <div class="section-title">Bugün</div>
        <div class="card">
          ${
            vm.bugun.length
              ? vm.bugun.map((t, i) => taskRow(t, { first: i === 0 })).join("")
              : `<div class="empty">Bugün için görev yok.</div>`
          }
        </div>
      </div>

      ${
        vm.belirsizTarih && vm.belirsizTarih.length
          ? `<div class="section">
              <div class="section-title">Tarihi Belirsiz</div>
              <div class="card">
                ${vm.belirsizTarih.map((t, i) => taskRow(t, { first: i === 0 })).join("")}
              </div>
            </div>`
          : ""
      }

      <div class="section">
        <div class="section-title">Yaklaşanlar</div>
        <div class="card">
          ${
            vm.yaklasanlar.length
              ? vm.yaklasanlar
                  .map((t, i) => {
                    const when = [KAI.fmtDate(t.planlananTarih), t.planlananSaat && t.planlananSaat !== "—" ? esc(t.planlananSaat) : null]
                      .filter(Boolean)
                      .join(" · ");
                    return `
              <div class="routine-row" style="${i === 0 ? "border-top:none;" : ""}">
                <span class="routine-name">${esc(t.baslik)}</span>
                <span class="routine-status" style="font-style:normal;">${when}</span>
              </div>`;
                  })
                  .join("")
              : `<div class="empty">Yaklaşan görev yok.</div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Ertelenenler <span style="text-transform:none;letter-spacing:0;color:#5f5f68;font-weight:400;">(geçmiş tarihli, kapatılmamış)</span></div>
        <div class="card">
          ${
            vm.ertelenenler.length
              ? vm.ertelenenler
                  .map(
                    (t, i) => `
              <div class="routine-row" style="${i === 0 ? "border-top:none;" : ""}">
                <span class="routine-name">${esc(t.baslik)}</span>
                <span class="routine-status" style="color:#ff9f0a;font-style:normal;">${esc(t.durum)} · ${t.gecikmeGun} gün gecikti</span>
              </div>`
                  )
                  .join("")
              : `<div class="empty">Ertelenen görev yok.</div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Sonuç Bekleyenler</div>
        <div class="card">
          ${
            vm.sonucBekleyenler.length
              ? vm.sonucBekleyenler
                  .map(
                    (o) => `
              <div style="margin-bottom:14px;">
                <div style="font-weight:700;font-size:15px;margin-bottom:8px;">${esc(o.title)}</div>
                ${o.bekleyenBilgi ? `<div style="font-size:13px;color:#9a9aa2;line-height:1.5;">Bekleyen bilgi: ${esc(o.bekleyenBilgi)}</div>` : ""}
                ${o.not ? `<div style="font-size:12px;color:#6f6f78;margin-top:8px;">${esc(o.not)}</div>` : ""}
              </div>`
                  )
                  .join("")
              : `<div class="empty">Sonuç bekleyen görev yok.</div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Rutinler</div>
        <div class="card">
          ${
            vm.routines.length
              ? vm.routines
                  .map(
                    (r, i) => `
            <div class="routine-row" style="${i === 0 ? "border-top:none;" : ""}">
              <span class="routine-name">${esc(r.name)}</span>
              <span class="routine-status">${esc(r.bugun)}${r.seri && r.seri !== "Veri eksik" ? " · Seri: " + esc(r.seri) : ""}</span>
            </div>`
                  )
                  .join("")
              : `<div class="empty">Kayıtlı rutin yok.</div>`
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Günlük Tamamlanma</div>
        <div class="card">
          <div class="completion-big">${vm.bugunOzet.tamamlanan} / ${vm.bugunOzet.planlanan}</div>
          <div class="completion-sub">Bugün planlanan ${vm.bugunOzet.planlanan} görevden ${vm.bugunOzet.tamamlanan} tanesi tamamlandı.</div>
        </div>
      </div>

      <footer>
        Bu görünüm Alanlar/Görevler.md dosyasının GitHub'daki son haline göre canlı hesaplanır (gün sınırı İstanbul saatine göre). Finans Merkezi'nden tamamen bağımsızdır.<br>
        Yenilemek için yukarıdaki "Yenile" düğmesini kullan veya sayfayı yenile.
      </footer>
    </div>
  `;
}

KAI.ensureLoggedIn(() => {
  document.getElementById("app").innerHTML = `<div class="loading-state">Yükleniyor…</div>`;
  KAI.authFetch("/api/gunluk")
    .then(renderGunluk)
    .catch((err) => KAI.handleViewError(err, "gunluk"));
});
