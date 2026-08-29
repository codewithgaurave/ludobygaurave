// js/firebase-room.js
// Firebase room/lobby module for Phase 2
// Depends on firebase compat SDK (already loaded) and js/firebase-init.js exposing window.FirebaseAuth

(function () {
  if (!window.firebase) {
    console.error('Firebase SDK not loaded. js/firebase-room.js requires Firebase.');
    window.FirebaseRoom = {
      createRoom: async () => ({ success: false, error: 'AUTH_REQUIRED' }),
      joinRoom: async () => ({ success: false, error: 'AUTH_REQUIRED' }),
      leaveRoom: async () => ({}),
      getRoom: async () => null,
      getPlayers: async () => [],
      getRoomCode: () => null,
      getCurrentPlayer: () => null,
      isHost: async () => false,
      onRoomChanged: () => { return () => {}; },
      onPlayersChanged: () => { return () => {}; }
    };
    return;
  }

  const db = firebase.database();
  const ServerValue = firebase.database.ServerValue;
  const COLORS = ['red', 'green', 'yellow', 'blue'];

  // helpers
  function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
  }
  function validRoomCode(code) {
    return /^[A-Z0-9_-]{3,20}$/.test(code);
  }
  function validName(name) {
    return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 50;
  }

  // internal listeners map to avoid duplicates
  const listeners = { room: {}, players: {} };

  async function ensureAuth() {
    if (!window.FirebaseAuth || !window.FirebaseAuth.firebaseAuthReady) {
      return Promise.reject(new Error('AUTH_REQUIRED'));
    }
    const user = await window.FirebaseAuth.firebaseAuthReady;
    if (!user) throw new Error('AUTH_REQUIRED');
    return user;
  }

  // get assigned colors from players map
  function pickColorFromPlayers(players) {
    const used = new Set();
    if (players) {
      Object.values(players).forEach(p => {
        if (p && p.color) used.add(p.color);
      });
    }
    for (const c of COLORS) {
      if (!used.has(c)) return c;
    }
    return null; // no color available
  }

  // createRoom implementation
  async function createRoom(roomCodeRaw, playerName) {
    try {
      const user = await ensureAuth();
      const uid = user.uid;
      const roomCode = normalizeCode(roomCodeRaw || Math.random().toString(36).substr(2,6).toUpperCase());
      const name = (playerName || '').trim();

      if (!validRoomCode(roomCode)) return { success: false, error: 'INVALID_ROOM_CODE' };
      if (!validName(name)) return { success: false, error: 'INVALID_NAME' };

      const roomRef = db.ref(`rooms/${roomCode}`);

      // Use transaction to ensure we don't overwrite existing room
      const result = await roomRef.transaction(curr => {
        if (curr === null) {
          const color = COLORS[0];
          const players = {};
          players[uid] = { uid, name, color, online: true, joinedAt: ServerValue.TIMESTAMP };
          return {
            hostId: uid,
            status: 'waiting',
            createdAt: ServerValue.TIMESTAMP,
            maxPlayers: 4,
            players: players
          };
        }
        // room exists -> abort
        return; // Abort transaction
      }, {applyLocally: false});

      if (!result.committed) {
        return { success: false, error: 'ROOM_EXISTS' };
      }

      // After creation, set onDisconnect handler for presence
      const playerRef = db.ref(`rooms/${roomCode}/players/${uid}/online`);
      playerRef.onDisconnect().set(false);

      return { success: true, roomCode, uid, color: COLORS[0], isHost: true };

    } catch (err) {
      console.error('createRoom error', err);
      if (err.message === 'AUTH_REQUIRED') return { success: false, error: 'AUTH_REQUIRED' };
      return { success: false, error: 'UNKNOWN_ERROR', details: err.message };
    }
  }

  // joinRoom implementation
  async function joinRoom(roomCodeRaw, playerName) {
    try {
      const user = await ensureAuth();
      const uid = user.uid;
      const roomCode = normalizeCode(roomCodeRaw);
      const name = (playerName || '').trim();

      if (!validRoomCode(roomCode)) return { success: false, error: 'INVALID_ROOM_CODE' };
      if (!validName(name)) return { success: false, error: 'INVALID_NAME' };

      const roomRef = db.ref(`rooms/${roomCode}`);
      const snap = await roomRef.once('value');
      const room = snap.val();
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

      const maxPlayers = room.maxPlayers || 4;
      const players = room.players || {};
      const currentCount = Object.keys(players).length;

      if (players[uid]) {
        // already in room; update name/online
        const playerRef = db.ref(`rooms/${roomCode}/players/${uid}`);
        await playerRef.update({ name, online: true, joinedAt: ServerValue.TIMESTAMP });
        // ensure onDisconnect
        db.ref(`rooms/${roomCode}/players/${uid}/online`).onDisconnect().set(false);
        return { success: true, roomCode, uid, color: players[uid].color || pickColorFromPlayers(players), isHost: room.hostId === uid };
      }

      if (currentCount >= maxPlayers) return { success: false, error: 'ROOM_FULL' };

      // choose color
      const color = pickColorFromPlayers(players);
      if (!color) return { success: false, error: 'ROOM_FULL' };

      const updates = {};
      updates[`rooms/${roomCode}/players/${uid}`] = { uid, name, color, online: true, joinedAt: ServerValue.TIMESTAMP };
      await db.ref().update(updates);

      // set onDisconnect
      db.ref(`rooms/${roomCode}/players/${uid}/online`).onDisconnect().set(false);

      return { success: true, roomCode, uid, color, isHost: room.hostId === uid };

    } catch (err) {
      console.error('joinRoom error', err);
      if (err.message === 'AUTH_REQUIRED') return { success: false, error: 'AUTH_REQUIRED' };
      return { success: false, error: 'UNKNOWN_ERROR', details: err.message };
    }
  }

  // leaveRoom implementation
  async function leaveRoom(roomCodeRaw) {
    try {
      const user = await ensureAuth();
      const uid = user.uid;
      const roomCode = normalizeCode(roomCodeRaw);
      if (!validRoomCode(roomCode)) return { success: false, error: 'INVALID_ROOM_CODE' };

      const roomRef = db.ref(`rooms/${roomCode}`);
      const snap = await roomRef.once('value');
      const room = snap.val();
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

      const players = room.players || {};
      if (!players[uid]) return { success: false, error: 'NOT_IN_ROOM' };

      // set online false
      await db.ref(`rooms/${roomCode}/players/${uid}/online`).set(false);

      // If host leaving, assign new host if players remain
      if (room.hostId === uid) {
        // find earliest joined online/remaining player
        const remaining = Object.values(players).filter(p => p && p.uid !== uid);
        if (remaining.length === 0) {
          // delete room
          await roomRef.remove();
          return { success: true, roomDeleted: true };
        } else {
          // pick earliest joinedAt among remaining players who are online true if possible
          remaining.sort((a,b) => (a.joinedAt||0) - (b.joinedAt||0));
          const newHost = remaining[0];
          await roomRef.child('hostId').set(newHost.uid);
          return { success: true, newHost: newHost.uid };
        }
      }

      return { success: true };
    } catch (err) {
      console.error('leaveRoom error', err);
      if (err.message === 'AUTH_REQUIRED') return { success: false, error: 'AUTH_REQUIRED' };
      return { success: false, error: 'UNKNOWN_ERROR', details: err.message };
    }
  }

  // getRoom
  async function getRoom(roomCodeRaw) {
    try {
      const roomCode = normalizeCode(roomCodeRaw);
      if (!validRoomCode(roomCode)) return null;
      const snap = await db.ref(`rooms/${roomCode}`).once('value');
      return snap.val();
    } catch (err) {
      console.error('getRoom error', err);
      return null;
    }
  }

  // getPlayers
  async function getPlayers(roomCodeRaw) {
    const roomCode = normalizeCode(roomCodeRaw);
    if (!validRoomCode(roomCode)) return [];
    const snap = await db.ref(`rooms/${roomCode}/players`).once('value');
    const playersObj = snap.val() || {};
    const arr = Object.values(playersObj);
    arr.sort((a,b) => (a.joinedAt||0) - (b.joinedAt||0));
    return arr;
  }

  function getRoomCode() {
    return null; // placeholder if needed
  }

  function getCurrentPlayer() {
    if (!window.FirebaseAuth) return null;
    return window.FirebaseAuth.getUser ? window.FirebaseAuth.getUser() : null;
  }

  async function isHost(roomCodeRaw) {
    const user = await ensureAuth();
    const uid = user.uid;
    const room = await getRoom(roomCodeRaw);
    if (!room) return false;
    return room.hostId === uid;
  }

  // listeners
  function onRoomChanged(roomCodeRaw, callback) {
    const roomCode = normalizeCode(roomCodeRaw);
    if (!validRoomCode(roomCode)) { console.warn('onRoomChanged invalid roomCode', roomCodeRaw); return () => {}; }
    const ref = db.ref(`rooms/${roomCode}`);
    const cb = snap => { callback(snap.val()); };
    ref.on('value', cb);
    listeners.room[roomCode] = listeners.room[roomCode] || [];
    listeners.room[roomCode].push({ ref, cb });
    return () => { ref.off('value', cb); };
  }

  function onPlayersChanged(roomCodeRaw, callback) {
    const roomCode = normalizeCode(roomCodeRaw);
    if (!validRoomCode(roomCode)) { console.warn('onPlayersChanged invalid roomCode', roomCodeRaw); return () => {}; }
    const ref = db.ref(`rooms/${roomCode}/players`);
    const cb = snap => {
      const playersObj = snap.val() || {};
      const arr = Object.values(playersObj);
      arr.sort((a,b) => (a.joinedAt||0) - (b.joinedAt||0));
      callback(arr);
    };
    ref.on('value', cb);
    listeners.players[roomCode] = listeners.players[roomCode] || [];
    listeners.players[roomCode].push({ ref, cb });
    return () => { ref.off('value', cb); };
  }

  // public API
  window.FirebaseRoom = {
    createRoom,
    joinRoom,
    leaveRoom,
    getRoom,
    getPlayers,
    getRoomCode,
    getCurrentPlayer,
    isHost,
    onRoomChanged,
    onPlayersChanged
  };

})();
