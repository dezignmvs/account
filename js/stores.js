import { escapeHTML } from "./utilities.js";

export async function renderStores(container, ctx) {
  const { stores, activeIndex, switchBusiness } = ctx;

  container.innerHTML = `
    <div class="dash-hero-banner">
      <div class="hero-top-notch">Multi-Store Workspace</div>
      <div>
        <div class="hero-diamonds"><span></span><span class="gold"></span><span></span><span class="gold"></span></div>
        <h2 class="font-display">Your Stores &amp; Businesses</h2>
        <p style="margin:6px 0 0;opacity:0.9;font-size:13.5px;">Each store keeps completely separate customers, Khata ledgers, and transactions.</p>
      </div>
      <a href="#/business-setup" class="btn" style="background:#fff;color:var(--brand-crimson);font-weight:700;border-radius:999px;">+ Create New Store</a>
    </div>

    <div class="folder-section">
      <div class="folder-tab-label">All Registered Stores (${stores.length})</div>
      <div class="stores-gallery-grid">
      ${stores.map((entry, idx) => {
        const b = entry.business;
        const isActive = idx === activeIndex;
        return `
          <div class="store-card ${isActive ? "active-store" : ""}">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
              <div class="flex-row">
                ${b.logoUrl
                  ? `<img src="${escapeHTML(b.logoUrl)}" class="product-thumb" alt="Logo" />`
                  : `<div class="user-avatar" style="border-radius:10px;">${escapeHTML((b.name || "S")[0].toUpperCase())}</div>`
                }
                <div>
                  <h3 style="font-size:16px;">${escapeHTML(b.name)}</h3>
                  <div class="text-muted" style="font-size:12px;">${escapeHTML(b.businessType || "Business")} &bull; ${escapeHTML(b.state || "")}</div>
                </div>
              </div>
              ${isActive ? `<span class="badge badge-brand">Active</span>` : `<span class="badge badge-neutral">${escapeHTML(entry.member.role)}</span>`}
            </div>

            <div class="text-secondary" style="font-size:12.5px;">
              <div>Owner: <strong>${escapeHTML(b.ownerName || "—")}</strong></div>
              <div>Mobile: <span class="mono">${escapeHTML(b.mobile || "—")}</span></div>
              ${b.gstin ? `<div>GSTIN: <span class="mono">${escapeHTML(b.gstin)}</span></div>` : ""}
            </div>

            <div style="display:flex;gap:8px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border-light);">
              ${isActive
                ? `<a href="#/ledger" class="btn btn-primary btn-sm" style="flex:1;">Open Khata</a>`
                : `<button class="btn btn-soft btn-sm switch-store-btn" data-idx="${idx}" style="flex:1;">Switch to Store</button>`
              }
              <a href="#/parties" class="btn btn-secondary btn-sm">Customers</a>
            </div>
          </div>
        `;
      }).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".switch-store-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchBusiness(Number(btn.dataset.idx));
    });
  });
}
