// Service Worker Lifecycle Events
self.addEventListener('install', (event) => {
  console.log('VTF Service Worker Installing...');
});

self.addEventListener('activate', (event) => {
  console.log('VTF Service Worker Activated');
});

// Debug logging function with timestamp
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[VTF ${timestamp}] ${message}`;
  console.log(logMessage, data || '');
  
  // Forward log to content script if we have an active tab
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, {
      type: 'log',
      message: logMessage,
      data: data
    }).catch(() => {
      // Ignore errors if content script isn't ready
    });
  }
}

// Initialize state
let activeTabId = null;

// Extension Lifecycle Events
chrome.runtime.onStartup.addListener(() => {
  console.log('VTF Extension Started');
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('VTF Extension Installed/Updated');
});

// --- Offscreen Document Management ---
async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    const hasDoc = !!existingContexts.find(c => c.documentUrl?.endsWith('offscreen.html'));
    debugLog('Checking offscreen document:', { exists: hasDoc });
    return hasDoc;
  }
  return false;
}

async function setupOffscreenDocument() {
  debugLog('Setting up offscreen document...');
  if (await hasOffscreenDocument()) {
    debugLog('Offscreen document already exists');
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio for transcription.'
    });
    debugLog('Offscreen document created successfully');
  } catch (error) {
    debugLog('Failed to create offscreen document:', error);
    throw error;
  }
}

// --- Transcription Logic ---
async function transcribeAudio(audioBlob) {
  debugLog('Starting audio transcription...');
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    debugLog('Transcription failed: API key missing');
    showNotification('API Key Missing', 'Please set your OpenAI API key in the extension options.');
    return;
  }

  try {
    debugLog('Preparing audio data for transcription');
    const formData = new FormData();
    
    // Ensure we have a proper Blob with the correct MIME type
    if (!(audioBlob instanceof Blob)) {
      debugLog('Converting audio data to Blob');
      audioBlob = new Blob([audioBlob], { type: 'audio/webm;codecs=opus' });
    } else if (audioBlob.type !== 'audio/webm;codecs=opus') {
      debugLog('Converting audio blob to correct MIME type');
      audioBlob = new Blob([audioBlob], { type: 'audio/webm;codecs=opus' });
    }

    // Check file size (Whisper API limit is 25MB)
    if (audioBlob.size > 25 * 1024 * 1024) {
      throw new Error('Audio file too large. Maximum size is 25MB.');
    }
    
    // Use .webm extension to match the MIME type
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'json');

    debugLog('Sending audio to OpenAI API...', { 
      size: `${(audioBlob.size / 1024 / 1024).toFixed(2)}MB`,
      type: audioBlob.type
    });

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
    debugLog('Transcription received:', { text: result.text?.trim() });
    
    if (result.text && result.text.trim()) {
      showNotification('Transcription Received', result.text.trim());
    } else {
      throw new Error('No transcription text received');
    }
  } catch (error) {
    debugLog('Transcription failed:', error);
    showNotification('Transcription Failed', error.message);
  }
}

// --- Main Event Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('Received message:', { type: request.type, sender: sender.url });
  
  switch (request.type) {
    case 'start-capture':
      debugLog('Processing start-capture request');
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs.length === 0) {
          debugLog('Start capture failed: No active tab found');
          sendResponse({ status: 'error', error: 'No active tab found' });
          return;
        }
        try {
          await startCapture(tabs[0].id);
          debugLog('Capture started successfully');
          sendResponse({ status: 'started' });
        } catch (error) {
          debugLog('Start capture failed:', error);
          sendResponse({ status: 'error', error: error.message });
        }
      });
      break;

    case 'stop-capture':
      debugLog('Processing stop-capture request');
      stopCapture().then(() => {
        debugLog('Capture stopped successfully');
        sendResponse({ status: 'stopped' });
      });
      break;

    case 'get-status':
      debugLog('Processing get-status request');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          debugLog('Status check failed: No active tab found');
          sendResponse({ isActive: false });
          return;
        }
        const isActive = activeTabId === tabs[0].id;
        debugLog('Status check result:', { isActive, activeTabId, currentTabId: tabs[0].id });
        sendResponse({ isActive });
      });
      break;

    case 'audio-blob':
      debugLog('Received audio blob from offscreen document');
      if (sender.url?.endsWith('offscreen.html')) {
        transcribeAudio(request.data.blob);
      } else {
        debugLog('Warning: Received audio blob from unexpected source:', sender.url);
      }
      break;
  }
  return true; // Keep message channel open for async response
});

// --- Capture Control Functions ---
async function startCapture(tabId) {
  debugLog('Starting capture for tab:', tabId);
  if (activeTabId) {
    debugLog('Capture already active:', { activeTabId });
    showNotification("Capture In Progress", "A capture is already active. Please stop it first.");
    return;
  }
  await setupOffscreenDocument();
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    debugLog('Got media stream ID:', { streamId });
    activeTabId = tabId;
    chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen', streamId });
    updateIcon(true);
    debugLog('Capture started successfully');
  } catch (error) {
    debugLog('Failed to start capture:', error);
    showNotification('Capture Error', `Could not start: ${error.message}`);
    await cleanup();
  }
}

async function stopCapture() {
  debugLog('Stopping capture');
  if (!activeTabId) {
    debugLog('No active capture to stop');
    return;
  }
  chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
  await cleanup();
}

async function cleanup() {
  debugLog('Cleaning up resources');
  activeTabId = null;
  updateIcon(false);
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
    debugLog('Offscreen document closed');
  }
  debugLog('Cleanup completed');
}

function updateIcon(isRecording) {
  debugLog('Updating icon state:', { isRecording });
  // Use the same icon for both states since we don't have an active version
  const iconPath = 'icons/icon48.png';
  const badgeText = isRecording ? 'REC' : '';
  chrome.action.setIcon({ path: iconPath });
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
}

function showNotification(title, message) {
  debugLog('Showing notification:', { title, message });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  });
}

// Ensure cleanup if the recorded tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    debugLog('Active tab closed, stopping capture:', { tabId });
    stopCapture();
  }
});