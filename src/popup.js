// Initialize popup state from storage
async function initializePopup() {
  debugLog('Initializing popup state...');
  try {
    const result = await chrome.storage.local.get([
      'captureState',
      'transcriptionState',
      'stats',
      'lastUpdate'
    ]);
    
    return {
      captureState: result.captureState || 'Inactive',
      transcriptionState: result.transcriptionState || 'Inactive',
      stats: result.stats || { totalDuration: 0, totalTranscriptions: 0, errorCount: 0 },
      lastUpdate: result.lastUpdate || 'Never'
    };
  } catch (error) {
    console.error('Failed to initialize popup state:', error);
    throw error;
  }
}

// Debug logging function
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[VTF Popup ${timestamp}] ${message}`;
  console.log(logMessage, data || '');
}

// Helper function to safely get element
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} not found`);
  }
  return element;
}

// Initialize UI elements
function initializeUI() {
  debugLog('Initializing UI elements...');
  
  const elements = {
    captureState: getElement('capture-state'),
    captureDuration: getElement('capture-duration'),
    transcriptionState: getElement('transcription-state'),
    lastUpdate: getElement('last-update'),
    totalDuration: getElement('total-duration'),
    totalTranscriptions: getElement('total-transcriptions'),
    errorCount: getElement('error-count'),
    startCaptureBtn: getElement('start-capture'),
    stopCaptureBtn: getElement('stop-capture'),
    testConnectionBtn: getElement('test-connection')
  };

  debugLog('All UI elements found successfully');
  return elements;
}

// Initialize event listeners
function initializeEventListeners(elements) {
  debugLog('Setting up event listeners...');
  
  elements.startCaptureBtn.addEventListener('click', startCapture);
  elements.stopCaptureBtn.addEventListener('click', stopCapture);
  
  elements.testConnectionBtn.addEventListener('click', async () => {
    elements.testConnectionBtn.textContent = 'Testing...';
    elements.testConnectionBtn.disabled = true;
    try {
      await new Promise(r => setTimeout(r, 500));
      elements.testConnectionBtn.textContent = 'Success';
    } catch {
      elements.testConnectionBtn.textContent = 'Failed';
    }
    setTimeout(() => {
      elements.testConnectionBtn.textContent = 'Test Connection';
      elements.testConnectionBtn.disabled = false;
    }, 1200);
  });

  // Listen for state updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    debugLog(`Received message: ${message.type}`, message);
    if (message.type === 'stateUpdate') {
      if (message.captureState) updateCaptureState(message.captureState);
      if (message.transcriptionState) updateTranscriptionState(message.transcriptionState);
      if (message.stats) updateStats(message.stats);
      if (message.lastUpdate) elements.lastUpdate.textContent = message.lastUpdate;
    }
  });

  debugLog('Event listeners initialized');
}

// State management
let captureStartTime = null;
let durationInterval = null;
let accumulatedDuration = 0;
let elements = null;

// Main initialization
document.addEventListener('DOMContentLoaded', async () => {
  debugLog('DOM Content Loaded - Starting initialization');
  
  try {
    // Initialize UI elements
    elements = initializeUI();
    
    // Load initial state
    const state = await initializePopup();
    
    // Update UI with initial state
    updateCaptureState(state.captureState);
    updateTranscriptionState(state.transcriptionState);
    updateStats(state.stats);
    elements.lastUpdate.textContent = state.lastUpdate;
    
    // Set up event listeners
    initializeEventListeners(elements);
    
    debugLog('Popup initialization complete');
  } catch (error) {
    console.error('Popup initialization failed:', error);
    document.body.innerHTML = `
      <div style="color: red; padding: 20px;">
        <h2>Error Initializing Popup</h2>
        <p>${error.message}</p>
        <p>Please check the console for more details.</p>
      </div>
    `;
  }
});

// UI Update Functions
function updateCaptureState(state) {
  debugLog(`Updating capture state to: ${state}`);
  elements.captureState.textContent = capitalize(state);
  if (state === 'active' || state === 'Active') {
    elements.startCaptureBtn.disabled = true;
    elements.stopCaptureBtn.disabled = false;
    startDurationTimer();
  } else {
    elements.startCaptureBtn.disabled = false;
    elements.stopCaptureBtn.disabled = true;
    stopDurationTimer();
  }
}

function updateTranscriptionState(state) {
  debugLog(`Updating transcription state to: ${state}`);
  elements.transcriptionState.textContent = capitalize(state);
}

function updateStats(stats) {
  debugLog('Updating stats:', stats);
  accumulatedDuration = stats.totalDuration || 0;
  elements.totalDuration.textContent = `${accumulatedDuration}s`;
  elements.totalTranscriptions.textContent = stats.totalTranscriptions || 0;
  elements.errorCount.textContent = stats.errorCount || 0;
}

// Timer Functions
function startDurationTimer() {
  if (durationInterval) return;
  captureStartTime = Date.now();
  durationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - captureStartTime) / 1000) + accumulatedDuration;
    elements.captureDuration.textContent = formatDuration(elapsed);
    elements.totalDuration.textContent = `${elapsed}s`;
  }, 1000);
  debugLog('Duration timer started');
}

function stopDurationTimer() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
    if (captureStartTime) {
      accumulatedDuration += Math.floor((Date.now() - captureStartTime) / 1000);
      captureStartTime = null;
    }
  }
  elements.captureDuration.textContent = '00:00';
  debugLog('Duration timer stopped');
}

// Utility Functions
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// Capture Control Functions
function startCapture() {
  debugLog('Starting capture...');
  chrome.runtime.sendMessage({ type: 'start-capture' }, (response) => {
    debugLog('Start capture response:', response);
    if (response?.status === 'started') {
      updateCaptureState('active');
      chrome.storage.local.set({ captureState: 'active' });
    }
  });
}

function stopCapture() {
  debugLog('Stopping capture...');
  chrome.runtime.sendMessage({ type: 'stop-capture' }, (response) => {
    debugLog('Stop capture response:', response);
    if (response?.status === 'stopped') {
      updateCaptureState('inactive');
      chrome.storage.local.set({ captureState: 'inactive' });
    }
  });
}