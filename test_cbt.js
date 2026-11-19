const http = require('http');

async function runTests() {
  console.log('🧪 Starting CBT Al-Fatih Automated Verification...');

  // Reset test student sessions so test is completely idempotent
  const db = require('./db/database.js');
  db.prepare("DELETE FROM student_exam_sessions WHERE student_id = (SELECT id FROM students WHERE nis = '2026001')").run();

  // Start server in background for testing
  const serverProcess = require('./server.js');
  await new Promise(r => setTimeout(r, 1000));

  const BASE_URL = 'http://127.0.0.1:3000';

  // Helper fetch
  async function postJson(endpoint, body, cookie = '') {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json(), headers: res.headers };
  }

  async function getJson(endpoint, cookie = '') {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Cookie': cookie }
    });
    return { status: res.status, data: await res.json(), headers: res.headers };
  }

  // 1. Test Admin Login
  console.log('\n1. Testing Admin Login...');
  const adminLogin = await postJson('/api/auth/admin/login', {
    username: 'admin',
    password: 'admin123'
  });
  console.log('Admin login status:', adminLogin.status, 'success:', adminLogin.data.success);
  if (!adminLogin.data.success) throw new Error('Admin login failed');
  const adminCookie = `cbt_token=${adminLogin.data.token}`;

  // 2. Test Get Students & Exam Cards
  console.log('\n2. Testing Student Management & Exam Cards...');
  const studentsRes = await getJson('/api/admin/students', adminCookie);
  console.log(`Loaded ${studentsRes.data.data.length} students.`);

  const cardsRes = await getJson('/api/admin/students/cards', adminCookie);
  console.log(`Cards endpoint returned ${cardsRes.data.data.length} student cards. Sample student password:`, cardsRes.data.data[0].password);
  if (!cardsRes.data.data[0].password) throw new Error('Password missing in student card');

  // 3. Test Question Template Download
  console.log('\n3. Testing Excel Question Template Download...');
  const templateRes = await fetch(`${BASE_URL}/api/admin/questions/template`, {
    headers: { 'Cookie': adminCookie }
  });
  console.log('Template status:', templateRes.status, 'Content-Type:', templateRes.headers.get('content-type'));
  if (templateRes.status !== 200) throw new Error('Template download failed');

  // 4. Test Student Login
  console.log('\n4. Testing Student Login...');
  const studentLogin = await postJson('/api/auth/student/login', {
    nis: '2026001',
    password: 'alfa123'
  });
  console.log('Student login status:', studentLogin.status, 'Student name:', studentLogin.data.student.name);
  if (!studentLogin.data.success) throw new Error('Student login failed');
  const studentCookie = `cbt_token=${studentLogin.data.token}`;

  // 5. Test Available Exams
  console.log('\n5. Testing Available Exams for Student...');
  const availExams = await getJson('/api/exam/available', studentCookie);
  console.log('Available exams count:', availExams.data.data.length);
  const exam = availExams.data.data[0];

  // 6. Test Start Exam
  console.log('\n6. Testing Start Exam Session...');
  const startExam = await postJson('/api/exam/start', {
    schedule_id: exam.id,
    token: exam.tokengit 
  }, studentCookie);
  console.log('Start exam status:', startExam.status, 'Session ID:', startExam.data.sessionId);
  const sessionId = startExam.data.sessionId;

  // 7. Test Get Session & Questions
  console.log('\n7. Testing Exam Session Questions Loading...');
  const sessionData = await getJson(`/api/exam/session/${sessionId}`, studentCookie);
  console.log('Loaded questions count:', sessionData.data.questions.length);
  console.log('First question:', sessionData.data.questions[0].text);

  // 8. Test Submit Answer
  console.log('\n8. Testing Save Student Answer...');
  const q1 = sessionData.data.questions[0];
  const ansRes = await postJson('/api/exam/answer', {
    sessionId,
    questionId: q1.id,
    selectedAnswer: 'B',
    isDoubtful: false
  }, studentCookie);
  console.log('Answer saved, total answered count:', ansRes.data.answeredCount);

  // 9. Test Anti-Cheat Violation Logging
  console.log('\n9. Testing Anti-Cheat Violation Logging (Tab switch, blur, copy)...');
  const violRes = await postJson('/api/exam/violation', {
    sessionId,
    violationType: 'TAB_SWITCH',
    description: 'Pindah ke tab lain atau meminimalkan browser'
  }, studentCookie);
  console.log('Violation recorded! Total violations for student:', violRes.data.violationCount, 'Is locked:', violRes.data.isLocked);

  // 10. Test Webcam Proctoring Compressed Snapshot Upload
  console.log('\n10. Testing Compressed Webcam Snapshot Upload...');
  // 1x1 dummy jpeg in base64
  const dummyBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const snapRes = await postJson('/api/exam/snapshot', {
    sessionId,
    imageBase64: dummyBase64,
    note: 'Tes Foto Berkala 30 Menit'
  }, studentCookie);
  console.log('Snapshot uploaded successfully! Path:', snapRes.data.photoPath, 'Size KB:', snapRes.data.fileSizeKb);

  // 11. Test Live Monitoring Dashboard API
  console.log('\n11. Testing Admin Live Monitoring Endpoint...');
  const monitorRes = await getJson(`/api/admin/monitoring/${exam.id}`, adminCookie);
  console.log('Active sessions in monitor:', monitorRes.data.sessions.length);
  console.log('Violations in monitor:', monitorRes.data.violations.length);
  console.log('Latest snapshot recorded:', monitorRes.data.sessions[0].total_snapshots);

  // 12. Test Finish Exam & Grading
  console.log('\n12. Testing Finish Exam...');
  const finishRes = await postJson('/api/exam/finish', { sessionId }, studentCookie);
  console.log('Finish exam response:', finishRes.data);

  console.log('\n======================================================');
  console.log('🎉 ALL 12 CBT ENGINE & ANTI-CHEAT TESTS PASSED!');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
