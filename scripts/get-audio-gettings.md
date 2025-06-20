
<!--
  @file get-audio-settings.md
  @path scripts/get-audio-settings.md
  @description prompt to extract audio config from our code
  @modified 2024-06-20
-->

## Prompt: Audio Configuration Extraction

Please analyze the VTF Audio Transcriber codebase and extract ALL audio-related configuration settings, thresholds, and parameters. Organize them into the following categories:

### 1. **Audio Capture Settings**
- Sample rates (Hz)
- Buffer sizes (samples/chunks)
- Channel configurations (mono/stereo)
- Audio format specifications

### 2. **Voice Activity Detection (VAD) Parameters**
- Energy thresholds
- Zero-crossing rate thresholds
- Spectral analysis thresholds (centroid, rolloff)
- Voice probability thresholds
- Adaptive window sizes
- Hangover frames

### 3. **Timing and Duration Settings**
- Silence timeouts (ms)
- Maximum segment durations (seconds)
- Minimum chunk sizes
- Processing intervals
- Keep-alive timers
- Health check intervals

### 4. **Buffer Management**
- Chunk sizes (samples)
- Buffer cleanup thresholds
- Memory limits
- Array size limits

### 5. **API and Processing Constraints**
- Maximum file sizes (MB)
- Concurrent request limits
- Retry delays and intervals
- Rate limiting parameters

### 6. **Quality Assessment Thresholds**
- RMS thresholds for quality levels (poor/fair/good)
- Dynamic range thresholds
- Clipping detection levels
- Signal-to-noise ratio thresholds

### 7. **Service Worker and Extension Timings**
- Service worker keep-alive intervals
- Extension lifecycle timeouts
- Recovery attempt limits
- Reconnection delays

For each setting, provide:
- **Parameter name** (as it appears in code)
- **Current value**
- **Location** (file and line/context)
- **Purpose** (what it controls)
- **Units** (ms, seconds, Hz, etc.)
- **Related parameters** (if any)

Also identify:
- Which settings are hardcoded constants vs configurable
- Any dynamic adjustments based on conditions
- Default vs active values
- Any settings that appear in multiple places with different values

Format the output as a structured reference table or JSON object that could be used as a configuration reference guide.
