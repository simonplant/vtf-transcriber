// offscreen.js

let mediaRecorder;
let recordingStream;

// Simple debug logging function
function debugLog(message) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({ debugMode: false }, (items) => {
            if (items.debugMode) {
                console.log('[VTF DEBUG]', message);
            }
        });
    }
}

// Log initialization
debugLog('Offscreen document initializing...');

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
    debugLog('Received message in offscreen:', message);
    if (message.type === 'start-recording') {
        await startRecording(message.streamId);
    } else if (message.type === 'stop-recording') {
        stopRecording();
    }
}

async function startRecording(streamId) {
    if (mediaRecorder?.state === 'recording') {
        debugLog('Recording is already in progress');
        return;
    }

    try {
        debugLog('Getting media stream with ID:', streamId);
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
        debugLog('Media stream obtained successfully');

        const options = { mimeType: 'audio/webm;codecs=opus' };
        mediaRecorder = new MediaRecorder(recordingStream, options);
        debugLog('MediaRecorder created with options:', options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                debugLog('Audio chunk available, size:', event.data.size);
                // Send the audio blob back to the service worker for transcription
                chrome.runtime.sendMessage({
                    type: 'audio-blob',
                    target: 'service-worker',
                    data: { blob: event.data }
                });
            }
        };

        mediaRecorder.onstop = () => {
            debugLog('MediaRecorder stopped, cleaning up');
            cleanup();
        };

        // Create a chunk every 5 seconds for faster transcription turnaround
        mediaRecorder.start(5000);
        debugLog('MediaRecorder started, creating chunks every 5 seconds');

    } catch (error) {
        debugLog('Error starting offscreen recording:', error);
    }
}

function stopRecording() {
    debugLog('Stopping recording');
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
    }
    cleanup();
}

function cleanup() {
    debugLog('Cleaning up media resources');
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    mediaRecorder = null;
}

// Log successful initialization
debugLog('Offscreen document initialized successfully'); 