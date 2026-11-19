const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAdmin } = require('./auth');

// Multer upload in memory for excel parsing
const upload = multer({ storage: multer.memoryStorage() });

// Apply requireAdmin to all routes in this router
router.use(requireAdmin);

// ==========================================
// 1. DASHBOARD STATS
// ==========================================
router.get('/dashboard/stats', (req, res) => {
  const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
  const totalBanks = db.prepare('SELECT COUNT(*) as count FROM question_banks').get().count;
  const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM questions').get().count;
  const activeSchedules = db.prepare('SELECT COUNT(*) as count FROM exam_schedules WHERE is_active = 1').get().count;
  const totalViolations = db.prepare('SELECT COUNT(*) as count FROM exam_violations').get().count;
  const totalSnapshots = db.prepare('SELECT COUNT(*) as count FROM proctoring_snapshots').get().count;

  const recentViolations = db.prepare(`
    SELECT v.*, s.name as student_name, s.class_name, es.title as exam_title
    FROM exam_violations v
    JOIN students s ON v.student_id = s.id
    JOIN exam_schedules es ON v.schedule_id = es.id
    ORDER BY v.timestamp DESC
    LIMIT 8
  `).all();

  const activeExams = db.prepare(`
    SELECT es.*, qb.subject,
      (SELECT COUNT(*) FROM student_exam_sessions WHERE schedule_id = es.id AND status = 'IN_PROGRESS') as active_students_count,
      (SELECT COUNT(*) FROM student_exam_sessions WHERE schedule_id = es.id AND status = 'FINISHED') as finished_students_count
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.is_active = 1
    ORDER BY es.id DESC
  `).all();

  return res.json({
    success: true,
    data: {
      totalStudents,
      totalBanks,
      totalQuestions,
      activeSchedules,
      totalViolations,
      totalSnapshots,
      recentViolations,
      activeExams
    }
  });
});

// ==========================================
// 2. DATA SISWA (STUDENTS) & CETAK KARTU
// ==========================================
router.get('/students', (req, res) => {
  const { class_name, search } = req.query;
  let query = 'SELECT * FROM students WHERE 1=1';
  const params = [];

  if (class_name && class_name !== 'ALL') {
    query += ' AND class_name = ?';
    params.push(class_name);
  }

  if (search) {
    query += ' AND (name LIKE ? OR nis LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY class_name ASC, name ASC';
  const students = db.prepare(query).all(...params);
  return res.json({ success: true, data: students });
});

router.get('/classes', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT class_name FROM students ORDER BY class_name ASC').all();
  return res.json({ success: true, data: rows.map(r => r.class_name) });
});

router.post('/students', (req, res) => {
  const { nis, password, name, class_name, gender, session_name, room_name } = req.body;
  if (!nis || !password || !name || !class_name) {
    return res.status(400).json({ success: false, message: 'NIS, Password, Nama, dan Kelas wajib diisi!' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO students (nis, password, name, class_name, gender, session_name, room_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(nis.trim(), password.trim(), name.trim(), class_name.trim(), gender || 'L', session_name || 'Sesi 1', room_name || 'Ruang 01');
    return res.json({ success: true, message: 'Data siswa berhasil ditambahkan.', id: info.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'NIS tersebut sudah terdaftar!' });
    }
    return res.status(500).json({ success: false, message: 'Gagal menambah siswa: ' + err.message });
  }
});

router.put('/students/:id', (req, res) => {
  const { id } = req.params;
  const { nis, password, name, class_name, gender, session_name, room_name } = req.body;

  try {
    const stmt = db.prepare(`
      UPDATE students
      SET nis = ?, password = ?, name = ?, class_name = ?, gender = ?, session_name = ?, room_name = ?
      WHERE id = ?
    `);
    stmt.run(nis.trim(), password.trim(), name.trim(), class_name.trim(), gender, session_name, room_name, id);
    return res.json({ success: true, message: 'Data siswa berhasil diperbarui.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal update siswa: ' + err.message });
  }
});

router.delete('/students/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Data siswa berhasil dihapus.' });
});

