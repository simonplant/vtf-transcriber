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

let mediaRecorder;

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return false;
  }
  
  log('Received message:', message.type);

  switch (message.type) {
    case 'start-recording':
      isDebugMode = message.debugMode || false; // Set debug mode from message
      log('Received start-recording command. Debug mode is:', isDebugMode);
      startRecording(message.stream)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      break;
    case 'stop-recording':
      stopRecording();
      sendResponse({ success: true });
      break;
    default:
      log('Unknown message type received.');
      return false;
  }
  
  return true; // Indicates an async response
});

// --- Core Recording Logic ---

async function startRecording(stream) {
  if (mediaRecorder?.state === 'recording') {
    throw new Error('Recording is already in progress.');
  }

  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      log('Audio chunk available, sending to background.');
      chrome.runtime.sendMessage({ type: 'audio-blob', data: { blob: event.data } });
    }
  };

  mediaRecorder.onerror = (event) => {
    log('MediaRecorder error:', event.error.message);
    chrome.runtime.sendMessage({ type: 'recording-error', error: event.error.message });
  };
  
  mediaRecorder.onstop = () => {
    log('MediaRecorder stopped. Cleaning up stream.');
    try {
      stream.getTracks().forEach(track => track.stop());
    } catch(e) {
      log('Error stopping tracks:', e.message);
    }
    mediaRecorder = null;
  };
  
  // Chunk audio every 10 seconds
  mediaRecorder.start(10000);
  log('Recording started.');
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') {
    log('Stopping recording.');
    mediaRecorder.stop();
  } else {
    log('No active recording to stop.');
  }
}

log('Offscreen document loaded. Logging will be enabled by background script.'); 