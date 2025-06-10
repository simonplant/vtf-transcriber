// offscreen.js

let mediaRecorder;
let recordingStream;

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
  if (message.target !== 'offscreen') {
    return;
  }
  switch (message.type) {
    case 'start-recording':
      await startRecording(message.streamId);
      break;
    case 'stop-recording':
      await stopRecording();
      break;
    default:
      console.warn(`Unexpected message received in offscreen document: ${message.type}`);
  }
}

async function startRecording(streamId) {
  if (mediaRecorder?.state === 'recording') {
    console.warn('Recording is already in progress.');
    return;
  }

  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    recordingStream = media;

    const options = { mimeType: 'audio/webm;codecs=opus' };
    mediaRecorder = new MediaRecorder(recordingStream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        // Send the audio blob back to the service worker for transcription
        chrome.runtime.sendMessage({
            type: 'audio-blob',
            target: 'service-worker',
            data: { blob: event.data }
        });
      }
    };

    mediaRecorder.onstop = cleanup;
    // Create a chunk every 5 seconds for faster transcription turnaround
    mediaRecorder.start(5000); 

    console.log('Offscreen recording started.');
  } catch (error) {
    console.error('Error starting offscreen recording:', error);
  }
}

async function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
  cleanup();
}

function cleanup() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  console.log('Offscreen resources cleaned up.');
} 