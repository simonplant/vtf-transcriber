// ===================================================================================
//
// VTF Audio Transcriber - Offscreen Document
//
// ===================================================================================

let isDebugMode = false;
const log = (...args) => {
  if (isDebugMode) {
    console.log('[VTF Offscreen]', ...args);
  }
};

let recorder;
const RECORDING_INTERVAL_MS = 10000; // 10 seconds

// --- Message Handling ---

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
  // Can't use log() here until we know the debug state from the message.
  if (message.target !== 'offscreen') {
    return;
  }

  isDebugMode = message.debugMode || false;
  log('Received message:', message.type);

  switch (message.type) {
    case 'start-recording':
      await startRecording(message.tabId);
      break;
    case 'stop-recording':
      stopRecording();
      break;
    default:
      log('Unknown message type received:', message.type);
  }
}

// --- Core Recording Logic ---

async function startRecording(tabId) {
  if (recorder?.state === 'recording') {
    log('Recording is already in progress.');
    return;
  }

  log('Starting recording for tab:', tabId);
  try {
    const stream = await chrome.tabCapture.capture({
      audio: true,
      video: false,
      targetTabId: tabId
    });

    // Get the audio track from the stream to ensure we're not holding onto the video track
    const audioStream = new MediaStream([stream.getAudioTracks()[0]]);

    recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = onDataAvailable;
    recorder.onstop = () => onStop(audioStream); // Pass stream to onStop for cleanup
    recorder.onerror = onError;
    recorder.start(RECORDING_INTERVAL_MS);
    log('Recorder started.');
  } catch(e) {
    log("Error starting recording:", e.message);
    // Send an error message back to the background script to update the state
    chrome.runtime.sendMessage({ type: 'recording-error', error: e.message });
  }
}

function stopRecording() {
  if (recorder?.state === 'recording') {
    recorder.stop(); // This will trigger the onstop event
    log('Recorder stop requested.');
  }
}

// --- MediaRecorder Event Handlers ---

function onDataAvailable(event) {
  if (event.data.size > 0) {
    log('Audio data received, sending to background script.');
    const blob = new Blob([event.data], { type: 'audio/webm' });
    chrome.runtime.sendMessage({ type: 'audio-blob', data: { blob } });
  }
}

function onError(event) {
  log('MediaRecorder error:', event.error.message);
  chrome.runtime.sendMessage({ type: 'recording-error', error: event.error.message });
}

function onStop(stream) {
  log('Recorder stopped. Cleaning up stream.');
  try {
    stream.getTracks().forEach(track => track.stop());
  } catch(e) {
    log('Error stopping tracks:', e.message);
  }
  recorder = null;
  // The offscreen document is closed by the background script.
}

log('Offscreen document loaded. Logging will be enabled by background script.'); 