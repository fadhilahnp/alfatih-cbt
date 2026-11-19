const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/database');

// Active sessions map: token -> { id, username, name, role, type: 'admin'|'student', class_name }
const activeSessions = new Map();

// Helper to generate token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware: Authenticate Admin
function requireAdmin(req, res, next) {
  const token = req.cookies?.cbt_token || req.headers['authorization']?.replace('Bearer ', '');
  const session = activeSessions.get(token);

  if (!session || session.type !== 'admin') {
    return res.status(401).json({ success: false, message: 'Akses ditolak. Sesi admin tidak valid.' });
  }

  req.user = session;
  next();
}

// Middleware: Authenticate Student
function requireStudent(req, res, next) {
  const token = req.cookies?.cbt_token || req.headers['authorization']?.replace('Bearer ', '');
  const session = activeSessions.get(token);

  if (!session || session.type !== 'student') {
    return res.status(401).json({ success: false, message: 'Akses ditolak. Sesi siswa tidak valid.' });
  }

  req.student = session;
  next();
}

// Admin Login
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Username atau password admin salah!' });
  }

  const token = generateToken();
  const sessionData = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    type: 'admin'
  };

  activeSessions.set(token, sessionData);

  res.cookie('cbt_token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  return res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    user: sessionData
  });
});

// Student Login
router.post('/student/login', (req, res) => {
  const { nis, password } = req.body;

  if (!nis || !password) {
    return res.status(400).json({ success: false, message: 'NIS dan password wajib diisi.' });
  }

  const student = db.prepare('SELECT * FROM students WHERE nis = ? AND password = ?').get(nis.trim(), password.trim());
  if (!student) {
    return res.status(401).json({ success: false, message: 'NIS atau password siswa tidak ditemukan!' });
  }

  const token = generateToken();
  const sessionData = {
    id: student.id,
    nis: student.nis,
    name: student.name,
    class_name: student.class_name,
    session_name: student.session_name,
    room_name: student.room_name,
    type: 'student'
  };

  activeSessions.set(token, sessionData);

  res.cookie('cbt_token', token, {
    httpOnly: true,
    maxAge: 12 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  return res.json({
    success: true,
    message: 'Login siswa berhasil.',
    token,
    student: sessionData
  });
});

// Check Session
router.get('/me', (req, res) => {
  const token = req.cookies?.cbt_token || req.headers['authorization']?.replace('Bearer ', '');
  const session = activeSessions.get(token);

  if (!session) {
    return res.status(401).json({ success: false, message: 'Tidak terautentikasi' });
  }

  return res.json({ success: true, user: session });
});

// Logout
router.post('/logout', (req, res) => {
  const token = req.cookies?.cbt_token || req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const session = activeSessions.get(token);
    // If this is a student session, mark any active IN_PROGRESS session as FINISHED
    if (session && session.type === 'student') {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE student_exam_sessions
        SET status = 'FINISHED', finished_at = ?
        WHERE student_id = ? AND status = 'IN_PROGRESS'
      `).run(now, session.id);
    }
    activeSessions.delete(token);
  }
  res.clearCookie('cbt_token');
  return res.json({ success: true, message: 'Berhasil logout' });
});

module.exports = {
  router,
  requireAdmin,
  requireStudent,
  activeSessions
};
