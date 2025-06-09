// src/content.js

// These imports will be resolved by Webpack
import { VTFGlobalsFinder } from './vtf-globals-finder.js';
import { VTFStreamMonitor } from './vtf-stream-monitor.js';
import { VTFAudioCapture } from './vtf-audio-capture.js';
import { TranscriptionUI } from './transcription-ui.js';

// Guard against double injection
if (window.vtfExtensionInitialized) {
  console.log('[VTF Extension] Already initialized, skipping.');
} else {
  window.vtfExtensionInitialized = true;

  class VTFAudioExtension {
    constructor() {
      this.audioCapture = new VTFAudioCapture();
      this.transcriptionUI = new TranscriptionUI();
      this.streamMonitor = new VTFStreamMonitor();
      this.globalsFinder = new VTFGlobalsFinder();
      this.recoveryAttempts = 0;
      this.maxRecoveryAttempts = 3;
      this.heartbeatInterval = null;
      this.isInitialized = false;
    }
    
    async init() {
      if (this.isInitialized) {
        console.log('[Content] Extension already initialized');
        return;
      }

      try {
        await this.globalsFinder.initialize();
        await this.streamMonitor.initialize(this.globalsFinder);
        await this.audioCapture.initialize();
        await this.transcriptionUI.initialize();
        
        this.setupMessageHandlers();
        this.startHeartbeat();
        this.startResourceMonitoring();
        
        this.isInitialized = true;
        this.recoveryAttempts = 0;
        
        console.log('[Content] Extension initialized successfully');
      } catch (error) {
        console.error('[Content] Initialization error:', error);
        this.attemptRecovery();
      }
    }
    
    async attemptRecovery() {
      if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
        console.error('[VTF Extension] Max recovery attempts reached. Please reload the page.');
        this.transcriptionUI.showError('Failed to initialize. Please reload the page.');
        return;
      }

      this.recoveryAttempts++;
      console.log(`[VTF Extension] Attempting recovery (${this.recoveryAttempts}/${this.maxRecoveryAttempts})...`);
      
      try {
        // Reset state
        this.audioCapture.stopAll();
        this.streamMonitor.reset();
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Retry initialization
        await this.init();
      } catch (error) {
        console.error('[VTF Extension] Recovery failed:', error);
        await this.attemptRecovery();
      }
    }

    startResourceMonitoring() {
      setInterval(() => {
        const activeStreams = this.streamMonitor.getActiveStreams();
        const activeCaptures = this.audioCapture.getActiveCaptures();
        
        console.log(`[VTF Extension] Resource Status:
          Active Streams: ${activeStreams}
          Active Captures: ${activeCaptures}
        `);

        // Check for resource leaks
        if (activeStreams !== activeCaptures) {
          console.warn('[VTF Extension] Resource mismatch detected');
          this.cleanupResources();
        }
      }, 30000); // Check every 30 seconds
    }

    cleanupResources() {
      console.log('[VTF Extension] Cleaning up resources...');
      this.audioCapture.stopAll();
      this.streamMonitor.reset();
    }
    
    scanExistingElements() {
      const elements = document.querySelectorAll('audio[id^="msRemAudio-"]');
      console.log(`[VTF Extension] Found ${elements.length} existing audio element(s) on scan.`);
      elements.forEach(element => this.handleNewAudioElement(element));
    }
    
    async findGlobalsForEnhancements() {
      const globalsFound = await this.globalsFinder.waitForGlobals(60, 500);
      if (globalsFound) {
        console.log('[VTF Extension] VTF globals found. Enhanced features (volume sync, etc.) are now enabled.');
        // Here you would initialize any features that DEPEND on globals,
        // like the VTFStateMonitor.
        // this.stateMonitor.startSync(this.globalsFinder, 1000);
      } else {
        console.warn('[VTF Extension] VTF globals not found. Running in core capture mode only.');
      }
    }
    
    setupDOMObserver() {
      this.observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (this.isVTFAudioElement(node)) {
              this.handleNewAudioElement(node);
            }
          });
        });
      });
      const target = document.getElementById('topRoomDiv') || document.body;
      this.observer.observe(target, { childList: true, subtree: false });
    }
    
    isVTFAudioElement(node) {
      return node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'AUDIO' && node.id && node.id.startsWith('msRemAudio-');
    }
    
    handleNewAudioElement(element) {
      const userId = element.id.replace('msRemAudio-', '');
      console.log(`[VTF Extension] New audio element detected: ${userId}`);
      this.streamMonitor.startMonitoring(element, userId, (stream) => {
        this.handleStreamAssigned(element, stream, userId);
      });
    }
    
    async handleStreamAssigned(element, stream, userId) {
      console.log(`[VTF Extension] Stream assigned to ${userId}`);
      try {
        await this.audioCapture.captureStream(stream, userId);
      } catch (error) {
        console.error(`[VTF Extension] Failed to capture ${userId}:`, error);
      }
    }

    setupMessageHandlers() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender)
          .then(sendResponse)
          .catch(error => {
            console.error('[Content] Message handling error:', error);
            sendResponse({ error: error.message });
          });
        return true;
      });
    }

    async handleMessage(request, sender) {
      switch (request.type) {
        case 'startCapture':
          await this.startCapture();
          return { started: true };

        case 'stopCapture':
          await this.stopCapture();
          return { stopped: true };

        case 'getStatus':
          return {
            isInitialized: this.isInitialized,
            streamCount: this.audioCapture.getActiveCaptures(),
            hasUI: this.transcriptionUI.isVisible()
          };

        default:
          throw new Error('Unknown message type');
      }
    }

    async startCapture() {
      if (!this.isInitialized) {
        await this.init();
      }

      const streams = await this.streamMonitor.getActiveStreams();
      for (const stream of streams) {
        await this.audioCapture.captureStream(stream.stream, stream.userId);
      }

      this.transcriptionUI.show();
    }

    async stopCapture() {
      await this.audioCapture.stopAll();
      this.transcriptionUI.hide();
    }

    startHeartbeat() {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      this.heartbeatInterval = setInterval(() => {
        const streamCount = this.audioCapture.getActiveCaptures();
        chrome.runtime.sendMessage({
          type: 'heartbeat',
          data: { streamCount }
        }).catch(error => {
          console.error('[Content] Heartbeat error:', error);
          // If we can't send heartbeat, try to recover
          this.attemptRecovery();
        });
      }, 5000); // Send heartbeat every 5 seconds
    }

    async shutdown() {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      try {
        await this.audioCapture.stopAll();
        this.transcriptionUI.remove();
        this.isInitialized = false;
        console.log('[Content] Extension shutdown complete');
      } catch (error) {
        console.error('[Content] Shutdown error:', error);
        throw error;
      }
    }
  }
  
  // Ensure the script runs after the DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const extension = new VTFAudioExtension();
      extension.init().catch(error => {
        console.error('[Content] Failed to initialize extension:', error);
      });
    });
  } else {
    const extension = new VTFAudioExtension();
    extension.init().catch(error => {
      console.error('[Content] Failed to initialize extension:', error);
    });
  }
}