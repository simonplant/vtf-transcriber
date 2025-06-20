/**
 * @file conversation.js
 * @path src/conversation.js
 * @description Handles conversation logic, including audio buffering, transcription, and structuring.
 * @modified 2024-07-27
 * @requires api.js
 */

import { processAudioChunk } from './api.js';

// Speaker name mapping for better display
const speakerNameMap = new Map();
let speakerCounter = 1;

/**
 * Extracts a speaker's name from a stream ID.
 * Example: "remote-stream-12345-John Doe" -> "John Doe"
 * @param {string} streamId - The stream ID.
 * @returns {string} The extracted speaker name.
 */
function extractSpeakerName(streamId) {
    if (!streamId) return 'Unknown Speaker';
    if (streamId === 'local-stream') return 'Me';
    
    // Check if we already have a mapped name for this stream ID
    if (speakerNameMap.has(streamId)) {
        return speakerNameMap.get(streamId);
    }
    
    // Handle VTF stream IDs like "msRemAudio-kB13khVfculpSKeoAFBz-5f523f02117fcb4cab91ca51"
    if (streamId.startsWith('msRemAudio-')) {
        // Extract the user ID part
        const userPart = streamId.replace('msRemAudio-', '');
        
        // Create a readable speaker name
        let speakerName;
        
        // Try to extract a meaningful identifier from the user ID
        const parts = userPart.split('-');
        if (parts.length >= 2) {
            // Use first 6 characters of the first part as identifier
            const shortId = parts[0].substring(0, 6);
            speakerName = `Speaker ${shortId}`;
        } else if (userPart.length > 8) {
            // Use first 6 characters as identifier
            const shortId = userPart.substring(0, 6);
            speakerName = `Speaker ${shortId}`;
        } else {
            // Assign a sequential speaker number
            speakerName = `Speaker ${speakerCounter++}`;
        }
        
        // Store the mapping for consistency
        speakerNameMap.set(streamId, speakerName);
        console.log(`[Conversation] Mapped stream ${streamId} to ${speakerName}`);
        return speakerName;
    }
    
    // Fallback for other stream ID formats
    let speakerName = `Speaker ${speakerCounter++}`;
    speakerNameMap.set(streamId, speakerName);
    return speakerName;
}

/**
 * Sanitizes transcription text, especially for highly repetitive content.
 */
function postProcessTranscription(text) {
    if (!text) return text;

    // Check for excessive repetition
    const words = text.toLowerCase().match(/\b\\w+\b/g);
    if (words && words.length > 10) {
        const wordCounts = {};
        words.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
        
        const mostFrequent = Object.entries(wordCounts).sort((a, b) => b[1] - a[1])[0];
        
        // If a single word makes up >70% of the text, it's likely an API error.
        if (mostFrequent && mostFrequent[1] / words.length > 0.7) {
            const repeatedWord = mostFrequent[0];
            // Return a sanitized, short version instead of the repetitive text.
            console.warn(`[Post-process] Sanitized highly repetitive text for word: "${repeatedWord}"`);
            return `${repeatedWord}, ${repeatedWord}, ${repeatedWord}.`;
        }
    }
    
    return text;
}

export class ConversationProcessor {
    constructor(apiKey, initialState) {
        this.apiKey = apiKey;
        this.completedSegments = [];
        this.speakerBuffers = new Map();
        this.totalProcessedDuration = 0;
        this.sessionCost = 0;

        if (initialState) {
            this.setState(initialState);
        }

        this.SPEAKER_TIMEOUT_MS = 1500; // End of speech delay (reduced from 3000ms)
        this.MAX_SEGMENT_DURATION_S = 5; // Max audio length to send to API (reduced from 30s)
        this.cleanupInterval = setInterval(() => this.finalizeCompletedStreams(), this.SPEAKER_TIMEOUT_MS);
    }

    getState() {
        return {
            completedSegments: this.completedSegments,
            totalProcessedDuration: this.totalProcessedDuration,
            sessionCost: this.sessionCost,
            speakerBuffers: Array.from(this.speakerBuffers.entries()),
        };
    }

    setState(state) {
        this.completedSegments = state.completedSegments || [];
        this.totalProcessedDuration = state.totalProcessedDuration || 0;
        this.sessionCost = state.sessionCost || 0;
        
        // Fix: speakerBuffers should be an array of [key, value] pairs for Map constructor
        if (state.speakerBuffers && Array.isArray(state.speakerBuffers)) {
            this.speakerBuffers = new Map(state.speakerBuffers);
        } else {
            this.speakerBuffers = new Map();
        }
    }

