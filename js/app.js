import { auth, isFirebaseConfigured, onAuthStateChanged } from "./firebase.js";
import {
  ensureUserDocument,
  loadUserBusinesses,
  performLogout,
  renderBusinessSetupView,
  renderLoginView,
  renderRegisterView
} from "./auth.js";
import { listCollection } from "./database.js";
import { matchRoute, navigate, parseHash } from "./router.js";
import { renderDashboard } from "./dashboard.js";
import { renderParties, renderPartyDetail } from "./parties.js";
import { renderLedger } from "./ledger.js";
import { renderProducts } from "./products.js";
import { renderInventory } from "./inventory.js";
import { renderCreateSale, renderSaleDetail, renderSalesList } from "./sales.js";
import { renderCreatePurchase, renderPurchasesList } from "./purchases.js";
import { renderPayments } from "./payments.js";
import { renderExpenses } from "./expenses.js";
import { renderGST } from "./gst.js";
import { renderReports } from "./reports.js";
import { renderStaff } from "./staff.js";
import { renderNotifications } from "./notifications.js";
import { renderBackup, renderSettings } from "./settings.js";
import { renderStores } from "./stores.js";
import { debounce, escapeHTML, openModal, showToast } from "./utilities.js";

const NAV_ITEMS = [
  { section: "Menu", items: [
    {
      path: "/dashboard", label: "Dashboard", perm: null,
      bg: "#ECEBFC", color: "#2D26D4",
      icon: `<rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.3"/><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.3"/><rect x="13" y="13" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>`
    },
    {
      path: "/ledger", label: "Khata / Ledger", perm: null,
      bg: "#FDF0EC", color: "#E24A23",
      icon: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" fill="currentColor" opacity="0.25"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="16" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/>`
    },
    {
      path: "/parties", label: "Customers", perm: null,
      bg: "#E6F7EE", color: "#13A85B",
      icon: `<circle cx="9" cy="7" r="4" fill="currentColor" opacity="0.3"/><circle cx="9" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`
    },
    {
      path: "/stores", label: "My Stores", perm: null,
      bg: "#FEF7E0", color: "#B87D00",
      icon: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" opacity="0.28"/><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`
    },
    {
      path: "/reports", label: "Reports", perm: "viewReports",
      bg: "#FDECEC", color: "#C8232C",
      icon: `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor" opacity="0.35"/><rect x="10" y="4" width="4" height="16" rx="1" fill="currentColor" opacity="0.35"/><rect x="16" y="8" width="4" height="12" rx="1" fill="currentColor" opacity="0.35"/><rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><rect x="16" y="8" width="4" height="12" rx="1"/>`
    },
    {
      path: "/settings", label: "Settings", perm: null,
      bg: "#E0F5EA", color: "#0F6E3D",
      icon: `<circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.35"/><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`
    }
  ]}
];

const ROUTES = [
  { path: "/dashboard", title: "Dashboard", render: renderDashboard },
  { path: "/stores", title: "My Stores & Businesses", render: renderStores },
  { path: "/parties", title: "Parties", render: renderParties },
  { path: "/parties/:id", title: "Party Ledger", render: renderPartyDetail },
  { path: "/ledger", title: "Khata / Digital Ledger", render: renderLedger },
  { path: "/products", title: "Products", render: renderProducts },
  { path: "/inventory", title: "Inventory & Stock", render: renderInventory },
  { path: "/sales", title: "Sales & Invoices", render: renderSalesList },
  { path: "/sales/create", title: "Create Invoice", render: renderCreateSale },
  { path: "/sales/:id", title: "Invoice Detail", render: renderSaleDetail },
  { path: "/purchases", title: "Purchases", render: renderPurchasesList },
  { path: "/purchases/create", title: "New Purchase", render: renderCreatePurchase },
  { path: "/payments", title: "Payments", render: renderPayments },
  { path: "/expenses", title: "Expenses", render: renderExpenses },
  { path: "/gst", title: "GST & Taxes", render: renderGST },
  { path: "/reports", title: "Reports & Analytics", render: renderReports },
  { path: "/staff", title: "Staff & Permissions", render: renderStaff },
  { path: "/notifications", title: "Notifications & Reminders", render: renderNotifications },
  { path: "/settings", title: "Business Settings", render: renderSettings },
  { path: "/backup", title: "Data Backup & Restore", render: renderBackup }
];

const state = {
  user: null,
  businesses: [],
  activeIndex: 0
};

const authRoot = document.getElementById("auth-root");
const appShell = document.getElementById("app-shell");
const pageContent = document.getElementById("page-content");
const topbarTitle = document.getElementById("topbar-title");

function getActiveContext() {
  const entry = state.businesses[state.activeIndex];
  if (!entry) return null;
  const { business, member } = entry;
  const can = (perm) => {
    if (!perm) return true;
    if (member.role === "Owner" || business.ownerId === state.user?.uid) return true;
    return Boolean(member.permissions?.[perm]);
  };
  return {
    user: state.user,
    business,
    businessId: business.id,
    member,
    stores: state.businesses,
    activeIndex: state.activeIndex,
    switchBusiness: (idx) => {
      if (idx < 0 || idx >= state.businesses.length) return;
      state.activeIndex = idx;
      localStorage.setItem("khataflow_last_biz", state.businesses[idx].business.id);
      routeNow();
    },
    can,
    reloadBusinesses: async () => {
      state.businesses = await loadUserBusinesses(state.user);
      renderShellMeta();
      await routeNow();
    }
  };
}

