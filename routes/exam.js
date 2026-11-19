const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireStudent } = require('./auth');
const { calculateSessionScore } = require('./admin');

// Ensure proctoring uploads directory exists
const uploadDir = path.join(__dirname, '../public/uploads/proctoring');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Apply requireStudent to all routes in this router
router.use(requireStudent);

// Helper: Shuffle Array (Fisher-Yates)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 1. Get Available Schedules for this student
router.get('/available', (req, res) => {
  const student = req.student;

  const schedules = db.prepare(`
    SELECT es.*, qb.subject, qb.total_questions,
      (SELECT status FROM student_exam_sessions WHERE schedule_id = es.id AND student_id = ?) as student_status,
      (SELECT score FROM student_exam_sessions WHERE schedule_id = es.id AND student_id = ?) as student_score,
      (SELECT id FROM student_exam_sessions WHERE schedule_id = es.id AND student_id = ?) as session_id
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.is_active = 1
    ORDER BY es.id DESC
  `).all(student.id, student.id, student.id);

  // Filter schedules that match target_classes
  const filtered = schedules.filter(s => {
    if (s.target_classes === 'ALL') return true;
    const classes = s.target_classes.split(',').map(c => c.trim());
    return classes.includes(student.class_name);
  });

  return res.json({ success: true, data: filtered, student });
});

