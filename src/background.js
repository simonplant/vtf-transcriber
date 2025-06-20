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
let currentConversation = null;
let isAudioWorkletRegistered = false;
const MAX_DEBUG_EVENTS = 50;
const debugEvents = [];

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

// Enhanced initialization with recovery capabilities
async function initializeState() {
    console.log('[Background] Service Worker starting - initializing state...');
    
    try {
        // Load state with retry logic
        const loadedState = await handleOperationWithRetry(async () => {
            return await storage.initState();
        });
        
        // Merge loaded state
        state = { ...state, ...loadedState };
        console.log('[Background] State loaded:', { 
            hasApiKey: !!state.apiKey, 
            isCapturing: state.isCapturing 
        });
        
        // Initialize conversation processor if we have an API key and were capturing
        if (state.apiKey && state.isCapturing) {
            console.log('[Background] Restoring conversation processor from previous session');
            conversationProcessor = new ConversationProcessor(state.apiKey, state.conversationProcessorState);
            
            // Start service worker optimizations
            startKeepAlive();
            startHealthCheck();
            
            // Attempt to reconnect to any active VTF tabs
            setTimeout(async () => {
                await attemptSystemRecovery();
            }, 2000); // Give tabs time to load
        }
        
    } catch (error) {
        console.error('[Background] Failed to initialize state:', error);
        // Continue with default state
        state.apiKey = null;
        state.isCapturing = false;
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
    
    // Update last activity timestamp
    state.lastActivity = Date.now();

    switch (message.type) {
        case 'audioData':
            handleAudioDataWithRetry(message, sendResponse);
            return true; // Async response

        case 'startCapture':
            handleStartCaptureWithRetry(message, sendResponse);
            return true; // Async response

        case 'stopCapture':
            handleStopCaptureWithRetry(sendResponse);
            return true; // Async response

        case 'setApiKey':
            handleSetApiKeyWithRetry(message, sendResponse);
            return true; // Async response

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
            handleClearDataWithRetry(sendResponse);
            return true; // Async response
            
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
            handleImportSessionDataWithRetry(message, sendResponse);
            return true; // Async response

        default:
            console.warn(`[Background] Unknown message type: ${message.type}`);
            sendResponse({ status: 'unknown_message_type' });
            return false;
    }
}

// --- Core Logic ---

/**
 * Logs a critical event for debugging purposes and stores it in a capped array.
 * @param {string} event - The name of the event.
 * @param {object} data - The data associated with the event.
 */
function logCriticalEvent(event, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[VTF] ${event}:`, data);
  debugEvents.push({ timestamp, event, data });
  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.shift(); // Keep the array size fixed
  }
}

async function startCapture(apiKey) {
    console.log('[Background] Starting capture session...');
    
    if (apiKey) {
        state.apiKey = apiKey;
        await storage.setApiKey(apiKey);
    }
    
    if (!state.apiKey) {
        throw new Error('No API key available');
    }
    
    // Create conversation processor
    conversationProcessor = new ConversationProcessor(state.apiKey);
    state.isCapturing = true;
    state.lastActivity = Date.now();
    state.reconnectAttempts = 0; // Reset reconnection attempts
    
    await updateState({ isCapturing: true });
    
    // Start service worker optimizations
    startKeepAlive();
    startHealthCheck();
    
    // Send start message to all VTF tabs
    const tabs = await chrome.tabs.query({ url: "*://vtf.t3live.com/*" });
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'start_capture' });
        } catch (error) {
            console.warn(`[Background] Could not send start message to tab ${tab.id}:`, error);
        }
    }
    
    console.log('[Background] Capture session started successfully');
}

async function stopCapture() {
    console.log('[Background] Stopping capture');
    
    // Stop service worker optimizations
    stopKeepAlive();
    stopHealthCheck();
    
    // Properly cleanup conversation processor to prevent memory leaks
    if (conversationProcessor) {
        conversationProcessor.destroy(); // Call the cleanup method we added
        conversationProcessor = null;
    }
    
    state.isCapturing = false;
    state.reconnectAttempts = 0;
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

// Automatic recovery system
async function attemptSystemRecovery() {
    console.log('[Background] Attempting system recovery...');
    
    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
        console.error('[Background] Max reconnection attempts reached, stopping capture');
        await stopCapture();
        notifyError('Transcription stopped due to connection issues. Please restart manually.');
        return false;
    }
    
    state.reconnectAttempts++;
    
    try {
        // Try to reinitialize the conversation processor
        if (!conversationProcessor && state.apiKey) {
            console.log('[Background] Reinitializing conversation processor');
            conversationProcessor = new ConversationProcessor(state.apiKey);
        }
        
        // Ping content scripts to check if they're responsive
        const tabs = await chrome.tabs.query({ url: "*://vtf.t3live.com/*" });
        let healthyTabs = 0;
        
        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, { type: 'health_check' });
                healthyTabs++;
            } catch (error) {
                console.warn(`[Background] Tab ${tab.id} not responsive, attempting recovery`);
                // Try to restart content script
                try {
                    await chrome.tabs.sendMessage(tab.id, { type: 'restart_capture' });
                } catch (restartError) {
                    console.error(`[Background] Failed to restart tab ${tab.id}:`, restartError);
                }
            }
        }
        
        if (healthyTabs > 0) {
            console.log(`[Background] System recovery successful, ${healthyTabs} tabs responsive`);
            state.reconnectAttempts = 0; // Reset counter on success
            state.lastActivity = Date.now();
            return true;
        } else {
            console.warn('[Background] No responsive tabs found during recovery');
            return false;
        }
        
    } catch (error) {
        console.error('[Background] System recovery failed:', error);
        return false;
    }
}

// Enhanced error handling with retry logic
async function handleOperationWithRetry(operation, maxRetries = 3, backoffMs = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            if (attempt > 1) {
                console.log(`[Background] Operation succeeded on attempt ${attempt}`);
            }
            return result;
        } catch (error) {
            lastError = error;
            console.warn(`[Background] Operation failed on attempt ${attempt}:`, error);
            
            if (attempt < maxRetries) {
                const delay = backoffMs * Math.pow(2, attempt - 1); // Exponential backoff
                console.log(`[Background] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

// Notification helper for user feedback
function notifyError(message) {
    chrome.runtime.sendMessage({
        type: 'error',
        message: message,
        recoverable: true
    }).catch(() => {});
}

function notifySuccess(message) {
    chrome.runtime.sendMessage({
        type: 'success',
        message: message
    }).catch(() => {});
}

// Retry-enabled message handlers
async function handleAudioDataWithRetry(message, sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            if (!state.apiKey) {
                throw new Error('No API key available for audio processing');
            }
            
            if (!conversationProcessor) {
                console.log('[Background] Creating new ConversationProcessor for audio processing');
                conversationProcessor = new ConversationProcessor(state.apiKey);
            }
            
            // Process audio asynchronously
            await conversationProcessor.processAudio(message.audioData, message.streamId, message.timestamp);
        });
        
        sendResponse({ status: 'received' });
    } catch (error) {
        console.error('[Background] Audio processing failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
    }
}

