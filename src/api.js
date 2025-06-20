/**
 * @file api.js
 * @path src/api.js
 * @description Handles all API interactions with OpenAI, including rate limiting and audio processing.
 * @modified 2024-07-26
 */

import { getApiKey } from './storage.js';

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

// --- Rate Limiter ---
// A simple rate limiter to avoid hitting API limits.
const MAX_CONCURRENT_REQUESTS = 3;
let activeRequests = 0;
const requestQueue = [];

async function processQueue() {
    if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
        return;
    }

    activeRequests++;
    const { requestFunction, resolve, reject } = requestQueue.shift();

    try {
        const result = await requestFunction();
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        activeRequests--;
        processQueue();
    }
}

function queueRequest(requestFunction) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ requestFunction, resolve, reject });
        processQueue();
    });
}


// --- Audio Utilities ---

/**
 * Converts a Float32Array to a WAV file buffer.
 * @param {Float32Array} float32Array - The audio data.
 * @param {number} sampleRate - The sample rate of the audio.
 * @returns {ArrayBuffer} - The WAV file data.
 */
function float32ToWav(float32Array, sampleRate = 16000) {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = float32Array.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
}


/**
 * Retries a function with exponential backoff.
 * @param {Function} fn - The async function to retry.
 * @param {number} maxRetries - Maximum number of retries.
 * @param {number} baseDelay - Initial delay in ms.
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let attempt = 1;
    while (attempt <= maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
}


// --- Core API Call ---

/**
 * Sends an audio chunk to the Whisper API for transcription.
 * @param {Float32Array} audioData - The raw audio data.
 * @param {string} streamId - The ID of the audio stream.
 * @returns {Promise<object|null>} - The transcription result or null on failure.
 */
export async function processAudioChunk(audioData, streamId) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        console.error('API key not found. Please set it in the options.');
        // Notify popup of error
        chrome.runtime.sendMessage({ type: 'error', message: 'API key not found.' });
        return null;
    }

    // Simple audio validation
    if (!audioData || audioData.length < 1600) { // at least 0.1s of audio
        console.warn(`Skipping empty or very short audio chunk for stream ${streamId}.`);
        return null;
    }

    const wavBuffer = float32ToWav(audioData);
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'en');

    const apiCall = async () => {
        const response = await fetch(WHISPER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            console.error('Whisper API Error:', response.status, errorBody);
            // Handle specific error cases if needed
            if (response.status === 401) {
                 chrome.runtime.sendMessage({ type: 'error', message: 'Invalid API key.' });
            }
            throw new Error(`API request failed with status ${response.status}`);
        }
        return response.json();
    };

    try {
        const result = await queueRequest(() => retryWithBackoff(apiCall));
        return result;
    } catch (error) {
        console.error(`Failed to process audio for stream ${streamId} after multiple retries.`, error);
        return null;
    }
} 