// 2. Start or Resume Exam
router.post('/start', (req, res) => {
  const student = req.student;
  const { schedule_id, token } = req.body;

  if (!schedule_id) {
    return res.status(400).json({ success: false, message: 'ID Jadwal ujian diperlukan.' });
  }

  const schedule = db.prepare(`
    SELECT es.*, qb.subject, qb.total_questions
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.id = ? AND es.is_active = 1
  `).get(schedule_id);

  if (!schedule) {
    return res.status(404).json({ success: false, message: 'Jadwal ujian tidak ditemukan atau tidak aktif.' });
  }

  // Token validation if required
  if (schedule.token && schedule.token.trim() !== '') {
    if (!token || token.trim().toUpperCase() !== schedule.token.toUpperCase()) {
      return res.status(400).json({ success: false, message: 'Token ujian tidak valid atau salah!' });
    }
  }

  // Check if session exists
  let session = db.prepare(`
    SELECT * FROM student_exam_sessions
    WHERE schedule_id = ? AND student_id = ?
  `).get(schedule_id, student.id);

  if (!session) {
    // New exam session
    const questions = db.prepare('SELECT id FROM questions WHERE bank_id = ? ORDER BY question_number ASC').all(schedule.bank_id);
    if (!questions || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Bank soal masih kosong, hubungi pengawas ujian.' });
    }

    let questionIds = questions.map(q => q.id);
    if (schedule.randomize_questions) {
      questionIds = shuffleArray(questionIds);
    }

    // Map options order
    const optionsOrder = {};
    for (const qId of questionIds) {
      const standardKeys = ['A', 'B', 'C', 'D', 'E'];
      optionsOrder[qId] = schedule.randomize_options ? shuffleArray(standardKeys) : standardKeys;
    }

    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO student_exam_sessions (
        schedule_id, student_id, started_at, status,
        question_order, options_order, ip_address, user_agent
      ) VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?)
    `).run(
      schedule_id,
      student.id,
      now,
      JSON.stringify(questionIds),
      JSON.stringify(optionsOrder),
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || 'Unknown'
    );

    session = db.prepare('SELECT * FROM student_exam_sessions WHERE id = ?').get(info.lastInsertRowid);

    // Broadcast student started exam
    const io = req.app.get('io');
    if (io) {
      io.emit('student_started', {
        sessionId: session.id,
        studentId: student.id,
        studentName: student.name,
        className: student.class_name,
        scheduleId: schedule_id,
        startedAt: now
      });
    }
  } else if (session.status === 'FINISHED') {
    return res.status(400).json({ success: false, message: 'Anda sudah menyelesaikan ujian ini.' });
  } else if (session.status === 'LOCKED') {
    return res.status(403).json({
      success: false,
      message: 'Ujian Anda telah dikunci oleh sistem karena melebihi batas toleransi kecurangan. Hubungi pengawas.'
    });
  }

  return res.json({
    success: true,
    message: 'Ujian siap dimulai.',
    sessionId: session.id
  });
});

// 3. Get Exam Session Data & Questions
router.get('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const student = req.student;

  const session = db.prepare(`
    SELECT ses.*, es.title as exam_title, es.duration_minutes, es.snapshot_interval_minutes,
           es.max_violations, es.show_result, qb.subject
    FROM student_exam_sessions ses
    JOIN exam_schedules es ON ses.schedule_id = es.id
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE ses.id = ? AND ses.student_id = ?
  `).get(sessionId, student.id);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Sesi ujian tidak ditemukan.' });
  }

  // Calculate remaining time
  const startTime = new Date(session.started_at).getTime();
  const totalDurationMs = session.duration_minutes * 60 * 1000;
  const elapsedMs = Date.now() - startTime;
  const remainingSeconds = Math.max(0, Math.floor((totalDurationMs - elapsedMs) / 1000));

  // If time has completely expired and session still in progress, auto finish
  if (remainingSeconds <= 0 && session.status === 'IN_PROGRESS') {
    const now = new Date().toISOString();
    db.prepare("UPDATE student_exam_sessions SET status = 'FINISHED', finished_at = ? WHERE id = ?").run(now, sessionId);
    calculateSessionScore(sessionId);
    session.status = 'FINISHED';
  }

  // Parse questions in randomized order
  const questionIds = JSON.parse(session.question_order || '[]');
  const optionsOrder = JSON.parse(session.options_order || '{}');

  // Fetch all questions for this session
  const placeholders = questionIds.map(() => '?').join(',');
  let rawQuestions = [];
  if (questionIds.length > 0) {
    rawQuestions = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).all(...questionIds);
  }

  const rawMap = new Map();
  for (const q of rawQuestions) {
    rawMap.set(q.id, q);
  }

  // Fetch saved student answers
  const savedAnswers = db.prepare('SELECT question_id, selected_answer, is_doubtful FROM student_answers WHERE session_id = ?').all(sessionId);
  const answerMap = new Map();
  for (const a of savedAnswers) {
    answerMap.set(a.question_id, a);
  }

  // Format questions array in session order, hiding the correct answer from client
  const questionsList = [];
  let index = 1;
  for (const qId of questionIds) {
    const raw = rawMap.get(qId);
    if (!raw) continue;

    const optKeys = optionsOrder[qId] || ['A', 'B', 'C', 'D', 'E'];
    const options = [];

    for (const key of optKeys) {
      const optionKey = key.toLowerCase();
      const optText = raw[`option_${optionKey}`];
      const optImage = raw[`option_${optionKey}_image`];
      if ((optText && optText.trim() !== '') || optImage) {
        options.push({
          key,
          text: optText || '',
          image: optImage || null
        });
      }
    }

    const saved = answerMap.get(qId);

    questionsList.push({
      id: raw.id,
      number: index++,
      text: raw.question_text,
      image: raw.question_image,
      audio: raw.question_audio,
      youtubeUrl: raw.youtube_url,
      options,
      selectedAnswer: saved ? saved.selected_answer : null,
      isDoubtful: saved ? Boolean(saved.is_doubtful) : false
    });
  }

  return res.json({
    success: true,
    session: {
      id: session.id,
      examTitle: session.exam_title,
      subject: session.subject,
      status: session.status,
      score: session.score,
      correctCount: session.correct_count,
      wrongCount: session.wrong_count,
      unansweredCount: session.unanswered_count,
      showResult: Boolean(session.show_result),
      durationMinutes: session.duration_minutes,
      remainingSeconds,
      snapshotIntervalMinutes: session.snapshot_interval_minutes || 30, // 30 minutes default
      maxViolations: session.max_violations || 5,
      violationCount: session.violation_count || 0
    },
    student: {
      id: student.id,
      nis: student.nis,
      name: student.name,
      className: student.class_name,
      roomName: student.room_name
    },
    questions: questionsList
  });
});

// 4. Save Student Answer
router.post('/answer', (req, res) => {
  const { sessionId, questionId, selectedAnswer, isDoubtful } = req.body;
  const student = req.student;

  const session = db.prepare('SELECT * FROM student_exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, student.id);
  if (!session) return res.status(404).json({ success: false, message: 'Sesi ujian tidak valid.' });

  if (session.status !== 'IN_PROGRESS') {
    return res.status(400).json({ success: false, message: 'Ujian sudah tidak dalam status aktif.' });
  }

  // Upsert student answer
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO student_answers (session_id, question_id, selected_answer, is_doubtful, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, question_id) DO UPDATE SET
      selected_answer = excluded.selected_answer,
      is_doubtful = excluded.is_doubtful,
      updated_at = excluded.updated_at
  `).run(sessionId, questionId, selectedAnswer, isDoubtful ? 1 : 0, now);

  // Update session last_activity
  db.prepare('UPDATE student_exam_sessions SET last_activity = ? WHERE id = ?').run(now, sessionId);

  // Count answered
  const answeredCount = db.prepare('SELECT COUNT(*) as count FROM student_answers WHERE session_id = ? AND selected_answer IS NOT NULL').get(sessionId).count;

  // Broadcast to admin dashboard
  const io = req.app.get('io');
  if (io) {
    io.emit('student_progress', {
      sessionId,
      studentId: student.id,
      answeredCount
    });
  }

  return res.json({ success: true, answeredCount });
});