// Download Template Excel Data Siswa
router.get('/students/template', (req, res) => {
  const templateData = [
    { NIS: '2026001', Nama: 'Achmad Fadhilah Pratama', Kelas: 'XII-MIPA-1', JK: 'L', Sesi_Ujian: 'Sesi 1 (07.30 - 09.30)', Ruang: 'Lab Komputer 1', Password: 'alfa123' },
    { NIS: '2026002', Nama: 'Bintang Satria Putra', Kelas: 'XII-MIPA-1', JK: 'L', Sesi_Ujian: 'Sesi 1 (07.30 - 09.30)', Ruang: 'Lab Komputer 1', Password: 'bintang45' },
    { NIS: '2026003', Nama: 'Cahya Kirana Dewi', Kelas: 'XII-IPS-1', JK: 'P', Sesi_Ujian: 'Sesi 2 (10.00 - 12.00)', Ruang: 'Lab Komputer 2', Password: 'cahya88' }
  ];

  const ws = xlsx.utils.json_to_sheet(templateData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Template_Siswa');

  // Set column widths
  ws['!cols'] = [
    { wch: 12 },  // NIS
    { wch: 30 },  // Nama
    { wch: 14 },  // Kelas
    { wch: 6 },   // JK
    { wch: 22 },  // Sesi Ujian
    { wch: 16 },  // Ruang
    { wch: 14 }   // Password
  ];

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="Template_Import_Siswa_CBT.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(buffer);
});

// Import Massal Data Siswa dari Excel
router.post('/students/import-excel', upload.single('excel_file'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'Harap upload file Excel (.xlsx).' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File Excel kosong atau tidak memiliki baris data.' });
    }

    // Normalize header key (trim, remove spaces/underscore/dash/slash, lowercase)
    const normKey = (k) => String(k).trim().replace(/[\s_\-\/]/g, '').toLowerCase();

    // Map normalized column names from the first row
    const colMap = {};
    for (const key of Object.keys(rows[0])) {
      colMap[normKey(key)] = key;
    }

    // Pick value by any candidate column name
    function pick(row, candidates) {
      for (const cand of candidates) {
        const originalKey = colMap[normKey(cand)];
        if (originalKey !== undefined && row[originalKey] !== undefined) {
          const val = String(row[originalKey]).trim();
          if (val !== '') return val;
        }
      }
      return '';
    }

    // Existing NIS to detect duplicates
    const existingNis = new Set(
      db.prepare('SELECT nis FROM students').all().map(r => r.nis)
    );
    const seenNisInFile = new Set();

    let importedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;
    const errors = [];

    const insertStmt = db.prepare(`
      INSERT INTO students (nis, password, name, class_name, gender, session_name, room_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const importTransaction = db.transaction((items) => {
      items.forEach((row, idx) => {
        const lineNo = idx + 2; // +1 header, +1 for 1-based

        const nis = pick(row, ['NIS', 'NIS (Username)', 'Username', 'Nis Siswa']);
        const name = pick(row, ['Nama', 'Nama Lengkap', 'Nama Siswa']);
        const className = pick(row, ['Kelas', 'Kelas / Rombel', 'Kelas Rombel', 'Rombel']);
        const genderRaw = pick(row, ['JK', 'Jenis Kelamin', 'Gender', 'L/P']);
        const sessionName = pick(row, ['Sesi Ujian', 'Sesi', 'Sesi Nama']);
        const roomName = pick(row, ['Ruang Ujian', 'Ruang', 'Ruang Nama']);
        const passwordRaw = pick(row, ['Password', 'Password Ujian', 'Kata Sandi']);

        if (!nis || !name || !className) {
          invalidCount++;
          errors.push(`Baris ${lineNo}: NIS, Nama, dan Kelas wajib diisi (dilewati).`);
          return;
        }

        if (existingNis.has(nis) || seenNisInFile.has(nis)) {
          duplicateCount++;
          errors.push(`Baris ${lineNo}: NIS ${nis} sudah terdaftar (dilewati).`);
          return;
        }

        // Normalize gender to L/P
        let gender = 'L';
        if (genderRaw) {
          const g = genderRaw.trim().toUpperCase();
          if (['P', 'F', 'PEREMPUAN', 'WANITA', 'WOMAN'].includes(g)) {
            gender = 'P';
          } else if (['L', 'M', 'LAKI', 'MALE'].includes(g)) {
            gender = 'L';
          }
        }

        // Auto-generate password if empty (will be printed on exam card)
        const password = passwordRaw || `alfa${nis}`;

        seenNisInFile.add(nis);
        insertStmt.run(nis, password, name, className, gender, sessionName || 'Sesi 1', roomName || 'Ruang 01');
        importedCount++;
      });
    });

    importTransaction(rows);

    let message = `Berhasil mengimpor ${importedCount} dari ${rows.length} baris siswa dari Excel.`;
    if (duplicateCount > 0 || invalidCount > 0) {
      message += ` (${duplicateCount} NIS duplikat dilewati, ${invalidCount} baris tidak valid.)`;
    }

    return res.json({
      success: true,
      message,
      importedCount,
      duplicateCount,
      invalidCount,
      totalRows: rows.length,
      errors: errors.slice(0, 20)
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal memproses file Excel: ' + err.message });
  }
});



// Cetak Kartu Ujian Siswa (dengan Username dan Password)
router.get('/students/cards', (req, res) => {
  const { class_name } = req.query;
  let query = 'SELECT * FROM students';
  const params = [];

  if (class_name && class_name !== 'ALL') {
    query += ' WHERE class_name = ?';
    params.push(class_name);
  }

  query += ' ORDER BY class_name ASC, nis ASC';
  const students = db.prepare(query).all(...params);

  return res.json({
    success: true,
    data: students,
    schoolInfo: {
      name: 'SMK / SMA AL-FATIH INDONESIA',
      title: 'KARTU PESERTA UJIAN BERBASIS KOMPUTER (CBT)',
      academicYear: 'TAHUN AJARAN 2026/2027',
      location: 'Jakarta, Indonesia'
    }
  });
});

// ==========================================
// 3. BANK SOAL & BUTIR SOAL
// ==========================================
router.get('/banks', (req, res) => {
  const banks = db.prepare(`
    SELECT qb.*,
      (SELECT COUNT(*) FROM questions WHERE bank_id = qb.id) as real_question_count
    FROM question_banks qb
    ORDER BY qb.id DESC
  `).all();
  return res.json({ success: true, data: banks });
});

router.post('/banks', (req, res) => {
  const { code, subject, class_level, description } = req.body;
  if (!code || !subject || !class_level) {
    return res.status(400).json({ success: false, message: 'Kode bank, mata pelajaran, dan tingkat kelas wajib diisi.' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO question_banks (code, subject, class_level, description)
      VALUES (?, ?, ?, ?)
    `).run(code.trim().toUpperCase(), subject.trim(), class_level.trim(), description || '');
    return res.json({ success: true, message: 'Bank soal berhasil dibuat.', id: info.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'Kode bank soal sudah digunakan!' });
    }
    return res.status(500).json({ success: false, message: 'Gagal membuat bank soal: ' + err.message });
  }
});

