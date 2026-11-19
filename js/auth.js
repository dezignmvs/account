import {
  auth,
  db,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  runTransaction,
  serverTimestamp
} from "./firebase.js";
import { DEFAULT_PERMISSIONS, uploadBusinessFile } from "./database.js";
import { escapeHTML, INDIAN_STATES, isValidGSTIN, isValidPAN, showToast } from "./utilities.js";

export async function ensureUserDocument(user) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || user.email?.split("@")[0] || "Business Owner",
      photoURL: user.photoURL || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  // Claim any pending staff invitations matching this email
  if (user.email) {
    try {
      const invQ = query(
        collection(db, "businessMembers"),
        where("email", "==", user.email.toLowerCase()),
        where("status", "==", "invited")
      );
      const invSnap = await getDocs(invQ);
      for (const invDoc of invSnap.docs) {
        const data = invDoc.data();
        const targetRef = doc(db, "businessMembers", `${data.businessId}_${user.uid}`);
        await setDoc(targetRef, {
          ...data,
          uid: user.uid,
          name: user.displayName || data.name || user.email,
          status: "active",
          joinedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn("Invite claim check skipped:", e);
    }
  }
}

export async function loadUserBusinesses(user) {
  if (!user) return [];
  const byId = new Map();

  // 1. Load all businesses directly owned by this user
  const ownedSnap = await getDocs(query(collection(db, "businesses"), where("ownerId", "==", user.uid)));
  for (const bDoc of ownedSnap.docs) {
    byId.set(bDoc.id, {
      business: { id: bDoc.id, ...bDoc.data() },
      member: {
        businessId: bDoc.id,
        uid: user.uid,
        role: "Owner",
        permissions: DEFAULT_PERMISSIONS.Owner,
        status: "active"
      }
    });
  }

  // 2. Load any businesses where user is an active staff member
  const memberSnap = await getDocs(query(collection(db, "businessMembers"), where("uid", "==", user.uid)));
  for (const mDoc of memberSnap.docs) {
    const m = { id: mDoc.id, ...mDoc.data() };
    if (m.status !== "active" || byId.has(m.businessId)) continue;
    const bSnap = await getDoc(doc(db, "businesses", m.businessId));
    if (bSnap.exists()) {
      byId.set(bSnap.id, {
        business: { id: bSnap.id, ...bSnap.data() },
        member: m
      });
    }
  }

  return Array.from(byId.values());
}

export async function registerBusiness(user, formValues, logoFile = null) {
  const businessRef = doc(collection(db, "businesses"));
  const businessId = businessRef.id;
  let logoUrl = "";
  if (logoFile) {
    logoUrl = await uploadBusinessFile(businessId, "logo", logoFile);
  }

  const businessData = {
    ownerId: user.uid,
    name: formValues.name.trim(),
    ownerName: formValues.ownerName.trim(),
    businessType: formValues.businessType,
    mobile: formValues.mobile.trim(),
    email: (formValues.email || user.email || "").trim(),
    address: (formValues.address || "").trim(),
    state: formValues.state,
    district: (formValues.district || "").trim(),
    pincode: (formValues.pincode || "").trim(),
    gstin: (formValues.gstin || "").trim().toUpperCase(),
    pan: (formValues.pan || "").trim().toUpperCase(),
    logoUrl,
    financialYear: formValues.financialYear || "2026-27",
    currency: formValues.currency || "INR",
    invoiceFormat: formValues.invoiceFormat || "INV-0001",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await runTransaction(db, async (tx) => {
    tx.set(businessRef, businessData);
    tx.set(doc(db, "businessMembers", `${businessId}_${user.uid}`), {
      businessId,
      uid: user.uid,
      email: (user.email || "").toLowerCase(),
      name: user.displayName || formValues.ownerName.trim(),
      role: "Owner",
      permissions: DEFAULT_PERMISSIONS.Owner,
      status: "active",
      createdAt: serverTimestamp()
    });
    tx.set(doc(db, "settings", businessId), {
      businessId,
      allowNegativeStock: false,
      defaultInvoiceTemplate: "a4",
      invoicePrefix: (formValues.invoiceFormat || "INV").split("-")[0] || "INV",
      purchasePrefix: "PUR",
      paymentPrefix: "PAY",
      termsAndConditions: "Thank you for your business. Subject to local jurisdiction.",
      notifications: { lowStock: true, overdueInvoices: true, paymentConfirmations: true },
      createdAt: serverTimestamp()
    });
  });

  return { id: businessId, ...businessData };
}

export function renderLoginView(container, { onSuccess }) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-hero">
        <div>
          <div class="brand-mark" style="color:#fff;">
            <img src="/assets/logo/logo.svg" alt="KhataFlow" style="background:#fff;padding:3px;" />
            <span>KhataFlow</span>
          </div>
          <h1 class="font-display">Modern Billing, Stock &amp; Digital Khata for Growing Businesses.</h1>
          <p style="opacity:0.88;max-width:440px;margin-top:16px;font-size:15px;">
            Combine GST-ready invoicing, real-time inventory tracking, and Khatabook-style party ledgers in one fast, offline-capable platform.
          </p>
        </div>
        <div style="font-size:13px;opacity:0.8;">
          Secure Cloud Firestore &bull; Role-based Staff Access &bull; Offline PWA
        </div>
      </div>

      <div class="auth-form-panel">
        <div class="auth-card">
          <h2 style="font-size:22px;margin-bottom:6px;">Sign in to KhataFlow</h2>
          <p class="text-muted" style="margin:0 0 20px;">Manage your businesses, invoices, and ledgers.</p>

          <form id="login-form" class="form-grid" style="grid-template-columns:1fr;gap:14px;">
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" name="email" class="form-control" required placeholder="owner@business.com" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" name="password" class="form-control" required placeholder="••••••••" />
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <a href="#/forgot-password" id="forgot-pw-link" style="font-size:13px;">Forgot password?</a>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;">Sign In</button>
          </form>

          <div style="text-align:center;margin:16px 0;color:var(--text-muted);font-size:12px;">OR</div>

          <button id="google-login-btn" type="button" class="btn btn-secondary" style="width:100%;padding:10px;">
            Continue with Google
          </button>

          <p class="text-center text-muted" style="margin:20px 0 0;font-size:13px;">
            New to KhataFlow? <a href="#/register" style="font-weight:600;">Create an account</a>
          </p>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Signing in...";
    try {
      await signInWithEmailAndPassword(auth, fd.get("email").trim(), fd.get("password"));
      showToast("Welcome back!", "success");
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || "Failed to sign in.", "error");
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });

  container.querySelector("#google-login-btn").addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast("Signed in with Google", "success");
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || "Google sign-in failed.", "error");
    }
  });

  container.querySelector("#forgot-pw-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = container.querySelector('input[name="email"]').value.trim();
    if (!email) {
      showToast("Enter your email address first, then click Forgot Password.", "warning");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast("Password reset email sent.", "success");
    } catch (err) {
      showToast(err.message || "Could not send reset email.", "error");
    }
  });
}

