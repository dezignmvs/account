import { db, doc, updateDoc, writeBatch, collection, serverTimestamp } from "./firebase.js";
import { getBusinessSettings, listCollection, logAudit, saveBusinessSettings, uploadBusinessFile } from "./database.js";
import { renderStaff } from "./staff.js";
import { escapeHTML, INDIAN_STATES, isValidGSTIN, isValidPAN, showToast } from "./utilities.js";

export async function renderSettings(container, ctx) {
  const { businessId, business, can } = ctx;
  const settings = await getBusinessSettings(businessId);
  let activeTab = "business";
  let isEditing = false;

  const stateOpts = INDIAN_STATES.map(
    (s) => `<option value="${escapeHTML(s)}" ${business.state === s ? "selected" : ""}>${escapeHTML(s)}</option>`
  ).join("");

  function renderShell() {
    container.innerHTML = `
      <div class="dash-hero-banner" style="background-color:var(--brand-green);padding:26px 24px 20px;">
        <div class="hero-top-notch" style="color:var(--brand-green);">Settings</div>
        <div class="flex-row" style="gap:14px;">
          <img src="/assets/logo/logo.svg" class="product-thumb" style="width:52px;height:52px;border-radius:14px;background:#fff;padding:4px;" alt="KhataFlow" />
          <div>
            <h2 class="font-display" style="font-size:28px;margin:0;">KhataFlow</h2>
            <div style="font-size:13px;opacity:0.9;">Workspace &amp; Store Settings &bull; ${escapeHTML(business.name)}</div>
          </div>
        </div>
        <div class="quick-actions">
          <a href="#/business-setup" class="btn" style="background:var(--brand-gold);color:#141110;font-weight:800;border-radius:999px;">+ New Store</a>
          <a href="#/backup" class="btn" style="background:#fff;color:var(--brand-green);font-weight:800;border-radius:999px;">Backup &amp; Restore</a>
        </div>
      </div>

      <div class="store-pill-strip" id="settings-menu-pills">
        <button type="button" class="store-pill ${activeTab === "business" ? "active" : ""}" data-tab="business" style="border-color:var(--brand-green);${activeTab === "business" ? "background:var(--brand-green);color:#fff;" : ""}">
          <span>Business</span>
          <span class="pill-dot" style="background:${activeTab === "business" ? "#fff" : "var(--brand-green)"};color:${activeTab === "business" ? "var(--brand-green)" : "#fff"};">1</span>
        </button>
        <button type="button" class="store-pill ${activeTab === "staff" ? "active" : ""}" data-tab="staff" style="border-color:var(--brand-indigo);${activeTab === "staff" ? "background:var(--brand-indigo);color:#fff;" : ""}">
          <span>Staff &amp; Roles</span>
          <span class="pill-dot" style="background:${activeTab === "staff" ? "#fff" : "var(--brand-indigo)"};color:${activeTab === "staff" ? "var(--brand-indigo)" : "#fff"};">2</span>
        </button>
        <button type="button" class="store-pill ${activeTab === "billing" ? "active" : ""}" data-tab="billing" style="border-color:var(--brand-primary);${activeTab === "billing" ? "background:var(--brand-primary);color:#fff;" : ""}">
          <span>Bill &amp; Invoice</span>
          <span class="pill-dot" style="background:${activeTab === "billing" ? "#fff" : "var(--brand-primary)"};color:${activeTab === "billing" ? "var(--brand-primary)" : "#fff"};">3</span>
        </button>
      </div>

      <div id="settings-tab-body"></div>
    `;

    container.querySelectorAll("#settings-menu-pills .store-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        isEditing = false;
        renderShell();
      });
    });

    const bodyEl = container.querySelector("#settings-tab-body");
    if (activeTab === "business") renderBusinessTab(bodyEl);
    else if (activeTab === "staff") renderStaff(bodyEl, ctx);
    else if (activeTab === "billing") renderBillingTab(bodyEl);
  }

  function renderBusinessTab(bodyEl) {
    bodyEl.innerHTML = `
      <div class="card" style="border-radius:20px;overflow:hidden;">
        <div class="card-header">
          <div>
            <h3 style="font-size:17px;">${escapeHTML(business.name)}</h3>
            <p class="text-muted" style="margin:2px 0 0;font-size:12.5px;">Active Business / Store Details</p>
          </div>
          ${!isEditing && can("changeSettings") ? `
            <button type="button" id="edit-biz-card-btn" class="btn btn-primary btn-sm" style="border-radius:999px;">Edit</button>
          ` : ""}
        </div>

        ${!isEditing ? `
          <div class="card-body">
            <div class="form-grid">
              <div><div class="text-muted" style="font-size:12px;">Business Name</div><div style="font-weight:700;">${escapeHTML(business.name)}</div></div>
              <div><div class="text-muted" style="font-size:12px;">Owner Name</div><div style="font-weight:600;">${escapeHTML(business.ownerName || "—")}</div></div>
              <div><div class="text-muted" style="font-size:12px;">Mobile</div><div class="mono" style="font-weight:600;">${escapeHTML(business.mobile || "—")}</div></div>
              <div><div class="text-muted" style="font-size:12px;">State / Place</div><div style="font-weight:600;">${escapeHTML(business.state || "—")} ${business.address ? `— ${escapeHTML(business.address)}` : ""}</div></div>
              <div><div class="text-muted" style="font-size:12px;">GSTIN</div><div class="mono">${escapeHTML(business.gstin || "Not Set")}</div></div>
              <div><div class="text-muted" style="font-size:12px;">PAN</div><div class="mono">${escapeHTML(business.pan || "Not Set")}</div></div>
            </div>
          </div>
        ` : `
          <form id="settings-form" class="card-body">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">Business Name *</label>
                <input type="text" name="name" class="form-control" required value="${escapeHTML(business.name)}" />
              </div>
              <div class="form-group">
                <label class="form-label">Owner Name *</label>
                <input type="text" name="ownerName" class="form-control" required value="${escapeHTML(business.ownerName || "")}" />
              </div>
              <div class="form-group">
                <label class="form-label">Mobile *</label>
                <input type="tel" name="mobile" class="form-control" required value="${escapeHTML(business.mobile || "")}" />
              </div>
              <div class="form-group">
                <label class="form-label">State *</label>
                <select name="state" class="form-control" required>${stateOpts}</select>
              </div>
              <div class="form-group">
                <label class="form-label">GSTIN</label>
                <input type="text" name="gstin" class="form-control" maxlength="15" value="${escapeHTML(business.gstin || "")}" style="text-transform:uppercase;" />
              </div>
              <div class="form-group">
                <label class="form-label">PAN</label>
                <input type="text" name="pan" class="form-control" maxlength="10" value="${escapeHTML(business.pan || "")}" style="text-transform:uppercase;" />
              </div>
              <div class="form-group full">
                <label class="form-label">Address / Place</label>
                <input type="text" name="address" class="form-control" value="${escapeHTML(business.address || "")}" />
              </div>
              <div class="form-group full">
                <label class="form-label">Update Logo</label>
                <input type="file" name="logo" class="form-control" accept="image/*" />
              </div>
            </div>
            <div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px;">
              <button type="button" id="cancel-edit-biz-btn" class="btn btn-secondary">Cancel</button>
              <button type="submit" id="save-settings-btn" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        `}
      </div>
    `;

    bodyEl.querySelector("#edit-biz-card-btn")?.addEventListener("click", () => {
      isEditing = true;
      renderBusinessTab(bodyEl);
    });

    bodyEl.querySelector("#cancel-edit-biz-btn")?.addEventListener("click", () => {
      isEditing = false;
      renderBusinessTab(bodyEl);
    });

    bodyEl.querySelector("#settings-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!can("changeSettings")) return;
      const fd = new FormData(e.target);
      const gstin = fd.get("gstin").trim().toUpperCase();
      const pan = fd.get("pan").trim().toUpperCase();
      if (!isValidGSTIN(gstin) || !isValidPAN(pan)) {
        showToast("Invalid GSTIN or PAN format.", "error");
        return;
      }
      const btn = bodyEl.querySelector("#save-settings-btn");
      btn.disabled = true;
      try {
        let logoUrl = business.logoUrl || "";
        const logoFile = fd.get("logo");
        if (logoFile && logoFile.size > 0) {
          logoUrl = await uploadBusinessFile(businessId, "logo", logoFile);
        }
        await updateDoc(doc(db, "businesses", businessId), {
          name: fd.get("name").trim(),
          ownerName: fd.get("ownerName").trim(),
          mobile: fd.get("mobile").trim(),
          state: fd.get("state"),
          gstin,
          pan,
          address: fd.get("address").trim(),
          logoUrl,
          updatedAt: serverTimestamp()
        });
        showToast("Business details updated!", "success");
        await ctx.reloadBusinesses();
      } catch (err) {
        showToast(err.message || "Failed to update business.", "error");
        btn.disabled = false;
      }
    });
  }

  function renderBillingTab(bodyEl) {
    bodyEl.innerHTML = `
      <div class="card" style="border-radius:20px;overflow:hidden;">
        <div class="card-header">
          <div>
            <h3 style="font-size:17px;">Bill &amp; Invoice Settings</h3>
            <p class="text-muted" style="margin:2px 0 0;font-size:12.5px;">Configure invoice numbering, template, and quick billing access.</p>
          </div>
          <div class="flex-row" style="gap:8px;">
            <a href="#/sales" class="btn btn-secondary btn-sm">View Bills</a>
            <a href="#/sales/create" class="btn btn-primary btn-sm">+ Create Bill</a>
          </div>
        </div>
        <form id="billing-settings-form" class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Invoice Prefix</label>
              <input type="text" name="invoicePrefix" class="form-control" value="${escapeHTML(settings.invoicePrefix || "INV")}" />
            </div>
            <div class="form-group">
              <label class="form-label">Default Print Format</label>
              <select name="defaultInvoiceTemplate" class="form-control">
                <option value="a4" ${settings.defaultInvoiceTemplate !== "thermal" ? "selected" : ""}>A4 Tax Invoice</option>
                <option value="thermal" ${settings.defaultInvoiceTemplate === "thermal" ? "selected" : ""}>80mm Thermal Receipt</option>
              </select>
            </div>
            <div class="form-group full">
              <label class="form-label">Invoice Terms &amp; Conditions</label>
              <textarea name="termsAndConditions" class="form-control">${escapeHTML(settings.termsAndConditions || "")}</textarea>
            </div>
            <div class="form-group full">
              <label class="checkbox-card">
                <input type="checkbox" name="allowNegativeStock" ${settings.allowNegativeStock ? "checked" : ""} />
                <span>Allow negative stock on bills</span>
              </label>
            </div>
          </div>
          ${can("changeSettings") ? `
            <div style="margin-top:18px;display:flex;justify-content:flex-end;">
              <button type="submit" id="save-billing-btn" class="btn btn-primary">Save Bill Settings</button>
            </div>
          ` : ""}
        </form>
      </div>
    `;

    bodyEl.querySelector("#billing-settings-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = bodyEl.querySelector("#save-billing-btn");
      btn.disabled = true;
      try {
        await saveBusinessSettings(
          businessId,
          {
            invoicePrefix: fd.get("invoicePrefix").trim() || "INV",
            defaultInvoiceTemplate: fd.get("defaultInvoiceTemplate"),
            termsAndConditions: fd.get("termsAndConditions").trim(),
            allowNegativeStock: fd.get("allowNegativeStock") === "on"
          },
          ctx.user
        );
        showToast("Bill & Invoice settings saved!", "success");
      } catch (err) {
        showToast(err.message || "Failed to save settings.", "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  renderShell();
}

export async function renderBackup(container, ctx) {
  const { businessId, business, can } = ctx;

  container.innerHTML = `
    <div class="dash-lists-grid">
      <div class="card card-body">
        <h3 style="font-size:17px;margin-bottom:6px;">Full Business JSON Backup</h3>
        <p class="text-muted" style="font-size:13px;">Download a complete snapshot of your parties, products, sales, purchases, ledger entries, payments, and expenses.</p>
        <button id="download-backup-btn" class="btn btn-primary" style="margin-top:10px;">Download Backup (.json)</button>
      </div>

      <div class="card card-body">
        <h3 style="font-size:17px;margin-bottom:6px;">Restore from Backup</h3>
        <p class="text-muted" style="font-size:13px;">Import parties or products from a KhataFlow JSON backup into this business. Existing IDs are preserved safely.</p>
        ${can("changeSettings") ? `
          <input type="file" id="restore-file-input" class="form-control" accept="application/json" style="margin-top:10px;" />
          <button id="restore-backup-btn" class="btn btn-secondary" style="margin-top:10px;">Restore Selected File</button>
        ` : `<p class="text-warning">Only Owners/Admins can restore backups.</p>`}
      </div>
    </div>
  `;

  container.querySelector("#download-backup-btn").addEventListener("click", async () => {
    const btn = container.querySelector("#download-backup-btn");
    btn.disabled = true;
    btn.textContent = "Exporting...";
    try {
      const cols = ["parties", "products", "sales", "purchases", "ledgerEntries", "payments", "expenses", "stockMovements"];
      const data = {};
      for (const c of cols) {
        data[c] = await listCollection(c, businessId, null, "desc", 2000);
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        app: "KhataFlow",
        businessId,
        businessName: business.name,
        collections: data
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `khataflow_backup_${business.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup downloaded!", "success");
    } catch (err) {
      showToast(err.message || "Backup failed.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Download Backup (.json)";
    }
  });

  container.querySelector("#restore-backup-btn")?.addEventListener("click", async () => {
    const file = container.querySelector("#restore-file-input").files[0];
    if (!file) {
      showToast("Select a .json backup file first.", "warning");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.collections) throw new Error("Invalid KhataFlow backup format.");
      const targetCols = ["parties", "products", "expenses"];
      let count = 0;
      for (const colName of targetCols) {
        const docs = parsed.collections[colName] || [];
        const batch = writeBatch(db);
        for (const item of docs.slice(0, 400)) {
          const { id, ...rest } = item;
          const refDoc = id ? doc(db, colName, id) : doc(collection(db, colName));
          batch.set(refDoc, { ...rest, businessId, restoredAt: serverTimestamp() }, { merge: true });
          count++;
        }
        if (docs.length > 0) await batch.commit();
      }
      await logAudit(businessId, ctx.user, "RESTORE_BACKUP", "businesses", businessId, { count });
      showToast(`Restored ${count} records into ${business.name}.`, "success");
    } catch (err) {
      showToast(err.message || "Restore failed.", "error");
    }
  });
}
