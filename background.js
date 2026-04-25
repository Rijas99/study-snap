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

// Hotkey Listener (Alt+S and Alt+F)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'take_screenshot' || command === 'take_fullscreen_screenshot') {
    const state = await chrome.storage.local.get(['sessionActive', 'destination']);
    if (!state.sessionActive) {
      console.warn("Session is not active. Ignoring screenshot command.");
      return;
    }
    
    // 1. Validate active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://')) return;
    
    // Inject content scripts safely (content.js has an initialization guard)
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (e) {
      console.warn("Failed to inject content scripts", e);
    }

    // 2. Validate capture zone exists (only for zone capturing)
    let zone = null;
    if (command === 'take_screenshot') {
      const sessionData = await chrome.storage.session.get('captureZone');
      if (!sessionData.captureZone) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => alert('StudySnap: No capture zone defined. Please click Start Session and drag an area on screen first.')
        }).catch(e => console.error(e));
        return;
      }
      zone = sessionData.captureZone;
    }

    // 3. Take Full Screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    const dest = state.destination || 'notion';
    const isNotion = dest === 'notion';

    // 4. Request Info and Caption from Content Script
    chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCREENSHOT_INFO', isNotion }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => alert('StudySnap: Cannot communicate with the extension. Please refresh the page completely and try again.')
        }).catch(e => console.error(e));
        return; 
      }
      
      const { title, timestamp, videoId, caption } = response;
      const isNewVideo = (videoId !== lastVideoId);
      
      try {
        // Show loading state
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: isNotion ? '⏳ Uploading to Notion...' : '⏳ Copying to Clipboard...' });
        
        // 5. Crop base64 image via OffscreenCanvas if zone capturing, else use full screen directly
        const finalBase64 = (command === 'take_screenshot' && zone) 
                              ? await cropImage(dataUrl, zone) 
                              : dataUrl;
        
        // 6. Navigate Logic depending on destination
        if (isNotion) {
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
            finalBase64, 
            caption, 
            isNewVideo
          );

          if (isNewVideo) {
             lastVideoId = videoId;
             await chrome.storage.local.set({ lastVideoId });
          }
        } else {
          // Copy to Clipboard
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (base64Str) => {
              try {
                const res = await fetch(base64Str);
                const blob = await res.blob();
                await navigator.clipboard.write([
                  new ClipboardItem({ 'image/png': blob })
                ]);
              } catch (e) {
                throw new Error("Failed to write to clipboard.");
              }
            },
            args: [finalBase64]
          });
        }
        
        // 7. Update State
        sessionScreenshots++;
        await chrome.storage.local.set({ sessionScreenshots });
        updateBadge();

        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: isNotion ? '✅ Saved to Notion!' : '✅ Copied to Clipboard!' });
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
