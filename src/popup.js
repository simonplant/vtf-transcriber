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
  errorCount: document.getElementById('errorCount'),
  testConnectionBtn: document.getElementById('testConnectionBtn')
};

// --- Rendering Logic ---

// A single function to update the entire UI based on the current state.
function render(state) {
  log('Rendering UI with new state:', state);

  // Capture State
  const isInactive = state.captureState === 'inactive';
  const isActive = state.captureState === 'active';
  const isError = state.captureState === 'error';

  UIElements.startBtn.disabled = !isInactive;
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
  
  UIElements.testConnectionBtn.onclick = async () => {
    log('Testing server connection...');
    try {
      const response = await fetch('http://localhost:3000/health');
      const data = await response.json();
      if (data.status === 'ok') {
        chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Connection Test', message: 'Server connection successful!' });
      } else {
        throw new Error('Server returned non-OK status.');
      }
    } catch (error) {
      log('Connection test failed:', error);
      chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Connection Test', message: `Failed to connect to server: ${error.message}` });
    }
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