function renderSidebarNav(currentPath, ctx) {
  const navEl = document.getElementById("sidebar-nav");
  navEl.innerHTML = NAV_ITEMS.map((sec) => {
    const visible = sec.items.filter((it) => ctx.can(it.perm));
    if (visible.length === 0) return "";
    return `
      <div class="nav-section-label">${escapeHTML(sec.section)}</div>
      ${visible.map((it) => `
        <a href="#${it.path}" class="nav-item ${currentPath === it.path || currentPath.startsWith(it.path + "/") ? "active" : ""}">
          <span class="nav-icon-badge" style="background:${it.bg};color:${it.color};">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>
          </span>
          <span>${escapeHTML(it.label)}</span>
        </a>
      `).join("")}
    `;
  }).join("");

  document.querySelectorAll(".mobile-nav-item").forEach((el) => {
    const r = el.dataset.route;
    el.classList.toggle("active", currentPath === r || currentPath.startsWith(r + "/"));
  });
}

function renderShellMeta() {
  const ctx = getActiveContext();
  if (!ctx) return;

  const switcher = document.getElementById("business-switcher");
  switcher.innerHTML = state.businesses
    .map((b, idx) => `<option value="${idx}" ${idx === state.activeIndex ? "selected" : ""}>${escapeHTML(b.business.name)}</option>`)
    .join("") + `<option value="__new__">+ Add New Business</option>`;

  const name = state.user.displayName || state.user.email || "User";
  document.getElementById("sidebar-user-avatar").textContent = name[0].toUpperCase();
  document.getElementById("sidebar-user-name").textContent = name;
  document.getElementById("sidebar-user-role").textContent = ctx.member.role || "Owner";
}

async function routeNow() {
  const { path, query } = parseHash();

  if (!state.user) {
    appShell.classList.add("hidden");
    authRoot.classList.remove("hidden");
    if (path === "/register") {
      renderRegisterView(authRoot);
    } else {
      renderLoginView(authRoot, { onSuccess: () => navigate("/dashboard") });
    }
    return;
  }

  if (state.businesses.length === 0 || path === "/business-setup") {
    appShell.classList.add("hidden");
    authRoot.classList.remove("hidden");
    renderBusinessSetupView(authRoot, state.user, {
      allowCancel: state.businesses.length > 0,
      onBusinessCreated: async (newBiz) => {
        const newBizId = typeof newBiz === "string" ? newBiz : newBiz.id;
        state.businesses = await loadUserBusinesses(state.user);
        let idx = state.businesses.findIndex((b) => b.business.id === newBizId);
        if (idx < 0 && typeof newBiz === "object") {
          state.businesses.push({
            business: newBiz,
            member: { role: "Owner", status: "active", permissions: {} }
          });
          idx = state.businesses.length - 1;
        }
        state.activeIndex = idx >= 0 ? idx : 0;
        if (state.businesses[state.activeIndex]) {
          localStorage.setItem("khataflow_last_biz", state.businesses[state.activeIndex].business.id);
        }
        navigate("/dashboard");
      }
    });
    return;
  }

  authRoot.classList.add("hidden");
  appShell.classList.remove("hidden");
  const ctx = getActiveContext();
  renderShellMeta();

  const matched = matchRoute(path, ROUTES) || { route: ROUTES[0], params: {} };
  topbarTitle.textContent = matched.route.title;
  renderSidebarNav(path, ctx);

  // Close mobile drawer on navigation
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-backdrop").classList.add("hidden");

  pageContent.innerHTML = `<div class="state-box"><div class="spinner"></div></div>`;
  try {
    await matched.route.render(pageContent, ctx, matched.route.path.includes(":") ? matched.params : query, query);
  } catch (err) {
    console.error("Route render error:", err);
    pageContent.innerHTML = `
      <div class="state-box card">
        <h3 class="text-danger">Something went wrong</h3>
        <p class="text-muted">${escapeHTML(err.message || "Unable to load this view.")}</p>
        <button class="btn btn-secondary btn-sm" onclick="location.reload()">Reload</button>
      </div>
    `;
  }
}