    async processAudio(audioData, streamId, timestamp) {
        if (!this.speakerBuffers.has(streamId)) {
            this.speakerBuffers.set(streamId, this.createSpeakerBuffer(timestamp));
        }

        const buffer = this.speakerBuffers.get(streamId);
        buffer.audioChunks.push(audioData);
        buffer.duration += audioData.length / 16000; // 16kHz sample rate
        buffer.lastActivity = Date.now();

        if (buffer.duration >= this.MAX_SEGMENT_DURATION_S) {
            await this.transcribeAndProcessSegment(streamId);
        }
    }
    
    async finalizeAllStreams() {
        console.log("Finalizing all active speaker buffers...");
        for (const streamId of this.speakerBuffers.keys()) {
            await this.transcribeAndProcessSegment(streamId);
        }
    }

    async finalizeCompletedStreams() {
        const now = Date.now();
        for (const [streamId, buffer] of this.speakerBuffers.entries()) {
            if (now - buffer.lastActivity > this.SPEAKER_TIMEOUT_MS && buffer.audioChunks.length > 0) {
                console.log(`Stream ${streamId} timed out. Processing segment.`);
                await this.transcribeAndProcessSegment(streamId);
            }
        }
    }
    
    createSpeakerBuffer(timestamp) {
        return {
            audioChunks: [],
            startTime: timestamp,
            duration: 0,
            lastActivity: Date.now(),
        };
    }

    async transcribeAndProcessSegment(streamId) {
        const buffer = this.speakerBuffers.get(streamId);
        if (!buffer || buffer.audioChunks.length === 0) {
            console.log(`[Conversation] No audio to process for stream ${streamId}`);
            return;
        }

        console.log(`[Conversation] Processing segment for stream ${streamId} with ${buffer.audioChunks.length} chunks`);
        const concatenatedAudio = this.concatenateAudioChunks(buffer.audioChunks);
        const segmentDuration = concatenatedAudio.length / 16000;
        
        // Reset buffer before the async API call
        const segmentStartTime = buffer.startTime;
        buffer.audioChunks = [];
        buffer.duration = 0;
        buffer.startTime = Date.now(); // Set new start time for the next segment

        const apiResult = await processAudioChunk(concatenatedAudio, streamId, this.apiKey);
        console.log(`[Conversation] API result for stream ${streamId}:`, apiResult);

        if (apiResult && apiResult.transcription && apiResult.transcription.text) {
            const processedText = postProcessTranscription(apiResult.transcription.text);
            console.log(`[Conversation] Processed text for stream ${streamId}: "${processedText}"`);
            
            this.totalProcessedDuration += segmentDuration;
            this.sessionCost = this.calculateSessionCost();

            const speakerName = extractSpeakerName(streamId);
            console.log(`[Conversation] Extracted speaker name for ${streamId}: "${speakerName}"`);

            const newSegment = {
                text: processedText,
                speaker: speakerName,
                timestamp: segmentStartTime,
                duration: segmentDuration,
                confidence: this.calculateAverageConfidence(apiResult.transcription.segments),
            };

            console.log(`[Conversation] Created segment:`, {
                speaker: newSegment.speaker,
                text: newSegment.text.substring(0, 50) + '...',
                timestamp: new Date(newSegment.timestamp).toISOString(),
                duration: newSegment.duration.toFixed(1) + 's'
            });

            this.completedSegments.push(newSegment);
            this.updateUIs();
        } else {
            console.warn(`[Conversation] No transcription result for stream ${streamId}`);
        }
    }

    concatenateAudioChunks(chunks) {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    calculateAverageConfidence(segments) {
        if (!segments || segments.length === 0) return 0;
        const totalConfidence = segments.reduce((sum, s) => sum + Math.exp(s.avg_logprob), 0);
        return totalConfidence / segments.length;
    }

    updateUIs() {
        // Send status to popup
        chrome.runtime.sendMessage({
            type: 'statusUpdate',
            status: {
                isCapturing: true, // If we're processing, we must be capturing
                transcriptionCount: this.completedSegments.length,
                activeSpeakers: this.speakerBuffers.size,
                sessionCost: this.sessionCost,
            }
        }).catch(e => {}); // Ignore errors if popup is closed

        // Send latest segment to content script for display
        const latestSegment = this.completedSegments[this.completedSegments.length - 1];
        if (latestSegment && latestSegment.text) {
            console.log(`[Conversation] Sending segment to UI: "${latestSegment.text.substring(0, 50)}..."`);
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'processedTranscription',
                        segment: latestSegment
                    }).catch(e => {
                        console.warn('[Conversation] Failed to send segment to content script:', e);
                    });
                }
            });
        } else {
            console.log('[Conversation] No valid segment to send to UI');
        }
    }

    calculateSessionCost() {
        const costPerMinute = 0.006;
        const minutesProcessed = this.totalProcessedDuration / 60;
        return minutesProcessed * costPerMinute;
    }

    // Add cleanup method to prevent memory leaks
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
} 