async function handleStartCaptureWithRetry(message, sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            await startCapture(message.apiKey);
        });
        
        sendResponse({ status: 'capturing' });
        notifySuccess('Transcription started successfully');
    } catch (error) {
        console.error('[Background] Start capture failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
        notifyError('Failed to start transcription. Please try again.');
    }
}

async function handleStopCaptureWithRetry(sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            await stopCapture();
        });
        
        sendResponse({ status: 'stopped' });
        notifySuccess('Transcription stopped');
    } catch (error) {
        console.error('[Background] Stop capture failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
    }
}

async function handleSetApiKeyWithRetry(message, sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            if (!message.apiKey) {
                throw new Error('No API key provided');
            }
            
            state.apiKey = message.apiKey;
            await storage.setApiKey(message.apiKey);
            console.log('[Background] API key updated from options page');
        });
        
        sendResponse({ status: 'updated' });
    } catch (error) {
        console.error('[Background] API key update failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
    }
}

async function handleClearDataWithRetry(sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            await clearAllData();
        });
        
        sendResponse({ status: 'cleared' });
        notifySuccess('All data cleared successfully');
    } catch (error) {
        console.error('[Background] Clear data failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
    }
}

async function handleImportSessionDataWithRetry(message, sendResponse) {
    try {
        await handleOperationWithRetry(async () => {
            if (!message.sessionData || !message.sessionData.transcriptions) {
                throw new Error('Invalid session data');
            }
            
            // Create or update conversation processor with imported data
            if (!conversationProcessor) {
                conversationProcessor = new ConversationProcessor(state.apiKey);
            }
            
            // Set the imported segments
            conversationProcessor.completedSegments = message.sessionData.transcriptions;
            conversationProcessor.sessionCost = message.sessionData.sessionCost || 0;
            conversationProcessor.totalProcessedDuration = message.sessionData.totalDuration || 0;
            
            // Save to storage
            await storage.setConversationProcessorState(conversationProcessor.getState());
            console.log(`[Background] Imported ${message.sessionData.transcriptions.length} transcriptions`);
        });
        
        sendResponse({ status: 'imported', count: message.sessionData.transcriptions.length });
        notifySuccess(`Imported ${message.sessionData.transcriptions.length} transcriptions`);
    } catch (error) {
        console.error('[Background] Import session failed after retries:', error);
        sendResponse({ status: 'error', message: error.message });
        notifyError('Failed to import session data');
    }
}