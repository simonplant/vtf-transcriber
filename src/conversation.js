/**
 * @file conversation.js
 * @path src/conversation.js
 * @description Handles conversation logic, including processing and structuring transcripts.
 * @modified 2024-07-26
 */

/**
 * Extracts a speaker's name from a stream ID.
 * Example: "remote-stream-12345-John Doe" -> "John Doe"
 * @param {string} streamId - The stream ID.
 * @returns {string} The extracted speaker name.
 */
function extractSpeakerName(streamId) {
    if (!streamId) return 'Unknown Speaker';
    // Fallback for local stream
    if (streamId === 'local-stream') return 'Me';

    const parts = streamId.split('-');
    if (parts.length > 3) {
        // Assumes name is at the end, handles names with spaces
        return parts.slice(3).join(' ');
    }
    return streamId; // Fallback to full ID if format is unexpected
}


export class ConversationProcessor {
    constructor(initialState) {
        if (initialState) {
            this.speakerBuffers = new Map(Object.entries(initialState.speakerBuffers || {}));
            this.completedSegments = initialState.completedSegments || [];
        } else {
            this.speakerBuffers = new Map(); // streamId -> {chunks, lastActivity, processed}
            this.completedSegments = [];
        }
        this.SPEAKER_TIMEOUT = 10000; // 10 seconds to determine speaker finished
        this.MIN_SEGMENT_LENGTH = 15; // 15 seconds before processing
    }

    getState() {
        return {
            speakerBuffers: Object.fromEntries(this.speakerBuffers),
            completedSegments: this.completedSegments,
        };
    }

    setState(state) {
        this.speakerBuffers = new Map(Object.entries(state.speakerBuffers || {}));
        this.completedSegments = state.completedSegments || [];
    }

    addTranscript(transcript) {
        const streamId = transcript.streamId;
        const now = Date.now();

        if (!this.speakerBuffers.has(streamId)) {
            this.speakerBuffers.set(streamId, {
                chunks: [],
                lastActivity: now,
                processed: false
            });
        }

        const buffer = this.speakerBuffers.get(streamId);
        buffer.chunks.push(transcript);
        buffer.lastActivity = now;

        this.checkForCompletedSegments();
    }

    checkForCompletedSegments() {
        const now = Date.now();
        this.speakerBuffers.forEach((buffer, streamId) => {
            const timeSinceActivity = now - buffer.lastActivity;
            const totalDuration = buffer.chunks.reduce((sum, chunk) => sum + (chunk.duration || 3), 0);
            
            if (!buffer.processed && (timeSinceActivity > this.SPEAKER_TIMEOUT || totalDuration > this.MIN_SEGMENT_LENGTH)) {
                this.processSpeakerSegment(streamId, buffer);
            }
        });
    }

    processSpeakerSegment(streamId, buffer) {
        if (buffer.chunks.length === 0) return;

        buffer.processed = true;

        const mergedText = this.mergeChunks(buffer.chunks);
        const cleanedText = this.cleanText(mergedText);
        const topicTitle = this.detectTopic(cleanedText);

        const processedSegment = {
            speaker: buffer.chunks[0].speaker || extractSpeakerName(streamId),
            text: cleanedText,
            topic: topicTitle,
            startTime: buffer.chunks[0].timestamp,
            endTime: buffer.chunks[buffer.chunks.length - 1].timestamp,
            duration: buffer.chunks.reduce((sum, chunk) => sum + (chunk.duration || 3), 0),
            confidence: this.calculateAverageConfidence(buffer.chunks),
            streamId: streamId,
            channelInfo: buffer.chunks[0].channelInfo || {}
        };

        this.completedSegments.push(processedSegment);

        // Notify about the processed segment
        chrome.runtime.sendMessage({
            type: 'processedTranscription',
            segment: processedSegment
        }).catch(err => console.log("Message sending failed:", err));


        // Reset buffer for new segments
        buffer.chunks = [];
        buffer.processed = false;
        buffer.lastActivity = Date.now();
    }

