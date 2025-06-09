// src/content.js

// These imports will be resolved by Webpack
import { VTFGlobalsFinder } from './vtf-globals-finder.js';
import { VTFStreamMonitor } from './vtf-stream-monitor.js';
import { VTFAudioCapture } from './vtf-audio-capture.js';
import { TranscriptionUI } from './transcription-ui.js';

class VTFAudioExtension {
    constructor() {
      this.globalsFinder = new VTFGlobalsFinder();
      this.audioCapture = new VTFAudioCapture();
      this.streamMonitor = new VTFStreamMonitor();
      this.ui = new TranscriptionUI();
    }
    
    async init() {
      console.log('[VTF Extension] Initializing...');
      const globalsFound = await this.globalsFinder.waitForGlobals(60, 500);
      if (!globalsFound) {
        console.error('[VTF Extension] Failed to find VTF globals');
        return;
      }
      
      await this.audioCapture.initialize();
      this.setupDOMObserver();
      this.setupMessageHandlers();
      console.log('[VTF Extension] Initialization complete');
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