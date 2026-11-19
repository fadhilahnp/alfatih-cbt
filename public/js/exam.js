/**
 * CBT Al-Fatih - Student Exam Engine with Anti-Cheat & Camera Proctoring
 * Fully optimized for Mobile Handphone & Desktop
 */

// Global State
let examSession = null;
let questions = [];
let currentQuestionIndex = 0;
let studentAnswers = {};
let remainingSeconds = 0;
let timerInterval = null;
let proctoringInterval = null;
let mediaStream = null;
let violationCount = 0;
let maxViolations = 5;
let isExamFinished = false;
let isLocked = false;
let isConfirmingFinish = false; // Flag to prevent blur violation when confirming submit
let renderedQuestionId = null;
let snapshotIntervalMinutes = 30; // Default 30 menit as requested

// Audio synthesizer for alerts
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(freq = 440, type = 'sine', duration = 0.2) {
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio context not allowed or failed
  }
}

function playViolationAlarm() {
  playBeep(880, 'sawtooth', 0.3);
  setTimeout(() => playBeep(660, 'sawtooth', 0.4), 200);
}

// 1. Initialize Exam
async function initExam() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (!sessionId) {
    alert('Sesi ujian tidak ditemukan!');
    window.location.href = '/student/confirm';
    return;
  }

  try {
    const res = await fetch(`/api/exam/session/${sessionId}`);
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Gagal memuat sesi ujian');
      window.location.href = '/student/confirm';
      return;
    }

    examSession = data.session;
    questions = data.questions;
    remainingSeconds = data.session.remainingSeconds;
    violationCount = data.session.violationCount || 0;
    maxViolations = data.session.maxViolations || 5;
    snapshotIntervalMinutes = data.session.snapshotIntervalMinutes || 30;

    // Check if session is already finished or locked
    if (examSession.status === 'FINISHED') {
      window.location.href = `/student/finish?session_id=${examSession.id}`;
      return;
    }

    if (examSession.status === 'LOCKED') {
      showLockScreen();
      return;
    }

    // Populate UI info
    document.getElementById('examTitle').textContent = examSession.examTitle;
    document.getElementById('examSubject').textContent = examSession.subject;
    document.getElementById('studentName').textContent = data.student.name;
    document.getElementById('studentClass').textContent = `${data.student.className} • ${data.student.roomName || 'Ruang CBT'}`;
    document.getElementById('totalQuestionsCount').textContent = questions.length;

    // Build question answers map
    questions.forEach((q, idx) => {
      studentAnswers[q.id] = {
        selected: q.selectedAnswer,
        isDoubtful: q.isDoubtful
      };
    });

    renderPalette();
    renderQuestion(0);
    startTimer();
    setupAntiCheat();
    setupSocket(sessionId, data.student.id);

    // Request & start camera proctoring
    await startCameraProctoring();

  } catch (err) {
    console.error('Error init exam:', err);
    alert('Terjadi kesalahan memuat data ujian: ' + err.message);
  }
}

// ========================================================
// 2. WEBCAM PROCTORING & COMPRESSED SNAPSHOT (MOBILE OPTIMIZED)
// ========================================================

// Cross-browser & Mobile Polyfill for getUserMedia
function getCameraMedia(constraints) {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacyGetUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia || navigator.getUserMedia;
  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, constraints, resolve, reject);
    });
  }
  return Promise.reject(new Error('Browser ini memblokir kamera atau koneksi bukan HTTPS'));
}

