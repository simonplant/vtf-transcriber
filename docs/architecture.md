# VTF Audio Transcriber Architecture

This document describes the architecture of the VTF Audio Transcriber Chrome extension, which uses the tabCapture API and Offscreen Documents for audio capture and transcription.

## Overview

The extension uses a modern architecture that captures audio directly from browser tabs without injecting any code into the target page. This approach is more reliable and secure than content script injection.

## Core Components

### 1. Background Service Worker (background.js)

The service worker is the central coordinator of the extension:

- Manages the tab capture process
- Handles communication with the offscreen document
- Makes API calls to OpenAI's Whisper service
- Shows notifications with transcription results

Key features:
- Uses `chrome.tabCapture.getMediaStreamId()` to get audio stream references
- Creates and manages the offscreen document
- Handles API key storage and validation
- Manages the extension's state (recording status, active tab)

### 2. Offscreen Document (offscreen.js)

The offscreen document handles audio recording:

- Receives the stream ID from the service worker
- Uses `navigator.mediaDevices.getUserMedia()` to access the audio stream
- Implements `MediaRecorder` to capture audio in chunks
- Sends audio blobs back to the service worker

Key features:
- Records audio in 5-second chunks for faster transcription
- Uses WebM format with Opus codec for efficient audio capture
- Handles cleanup of media resources

### 3. User Interface

#### Popup (popup.html, popup.js)

A simple interface for controlling the recording:

- Start/Stop recording buttons
- Status display
- No complex configuration needed

#### Options Page (options.html, options.js)

Manages extension settings:

- OpenAI API key configuration
- Secure storage of credentials

## Data Flow

1. User clicks "Start Recording" in the popup
2. Service worker gets the tab's audio stream ID
3. Service worker creates offscreen document
4. Offscreen document starts recording audio
5. Every 5 seconds, audio chunks are sent to the service worker
6. Service worker sends chunks to OpenAI for transcription
7. Transcription results are shown as notifications
8. User can stop recording at any time

## Security Considerations

- No code is injected into target pages
- API key is stored securely in chrome.storage.local
- Audio processing is isolated in the offscreen document
- Minimal permissions required

## Performance

- Efficient audio capture using WebM/Opus
- Small audio chunks for faster transcription
- No impact on target page performance
- Minimal memory usage

## Error Handling

- Graceful handling of API errors
- Clear user notifications for issues
- Automatic cleanup of resources
- Recovery from tab closure 