import { db, doc, updateDoc } from "./firebase.js";
import { listCollection } from "./database.js";
import { buildWhatsAppURL, escapeHTML, formatCurrency, formatDate, todayISO } from "./utilities.js";

export async function renderNotifications(container, ctx) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `<div class="state-box"><div class="spinner"></div><p class="text-muted">Checking alerts &amp; reminders...</p></div>`;

  const [notifs, products, sales, parties] = await Promise.all([
    listCollection("notifications", businessId, "createdAt", "desc", 100),
    listCollection("products", businessId, "name", "asc", 500),
    listCollection("sales", businessId, "date", "desc", 300),
    listCollection("parties", businessId, "name", "asc", 300)
  ]);

  const today = todayISO();
  const lowStock = products.filter((p) => (p.currentStock || 0) <= (p.minStock || 0));
  const overdueInvoices = sales.filter((s) => s.status === "final" && (s.balanceDue || 0) > 0 && s.dueDate && s.dueDate < today);
  const dueParties = parties.filter((p) => (p.currentBalance || 0) > 0).sort((a, b) => b.currentBalance - a.currentBalance).slice(0, 8);

  container.innerHTML = `
    <div class="dash-lists-grid" style="margin-bottom:18px;">
      <div class="card">
        <div class="card-header"><span class="card-title">Overdue Invoices (${overdueInvoices.length})</span></div>
        <div class="card-body">
          ${overdueInvoices.length === 0 ? `<p class="text-muted">No overdue invoices.</p>` : overdueInvoices.map((inv) => `
            <div class="mini-list-item">
              <div>
                <a href="#/sales/${inv.id}" style="font-weight:700;">${escapeHTML(inv.invoiceNumber)}</a>
                <div class="text-muted" style="font-size:12px;">${escapeHTML(inv.partyName)} &bull; Due: ${formatDate(inv.dueDate)}</div>
              </div>
              <span class="mono text-danger" style="font-weight:700;">${formatCurrency(inv.balanceDue, currency)}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Payment Reminders (WhatsApp)</span></div>
        <div class="card-body">
          ${dueParties.length === 0 ? `<p class="text-muted">No pending customer dues.</p>` : dueParties.map((p) => {
            const msg = `Hello ${p.name}, gentle reminder from ${business.name}: your pending Khata balance is ${formatCurrency(p.currentBalance, currency)}. Thank you!`;
            return `
              <div class="mini-list-item">
                <div>
                  <div style="font-weight:700;">${escapeHTML(p.name)}</div>
                  <div class="text-muted" style="font-size:12px;">Due: <strong class="mono">${formatCurrency(p.currentBalance, currency)}</strong></div>
                </div>
                <a href="${buildWhatsAppURL(p.mobile, msg)}" target="_blank" rel="noopener" class="btn btn-soft btn-sm">Send WhatsApp</a>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <div class="card-header"><span class="card-title">Low Stock Alerts (${lowStock.length})</span><a href="#/inventory" class="btn btn-secondary btn-sm">Open Inventory</a></div>
      <div class="card-body">
        ${lowStock.length === 0 ? `<p class="text-muted">All products are above minimum stock levels.</p>` : lowStock.map((p) => `
          <div class="mini-list-item">
            <div><strong>${escapeHTML(p.name)}</strong> <span class="text-muted">(Min: ${p.minStock})</span></div>
            <span class="badge ${p.currentStock <= 0 ? "badge-danger" : "badge-warning"}">${p.currentStock} ${escapeHTML(p.unit || "PCS")}</span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Activity &amp; System Notifications</span></div>
      <div class="card-body">
        ${notifs.length === 0 ? `<p class="text-muted">No notifications yet.</p>` : notifs.map((n) => `
          <div class="mini-list-item">
            <div>
              <div style="font-weight:${n.read ? "500" : "700"};">${escapeHTML(n.title)}</div>
              <div class="text-muted" style="font-size:12.5px;">${escapeHTML(n.message)}</div>
            </div>
            <div class="flex-row">
              ${n.link ? `<a href="${escapeHTML(n.link)}" class="btn btn-secondary btn-sm">Open</a>` : ""}
              ${!n.read ? `<button class="btn btn-soft btn-sm mark-read-btn" data-id="${n.id}">Mark Read</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".mark-read-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      await updateDoc(doc(db, "notifications", b.dataset.id), { read: true });
      renderNotifications(container, ctx);
    });
  });
}
