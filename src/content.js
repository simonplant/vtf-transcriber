// src/content.js

// These imports will be resolved by Webpack
import { VTFGlobalsFinder } from './vtf-globals-finder.js';
import { VTFStreamMonitor } from './vtf-stream-monitor.js';
import { VTFAudioCapture } from './vtf-audio-capture.js';
import { TranscriptionUI } from './transcription-ui.js';

class VTFAudioExtension {
    constructor() {
      this.ui = new TranscriptionUI();
      this.globalsFinder = new VTFGlobalsFinder();
      this.audioCapture = new VTFAudioCapture();
      this.streamMonitor = new VTFStreamMonitor();
    }
    
    async init() {
      try {
        // This is the unconditional entry point, running after programmatic injection.
        console.log('[VTF Extension] Initializing...');
        
        // --- BEST PRACTICE SEQUENCE ---

        // STEP 1 & 2: Initialize core systems that Observe and Scan immediately.
        // This part is lean and has no external dependencies on page state.
        await this.audioCapture.initialize(); // Prepares the AudioContext
        if (!this.audioCapture.workletReady) {
          throw new Error('AudioWorklet could not be initialized.');
        }
        
        this.setupDOMObserver(); // STEP 1: Starts *observing* for future elements.
        this.scanExistingElements(); // STEP 2: *Scans* for current elements.
        
        this.setupMessageHandlers();
        
        console.log('[VTF Extension] Core capture system is LIVE.');
        
        // STEP 3: Decouple non-essential enhancements.
        // This runs in parallel and does not block the core logic above.
        this.findGlobalsForEnhancements();

      } catch (error) {
        console.error('[VTF Extension] CRITICAL ERROR:', error);
        this.ui.showError(error.message);
      }
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
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (this.isVTFAudioElement(node)) {
              this.handleNewAudioElement(node);
            }
          });
        });
      });
      const target = document.getElementById('topRoomDiv') || document.body;
      observer.observe(target, { childList: true, subtree: false });
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
        if (request.type === 'transcription') {
          const { speaker, text } = request.data;
          this.ui.addTranscription(speaker, text);
        } else if (request.type === 'transcription-error') {
          this.ui.showError(request.data.message);
        }
      });
    }
  }
  
  // Ensure the script runs after the DOM is loaded
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => new VTFAudioExtension().init());
  } else {
      new VTFAudioExtension().init();
  }