// background.js - VTF Audio Transcription Extension
// FIXED VERSION - Resolves processing delays and missing audio

// Configuration - SIMPLIFIED AND PROVEN TO WORK
const CONFIG = {
  SAMPLE_RATE: 16000,
  // Adaptive chunking settings
  CHUNK_DURATION_ACTIVE: 5,   // seconds when room is busy
  CHUNK_DURATION_IDLE: 7,    // seconds when only one speaker
  MIN_CHUNK_SIZE: 1,
  MAX_CHUNK_SIZE: 15,        // hard-cap per chunk
  SILENCE_THRESHOLD: 0.0003, // more sensitive silence detection
  SILENCE_TIMEOUT: 2500,
  // Speaker merging settings
  SPEAKER_MERGE_WINDOW: 5000,
  ACTIVITY_WINDOW: 5000,
  ACTIVITY_THRESHOLD: 2,
  // Processing settings
  MAX_CONCURRENT_PROCESSING: 4,
  // Minimum seconds to collect before sending the very first chunk for a speaker
  STARTUP_MIN_DURATION: 2,
  // Watchdog settings
  STALL_IDLE_THRESHOLD: 3000,   // ms of inactivity before forcing flush
  STALL_MIN_DURATION: 1         // s – only flush if we have at least this much audio
};

// Store audio chunks and transcriptions
let audioChunks = [];
let isCapturing = false;
let transcriptions = [];
let apiKey = null;

// Enhanced buffering state
const speakerBuffers = new Map(); 
let lastProcessTime = Date.now();
let silenceTimers = new Map();    
let recentActivity = [];          
let processingQueue = new Set();
let lastTranscripts = new Map();  

const speakerAliasMap = new Map();

// Simple log helper – switch between 'debug', 'info', 'silent'
const LOG = { level: 'info' };
function dbg(...msg){ if (LOG.level==='debug') console.log(...msg); }
function info(...msg){ if (LOG.level!=='silent') console.log(...msg); }