export function renderRegisterView(container) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-hero">
        <div>
          <div class="brand-mark" style="color:#fff;">
            <img src="/assets/logo/logo.svg" alt="KhataFlow" style="background:#fff;padding:3px;" />
            <span>KhataFlow</span>
          </div>
          <h1 class="font-display">Start managing your shop, wholesale or services in minutes.</h1>
        </div>
        <div style="font-size:13px;opacity:0.8;">
          Free to set up &bull; Multi-business support &bull; Export anytime
        </div>
      </div>

      <div class="auth-form-panel">
        <div class="auth-card">
          <h2 style="font-size:22px;margin-bottom:6px;">Create Account</h2>
          <p class="text-muted" style="margin:0 0 20px;">Set up your owner login to continue.</p>

          <form id="register-form" class="form-grid" style="grid-template-columns:1fr;gap:14px;">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" name="name" class="form-control" required placeholder="e.g. Rajesh Sharma" />
            </div>
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" name="email" class="form-control" required placeholder="rajesh@sharmatraders.in" />
            </div>
            <div class="form-group">
              <label class="form-label">Password (min 6 characters)</label>
              <input type="password" name="password" class="form-control" minlength="6" required placeholder="Create a strong password" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;">Create Account</button>
          </form>

          <p class="text-center text-muted" style="margin:20px 0 0;font-size:13px;">
            Already have an account? <a href="#/login" style="font-weight:600;">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Creating account...";
    try {
      const cred = await createUserWithEmailAndPassword(auth, fd.get("email").trim(), fd.get("password"));
      await updateProfile(cred.user, { displayName: fd.get("name").trim() });
      await ensureUserDocument(cred.user);
      showToast("Account created! Now set up your business.", "success");
      window.location.hash = "#/business-setup";
    } catch (err) {
      showToast(err.message || "Registration failed.", "error");
      btn.disabled = false;
      btn.textContent = "Create Account";
    }
  });
}

