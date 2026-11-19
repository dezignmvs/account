# KhataFlow — Business Billing, Inventory & Digital Ledger

A production-oriented business management platform combining **Vyapar** (GST invoicing, purchases, inventory, expenses, reports) and **Khatabook** (digital party ledger, WhatsApp payment reminders, partial/advance settlements) built with **HTML5, CSS3, Vanilla ES6+ JavaScript, Firebase (Auth, Firestore, Storage, Hosting, Functions), and PWA**.

---

## 1. Quick Start & Firebase Configuration

1. **Create a Firebase Project** at [https://console.firebase.google.com/](https://console.firebase.google.com/).
2. **Enable Authentication**:
   - Go to **Authentication -> Sign-in method**.
   - Enable **Email/Password** and **Google**.
3. **Create Cloud Firestore**:
   - Go to **Firestore Database -> Create database** (Production mode).
4. **Enable Firebase Storage**:
   - Go to **Storage -> Get started**.
5. **Add Web App Config**:
   - Go to **Project Settings -> Your apps -> Add Web App**.
   - Copy the `firebaseConfig` object and paste it into `js/firebase-config.js`.
6. **Deploy Security Rules & Indexes**:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use <your-project-id>
   firebase deploy --only firestore,storage
   ```
7. **Run Locally** (no Node.js/npm required for the frontend itself — any static HTTP server works):
   ```bash
   # Using Python
   python -m http.server 5500
   # OR using Firebase Hosting emulator
   firebase serve
   ```
   Open `http://localhost:5500` in your browser.
8. **Deploy to Firebase Hosting**:
   ```bash
   firebase deploy --only hosting
   ```

---

## 2. Architecture & Security Highlights

- **Multi-Business Isolation**: Every document in `parties`, `products`, `sales`, `purchases`, `ledgerEntries`, `payments`, `expenses`, `stockMovements`, `notifications`, `auditLogs`, and `counters` is scoped by `businessId` and enforced in `firestore.rules`.
- **Atomic Financial Transactions**: Sales invoicing, cancellations, purchases, payments, and Khata entries use `runTransaction` to update party balances, product stock, and immutable ledger/stock movement records atomically.
- **Role-Based Access Control (RBAC)**: Owner, Admin, Manager, Accountant, Salesperson, and Viewer roles with granular permissions enforced in both UI and `firestore.rules`.
- **Offline PWA Support**: Service Worker (`sw.js`) caches the app shell, and Firestore `persistentLocalCache` with `persistentMultipleTabManager` queues writes offline and syncs automatically when connectivity returns.
- **GST Disclaimer**: GST calculations support Intra-State (CGST + SGST) and Inter-State (IGST) summaries for accountant review; this app does not claim automated GST portal return filing.
