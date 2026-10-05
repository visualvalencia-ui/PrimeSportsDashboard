import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAgi9ftgGFYGG8UcaYQ_lw6haWY4p8NPLs",
  authDomain: "dashboard-semanal-99c26.firebaseapp.com",
  projectId: "dashboard-semanal-99c26",
  storageBucket: "dashboard-semanal-99c26.firebasestorage.app",
  messagingSenderId: "484144858932",
  appId: "1:484144858932:web:3a4576805c9da39e65c761"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
