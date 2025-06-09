export class TranscriptionUI {
  constructor() {
    this.container = null;
    this.contentArea = null;
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

  addTranscription(speaker, text) {
    if (!this.contentArea) return;
    const line = document.createElement('p');
    line.innerHTML = `<strong>${speaker}:</strong> ${text}`;
    this.contentArea.appendChild(line);
    // Auto-scroll to the bottom
    this.contentArea.scrollTop = this.contentArea.scrollHeight;
  }

  showError(message) {
    if (!this.contentArea) return;
    const errorLine = document.createElement('p');
    errorLine.className = 'error';
    errorLine.textContent = `ERROR: ${message}`;
    this.contentArea.appendChild(errorLine);
    this.contentArea.scrollTop = this.contentArea.scrollHeight;
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
    `;
    document.head.appendChild(style);
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