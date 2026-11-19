import { db, doc, getDoc } from "./firebase.js";
import {
  cancelSaleInvoice,
  createSaleInvoice,
  getBusinessSettings,
  listCollection
} from "./database.js";
import {
  buildWhatsAppURL,
  confirmDialog,
  escapeHTML,
  formatCurrency,
  formatDate,
  generateIdempotencyKey,
  round2,
  showToast,
  todayISO
} from "./utilities.js";

export async function renderSalesList(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" id="sales-search" class="form-control" placeholder="Search invoice # or customer..." />
        </div>
        <select id="sales-status-filter" class="form-control" style="width:auto;">
          <option value="ALL">All Statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="unpaid">Unpaid</option>
          <option value="draft">Draft</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div class="filter-bar">
        ${can("createInvoices") ? `<a href="#/sales/create" class="btn btn-primary">+ Create Invoice</a>` : ""}
      </div>
    </div>

    <div class="card">
      <div id="sales-table-wrap" class="table-wrap">
        <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading invoices...</p></div>
      </div>
    </div>
  `;

  const sales = await listCollection("sales", businessId, "date", "desc", 500);
  const searchEl = container.querySelector("#sales-search");
  const statusEl = container.querySelector("#sales-status-filter");
  const wrap = container.querySelector("#sales-table-wrap");

  function renderTable() {
    const q = searchEl.value.trim().toLowerCase();
    const st = statusEl.value;
    const list = sales.filter((s) => {
      const stOk = st === "ALL" || s.paymentStatus === st || s.status === st;
      const qOk = !q || (s.invoiceNumber || "").toLowerCase().includes(q) || (s.partyName || "").toLowerCase().includes(q);
      return stOk && qOk;
    });

    if (list.length === 0) {
      wrap.innerHTML = `
        <div class="state-box">
          <p class="text-muted">No invoices found.</p>
          ${can("createInvoices") ? `<a href="#/sales/create" class="btn btn-primary btn-sm">+ Create First Invoice</a>` : ""}
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Date</th>
            <th>Customer</th>
            <th class="text-right">Grand Total</th>
            <th class="text-right">Received</th>
            <th class="text-right">Balance Due</th>
            <th>Status</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((s) => {
            const badgeClass =
              s.paymentStatus === "paid" ? "badge-success" :
              s.paymentStatus === "partial" ? "badge-warning" :
              s.paymentStatus === "cancelled" ? "badge-neutral" :
              s.paymentStatus === "draft" ? "badge-info" : "badge-danger";
            return `
              <tr>
                <td><a href="#/sales/${s.id}" class="mono" style="font-weight:700;">${escapeHTML(s.invoiceNumber)}</a></td>
                <td>${formatDate(s.date)}</td>
                <td>${escapeHTML(s.partyName || "Walk-in")}</td>
                <td class="text-right mono" style="font-weight:700;">${formatCurrency(s.grandTotal, currency)}</td>
                <td class="text-right mono text-success">${formatCurrency(s.amountReceived, currency)}</td>
                <td class="text-right mono ${s.balanceDue > 0 ? "text-danger" : ""}">${formatCurrency(s.balanceDue, currency)}</td>
                <td><span class="badge ${badgeClass}">${escapeHTML(s.paymentStatus)}</span></td>
                <td class="text-right">
                  <a href="#/sales/${s.id}" class="btn btn-secondary btn-sm">View / Print</a>
                  ${can("createInvoices") ? `<a href="#/sales/create?duplicate=${s.id}" class="btn btn-secondary btn-sm">Duplicate</a>` : ""}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  searchEl.addEventListener("input", renderTable);
  statusEl.addEventListener("change", renderTable);
  renderTable();
}

export async function renderCreateSale(container, ctx, queryParams = new URLSearchParams()) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";
  const idempKey = generateIdempotencyKey("sale");
  const dupId = queryParams.get("duplicate") || "";

  container.innerHTML = `<div class="state-box"><div class="spinner"></div><p class="text-muted">Preparing invoice builder...</p></div>`;

  const [parties, products, settings] = await Promise.all([
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("products", businessId, "name", "asc", 500),
    getBusinessSettings(businessId)
  ]);

  let duplicateData = null;
  if (dupId) {
    const dSnap = await getDoc(doc(db, "sales", dupId));
    if (dSnap.exists() && dSnap.data().businessId === businessId) {
      duplicateData = dSnap.data();
    }
  }

  const customers = parties.filter((p) => p.type === "Customer" || p.type === "Both");
  let items = duplicateData?.items?.length
    ? duplicateData.items.map((it) => ({ ...it }))
    : [{ productId: "", name: "", quantity: 1, unit: "PCS", price: 0, discountPct: 0, gstRate: 18 }];

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="flex-row">
        <a href="#/sales" class="btn btn-secondary btn-sm">&larr; Invoices</a>
        <h2 style="font-size:20px;">${duplicateData ? "Duplicate Invoice" : "Create Sales Invoice"}</h2>
      </div>
    </div>

    <form id="sale-builder-form" class="invoice-builder-grid">
      <div class="stack-xs" style="gap:16px;">
        <div class="card card-body">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label">Customer *</label>
              <select id="sale-party-select" name="partyId" class="form-control">
                <option value="">Walk-in / Cash Customer</option>
                ${customers.map((c) => `<option value="${c.id}" ${duplicateData?.partyId === c.id ? "selected" : ""}>${escapeHTML(c.name)} (${escapeHTML(c.mobile)})</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Invoice Date *</label>
              <input type="date" name="date" class="form-control" required value="${todayISO()}" />
            </div>
            <div class="form-group">
              <label class="form-label">Due Date</label>
              <input type="date" name="dueDate" class="form-control" value="${todayISO()}" />
            </div>
            <div class="form-group">
              <label class="form-label">Tax Supply Type</label>
              <select id="sale-supply-type" name="supplyType" class="form-control">
                <option value="intra">Intra-State (CGST + SGST)</option>
                <option value="inter" ${duplicateData?.isInterState ? "selected" : ""}>Inter-State (IGST)</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:span 2;">
              <label class="form-label">Notes / Terms</label>
              <input type="text" name="notes" class="form-control" value="${escapeHTML(duplicateData?.notes || settings.termsAndConditions || "")}" />
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Invoice Line Items</span>
            <button type="button" id="add-line-btn" class="btn btn-soft btn-sm">+ Add Item</button>
          </div>
          <div class="table-wrap">
            <table class="data-table invoice-items-table">
              <thead>
                <tr>
                  <th style="min-width:200px;">Product</th>
                  <th style="width:85px;">Qty</th>
                  <th style="width:110px;">Rate (₹)</th>
                  <th style="width:85px;">Disc %</th>
                  <th style="width:85px;">GST %</th>
                  <th class="text-right" style="width:120px;">Total</th>
                  <th style="width:44px;"></th>
                </tr>
              </thead>
              <tbody id="sale-items-body"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card card-body invoice-totals-box">
        <h3 style="font-size:16px;margin-bottom:4px;">Summary &amp; Payment</h3>
        <div class="total-line"><span>Subtotal</span><span id="sum-subtotal" class="mono">₹0.00</span></div>
        <div class="total-line"><span>Discount</span><span id="sum-discount" class="mono text-danger">-₹0.00</span></div>
        <div class="total-line"><span>Taxable Value</span><span id="sum-taxable" class="mono">₹0.00</span></div>
        <div class="total-line" id="row-cgst"><span>CGST</span><span id="sum-cgst" class="mono">₹0.00</span></div>
        <div class="total-line" id="row-sgst"><span>SGST</span><span id="sum-sgst" class="mono">₹0.00</span></div>
        <div class="total-line hidden" id="row-igst"><span>IGST</span><span id="sum-igst" class="mono">₹0.00</span></div>

        <div class="form-group" style="margin-top:6px;">
          <label class="form-label">Shipping / Additional Charges (₹)</label>
          <input type="number" step="0.01" min="0" id="sale-shipping" name="shippingCharges" class="form-control" value="${duplicateData?.shippingCharges || 0}" />
        </div>

        <div class="total-line"><span>Round-off</span><span id="sum-roundoff" class="mono">₹0.00</span></div>
        <div class="total-line grand"><span>Grand Total</span><span id="sum-grand" class="mono">₹0.00</span></div>

        <hr style="border:none;border-top:1px solid var(--border-light);width:100%;" />

        <div class="form-group">
          <label class="form-label">Amount Received (₹)</label>
          <div class="flex-row">
            <input type="number" step="0.01" min="0" id="sale-received" name="amountReceived" class="form-control" value="0" />
            <button type="button" id="mark-full-paid-btn" class="btn btn-soft btn-sm">Full</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select name="paymentMethod" class="form-control">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank Transfer</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div class="total-line"><span>Balance Due</span><span id="sum-balance" class="mono text-danger" style="font-weight:700;">₹0.00</span></div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          <button type="submit" data-status="final" class="btn btn-primary" id="save-final-btn">Save &amp; Generate Invoice</button>
          <button type="button" id="save-draft-btn" class="btn btn-secondary">Save as Draft</button>
        </div>
      </div>
    </form>
  `;

  const tbody = container.querySelector("#sale-items-body");
  const partySel = container.querySelector("#sale-party-select");
  const supplySel = container.querySelector("#sale-supply-type");
  const shippingEl = container.querySelector("#sale-shipping");
  const receivedEl = container.querySelector("#sale-received");

  partySel.addEventListener("change", () => {
    const p = customers.find((x) => x.id === partySel.value);
    if (p && p.state && business.state) {
      supplySel.value = p.state.toLowerCase() === business.state.toLowerCase() ? "intra" : "inter";
      recalculate();
    }
  });

  function renderLines() {
    tbody.innerHTML = items.map((it, idx) => `
      <tr>
        <td>
          <select class="form-control line-prod" data-idx="${idx}">
            <option value="">-- Custom / Select Product --</option>
            ${products.map((p) => `<option value="${p.id}" ${it.productId === p.id ? "selected" : ""}>${escapeHTML(p.name)} (Stock: ${p.currentStock})</option>`).join("")}
          </select>
          ${!it.productId ? `<input type="text" class="form-control line-name" data-idx="${idx}" placeholder="Item description" value="${escapeHTML(it.name)}" style="margin-top:4px;" />` : ""}
        </td>
        <td><input type="number" step="0.01" min="0.01" class="form-control line-qty" data-idx="${idx}" value="${it.quantity}" /></td>
        <td><input type="number" step="0.01" min="0" class="form-control line-price" data-idx="${idx}" value="${it.price}" /></td>
        <td><input type="number" step="0.01" min="0" max="100" class="form-control line-disc" data-idx="${idx}" value="${it.discountPct}" /></td>
        <td><input type="number" step="0.01" min="0" max="28" class="form-control line-gst" data-idx="${idx}" value="${it.gstRate}" /></td>
        <td class="text-right mono line-total" data-idx="${idx}">₹0.00</td>
        <td><button type="button" class="btn-icon remove-line-btn" data-idx="${idx}" title="Remove">&times;</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".line-prod").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.idx);
        const prod = products.find((p) => p.id === sel.value);
        if (prod) {
          items[idx] = {
            ...items[idx],
            productId: prod.id,
            name: prod.name,
            unit: prod.unit || "PCS",
            price: prod.sellingPrice || 0,
            gstRate: prod.gstRate ?? 18
          };
        } else {
          items[idx].productId = "";
        }
        renderLines();
      });
    });

    tbody.querySelectorAll(".line-name").forEach((inp) => {
      inp.addEventListener("input", () => { items[Number(inp.dataset.idx)].name = inp.value; });
    });
    tbody.querySelectorAll(".line-qty").forEach((inp) => {
      inp.addEventListener("input", () => { items[Number(inp.dataset.idx)].quantity = Number(inp.value || 0); recalculate(); });
    });
    tbody.querySelectorAll(".line-price").forEach((inp) => {
      inp.addEventListener("input", () => { items[Number(inp.dataset.idx)].price = Number(inp.value || 0); recalculate(); });
    });
    tbody.querySelectorAll(".line-disc").forEach((inp) => {
      inp.addEventListener("input", () => { items[Number(inp.dataset.idx)].discountPct = Number(inp.value || 0); recalculate(); });
    });
    tbody.querySelectorAll(".line-gst").forEach((inp) => {
      inp.addEventListener("input", () => { items[Number(inp.dataset.idx)].gstRate = Number(inp.value || 0); recalculate(); });
    });
    tbody.querySelectorAll(".remove-line-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (items.length === 1) return;
        items.splice(Number(btn.dataset.idx), 1);
        renderLines();
      });
    });

    recalculate();
  }

  let computedTotals = {};
  function recalculate() {
    const isInter = supplySel.value === "inter";
    let subtotal = 0;
    let totalDiscount = 0;
    let taxableAmount = 0;
    let gstTotal = 0;

    items.forEach((it, idx) => {
      const base = round2(Number(it.quantity || 0) * Number(it.price || 0));
      const disc = round2(base * (Number(it.discountPct || 0) / 100));
      const taxable = round2(base - disc);
      const gst = round2(taxable * (Number(it.gstRate || 0) / 100));
      const lineTotal = round2(taxable + gst);

      it.taxableAmount = taxable;
      it.gstAmount = gst;
      it.total = lineTotal;

      subtotal = round2(subtotal + base);
      totalDiscount = round2(totalDiscount + disc);
      taxableAmount = round2(taxableAmount + taxable);
      gstTotal = round2(gstTotal + gst);

      const cell = tbody.querySelector(`.line-total[data-idx="${idx}"]`);
      if (cell) cell.textContent = formatCurrency(lineTotal, currency);
    });

    const shipping = round2(shippingEl.value || 0);
    const cgstTotal = isInter ? 0 : round2(gstTotal / 2);
    const sgstTotal = isInter ? 0 : round2(gstTotal - cgstTotal);
    const igstTotal = isInter ? gstTotal : 0;

    const rawGrand = round2(taxableAmount + gstTotal + shipping);
    const grandTotal = Math.round(rawGrand);
    const roundOff = round2(grandTotal - rawGrand);
    const received = round2(receivedEl.value || 0);
    const balance = round2(Math.max(0, grandTotal - received));

    computedTotals = {
      isInterState: isInter,
      subtotal,
      totalDiscount,
      taxableAmount,
      cgstTotal,
      sgstTotal,
      igstTotal,
      gstTotal,
      shippingCharges: shipping,
      roundOff,
      grandTotal
    };

    container.querySelector("#sum-subtotal").textContent = formatCurrency(subtotal, currency);
    container.querySelector("#sum-discount").textContent = `-${formatCurrency(totalDiscount, currency)}`;
    container.querySelector("#sum-taxable").textContent = formatCurrency(taxableAmount, currency);
    container.querySelector("#sum-cgst").textContent = formatCurrency(cgstTotal, currency);
    container.querySelector("#sum-sgst").textContent = formatCurrency(sgstTotal, currency);
    container.querySelector("#sum-igst").textContent = formatCurrency(igstTotal, currency);
    container.querySelector("#row-cgst").classList.toggle("hidden", isInter);
    container.querySelector("#row-sgst").classList.toggle("hidden", isInter);
    container.querySelector("#row-igst").classList.toggle("hidden", !isInter);
    container.querySelector("#sum-roundoff").textContent = formatCurrency(roundOff, currency);
    container.querySelector("#sum-grand").textContent = formatCurrency(grandTotal, currency);
    container.querySelector("#sum-balance").textContent = formatCurrency(balance, currency);
  }

  container.querySelector("#add-line-btn").addEventListener("click", () => {
    items.push({ productId: "", name: "", quantity: 1, unit: "PCS", price: 0, discountPct: 0, gstRate: 18 });
    renderLines();
  });
  container.querySelector("#mark-full-paid-btn").addEventListener("click", () => {
    receivedEl.value = computedTotals.grandTotal || 0;
    recalculate();
  });
  supplySel.addEventListener("change", recalculate);
  shippingEl.addEventListener("input", recalculate);
  receivedEl.addEventListener("input", recalculate);

  async function submitInvoice(status) {
    const validItems = items.filter((it) => (it.name || it.productId) && it.quantity > 0);
    if (validItems.length === 0) {
      showToast("Add at least one valid line item.", "error");
      return;
    }
    const fd = new FormData(container.querySelector("#sale-builder-form"));
    const party = customers.find((c) => c.id === fd.get("partyId"));
    const btn = container.querySelector("#save-final-btn");
    const draftBtn = container.querySelector("#save-draft-btn");
    btn.disabled = true;
    draftBtn.disabled = true;

    try {
      const res = await createSaleInvoice(
        businessId,
        {
          idempotencyKey,
          status,
          date: fd.get("date"),
          dueDate: fd.get("dueDate"),
          partyId: party?.id || "",
          partyName: party?.name || "Walk-in Customer",
          partyMobile: party?.mobile || "",
          partyState: party?.state || "",
          partyGstin: party?.gstin || "",
          paymentMethod: fd.get("paymentMethod"),
          amountReceived: Number(fd.get("amountReceived") || 0),
          notes: fd.get("notes"),
          items: validItems,
          ...computedTotals
        },
        ctx.user,
        settings
      );
      showToast(`Invoice ${res.invoiceNumber} saved!`, "success");
      window.location.hash = `#/sales/${res.id}`;
    } catch (err) {
      showToast(err.message || "Failed to save invoice.", "error");
      btn.disabled = false;
      draftBtn.disabled = false;
    }
  }

  container.querySelector("#sale-builder-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitInvoice("final");
  });
  container.querySelector("#save-draft-btn").addEventListener("click", () => submitInvoice("draft"));

  renderLines();
}