// Load API key on startup
chrome.storage.local.get(['openaiApiKey'], (result) => {
  if (result.openaiApiKey) {
    apiKey = result.openaiApiKey;
    console.log('[VTF Background] API key loaded successfully');
  } else {
    console.warn('[VTF Background] No API key found in storage');
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    dbg('[VTF Background] Received message:', {
      type: request.type,
      dataLength: request.audioData?.length,
      timestamp: new Date().toISOString()
    });
    
    if (request.type === 'audioData') {
      if (!isCapturing) {
        dbg('[VTF Background] Ignoring audioData: capture is stopped');
        sendResponse({ received: true, ignored: true });
        return true;
      }

      // Handle audio data with speaker-aware buffering
      if (request.audioData && request.audioData.length > 0) {
        const streamId = request.streamId || 'unknown';
        console.log(`[VTF Background] Processing audio chunk: ${request.audioData.length} samples from stream ${streamId}`);
        
        // Initialize speaker buffer if needed
        if (!speakerBuffers.has(streamId)) {
          speakerBuffers.set(streamId, {
            buffer: [],
            lastActivityTime: Date.now(),
            pendingTranscripts: [],
            processedOnce: false
          });
        }
        
        // Add to speaker-specific buffer
        const speakerData = speakerBuffers.get(streamId);
        speakerData.buffer.push(...request.audioData);
        speakerData.lastActivityTime = Date.now();
        
        // Track recent activity for adaptive chunking
        trackSpeechActivity(streamId);
        
        // Store the chunk metadata
        audioChunks.push({
          data: request.audioData,
          timestamp: request.timestamp,
          streamId: streamId
        });
        
        // Send visual feedback to popup
        updateBufferStatus();
        
        // Check if we should process this speaker's buffer
        checkAndProcessSpeakerBuffer(streamId);
      } else {
        console.warn('[VTF Background] Received empty audio data');
      }
      
      // CRITICAL: Send response to prevent "message channel closed" error
      sendResponse({ received: true, status: 'success', timestamp: Date.now() });
      return true;
    }
    
    if (request.type === 'startCapture') {
      isCapturing = true;
      audioChunks = []; 
      speakerBuffers.clear(); 
      transcriptions = []; 
      recentActivity = []; 
      processingQueue.clear();
      console.log('[VTF Background] Started audio capture');
      sendResponse({ status: 'started' });
      updateBufferStatus();
      return true;
    }
    
    if (request.type === 'stopCapture') {
      isCapturing = false;
      // Process any remaining audio in all speaker buffers
      speakerBuffers.forEach((data, streamId) => {
        if (data.buffer.length > CONFIG.SAMPLE_RATE * 0.3) {
          processSpeakerBuffer(streamId, 'final');
        }
      });
      console.log('[VTF Background] Stopped audio capture');
      sendResponse({ status: 'stopped' });
      updateBufferStatus();
      return true;
    }
    
    if (request.type === 'getStatus') {
      const totalBufferSize = Array.from(speakerBuffers.values())
        .reduce((sum, data) => sum + data.buffer.length, 0);
      
      const status = {
        isCapturing, 
        chunksReceived: audioChunks.length,
        transcriptionCount: transcriptions.length,
        hasApiKey: !!apiKey,
        bufferSize: totalBufferSize,
        bufferDuration: (totalBufferSize / CONFIG.SAMPLE_RATE).toFixed(2),
        activeSpeakers: speakerBuffers.size,
        isProcessing: processingQueue.size > 0,
        speechActivity: getActivityLevel()
      };
      console.log('[VTF Background] Status request:', status);
      sendResponse(status);
      return true;
    }
    
    if (request.type === 'getTranscriptions') {
      console.log('[VTF Background] Sending transcriptions:', transcriptions.length);
      sendResponse({ transcriptions });
      return true;
    }
    
    if (request.type === 'setApiKey') {
      console.log('[VTF Background] Received setApiKey request');
      apiKey = request.apiKey;
      chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
        if (chrome.runtime.lastError) {
          console.error('[VTF Background] Error saving API key:', chrome.runtime.lastError);
          sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        } else {
          console.log('[VTF Background] API key saved successfully');
          sendResponse({ status: 'saved' });
        }
      });
      return true;
    }
    
    // Default response for unknown message types
    console.warn('[VTF Background] Unknown message type:', request.type);
    sendResponse({ received: true, error: 'Unknown message type' });
    return true;
    
  } catch (error) {
    console.error('[VTF Background] Error in message handler:', error);
    sendResponse({ error: error.message });
    return true;
  }
});

// Track speech activity for adaptive chunking
function trackSpeechActivity(streamId) {
  const now = Date.now();
  recentActivity.push({ streamId, timestamp: now });
  
  // Remove old activity records
  recentActivity = recentActivity.filter(
    activity => now - activity.timestamp < CONFIG.ACTIVITY_WINDOW
  );
  
  // Reset startup flag if speaker was silent for a while
  const data = speakerBuffers.get(streamId);
  if (data && data.processedOnce && now - data.lastActivityTime > CONFIG.SILENCE_TIMEOUT) {
    data.processedOnce = false;
  }
}

// Get current speech activity level
function getActivityLevel() {
  const uniqueSpeakers = new Set(recentActivity.map(a => a.streamId));
  const activityScore = recentActivity.length;
  
  if (activityScore >= CONFIG.ACTIVITY_THRESHOLD || uniqueSpeakers.size > 1) {
    return 'high';
  } else if (activityScore > 0) {
    return 'low';
  }
  return 'none';
}

