import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
  startAfter,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let googleProvider = null;

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
}

export {
  app,
  auth,
  db,
  googleProvider,
  isFirebaseConfigured,
  onAuthStateChanged,
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
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
  onSnapshot
};
