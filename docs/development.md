# Development Guide

This guide explains how to work with the VTF Audio Transcriber Chrome extension.

## Project Structure

```
src/
├── background.js     # Main service worker
├── offscreen.js      # Audio recording logic
├── popup.js          # User interface
├── options.js        # Settings management
├── popup.html        # Popup interface
├── options.html      # Options page
└── manifest.json     # Extension manifest
```

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/simonplant/vtf-transcriber.git
   cd vtf-transcriber
   ```

2. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `src` directory

## Development Workflow

1. Make changes to the source files in the `src` directory
2. The extension will automatically reload when you make changes
3. Test your changes in Chrome
4. Use Chrome's developer tools to debug:
   - Service worker: chrome://serviceworker-internals
   - Extension: chrome://extensions (click "inspect views")

## Testing

### Manual Testing

1. Start recording:
   - Click the extension icon
   - Click "Start Recording"
   - Verify the recording indicator appears
   - Check that audio is being captured

2. Stop recording:
   - Click "Stop Recording"
   - Verify the recording stops
   - Check that resources are cleaned up

3. Test transcription:
   - Start recording
   - Speak or play audio
   - Verify notifications appear with transcriptions
   - Check transcription accuracy

### Debugging

1. Service Worker:
   - Open chrome://serviceworker-internals
   - Find the extension's service worker
   - Click "inspect" to open DevTools

2. Popup:
   - Right-click the extension icon
   - Click "inspect popup"

3. Options Page:
   - Open the options page
   - Right-click and select "inspect"

## Common Issues

1. Audio Capture:
   - Ensure the tab has audio playing
   - Check that the tab is not a chrome:// page
   - Verify microphone permissions if needed

2. Transcription:
   - Check that the API key is set
   - Verify internet connection
   - Check API rate limits

3. Extension Loading:
   - Clear browser cache
   - Reload the extension
   - Check manifest.json for errors

## Best Practices

1. Code Style:
   - Use consistent formatting
   - Add comments for complex logic
   - Keep functions focused and small

2. Error Handling:
   - Always handle promises
   - Show user-friendly error messages
   - Clean up resources properly

3. Security:
   - Never log sensitive data
   - Validate all user input
   - Use secure storage for API keys

## Deployment

1. Package the extension:
   ```bash
   make package
   ```

2. The packaged extension will be in the `release` directory

3. Submit to Chrome Web Store:
   - Create a zip file of the contents
   - Upload to the Chrome Web Store
   - Fill in store listing details
   - Submit for review 