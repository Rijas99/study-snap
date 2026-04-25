document.addEventListener('DOMContentLoaded', async () => {
  const authSection = document.getElementById('auth-section');
  const sessionSection = document.getElementById('session-section');
  const tokenInput = document.getElementById('notion-token');
  const btnLogin = document.getElementById('btn-login');
  
  const destRadios = document.querySelectorAll('input[name="destination"]');
  const notionSetup = document.getElementById('notion-setup');

  const pageDropdown = document.getElementById('page-dropdown');
  const btnStart = document.getElementById('btn-start');
  const btnEnd = document.getElementById('btn-end');
  const statusMsg = document.getElementById('session-status');

  // Load state
  const state = await chrome.storage.local.get(['notionToken', 'targetPageId', 'sessionActive', 'destination']);
  
  let currentDest = state.destination || 'notion';
  document.querySelector(`input[name="destination"][value="${currentDest}"]`).checked = true;

  function renderView() {
    if (currentDest === 'clipboard') {
      authSection.classList.add('hidden');
      sessionSection.classList.remove('hidden');
      notionSetup.classList.add('hidden');
      updateSessionUI(state.sessionActive);
    } else {
      notionSetup.classList.remove('hidden');
      if (state.notionToken) {
        showSessionSection(state.notionToken, state.targetPageId, state.sessionActive);
      } else {
        showAuthSection();
      }
    }
  }

  destRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      currentDest = e.target.value;
      await chrome.storage.local.set({ destination: currentDest });
      renderView();
    });
  });

  renderView();

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
        state.notionToken = token;
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
    state.targetPageId = targetPageId;
    await chrome.storage.local.set({ targetPageId });
  });

  btnStart.addEventListener('click', () => {
    if (currentDest === 'notion' && !state.targetPageId) {
      alert('Please select a target page first.');
      return;
    }
    
    // Check if valid URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || tab.url.startsWith('chrome://')) {
        alert("Please navigate to a valid website first to start the capture session.");
        return;
      }
      
      chrome.runtime.sendMessage({ type: 'START_SESSION' }, (res) => {
        if (res.success) {
          state.sessionActive = true;
          updateSessionUI(true);
          window.close(); // Close popup so user can draw area on the active tab seamlessly
        }
      });
    });
  });

  btnEnd.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'END_SESSION' }, (res) => {
      if (res.success) {
        state.sessionActive = false;
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
          state.targetPageId = res.pages[0].id;
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
      if (currentDest === 'notion') pageDropdown.disabled = true;
      destRadios.forEach(r => r.disabled = true);
    } else {
      btnStart.classList.remove('hidden');
      btnEnd.classList.add('hidden');
      statusMsg.innerHTML = '';
      if (currentDest === 'notion') pageDropdown.disabled = false;
      destRadios.forEach(r => r.disabled = false);
    }
  }
});
