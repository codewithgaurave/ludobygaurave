// index.js — lobby handlers for the new clean UI
(function(){
  // ensure hidden fallbacks used elsewhere still exist
  function ensureHiddenFallbacks(){
    if(!document.getElementById('name')){
      const hid = document.createElement('input'); hid.type='hidden'; hid.id='name'; document.body.appendChild(hid);
    }
    if(!document.getElementById('room')){
      const hid2 = document.createElement('input'); hid2.type='hidden'; hid2.id='room'; document.body.appendChild(hid2);
    }
  }
  ensureHiddenFallbacks();

  const playerNameInput = document.getElementById('playerName');
  const roomCodeInput = document.getElementById('roomCode');
  const createBtn = document.getElementById('createRoom');
  const joinBtn = document.getElementById('joinRoom');
  const playerInfo = document.getElementById('playerInfo');
  const playerInfoName = document.getElementById('playerInfoName');
  const changeNameBtn = document.getElementById('changeNameBtn');
  const statusEl = document.getElementById('status');

  function showStatus(msg){
    if (statusEl) statusEl.innerText = msg;
    console.log('[Lobby]', msg);
  }

  // Prefill from localStorage
  const savedName = localStorage.getItem('playerName');
  if (playerNameInput && savedName) playerNameInput.value = savedName;
  if (playerInfo && savedName) { playerInfo.style.display='block'; if (playerInfoName) playerInfoName.textContent = savedName; }

  const savedRoom = localStorage.getItem('roomCode');
  if (roomCodeInput && savedRoom) roomCodeInput.value = savedRoom;

  // keep fallback #name/#room updated when saving
  function syncHiddenFallbacks(){
    const nameVal = playerNameInput ? playerNameInput.value.trim() : '';
    const roomVal = roomCodeInput ? roomCodeInput.value.trim() : '';
    const fallbackName = document.getElementById('name');
    const fallbackRoom = document.getElementById('room');
    if (fallbackName && nameVal) fallbackName.value = nameVal;
    if (fallbackRoom && roomVal) fallbackRoom.value = roomVal;
    if (nameVal) localStorage.setItem('playerName', nameVal);
    if (roomVal) localStorage.setItem('roomCode', roomVal);
  }

  // Create room
  if (createBtn) {
    createBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const name = playerNameInput && playerNameInput.value ? playerNameInput.value.trim() : '';
      const roomCode = roomCodeInput && roomCodeInput.value ? roomCodeInput.value.trim() : '';
      if (!name) { showStatus('Enter your name'); return; }
      showStatus('Creating room...');
      if (!window.FirebaseRoom) { showStatus('FirebaseRoom not loaded'); return; }
      const rc = roomCode || (Math.random().toString(36).substr(2,6)).toUpperCase();
      const res = await window.FirebaseRoom.createRoom(rc, name);
      if (res.success) {
        localStorage.setItem('playerName', name);
        localStorage.setItem('roomCode', res.roomCode);
        localStorage.setItem('playerUid', res.uid);
        localStorage.setItem('playerColor', res.color);
        showStatus(`Room created: ${res.roomCode}. You are host.`);
        syncHiddenFallbacks();
        if (window.FirebaseRoom && typeof window.FirebaseRoom.onPlayersChanged === 'function') {
          window.FirebaseRoom.onPlayersChanged(res.roomCode, (players) => {
            showStatus(`Players: ${players.length}/4`);
          });
        }
        window.location.href = 'ludo.html';
      } else {
        showStatus('Create failed: ' + (res.error || 'Unknown'));
      }
    });
  }

  // Join room
  if (joinBtn) {
    joinBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const name = playerNameInput && playerNameInput.value ? playerNameInput.value.trim() : '';
      const roomCode = roomCodeInput && roomCodeInput.value ? roomCodeInput.value.trim() : '';
      if (!name) { showStatus('Enter your name'); return; }
      if (!roomCode) { showStatus('Enter room code to join'); return; }
      showStatus('Joining room...');
      if (!window.FirebaseRoom) { showStatus('FirebaseRoom not loaded'); return; }
      const res = await window.FirebaseRoom.joinRoom(roomCode, name);
      if (res.success) {
        localStorage.setItem('playerName', name);
        localStorage.setItem('roomCode', res.roomCode);
        localStorage.setItem('playerUid', res.uid);
        localStorage.setItem('playerColor', res.color);
        showStatus(`Joined room: ${res.roomCode}. Color: ${res.color}`);
        syncHiddenFallbacks();
        if (window.FirebaseRoom && typeof window.FirebaseRoom.onPlayersChanged === 'function') {
          window.FirebaseRoom.onPlayersChanged(res.roomCode, (players) => {
            showStatus(`Players: ${players.length}/4`);
          });
        }
        window.location.href = 'ludo.html';
      } else {
        if (res.error === 'ROOM_NOT_FOUND') showStatus('Room not found');
        else if (res.error === 'ROOM_FULL') showStatus('Room full');
        else showStatus('Join failed: ' + (res.error || 'Unknown'));
      }
    });
  }

  // Change name button (shows onboarding modal)
  if (changeNameBtn) {
    changeNameBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const cur = localStorage.getItem('playerName') || '';
      const onboardInput = document.getElementById('onboardName');
      if (onboardInput) onboardInput.value = cur;
      const err = document.getElementById('onboardError');
      if (err) err.style.display='none';
      const modal = document.getElementById('onboardingModal');
      if (modal) modal.style.display = 'flex';
    });
  }

})();
