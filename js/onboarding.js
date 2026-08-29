// js/onboarding.js
// Phase 6: Player Name Onboarding (fixed initialization + logs)

(function(){
  function $(id){ return document.getElementById(id); }

  function log(msg, ...args){
    try { console.log('[ONBOARDING]', msg, ...args); } catch(e) {}
  }

  function sanitizeName(raw){
    if (!raw) return '';
    let s = String(raw).trim();
    // remove angle brackets to prevent tag injection
    s = s.replace(/[<>]/g, '');
    // clamp length
    if (s.length > 20) s = s.substring(0,20);
    return s;
  }

  function showOnboard(){
    const modal = $('onboardingModal');
    if (!modal) { log('onboard modal not found'); return; }
    modal.style.display = 'flex';
    const input = $('onboardName');
    if (input) input.focus();
    log('showing name modal');
  }

  function hideOnboard(){
    const modal = $('onboardingModal');
    if (!modal) return;
    modal.style.display = 'none';
  }

  function updatePlayerInfoUI(){
    const name = localStorage.getItem('playerName');
    if (name && name.trim().length>0){
      const info = $('playerInfo');
      if (info) info.style.display = 'block';
      const nameSpan = $('playerInfoName');
      if (nameSpan) nameSpan.textContent = name;
      const pn = $('playerName'); if (pn) pn.value = name;
      // hidden fallback
      const nameFallback = document.getElementById('name'); if(nameFallback) nameFallback.value = name;
    } else {
      const info = $('playerInfo'); if (info) info.style.display = 'none';
    }
  }

  async function saveNameFlow(name){
    const clean = sanitizeName(name);
    const errEl = $('onboardError');
    if (!clean || clean.length < 2){ if(errEl){ errEl.textContent = 'Name must be at least 2 characters'; errEl.style.display='block'; } return false; }
    if (clean.length > 20){ if(errEl){ errEl.textContent = 'Name must be 20 characters or fewer'; errEl.style.display='block'; } return false; }
    if (errEl) { errEl.style.display='none'; }

    // save locally
    localStorage.setItem('playerName', clean);
    log('name saved locally', clean);

    // update visible inputs / fallback
    const pn = $('playerName'); if (pn) pn.value = clean;
    const nameFallback = document.getElementById('name'); if(nameFallback) nameFallback.value = clean;

    // If user is in a room, attempt to update the player's name safely (upsert behavior)
    const roomCode = localStorage.getItem('roomCode');
    const playerUid = localStorage.getItem('playerUid');
    if (roomCode && window.FirebaseRoom && playerUid) {
      try {
        await window.FirebaseRoom.joinRoom(roomCode, clean);
        log('updated name in Firebase room (upsert)', roomCode);
      } catch (e) {
        console.warn('[ONBOARDING] failed to update name in Firebase room', e);
      }
    }

    updatePlayerInfoUI();
    hideOnboard();
    log('name saved', clean);
    return true;
  }

  function initOnboarding(){
    log('initialized');
    // ensure fallback hidden inputs exist
    if(!document.getElementById('name')){
      const hid = document.createElement('input'); hid.type='hidden'; hid.id='name'; document.body.appendChild(hid);
    }
    if(!document.getElementById('room')){
      const hid2 = document.createElement('input'); hid2.type='hidden'; hid2.id='room'; document.body.appendChild(hid2);
    }

    updatePlayerInfoUI();

    const existing = localStorage.getItem('playerName');
    if (existing && existing.trim().length>0) {
      log('player name found', existing);
      // do not show onboarding
    } else {
      log('player name NOT found; showing onboarding');
      showOnboard();
    }

    // Save button
    const saveBtn = $('onboardSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const name = $('onboardName') ? $('onboardName').value : '';
        await saveNameFlow(name);
      });
    }

    // Enter key support
    const input = $('onboardName');
    if (input) {
      input.addEventListener('keyup', async (e) => {
        if (e.key === 'Enter') {
          const name = input.value;
          await saveNameFlow(name);
        }
      });
    }

    // Change name button
    const changeBtn = $('changeNameBtn');
    if (changeBtn){
      changeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const cur = localStorage.getItem('playerName') || '';
        const modalInput = $('onboardName');
        if (modalInput) modalInput.value = cur;
        const err = $('onboardError'); if (err) err.style.display='none';
        showOnboard();
      });
    }
  }

  // Run init when DOM is ready; also handle case where DOMContentLoaded already fired.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      try { initOnboarding(); } catch (e) { console.error('[ONBOARDING] init error', e); }
    });
  } else {
    try { initOnboarding(); } catch (e) { console.error('[ONBOARDING] init error', e); }
  }

})();
