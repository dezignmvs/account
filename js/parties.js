import { db, doc, getDoc, collection, query, where, getDocs } from "./firebase.js";
import { addLedgerEntry, deletePartyValidated, listCollection, saveParty } from "./database.js";
import {
  buildWhatsAppURL,
  confirmDialog,
  escapeHTML,
  exportToCSV,
  formatCurrency,
  formatDate,
  generateIdempotencyKey,
  INDIAN_STATES,
  isValidGSTIN,
  isValidPhone,
  openModal,
  showToast,
  todayISO
} from "./utilities.js";

export function openPartyModal(ctx, existing = null, onSaved = null) {
  const close = openModal({
    title: existing ? `Edit Customer — ${existing.name}` : "Add Customer",
    bodyHTML: `
      <form id="party-modal-form" class="form-grid">
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input type="text" name="name" class="form-control" required value="${escapeHTML(existing?.name || "")}" placeholder="Customer Name" />
        </div>
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select name="type" class="form-control" required>
            <option value="Customer" ${existing?.type === "Customer" ? "selected" : ""}>Customer</option>
            <option value="Remote" ${existing?.type === "Remote" ? "selected" : ""}>Remote</option>
            <option value="Freelance" ${existing?.type === "Freelance" ? "selected" : ""}>Freelance</option>
            <option value="Service" ${existing?.type === "Service" ? "selected" : ""}>Service</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Mobile Number *</label>
          <input type="tel" name="mobile" class="form-control" required value="${escapeHTML(existing?.mobile || "")}" placeholder="10-digit mobile number" />
        </div>
        <div class="form-group">
          <label class="form-label">Place</label>
          <input type="text" name="address" class="form-control" value="${escapeHTML(existing?.address || "")}" placeholder="City / Town / Place" />
        </div>
      </form>
    `,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="party-cancel-btn">Cancel</button>
      <button type="button" class="btn btn-primary" id="party-save-btn">Save</button>
    `,
    onMount: (el, close) => {
      const form = el.querySelector("#party-modal-form");
      const saveBtn = el.querySelector("#party-save-btn");

      async function handleSave(e) {
        if (e) e.preventDefault();
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const vals = Object.fromEntries(fd.entries());
        if (!isValidPhone(vals.mobile)) {
          showToast("Please enter a valid mobile number.", "error");
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
          const id = await saveParty(ctx.businessId, vals, existing?.id || null, ctx.user);
          showToast(existing ? "Customer updated." : "Customer added.", "success");
          close();
          if (onSaved) onSaved(id);
        } catch (err) {
          showToast(err.message || "Failed to save customer.", "error");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      }

      el.querySelector("#party-cancel-btn").addEventListener("click", close);
      saveBtn.addEventListener("click", handleSave);
      form.addEventListener("submit", handleSave);
    }
  });
}

export async function renderParties(container, ctx, initialSelectedId = "") {
  const { businessId, business, can } = ctx;
  const currency = business.currency || "INR";

  container.innerHTML = `
    <div class="wa-shell">
      <!-- Left Chat List -->
      <aside class="wa-sidebar" id="wa-sidebar">
        <div class="wa-sidebar-header">
          <h2 style="font-size:20px;font-weight:800;">Customers</h2>
          <div class="flex-row" style="gap:6px;">
            ${can("manageParties") ? `
              <button id="add-party-btn" class="store-pill" style="padding:4px 6px 4px 14px;border-color:#fff;background:#fff;color:var(--brand-indigo);">
                <span>New</span>
                <span class="pill-dot" style="background:var(--brand-gold);color:#141110;">+</span>
              </button>
            ` : ""}
          </div>
        </div>

        <div class="wa-search-box" style="border-bottom:2px solid var(--brand-gold);">
          <input type="search" id="party-search" placeholder="Search customer or mobile..." />
        </div>

        <div id="wa-chat-list" class="wa-chat-list">
          <div class="state-box"><div class="spinner"></div></div>
        </div>
      </aside>

      <!-- Right Chat-Style Ledger Pane -->
      <section class="wa-chat-pane ${window.innerWidth <= 860 ? "mobile-hidden" : ""}" id="wa-chat-pane">
        <div class="state-box" style="margin:auto;background:rgba(255,255,255,0.96);border:1px solid var(--border-light);border-radius:20px;padding:28px 34px;box-shadow:var(--shadow-sm);max-width:420px;">
          <p style="font-weight:700;font-size:15px;color:var(--text-primary);margin:0;">Select a customer to view &amp; record Khata</p>
          <p style="color:var(--text-secondary);margin:4px 0 0;font-size:13px;">Every "You Gave" and "You Got" entry appears here like a chat.</p>
        </div>
      </section>
    </div>
  `;

  let [parties, allEntries] = await Promise.all([
    listCollection("parties", businessId, "name", "asc", 500),
    listCollection("ledgerEntries", businessId, "createdAt", "asc", 1000)
  ]);

  function applyComputedBalances() {
    const map = {};
    const hasEntries = {};
    for (const e of allEntries) {
      if (!e.partyId) continue;
      hasEntries[e.partyId] = true;
      const isDebtOrDebit = e.entryType === "debit" || e.paymentMethod === "debt";
      const delta = isDebtOrDebit ? -Number(e.amount || 0) : Number(e.amount || 0);
      map[e.partyId] = (map[e.partyId] || 0) + delta;
    }
    parties.forEach((p) => {
      if (hasEntries[p.id]) {
        p.currentBalance = Math.round((map[p.id] + Number.EPSILON) * 100) / 100;
      }
    });
  }
  applyComputedBalances();

  let selectedId = (typeof initialSelectedId === "string" && initialSelectedId) ? initialSelectedId : (parties[0]?.id || "");

  const searchEl = container.querySelector("#party-search");
  const listEl = container.querySelector("#wa-chat-list");
  const paneEl = container.querySelector("#wa-chat-pane");
  const sidebarEl = container.querySelector("#wa-sidebar");

  function renderChatList() {
    const q = searchEl.value.trim().toLowerCase();
    const filtered = parties.filter((p) => {
      return !q || (p.name || "").toLowerCase().includes(q) || (p.mobile || "").includes(q);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="state-box" style="padding:32px 16px;">
          <p class="text-muted">No customers found.</p>
          ${can("manageParties") ? `
            <button class="store-pill" id="empty-add-party" style="border-color:var(--brand-primary);">
              <span>Add Customer</span>
              <span class="pill-dot" style="background:var(--brand-primary);color:#fff;">+</span>
            </button>
          ` : ""}
        </div>
      `;
      listEl.querySelector("#empty-add-party")?.addEventListener("click", () =>
        openPartyModal(ctx, null, (newId) => renderParties(container, ctx, newId))
      );
      return;
    }

    listEl.innerHTML = filtered.map((p) => {
      const bal = Number(p.currentBalance || 0);
      const initials = (p.name || "C").slice(0, 2).toUpperCase();
      return `
        <button type="button" class="wa-chat-item ${p.id === selectedId ? "active" : ""}" data-id="${p.id}">
          <div class="wa-avatar">${escapeHTML(initials)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <span style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(p.name)}</span>
              <span class="mono ${bal > 0 ? "text-success" : bal < 0 ? "text-danger" : "text-muted"}" style="font-weight:700;font-size:13px;">
                ${bal > 0 ? `+${formatCurrency(bal, currency)}` : bal < 0 ? `-${formatCurrency(Math.abs(bal), currency)}` : formatCurrency(0, currency)}
              </span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
              <span class="text-muted" style="font-size:12px;">${escapeHTML(p.mobile)} &bull; ${escapeHTML(p.type)}</span>
            </div>
          </div>
        </button>
      `;
    }).join("");

    listEl.querySelectorAll(".wa-chat-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.dataset.id;
        renderChatList();
        openCustomerChat(selectedId, true);
      });
    });
  }

  async function openCustomerChat(partyId, isMobileClick = false) {
    const party = parties.find((p) => p.id === partyId);
    if (!party) return;

    if (isMobileClick && window.innerWidth <= 860) {
      sidebarEl.classList.add("mobile-hidden");
      paneEl.classList.remove("mobile-hidden");
    }

    paneEl.innerHTML = `<div class="state-box" style="margin:auto;"><div class="spinner"></div></div>`;

    const snap = await getDocs(query(collection(db, "ledgerEntries"), where("businessId", "==", businessId)));
    const entries = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => e.partyId === partyId)
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

    const bal = Number(party.currentBalance || 0);
    const waMsg = `Hello ${party.name}, your Khata balance with ${business.name} is ${formatCurrency(Math.abs(bal), currency)} (${bal >= 0 ? "To Pay" : "Advance"}). Thank you!`;

    paneEl.innerHTML = `
      <div class="wa-chat-header">
        <div class="flex-row">
          <button type="button" id="wa-mobile-back" class="btn-icon mobile-menu-btn" aria-label="Back">&larr;</button>
          <div class="wa-avatar">${escapeHTML((party.name || "C").slice(0, 2).toUpperCase())}</div>
          <div>
            <div style="font-weight:800;font-size:15px;">${escapeHTML(party.name)}</div>
            <div class="text-muted" style="font-size:12px;">
              ${escapeHTML(party.mobile)} &bull; ${escapeHTML(party.type)} &bull;
              <strong class="mono ${bal > 0 ? "text-success" : bal < 0 ? "text-danger" : ""}">
                ${bal > 0 ? `+${formatCurrency(bal, currency)}` : bal < 0 ? `-${formatCurrency(Math.abs(bal), currency)}` : formatCurrency(0, currency)}
              </strong>
            </div>
          </div>
        </div>

        <div class="flex-row" style="gap:6px;">
          ${bal > 0 ? `<a href="${buildWhatsAppURL(party.mobile, waMsg)}" target="_blank" rel="noopener" class="btn btn-soft btn-sm">WhatsApp</a>` : ""}
          <a href="#/parties/${party.id}" class="btn btn-secondary btn-sm">Statement</a>
          ${can("manageParties") ? `<button id="wa-edit-party" class="btn btn-secondary btn-sm">Edit</button>` : ""}
          ${can("deleteTransactions") ? `<button id="wa-del-party" class="btn btn-danger-soft btn-sm">Delete</button>` : ""}
        </div>
      </div>

      <div class="wa-messages" id="wa-messages">
        ${entries.length === 0 ? `
          <div class="wa-date-chip">No transactions yet — send your first Khata entry below</div>
        ` : entries.map((e, idx) => {
          const prevDate = idx > 0 ? entries[idx - 1].date : null;
          const showDate = e.date !== prevDate;
          const isDebit = e.entryType === "debit";
          const isDebt = e.paymentMethod === "debt" && !isDebit;
          return `
            ${showDate ? `<div class="wa-date-chip">${formatDate(e.date)}</div>` : ""}
            <div class="wa-bubble ${isDebit ? "debit" : "credit"}">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;">
                <span class="mono" style="font-size:16px;font-weight:800;color:${isDebit || isDebt ? "#B91C1C" : "#0F6E3D"};">
                  ${isDebit ? "You Gave " : isDebt ? "Debt (You Pay) " : "You Got "}${formatCurrency(e.amount, currency)}
                </span>
                <span class="badge ${isDebit || isDebt ? "badge-danger" : "badge-success"}" style="font-size:10px;">
                  ${isDebit ? "Gave" : isDebt ? "Debt" : "Got"}
                </span>
              </div>
              <div style="font-size:13px;color:var(--text-primary);">${escapeHTML(e.description || "Khata entry")}</div>
              <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-muted);margin-top:2px;">
                <span>${escapeHTML((e.paymentMethod || "cash").toUpperCase())}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      ${can("manageParties") ? `
        <form id="wa-composer-form" class="wa-composer">
          <input type="number" step="0.01" min="0.01" name="amount" class="form-control" placeholder="₹ Amount" required style="width:130px;" />
          <input type="text" name="description" class="form-control" placeholder="Type note (e.g. Cash received, Bill #12)..." required style="flex:1;min-width:160px;" />
          <select name="paymentMethod" id="wa-pay-method" class="form-control" style="width:110px;">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
          </select>
          <button type="submit" data-type="debit" class="btn btn-danger btn-sm" style="border-radius:999px;">You Gave (-)</button>
          <button type="submit" data-type="credit" class="btn btn-primary btn-sm" style="border-radius:999px;background:#0F6E3D;border-color:#0F6E3D;">You Got (+)</button>
        </form>
      ` : ""}
    `;

    const msgBox = paneEl.querySelector("#wa-messages");
    msgBox.scrollTop = msgBox.scrollHeight;

    paneEl.querySelector("#wa-mobile-back")?.addEventListener("click", () => {
      sidebarEl.classList.remove("mobile-hidden");
      paneEl.classList.add("mobile-hidden");
    });

    paneEl.querySelector("#wa-edit-party")?.addEventListener("click", () => {
      openPartyModal(ctx, party, () => renderParties(container, ctx));
    });

    paneEl.querySelector("#wa-del-party")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Delete Customer",
        message: `Delete "${party.name}"? Customers with transaction history cannot be deleted.`,
        confirmText: "Delete",
        danger: true
      });
      if (!ok) return;
      try {
        await deletePartyValidated(businessId, party.id, ctx.user);
        showToast("Customer deleted.", "success");
        renderParties(container, ctx);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    const composer = paneEl.querySelector("#wa-composer-form");
    if (composer) {
      let clickedType = "credit";
      composer.querySelectorAll('button[type="submit"]').forEach((b) => {
        b.addEventListener("click", () => { clickedType = b.dataset.type; });
      });
      composer.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(composer);
        const amount = Number(fd.get("amount"));
        if (!amount || amount <= 0) return;
        const method = fd.get("paymentMethod");
        const entryType = clickedType;
        const btns = composer.querySelectorAll('button[type="submit"]');
        btns.forEach((b) => { b.disabled = true; });
        try {
          await addLedgerEntry(
            businessId,
            {
              idempotencyKey: generateIdempotencyKey("wa"),
              partyId: party.id,
              entryType,
              category: entryType === "credit" ? "payment" : "manual",
              amount,
              date: todayISO(),
              description: fd.get("description"),
              paymentMethod: method
            },
            ctx.user
          );
          showToast(clickedType === "credit" ? "Payment received!" : "Debit recorded!", "success");
          [parties, allEntries] = await Promise.all([
            listCollection("parties", businessId, "name", "asc", 500),
            listCollection("ledgerEntries", businessId, "createdAt", "asc", 1000)
          ]);
          applyComputedBalances();
          renderChatList();
          await openCustomerChat(party.id);
        } catch (err) {
          showToast(err.message || "Failed to record entry.", "error");
          btns.forEach((b) => { b.disabled = false; });
        }
      });
    }
  }

  searchEl.addEventListener("input", renderChatList);
  container.querySelector("#add-party-btn")?.addEventListener("click", () =>
    openPartyModal(ctx, null, (newId) => renderParties(container, ctx, newId))
  );

  renderChatList();
  if (selectedId) openCustomerChat(selectedId);
}

export async function renderPartyDetail(container, ctx, params) {
  const { businessId, business } = ctx;
  const currency = business.currency || "INR";
  const partyId = params.id;

  const snap = await getDoc(doc(db, "parties", partyId));
  if (!snap.exists() || snap.data().businessId !== businessId) {
    container.innerHTML = `<div class="state-box"><p class="text-danger">Party not found or access denied.</p><a href="#/parties" class="btn btn-secondary">Back to Parties</a></div>`;
    return;
  }
  const party = { id: snap.id, ...snap.data() };

  const ledgerSnap = await getDocs(
    query(collection(db, "ledgerEntries"), where("businessId", "==", businessId))
  );
  const entries = ledgerSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.partyId === partyId)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const bal = Number(party.currentBalance || 0);
  const reminderMsg = `Hello ${party.name}, this is a polite reminder from ${business.name}. Your current pending balance is ${formatCurrency(Math.abs(bal), currency)}. Thank you!`;

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="flex-row">
        <a href="#/parties" class="btn btn-secondary btn-sm">&larr; Parties</a>
        <div>
          <h2 style="font-size:20px;">${escapeHTML(party.name)}</h2>
          <div class="text-muted" style="font-size:12.5px;">${escapeHTML(party.type)} &bull; ${escapeHTML(party.mobile)} ${party.gstin ? `&bull; GSTIN: ${escapeHTML(party.gstin)}` : ""}</div>
        </div>
      </div>
      <div class="filter-bar">
        ${bal > 0 ? `<a href="${buildWhatsAppURL(party.mobile, reminderMsg)}" target="_blank" rel="noopener" class="btn btn-soft btn-sm">WhatsApp Reminder</a>` : ""}
        <button onclick="window.print()" class="btn btn-secondary btn-sm">Print / PDF</button>
        <a href="#/ledger?party=${party.id}" class="btn btn-primary btn-sm">Add Khata Entry</a>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
      <div class="kpi-card">
        <div class="kpi-label">Current Outstanding</div>
        <div class="kpi-value ${bal >= 0 ? "text-success" : "text-danger"}">${formatCurrency(Math.abs(bal), currency)}</div>
        <div class="kpi-sub">${bal > 0 ? "You will receive" : bal < 0 ? "You will pay" : "Settled"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Opening Balance</div>
        <div class="kpi-value">${formatCurrency(Math.abs(party.openingBalance || 0), currency)}</div>
        <div class="kpi-sub">${(party.openingBalance || 0) >= 0 ? "Receivable" : "Payable"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Credit Limit</div>
        <div class="kpi-value">${formatCurrency(party.creditLimit || 0, currency)}</div>
        <div class="kpi-sub">${escapeHTML(party.address || "No address on file")}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Complete Transaction History (${entries.length})</span>
      </div>
      <div class="table-wrap">
        ${entries.length === 0 ? `<div class="state-box"><p class="text-muted">No ledger entries yet.</p></div>` : `
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Method / Ref</th>
                <th class="text-right">Debit (Gave)</th>
                <th class="text-right">Credit (Got)</th>
                <th class="text-right">Balance After</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((e) => `
                <tr>
                  <td>${formatDate(e.date)}</td>
                  <td>
                    <div style="font-weight:600;">${escapeHTML(e.description)}</div>
                    ${e.notes ? `<div class="text-muted" style="font-size:12px;">${escapeHTML(e.notes)}</div>` : ""}
                  </td>
                  <td style="font-size:12.5px;">${escapeHTML(e.paymentMethod || "—")} ${e.referenceNo ? `(${escapeHTML(e.referenceNo)})` : ""}</td>
                  <td class="text-right mono text-danger">${e.entryType === "debit" ? formatCurrency(e.amount, currency) : "—"}</td>
                  <td class="text-right mono text-success">${e.entryType === "credit" ? formatCurrency(e.amount, currency) : "—"}</td>
                  <td class="text-right mono" style="font-weight:700;">${formatCurrency(e.balanceAfter, currency)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `;
}
