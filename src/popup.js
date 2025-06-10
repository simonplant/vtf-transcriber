// ===================================================================================
//
// VTF Audio Transcriber - Popup UI Logic
//
// ===================================================================================
const UIElements = {
  startBtn: document.getElementById('startCaptureBtn'),
  stopBtn: document.getElementById('stopCaptureBtn'),
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.getElementById('statusText'),
  transcriptionStatusIndicator: document.getElementById('transcriptionStatusIndicator'),
  transcriptionStatusText: document.getElementById('transcriptionStatusText'),
  transcriptionLog: document.getElementById('transcriptionLog'),
  totalDuration: document.getElementById('totalDuration'),
  totalTranscriptions: document.getElementById('totalTranscriptions'),
  errorCount: document.getElementById('errorCount')
};

let isDebugMode = false;
const log = (...args) => isDebugMode && console.log('[VTF Popup]', ...args);

function render(state) {
  if (!state) return;
  isDebugMode = state.debugMode || false;
  log('Rendering UI with new state:', state);

  const isCapturing = state.captureState === 'active';
  UIElements.startBtn.disabled = isCapturing;
  UIElements.stopBtn.disabled = !isCapturing;

  UIElements.statusIndicator.className = 'status-indicator';
  if (state.captureState === 'active') UIElements.statusIndicator.classList.add('active');
  if (state.captureState === 'error') UIElements.statusIndicator.classList.add('error');
  UIElements.statusText.textContent = state.captureState.charAt(0).toUpperCase() + state.captureState.slice(1);

  UIElements.transcriptionStatusIndicator.className = 'status-indicator';
  if (state.transcriptionState === 'transcribing') UIElements.transcriptionStatusIndicator.classList.add('active');
  if (state.transcriptionState === 'error') UIElements.transcriptionStatusIndicator.classList.add('error');
  UIElements.transcriptionStatusText.textContent = state.transcriptionState.charAt(0).toUpperCase() + state.transcriptionState.slice(1);

  UIElements.transcriptionLog.innerHTML = '';
  if (state.transcriptionLog?.length > 0) {
    state.transcriptionLog.forEach(msg => {
      if(!msg?.speaker || !msg.text) return;
      const messageEl = document.createElement('div');
      messageEl.className = `chat-message ${msg.speaker.toLowerCase()}`;
      messageEl.innerHTML = `<span class="speaker">${msg.speaker}</span><span class="text">${msg.text}</span>`;
      UIElements.transcriptionLog.appendChild(messageEl);
    });
  } else {
    UIElements.transcriptionLog.innerHTML = `<div class="chat-message system"><span>Waiting for transcription...</span></div>`;
  }
  UIElements.transcriptionLog.scrollTop = UIElements.transcriptionLog.scrollHeight;

  if (state.stats) {
    UIElements.totalDuration.textContent = formatDuration(state.stats.totalDuration || 0);
    UIElements.totalTranscriptions.textContent = state.stats.totalTranscriptions || 0;
    UIElements.errorCount.textContent = state.stats.errorCount || 0;
  }
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

UIElements.startBtn.onclick = () => chrome.runtime.sendMessage({ type: 'start-capture' });
UIElements.stopBtn.onclick = () => chrome.runtime.sendMessage({ type: 'stop-capture' });

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stateUpdate') render(message.data);
});

// Initial render
chrome.runtime.sendMessage({ type: 'get-status' }, (initialState) => {
    if (chrome.runtime.lastError) {
        console.error("Could not get initial state:", chrome.runtime.lastError.message);
        document.body.innerHTML = "Error loading extension. Please reload.";
        return;
    }
    render(initialState);
});
