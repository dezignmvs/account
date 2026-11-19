import { adjustStock, getBusinessSettings, listCollection } from "./database.js";
import { escapeHTML, formatCurrency, formatDate, openModal, showToast } from "./utilities.js";

export async function renderInventory(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <button class="btn btn-soft btn-sm inv-filter active" data-f="ALL">All Items</button>
        <button class="btn btn-secondary btn-sm inv-filter" data-f="LOW">Low Stock</button>
        <button class="btn btn-secondary btn-sm inv-filter" data-f="OUT">Out of Stock</button>
      </div>
      <div class="filter-bar">
        ${can("manageProducts") ? `<button id="stock-adjust-btn" class="btn btn-primary">+ Stock In / Out</button>` : ""}
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));" id="inv-kpis"></div>

    <div class="card" style="margin-bottom:18px;">
      <div class="card-header">
        <span class="card-title">Current Stock Levels</span>
      </div>
      <div id="inv-stock-table" class="table-wrap"><div class="state-box"><div class="spinner"></div></div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Stock Movement History (Audit Trail)</span>
      </div>
      <div id="inv-movements-table" class="table-wrap"><div class="state-box"><div class="spinner"></div></div></div>
    </div>
  `;

  const [products, movements, settings] = await Promise.all([
    listCollection("products", businessId, "name", "asc", 500),
    listCollection("stockMovements", businessId, "createdAt", "desc", 200),
    getBusinessSettings(businessId)
  ]);

  const totalValue = products.reduce((a, p) => a + Math.max(0, p.currentStock || 0) * (p.purchasePrice || 0), 0);
  const lowCount = products.filter((p) => (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.minStock || 0)).length;
  const outCount = products.filter((p) => (p.currentStock || 0) <= 0).length;

  container.querySelector("#inv-kpis").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Inventory Valuation (Cost)</div>
      <div class="kpi-value">${formatCurrency(totalValue, currency)}</div>
      <div class="kpi-sub">${products.length} total SKUs</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Low Stock Items</div>
      <div class="kpi-value text-warning">${lowCount}</div>
      <div class="kpi-sub">At or below minimum level</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Out of Stock</div>
      <div class="kpi-value text-danger">${outCount}</div>
      <div class="kpi-sub">${settings.allowNegativeStock ? "Negative stock allowed" : "Negative stock blocked"}</div>
    </div>
  `;

  let filterMode = "ALL";
  const stockWrap = container.querySelector("#inv-stock-table");

  function renderStockTable() {
    const list = products.filter((p) => {
      if (filterMode === "LOW") return (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.minStock || 0);
      if (filterMode === "OUT") return (p.currentStock || 0) <= 0;
      return true;
    });
    if (list.length === 0) {
      stockWrap.innerHTML = `<div class="state-box"><p class="text-muted">No products in this filter.</p></div>`;
      return;
    }
    stockWrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th class="text-right">Current Stock</th>
            <th class="text-right">Min Stock</th>
            <th class="text-right">Stock Value</th>
            <th class="text-right">Quick Adjust</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => `
            <tr>
              <td><div style="font-weight:700;">${escapeHTML(p.name)}</div><div class="text-muted" style="font-size:11.5px;">${escapeHTML(p.sku || "")}</div></td>
              <td class="text-right"><span class="badge ${(p.currentStock || 0) <= 0 ? "badge-danger" : (p.currentStock || 0) <= (p.minStock || 0) ? "badge-warning" : "badge-success"}">${p.currentStock} ${escapeHTML(p.unit || "PCS")}</span></td>
              <td class="text-right">${p.minStock || 0}</td>
              <td class="text-right mono">${formatCurrency(Math.max(0, p.currentStock || 0) * (p.purchasePrice || 0), currency)}</td>
              <td class="text-right">
                ${can("manageProducts") ? `<button class="btn btn-secondary btn-sm quick-adj-btn" data-id="${p.id}">Adjust</button>` : "—"}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    stockWrap.querySelectorAll(".quick-adj-btn").forEach((b) => {
      b.addEventListener("click", () => openAdjustModal(b.dataset.id));
    });
  }

  const movWrap = container.querySelector("#inv-movements-table");
  if (movements.length === 0) {
    movWrap.innerHTML = `<div class="state-box"><p class="text-muted">No stock movements recorded yet.</p></div>`;
  } else {
    movWrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Product</th>
            <th>Type</th>
            <th class="text-right">Change</th>
            <th class="text-right">Stock After</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${movements.map((m) => `
            <tr>
              <td>${formatDate(m.createdAt)}</td>
              <td style="font-weight:600;">${escapeHTML(m.productName)}</td>
              <td><span class="badge badge-neutral">${escapeHTML(m.type)}</span></td>
              <td class="text-right mono ${m.quantityChange >= 0 ? "text-success" : "text-danger"}" style="font-weight:700;">
                ${m.quantityChange >= 0 ? `+${m.quantityChange}` : m.quantityChange}
              </td>
              <td class="text-right mono">${m.stockAfter}</td>
              <td class="text-muted">${escapeHTML(m.notes || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function openAdjustModal(defaultProductId = "") {
    if (products.length === 0) {
      showToast("Add products first.", "warning");
      return;
    }
    const close = openModal({
      title: "Stock In / Out / Adjustment",
      bodyHTML: `
        <form id="adj-form" class="form-grid">
          <div class="form-group full">
            <label class="form-label">Product *</label>
            <select name="productId" class="form-control" required>
              ${products.map((p) => `<option value="${p.id}" ${p.id === defaultProductId ? "selected" : ""}>${escapeHTML(p.name)} (Current: ${p.currentStock} ${escapeHTML(p.unit || "PCS")})</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Operation *</label>
            <select name="type" class="form-control" required>
              <option value="in">Stock In (+)</option>
              <option value="out">Stock Out (-)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Quantity *</label>
            <input type="number" step="0.01" min="0.01" name="quantity" class="form-control" required />
          </div>
          <div class="form-group full">
            <label class="form-label">Reason / Notes</label>
            <input type="text" name="notes" class="form-control" placeholder="e.g. Damaged goods, Physical count correction" />
          </div>
        </form>
      `,
      footerHTML: `
        <button type="button" class="btn btn-secondary" id="adj-cancel">Cancel</button>
        <button type="submit" form="adj-form" class="btn btn-primary" id="adj-save">Apply Stock Update</button>
      `,
      onMount: (el, close) => {
        el.querySelector("#adj-cancel").addEventListener("click", close);
        el.querySelector("#adj-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const btn = el.querySelector("#adj-save");
          btn.disabled = true;
          try {
            await adjustStock(
              businessId,
              {
                productId: fd.get("productId"),
                type: fd.get("type"),
                quantity: Number(fd.get("quantity")),
                notes: fd.get("notes"),
                allowNegative: settings.allowNegativeStock
              },
              ctx.user
            );
            showToast("Stock updated.", "success");
            close();
            renderInventory(container, ctx);
          } catch (err) {
            showToast(err.message || "Stock update failed.", "error");
            btn.disabled = false;
          }
        });
      }
    });
  }

  container.querySelectorAll(".inv-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".inv-filter").forEach((b) => {
        b.classList.remove("active", "btn-soft");
        b.classList.add("btn-secondary");
      });
      btn.classList.add("active", "btn-soft");
      btn.classList.remove("btn-secondary");
      filterMode = btn.dataset.f;
      renderStockTable();
    });
  });

  container.querySelector("#stock-adjust-btn")?.addEventListener("click", () => openAdjustModal());
  renderStockTable();
}
