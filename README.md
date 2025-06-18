# VTF Audio Transcriber

A sophisticated Chrome extension designed for Virtual Trading Floor (VTF) environments that provides real-time audio transcription, intelligent conversation analysis, and comprehensive session documentation.

## 🎯 Overview

The VTF Audio Transcriber transforms live trading room audio into structured, searchable transcripts with intelligent conversation detection and professional reporting capabilities. Built specifically for financial trading environments, it handles multiple speakers, session continuity, and provides both real-time monitoring and end-of-day documentation.

**Current Version**: 0.6.0 - Features enhanced audio visualization, Voice Activity Detection (VAD), and redesigned dashboard with 4-column layout.

## ✨ Key Features

### 🎙️ **Advanced Audio Capture**
- **Multi-speaker detection** with automatic speaker identification
- **Voice Activity Detection (VAD)** with spectral analysis and SNR monitoring
- **Adaptive audio chunking** based on conversation activity levels
- **Real-time audio level visualization** with waveform display and grid references
- **Audio quality assessment** with clipping detection and noise analysis
- **High-quality audio processing** with dynamic range compression and spectral gating
- **Real-time buffer management** with memory optimization
- **Automatic session continuity** across browser refreshes

### 🤖 **Intelligent Transcription**
- **OpenAI Whisper integration** for industry-leading accuracy
- **Smart transcript merging** to reduce redundancy
- **Context-aware processing** with conversation assembly
- **Retry logic with exponential backoff** for reliability
- **Performance monitoring** with API call tracking

### 💬 **Conversation Intelligence**
- **Automatic conversation grouping** (10-second gap detection)
- **Conversation type classification**:
  - **Soliloquy**: Single speaker analysis (>15 seconds)
  - **Exchange**: Two-person discussions
  - **Group Discussion**: Multi-participant conversations
- **Speaker activity tracking** with real-time status
- **Session metadata** including duration and participant lists

### 📊 **Real-time Monitoring**
- **Live dashboard** with redesigned 4-column metrics layout
- **Audio level waveform** with real-time visualization and reference grids
- **Voice Activity Detection metrics** (confidence, SNR, spectral centroid)
- **Audio quality assessment** (excellent/good/fair/poor with detailed tooltips)
- **Clipping detection** and noise level monitoring (High/Medium/Low)
- **Processing status** with buffer visualization and active speaker tracking
- **Session cost tracking** with Whisper API pricing
- **Channel monitoring** with multi-track audio support
- **Performance metrics** with API response times and error rates

### 📋 **Export & Documentation**
- **Instant copy-to-clipboard** for quick sharing
- **Individual session exports** in markdown format
- **Daily comprehensive reports** with conversation analysis
- **Professional formatting** with timestamps and speaker attribution
- **Multi-session aggregation** for full trading day documentation

## 🚀 Installation

### Method 1: Direct Installation (Recommended)
1. **Download** the latest release from this repository
2. **Extract** the files to a folder (e.g., `vtf-transcriber`)
3. **Open Chrome** and navigate to `chrome://extensions/`
4. **Enable "Developer mode"** (toggle in top-right corner)
5. **Click "Load unpacked"** and select the extracted folder
6. **Verify installation**: The VTF Audio Transcriber icon appears in your Chrome toolbar
7. **Navigate** to your VTF platform (vtf.t3live.com) for automatic activation

### Method 2: Build from Source
```bash
git clone https://github.com/simonplant/vtf-transcriber.git
cd vtf-transcriber
make dist  # Builds to 'dist' directory
```
Then follow steps 3-7 above, selecting the `dist` directory.

### ✅ Installation Verification
After installation, you should see:
- **Extension icon** in Chrome toolbar
- **Automatic activation** when visiting vtf.t3live.com
- **No permission prompts** (extension uses existing VTF audio streams)

### 🔄 Enabling/Disabling the Extension
- **Enable**: Click the extension icon in Chrome toolbar → "Start Capture"
- **Disable**: Click "Stop Capture" or disable extension in `chrome://extensions/`
- **Temporary disable**: Extension automatically pauses when leaving VTF platform

## ⚙️ Configuration

