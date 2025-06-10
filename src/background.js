// ===================================================================================
//
// VTF Audio Transcriber - Background Service Worker (Final Scoped Architecture)
//
// ===================================================================================

// The specific URL this extension is designed for.
const VTF_URL_PATTERN = 'https://vtf.t3live.com/';

// --- State Management ---
let state = {
  apiKey: '',
  debugMode: false,
  captureState: 'inactive',
  transcriptionState: 'inactive',
  activeTabId: null,
  transcriptionLog: [],
  stats: { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 }
};

// --- Global Variables for Capture ---
let mediaRecorder = null; 
let audioStream = null;

const log = (...args) => state.debugMode && console.log('[VTF BG]', ...args);

// --- Core Functions ---
async function setState(newState) {
  Object.assign(state, newState);
  await chrome.storage.local.set({ appState: state });
  log('State updated:', state);
  chrome.runtime.sendMessage({ type: 'stateUpdate', data: state }).catch(() => {});
}

async function initializeState() {
  const { appState } = await chrome.storage.local.get('appState');
  if (appState) {
    Object.assign(state, appState);
    state.captureState = 'inactive';
    state.transcriptionState = 'inactive';
    state.activeTabId = null;
    state.transcriptionLog = [];
  }
  await setState(state);
  log('Initial state loaded.', state);
}

async function startCapture(tab) {
  log(`Attempting to start capture for tab: ${tab.id}`);

  // *** UPDATED GUARD: Now specifically checks for the correct site ***
  if (!tab.url || !tab.url.startsWith(VTF_URL_PATTERN)) {
    const errorMsg = 'This extension only works on the VTF platform.';
    log(errorMsg);
    await setState({ captureState: 'error', transcriptionLog: [{ text: errorMsg, speaker: 'System' }] });
    return;
  }

  if (mediaRecorder?.state === 'recording') {
    log('Capture is already active. Ignoring request.');
    return;
  }

  try {
    audioStream = await chrome.tabCapture.capture({ audio: true, video: false, targetTabId: tab.id });
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => event.data.size > 0 && transcribeAudio(event.data);
    mediaRecorder.onstop = () => {
      log('MediaRecorder stopped.');
      if(audioStream) audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
      mediaRecorder = null;
    };
    
    mediaRecorder.start(10000);
    await setState({ captureState: 'active', activeTabId: tab.id, transcriptionLog: [] });
    updateIcon();
    log('Capture initiated successfully on VTF platform.');

  } catch (error) {
    log('Error starting capture:', error.message);
    await setState({ captureState: 'error', activeTabId: null });
    updateIcon();
    if (audioStream) audioStream.getTracks().forEach(track => track.stop());
  }
}

async function stopCapture() {
  log('Attempting to stop capture...');
  await setState({ captureState: 'inactive', transcriptionState: 'inactive', activeTabId: null });
  updateIcon();
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  log('Capture stop process initiated.');
}

async function transcribeAudio(audioBlob) {
    if (!state.apiKey) {
      const errorMsg = 'API Key is missing. Please set it in the options.';
      const newLogEntry = { timestamp: new Date().toISOString(), text: errorMsg, speaker: 'System' };
      await setState({ transcriptionState: 'error', transcriptionLog: [...state.transcriptionLog, newLogEntry] });
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
        const newLogEntry = {
          timestamp: new Date().toISOString(),
          text: result.text.trim(),
          speaker: state.transcriptionLog.length % 2 === 0 ? 'Moderator' : 'Member'
        };
        await setState({
          transcriptionState: 'inactive',
          transcriptionLog: [...state.transcriptionLog, newLogEntry],
          stats: { ...state.stats, totalTranscriptions: state.stats.totalTranscriptions + 1, totalDuration: state.stats.totalDuration + 10 }
        });
      } else {
        await setState({ transcriptionState: 'inactive' });
      }
    } catch (error) {
      log('Transcription failed:', error.message);
      const newLogEntry = { timestamp: new Date().toISOString(), text: `Transcription Failed: ${error.message}`, speaker: 'System' };
      await setState({
        transcriptionState: 'error',
        transcriptionLog: [...state.transcriptionLog, newLogEntry],
        stats: { ...state.stats, errorCount: state.stats.errorCount + 1 }
      });
    }
}

function updateIcon() {
  const isRecording = state.captureState === 'active';
  chrome.action.setBadgeText({ text: isRecording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

// --- Event Listeners ---

// *** NEW: Context-Aware Logic ***
// This function enables or disables the extension's icon based on the URL.
async function updateActionState(tabId) {
    if (!tabId) return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.url && tab.url.startsWith(VTF_URL_PATTERN)) {
            chrome.action.enable(tabId);
        } else {
            chrome.action.disable(tabId);
        }
    } catch(e) {
        // This can happen if the tab is closed before the get() call completes.
        log(`Could not get tab ${tabId}, likely closed.`);
    }
}

// Enable/disable the icon when a tab is updated.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only need to check when the URL changes.
    if (changeInfo.url) {
        updateActionState(tabId);
    }
});

// Enable/disable the icon when the user switches to a different tab.
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateActionState(activeInfo.tabId);
});

// The main message handler.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'get-status') {
    sendResponse(state);
    return true;
  }

  (async () => {
    switch (request.type) {
      case 'start-capture':
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await startCapture(tab);
        break;
      case 'stop-capture':
        await stopCapture();
        break;
      case 'options-updated':
        await initializeState();
        break;
    }
  })().catch(e => log(`Error in message handler for ${request.type}:`, e.message));
  
  return false;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.activeTabId) {
    log('Active tab closed, stopping capture.');
    stopCapture();
  }
});

chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(async () => {
    await initializeState();
    // On install, check all existing tabs and disable the action until the user navigates.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if(tab.id) {
           updateActionState(tab.id);
        }
    }
});
