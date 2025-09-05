const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
// Remove static serving since Client folder moved to HM_career
// app.use(express.static(path.join(__dirname, '../Client')));

// Store connected users and chat sessions
let connectedUsers = new Map();
let admins = new Set(); // Store admin socket IDs
let customerSessions = new Map(); // Map of customer sessions: sessionId -> { customer, admin, messages }
let closedSessions = new Map(); // Map of closed sessions for history viewing
let availableAdmins = new Set(); // Available admins for new sessions
let customerHistory = new Map(); // Track customer history by name: name -> { sessions, totalMessages, lastSeen }
let clientHistory = new Map(); // Track client IDs and their associated customer names: clientId -> { names: [], lastSeen }

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle user join
  socket.on('join', (userData) => {
    console.log('User joining with data:', userData);
    
    const user = {
      id: socket.id,
      name: userData.name,
      isAdmin: userData.isAdmin || false,
      clientId: userData.clientId || null,
      joinTime: new Date(),
      sessionId: null
    };
    
    if (userData.clientId) {
      console.log(`Customer joining with client ID: ${userData.clientId}`);
    }
    
    connectedUsers.set(socket.id, user);
    
    if (user.isAdmin) {
      admins.add(socket.id);
      availableAdmins.add(socket.id);
      socket.join('admins');
      
      console.log('admin joined as admin');
      
      // Send list of active sessions to admin
      sendSessionListToAdmins();
      
      // Send closed sessions to admin
      sendClosedSessionsToAdmins();
    } else {
      // Customer joins - check for existing client ID first
      let sessionId;
      let isReturningClient = false;
      
      if (user.clientId && clientHistory.has(user.clientId)) {
        // This is a returning client - check for recent closed sessions
        const recentClosedSession = findRecentClosedSessionByClientId(user.clientId);
        
        if (recentClosedSession) {
          console.log(`Returning client ${user.clientId} found with recent session: ${recentClosedSession.id}`);
          isReturningClient = true;
          
          // Create new session but link to previous history
          sessionId = createCustomerSession(socket.id, user, recentClosedSession);
        } else {
          // Client has history but no recent closed session, create new session
          sessionId = createCustomerSession(socket.id, user);
          isReturningClient = true;
        }
      } else {
        // New client, create fresh session
        sessionId = createCustomerSession(socket.id, user);
      }
      
      user.sessionId = sessionId;
      
      // Notify customer about session
      const welcomeMessage = isReturningClient 
        ? 'Welcome back! We can see your previous conversations. An admin will join shortly to continue helping you.'
        : 'Welcome to customer support! You can start asking questions. An admin will join shortly to help you.';
        
      socket.emit('session_created', { 
        sessionId: sessionId,
        message: welcomeMessage,
        isReturningClient: isReturningClient
      });
    }

    console.log(`${user.name} joined ${user.isAdmin ? 'as admin' : `as customer with session ${user.sessionId}`}`);
  });

  // Handle session rejoin (for returning users)
  socket.on('rejoin_session', (data) => {
    const { sessionId, user: userData } = data;
    
    if (!sessionId || !customerSessions.has(sessionId)) {
      // Session doesn't exist, treat as new join
      socket.emit('session_invalid', { 
        message: 'Session no longer exists. Starting a new session...'
      });
      
      // Create new session
      const user = {
        id: socket.id,
        name: userData.name,
        isAdmin: false,
        joinTime: new Date(),
        sessionId: null
      };
      
      connectedUsers.set(socket.id, user);
      const newSessionId = createCustomerSession(socket.id, user);
      user.sessionId = newSessionId;
      
      socket.emit('session_created', { 
        sessionId: newSessionId,
        message: 'New session created. An admin will join shortly to help you.'
      });
      return;
    }
    
    // Session exists, rejoin it
    const session = customerSessions.get(sessionId);
    const user = {
      id: socket.id,
      name: userData.name,
      isAdmin: false,
      joinTime: new Date(),
      sessionId: sessionId
    };
    
    connectedUsers.set(socket.id, user);
    // Fix: Update session.customer with the full user object, not just socket.id
    session.customer = user;
    session.status = 'active'; // Update status since customer has rejoined
    
    // Notify about successful rejoin
    socket.emit('session_rejoined', { 
      sessionId: sessionId,
      message: 'Reconnected to your previous session.',
      hasAdmin: session.admin !== null
    });
    
    // If admin is still in session, notify them
    if (session.admin && connectedUsers.has(session.admin)) {
      io.to(session.admin).emit('customer_rejoined', {
        sessionId: sessionId,
        customerName: user.name
      });
    }
    
    console.log(`${user.name} rejoined session ${sessionId}`);
  });

  // Handle new messages
  socket.on('send_message', (messageData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now() + Math.random(),
      user: user.name,
      message: messageData.message,
      timestamp: new Date(),
      isAdmin: user.isAdmin,
      sessionId: user.sessionId
    };

    if (user.isAdmin) {
      // Admin sending message - need to specify which session
      const sessionId = messageData.sessionId;
      if (!sessionId || !customerSessions.has(sessionId)) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }
      
      const session = customerSessions.get(sessionId);
      message.sessionId = sessionId;
      session.messages.push(message);
      
      // Send to customer in this session
      if (session.customer) {
        io.to(session.customer.id).emit('receive_message', message);
      }
      
      // Send back to admin
      socket.emit('receive_message', message);
      
    } else {
      // Customer sending message
      if (!user.sessionId) {
        // Create session if it doesn't exist (shouldn't happen, but failsafe)
        const sessionId = createCustomerSession(socket.id, user);
        user.sessionId = sessionId;
        
        socket.emit('session_created', { 
          sessionId: sessionId,
          message: 'Session created. You can now send messages.'
        });
      }
      
      const session = customerSessions.get(user.sessionId);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }
      
      session.messages.push(message);
      
      // Track customer message in history
      if (!user.isAdmin) {
        incrementCustomerMessages(user.name);
      }
      
      // Send to admin in this session (if any)
      if (session.admin) {
        io.to(session.admin.id).emit('receive_message', message);
      }
      
      // Send back to customer
      socket.emit('receive_message', message);
    }
    
    console.log(`Message in session ${user.sessionId || messageData.sessionId} from ${user.name}: ${messageData.message}`);
  });

  // Handle getting session history without joining
  socket.on('get_session_history', (data) => {
    console.log(`Admin ${data.adminId} requesting history for session ${data.sessionId}`);
    
    const admin = connectedUsers.get(socket.id);
    if (!admin || !admin.isAdmin) {
      socket.emit('error', { message: 'Unauthorized access' });
      return;
    }
    
    const session = customerSessions.get(data.sessionId);
    if (session) {
      console.log(`Session ${data.sessionId} found, sending history to admin`);
      socket.emit('session_history', {
        sessionId: data.sessionId,
        messages: session.messages || [],
        customer: session.customer,
        admin: session.admin
      });
    } else {
      console.log(`Session ${data.sessionId} not found`);
      socket.emit('error', { message: 'Session not found' });
    }
  });

  // Handle getting client history by client ID
  socket.on('get_client_history', (data) => {
    console.log(`Admin requesting client history for client ID: ${data.clientId}`);
    
    const admin = connectedUsers.get(socket.id);
    if (!admin || !admin.isAdmin) {
      socket.emit('error', { message: 'Unauthorized access' });
      return;
    }
    
    const clientHistory = getClientChatHistory(data.clientId);
    console.log(`Found ${clientHistory.sessions.length} previous sessions for client ${data.clientId}`);
    
    socket.emit('client_history', {
      clientId: data.clientId,
      sessions: clientHistory.sessions,
      totalSessions: clientHistory.totalSessions,
      totalMessages: clientHistory.totalMessages
    });
  });

  // Handle admin joining a session
  socket.on('join_session', (data) => {
    const admin = connectedUsers.get(socket.id);
    if (!admin || !admin.isAdmin) return;
    
    const sessionId = data.sessionId;
    const session = customerSessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { message: 'Session not found' });
      return;
    }
    
    if (session.admin) {
      socket.emit('error', { message: 'Session already has an admin' });
      return;
    }
    
    // Admin joins the session
    session.admin = admin;
    admin.sessionId = sessionId;
    availableAdmins.delete(socket.id);
    
    // Send chat history to admin
    socket.emit('session_history', {
      sessionId: sessionId,
      messages: session.messages,
      customer: session.customer
    });
    
    // Notify customer that admin joined
    if (session.customer) {
      io.to(session.customer.id).emit('admin_joined', {
        adminName: admin.name,
        message: `${admin.name} has joined the chat to help you.`
      });
    }
    
    // Update session list for all admins
    sendSessionListToAdmins();
    
    console.log(`Admin ${admin.name} joined session ${sessionId}`);
  });

  // Handle admin leaving a session
  socket.on('leave_session', () => {
    const admin = connectedUsers.get(socket.id);
    if (!admin || !admin.isAdmin || !admin.sessionId) return;
    
    const session = customerSessions.get(admin.sessionId);
    if (session) {
      session.admin = null;
      
      // Notify customer that admin left
      if (session.customer) {
        io.to(session.customer.id).emit('admin_left', {
          message: 'The admin has left the chat. You may need to wait for another admin to join.'
        });
      }
    }
    
    admin.sessionId = null;
    availableAdmins.add(socket.id);
    
    // Update session list for all admins
    sendSessionListToAdmins();
  });

  // Handle getting session list (for admins)
  socket.on('get_sessions', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.isAdmin) return;
    
    sendSessionListToAdmin(socket.id);
  });
  // Handle admin actions
  socket.on('admin_action', (actionData) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.isAdmin) return;

    switch (actionData.type) {
      case 'close_session':
        const sessionId = actionData.sessionId;
        const session = customerSessions.get(sessionId);
        if (session) {
          // Notify customer that session is closed
          if (session.customer) {
            io.to(session.customer.id).emit('session_closed', { 
              reason: actionData.reason || 'Session closed by admin'
            });
          }
          
          // Move session to closed sessions instead of deleting
          moveSessionToClosed(sessionId);
          
          // Make admin available again
          if (session.admin) {
            session.admin.sessionId = null;
            availableAdmins.add(session.admin.id);
          }
          
          // Send updated closed sessions list to admins
          sendClosedSessionsToAdmins();
        }
        break;
        
      case 'transfer_session':
        // Transfer session to another admin (future feature)
        break;
    }
  });

  // Handle request for closed sessions
  socket.on('get_closed_sessions', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.isAdmin) return;
    
    sendClosedSessionsToAdmins();
  });

  // Handle request to view closed session messages
  socket.on('view_closed_session', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.isAdmin) return;
    
    const session = closedSessions.get(data.sessionId);
    if (session) {
      socket.emit('closed_session_messages', {
        sessionId: data.sessionId,
        customer: session.customer,
        admin: session.admin,
        messages: session.messages,
        createdAt: session.createdAt,
        closedAt: session.closedAt,
        status: session.status
      });
    }
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_typing', {
        user: user.name,
        isTyping: data.isTyping
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`${user.name} disconnected`);
      
      if (user.isAdmin) {
        // Admin disconnected
        admins.delete(socket.id);
        availableAdmins.delete(socket.id);
        
        // If admin was in a session, notify customer
        if (user.sessionId) {
          const session = customerSessions.get(user.sessionId);
          if (session) {
            session.admin = null;
            if (session.customer) {
              io.to(session.customer.id).emit('admin_left', {
                message: 'The admin has disconnected. Please wait for another admin to join.'
              });
            }
          }
        }
        
        sendSessionListToAdmins();
      } else {
        // Customer disconnected
        if (user.sessionId) {
          const session = customerSessions.get(user.sessionId);
          if (session) {
            // Keep customer info but mark as disconnected
            if (session.customer) {
              session.customer.isConnected = false;
              session.customer.disconnectedAt = new Date();
            }
            session.status = 'customer_disconnected';
            
            if (session.admin) {
              io.to(session.admin.id).emit('customer_disconnected', {
                sessionId: user.sessionId,
                customerName: user.name,
                message: `${user.name} has disconnected`
              });
            }
            
            // Move session to closed immediately when customer disconnects
            moveSessionToClosed(user.sessionId);
          }
        }
      }
      
      connectedUsers.delete(socket.id);
    }
  });
});