async function obtainUserMedia() {
  // Check if mobile HTTP LAN issue
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isHttps = window.location.protocol === 'https:';

  if (!isLocal && !isHttps) {
    const alertBox = document.getElementById('examHttpsAlert');
    const link = document.getElementById('examHttpsLink');
    if (alertBox && link) {
      link.href = `https://${window.location.hostname}:3001${window.location.pathname}${window.location.search}`;
      alertBox.style.display = 'block';
    }
  }

  // Attempt 1: Ideal 640x480 front camera (user)
  try {
    return await getCameraMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
  } catch (e1) {
    console.warn('Attempt 1 failed, trying fallback 2:', e1);
  }

  // Attempt 2: Flexible user facing
  try {
    return await getCameraMedia({
      video: { facingMode: 'user' },
      audio: false
    });
  } catch (e2) {
    console.warn('Attempt 2 failed, trying fallback 3:', e2);
  }

  // Attempt 3: Any video device
  return await getCameraMedia({
    video: true,
    audio: false
  });
}

async function startCameraProctoring() {
  const overlay = document.getElementById('cameraBlockerOverlay');
  const videoElem = document.getElementById('cameraPreview');

  try {
    mediaStream = await obtainUserMedia();

    // Ensure video properties for mobile browsers (iOS WebKit & Android Chrome)
    videoElem.setAttribute('autoplay', '');
    videoElem.setAttribute('playsinline', '');
    videoElem.setAttribute('webkit-playsinline', '');
    videoElem.muted = true;
    videoElem.srcObject = mediaStream;

    try {
      await videoElem.play();
    } catch (playErr) {
      console.log('Video preview play error:', playErr);
    }

    overlay.classList.remove('active');

    // Monitor if camera stream stops or track ends
    const track = mediaStream.getVideoTracks()[0];
    track.onended = () => {
      handleCameraDisconnected('Kamera depan terputus atau ditutup!');
    };

    // Take baseline snapshot immediately upon entering
    setTimeout(() => {
      captureAndSendSnapshot('Baseline foto saat ujian dimulai');
    }, 2000);

    // Setup periodic snapshot every 30 minutes (or configured interval)
    if (proctoringInterval) clearInterval(proctoringInterval);
    const intervalMs = snapshotIntervalMinutes * 60 * 1000;
    console.log(`📸 Webcam snapshot interval set to: ${snapshotIntervalMinutes} minutes (${intervalMs}ms)`);

    proctoringInterval = setInterval(() => {
      captureAndSendSnapshot(`Foto berkala (${snapshotIntervalMinutes} menit)`);
    }, intervalMs);

  } catch (err) {
    console.warn('Camera access denied or unavailable:', err);
    handleCameraDisconnected('Izin akses kamera depan ditolak atau belum aktif.');
  }
}

function handleCameraDisconnected(reason) {
  const overlay = document.getElementById('cameraBlockerOverlay');
  overlay.classList.add('active');
  playViolationAlarm();
  reportViolation('CAMERA_BLOCKED', reason);
}

// Retry camera button
async function retryCameraAccess(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById('retryCameraBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Meminta Izin Kamera...';
  }

  await startCameraProctoring();

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔄 Aktifkan Kamera Sekarang';
  }
}

/**
 * Capture frame from video, resize & compress as JPEG, send to server
 */
function captureAndSendSnapshot(note = '') {
  if (!mediaStream) return;
  const video = document.getElementById('cameraPreview');
  if (!video || video.videoWidth === 0) return;

  try {
    // Off-screen canvas with compressed resolution 400x300
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Compress to JPEG with 0.5 quality (typically ~15KB - 25KB only!)
    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);

    // Send to backend
    fetch('/api/exam/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: examSession.id,
        imageBase64: compressedBase64,
        note
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        console.log(`✅ Snapshot captured & compressed (${data.fileSizeKb} KB): ${data.photoPath}`);
      }
    })
    .catch(e => console.error('Error sending snapshot:', e));

  } catch (e) {
    console.error('Failed to capture snapshot:', e);
  }
}

