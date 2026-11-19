const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Server-side trigger: When a stock movement drops a product at or below minStock,
 * ensure a low-stock notification is created even if the client went offline mid-write.
 */
exports.onStockMovementCreated = onDocumentCreated("stockMovements/{movId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const prodSnap = await db.doc(`products/${data.productId}`).get();
  if (!prodSnap.exists) return;
  const prod = prodSnap.data();
  if ((data.stockAfter ?? 0) <= (prod.minStock ?? 0)) {
    await db.collection("notifications").add({
      businessId: data.businessId,
      type: "low_stock",
      title: data.stockAfter <= 0 ? "Out of Stock Alert" : "Low Stock Alert",
      message: `${prod.name} stock is ${data.stockAfter} (Min: ${prod.minStock || 0}).`,
      link: "#/inventory",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
});