// Function to move session to closed sessions
function moveSessionToClosed(sessionId) {
  const session = customerSessions.get(sessionId);
  if (session) {
    // Mark session as closed
    session.closedAt = new Date();
    session.status = 'closed';
    
    // Move to closed sessions
    closedSessions.set(sessionId, session);
    
    // Remove from active sessions
    customerSessions.delete(sessionId);
    
    console.log(`Session ${sessionId} moved to closed sessions`);
    
    // Update admin interface
    sendSessionListToAdmins();
    sendClosedSessionsToAdmins();
  }
}

// Function to create a new customer session
function createCustomerSession(customerId, customer, previousSession = null) {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Track customer history
  updateCustomerHistory(customer.name);
  
  // Track client ID history if provided
  if (customer.clientId) {
    updateClientHistory(customer.clientId, customer.name);
  }
  
  const session = {
    id: sessionId,
    customer: customer,
    admin: null,
    messages: [],
    createdAt: new Date(),
    status: 'waiting_for_admin',
    customerHistory: getCustomerHistorySummary(customer.name),
    clientHistory: customer.clientId ? getClientHistorySummary(customer.clientId) : null,
    previousSession: previousSession ? {
      id: previousSession.id,
      messageCount: previousSession.messages ? previousSession.messages.length : 0,
      closedAt: previousSession.closedAt,
      lastActivity: previousSession.lastActivity
    } : null
  };
  
  customerSessions.set(sessionId, session);
  
  console.log(`Created new session: ${sessionId} for customer: ${customer.name}`);
  if (customer.clientId) {
    console.log(`Client ID: ${customer.clientId}`);
    if (previousSession) {
      console.log(`Linked to previous session: ${previousSession.id}`);
    }
  }
  console.log(`Total active sessions: ${customerSessions.size}`);
  
  // Notify available admins about new session
  sendSessionListToAdmins();
  
  // Try to auto-assign an admin if available
  if (availableAdmins.size > 0) {
    const adminId = availableAdmins.values().next().value;
    io.to('admins').emit('new_session_alert', {
      sessionId: sessionId,
      customerName: customer.name,
      message: `New customer support session from ${customer.name}`,
      isReturningClient: previousSession !== null
    });
  }
  
  return sessionId;
}

