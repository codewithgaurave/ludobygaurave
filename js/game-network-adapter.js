// js/game-network-adapter.js
// Phase 5: Complete gameplay synchronization
// Enhancements from Phase4: initialize gameState atomically, respect lastActionId, event emission, and UI hooks

(function(){
  function whenReady(cb) {
    const wait = () => {
      if (window.FirebaseRoom && window.FirebaseGame && window.FirebaseAuth && document.readyState === 'complete') {
        cb();
      } else {
        setTimeout(wait, 200);
      }
    };
    wait();
  }

  whenReady(() => {
    const roomCode = (localStorage.getItem('roomCode') || '').toUpperCase();
    const playerUid = localStorage.getItem('playerUid') || window.FirebaseAuth.getUid();
    const playerColor = localStorage.getItem('playerColor') || null;
    const onlineMode = !!(roomCode && playerUid && playerColor);
    console.log('[FIREBASE-HOST] adapter init; onlineMode=', onlineMode, 'room=', roomCode);

    const orig_showDiceFromServer = window.showDiceFromServer;
    const orig_moveToken = window.moveToken;
    const orig_update = window.update;
    const orig_switchPlayer = window.switchPlayer;

    let isHost = false;
    let hostUnsubActions = null;
    let hostHostIdRef = null;
    let clientUnsubGameState = null;
    let lastProcessedActionTimestamp = 0;

    // helper: serialize pieces from DOM
    function serializePiecesFromDOM(){
      const colors=['red','green','yellow','blue'];
      const pieces = {};
      colors.forEach(color=>{
        pieces[color]=[];
        for(let i=1;i<=4;i++){
          const id = `${color}Token${i}`;
          const el = document.getElementById(id);
          if (!el || !el.parentElement) { pieces[color].push(0); continue; }
          const classes = Array.from(el.parentElement.classList || []);
          let pos = 0;
          for(const c of classes){
            const prefix = color + 'Path';
            if (c.startsWith(prefix)){
              const num = parseInt(c.substring(prefix.length));
              if (!isNaN(num)) { pos = num; break; }
            }
          }
          if (el.parentElement.classList.contains('tokenHome') || el.parentElement.classList.contains(color+'Home')) pos=57;
          pieces[color].push(pos);
        }
      });
      return pieces;
    }

    async function emitEvent(type, payload){
      try {
        await window.FirebaseGame.writeEvent(roomCode, Object.assign({ type }, payload || {}));
      } catch(e){ console.error('[FIREBASE-STATE] emitEvent error', e); }
    }

    async function initGameStateIfNeeded(){
      try {
        const existing = await window.FirebaseGame.getGameStateOnce(roomCode);
        if (existing) return existing;
        // create minimal initial state based on players and their colors, deterministic order using color order
        const players = await window.FirebaseGame.getPlayersOnce(roomCode);
        const colorOrder = ['red','green','yellow','blue'];
        const presentColors = [];
        Object.values(players).forEach(p=>{ if (p && p.color) presentColors.push(p.color); });
        // determine first turn color deterministically: choose first in colorOrder that is present
        let firstColor = null;
        for (const c of colorOrder) { if (presentColors.includes(c)) { firstColor = c; break; } }
        const firstUid = firstColor ? (Object.values(players).find(p => p.color === firstColor) || {}).uid : null;
        const initial = {
          started: true,
          turnNumber: 1,
          currentTurnUid: firstUid || null,
          currentTurnColor: firstColor || null,
          diceValue: null,
          diceRolling: false,
          extraTurn: false,
          winnerUid: null,
          winnerColor: null,
          pieces: { red:[0,0,0,0], green:[0,0,0,0], blue:[0,0,0,0], yellow:[0,0,0,0] },
          updatedAt: firebase.database.ServerValue.TIMESTAMP,
          lastActionId: null
        };
        const res = await window.FirebaseGame.initGameStateIfMissing(roomCode, initial);
        if (res.success) {
          console.log('[FIREBASE-STATE] initial gameState created');
          await emitEvent('GAME_STARTED', { room: roomCode, by: window.FirebaseAuth.getUid() });
        } else {
          console.log('[FIREBASE-STATE] gameState existed already');
        }
        return await window.FirebaseGame.getGameStateOnce(roomCode);
      } catch (err) {
        console.error('[FIREBASE-STATE] initGameStateIfNeeded error', err);
        return null;
      }
    }

    async function validateAction(action, gameState, players){
      if (!action || !action.type) return { valid:false, reason:'INVALID_ACTION' };
      if (!gameState) return { valid:false, reason:'NO_GAME' };
      const p = players && players[action.uid];
      if (!p) return { valid:false, reason:'PLAYER_NOT_IN_ROOM' };
      if (!p.online) return { valid:false, reason:'PLAYER_OFFLINE' };
      if (p.color !== action.color) return { valid:false, reason:'COLOR_MISMATCH' };
      if (['ROLL_DICE','MOVE_TOKEN'].includes(action.type)){
        if (gameState.currentTurnUid !== action.uid) return { valid:false, reason:'NOT_YOUR_TURN' };
      }
      return { valid:true };
    }

    async function processAction(action){
      if (!action || !action._actionKey) return;
      const actionId = action._actionKey;
      console.log('[FIREBASE-ACTION] processAction', actionId, action.type, action.uid);

      try {
        const mark = await window.FirebaseGame.markActionProcessed(roomCode, actionId);
        if (!mark.success) {
          console.log('[FIREBASE-ACTION] action already processed or mark failed', actionId, mark.error);
          return;
        }

        // Load fresh game state and players
        const [gameState, players] = await Promise.all([window.FirebaseGame.getGameStateOnce(roomCode), window.FirebaseGame.getPlayersOnce(roomCode)]);
        if (!gameState) {
          console.warn('[FIREBASE-ACTION] no gameState present, rejecting action', actionId);
          await emitEvent('ACTION_REJECTED', { actionId, reason: 'NO_GAME' });
          return;
        }

        // Ensure action is not stale relative to lastActionId or updatedAt
        if (gameState.lastActionId && gameState.lastActionId === actionId) {
          console.log('[FIREBASE-ACTION] action matches lastActionId, skipping duplicate', actionId);
          return;
        }

        const validation = await validateAction(action, gameState, players);
        if (!validation.valid) {
          console.warn('[FIREBASE-ACTION] invalid action', actionId, validation.reason);
          await emitEvent('ACTION_REJECTED', { actionId, reason: validation.reason });
          return;
        }

        if (action.type === 'ROLL_DICE') {
          // Generate dice authoritatively
          const dice = Math.floor(Math.random()*6)+1;
          console.log('[FIREBASE-HOST] roll dice', dice);
          try { orig_showDiceFromServer && orig_showDiceFromServer(dice); } catch(e){ console.error('[FIREBASE-HOST] showDice error', e); }
          // update gameState with diceValue but do not change turn yet
          const newState = Object.assign({}, gameState, { diceValue: dice, diceRolling: false, lastActionId: actionId });
          await window.FirebaseGame.writeGameState(roomCode, newState);
          await emitEvent('DICE_RESULT', { actionId, uid: action.uid, color: action.color, diceValue: dice });
        } else if (action.type === 'MOVE_TOKEN') {
          // Host must apply the move using existing ludo2.js logic
          const tokenId = action.pieceId || action.tokenId;
          const tokenEl = tokenId ? document.getElementById(tokenId) : null;
          if (!tokenEl) {
            console.warn('[FIREBASE-HOST] token element not found', tokenId);
            await emitEvent('ACTION_REJECTED', { actionId, reason: 'TOKEN_NOT_FOUND' });
            return;
          }

          try {
            // Execute movement on host
            orig_moveToken && orig_moveToken.apply(tokenEl, []);
            // let host game logic run update() to settle state
            orig_update && orig_update();

            // After move, serialize pieces and determine new turn info from ludo2.js state variables if available
            const pieces = serializePiecesFromDOM();
            // Attempt to read currentTurn from global if present
            const currentTurnColor = window.currentTurn || null; // ludo2.js uses currentTurn (color string)
            let currentTurnUid = null;
            if (currentTurnColor) {
              const playersObj = players || {};
              for (const uidKey in playersObj) {
                if (playersObj[uidKey] && playersObj[uidKey].color === currentTurnColor) { currentTurnUid = playersObj[uidKey].uid; break; }
              }
            }

            const newState = Object.assign({}, gameState, { pieces: pieces, currentTurnColor: currentTurnColor, currentTurnUid: currentTurnUid, lastActionId: actionId });
            await window.FirebaseGame.writeGameState(roomCode, newState);
            await emitEvent('MOVE_APPLIED', { actionId, uid: action.uid, color: action.color, pieceId: tokenId });

            // If move resulted in winner, detect via ludo2.js variables and write winner
            if (window.isWon && typeof window.isWon === 'function') {
              try {
                const winner = window.isWon();
                if (winner) {
                  // winner may be color string
                  const winnerColor = winner || null;
                  let winnerUid = null;
                  const playersObj = players || {};
                  for (const uidKey in playersObj) {
                    if (playersObj[uidKey] && playersObj[uidKey].color === winnerColor) { winnerUid = playersObj[uidKey].uid; break; }
                  }
                  if (winnerUid) {
                    const winState = Object.assign({}, newState, { winnerUid: winnerUid, winnerColor: winnerColor });
                    await window.FirebaseGame.writeGameState(roomCode, winState);
                    await emitEvent('WINNER', { winnerUid, winnerColor });
                  }
                }
              } catch (e) { console.warn('[FIREBASE-HOST] winner check error', e); }
            }

          } catch (err) {
            console.error('[FIREBASE-HOST] error applying move', err);
            await emitEvent('ACTION_ERROR', { actionId, reason: err.message });
          }

        } else {
          console.warn('[FIREBASE-ACTION] unknown action type', action.type);
        }

      } catch (err) {
        console.error('[FIREBASE-HOST] processAction error', err);
      }
    }

    async function initAsHost(){
      console.log('[FIREBASE-FAILOVER] initAsHost for', roomCode);
      // Ensure gameState exists or initialize atomically
      const state = await initGameStateIfNeeded();
      if (state) {
        // reconstruct board from canonical state
        try { window.FirebaseRenderer.reconstructFromState(state); } catch (e) { console.error('[FIREBASE-RENDER] reconstruct error', e); }
      }

      if (hostUnsubActions) hostUnsubActions();
      hostUnsubActions = window.FirebaseGame.listenActionsAsHost(roomCode, async (action) => {
        try { await processAction(action); } catch (e) { console.error('[FIREBASE-HOST] action handler err', e); }
      });

      await emitEvent('HOST_CHANGED', { newHost: window.FirebaseAuth.getUid() });
      console.log('[FIREBASE-HOST] host action listener started');
    }

    function watchHostChange(){
      const rc = roomCode;
      hostHostIdRef = firebase.database().ref(`rooms/${rc}/hostId`);
      hostHostIdRef.on('value', async snap => {
        const newHost = snap.val();
        const uid = window.FirebaseAuth.getUid();
        console.log('[FIREBASE-FAILOVER] hostId changed to', newHost, 'my uid=', uid);
        if (newHost === uid) {
          isHost = true;
          await initAsHost();
        } else {
          if (isHost) {
            if (hostUnsubActions) { hostUnsubActions(); hostUnsubActions = null; }
          }
          isHost = false;
        }
        // update UI via event
        emitEvent('HOST_CHANGED', { newHost });
      });
    }

    function startClientListeners(){
      if (clientUnsubGameState) clientUnsubGameState();
      clientUnsubGameState = window.FirebaseGame.listenGameState(roomCode, (state) => {
        if (!state) return;
        console.log('[FIREBASE-STATE] client received gameState update');
        try {
          if (typeof state.diceValue !== 'undefined' && state.diceValue !== null) orig_showDiceFromServer && orig_showDiceFromServer(state.diceValue);
          if (state.pieces) window.FirebaseRenderer.reconstructFromState(state);
          // update UI panel via event
          emitEvent('STATE_APPLIED', { });
        } catch (err) {
          console.error('[FIREBASE-RENDER] apply gameState error', err);
        }
      });
    }

    async function init(){
      if (!onlineMode) { console.log('[FIREBASE-HOST] offline mode; adapter inactive'); return; }
      watchHostChange();
      isHost = await window.FirebaseGame.isHost(roomCode);
      if (isHost) await initAsHost();
      startClientListeners();
      // presence
      try {
        const uid = window.FirebaseAuth.getUid();
        if (uid) {
          const playerOnlineRef = firebase.database().ref(`rooms/${roomCode}/players/${uid}/online`);
          await playerOnlineRef.set(true);
          playerOnlineRef.onDisconnect().set(false);
        }
      } catch (err) { console.error('[FIREBASE-GAME] presence error', err); }
      console.log('[FIREBASE-HOST] adapter init complete');
    }

    init();

    window.addEventListener('beforeunload', () => {
      if (hostUnsubActions) hostUnsubActions();
      if (hostHostIdRef) hostHostIdRef.off();
      if (clientUnsubGameState) clientUnsubGameState();
    });

  });
})();
