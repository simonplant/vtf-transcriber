// offscreen.js

let mediaRecorder;
let recordingStream;
let isInitialized = false;

// Simple debug logging function
function debugLog(message, data = null) {
    chrome.storage.local.get({ debugMode: false }, (items) => {
        if (items.debugMode) {
            console.log('[VTF Offscreen]', message, data || '');
            // Send log to background script
            chrome.runtime.sendMessage({
                type: 'log',
                message: `[VTF Offscreen] ${message}`,
                data: data
            }).catch(() => {
                // Ignore errors if background script isn't ready
            });
        }
    });
}

// Initialize the offscreen document
async function initialize() {
    try {
        debugLog('Initializing offscreen document...');
        
        // Verify we have the necessary APIs
        if (!window.MediaRecorder) {
            throw new Error('MediaRecorder API not available');
        }
        
        // Test if we can create a MediaRecorder
        const testStream = new MediaStream();
        const testRecorder = new MediaRecorder(testStream);
        testRecorder.stop();
        testStream.getTracks().forEach(track => track.stop());
        
        isInitialized = true;
        debugLog('Offscreen document initialized successfully');
        
        // Notify background script of successful initialization
        chrome.runtime.sendMessage({
            type: 'offscreen-ready',
            status: 'initialized'
        }).catch(error => {
            debugLog('Failed to send ready message:', error);
        });
    } catch (error) {
        debugLog('Failed to initialize offscreen document:', error);
        // Notify background script of initialization failure
        chrome.runtime.sendMessage({
            type: 'offscreen-error',
            error: error.message
        }).catch(() => {
            // Ignore errors if background script isn't ready
        });
    }
}

// Handle messages from the background script
async function handleMessages(message, sender, sendResponse) {
    if (!isInitialized) {
        debugLog('Received message before initialization:', message);
        sendResponse({ status: 'error', error: 'Offscreen document not initialized' });
        return;
    }

    try {
        switch (message.type) {
            case 'start-recording':
                await startRecording(message.stream);
                sendResponse({ status: 'ok' });
                break;
            case 'stop-recording':
                stopRecording();
                sendResponse({ status: 'ok' });
                break;
            case 'check-status':
                sendResponse({ 
                    status: 'ok',
                    isInitialized,
                    isRecording: mediaRecorder?.state === 'recording'
                });
                break;
            default:
                debugLog('Unknown message type:', message.type);
                sendResponse({ status: 'error', error: 'Unknown message type' });
        }
    } catch (error) {
        debugLog('Error handling message:', error);
        sendResponse({ status: 'error', error: error.message });
    }
}

async function startRecording(stream) {
    if (mediaRecorder?.state === 'recording') {
        debugLog('Recording is already in progress');
        return;
    }

    try {
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
                debugLog('Audio chunk available:', { size: event.data.size });
                // Send the audio blob back to the service worker
                chrome.runtime.sendMessage({
                    type: 'audio-blob',
                    data: { 
                        blob: event.data,
                        timestamp: new Date().toISOString()
                    }
                }).catch(error => {
                    debugLog('Failed to send audio blob:', error);
                });
            }
        };

        mediaRecorder.onstop = () => {
            debugLog('MediaRecorder stopped, cleaning up');
            cleanup();
        };

        mediaRecorder.onerror = (event) => {
            debugLog('MediaRecorder error:', event.error);
            chrome.runtime.sendMessage({
                type: 'recording-error',
                error: event.error.message
            }).catch(error => {
                debugLog('Failed to send error message:', error);
            });
        };
        
        // Create a chunk every 10 seconds for better transcription
        mediaRecorder.start(10000);
        debugLog('Recording started with optimized settings');
    } catch (error) {
        debugLog('Error starting recording:', error);
        cleanup();
        throw error;
    }
}

function stopRecording() {
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
    }
    cleanup();
}

function cleanup() {
    if (mediaRecorder) {
        mediaRecorder = null;
    }
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
}

// Set up message listener
chrome.runtime.onMessage.addListener(handleMessages);

// Initialize when the document loads
document.addEventListener('DOMContentLoaded', initialize);

// Handle unload
window.addEventListener('unload', () => {
    debugLog('Offscreen document unloading');
    cleanup();
}); 