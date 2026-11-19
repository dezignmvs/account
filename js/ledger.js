import { db, collection, doc, setDoc, serverTimestamp } from "./firebase.js";
import { listCollection, logAudit } from "./database.js";
import {
  escapeHTML,
  exportToCSV,
  formatCurrency,
  formatDate,
  generateIdempotencyKey,
  round2,
  showToast,
  todayISO
} from "./utilities.js";

export async function renderLedger(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="dash-hero-banner" style="background-color:var(--brand-primary);padding:26px 24px 20px;">
      <div class="hero-top-notch" style="color:var(--brand-primary);">Store Ledger</div>
      <div>
        <div class="hero-diamonds"><span></span><span class="gold"></span><span></span><span class="gold"></span></div>
        <h2 class="font-display" style="font-size:28px;margin:0;">${escapeHTML(business.name)} — Ledger</h2>
      </div>
      <div class="quick-actions">
        <button id="ledger-csv-btn" class="btn" style="background:var(--brand-gold);color:#141110;font-weight:800;border-radius:999px;">Export CSV</button>
        <button onclick="window.print()" class="btn" style="background:#fff;color:var(--brand-primary);font-weight:800;border-radius:999px;">Print / PDF</button>
      </div>
    </div>

    ${can("manageParties") ? `
      <div class="card" style="border-radius:20px;margin-bottom:20px;">
        <div class="card-header">
          <div class="flex-row">
            <span class="icon-badge-sm" style="background:#FDF0EC;color:#E24A23;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg></span>
            <span class="card-title">Add Ledger Entry</span>
          </div>
        </div>
        <form id="simple-ledger-form" class="card-body">
          <div class="ledger-inline-grid">
            <div class="form-group">
              <label class="form-label">Title *</label>
              <input type="text" name="title" class="form-control" required placeholder="e.g. Shop Sale, Rent, Advance" />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input type="text" name="description" class="form-control" placeholder="Details or notes" />
            </div>
            <div class="form-group">
              <label class="form-label">Credit / Debit *</label>
              <select name="entryType" class="form-control" required>
                <option value="credit">Credit (+)</option>
                <option value="debit">Debit (-)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Money Type *</label>
              <select name="paymentMethod" class="form-control" required>
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Amount (₹) *</label>
              <input type="number" step="0.01" min="0.01" name="amount" class="form-control" required placeholder="0.00" />
            </div>
            <div>
              <button type="submit" id="ledger-save-btn" class="btn btn-primary" style="height:40px;padding:0 22px;border-radius:999px;">Save</button>
            </div>
          </div>
        </form>
      </div>
    ` : ""}

    <div class="kpi-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));" id="ledger-kpis"></div>

    <div class="diamond-divider"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>

    <div class="folder-section">
      <div class="folder-tab-label">Ledger Entries</div>
      <div class="card" style="border-radius:18px;overflow:hidden;">
        <div id="ledger-table-wrap" class="table-wrap">
          <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading ledger...</p></div>
        </div>
      </div>
    </div>
  `;

  let entries = [];
  const wrap = container.querySelector("#ledger-table-wrap");
  const kpiEl = container.querySelector("#ledger-kpis");

  async function loadAndRender() {
    entries = await listCollection("ledgerEntries", businessId, "createdAt", "desc", 500);

    const totalCredit = round2(entries.filter((e) => e.entryType === "credit").reduce((a, e) => a + (e.amount || 0), 0));
    const totalDebit = round2(entries.filter((e) => e.entryType === "debit").reduce((a, e) => a + (e.amount || 0), 0));

    kpiEl.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Total Credit (+)</div>
        <div class="kpi-value text-success">${formatCurrency(totalCredit, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Debit (-)</div>
        <div class="kpi-value text-danger">${formatCurrency(totalDebit, currency)}</div>
      </div>
    `;

    if (entries.length === 0) {
      wrap.innerHTML = `<div class="state-box"><p class="text-muted">No ledger entries yet. Use the form above to add your first entry.</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
          <thead>
          <tr>
            <th>Date</th>
            <th>Title</th>
            <th>Description</th>
            <th>Money Type</th>
            <th>Type</th>
            <th class="text-right">Credit (+)</th>
            <th class="text-right">Debit (-)</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((e) => {
            const isCredit = e.entryType === "credit";
            return `
              <tr>
                <td>${formatDate(e.date)}</td>
                <td style="font-weight:700;">${escapeHTML(e.title || e.partyName || "Entry")}</td>
                <td class="text-secondary">${escapeHTML(e.description || "—")}</td>
                <td><span class="badge badge-neutral">${escapeHTML(e.paymentMethod || "Cash")}</span></td>
                <td><span class="badge ${isCredit ? "badge-success" : "badge-danger"}">${isCredit ? "Credit" : "Debit"}</span></td>
                <td class="text-right mono text-success" style="font-weight:700;">${isCredit ? formatCurrency(e.amount, currency) : "—"}</td>
                <td class="text-right mono text-danger" style="font-weight:700;">${!isCredit ? formatCurrency(e.amount, currency) : "—"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  const form = container.querySelector("#simple-ledger-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const amount = round2(fd.get("amount"));
      if (amount <= 0) {
        showToast("Enter a valid amount.", "error");
        return;
      }
      const btn = container.querySelector("#ledger-save-btn");
      btn.disabled = true;
      try {
        const entryId = generateIdempotencyKey("ldg");
        await setDoc(doc(db, "ledgerEntries", entryId), {
          businessId,
          partyId: "",
          partyName: fd.get("title").trim(),
          title: fd.get("title").trim(),
          description: (fd.get("description") || "").trim(),
          entryType: fd.get("entryType"),
          category: "general_ledger",
          amount,
          date: todayISO(),
          paymentMethod: fd.get("paymentMethod") || "Cash",
          createdBy: ctx.user?.uid || "",
          createdAt: serverTimestamp()
        });
        await logAudit(businessId, ctx.user, "CREATE_LEDGER_ENTRY", "ledgerEntries", entryId, {
          title: fd.get("title").trim(),
          amount
        });
        showToast("Ledger entry saved!", "success");
        form.reset();
        await loadAndRender();
      } catch (err) {
        showToast(err.message || "Failed to save entry.", "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  container.querySelector("#ledger-csv-btn").addEventListener("click", () => {
    exportToCSV(
      `ledger_${business.name.replace(/\s+/g, "_")}.csv`,
      ["Date", "Title", "Description", "Money Type", "Type", "Amount"],
      entries.map((e) => [e.date, e.title || e.partyName || "", e.description || "", e.paymentMethod || "Cash", e.entryType, e.amount])
    );
  });

  await loadAndRender();
}
