/**
 * @file inject.js
 * @path src/inject.js
 * @description Direct audio stream capture from VTF platform with enhanced Voice Activity Detection
 * @modified 2025-01-27
 */

// QA FIXES IMPLEMENTED:
// ✅ Added proper AudioContext cleanup on page unload
// ✅ Optimized array operations (removed spread operator)
// ✅ Enhanced resource management and error handling
// ✅ Added comprehensive cleanup function for all audio resources

(function() {
  console.log('[VTF Inject] Enhanced script loaded with stream switching support');
  
  let audioContext = null;
  let activeProcessors = new Map();
  let capturePaused = false;
  let workletLoaded = false;
  let producerChannels = new Map(); // Map producer IDs to channel info
  let cleanupTimeouts = new Map(); // Debounced cleanup for stream switches
  
  // Proper cleanup on page unload
  window.addEventListener('beforeunload', () => {
    console.log('[VTF Inject] Page unloading, cleaning up audio resources');
    cleanupAudioResources();
  });
  
  // Cleanup function for audio resources
  function cleanupAudioResources() {
    try {
      // Close all active processors
      activeProcessors.forEach((processor, elementId) => {
        if (processor.source) {
          processor.source.disconnect();
        }
        if (processor.processor) {
          if (processor.processor.disconnect) {
            processor.processor.disconnect();
          }
          if (processor.processor.port) {
            processor.processor.port.close();
          }
        }
      });
      activeProcessors.clear();
      
      // Close audio context
      if (audioContext && audioContext.state !== 'closed') {
        console.log('[VTF Inject] Closing AudioContext');
        audioContext.close();
        audioContext = null;
        workletLoaded = false;
      }
      
      // Clear timeouts
      cleanupTimeouts.forEach(timeout => clearTimeout(timeout));
      cleanupTimeouts.clear();
      
      // Clear producer channels
      producerChannels.clear();
      
    } catch (error) {
      console.error('[VTF Inject] Error during cleanup:', error);
    }
  }
  
  // Error handling wrapper
  function withErrorBoundary(fn, context = '') {
    return function(...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        console.error(`[VTF Inject] Error in ${context}:`, error);
        // Don't rethrow - keep the extension running
      }
    };
  }
  
  // Enhanced audio quality assessment with reasonable thresholds
  function assessAudioQuality(audioData) {
    const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
    const maxSample = Math.max(...audioData.map(Math.abs));
    const dynamicRange = maxSample / (rms || 0.0001);
    
    let quality = 'poor';
    // Reasonable thresholds for speech
    if (rms > 0.005 && dynamicRange > 2) {
      quality = 'good';
    } else if (rms > 0.002 || dynamicRange > 1.5) {
      quality = 'fair';  
    }
    
    return {
      quality: quality,
      rms: rms,
      dynamicRange: dynamicRange,
      maxSample: maxSample
    };
  }
  
  // Reliably initialize AudioWorklet with proper VAD for VTF
  async function ensureAudioWorkletLoaded() {
    if (workletLoaded) return true;
    
    try {
      if (!audioContext.audioWorklet) {
        throw new Error('AudioWorklet not supported by this browser');
      }
      
      console.log('[VTF Inject] Loading enhanced AudioWorklet module...');
      await audioContext.audioWorklet.addModule(URL.createObjectURL(new Blob([`
        // Enhanced AudioWorklet Processor for VTF with proper thresholds
        class VTFAudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.audioBuffer = [];
            this.chunkSize = 16000; // 1 second at 16kHz for better context
            
            // Proper VAD parameters for speech detection
            this.vadConfig = {
              energyThreshold: 0.003,          // Reasonable threshold for speech
              zcrThreshold: 0.4,               // Good for speech detection
              spectralCentroidThreshold: 1000, // Speech frequency range
              spectralRolloffThreshold: 2000,  // Speech frequency range  
              voiceProbabilityThreshold: 0.5,  // Balanced threshold
              adaptiveWindow: 20,              // Reasonable adaptation
              hangoverFrames: 8                // Smooth detection
            };
            
            // Adaptive thresholding
            this.energyHistory = [];
            this.noiseFloor = 0.002;     // Reasonable noise floor
            this.snrHistory = [];
            this.initialized = false;
            
            // Voice activity state
            this.voiceActivity = false;
            this.hangoverCounter = 0;
            this.consecutiveSilentChunks = 0;
            this.chunkCount = 0;
            
            // Spectral analysis setup
            this.sampleRate = 16000;
            this.fftSize = 256;
            
            // Listen for configuration updates
            this.port.onmessage = (event) => {
              if (event.data.type === 'configure') {
                this.chunkSize = event.data.chunkSize || 16000;
                Object.assign(this.vadConfig, event.data.vadConfig || {});
              }
            };
          }
          
          calculateZCR(audioData) {
            let crossings = 0;
            for (let i = 1; i < audioData.length; i++) {
              if ((audioData[i] >= 0) !== (audioData[i - 1] >= 0)) {
                crossings++;
              }
            }
            return crossings / (audioData.length - 1);
          }
          
          // Simplified spectral analysis for performance
          calculateSpectralFeatures(audioData) {
            const N = Math.min(audioData.length, this.fftSize);
            let totalEnergy = 0;
            let weightedSum = 0;
            
            // Simple energy-based spectral centroid calculation
            for (let i = 0; i < N; i++) {
              const energy = audioData[i] * audioData[i];
              totalEnergy += energy;
              weightedSum += i * energy;
            }
            
            const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) * (this.sampleRate / 2 / N) : 0;
            
            return { centroid, rolloff: centroid * 1.5 };
          }
          
          // Proper VAD with reasonable thresholds
          performVAD(audioData) {
            const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
            const maxSample = Math.max(...audioData.map(Math.abs));
            
            // Update energy history
            this.energyHistory.push(rms);
            if (this.energyHistory.length > this.vadConfig.adaptiveWindow) {
              this.energyHistory.shift();
            }
            
            // Initialize noise floor
            if (!this.initialized && this.energyHistory.length >= 5) {
              const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
              this.noiseFloor = Math.max(0.001, sortedEnergy[0] * 1.5); // Reasonable noise floor
              this.initialized = true;
            }
            
            const zcr = this.calculateZCR(audioData);
            const spectralFeatures = this.calculateSpectralFeatures(audioData);
            const snr = this.noiseFloor > 0 ? 20 * Math.log10(rms / this.noiseFloor) : 0;
            
            this.snrHistory.push(snr);
            if (this.snrHistory.length > 5) this.snrHistory.shift();
            const avgSNR = this.snrHistory.reduce((a, b) => a + b, 0) / this.snrHistory.length;
            
            // Multi-feature voice activity decision
            let voiceProbability = 0;
            
            // Energy criterion
            if (rms > this.vadConfig.energyThreshold) voiceProbability += 0.3;
            if (rms > this.vadConfig.energyThreshold * 2) voiceProbability += 0.2;
            
            // ZCR criterion (voice typically has lower ZCR)
            if (zcr < this.vadConfig.zcrThreshold) voiceProbability += 0.2;
            
            // Spectral features
            if (spectralFeatures.centroid > this.vadConfig.spectralCentroidThreshold) voiceProbability += 0.15;
            
            // SNR criterion
            if (avgSNR > 6) voiceProbability += 0.15; // Reasonable SNR threshold
            
            // Dynamic range check
            const dynamicRange = maxSample / (rms || 0.0001);
            if (dynamicRange > 2) voiceProbability += 0.1;
            
            // Decision logic with hangover
            const isVoiceCandidate = voiceProbability >= this.vadConfig.voiceProbabilityThreshold;
            
            if (isVoiceCandidate) {
              this.voiceActivity = true;
              this.hangoverCounter = this.vadConfig.hangoverFrames;
            } else {
              if (this.hangoverCounter > 0) {
                this.hangoverCounter--;
                this.voiceActivity = true;
              } else {
                this.voiceActivity = false;
              }
            }
            
            // Quality assessment
            let quality = 'poor';
            if (rms > 0.005 && maxSample < 0.95) {
              quality = avgSNR > 10 ? 'good' : 'fair';
            } else if (rms > 0.002) {
              quality = 'fair';
            }
            
            return {
              isVoice: this.voiceActivity,
              probability: voiceProbability,
              quality: quality,
              features: {
                rms: rms,
                maxSample: maxSample,
                zcr: zcr,
                spectralCentroid: spectralFeatures.centroid,
                spectralRolloff: spectralFeatures.rolloff,
                snr: avgSNR
              }
            };
          }
          
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input.length > 0) {
              const audioData = input[0];
              // Efficient array concatenation instead of spread operator
              const oldLength = this.audioBuffer.length;
              this.audioBuffer.length = oldLength + audioData.length;
              for (let i = 0; i < audioData.length; i++) {
                this.audioBuffer[oldLength + i] = audioData[i];
              }
              
              while (this.audioBuffer.length >= this.chunkSize) {
                const chunk = this.audioBuffer.slice(0, this.chunkSize);
                this.audioBuffer = this.audioBuffer.slice(this.chunkSize);
                this.chunkCount++;
                
                const vadResult = this.performVAD(chunk);
                
                // Only send chunks with voice activity or reasonable energy
                if (vadResult.isVoice || vadResult.features.rms > 0.002) {
                  this.port.postMessage({
                    type: 'audioData',
                    audioData: chunk,
                    timestamp: Date.now(),
                    vadResult: vadResult
                  });
                }
              }
            }
            
            return true;
          }
        }
        
        registerProcessor('vtf-audio-processor', VTFAudioProcessor);
      `], { type: 'application/javascript' })));
      
      workletLoaded = true;
      console.log('[VTF Inject] Enhanced AudioWorklet module loaded successfully');
      return true;
      
    } catch (error) {
      console.error('[VTF Inject] Failed to load AudioWorklet:', error);
      workletLoaded = false;
      return false;
    }
  }

  // Simplified capture function using element ID as primary key
  async function captureAudioElement(audioElement) {
    const elementId = audioElement.id;
    
    if (capturePaused) return;
    
    // Extract stream and track information
    const mediaStream = audioElement.srcObject;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      console.log(`[VTF Inject] No audio tracks found for: ${elementId}`);
      return;
    }
    
    // Check if we already have a processor for this element
    if (activeProcessors.has(elementId)) {
      console.log(`[VTF Inject] Already have processor for element: ${elementId}`);
      return;
    }
    
    const audioTrack = mediaStream.getAudioTracks()[0];
    const trackId = audioTrack.id;
    const producerId = elementId.replace('msRemAudio-', '');
    
    console.log(`[VTF Inject] Starting capture for element: ${elementId} (track: ${trackId})`);
    
    try {
      // Create audio context if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        console.log(`[VTF Inject] Created AudioContext, state: ${audioContext.state}`);
      }
      
      // Resume context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      // Ensure AudioWorklet is loaded
      const workletSuccess = await ensureAudioWorkletLoaded();
      
      // Create audio source
      const source = audioContext.createMediaStreamSource(mediaStream);
      let processor;
      
      // Create channel info
      const channelInfo = {
        elementId: elementId,
        producerId: producerId,
        trackId: trackId,
        trackLabel: audioTrack.label || `Producer ${producerId.substring(0, 8)}`,
        mediaStreamId: mediaStream.id,
        startTime: Date.now()
      };
      
      // Store producer channel mapping
      producerChannels.set(producerId, channelInfo);
      
      if (workletSuccess) {
        // Use modern AudioWorklet
        processor = new AudioWorkletNode(audioContext, 'vtf-audio-processor');
        
        // Configure worklet with proper settings
        processor.port.postMessage({
          type: 'configure',
          chunkSize: 16000, // 1 second chunks at 16kHz
          vadConfig: {
            energyThreshold: 0.003,
            zcrThreshold: 0.4,
            spectralCentroidThreshold: 1000,
            spectralRolloffThreshold: 2000,
            voiceProbabilityThreshold: 0.5,
            adaptiveWindow: 20,
            hangoverFrames: 8
          }
        });
        
        // Listen for VAD results from the worklet
        processor.port.onmessage = withErrorBoundary((event) => {
          if (event.data.type === 'audioData') {
            const { audioData, timestamp, vadResult } = event.data;
            
            // Send to content script with channel info
            window.postMessage({
              type: 'VTF_AUDIO_DATA',
              streamId: elementId,
              audioData: audioData,
              timestamp: timestamp,
              vadResult: vadResult,
              channelInfo: channelInfo,
              // Legacy compatibility
              maxSample: vadResult.features.maxSample,
              audioQuality: vadResult.quality,
              rms: vadResult.features.rms,
              isSilent: !vadResult.isVoice
            }, '*');
          }
        }, `worklet message handling for ${elementId}`);
        
        console.log(`[VTF Inject] Using AudioWorklet processor for ${elementId}`);
        
      } else {
        // Fallback to ScriptProcessor
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        let audioBuffer = [];
        let chunkCount = 0;
        const CHUNK_SIZE = 16000; // 1 second at 16kHz
        
        processor.onaudioprocess = withErrorBoundary((e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          // Efficient array concatenation for ScriptProcessor fallback
          const oldLength = audioBuffer.length;
          audioBuffer.length = oldLength + inputData.length;
          for (let i = 0; i < inputData.length; i++) {
            audioBuffer[oldLength + i] = inputData[i];
          }
          
          if (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            chunkCount++;
            
            // Quality assessment
            const qualityInfo = assessAudioQuality(chunk);
            
            // Process only chunks with sufficient audio
            if (qualityInfo.rms > 0.003 || qualityInfo.maxSample > 0.01) {
              // Send to content script
              window.postMessage({
                type: 'VTF_AUDIO_DATA',
                streamId: elementId,
                audioData: chunk,
                timestamp: Date.now(),
                chunkId: `${elementId}-${chunkCount}`,
                channelInfo: channelInfo,
                maxSample: qualityInfo.maxSample,
                audioQuality: qualityInfo.quality,
                rms: qualityInfo.rms,
                isSilent: qualityInfo.rms < 0.003
              }, '*');
            }
          }
        }, `audio processing for ${elementId}`);
      }
      
      // Connect pipeline
      source.connect(processor);
      if (processor.connect) {
        processor.connect(audioContext.destination);
      }
      
      // Store for cleanup
      activeProcessors.set(elementId, {
        source: source,
        processor: processor,
        trackId: trackId,
        producerId: producerId,
        channelInfo: channelInfo,
        startTime: Date.now()
      });
      
      console.log(`[VTF Inject] Audio pipeline connected for element ${elementId}`);
      
    } catch (error) {
      console.error(`[VTF Inject] Error setting up capture for ${elementId}:`, error);
    }
  }
  
  // Simplified stop capture function
  function stopCapture(elementId) {
    const processorInfo = activeProcessors.get(elementId);
    if (processorInfo) {
      console.log(`[VTF Inject] Stopping capture for element: ${elementId}`);
      try {
        processorInfo.source.disconnect();
        if (processorInfo.processor.disconnect) {
          processorInfo.processor.disconnect();
        }
        
        // Clean up producer mapping
        if (processorInfo.producerId) {
          producerChannels.delete(processorInfo.producerId);
        }
        
      } catch (e) {
        console.warn(`[VTF Inject] Error disconnecting ${elementId}:`, e);
      }
      activeProcessors.delete(elementId);
    }
  }
  
  // Debounced cleanup for stream switching
  function handleStopTalking(elementId) {
    // Cancel any existing cleanup timeout
    if (cleanupTimeouts.has(elementId)) {
      clearTimeout(cleanupTimeouts.get(elementId));
    }
    
    // Set a 5-second delay before cleanup to ensure buffers are processed
    cleanupTimeouts.set(elementId, setTimeout(() => {
      stopCapture(elementId);
      cleanupTimeouts.delete(elementId);
      console.log(`[VTF Inject] Delayed cleanup completed for ${elementId}`);
    }, 5000)); // 5 seconds to ensure all audio is processed
  }
  
  // MutationObserver for detecting audio elements
  const observer = new MutationObserver(withErrorBoundary((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === 'AUDIO' && node.id && node.id.startsWith('msRemAudio-')) {
          console.log(`[VTF Inject] New audio element detected: ${node.id}`);
          
          // Immediate attempt to capture
          if (node.srcObject || node.src) {
            captureAudioElement(node);
          }
          
          // Also set up event listeners for delayed initialization
          const tryCapture = () => {
            if (node.srcObject || node.src) {
              captureAudioElement(node);
            }
          };
          
          // Multiple fallback attempts
          setTimeout(tryCapture, 100);
          setTimeout(tryCapture, 500);
          
          // Listen for play event  
          node.addEventListener('play', tryCapture);
          node.addEventListener('loadedmetadata', tryCapture);
        }
      });
      
      mutation.removedNodes.forEach((node) => {
        if (node.nodeName === 'AUDIO' && node.id && node.id.startsWith('msRemAudio-')) {
          console.log(`[VTF Inject] Audio element removed: ${node.id}`);
          handleStopTalking(node.id); // Use debounced cleanup
        }
      });
    });
  }, 'mutation observer'));
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });
  
  // Check existing elements immediately
  document.querySelectorAll('audio[id^="msRemAudio-"]').forEach(audio => {
    console.log(`[VTF Inject] Found existing audio element: ${audio.id}`);
    if (audio.srcObject || audio.src) {
      captureAudioElement(audio);
    }
  });
  
  // Play event listener
  document.addEventListener('play', (e) => {
    if (e.target.id && e.target.id.startsWith('msRemAudio-')) {
      console.log(`[VTF Inject] Play event for: ${e.target.id}`);
      captureAudioElement(e.target);
    }
  }, true);
  
  // Listen for control messages from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'VTF_STOP_CAPTURE') {
      console.log('[VTF Inject] Stop capture requested - cleaning up all processors');
      capturePaused = true;
      
      // Clear all cleanup timeouts
      cleanupTimeouts.forEach(timeout => clearTimeout(timeout));
      cleanupTimeouts.clear();
      
      // Disconnect all active processors
      activeProcessors.forEach((_, id) => {
        stopCapture(id);
      });
      
      if (audioContext && audioContext.state === 'running') {
        audioContext.suspend();
      }
    }

    if (event.data.type === 'VTF_START_CAPTURE') {
      console.log('[VTF Inject] Start capture requested - scanning for audio elements');
      capturePaused = false;
      
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // Re-scan existing audio elements
      document.querySelectorAll('audio[id^="msRemAudio-"]').forEach(audio => {
        if (audio.srcObject || audio.src) {
          console.log(`[VTF Inject] Re-capturing existing element: ${audio.id}`);
          captureAudioElement(audio);
        }
      });
    }
  });
  
  console.log('[VTF Inject] Ready for audio capture with improved processing');
})();