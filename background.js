import { getPages, appendScreenshot } from './notion.js';

let sessionActive = false;
let sessionScreenshots = 0;
let lastVideoId = null;

// Initialize state
chrome.storage.local.get(['sessionActive', 'sessionScreenshots', 'lastVideoId'], (res) => {
  sessionActive = res.sessionActive || false;
  sessionScreenshots = res.sessionScreenshots || 0;
  lastVideoId = res.lastVideoId || null;
  updateBadge();
});

// Extension Icon Badge logic
function updateBadge() {
  if (sessionActive) {
    chrome.action.setBadgeText({ text: sessionScreenshots > 0 ? sessionScreenshots.toString() : '0' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // vibrant green
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Global Message Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SESSION') {
    sessionActive = true;
    sessionScreenshots = 0;
    lastVideoId = null; // reset for new session
    chrome.storage.local.set({ sessionActive, sessionScreenshots, lastVideoId });
    updateBadge();
    
    // Inject capture.js into the active tab to draw area
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && !tabs[0].url.startsWith('chrome://')) {
        chrome.scripting.insertCSS({ target: { tabId: tabs[0].id }, files: ['styles/capture.css'] });
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['capture.js'] });
      }
    });
    
    sendResponse({ success: true });
  } else if (msg.type === 'END_SESSION') {
    sessionActive = false;
    sessionScreenshots = 0;
    chrome.storage.local.set({ sessionActive, sessionScreenshots });
    updateBadge();
    // Clear capture zone
    chrome.storage.session.remove('captureZone');
    sendResponse({ success: true });
  } else if (msg.type === 'SAVE_CAPTURE_ZONE') {
    chrome.storage.session.set({ captureZone: msg.zone });
    sendResponse({ success: true });
  } else if (msg.type === 'FETCH_NOTION_PAGES') {
    getPages(msg.token)
      .then(pages => sendResponse({ success: true, pages }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async
  }
  return true;
});

// Hotkey Listener (Alt+S)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'take_screenshot') {
    const state = await chrome.storage.local.get('sessionActive');
    if (!state.sessionActive) {
      console.warn("Session is not active. Ignoring screenshot command.");
      return;
    }
    
    // 1. Validate active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('youtube.com/watch') && !tab.url.includes('youtu.be/'))) return;
    
    // 2. Validate capture zone exists
    const sessionData = await chrome.storage.session.get('captureZone');
    if (!sessionData.captureZone) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert('StudySnap: No capture zone defined. Please click Start Session and drag an area on screen first.')
      }).catch(e => console.error(e));
      return;
    }
    const zone = sessionData.captureZone;

    // 3. Take Full Screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // 4. Request Info and Caption from Content Script
    chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCREENSHOT_INFO' }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => alert('StudySnap: Cannot communicate with the extension yet. Please refresh the YouTube page completely and try again.')
        }).catch(e => console.error(e));
        return; 
      }
      
      const { title, timestamp, videoId, caption } = response;
      const isNewVideo = (videoId !== lastVideoId);
      
      try {
        // Show loading state
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: '⏳ Uploading to Notion...' });
        
        // 5. Crop base64 image via OffscreenCanvas
        const croppedBase64 = await cropImage(dataUrl, zone);
        
        // 6. Send to Notion
        const storageOptions = await chrome.storage.local.get(['notionToken', 'targetPageId']);
        if (!storageOptions.notionToken || !storageOptions.targetPageId) {
           chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: '❌ Notion integration missing!' });
           return;
        }
        
        await appendScreenshot(
          storageOptions.notionToken, 
          storageOptions.targetPageId, 
          title, 
          timestamp, 
          croppedBase64, 
          caption, 
          isNewVideo
        );
        
        // 7. Update State
        if (isNewVideo) {
           lastVideoId = videoId;
           await chrome.storage.local.set({ lastVideoId });
        }
        sessionScreenshots++;
        await chrome.storage.local.set({ sessionScreenshots });
        updateBadge();

        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: '✅ Saved to Notion!' });
      } catch (err) {
        console.error(err);
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: '❌ Error: ' + err.message });
      }
    });
  }
});

// Helper Function: Crop Image Using Offscreen Canvas
async function cropImage(dataUrl, zone) {
  // Fix for "Failed to fetch" on data: URIs in MV3 Service Workers
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeString });
  
  const bitmap = await createImageBitmap(blob);
  
  const scale = zone.devicePixelRatio || 1;
  const sx = zone.x * scale;
  const sy = zone.y * scale;
  const sWidth = zone.width * scale;
  const sHeight = zone.height * scale;

  const canvas = new OffscreenCanvas(sWidth, sHeight);
  const ctx = canvas.getContext('2d');
  
  // Draw the cropped portion
  ctx.drawImage(bitmap, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  
  const blobOutput = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blobOutput);
  });
}
