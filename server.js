const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');

// Initialize database
const db = require('./db/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Optional HTTPS Server for secure context on mobile browsers (Camera permission)
const certPath = path.join(__dirname, 'certs/cert.pem');
const keyPath = path.join(__dirname, 'certs/key.pem');
let httpsServer = null;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  try {
    httpsServer = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    }, app);
    io.attach(httpsServer);
  } catch (err) {
    console.warn('Could not initialize HTTPS server:', err.message);
  }
}

// Attach io to express app so routes can access it via req.app.get('io')
app.set('io', io);

// Middleware
app.use(express.json({ limit: '15mb' })); // Support base64 image snapshots
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Serve static assets
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

// Routes
const { router: authRouter } = require('./routes/auth');
const adminRouter = require('./routes/admin');
const examRouter = require('./routes/exam');

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/exam', examRouter);

// Frontend Page Routing
const viewsDir = path.join(__dirname, 'public/views');

// Landing / Student Login (Dedicated Student Login)
app.get('/', (req, res) => {
  res.sendFile(path.join(viewsDir, 'student/login.html'));
});
app.get('/student/login', (req, res) => {
  res.sendFile(path.join(viewsDir, 'student/login.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(viewsDir, 'student/login.html'));
});

// Admin Pages
app.get('/admin/login', (req, res) => res.sendFile(path.join(viewsDir, 'admin/login.html')));
app.get('/admin', (req, res) => res.redirect('/admin/dashboard'));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(viewsDir, 'admin/dashboard.html')));
app.get('/admin/students', (req, res) => res.sendFile(path.join(viewsDir, 'admin/students.html')));
app.get('/admin/print-cards', (req, res) => res.sendFile(path.join(viewsDir, 'admin/print-cards.html')));
app.get('/admin/questions', (req, res) => res.sendFile(path.join(viewsDir, 'admin/questions.html')));
app.get('/admin/schedules', (req, res) => res.sendFile(path.join(viewsDir, 'admin/schedules.html')));
app.get('/admin/monitoring', (req, res) => res.sendFile(path.join(viewsDir, 'admin/monitoring.html')));
app.get('/admin/results', (req, res) => res.sendFile(path.join(viewsDir, 'admin/results.html')));

// Student Pages
app.get('/student/confirm', (req, res) => res.sendFile(path.join(viewsDir, 'student/confirm.html')));
app.get('/student/exam', (req, res) => res.sendFile(path.join(viewsDir, 'student/exam.html')));
app.get('/student/finish', (req, res) => res.sendFile(path.join(viewsDir, 'student/finish.html')));

// Socket.io connection handling
io.on('connection', (socket) => {
  // Join room by schedule
  socket.on('join_schedule', (scheduleId) => {
    socket.join(`schedule_${scheduleId}`);
  });

  // Relay student ping / heartbeat
  socket.on('student_heartbeat', (data) => {
    io.emit('student_online_status', {
      ...data,
      lastSeen: Date.now()
    });
    // Keep session last_activity fresh so monitoring shows truly active students
    if (data && data.sessionId) {
      try {
        db.prepare('UPDATE student_exam_sessions SET last_activity = ? WHERE id = ? AND status = ?')
          .run(new Date().toISOString(), data.sessionId, 'IN_PROGRESS');
      } catch (err) {
        // Ignore DB errors on heartbeat
      }
    }
  });

  socket.on('disconnect', () => {
    // Client disconnected
  });
});

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 CBT AL-FATIH Web Application is RUNNING!`);
  console.log(`📡 HTTP URL : http://localhost:${PORT}`);
  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`🔒 HTTPS URL: https://localhost:${HTTPS_PORT} (Akses Kamera Handphone)`);
    });
  }
  console.log(`🔑 Login Admin: /admin/login`);
  console.log(`====================================================`);
});