export async function renderSaleDetail(container, ctx, params) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";
  const snap = await getDoc(doc(db, "sales", params.id));

  if (!snap.exists() || snap.data().businessId !== businessId) {
    container.innerHTML = `<div class="state-box"><p class="text-danger">Invoice not found.</p><a href="#/sales" class="btn btn-secondary">Back to Sales</a></div>`;
    return;
  }
  const sale = { id: snap.id, ...snap.data() };
  let templateMode = "a4";

  function renderPaper() {
    const waMsg = `Hello ${sale.partyName}, your invoice ${sale.invoiceNumber} dated ${formatDate(sale.date)} for ${formatCurrency(sale.grandTotal, currency)} is ready. Balance due: ${formatCurrency(sale.balanceDue, currency)}. Thank you - ${business.name}`;

    container.innerHTML = `
      <div class="page-toolbar no-print">
        <div class="flex-row">
          <a href="#/sales" class="btn btn-secondary btn-sm">&larr; Invoices</a>
          <span class="badge ${sale.status === "cancelled" ? "badge-danger" : "badge-brand"}">${escapeHTML(sale.status.toUpperCase())}</span>
        </div>
        <div class="filter-bar">
          <button id="toggle-template-btn" class="btn btn-secondary btn-sm">${templateMode === "a4" ? "Switch to 80mm Thermal" : "Switch to A4 Invoice"}</button>
          <a href="${buildWhatsAppURL(sale.partyMobile, waMsg)}" target="_blank" rel="noopener" class="btn btn-soft btn-sm">Share WhatsApp</a>
          <button onclick="window.print()" class="btn btn-primary btn-sm">Print / Download PDF</button>
          ${sale.status !== "cancelled" && can("deleteTransactions") ? `<button id="cancel-inv-btn" class="btn btn-danger-soft btn-sm">Cancel Invoice</button>` : ""}
        </div>
      </div>

      <div class="invoice-paper ${templateMode === "thermal" ? "thermal" : ""}">
        <div class="invoice-paper-header">
          <div>
            ${business.logoUrl && templateMode === "a4" ? `<img src="${escapeHTML(business.logoUrl)}" class="invoice-logo" alt="Logo" style="margin-bottom:8px;" />` : ""}
            <h2 style="font-size:${templateMode === "thermal" ? "16px" : "22px"};">${escapeHTML(business.name)}</h2>
            <div style="font-size:12px;color:#444;">
              ${escapeHTML(business.address || "")} ${escapeHTML(business.district || "")} ${escapeHTML(business.state || "")}<br/>
              Mobile: ${escapeHTML(business.mobile || "")} ${business.gstin ? `| GSTIN: ${escapeHTML(business.gstin)}` : ""}
            </div>
          </div>
          <div class="text-right">
            <div style="font-size:12px;text-transform:uppercase;color:#666;font-weight:700;">Tax Invoice</div>
            <div class="mono" style="font-size:18px;font-weight:800;color:var(--brand-primary);">${escapeHTML(sale.invoiceNumber)}</div>
            <div style="font-size:12px;">Date: ${formatDate(sale.date)}</div>
            <div style="font-size:12px;">Due: ${formatDate(sale.dueDate)}</div>
          </div>
        </div>

        <div style="margin-bottom:16px;font-size:13px;">
          <strong>Bill To:</strong> ${escapeHTML(sale.partyName)}
          ${sale.partyMobile ? ` &bull; ${escapeHTML(sale.partyMobile)}` : ""}
          ${sale.partyGstin ? ` &bull; GSTIN: ${escapeHTML(sale.partyGstin)}` : ""}
        </div>

        <table class="data-table" style="margin-bottom:18px;">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Rate</th>
              <th class="text-right">GST</th>
              <th class="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(sale.items || []).map((it, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHTML(it.name)}</td>
                <td class="text-right mono">${it.quantity} ${escapeHTML(it.unit || "")}</td>
                <td class="text-right mono">${formatCurrency(it.price, currency)}</td>
                <td class="text-right">${it.gstRate}%</td>
                <td class="text-right mono" style="font-weight:700;">${formatCurrency(it.total, currency)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div style="display:flex;justify-content:flex-end;">
          <div style="width:280px;display:flex;flex-direction:column;gap:6px;font-size:13px;">
            <div class="total-line"><span>Taxable Amount</span><span class="mono">${formatCurrency(sale.taxableAmount, currency)}</span></div>
            ${sale.isInterState
              ? `<div class="total-line"><span>IGST</span><span class="mono">${formatCurrency(sale.igstTotal, currency)}</span></div>`
              : `<div class="total-line"><span>CGST</span><span class="mono">${formatCurrency(sale.cgstTotal, currency)}</span></div>
                 <div class="total-line"><span>SGST</span><span class="mono">${formatCurrency(sale.sgstTotal, currency)}</span></div>`
            }
            ${sale.shippingCharges ? `<div class="total-line"><span>Shipping</span><span class="mono">${formatCurrency(sale.shippingCharges, currency)}</span></div>` : ""}
            <div class="total-line grand"><span>Grand Total</span><span class="mono">${formatCurrency(sale.grandTotal, currency)}</span></div>
            <div class="total-line"><span>Received</span><span class="mono text-success">${formatCurrency(sale.amountReceived, currency)}</span></div>
            <div class="total-line"><span>Balance Due</span><span class="mono text-danger">${formatCurrency(sale.balanceDue, currency)}</span></div>
          </div>
        </div>

        ${sale.notes ? `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#555;"><strong>Notes:</strong> ${escapeHTML(sale.notes)}</div>` : ""}
      </div>
    `;

    container.querySelector("#toggle-template-btn").addEventListener("click", () => {
      templateMode = templateMode === "a4" ? "thermal" : "a4";
      renderPaper();
    });

    container.querySelector("#cancel-inv-btn")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Cancel Invoice",
        message: `Cancel ${sale.invoiceNumber}? This will restore product stock and post a reversal entry in the customer's Khata ledger.`,
        confirmText: "Cancel Invoice",
        danger: true
      });
      if (!ok) return;
      try {
        await cancelSaleInvoice(businessId, sale.id, ctx.user);
        showToast("Invoice cancelled & reversed.", "success");
        renderSaleDetail(container, ctx, params);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  renderPaper();
}
