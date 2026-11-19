import { listCollection, saveExpense, uploadBusinessFile } from "./database.js";
import {
  escapeHTML,
  exportToCSV,
  formatCurrency,
  formatDate,
  openModal,
  showToast,
  todayISO
} from "./utilities.js";

const EXPENSE_CATEGORIES = [
  "Rent", "Electricity", "Salary", "Transportation", "Food",
  "Maintenance", "Marketing", "Internet", "Other"
];

export async function renderExpenses(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <select id="exp-cat-filter" class="form-control" style="width:auto;">
          <option value="ALL">All Categories</option>
          ${EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <input type="month" id="exp-month-filter" class="form-control" style="width:auto;" value="${todayISO().slice(0, 7)}" />
      </div>
      <div class="filter-bar">
        <button id="exp-csv-btn" class="btn btn-secondary">Export CSV</button>
        ${can("manageExpenses") ? `<button id="add-exp-btn" class="btn btn-primary">+ Add Expense</button>` : ""}
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));" id="exp-kpis"></div>

    <div class="card">
      <div id="expenses-table-wrap" class="table-wrap">
        <div class="state-box"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  const expenses = await listCollection("expenses", businessId, "date", "desc", 500);
  const catEl = container.querySelector("#exp-cat-filter");
  const monthEl = container.querySelector("#exp-month-filter");
  const wrap = container.querySelector("#expenses-table-wrap");

  function renderTable() {
    const cat = catEl.value;
    const ym = monthEl.value;
    const list = expenses.filter((e) => {
      const catOk = cat === "ALL" || e.category === cat;
      const mOk = !ym || (e.date || "").startsWith(ym);
      return catOk && mOk;
    });

    const filteredTotal = list.reduce((a, e) => a + (e.amount || 0), 0);
    const allTotal = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    container.querySelector("#exp-kpis").innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Filtered Total</div><div class="kpi-value text-warning">${formatCurrency(filteredTotal, currency)}</div><div class="kpi-sub">${list.length} entries</div></div>
      <div class="kpi-card"><div class="kpi-label">All-Time Expenses</div><div class="kpi-value">${formatCurrency(allTotal, currency)}</div><div class="kpi-sub">${expenses.length} total records</div></div>
      <div class="kpi-card"><div class="kpi-label">Top Category</div><div class="kpi-value" style="font-size:18px;">${escapeHTML(list[0]?.category || "—")}</div><div class="kpi-sub">Most recent in filter</div></div>
    `;

    if (list.length === 0) {
      wrap.innerHTML = `<div class="state-box"><p class="text-muted">No expenses found for this period.</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Description</th>
            <th>Method</th>
            <th>Receipt</th>
            <th class="text-right">Amount</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((e) => `
            <tr>
              <td>${formatDate(e.date)}</td>
              <td><span class="badge badge-neutral">${escapeHTML(e.category)}</span></td>
              <td>${escapeHTML(e.description || "—")}</td>
              <td>${escapeHTML((e.paymentMethod || "cash").toUpperCase())}</td>
              <td>${e.attachmentUrl ? `<a href="${escapeHTML(e.attachmentUrl)}" target="_blank" rel="noopener">View</a>` : "—"}</td>
              <td class="text-right mono text-warning" style="font-weight:700;">${formatCurrency(e.amount, currency)}</td>
              <td class="text-right">
                ${can("manageExpenses") ? `<button class="btn btn-secondary btn-sm edit-exp-btn" data-id="${e.id}">Edit</button>` : "—"}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll(".edit-exp-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const exp = expenses.find((x) => x.id === b.dataset.id);
        openExpenseModal(exp);
      });
    });
  }

  function openExpenseModal(existing = null) {
    const close = openModal({
      title: existing ? "Edit Expense" : "Add Expense",
      bodyHTML: `
        <form id="exp-form" class="form-grid">
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select name="category" class="form-control" required>
              ${EXPENSE_CATEGORIES.map((c) => `<option value="${c}" ${existing?.category === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount (₹) *</label>
            <input type="number" step="0.01" min="0.01" name="amount" class="form-control" required value="${existing?.amount || ""}" />
          </div>
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input type="date" name="date" class="form-control" required value="${existing?.date || todayISO()}" />
          </div>
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select name="paymentMethod" class="form-control">
              ${["cash", "upi", "bank", "card"].map((m) => `<option value="${m}" ${existing?.paymentMethod === m ? "selected" : ""}>${m.toUpperCase()}</option>`).join("")}
            </select>
          </div>
          <div class="form-group full">
            <label class="form-label">Description *</label>
            <input type="text" name="description" class="form-control" required value="${escapeHTML(existing?.description || "")}" placeholder="e.g. Monthly shop rent" />
          </div>
          <div class="form-group full">
            <label class="form-label">Receipt Attachment (Optional)</label>
            <input type="file" name="receipt" class="form-control" accept="image/*,application/pdf" />
          </div>
        </form>
      `,
      footerHTML: `
        <button type="button" class="btn btn-secondary" id="exp-cancel">Cancel</button>
        <button type="submit" form="exp-form" class="btn btn-primary" id="exp-save">Save Expense</button>
      `,
      onMount: (el, close) => {
        el.querySelector("#exp-cancel").addEventListener("click", close);
        el.querySelector("#exp-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const btn = el.querySelector("#exp-save");
          btn.disabled = true;
          try {
            let attachmentUrl = existing?.attachmentUrl || "";
            const file = fd.get("receipt");
            if (file && file.size > 0) {
              attachmentUrl = await uploadBusinessFile(businessId, "expenses", file);
            }
            await saveExpense(businessId, { ...Object.fromEntries(fd.entries()), attachmentUrl }, existing?.id || null, ctx.user);
            showToast("Expense saved.", "success");
            close();
            renderExpenses(container, ctx);
          } catch (err) {
            showToast(err.message || "Failed to save expense.", "error");
            btn.disabled = false;
          }
        });
      }
    });
  }

  catEl.addEventListener("change", renderTable);
  monthEl.addEventListener("change", renderTable);
  container.querySelector("#add-exp-btn")?.addEventListener("click", () => openExpenseModal());
  container.querySelector("#exp-csv-btn").addEventListener("click", () => {
    exportToCSV("expenses.csv", ["Date", "Category", "Description", "Method", "Amount"], expenses.map((e) => [e.date, e.category, e.description, e.paymentMethod, e.amount]));
  });
  renderTable();
}