// 5. Anti-Cheat: Record Cheating Violation
router.post('/violation', (req, res) => {
  const { sessionId, violationType, description } = req.body;
  const student = req.student;

  const session = db.prepare(`
    SELECT ses.*, es.max_violations
    FROM student_exam_sessions ses
    JOIN exam_schedules es ON ses.schedule_id = es.id
    WHERE ses.id = ? AND ses.student_id = ?
  `).get(sessionId, student.id);

  if (!session) return res.status(404).json({ success: false, message: 'Sesi ujian tidak valid.' });

  const now = new Date().toISOString();

  // Record violation entry
  db.prepare(`
    INSERT INTO exam_violations (session_id, schedule_id, student_id, violation_type, description, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, session.schedule_id, student.id, violationType || 'GENERAL_VIOLATION', description || 'Pelanggaran terdeteksi', now);

  // Increment session violation count
  const newViolationCount = (session.violation_count || 0) + 1;
  const isLocked = newViolationCount >= session.max_violations;
  const newStatus = isLocked ? 'LOCKED' : session.status;

  db.prepare(`
    UPDATE student_exam_sessions
    SET violation_count = ?, status = ?, last_activity = ?
    WHERE id = ?
  `).run(newViolationCount, newStatus, now, sessionId);

  // Broadcast real-time cheating alert to admin
  const io = req.app.get('io');
  if (io) {
    io.emit('cheating_alert', {
      sessionId,
      scheduleId: session.schedule_id,
      studentId: student.id,
      studentName: student.name,
      className: student.class_name,
      violationType,
      description,
      totalViolations: newViolationCount,
      isLocked,
      timestamp: now
    });
  }

  return res.json({
    success: true,
    violationCount: newViolationCount,
    isLocked,
    maxViolations: session.max_violations
  });
});

// 6. Webcam Proctoring Snapshot Upload (Compressed)
router.post('/snapshot', (req, res) => {
  const { sessionId, imageBase64, note } = req.body;
  const student = req.student;

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'Data gambar tidak ditemukan.' });
  }

  const session = db.prepare('SELECT * FROM student_exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, student.id);
  if (!session) return res.status(404).json({ success: false, message: 'Sesi tidak valid.' });

  try {
    // Strip header if data URL
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = `snap_${session.schedule_id}_${student.id}_${Date.now()}.jpg`;
    const filePath = path.join(uploadDir, fileName);

    fs.writeFileSync(filePath, buffer);
    const fileSizeKb = Math.round((buffer.length / 1024) * 10) / 10;
    const publicUrl = `/uploads/proctoring/${fileName}`;
    const now = new Date().toISOString();

    const info = db.prepare(`
      INSERT INTO proctoring_snapshots (session_id, schedule_id, student_id, photo_path, file_size_kb, captured_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, session.schedule_id, student.id, publicUrl, fileSizeKb, now, note || 'Pengawasan Otomatis');

    // Broadcast snapshot to admin live dashboard
    const io = req.app.get('io');
    if (io) {
      io.emit('new_snapshot', {
        id: info.lastInsertRowid,
        sessionId,
        scheduleId: session.schedule_id,
        studentId: student.id,
        studentName: student.name,
        className: student.class_name,
        photoPath: publicUrl,
        fileSizeKb,
        capturedAt: now
      });
    }

    return res.json({
      success: true,
      message: 'Foto pengawasan tersimpan.',
      photoPath: publicUrl,
      fileSizeKb
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal menyimpan snapshot: ' + err.message });
  }
});

// 7. Finish Exam
router.post('/finish', (req, res) => {
  const { sessionId } = req.body;
  const student = req.student;

  const session = db.prepare(`
    SELECT ses.*, es.show_result
    FROM student_exam_sessions ses
    JOIN exam_schedules es ON ses.schedule_id = es.id
    WHERE ses.id = ? AND ses.student_id = ?
  `).get(sessionId, student.id);

  if (!session) return res.status(404).json({ success: false, message: 'Sesi ujian tidak valid.' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE student_exam_sessions
    SET status = 'FINISHED', finished_at = ?
    WHERE id = ?
  `).run(now, sessionId);

  // Recalculate score
  calculateSessionScore(sessionId);

  const updatedSession = db.prepare('SELECT * FROM student_exam_sessions WHERE id = ?').get(sessionId);

  // Broadcast completion to admin
  const io = req.app.get('io');
  if (io) {
    io.emit('student_finished', {
      sessionId,
      studentId: student.id,
      studentName: student.name,
      score: updatedSession.score,
      finishedAt: now
    });
  }

  return res.json({
    success: true,
    message: 'Ujian berhasil diselesaikan.',
    score: session.show_result ? updatedSession.score : null,
    correctCount: session.show_result ? updatedSession.correct_count : null,
    wrongCount: session.show_result ? updatedSession.wrong_count : null,
    unansweredCount: session.show_result ? updatedSession.unanswered_count : null,
    showResult: Boolean(session.show_result)
  });
});

module.exports = router;
