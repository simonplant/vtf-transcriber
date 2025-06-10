const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusElement = document.getElementById('status');

startButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'startCapture', target: 'background', tabId: tab.id });
  window.close();
});

stopButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stopCapture', target: 'background' });
  window.close();
});

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus', target: 'background', tabId: tab.id });
    if (response && response.isActive) {
      statusElement.textContent = `Status: Recording`;
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
    } else {
      statusElement.textContent = `Status: Inactive`;
    }
  } catch (e) {
    statusElement.textContent = 'Status: Ready to start.';
  }
});