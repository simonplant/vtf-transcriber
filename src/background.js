// Service Worker Lifecycle Events
self.addEventListener('install', (event) => {
  console.log('VTF Service Worker Installing...');
  // Skip waiting to ensure we get the latest version
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('VTF Service Worker Activated');
  // Claim clients to ensure we control all pages
  event.waitUntil(clients.claim());
});

// Debug logging function with timestamp
function debugLog(message, data = null) {
  chrome.storage.local.get({ debugMode: false }, (items) => {
    if (items.debugMode) {
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
  });
}

// Initialize state with persistence
let activeTabId = null;

// Load persisted state on startup
async function loadPersistedState() {
  try {
    const { persistedTabId } = await chrome.storage.local.get('persistedTabId');
    if (persistedTabId) {
      activeTabId = persistedTabId;
      debugLog('Restored persisted tab ID:', activeTabId);
    }
  } catch (error) {
    debugLog('Failed to load persisted state:', error);
  }
}

// Save state when it changes
async function saveState() {
  try {
    await chrome.storage.local.set({
      persistedTabId: activeTabId,
      captureState: activeTabId ? 'active' : 'inactive',
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    debugLog('Failed to save state:', error);
  }
}

// Extension Lifecycle Events
chrome.runtime.onStartup.addListener(async () => {
  console.log('VTF Extension Started');
  await loadPersistedState();
  // Clear any stale session state, but preserve stats
  await chrome.storage.local.set({
    captureState: 'inactive',
    transcriptionState: 'inactive'
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('VTF Extension Installed/Updated');
  await loadPersistedState();
  // Clear any stale state
  await chrome.storage.local.set({
    captureState: 'inactive',
    transcriptionState: 'inactive',
    stats: { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 },
    lastUpdate: 'Never'
  });
});

// Check for pending actions on startup
chrome.runtime.onStartup.addListener(async () => {
  debugLog('Extension starting up, checking for pending actions...');
  const { pendingAction } = await chrome.storage.local.get('pendingAction');
  if (pendingAction) {
    debugLog('Found pending action:', pendingAction);
    await handlePendingAction(pendingAction);
  }
});

// --- Offscreen Document Management ---
let offscreenDocument = null;

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    const doc = existingContexts.find(c => c.documentUrl?.endsWith('offscreen.html'));
    if (doc) {
      offscreenDocument = doc;
      debugLog('Found existing offscreen document:', doc.documentUrl);
      return true;
    }
  }
  return false;
}

async function setupOffscreenDocument() {
  debugLog('Setting up offscreen document...');
  try {
    // Check if we already have an offscreen document
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    const existingOffscreen = existingContexts.find(
      context => context.documentUrl?.endsWith('offscreen.html')
    );

    if (existingOffscreen) {
      debugLog('Offscreen document already exists');
      return;
    }

    // Create the offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_CAPTURE'],
      justification: 'Recording tab audio for transcription.'
    });

    debugLog('Offscreen document created successfully');

    // Wait for initialization
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Offscreen document initialization timeout'));
      }, 5000);

      const listener = (message) => {
        if (message.type === 'offscreen-ready') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        } else if (message.type === 'offscreen-error') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(message.error));
        }
      };

      chrome.runtime.onMessage.addListener(listener);
    });
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
      // Show notification
      showNotification('Transcription Received', result.text.trim());
      
      // Send to popup if it's open
      chrome.runtime.sendMessage({
        type: 'transcription',
        text: result.text.trim()
      }).catch(() => {
        // Ignore errors if popup isn't open
      });
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
    case 'log':
      // Forward log messages to the main console
      console.log(request.message, request.data || '');
      sendResponse({ status: 'ok' });
      break;

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
      return true; // Keep message channel open for async response

    case 'stop-capture':
      debugLog('Processing stop-capture request');
      stopCapture().then(() => {
        debugLog('Capture stopped successfully');
        sendResponse({ status: 'stopped' });
      }).catch(error => {
        debugLog('Stop capture failed:', error);
        sendResponse({ status: 'error', error: error.message });
      });
      return true; // Keep message channel open for async response

    case 'get-status':
      debugLog('Processing get-status request');
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (chrome.runtime.lastError) {
          debugLog('Error querying tabs:', chrome.runtime.lastError.message);
          sendResponse({ isActive: false, offscreenStatus: 'error' });
          return;
        }
        
        if (tabs.length === 0) {
          debugLog('Status check failed: No active tab found');
          sendResponse({ isActive: false, offscreenStatus: 'inactive' });
          return;
        }

        const isActive = activeTabId === tabs[0].id;
        debugLog('Status check result:', { isActive, activeTabId, currentTabId: tabs[0].id });

        // Check offscreen document status robustly
        try {
          const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
          if (existingContexts.length > 0) {
            // It exists, so we can query it
            const offscreenStatus = await chrome.runtime.sendMessage({ type: 'check-status' });
            sendResponse({
              isActive,
              offscreenStatus: offscreenStatus?.status || 'inactive',
              isRecording: offscreenStatus?.isRecording || false
            });
          } else {
            // It does not exist, which is a normal state before capture
            sendResponse({
              isActive,
              offscreenStatus: 'inactive',
              isRecording: false
            });
          }
        } catch (error) {
          debugLog('Error checking offscreen status:', error);
          // If messaging fails, it could be because the document is closing.
          // This is not a critical extension error, but a transient state.
          sendResponse({
            isActive,
            offscreenStatus: 'inactive',
            isRecording: false
          });
        }
      });
      return true; // Keep message channel open for async response

    case 'audio-blob':
      debugLog('Received audio blob from offscreen document');
      if (sender.url?.endsWith('offscreen.html')) {
        transcribeAudio(request.data.blob);
        sendResponse({ status: 'ok' });
      } else {
        debugLog('Warning: Received audio blob from unexpected source:', sender.url);
        sendResponse({ status: 'error', error: 'Invalid sender' });
      }
      break;

    case 'recording-error':
      debugLog('Recording error from offscreen document:', request.error);
      showNotification('Recording Error', request.error);
      // Update state to reflect the error
      activeTabId = null;
      saveState().then(() => {
        updateIcon(false);
        // Notify popup if it's open
        chrome.runtime.sendMessage({
          type: 'stateUpdate',
          captureState: 'error'
        }).catch(() => {
          // Ignore errors if popup isn't open
        });
        sendResponse({ status: 'ok' });
      }).catch(error => {
        debugLog('Failed to save state:', error);
        sendResponse({ status: 'error', error: error.message });
      });
      return true; // Keep message channel open for async response
  }
});

