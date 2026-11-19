import { deleteProductValidated, listCollection, saveProduct, uploadBusinessFile } from "./database.js";
import {
  confirmDialog,
  escapeHTML,
  exportToCSV,
  formatCurrency,
  openModal,
  showToast
} from "./utilities.js";

export function openProductModal(ctx, existing = null, onSaved = null) {
  const close = openModal({
    title: existing ? `Edit Product — ${existing.name}` : "Add New Product",
    large: true,
    bodyHTML: `
      <form id="product-modal-form" class="form-grid-3">
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Product Name *</label>
          <input type="text" name="name" class="form-control" required value="${escapeHTML(existing?.name || "")}" placeholder="e.g. Havells LED Bulb 9W" />
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input type="text" name="category" class="form-control" value="${escapeHTML(existing?.category || "General")}" placeholder="Electrical, Grocery..." />
        </div>
        <div class="form-group">
          <label class="form-label">Product Code</label>
          <input type="text" name="code" class="form-control" value="${escapeHTML(existing?.code || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">SKU</label>
          <input type="text" name="sku" class="form-control" value="${escapeHTML(existing?.sku || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Barcode</label>
          <input type="text" name="barcode" class="form-control" value="${escapeHTML(existing?.barcode || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Brand</label>
          <input type="text" name="brand" class="form-control" value="${escapeHTML(existing?.brand || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Unit *</label>
          <select name="unit" class="form-control">
            ${["PCS", "KG", "GM", "LTR", "ML", "BOX", "PKT", "MTR", "SET", "DOZEN"].map(
              (u) => `<option value="${u}" ${existing?.unit === u ? "selected" : ""}>${u}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">GST % *</label>
          <select name="gstRate" class="form-control">
            ${[0, 5, 12, 18, 28].map(
              (r) => `<option value="${r}" ${Number(existing?.gstRate ?? 18) === r ? "selected" : ""}>${r}%</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Purchase Price (₹) *</label>
          <input type="number" step="0.01" min="0" name="purchasePrice" class="form-control" required value="${existing?.purchasePrice ?? 0}" />
        </div>
        <div class="form-group">
          <label class="form-label">Selling Price (₹) *</label>
          <input type="number" step="0.01" min="0" name="sellingPrice" class="form-control" required value="${existing?.sellingPrice ?? 0}" />
        </div>
        <div class="form-group">
          <label class="form-label">MRP (₹)</label>
          <input type="number" step="0.01" min="0" name="mrp" class="form-control" value="${existing?.mrp ?? 0}" />
        </div>
        ${!existing ? `
          <div class="form-group">
            <label class="form-label">Opening Stock</label>
            <input type="number" step="0.01" min="0" name="openingStock" class="form-control" value="0" />
          </div>
        ` : ""}
        <div class="form-group">
          <label class="form-label">Minimum Stock Alert</label>
          <input type="number" step="0.01" min="0" name="minStock" class="form-control" value="${existing?.minStock ?? 5}" />
        </div>
        <div class="form-group">
          <label class="form-label">Product Image</label>
          <input type="file" name="image" class="form-control" accept="image/*" />
        </div>
        <div class="form-group full">
          <label class="form-label">Description</label>
          <textarea name="description" class="form-control">${escapeHTML(existing?.description || "")}</textarea>
        </div>
      </form>
    `,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="prod-cancel">Cancel</button>
      <button type="submit" form="product-modal-form" class="btn btn-primary" id="prod-save">${existing ? "Update Product" : "Save Product"}</button>
    `,
    onMount: (el, close) => {
      el.querySelector("#prod-cancel").addEventListener("click", close);
      el.querySelector("#product-modal-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = el.querySelector("#prod-save");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
          let imageUrl = existing?.imageUrl || "";
          const file = fd.get("image");
          if (file && file.size > 0) {
            imageUrl = await uploadBusinessFile(ctx.businessId, "products", file);
          }
          const vals = { ...Object.fromEntries(fd.entries()), imageUrl };
          await saveProduct(ctx.businessId, vals, existing?.id || null, ctx.user);
          showToast(existing ? "Product updated." : "Product added.", "success");
          close();
          if (onSaved) onSaved();
        } catch (err) {
          showToast(err.message || "Failed to save product.", "error");
          btn.disabled = false;
          btn.textContent = existing ? "Update Product" : "Save Product";
        }
      });
    }
  });
}

export async function renderProducts(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" id="prod-search" class="form-control" placeholder="Search name, SKU, barcode..." />
        </div>
        <select id="prod-cat-filter" class="form-control" style="width:auto;">
          <option value="ALL">All Categories</option>
        </select>
      </div>
      <div class="filter-bar">
        <button id="export-prod-btn" class="btn btn-secondary">Export CSV</button>
        ${can("manageProducts") ? `<button id="add-prod-btn" class="btn btn-primary">+ Add Product</button>` : ""}
      </div>
    </div>

    <div class="card">
      <div id="products-table-wrap" class="table-wrap">
        <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading products...</p></div>
      </div>
    </div>
  `;

  const products = await listCollection("products", businessId, "name", "asc", 500);
  const categories = [...new Set(products.map((p) => p.category || "General"))];
  const catEl = container.querySelector("#prod-cat-filter");
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  });

  const searchEl = container.querySelector("#prod-search");
  const wrap = container.querySelector("#products-table-wrap");

  function renderTable() {
    const q = searchEl.value.trim().toLowerCase();
    const cat = catEl.value;
    const filtered = products.filter((p) => {
      const catOk = cat === "ALL" || (p.category || "General") === cat;
      const qOk =
        !q ||
        (p.name || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q);
      return catOk && qOk;
    });

    if (filtered.length === 0) {
      wrap.innerHTML = `<div class="state-box"><p class="text-muted">No products found.</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU / Barcode</th>
            <th>Category</th>
            <th class="text-right">Purchase</th>
            <th class="text-right">Selling</th>
            <th class="text-right">GST</th>
            <th class="text-right">Stock</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((p) => {
            const stock = Number(p.currentStock || 0);
            const low = stock <= (p.minStock || 0);
            return `
              <tr>
                <td>
                  <div class="flex-row">
                    ${p.imageUrl ? `<img src="${escapeHTML(p.imageUrl)}" class="product-thumb" alt="" />` : `<div class="product-thumb" style="display:grid;place-items:center;font-weight:700;color:var(--brand-primary);">${escapeHTML((p.name || "P")[0].toUpperCase())}</div>`}
                    <div>
                      <div style="font-weight:700;">${escapeHTML(p.name)}</div>
                      <div class="text-muted" style="font-size:11.5px;">${escapeHTML(p.brand || "")}</div>
                    </div>
                  </div>
                </td>
                <td class="mono" style="font-size:12px;">
                  ${escapeHTML(p.sku || p.code || "—")}
                  ${p.barcode ? `<div class="text-muted">${escapeHTML(p.barcode)}</div>` : ""}
                </td>
                <td><span class="badge badge-neutral">${escapeHTML(p.category || "General")}</span></td>
                <td class="text-right mono">${formatCurrency(p.purchasePrice, currency)}</td>
                <td class="text-right mono" style="font-weight:700;">${formatCurrency(p.sellingPrice, currency)}</td>
                <td class="text-right">${p.gstRate ?? 0}%</td>
                <td class="text-right">
                  <span class="badge ${stock <= 0 ? "badge-danger" : low ? "badge-warning" : "badge-success"}">
                    ${stock} ${escapeHTML(p.unit || "PCS")}
                  </span>
                </td>
                <td class="text-right">
                  ${can("manageProducts") ? `<button class="btn btn-secondary btn-sm edit-prod-btn" data-id="${p.id}">Edit</button>` : ""}
                  ${can("manageProducts") ? `<button class="btn btn-danger-soft btn-sm del-prod-btn" data-id="${p.id}">Delete</button>` : ""}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll(".edit-prod-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const p = products.find((x) => x.id === b.dataset.id);
        openProductModal(ctx, p, () => renderProducts(container, ctx));
      });
    });

    wrap.querySelectorAll(".del-prod-btn").forEach((b) => {
      b.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete Product",
          message: "Delete this product? Products with invoice or stock movement history cannot be deleted.",
          confirmText: "Delete",
          danger: true
        });
        if (!ok) return;
        try {
          await deleteProductValidated(businessId, b.dataset.id, ctx.user);
          showToast("Product deleted.", "success");
          renderProducts(container, ctx);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }

  searchEl.addEventListener("input", renderTable);
  catEl.addEventListener("change", renderTable);
  container.querySelector("#add-prod-btn")?.addEventListener("click", () => openProductModal(ctx, null, () => renderProducts(container, ctx)));
  container.querySelector("#export-prod-btn").addEventListener("click", () => {
    exportToCSV(
      "products.csv",
      ["Name", "Code", "SKU", "Barcode", "Category", "Purchase Price", "Selling Price", "MRP", "GST%", "Stock", "Unit"],
      products.map((p) => [p.name, p.code || "", p.sku || "", p.barcode || "", p.category || "", p.purchasePrice, p.sellingPrice, p.mrp, p.gstRate, p.currentStock, p.unit])
    );
  });
  renderTable();
}