// Get adaptive chunk duration based on activity
function getAdaptiveChunkDuration() {
  const activityLevel = getActivityLevel();
  
  switch (activityLevel) {
    case 'high':
      return CONFIG.CHUNK_DURATION_ACTIVE;
    case 'low':
      return (CONFIG.CHUNK_DURATION_ACTIVE + CONFIG.CHUNK_DURATION_IDLE) / 2;
    default:
      return CONFIG.CHUNK_DURATION_IDLE;
  }
}

// Check if we should process a specific speaker's buffer
function checkAndProcessSpeakerBuffer(streamId) {
  const speakerData = speakerBuffers.get(streamId);
  if (!speakerData) return;
  
  const bufferDuration = speakerData.buffer.length / CONFIG.SAMPLE_RATE;
  
  // For the very first chunk from this speaker, ensure we have at least STARTUP_MIN_DURATION seconds
  if (!speakerData.processedOnce && bufferDuration < CONFIG.STARTUP_MIN_DURATION) {
    // wait a little longer
    setTimeout(() => checkAndProcessSpeakerBuffer(streamId), 300);
    return;
  }
  
  const timeSinceLastProcess = Date.now() - lastProcessTime;
  const adaptiveChunkDuration = getAdaptiveChunkDuration();
  
  // Clear existing silence timer for this speaker
  if (silenceTimers.has(streamId)) {
    clearTimeout(silenceTimers.get(streamId));
  }
  
  console.log(`[VTF Background] Speaker ${streamId}: buffer=${bufferDuration.toFixed(2)}s, chunk=${adaptiveChunkDuration}s`);
  
  // Process if we have enough audio based on adaptive duration
  if (bufferDuration >= adaptiveChunkDuration) {
    processSpeakerBuffer(streamId, 'chunk-ready');
  } 
  // Or if we have minimum audio and it's been a while
  else if (bufferDuration >= CONFIG.MIN_CHUNK_SIZE && timeSinceLastProcess > 5000) {
    processSpeakerBuffer(streamId, 'timeout');
  }
  // Otherwise, set a timer to process on silence
  else if (bufferDuration > 0) {
    const timer = setTimeout(() => {
      const data = speakerBuffers.get(streamId);
      if (data && data.buffer.length > 0) {
        console.log(`[VTF Background] Processing ${streamId} buffer due to silence (leftover ${(data.buffer.length / CONFIG.SAMPLE_RATE).toFixed(2)}s)`);
        processSpeakerBuffer(streamId, 'silence');
      }
    }, CONFIG.SILENCE_TIMEOUT);
    
    silenceTimers.set(streamId, timer);
  }
}

