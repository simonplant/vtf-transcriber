// options.js - Fixed for your original HTML

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');
  const toggleVisibility = document.getElementById('toggleVisibility');
  
  console.log('[Options] DOM loaded, elements found:', {
    apiKeyInput: !!apiKeyInput,
    saveBtn: !!saveBtn,
    saveStatus: !!saveStatus,
    toggleVisibility: !!toggleVisibility
  });
  
  // Load existing API key
  chrome.storage.local.get(['openaiApiKey'], (result) => {
    console.log('[Options] Storage check:', {
      hasKey: !!result.openaiApiKey,
      keyLength: result.openaiApiKey ? result.openaiApiKey.length : 0
    });
    
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
  });
  
  // Toggle password visibility
  if (toggleVisibility) {
    toggleVisibility.addEventListener('change', () => {
      if (toggleVisibility.checked) {
        apiKeyInput.type = 'text';
      } else {
        apiKeyInput.type = 'password';
      }
    });
  }
  
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
    });
  }
  
  function showStatus(message, type) {
    console.log('[Options] Status:', type, message);
    
    saveStatus.textContent = message;
    saveStatus.className = 'save-status show';
    
    if (type === 'error') {
      saveStatus.style.color = 'var(--danger)';
    } else if (type === 'warning') {
      saveStatus.style.color = 'var(--warning)';
    } else {
      saveStatus.style.color = 'var(--success)';
    }
    
    setTimeout(() => {
      saveStatus.classList.remove('show');
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