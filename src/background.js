// ===================================================================================
//
// VTF Audio Transcriber - Background Service Worker (Final Architecture)
//
// ===================================================================================

const VTF_URL_PATTERN = 'https://vtf.t3live.com/';

let state = {
  apiKey: '',
  debugMode: false,
  captureState: 'inactive',
  transcriptionState: 'inactive',
  activeTabId: null,
  transcriptionLog: [],
  stats: { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 }
};

const log = (...args) => state.debugMode && console.log('[VTF BG]', ...args);

async function setState(newState) {
  Object.assign(state, newState);
  await chrome.storage.local.set({ appState: state });
  log('State updated:', state);
  chrome.runtime.sendMessage({ type: 'stateUpdate', data: state }).catch(() => {});
}

async function initializeState() {
  const { appState } = await chrome.storage.local.get('appState');
  if (appState) Object.assign(state, appState);
  state.captureState = 'inactive';
  state.transcriptionState = 'inactive';
  state.activeTabId = null;
  state.transcriptionLog = [];
  await setState(state);
  log('Initial state loaded.', state);
}

// *** HELPER FUNCTION TO RECONSTRUCT THE BLOB ***
async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return blob;
}

async function startCapture(tab) {
  log(`Attempting to start capture for tab: ${tab.id}`);
  if (!tab.url || !tab.url.startsWith(VTF_URL_PATTERN)) {
    const errorMsg = 'This extension only works on the VTF platform.';
    log(errorMsg);
    await setState({ captureState: 'error', transcriptionLog: [{ text: errorMsg, speaker: 'System' }] });
    return;
  }
  if (state.captureState === 'active') {
    log('Capture is already active.');
    return;
  }
  await setState({ captureState: 'active', activeTabId: tab.id, transcriptionLog: [] });
  updateIcon();

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await setupOffscreenDocument('offscreen.html');
    chrome.runtime.sendMessage({
      type: 'start-recording',
      target: 'offscreen',
      data: { streamId: streamId, debugMode: state.debugMode }
    });
  } catch (error) {
    log('Error starting capture process:', error.message);
    await setState({ captureState: 'error', activeTabId: null });
    updateIcon();
  }
}

async function stopCapture() {
  log('Attempting to stop capture...');
  await setState({ captureState: 'inactive', transcriptionState: 'inactive', activeTabId: null });
  updateIcon();
  await chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' }).catch(() => {});
}

async function transcribeAudio(audioBlob) {
    if (!state.apiKey) {
      const errorMsg = 'API Key is missing.';
      const newLogEntry = { timestamp: new Date().toISOString(), text: errorMsg, speaker: 'System' };
      await setState({ transcriptionState: 'error', transcriptionLog: [...state.transcriptionLog, newLogEntry] });
      return;
    }
    
    await setState({ transcriptionState: 'transcribing' });
    try {
      const formData = new FormData();
      // This will now succeed because we have a proper Blob object.
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-1');
  
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.apiKey}` },
        body: formData
      });
  
      if (!response.ok) throw new Error((await response.json()).error.message);
  
      const result = await response.json();
      if (result.text?.trim()) {
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

async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existingContexts.length > 0) {
        log('Offscreen document already exists.');
        return;
    }
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['USER_MEDIA'],
        justification: 'To record tab audio for transcription.'
    });
    log('Offscreen document created.');
}

function updateIcon() {
  const isRecording = state.captureState === 'active';
  chrome.action.setBadgeText({ text: isRecording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

async function updateActionState(tabId) {
    if (!tabId) return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url?.startsWith(VTF_URL_PATTERN)) {
            chrome.action.enable(tabId);
        } else {
            chrome.action.disable(tabId);
        }
    } catch(e) {
        log(`Could not get tab ${tabId}, likely closed.`);
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => changeInfo.url && updateActionState(tabId));
chrome.tabs.onActivated.addListener(activeInfo => updateActionState(activeInfo.tabId));
chrome.tabs.onRemoved.addListener(tabId => (tabId === state.activeTabId) && stopCapture());

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'get-status') { sendResponse(state); return true; }
  (async () => {
    switch (request.type) {
      case 'start-capture':
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await startCapture(tab);
        break;
      case 'stop-capture': await stopCapture(); break;
      case 'options-updated': await initializeState(); break;
      // *** THIS IS THE FIX ***
      // We now receive a dataUrl and convert it back to a blob before transcribing.
      case 'audio-blob':
        const audioBlob = await dataUrlToBlob(request.data.dataUrl);
        await transcribeAudio(audioBlob);
        break;
      case 'recording-error':
        log('Received recording error:', request.error);
        await stopCapture();
        break;
    }
  })().catch(e => log(`Error in message handler for ${request.type}:`, e.message));
  return false;
});

chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(async () => {
    await initializeState();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) if (tab.id) updateActionState(tab.id);
});
