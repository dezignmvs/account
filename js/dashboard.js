import { listCollection } from "./database.js";
import { openPartyModal } from "./parties.js";
import {
  buildWhatsAppURL,
  escapeHTML,
  formatCurrency,
  formatDate,
  round2,
  todayISO
} from "./utilities.js";

export async function renderDashboard(container, ctx) {
  const { businessId, business, can, stores, activeIndex, switchBusiness } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="store-pill-strip">
      ${stores.map((s, idx) => `
        <button type="button" class="store-pill ${idx === activeIndex ? "active" : ""}" data-store-idx="${idx}">
          <span>${escapeHTML(s.business.name)}</span>
          <span class="pill-dot">${idx + 1}</span>
        </button>
      `).join("")}
      <a href="#/business-setup" class="store-pill" style="border-style:dashed;">
        <span>New Store</span>
        <span class="pill-dot">+</span>
      </a>
    </div>

    <div class="dash-hero-banner">
      <div class="hero-top-notch">Active Store &bull; ${escapeHTML(business.businessType || "Business")}</div>
      <div>
        <div class="hero-diamonds"><span></span><span class="gold"></span><span></span><span class="gold"></span></div>
        <h2 class="font-display">${escapeHTML(business.name)}</h2>
        <div style="font-size:13px;opacity:0.9;margin-top:4px;">${escapeHTML(business.state || "")} &bull; ${escapeHTML(business.mobile || "")}</div>
      </div>
      <div class="quick-actions">
        ${can("manageParties") ? `<button id="dash-add-cust-btn" class="btn" style="background:#fff;color:var(--brand-crimson);font-weight:700;border-radius:999px;">+ Add Customer</button>` : ""}
        <a href="#/ledger" class="btn" style="background:var(--brand-gold);color:#1A1615;font-weight:700;border-radius:999px;">Open Khata</a>
        ${can("createInvoices") ? `<a href="#/sales/create" class="btn" style="background:rgba(255,255,255,0.18);color:#fff;border-color:rgba(255,255,255,0.4);border-radius:999px;">+ New Bill</a>` : ""}
      </div>
    </div>

    <div id="dash-body">
      <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading store ledger...</p></div>
    </div>
  `;

  container.querySelectorAll("[data-store-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.storeIdx);
      if (idx !== activeIndex) switchBusiness(idx);
    });
  });

  container.querySelector("#dash-add-cust-btn")?.addEventListener("click", () => {
    openPartyModal(ctx, null, () => renderDashboard(container, ctx));
  });

  const [parties, ledgerEntries, sales] = await Promise.all([
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("ledgerEntries", businessId, "createdAt", "desc", 500),
    listCollection("sales", businessId, "date", "desc", 300)
  ]);

  const receivables = round2(parties.filter((p) => (p.currentBalance || 0) > 0).reduce((a, p) => a + p.currentBalance, 0));
  const payables = round2(parties.filter((p) => (p.currentBalance || 0) < 0).reduce((a, p) => a + Math.abs(p.currentBalance), 0));

  const today = todayISO();
  const todayEntries = ledgerEntries.filter((e) => e.date === today);
  const todayGot = round2(todayEntries.filter((e) => e.entryType === "credit").reduce((a, e) => a + (e.amount || 0), 0));
  const todayGave = round2(todayEntries.filter((e) => e.entryType === "debit").reduce((a, e) => a + (e.amount || 0), 0));
  const totalSales = round2(sales.filter((s) => s.status === "final").reduce((a, s) => a + (s.grandTotal || 0), 0));

  const topCustomers = [...parties]
    .sort((a, b) => Math.abs(b.currentBalance || 0) - Math.abs(a.currentBalance || 0))
    .slice(0, 8);
  const recentEntries = ledgerEntries.slice(0, 8);

  container.querySelector("#dash-body").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>You Will Get</span>
          <span class="icon-badge-sm" style="background:#E6F7EE;color:#13A85B;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="7 17 17 7"/><polyline points="7 7 17 7 17 17"/></svg></span>
        </div>
        <div class="kpi-value text-success">${formatCurrency(receivables, currency)}</div>
        <div class="kpi-sub">${parties.filter((p) => (p.currentBalance || 0) > 0).length} customers with due</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">
          <span>You Will Pay</span>
          <span class="icon-badge-sm" style="background:#FDF0EC;color:#E24A23;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 7 7 17"/><polyline points="17 17 7 17 7 7"/></svg></span>
        </div>
        <div class="kpi-value text-danger">${formatCurrency(payables, currency)}</div>
        <div class="kpi-sub">${parties.filter((p) => (p.currentBalance || 0) < 0).length} suppliers pending</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Today's Khata</span>
          <span class="icon-badge-sm" style="background:#FEF7E0;color:#B87D00;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg></span>
        </div>
        <div class="kpi-value" style="font-size:18px;">
          <span class="text-success">+${formatCurrency(todayGot, currency)}</span>
          <span class="text-muted" style="font-size:13px;"> / </span>
          <span class="text-danger">-${formatCurrency(todayGave, currency)}</span>
        </div>
        <div class="kpi-sub">${todayEntries.length} entries recorded today</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Billed Sales</span>
          <span class="icon-badge-sm" style="background:#ECEBFC;color:#2D26D4;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
        </div>
        <div class="kpi-value text-brand">${formatCurrency(totalSales, currency)}</div>
        <div class="kpi-sub">${parties.length} total parties in this store</div>
      </div>
    </div>

    <div class="diamond-divider"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>

    <div class="folder-section">
      <div class="folder-tab-label">Store Khata &amp; Activity</div>
      <div class="dash-lists-grid">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Customer &amp; Party Khata</span>
          <a href="#/parties" style="font-size:12.5px;font-weight:600;">Manage all &rarr;</a>
        </div>
        <div class="card-body">
          ${topCustomers.length === 0 ? `
            <div class="state-box" style="padding:24px;">
              <p class="text-muted">No customers added to <strong>${escapeHTML(business.name)}</strong> yet.</p>
              ${can("manageParties") ? `<button id="empty-dash-cust" class="btn btn-primary btn-sm">+ Add First Customer</button>` : ""}
            </div>
          ` : `
            <div class="mini-list">
              ${topCustomers.map((p) => {
                const bal = Number(p.currentBalance || 0);
                const msg = `Hello ${p.name}, reminder from ${business.name}: your pending balance is ${formatCurrency(Math.abs(bal), currency)}.`;
                return `
                  <div class="mini-list-item">
                    <div>
                      <a href="#/ledger?party=${p.id}" style="font-weight:700;">${escapeHTML(p.name)}</a>
                      <div class="text-muted" style="font-size:12px;">${escapeHTML(p.type)} &bull; ${escapeHTML(p.mobile)}</div>
                    </div>
                    <div class="flex-row">
                      <div class="text-right">
                        <div class="mono ${bal > 0 ? "text-success" : bal < 0 ? "text-danger" : "text-muted"}" style="font-weight:700;">
                          ${formatCurrency(Math.abs(bal), currency)}
                        </div>
                        <div style="font-size:10.5px;color:var(--text-muted);">${bal > 0 ? "You Get" : bal < 0 ? "You Pay" : "Settled"}</div>
                      </div>
                      ${bal > 0 ? `<a href="${buildWhatsAppURL(p.mobile, msg)}" target="_blank" rel="noopener" class="btn btn-soft btn-sm">WA</a>` : ""}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Khata Transactions</span>
          <a href="#/ledger" style="font-size:12.5px;font-weight:600;">Open Ledger &rarr;</a>
        </div>
        <div class="card-body">
          ${recentEntries.length === 0 ? `
            <div class="state-box" style="padding:24px;">
              <p class="text-muted">No Khata transactions yet in this store.</p>
            </div>
          ` : `
            <div class="mini-list">
              ${recentEntries.map((e) => `
                <div class="mini-list-item">
                  <div>
                    <a href="#/ledger?party=${e.partyId}" style="font-weight:700;">${escapeHTML(e.partyName)}</a>
                    <div class="text-muted" style="font-size:12px;">${escapeHTML(e.description)} &bull; ${formatDate(e.date)}</div>
                  </div>
                  <div class="text-right">
                    <div class="mono ${e.entryType === "credit" ? "text-success" : "text-danger"}" style="font-weight:700;">
                      ${e.entryType === "credit" ? "+" : "-"}${formatCurrency(e.amount, currency)}
                    </div>
                    <span class="badge ${e.entryType === "credit" ? "badge-success" : "badge-danger"}">${e.entryType === "credit" ? "You Got" : "You Gave"}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          `}
        </div>
      </div>
    </div>
    </div>
  `;

  container.querySelector("#empty-dash-cust")?.addEventListener("click", () => {
    openPartyModal(ctx, null, () => renderDashboard(container, ctx));
  });
}
