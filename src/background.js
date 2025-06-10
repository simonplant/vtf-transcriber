// ===================================================================================
//
// VTF Audio Transcriber - Background Service Worker
//
// ===================================================================================

// --- Constants and State Management ---

const DEBUG = true; // Set to true to enable detailed console logging

// The single source of truth for the extension's state.
let state = {
  apiKey: '',
  debugMode: false, // Default debug mode to false
  captureState: 'inactive', // 'inactive', 'active', 'error'
  transcriptionState: 'inactive', // 'inactive', 'transcribing', 'error'
  activeTabId: null,
  stats: {
    totalDuration: 0,
    totalTranscriptions: 0,
    errorCount: 0
  }
};

// Simple logger that respects the debugMode flag in the state.
const log = (...args) => {
  if (state.debugMode) {
    console.log('[VTF BG]', ...args);
  }
};

// Updates the state in memory, persists it to storage, and notifies listeners.
async function setState(newState) {
  Object.assign(state, newState);
  await chrome.storage.local.set({ appState: state });
  log('State updated:', state);
  // Notify the popup of the change
  chrome.runtime.sendMessage({ type: 'stateUpdate', data: state }).catch(() => log('Popup not open.'));
}

// --- Initialization ---

// Loads the state from storage when the extension starts.
async function initializeState() {
  const { appState } = await chrome.storage.local.get('appState');
  if (appState) {
    // Merge stored state with default, in case new properties were added
    Object.assign(state, appState);
    // Reset transient states
    state.captureState = 'inactive';
    state.transcriptionState = 'inactive';
    state.activeTabId = null;
  }
  // Persist the potentially cleaned state
  await setState(state);
  log('Initial state loaded.', state);
}

chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(initializeState);

// --- Core Logic: Capture and Transcription ---

async function startCapture(tabId) {
  log('Attempting to start capture...');
  if (state.activeTabId) {
    log('Capture already active.');
    return;
  }

  try {
    // 1. Setup and create the offscreen document
    await setupOffscreenDocument('offscreen.html');
    
    // 2. Get a media stream from the tab
    const stream = await chrome.tabCapture.capture({ audio: true, video: false });

    // 3. Send the stream to the offscreen document to start recording
    await chrome.runtime.sendMessage({
      type: 'start-recording',
      target: 'offscreen',
      stream: stream,
      debugMode: state.debugMode // Pass the current debug mode
    });

    // 4. Update our state
    await setState({ captureState: 'active', activeTabId: tabId });
    updateIcon();
    log('Capture started successfully for tab:', tabId);

  } catch (error) {
    log('Error starting capture:', error.message);
    await setState({ captureState: 'error', activeTabId: null });
    updateIcon();
    await cleanupOffscreenDocument();
  }
}

async function stopCapture() {
  log('Attempting to stop capture...');
  if (!state.activeTabId) {
    log('No active capture to stop.');
    return;
  }

  try {
    // Tell the offscreen document to stop recording.
    await chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
  } catch(e) {
    log("Could not communicate with offscreen doc to stop, will close it.", e.message);
  } finally {
    // Always clean up the state and offscreen document
    await cleanupOffscreenDocument();
    await setState({ captureState: 'inactive', transcriptionState: 'inactive', activeTabId: null });
    updateIcon();
    log('Capture stopped and cleaned up.');
  }
}

async function transcribeAudio(audioBlob) {
  log(`Transcribing audio chunk of size ${audioBlob.size}...`);
  if (!state.apiKey) {
    log('Transcription failed: API key missing');
    showNotification('API Key Missing', 'Please set your OpenAI API key in the options.');
    await setState({ transcriptionState: 'error', stats: { ...state.stats, errorCount: state.stats.errorCount + 1 } });
    return;
  }
  
  await setState({ transcriptionState: 'transcribing' });
  
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.apiKey}` },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    const result = await response.json();
    log('Transcription received:', result.text);

    if (result.text && result.text.trim()) {
      showNotification('Transcription Received', result.text.trim());
      await setState({
        transcriptionState: 'inactive',
        stats: {
          ...state.stats,
          totalTranscriptions: state.stats.totalTranscriptions + 1,
          totalDuration: state.stats.totalDuration + 10 // Chunks are 10s
        }
      });
    } else {
      throw new Error('No transcription text received from API.');
    }
  } catch (error) {
    log('Transcription failed:', error.message);
    showNotification('Transcription Failed', error.message);
    await setState({
      transcriptionState: 'error',
      stats: { ...state.stats, errorCount: state.stats.errorCount + 1 }
    });
  }
}

// --- Offscreen Document Management ---

async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existingContexts.find(c => c.documentUrl.endsWith(path))) {
    log('Offscreen document already exists.');
    return;
  }
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['AUDIO_CAPTURE'],
    justification: 'To record tab audio for transcription.'
  });
  log('Offscreen document created.');
}

async function cleanupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
    log('Offscreen document closed.');
  }
}

// --- UI Helpers ---

function updateIcon() {
  const isRecording = state.captureState === 'active';
  const badgeText = isRecording ? 'REC' : '';
  
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  });
}

// --- Event Listeners ---

// Main message handler for requests from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('Received message:', request.type, 'from', sender.url?.split('/').pop());

  // Handle the 'get-status' request separately because it's synchronous
  // and doesn't return a promise that needs a .catch handler.
  if (request.type === 'get-status') {
    sendResponse(state);
    return true; // Return true to indicate you will be calling sendResponse.
  }

  // Use a handler map for clean, async routing of all other messages.
  const handlers = {
    'start-capture': () => chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => startCapture(tabs[0].id)),
    'stop-capture': stopCapture,
    'audio-blob': () => transcribeAudio(request.data.blob),
    'recording-error': async () => {
      log('Received recording error:', request.error);
      showNotification('Recording Error', request.error);
      await stopCapture(); // Properly await the async stopCapture function
    },
    'options-updated': initializeState
  };

  const handler = handlers[request.type];
  if (handler) {
    // Now, this line is safe because all functions in the handlers map above
    // are guaranteed to return a Promise.
    handler().catch(e => log(`Error in '${request.type}' handler:`, e.message));
  }

  // Return false for any message that is not handled or does not need an async response.
  return false;
});

// Stop capture if the recorded tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.activeTabId) {
    log('Active tab closed, stopping capture.');
    stopCapture();
  }
});