export function renderBusinessSetupView(container, user, { onBusinessCreated, allowCancel = false }) {
  const stateOptions = INDIAN_STATES.map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");
  container.innerHTML = `
    <div style="max-width:680px;margin:32px auto;padding:0 16px;">
      <div class="card" style="border-radius:20px;overflow:hidden;">
        <div class="card-header" style="background:linear-gradient(90deg, var(--brand-primary-soft) 0%, var(--brand-gold-soft) 100%);">
          <div class="flex-row">
            <span class="icon-badge-sm" style="width:38px;height:38px;border-radius:11px;background:var(--brand-indigo);color:#fff;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </span>
            <div>
              <h2 style="font-size:20px;">Create Store / Business</h2>
              <p class="text-muted" style="margin:2px 0 0;font-size:13px;">Each store has completely separate customers, Khata ledger, and transactions.</p>
            </div>
          </div>
          ${allowCancel ? `<a href="#/stores" class="btn btn-secondary btn-sm">&larr; Back to Stores</a>` : ""}
        </div>
        <form id="business-setup-form" class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Store / Business Name *</label>
              <input type="text" name="name" class="form-control" required placeholder="e.g. Cresto Studio / Branch 2" />
            </div>
            <div class="form-group">
              <label class="form-label">Owner Name *</label>
              <input type="text" name="ownerName" class="form-control" required value="${escapeHTML(user.displayName || "")}" />
            </div>
            <div class="form-group">
              <label class="form-label">Business Type *</label>
              <select name="businessType" class="form-control" required>
                <option value="Retail">Retail Shop</option>
                <option value="Wholesale">Wholesale / Distribution</option>
                <option value="Services">Services / Studio</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Mobile Number *</label>
              <input type="tel" name="mobile" class="form-control" required placeholder="10-digit mobile number" />
            </div>
            <div class="form-group">
              <label class="form-label">State *</label>
              <select name="state" class="form-control" required>
                <option value="">Select State</option>
                ${stateOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">City / District</label>
              <input type="text" name="district" class="form-control" placeholder="e.g. Mannarkkad" />
            </div>

            <details class="form-group full" style="border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:12px;background:var(--bg-subtle);">
              <summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--brand-primary);">Optional Tax, Address &amp; Logo Details</summary>
              <div class="form-grid" style="margin-top:12px;">
                <div class="form-group">
                  <label class="form-label">Business Email</label>
                  <input type="email" name="email" class="form-control" value="${escapeHTML(user.email || "")}" />
                </div>
                <div class="form-group">
                  <label class="form-label">PIN Code</label>
                  <input type="text" name="pincode" class="form-control" maxlength="6" />
                </div>
                <div class="form-group full">
                  <label class="form-label">Business Address</label>
                  <textarea name="address" class="form-control" placeholder="Shop No, Street, Landmark"></textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">GSTIN (Optional)</label>
                  <input type="text" name="gstin" class="form-control" maxlength="15" placeholder="22AAAAA0000A1Z5" style="text-transform:uppercase;" />
                </div>
                <div class="form-group">
                  <label class="form-label">PAN (Optional)</label>
                  <input type="text" name="pan" class="form-control" maxlength="10" placeholder="AAAAA0000A" style="text-transform:uppercase;" />
                </div>
                <div class="form-group">
                  <label class="form-label">Financial Year</label>
                  <select name="financialYear" class="form-control">
                    <option value="2026-27">2026–27</option>
                    <option value="2025-26">2025–26</option>
                    <option value="2027-28">2027–28</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Invoice Numbering Format</label>
                  <input type="text" name="invoiceFormat" class="form-control" value="INV-0001" />
                </div>
                <div class="form-group full">
                  <label class="form-label">Store Logo (Optional)</label>
                  <input type="file" name="logo" class="form-control" accept="image/*" />
                </div>
              </div>
            </details>
          </div>
          <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;">
            <button type="submit" class="btn btn-primary" style="border-radius:999px;padding:10px 22px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Save &amp; Open Store
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  container.querySelector("#business-setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const gstin = fd.get("gstin").trim().toUpperCase();
    const pan = fd.get("pan").trim().toUpperCase();
    if (!isValidGSTIN(gstin)) {
      showToast("Invalid GSTIN format (15 characters expected).", "error");
      return;
    }
    if (!isValidPAN(pan)) {
      showToast("Invalid PAN format (e.g. ABCDE1234F).", "error");
      return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Creating Business...";
    try {
      const logoFile = fd.get("logo")?.size > 0 ? fd.get("logo") : null;
      const biz = await registerBusiness(user, Object.fromEntries(fd.entries()), logoFile);
      showToast(`Business "${biz.name}" created!`, "success");
      if (onBusinessCreated) await onBusinessCreated(biz);
    } catch (err) {
      showToast(err.message || "Failed to create business.", "error");
      btn.disabled = false;
      btn.textContent = "Save & Launch Business";
    }
  });
}

export async function performLogout() {
  await signOut(auth);
  showToast("Signed out.", "info");
}
