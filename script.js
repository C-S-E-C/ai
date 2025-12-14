// API Configuration
const API_BASE_URL = 'https://1.s.csec.top:10082/api';
const ENDPOINTS = {
    listModels: `${API_BASE_URL}/list-models`,
    startSession: `${API_BASE_URL}/start-session`,
    getSession: `${API_BASE_URL}/get-session`,
    streamSession: `${API_BASE_URL}/stream-session`,
    continueSession: `${API_BASE_URL}/continue-session`,
    endSession: `${API_BASE_URL}/end-session`
};

// Application State
let currentSession = {
    key: null,
    sessionId: null,
    model: null,
    history: [],
    eventSource: null,
    isStreaming: false
};

// DOM Elements
const modelSelect = document.getElementById('model-select');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const loadingIndicator = document.getElementById('loading-indicator');
const statusText = document.getElementById('status-text');
const clearChatBtn = document.getElementById('clear-chat');

// Initialize Application
async function init() {
    await loadModels();
    setupEventListeners();
    autoResizeTextarea();
    
    // 加载保存的会话
    loadSavedSession();
}

// Load available models
async function loadModels() {
    try {
        statusText.textContent = 'Loading models...';
        
        const response = await fetch(ENDPOINTS.listModels, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const models = await response.json();
        
        if (models && Array.isArray(models)) {
            populateModelSelect(models);
            statusText.textContent = 'Select a model to begin';
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading models:', error);
        showError('Failed to load models. Please check your connection and try again.');
        statusText.textContent = 'Error loading models';
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
    
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }
    
    // 页面卸载时清理资源
    window.addEventListener('beforeunload', cleanupResources);
}

// Handle model selection
function handleModelChange() {
    const selectedModel = modelSelect.value;
    if (selectedModel) {
        currentSession.model = selectedModel;
        sendButton.disabled = false;
        statusText.textContent = `Ready with ${selectedModel}`;
        clearWelcomeMessage();
        
        // 保存选择的模型
        localStorage.setItem('selectedModel', selectedModel);
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
    
    if (!message || !currentSession.model || currentSession.isStreaming) {
        return;
    }

    // 添加用户消息到UI
    addMessageToUI('user', message);
    
    // 添加到历史记录
    currentSession.history.push({
        role: 'user',
        content: message
    });

    // 清空输入框
    messageInput.value = '';
    autoResizeTextarea();

    // 禁用输入等待响应
    setInputState(false);
    showLoading(true);
    
    try {
        if (!currentSession.key || !currentSession.sessionId) {
            // 开始新会话
            await startNewSession(message);
        } else {
            // 继续现有会话
            await continueSession(message);
        }
        
        // 开始流式接收响应
        await startStreamingResponse();
        
    } catch (error) {
        console.error('Error sending message:', error);
        showError('Failed to send message. Please try again.');
        setInputState(true);
        showLoading(false);
    }
}

// Start new chat session
async function startNewSession(message) {
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
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json();
        
        if (data.key && data.session_id) {
            currentSession.key = data.key;
            currentSession.sessionId = data.session_id;
            statusText.textContent = 'Session started, receiving response...';
            
            // 保存会话信息到localStorage
            saveSessionToStorage();
            
        } else {
            throw new Error('Invalid session response');
        }
    } catch (error) {
        throw new Error(`Failed to start session: ${error.message}`);
    }
}

// Continue existing session
async function continueSession(message) {
    try {
        statusText.textContent = 'Sending message...';
        
        const response = await fetch(ENDPOINTS.continueSession, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: currentSession.sessionId,
                key: currentSession.key,
                message: message
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        statusText.textContent = 'Receiving response...';
        
    } catch (error) {
        throw new Error(`Failed to continue session: ${error.message}`);
    }
}

// Start streaming response using SSE
async function startStreamingResponse() {
    return new Promise((resolve, reject) => {
        if (!currentSession.sessionId || !currentSession.key) {
            reject(new Error('No active session'));
            return;
        }
        
        // 关闭之前的连接
        if (currentSession.eventSource) {
            currentSession.eventSource.close();
        }
        
        // 创建AI消息容器
        const aiMessageId = 'ai-response-' + Date.now();
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.id = aiMessageId;
        aiMessageDiv.className = 'message ai streaming';
        
        aiMessageDiv.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <div class="message-role">AI Assistant</div>
                <div class="message-text" id="${aiMessageId}-content"></div>
            </div>
        `;
        
        chatMessages.appendChild(aiMessageDiv);
        scrollToBottom();
        
        // 创建EventSource连接
        currentSession.isStreaming = true;
        currentSession.eventSource = new EventSource(
            `${ENDPOINTS.streamSession}?session_id=${currentSession.sessionId}&key=${currentSession.key}`
        );
        
        const contentElement = document.getElementById(`${aiMessageId}-content`);
        let fullResponse = '';
        
        // 处理流式数据
        currentSession.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                if (data.content) {
                    fullResponse += data.content;
                    contentElement.textContent = fullResponse;
                    scrollToBottom();
                }
                
                if (data.done) {
                    // 流式传输完成
                    currentSession.eventSource.close();
                    currentSession.isStreaming = false;
                    currentSession.eventSource = null;
                    
                    // 移除streaming类
                    aiMessageDiv.classList.remove('streaming');
                    
                    // 添加到历史记录
                    if (fullResponse) {
                        currentSession.history.push({
                            role: 'assistant',
                            content: fullResponse
                        });
                    }
                    
                    // 保存会话
                    saveSessionToStorage();
                    
                    setInputState(true);
                    showLoading(false);
                    statusText.textContent = 'Ready';
                    
                    resolve();
                }
                
            } catch (error) {
                console.error('Error processing stream data:', error);
                reject(error);
            }
        };
        
        // 处理错误
        currentSession.eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            currentSession.eventSource.close();
            currentSession.isStreaming = false;
            currentSession.eventSource = null;
            
            // 显示错误
            contentElement.innerHTML = `<span style="color: #ef4444;">Error receiving response. Please try again.</span>`;
            aiMessageDiv.classList.remove('streaming');
            
            setInputState(true);
            showLoading(false);
            statusText.textContent = 'Connection error';
            
            reject(error);
        };
        
        // 设置超时
        setTimeout(() => {
            if (currentSession.isStreaming) {
                console.warn('Stream timeout');
                currentSession.eventSource.close();
                currentSession.isStreaming = false;
                currentSession.eventSource = null;
                
                if (!fullResponse) {
                    contentElement.innerHTML = `<span style="color: #ef4444;">Response timeout. Please try again.</span>`;
                }
                
                aiMessageDiv.classList.remove('streaming');
                setInputState(true);
                showLoading(false);
                statusText.textContent = 'Timeout';
                
                resolve();
            }
        }, 30000); // 30秒超时
    });
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
    if (loadingIndicator) {
        loadingIndicator.classList.toggle('hidden', !show);
    }
    if (show) {
        scrollToBottom();
    }
}

// Set input state
function setInputState(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    modelSelect.disabled = !enabled;
    
    if (enabled) {
        messageInput.focus();
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message ai error';
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

// Clear chat
function clearChat() {
    if (confirm('Are you sure you want to clear the chat?')) {
        chatMessages.innerHTML = '';
        
        // 结束当前会话
        if (currentSession.sessionId && currentSession.key) {
            endCurrentSession();
        }
        
        // 重置会话状态
        currentSession = {
            key: null,
            sessionId: null,
            model: currentSession.model, // 保持模型选择
            history: [],
            eventSource: null,
            isStreaming: false
        };
        
        // 清理存储
        localStorage.removeItem('chatSession');
        
        // 显示欢迎消息
        showWelcomeMessage();
        
        statusText.textContent = currentSession.model ? `Ready with ${currentSession.model}` : 'Select a model to begin';
    }
}

// End current session
async function endCurrentSession() {
    try {
        if (currentSession.eventSource) {
            currentSession.eventSource.close();
        }
        
        await fetch(ENDPOINTS.endSession, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: currentSession.sessionId,
                key: currentSession.key
            })
        });
    } catch (error) {
        console.error('Error ending session:', error);
    }
}

// Save session to localStorage
function saveSessionToStorage() {
    const sessionData = {
        key: currentSession.key,
        sessionId: currentSession.sessionId,
        model: currentSession.model,
        history: currentSession.history.slice(-20) // 保存最近20条消息
    };
    
    localStorage.setItem('chatSession', JSON.stringify(sessionData));
}

// Load saved session from localStorage
function loadSavedSession() {
    try {
        const saved = localStorage.getItem('chatSession');
        const savedModel = localStorage.getItem('selectedModel');
        
        if (saved) {
            const sessionData = JSON.parse(saved);
            
            // 恢复会话
            currentSession.key = sessionData.key;
            currentSession.sessionId = sessionData.sessionId;
            currentSession.model = sessionData.model;
            currentSession.history = sessionData.history || [];
            
            // 恢复模型选择
            if (currentSession.model) {
                modelSelect.value = currentSession.model;
                sendButton.disabled = false;
            }
            
            // 恢复聊天历史显示
            if (currentSession.history.length > 0) {
                clearWelcomeMessage();
                currentSession.history.forEach(msg => {
                    if (msg.role && msg.content) {
                        addMessageToUI(msg.role === 'user' ? 'user' : 'ai', msg.content);
                    }
                });
                
                statusText.textContent = `Resumed session with ${currentSession.model}`;
            }
        }
        
        // 恢复模型选择
        if (savedModel && modelSelect) {
            modelSelect.value = savedModel;
            currentSession.model = savedModel;
            sendButton.disabled = false;
        }
        
    } catch (error) {
        console.error('Error loading saved session:', error);
        localStorage.removeItem('chatSession');
    }
}

// Show welcome message
function showWelcomeMessage() {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
        <h3>Welcome to Chat AI</h3>
        <p>Select a model from the dropdown above and start chatting!</p>
    `;
    chatMessages.appendChild(welcomeDiv);
}

// Scroll to bottom of chat
function scrollToBottom() {
    setTimeout(() => {
        if (chatMessages && chatMessages.parentElement) {
            chatMessages.parentElement.scrollTop = chatMessages.parentElement.scrollHeight;
        }
    }, 100);
}

// Cleanup resources
function cleanupResources() {
    if (currentSession.eventSource) {
        currentSession.eventSource.close();
    }
    
    if (currentSession.sessionId && currentSession.key) {
        // 尝试结束会话，但不等待响应
        fetch(ENDPOINTS.endSession, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                session_id: currentSession.sessionId,
                key: currentSession.key
            })
        }).catch(() => {}); // 忽略错误
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
