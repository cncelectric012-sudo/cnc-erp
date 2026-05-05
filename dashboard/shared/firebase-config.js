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
  apiKey:            "AIzaSyBJXCAyEAww-XjWtC19Mdo2CNQ_uJQa0FA",
  authDomain:        "cnc-invoice-ledgers-approvals.firebaseapp.com",
  projectId:         "cnc-invoice-ledgers-approvals",
  storageBucket:     "cnc-invoice-ledgers-approvals.firebasestorage.app",
  messagingSenderId: "665671728862",
  appId:             "1:665671728862:web:27756abe17b6ce979b8c4f"
};