// Process a specific speaker's buffer
async function processSpeakerBuffer(streamId, reason) {
  const speakerData = speakerBuffers.get(streamId);
  if (!speakerData || speakerData.buffer.length === 0) return;
  
  // Check if already processing this speaker
  if (processingQueue.has(streamId)) {
    console.log(`[VTF Background] Already processing ${streamId}, queuing for later`);
    setTimeout(() => checkAndProcessSpeakerBuffer(streamId), 500);
    return;
  }
  
  // Check if we've hit max concurrent processing
  if (processingQueue.size >= CONFIG.MAX_CONCURRENT_PROCESSING) {
    console.log(`[VTF Background] Max concurrent processing reached, queuing ${streamId}`);
    setTimeout(() => checkAndProcessSpeakerBuffer(streamId), 1000);
    return;
  }
  
  processingQueue.add(streamId);
  updateBufferStatus();
  
  // Get chunk from buffer – size adapts to current activity but obeys hard cap
  const targetDuration = Math.min(getAdaptiveChunkDuration(), CONFIG.MAX_CHUNK_SIZE);
  const targetSamples = targetDuration * CONFIG.SAMPLE_RATE;
  const chunk = speakerData.buffer.slice(0, Math.min(speakerData.buffer.length, targetSamples));
  
  // Remove processed samples from buffer
  speakerData.buffer = speakerData.buffer.slice(chunk.length);
  
  // mark that we have processed at least once
  speakerData.processedOnce = true;
  
  console.log(`[VTF Background] Processing ${streamId} buffer: ${chunk.length} samples (${(chunk.length / CONFIG.SAMPLE_RATE).toFixed(2)}s), reason: ${reason}`);
  
  // Analyse audio energy
  const absVals = chunk.map(Math.abs);
  const maxSample = absVals.reduce((m, x) => (x > m ? x : m), 0);
  const avgSample = absVals.reduce((s, x) => s + x, 0) / absVals.length;
  
  // adaptive silence gate: allow quieter chunks as long as average energy is present
  const maxGate = 0.0001; // very low peak allowed
  const avgGate = 0.00002; // very low RMS allowed
  
  if (maxSample < maxGate && avgSample < avgGate) {
    console.log(`[VTF Background] ${streamId} chunk below energy threshold (max=${maxSample.toFixed(6)}, avg=${avgSample.toFixed(6)}), skipping`);
    processingQueue.delete(streamId);
    updateBufferStatus();
    if (speakerData.buffer.length > CONFIG.SAMPLE_RATE * CONFIG.MIN_CHUNK_SIZE) {
      setTimeout(() => checkAndProcessSpeakerBuffer(streamId), 100);
    }
    return;
  }
  
  // Normalise chunk so Whisper sees a consistent level
  const gain = 1 / (maxSample || 1);
  const normalised = chunk.map(v => Math.max(-1, Math.min(1, v * gain)));
  
  // Extract speaker name from streamId
  const speakerName = extractSpeakerName(streamId);
  
  // Log buffer details before sending to Whisper
  console.log(`[VTF Background] Sending to Whisper: ${(chunk.length / CONFIG.SAMPLE_RATE).toFixed(2)}s from ${speakerName} (${streamId})`);
  
  lastProcessTime = Date.now();
  
  try {
    // Process with Whisper API
    const result = await processAudioChunk(new Float32Array(normalised), Date.now(), streamId);
    
    if (result && result.text) {
      // Add speaker name to result
      result.speaker = speakerName;
      console.log(`[VTF Background] Transcription successful for ${speakerName}:`, result.text);
      
      // Check if we should merge with previous transcript from same speaker
      const shouldMerge = checkShouldMergeTranscript(streamId, result);
      
      if (shouldMerge) {
        mergeTranscript(streamId, result);
      } else {
        // Add as new transcript
        transcriptions.push(result);
        speakerData.pendingTranscripts = [result];
      }
      
      // Send transcription to content script
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes('vtf.t3live.com')) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'newTranscription',
              transcription: result,
              merged: shouldMerge
            }, response => {
              // Handle response or error silently
              if (chrome.runtime.lastError) {
                console.log('[VTF Background] Content script not ready:', chrome.runtime.lastError.message);
              }
            });
          }
        });
      });
    }
    
  } catch (error) {
    console.error(`[VTF Background] Processing error for ${speakerName}:`, error);
  } finally {
    processingQueue.delete(streamId);
    updateBufferStatus();
    
    // Check if this speaker has more audio to process
    if (speakerData.buffer.length > CONFIG.SAMPLE_RATE * CONFIG.MIN_CHUNK_SIZE) {
      setTimeout(() => checkAndProcessSpeakerBuffer(streamId), 100);
    }
    
    // Check if other speakers need processing
    speakerBuffers.forEach((data, id) => {
      if (id !== streamId && data.buffer.length > CONFIG.SAMPLE_RATE * CONFIG.MIN_CHUNK_SIZE) {
        setTimeout(() => checkAndProcessSpeakerBuffer(id), 200);
      }
    });
  }
}

