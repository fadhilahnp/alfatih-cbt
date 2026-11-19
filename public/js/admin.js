/**
 * CBT Al-Fatih - Admin Common Utilities
 */

// Show toast alert
function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'danger' ? '⚠️' : type === 'warning' ? '🔔' : '✅'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Global Logout
async function handleLogout() {
  if (confirm('Apakah Anda yakin ingin keluar dari dashboard admin?')) {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/admin/login';
    } catch (e) {
      window.location.href = '/admin/login';
    }
  }
}

// Check if user is authenticated admin
async function checkAdminAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.success || data.user.type !== 'admin') {
      window.location.href = '/admin/login';
    } else {
      const nameElem = document.getElementById('adminNameDisplay');
      if (nameElem) nameElem.textContent = data.user.name;
    }
  } catch (e) {
    window.location.href = '/admin/login';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // Only protect authenticated admin pages, do NOT redirect on login or print pages
  const path = window.location.pathname;
  if (path.startsWith('/admin') && !path.includes('/login') && !path.includes('/print-cards')) {
    checkAdminAuth();
  }
});
