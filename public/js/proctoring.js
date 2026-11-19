/**
 * CBT Al-Fatih - Realtime Proctoring & Cheating Detection Script
 */

let currentScheduleId = null;
let currentSchedule = null;
let activeSessions = [];
let violationsLog = [];
let socket = null;

// Audio notification
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playAlertChime() {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {}
}

async function initProctoring() {
  const urlParams = new URLSearchParams(window.location.search);
  currentScheduleId = urlParams.get('schedule_id');

  // Load available schedules dropdown
  await loadSchedulesDropdown();

  if (currentScheduleId) {
    document.getElementById('scheduleSelector').value = currentScheduleId;
    await loadMonitoringData(currentScheduleId);
  }

  // Connect Socket.io
  if (typeof io !== 'undefined') {
    socket = io();

    socket.on('cheating_alert', (data) => {
      if (!currentScheduleId || data.scheduleId == currentScheduleId) {
        handleRealtimeViolation(data);
      }
    });

    socket.on('new_snapshot', (data) => {
      if (!currentScheduleId || data.scheduleId == currentScheduleId) {
        handleRealtimeSnapshot(data);
      }
    });

    socket.on('student_progress', (data) => {
      handleRealtimeProgress(data);
    });

    socket.on('student_started', (data) => {
      if (!currentScheduleId || data.scheduleId == currentScheduleId) {
        loadMonitoringData(currentScheduleId);
      }
    });

    socket.on('student_finished', (data) => {
      if (currentScheduleId) {
        loadMonitoringData(currentScheduleId);
      }
    });
  }
}

