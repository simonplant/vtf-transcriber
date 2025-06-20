/**
 * @file background.js
 * @path src/background.js
 * @description Service worker orchestrating audio processing, API calls, and state management.
 * @modified 2024-07-26
 * @requires storage.js
 * @requires api.js
 * @requires conversation.js
 */

import * as storage from './storage.js';
import { processAudioChunk } from './api.js';
import { ConversationProcessor } from './conversation.js';

// --- Global State ---
let state = {
    isCapturing: false,
    apiKey: null,
};

let conversationProcessor;


// --- Service Worker Lifecycle ---

chrome.runtime.onStartup.addListener(async () => {
    await initializeState();
    console.log('Browser startup: VTF Transcriber state initialized.');
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage();
    }
    await initializeState();
    console.log('Extension installed/updated: VTF Transcriber state initialized.');
});


/**
 * Initializes the in-memory state from chrome.storage.
 */
async function initializeState() {
    const persistedState = await storage.initState();
    state.isCapturing = persistedState.isCapturing;
    state.apiKey = persistedState.apiKey;
    
    // Initialize conversation processor with its persisted state
    conversationProcessor = new ConversationProcessor(persistedState.conversationProcessorState);
    
    console.log("VTF Transcriber state initialized from storage.");
}


// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    // Return true to indicate we will send a response asynchronously
    return true;
});

async function handleMessage(message, sender, sendResponse) {
    if (message.type === 'audioChunk') {
        if (state.isCapturing) {
            await handleAudioChunk(message.chunk, message.streamId);
        }
    } else if (message.type === 'startCapture') {
        await startCapture(message.apiKey);
        sendResponse({ status: 'capturing' });
    } else if (message.type === 'stopCapture') {
        await stopCapture();
        sendResponse({ status: 'stopped' });
    } else if (message.type === 'getStatus') {
        // This is now push-based, but we can send a one-off status if requested.
        sendStatus();
        sendResponse({ status: 'ok' }); // Acknowledge the request
    } else if (message.type === 'getTranscriptions') {
        const transcriptions = await storage.getTranscriptions();
        sendResponse({ transcriptions });
    } else if (message.type === 'clearData') {
        await clearAllData();
        sendResponse({ status: 'cleared' });
    } else if (message.type === 'getApiKey') {
        // Re-check storage in case it was updated in another context
        const key = await storage.getApiKey();
        state.apiKey = key;
        sendResponse({ apiKey: state.apiKey });
    } else if (message.type === 'getCapturingState') {
        sendResponse({ isCapturing: state.isCapturing });
    } else if (message.type === 'getMarkdown') {
        const transcriptions = await storage.getTranscriptions();
        const markdown = generateMarkdown(transcriptions, message.scope); // scope can be 'session' or 'daily'
        sendResponse({ markdown: markdown });
    }
}

function sendStatus() {
     const status = getStatusPayload();
     chrome.runtime.sendMessage({
        type: 'statusUpdate',
        status: status,
    }).catch(e => {}); // Ignore errors, popup may be closed
}

/**
 * Gathers the current status to be sent to the popup.
 * @returns {object}
 */
function getStatusPayload() {
    const conversationState = conversationProcessor.getState();
    const speakerBuffers = conversationState.speakerBuffers || {};
    
    return {
        isCapturing: state.isCapturing,
        transcriptionCount: conversationState.completedSegments.length,
        activeSpeakers: Object.keys(speakerBuffers).length,
        // Add other metrics as they are re-introduced
    };
}


// --- Audio Processing Functions ---

/**
 * A pipeline for processing raw audio data before sending to Whisper.
 * @param {Float32Array} data - The raw audio data.
 * @returns {Float32Array} - The processed audio data.
 */
function preprocessAudioForWhisper(data) {
    // For now, we only apply dynamic range compression as it's the most critical part.
    // Other filters like high-pass can be added back here if needed.
    return dynamicRangeCompression(data);
}

/**
 * Applies dynamic range compression to audio data.
 * Fixes stack overflow by using a loop for finding the max value.
 */
function dynamicRangeCompression(data, threshold = 0.3, ratio = 4, makeupGain = 1.5) {
    const compressed = new Float32Array(data.length);

    for (let i = 0; i < data.length; i++) {
        const sample = data[i];
        const abs = Math.abs(sample);

        if (abs > threshold) {
            const excess = abs - threshold;
            const compressedExcess = excess / ratio;
            const compressedAbs = threshold + compressedExcess;
            compressed[i] = Math.sign(sample) * compressedAbs * makeupGain;
        } else {
            compressed[i] = sample * makeupGain;
        }
    }

    // Prevent clipping using a loop to avoid stack overflow
    let maxVal = 0;
    for (let i = 0; i < compressed.length; i++) {
        const absVal = Math.abs(compressed[i]);
        if (absVal > maxVal) {
            maxVal = absVal;
        }
    }

    if (maxVal > 0.95) {
        const scale = 0.95 / maxVal;
        for (let i = 0; i < compressed.length; i++) {
            compressed[i] *= scale;
        }
    }

    return compressed;
}

