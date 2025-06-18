// background.js - VTF Audio Transcription Extension
// FIXED VERSION - Resolves processing delays and missing audio

// Configuration - SIMPLIFIED AND PROVEN TO WORK
const CONFIG = {
  SAMPLE_RATE: 16000,
  // Adaptive chunking settings
  CHUNK_DURATION_ACTIVE: 5,   // seconds - optimal for active trading room with multiple speakers
  CHUNK_DURATION_IDLE: 7,    // seconds - longer chunks when only one speaker for better context
  MIN_CHUNK_SIZE: 1,          // seconds - minimum audio length before processing
  MAX_CHUNK_SIZE: 15,        // seconds - hard-cap per chunk to prevent oversized API calls
  SILENCE_THRESHOLD: 0.0003, // amplitude - tuned for trading room acoustics and background noise
  SILENCE_TIMEOUT: 2500,     // milliseconds - how long to wait before considering speech ended
  // Speaker merging settings
  SPEAKER_MERGE_WINDOW: 5000, // milliseconds - window for merging consecutive speech from same speaker
  ACTIVITY_WINDOW: 5000,      // milliseconds - window for tracking recent activity levels
  ACTIVITY_THRESHOLD: 2,      // number of speakers - threshold for considering room "busy"
  // Processing settings
  MAX_CONCURRENT_PROCESSING: 4, // maximum simultaneous API calls to prevent rate limiting
  // Minimum seconds to collect before sending the very first chunk for a speaker
  STARTUP_MIN_DURATION: 2,    // seconds - initial buffer time for better speech detection
  // Watchdog settings
  STALL_IDLE_THRESHOLD: 3000, // milliseconds - inactivity threshold before forcing buffer flush
  STALL_MIN_DURATION: 1,      // seconds - only flush if we have at least this much audio
  // Memory management
  MAX_TRANSCRIPTIONS: 1000,   // maximum transcriptions to keep in memory (reduced to prevent memory issues)
  TRANSCRIPTION_CLEANUP_KEEP: 500 // number of recent transcriptions to keep when cleaning up
};

// Store audio chunks and transcriptions
let audioChunks = [];
let isCapturing = false;
let transcriptions = [];
let apiKey = null;

// Performance monitoring
const performanceMetrics = {
  apiCalls: 0,
  totalResponseTime: 0,
  avgResponseTime: 0,
  errorCount: 0,
  errorRate: 0,
  lastReset: Date.now()
};

// Enhanced buffering state
const speakerBuffers = new Map(); 
let lastProcessTime = Date.now();
let silenceTimers = new Map();    
let recentActivity = [];          
let processingQueue = new Set();
let lastTranscripts = new Map();
let processedChunks = new Set(); // Track processed chunk IDs to prevent duplicates  

const speakerAliasMap = new Map();

// Conversation processing for quality transcription
class ConversationProcessor {
  constructor() {
    this.speakerBuffers = new Map(); // streamId -> {chunks, lastActivity, processed}
    this.completedSegments = [];
    this.SPEAKER_TIMEOUT = 4000; // 4 seconds to determine speaker finished
    this.MIN_SEGMENT_LENGTH = 8; // minimum seconds before processing
  }
  
  addTranscript(transcript) {
    const streamId = transcript.streamId;
    const now = Date.now();
    
    if (!this.speakerBuffers.has(streamId)) {
      this.speakerBuffers.set(streamId, {
        chunks: [],
        lastActivity: now,
        processed: false
      });
    }
    
    const buffer = this.speakerBuffers.get(streamId);
    buffer.chunks.push(transcript);
    buffer.lastActivity = now;
    
    // Check if we should process any completed speaker segments
    this.checkForCompletedSegments();
  }
  
  checkForCompletedSegments() {
    const now = Date.now();
    
    this.speakerBuffers.forEach((buffer, streamId) => {
      const timeSinceActivity = now - buffer.lastActivity;
      const totalDuration = buffer.chunks.reduce((sum, chunk) => sum + (chunk.duration || 2), 0);
      
      // Process if: speaker finished talking OR segment is long enough
      if (!buffer.processed && (timeSinceActivity > this.SPEAKER_TIMEOUT || totalDuration > this.MIN_SEGMENT_LENGTH)) {
        this.processSpeakerSegment(streamId, buffer);
      }
    });
  }
  
