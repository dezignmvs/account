export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

export function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function round2(num) {
  return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(amount, currency = "INR") {
  const val = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  } catch {
    return `₹${val.toFixed(2)}`;
  }
}

export function formatNumber(num) {
  return new Intl.NumberFormat("en-IN").format(Number(num || 0));
}

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = typeof dateStr?.toDate === "function" ? dateStr.toDate() : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function isValidGSTIN(gstin) {
  if (!gstin) return true; // optional
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

export function isValidPAN(pan) {
  if (!pan) return true;
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.trim().toUpperCase());
}

export function isValidPhone(phone) {
  if (!phone) return false;
  return /^[0-9+\-\s]{8,15}$/.test(phone.trim());
}

export function generateIdempotencyKey(prefix = "tx") {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function showToast(message, type = "info", duration = 3400) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export function openModal({ title, bodyHTML, footerHTML = "", large = false, onMount = null }) {
  const root = document.getElementById("modal-root");
  if (!root) return () => {};
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-dialog ${large ? "modal-lg" : ""}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>${escapeHTML(title)}</h3>
        <button type="button" class="btn-icon modal-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ""}
    </div>
  `;
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  root.appendChild(backdrop);
  if (typeof onMount === "function") onMount(backdrop, close);
  return close;
}

export function confirmDialog({ title = "Confirm Action", message, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const close = openModal({
      title,
      bodyHTML: `<p style="margin:0;color:var(--text-secondary);">${escapeHTML(message)}</p>`,
      footerHTML: `
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="ok">${escapeHTML(confirmText)}</button>
      `,
      onMount: (el, close) => {
        el.querySelector('[data-action="cancel"]').addEventListener("click", () => {
          close();
          resolve(false);
        });
        el.querySelector('[data-action="ok"]').addEventListener("click", () => {
          close();
          resolve(true);
        });
      }
    });
  });
}

export function exportToCSV(filename, headers, rows) {
  const csvEscape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(r.map(csvEscape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildWhatsAppURL(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const formatted = digits.length === 10 ? `91${digits}` : digits;
  const text = encodeURIComponent(message);
  return formatted ? `https://wa.me/${formatted}?text=${text}` : `https://wa.me/?text=${text}`;
}

export function drawBarChart(canvas, labels, datasets) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(300, rect.width || 500);
  const height = 240;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  const pad = { top: 20, right: 16, bottom: 32, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let maxVal = 0;
  datasets.forEach((ds) => ds.data.forEach((v) => { if (v > maxVal) maxVal = v; }));
  if (maxVal === 0) maxVal = 1000;

  // Grid lines
  ctx.strokeStyle = "#E4E8E3";
  ctx.fillStyle = "#76837A";
  ctx.font = "11px Plus Jakarta Sans, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const val = Math.round(maxVal * (1 - i / 4));
    ctx.textAlign = "right";
    ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val), pad.left - 8, y + 4);
  }

  const n = labels.length || 1;
  const groupW = plotW / n;
  const barW = Math.min(26, (groupW * 0.68) / datasets.length);

  labels.forEach((lbl, idx) => {
    const xBase = pad.left + idx * groupW + groupW / 2 - (datasets.length * barW) / 2;
    datasets.forEach((ds, dIdx) => {
      const val = Math.max(0, ds.data[idx] || 0);
      const h = (val / maxVal) * plotH;
      const x = xBase + dIdx * (barW + 2);
      const y = pad.top + plotH - h;
      ctx.fillStyle = ds.color || "#146C43";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, h, [4, 4, 0, 0]) : ctx.rect(x, y, barW, h);
      ctx.fill();
    });
    ctx.fillStyle = "#4B574F";
    ctx.textAlign = "center";
    ctx.fillText(lbl, pad.left + idx * groupW + groupW / 2, height - 10);
  });
}

export function getDateRange(preset, customStart = "", customEnd = "") {
  const now = new Date();
  const toISO = (d) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  const today = toISO(now);
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const ys = toISO(y);
    return { start: ys, end: ys };
  }
  if (preset === "week") {
    const w = new Date(now);
    w.setDate(w.getDate() - 6);
    return { start: toISO(w), end: today };
  }
  if (preset === "month") {
    const m = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toISO(m), end: today };
  }
  if (preset === "year") {
    const y = new Date(now.getFullYear(), 0, 1);
    return { start: toISO(y), end: today };
  }
  if (preset === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  return { start: "2000-01-01", end: "2099-12-31" };
}
