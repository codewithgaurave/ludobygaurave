// js/firebase-renderer.js
// Reconciles DOM token positions to canonical gameState.pieces
// Phase 5: stronger idempotent rendering, removal of duplicates, correct reconstruction

(function(){
  function findParentForPosition(color, index) {
    if (index === 0) return document.querySelector(`.${color}Path0`);
    if (index === 57) {
      return document.querySelector(`.${color}Path57`) || document.querySelector('.tokenHome');
    }
    return document.querySelector(`.${color}Path${index}`);
  }

  function placeTokenAt(color, tokenId, index) {
    try {
      const token = document.getElementById(tokenId);
      if (!token) return false;
      const dest = findParentForPosition(color, index);
      if (!dest) return false;
      // If token is already in correct parent, nothing to do
      if (token.parentElement === dest) return true;
      // Remove duplicates: ensure token is removed from any other parent
      if (token.parentElement) token.parentElement.removeChild(token);
      dest.appendChild(token);
      return true;
    } catch (err) {
      console.error('[FIREBASE-RENDER] placeTokenAt error', err);
      return false;
    }
  }

  function renderPieces(pieces) {
    if (!pieces) return;
    const colors = ['red','green','yellow','blue'];
    colors.forEach(color => {
      const arr = pieces[color] || [];
      for (let i=0;i<4;i++){
        const pos = (typeof arr[i] !== 'undefined' && arr[i] !== null) ? arr[i] : 0;
        const tokenId = `${color}Token${i+1}`;
        placeTokenAt(color, tokenId, pos);
      }
    });
  }

  function reconstructFromState(state) {
    if (!state || !state.pieces) return;
    try {
      // Sanity: ensure tokens exist in DOM; if missing, log
      const colors = ['red','green','yellow','blue'];
      colors.forEach(color => {
        for (let i=1;i<=4;i++){
          const id = `${color}Token${i}`;
          if (!document.getElementById(id)) {
            console.warn('[FIREBASE-RENDER] token missing in DOM:', id);
          }
        }
      });

      // Place tokens idempotently
      renderPieces(state.pieces);

    } catch (err) {
      console.error('[FIREBASE-RENDER] reconstructFromState error', err);
    }
  }

  window.FirebaseRenderer = {
    renderPieces,
    placeTokenAt,
    reconstructFromState
  };
})();
