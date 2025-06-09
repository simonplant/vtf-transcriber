export class TranscriptionUI {
  constructor() {
    this.container = null;
    this.contentArea = null;
    this.lastSpeaker = null;
    this.lastMessageTimestamp = 0;
    this.lastMessageElement = null;
    this.performanceMetrics = {
      updateCount: 0,
      totalTime: 0,
      slowUpdates: 0
    };
    this.createUI();
  }

  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'vtf-transcription-ui';
    this.container.innerHTML = `
      <div id="vtf-transcription-header">Live Transcription</div>
      <div id="vtf-transcription-content"></div>
    `;
    document.body.appendChild(this.container);
    this.contentArea = document.getElementById('vtf-transcription-content');
    this.makeDraggable(this.container, document.getElementById('vtf-transcription-header'));
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #vtf-transcription-ui {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        height: 250px;
        background-color: rgba(20, 20, 20, 0.9);
        border: 1px solid #444;
        border-radius: 8px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        font-family: sans-serif;
        color: #eee;
        font-size: 14px;
      }
      #vtf-transcription-header {
        background-color: #333;
        color: #fff;
        padding: 8px;
        font-weight: bold;
        cursor: move;
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
      }
      #vtf-transcription-content {
        padding: 10px;
        flex-grow: 1;
        overflow-y: auto;
      }
      #vtf-transcription-content p {
        margin: 0 0 8px 0;
        line-height: 1.4;
      }
      #vtf-transcription-content p.error {
        color: #ff8a8a;
        font-weight: bold;
      }
      .speaker-name { 
        font-weight: bold; 
        color: #8ab4f8; 
      }
      .message-block { 
        margin-bottom: 12px; 
      }
      .message-content { 
        padding-left: 10px; 
      }
    `;
    document.head.appendChild(style);
  }

  sanitizeText(text) {
    return text
      .replace(/[<>]/g, '') // Remove potential HTML
      .replace(/&/g, '&amp;') // Escape HTML entities
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .trim();
  }

  sanitizeSpeaker(speaker) {
    return this.sanitizeText(speaker).substring(0, 50); // Limit speaker name length
  }
  
  addTranscription(speaker, text) {
    if (!this.contentArea) return;

    const start = performance.now();
    const sanitizedSpeaker = this.sanitizeSpeaker(speaker);
    const sanitizedText = this.sanitizeText(text);

    const now = Date.now();
    const isNewBlock = sanitizedSpeaker !== this.lastSpeaker || 
                      (now - this.lastMessageTimestamp > 10000);

    try {
      if (isNewBlock) {
        const messageBlock = document.createElement('div');
        messageBlock.className = 'message-block';
        
        const speakerElement = document.createElement('div');
        speakerElement.className = 'speaker-name';
        speakerElement.textContent = sanitizedSpeaker;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        contentElement.textContent = sanitizedText;
        
        messageBlock.appendChild(speakerElement);
        messageBlock.appendChild(contentElement);
        this.contentArea.appendChild(messageBlock);
        
        this.lastMessageElement = contentElement;
      } else {
        if (this.lastMessageElement) {
          this.lastMessageElement.textContent += ' ' + sanitizedText;
        }
      }

      this.lastSpeaker = sanitizedSpeaker;
      this.lastMessageTimestamp = now;
      this.contentArea.scrollTop = this.contentArea.scrollHeight;

      // Performance monitoring
      const duration = performance.now() - start;
      this.performanceMetrics.updateCount++;
      this.performanceMetrics.totalTime += duration;
      
      if (duration > 100) {
        this.performanceMetrics.slowUpdates++;
        console.warn(`[UI] Slow transcription update: ${duration.toFixed(2)}ms`);
      }

      // Log performance metrics every 100 updates
      if (this.performanceMetrics.updateCount % 100 === 0) {
        const avgTime = this.performanceMetrics.totalTime / this.performanceMetrics.updateCount;
        console.log(`[UI] Performance metrics:
          Updates: ${this.performanceMetrics.updateCount}
          Average time: ${avgTime.toFixed(2)}ms
          Slow updates: ${this.performanceMetrics.slowUpdates}
        `);
      }
    } catch (error) {
      console.error('[UI] Error adding transcription:', error);
      this.showError('Failed to update transcription');
    }
  }

  showError(message) {
    if (!this.contentArea) return;
    try {
      const errorLine = document.createElement('p');
      errorLine.className = 'error';
      errorLine.textContent = `ERROR: ${this.sanitizeText(message)}`;
      this.contentArea.appendChild(errorLine);
      this.contentArea.scrollTop = this.contentArea.scrollHeight;
    } catch (error) {
      console.error('[UI] Error showing error message:', error);
    }
  }

  makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = (e) => {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => {
        document.onmouseup = null;
        document.onmousemove = null;
      };
      document.onmousemove = (e) => {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
      };
    };
  }
} 