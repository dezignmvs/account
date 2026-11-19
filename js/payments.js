import { getBusinessSettings, listCollection, recordPayment } from "./database.js";
import {
  escapeHTML,
  formatCurrency,
  formatDate,
  generateIdempotencyKey,
  openModal,
  showToast,
  todayISO
} from "./utilities.js";

export async function renderPayments(container, ctx) {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-bar">
        <button class="btn btn-soft btn-sm pay-tab active" data-dir="ALL">All Payments</button>
        <button class="btn btn-secondary btn-sm pay-tab" data-dir="in">Received (In)</button>
        <button class="btn btn-secondary btn-sm pay-tab" data-dir="out">Paid (Out)</button>
      </div>
      <div class="filter-bar">
        ${can("managePayments") ? `
          <button id="pay-in-btn" class="btn btn-primary">+ Receive Payment</button>
          <button id="pay-out-btn" class="btn btn-secondary">+ Pay Supplier</button>
        ` : ""}
      </div>
    </div>

    <div class="card">
      <div id="payments-table-wrap" class="table-wrap">
        <div class="state-box"><div class="spinner"></div><p class="text-muted">Loading payments...</p></div>
      </div>
    </div>
  `;

  const [payments, parties, sales, purchases, settings] = await Promise.all([
    listCollection("payments", businessId, "date", "desc", 500),
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("sales", businessId, "date", "desc", 300),
    listCollection("purchases", businessId, "date", "desc", 300),
    getBusinessSettings(businessId)
  ]);

  let dirFilter = "ALL";
  const wrap = container.querySelector("#payments-table-wrap");

  function renderTable() {
    const list = payments.filter((p) => dirFilter === "ALL" || p.direction === dirFilter);
    if (list.length === 0) {
      wrap.innerHTML = `<div class="state-box"><p class="text-muted">No payments recorded yet.</p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Receipt #</th>
            <th>Date</th>
            <th>Party</th>
            <th>Direction</th>
            <th>Method</th>
            <th>Linked Bill / Ref</th>
            <th class="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => `
            <tr>
              <td class="mono" style="font-weight:700;">${escapeHTML(p.paymentNumber)}</td>
              <td>${formatDate(p.date)}</td>
              <td>${escapeHTML(p.partyName)}</td>
              <td><span class="badge ${p.direction === "in" ? "badge-success" : "badge-danger"}">${p.direction === "in" ? "Received" : "Paid Out"}</span></td>
              <td>${escapeHTML((p.method || "cash").toUpperCase())}</td>
              <td class="mono" style="font-size:12px;">${escapeHTML(p.linkedNumber || p.invoiceNumber || p.purchaseNumber || p.referenceNo || "Advance / Unallocated")}</td>
              <td class="text-right mono ${p.direction === "in" ? "text-success" : "text-danger"}" style="font-weight:700;">${formatCurrency(p.amount, currency)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function openPaymentModal(direction) {
    if (parties.length === 0) {
      showToast("Add a customer or supplier party first.", "warning");
      return;
    }
    const idempKey = generateIdempotencyKey("pay");
    const isIn = direction === "in";
    const eligibleParties = parties.filter((p) => (isIn ? p.type !== "Supplier" : p.type !== "Customer"));

    const close = openModal({
      title: isIn ? "Receive Customer Payment" : "Make Supplier Payment",
      bodyHTML: `
        <form id="pay-modal-form" class="form-grid">
          <div class="form-group full">
            <label class="form-label">${isIn ? "Customer" : "Supplier"} *</label>
            <select id="pay-party-sel" name="partyId" class="form-control" required>
              <option value="">-- Select Party --</option>
              ${eligibleParties.map((p) => `<option value="${p.id}">${escapeHTML(p.name)} (Bal: ${formatCurrency(p.currentBalance || 0, currency)})</option>`).join("")}
            </select>
          </div>
          <div class="form-group full">
            <label class="form-label">Link to Pending ${isIn ? "Invoice" : "Purchase"} (Optional)</label>
            <select id="pay-bill-sel" name="linkedId" class="form-control">
              <option value="">Advance / General Khata Settlement</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount (₹) *</label>
            <input type="number" step="0.01" min="0.01" id="pay-amount-inp" name="amount" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input type="date" name="date" class="form-control" required value="${todayISO()}" />
          </div>
          <div class="form-group">
            <label class="form-label">Payment Method *</label>
            <select name="method" class="form-control">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank Transfer</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Reference No.</label>
            <input type="text" name="referenceNo" class="form-control" placeholder="UTR / Cheque / Txn ID" />
          </div>
          <div class="form-group full">
            <label class="form-label">Notes</label>
            <input type="text" name="notes" class="form-control" />
          </div>
        </form>
      `,
      footerHTML: `
        <button type="button" class="btn btn-secondary" id="pay-cancel">Cancel</button>
        <button type="submit" form="pay-modal-form" class="btn btn-primary" id="pay-save">Record Payment</button>
      `,
      onMount: (el, close) => {
        const partySel = el.querySelector("#pay-party-sel");
        const billSel = el.querySelector("#pay-bill-sel");
        const amtInp = el.querySelector("#pay-amount-inp");

        partySel.addEventListener("change", () => {
          const pid = partySel.value;
          const bills = isIn
            ? sales.filter((s) => s.partyId === pid && s.status === "final" && (s.balanceDue || 0) > 0)
            : purchases.filter((p) => p.partyId === pid && (p.pendingAmount || 0) > 0);
          billSel.innerHTML = `<option value="">Advance / General Khata Settlement</option>` +
            bills.map((b) => {
              const due = isIn ? b.balanceDue : b.pendingAmount;
              const num = isIn ? b.invoiceNumber : b.purchaseNumber;
              return `<option value="${b.id}" data-due="${due}" data-num="${escapeHTML(num)}">${escapeHTML(num)} — Due: ${formatCurrency(due, currency)}</option>`;
            }).join("");
        });

        billSel.addEventListener("change", () => {
          const opt = billSel.selectedOptions[0];
          if (opt && opt.dataset.due) amtInp.value = opt.dataset.due;
        });

        el.querySelector("#pay-cancel").addEventListener("click", close);
        el.querySelector("#pay-modal-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const billOpt = billSel.selectedOptions[0];
          const btn = el.querySelector("#pay-save");
          btn.disabled = true;
          try {
            const res = await recordPayment(
              businessId,
              {
                idempotencyKey: idempKey,
                direction,
                partyId: fd.get("partyId"),
                linkedCollection: fd.get("linkedId") ? (isIn ? "sales" : "purchases") : "",
                linkedId: fd.get("linkedId") || "",
                linkedNumber: billOpt?.dataset?.num || "",
                amount: Number(fd.get("amount")),
                date: fd.get("date"),
                method: fd.get("method"),
                referenceNo: fd.get("referenceNo"),
                notes: fd.get("notes")
              },
              ctx.user,
              settings
            );
            showToast(`Payment ${res.paymentNumber} recorded!`, "success");
            close();
            renderPayments(container, ctx);
          } catch (err) {
            showToast(err.message || "Payment failed.", "error");
            btn.disabled = false;
          }
        });
      }
    });
  }

  container.querySelectorAll(".pay-tab").forEach((b) => {
    b.addEventListener("click", () => {
      container.querySelectorAll(".pay-tab").forEach((x) => {
        x.classList.remove("active", "btn-soft");
        x.classList.add("btn-secondary");
      });
      b.classList.add("active", "btn-soft");
      b.classList.remove("btn-secondary");
      dirFilter = b.dataset.dir;
      renderTable();
    });
  });

  container.querySelector("#pay-in-btn")?.addEventListener("click", () => openPaymentModal("in"));
  container.querySelector("#pay-out-btn")?.addEventListener("click", () => openPaymentModal("out"));
  renderTable();
}
