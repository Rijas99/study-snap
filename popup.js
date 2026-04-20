document.addEventListener('DOMContentLoaded', async () => {
  const authSection = document.getElementById('auth-section');
  const sessionSection = document.getElementById('session-section');
  const tokenInput = document.getElementById('notion-token');
  const btnLogin = document.getElementById('btn-login');
  
  const pageDropdown = document.getElementById('page-dropdown');
  const btnStart = document.getElementById('btn-start');
  const btnEnd = document.getElementById('btn-end');
  const statusMsg = document.getElementById('session-status');

  // Load state
  const state = await chrome.storage.local.get(['notionToken', 'targetPageId', 'sessionActive']);
  
  if (state.notionToken) {
    showSessionSection(state.notionToken, state.targetPageId, state.sessionActive);
  } else {
    showAuthSection();
  }

  btnLogin.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      alert("Please enter a valid API Key.");
      return;
    }
    btnLogin.textContent = "Connecting...";
    try {
      // Validate by fetching pages
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'FETCH_NOTION_PAGES', token }, resolve);
      });
      if (res.success) {
        await chrome.storage.local.set({ notionToken: token });
        showSessionSection(token, null, false);
      } else {
        alert("Failed to connect: " + res.error);
        btnLogin.textContent = "Connect";
      }
    } catch (e) {
      alert("Error: " + e.message);
      btnLogin.textContent = "Connect";
    }
  });

  pageDropdown.addEventListener('change', async (e) => {
    const targetPageId = e.target.value;
    await chrome.storage.local.set({ targetPageId });
  });

  btnStart.addEventListener('click', () => {
    const targetPageId = pageDropdown.value;
    if (!targetPageId) {
      alert('Please select a target page first.');
      return;
    }
    
    // Check if on youtube
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || (!tab.url.includes('youtube.com/watch') && !tab.url.includes('youtu.be/'))) {
        alert("Please navigate to a YouTube video first to start the capture session.");
        return;
      }
      
      chrome.runtime.sendMessage({ type: 'START_SESSION' }, (res) => {
        if (res.success) {
          updateSessionUI(true);
          window.close(); // Close popup so user can draw area on the active tab seamlessly
        }
      });
    });
  });

  btnEnd.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'END_SESSION' }, (res) => {
      if (res.success) {
        updateSessionUI(false);
      }
    });
  });

  function showAuthSection() {
    authSection.classList.remove('hidden');
    sessionSection.classList.add('hidden');
  }

  async function showSessionSection(token, savedPageId, isSessionActive) {
    authSection.classList.add('hidden');
    sessionSection.classList.remove('hidden');
    updateSessionUI(isSessionActive);

    // Fetch pages
    chrome.runtime.sendMessage({ type: 'FETCH_NOTION_PAGES', token }, (res) => {
      pageDropdown.innerHTML = ''; 
      if (res.success && res.pages.length > 0) {
        res.pages.forEach(page => {
          const opt = document.createElement('option');
          opt.value = page.id;
          opt.textContent = page.title;
          if (page.id === savedPageId) {
            opt.selected = true;
          }
          pageDropdown.appendChild(opt);
        });
        if (!savedPageId && res.pages.length > 0) {
          chrome.storage.local.set({ targetPageId: res.pages[0].id });
        }
      } else {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = res.error ? "Error loading pages" : "No pages found. Make sure connection is added to specific Notion pages!";
        pageDropdown.appendChild(opt);
      }
    });
  }

  function updateSessionUI(isActive) {
    if (isActive) {
      btnStart.classList.add('hidden');
      btnEnd.classList.remove('hidden');
      statusMsg.innerHTML = `🟢 Session Active! Press <b>Alt+S</b> to capture.`;
      pageDropdown.disabled = true;
    } else {
      btnStart.classList.remove('hidden');
      btnEnd.classList.add('hidden');
      statusMsg.innerHTML = '';
      pageDropdown.disabled = false;
    }
  }
});
