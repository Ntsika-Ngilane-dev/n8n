import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Object.values(config).every(
  (value) => typeof value === "string" && value.trim(),
);

const firebaseApp = hasFirebaseConfig
  ? getApps().length ? getApp() : initializeApp(config)
  : null;

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
