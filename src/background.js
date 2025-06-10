// ===================================================================================
//
// VTF Audio Transcriber - Background Service Worker
//
// ===================================================================================

// --- State Management ---
let state = {
  apiKey: '',
  debugMode: false,
  captureState: 'inactive', // 'inactive', 'active', 'error'
  transcriptionState: 'inactive', // 'inactive', 'transcribing', 'error'
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

// *** THE PRIMARY FIX IS HERE ***
async function startCapture(tab) {
  log(`Attempting to start capture for tab: ${tab.id}`);

  // 1. ADDED GUARD: Check if the URL is a restricted page.
  const url = tab.url;
  if (!url || url.startsWith('chrome://') || url.startsWith('https://chrome.google.com')) {
    const errorMsg = 'Cannot capture audio on this page. Please use on a standard website (http or https).';
    log(errorMsg);
    const newLogEntry = { timestamp: new Date().toISOString(), text: errorMsg, speaker: 'System' };
    await setState({ 
      captureState: 'error', 
      transcriptionLog: [newLogEntry] 
    });
    return;
  }

  if (mediaRecorder?.state === 'recording') {
    log('Capture is already active. Ignoring request.');
    return;
  }

  try {
    // 2. Capture the tab's audio stream.
    audioStream = await chrome.tabCapture.capture({
        audio: true,
        video: false,
        targetTabId: tab.id
    });

    // 3. Setup the MediaRecorder.
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        transcribeAudio(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      log('MediaRecorder stopped.');
      if(audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
      }
      audioStream = null;
      mediaRecorder = null;
    };
    
    mediaRecorder.start(10000);

    // 4. Update state and UI.
    await setState({ captureState: 'active', activeTabId: tab.id, transcriptionLog: [] });
    updateIcon();
    log('Capture initiated successfully.');

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

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
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
// *** SIMPLIFIED MESSAGE LISTENER ***
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'get-status') {
    sendResponse(state);
    return true; // Keep channel open for the synchronous response.
  }

  // Handle other messages asynchronously without returning true, to prevent channel closed errors.
  (async () => {
    switch (request.type) {
      case 'start-capture':
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await startCapture(tab); // Pass the whole tab object
        }
        break;
      case 'stop-capture':
        await stopCapture();
        break;
      case 'options-updated':
        await initializeState();
        break;
    }
  })().catch(e => log(`Error in message handler for ${request.type}:`, e.message));
  
  // Return false for async handlers where we don't use sendResponse.
  return false;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.activeTabId) {
    log('Active tab closed, stopping capture.');
    stopCapture();
  }
});

chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(initializeState);
