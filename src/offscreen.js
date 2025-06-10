// ===================================================================================
//
// VTF Audio Transcriber - Offscreen Document (Final Architecture)
//
// ===================================================================================

let mediaRecorder;
let stream;
let isDebugMode = false;
const log = (...args) => isDebugMode && console.log('[VTF Offscreen]', ...args);

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'start-recording') {
    isDebugMode = message.data.debugMode;
    log('Received start-recording command with streamId:', message.data.streamId);
    if (mediaRecorder?.state === 'recording') {
      log('Recorder is already active. Ignoring.');
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: message.data.streamId,
          },
        },
      });

      stream = media;
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      // *** THIS IS THE FIX ***
      // Instead of sending the raw blob object, we encode it as a base64 data URL string.
      // This is a robust way to send binary data through Chrome's messaging system.
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onload = () => {
            // reader.result contains the data URL.
            chrome.runtime.sendMessage({ type: 'audio-blob', data: { dataUrl: reader.result } });
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        log('Recorder stopped. Cleaning up and closing document.');
        stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
        stream = null;
        window.close();
      };

      mediaRecorder.start(10000);
      log('Recording started successfully.');
    } catch (error) {
      log('Error starting recording in offscreen document:', error.message);
      chrome.runtime.sendMessage({ type: 'recording-error', error: error.message });
    }

  } else if (message.type === 'stop-recording') {
    log('Received stop-recording command.');
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
    } else {
      log('No active recorder to stop, closing window.');
      window.close();
    }
  }
});