// Function to send session list to all admins
function sendSessionListToAdmins() {
  const sessionList = Array.from(customerSessions.values()).map(session => ({
    id: session.id,
    customer: session.customer ? {
      name: session.customer.name,
      id: session.customer.id,
      clientId: session.customer.clientId,
      isConnected: session.customer.isConnected !== false, // Default true unless explicitly set false
      disconnectedAt: session.customer.disconnectedAt
    } : null,
    admin: session.admin ? {
      name: session.admin.name,
      id: session.admin.id
    } : null,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    status: session.status,
    customerHistory: session.customerHistory, // Include customer history
    clientHistory: session.clientHistory, // Include client history
    previousSession: session.previousSession // Include previous session info
  }));
  
  console.log(`Sending session list update to ${admins.size} admins:`, sessionList.length, 'sessions');
  io.to('admins').emit('session_list_update', sessionList);
}

// Function to send closed sessions list to all admins
function sendClosedSessionsToAdmins() {
  const closedSessionList = Array.from(closedSessions.values()).map(session => ({
    id: session.id,
    customer: session.customer ? {
      name: session.customer.name,
      id: session.customer.id
    } : null,
    admin: session.admin ? {
      name: session.admin.name,
      id: session.admin.id
    } : null,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    closedAt: session.closedAt,
    status: session.status,
    customerHistory: session.customerHistory
  }));
  
  console.log(`Sending closed sessions list to ${admins.size} admins:`, closedSessionList.length, 'closed sessions');
  io.to('admins').emit('closed_sessions_update', closedSessionList);
}