    mergeChunks(chunks) {
        if (chunks.length === 0) return '';
        let merged = chunks[0].text;
        for (let i = 1; i < chunks.length; i++) {
            const currentText = chunks[i].text.trim();
            const lastChar = merged[merged.length - 1];
            if (lastChar && lastChar.match(/[.!?]$/)) {
                merged += ' ' + currentText;
            } else if (currentText[0] && currentText[0].match(/[A-Z]/)) {
                merged += '. ' + currentText;
            } else {
                merged += ' ' + currentText;
            }
        }
        return merged;
    }

    cleanText(text) {
        text = text.replace(/\b(um|uh|you know|like|actually)\b/gi, '');
        text = text.replace(/\bgonna\b/gi, 'going to');
        text = text.replace(/\bcause\b/gi, 'because');
        text = text.replace(/\bwanna\b/gi, 'want to');
        text = text.replace(/\bgotta\b/gi, 'got to');
        text = text.replace(/\bis\s+not\b/gi, "isn't");
        text = text.replace(/\bdo\s+not\b/gi, "don't");
        text = text.replace(/\bdoes\s+not\b/gi, "doesn't");
        text = text.replace(/\bcan\s+not\b/gi, "can't");
        text = text.replace(/\bwill\s+not\b/gi, "won't");
        text = text.replace(/\b(\w+)(\s+\1){2,}\b/gi, '$1');
        text = text.replace(/\s+/g, ' ');
        text = text.replace(/\s+([,.!?])/g, '$1');
        text = text.replace(/([,.!?])\s*([a-z])/g, '$1 $2');
        text = text.replace(/(^|[.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());
        return text.trim();
    }

    detectTopic(text) {
        const topics = [
            { keywords: ['spy', 'qqq', 'iwm', 'dia', 'market', 'futures', 'index', 'dow', 'nasdaq'], title: 'Market Overview' },
            { keywords: ['call', 'put', 'option', 'strike', 'expiry', 'premium', 'gamma', 'delta'], title: 'Options Trading' },
            { keywords: ['buy', 'sell', 'long', 'short', 'position', 'stop', 'target', 'entry', 'exit'], title: 'Trade Setup' },
            { keywords: ['chart', 'support', 'resistance', 'trend', 'breakout', 'pattern', 'level', 'technical'], title: 'Technical Analysis' },
            { keywords: ['earnings', 'revenue', 'guidance', 'eps', 'beat', 'miss', 'report', 'quarter'], title: 'Earnings' },
            { keywords: ['fed', 'fomc', 'powell', 'rates', 'inflation', 'cpi', 'pce', 'policy'], title: 'Fed & Macro' },
            { keywords: ['tesla', 'apple', 'microsoft', 'nvidia', 'amazon', 'meta', 'google', 'aapl', 'msft', 'nvda', 'amzn'], title: 'Big Tech' },
            { keywords: ['vix', 'volatility', 'fear', 'greed', 'sentiment', 'risk'], title: 'Market Sentiment' }
        ];

        const textLower = text.toLowerCase();
        let bestMatch = { topic: null, score: 0 };

        for (const topic of topics) {
            const matches = topic.keywords.filter(keyword => textLower.includes(keyword));
            const score = matches.length;
            if (score > bestMatch.score) {
                bestMatch = { topic: topic.title, score: score };
            }
        }

        if (bestMatch.score >= 2) return bestMatch.topic;
        if (textLower.match(/\b\d{2,3}\b/) && textLower.match(/\b(call|put|strike)\b/)) return 'Options Trading';
        if (textLower.match(/\b(buy|sell|long|short)\b/) && textLower.match(/\b\d+\b/)) return 'Trade Setup';

        return 'Market Commentary';
    }

    calculateAverageConfidence(chunks) {
        const confidences = chunks.filter(c => c.confidence).map(c => c.confidence);
        if (confidences.length === 0) return 0;
        return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
    }

    getCompletedSegments() {
        return this.completedSegments;
    }

    clearOldSegments() {
        this.completedSegments = [];
        this.speakerBuffers.clear();
    }
} 