import { db, collection, doc, setDoc, updateDoc, deleteDoc, query, where, getDocs, serverTimestamp } from "./firebase.js";
import { DEFAULT_PERMISSIONS, logAudit } from "./database.js";
import { confirmDialog, escapeHTML, openModal, showToast } from "./utilities.js";

const PERMISSION_LABELS = {
  viewSales: "View Sales",
  createInvoices: "Create Invoices",
  editInvoices: "Edit Invoices",
  deleteTransactions: "Cancel / Delete Transactions",
  manageProducts: "Manage Products & Stock",
  manageParties: "Manage Parties & Khata",
  viewReports: "View Reports & Audit Logs",
  manageExpenses: "Manage Expenses",
  managePurchases: "Manage Purchases",
  managePayments: "Manage Payments",
  manageStaff: "Manage Staff",
  changeSettings: "Change Business Settings"
};

export async function renderStaff(container, ctx) {
  const { businessId, can } = ctx;

  container.innerHTML = `
    <div class="page-toolbar">
      <div>
        <h2 style="font-size:20px;">Staff &amp; Access Permissions</h2>
        <p class="text-muted" style="margin:2px 0 0;font-size:13px;">Permissions are enforced in Firestore Security Rules and the interface.</p>
      </div>
      ${can("manageStaff") ? `<button id="invite-staff-btn" class="btn btn-primary">+ Add Staff Member</button>` : ""}
    </div>

    <div class="card">
      <div id="staff-table-wrap" class="table-wrap"><div class="state-box"><div class="spinner"></div></div></div>
    </div>
  `;

  const snap = await getDocs(query(collection(db, "businessMembers"), where("businessId", "==", businessId)));
  const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const wrap = container.querySelector("#staff-table-wrap");

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Name / Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Active Permissions</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${members.map((m) => {
          const permCount = Object.values(m.permissions || {}).filter(Boolean).length;
          return `
            <tr>
              <td>
                <div style="font-weight:700;">${escapeHTML(m.name || m.email)}</div>
                <div class="text-muted" style="font-size:12px;">${escapeHTML(m.email)}</div>
              </td>
              <td><span class="badge badge-brand">${escapeHTML(m.role)}</span></td>
              <td><span class="badge ${m.status === "active" ? "badge-success" : "badge-warning"}">${escapeHTML(m.status)}</span></td>
              <td>${permCount} / ${Object.keys(PERMISSION_LABELS).length} enabled</td>
              <td class="text-right">
                ${m.role !== "Owner" && can("manageStaff") ? `
                  <button class="btn btn-secondary btn-sm edit-staff-btn" data-id="${m.id}">Permissions</button>
                  <button class="btn btn-danger-soft btn-sm rem-staff-btn" data-id="${m.id}">Remove</button>
                ` : `<span class="text-muted" style="font-size:12px;">Primary Owner</span>`}
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  function openStaffModal(existing = null) {
    const defaultRole = existing?.role || "Salesperson";
    const perms = existing?.permissions || DEFAULT_PERMISSIONS[defaultRole];

    const close = openModal({
      title: existing ? `Edit Staff — ${existing.email}` : "Add Staff Member",
      large: true,
      bodyHTML: `
        <form id="staff-form" class="form-grid">
          <div class="form-group">
            <label class="form-label">Staff Name *</label>
            <input type="text" name="name" class="form-control" required value="${escapeHTML(existing?.name || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Staff Email *</label>
            <input type="email" name="email" class="form-control" required value="${escapeHTML(existing?.email || "")}" ${existing ? "readonly" : ""} placeholder="staff@email.com" />
          </div>
          <div class="form-group full">
            <label class="form-label">Role Preset</label>
            <select id="staff-role-sel" name="role" class="form-control">
              ${["Admin", "Manager", "Accountant", "Salesperson", "Viewer"].map((r) => `<option value="${r}" ${defaultRole === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
          </div>
          <div class="form-group full">
            <label class="form-label">Granular Permissions</label>
            <div class="permission-grid" id="perm-checkboxes">
              ${Object.entries(PERMISSION_LABELS).map(([k, lbl]) => `
                <label class="checkbox-card">
                  <input type="checkbox" name="perm_${k}" ${perms[k] ? "checked" : ""} />
                  <span>${escapeHTML(lbl)}</span>
                </label>
              `).join("")}
            </div>
          </div>
        </form>
      `,
      footerHTML: `
        <button type="button" class="btn btn-secondary" id="st-cancel">Cancel</button>
        <button type="submit" form="staff-form" class="btn btn-primary" id="st-save">Save Staff Member</button>
      `,
      onMount: (el, close) => {
        const roleSel = el.querySelector("#staff-role-sel");
        roleSel.addEventListener("change", () => {
          const preset = DEFAULT_PERMISSIONS[roleSel.value] || {};
          Object.keys(PERMISSION_LABELS).forEach((k) => {
            const cb = el.querySelector(`input[name="perm_${k}"]`);
            if (cb) cb.checked = Boolean(preset[k]);
          });
        });
        el.querySelector("#st-cancel").addEventListener("click", close);
        el.querySelector("#staff-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const permissions = {};
          Object.keys(PERMISSION_LABELS).forEach((k) => {
            permissions[k] = fd.get(`perm_${k}`) === "on";
          });
          const email = fd.get("email").trim().toLowerCase();
          const btn = el.querySelector("#st-save");
          btn.disabled = true;
          try {
            if (existing) {
              await updateDoc(doc(db, "businessMembers", existing.id), {
                name: fd.get("name").trim(),
                role: fd.get("role"),
                permissions,
                updatedAt: serverTimestamp()
              });
            } else {
              const inviteId = `${businessId}_invite_${email.replace(/[^a-z0-9]/g, "_")}`;
              await setDoc(doc(db, "businessMembers", inviteId), {
                businessId,
                uid: "",
                email,
                name: fd.get("name").trim(),
                role: fd.get("role"),
                permissions,
                status: "invited",
                createdAt: serverTimestamp()
              });
            }
            await logAudit(businessId, ctx.user, "SAVE_STAFF", "businessMembers", email, { role: fd.get("role") });
            showToast(existing ? "Staff updated." : "Staff invited! They will get access when they sign in with this email.", "success");
            close();
            renderStaff(container, ctx);
          } catch (err) {
            showToast(err.message || "Failed to save staff.", "error");
            btn.disabled = false;
          }
        });
      }
    });
  }

  container.querySelector("#invite-staff-btn")?.addEventListener("click", () => openStaffModal());
  wrap.querySelectorAll(".edit-staff-btn").forEach((b) => {
    b.addEventListener("click", () => openStaffModal(members.find((m) => m.id === b.dataset.id)));
  });
  wrap.querySelectorAll(".rem-staff-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Remove Staff", message: "Revoke this staff member's access to the business?", confirmText: "Remove", danger: true });
      if (!ok) return;
      await deleteDoc(doc(db, "businessMembers", b.dataset.id));
      showToast("Staff removed.", "success");
      renderStaff(container, ctx);
    });
  });
}
