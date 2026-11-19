const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/database');
const { requireAdmin } = require('./auth');

// Multer upload in memory for excel parsing
const upload = multer({ storage: multer.memoryStorage() });

const questionUploadDir = path.join(__dirname, '../public/uploads/questions');
fs.mkdirSync(questionUploadDir, { recursive: true });

const QUESTION_COLUMNS = [
  'question_text', 'question_image', 'question_audio', 'youtube_url',
  'option_a', 'option_a_image', 'option_b', 'option_b_image',
  'option_c', 'option_c_image', 'option_d', 'option_d_image',
  'option_e', 'option_e_image', 'correct_answer', 'weight'
];
const QUESTION_FILE_COLUMNS = [
  'question_image', 'question_audio', 'option_a_image', 'option_b_image',
  'option_c_image', 'option_d_image', 'option_e_image'
];
const QUESTION_MEDIA_FIELDS = {
  question_image_file: { column: 'question_image', type: 'image' },
  question_audio_file: { column: 'question_audio', type: 'audio' },
  option_a_image_file: { column: 'option_a_image', type: 'image' },
  option_b_image_file: { column: 'option_b_image', type: 'image' },
  option_c_image_file: { column: 'option_c_image', type: 'image' },
  option_d_image_file: { column: 'option_d_image', type: 'image' },
  option_e_image_file: { column: 'option_e_image', type: 'image' }
};
const MEDIA_EXTENSIONS = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac'])
};

const questionMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: Object.keys(QUESTION_MEDIA_FIELDS).length },
  fileFilter: (req, file, cb) => {
    const config = QUESTION_MEDIA_FIELDS[file.fieldname];
    const extension = path.extname(file.originalname).toLowerCase();
    if (!config || !MEDIA_EXTENSIONS[config.type].has(extension)) {
      return cb(new Error('Format file tidak didukung. Gambar: JPG/PNG/GIF/WebP; audio: MP3/WAV/OGG/M4A/AAC.'));
    }

    const genericMime = file.mimetype === 'application/octet-stream';
    const validImageMime = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    const validAudioMime = /^(audio\/(mpeg|mp3|wav|x-wav|ogg|mp4|x-m4a|aac)|video\/mp4|application\/ogg)$/.test(file.mimetype);
    if (!genericMime && !(config.type === 'image' ? validImageMime : validAudioMime)) {
      return cb(new Error('Tipe MIME file tidak sesuai dengan media yang dipilih.'));
    }
    cb(null, true);
  }
}).fields(Object.keys(QUESTION_MEDIA_FIELDS).map(name => ({ name, maxCount: 1 })));

function parseQuestionMedia(req, res, next) {
  questionMediaUpload(req, res, err => {
    if (!err) return next();
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Ukuran setiap file maksimal 10 MB.';
    if (err.code === 'LIMIT_FILE_COUNT') message = 'Terlalu banyak file media dalam satu soal.';
    return res.status(400).json({ success: false, message });
  });
}

function questionValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function textValue(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeMediaUrl(value, label) {
  const raw = textValue(value);
  if (!raw) return '';
  if (raw.length > 2048) throw questionValidationError(`URL ${label} terlalu panjang.`);

  const localPrefix = '/uploads/questions/';
  if (raw.startsWith(localPrefix)) {
    const fileName = raw.slice(localPrefix.length);
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw questionValidationError(`URL ${label} lokal tidak valid.`);
    }
    return raw;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw questionValidationError(`URL ${label} harus berupa alamat HTTP/HTTPS yang valid.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw questionValidationError(`URL ${label} hanya boleh menggunakan HTTP atau HTTPS.`);
  }
  return parsed.toString();
}

function normalizeYouTubeUrl(value) {
  const raw = textValue(value);
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw questionValidationError('Link YouTube tidak valid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw questionValidationError('Link YouTube hanya boleh menggunakan HTTP atau HTTPS.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  let videoId = '';
  if (host === 'youtu.be') {
    videoId = pathParts[0] || '';
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parsed.pathname === '/watch') videoId = parsed.searchParams.get('v') || '';
    if (['embed', 'shorts', 'live'].includes(pathParts[0])) videoId = pathParts[1] || '';
  } else if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
    if (pathParts[0] === 'embed') videoId = pathParts[1] || '';
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw questionValidationError('Link YouTube harus berisi ID video yang valid.');
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function removeLocalQuestionMedia(values) {
  for (const value of values) {
    if (!value || !value.startsWith('/uploads/questions/')) continue;
    const fileName = path.basename(value);
    if (value !== `/uploads/questions/${fileName}`) continue;
    try {
      fs.unlinkSync(path.join(questionUploadDir, fileName));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('Gagal menghapus media soal:', err.message);
    }
  }
}

function questionFilePaths(question) {
  return QUESTION_FILE_COLUMNS.map(column => question[column]).filter(Boolean);
}

function saveQuestionFile(file, config) {
  const maxSize = config.type === 'image' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw questionValidationError(`${config.type === 'image' ? 'Gambar' : 'Audio'} melebihi batas ${config.type === 'image' ? '5' : '10'} MB.`);
  }
  const extension = path.extname(file.originalname).toLowerCase();
  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(questionUploadDir, fileName), file.buffer);
  return `/uploads/questions/${fileName}`;
}

function buildQuestionData(source, files = {}) {
  const filesByColumn = {};
  for (const [fieldName, config] of Object.entries(QUESTION_MEDIA_FIELDS)) {
    const file = files[fieldName]?.[0];
    if (file) filesByColumn[config.column] = { file, config };
  }

  const data = {
    question_text: textValue(source.question_text),
    question_image: normalizeMediaUrl(filesByColumn.question_image ? '' : source.question_image, 'gambar soal'),
    question_audio: normalizeMediaUrl(filesByColumn.question_audio ? '' : source.question_audio, 'audio soal'),
    youtube_url: normalizeYouTubeUrl(source.youtube_url),
    correct_answer: textValue(source.correct_answer).toUpperCase()
  };

  const weight = Number(source.weight);
  data.weight = Number.isFinite(weight) && weight > 0 ? weight : 1.0;

  for (const key of ['a', 'b', 'c', 'd', 'e']) {
    const imageColumn = `option_${key}_image`;
    data[`option_${key}`] = textValue(source[`option_${key}`]);
    data[imageColumn] = normalizeMediaUrl(
      filesByColumn[imageColumn] ? '' : source[imageColumn],
      `gambar opsi ${key.toUpperCase()}`
    );
  }

  if (!data.question_text && !data.question_image && !data.question_audio && !data.youtube_url &&
      !filesByColumn.question_image && !filesByColumn.question_audio) {
    throw questionValidationError('Soal wajib memiliki teks, gambar, audio, atau link YouTube.');
  }
  for (const key of ['a', 'b', 'c', 'd']) {
    const imageColumn = `option_${key}_image`;
    if (!data[`option_${key}`] && !data[imageColumn] && !filesByColumn[imageColumn]) {
      throw questionValidationError(`Pilihan ${key.toUpperCase()} wajib memiliki teks atau gambar.`);
    }
  }
  if (!['A', 'B', 'C', 'D', 'E'].includes(data.correct_answer)) {
    throw questionValidationError('Kunci jawaban harus berupa A, B, C, D, atau E.');
  }
  const correctKey = data.correct_answer.toLowerCase();
  const correctImageColumn = `option_${correctKey}_image`;
  if (!data[`option_${correctKey}`] && !data[correctImageColumn] && !filesByColumn[correctImageColumn]) {
    throw questionValidationError(`Kunci ${data.correct_answer} tidak dapat dipakai karena pilihan tersebut kosong.`);
  }

  const savedPaths = [];
  try {
    for (const [column, media] of Object.entries(filesByColumn)) {
      const publicPath = saveQuestionFile(media.file, media.config);
      data[column] = publicPath;
      savedPaths.push(publicPath);
    }
  } catch (err) {
    removeLocalQuestionMedia(savedPaths);
    throw err;
  }

  return { data, savedPaths };
}

function questionValues(data) {
  return QUESTION_COLUMNS.map(column => data[column]);
}

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
  const mediaPaths = db.prepare('SELECT * FROM questions WHERE bank_id = ?').all(id)
    .flatMap(questionFilePaths);
  db.prepare('DELETE FROM question_banks WHERE id = ?').run(id);
  removeLocalQuestionMedia(mediaPaths);
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
router.post('/banks/:bankId/questions', parseQuestionMedia, (req, res) => {
  const { bankId } = req.params;
  const bank = db.prepare('SELECT id FROM question_banks WHERE id = ?').get(bankId);
  if (!bank) return res.status(404).json({ success: false, message: 'Bank soal tidak ditemukan.' });

  let savedPaths = [];
  try {
    const built = buildQuestionData(req.body, req.files || {});
    savedPaths = built.savedPaths;
    const currentMax = db.prepare('SELECT MAX(question_number) as max_num FROM questions WHERE bank_id = ?').get(bankId);
    const nextNum = (currentMax?.max_num || 0) + 1;
    const placeholders = QUESTION_COLUMNS.map(() => '?').join(', ');
    const info = db.prepare(`
      INSERT INTO questions (bank_id, question_number, ${QUESTION_COLUMNS.join(', ')})
      VALUES (?, ?, ${placeholders})
    `).run(bankId, nextNum, ...questionValues(built.data));

    db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(bankId, bankId);
    return res.json({ success: true, message: 'Soal berhasil ditambahkan.', id: info.lastInsertRowid });
  } catch (err) {
    removeLocalQuestionMedia(savedPaths);
    return res.status(err.statusCode || 500).json({ success: false, message: 'Gagal menyimpan soal: ' + err.message });
  }
});

// Edit Soal
router.put('/questions/:id', parseQuestionMedia, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan.' });

  let savedPaths = [];
  try {
    const built = buildQuestionData(req.body, req.files || {});
    savedPaths = built.savedPaths;
    const assignments = QUESTION_COLUMNS.map(column => `${column} = ?`).join(', ');
    db.prepare(`UPDATE questions SET ${assignments} WHERE id = ?`)
      .run(...questionValues(built.data), id);

    const retainedPaths = new Set(questionFilePaths(built.data));
    removeLocalQuestionMedia(questionFilePaths(existing).filter(mediaPath => !retainedPaths.has(mediaPath)));
    return res.json({ success: true, message: 'Soal berhasil diperbarui.' });
  } catch (err) {
    removeLocalQuestionMedia(savedPaths);
    return res.status(err.statusCode || 500).json({ success: false, message: 'Gagal memperbarui soal: ' + err.message });
  }
});

// Hapus Soal
router.delete('/questions/:id', (req, res) => {
  const { id } = req.params;
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (q) {
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(q.bank_id, q.bank_id);
    removeLocalQuestionMedia(questionFilePaths(q));
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
      Gambar_Soal: '',
      Audio_Soal: '',
      Youtube_Soal: '',
      Opsi_A: 'Nusantara',
      Gambar_A: '',
      Opsi_B: 'Balikpapan',
      Gambar_B: '',
      Opsi_C: 'Samarinda',
      Gambar_C: '',
      Opsi_D: 'Banjarmasin',
      Gambar_D: '',
      Opsi_E: 'Pontianak',
      Gambar_E: '',
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
    { wch: 32 }, // Gambar soal
    { wch: 32 }, // Audio soal
    { wch: 40 }, // YouTube soal
    { wch: 20 }, { wch: 32 }, // Opsi dan gambar A
    { wch: 20 }, { wch: 32 }, // Opsi dan gambar B
    { wch: 20 }, { wch: 32 }, // Opsi dan gambar C
    { wch: 20 }, { wch: 32 }, // Opsi dan gambar D
    { wch: 20 }, { wch: 32 }, // Opsi dan gambar E
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
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File Excel kosong atau tidak memiliki baris data.' });
    }

    const normalizeHeader = key => String(key).trim().replace(/[\s_\-\/]/g, '').toLowerCase();
    const normalizedRows = rows.map(row => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) normalized[normalizeHeader(key)] = value;
      return normalized;
    });
    const cell = (row, ...aliases) => {
      for (const alias of aliases) {
        const value = row[normalizeHeader(alias)];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
      }
      return '';
    };

    const currentMax = db.prepare('SELECT MAX(question_number) as max_num FROM questions WHERE bank_id = ?').get(bankId);
    let nextNum = (currentMax?.max_num || 0) + 1;
    const placeholders = QUESTION_COLUMNS.map(() => '?').join(', ');
    const insertQ = db.prepare(`
      INSERT INTO questions (bank_id, question_number, ${QUESTION_COLUMNS.join(', ')})
      VALUES (?, ?, ${placeholders})
    `);

    let importedCount = 0;
    let skippedCount = 0;
    const errors = [];
    const importTransaction = db.transaction(items => {
      items.forEach((row, index) => {
        try {
          const source = {
            question_text: cell(row, 'Pertanyaan', 'Soal', 'question_text'),
            question_image: cell(row, 'Gambar_Soal', 'Foto_Soal', 'question_image'),
            question_audio: cell(row, 'Audio_Soal', 'question_audio'),
            youtube_url: cell(row, 'Youtube_Soal', 'Link_Youtube', 'youtube_url', 'YouTube'),
            correct_answer: cell(row, 'Kunci', 'Kunci_Jawaban', 'correct_answer', 'Jawaban'),
            weight: cell(row, 'Bobot', 'weight') || 1.0
          };
          for (const key of ['a', 'b', 'c', 'd', 'e']) {
            const upper = key.toUpperCase();
            source[`option_${key}`] = cell(row, `Opsi_${upper}`, `Pilihan_${upper}`, `option_${key}`, upper);
            source[`option_${key}_image`] = cell(row, `Gambar_${upper}`, `Foto_${upper}`, `Gambar_Opsi_${upper}`, `option_${key}_image`);
          }

          const { data } = buildQuestionData(source);
          insertQ.run(bankId, nextNum++, ...questionValues(data));
          importedCount++;
        } catch (err) {
          skippedCount++;
          errors.push(`Baris ${index + 2}: ${err.message}`);
        }
      });
    });

    importTransaction(normalizedRows);

    // Update total questions in bank
    db.prepare('UPDATE question_banks SET total_questions = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?').run(bankId, bankId);

    return res.json({
      success: true,
      message: `Berhasil mengimpor ${importedCount} butir soal dari Excel${skippedCount ? `; ${skippedCount} baris dilewati` : ''}.`,
      importedCount,
      skippedCount,
      errors
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
