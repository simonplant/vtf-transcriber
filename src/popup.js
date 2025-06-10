// ===================================================================================
//
// VTF Audio Transcriber - Popup UI Logic
//
// ===================================================================================

const log = (...args) => console.log('[VTF Popup]', ...args);

// --- DOM Elements ---
const UIElements = {
  startBtn: document.getElementById('startCaptureBtn'),
  stopBtn: document.getElementById('stopCaptureBtn'),
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.getElementById('statusText'),
  transcriptionStatus: document.getElementById('transcriptionStatusText'),
  totalDuration: document.getElementById('totalDuration'),
  totalTranscriptions: document.getElementById('totalTranscriptions'),
  errorCount: document.getElementById('errorCount')
};

// --- Rendering Logic ---

// A single function to update the entire UI based on the current state.
function render(state) {
  log('Rendering UI with new state:', state);

  // Capture State
  const isInactive = state.captureState === 'inactive';
  const isActive = state.captureState === 'active';
  const isError = state.captureState === 'error';

  // The user should be able to start a capture if the state is inactive OR if there was an error.
  UIElements.startBtn.disabled = !(isInactive || isError);
  UIElements.stopBtn.disabled = !isActive;

  UIElements.statusIndicator.className = 'status-indicator'; // Reset
  if (isActive) UIElements.statusIndicator.classList.add('active');
  if (isError) UIElements.statusIndicator.classList.add('error');

  const captureStatusMap = {
    inactive: 'Ready to capture',
    active: 'Capturing...',
    error: 'Capture Error'
  };
  UIElements.statusText.textContent = captureStatusMap[state.captureState] || 'Unknown';

  // Transcription State
  const transcribingStatusMap = {
    inactive: 'Idle',
    transcribing: 'Transcribing...',
    error: 'Transcription Error'
  };
  UIElements.transcriptionStatus.textContent = transcribingStatusMap[state.transcriptionState] || 'Unknown';

  // Stats
  UIElements.totalDuration.textContent = formatDuration(state.stats.totalDuration);
  UIElements.totalTranscriptions.textContent = state.stats.totalTranscriptions;
  UIElements.errorCount.textContent = state.stats.errorCount;
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
  
  // Listen for state updates from the background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stateUpdate') {
      render(message.data);
    }
  });
}

// --- Initialization ---

async function initializePopup() {
  log('Initializing popup...');
  setupEventListeners();
  // Request the current state from the background script to render the initial UI
  const initialState = await chrome.runtime.sendMessage({ type: 'get-status' });
  render(initialState);
}

// --- Helpers ---
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', initializePopup);