### 🔑 OpenAI API Setup (Required)
1. **Get API Key**: Visit [OpenAI Platform](https://platform.openai.com/api-keys) and create a new API key
2. **Open Settings**: Click the VTF extension icon → Click the gear (⚙️) icon
3. **Enter Key**: Paste your API key in the "OpenAI API Key" field
4. **Save & Test**: Click "Save API Key" then "Test API Key" to verify
5. **Confirmation**: Green checkmark indicates successful setup

### 🎛️ Audio Processing Settings
The extension uses optimized defaults, but advanced users can modify settings in `src/background.js`:

```javascript
const CONFIG = {
  SAMPLE_RATE: 16000,           // Audio sample rate (16kHz optimal for Whisper)
  CHUNK_DURATION_ACTIVE: 4,     // Chunk size during active conversation (seconds)
  CHUNK_DURATION_IDLE: 6,       // Chunk size during quiet periods (seconds)
  MIN_CHUNK_SIZE: 3,            // Minimum chunk size for quality (seconds)
  MAX_CHUNK_SIZE: 10,           // Maximum chunk size (seconds)
  SILENCE_THRESHOLD: 0.003,     // Audio amplitude threshold for silence detection
  SILENCE_TIMEOUT: 2500,        // Milliseconds before processing quiet audio
  MAX_CONCURRENT_PROCESSING: 3  // Max simultaneous Whisper API calls
};
```

### 🎙️ Voice Activity Detection (VAD) Settings
VAD parameters can be adjusted in `src/inject.js` AudioWorklet configuration:

```javascript
vadConfig: {
  energyThreshold: 0.003,          // Speech energy threshold
  zcrThreshold: 0.4,               // Zero-crossing rate for speech detection
  spectralCentroidThreshold: 1000, // Speech frequency range (Hz)
  voiceProbabilityThreshold: 0.5,  // Confidence threshold for voice detection
  adaptiveWindow: 20,              // Adaptive threshold window size
  hangoverFrames: 8                // Frames to continue after voice stops
}
```

### 🔧 Debug and Performance Settings
- **Debug Logging**: Set `DEBUG = true` in `src/background.js` for verbose console output
- **Content Script Debug**: Set `DEBUG_CAPTURE = true` in `src/content.js` for VAD logging
- **Performance Monitoring**: Built-in metrics displayed in popup dashboard

### 📋 Session Management
- **Backup Sessions**: Options page → "Backup Session" (exports transcripts as JSON)
- **Restore Sessions**: Options page → "Restore Session" (imports previous sessions)
- **Session Statistics**: View current session metrics in options page

### 🔐 Permissions Required
The extension requires minimal permissions:
- **Storage**: Secure API key and session data storage
- **Active tab**: VTF platform integration and auto-start
- **Host permissions**: OpenAI API access (https://api.openai.com/*)

**Security Note**: Extension captures audio from VTF platform's existing MediaStream API - no additional browser permissions needed.

## 📖 Usage Guide

### Basic Operation
1. **Navigate** to your VTF trading platform (vtf.t3live.com)
2. **Click** the VTF Audio Transcriber extension icon
3. **Start Capture** - Audio recording begins from platform's audio streams
4. **Monitor** real-time metrics:
   - **Audio Level Visualization**: Live waveform with reference grids
   - **Voice Activity Detection**: Confidence levels and spectral analysis
   - **Audio Quality**: Excellent/Good/Fair/Poor with clipping detection
5. **Export** transcripts as needed throughout the session

### Dashboard Overview
- **Inline Status**: Capture state displayed between Start/Stop buttons
- **4-Column Metrics Grid**: 
  - **Row 1**: Audio chunks, transcriptions, active speakers, session cost
  - **Row 2**: Speech activity, processing status, last transcription, audio quality
- **Current Transcript**: Live preview of most recent transcription
- **Performance Stats**: API calls, response times, error rates
- **Voice Activity Detection**: 
  - Real-time voice activity percentage and VAD confidence
  - Signal-to-noise ratio (SNR) and spectral centroid measurements
  - **Audio Level Visualization**: Live waveform with -20dB, -10dB, 0dB reference grids
- **Audio Channels**: Multi-track monitoring with voice activity per channel
- **Actions**: Copy, export individual session, or daily comprehensive report

### Export Options
- **Copy All**: Copies current session transcripts to clipboard
- **Export All**: Downloads session as markdown file
- **Daily Export**: Generates comprehensive daily report with conversation analysis

## 🏗️ Architecture

### Core Components
- **Background Service Worker** (`background.js`): Audio processing, API management, and transcription
- **Content Script** (`content.js`): VTF platform integration and message routing
- **Inject Script** (`inject.js`): Direct audio stream capture from VTF platform
- **Popup Interface** (`popup.html/js`): Real-time monitoring and control dashboard
- **Options Page** (`options.html/js`): Configuration and API key management

### 🎵 How VTF Audio Capture Works

#### 1. **Platform Integration**
The extension automatically detects and integrates with VTF platform audio streams:
- **Content Script Injection**: Runs on `vtf.t3live.com` pages
- **MediaStream Detection**: Monitors for WebRTC audio streams in VTF platform
- **Producer Tracking**: Identifies individual speakers/audio sources
- **Stream Switching**: Handles dynamic audio stream changes during sessions

#### 2. **Audio Stream Capture Process**
```javascript
// VTF Platform → MediaStream API → AudioContext
const mediaStream = /* VTF platform's existing audio stream */;
const audioContext = new AudioContext({ sampleRate: 16000 });
const source = audioContext.createMediaStreamSource(mediaStream);
```

#### 3. **Real-time Audio Processing Pipeline**
```
VTF MediaStream → AudioWorklet/ScriptProcessor → Voice Activity Detection → 
Audio Quality Assessment → Speaker-Aware Buffering → Audio Preprocessing → 
Whisper API → Transcript Processing → Conversation Assembly → 
Real-time Dashboard → Export Generation
```

### 🔄 Implementation Details

#### **Audio Capture Layer** (`inject.js`)
- **AudioWorklet**: Modern, low-latency audio processing (preferred)
- **ScriptProcessor**: Fallback for older browsers
- **VAD Processing**: Real-time voice activity detection with spectral analysis
- **Quality Assessment**: RMS, dynamic range, and clipping detection
- **Multi-channel Support**: Handles multiple simultaneous audio streams

#### **Processing Layer** (`background.js`)
- **Speaker-Aware Buffering**: Separate buffers for each audio source
- **Adaptive Chunking**: Dynamic chunk sizes based on conversation activity
- **Audio Preprocessing**: 
  - Pre-emphasis filtering for speech enhancement
  - Dynamic range compression
  - Spectral gating for noise reduction
  - High-pass filtering for rumble removal
- **Concurrent Processing**: Multiple simultaneous Whisper API calls
- **Rate Limiting**: Intelligent API call management

#### **Integration Layer** (`content.js`)
- **Message Validation**: Ensures data integrity between components
- **Stream Coordination**: Manages multiple audio sources
- **Error Recovery**: Handles extension reloads and context invalidation
- **Performance Monitoring**: Tracks processing metrics

### 🎛️ Configuration Architecture

#### **Static Configuration** (`CONFIG` object in `background.js`)
```javascript
const CONFIG = {
  // Audio Settings
  SAMPLE_RATE: 16000,              // Whisper-optimized sample rate
  CHUNK_DURATION_ACTIVE: 4,        // Active conversation chunk size
  CHUNK_DURATION_IDLE: 6,          // Quiet period chunk size
  
  // Processing Settings
  MAX_CONCURRENT_PROCESSING: 3,    // Parallel API calls
  SILENCE_THRESHOLD: 0.003,        // Voice detection threshold
  
  // Memory Management
  MAX_TRANSCRIPTIONS: 2000,        // Session transcript limit
  TRANSCRIPTION_CLEANUP_KEEP: 1000 // Cleanup retention count
};
```

#### **Dynamic Configuration** (VAD settings in `inject.js`)
```javascript
vadConfig: {
  energyThreshold: 0.003,          // Speech energy detection
  zcrThreshold: 0.4,               // Zero-crossing rate
  spectralCentroidThreshold: 1000, // Frequency analysis
  voiceProbabilityThreshold: 0.5,  // Confidence threshold
  adaptiveWindow: 20,              // Adaptive learning window
  hangoverFrames: 8                // Post-speech continuation
}
```

#### **User Configuration** (Options page)
- **API Key Management**: Secure storage and validation
- **Session Backup/Restore**: JSON export/import functionality
- **Performance Statistics**: Real-time session metrics

### 📊 Data Flow Architecture

#### **Real-time Processing**
1. **Audio Capture**: VTF MediaStream → AudioWorklet buffer (1-second chunks)
2. **VAD Analysis**: Multi-feature voice detection (energy + spectral + SNR)
3. **Quality Assessment**: RMS analysis, clipping detection, noise evaluation
4. **Buffering**: Speaker-aware accumulation with adaptive sizing
5. **API Processing**: Whisper transcription with retry logic
6. **Dashboard Update**: Real-time metrics and visualization

#### **Session Management**
1. **Transcript Accumulation**: Chronological storage with speaker attribution
2. **Conversation Grouping**: 10-second gap detection for conversation segments
3. **Performance Tracking**: API costs, response times, error rates
4. **Export Generation**: Markdown formatting with professional structure

#### **Multi-Session Aggregation**
1. **Daily Compilation**: Cross-session transcript merging
2. **Speaker Consistency**: Name resolution across sessions
3. **Conversation Analysis**: Type classification (soliloquy/exchange/group)
4. **Comprehensive Reporting**: Full trading day documentation

### 🔧 How to Modify Settings

#### **Audio Processing Parameters**
Edit `src/background.js` CONFIG object and reload extension:
```javascript
const CONFIG = {
  CHUNK_DURATION_ACTIVE: 5,  // Increase for longer context
  SILENCE_THRESHOLD: 0.005,  // Increase for noisier environments
  MAX_CONCURRENT_PROCESSING: 2  // Reduce for slower systems
};
```

#### **Voice Activity Detection**
Modify `src/inject.js` AudioWorklet configuration:
```javascript
vadConfig: {
  energyThreshold: 0.005,    // Higher = less sensitive
  voiceProbabilityThreshold: 0.6  // Higher = more selective
}
```

#### **Debug and Monitoring**
Enable detailed logging:
```javascript
// In src/background.js
const DEBUG = true;

// In src/content.js  
const DEBUG_CAPTURE = true;
```

## 🔧 Development

### Prerequisites
- Node.js 16+ (for development tools)
- Chrome browser for testing
- OpenAI API key for transcription testing

### Setup
```bash
git clone https://github.com/simonplant/vtf-transcriber.git
cd vtf-transcriber

# Build the extension
make dist

# Load in Chrome (developer mode)
# Point to the 'dist' directory
```

### Development Commands
```bash
make dist          # Build production version
make clean         # Clean build artifacts
make dev           # Development build with source maps
```

### Debug Logging Control
The extension includes configurable debug logging to prevent console spam:

**Enable Debug Mode:**
```javascript
// In src/background.js, change:
const DEBUG = false;  // to:
const DEBUG = true;
```

**Debug vs Production Logging:**
- **Production Mode** (`DEBUG = false`): Only errors and warnings logged
- **Debug Mode** (`DEBUG = true`): Verbose logging for development
- **Benefits**: Cleaner console, better performance, easier debugging

**What Gets Logged in Debug Mode:**
- Audio chunk processing details
- Voice Activity Detection results and thresholds
- Audio quality assessment and clipping detection
- Whisper API request/response data
- Speaker detection and buffer management
- Multi-channel audio stream monitoring
- Memory cleanup operations
- Performance metrics and timing

### File Structure
```
src/
├── background.js      # Service worker - audio processing
├── content.js         # VTF platform integration
├── popup.html/js      # Dashboard interface
├── options.html/js    # Settings configuration
├── inject.js          # Platform-specific injection
└── style.css          # Unified design system
```

## 🔒 Security & Privacy

### Data Protection
- **No persistent audio storage** - audio processed in real-time only
- **Secure API key storage** using Chrome's encrypted storage
- **No external data transmission** except to OpenAI Whisper API
- **Local transcript storage** with no cloud backup
- **Audio stream integration** - captures from VTF platform's existing audio streams

### Permissions Justification
- **storage**: Secure storage of API keys and user preferences
- **activeTab**: Integration with VTF platform for auto-start functionality
- **host_permissions**: OpenAI API access for transcription services

## 💰 Pricing & Usage

### OpenAI Whisper Costs
- **$0.006 per minute** of audio transcribed
- **Typical trading session**: $2-5 per day
- **Cost tracking**: Built-in session cost monitoring
- **Usage optimization**: Smart chunking reduces API calls

## 🐛 Troubleshooting

### Common Issues

**Audio not capturing:**
- Check VTF platform audio is working
- Ensure browser allows media stream access
- Check Voice Activity Detection metrics in popup

**Transcription not working:**
- Check status via extension popup (click icon)
- Validate OpenAI API key in settings
- Check service worker logs
- Monitor audio quality indicators (should show green/yellow, not red)

**Poor transcription quality:**
- Monitor audio quality display (excellent/good/fair/poor)
- Check Voice Activity Detection confidence levels
- Watch for clipping indicators in audio quality tooltips
- Ensure Signal-to-Noise Ratio (SNR) is above 6dB
- Check audio level visualization for proper signal levels
- **Adjust settings**: Increase `CHUNK_DURATION_ACTIVE` for better context
- **Lower thresholds**: Reduce `SILENCE_THRESHOLD` for quiet speakers

**Configuration Issues:**
- **Settings not saving**: Check browser storage permissions
- **API key validation fails**: Verify key format and account billing status
- **Extension not activating**: Ensure you're on vtf.t3live.com domain
- **Audio not detected**: Check VTF platform audio is unmuted and playing
- **High CPU usage**: Reduce `MAX_CONCURRENT_PROCESSING` or disable debug logging

### Debug Information

**Console Logging:**
The extension runs in production mode by default with minimal console output. To enable verbose logging for troubleshooting:

```javascript
// 1. Open src/background.js
// 2. Change: const DEBUG = false; to: const DEBUG = true;
// 3. Reload the extension
```

**Check Extension Logs:**
```javascript
// Service worker logs (Chrome DevTools > Extensions > VTF Audio Transcriber > service worker)
// Content script logs (F12 on VTF page > Console tab)
// Popup logs (Right-click popup > Inspect)
```

**Log Categories:**
- **Errors**: Always visible (API failures, permission issues)
- **Debug**: Only when `DEBUG = true` (processing details, performance)
- **Performance**: API response times, buffer statistics

## 📈 Performance

### Optimizations
- **Voice Activity Detection**: Intelligent speech detection reduces unnecessary processing
- **Audio quality assessment**: Real-time monitoring prevents poor audio from reaching API
- **Adaptive chunking**: Adjusts processing based on conversation activity
- **Audio preprocessing**: Dynamic range compression and spectral gating improve quality
- **Smart buffering**: Prevents memory leaks with automatic cleanup
- **Concurrent processing**: Handles multiple speakers simultaneously
- **Retry logic**: Ensures reliable API communication
- **Memory management**: Automatic buffer cleanup and optimization
- **Clipping detection**: Prevents distorted audio from affecting transcription

### Metrics
- **Transcription accuracy**: 95%+ with clear audio (monitored via quality indicators)
- **Processing latency**: 2-5 seconds average (displayed in performance stats)
- **Memory usage**: <50MB typical session
- **Audio quality tracking**: Real-time excellent/good/fair/poor classification
- **Voice activity accuracy**: Multi-feature VAD with spectral analysis
- **API efficiency**: Smart chunking and quality filtering reduces costs by 30-40%

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issue Tracker](https://github.com/simonplant/vtf-transcriber/issues)
- **Discussions**: [GitHub Discussions](https://github.com/simonplant/vtf-transcriber/discussions)
- **Email**: [support@vtf-transcriber.com](mailto:support@vtf-transcriber.com)

## 🏆 Acknowledgments

- **OpenAI** for the Whisper transcription model
- **Chrome Extensions Team** for the robust tabCapture API
- **VTF Community** for feedback and feature requests

---

*Built with ❤️ for the trading community*