/**
 * Sanitizes transcription text, especially for highly repetitive content.
 */
function postProcessTranscription(text) {
    if (!text) return text;

    // Check for excessive repetition
    const words = text.toLowerCase().match(/\b\w+\b/g);
    if (words && words.length > 10) {
        const wordCounts = {};
        words.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
        
        const mostFrequent = Object.entries(wordCounts).sort((a, b) => b[1] - a[1])[0];
        
        // If a single word makes up >70% of the text, it's likely an API error.
        if (mostFrequent && mostFrequent[1] / words.length > 0.7) {
            const repeatedWord = mostFrequent[0];
            // Return a sanitized, short version instead of the repetitive text.
            console.warn(`[Post-process] Sanitized highly repetitive text for word: "${repeatedWord}"`);
            return `${repeatedWord}, ${repeatedWord}, ${repeatedWord}.`;
        }
    }
    
    return text;
}


// --- Core Logic ---

async function startCapture(apiKey) {
    if (state.isCapturing) return;
    console.log('Starting capture...');
    state.isCapturing = true;
    state.apiKey = apiKey;
    await storage.setCapturingState(true);
    await storage.setApiKey(apiKey);
    
    // Notify UI
    sendStatus();

    // Notify content script to start
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'start_capture' }).catch(e => console.error("Failed to send start_capture to content script:", e));
    }
}

async function stopCapture() {
    if (!state.isCapturing) return;
    console.log('Stopping capture...');
    state.isCapturing = false;
    await storage.setCapturingState(false);
    
    // Notify UI
    sendStatus();

    // Notify content script to stop
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'stop_capture' }).catch(e => console.error("Failed to send stop_capture to content script:", e));
    }
}

async function handleAudioChunk(chunk, streamId) {
    const audioData = new Float32Array(Object.values(chunk));

    // 1. Pre-process the audio
    const processedAudio = preprocessAudioForWhisper(audioData);

    // 2. Send to API
    const transcriptionResult = await processAudioChunk(processedAudio, streamId);
    
    if (transcriptionResult && transcriptionResult.text) {
        // 3. Post-process the text
        const processedText = postProcessTranscription(transcriptionResult.text);

        const newTranscription = {
            timestamp: Date.now(),
            speaker: extractSpeakerName(streamId),
            text: processedText,
            duration: transcriptionResult.duration,
            streamId: streamId,
        };

        await storage.addTranscription(newTranscription);
        
        conversationProcessor.addTranscript(newTranscription);
        await storage.setConversationProcessorState(conversationProcessor.getState());

        sendStatus();
        sendTranscriptionsToPopup();
    }
}

async function sendTranscriptionsToPopup() {
    const transcriptions = await storage.getTranscriptions();
    chrome.runtime.sendMessage({
        type: 'transcriptionsUpdate',
        transcriptions: transcriptions,
    }).catch(e => {}); // Ignore errors
}

async function clearAllData() {
    console.log('Clearing all data...');
    await stopCapture();
    await storage.clearSession(); // This now clears conversation processor state too
    await storage.clearTranscriptions();
    conversationProcessor.clearOldSegments();
    await storage.setConversationProcessorState(conversationProcessor.getState()); // Persist cleared state
    sendStatus();
    sendTranscriptionsToPopup();
}

// --- Utility ---

/**
 * Generates markdown content from transcriptions.
 * @param {Array<object>} transcriptions - The list of transcriptions.
 * @param {string} scope - The scope of the export ('session' or 'daily').
 * @returns {string} - The generated markdown string.
 */
function generateMarkdown(transcriptions, scope = 'session') {
    const now = new Date();
    let title = "VTF Transcription Session";
    let content = transcriptions;

    if (scope === 'daily') {
        title = `VTF Trading Room - ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
        // Filter for today's transcripts if needed, though for now we assume all in storage are for the current session/day
    }
    
    if (content.length === 0) {
        return `# ${title}\n\n*No transcriptions recorded.*`;
    }

    let markdown = `# ${title}\n\n`;
    markdown += `**Date:** ${now.toLocaleString()}\n`;
    markdown += `**Total Transcripts:** ${content.length}\n\n---\n\n`;

    content.forEach(transcript => {
        const time = new Date(transcript.timestamp).toLocaleTimeString();
        markdown += `**${transcript.speaker}** *(${time})*: ${transcript.text}\n\n`;
    });

    return markdown;
}

function extractSpeakerName(streamId) {
    if (!streamId) return 'Unknown';
    if (streamId === 'local-stream') return 'Me';
    const parts = streamId.split('-');
    return parts.length > 3 ? parts.slice(3).join(' ') : streamId;
}

// Initialize state when the script first loads
initializeState();

// Also send status periodically to keep popup fresh if it's open
setInterval(() => {
    if (state.isCapturing) {
        sendStatus();
    }
}, 3000);