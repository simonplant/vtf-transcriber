// inject.js - Enhanced audio capture with stream switching support for VTF
(function() {
  console.log('[VTF Inject] Enhanced script loaded with stream switching support');
  
  let audioContext = null;
  let activeProcessors = new Map();
  let capturePaused = false;
  let workletLoaded = false;
  let capturingTracks = new Set(); // Track active stream+track combinations
  let producerChannels = new Map(); // Map producer IDs to channel info
  let cleanupTimeouts = new Map(); // Debounced cleanup for stream switches
  
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
  
  // Enhanced audio quality assessment with lowered thresholds
  function assessAudioQuality(audioData) {
    const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
    const maxSample = Math.max(...audioData.map(Math.abs));
    const dynamicRange = maxSample / (rms || 0.0001);
    
    let quality = 'poor';
    // Lowered thresholds based on VTF feedback
    if (rms > 0.001 && dynamicRange > 1.5) {
      quality = 'good';
    } else if (rms > 0.0005 || dynamicRange > 1.2) {
      quality = 'fair';  
    }
    
    return {
      quality: quality,
      rms: rms,
      dynamicRange: dynamicRange,
      maxSample: maxSample
    };
  }
  
  // Reliably initialize AudioWorklet with enhanced VAD for VTF
  async function ensureAudioWorkletLoaded() {
    if (workletLoaded) return true;
    
    try {
      if (!audioContext.audioWorklet) {
        throw new Error('AudioWorklet not supported by this browser');
      }
      
      console.log('[VTF Inject] Loading enhanced AudioWorklet module...');
      await audioContext.audioWorklet.addModule(URL.createObjectURL(new Blob([`
        // Enhanced AudioWorklet Processor for VTF with lowered thresholds
        class VTFAudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.audioBuffer = [];
            this.chunkSize = 8000; // 0.5 seconds at 16kHz for faster response
            
            // Enhanced VAD parameters optimized for VTF based on feedback
            this.vadConfig = {
              energyThreshold: 0.001,      // Lowered from 0.005 to capture more speech
              zcrThreshold: 0.5,           // Adjusted for better speech detection
              spectralCentroidThreshold: 800,  // Lowered for more inclusive detection
              spectralRolloffThreshold: 1500,  // Lowered threshold
              voiceProbabilityThreshold: 0.25, // Significantly lowered from 0.6 to 0.25
              adaptiveWindow: 15,          // Faster adaptation for dynamic environment
              hangoverFrames: 2            // Minimal hangover to prevent gaps
            };
            
            // Adaptive thresholding
            this.energyHistory = [];
            this.noiseFloor = 0.001;     // Lower starting noise floor
            this.snrHistory = [];
            this.initialized = false;
            
            // Voice activity state
            this.voiceActivity = false;
            this.hangoverCounter = 0;
            this.consecutiveSilentChunks = 0;
            this.chunkCount = 0;
            
            // Spectral analysis setup
            this.sampleRate = 16000;
            this.fftSize = 256; // Smaller FFT for faster processing
            
            // Listen for configuration updates
            this.port.onmessage = (event) => {
              if (event.data.type === 'configure') {
                this.chunkSize = event.data.chunkSize || 8000;
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
          
          // Enhanced VAD with lowered thresholds
          performVAD(audioData) {
            const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
            const maxSample = Math.max(...audioData.map(Math.abs));
            
            // Update energy history
            this.energyHistory.push(rms);
            if (this.energyHistory.length > this.vadConfig.adaptiveWindow) {
              this.energyHistory.shift();
            }
            
            // Initialize noise floor more aggressively
            if (!this.initialized && this.energyHistory.length >= 5) {
              const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
              this.noiseFloor = Math.max(0.0005, sortedEnergy[0]); // Much lower noise floor
              this.initialized = true;
            }
            
            const zcr = this.calculateZCR(audioData);
            const spectralFeatures = this.calculateSpectralFeatures(audioData);
            const snr = this.noiseFloor > 0 ? 20 * Math.log10(rms / this.noiseFloor) : 0;
            
            this.snrHistory.push(snr);
            if (this.snrHistory.length > 5) this.snrHistory.shift();
            const avgSNR = this.snrHistory.reduce((a, b) => a + b, 0) / this.snrHistory.length;
            
            // Multi-feature voice activity decision with lowered thresholds
            let voiceProbability = 0;
            
            // Energy criterion (more generous)
            if (rms > this.vadConfig.energyThreshold) voiceProbability += 0.4;
            if (rms > this.vadConfig.energyThreshold * 2) voiceProbability += 0.2; // Bonus for strong signal
            
            // ZCR criterion (voice typically has lower ZCR)
            if (zcr < this.vadConfig.zcrThreshold) voiceProbability += 0.2;
            
            // Spectral features (more inclusive)
            if (spectralFeatures.centroid > this.vadConfig.spectralCentroidThreshold) voiceProbability += 0.15;
            
            // SNR criterion (lowered threshold)
            if (avgSNR > 3) voiceProbability += 0.15; // Lowered from 5dB to 3dB
            
            // Dynamic range check
            const dynamicRange = maxSample / (rms || 0.0001);
            if (dynamicRange > 1.5) voiceProbability += 0.1;
            
            // Decision logic with minimal hangover
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
            
            // Quality assessment with lowered thresholds
            let quality = 'poor';
            if (rms > 0.002 && maxSample < 0.95) {
              quality = avgSNR > 8 ? 'good' : 'fair';
            } else if (rms > 0.001) {
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
              this.audioBuffer.push(...audioData);
              
              while (this.audioBuffer.length >= this.chunkSize) {
                const chunk = this.audioBuffer.slice(0, this.chunkSize);
                this.audioBuffer = this.audioBuffer.slice(this.chunkSize);
                this.chunkCount++;
                
                const vadResult = this.performVAD(chunk);
                
                this.port.postMessage({
                  type: 'audioData',
                  audioData: chunk,
                  timestamp: Date.now(),
                  vadResult: vadResult
                });
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

  // Enhanced function to capture audio with proper stream/track tracking
  async function captureAudioElement(audioElement) {
    const streamId = audioElement.id;
    
    if (capturePaused) return;
    
    // Extract detailed stream and track information
    const mediaStream = audioElement.srcObject;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      console.log(`[VTF Inject] No audio tracks found for: ${streamId}`);
      return;
    }
    
    const audioTrack = mediaStream.getAudioTracks()[0];
    const trackId = audioTrack.id;
    const producerId = streamId.replace('msRemAudio-', '');
    
    // Create unique capture key: elementId + streamId + trackId
    const captureKey = `${streamId}:${mediaStream.id}:${trackId}`;
    
    // Check if we're already capturing this specific stream+track combination
    if (capturingTracks.has(captureKey)) {
      console.log(`[VTF Inject] Already capturing: ${captureKey}`);
      return;
    }
    
    // Check if this element has an old processor (stream/track switched)
    if (activeProcessors.has(streamId)) {
      const oldProcessor = activeProcessors.get(streamId);
      if (oldProcessor.captureKey !== captureKey) {
        console.log(`[VTF Inject] Stream switched for ${streamId}: ${oldProcessor.captureKey} → ${captureKey}`);
        stopCapture(streamId); // Clean up old stream immediately
      } else {
        console.log(`[VTF Inject] Same stream+track already captured: ${captureKey}`);
        return;
      }
    }
    
    console.log(`[VTF Inject] Starting enhanced capture: ${captureKey} (producer: ${producerId})`);
    
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
      
      // Create enhanced channel info with full tracking
      const channelInfo = {
        streamId: streamId,
        producerId: producerId,
        trackId: trackId,
        trackLabel: audioTrack.label || `Producer ${producerId.substring(0, 8)}`,
        mediaStreamId: mediaStream.id,
        captureKey: captureKey,
        startTime: Date.now()
      };
      
      // Store producer channel mapping for statistics
      producerChannels.set(producerId, channelInfo);
      
      if (workletSuccess) {
        // Use modern AudioWorklet with enhanced settings
        processor = new AudioWorkletNode(audioContext, 'vtf-audio-processor');
        
        // Configure worklet with optimized settings for VTF
        processor.port.postMessage({
          type: 'configure',
          chunkSize: 8000, // 0.5 seconds for faster response
          vadConfig: {
            energyThreshold: 0.001,    // Lowered based on feedback
            zcrThreshold: 0.5,
            spectralCentroidThreshold: 800,
            spectralRolloffThreshold: 1500,
            voiceProbabilityThreshold: 0.25, // Much lower threshold
            adaptiveWindow: 15,
            hangoverFrames: 2
          }
        });
        
        // Listen for VAD results from the worklet
        processor.port.onmessage = withErrorBoundary((event) => {
          if (event.data.type === 'audioData') {
            const { audioData, timestamp, vadResult } = event.data;
            
            // Enhanced debug logging
            if (window.VTF_DEBUG_CAPTURE) {
              const f = vadResult.features;
              console.debug(`[VTF Inject] ${captureKey} chunk: voice=${vadResult.isVoice}, prob=${vadResult.probability.toFixed(3)}, rms=${f.rms.toFixed(6)}, snr=${f.snr.toFixed(1)}dB, quality=${vadResult.quality}`);
            }
            
            // Send to content script with enhanced channel info
            window.postMessage({
              type: 'VTF_AUDIO_DATA',
              streamId: streamId,
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
        }, `worklet VAD message handling for ${captureKey}`);
        
        console.log(`[VTF Inject] Using enhanced AudioWorklet processor for ${captureKey}`);
        
      } else {
        // Enhanced fallback to ScriptProcessor with lowered thresholds
        processor = audioContext.createScriptProcessor(2048, 1, 1); // Smaller buffer
        let audioBuffer = [];
        let chunkCount = 0;
        const CHUNK_SIZE = 8000; // 0.5 seconds at 16kHz
        
        processor.onaudioprocess = withErrorBoundary((e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          audioBuffer.push(...inputData);
          
          if (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            chunkCount++;
            
            // Enhanced quality assessment with much lower thresholds
            const qualityInfo = assessAudioQuality(chunk);
            
            // Process many more chunks based on VTF feedback
            if (qualityInfo.rms > 0.001 || qualityInfo.maxSample > 0.002) {
              if (window.VTF_DEBUG_CAPTURE) {
                console.debug(`[VTF Inject] ${captureKey} ScriptProcessor #${chunkCount}: rms=${qualityInfo.rms.toFixed(6)}, peak=${qualityInfo.maxSample.toFixed(5)}, quality=${qualityInfo.quality}`);
              }
              
              // Send to content script
              window.postMessage({
                type: 'VTF_AUDIO_DATA',
                streamId: streamId,
                audioData: chunk,
                timestamp: Date.now(),
                chunkId: chunkCount,
                channelInfo: channelInfo,
                maxSample: qualityInfo.maxSample,
                audioQuality: qualityInfo.quality,
                rms: qualityInfo.rms,
                isSilent: qualityInfo.rms < 0.001
              }, '*');
            }
          }
        }, `audio processing for ${captureKey}`);
      }
      
      // Connect pipeline
      source.connect(processor);
      if (processor.connect) {
        processor.connect(audioContext.destination);
      }
      
      // Store for cleanup with enhanced metadata
      activeProcessors.set(streamId, {
        source: source,
        processor: processor,
        captureKey: captureKey,
        trackId: trackId,
        producerId: producerId,
        channelInfo: channelInfo,
        startTime: Date.now()
      });
      
      // Track this capture
      capturingTracks.add(captureKey);
      
      console.log(`[VTF Inject] Enhanced audio pipeline connected for ${captureKey}`);
      
    } catch (error) {
      console.error(`[VTF Inject] Error setting up capture for ${captureKey}:`, error);
    }
  }
  
  // Enhanced function to stop capture with proper cleanup
  function stopCapture(streamId) {
    const processorInfo = activeProcessors.get(streamId);
    if (processorInfo) {
      console.log(`[VTF Inject] Stopping capture for: ${streamId} (${processorInfo.captureKey})`);
      try {
        processorInfo.source.disconnect();
        if (processorInfo.processor.disconnect) {
          processorInfo.processor.disconnect();
        }
        
        // Clean up track tracking
        if (processorInfo.captureKey) {
          capturingTracks.delete(processorInfo.captureKey);
        }
        
        // Clean up producer mapping
        if (processorInfo.producerId) {
          producerChannels.delete(processorInfo.producerId);
        }
        
      } catch (e) {
        console.warn(`[VTF Inject] Error disconnecting ${streamId}:`, e);
      }
      activeProcessors.delete(streamId);
    }
  }
  
  // Enhanced function to handle stopTalking with debounced cleanup
  function handleStopTalking(streamId) {
    // Cancel any existing cleanup timeout
    if (cleanupTimeouts.has(streamId)) {
      clearTimeout(cleanupTimeouts.get(streamId));
    }
    
    // Set a 1.5-second delay before cleanup (shorter for faster response)
    cleanupTimeouts.set(streamId, setTimeout(() => {
      stopCapture(streamId);
      cleanupTimeouts.delete(streamId);
      console.log(`[VTF Inject] Delayed cleanup completed for ${streamId}`);
    }, 1500));
  }
  
  // Enhanced MutationObserver with better stream detection
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
  }, 'enhanced mutation observer'));
  
  // Start observing with enhanced options
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
  
  // Enhanced event listeners
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
      
      // Aggressive re-scan of existing audio elements
      document.querySelectorAll('audio[id^="msRemAudio-"]').forEach(audio => {
        if (audio.srcObject || audio.src) {
          console.log(`[VTF Inject] Re-capturing existing element: ${audio.id}`);
          captureAudioElement(audio);
        }
      });
    }
  });
  
  console.log('[VTF Inject] Enhanced monitoring active - ready for dynamic stream switching');
})();