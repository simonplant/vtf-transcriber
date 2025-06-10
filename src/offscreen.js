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
    // No target check needed here; background script is the only sender.
    switch (message.type) {
        case 'start-recording':
            await startRecording(message.streamId);
            break;
        case 'stop-recording':
            stopRecording();
            break;
    }
}

async function startRecording(streamId) {
    if (mediaRecorder?.state === 'recording') {
        console.warn('Recording is already in progress.');
        return;
    }

    try {
        // Use chrome.tabCapture.capture to get the audio stream
        const stream = await new Promise((resolve, reject) => {
            chrome.tabCapture.capture({
                audio: true,
                video: false,
                audioConstraints: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                }
            }, (stream) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(stream);
                }
            });
        });

        recordingStream = stream;
        
        // Configure MediaRecorder with optimal settings for Whisper API
        const options = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 64000, // 64kbps for mono Opus (optimal for Whisper)
            sampleRate: 48000 // 48kHz is the default and ideal for Opus
        };
        
        mediaRecorder = new MediaRecorder(recordingStream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                // Send the audio blob back to the service worker.
                chrome.runtime.sendMessage({
                    type: 'audio-blob',
                    data: { 
                        blob: event.data,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        };

        mediaRecorder.onstop = () => {
            console.log("MediaRecorder stopped, cleaning up.");
            cleanup();
        };
        
        // Create a chunk every 10 seconds for better transcription
        mediaRecorder.start(10000); 
        console.log('Offscreen recording started with optimized settings.');

    } catch (error) {
        console.error('Error starting offscreen recording:', error);
        // Notify the background script of the error
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: error.message
        });
    }
}

function stopRecording() {
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
    }
    // The 'onstop' event listener will handle cleanup.
}

function cleanup() {
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    mediaRecorder = null;
    console.log('Offscreen resources cleaned up.');
}

// Log successful initialization
debugLog('Offscreen document initialized successfully'); 