// ========================================================
// 3. ANTI-CHEAT ENGINE (DETEKSI KECURANGAN)
// ========================================================
function setupAntiCheat() {
  // 1. Tab Switching Detection (document.visibilitychange)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isExamFinished) {
      reportViolation('TAB_SWITCH', 'Membuka tab peramban lain atau meminimalkan layar ujian');
    }
  });

  // 2. Window Blur / Pindah Aplikasi Lain
  window.addEventListener('blur', () => {
    if (!isExamFinished && !isLocked && !isConfirmingFinish) {
      reportViolation('WINDOW_BLUR', 'Pindah ke aplikasi lain atau kehilangan fokus dari jendela ujian');
    }
  });

  // 3. Fullscreen Exit Detection
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !isExamFinished) {
      reportViolation('FULLSCREEN_EXIT', 'Keluar dari mode layar penuh (Fullscreen)');
    }
  });

  // 4. Copy, Cut, Select prevention (Menyalin Soal)
  document.addEventListener('copy', (e) => {
    e.preventDefault();
    reportViolation('COPY_PASTE', 'Mencoba menyalin (copy) teks soal ujian');
  });

  document.addEventListener('cut', (e) => {
    e.preventDefault();
    reportViolation('COPY_PASTE', 'Mencoba memotong (cut) teks');
  });

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    reportViolation('COPY_PASTE', 'Mencoba klik kanan (context menu)');
  });

  document.addEventListener('selectstart', (e) => {
    e.preventDefault();
  });

  // 5. Block Key Combinations (Ctrl+C, Ctrl+V, Ctrl+U, Ctrl+S, F12, DevTools)
  window.addEventListener('keydown', (e) => {
    if (
      (e.ctrlKey && ['c', 'v', 'x', 'a', 'u', 's', 'p'].includes(e.key.toLowerCase())) ||
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))
    ) {
      e.preventDefault();
      reportViolation('DEVTOOLS_OPEN', `Mencoba menekan kombinasi tombol dilarang (${e.key})`);
    }
  });

  // Request fullscreen when user interacts
  enterFullscreen();
}

function enterFullscreen() {
  try {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => {});
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen().catch(() => {});
      }
    }
  } catch (err) {}
}

// Report violation to server
let isReporting = false;
async function reportViolation(type, description) {
  if (isExamFinished || isLocked || isReporting) return;
  isReporting = true;

  playViolationAlarm();

  try {
    const res = await fetch('/api/exam/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: examSession.id,
        violationType: type,
        description
      })
    });

    const data = await res.json();
    if (data.success) {
      violationCount = data.violationCount;
      if (data.isLocked) {
        isLocked = true;
        showLockScreen();
      } else {
        showCheatWarningModal(description, violationCount, data.maxViolations);
      }
    }
  } catch (err) {
    console.error('Error reporting violation:', err);
  } finally {
    setTimeout(() => { isReporting = false; }, 1000);
  }
}

function showCheatWarningModal(reason, currentCount, maxCount) {
  const modal = document.getElementById('cheatWarningModal');
  document.getElementById('cheatReasonText').textContent = reason;
  document.getElementById('cheatCounterBadge').textContent = `Pelanggaran ke-${currentCount} dari batas toleransi ${maxCount}`;
  modal.classList.add('active');
}

function dismissCheatWarning() {
  const modal = document.getElementById('cheatWarningModal');
  modal.classList.remove('active');
  enterFullscreen();
}

function showLockScreen() {
  isLocked = true;
  if (timerInterval) clearInterval(timerInterval);
  if (proctoringInterval) clearInterval(proctoringInterval);
  const modal = document.getElementById('cheatWarningModal');
  modal.classList.remove('active');

  const lockOverlay = document.getElementById('lockExamOverlay');
  lockOverlay.classList.add('active');
}

// ========================================================
// 4. QUESTION RENDERING & NAVIGATION (MOBILE OPTIMIZED)
// ========================================================
function getYouTubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = parts[0] || '';
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      if (['embed', 'shorts', 'live'].includes(parts[0])) videoId = parts[1] || '';
    } else if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
      if (parts[0] === 'embed') videoId = parts[1] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId)
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : '';
  } catch (err) {
    return '';
  }
}