  processSpeakerSegment(streamId, buffer) {
    if (buffer.chunks.length === 0) return;
    
    buffer.processed = true;
    
    // Merge all chunks from this speaker
    const mergedText = this.mergeChunks(buffer.chunks);
    const cleanedText = this.cleanText(mergedText);
    const topicTitle = this.detectTopic(cleanedText);
    
    const processedSegment = {
      speaker: buffer.chunks[0].speaker || this.extractSpeakerName(streamId),
      text: cleanedText,
      topic: topicTitle,
      startTime: buffer.chunks[0].timestamp,
      endTime: buffer.chunks[buffer.chunks.length - 1].timestamp,
      duration: buffer.chunks.reduce((sum, chunk) => sum + (chunk.duration || 2), 0),
      confidence: this.calculateAverageConfidence(buffer.chunks),
      streamId: streamId
    };
    
    this.completedSegments.push(processedSegment);
    
    // Send processed segment to content script
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.url && tab.url.includes('vtf.t3live.com')) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'processedTranscription',
            segment: processedSegment
          }, response => {
            if (chrome.runtime.lastError) {
              // Silent fail if content script not ready
            }
          });
        }
      });
    });
  }
  
  mergeChunks(chunks) {
    let merged = chunks.map(chunk => chunk.text).join(' ');
    
    // Fix sentence fragments
    merged = merged.replace(/\s+/g, ' '); // normalize spaces
    merged = merged.replace(/\.\s*([a-z])/g, '. $1'); // fix sentence boundaries
    merged = merged.replace(/([a-z])\s+([A-Z])/g, '$1. $2'); // add missing periods
    
    return merged.trim();
  }
  
  cleanText(text) {
    // Remove speech artifacts
    text = text.replace(/\b(um|uh|you know|like|actually)\b/gi, '');
    text = text.replace(/\bgonna\b/gi, 'going to');
    text = text.replace(/\bcause\b/gi, 'because');
    text = text.replace(/\bwanna\b/gi, 'want to');
    
    // Fix contractions
    text = text.replace(/\bis\s+not\b/gi, "isn't");
    text = text.replace(/\bdo\s+not\b/gi, "don't");
    text = text.replace(/\bdoes\s+not\b/gi, "doesn't");
    
    // Remove repetitions (same word twice in a row)
    text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');
    
    // Clean up spacing and punctuation
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/\s+([,.!?])/g, '$1');
    text = text.replace(/([,.!?])\s*([a-z])/g, '$1 $2');
    
    return text.trim();
  }
  
  detectTopic(text) {
    const topics = [
      { keywords: ['market', 'futures', 'dow', 'nasdaq', 'spy'], title: 'Market Update' },
      { keywords: ['price target', 'upgrade', 'downgrade', 'analyst', 'buy', 'sell'], title: 'Analyst Updates' },
      { keywords: ['trade', 'position', 'buy', 'sell', 'profit', 'loss'], title: 'Trade Discussion' },
      { keywords: ['chart', 'technical', 'support', 'resistance', 'fibonacci'], title: 'Technical Analysis' },
      { keywords: ['earnings', 'revenue', 'guidance', 'report'], title: 'Earnings Analysis' },
      { keywords: ['fed', 'fomc', 'powell', 'rates', 'inflation'], title: 'Fed Watch' }
    ];
    
    const textLower = text.toLowerCase();
    
    for (const topic of topics) {
      const matches = topic.keywords.filter(keyword => textLower.includes(keyword));
      if (matches.length >= 2) {
        return topic.title;
      }
    }
    
    return 'Market Commentary';
  }
  
  calculateAverageConfidence(chunks) {
    const confidences = chunks.filter(c => c.confidence).map(c => c.confidence);
    if (confidences.length === 0) return 0;
    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  }
  
  getCompletedSegments() {
    return this.completedSegments;
  }
  
  clearOldSegments() {
    // Keep only recent segments to manage memory
    if (this.completedSegments.length > 100) {
      this.completedSegments = this.completedSegments.slice(-50);
    }
  }
  
  extractSpeakerName(streamId) {
    return extractSpeakerName(streamId);
  }
}