// Extract speaker name from streamId - UPDATED WITH ALL KNOWN SPEAKERS
function extractSpeakerName(streamId) {
  if (!streamId || !streamId.startsWith('msRemAudio-')) return 'Unknown';

  const key = streamId.split('-')[1] || streamId; // the middle segment is stable per user session

  // If we have a known hard-coded mapping, use it first
  const staticMap = {
    XRcupJ: 'DP',
    Ixslfo: 'Rickman',
    O3e0pz: 'Kira',
    ccQjUW: 'Kira',
    rgqrma: 'DP'
  };
  const shortId = key.substring(0, 6);
  if (staticMap[shortId]) return staticMap[shortId];

  // Dynamic assignment – keep alias stable within the session
  if (!speakerAliasMap.has(shortId)) {
    const alias = `S${speakerAliasMap.size + 1}`; // S1, S2 …
    speakerAliasMap.set(shortId, alias);
  }
  return speakerAliasMap.get(shortId);
}

// Check if we should merge with previous transcript
function checkShouldMergeTranscript(streamId, newTranscript) {
  const speakerData = speakerBuffers.get(streamId);
  if (!speakerData || !speakerData.pendingTranscripts.length) return false;
  
  const lastTranscript = speakerData.pendingTranscripts[speakerData.pendingTranscripts.length - 1];
  const timeDiff = newTranscript.timestamp - lastTranscript.timestamp;
  
  // Only merge if:
  // 1. Same speaker
  // 2. Within merge window (2 seconds)
  // 3. No other speakers talked in between
  const noIntervening = !hasInterveningSpeaker(lastTranscript.timestamp, newTranscript.timestamp, streamId);
  
  return timeDiff < CONFIG.SPEAKER_MERGE_WINDOW && noIntervening;
}

// Check if another speaker talked in between
function hasInterveningSpeaker(startTime, endTime, currentStreamId) {
  // Check recent transcriptions for other speakers
  for (let i = transcriptions.length - 1; i >= 0 && i >= transcriptions.length - 10; i--) {
    const trans = transcriptions[i];
    if (trans.streamId !== currentStreamId && 
        trans.timestamp > startTime && 
        trans.timestamp < endTime) {
      return true;
    }
  }
  return false;
}

// Merge transcript with previous from same speaker
function mergeTranscript(streamId, newTranscript) {
  const speakerData = speakerBuffers.get(streamId);
  const lastTranscriptIndex = transcriptions.findIndex(
    t => t === speakerData.pendingTranscripts[speakerData.pendingTranscripts.length - 1]
  );
  
  if (lastTranscriptIndex !== -1) {
    // Merge text
    transcriptions[lastTranscriptIndex].text += ' ' + newTranscript.text;
    transcriptions[lastTranscriptIndex].duration += newTranscript.duration;
    
    console.log(`[VTF Background] Merged transcript for ${streamId}`);
  }
}

// Update buffer status for visual feedback
function updateBufferStatus() {
  const bufferInfo = {};
  let totalSamples = 0;
  
  speakerBuffers.forEach((data, streamId) => {
    const duration = data.buffer.length / CONFIG.SAMPLE_RATE;
    bufferInfo[streamId] = duration;
    totalSamples += data.buffer.length;
  });
  
  const status = {
    type: 'buffer_status',
    isProcessing: processingQueue.size > 0,
    isCapturing: isCapturing,
    bufferSeconds: totalSamples / CONFIG.SAMPLE_RATE,
    speakerBuffers: bufferInfo,
    activityLevel: getActivityLevel(),
    adaptiveChunkSize: getAdaptiveChunkDuration(),
    processingCount: processingQueue.size
  };
  
  // Send to all VTF tabs
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      if (tab.url && tab.url.includes('vtf.t3live.com')) {
        chrome.tabs.sendMessage(tab.id, status, response => {
          // Handle silently - content script might not be ready
          if (chrome.runtime.lastError) {
            // Silent fail - this is expected if content script isn't loaded
          }
        });
      }
    });
  });
}

