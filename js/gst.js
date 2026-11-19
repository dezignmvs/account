import { listCollection } from "./database.js";
import { escapeHTML, exportToCSV, formatCurrency, formatDate, getDateRange, round2 } from "./utilities.js";

export async function renderGST(container, ctx) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="banner-alert info">
      <span><strong>Accountant Review Summary:</strong> Figures below are derived from your recorded sales and purchase transactions. This module prepares GST summaries for review and does not automatically file returns with the GST portal.</span>
      <span class="mono" style="font-weight:700;">GSTIN: ${escapeHTML(business.gstin || "Not Set")}</span>
    </div>

    <div class="page-toolbar">
      <div class="filter-bar">
        <select id="gst-period" class="form-control" style="width:auto;">
          <option value="month" selected>This Month</option>
          <option value="year">This Year</option>
          <option value="all">All Time</option>
          <option value="custom">Custom Range</option>
        </select>
        <input type="date" id="gst-start" class="form-control hidden" style="width:auto;" />
        <input type="date" id="gst-end" class="form-control hidden" style="width:auto;" />
      </div>
      <div class="filter-bar">
        <button id="gst-export-btn" class="btn btn-secondary">Export Accountant CSV</button>
        <button onclick="window.print()" class="btn btn-primary">Print / PDF</button>
      </div>
    </div>

    <div id="gst-body"><div class="state-box"><div class="spinner"></div></div></div>
  `;

  const [sales, purchases] = await Promise.all([
    listCollection("sales", businessId, "date", "desc", 500),
    listCollection("purchases", businessId, "date", "desc", 500)
  ]);

  const activeSales = sales.filter((s) => s.status === "final");
  const periodEl = container.querySelector("#gst-period");
  const startEl = container.querySelector("#gst-start");
  const endEl = container.querySelector("#gst-end");

  function render() {
    const isCustom = periodEl.value === "custom";
    startEl.classList.toggle("hidden", !isCustom);
    endEl.classList.toggle("hidden", !isCustom);
    const { start, end } = getDateRange(periodEl.value, startEl.value, endEl.value);
    const inRange = (d) => d && d >= start && d <= end;

    const fSales = activeSales.filter((s) => inRange(s.date));
    const fPurchases = purchases.filter((p) => inRange(p.date));

    const taxableSales = round2(fSales.reduce((a, s) => a + (s.taxableAmount || 0), 0));
    const outputCGST = round2(fSales.reduce((a, s) => a + (s.cgstTotal || 0), 0));
    const outputSGST = round2(fSales.reduce((a, s) => a + (s.sgstTotal || 0), 0));
    const outputIGST = round2(fSales.reduce((a, s) => a + (s.igstTotal || 0), 0));
    const outputTax = round2(outputCGST + outputSGST + outputIGST);

    const taxablePurchases = round2(fPurchases.reduce((a, p) => a + (p.subtotal || 0), 0));
    const inputTax = round2(fPurchases.reduce((a, p) => a + (p.gstTotal || 0), 0));
    const netPayable = round2(outputTax - inputTax);

    container.querySelector("#gst-body").innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Taxable Sales</div><div class="kpi-value">${formatCurrency(taxableSales, currency)}</div><div class="kpi-sub">${fSales.length} invoices</div></div>
        <div class="kpi-card"><div class="kpi-label">Output Tax (Collected)</div><div class="kpi-value text-danger">${formatCurrency(outputTax, currency)}</div><div class="kpi-sub">CGST: ${formatCurrency(outputCGST, currency)} | SGST: ${formatCurrency(outputSGST, currency)} | IGST: ${formatCurrency(outputIGST, currency)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Input Tax Credit (Purchases)</div><div class="kpi-value text-success">${formatCurrency(inputTax, currency)}</div><div class="kpi-sub">On ${formatCurrency(taxablePurchases, currency)} purchases</div></div>
        <div class="kpi-card"><div class="kpi-label">Estimated Net Tax</div><div class="kpi-value ${netPayable >= 0 ? "text-warning" : "text-success"}">${formatCurrency(netPayable, currency)}</div><div class="kpi-sub">Output Tax − Input Tax</div></div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">B2B / B2C Sales Tax Register</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>GSTIN</th>
                <th class="text-right">Taxable</th>
                <th class="text-right">CGST</th>
                <th class="text-right">SGST</th>
                <th class="text-right">IGST</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${fSales.length === 0 ? `<tr><td colspan="9" class="text-center text-muted">No taxable sales in this period.</td></tr>` : fSales.map((s) => `
                <tr>
                  <td class="mono">${escapeHTML(s.invoiceNumber)}</td>
                  <td>${formatDate(s.date)}</td>
                  <td>${escapeHTML(s.partyName)}</td>
                  <td class="mono" style="font-size:12px;">${escapeHTML(s.partyGstin || "Unregistered")}</td>
                  <td class="text-right mono">${formatCurrency(s.taxableAmount, currency)}</td>
                  <td class="text-right mono">${formatCurrency(s.cgstTotal, currency)}</td>
                  <td class="text-right mono">${formatCurrency(s.sgstTotal, currency)}</td>
                  <td class="text-right mono">${formatCurrency(s.igstTotal, currency)}</td>
                  <td class="text-right mono" style="font-weight:700;">${formatCurrency(s.grandTotal, currency)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector("#gst-export-btn").onclick = () => {
      exportToCSV(
        "gst_sales_register.csv",
        ["Invoice", "Date", "Customer", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Grand Total"],
        fSales.map((s) => [s.invoiceNumber, s.date, s.partyName, s.partyGstin || "", s.taxableAmount, s.cgstTotal, s.sgstTotal, s.igstTotal, s.grandTotal])
      );
    };
  }

  periodEl.addEventListener("change", render);
  startEl.addEventListener("change", render);
  endEl.addEventListener("change", render);
  render();
}