// Create global conversation processor
const conversationProcessor = new ConversationProcessor();

// Rate limiting for OpenAI API
const rateLimiter = {
  requests: [],
  maxPerMinute: 50, // OpenAI API limit
  maxConcurrent: 3, // Limit concurrent requests
  currentRequests: 0,
  
  canMakeRequest() {
    const now = Date.now();
    // Clean old requests (older than 1 minute)
    this.requests = this.requests.filter(time => now - time < 60000);
    
    // Check rate limits
    const withinRateLimit = this.requests.length < this.maxPerMinute;
    const withinConcurrentLimit = this.currentRequests < this.maxConcurrent;
    
    return withinRateLimit && withinConcurrentLimit;
  },
  
  addRequest() {
    this.requests.push(Date.now());
    this.currentRequests++;
  },
  
  completeRequest() {
    this.currentRequests = Math.max(0, this.currentRequests - 1);
  },
  
  getWaitTime() {
    if (this.requests.length >= this.maxPerMinute) {
      const oldestRequest = Math.min(...this.requests);
      return Math.max(0, 60000 - (Date.now() - oldestRequest));
    }
    return 0;
  }
};

// Simple log helper – switch between 'debug', 'info', 'silent'
const LOG = { level: 'info' };
function dbg(...msg){ if (LOG.level==='debug') console.log(...msg); }
function info(...msg){ if (LOG.level!=='silent') console.log(...msg); }

