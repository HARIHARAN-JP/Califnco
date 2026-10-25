
import { initializeApp, getApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBkB7rqGtNdJ3PGlIaFOzkHH8Xci5uIMjI",
  authDomain: "califncomobile.firebaseapp.com",
  projectId: "califncomobile",
  storageBucket: "califncomobile.firebasestorage.app",
  messagingSenderId: "803381712098",
  appId: "1:803381712098:web:a382699d19ad155614fabb",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = getFirestore(app);
