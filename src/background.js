/**
 * @file background.js
 * @path src/background.js
 * @description Service worker for VTF Audio Transcriber with optimized lifecycle management
 * @modified 2025-06-20
 * @requires storage.js
 * @requires conversation.js
 */

import * as storage from './storage.js';
import { ConversationProcessor } from './conversation.js';

// Service worker optimization - Enhanced state management
let state = {
    apiKey: null,
    isCapturing: false,
    lastActivity: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3
};

let conversationProcessor = null;
let keepAliveTimer = null;
let healthCheckInterval = null;

// Service worker lifecycle optimization
const KEEP_ALIVE_INTERVAL = 25000; // 25 seconds (Chrome limit is 30s)
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const MAX_IDLE_TIME = 300000; // 5 minutes

// Keep service worker alive during active sessions
function startKeepAlive() {
    if (keepAliveTimer) return;
    
    keepAliveTimer = setInterval(() => {
        // Ping to keep service worker alive during transcription
        if (state.isCapturing) {
            console.log('[Background] Service worker keep-alive ping');
            chrome.runtime.getPlatformInfo().then(() => {
                // This API call keeps the service worker active
            }).catch(() => {});
        }
    }, KEEP_ALIVE_INTERVAL);
}

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

// Health check system for automatic recovery
function startHealthCheck() {
    if (healthCheckInterval) return;
    
    healthCheckInterval = setInterval(async () => {
        try {
            // Check if conversation processor is healthy
            if (conversationProcessor && state.isCapturing) {
                const now = Date.now();
                if (state.lastActivity && (now - state.lastActivity) > MAX_IDLE_TIME) {
                    console.log('[Background] No activity detected, checking system health');
                    await attemptSystemRecovery();
                }
            }
        } catch (error) {
            console.error('[Background] Health check failed:', error);
            await attemptSystemRecovery();
        }
    }, HEALTH_CHECK_INTERVAL);
}

function stopHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// --- Global State ---

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

async function initializeState() {
    const persistedState = await storage.initState();
    console.log('[Background] Loaded persisted state:', persistedState);
    
    state.isCapturing = persistedState.isCapturing;
    state.apiKey = persistedState.apiKey;
    
    console.log('[Background] Initialized state:', { 
        isCapturing: state.isCapturing, 
        hasApiKey: !!state.apiKey,
        apiKeyLength: state.apiKey ? state.apiKey.length : 0
    });
    
    // If API key is missing, try to load it directly
    if (!state.apiKey) {
        console.log('[Background] API key missing, attempting direct load...');
        const directApiKey = await storage.getApiKey();
        console.log('[Background] Direct API key load result:', { hasKey: !!directApiKey, keyLength: directApiKey ? directApiKey.length : 0 });
        if (directApiKey) {
            state.apiKey = directApiKey;
        }
    }
    
    if (state.isCapturing && state.apiKey) {
        // If we were in the middle of capturing, resume the session
        conversationProcessor = new ConversationProcessor(state.apiKey, persistedState.conversationProcessorState);
        console.log("VTF Transcriber session resumed from storage.");
    } else {
        // Otherwise, ensure capturing is marked as false
        state.isCapturing = false;
        await storage.setCapturingState(false);
        console.log("VTF Transcriber state initialized. Not currently capturing.");
    }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Return true to indicate we will send a response asynchronously
    const isAsync = handleMessage(message, sender, sendResponse);
    return isAsync;
});