// Function to send session list to a specific admin
function sendSessionListToAdmin(adminId) {
  const sessionList = Array.from(customerSessions.values()).map(session => ({
    id: session.id,
    customer: session.customer ? {
      name: session.customer.name,
      id: session.customer.id
    } : null,
    admin: session.admin ? {
      name: session.admin.name,
      id: session.admin.id
    } : null,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    status: session.status
  }));
  
  io.to(adminId).emit('session_list_update', sessionList);
}

// Serve the client files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Client/index.html'));
});

// Customer history tracking functions
function updateCustomerHistory(customerName) {
  if (!customerHistory.has(customerName)) {
    customerHistory.set(customerName, {
      sessions: 0,
      totalMessages: 0,
      lastSeen: new Date(),
      firstSeen: new Date()
    });
  }
  
  const history = customerHistory.get(customerName);
  history.sessions += 1;
  history.lastSeen = new Date();
  
  return history;
}

function getCustomerHistorySummary(customerName) {
  const history = customerHistory.get(customerName);
  if (!history) return null;
  
  return {
    previousSessions: history.sessions - 1, // -1 for current session
    totalMessages: history.totalMessages,
    isReturning: history.sessions > 1,
    firstSeen: history.firstSeen,
    lastSeen: history.lastSeen
  };
}