async function loadSchedulesDropdown() {
  try {
    const res = await fetch('/api/admin/schedules');
    const data = await res.json();
    const select = document.getElementById('scheduleSelector');
    select.innerHTML = '';

    if (data.data.length === 0) {
      select.innerHTML = '<option value="">Belum ada jadwal ujian</option>';
      return;
    }

    data.data.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.title} (${s.subject}) - Token: ${s.token || '-'}`;
      select.appendChild(opt);
    });

    if (!currentScheduleId && data.data.length > 0) {
      currentScheduleId = data.data[0].id;
      select.value = currentScheduleId;
    }
  } catch (err) {
    console.error('Error load schedules dropdown:', err);
  }
}

async function onScheduleChange(scheduleId) {
  currentScheduleId = scheduleId;
  const url = new URL(window.location);
  url.searchParams.set('schedule_id', scheduleId);
  window.history.pushState({}, '', url);
  await loadMonitoringData(scheduleId);
}

async function loadMonitoringData(scheduleId) {
  if (!scheduleId) return;

  try {
    const res = await fetch(`/api/admin/monitoring/${scheduleId}`);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message, 'danger');
      return;
    }

    currentSchedule = data.schedule;
    activeSessions = data.sessions;
    violationsLog = data.violations;

    document.getElementById('monitorExamTitle').textContent = currentSchedule.title;
    document.getElementById('monitorSubject').textContent = `Mata Pelajaran: ${currentSchedule.subject} • Total Soal: ${currentSchedule.total_questions}`;

    renderSessionCards();
    renderViolationsTable();
    updateSummaryBadges();

  } catch (err) {
    console.error('Error load monitoring data:', err);
  }
}

function updateSummaryBadges() {
  const total = activeSessions.length;
  const inProgress = activeSessions.filter(s => s.status === 'IN_PROGRESS').length;
  const finished = activeSessions.filter(s => s.status === 'FINISHED').length;
  const locked = activeSessions.filter(s => s.status === 'LOCKED').length;
  const withViolations = activeSessions.filter(s => s.violation_count > 0).length;

  document.getElementById('totalActiveCount').textContent = total;
  document.getElementById('inProgressCount').textContent = inProgress;
  document.getElementById('finishedCount').textContent = finished;
  document.getElementById('lockedCount').textContent = locked;
  document.getElementById('violationStudentsCount').textContent = withViolations;
}

function renderSessionCards() {
  const container = document.getElementById('sessionsContainer');
  container.innerHTML = '';

  if (activeSessions.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted); background: white; border-radius: 12px; border: 1px solid var(--border);">
        <p style="font-size: 16px; font-weight: 600;">Belum ada peserta yang memulai ujian pada jadwal ini.</p>
        <p style="font-size: 13px; margin-top: 6px;">Peserta yang login dan menekan Mulai Ujian akan muncul di sini secara langsung.</p>
      </div>
    `;
    return;
  }

  activeSessions.forEach(ses => {
    const card = document.createElement('div');
    card.id = `session-card-${ses.id}`;
    card.className = 'session-monitor-card';

    // Status badge & color
    let statusBadge = '<span class="badge badge-info">Sedang Mengerjakan</span>';
    if (ses.status === 'FINISHED') statusBadge = '<span class="badge badge-success">Selesai</span>';
    if (ses.status === 'LOCKED') statusBadge = '<span class="badge badge-danger">🔒 TERKUNCI</span>';

    // Violation badge
    let violBadge = `<span class="badge badge-success">0 Pelanggaran</span>`;
    if (ses.violation_count > 0 && ses.violation_count < 3) {
      violBadge = `<span class="badge badge-warning">${ses.violation_count} Pelanggaran</span>`;
    } else if (ses.violation_count >= 3) {
      violBadge = `<span class="badge badge-danger">⚠️ ${ses.violation_count} Pelanggaran</span>`;
    }

    const progressPct = currentSchedule.total_questions > 0 ? Math.round((ses.answered_count / currentSchedule.total_questions) * 100) : 0;

    const photoSrc = ses.latest_photo || '/public/img/avatar-placeholder.png';

    card.innerHTML = `
      <div class="session-card-top">
        <div class="student-avatar-box">
          <img id="avatar-img-${ses.student_id}" src="${photoSrc}" alt="Cam" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(ses.student_name)}&background=2563eb&color=fff'">
          <span class="cam-badge" title="Jumlah Foto">${ses.total_snapshots} 📷</span>
        </div>
        <div class="student-details">
          <div class="student-name-row">
            <span class="name">${ses.student_name}</span>
            ${statusBadge}
          </div>
          <div class="student-meta">${ses.nis} • Kelas: ${ses.class_name} • ${ses.room_name || 'Lab CBT'}</div>
          <div style="margin-top: 6px;">${violBadge}</div>
        </div>
      </div>

      <div class="progress-bar-wrap">
        <div class="progress-info-row">
          <span>Progres: <strong id="progress-text-${ses.id}">${ses.answered_count} / ${currentSchedule.total_questions}</strong> soal</span>
          <span>${progressPct}%</span>
        </div>
        <div class="progress-bar-track">
          <div id="progress-bar-${ses.id}" class="progress-bar-fill" style="width: ${progressPct}%"></div>
        </div>
      </div>

      <div class="session-card-actions">
        <button class="btn btn-secondary btn-sm" onclick="viewStudentSnapshots(${ses.schedule_id}, ${ses.student_id})">
          📷 Lihat Foto (${ses.total_snapshots})
        </button>
        <button class="btn btn-secondary btn-sm" onclick="requestSnapshot(${ses.id}, ${ses.student_id})">
          ⚡ Ambil Foto
        </button>
        <button class="btn btn-secondary btn-sm" onclick="openSendWarningModal(${ses.id}, ${ses.student_id}, '${ses.student_name}')">
          📢 Peringatan
        </button>
        ${ses.status === 'LOCKED' ? `
          <button class="btn btn-success btn-sm" onclick="unlockSession(${ses.id})">
            🔓 Buka Kunci
          </button>
        ` : ses.status === 'IN_PROGRESS' ? `
          <button class="btn btn-danger btn-sm" onclick="forceFinishSession(${ses.id})">
            ⏹ Paksa Selesai
          </button>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

function renderViolationsTable() {
  const tbody = document.getElementById('violationsTableBody');
  tbody.innerHTML = '';

  if (violationsLog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Belum ada pelanggaran kecurangan yang terdeteksi.</td></tr>';
    return;
  }

  violationsLog.forEach(v => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-warning';
    let icon = '⚠️';
    if (v.violation_type === 'TAB_SWITCH') {
      badgeClass = 'badge-warning';
      icon = '🗂 Pindah Tab';
    } else if (v.violation_type === 'WINDOW_BLUR') {
      badgeClass = 'badge-warning';
      icon = '💻 Pindah Aplikasi';
    } else if (v.violation_type === 'COPY_PASTE') {
      badgeClass = 'badge-danger';
      icon = '📋 Salin Soal';
    } else if (v.violation_type === 'FULLSCREEN_EXIT') {
      badgeClass = 'badge-danger';
      icon = '🖥 Keluar Fullscreen';
    } else if (v.violation_type === 'CAMERA_BLOCKED') {
      badgeClass = 'badge-danger';
      icon = '📷 Kamera Ditutup';
    }

    const timeStr = new Date(v.timestamp).toLocaleTimeString('id-ID');

    tr.innerHTML = `
      <td><strong>${timeStr}</strong></td>
      <td><strong>${v.student_name}</strong></td>
      <td><span class="badge badge-gray">${v.class_name}</span></td>
      <td><span class="badge ${badgeClass}">${icon}</span></td>
      <td>${v.description}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Real-time Event Handlers
function handleRealtimeViolation(data) {
  playAlertChime();
  showToast(`Kecurangan terdeteksi! Siswa: ${data.studentName} (${data.violationType})`, 'danger');

  // Prepend to violations log
  violationsLog.unshift({
    timestamp: data.timestamp,
    student_name: data.studentName,
    class_name: data.className,
    violation_type: data.violationType,
    description: data.description
  });
  renderViolationsTable();

  // Update session card
  const s = activeSessions.find(x => x.id === data.sessionId);
  if (s) {
    s.violation_count = data.totalViolations;
    if (data.isLocked) s.status = 'LOCKED';
    renderSessionCards();
    updateSummaryBadges();
  } else {
    loadMonitoringData(currentScheduleId);
  }
}

function handleRealtimeSnapshot(data) {
  showToast(`Foto baru dari: ${data.studentName} (${data.fileSizeKb} KB)`, 'info');

  const avatar = document.getElementById(`avatar-img-${data.studentId}`);
  if (avatar) {
    avatar.src = `${data.photoPath}?t=${Date.now()}`;
  }

  // Update session record
  const s = activeSessions.find(x => x.id === data.sessionId);
  if (s) {
    s.total_snapshots = (s.total_snapshots || 0) + 1;
    s.latest_photo = data.photoPath;
  }
}

function handleRealtimeProgress(data) {
  const s = activeSessions.find(x => x.id === data.sessionId);
  if (s) {
    s.answered_count = data.answeredCount;
    const progressText = document.getElementById(`progress-text-${s.id}`);
    const progressBar = document.getElementById(`progress-bar-${s.id}`);
    if (progressText && currentSchedule) {
      progressText.textContent = `${s.answered_count} / ${currentSchedule.total_questions}`;
      const pct = Math.round((s.answered_count / currentSchedule.total_questions) * 100);
      progressBar.style.width = `${pct}%`;
    }
  }
}

// Remote Control Actions
async function unlockSession(sessionId) {
  if (confirm('Buka kembali kunci ujian siswa ini?')) {
    try {
      const res = await fetch('/api/admin/monitoring/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        loadMonitoringData(currentScheduleId);
      }
    } catch (e) {
      showToast('Gagal membuka kunci: ' + e.message, 'danger');
    }
  }
}

async function forceFinishSession(sessionId) {
  if (confirm('Apakah Anda yakin ingin mematikan/menyelesaikan ujian siswa ini secara paksa? Jawaban akan langsung dikumpulkan dan dihitung nilainya.')) {
    try {
      const res = await fetch('/api/admin/monitoring/force-finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        loadMonitoringData(currentScheduleId);
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'danger');
    }
  }
}

async function requestSnapshot(sessionId, studentId) {
  try {
    const res = await fetch('/api/admin/monitoring/request-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, studentId })
    });
    const data = await res.json();
    showToast(data.message, 'info');
  } catch (e) {
    showToast('Gagal meminta snapshot', 'danger');
  }
}

function openSendWarningModal(sessionId, studentId, studentName) {
  const msg = prompt(`Kirim pesan peringatan langsung ke layar ${studentName}:`, 'Peringatan: Harap tetap fokus pada soal ujian dan jangan berpindah layar!');
  if (msg && msg.trim()) {
    fetch('/api/admin/monitoring/send-warning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, studentId, message: msg.trim() })
    })
    .then(r => r.json())
    .then(d => showToast('Peringatan telah dikirim.', 'success'))
    .catch(e => showToast('Gagal mengirim peringatan', 'danger'));
  }
}

// Student Snapshot Gallery Modal
async function viewStudentSnapshots(scheduleId, studentId) {
  try {
    const res = await fetch(`/api/admin/monitoring/snapshots/${scheduleId}/${studentId}`);
    const data = await res.json();

    if (!data.success) {
      showToast('Gagal memuat foto siswa', 'danger');
      return;
    }

    const modal = document.getElementById('snapshotsModal');
    document.getElementById('snapshotModalTitle').textContent = `Galeri Foto Pengawasan: ${data.student.name} (${data.student.nis} - ${data.student.class_name})`;

    const gallery = document.getElementById('snapshotGalleryGrid');
    gallery.innerHTML = '';

    if (data.snapshots.length === 0) {
      gallery.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px;">Belum ada foto yang tercapture untuk siswa ini.</p>';
    } else {
      data.snapshots.forEach(snap => {
        const item = document.createElement('div');
        item.className = 'gallery-snapshot-card';
        const dateStr = new Date(snap.captured_at).toLocaleString('id-ID');

        item.innerHTML = `
          <a href="${snap.photo_path}" target="_blank">
            <img src="${snap.photo_path}" alt="Snap" style="width: 100%; height: 140px; object-fit: cover; border-radius: 8px;">
          </a>
          <div style="font-size: 11px; margin-top: 6px; color: var(--text-muted); display: flex; justify-content: space-between;">
            <span>${dateStr}</span>
            <span>${snap.file_size_kb} KB</span>
          </div>
          <div style="font-size: 11px; color: #1e40af; font-weight: 600;">${snap.note || 'Pengawasan Otomatis'}</div>
        `;
        gallery.appendChild(item);
      });
    }

    modal.classList.add('active');
  } catch (err) {
    console.error('Error view snapshots:', err);
  }
}

function closeSnapshotsModal() {
  document.getElementById('snapshotsModal').classList.remove('active');
}

window.addEventListener('DOMContentLoaded', () => {
  initProctoring();
});
