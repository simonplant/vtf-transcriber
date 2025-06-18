# QA Testing Checklist - VTF Audio Transcriber

## 🔧 Critical Fixes Verification

### ✅ Memory Management Fixes

#### Test 1: processedChunks Memory Leak
- [ ] **Start 8+ hour capture session**
- [ ] **Monitor memory usage** via Chrome DevTools
- [ ] **Verify processedChunks size** stays under 1000 entries
- [ ] **Check cleanup logs** when size exceeds 1000
- [ ] **Expected**: Memory usage remains stable, no gradual growth

#### Test 2: AudioContext Cleanup
- [ ] **Start audio capture** on VTF platform
- [ ] **Navigate away** from VTF page
- [ ] **Check console** for cleanup messages
- [ ] **Verify AudioContext state** is 'closed'
- [ ] **Expected**: No resource leaks, proper cleanup logs

### ✅ Performance Optimizations

#### Test 3: Array Operations Efficiency
- [ ] **Monitor CPU usage** during active capture
- [ ] **Test with multiple speakers** (3+ simultaneous)
- [ ] **Check audio processing latency**
- [ ] **Expected**: Reduced CPU usage, smooth processing

#### Test 4: Rate Limiting Queue
- [ ] **Generate high audio activity** (multiple speakers)
- [ ] **Monitor API request patterns**
- [ ] **Check for request queuing** in console
- [ ] **Verify no dropped requests**
- [ ] **Expected**: Smooth API usage, no rate limit errors

### ✅ Data Integrity Fixes

#### Test 5: Unique Chunk IDs
- [ ] **Start capture with rapid audio**
- [ ] **Check for duplicate chunk warnings**
- [ ] **Verify chunk ID format**: `streamId-counter-timestamp`
- [ ] **Expected**: No duplicate chunks processed

#### Test 6: Export Date Format
- [ ] **Export transcriptions**
- [ ] **Verify filename format**: `vtf-transcriptions-YYYY-MM-DD.md`
- [ ] **Test on different locales**
- [ ] **Expected**: Consistent, safe filenames

### ✅ Security Enhancements

#### Test 7: Message Origin Validation
- [ ] **Open browser console** on VTF page
- [ ] **Inject malicious postMessage** from different origin
- [ ] **Verify messages are rejected**
- [ ] **Expected**: Only same-origin messages accepted

## 🎯 Regression Testing

### Core Functionality
- [ ] **Audio capture** starts/stops correctly
- [ ] **Voice Activity Detection** shows accurate metrics
- [ ] **Audio quality indicators** display properly
- [ ] **Real-time transcription** works smoothly
- [ ] **Speaker detection** identifies multiple speakers
- [ ] **Export functions** generate correct markdown

### Dashboard Features
- [ ] **Audio level visualization** displays waveform
- [ ] **VAD metrics** update in real-time
- [ ] **Performance stats** show accurate data
- [ ] **Channel monitoring** tracks multiple streams
- [ ] **Status indicators** reflect capture state

### Long Session Testing
- [ ] **8+ hour continuous capture**
- [ ] **Memory usage remains stable**
- [ ] **No performance degradation**
- [ ] **All transcripts preserved**
- [ ] **Export functions work after long session**

## 🔍 Specific Bug Verifications

### Bug 1: Memory Growth
- **Before**: processedChunks grew indefinitely
- **After**: Maintains 500 most recent entries
- **Test**: Monitor `processedChunks.size` during long session

### Bug 2: AudioContext Leaks
- **Before**: AudioContext never closed
- **After**: Cleanup on page unload
- **Test**: Check AudioContext state after navigation

### Bug 3: Timestamp Collisions
- **Before**: Duplicate chunks from simultaneous audio
- **After**: Unique counter-based IDs
- **Test**: High-frequency audio with multiple speakers

### Bug 4: Locale Date Issues
- **Before**: Invalid filenames with some locales
- **After**: ISO date format (YYYY-MM-DD)
- **Test**: Export on systems with different date formats

### Bug 5: Array Performance
- **Before**: Spread operator on large arrays
- **After**: Efficient loop-based concatenation
- **Test**: CPU usage during intensive audio processing

## 🚨 Error Conditions Testing

### API Failures
- [ ] **Invalid API key** handling
- [ ] **Network errors** during transcription
- [ ] **Rate limit exceeded** scenarios
- [ ] **Service unavailable** responses

### Browser Compatibility
- [ ] **Chrome 88+** (minimum version)
- [ ] **AudioWorklet support** vs ScriptProcessor fallback
- [ ] **Extension reload** scenarios
- [ ] **Page refresh** during capture

### Resource Constraints
- [ ] **Low memory** conditions
- [ ] **High CPU usage** scenarios
- [ ] **Network throttling**
- [ ] **Multiple tabs** with VTF

## 📊 Performance Benchmarks

### Memory Usage
- **Target**: <100MB for 8-hour session
- **Measurement**: Chrome DevTools Memory tab
- **Frequency**: Every hour during long session

### CPU Usage
- **Target**: <10% average during active capture
- **Measurement**: Chrome Task Manager
- **Conditions**: 3+ simultaneous speakers

### API Efficiency
- **Target**: <3 requests/minute average
- **Measurement**: Background script logs
- **Metric**: Requests per audio minute ratio

### Transcription Latency
- **Target**: <5 seconds from speech to text
- **Measurement**: Timestamp comparison
- **Conditions**: Normal conversation pace

## ✅ Sign-off Criteria

### Critical Requirements
- [ ] **No memory leaks** during 8+ hour sessions
- [ ] **All audio resources** properly cleaned up
- [ ] **No duplicate chunk processing**
- [ ] **Stable performance** under load
- [ ] **Secure message handling**

### Quality Requirements
- [ ] **Transcription accuracy** >95% with clear audio
- [ ] **Real-time dashboard** updates smoothly
- [ ] **Export functions** work reliably
- [ ] **Error recovery** handles failures gracefully
- [ ] **User experience** remains responsive

## 🔧 Developer Testing Commands

### Memory Monitoring
```javascript
// Console command to check memory usage
console.log('processedChunks size:', processedChunks?.size);
console.log('speakerBuffers size:', speakerBuffers?.size);
console.log('audioChunks length:', audioChunks?.length);
```

### Performance Profiling
```javascript
// Enable verbose logging
const DEBUG = true;
const DEBUG_CAPTURE = true;

// Monitor rate limiter
console.log('Rate limiter queue:', rateLimiter?.requestQueue?.length);
console.log('Active requests:', rateLimiter?.currentRequests);
```

### Resource Verification
```javascript
// Check AudioContext state
console.log('AudioContext state:', audioContext?.state);

// Verify cleanup
window.addEventListener('beforeunload', () => {
  console.log('Page unloading - resources cleaned:', !audioContext || audioContext.state === 'closed');
});
```

---

**Testing Environment**: Chrome DevTools, VTF Platform (vtf.t3live.com)
**Test Duration**: Minimum 2 hours for basic tests, 8+ hours for stress tests
**Success Criteria**: All checkboxes completed without critical issues 