function renderQuestionMedia(question) {
  const container = document.getElementById('questionMedia');
  container.querySelectorAll('audio').forEach(audio => audio.pause());
  container.replaceChildren();

  if (question.image) {
    const image = document.createElement('img');
    image.className = 'question-media-image';
    image.src = question.image;
    image.alt = 'Gambar pendukung soal';
    image.draggable = false;
    container.appendChild(image);
  }

  if (question.audio) {
    const audio = document.createElement('audio');
    audio.className = 'question-media-audio';
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = question.audio;
    container.appendChild(audio);
  }

  const embedUrl = getYouTubeEmbedUrl(question.youtubeUrl);
  if (embedUrl) {
    const iframe = document.createElement('iframe');
    iframe.className = 'youtube-embed';
    iframe.src = embedUrl;
    iframe.title = 'Video YouTube pendukung soal';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    container.appendChild(iframe);
  }
}

function renderQuestion(index) {
  if (index < 0 || index >= questions.length) return;
  currentQuestionIndex = index;

  const q = questions[index];
  const ansData = studentAnswers[q.id] || { selected: null, isDoubtful: false };

  // Set number badge and render content only when moving to another question.
  document.getElementById('currentQuestionBadge').textContent = `Soal No. ${q.number}`;
  if (renderedQuestionId !== q.id) {
    const questionText = document.getElementById('questionText');
    questionText.textContent = q.text || '';
    questionText.style.display = q.text ? 'block' : 'none';
    renderQuestionMedia(q);
    renderedQuestionId = q.id;
  }

  // Options list
  const container = document.getElementById('optionsContainer');
  container.replaceChildren();

  q.options.forEach(opt => {
    const isSelected = ansData.selected === opt.key;
    const optDiv = document.createElement('div');
    optDiv.className = `option-item ${isSelected ? 'selected' : ''}`;
    optDiv.onclick = () => selectOption(q.id, opt.key);

    const keyElement = document.createElement('div');
    keyElement.className = 'option-key';
    keyElement.textContent = opt.key;
    const textElement = document.createElement('div');
    textElement.className = 'option-text';
    if (opt.text) {
      const textValue = document.createElement('div');
      textValue.textContent = opt.text;
      textElement.appendChild(textValue);
    }
    if (opt.image) {
      const image = document.createElement('img');
      image.className = 'option-image';
      image.src = opt.image;
      image.alt = `Gambar jawaban ${opt.key}`;
      image.draggable = false;
      textElement.appendChild(image);
    }
    optDiv.append(keyElement, textElement);
    container.appendChild(optDiv);
  });

  // Doubt button state
  const doubtBtn = document.getElementById('doubtButton');
  if (ansData.isDoubtful) {
    doubtBtn.classList.add('active');
    doubtBtn.innerHTML = '<span>★</span> Ragu-Ragu (Aktif)';
  } else {
    doubtBtn.classList.remove('active');
    doubtBtn.innerHTML = '<span>☆</span> Ragu-Ragu';
  }

  // Prev / Next button states
  document.getElementById('prevButton').disabled = (index === 0);
  const nextBtn = document.getElementById('nextButton');
  if (index === questions.length - 1) {
    nextBtn.textContent = 'Selesai Ujian';
    nextBtn.className = 'btn btn-success';
    nextBtn.onclick = () => confirmFinishExam();
  } else {
    nextBtn.textContent = 'Berikutnya →';
    nextBtn.className = 'btn btn-primary';
    nextBtn.onclick = () => nextQuestion();
  }

  updatePaletteActive();
}

function nextQuestion() {
  if (currentQuestionIndex < questions.length - 1) {
    renderQuestion(currentQuestionIndex + 1);
  }
}

function prevQuestion() {
  if (currentQuestionIndex > 0) {
    renderQuestion(currentQuestionIndex - 1);
  }
}