// --- Capture Control Functions ---
async function startCapture(tabId) {
  debugLog('Starting capture for tab:', tabId);
  try {
    // Ensure offscreen document is ready
    await setupOffscreenDocument();

    // Get tab capture stream
    const stream = await chrome.tabCapture.capture({
      audio: true,
      video: false
    });

    if (!stream) {
      throw new Error('Failed to capture tab audio');
    }

    // Start recording in offscreen document
    await chrome.runtime.sendMessage({
      type: 'start-recording',
      stream: stream
    });

    // Update state
    activeTabId = tabId;
    await saveState();
    updateIcon(true);

    debugLog('Capture started successfully');
  } catch (error) {
    debugLog('Failed to start capture:', error);
    throw error;
  }
}

async function stopCapture() {
  debugLog('Stopping capture...');
  try {
    // Stop recording in offscreen document
    await chrome.runtime.sendMessage({ type: 'stop-recording' });

    // Close the offscreen document to release resources
    await chrome.offscreen.closeDocument();
    debugLog('Offscreen document closed.');

    // Update state
    activeTabId = null;
    await saveState();
    updateIcon(false);

    debugLog('Capture stopped successfully');
  } catch (error) {
    debugLog('Failed to stop capture:', error);
    // Even if there's an error, try to clean up state
    activeTabId = null;
    await saveState();
    updateIcon(false);
    throw error;
  }
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

// Handle pending actions
async function handlePendingAction(action) {
  debugLog('Handling pending action:', action);
  try {
    switch (action) {
      case 'start-capture':
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          await startCapture(tabs[0].id);
        }
        break;
      case 'stop-capture':
        await stopCapture();
        break;
    }
    // Clear the pending action
    await chrome.storage.local.remove('pendingAction');
  } catch (error) {
    debugLog('Error handling pending action:', error);
    // Clear the pending action even if it failed
    await chrome.storage.local.remove('pendingAction');
  }
}