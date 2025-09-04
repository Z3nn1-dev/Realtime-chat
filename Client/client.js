class LiveChatClient {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.sessionId = null;
        this.isConnected = false;
        this.unreadMessages = 0;
        this.typingTimer = null;
        this.isTyping = false;
        
        this.initializeElements();
        this.attachEventListeners();
        this.initializeSocket();
    }

    initializeElements() {
        // Chat widget elements
        this.chatToggle = document.getElementById('chatToggle');
        this.chatWindow = document.getElementById('chatWindow');
        this.chatContent = document.getElementById('chatContent');
        this.joinForm = document.getElementById('joinForm');
        
        // Controls
        this.minimizeBtn = document.getElementById('minimizeChat');
        this.closeBtn = document.getElementById('closeChat');
        this.unreadCount = document.getElementById('unreadCount');
        
        // Join form elements
        this.userNameInput = document.getElementById('userName');
        this.joinBtn = document.getElementById('joinBtn');
        
        // Message elements
        this.messagesList = document.getElementById('messagesList');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.typingIndicator = document.getElementById('typingIndicator');
    }

    attachEventListeners() {
        // Chat toggle
        this.chatToggle.addEventListener('click', () => this.toggleChat());
        
        // Controls
        this.minimizeBtn.addEventListener('click', () => this.minimizeChat());
        this.closeBtn.addEventListener('click', () => this.closeChat());
        
        // Join form
        this.joinBtn.addEventListener('click', () => this.joinChat());
        this.userNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChat();
        });
        
        // Message sending
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            } else {
                this.handleTyping();
            }
        });
        
        // Stop typing when input loses focus
        this.messageInput.addEventListener('blur', () => {
            this.stopTyping();
        });
        
        // Prevent chat from closing when clicking inside
        this.chatWindow.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Close chat when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.chatToggle.contains(e.target) && 
                !this.chatWindow.contains(e.target) && 
                !this.chatWindow.classList.contains('hidden')) {
                this.closeChat();
            }
        });
    }

    initializeSocket() {
        this.socket = io();
        
        // Connection events
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            this.showSystemMessage('Disconnected from server. Trying to reconnect...');
        });
        
        // Session events
        this.socket.on('session_created', (data) => {
            this.sessionId = data.sessionId;
            console.log('Session created:', data);
            this.showSystemMessage(data.message);
        });
        
        this.socket.on('session_history', (data) => {
            this.loadChatHistory(data.messages);
        });
        
        this.socket.on('admin_joined', (data) => {
            this.showSystemMessage(`${data.adminName} has joined to help you!`);
        });
        
        this.socket.on('admin_left', (data) => {
            this.showSystemMessage('The support agent has left. Another agent will join shortly if needed.');
        });
        
        this.socket.on('session_closed', (data) => {
            this.showSystemMessage(`Support session ended: ${data.reason}`);
            this.sessionId = null;
        });
        
        this.socket.on('customer_disconnected', (data) => {
            this.showSystemMessage(data.message);
        });
        
        // Chat events
        this.socket.on('receive_message', (message) => {
            this.displayMessage(message);
            if (this.chatWindow.classList.contains('hidden')) {
                this.incrementUnreadCount();
            }
        });
        
        this.socket.on('user_typing', (data) => {
            this.showTypingIndicator(data);
        });
        
        this.socket.on('error', (data) => {
            this.showSystemMessage(`Error: ${data.message}`);
        });
    }

    toggleChat() {
        if (this.chatWindow.classList.contains('hidden')) {
            this.openChat();
        } else {
            this.closeChat();
        }
    }

    openChat() {
        this.chatWindow.classList.remove('hidden');
        this.resetUnreadCount();
        
        if (this.currentUser) {
            this.messageInput.focus();
        } else {
            this.userNameInput.focus();
        }
    }

    closeChat() {
        this.chatWindow.classList.add('hidden');
    }

    minimizeChat() {
        this.closeChat();
    }

    joinChat() {
        const userName = this.userNameInput.value.trim();
        
        if (!userName) {
            alert('Please enter your name');
            return;
        }
        
        if (userName.length > 20) {
            alert('Name must be 20 characters or less');
            return;
        }

        this.currentUser = {
            name: userName,
            isAdmin: false
        };

        // Send join request to server
        this.socket.emit('join', this.currentUser);
        
        // Switch to chat interface
        this.joinForm.classList.add('hidden');
        this.chatContent.classList.remove('hidden');
        this.messageInput.focus();
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        
        if (!message || !this.currentUser) return;
        
        if (message.length > 500) {
            alert('Message must be 500 characters or less');
            return;
        }

        // Send message to server (session will be created automatically if needed)
        this.socket.emit('send_message', { 
            message: message
        });
        
        // Clear input
        this.messageInput.value = '';
        this.stopTyping();
    }

    displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        // Check if it's user's own message
        const isOwnMessage = this.currentUser && message.user === this.currentUser.name;
        
        if (isOwnMessage) {
            messageElement.classList.add('own');
        }
        
        if (message.isAdmin) {
            messageElement.classList.add('admin');
        }
        
        if (message.isSystem) {
            messageElement.classList.add('system');
        }
        
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = message.message;
        
        const info = document.createElement('div');
        info.className = 'message-info';
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        info.textContent = `${message.user} • ${timestamp}`;
        
        messageElement.appendChild(bubble);
        messageElement.appendChild(info);
        
        this.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    loadChatHistory(messages) {
        this.messagesList.innerHTML = '';
        messages.forEach(message => this.displayMessage(message));
    }

    showSystemMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.className = 'system-message';
        messageElement.textContent = text;
        this.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typing', { isTyping: true });
        }
        
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }

    stopTyping() {
        if (this.isTyping) {
            this.isTyping = false;
            this.socket.emit('typing', { isTyping: false });
        }
        clearTimeout(this.typingTimer);
    }

    showTypingIndicator(data) {
        if (data.isTyping) {
            this.typingIndicator.innerHTML = `
                <span>${data.user} is typing</span>
                <span class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            `;
            this.typingIndicator.classList.remove('hidden');
        } else {
            this.typingIndicator.classList.add('hidden');
        }
        this.scrollToBottom();
    }

    incrementUnreadCount() {
        this.unreadMessages++;
        this.unreadCount.textContent = this.unreadMessages;
        this.unreadCount.classList.remove('hidden');
    }

    resetUnreadCount() {
        this.unreadMessages = 0;
        this.unreadCount.classList.add('hidden');
    }

    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    }

    resetChat() {
        this.currentUser = null;
        this.joinForm.classList.remove('hidden');
        this.chatContent.classList.add('hidden');
        this.messagesList.innerHTML = '';
        this.userNameInput.value = '';
        this.closeChat();
    }
}

// Initialize the chat client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatClient = new LiveChatClient();
});
