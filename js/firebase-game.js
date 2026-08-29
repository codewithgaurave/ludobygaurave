// js/firebase-game.js
// Low-level Firebase game networking primitives (Phase 5 hardened)
// Adds initGameStateIfMissing, stricter sendAction, and helpers

(function(){
  if (!window.firebase) {
    console.error('[FIREBASE-GAME] Firebase SDK not loaded');
    window.FirebaseGame = {
      getCurrentUid: () => null,
      isHost: async () => false,
      sendAction: async () => ({ success: false }),
      listenActionsAsHost: () => () => {},
      listenGameState: () => () => {},
      writeGameState: async () => ({ success: false }),
      writeEvent: async () => ({ success: false }),
      markActionProcessed: async () => ({ success: false }),
      checkActionProcessed: async () => false,
      getGameStateOnce: async () => null,
      getPlayersOnce: async () => ({}),
      initGameStateIfMissing: async () => ({ success: false }),
      cleanup: () => {}
    };
    return;
  }

  const db = firebase.database();

  function getCurrentUid() {
    if (window.FirebaseAuth && window.FirebaseAuth.getUid) return window.FirebaseAuth.getUid();
    return null;
  }

  async function isHost(roomCode) {
    const rc = String(roomCode || '').toUpperCase();
    if (!rc) return false;
    try {
      const snap = await db.ref(`rooms/${rc}/hostId`).once('value');
      const hostId = snap.val();
      const uid = getCurrentUid();
      return uid && hostId === uid;
    } catch (err) {
      console.error('[FIREBASE-GAME] isHost error', err);
      return false;
    }
  }

  // sendAction: push action to /rooms/{roomCode}/actions
  // Ensures action.uid equals auth.uid to prevent clients spoofing others
  async function sendAction(roomCode, action) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const uid = getCurrentUid();
      if (!rc) return { success: false, error: 'INVALID_ROOM' };
      if (!uid) return { success: false, error: 'AUTH_REQUIRED' };
      const safeAction = Object.assign({}, action, { uid });
      // Clients should not set processed flags or lastActionId
      const payload = Object.assign({}, safeAction, { timestamp: firebase.database.ServerValue.TIMESTAMP });
      const ref = await db.ref(`rooms/${rc}/actions`).push(payload);
      console.log('[FIREBASE-GAME] sendAction', rc, ref.key, payload.type, 'uid=', uid);
      return { success: true, actionId: ref.key };
    } catch (err) {
      console.error('[FIREBASE-GAME] sendAction error', err);
      return { success: false, error: err.message };
    }
  }

  // markActionProcessed: atomically set processedActions/{actionId} if not exists
  async function markActionProcessed(roomCode, actionId) {
    if (!actionId) return { success: false, error: 'INVALID_ACTION_ID' };
    try {
      const rc = String(roomCode || '').toUpperCase();
      const ref = db.ref(`rooms/${rc}/processedActions/${actionId}`);
      const uid = getCurrentUid() || 'unknown';
      const result = await ref.transaction(curr => {
        if (curr === null) {
          return { processedBy: uid, processedAt: firebase.database.ServerValue.TIMESTAMP };
        }
        return; // already exists
      }, undefined, false);

      if (result.committed) {
        console.log('[FIREBASE-GAME] markActionProcessed committed', actionId);
        return { success: true };
      } else {
        return { success: false, error: 'ALREADY_PROCESSED' };
      }
    } catch (err) {
      console.error('[FIREBASE-GAME] markActionProcessed error', err);
      return { success: false, error: err.message };
    }
  }

  // checkActionProcessed: quickly check whether processedActions/{actionId} exists
  async function checkActionProcessed(roomCode, actionId) {
    if (!actionId) return false;
    try {
      const rc = String(roomCode || '').toUpperCase();
      const snap = await db.ref(`rooms/${rc}/processedActions/${actionId}`).once('value');
      return !!snap.val();
    } catch (err) {
      console.error('[FIREBASE-GAME] checkActionProcessed error', err);
      return false;
    }
  }

  // listenActionsAsHost: host listens for new actions (onChildAdded)
  function listenActionsAsHost(roomCode, handler) {
    const rc = String(roomCode || '').toUpperCase();
    const ref = db.ref(`rooms/${rc}/actions`);
    const cb = ref.on('child_added', snap => {
      const val = snap.val();
      const key = snap.key;
      handler(Object.assign({ _actionKey: key }, val));
    });
    console.log('[FIREBASE-GAME] listenActionsAsHost', rc);
    return () => ref.off('child_added', cb);
  }

  // listenGameState: subscribe to /rooms/{roomCode}/gameState value changes
  function listenGameState(roomCode, handler) {
    const rc = String(roomCode || '').toUpperCase();
    const ref = db.ref(`rooms/${rc}/gameState`);
    const cb = ref.on('value', snap => {
      handler(snap.val());
    });
    console.log('[FIREBASE-GAME] listenGameState', rc);
    return () => ref.off('value', cb);
  }

  // getGameStateOnce
  async function getGameStateOnce(roomCode) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const snap = await db.ref(`rooms/${rc}/gameState`).once('value');
      return snap.val();
    } catch (err) {
      console.error('[FIREBASE-GAME] getGameStateOnce error', err);
      return null;
    }
  }

  // initGameStateIfMissing: create a minimal canonical gameState only if none exists
  async function initGameStateIfMissing(roomCode, initialState) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const ref = db.ref(`rooms/${rc}/gameState`);
      const result = await ref.transaction(curr => {
        if (curr === null) {
          const payload = Object.assign({}, initialState || {}, { updatedAt: firebase.database.ServerValue.TIMESTAMP });
          return payload;
        }
        return; // exists, abort
      }, undefined, false);
      if (result.committed) {
        console.log('[FIREBASE-GAME] initGameStateIfMissing: created state');
        return { success: true };
      } else {
        console.log('[FIREBASE-GAME] initGameStateIfMissing: gameState already exists');
        return { success: false, error: 'ALREADY_EXISTS' };
      }
    } catch (err) {
      console.error('[FIREBASE-GAME] initGameStateIfMissing error', err);
      return { success: false, error: err.message };
    }
  }

  // getPlayersOnce
  async function getPlayersOnce(roomCode) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const snap = await db.ref(`rooms/${rc}/players`).once('value');
      return snap.val() || {};
    } catch (err) {
      console.error('[FIREBASE-GAME] getPlayersOnce error', err);
      return {};
    }
  }

  // writeGameState: host writes canonical gameState (overwrite)
  async function writeGameState(roomCode, state) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const payload = Object.assign({}, state, { updatedAt: firebase.database.ServerValue.TIMESTAMP });
      await db.ref(`rooms/${rc}/gameState`).set(payload);
      console.log('[FIREBASE-GAME] writeGameState', rc);
      return { success: true };
    } catch (err) {
      console.error('[FIREBASE-GAME] writeGameState error', err);
      return { success: false, error: err.message };
    }
  }

  // writeEvent: push event to events log
  async function writeEvent(roomCode, ev) {
    try {
      const rc = String(roomCode || '').toUpperCase();
      const payload = Object.assign({}, ev, { timestamp: firebase.database.ServerValue.TIMESTAMP });
      const ref = await db.ref(`rooms/${rc}/events`).push(payload);
      console.log('[FIREBASE-GAME] writeEvent', rc, ev.type);
      return { success: true, eventId: ref.key };
    } catch (err) {
      console.error('[FIREBASE-GAME] writeEvent error', err);
      return { success: false, error: err.message };
    }
  }

  function cleanup() {
    console.log('[FIREBASE-GAME] cleanup');
  }

  window.FirebaseGame = {
    getCurrentUid,
    isHost,
    sendAction,
    listenActionsAsHost,
    listenGameState,
    writeGameState,
    writeEvent,
    markActionProcessed,
    checkActionProcessed,
    getGameStateOnce,
    getPlayersOnce,
    initGameStateIfMissing,
    cleanup
  };

})();