router.delete('/banks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM question_banks WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Bank soal berhasil dihapus.' });
});

// Daftar Soal dalam Bank
router.get('/banks/:bankId/questions', (req, res) => {
  const { bankId } = req.params;
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(bankId);
  if (!bank) return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });

  const questions = db.prepare('SELECT * FROM questions WHERE bank_id = ? ORDER BY question_number ASC, id ASC').all(bankId);
  return res.json({ success: true, bank, data: questions });
});

// Tambah Soal Manual
router.post('/banks/:bankId/questions', (req, res) => {
  const { bankId } = req.params;
  const { question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, weight } = req.body;

  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_answer) {
    return res.status(400).json({ success: false, message: 'Pertanyaan, pilihan A-D, dan kunci jawaban wajib diisi.' });
  }

  const currentMax = db.prepare('SELECT MAX(question_number) as max_num FROM questions WHERE bank_id = ?').get(bankId);
  const nextNum = (currentMax?.max_num || 0) + 1;

  const info = db.prepare(`
    INSERT INTO questions (bank_id, question_number, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bankId, nextNum, question_text, option_a, option_b, option_c, option_d, option_e || '', correct_answer.toUpperCase(), weight || 1.0);

  // Update total questions in bank
  db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(bankId, bankId);

  return res.json({ success: true, message: 'Soal berhasil ditambahkan.', id: info.lastInsertRowid });
});

// Edit Soal
router.put('/questions/:id', (req, res) => {
  const { id } = req.params;
  const { question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, weight } = req.body;

  db.prepare(`
    UPDATE questions
    SET question_text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, option_e = ?, correct_answer = ?, weight = ?
    WHERE id = ?
  `).run(question_text, option_a, option_b, option_c, option_d, option_e || '', correct_answer.toUpperCase(), weight || 1.0, id);

  return res.json({ success: true, message: 'Soal berhasil diperbarui.' });
});

// Hapus Soal
router.delete('/questions/:id', (req, res) => {
  const { id } = req.params;
  const q = db.prepare('SELECT bank_id FROM questions WHERE id = ?').get(id);
  if (q) {
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(q.bank_id, q.bank_id);
  }
  return res.json({ success: true, message: 'Soal berhasil dihapus.' });
});

// ==========================================
// 4. IMPORT SOAL EXCEL & DOWNLOAD TEMPLATE
// ==========================================

// Download Template Excel
router.get('/questions/template', (req, res) => {
  const templateData = [
    {
      No: 1,
      Pertanyaan: 'Ibukota negara Indonesia yang baru di Kalimantan Timur adalah...',
      Opsi_A: 'Nusantara',
      Opsi_B: 'Balikpapan',
      Opsi_C: 'Samarinda',
      Opsi_D: 'Banjarmasin',
      Opsi_E: 'Pontianak',
      Kunci: 'A',
      Bobot: 10
    },
    {
      No: 2,
      Pertanyaan: 'Manakah di bawah ini yang merupakan bahasa pemrograman untuk membuat aplikasi web sisi server?',
      Opsi_A: 'HTML',
      Opsi_B: 'CSS',
      Opsi_C: 'Node.js',
      Opsi_D: 'Photoshop',
      Opsi_E: 'Canva',
      Kunci: 'C',
      Bobot: 10
    },
    {
      No: 3,
      Pertanyaan: 'Komponen perangkat keras komputer yang berfungsi sebagai penyimpan data permanen adalah...',
      Opsi_A: 'RAM',
      Opsi_B: 'SSD / Harddisk',
      Opsi_C: 'Processor',
      Opsi_D: 'Power Supply',
      Opsi_E: 'VGA Card',
      Kunci: 'B',
      Bobot: 10
    }
  ];

  const ws = xlsx.utils.json_to_sheet(templateData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Template_Soal');

  // Set column widths
  ws['!cols'] = [
    { wch: 6 },  // No
    { wch: 50 }, // Pertanyaan
    { wch: 20 }, // Opsi A
    { wch: 20 }, // Opsi B
    { wch: 20 }, // Opsi C
    { wch: 20 }, // Opsi D
    { wch: 20 }, // Opsi E
    { wch: 8 },  // Kunci
    { wch: 8 }   // Bobot
  ];

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="Template_Import_Soal_CBT.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(buffer);
});

// Import Soal dari Excel
router.post('/banks/:bankId/import-excel', upload.single('excel_file'), (req, res) => {
  const { bankId } = req.params;
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(bankId);
  if (!bank) return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'Harap upload file Excel (.xlsx).' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File Excel kosong atau tidak memiliki baris data.' });
    }

    const currentMax = db.prepare('SELECT MAX(question_number) as max_num FROM questions WHERE bank_id = ?').get(bankId);
    let nextNum = (currentMax?.max_num || 0) + 1;

    const insertQ = db.prepare(`
      INSERT INTO questions (bank_id, question_number, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let importedCount = 0;
    const importTransaction = db.transaction((items) => {
      for (const row of items) {
        const questionText = row['Pertanyaan'] || row['Soal'] || row['question_text'];
        const optA = row['Opsi_A'] || row['Pilihan_A'] || row['option_a'] || row['A'];
        const optB = row['Opsi_B'] || row['Pilihan_B'] || row['option_b'] || row['B'];
        const optC = row['Opsi_C'] || row['Pilihan_C'] || row['option_c'] || row['C'];
        const optD = row['Opsi_D'] || row['Pilihan_D'] || row['option_d'] || row['D'];
        const optE = row['Opsi_E'] || row['Pilihan_E'] || row['option_e'] || row['E'] || '';
        let key = row['Kunci'] || row['Kunci_Jawaban'] || row['correct_answer'] || row['Jawaban'];
        const weight = Number(row['Bobot'] || row['weight']) || 1.0;

        if (questionText && optA && optB && optC && optD && key) {
          key = String(key).trim().toUpperCase();
          insertQ.run(bankId, nextNum++, String(questionText).trim(), String(optA).trim(), String(optB).trim(), String(optC).trim(), String(optD).trim(), optE ? String(optE).trim() : '', key, weight);
          importedCount++;
        }
      }
    });

    importTransaction(rows);

    // Update total questions in bank
    db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(bankId, bankId);

    return res.json({
      success: true,
      message: `Berhasil mengimpor ${importedCount} butir soal dari Excel.`,
      importedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal memproses file Excel: ' + err.message });
  }
});

// ==========================================
// 5. ATUR JADWAL UJIAN (EXAM SCHEDULES)
// ==========================================
router.get('/schedules', (req, res) => {
  const schedules = db.prepare(`
    SELECT es.*, qb.subject, qb.code as bank_code,
      (SELECT COUNT(*) FROM student_exam_sessions WHERE schedule_id = es.id) as total_sessions,
      (SELECT COUNT(*) FROM student_exam_sessions WHERE schedule_id = es.id AND status = 'FINISHED') as finished_sessions
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    ORDER BY es.id DESC
  `).all();
  return res.json({ success: true, data: schedules });
});

router.post('/schedules', (req, res) => {
  const {
    title,
    bank_id,
    target_classes,
    start_time,
    end_time,
    duration_minutes,
    token,
    randomize_questions,
    randomize_options,
    show_result,
    max_violations,
    snapshot_interval_minutes,
    is_active
  } = req.body;

  if (!title || !bank_id || !start_time || !end_time || !duration_minutes) {
    return res.status(400).json({ success: false, message: 'Judul, Bank Soal, Waktu Mulai, Selesai, dan Durasi wajib diisi.' });
  }

  const stmt = db.prepare(`
    INSERT INTO exam_schedules (
      title, bank_id, target_classes, start_time, end_time,
      duration_minutes, token, randomize_questions, randomize_options,
      show_result, max_violations, snapshot_interval_minutes, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    title.trim(),
    bank_id,
    target_classes || 'ALL',
    start_time,
    end_time,
    parseInt(duration_minutes),
    token ? token.trim().toUpperCase() : '',
    randomize_questions !== undefined ? (randomize_questions ? 1 : 0) : 1,
    randomize_options !== undefined ? (randomize_options ? 1 : 0) : 1,
    show_result !== undefined ? (show_result ? 1 : 0) : 1,
    parseInt(max_violations) || 5,
    parseInt(snapshot_interval_minutes) || 30, // User requirement: default 30 menit
    is_active !== undefined ? (is_active ? 1 : 0) : 1
  );

  return res.json({ success: true, message: 'Jadwal ujian berhasil dibuat.', id: info.lastInsertRowid });
});

router.put('/schedules/:id', (req, res) => {
  const { id } = req.params;
  const {
    title,
    bank_id,
    target_classes,
    start_time,
    end_time,
    duration_minutes,
    token,
    randomize_questions,
    randomize_options,
    show_result,
    max_violations,
    snapshot_interval_minutes,
    is_active
  } = req.body;

  db.prepare(`
    UPDATE exam_schedules
    SET title = ?, bank_id = ?, target_classes = ?, start_time = ?, end_time = ?,
        duration_minutes = ?, token = ?, randomize_questions = ?, randomize_options = ?,
        show_result = ?, max_violations = ?, snapshot_interval_minutes = ?, is_active = ?
    WHERE id = ?
  `).run(
    title,
    bank_id,
    target_classes || 'ALL',
    start_time,
    end_time,
    parseInt(duration_minutes),
    token ? token.trim().toUpperCase() : '',
    randomize_questions ? 1 : 0,
    randomize_options ? 1 : 0,
    show_result ? 1 : 0,
    parseInt(max_violations) || 5,
    parseInt(snapshot_interval_minutes) || 30,
    is_active ? 1 : 0,
    id
  );

  return res.json({ success: true, message: 'Jadwal ujian berhasil diperbarui.' });
});

router.patch('/schedules/:id/toggle', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE exam_schedules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Status jadwal ujian diperbarui.' });
});

router.delete('/schedules/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM exam_schedules WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Jadwal ujian berhasil dihapus.' });
});

// ==========================================
// 6. REAL-TIME MONITORING & ANTI-KECURANGAN
// ==========================================
router.get('/monitoring/:scheduleId', (req, res) => {
  const { scheduleId } = req.params;

  const schedule = db.prepare(`
    SELECT es.*, qb.subject, qb.total_questions
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.id = ?
  `).get(scheduleId);

  if (!schedule) return res.status(404).json({ success: false, message: 'Jadwal ujian tidak ditemukan.' });

  // Get only active/in-progress sessions for this schedule
  const sessions = db.prepare(`
    SELECT ses.*, s.nis, s.name as student_name, s.class_name, s.room_name,
      (SELECT COUNT(*) FROM student_answers WHERE session_id = ses.id AND selected_answer IS NOT NULL) as answered_count,
      (SELECT COUNT(*) FROM proctoring_snapshots WHERE session_id = ses.id) as total_snapshots,
      (SELECT photo_path FROM proctoring_snapshots WHERE session_id = ses.id ORDER BY id DESC LIMIT 1) as latest_photo
    FROM student_exam_sessions ses
    JOIN students s ON ses.student_id = s.id
    WHERE ses.schedule_id = ? AND ses.status = 'IN_PROGRESS'
    ORDER BY ses.violation_count DESC, ses.last_activity DESC
  `).all(scheduleId);

  // Get recent violations for this schedule
  const violations = db.prepare(`
    SELECT ev.*, s.name as student_name, s.class_name
    FROM exam_violations ev
    JOIN students s ON ev.student_id = s.id
    WHERE ev.schedule_id = ?
    ORDER BY ev.timestamp DESC
    LIMIT 50
  `).all(scheduleId);

  return res.json({
    success: true,
    schedule,
    sessions,
    violations
  });
});

// Buka kunci ujian siswa (Unlock)
router.post('/monitoring/unlock', (req, res) => {
  const { sessionId } = req.body;
  db.prepare("UPDATE student_exam_sessions SET status = 'IN_PROGRESS' WHERE id = ?").run(sessionId);

  // Notify via socket
  const io = req.app.get('io');
  if (io) {
    io.emit('session_unlocked', { sessionId });
  }

  return res.json({ success: true, message: 'Sesi siswa berhasil dibuka kuncinya.' });
});

// Paksa Selesai Ujian Siswa
router.post('/monitoring/force-finish', (req, res) => {
  const { sessionId } = req.body;
  const now = new Date().toISOString();
  db.prepare("UPDATE student_exam_sessions SET status = 'FINISHED', finished_at = ? WHERE id = ?").run(now, sessionId);

  // Recalculate score
  calculateSessionScore(sessionId);

  // Notify via socket
  const io = req.app.get('io');
  if (io) {
    io.emit('force_finished', { sessionId });
  }

  return res.json({ success: true, message: 'Sesi siswa telah diselesaikan secara paksa oleh proktor.' });
});

// Ambil Foto Siswa dari Pengawas (Manual Proctoring Snapshot Request)
router.post('/monitoring/request-snapshot', (req, res) => {
  const { sessionId, studentId } = req.body;
  const io = req.app.get('io');
  if (io) {
    io.emit('capture_instant_snapshot', { sessionId, studentId });
  }
  return res.json({ success: true, message: 'Permintaan pengambilan gambar telah dikirim ke perangkat siswa.' });
});

// Kirim Pesan Teguran Langsung ke Layar Siswa
router.post('/monitoring/send-warning', (req, res) => {
  const { sessionId, studentId, message } = req.body;
  const io = req.app.get('io');
  if (io) {
    io.emit('proctor_warning', {
      sessionId,
      studentId,
      message: message || 'Peringatan dari pengawas: Harap tetap fokus pada layar ujian dan patuhi tata tertib!'
    });
  }
  return res.json({ success: true, message: 'Pesan peringatan telah dikirim ke siswa.' });
});

// Lihat Galeri Foto Pengawasan (Proctoring Snapshots) Siswa
router.get('/monitoring/snapshots/:scheduleId/:studentId', (req, res) => {
  const { scheduleId, studentId } = req.params;
  const snapshots = db.prepare(`
    SELECT * FROM proctoring_snapshots
    WHERE schedule_id = ? AND student_id = ?
    ORDER BY captured_at DESC
  `).all(scheduleId, studentId);

  const student = db.prepare('SELECT id, name, nis, class_name FROM students WHERE id = ?').get(studentId);

  return res.json({
    success: true,
    student,
    snapshots
  });
});

// ==========================================
// 7. HASIL & REKAP NILAI UJIAN
// ==========================================
router.get('/results/:scheduleId', (req, res) => {
  const { scheduleId } = req.params;
  const requestedClass = typeof req.query.class_name === 'string' ? req.query.class_name.trim() : '';
  const className = requestedClass && requestedClass !== 'ALL' ? requestedClass : null;

  const schedule = db.prepare(`
    SELECT es.*, qb.subject, qb.total_questions
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.id = ?
  `).get(scheduleId);

  if (!schedule) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });

  let resultsQuery = `
    SELECT ses.*, s.nis, s.name as student_name, s.class_name, s.room_name
    FROM student_exam_sessions ses
    JOIN students s ON ses.student_id = s.id
    WHERE ses.schedule_id = ?
  `;
  const resultParams = [scheduleId];

  if (className) {
    resultsQuery += ' AND s.class_name = ?';
    resultParams.push(className);
  }

  resultsQuery += ' ORDER BY ses.score DESC, ses.violation_count ASC';
  const results = db.prepare(resultsQuery).all(...resultParams);
  const classes = db.prepare(`
    SELECT DISTINCT s.class_name
    FROM student_exam_sessions ses
    JOIN students s ON ses.student_id = s.id
    WHERE ses.schedule_id = ?
    ORDER BY s.class_name ASC
  `).all(scheduleId).map(row => row.class_name);

  return res.json({
    success: true,
    schedule,
    classes,
    data: results
  });
});

// Export Nilai ke Excel
router.get('/results/:scheduleId/export-excel', (req, res) => {
  const { scheduleId } = req.params;
  const requestedClass = typeof req.query.class_name === 'string' ? req.query.class_name.trim() : '';
  const className = requestedClass && requestedClass !== 'ALL' ? requestedClass : null;

  const schedule = db.prepare(`
    SELECT es.*, qb.subject
    FROM exam_schedules es
    JOIN question_banks qb ON es.bank_id = qb.id
    WHERE es.id = ?
  `).get(scheduleId);

  if (!schedule) return res.status(404).send('Jadwal tidak ditemukan');

  let resultsQuery = `
    SELECT s.nis as NIS, s.name as "Nama Siswa", s.class_name as Kelas,
           ses.score as "Nilai Akhir", ses.correct_count as "Benar",
           ses.wrong_count as "Salah", ses.unanswered_count as "Kosong",
           ses.violation_count as "Jumlah Pelanggaran", ses.status as "Status Sesi",
           ses.started_at as "Waktu Mulai", ses.finished_at as "Waktu Selesai"
    FROM student_exam_sessions ses
    JOIN students s ON ses.student_id = s.id
    WHERE ses.schedule_id = ?
  `;
  const resultParams = [scheduleId];

  if (className) {
    resultsQuery += ' AND s.class_name = ?';
    resultParams.push(className);
  }

  resultsQuery += ' ORDER BY ses.score DESC';
  const results = db.prepare(resultsQuery).all(...resultParams);

  const ws = xlsx.utils.json_to_sheet(results);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Rekap_Nilai');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const sanitizedTitle = (schedule.title || 'Ujian').replace(/[^a-zA-Z0-9]/g, '_');
  const classSuffix = className ? `_${className.replace(/[^a-zA-Z0-9]/g, '_')}` : '';

  res.setHeader('Content-Disposition', `attachment; filename="Nilai_${sanitizedTitle}${classSuffix}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(buffer);
});

// Helper: Calculate session score
function calculateSessionScore(sessionId) {
  const session = db.prepare('SELECT * FROM student_exam_sessions WHERE id = ?').get(sessionId);
  if (!session) return;

  const schedule = db.prepare('SELECT bank_id FROM exam_schedules WHERE id = ?').get(session.schedule_id);
  if (!schedule) return;

  const questions = db.prepare('SELECT id, correct_answer, weight FROM questions WHERE bank_id = ?').all(schedule.bank_id);
  const answers = db.prepare('SELECT question_id, selected_answer FROM student_answers WHERE session_id = ?').all(sessionId);

  const answerMap = new Map();
  for (const ans of answers) {
    answerMap.set(ans.question_id, ans.selected_answer);
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const q of questions) {
    totalWeight += (q.weight || 1);
    const selected = answerMap.get(q.id);
    if (!selected) {
      unansweredCount++;
    } else if (selected.toUpperCase() === q.correct_answer.toUpperCase()) {
      correctCount++;
      earnedWeight += (q.weight || 1);
      db.prepare('UPDATE student_answers SET is_correct = 1 WHERE session_id = ? AND question_id = ?').run(sessionId, q.id);
    } else {
      wrongCount++;
      db.prepare('UPDATE student_answers SET is_correct = 0 WHERE session_id = ? AND question_id = ?').run(sessionId, q.id);
    }
  }

  const finalScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100 * 10) / 10 : 0;

  db.prepare(`
    UPDATE student_exam_sessions
    SET score = ?, correct_count = ?, wrong_count = ?, unanswered_count = ?
    WHERE id = ?
  `).run(finalScore, correctCount, wrongCount, unansweredCount, sessionId);
}

module.exports = router;
module.exports.calculateSessionScore = calculateSessionScore;
