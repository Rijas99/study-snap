// content.js
// Handles YouTube extraction and quick caption UI

if (typeof window.studySnapInjected === 'undefined') {
  window.studySnapInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'REQUEST_SCREENSHOT_INFO') {
      handleScreenshotInfo(msg.isNotion).then(sendResponse);
      return true; // async
    } else if (msg.type === 'SHOW_TOAST') {
      showToast(msg.message);
    }
  });

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function handleScreenshotInfo(isNotion) {
    const video = document.querySelector('video');
    const titleEl = document.querySelector('h1.ytd-watch-metadata');
    
    const title = titleEl ? titleEl.innerText : (document.title || 'Unknown Page');
    const timestamp = video ? formatTime(video.currentTime) : '';
    
    let videoId = window.location.href; // Use URL as the unique identifier for non-YouTube sites
    if (window.location.href.includes('youtube.com/watch')) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('v')) {
        videoId = urlParams.get('v');
      }
    }

    // Launch quick caption popup and waiting for user input only if Notion
    const caption = isNotion ? await showCaptionPopup() : '';
    
    return { title, timestamp, videoId, caption };
  }

  function showCaptionPopup() {
    return new Promise(resolve => {
      let existing = document.getElementById('studysnap-caption-popup');
      if (existing) existing.remove();

      const popup = document.createElement('div');
      popup.id = 'studysnap-caption-popup';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add an optional caption... (Press Enter)';
      input.autocomplete = 'off';
      
      popup.appendChild(input);
      document.body.appendChild(popup);
      
      // Focus instantly
      setTimeout(() => input.focus(), 50);

      let resolved = false;
      
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        popup.style.opacity = '0';
        popup.style.transform = 'translate(-50%, 20px) scale(0.95)';
        setTimeout(() => popup.remove(), 300);
        resolve(value);
      };

      // Auto-dismiss after 3s if no typing
      let timeoutId = setTimeout(() => {
        // If user has typed something, give them more time, else dismiss
        if (input.value.trim() === '') {
          finish('');
        } else {
           finish(input.value.trim());
        }
      }, 4000); // 4 seconds total to be safe

      input.addEventListener('keydown', (e) => {
        // Reset timeout on keydown so they can finish typing
        clearTimeout(timeoutId);
        if (e.key === 'Enter') {
          finish(input.value.trim());
        } else if (e.key === 'Escape') {
          finish('');
        } else {
          // Extend timeout while actively typing
          timeoutId = setTimeout(() => finish(input.value.trim()), 3000);
        }
      });
    });
  }

  function showToast(message) {
    let existing = document.getElementById('studysnap-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'studysnap-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // trigger layout for animation
    void toast.offsetWidth;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}
