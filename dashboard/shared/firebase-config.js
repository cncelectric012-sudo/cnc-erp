/* ═══════════════════════════════════════════════════════════════
   Firebase Configuration

   ⚠️  IMPORTANT: These values are PUBLIC by design.
       The apiKey, authDomain, projectId, etc. are NOT secrets.
       They are visible in any web app that uses Firebase.

   Real security comes from:
   1. Firebase Auth (login required)
   2. Firestore Security Rules (server-side enforcement)
   3. Authorized Domains (Firebase Console > Authentication > Settings)

   Real secrets like Claude API key, WhatsApp tokens, Service Account
   credentials must NEVER be in this file or anywhere in the dashboard
   folder. They live only in C:\CNC-Bot\.env on the server.
   ═══════════════════════════════════════════════════════════════ */

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDDhsXtfdOpUhsRXqayDHrQZFLPscZqCIw",
  authDomain:        "cnc-electric-erp.firebaseapp.com",
  projectId:         "cnc-electric-erp",
  storageBucket:     "cnc-electric-erp.firebasestorage.app",
  messagingSenderId: "841412784519",
  appId:             "1:841412784519:web:bfce21bf168ced166fa322"
};
