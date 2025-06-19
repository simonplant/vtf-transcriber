/**
 * @file options.js
 * @path src/options.js
 * @description Configuration management for API keys, session backup/restore, and extension settings
 * @modified 2025-01-27
 */

// options.js - Fixed for your original HTML

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.querySelector('button[type="submit"]');
  const testBtn = document.getElementById('testApiKey');
  const saveStatus = document.getElementById('saveStatus');
  
  // Session management elements
  const backupBtn = document.getElementById('backupSession');
  const restoreBtn = document.getElementById('restoreSession');
  const sessionStatus = document.getElementById('sessionStatus');
  const sessionFileInput = document.getElementById('sessionFileInput');
  const currentTranscripts = document.getElementById('currentTranscripts');
  const currentSpeakers = document.getElementById('currentSpeakers');
  const sessionDuration = document.getElementById('sessionDuration');
  
  console.log('[Options] DOM loaded, elements found:', {
    apiKeyInput: !!apiKeyInput,
    saveBtn: !!saveBtn,
    testBtn: !!testBtn,
    saveStatus: !!saveStatus
  });
  
  // Check if API key exists without retrieving it
  chrome.storage.local.get(['openaiApiKey'], (result) => {
    if (result.openaiApiKey && result.openaiApiKey.trim()) {
      apiKeyInput.placeholder = 'API key is configured - enter new key to replace';
      showStatus('API key is configured', 'success');
    } else {
      apiKeyInput.placeholder = 'Enter your OpenAI API key';
      showStatus('No API key configured', 'error');
    }
  });
  
  // Load session statistics
  updateSessionStats();
  
  // Save settings
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      console.log('[Options] Save button clicked');
      
      const apiKey = apiKeyInput.value.trim();
      console.log('[Options] API key length:', apiKey.length);
      
      if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
      }
      
      if (!apiKey.startsWith('sk-')) {
        showStatus('Invalid API key format. Should start with "sk-"', 'error');
        return;
      }
      
      // Save to Chrome storage
      chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Options] Storage error:', chrome.runtime.lastError);
          showStatus('Error saving API key: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        
        console.log('[Options] API key saved to storage');
        
        // Verify it was saved
        chrome.storage.local.get(['openaiApiKey'], (verify) => {
          console.log('[Options] Verification:', {
            saved: !!verify.openaiApiKey,
            matches: verify.openaiApiKey === apiKey
          });
        });
        
        // Also notify background script
        chrome.runtime.sendMessage({
          type: 'setApiKey',
          apiKey: apiKey
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Options] Message error:', chrome.runtime.lastError);
            // Still show success if storage worked
            showStatus('API key saved (background update failed)', 'warning');
          } else {
            console.log('[Options] Background response:', response);
            showStatus('API key saved successfully!', 'success');
          }
        });
      });
      
      // Clear the input field after saving for security
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'API key saved - enter new key to replace';
    });
  }
  
  // Test API key button
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const keyToTest = apiKeyInput.value.trim();
      
      if (!keyToTest) {
        // Test existing stored key
        const result = await chrome.storage.local.get(['openaiApiKey']);
        if (!result.openaiApiKey) {
          showStatus('No API key to test', 'error');
          return;
        }
        await testApiKey(result.openaiApiKey);
      } else {
        // Test the key being entered
        await testApiKey(keyToTest);
      }
    });
  }
  
  async function testApiKey(apiKey) {
    showStatus('Testing API key...', 'info');
    
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        showStatus('API key is valid and working!', 'success');
      } else if (response.status === 401) {
        showStatus('API key is invalid or expired', 'error');
      } else {
        showStatus(`API test failed: ${response.status} ${response.statusText}`, 'error');
      }
    } catch (error) {
      showStatus(`Network error testing API key: ${error.message}`, 'error');
    }
  }
  
  // Session Management Functions
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      console.log('[Options] Backup button clicked');
      
      chrome.runtime.sendMessage({type: 'exportSessionData'}, (response) => {
        if (chrome.runtime.lastError) {
          showSessionStatus('Failed to create backup: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        
        if (!response || !response.sessionData) {
          showSessionStatus('No session data available for backup', 'error');
          return;
        }
        
        const sessionData = response.sessionData;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Create and download file
        const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vtf-session-backup-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showSessionStatus(`Session backup created (${sessionData.transcriptions.length} transcripts)`, 'success');
      });
    });
  }
  
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      sessionFileInput.click();
    });
  }
  
  if (sessionFileInput) {
    sessionFileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const sessionData = JSON.parse(e.target.result);
          
          // Validate session data structure
          if (!sessionData.transcriptions || !Array.isArray(sessionData.transcriptions)) {
            showSessionStatus('Invalid backup file format', 'error');
            return;
          }
          
          // Send to background script for restoration
          chrome.runtime.sendMessage({type: 'importSessionData', sessionData: sessionData}, (response) => {
            if (chrome.runtime.lastError) {
              showSessionStatus('Failed to restore session: ' + chrome.runtime.lastError.message, 'error');
              return;
            }
            
            showSessionStatus(`Session restored successfully (${sessionData.transcriptions.length} transcripts)`, 'success');
            updateSessionStats(); // Refresh stats after restore
          });
          
        } catch (error) {
          showSessionStatus('Error reading backup file: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
      
      // Clear the input for next use
      event.target.value = '';
    });
  }
  
  function updateSessionStats() {
    chrome.runtime.sendMessage({type: 'getTranscriptions'}, (response) => {
      if (chrome.runtime.lastError || !response) return;
      
      const transcripts = response.transcriptions || [];
      if (currentTranscripts) currentTranscripts.textContent = transcripts.length;
      
      // Count unique speakers
      const speakers = new Set(transcripts.map(t => t.speaker)).size;
      if (currentSpeakers) currentSpeakers.textContent = speakers;
      
      // Calculate duration
      if (transcripts.length > 0) {
        const start = new Date(transcripts[0].timestamp);
        const end = new Date(transcripts[transcripts.length - 1].timestamp);
        const durationMs = end - start;
        const durationMins = Math.round(durationMs / 60000);
        if (sessionDuration) sessionDuration.textContent = `${durationMins}m`;
      } else {
        if (sessionDuration) sessionDuration.textContent = '0m';
      }
    });
  }
  
  function showStatus(message, type) {
    console.log('[Options] Status:', type, message);
    
    saveStatus.textContent = message;
    saveStatus.className = 'vtf-message vtf-message-' + type;
    saveStatus.classList.remove('vtf-hidden');
    
    if (type === 'error') {
      saveStatus.style.color = 'var(--danger)';
    } else if (type === 'warning') {
      saveStatus.style.color = 'var(--warning)';
    } else if (type === 'info') {
      saveStatus.style.color = 'var(--info)';
    } else {
      saveStatus.style.color = 'var(--success)';
    }
    
    setTimeout(() => {
      saveStatus.classList.add('vtf-hidden');
    }, 3000);
  }
  
  function showSessionStatus(message, type) {
    console.log('[Options] Session Status:', type, message);
    
    sessionStatus.textContent = message;
    sessionStatus.className = 'vtf-message vtf-message-' + type;
    sessionStatus.classList.remove('vtf-hidden');
    
    setTimeout(() => {
      sessionStatus.classList.add('vtf-hidden');
    }, 4000);
  }
  
  // Debug helper - Press Ctrl+Shift+D
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      chrome.storage.local.get(null, (items) => {
        console.log('[Options] All storage:', items);
        const debugInfo = {
          'API Key': items.openaiApiKey ? `Set (${items.openaiApiKey.length} chars)` : 'Not set',
          'Storage Keys': Object.keys(items).join(', ')
        };
        alert('Storage Debug:\n' + Object.entries(debugInfo).map(([k, v]) => `${k}: ${v}`).join('\n'));
      });
    }
  });
});