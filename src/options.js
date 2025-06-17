// options.js - Fixed for your original HTML

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.querySelector('button[type="submit"]');
  const testBtn = document.getElementById('testApiKey');
  const saveStatus = document.getElementById('saveStatus');
  
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