function incrementCustomerMessages(customerName) {
  if (customerHistory.has(customerName)) {
    customerHistory.get(customerName).totalMessages += 1;
  }
}

function updateClientHistory(clientId, customerName) {
  if (!clientHistory.has(clientId)) {
    clientHistory.set(clientId, {
      names: [],
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalSessions: 0
    });
  }
  
  const history = clientHistory.get(clientId);
  
  // Add name if not already in the list
  if (!history.names.includes(customerName)) {
    history.names.push(customerName);
  }
  
  history.lastSeen = new Date();
  history.totalSessions += 1;
  
  return history;
}

function getClientHistorySummary(clientId) {
  const history = clientHistory.get(clientId);
  if (!history) return null;
  
  return {
    previousNames: history.names,
    totalSessions: history.totalSessions - 1, // -1 for current session
    isReturning: history.totalSessions > 1,
    firstSeen: history.firstSeen,
    lastSeen: history.lastSeen
  };
}

function findRecentClosedSessionByClientId(clientId) {
  // Look for the most recent closed session from this client ID
  let recentSession = null;
  let recentDate = null;
  
  for (const session of closedSessions.values()) {
    if (session.customer && session.customer.clientId === clientId) {
      const sessionDate = new Date(session.closedAt || session.lastActivity || session.createdAt);
      if (!recentDate || sessionDate > recentDate) {
        recentDate = sessionDate;
        recentSession = session;
      }
    }
  }
  
  // Only return sessions closed within the last 24 hours
  if (recentSession && recentDate) {
    const hoursSinceClose = (Date.now() - recentDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceClose <= 24) {
      return recentSession;
    }
  }
  
  return null;
}

function getClientChatHistory(clientId) {
  const historySessions = [];
  let totalMessages = 0;
  
  // Get all closed sessions for this client ID
  for (const session of closedSessions.values()) {
    if (session.customer && session.customer.clientId === clientId) {
      const sessionInfo = {
        id: session.id,
        customerName: session.customer.name,
        messages: session.messages || [],
        createdAt: session.createdAt,
        closedAt: session.closedAt || session.lastActivity,
        messageCount: session.messages ? session.messages.length : 0,
        adminName: session.admin ? session.admin.name : 'No admin assigned'
      };
      
      historySessions.push(sessionInfo);
      totalMessages += sessionInfo.messageCount;
    }
  }
  
  // Sort sessions by creation date (newest first)
  historySessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return {
    sessions: historySessions,
    totalSessions: historySessions.length,
    totalMessages: totalMessages
  };
}

app.get('/admin', (req, res) => {
  res.json({ 
    message: 'Admin panel available at frontend server',
    admin: 'http://localhost:8080/Client/admin.html'
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Client: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
