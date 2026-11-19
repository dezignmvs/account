import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp
} from "./firebase.js";
import { round2, todayISO } from "./utilities.js";

export const DEFAULT_PERMISSIONS = {
  Owner: {
    viewSales: true, createInvoices: true, editInvoices: true, deleteTransactions: true,
    manageProducts: true, manageParties: true, viewReports: true, manageExpenses: true,
    manageStaff: true, changeSettings: true, managePurchases: true, managePayments: true
  },
  Admin: {
    viewSales: true, createInvoices: true, editInvoices: true, deleteTransactions: true,
    manageProducts: true, manageParties: true, viewReports: true, manageExpenses: true,
    manageStaff: true, changeSettings: true, managePurchases: true, managePayments: true
  },
  Manager: {
    viewSales: true, createInvoices: true, editInvoices: true, deleteTransactions: false,
    manageProducts: true, manageParties: true, viewReports: true, manageExpenses: true,
    manageStaff: false, changeSettings: false, managePurchases: true, managePayments: true
  },
  Accountant: {
    viewSales: true, createInvoices: false, editInvoices: false, deleteTransactions: false,
    manageProducts: false, manageParties: true, viewReports: true, manageExpenses: true,
    manageStaff: false, changeSettings: false, managePurchases: true, managePayments: true
  },
  Salesperson: {
    viewSales: true, createInvoices: true, editInvoices: false, deleteTransactions: false,
    manageProducts: false, manageParties: true, viewReports: false, manageExpenses: false,
    manageStaff: false, changeSettings: false, managePurchases: false, managePayments: true
  },
  Viewer: {
    viewSales: true, createInvoices: false, editInvoices: false, deleteTransactions: false,
    manageProducts: false, manageParties: false, viewReports: true, manageExpenses: false,
    manageStaff: false, changeSettings: false, managePurchases: false, managePayments: false
  }
};

/**
 * Compresses images client-side into lightweight Data URLs stored in Firestore
 * (no Firebase Storage bucket required). Rejects oversized non-image files.
 */
