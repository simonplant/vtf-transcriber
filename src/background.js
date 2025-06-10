// Debug logging function
function debugLog(message) {
  console.log('[VTF DEBUG]', message);
}

// Initialize state
let activeTabId = null;

debugLog('Background service worker initializing...');

// Handle messages from popup and offscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog('Received message:', message);

  switch (message.type) {
    case 'start-capture':
      debugLog('Start capture requested for tab:', message.tabId);
      startCapture(message.tabId)
        .then(() => sendResponse({ status: 'started' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      break;

    case 'stop-capture':
      debugLog('Stop capture requested');
      stopCapture()
        .then(() => sendResponse({ status: 'stopped' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      break;

    case 'get-status':
      debugLog('Getting capture status');
      sendResponse({ isActive: activeTabId === message.tabId });
      break;

    case 'audio-blob':
      if (sender.url?.endsWith('offscreen.html')) {
        debugLog('Received audio blob from offscreen');
        transcribeAudio(message.data.blob);
      }
      break;
  }
  return true; // Keep the message channel open for async response
});

// --- Offscreen Document Management ---
async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return !!existingContexts.find(c => c.documentUrl?.endsWith('offscreen.html'));
  }
  return false;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  console.log("Creating offscreen document...");
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab audio for transcription.'
  });
}

// --- Transcription Logic ---
async function transcribeAudio(audioBlob) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    showNotification('API Key Missing', 'Please set your OpenAI API key in the extension options.');
    return;
  }

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }
    const result = await response.json();
    if (result.text && result.text.trim()) {
      showNotification('Transcription Received', result.text.trim());
    }
  } catch (error) {
    showNotification('Transcription Failed', error.message);
  }
}

// --- Main Event Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'start-capture':
      // Get tabId from the sender of the message (the popup)
      startCapture(sender.tab.id).then(() => sendResponse({ status: 'started' }));
      break;
    case 'stop-capture':
      stopCapture().then(() => sendResponse({ status: 'stopped' }));
      break;
    case 'get-status':
      // Get tabId from the sender to check if it's the active one
      sendResponse({ isActive: activeTabId === sender.tab.id });
      break;
    case 'audio-blob':
      // Ensure the message is from our offscreen document
      if (sender.url?.endsWith('offscreen.html')) {
        transcribeAudio(request.data.blob);
      }
      break;
  }
  return true; // Keep message channel open for async response
});

// --- Capture Control Functions ---
async function startCapture(tabId) {
  if (activeTabId) {
    showNotification("Capture In Progress", "A capture is already active. Please stop it first.");
    return;
  }
  await setupOffscreenDocument();
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    activeTabId = tabId;
    chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen', streamId });
    updateIcon(true);
  } catch (error) {
    showNotification('Capture Error', `Could not start: ${error.message}`);
    await cleanup();
  }
}

async function stopCapture() {
  if (!activeTabId) return;
  chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
  await cleanup();
}

async function cleanup() {
  activeTabId = null;
  updateIcon(false);
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
  console.log("Capture stopped and resources cleaned up.");
}

function updateIcon(isRecording) {
  const iconPath = `icons/icon48${isRecording ? '-active' : ''}.png`;
  const badgeText = isRecording ? 'REC' : '';
  chrome.action.setIcon({ path: iconPath });
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2
  });
}

// Ensure cleanup if the recorded tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) stopCapture();
});

debugLog('Background service worker initialized successfully');