// Convert Float32Array to WAV format
function float32ToWav(float32Array, sampleRate = 16000) {
  const length = float32Array.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  
  // WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  
  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, sample * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

// Process audio chunk with Whisper API
async function processAudioChunk(audioData, timestamp, streamId) {
  console.log('[VTF Background] Processing audio chunk for transcription...');
  
  if (!apiKey) {
    console.error('[VTF Background] No API key available, attempting to reload...');
    // Try to reload API key
    const result = await chrome.storage.local.get(['openaiApiKey']);
    if (result.openaiApiKey) {
      apiKey = result.openaiApiKey;
      console.log('[VTF Background] API key reloaded from storage');
    } else {
      console.error('[VTF Background] No API key in storage');
      return null;
    }
  }
  
  try {
    // Convert Float32Array to WAV
    const wavBlob = float32ToWav(audioData);
    console.log('[VTF Background] WAV blob created:', wavBlob.size, 'bytes');
    
    // Create form data
    const formData = new FormData();
    formData.append('file', wavBlob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'json');
    
    console.log('[VTF Background] Sending to Whisper API...');
    
    // Send to Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    
    console.log('[VTF Background] Whisper API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('[VTF Background] Whisper API result:', result);
    
    if (result.text && result.text.trim()) {
      const transcription = {
        text: result.text,
        timestamp: timestamp,
        duration: audioData.length / 16000, // Calculate duration from samples
        streamId: streamId
      };
      
      // Store transcriptions (limit to last 10000)
      if (transcriptions.length > 10000) {
        transcriptions = transcriptions.slice(-10000);
      }
      
      console.log('[VTF Background] Transcription added:', transcription.text);
      
      return transcription;
    } else {
      console.log('[VTF Background] No text in transcription result');
    }
    
    return null;
  } catch (error) {
    console.error('[VTF Background] Whisper API error:', error.message);
    console.error('[VTF Background] Full error:', error);
    return null;
  }
}

// Periodic cleanup and maintenance
setInterval(() => {
  // Process any remaining audio if capture is active and buffer has been sitting
  if (isCapturing) {
    speakerBuffers.forEach((data, streamId) => {
      const bufferDuration = data.buffer.length / CONFIG.SAMPLE_RATE;
      const timeSinceActivity = Date.now() - data.lastActivityTime;
      
      // Process if buffer has been sitting for too long
      if (bufferDuration >= CONFIG.MIN_CHUNK_SIZE && timeSinceActivity > 3000 && !processingQueue.has(streamId)) {
        console.log(`[VTF Background] Periodic processing for ${streamId}`);
        processSpeakerBuffer(streamId, 'periodic');
      }
    });
  }
  
  // Prevent buffers from growing too large
  speakerBuffers.forEach((data, streamId) => {
    if (data.buffer.length > CONFIG.SAMPLE_RATE * 60) { // 1 minute max
      console.warn(`[VTF Background] Buffer overflow for ${streamId}, trimming...`);
      data.buffer = data.buffer.slice(-CONFIG.SAMPLE_RATE * 30);
    }
  });
  
  // Update visual feedback
  if (isCapturing) {
    updateBufferStatus();
  }
}, 3000);

// -----------------------------------------
// Watchdog: flush small idle buffers
// -----------------------------------------
setInterval(() => {
  speakerBuffers.forEach((data, streamId) => {
    const seconds = data.buffer.length / CONFIG.SAMPLE_RATE;
    const idleMs  = Date.now() - data.lastActivityTime;

    if (seconds >= CONFIG.STALL_MIN_DURATION && seconds < CONFIG.CHUNK_DURATION_ACTIVE && idleMs > CONFIG.STALL_IDLE_THRESHOLD) {
      info(`[VTF Watchdog] Forcing flush of ${seconds.toFixed(2)}s from ${streamId}`);
      processSpeakerBuffer(streamId, 'watchdog');
    }
  });
}, 2000);

// Log when service worker starts
console.log('[VTF Background] Service worker started at', new Date().toISOString());