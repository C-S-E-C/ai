// API Configuration
const API_BASE_URL = 'https://1.s.csec.top:10082/api';
const ENDPOINTS = {
    listModels: `${API_BASE_URL}/list-models`,
    startSession: `${API_BASE_URL}/start-session`,
    getSession: `${API_BASE_URL}/get-session`
};

// Application State
let currentSession = {
    key: null,
    sessionId: null,
    model: null,
    history: []
};

let isWaitingForResponse = false;
let pollAttempts = 0;
const MAX_POLL_ATTEMPTS = 100;
const POLL_INTERVAL = 1000; // 1 second
const STABILITY_CHECK_COUNT = 5;

// DOM Elements
const modelSelect = document.getElementById('model-select');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const loadingIndicator = document.getElementById('loading-indicator');
const statusText = document.getElementById('status-text');

// Initialize Application
async function init() {
    await loadModels();
    setupEventListeners();
    autoResizeTextarea();
}

// Load available models
async function loadModels() {
    try {
        statusText.textContent = 'Loading models...';
        const response = await fetch(ENDPOINTS.listModels, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (data && Array.isArray(data)) {
            populateModelSelect(data);
            statusText.textContent = 'Select a model to begin';
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
        statusText.textContent = 'Error loading models. Please refresh.';
        showError('Failed to load models. Please check your connection and try again.');
    }
}

// Populate model dropdown
function populateModelSelect(models) {
    modelSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    });
}

// Setup event listeners
function setupEventListeners() {
    modelSelect.addEventListener('change', handleModelChange);
    sendButton.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keydown', handleKeyPress);
    messageInput.addEventListener('input', autoResizeTextarea);
}

// Handle model selection
function handleModelChange() {
    const selectedModel = modelSelect.value;
    if (selectedModel) {
        currentSession.model = selectedModel;
        sendButton.disabled = false;
        statusText.textContent = `Ready with ${selectedModel}`;
        clearWelcomeMessage();
    } else {
        sendButton.disabled = true;
        statusText.textContent = 'Select a model to begin';
    }
}

// Handle Enter key press
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
}

// Auto-resize textarea
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}

// Clear welcome message
function clearWelcomeMessage() {
    const welcomeMessage = chatMessages.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.opacity = '0';
        setTimeout(() => welcomeMessage.remove(), 300);
    }
}

// Handle send message
async function handleSendMessage() {
    const message = messageInput.value.trim();
    
    if (!message || !currentSession.model || isWaitingForResponse) {
        return;
    }

    // Add user message to UI
    addMessageToUI('user', message);
    
    // Add to history
    currentSession.history.push({
        role: 'user',
        content: message
    });

    // Clear input
    messageInput.value = '';
    autoResizeTextarea();

    // Disable input while waiting
    setInputState(false);
    showLoading(true);

    try {
        // Start or continue session
        if (!currentSession.key || !currentSession.sessionId) {
            await startNewSession();
        } else {
            await getSessionResponse();
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showError('Failed to send message. Please try again.');
        setInputState(true);
        showLoading(false);
    }
}

// Start new chat session
async function startNewSession() {
    try {
        statusText.textContent = 'Starting new session...';
        
        const response = await fetch(ENDPOINTS.startSession, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: currentSession.model,
                history: currentSession.history
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.key && data.session_id) {
            currentSession.key = data.key;
            currentSession.sessionId = data.session_id;
            statusText.textContent = 'Session started';
            
            // Start polling for response
            await pollForResponse();
        } else {
            throw new Error('Invalid session response');
        }
    } catch (error) {
        throw new Error(`Failed to start session: ${error.message}`);
    }
}

// Get session response
async function getSessionResponse() {
    try {
        statusText.textContent = 'Getting response...';
        await pollForResponse();
    } catch (error) {
        throw new Error(`Failed to get response: ${error.message}`);
    }
}

// Poll for response with stability check
async function pollForResponse() {
    pollAttempts = 0;
    let previousResponses = [];
    let stableContent = null;

    while (pollAttempts < MAX_POLL_ATTEMPTS) {
        try {
            const response = await fetch(ENDPOINTS.getSession, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    key: currentSession.key,
                    session_id: currentSession.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.chat && Array.isArray(data.chat)) {
                // Get the last assistant message
                const lastMessage = data.chat
                    .slice()
                    .reverse()
                    .find(msg => msg.role === 'assistant');

                if (lastMessage && lastMessage.content) {
                    previousResponses.push(lastMessage.content);
                    
                    // Keep only last STABILITY_CHECK_COUNT responses
                    if (previousResponses.length > STABILITY_CHECK_COUNT) {
                        previousResponses.shift();
                    }

                    // Check if last 5 responses are identical
                    if (previousResponses.length === STABILITY_CHECK_COUNT) {
                        const allSame = previousResponses.every(
                            content => content === previousResponses[0]
                        );

                        if (allSame) {
                            stableContent = previousResponses[0];
                            break;
                        }
                    }

                    statusText.textContent = `Receiving response... (${pollAttempts + 1})`;
                }
            }

            pollAttempts++;
            await sleep(POLL_INTERVAL);

        } catch (error) {
            console.error('Error polling for response:', error);
            throw error;
        }
    }

    showLoading(false);

    if (stableContent) {
        // Add AI response to UI
        addMessageToUI('ai', stableContent);
        
        // Add to history
        currentSession.history.push({
            role: 'assistant',
            content: stableContent
        });

        statusText.textContent = 'Ready';
    } else {
        throw new Error('Response did not stabilize');
    }

    setInputState(true);
}

// Add message to UI
function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'U' : 'AI';

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    const messageRole = document.createElement('div');
    messageRole.className = 'message-role';
    messageRole.textContent = role === 'user' ? 'You' : 'AI Assistant';

    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = content;

    messageContent.appendChild(messageRole);
    messageContent.appendChild(messageText);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);

    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// Show/hide loading indicator
function showLoading(show) {
    loadingIndicator.classList.toggle('hidden', !show);
    if (show) {
        scrollToBottom();
    }
}

// Set input state
function setInputState(enabled) {
    isWaitingForResponse = !enabled;
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    modelSelect.disabled = !enabled;
}

// Show error message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message ai';
    errorDiv.innerHTML = `
        <div class="message-avatar">⚠️</div>
        <div class="message-content">
            <div class="message-role">System</div>
            <div class="message-text" style="color: #ef4444;">${message}</div>
        </div>
    `;
    chatMessages.appendChild(errorDiv);
    scrollToBottom();
}

// Scroll to bottom of chat
function scrollToBottom() {
    setTimeout(() => {
        chatMessages.parentElement.scrollTop = chatMessages.parentElement.scrollHeight;
    }, 100);
}

// Sleep utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
