const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'cbt_alfatih.db');
const db = new Database(dbPath, {
  // verbose: console.log // uncomment for debugging
});

// High performance PRAGMA configurations for SQLite
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

// Initialize database schema
function initSchema() {
  db.exec(`
    -- Admin users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Students table
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nis TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      gender TEXT DEFAULT 'L',
      session_name TEXT DEFAULT 'Sesi 1',
      room_name TEXT DEFAULT 'Ruang 01',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);
    CREATE INDEX IF NOT EXISTS idx_students_nis ON students(nis);

    -- Question banks
    CREATE TABLE IF NOT EXISTS question_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL,
      class_level TEXT NOT NULL,
      description TEXT,
      total_questions INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Questions
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
      question_number INTEGER DEFAULT 1,
      question_text TEXT NOT NULL,
      question_image TEXT,
      question_audio TEXT,
      youtube_url TEXT,
      option_a TEXT NOT NULL,
      option_a_image TEXT,
      option_b TEXT NOT NULL,
      option_b_image TEXT,
      option_c TEXT NOT NULL,
      option_c_image TEXT,
      option_d TEXT NOT NULL,
      option_d_image TEXT,
      option_e TEXT,
      option_e_image TEXT,
      correct_answer TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);

    -- Exam schedules
    CREATE TABLE IF NOT EXISTS exam_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      bank_id INTEGER NOT NULL REFERENCES question_banks(id),
      target_classes TEXT NOT NULL DEFAULT 'ALL',
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      token TEXT DEFAULT '',
      randomize_questions INTEGER DEFAULT 1,
      randomize_options INTEGER DEFAULT 1,
      show_result INTEGER DEFAULT 1,
      max_violations INTEGER DEFAULT 5,
      snapshot_interval_minutes INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_active ON exam_schedules(is_active);

    -- Student exam sessions
    CREATE TABLE IF NOT EXISTS student_exam_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES exam_schedules(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      started_at DATETIME,
      finished_at DATETIME,
      status TEXT DEFAULT 'IN_PROGRESS', -- 'NOT_STARTED', 'IN_PROGRESS', 'FINISHED', 'LOCKED'
      score REAL DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      wrong_count INTEGER DEFAULT 0,
      unanswered_count INTEGER DEFAULT 0,
      violation_count INTEGER DEFAULT 0,
      question_order TEXT, -- JSON array of question IDs
      options_order TEXT,  -- JSON object mapping question_id -> array of option keys
      ip_address TEXT,
      user_agent TEXT,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schedule_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_schedule_student ON student_exam_sessions(schedule_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON student_exam_sessions(status);

    -- Student answers
    CREATE TABLE IF NOT EXISTS student_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES student_exam_sessions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      selected_answer TEXT,
      is_doubtful INTEGER DEFAULT 0,
      is_correct INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_answers_session ON student_answers(session_id);

    -- Cheating Violations Log
    CREATE TABLE IF NOT EXISTS exam_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES student_exam_sessions(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      violation_type TEXT NOT NULL, -- 'TAB_SWITCH', 'WINDOW_BLUR', 'COPY_PASTE', 'FULLSCREEN_EXIT', 'CAMERA_BLOCKED', 'DEVTOOLS_OPEN'
      description TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_violations_session ON exam_violations(session_id);
    CREATE INDEX IF NOT EXISTS idx_violations_schedule ON exam_violations(schedule_id);

    -- Proctoring Snapshots (Webcam captures every 30 minutes or baseline)
    CREATE TABLE IF NOT EXISTS proctoring_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES student_exam_sessions(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      photo_path TEXT NOT NULL,
      file_size_kb REAL DEFAULT 0,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_session ON proctoring_snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_schedule ON proctoring_snapshots(schedule_id);
  `);

  // CREATE TABLE IF NOT EXISTS does not add new columns to an existing database.
  const existingQuestionColumns = new Set(
    db.pragma('table_info(questions)').map(column => column.name)
  );
  const questionMediaColumns = [
    'question_audio',
    'youtube_url',
    'option_a_image',
    'option_b_image',
    'option_c_image',
    'option_d_image',
    'option_e_image'
  ];

  for (const column of questionMediaColumns) {
    if (!existingQuestionColumns.has(column)) {
      db.exec(`ALTER TABLE questions ADD COLUMN ${column} TEXT`);
    }
  }
}

initSchema();

module.exports = db;
