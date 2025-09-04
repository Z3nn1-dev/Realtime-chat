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
app.use(express.static(path.join(__dirname, '../Client')));

// Store connected users and chat sessions
let connectedUsers = new Map();
let admins = new Set(); // Store admin socket IDs
let customerSessions = new Map(); // Map of customer sessions: sessionId -> { customer, admin, messages }
let availableAdmins = new Set(); // Available admins for new sessions

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle user join
  socket.on('join', (userData) => {
    const user = {
      id: socket.id,
      name: userData.name,
      isAdmin: userData.isAdmin || false,
      joinTime: new Date(),
      sessionId: null
    };
    
    connectedUsers.set(socket.id, user);
    
    if (user.isAdmin) {
      admins.add(socket.id);
      availableAdmins.add(socket.id);
      socket.join('admins');
      
      // Send list of active sessions to admin
      sendSessionListToAdmins();
    } else {
      // Customer joins - create or find session
      const sessionId = createCustomerSession(socket.id, user);
      user.sessionId = sessionId;
      
      // Notify customer about session
      socket.emit('session_created', { 
        sessionId: sessionId,
        message: 'Welcome to customer support! You can start asking questions. An admin will join shortly to help you.'
      });
    }

    console.log(`${user.name} joined ${user.isAdmin ? 'as admin' : `as customer with session ${user.sessionId}`}`);
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
          
          // Remove session
          customerSessions.delete(sessionId);
          
          // Make admin available again
          if (session.admin) {
            session.admin.sessionId = null;
            availableAdmins.add(session.admin.id);
          }
          
          sendSessionListToAdmins();
        }
        break;
        
      case 'transfer_session':
        // Transfer session to another admin (future feature)
        break;
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
            // Keep session for a while in case customer reconnects
            session.customer = null;
            session.status = 'customer_disconnected';
            
            if (session.admin) {
              io.to(session.admin.id).emit('customer_disconnected', {
                sessionId: user.sessionId,
                message: 'Customer has disconnected'
              });
            }
            
            // Remove session after 5 minutes if customer doesn't return
            setTimeout(() => {
              if (customerSessions.has(user.sessionId) && 
                  customerSessions.get(user.sessionId).status === 'customer_disconnected') {
                customerSessions.delete(user.sessionId);
                sendSessionListToAdmins();
              }
            }, 5 * 60 * 1000); // 5 minutes
          }
        }
      }
      
      connectedUsers.delete(socket.id);
    }
  });
});

// Function to create a new customer session
function createCustomerSession(customerId, customer) {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const session = {
    id: sessionId,
    customer: customer,
    admin: null,
    messages: [],
    createdAt: new Date(),
    status: 'waiting_for_admin'
  };
  
  customerSessions.set(sessionId, session);
  
  console.log(`Created new session: ${sessionId} for customer: ${customer.name}`);
  console.log(`Total active sessions: ${customerSessions.size}`);
  
  // Notify available admins about new session
  sendSessionListToAdmins();
  
  // Try to auto-assign an admin if available
  if (availableAdmins.size > 0) {
    const adminId = availableAdmins.values().next().value;
    io.to('admins').emit('new_session_alert', {
      sessionId: sessionId,
      customerName: customer.name,
      message: `New customer support session from ${customer.name}`
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
  
  console.log(`Sending session list update to ${admins.size} admins:`, sessionList.length, 'sessions');
  io.to('admins').emit('session_list_update', sessionList);
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../Client/admin.html'));
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Client: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
