// capture.js
// Injected to capture screen zone coordinates

(function() {
  if (document.getElementById('studysnap-capture-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'studysnap-capture-overlay';
  document.body.appendChild(overlay);

  const selection = document.createElement('div');
  selection.id = 'studysnap-capture-selection';
  overlay.appendChild(selection);

  const instructions = document.createElement('div');
  instructions.id = 'studysnap-instructions';
  instructions.textContent = 'Draw area to capture. Fasten seatbelt.';
  overlay.appendChild(instructions);

  let isDrawing = false;
  let startX = 0, startY = 0;

  overlay.addEventListener('mousedown', (e) => {
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
    selection.style.left = (currentX < startX ? currentX : startX) + 'px';
    selection.style.top = (currentY < startY ? currentY : startY) + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    isDrawing = false;
    const rect = selection.getBoundingClientRect();
    
    // Ensure minimal dimensions
    if (rect.width > 20 && rect.height > 20) {
      chrome.runtime.sendMessage({
        type: 'SAVE_CAPTURE_ZONE',
        zone: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          devicePixelRatio: window.devicePixelRatio
        }
      });
      cleanup();
    } else {
      selection.style.display = 'none'; // reset
    }
  });

  function handleEsc(e) {
    if (e.key === 'Escape') cleanup();
  }
  document.addEventListener('keydown', handleEsc);

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', handleEsc);
  }
})();
