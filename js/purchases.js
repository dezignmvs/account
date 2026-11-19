import { createPurchaseEntry, getBusinessSettings, listCollection } from "./database.js";
import {
  escapeHTML,
  formatCurrency,
  formatDate,
  generateIdempotencyKey,
  round2,
  showToast,
  todayISO
} from "./utilities.js";

export async function renderPurchasesList(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" id="pur-search" class="form-control" placeholder="Search purchase # or supplier..." />
        </div>
      </div>
      <div class="filter-bar">
        ${can("managePurchases") ? `<a href="#/purchases/create" class="btn btn-primary">+ New Purchase</a>` : ""}
      </div>
    </div>

    <div class="card">
      <div id="purchases-table-wrap" class="table-wrap">
        <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading purchases...</p></div>
      </div>
    </div>
  `;

  const purchases = await listCollection("purchases", businessId, "date", "desc", 500);
  const searchEl = container.querySelector("#pur-search");
  const wrap = container.querySelector("#purchases-table-wrap");

  function renderTable() {
    const q = searchEl.value.trim().toLowerCase();
    const list = purchases.filter(
      (p) => !q || (p.purchaseNumber || "").toLowerCase().includes(q) || (p.partyName || "").toLowerCase().includes(q)
    );
    if (list.length === 0) {
      wrap.innerHTML = `<div class="state-box"><p class="text-muted">No purchase bills recorded yet.</p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Purchase #</th>
            <th>Supplier Bill #</th>
            <th>Date</th>
            <th>Supplier</th>
            <th class="text-right">Total</th>
            <th class="text-right">Paid</th>
            <th class="text-right">Pending</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => `
            <tr>
              <td class="mono" style="font-weight:700;">${escapeHTML(p.purchaseNumber)}</td>
              <td class="mono">${escapeHTML(p.supplierInvoiceNo || "—")}</td>
              <td>${formatDate(p.date)}</td>
              <td>${escapeHTML(p.partyName)}</td>
              <td class="text-right mono" style="font-weight:700;">${formatCurrency(p.grandTotal, currency)}</td>
              <td class="text-right mono text-success">${formatCurrency(p.paidAmount, currency)}</td>
              <td class="text-right mono ${p.pendingAmount > 0 ? "text-danger" : ""}">${formatCurrency(p.pendingAmount, currency)}</td>
              <td><span class="badge ${p.paymentStatus === "paid" ? "badge-success" : p.paymentStatus === "partial" ? "badge-warning" : "badge-danger"}">${escapeHTML(p.paymentStatus)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  searchEl.addEventListener("input", renderTable);
  renderTable();
}

export async function renderCreatePurchase(container, ctx) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";
  const idempKey = generateIdempotencyKey("pur");

  container.innerHTML = `<div class="state-box"><div class="spinner"></div></div>`;
  const [parties, products, settings] = await Promise.all([
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("products", businessId, "name", "asc", 500),
    getBusinessSettings(businessId)
  ]);

  const suppliers = parties.filter((p) => p.type === "Supplier" || p.type === "Both");
  let items = [{ productId: "", name: "", quantity: 1, price: 0, gstRate: 18 }];

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="flex-row">
        <a href="#/purchases" class="btn btn-secondary btn-sm">&larr; Purchases</a>
        <h2 style="font-size:20px;">Record Purchase Entry</h2>
      </div>
    </div>

    <form id="pur-form" class="invoice-builder-grid">
      <div class="stack-xs" style="gap:16px;">
        <div class="card card-body">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label">Supplier *</label>
              <select name="partyId" class="form-control">
                <option value="">Cash / Walk-in Supplier</option>
                ${suppliers.map((s) => `<option value="${s.id}">${escapeHTML(s.name)} (${escapeHTML(s.mobile)})</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Supplier Invoice No.</label>
              <input type="text" name="supplierInvoiceNo" class="form-control" placeholder="e.g. SUP-402" />
            </div>
            <div class="form-group">
              <label class="form-label">Purchase Date *</label>
              <input type="date" name="date" class="form-control" required value="${todayISO()}" />
            </div>
            <div class="form-group">
              <label class="form-label">Supply Type</label>
              <select name="supplyType" class="form-control">
                <option value="intra">Intra-State (CGST + SGST)</option>
                <option value="inter">Inter-State (IGST)</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:span 2;">
              <label class="form-label">Notes</label>
              <input type="text" name="notes" class="form-control" />
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Purchased Items (Auto-updates Inventory)</span>
            <button type="button" id="pur-add-line" class="btn btn-soft btn-sm">+ Add Item</button>
          </div>
          <div class="table-wrap">
            <table class="data-table invoice-items-table">
              <thead>
                <tr>
                  <th style="min-width:200px;">Product</th>
                  <th style="width:90px;">Qty</th>
                  <th style="width:120px;">Purchase Rate (₹)</th>
                  <th style="width:90px;">GST %</th>
                  <th class="text-right" style="width:120px;">Total</th>
                  <th style="width:44px;"></th>
                </tr>
              </thead>
              <tbody id="pur-items-body"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card card-body invoice-totals-box">
        <h3 style="font-size:16px;">Purchase Summary</h3>
        <div class="total-line"><span>Taxable Subtotal</span><span id="pur-sub" class="mono">₹0.00</span></div>
        <div class="total-line"><span>Input GST</span><span id="pur-gst" class="mono">₹0.00</span></div>
        <div class="form-group">
          <label class="form-label">Additional Charges (₹)</label>
          <input type="number" step="0.01" min="0" id="pur-extra" name="additionalCharges" class="form-control" value="0" />
        </div>
        <div class="total-line grand"><span>Grand Total</span><span id="pur-grand" class="mono">₹0.00</span></div>
        <hr style="border:none;border-top:1px solid var(--border-light);width:100%;" />
        <div class="form-group">
          <label class="form-label">Paid Amount (₹)</label>
          <div class="flex-row">
            <input type="number" step="0.01" min="0" id="pur-paid" name="paidAmount" class="form-control" value="0" />
            <button type="button" id="pur-full-btn" class="btn btn-soft btn-sm">Full</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select name="paymentMethod" class="form-control">
            <option value="bank">Bank Transfer</option>
            <option value="upi">UPI</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <button type="submit" id="pur-save-btn" class="btn btn-primary" style="margin-top:8px;">Save Purchase &amp; Update Stock</button>
      </div>
    </form>
  `;

  const tbody = container.querySelector("#pur-items-body");
  const extraEl = container.querySelector("#pur-extra");
  const paidEl = container.querySelector("#pur-paid");
  let totals = { subtotal: 0, gstTotal: 0, additionalCharges: 0, grandTotal: 0 };

  function recalc() {
    let sub = 0;
    let gstSum = 0;
    items.forEach((it, idx) => {
      const base = round2(Number(it.quantity || 0) * Number(it.price || 0));
      const gst = round2(base * (Number(it.gstRate || 0) / 100));
      it.total = round2(base + gst);
      sub = round2(sub + base);
      gstSum = round2(gstSum + gst);
      const cell = tbody.querySelector(`.p-line-tot[data-idx="${idx}"]`);
      if (cell) cell.textContent = formatCurrency(it.total, currency);
    });
    const extra = round2(extraEl.value || 0);
    const grand = round2(sub + gstSum + extra);
    totals = { subtotal: sub, gstTotal: gstSum, additionalCharges: extra, grandTotal: grand };
    container.querySelector("#pur-sub").textContent = formatCurrency(sub, currency);
    container.querySelector("#pur-gst").textContent = formatCurrency(gstSum, currency);
    container.querySelector("#pur-grand").textContent = formatCurrency(grand, currency);
  }

  function renderLines() {
    tbody.innerHTML = items.map((it, idx) => `
      <tr>
        <td>
          <select class="form-control p-prod" data-idx="${idx}" required>
            <option value="">-- Select Product --</option>
            ${products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHTML(p.name)}</option>`).join("")}
          </select>
        </td>
        <td><input type="number" step="0.01" min="0.01" class="form-control p-qty" data-idx="${idx}" value="${it.quantity}" /></td>
        <td><input type="number" step="0.01" min="0" class="form-control p-price" data-idx="${idx}" value="${it.price}" /></td>
        <td><input type="number" step="0.01" min="0" max="28" class="form-control p-gst" data-idx="${idx}" value="${it.gstRate}" /></td>
        <td class="text-right mono p-line-tot" data-idx="${idx}">₹0.00</td>
        <td><button type="button" class="btn-icon p-rem" data-idx="${idx}">&times;</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".p-prod").forEach((s) => {
      s.addEventListener("change", () => {
        const idx = Number(s.dataset.idx);
        const prod = products.find((p) => p.id === s.value);
        if (prod) {
          items[idx] = { ...items[idx], productId: prod.id, name: prod.name, price: prod.purchasePrice || 0, gstRate: prod.gstRate ?? 18 };
        }
        renderLines();
      });
    });
    tbody.querySelectorAll(".p-qty").forEach((i) => i.addEventListener("input", () => { items[Number(i.dataset.idx)].quantity = Number(i.value || 0); recalc(); }));
    tbody.querySelectorAll(".p-price").forEach((i) => i.addEventListener("input", () => { items[Number(i.dataset.idx)].price = Number(i.value || 0); recalc(); }));
    tbody.querySelectorAll(".p-gst").forEach((i) => i.addEventListener("input", () => { items[Number(i.dataset.idx)].gstRate = Number(i.value || 0); recalc(); }));
    tbody.querySelectorAll(".p-rem").forEach((b) => b.addEventListener("click", () => {
      if (items.length === 1) return;
      items.splice(Number(b.dataset.idx), 1);
      renderLines();
    }));
    recalc();
  }

  container.querySelector("#pur-add-line").addEventListener("click", () => {
    items.push({ productId: "", name: "", quantity: 1, price: 0, gstRate: 18 });
    renderLines();
  });
  container.querySelector("#pur-full-btn").addEventListener("click", () => {
    paidEl.value = totals.grandTotal;
  });
  extraEl.addEventListener("input", recalc);

  container.querySelector("#pur-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const valid = items.filter((it) => it.productId && it.quantity > 0);
    if (valid.length === 0) {
      showToast("Select at least one product.", "error");
      return;
    }
    const fd = new FormData(e.target);
    const party = suppliers.find((s) => s.id === fd.get("partyId"));
    const btn = container.querySelector("#pur-save-btn");
    btn.disabled = true;
    try {
      const res = await createPurchaseEntry(
        businessId,
        {
          idempotencyKey: idempKey,
          partyId: party?.id || "",
          partyName: party?.name || "Cash Supplier",
          supplierInvoiceNo: fd.get("supplierInvoiceNo"),
          date: fd.get("date"),
          isInterState: fd.get("supplyType") === "inter",
          paidAmount: Number(fd.get("paidAmount") || 0),
          paymentMethod: fd.get("paymentMethod"),
          notes: fd.get("notes"),
          items: valid,
          ...totals
        },
        ctx.user,
        settings
      );
      showToast(`Purchase ${res.purchaseNumber} saved & stock updated!`, "success");
      window.location.hash = "#/purchases";
    } catch (err) {
      showToast(err.message || "Failed to record purchase.", "error");
      btn.disabled = false;
    }
  });

  renderLines();
}
