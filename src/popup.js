// ===================================================================================
//
// VTF Audio Transcriber - Popup UI Logic (Hybrid View - Corrected)
//
// ===================================================================================

let isDebugMode = false;
const log = (...args) => {
  if (isDebugMode) {
    console.log('[VTF Popup]', ...args);
  }
};

// --- DOM Elements ---
// This now correctly references ALL elements from popup.html
const UIElements = {
  startBtn: document.getElementById('startCaptureBtn'),
  stopBtn: document.getElementById('stopCaptureBtn'),
  
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.getElementById('statusText'),
  
  transcriptionStatusIndicator: document.getElementById('transcriptionStatusIndicator'), // <-- FIX: Added missing element
  transcriptionStatusText: document.getElementById('transcriptionStatusText'),

  transcriptionLog: document.getElementById('transcriptionLog'),
  
  totalDuration: document.getElementById('totalDuration'),
  totalTranscriptions: document.getElementById('totalTranscriptions'),
  errorCount: document.getElementById('errorCount')
};

// --- Rendering Logic ---

function render(state) {
  if (!state) {
    log('Render aborted: state is null or undefined');
    return;
  }
  isDebugMode = state.debugMode || false;
  log('Rendering UI with new state:', state);

  // 1. Header Buttons
  const isCapturing = state.captureState === 'active';
  UIElements.startBtn.disabled = isCapturing;
  UIElements.stopBtn.disabled = !isCapturing;

  // 2. Status Bar
  // Capture Status
  UIElements.statusIndicator.className = 'status-indicator';
  if (state.captureState === 'active') UIElements.statusIndicator.classList.add('active');
  if (state.captureState === 'error') UIElements.statusIndicator.classList.add('error');
  UIElements.statusText.textContent = state.captureState.charAt(0).toUpperCase() + state.captureState.slice(1);

  // Transcription Status
  UIElements.transcriptionStatusIndicator.className = 'status-indicator'; // <-- FIX: This will now work
  if (state.transcriptionState === 'transcribing') UIElements.transcriptionStatusIndicator.classList.add('active');
  if (state.transcriptionState === 'error') UIElements.transcriptionStatusIndicator.classList.add('error');
  UIElements.transcriptionStatusText.textContent = state.transcriptionState.charAt(0).toUpperCase() + state.transcriptionState.slice(1);

  // 3. Transcription Log (Chat View)
  UIElements.transcriptionLog.innerHTML = ''; // Clear old log
  if (state.transcriptionLog && state.transcriptionLog.length > 0) {
    // <-- FIX: Changed logic to create styled chat bubbles
    state.transcriptionLog.forEach(msg => {
      if(!msg || !msg.speaker || !msg.text) return;

      const messageEl = document.createElement('div');
      messageEl.className = `chat-message ${msg.speaker.toLowerCase()}`;
      
      const speakerEl = document.createElement('span');
      speakerEl.className = 'speaker';
      speakerEl.textContent = msg.speaker;

      const textEl = document.createElement('span');
      textEl.className = 'text';
      textEl.textContent = msg.text;
      
      messageEl.appendChild(speakerEl);
      messageEl.appendChild(textEl);
      UIElements.transcriptionLog.appendChild(messageEl);
    });
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-message system';
    placeholder.innerHTML = '<span>Transcription log will appear here...</span>';
    UIElements.transcriptionLog.appendChild(placeholder);
  }
  UIElements.transcriptionLog.scrollTop = UIElements.transcriptionLog.scrollHeight;

  // 4. Footer Stats
  if (state.stats) {
    UIElements.totalDuration.textContent = formatDuration(state.stats.totalDuration || 0);
    UIElements.totalTranscriptions.textContent = state.stats.totalTranscriptions || 0;
    UIElements.errorCount.textContent = state.stats.errorCount || 0;
  }
}

// --- Event Listeners ---

function setupEventListeners() {
  UIElements.startBtn.onclick = () => {
    log('Start button clicked');
    chrome.runtime.sendMessage({ type: 'start-capture' });
  };

  UIElements.stopBtn.onclick = () => {
    log('Stop button clicked');
    chrome.runtime.sendMessage({ type: 'stop-capture' });
  };
  
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stateUpdate') {
      render(message.data);
    }
    return true;
  });
}

// --- Initialization ---

async function initializePopup() {
  setupEventListeners();
  try {
    const initialState = await chrome.runtime.sendMessage({ type: 'get-status' });
    render(initialState);
    log('Popup initialized and rendered.');
  } catch(e) {
    console.error("Error initializing popup:", e.message);
    UIElements.transcriptionLog.innerHTML = `<div class="chat-message error"><span>Could not connect to the background service. Reload extension.</span></div>`;
  }
}

// --- Helpers ---
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', initializePopup);
