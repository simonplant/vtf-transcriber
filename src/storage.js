/**
 * @file storage.js
 * @path src/storage.js
 * @description Manages all interactions with chrome.storage for state persistence.
 * @modified 2024-07-26
 */

const DEFAULTS = {
  transcriptions: [],
  speakerBuffers: {}, // Storing as object as Map is not serializable
  isCapturing: false,
  apiKey: null,
  // Add other state defaults here
  sessionState: {
    silenceTimers: {},
    recentActivity: [],
    processingQueue: [],
    lastTranscripts: {},
    processedChunks: {},
    chunkCounter: 0,
    speakerAliasMap: {},
  },
  conversationProcessorState: {
    speakerBuffers: {},
    completedSegments: []
  }
};

// Helper to get from chrome.storage.local
const getLocal = (keys) => chrome.storage.local.get(keys);

// Helper to set to chrome.storage.local
const setLocal = (items) => chrome.storage.local.set(items);

// Helper to get from chrome.storage.session
const getSession = (keys) => chrome.storage.session.get(keys);

// Helper to set to chrome.storage.session
const setSession = (items) => chrome.storage.session.set(items);

/**
 * Initializes state from storage.
 * @returns {Promise<object>} - The combined state from local and session storage.
 */
export async function initState() {
  const localState = await getLocal(['apiKey', 'isCapturing', 'transcriptions']);
  const sessionState = await getSession(['speakerBuffers', 'sessionState', 'conversationProcessorState']);

  return {
    apiKey: localState.apiKey || DEFAULTS.apiKey,
    isCapturing: localState.isCapturing || DEFAULTS.isCapturing,
    transcriptions: localState.transcriptions || DEFAULTS.transcriptions,
    speakerBuffers: sessionState.speakerBuffers || DEFAULTS.speakerBuffers,
    sessionState: sessionState.sessionState || DEFAULTS.sessionState,
    conversationProcessorState: sessionState.conversationProcessorState || DEFAULTS.conversationProcessorState,
  };
}

// --- Transcription Management ---

/**
 * Adds a single transcription to the stored array.
 * @param {object} transcription - The transcription object to add.
 */
export async function addTranscription(transcription) {
  const { transcriptions } = await getLocal({ transcriptions: [] });
  transcriptions.push(transcription);
  await setLocal({ transcriptions });
}

/**
 * Retrieves all transcriptions.
 * @returns {Promise<Array<object>>}
 */
export async function getTranscriptions() {
    const { transcriptions } = await getLocal({ transcriptions: [] });
    return transcriptions;
}

/**
 * Clears all stored transcriptions.
 */
export async function clearTranscriptions() {
    await setLocal({ transcriptions: [] });
}


// --- API Key Management ---
export const getApiKey = async () => (await getLocal('apiKey')).apiKey;
export const setApiKey = (apiKey) => setLocal({ apiKey });


// --- Capturing State ---
export const getCapturingState = async () => (await getLocal('isCapturing')).isCapturing || false;
export const setCapturingState = (isCapturing) => setLocal({ isCapturing });


// --- Session State Management ---

/**
 * Gets the entire session state object.
 * @returns {Promise<object>}
 */
export async function getSessionState() {
    const { sessionState } = await getSession({ sessionState: DEFAULTS.sessionState });
    return sessionState;
}

/**
 * Updates parts of the session state.
 * @param {object} newState - The partial state to update.
 */
export async function updateSessionState(newState) {
    const currentState = await getSessionState();
    await setSession({ sessionState: { ...currentState, ...newState } });
}

/**
 * Gets speaker buffers.
 * @returns {Promise<object>}
 */
export async function getSpeakerBuffers() {
    const { speakerBuffers } = await getSession({ speakerBuffers: {} });
    return speakerBuffers;
}

/**
 * Sets the entire speaker buffers object.
 * @param {object} buffers - The speaker buffers object.
 */
export async function setSpeakerBuffers(buffers) {
    await setSession({ speakerBuffers: buffers });
}

// --- Conversation Processor State ---

export async function getConversationProcessorState() {
    const { conversationProcessorState } = await getSession({ conversationProcessorState: DEFAULTS.conversationProcessorState });
    return conversationProcessorState;
}

export async function setConversationProcessorState(state) {
    await setSession({ conversationProcessorState: state });
}

/**
 * Clears all session data.
 */
export async function clearSession() {
    await setSession({ 
        speakerBuffers: {}, 
        sessionState: DEFAULTS.sessionState,
        conversationProcessorState: DEFAULTS.conversationProcessorState 
    });
    await setLocal({ isCapturing: false, transcriptions: [] });
} 