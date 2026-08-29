// js/firebase-init.js
// Phase 1: Anonymous authentication only. No database reads/writes performed.
// Requires Firebase compat SDKs to be loaded in the HTML (see index.html).

(function () {
  if (!window.firebase || !window.FIREBASE_CONFIG) {
    console.warn("Firebase not available or FIREBASE_CONFIG missing. firebase-init skipped.");
    window.FirebaseAuth = {
      getUid: () => null,
      getUser: () => null,
      onAuthReady: (cb) => { /* noop */ },
      firebaseAuthReady: Promise.resolve(null)
    };
    return;
  }

  // Initialize app only once
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }

  const auth = firebase.auth();
  const db = firebase.database(); // reserved for later phases

  let resolveAuth;
  const authReady = new Promise((res) => { resolveAuth = res; });

  // Sign in anonymously if not signed in
  if (!auth.currentUser) {
    auth.signInAnonymously().catch(err => {
      console.error("Anonymous sign-in failed:", err);
      resolveAuth(null);
    });
  }

  auth.onAuthStateChanged(user => {
    // user may be null on failure
    window.FirebaseAuth = {
      getUid: () => (user ? user.uid : null),
      getUser: () => user,
      onAuthReady: (cb) => {
        if (user) cb(user);
        else auth.onAuthStateChanged(cb);
      },
      firebaseAuthReady: authReady
    };

    resolveAuth(user);
  });

  // expose internal handles for later phases (non-public API)
  window.__firebase_internal = { auth, db };

})();