function setupUIEvents() {
  // Business switcher
  document.getElementById("business-switcher").addEventListener("change", (e) => {
    if (e.target.value === "__new__") {
      navigate("/business-setup");
      return;
    }
    state.activeIndex = Number(e.target.value);
    const biz = state.businesses[state.activeIndex]?.business;
    if (biz) localStorage.setItem("khataflow_last_biz", biz.id);
    routeNow();
  });

  // Logout
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await performLogout();
    navigate("/login");
  });

  // Mobile sidebar drawer
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  document.getElementById("open-sidebar-btn").addEventListener("click", () => {
    sidebar.classList.add("open");
    backdrop.classList.remove("hidden");
  });
  const closeDrawer = () => {
    sidebar.classList.remove("open");
    backdrop.classList.add("hidden");
  };
  document.getElementById("close-sidebar-btn").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  // Online / Offline indicator
  const pill = document.getElementById("network-status-pill");
  const text = document.getElementById("network-status-text");
  const updateNet = () => {
    const online = navigator.onLine;
    pill.classList.toggle("offline", !online);
    text.textContent = online ? "Online" : "Offline (Cached)";
  };
  window.addEventListener("online", () => {
    updateNet();
    showToast("Back online! Syncing pending Firestore writes...", "success");
  });
  window.addEventListener("offline", () => {
    updateNet();
    showToast("You are offline. Changes are queued locally and will sync automatically.", "warning", 4500);
  });
  updateNet();

  // PWA Install Prompt
  let deferredPrompt = null;
  const installBtn = document.getElementById("install-pwa-btn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove("hidden");
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });

  // Global Search
  const gSearch = document.getElementById("global-search-input");
  gSearch.addEventListener("keydown", debounce(async (e) => {
    if (e.key !== "Enter") return;
    const q = gSearch.value.trim().toLowerCase();
    const ctx = getActiveContext();
    if (!q || !ctx) return;
    const [parties, products, sales] = await Promise.all([
      listCollection("parties", ctx.businessId, null, "desc", 200),
      listCollection("products", ctx.businessId, null, "desc", 200),
      listCollection("sales", ctx.businessId, null, "desc", 200)
    ]);
    const pMatches = parties.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.mobile || "").includes(q)).slice(0, 5);
    const prodMatches = products.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)).slice(0, 5);
    const saleMatches = sales.filter((s) => (s.invoiceNumber || "").toLowerCase().includes(q) || (s.partyName || "").toLowerCase().includes(q)).slice(0, 5);

    const close = openModal({
      title: `Search Results for "${q}"`,
      bodyHTML: `
        <div class="stack-xs" style="gap:14px;">
          <div>
            <strong>Parties (${pMatches.length})</strong>
            ${pMatches.map((p) => `<div><a href="#/parties/${p.id}" class="g-link">${escapeHTML(p.name)} (${escapeHTML(p.mobile)})</a></div>`).join("") || `<div class="text-muted">No matching parties</div>`}
          </div>
          <div>
            <strong>Products (${prodMatches.length})</strong>
            ${prodMatches.map((p) => `<div><a href="#/products" class="g-link">${escapeHTML(p.name)} — Stock: ${p.currentStock}</a></div>`).join("") || `<div class="text-muted">No matching products</div>`}
          </div>
          <div>
            <strong>Invoices (${saleMatches.length})</strong>
            ${saleMatches.map((s) => `<div><a href="#/sales/${s.id}" class="g-link">${escapeHTML(s.invoiceNumber)} — ${escapeHTML(s.partyName)}</a></div>`).join("") || `<div class="text-muted">No matching invoices</div>`}
          </div>
        </div>
      `,
      onMount: (el, close) => {
        el.querySelectorAll(".g-link").forEach((a) => a.addEventListener("click", close));
      }
    });
  }, 150));
}

function renderFirebaseSetupBanner() {
  authRoot.classList.remove("hidden");
  authRoot.innerHTML = `
    <div style="max-width:720px;margin:48px auto;padding:0 16px;">
      <div class="card card-body">
        <div class="brand-mark" style="margin-bottom:14px;">
          <img src="/assets/logo/logo.svg" alt="KhataFlow" />
          <span>KhataFlow — Firebase Configuration Required</span>
        </div>
        <p class="text-secondary">
          Your application shell is ready, but <code>js/firebase-config.js</code> still contains placeholder values.
          Connect your Firebase project to enable Authentication, Cloud Firestore, and Storage:
        </p>
        <ol style="line-height:1.8;color:var(--text-secondary);">
          <li>Create a project in the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console</a>.</li>
          <li>Enable <strong>Authentication</strong> (Email/Password and Google providers).</li>
          <li>Create a <strong>Cloud Firestore</strong> database and <strong>Firebase Storage</strong> bucket.</li>
          <li>Register a Web App and paste your <code>firebaseConfig</code> into <code>js/firebase-config.js</code>.</li>
          <li>Deploy security rules &amp; indexes using <code>firebase deploy --only firestore,storage</code>.</li>
        </ol>
      </div>
    </div>
  `;
}

// Bootstrap
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}

if (!isFirebaseConfigured()) {
  renderFirebaseSetupBanner();
} else {
  setupUIEvents();
  window.addEventListener("hashchange", routeNow);

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (user) {
      await ensureUserDocument(user);
      state.businesses = await loadUserBusinesses(user);
      const lastId = localStorage.getItem("khataflow_last_biz");
      const foundIdx = state.businesses.findIndex((b) => b.business.id === lastId);
      state.activeIndex = foundIdx >= 0 ? foundIdx : 0;
    } else {
      state.businesses = [];
      state.activeIndex = 0;
    }
    await routeNow();
  });
}