function selectOption(questionId, key) {
  const current = studentAnswers[questionId] || {};
  current.selected = key;
  studentAnswers[questionId] = current;

  playBeep(520, 'sine', 0.1);

  // Send answer to server immediately (auto-save)
  saveAnswerToServer(questionId, current.selected, current.isDoubtful);

  renderQuestion(currentQuestionIndex);
  renderPalette();
}

function toggleDoubt() {
  const q = questions[currentQuestionIndex];
  const current = studentAnswers[q.id] || { selected: null, isDoubtful: false };
  current.isDoubtful = !current.isDoubtful;
  studentAnswers[q.id] = current;

  saveAnswerToServer(q.id, current.selected, current.isDoubtful);
  renderQuestion(currentQuestionIndex);
  renderPalette();
}

async function saveAnswerToServer(questionId, selectedAnswer, isDoubtful) {
  try {
    await fetch('/api/exam/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: examSession.id,
        questionId,
        selectedAnswer,
        isDoubtful
      })
    });
  } catch (err) {
    console.error('Failed to auto-save answer:', err);
  }
}

// Mobile Palette Drawer Toggle
function togglePaletteDrawer() {
  const pane = document.getElementById('palettePane');
  const backdrop = document.getElementById('paletteBackdrop');
  if (pane) pane.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('active');
}

function closePaletteDrawer() {
  const pane = document.getElementById('palettePane');
  const backdrop = document.getElementById('paletteBackdrop');
  if (pane) pane.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

// Palette rendering
function renderPalette() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = '';

  let answeredCount = 0;

  questions.forEach((q, idx) => {
    const ans = studentAnswers[q.id];
    const isAnswered = ans && ans.selected;
    const isDoubt = ans && ans.isDoubtful;
    const isCurrent = (idx === currentQuestionIndex);

    if (isAnswered) answeredCount++;

    const item = document.createElement('div');
    let classes = 'palette-item';
    if (isCurrent) classes += ' current';
    if (isDoubt) {
      classes += ' doubtful';
    } else if (isAnswered) {
      classes += ' answered';
    }

    item.className = classes;
    item.onclick = () => {
      renderQuestion(idx);
      closePaletteDrawer(); // Auto-close drawer on mobile upon selection
    };

    item.innerHTML = `
      <span>${q.number}</span>
      ${isAnswered ? `<span class="chosen-key">${ans.selected}</span>` : ''}
    `;

    grid.appendChild(item);
  });

  document.getElementById('answeredBadgeCount').textContent = `${answeredCount} / ${questions.length}`;
}

function updatePaletteActive() {
  const items = document.querySelectorAll('.palette-item');
  items.forEach((item, idx) => {
    if (idx === currentQuestionIndex) {
      item.classList.add('current');
    } else {
      item.classList.remove('current');
    }
  });
}

// Font size scaling
function setFontSize(scale) {
  const card = document.getElementById('questionCard');
  card.classList.remove('font-scale-sm', 'font-scale-md', 'font-scale-lg');
  card.classList.add(`font-scale-${scale}`);
}

// ========================================================
// 5. TIMER COUNTDOWN
// ========================================================
function startTimer() {
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    remainingSeconds--;

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      remainingSeconds = 0;
      updateTimerDisplay();
      autoFinishTimeUp();
    } else {
      updateTimerDisplay();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  const sStr = String(seconds).padStart(2, '0');

  const timerText = document.getElementById('timerText');
  if (timerText) {
    timerText.textContent = `${hStr}:${mStr}:${sStr}`;
  }

  const timerBox = document.getElementById('examTimerBox');
  if (timerBox) {
    if (remainingSeconds < 300) {
      timerBox.classList.add('timer-warning');
    } else {
      timerBox.classList.remove('timer-warning');
    }
  }
}

function autoFinishTimeUp() {
  alert('Waktu ujian telah habis! Sistem akan mengumpulkan jawaban Anda secara otomatis.');
  finishExam();
}

