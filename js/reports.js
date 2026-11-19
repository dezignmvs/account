import { listCollection } from "./database.js";
import {
  drawBarChart,
  escapeHTML,
  exportToCSV,
  formatCurrency,
  formatDate,
  getDateRange,
  round2
} from "./utilities.js";

const REPORT_TYPES = [
  { id: "pnl", label: "Profit & Loss", color: "#2D26D4" },
  { id: "cust_due", label: "Customer Outstanding", color: "#13A85B" },
  { id: "supp_due", label: "Supplier Outstanding", color: "#E24A23" },
  { id: "khata", label: "Khata Summary", color: "#F2B718" },
  { id: "sales", label: "Sales Report", color: "#13A85B" },
  { id: "purchases", label: "Purchase Report", color: "#E24A23" },
  { id: "cashflow", label: "Cash Flow", color: "#2D26D4" },
  { id: "expenses", label: "Expense Report", color: "#F2B718" }
];

export async function renderReports(container, ctx) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="dash-hero-banner" style="background-color:var(--brand-indigo);">
      <div class="hero-top-notch" style="color:var(--brand-indigo);">Store Analytics &amp; Reports</div>
      <div>
        <div class="hero-diamonds"><span></span><span class="gold"></span><span></span><span class="gold"></span></div>
        <h2 class="font-display">${escapeHTML(business.name)} — Reports</h2>
        <div style="font-size:13px;opacity:0.9;margin-top:4px;">Live financial &amp; Khata insights derived from your store transactions.</div>
      </div>
      <div class="quick-actions">
        <select id="rep-period" class="form-control" style="width:auto;border-radius:999px;font-weight:700;border:none;">
          <option value="month" selected>This Month</option>
          <option value="week">Last 7 Days</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
          <option value="custom">Custom Range</option>
        </select>
        <input type="date" id="rep-start" class="form-control hidden" style="width:auto;border-radius:999px;" />
        <input type="date" id="rep-end" class="form-control hidden" style="width:auto;border-radius:999px;" />
        <button id="rep-csv-btn" class="btn" style="background:var(--brand-gold);color:#1A1615;font-weight:800;border-radius:999px;">Export CSV</button>
        <button onclick="window.print()" class="btn" style="background:#fff;color:var(--brand-indigo);font-weight:800;border-radius:999px;">Print / PDF</button>
      </div>
    </div>

    <div class="store-pill-strip" id="report-tabs" style="margin-bottom:8px;">
      ${REPORT_TYPES.map((r, i) => `
        <button type="button" class="store-pill ${i === 0 ? "active" : ""}" data-rep="${r.id}" style="border-color:${r.color};${i === 0 ? `background:${r.color};color:#fff;` : ""}">
          <span>${r.label}</span>
          <span class="pill-dot" style="background:${i === 0 ? "#fff" : r.color};color:${i === 0 ? r.color : "#fff"};">&bull;</span>
        </button>
      `).join("")}
    </div>

    <div class="diamond-divider"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>

    <div class="folder-section">
      <div class="folder-tab-label" id="rep-folder-title">Profit &amp; Loss</div>
      <div id="rep-body"><div class="state-box"><div class="spinner"></div><p class="text-muted">Loading transaction data...</p></div></div>
    </div>
  `;

  const [sales, purchases, payments, expenses, parties, ledgerEntries] = await Promise.all([
    listCollection("sales", businessId, "date", "desc", 500),
    listCollection("purchases", businessId, "date", "desc", 500),
    listCollection("payments", businessId, "date", "desc", 500),
    listCollection("expenses", businessId, "date", "desc", 500),
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("ledgerEntries", businessId, "createdAt", "desc", 500)
  ]);

  const activeSales = sales.filter((s) => s.status === "final");
  let activeRep = "pnl";
  let currentExport = { filename: "report.csv", headers: [], rows: [] };

  const periodEl = container.querySelector("#rep-period");
  const startEl = container.querySelector("#rep-start");
  const endEl = container.querySelector("#rep-end");
  const bodyEl = container.querySelector("#rep-body");
  const folderTitleEl = container.querySelector("#rep-folder-title");

  function renderReport() {
    const isCustom = periodEl.value === "custom";
    startEl.classList.toggle("hidden", !isCustom);
    endEl.classList.toggle("hidden", !isCustom);
    const { start, end } = getDateRange(periodEl.value, startEl.value, endEl.value);
    const inRange = (d) => d && d >= start && d <= end;

    const fSales = activeSales.filter((s) => inRange(s.date));
    const fPurchases = purchases.filter((p) => inRange(p.date));
    const fPayments = payments.filter((p) => inRange(p.date));
    const fExpenses = expenses.filter((e) => inRange(e.date));
    const fLedger = ledgerEntries.filter((l) => inRange(l.date));

    const meta = REPORT_TYPES.find((r) => r.id === activeRep);
    folderTitleEl.textContent = meta?.label || "Report";

    if (activeRep === "pnl") {
      const rev = round2(fSales.reduce((a, s) => a + (s.grandTotal || 0), 0));
      const cogs = round2(fPurchases.reduce((a, p) => a + (p.grandTotal || 0), 0));
      const exp = round2(fExpenses.reduce((a, e) => a + (e.amount || 0), 0));
      const net = round2(rev - cogs - exp);
      currentExport = {
        filename: "profit_and_loss.csv",
        headers: ["Metric", "Amount"],
        rows: [["Total Sales", rev], ["Total Purchases", cogs], ["Total Expenses", exp], ["Net Profit / Loss", net]]
      };
      bodyEl.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Gross Sales</div><div class="kpi-value text-success">${formatCurrency(rev, currency)}</div><div class="kpi-sub">${fSales.length} invoices</div></div>
          <div class="kpi-card"><div class="kpi-label">Purchases</div><div class="kpi-value text-danger">${formatCurrency(cogs, currency)}</div><div class="kpi-sub">${fPurchases.length} bills</div></div>
          <div class="kpi-card"><div class="kpi-label">Operating Expenses</div><div class="kpi-value text-warning">${formatCurrency(exp, currency)}</div><div class="kpi-sub">${fExpenses.length} entries</div></div>
          <div class="kpi-card"><div class="kpi-label">Net Profit / Loss</div><div class="kpi-value ${net >= 0 ? "text-success" : "text-danger"}">${formatCurrency(net, currency)}</div><div class="kpi-sub">Sales − Purchases − Expenses</div></div>
        </div>
        <div class="card card-body" style="border-radius:18px;">
          <div class="chart-canvas-wrap"><canvas id="rep-pnl-chart"></canvas></div>
        </div>
      `;
      drawBarChart(bodyEl.querySelector("#rep-pnl-chart"), ["Sales", "Purchases", "Expenses", "Net Profit"], [
        { label: "Sales", data: [rev, 0, 0, 0], color: "#13A85B" },
        { label: "Purchases", data: [0, cogs, 0, 0], color: "#E24A23" },
        { label: "Expenses", data: [0, 0, exp, 0], color: "#F2B718" },
        { label: "Net", data: [0, 0, 0, Math.max(0, net)], color: "#2D26D4" }
      ]);
      return;
    }

    if (activeRep === "khata") {
      const got = round2(fLedger.filter((e) => e.entryType === "credit").reduce((a, e) => a + (e.amount || 0), 0));
      const gave = round2(fLedger.filter((e) => e.entryType === "debit").reduce((a, e) => a + (e.amount || 0), 0));
      currentExport = {
        filename: "khata_summary.csv",
        headers: ["Date", "Customer", "Type", "Description", "Method", "Amount"],
        rows: fLedger.map((e) => [e.date, e.partyName, e.entryType === "credit" ? "You Got" : "You Gave", e.description, e.paymentMethod, e.amount])
      };
      bodyEl.innerHTML = `
        <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="kpi-card"><div class="kpi-label">Total You Got (+)</div><div class="kpi-value text-success">${formatCurrency(got, currency)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Total You Gave (-)</div><div class="kpi-value text-danger">${formatCurrency(gave, currency)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Net Khata Flow</div><div class="kpi-value">${formatCurrency(got - gave, currency)}</div></div>
        </div>
        ${renderSimpleTable(
          ["Date", "Customer", "Type", "Description", "Amount"],
          fLedger.map((e) => [formatDate(e.date), e.partyName, e.entryType === "credit" ? "You Got (+)" : "You Gave (-)", e.description, formatCurrency(e.amount, currency)])
        )}
      `;
      return;
    }

    if (activeRep === "cust_due") {
      const list = parties.filter((p) => (p.currentBalance || 0) > 0).sort((a, b) => b.currentBalance - a.currentBalance);
      currentExport = {
        filename: "customer_outstanding.csv",
        headers: ["Customer", "Mobile", "Receivable Balance"],
        rows: list.map((p) => [p.name, p.mobile, p.currentBalance])
      };
      bodyEl.innerHTML = renderSimpleTable(
        ["Customer", "Mobile", "Receivable Balance"],
        list.map((p) => [p.name, p.mobile, formatCurrency(p.currentBalance, currency)])
      );
      return;
    }

    if (activeRep === "supp_due") {
      const list = parties.filter((p) => (p.currentBalance || 0) < 0).sort((a, b) => a.currentBalance - b.currentBalance);
      currentExport = {
        filename: "supplier_outstanding.csv",
        headers: ["Supplier", "Mobile", "Payable Balance"],
        rows: list.map((p) => [p.name, p.mobile, Math.abs(p.currentBalance)])
      };
      bodyEl.innerHTML = renderSimpleTable(
        ["Supplier", "Mobile", "Payable Balance"],
        list.map((p) => [p.name, p.mobile, formatCurrency(Math.abs(p.currentBalance), currency)])
      );
      return;
    }

    if (activeRep === "sales") {
      currentExport = {
        filename: "sales_report.csv",
        headers: ["Invoice", "Date", "Customer", "Grand Total", "Received", "Balance"],
        rows: fSales.map((s) => [s.invoiceNumber, s.date, s.partyName, s.grandTotal, s.amountReceived, s.balanceDue])
      };
      bodyEl.innerHTML = renderSimpleTable(
        ["Invoice #", "Date", "Customer", "Grand Total", "Received", "Balance"],
        fSales.map((s) => [s.invoiceNumber, formatDate(s.date), s.partyName, formatCurrency(s.grandTotal, currency), formatCurrency(s.amountReceived, currency), formatCurrency(s.balanceDue, currency)])
      );
      return;
    }

    if (activeRep === "purchases") {
      currentExport = {
        filename: "purchase_report.csv",
        headers: ["Purchase #", "Date", "Supplier", "Total", "Paid", "Pending"],
        rows: fPurchases.map((p) => [p.purchaseNumber, p.date, p.partyName, p.grandTotal, p.paidAmount, p.pendingAmount])
      };
      bodyEl.innerHTML = renderSimpleTable(
        ["Purchase #", "Date", "Supplier", "Total", "Paid", "Pending"],
        fPurchases.map((p) => [p.purchaseNumber, formatDate(p.date), p.partyName, formatCurrency(p.grandTotal, currency), formatCurrency(p.paidAmount, currency), formatCurrency(p.pendingAmount, currency)])
      );
      return;
    }

    if (activeRep === "cashflow") {
      const inflows = round2(fPayments.filter((p) => p.direction === "in").reduce((a, p) => a + (p.amount || 0), 0));
      const outflows = round2(fPayments.filter((p) => p.direction === "out").reduce((a, p) => a + (p.amount || 0), 0) + fExpenses.reduce((a, e) => a + (e.amount || 0), 0));
      currentExport = {
        filename: "cashflow_report.csv",
        headers: ["Type", "Date", "Party", "Method", "Amount"],
        rows: fPayments.map((p) => [p.direction === "in" ? "Inflow" : "Outflow", p.date, p.partyName, p.method, p.amount])
      };
      bodyEl.innerHTML = `
        <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="kpi-card"><div class="kpi-label">Cash Inflows</div><div class="kpi-value text-success">${formatCurrency(inflows, currency)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Cash Outflows</div><div class="kpi-value text-danger">${formatCurrency(outflows, currency)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Net Cash Flow</div><div class="kpi-value">${formatCurrency(inflows - outflows, currency)}</div></div>
        </div>
        ${renderSimpleTable(["Receipt #", "Date", "Party", "Direction", "Method", "Amount"], fPayments.map((p) => [p.paymentNumber, formatDate(p.date), p.partyName, p.direction.toUpperCase(), p.method, formatCurrency(p.amount, currency)]))}
      `;
      return;
    }

    if (activeRep === "expenses") {
      currentExport = {
        filename: "expense_report.csv",
        headers: ["Date", "Category", "Description", "Method", "Amount"],
        rows: fExpenses.map((e) => [e.date, e.category, e.description, e.paymentMethod, e.amount])
      };
      bodyEl.innerHTML = renderSimpleTable(
        ["Date", "Category", "Description", "Method", "Amount"],
        fExpenses.map((e) => [formatDate(e.date), e.category, e.description, e.paymentMethod, formatCurrency(e.amount, currency)])
      );
    }
  }

  function renderSimpleTable(headers, rows) {
    if (rows.length === 0) return `<div class="card" style="border-radius:18px;"><div class="state-box"><p class="text-muted">No records in this report for the selected period.</p></div></div>`;
    return `
      <div class="card" style="border-radius:18px;overflow:hidden;"><div class="table-wrap">
        <table class="data-table">
          <thead><tr>${headers.map((h) => `<th>${escapeHTML(h)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHTML(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div></div>
    `;
  }

  container.querySelectorAll("#report-tabs .store-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("#report-tabs .store-pill").forEach((b) => {
        const meta = REPORT_TYPES.find((r) => r.id === b.dataset.rep);
        b.classList.remove("active");
        b.style.background = "#fff";
        b.style.color = "var(--text-primary)";
        const dot = b.querySelector(".pill-dot");
        if (dot && meta) { dot.style.background = meta.color; dot.style.color = "#fff"; }
      });
      const activeMeta = REPORT_TYPES.find((r) => r.id === btn.dataset.rep);
      btn.classList.add("active");
      if (activeMeta) {
        btn.style.background = activeMeta.color;
        btn.style.color = "#fff";
        const dot = btn.querySelector(".pill-dot");
        if (dot) { dot.style.background = "#fff"; dot.style.color = activeMeta.color; }
      }
      activeRep = btn.dataset.rep;
      renderReport();
    });
  });

  periodEl.addEventListener("change", renderReport);
  startEl.addEventListener("change", renderReport);
  endEl.addEventListener("change", renderReport);
  container.querySelector("#rep-csv-btn").addEventListener("click", () => {
    exportToCSV(currentExport.filename, currentExport.headers, currentExport.rows);
  });

  renderReport();
}
