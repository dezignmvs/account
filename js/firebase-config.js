/**
 * Firebase Web App Configuration (khatabooook)
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBoCmo33yTXLE21073CTwn7BltFJH4fWMI",
  authDomain: "khatabooook.firebaseapp.com",
  projectId: "khatabooook",
  storageBucket: "khatabooook.firebasestorage.app",
  messagingSenderId: "200353416433",
  appId: "1:200353416433:web:a28aa526766db72f509550",
  measurementId: "G-RRMZ6YNV84"
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("YOUR_")
  );
}
