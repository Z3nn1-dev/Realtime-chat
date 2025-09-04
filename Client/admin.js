class AdminChatClient {
    constructor() {
        this.socket = null;
        this.currentAdmin = null;
        this.currentSession = null;
        this.isConnected = false;
        this.sessions = new Map();
        
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Login elements
        this.adminLogin = document.getElementById('adminLogin');
        this.adminPanel = document.getElementById('adminPanel');
        this.loginForm = document.getElementById('loginForm');
        this.adminNameInput = document.getElementById('adminNameInput');
        this.adminPassword = document.getElementById('adminPassword');
        
        // Header elements
        this.connectionStatus = document.getElementById('connectionStatus');
        this.adminNameDisplay = document.getElementById('adminName');
        
        // Navigation
        this.navButtons = document.querySelectorAll('.nav-btn');
        this.adminTabs = document.querySelectorAll('.admin-tab');
        
        // Chat elements
        this.adminMessagesList = document.getElementById('adminMessagesList');
        this.adminMessageInput = document.getElementById('adminMessageInput');
        this.sendAdminMessage = document.getElementById('sendAdminMessage');
        this.closeSessionBtn = document.getElementById('closeSessionBtn');
        this.leaveSessionBtn = document.getElementById('leaveSessionBtn');
        this.sessionInfo = document.getElementById('sessionInfo');
        this.customerName = document.getElementById('customerName');
        this.sessionId = document.getElementById('sessionId');
        this.noSessionMessage = document.getElementById('noSessionMessage');
        this.messagesPanel = document.getElementById('messagesPanel');
        this.messageControls = document.getElementById('messageControls');
        
        // Sessions elements
        this.sessionsList = document.getElementById('sessionsList');
        this.sessionCount = document.getElementById('sessionCount');
        this.activeSessionCount = document.getElementById('activeSessionCount');
        this.waitingSessionCount = document.getElementById('waitingSessionCount');
        
        // Settings elements
        this.serverStatus = document.getElementById('serverStatus');
        this.serverUptime = document.getElementById('serverUptime');
        this.exportChatBtn = document.getElementById('exportChatBtn');
        this.reloadServerBtn = document.getElementById('reloadServerBtn');
    }

    attachEventListeners() {
        // Login form
        this.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAdminLogin();
        });
        
        // Navigation
        this.navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });
        
        // Chat controls
        this.sendAdminMessage.addEventListener('click', () => this.sendMessage());
        this.adminMessageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Session controls
        if (this.closeSessionBtn) {
            this.closeSessionBtn.addEventListener('click', () => this.closeCurrentSession());
        }
        
        if (this.leaveSessionBtn) {
            this.leaveSessionBtn.addEventListener('click', () => this.leaveCurrentSession());
        }
        
        // Settings controls
        if (this.reloadServerBtn) {
            this.reloadServerBtn.addEventListener('click', () => this.reconnect());
        }
        
        if (this.exportChatBtn) {
            this.exportChatBtn.addEventListener('click', () => this.exportChatHistory());
        }
    }

    handleAdminLogin() {
        const adminName = this.adminNameInput.value.trim();
        const password = this.adminPassword.value;
        
        // Simple password check (in production, use proper authentication)
        if (!adminName || password !== 'admin123') {
            alert('Invalid credentials. Use password: admin123');
            return;
        }
        
        this.currentAdmin = {
            name: adminName,
            isAdmin: true
        };
        
        this.initializeSocket();
        this.showAdminPanel();
    }

    showAdminPanel() {
        this.adminLogin.classList.add('hidden');
        this.adminPanel.classList.remove('hidden');
        this.adminNameDisplay.textContent = this.currentAdmin.name;
        
        // Ensure the first tab (Active Session) is shown by default
        this.switchTab('chat');
    }

    initializeSocket() {
        this.socket = io();
        
        // Connection events
        this.socket.on('connect', () => {
            console.log('Admin connected to server');
            this.isConnected = true;
            this.updateConnectionStatus('connected');
            
            // Join as admin
            this.socket.emit('join', this.currentAdmin);
            
            // Request session list
            setTimeout(() => {
                console.log('Requesting initial session list...');
                this.socket.emit('get_sessions');
            }, 500);
        });
        
        this.socket.on('disconnect', () => {
            console.log('Admin disconnected from server');
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
        });
        
        // Session events
        this.socket.on('session_list_update', (sessions) => {
            console.log('Received session list update:', sessions);
            
            // Log detailed session info
            sessions.forEach((session, index) => {
                console.log(`Session ${index}:`, {
                    id: session.id,
                    customer: session.customer,
                    admin: session.admin,
                    isMySession: session.admin && session.admin.name === this.currentAdmin.name
                });
            });
            
            this.updateSessionsList(sessions);
        });
        
        this.socket.on('session_history', (data) => {
            console.log('Received session history:', data);
            this.loadSessionHistory(data);
        });
        
        // Handle session history requests (different from joining)
        this.socket.on('session_messages', (data) => {
            console.log('Received session messages:', data);
            if (this.currentSession && this.currentSession.id === data.sessionId) {
                this.currentSession.messages = data.messages || [];
                // Load messages into UI
                this.adminMessagesList.innerHTML = '';
                if (data.messages) {
                    data.messages.forEach(message => this.displayMessage(message));
                }
            }
        });
        
        this.socket.on('new_session_alert', (data) => {
            this.showNewSessionAlert(data);
        });
        
        this.socket.on('customer_disconnected', (data) => {
            this.showSystemMessage(`Customer in session ${data.sessionId} has disconnected`);
        });
        
        // Chat events
        this.socket.on('receive_message', (message) => {
            this.displayMessage(message);
        });
        
        this.socket.on('error', (data) => {
            alert(`Error: ${data.message}`);
        });
    }

    updateConnectionStatus(status) {
        this.connectionStatus.className = `status-indicator ${status}`;
        switch (status) {
            case 'connected':
                this.connectionStatus.textContent = 'Connected';
                break;
            case 'disconnected':
                this.connectionStatus.textContent = 'Disconnected';
                break;
            case 'connecting':
                this.connectionStatus.textContent = 'Connecting...';
                break;
        }
    }

    switchTab(tabName) {
        console.log('Switching to tab:', tabName);
        
        // Update navigation
        this.navButtons.forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle('active', isActive);
            console.log(`Nav button ${btn.dataset.tab}: ${isActive ? 'active' : 'inactive'}`);
        });
        
        // Update tabs
        this.adminTabs.forEach(tab => {
            const shouldBeActive = tab.id === `${tabName}Tab`;
            tab.classList.toggle('active', shouldBeActive);
            console.log(`Tab ${tab.id}: ${shouldBeActive ? 'showing' : 'hiding'} (classes: ${tab.className})`);
            
            // Force visibility for sessions tab if it should be active
            if (shouldBeActive && tabName === 'sessions') {
                tab.style.display = 'flex';
                tab.style.visibility = 'visible';
                tab.style.opacity = '1';
                tab.style.height = 'auto';
                tab.style.overflow = 'visible';
                console.log('Forced sessions tab to be visible');
                
                // Also force the sessions list to be visible
                if (this.sessionsList) {
                    this.sessionsList.style.display = 'block';
                    this.sessionsList.style.visibility = 'visible';
                    console.log('Forced sessions list to be visible');
                }
            } else if (!shouldBeActive) {
                // Hide inactive tabs
                tab.style.display = 'none';
            }
        });
        
        // If switching to sessions tab, make sure we have the latest data
        if (tabName === 'sessions') {
            console.log('Requesting session update for sessions tab');
            this.socket.emit('get_sessions');
        } else if (tabName === 'chat') {
            // If switching to Active Session tab, make sure current session UI is updated
            console.log('Switching to Active Session tab');
            if (this.currentSession) {
                console.log('Updating UI for existing current session');
                this.updateActiveSessionUI();
            } else {
                console.log('No current session - requesting session list to check for active sessions');
                this.socket.emit('get_sessions');
            }
        }
    }

    sendMessage() {
        const message = this.adminMessageInput.value.trim();
        if (!message || !this.currentSession) return;
        
        this.socket.emit('send_message', { 
            message: message,
            sessionId: this.currentSession.id 
        });
        this.adminMessageInput.value = '';
    }

    // Session management methods
    updateSessionsList(sessions) {
        console.log('Updating sessions list with:', sessions);
        this.sessions.clear();
        let activeCount = 0;
        let waitingCount = 0;
        let myActiveSession = null;
        
        sessions.forEach(session => {
            this.sessions.set(session.id, session);
            if (session.admin) {
                activeCount++;
                // Check if this admin is me
                if (session.admin.name === this.currentAdmin.name) {
                    myActiveSession = session;
                    console.log('Found my active session:', session);
                }
            } else if (session.customer) {
                waitingCount++;
            }
        });
        
        // Update counters
        if (this.sessionCount) this.sessionCount.textContent = sessions.length;
        if (this.activeSessionCount) this.activeSessionCount.textContent = activeCount;
        if (this.waitingSessionCount) this.waitingSessionCount.textContent = waitingCount;
        
        console.log(`Session counts - Total: ${sessions.length}, Active: ${activeCount}, Waiting: ${waitingCount}`);
        
        // If I have an active session but currentSession is not set, set it
        if (myActiveSession && !this.currentSession) {
            console.log('AUTO-LOADING: Found my active session, loading it automatically:', myActiveSession);
            
            // Set the current session
            this.currentSession = {
                id: myActiveSession.id,
                sessionId: myActiveSession.id,
                customer: myActiveSession.customer,
                messages: myActiveSession.messages || []
            };
            
            // Update UI immediately
            this.updateActiveSessionUI();
            
            // Only request session history if we don't have messages, and don't re-join
            if (!myActiveSession.messages || myActiveSession.messages.length === 0) {
                console.log('No messages cached, requesting session history...');
                console.log('Current admin object:', this.currentAdmin);
                this.socket.emit('get_session_history', { 
                    sessionId: myActiveSession.id,
                    adminId: this.currentAdmin ? this.currentAdmin.name : 'unknown'
                });
            }
            
        } else if (myActiveSession && this.currentSession && this.currentSession.id !== myActiveSession.id) {
            // If we have a different active session, switch to it
            console.log('SWITCHING: Different active session detected, switching to:', myActiveSession);
            this.currentSession = {
                id: myActiveSession.id,
                sessionId: myActiveSession.id,
                customer: myActiveSession.customer,
                messages: myActiveSession.messages || []
            };
            this.updateActiveSessionUI();
            this.socket.emit('get_session_history', { 
                sessionId: myActiveSession.id,
                adminId: this.currentAdmin ? this.currentAdmin.name : 'unknown'
            });
            
        } else if (myActiveSession && this.currentSession) {
            // Update existing session data
            this.currentSession.customer = myActiveSession.customer;
            this.updateActiveSessionUI();
            
        } else if (!myActiveSession && this.currentSession) {
            // No active session found but we think we have one - clear it
            console.log('CLEARING: No active session found, clearing current session');
            this.currentSession = null;
            this.clearActiveSessionUI();
        }
        
        // Update sessions list UI
        this.renderSessionsList(sessions);
    }
    
    updateActiveSessionUI() {
        if (this.currentSession && this.currentSession.customer) {
            console.log('Updating active session UI for:', this.currentSession);
            
            // Hide no session message
            this.noSessionMessage.classList.add('hidden');
            
            // Show session elements
            this.sessionInfo.classList.remove('hidden');
            this.messagesPanel.classList.remove('hidden');
            this.messageControls.classList.remove('hidden');
            this.closeSessionBtn.classList.remove('hidden');
            this.leaveSessionBtn.classList.remove('hidden');
            
            // Update session info
            this.customerName.textContent = `Chat with ${this.currentSession.customer.name}`;
            this.sessionId.textContent = `Session: ${this.currentSession.sessionId || this.currentSession.id}`;
            
            // Load messages if available
            if (this.currentSession.messages && this.currentSession.messages.length > 0) {
                this.adminMessagesList.innerHTML = '';
                this.currentSession.messages.forEach(message => this.displayMessage(message));
            }
            
            console.log('Active session UI updated successfully - customer:', this.currentSession.customer.name);
            
            // Make sure we're on the chat tab
            if (document.querySelector('.nav-btn[data-tab="chat"]')) {
                document.querySelector('.nav-btn[data-tab="chat"]').classList.add('active');
            }
        } else {
            console.log('Cannot update active session UI - no valid current session');
            this.clearActiveSessionUI();
        }
    }
    
    clearActiveSessionUI() {
        console.log('Clearing active session UI');
        
        // Hide session elements
        this.sessionInfo.classList.add('hidden');
        this.messagesPanel.classList.add('hidden');
        this.messageControls.classList.add('hidden');
        this.closeSessionBtn.classList.add('hidden');
        this.leaveSessionBtn.classList.add('hidden');
        
        // Show no session message
        this.noSessionMessage.classList.remove('hidden');
        
        // Clear content
        this.customerName.textContent = 'No active session';
        this.sessionId.textContent = '';
        this.adminMessagesList.innerHTML = '';
    }
    
    renderSessionsList(sessions) {
        console.log('Rendering sessions list:', sessions);
        console.log('Sessions list element:', this.sessionsList);
        
        if (!this.sessionsList) {
            console.error('Sessions list element not found!');
            return;
        }
        
        this.sessionsList.innerHTML = '';
        
        // Add test content to verify the element is working
        this.sessionsList.innerHTML = '<div style="padding: 1rem; background: #f0f0f0; margin: 1rem; border-radius: 4px;">TEST: Sessions list is working. Loading sessions...</div>';
        
        if (sessions.length === 0) {
            console.log('No sessions to display');
            this.sessionsList.innerHTML = '<div class="no-sessions">No active sessions</div>';
            return;
        }
        
        console.log(`Rendering ${sessions.length} sessions`);
        
        // Clear test content
        this.sessionsList.innerHTML = '';
        
        sessions.forEach((session, index) => {
            console.log(`Rendering session ${index}:`, session);
            const sessionCard = document.createElement('div');
            sessionCard.className = 'session-card';
            sessionCard.style.border = '1px solid #ccc';
            sessionCard.style.margin = '10px';
            sessionCard.style.padding = '15px';
            sessionCard.style.borderRadius = '8px';
            sessionCard.style.backgroundColor = '#f9f9f9';
            
            const statusClass = session.admin ? 'active' : (session.customer ? 'waiting' : 'disconnected');
            const statusText = session.admin ? 'Active' : (session.customer ? 'Waiting for Admin' : 'Customer Disconnected');
            
            sessionCard.innerHTML = `
                <div class="session-info">
                    <div class="session-details">
                        <h4>${session.customer ? session.customer.name : 'Unknown Customer'}</h4>
                        <div class="session-meta">
                            <div>Session: ${session.id.substring(8, 16)}...</div>
                            <div>Messages: ${session.messageCount}</div>
                            <div>Created: ${new Date(session.createdAt).toLocaleTimeString()}</div>
                        </div>
                    </div>
                    <span class="session-status ${statusClass}">
                        ${statusText}
                    </span>
                </div>
                <div class="session-actions">
                    ${!session.admin && session.customer ? 
                        `<button class="session-btn join" onclick="adminClient.joinSession('${session.id}')">Join Session</button>` : 
                        session.admin && session.admin.name === this.currentAdmin.name ?
                        `<button class="session-btn current" onclick="adminClient.switchToActiveSession('${session.id}')">Current Session</button>` :
                        `<button class="session-btn occupied">Occupied</button>`
                    }
                </div>
            `;
            
            console.log('Session card HTML:', sessionCard.innerHTML);
            this.sessionsList.appendChild(sessionCard);
        });
        
        console.log('Final sessions list HTML:', this.sessionsList.innerHTML);
    }
    
    joinSession(sessionId) {
        console.log('Joining session:', sessionId);
        const session = this.sessions.get(sessionId);
        
        if (session && session.admin && session.admin.name === this.currentAdmin.name) {
            console.log('Already in this session, just switching to it...');
            this.switchToActiveSession(sessionId);
            return;
        }
        
        this.socket.emit('join_session', { sessionId: sessionId });
    }
    
    switchToActiveSession(sessionId) {
        console.log('Switching to active session:', sessionId);
        const session = this.sessions.get(sessionId);
        if (session) {
            console.log('Loading existing session into Active Session tab:', session);
            this.currentSession = {
                id: session.id,
                sessionId: session.id,
                customer: session.customer,
                messages: session.messages || []
            };
            
            // Update UI immediately
            this.updateActiveSessionUI();
            
            // Only request session history if we don't have messages
            if (!session.messages || session.messages.length === 0) {
                console.log('No messages cached, requesting session history...');
                console.log('Current admin object:', this.currentAdmin);
                console.log('Admin name to send:', this.currentAdmin ? this.currentAdmin.name : 'UNDEFINED');
                this.socket.emit('get_session_history', { 
                    sessionId: sessionId,
                    adminId: this.currentAdmin ? this.currentAdmin.name : 'unknown'
                });
            }
            
            // Switch to Active Session tab
            this.switchTab('chat');
        }
    }
    
    loadSessionHistory(data) {
        console.log('Loading session history:', data);
        this.currentSession = data;
        
        // Update UI to show active session
        this.noSessionMessage.classList.add('hidden');
        this.messagesPanel.classList.remove('hidden');
        this.messageControls.classList.remove('hidden');
        this.sessionInfo.classList.remove('hidden');
        this.closeSessionBtn.classList.remove('hidden');
        this.leaveSessionBtn.classList.remove('hidden');
        
        // Update session info
        this.customerName.textContent = `Chat with ${data.customer.name}`;
        this.sessionId.textContent = `Session: ${data.sessionId}`;
        
        // Load messages
        this.adminMessagesList.innerHTML = '';
        data.messages.forEach(message => this.displayMessage(message));
        
        console.log('Switching to chat tab after loading session');
        // Switch to chat tab
        this.switchTab('chat');
    }
    
    closeCurrentSession() {
        if (!this.currentSession) return;
        
        if (confirm('Are you sure you want to close this session? The customer will be disconnected.')) {
            this.socket.emit('admin_action', {
                type: 'close_session',
                sessionId: this.currentSession.id,
                reason: 'Session closed by admin'
            });
            
            this.leaveSession();
        }
    }
    
    leaveCurrentSession() {
        if (!this.currentSession) return;
        
        if (confirm('Are you sure you want to leave this session? The customer will wait for another admin.')) {
            this.socket.emit('leave_session');
            this.leaveSession();
        }
    }
    
    leaveSession() {
        this.currentSession = null;
        
        // Update UI to show no active session
        this.noSessionMessage.classList.remove('hidden');
        this.messagesPanel.classList.add('hidden');
        this.messageControls.classList.add('hidden');
        this.sessionInfo.classList.add('hidden');
        this.closeSessionBtn.classList.add('hidden');
        this.leaveSessionBtn.classList.add('hidden');
        
        // Clear session info
        this.customerName.textContent = 'No active session';
        this.sessionId.textContent = '';
        this.adminMessagesList.innerHTML = '';
        
        // Switch to sessions tab
        this.switchTab('sessions');
    }
    
    showNewSessionAlert(data) {
        // You could add a notification sound or visual alert here
        console.log('New session alert:', data);
    }

    displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'admin-message';
        
        if (message.user === this.currentAdmin.name) {
            messageElement.classList.add('own');
        }
        
        if (message.isSystem) {
            messageElement.classList.add('system');
        } else if (message.isAdmin) {
            messageElement.classList.add('admin-only');
        }
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-user ${message.isAdmin ? 'admin' : ''}">${message.user}</span>
                <span class="message-time">${timestamp}</span>
            </div>
            <div class="message-content">${message.message}</div>
        `;
        
        this.adminMessagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    loadChatHistory(messages) {
        this.adminMessagesList.innerHTML = '';
        messages.forEach(message => this.displayMessage(message));
    }

    showSystemMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.className = 'admin-message system';
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-user">System</span>
                <span class="message-time">${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="message-content">${text}</div>
        `;
        this.adminMessagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    exportChatHistory() {
        if (!this.currentSession) {
            alert('No active session to export');
            return;
        }
        
        const messages = Array.from(this.adminMessagesList.children).map(msg => {
            const user = msg.querySelector('.message-user').textContent;
            const time = msg.querySelector('.message-time').textContent;
            const content = msg.querySelector('.message-content').textContent;
            return `[${time}] ${user}: ${content}`;
        });
        
        const chatData = messages.join('\n');
        const blob = new Blob([chatData], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-${this.currentSession.id}-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    reconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket.connect();
        }
    }

    scrollToBottom() {
        const container = this.messagesPanel;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    forceLoadActiveSession() {
        console.log('=== FORCE LOADING ACTIVE SESSION ===');
        console.log('Current sessions map:', this.sessions);
        console.log('Current admin:', this.currentAdmin);
        console.log('Looking for admin name:', this.currentAdmin ? this.currentAdmin.name : 'NO ADMIN');
        
        // Find any session where I'm the admin
        let foundSession = null;
        for (const [sessionId, session] of this.sessions) {
            console.log(`Checking session ${sessionId}:`, {
                id: session.id,
                customer: session.customer ? session.customer.name : 'NO CUSTOMER',
                admin: session.admin ? session.admin.name : 'NO ADMIN',
                isMySession: session.admin && session.admin.name === this.currentAdmin.name
            });
            
            if (session.admin && session.admin.name === this.currentAdmin.name) {
                foundSession = session;
                break;
            }
        }
        
        if (foundSession) {
            console.log('✅ FOUND MY ACTIVE SESSION:', foundSession);
            this.currentSession = {
                id: foundSession.id,
                sessionId: foundSession.id,
                customer: foundSession.customer,
                messages: foundSession.messages || []
            };
            
            // Update UI immediately
            this.updateActiveSessionUI();
            
            // Only request session history if we don't have messages, and don't re-join
            if (!foundSession.messages || foundSession.messages.length === 0) {
                console.log('No messages cached, requesting session history...');
                console.log('Current admin object:', this.currentAdmin);
                console.log('Admin name to send:', this.currentAdmin ? this.currentAdmin.name : 'UNDEFINED');
                this.socket.emit('get_session_history', { 
                    sessionId: foundSession.id,
                    adminId: this.currentAdmin ? this.currentAdmin.name : 'unknown'
                });
            }
            
            // Switch to Active Session tab
            this.switchTab('chat');
            
            alert(`✅ Loaded session with ${foundSession.customer.name}!`);
        } else {
            console.log('❌ NO ACTIVE SESSION FOUND');
            console.log('Available sessions:', Array.from(this.sessions.keys()));
            alert('❌ No active session found. You need to join a session first from the Sessions tab.');
            
            // Refresh session list
            this.socket.emit('get_sessions');
        }
    }
}

// Initialize the admin client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.adminClient = new AdminChatClient();
});