// Load API key from local storage
chrome.storage.local.get(['openaiApiKey'], (result) => {
  if (result.openaiApiKey) {
    apiKey = result.openaiApiKey;
    console.log('[VTF Background] API key loaded from local storage');
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
        const chunkId = request.chunkId || `${streamId}-${request.timestamp}`;
        
        // Check for duplicate chunks
        if (processedChunks.has(chunkId)) {
          console.log(`[VTF Background] Skipping duplicate chunk: ${chunkId}`);
          sendResponse({ received: true, ignored: true, reason: 'duplicate' });
          return true;
        }
        
        // Mark chunk as processed
        processedChunks.add(chunkId);
        
        // Clean old processed chunks to prevent memory leak (keep last 1000)
        if (processedChunks.size > 1000) {
          const oldChunks = Array.from(processedChunks).slice(0, 500);
          oldChunks.forEach(id => processedChunks.delete(id));
        }
        
        console.log(`[VTF Background] Processing audio chunk: ${request.audioData.length} samples from stream ${streamId} (ID: ${chunkId})`);
        
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
        
        // Store the chunk metadata with VAD results and channel info
        audioChunks.push({
          data: request.audioData,
          timestamp: request.timestamp,
          streamId: streamId,
          vadResult: request.vadResult,
          channelInfo: request.channelInfo
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
      
      // Calculate VAD statistics
      const recentChunks = audioChunks.slice(-10);
      const vadStats = {
        voiceActivity: 0,
        avgProbability: 0,
        avgSNR: 0,
        avgSpectralCentroid: 0
      };
      
      // Calculate channel statistics
      const channelStats = {};
      const uniqueChannels = new Set();
      
      if (recentChunks.length > 0) {
        let voiceCount = 0;
        let probSum = 0;
        let snrSum = 0;
        let centroidSum = 0;
        let validVadCount = 0;
        
        recentChunks.forEach(chunk => {
          if (chunk.vadResult) {
            validVadCount++;
            if (chunk.vadResult.isVoice) voiceCount++;
            probSum += chunk.vadResult.probability;
            snrSum += chunk.vadResult.features.snr;
            centroidSum += chunk.vadResult.features.spectralCentroid;
          }
          
          // Track channel information
          if (chunk.channelInfo && chunk.channelInfo.trackId) {
            const trackId = chunk.channelInfo.trackId;
            uniqueChannels.add(trackId);
            
            if (!channelStats[trackId]) {
              channelStats[trackId] = {
                trackId: trackId,
                trackLabel: chunk.channelInfo.trackLabel || 'Unknown',
                streamId: chunk.channelInfo.streamId,
                chunkCount: 0,
                voiceChunks: 0,
                lastActivity: chunk.timestamp
              };
            }
            
            channelStats[trackId].chunkCount++;
            if (chunk.vadResult && chunk.vadResult.isVoice) {
              channelStats[trackId].voiceChunks++;
            }
            channelStats[trackId].lastActivity = Math.max(channelStats[trackId].lastActivity, chunk.timestamp);
          }
        });
        
        if (validVadCount > 0) {
          vadStats.voiceActivity = (voiceCount / validVadCount * 100).toFixed(1);
          vadStats.avgProbability = (probSum / validVadCount).toFixed(3);
          vadStats.avgSNR = (snrSum / validVadCount).toFixed(2);
          vadStats.avgSpectralCentroid = Math.round(centroidSum / validVadCount);
        }
      }
      
      const status = {
        isCapturing, 
        chunksReceived: audioChunks.length,
        transcriptionCount: transcriptions.length,
        hasApiKey: !!apiKey,
        bufferSize: totalBufferSize,
        bufferDuration: (totalBufferSize / CONFIG.SAMPLE_RATE).toFixed(2),
        activeSpeakers: speakerBuffers.size,
        isProcessing: processingQueue.size > 0,
        speechActivity: getActivityLevel(),
        vadStats: vadStats,
        channelStats: {
          activeChannels: uniqueChannels.size,
          channels: Object.values(channelStats).map(ch => ({
            ...ch,
            voiceActivity: ch.chunkCount > 0 ? ((ch.voiceChunks / ch.chunkCount) * 100).toFixed(1) : '0.0',
            timeSinceActivity: Date.now() - ch.lastActivity
          }))
        },
        performance: {
          apiCalls: performanceMetrics.apiCalls,
          avgResponseTime: Math.round(performanceMetrics.avgResponseTime),
          errorRate: Math.round(performanceMetrics.errorRate * 100)
        }
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
    
    if (request.type === 'getDailyMarkdown') {
      const targetDate = request.date ? new Date(request.date) : new Date();
      const markdown = generateDailyMarkdown(targetDate);
      sendResponse({ markdown, date: targetDate.toISOString().split('T')[0] });
      return true;
    }
    
    if (request.type === 'exportSessionData') {
      const sessionData = {
        transcriptions: transcriptions,
        timestamp: Date.now(),
        version: '0.6.0',
        speakers: Array.from(speakerAliasMap.entries()),
        performance: performanceMetrics
      };
      sendResponse({ sessionData });
      return true;
    }
    
    if (request.type === 'importSessionData') {
      try {
        const data = request.sessionData;
        if (data && data.transcriptions) {
          transcriptions = data.transcriptions;
          if (data.speakers) {
            speakerAliasMap.clear();
            data.speakers.forEach(([key, value]) => {
              speakerAliasMap.set(key, value);
            });
          }
          console.log(`[VTF Background] Imported ${transcriptions.length} transcriptions`);
          sendResponse({ success: true, count: transcriptions.length });
        } else {
          sendResponse({ success: false, error: 'Invalid data format' });
        }
      } catch (error) {
        console.error('[VTF Background] Import error:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }
    
    if (request.type === 'setApiKey') {
      console.log('[VTF Background] Received setApiKey request');
      apiKey = request.apiKey;
      // Store API key in local storage
      chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
        if (chrome.runtime.lastError) {
          console.error('[VTF Background] Error saving API key:', chrome.runtime.lastError);
          sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        } else {
          console.log('[VTF Background] API key saved to local storage');
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
        // Store transcriptions with conversation assembly
        assembleConversation(result);
        // Update speaker pending transcripts for merging
        speakerData.pendingTranscripts = [result];
      }
      
      // Feed to conversation processor instead of immediate display
      conversationProcessor.addTranscript(result);
    }
    
  } catch (error) {
    console.error(`[VTF Background] Processing error for speaker ${speakerName} (${streamId}), buffer size: ${chunk.length} samples, reason: ${reason}:`, error);
    
    // Clean up failed processing
    processingQueue.delete(streamId);
    
    // Send error notification to UI if available
    updateBufferStatus();
    
    // Continue processing other speakers
    return null;
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

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on 4xx errors (except 429 rate limit)
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }
      
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        info(`[VTF Background] Retry ${i + 1}/${maxRetries} after ${delay}ms for ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Process audio chunk with Whisper API
async function processAudioChunk(audioData, timestamp, streamId) {
  const startTime = Date.now();
  
  // Check rate limiting before proceeding
  if (!rateLimiter.canMakeRequest()) {
    const waitTime = rateLimiter.getWaitTime();
    console.log(`[VTF Background] Rate limit reached, waiting ${waitTime}ms for ${streamId}`);
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Check again after waiting
    if (!rateLimiter.canMakeRequest()) {
      console.warn(`[VTF Background] Still rate limited, skipping chunk for ${streamId}`);
      return null;
    }
  }
  
  // Add to rate limiter tracking
  rateLimiter.addRequest();
  performanceMetrics.apiCalls++;
  
  if (!apiKey) {
    console.error('[VTF Background] No API key available, attempting to reload...');
    // Try to reload API key from local storage
    const result = await chrome.storage.local.get(['openaiApiKey']);
    if (result.openaiApiKey) {
      apiKey = result.openaiApiKey;
      console.log('[VTF Background] API key reloaded from local storage');
    } else {
      console.error('[VTF Background] No API key in local storage');
      performanceMetrics.errorCount++;
      updatePerformanceMetrics();
      rateLimiter.completeRequest(); // Complete the tracking
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
    formData.append('response_format', 'verbose_json'); // Get timestamps and confidence scores
    
    console.log('[VTF Background] Sending to Whisper API...');
    
    // Send to Whisper API with retry logic
    const response = await retryWithBackoff(async () => {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res;
    });
    
    console.log('[VTF Background] Whisper API response status:', response.status);
    
    const result = await response.json();
    console.log('[VTF Background] Whisper API result:', result);
    
    if (result.text && result.text.trim()) {
      // Calculate average confidence if segments are available
      let avgConfidence = 0;
      if (result.segments && result.segments.length > 0) {
        const confidenceSum = result.segments.reduce((sum, segment) => {
          return sum + (segment.avg_logprob ? Math.exp(segment.avg_logprob) : 0.5);
        }, 0);
        avgConfidence = confidenceSum / result.segments.length;
      }
      
      // Get channel info from recent audio chunks for this stream
      const recentChunk = audioChunks.find(chunk => 
        chunk.streamId === streamId && Math.abs(chunk.timestamp - timestamp) < 2000
      );
      
      const transcription = {
        text: result.text,
        timestamp: timestamp,
        duration: result.duration || (audioData.length / 16000), // Use API duration if available
        streamId: streamId,
        confidence: avgConfidence,
        language: result.language || 'en',
        segments: result.segments || [],
        channelInfo: recentChunk?.channelInfo || {}
      };
      
      // Track successful response time
      const responseTime = Date.now() - startTime;
      performanceMetrics.totalResponseTime += responseTime;
      updatePerformanceMetrics();
      rateLimiter.completeRequest(); // Complete the rate limiting tracking
      
      return transcription;
    } else {
      console.log('[VTF Background] No text in transcription result');
      rateLimiter.completeRequest(); // Complete the rate limiting tracking
    }
    
    return null;
  } catch (error) {
    performanceMetrics.errorCount++;
    updatePerformanceMetrics();
    rateLimiter.completeRequest(); // Complete the rate limiting tracking
    console.error('[VTF Background] Whisper API error:', error.message);
    console.error('[VTF Background] Full error:', error);
    throw error;
  }
}

// Conversation assembly and post-processing
function assembleConversation(newTranscription) {
  // Add to transcriptions without purging
  transcriptions.push(newTranscription);
  
  // Optional cleanup for very long sessions to prevent memory issues
  if (transcriptions.length > CONFIG.MAX_TRANSCRIPTIONS) {
    const removed = transcriptions.length - CONFIG.TRANSCRIPTION_CLEANUP_KEEP;
    transcriptions = transcriptions.slice(-CONFIG.TRANSCRIPTION_CLEANUP_KEEP);
    console.log(`[VTF Background] Memory cleanup: removed ${removed} old transcriptions, keeping ${transcriptions.length}`);
  }
  
  return newTranscription;
}



// Generate daily markdown export
function generateDailyMarkdown(targetDate = null) {
  const date = targetDate || new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Filter transcripts for the target date
  const dayTranscripts = transcriptions.filter(t => {
    const transcriptDate = new Date(t.timestamp).toISOString().split('T')[0];
    return transcriptDate === dateStr;
  });
  
  if (dayTranscripts.length === 0) {
    return `# VTF Trading Room - ${dateStr}\n\n*No transcriptions recorded for this date.*`;
  }
  
  let markdown = `# VTF Trading Room - ${date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  })}\n\n`;
  
  markdown += `**Session Summary:**\n`;
  markdown += `- Total Transcripts: ${dayTranscripts.length}\n`;
  markdown += `- Session Duration: ${formatDuration(dayTranscripts[dayTranscripts.length - 1].timestamp - dayTranscripts[0].timestamp)}\n`;
  markdown += `- Speakers: ${[...new Set(dayTranscripts.map(t => t.speaker))].join(', ')}\n\n`;
  
  markdown += `---\n\n`;
  
  // Process transcripts chronologically
  dayTranscripts.forEach(transcript => {
    const time = new Date(transcript.timestamp).toLocaleTimeString();
    const duration = transcript.duration ? ` *(${transcript.duration.toFixed(1)}s)*` : '';
    
    markdown += `**${transcript.speaker}** *(${time})*${duration}: ${transcript.text}\n\n`;
  });
  
  return markdown;
}



function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function cleanupSpeakerBuffers() {
  const MAX_BUFFER_DURATION = 60; // seconds
  const MAX_INACTIVE_TIME = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  let cleaned = 0;
  
  speakerBuffers.forEach((data, streamId) => {
    // Trim oversized buffers
    const duration = data.buffer.length / CONFIG.SAMPLE_RATE;
    if (duration > MAX_BUFFER_DURATION) {
      const keepSamples = MAX_BUFFER_DURATION * CONFIG.SAMPLE_RATE;
      data.buffer = data.buffer.slice(-keepSamples);
      cleaned++;
    }
    
    // Remove inactive speakers
    if (now - data.lastActivityTime > MAX_INACTIVE_TIME) {
      speakerBuffers.delete(streamId);
      info(`[VTF Background] Removed inactive speaker: ${streamId}`);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    dbg(`[VTF Background] Cleaned ${cleaned} speaker buffers`);
  }
}

function getMemoryStats() {
  const stats = {
    transcriptions: transcriptions.length,
    speakerBuffers: speakerBuffers.size,
    totalBufferSamples: Array.from(speakerBuffers.values()).reduce((sum, data) => sum + data.buffer.length, 0)
  };
  
  if (performance.memory) {
    stats.heapUsed = (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + 'MB';
    stats.heapTotal = (performance.memory.totalJSHeapSize / 1048576).toFixed(1) + 'MB';
  }
  
  return stats;
}

// Periodic cleanup and maintenance
setInterval(() => {
  // Memory cleanup (only speaker buffers, keep all transcriptions)
  cleanupSpeakerBuffers();
  
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
  
  // Update visual feedback and log memory stats
  if (isCapturing) {
    updateBufferStatus();
    const stats = getMemoryStats();
    dbg('[VTF Background] Memory stats:', stats);
  }
}, 5000); // Increased to 5s for less frequent cleanup

// -----------------------------------------
// Watchdog: flush small idle buffers + conversation processing
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
  
  // Check for completed conversation segments
  conversationProcessor.checkForCompletedSegments();
}, 2000);

// Log when service worker starts
console.log('[VTF Background] Service worker started at', new Date().toISOString());



function updatePerformanceMetrics() {
  performanceMetrics.avgResponseTime = performanceMetrics.totalResponseTime / performanceMetrics.apiCalls;
  performanceMetrics.errorRate = performanceMetrics.errorCount / performanceMetrics.apiCalls;
  performanceMetrics.lastReset = Date.now();
}