function handleMessage(message, sender, sendResponse) {
    console.log(`[Background] Received message: type=${message.type}`, message);

    switch (message.type) {
        case 'audioData':
            if (!state.apiKey) {
                console.error('[Background] No API key available for audio processing');
                sendResponse({ status: 'error', message: 'No API key available' });
                return false;
            }
            
            if (!conversationProcessor) {
                console.log('[Background] Creating new ConversationProcessor for audio processing');
                conversationProcessor = new ConversationProcessor(state.apiKey);
            }
            
            // Process audio asynchronously but don't wait for it
            conversationProcessor.processAudio(message.audioData, message.streamId, message.timestamp)
                .catch(error => console.error('[Background] Error processing audio:', error));
            sendResponse({ status: 'received' });
            return false;

        case 'startCapture':
            startCapture(message.apiKey).then(() => sendResponse({ status: 'capturing' }));
            return true;

        case 'stopCapture':
            stopCapture().then(() => sendResponse({ status: 'stopped' }));
            return true;

        case 'setApiKey':
            // Handle API key updates from options page
            if (message.apiKey) {
                state.apiKey = message.apiKey;
                storage.setApiKey(message.apiKey).then(() => {
                    console.log('[Background] API key updated from options page');
                    sendResponse({ status: 'updated' });
                }).catch(error => {
                    console.error('[Background] Failed to save API key:', error);
                    sendResponse({ status: 'error', message: error.message });
                });
            } else {
                sendResponse({ status: 'error', message: 'No API key provided' });
            }
            return true;

        case 'getStatus':
            if (conversationProcessor) {
                // Only send status update, don't force UI update that might send empty segments
                const status = {
                    isCapturing: true,
                    transcriptionCount: conversationProcessor.completedSegments.length,
                    activeSpeakers: conversationProcessor.speakerBuffers.size,
                    sessionCost: conversationProcessor.sessionCost,
                };
                chrome.runtime.sendMessage({
                    type: 'statusUpdate',
                    status: status
                }).catch(e => {}); // Ignore errors if popup is closed
            }
            sendResponse({ status: 'ok' });
            return false;

        case 'clearData':
            clearAllData().then(() => sendResponse({ status: 'cleared' }));
            return true;
            
        case 'getTranscriptions':
            // Get transcriptions from conversation processor
            if (conversationProcessor && conversationProcessor.completedSegments.length > 0) {
                sendResponse({ transcriptions: conversationProcessor.completedSegments });
            } else {
                sendResponse({ transcriptions: [] });
            }
            return false;
            
        case 'getMarkdown':
            // Generate markdown export
            if (conversationProcessor && conversationProcessor.completedSegments.length > 0) {
                const markdown = generateMarkdown(conversationProcessor.completedSegments, message.scope || 'session');
                sendResponse({ markdown: markdown });
            } else {
                sendResponse({ markdown: null });
            }
            return false;
            
        case 'exportSessionData':
            // Export session data for backup
            if (conversationProcessor && conversationProcessor.completedSegments.length > 0) {
                const sessionData = {
                    transcriptions: conversationProcessor.completedSegments,
                    sessionCost: conversationProcessor.sessionCost,
                    totalDuration: conversationProcessor.totalProcessedDuration,
                    exportDate: new Date().toISOString(),
                    version: '1.0'
                };
                sendResponse({ sessionData: sessionData });
            } else {
                sendResponse({ sessionData: null });
            }
            return false;
            
        case 'importSessionData':
            // Import session data for restore
            if (message.sessionData && message.sessionData.transcriptions) {
                // Create or update conversation processor with imported data
                if (!conversationProcessor) {
                    conversationProcessor = new ConversationProcessor(state.apiKey);
                }
                
                // Set the imported segments
                conversationProcessor.completedSegments = message.sessionData.transcriptions;
                conversationProcessor.sessionCost = message.sessionData.sessionCost || 0;
                conversationProcessor.totalProcessedDuration = message.sessionData.totalDuration || 0;
                
                // Save to storage
                storage.setConversationProcessorState(conversationProcessor.getState()).then(() => {
                    console.log(`[Background] Imported ${message.sessionData.transcriptions.length} transcriptions`);
                    sendResponse({ status: 'imported', count: message.sessionData.transcriptions.length });
                }).catch(error => {
                    console.error('[Background] Failed to save imported session:', error);
                    sendResponse({ status: 'error', message: 'Failed to save imported data' });
                });
            } else {
                sendResponse({ status: 'error', message: 'Invalid session data' });
            }
            return true;
            
        default:
            // Handle other synchronous messages if any, or just log them
            console.warn(`[Background] Unhandled message type: ${message.type}`);
            return false;
    }
}

// --- Core Logic ---

async function startCapture(apiKey) {
    if (state.isCapturing) return;
    
    console.log('Starting capture session...');
    state.isCapturing = true;
    state.apiKey = apiKey;
    
    // Create a new processor for the new session
    conversationProcessor = new ConversationProcessor(apiKey);
    
    await storage.setApiKey(apiKey);
    await storage.setCapturingState(true);
    await storage.setConversationProcessorState(conversationProcessor.getState()); // Save initial state
    
    if (conversationProcessor) conversationProcessor.updateUIs();
    
    // Notify content script to start (if needed)
    // This might not be necessary if content script is always listening
}

async function stopCapture() {
    console.log('[Background] Stopping capture');
    
    // Properly cleanup conversation processor to prevent memory leaks
    if (conversationProcessor) {
        conversationProcessor.destroy(); // Call the cleanup method we added
        conversationProcessor = null;
    }
    
    state.isCapturing = false;
    await updateState({ isCapturing: false });
    
    // Send stop message to all tabs
    const tabs = await chrome.tabs.query({ url: "*://vtf.t3live.com/*" });
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'stop_capture' });
        } catch (error) {
            console.warn(`[Background] Could not send stop message to tab ${tab.id}:`, error);
        }
    }
}

async function clearAllData() {
    console.log('Clearing all data...');
    await stopCapture();
    await storage.clearAll();
    // Re-initialize to a clean state
    if (conversationProcessor) {
        conversationProcessor.updateUIs(); // Update UI to reflect cleared state
    }
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

// Note: Status updates are now handled by ConversationProcessor.updateUIs() 
// when new transcriptions are processed, so no periodic updates are needed.