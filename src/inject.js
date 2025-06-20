/**
 * @file inject.js
 * @path src/inject.js
 * @description Direct audio stream capture from VTF platform with enhanced Voice Activity Detection
 * @modified 2025-06-18
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
  let pendingProcessors = new Set(); // Prevent race conditions during setup
  let capturePaused = false;
  let workletLoaded = false;
  let vtfWorkletUrl = null; // Cache the worklet URL once received
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
      pendingProcessors.clear(); // Also clear pending processors
      
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
  
  /**
   * Securely requests the AudioWorklet URL from the content script via postMessage.
   * This avoids CSP violations and caches the URL for subsequent requests.
   * @returns {Promise<string>} A promise that resolves with the worklet URL.
   */
  function getWorkletUrl() {
    // Return the cached URL if we already have it.
    if (vtfWorkletUrl) return Promise.resolve(vtfWorkletUrl);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timeout: Did not receive worklet URL from content script.'));
      }, 5000); // 5-second timeout for a response.

      const handleMessage = (event) => {
        if (event.source === window && event.data && event.data.type === 'VTF_WORKLET_URL') {
          console.log('[VTF Inject] Received worklet URL from content script.');
          vtfWorkletUrl = event.data.url; // Cache the URL.
          
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
          resolve(vtfWorkletUrl);
        }
      };

      window.addEventListener('message', handleMessage);

      // Request the URL from the content script.
      console.log('[VTF Inject] Requesting worklet URL from content script...');
      window.postMessage({ type: 'VTF_REQUEST_WORKLET_URL' }, window.location.origin);
    });
  }

  // Reliably initialize AudioWorklet with proper VAD for VTF
  async function ensureAudioWorkletLoaded() {
    if (workletLoaded) return true;
    
    try {
      if (!audioContext.audioWorklet) {
        throw new Error('AudioWorklet not supported by this browser');
      }

      // --- FIX: Asynchronously request the URL from the content script ---
      const workletURL = await getWorkletUrl();
      
      if (!workletURL) {
          throw new Error('Failed to get the worklet URL from the content script.');
      }
      
      console.log('[VTF Inject] Loading enhanced AudioWorklet module from:', workletURL);
      await audioContext.audioWorklet.addModule(workletURL);
      
      workletLoaded = true;
      console.log('[VTF Inject] AudioWorklet module loaded successfully');
      return true;
      
    } catch (error) {
      // This is where the error was previously happening.
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
      // This is not an error, the stream might not be ready yet.
      return;
    }
    
    // Check if we already have a processor or one is being set up
    if (activeProcessors.has(elementId) || pendingProcessors.has(elementId)) {
      return;
    }
    
    const audioTrack = mediaStream.getAudioTracks()[0];
    const trackId = audioTrack.id;
    const producerId = elementId.replace('msRemAudio-', '');
    
    console.log(`[VTF Inject] Starting capture for element: ${elementId} (track: ${trackId})`);
    
    try {
      pendingProcessors.add(elementId); // Add lock to prevent race conditions

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
      
      if (!workletSuccess) {
        console.error('[VTF Inject] AudioWorklet is required. This browser is not supported.');
        showNotification('Your browser does not support AudioWorklet. Please use a modern Chrome browser.', 'error');
        pendingProcessors.delete(elementId); // Release lock
        return; // Exit early - don't attempt capture
      }

      // Create audio source
      const source = audioContext.createMediaStreamSource(mediaStream);
      
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
      
      // Create AudioWorklet (the only path)
      const processor = new AudioWorkletNode(audioContext, 'vtf-audio-processor');
        
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
            
          // Assess audio quality before sending
          const qualityMetrics = assessAudioQuality(audioData);

          window.postMessage({
            type: 'VTF_AUDIO_DATA',
            streamId: elementId,
            audioData: audioData,
            timestamp: timestamp,
            vadResult: vadResult,
            quality: qualityMetrics, // Send quality metrics
            channelInfo: channelInfo
          }, '*');
        } else if (event.data.type === 'stoppedTalking') {
            // Handle end-of-speech event from the worklet
            handleStopTalking(elementId);
        }
      }, `worklet message handling for ${elementId}`);

      // Connect pipeline
      source.connect(processor);
      if (processor.connect) {
        // This is a subtle but important check. AudioWorkletNodes do not need
        // to be connected to the destination to function, but doing so can
        // prevent garbage collection in some browser versions.
        processor.connect(audioContext.destination);
      }
      
      // Store the active processor
      activeProcessors.set(elementId, {
        source, 
        processor, 
        startTime: Date.now(), 
        channelInfo: channelInfo,
        lastActivity: Date.now()
      });

      // Remove the lock
      pendingProcessors.delete(elementId);

      // Cancel any pending cleanup for this stream
      if (cleanupTimeouts.has(elementId)) {
        clearTimeout(cleanupTimeouts.get(elementId));
        cleanupTimeouts.delete(elementId);
      }
      
      console.log(`[VTF Inject] Successfully started capture for ${elementId}`);

    } catch (error) {
      console.error(`[VTF Inject] Error capturing element ${elementId}:`, error);
      pendingProcessors.delete(elementId); // Release lock on error
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
      // Also remove from pending, in case it was being set up
      pendingProcessors.delete(elementId);
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
          
          const tryCapture = () => {
            // The pendingProcessors lock in captureAudioElement will prevent duplicates
            captureAudioElement(node);
          };

          // Attempt to capture if srcObject is already available.
          if (node.srcObject) {
            tryCapture();
          }

          // The `play` event listener on `document` will handle most cases.
          // We add a 'loadedmetadata' listener as a fallback for when the stream is attached later.
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