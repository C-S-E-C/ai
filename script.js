// API Configuration
const API_BASE_URL = "https://1.s.csec.top:10082/api"

// State Management
let currentSessionKey = null
let currentSessionId = null
let conversationHistory = []
let isProcessing = false
let selectedModel = null

// DOM Elements
const modelSelect = document.getElementById("model-select")
const chatMessages = document.getElementById("chat-messages")
const chatWrapper = document.getElementById("chat-wrapper")
const messageInput = document.getElementById("message-input")
const sendButton = document.getElementById("send-button")
const loadingIndicator = document.getElementById("loading-indicator")
const statusText = document.getElementById("status-text")
const welcomeMessage = document.getElementById("welcome-message")

// Initialize App
async function init() {
  await loadModels()
  setupEventListeners()
}

// Load Available Models
async function loadModels() {
  try {
    statusText.textContent = "Loading models..."
    const response = await fetch(`${API_BASE_URL}/list-models`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error("Failed to load models")
    }

    const models = await response.json()

    modelSelect.innerHTML = '<option value="">Select a model</option>'
    models.forEach((model) => {
      const option = document.createElement("option")
      option.value = model
      option.textContent = model
      modelSelect.appendChild(option)
    })

    statusText.textContent = "Ready"
  } catch (error) {
    console.error("Error loading models:", error)
    modelSelect.innerHTML = '<option value="">Error loading models</option>'
    statusText.textContent = "Error loading models"
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Model selection
  modelSelect.addEventListener("change", (e) => {
    selectedModel = e.target.value
    if (selectedModel) {
      resetSession()
      statusText.textContent = `Model: ${selectedModel}`
    }
  })

  // Send button
  sendButton.addEventListener("click", handleSendMessage)

  // Message input
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  })

  // Auto-resize textarea
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto"
    messageInput.style.height = messageInput.scrollHeight + "px"
  })
}

// Handle Send Message
async function handleSendMessage() {
  const message = messageInput.value.trim()

  if (!message || isProcessing) return

  if (!selectedModel) {
    alert("Please select a model first")
    return
  }

  // Add user message to UI
  addMessage("user", message)
  messageInput.value = ""
  messageInput.style.height = "auto"

  // Hide welcome message
  if (welcomeMessage) {
    welcomeMessage.style.display = "none"
  }

  // Process message
  await processMessage(message)
}

// Add Message to UI
function addMessage(role, content) {
  const messageDiv = document.createElement("div")
  messageDiv.className = `message ${role}`

  const avatar = document.createElement("div")
  avatar.className = "message-avatar"
  avatar.textContent = role === "user" ? "U" : "AI"

  const messageContent = document.createElement("div")
  messageContent.className = "message-content"

  const roleLabel = document.createElement("div")
  roleLabel.className = "message-role"
  roleLabel.textContent = role === "user" ? "You" : "Assistant"

  const messageText = document.createElement("div")
  messageText.className = "message-text"
  messageText.textContent = content

  messageContent.appendChild(roleLabel)
  messageContent.appendChild(messageText)
  messageDiv.appendChild(avatar)
  messageDiv.appendChild(messageContent)

  chatMessages.appendChild(messageDiv)
  scrollToBottom()

  return messageText
}

// Process Message with AI
async function processMessage(userMessage) {
  isProcessing = true
  updateUIState()

  try {
    // Add to history
    conversationHistory.push({
      role: "user",
      content: userMessage,
    })

    // Create or continue session
    await createSession()

    // Get AI response
    const aiResponse = await pollResponse()

    // Add AI response to UI and history
    addMessage("assistant", aiResponse)
    conversationHistory.push({
      role: "assistant",
      content: aiResponse,
    })

    statusText.textContent = "Ready"
  } catch (error) {
    console.error("Error processing message:", error)
    addMessage("assistant", `Error: ${error.message}`)
    statusText.textContent = "Error occurred"
  } finally {
    isProcessing = false
    updateUIState()
  }
}

// Create Chat Session
async function createSession() {
  try {
    statusText.textContent = "Starting session..."

    const response = await fetch(`${API_BASE_URL}/start-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        history: conversationHistory,
      }),
    })

    if (!response.ok) {
      throw new Error("Failed to start session")
    }

    const data = await response.json()
    currentSessionKey = data.key
    currentSessionId = data.session_id

    statusText.textContent = "Session started"
  } catch (error) {
    console.error("Error creating session:", error)
    throw new Error("Failed to create chat session")
  }
}

// Poll for Response with Stability Check
async function pollResponse() {
  const responses = []
  const maxAttempts = 100
  let attempt = 0

  statusText.textContent = "Waiting for response..."

  while (attempt < maxAttempts) {
    try {
      const response = await fetch(`${API_BASE_URL}/get-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: currentSessionKey,
          session_id: currentSessionId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get response")
      }

      const data = await response.json()

      // Join the chat array into a single string
      const currentResponse = Array.isArray(data.chat) ? data.chat.join("") : ""
      responses.push(currentResponse)

      // Check if last 5 responses are identical
      if (responses.length >= 5) {
        const last5 = responses.slice(-5)
        const allSame = last5.every((r) => r === last5[0])

        if (allSame && last5[0]) {
          return last5[0]
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 500))
      attempt++

      statusText.textContent = `Receiving response... (${attempt})`
    } catch (error) {
      console.error("Error polling response:", error)
      throw new Error("Failed to get AI response")
    }
  }

  // If we hit max attempts, return the last response
  return responses[responses.length - 1] || "No response received"
}

// Reset Session
function resetSession() {
  currentSessionKey = null
  currentSessionId = null
  conversationHistory = []
  chatMessages.innerHTML = ""

  // Show welcome message
  const welcome = document.createElement("div")
  welcome.className = "welcome-message"
  welcome.id = "welcome-message"
  welcome.innerHTML = `
        <div class="welcome-icon">💬</div>
        <h2>Welcome to Chat AI</h2>
        <p>Start chatting with ${selectedModel}</p>
    `
  chatMessages.appendChild(welcome)
}

// Update UI State
function updateUIState() {
  if (isProcessing) {
    messageInput.disabled = true
    sendButton.disabled = true
    loadingIndicator.classList.remove("hidden")
  } else {
    messageInput.disabled = false
    sendButton.disabled = false
    loadingIndicator.classList.add("hidden")
    messageInput.focus()
  }
}

// Scroll to Bottom
function scrollToBottom() {
  chatWrapper.scrollTop = chatWrapper.scrollHeight
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", init)