export async function uploadBusinessFile(_businessId, _folder, file) {
  if (!file) return "";
  if (file.type.startsWith("image/")) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image file."));
        img.onload = () => {
          const maxDim = 640;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  if (file.size > 250 * 1024) {
    throw new Error("Without Firebase Storage, non-image attachments must be under 250 KB.");
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export async function logAudit(businessId, user, action, entityType, entityId, details = {}) {
  try {
    await addDoc(collection(db, "auditLogs"), {
      businessId,
      userId: user?.uid || "system",
      userName: user?.displayName || user?.email || "User",
      action,
      entityType,
      entityId: entityId || "",
      details,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Audit log skipped:", err);
  }
}

export async function createNotification(businessId, { type, title, message, link = "" }) {
  try {
    await addDoc(collection(db, "notifications"), {
      businessId,
      type,
      title,
      message,
      link,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Notification creation skipped:", err);
  }
}

function toSortableValue(val) {
  if (val === null || val === undefined) return "";
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val === "number") return val;
  return String(val).toLowerCase();
}

export async function listCollection(colName, businessId, sortField = null, sortDir = "desc", maxRows = 500) {
  const q = query(collection(db, colName), where("businessId", "==", businessId), limit(maxRows || 500));
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (sortField) {
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const va = toSortableValue(a[sortField]);
      const vb = toSortableValue(b[sortField]);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  return rows;
}

export async function getBusinessSettings(businessId) {
  const snap = await getDoc(doc(db, "settings", businessId));
  if (snap.exists()) return snap.data();
  return {
    businessId,
    allowNegativeStock: false,
    defaultInvoiceTemplate: "a4",
    invoicePrefix: "INV",
    purchasePrefix: "PUR",
    paymentPrefix: "PAY",
    termsAndConditions: "Thank you for your business. Goods once sold will only be exchanged as per store policy.",
    notifications: {
      lowStock: true,
      overdueInvoices: true,
      paymentConfirmations: true
    }
  };
}

export async function saveBusinessSettings(businessId, data, user) {
  await setDoc(doc(db, "settings", businessId), { ...data, businessId, updatedAt: serverTimestamp() }, { merge: true });
  await logAudit(businessId, user, "UPDATE_SETTINGS", "settings", businessId, {});
}

export async function getNextSequenceNumber(tx, businessId, type, prefix) {
  const counterRef = doc(db, "counters", `${businessId}_${type}`);
  const counterSnap = await tx.get(counterRef);
  const nextSeq = counterSnap.exists() ? (counterSnap.data().seq || 0) + 1 : 1;
  tx.set(counterRef, { businessId, type, seq: nextSeq, updatedAt: serverTimestamp() }, { merge: true });
  return `${prefix}-${String(nextSeq).padStart(4, "0")}`;
}

/* ==================== PARTIES & KHATA LEDGER ==================== */
export async function saveParty(businessId, partyData, existingId = null, user = null) {
  const openingBal = round2(partyData.openingBalance || 0);
  const signedOpening = partyData.openingType === "payable" ? -Math.abs(openingBal) : Math.abs(openingBal);

  if (existingId) {
    const partyRef = doc(db, "parties", existingId);
    await updateDoc(partyRef, {
      name: partyData.name.trim(),
      type: partyData.type,
      mobile: partyData.mobile.trim(),
      email: (partyData.email || "").trim(),
      address: (partyData.address || "").trim(),
      state: partyData.state || "",
      gstin: (partyData.gstin || "").trim().toUpperCase(),
      creditLimit: round2(partyData.creditLimit || 0),
      category: (partyData.category || "General").trim(),
      notes: (partyData.notes || "").trim(),
      updatedAt: serverTimestamp()
    });
    await logAudit(businessId, user, "UPDATE_PARTY", "parties", existingId, { name: partyData.name });
    return existingId;
  }

  const partyRef = doc(collection(db, "parties"));
  await runTransaction(db, async (tx) => {
    tx.set(partyRef, {
      businessId,
      name: partyData.name.trim(),
      type: partyData.type,
      mobile: partyData.mobile.trim(),
      email: (partyData.email || "").trim(),
      address: (partyData.address || "").trim(),
      state: partyData.state || "",
      gstin: (partyData.gstin || "").trim().toUpperCase(),
      openingBalance: signedOpening,
      currentBalance: signedOpening,
      creditLimit: round2(partyData.creditLimit || 0),
      category: (partyData.category || "General").trim(),
      notes: (partyData.notes || "").trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (signedOpening !== 0) {
      const ledgerRef = doc(collection(db, "ledgerEntries"));
      tx.set(ledgerRef, {
        businessId,
        partyId: partyRef.id,
        partyName: partyData.name.trim(),
        entryType: signedOpening > 0 ? "debit" : "credit",
        category: "opening_balance",
        amount: Math.abs(signedOpening),
        balanceAfter: signedOpening,
        date: todayISO(),
        description: "Opening Balance",
        paymentMethod: "none",
        referenceNo: "",
        attachmentUrl: "",
        notes: "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp()
      });
    }
  });
  await logAudit(businessId, user, "CREATE_PARTY", "parties", partyRef.id, { name: partyData.name });
  return partyRef.id;
}

export async function deletePartyValidated(businessId, partyId, user) {
  const ledgerQ = query(collection(db, "ledgerEntries"), where("businessId", "==", businessId), where("partyId", "==", partyId), limit(2));
  const ledgerSnap = await getDocs(ledgerQ);
  const nonOpening = ledgerSnap.docs.filter((d) => d.data().category !== "opening_balance");
  if (nonOpening.length > 0) {
    throw new Error("Cannot delete party with existing ledger transactions.");
  }
  await deleteDoc(doc(db, "parties", partyId));
  await logAudit(businessId, user, "DELETE_PARTY", "parties", partyId, {});
}

export async function addLedgerEntry(businessId, entry, user) {
  const amount = round2(entry.amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero.");

  const entryId = entry.idempotencyKey || doc(collection(db, "ledgerEntries")).id;
  const entryRef = doc(db, "ledgerEntries", entryId);
  const partyRef = doc(db, "parties", entry.partyId);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(entryRef);
    if (existing.exists()) throw new Error("Duplicate ledger entry prevented.");

    const partySnap = await tx.get(partyRef);
    if (!partySnap.exists()) throw new Error("Party not found.");
    const party = partySnap.data();

    const delta = entry.entryType === "credit" ? amount : -amount;
    const newBalance = round2((party.currentBalance || 0) + delta);

    tx.update(partyRef, {
      currentBalance: newBalance,
      updatedAt: serverTimestamp()
    });

    tx.set(entryRef, {
      businessId,
      partyId: entry.partyId,
      partyName: party.name,
      entryType: entry.entryType, // 'debit' (you gave) | 'credit' (you got)
      category: entry.category || "manual", // manual | correction | payment | sale | purchase
      amount,
      balanceAfter: newBalance,
      date: entry.date || todayISO(),
      description: (entry.description || "").trim(),
      paymentMethod: entry.paymentMethod || "cash",
      referenceNo: (entry.referenceNo || "").trim(),
      attachmentUrl: entry.attachmentUrl || "",
      notes: (entry.notes || "").trim(),
      createdBy: user?.uid || "",
      createdAt: serverTimestamp()
    });
  });

  await logAudit(businessId, user, "CREATE_LEDGER_ENTRY", "ledgerEntries", entryId, {
    partyId: entry.partyId,
    entryType: entry.entryType,
    amount
  });
  return entryId;
}

/* ==================== PRODUCTS & INVENTORY ==================== */
export async function saveProduct(businessId, productData, existingId = null, user = null) {
  if (existingId) {
    await updateDoc(doc(db, "products", existingId), {
      name: productData.name.trim(),
      code: (productData.code || "").trim(),
      sku: (productData.sku || "").trim(),
      barcode: (productData.barcode || "").trim(),
      category: (productData.category || "General").trim(),
      brand: (productData.brand || "").trim(),
      description: (productData.description || "").trim(),
      imageUrl: productData.imageUrl || "",
      purchasePrice: round2(productData.purchasePrice),
      sellingPrice: round2(productData.sellingPrice),
      mrp: round2(productData.mrp),
      gstRate: round2(productData.gstRate),
      unit: (productData.unit || "PCS").trim(),
      minStock: round2(productData.minStock),
      updatedAt: serverTimestamp()
    });
    await logAudit(businessId, user, "UPDATE_PRODUCT", "products", existingId, { name: productData.name });
    return existingId;
  }

  const prodRef = doc(collection(db, "products"));
  const openingStock = round2(productData.openingStock || 0);
  await runTransaction(db, async (tx) => {
    tx.set(prodRef, {
      businessId,
      name: productData.name.trim(),
      code: (productData.code || "").trim(),
      sku: (productData.sku || "").trim(),
      barcode: (productData.barcode || "").trim(),
      category: (productData.category || "General").trim(),
      brand: (productData.brand || "").trim(),
      description: (productData.description || "").trim(),
      imageUrl: productData.imageUrl || "",
      purchasePrice: round2(productData.purchasePrice),
      sellingPrice: round2(productData.sellingPrice),
      mrp: round2(productData.mrp),
      gstRate: round2(productData.gstRate),
      unit: (productData.unit || "PCS").trim(),
      openingStock,
      currentStock: openingStock,
      minStock: round2(productData.minStock),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (openingStock !== 0) {
      const movRef = doc(collection(db, "stockMovements"));
      tx.set(movRef, {
        businessId,
        productId: prodRef.id,
        productName: productData.name.trim(),
        type: "opening",
        quantityChange: openingStock,
        stockAfter: openingStock,
        referenceType: "product",
        referenceId: prodRef.id,
        notes: "Opening Stock",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp()
      });
    }
  });
  await logAudit(businessId, user, "CREATE_PRODUCT", "products", prodRef.id, { name: productData.name });
  return prodRef.id;
}

export async function deleteProductValidated(businessId, productId, user) {
  const movQ = query(collection(db, "stockMovements"), where("businessId", "==", businessId), where("productId", "==", productId), limit(2));
  const snap = await getDocs(movQ);
  const nonOpening = snap.docs.filter((d) => d.data().type !== "opening");
  if (nonOpening.length > 0) {
    throw new Error("Cannot delete product that has stock movements or invoices.");
  }
  await deleteDoc(doc(db, "products", productId));
  await logAudit(businessId, user, "DELETE_PRODUCT", "products", productId, {});
}

export async function adjustStock(businessId, { productId, type, quantity, notes, allowNegative = false }, user) {
  const qty = round2(quantity);
  if (qty <= 0) throw new Error("Quantity must be greater than zero.");
  const delta = type === "out" ? -qty : qty;

  const prodRef = doc(db, "products", productId);
  let newStock = 0;
  let prodName = "";
  let minStock = 0;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(prodRef);
    if (!snap.exists()) throw new Error("Product not found.");
    const prod = snap.data();
    prodName = prod.name;
    minStock = prod.minStock || 0;
    newStock = round2((prod.currentStock || 0) + delta);
    if (!allowNegative && newStock < 0) {
      throw new Error(`Insufficient stock for ${prod.name}. Available: ${prod.currentStock}`);
    }

    tx.update(prodRef, { currentStock: newStock, updatedAt: serverTimestamp() });
    const movRef = doc(collection(db, "stockMovements"));
    tx.set(movRef, {
      businessId,
      productId,
      productName: prod.name,
      type: type === "in" ? "stock_in" : type === "out" ? "stock_out" : "adjustment",
      quantityChange: delta,
      stockAfter: newStock,
      referenceType: "manual",
      referenceId: "",
      notes: (notes || "").trim() || `Manual ${type}`,
      createdBy: user?.uid || "",
      createdAt: serverTimestamp()
    });
  });

  if (newStock <= minStock) {
    await createNotification(businessId, {
      type: "low_stock",
      title: newStock <= 0 ? "Out of Stock Alert" : "Low Stock Alert",
      message: `${prodName} stock is now ${newStock} (Min: ${minStock}).`,
      link: "#/inventory"
    });
  }
  await logAudit(businessId, user, "ADJUST_STOCK", "products", productId, { type, qty, newStock });
}

/* ==================== SALES & INVOICES ==================== */
export async function createSaleInvoice(businessId, payload, user, settings) {
  const invoiceId = payload.idempotencyKey || doc(collection(db, "sales")).id;
  const saleRef = doc(db, "sales", invoiceId);
  const allowNegative = Boolean(settings?.allowNegativeStock);
  const prefix = settings?.invoicePrefix || "INV";
  const isDraft = payload.status === "draft";
  const lowStockAlerts = [];

  let finalInvoiceNumber = payload.invoiceNumber || "";

  await runTransaction(db, async (tx) => {
    const dup = await tx.get(saleRef);
    if (dup.exists()) throw new Error("Duplicate invoice submission prevented.");

    // Read party & all products first (Firestore transactions require all reads before writes)
    let partySnap = null;
    let partyRef = null;
    if (payload.partyId) {
      partyRef = doc(db, "parties", payload.partyId);
      partySnap = await tx.get(partyRef);
      if (!partySnap.exists()) throw new Error("Selected customer not found.");
    }

    const productReads = [];
    for (const item of payload.items) {
      if (item.productId) {
        const pRef = doc(db, "products", item.productId);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error(`Product ${item.name} not found.`);
        productReads.push({ item, pRef, pData: pSnap.data() });
      } else {
        productReads.push({ item, pRef: null, pData: null });
      }
    }

    if (!finalInvoiceNumber) {
      finalInvoiceNumber = await getNextSequenceNumber(tx, businessId, isDraft ? "draft_sale" : "sale", isDraft ? "DRF" : prefix);
    }

    const grandTotal = round2(payload.grandTotal);
    const amountReceived = isDraft ? 0 : round2(payload.amountReceived || 0);
    const balanceDue = round2(Math.max(0, grandTotal - amountReceived));
    const paymentStatus = isDraft
      ? "draft"
      : balanceDue === 0
      ? "paid"
      : amountReceived > 0
      ? "partial"
      : "unpaid";

    tx.set(saleRef, {
      businessId,
      invoiceNumber: finalInvoiceNumber,
      date: payload.date || todayISO(),
      dueDate: payload.dueDate || payload.date || todayISO(),
      partyId: payload.partyId || "",
      partyName: payload.partyName || "Walk-in Customer",
      partyMobile: payload.partyMobile || "",
      partyState: payload.partyState || "",
      partyGstin: payload.partyGstin || "",
      isInterState: Boolean(payload.isInterState),
      subtotal: round2(payload.subtotal),
      totalDiscount: round2(payload.totalDiscount),
      taxableAmount: round2(payload.taxableAmount),
      cgstTotal: round2(payload.cgstTotal),
      sgstTotal: round2(payload.sgstTotal),
      igstTotal: round2(payload.igstTotal),
      gstTotal: round2(payload.gstTotal),
      shippingCharges: round2(payload.shippingCharges),
      roundOff: round2(payload.roundOff),
      grandTotal,
      amountReceived,
      balanceDue,
      paymentStatus,
      paymentMethod: payload.paymentMethod || "cash",
      status: isDraft ? "draft" : "final",
      notes: (payload.notes || "").trim(),
      items: payload.items,
      createdBy: user?.uid || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (!isDraft) {
      // 1. Reduce inventory & record stock movements
      for (const { item, pRef, pData } of productReads) {
        if (!pRef) continue;
        const newStock = round2((pData.currentStock || 0) - Number(item.quantity));
        if (!allowNegative && newStock < 0) {
          throw new Error(`Insufficient stock for "${pData.name}". Available: ${pData.currentStock}`);
        }
        tx.update(pRef, { currentStock: newStock, updatedAt: serverTimestamp() });
        const movRef = doc(collection(db, "stockMovements"));
        tx.set(movRef, {
          businessId,
          productId: pRef.id,
          productName: pData.name,
          type: "sale",
          quantityChange: -Number(item.quantity),
          stockAfter: newStock,
          referenceType: "sale",
          referenceId: invoiceId,
          notes: `Invoice ${finalInvoiceNumber}`,
          createdBy: user?.uid || "",
          createdAt: serverTimestamp()
        });
        if (newStock <= (pData.minStock || 0)) {
          lowStockAlerts.push({ name: pData.name, stock: newStock, min: pData.minStock || 0 });
        }
      }

      // 2. Update Party Balance & Khata Ledger
      if (partyRef && partySnap) {
        let runningBal = round2(partySnap.data().currentBalance || 0);
        // Sale Debit
        runningBal = round2(runningBal + grandTotal);
        tx.set(doc(collection(db, "ledgerEntries")), {
          businessId,
          partyId: partyRef.id,
          partyName: partySnap.data().name,
          entryType: "debit",
          category: "sale",
          amount: grandTotal,
          balanceAfter: runningBal,
          date: payload.date || todayISO(),
          description: `Sales Invoice ${finalInvoiceNumber}`,
          paymentMethod: "credit",
          referenceNo: finalInvoiceNumber,
          attachmentUrl: "",
          notes: "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp()
        });

        // Immediate payment Credit if amountReceived > 0
        if (amountReceived > 0) {
          runningBal = round2(runningBal - amountReceived);
          tx.set(doc(collection(db, "ledgerEntries")), {
            businessId,
            partyId: partyRef.id,
            partyName: partySnap.data().name,
            entryType: "credit",
            category: "payment",
            amount: amountReceived,
            balanceAfter: runningBal,
            date: payload.date || todayISO(),
            description: `Payment against ${finalInvoiceNumber}`,
            paymentMethod: payload.paymentMethod || "cash",
            referenceNo: finalInvoiceNumber,
            attachmentUrl: "",
            notes: "",
            createdBy: user?.uid || "",
            createdAt: serverTimestamp()
          });

          const payNum = await getNextSequenceNumber(tx, businessId, "payment", settings?.paymentPrefix || "PAY");
          tx.set(doc(collection(db, "payments")), {
            businessId,
            paymentNumber: payNum,
            direction: "in",
            partyId: partyRef.id,
            partyName: partySnap.data().name,
            invoiceId,
            invoiceNumber: finalInvoiceNumber,
            amount: amountReceived,
            date: payload.date || todayISO(),
            method: payload.paymentMethod || "cash",
            referenceNo: finalInvoiceNumber,
            notes: `Against ${finalInvoiceNumber}`,
            createdBy: user?.uid || "",
            createdAt: serverTimestamp()
          });
        }

        tx.update(partyRef, { currentBalance: runningBal, updatedAt: serverTimestamp() });
      }
    }
  });

  for (const al of lowStockAlerts) {
    await createNotification(businessId, {
      type: "low_stock",
      title: al.stock <= 0 ? "Out of Stock Alert" : "Low Stock Alert",
      message: `${al.name} stock dropped to ${al.stock} (Min: ${al.min}).`,
      link: "#/inventory"
    });
  }

  await logAudit(businessId, user, isDraft ? "CREATE_DRAFT_INVOICE" : "CREATE_INVOICE", "sales", invoiceId, {
    invoiceNumber: finalInvoiceNumber,
    grandTotal: payload.grandTotal
  });

  return { id: invoiceId, invoiceNumber: finalInvoiceNumber };
}

export async function cancelSaleInvoice(businessId, saleId, user) {
  const saleRef = doc(db, "sales", saleId);
  await runTransaction(db, async (tx) => {
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists()) throw new Error("Invoice not found.");
    const sale = saleSnap.data();
    if (sale.status === "cancelled") throw new Error("Invoice is already cancelled.");

    let partySnap = null;
    let partyRef = null;
    if (sale.partyId && sale.status !== "draft") {
      partyRef = doc(db, "parties", sale.partyId);
      partySnap = await tx.get(partyRef);
    }

    const productReads = [];
    if (sale.status !== "draft") {
      for (const item of sale.items || []) {
        if (item.productId) {
          const pRef = doc(db, "products", item.productId);
          const pSnap = await tx.get(pRef);
          if (pSnap.exists()) productReads.push({ item, pRef, pData: pSnap.data() });
        }
      }
    }

    // Reverse stock
    for (const { item, pRef, pData } of productReads) {
      const restored = round2((pData.currentStock || 0) + Number(item.quantity));
      tx.update(pRef, { currentStock: restored, updatedAt: serverTimestamp() });
      tx.set(doc(collection(db, "stockMovements")), {
        businessId,
        productId: pRef.id,
        productName: pData.name,
        type: "sale_cancel_reversal",
        quantityChange: Number(item.quantity),
        stockAfter: restored,
        referenceType: "sale",
        referenceId: saleId,
        notes: `Cancelled ${sale.invoiceNumber}`,
        createdBy: user?.uid || "",
        createdAt: serverTimestamp()
      });
    }

    // Reverse party balance via immutable reversal ledger entry
    if (partyRef && partySnap && partySnap.exists()) {
      const netEffect = round2((sale.grandTotal || 0) - (sale.amountReceived || 0));
      const newBal = round2((partySnap.data().currentBalance || 0) - netEffect);
      tx.update(partyRef, { currentBalance: newBal, updatedAt: serverTimestamp() });
      if (netEffect !== 0) {
        tx.set(doc(collection(db, "ledgerEntries")), {
          businessId,
          partyId: partyRef.id,
          partyName: partySnap.data().name,
          entryType: netEffect > 0 ? "credit" : "debit",
          category: "correction",
          amount: Math.abs(netEffect),
          balanceAfter: newBal,
          date: todayISO(),
          description: `Reversal for Cancelled Invoice ${sale.invoiceNumber}`,
          paymentMethod: "none",
          referenceNo: sale.invoiceNumber,
          attachmentUrl: "",
          notes: "Invoice cancelled",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp()
        });
      }
    }

    tx.update(saleRef, {
      status: "cancelled",
      paymentStatus: "cancelled",
      balanceDue: 0,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  await logAudit(businessId, user, "CANCEL_INVOICE", "sales", saleId, {});
}

/* ==================== PURCHASES ==================== */
export async function createPurchaseEntry(businessId, payload, user, settings) {
  const purchaseId = payload.idempotencyKey || doc(collection(db, "purchases")).id;
  const purRef = doc(db, "purchases", purchaseId);
  const prefix = settings?.purchasePrefix || "PUR";
  let finalNumber = payload.purchaseNumber || "";

  await runTransaction(db, async (tx) => {
    const dup = await tx.get(purRef);
    if (dup.exists()) throw new Error("Duplicate purchase submission prevented.");

    let partyRef = null;
    let partySnap = null;
    if (payload.partyId) {
      partyRef = doc(db, "parties", payload.partyId);
      partySnap = await tx.get(partyRef);
      if (!partySnap.exists()) throw new Error("Selected supplier not found.");
    }

    const productReads = [];
    for (const item of payload.items) {
      if (item.productId) {
        const pRef = doc(db, "products", item.productId);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists()) throw new Error(`Product ${item.name} not found.`);
        productReads.push({ item, pRef, pData: pSnap.data() });
      }
    }

    if (!finalNumber) {
      finalNumber = await getNextSequenceNumber(tx, businessId, "purchase", prefix);
    }

    const grandTotal = round2(payload.grandTotal);
    const paidAmount = round2(payload.paidAmount || 0);
    const pendingAmount = round2(Math.max(0, grandTotal - paidAmount));
    const paymentStatus = pendingAmount === 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    tx.set(purRef, {
      businessId,
      purchaseNumber: finalNumber,
      supplierInvoiceNo: (payload.supplierInvoiceNo || "").trim(),
      date: payload.date || todayISO(),
      partyId: payload.partyId || "",
      partyName: payload.partyName || "Cash Supplier",
      isInterState: Boolean(payload.isInterState),
      subtotal: round2(payload.subtotal),
      gstTotal: round2(payload.gstTotal),
      additionalCharges: round2(payload.additionalCharges),
      grandTotal,
      paidAmount,
      pendingAmount,
      paymentStatus,
      paymentMethod: payload.paymentMethod || "bank",
      status: "final",
      notes: (payload.notes || "").trim(),
      items: payload.items,
      createdBy: user?.uid || "",
      createdAt: serverTimestamp()
    });

    // Increase stock
    for (const { item, pRef, pData } of productReads) {
      const newStock = round2((pData.currentStock || 0) + Number(item.quantity));
      tx.update(pRef, {
        currentStock: newStock,
        purchasePrice: round2(item.price),
        updatedAt: serverTimestamp()
      });
      tx.set(doc(collection(db, "stockMovements")), {
        businessId,
        productId: pRef.id,
        productName: pData.name,
        type: "purchase",
        quantityChange: Number(item.quantity),
        stockAfter: newStock,
        referenceType: "purchase",
        referenceId: purchaseId,
        notes: `Purchase ${finalNumber}`,
        createdBy: user?.uid || "",
        createdAt: serverTimestamp()
      });
    }

    // Supplier Ledger
    if (partyRef && partySnap) {
      let bal = round2(partySnap.data().currentBalance || 0);
      bal = round2(bal - grandTotal); // Credit entry (we owe supplier)
      tx.set(doc(collection(db, "ledgerEntries")), {
        businessId,
        partyId: partyRef.id,
        partyName: partySnap.data().name,
        entryType: "credit",
        category: "purchase",
        amount: grandTotal,
        balanceAfter: bal,
        date: payload.date || todayISO(),
        description: `Purchase ${finalNumber}`,
        paymentMethod: "credit",
        referenceNo: finalNumber,
        attachmentUrl: "",
        notes: "",
        createdBy: user?.uid || "",
        createdAt: serverTimestamp()
      });

      if (paidAmount > 0) {
        bal = round2(bal + paidAmount);
        tx.set(doc(collection(db, "ledgerEntries")), {
          businessId,
          partyId: partyRef.id,
          partyName: partySnap.data().name,
          entryType: "debit",
          category: "payment",
          amount: paidAmount,
          balanceAfter: bal,
          date: payload.date || todayISO(),
          description: `Payment for Purchase ${finalNumber}`,
          paymentMethod: payload.paymentMethod || "bank",
          referenceNo: finalNumber,
          attachmentUrl: "",
          notes: "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp()
        });

        const payNum = await getNextSequenceNumber(tx, businessId, "payment", settings?.paymentPrefix || "PAY");
        tx.set(doc(collection(db, "payments")), {
          businessId,
          paymentNumber: payNum,
          direction: "out",
          partyId: partyRef.id,
          partyName: partySnap.data().name,
          purchaseId,
          purchaseNumber: finalNumber,
          amount: paidAmount,
          date: payload.date || todayISO(),
          method: payload.paymentMethod || "bank",
          referenceNo: finalNumber,
          notes: `Against ${finalNumber}`,
          createdBy: user?.uid || "",
          createdAt: serverTimestamp()
        });
      }
      tx.update(partyRef, { currentBalance: bal, updatedAt: serverTimestamp() });
    }
  });

  await logAudit(businessId, user, "CREATE_PURCHASE", "purchases", purchaseId, { purchaseNumber: finalNumber, grandTotal: payload.grandTotal });
  return { id: purchaseId, purchaseNumber: finalNumber };
}

/* ==================== PAYMENTS ==================== */
export async function recordPayment(businessId, payload, user, settings) {
  const amount = round2(payload.amount);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero.");

  const paymentId = payload.idempotencyKey || doc(collection(db, "payments")).id;
  const payRef = doc(db, "payments", paymentId);
  const partyRef = doc(db, "parties", payload.partyId);
  let payNumber = "";

  await runTransaction(db, async (tx) => {
    const dup = await tx.get(payRef);
    if (dup.exists()) throw new Error("Duplicate payment prevented.");

    const partySnap = await tx.get(partyRef);
    if (!partySnap.exists()) throw new Error("Party not found.");
    const party = partySnap.data();

    let linkedDocRef = null;
    let linkedDocSnap = null;
    if (payload.linkedCollection && payload.linkedId) {
      linkedDocRef = doc(db, payload.linkedCollection, payload.linkedId);
      linkedDocSnap = await tx.get(linkedDocRef);
    }

    payNumber = await getNextSequenceNumber(tx, businessId, "payment", settings?.paymentPrefix || "PAY");

    // direction: 'in' (customer pays us -> credit -> reduces positive receivable)
    // direction: 'out' (we pay supplier -> debit -> reduces negative payable)
    const isIn = payload.direction === "in";
    const delta = isIn ? -amount : amount;
    const newBal = round2((party.currentBalance || 0) + delta);

    tx.update(partyRef, { currentBalance: newBal, updatedAt: serverTimestamp() });

    tx.set(doc(collection(db, "ledgerEntries")), {
      businessId,
      partyId: partyRef.id,
      partyName: party.name,
      entryType: isIn ? "credit" : "debit",
      category: "payment",
      amount,
      balanceAfter: newBal,
      date: payload.date || todayISO(),
      description: payload.notes || `Payment ${payNumber}`,
      paymentMethod: payload.method || "cash",
      referenceNo: payload.referenceNo || payNumber,
      attachmentUrl: "",
      notes: "",
      createdBy: user?.uid || "",
      createdAt: serverTimestamp()
    });

    if (linkedDocRef && linkedDocSnap && linkedDocSnap.exists()) {
      const docData = linkedDocSnap.data();
      if (payload.linkedCollection === "sales") {
        const newRec = round2((docData.amountReceived || 0) + amount);
        const newDue = round2(Math.max(0, (docData.grandTotal || 0) - newRec));
        tx.update(linkedDocRef, {
          amountReceived: newRec,
          balanceDue: newDue,
          paymentStatus: newDue === 0 ? "paid" : "partial",
          updatedAt: serverTimestamp()
        });
      } else if (payload.linkedCollection === "purchases") {
        const newPaid = round2((docData.paidAmount || 0) + amount);
        const newPend = round2(Math.max(0, (docData.grandTotal || 0) - newPaid));
        tx.update(linkedDocRef, {
          paidAmount: newPaid,
          pendingAmount: newPend,
          paymentStatus: newPend === 0 ? "paid" : "partial",
          updatedAt: serverTimestamp()
        });
      }
    }

    tx.set(payRef, {
      businessId,
      paymentNumber: payNumber,
      direction: payload.direction,
      partyId: partyRef.id,
      partyName: party.name,
      linkedCollection: payload.linkedCollection || "",
      linkedId: payload.linkedId || "",
      linkedNumber: payload.linkedNumber || "",
      amount,
      date: payload.date || todayISO(),
      method: payload.method || "cash",
      referenceNo: (payload.referenceNo || "").trim(),
      notes: (payload.notes || "").trim(),
      createdBy: user?.uid || "",
      createdAt: serverTimestamp()
    });
  });

  await createNotification(businessId, {
    type: "payment",
    title: payload.direction === "in" ? "Payment Received" : "Payment Made",
    message: `${payNumber} recorded for ₹${amount.toFixed(2)}.`,
    link: "#/payments"
  });
  await logAudit(businessId, user, "RECORD_PAYMENT", "payments", paymentId, { payNumber, amount });
  return { id: paymentId, paymentNumber: payNumber };
}

/* ==================== EXPENSES ==================== */
export async function saveExpense(businessId, data, existingId = null, user = null) {
  const payload = {
    businessId,
    date: data.date || todayISO(),
    category: data.category || "Other",
    amount: round2(data.amount),
    paymentMethod: data.paymentMethod || "cash",
    description: (data.description || "").trim(),
    attachmentUrl: data.attachmentUrl || "",
    updatedAt: serverTimestamp()
  };
  if (existingId) {
    await updateDoc(doc(db, "expenses", existingId), payload);
    await logAudit(businessId, user, "UPDATE_EXPENSE", "expenses", existingId, { amount: payload.amount });
    return existingId;
  }
  const refDoc = await addDoc(collection(db, "expenses"), {
    ...payload,
    createdBy: user?.uid || "",
    createdAt: serverTimestamp()
  });
  await logAudit(businessId, user, "CREATE_EXPENSE", "expenses", refDoc.id, { amount: payload.amount });
  return refDoc.id;
}