// ========================================================
// 6. FINISH EXAM (SAFE IN-DOM MODAL, NO BLUR VIOLATIONS)
// ========================================================
function confirmFinishExam() {
  isConfirmingFinish = true;

  let unanswered = 0;
  let doubtful = 0;
  let answered = 0;

  questions.forEach(q => {
    const ans = studentAnswers[q.id];
    if (ans && ans.selected) {
      answered++;
      if (ans.isDoubtful) doubtful++;
    } else {
      unanswered++;
    }
  });

  const aElem = document.getElementById('modalAnsweredCount');
  const dElem = document.getElementById('modalDoubtCount');
  const uElem = document.getElementById('modalUnansweredCount');
  const note = document.getElementById('modalWarningNote');

  if (aElem) aElem.textContent = answered;
  if (dElem) dElem.textContent = doubtful;
  if (uElem) uElem.textContent = unanswered;

  if (note) {
    if (unanswered > 0 || doubtful > 0) {
      note.style.display = 'block';
      note.textContent = `⚠️ Perhatian: Ada ${unanswered} soal belum dijawab dan ${doubtful} soal masih bertanda ragu-ragu.`;
    } else {
      note.style.display = 'none';
    }
  }

  const modal = document.getElementById('confirmFinishModal');
  if (modal) {
    modal.classList.add('active');
  }
}

function cancelFinishExam() {
  const modal = document.getElementById('confirmFinishModal');
  if (modal) {
    modal.classList.remove('active');
  }

  // Keep isConfirmingFinish true for 500ms to safely absorb any window focus/blur event
  setTimeout(() => {
    isConfirmingFinish = false;
    window.focus();
  }, 500);
}

function submitFinishExam() {
  const btn = document.getElementById('confirmFinishSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Mengumpulkan...';
  }
  finishExam();
}

async function finishExam() {
  isExamFinished = true;
  if (timerInterval) clearInterval(timerInterval);
  if (proctoringInterval) clearInterval(proctoringInterval);

  try {
    const res = await fetch('/api/exam/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: examSession.id })
    });

    const data = await res.json();
    if (data.success) {
      window.location.href = `/student/finish?session_id=${examSession.id}`;
    } else {
      alert(data.message || 'Gagal menyelesaikan ujian');
    }
  } catch (err) {
    console.error('Error finish exam:', err);
    window.location.href = `/student/finish?session_id=${examSession.id}`;
  }
}

// ========================================================
// 7. REAL-TIME SOCKET.IO LISTENER
// ========================================================
function setupSocket(sessionId, studentId) {
  if (typeof io === 'undefined') return;
  const socket = io();

  // Proctor forces session finished
  socket.on('force_finished', (data) => {
    if (data.sessionId == sessionId) {
      alert('Ujian Anda telah diselesaikan oleh pengawas ujian.');
      window.location.href = `/student/finish?session_id=${sessionId}`;
    }
  });

  // Proctor unlocked locked session
  socket.on('session_unlocked', (data) => {
    if (data.sessionId == sessionId) {
      isLocked = false;
      document.getElementById('lockExamOverlay').classList.remove('active');
      alert('Sesi ujian Anda telah dibuka kembali oleh pengawas. Harap patuhi tata tertib!');
      startTimer();
      enterFullscreen();
    }
  });

  // Proctor requests instant camera snapshot
  socket.on('capture_instant_snapshot', (data) => {
    if (data.sessionId == sessionId || data.studentId == studentId) {
      console.log('📸 Pengawas meminta snapshot kamera sekarang...');
      captureAndSendSnapshot('Permintaan instan dari pengawas');
    }
  });

  // Proctor sends custom warning toast
  socket.on('proctor_warning', (data) => {
    if (data.sessionId == sessionId || data.studentId == studentId) {
      playViolationAlarm();
      alert(`PESAN PENGAWAS: ${data.message}`);
    }
  });

  // Send heartbeat
  setInterval(() => {
    socket.emit('student_heartbeat', { sessionId, studentId });
  }, 10000);
}

// Trigger initialization on load
window.addEventListener('DOMContentLoaded', () => {
  initExam();
});
