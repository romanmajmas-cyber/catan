'use strict';

// ==================== АККАУНТЫ ====================
const STORAGE_KEYS = { ACCOUNTS: 'catan_accounts_v1', SESSION: 'catan_session_v1' };

function getAccounts() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.ACCOUNTS) || '{}'); } catch(e) { return {}; } }
function saveAccounts(a) { localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(a)); }
function hashPassword(pwd) { let h = 0; for (let i = 0; i < pwd.length; i++) { h = ((h << 5) - h) + pwd.charCodeAt(i); h |= 0; } return 'h' + Math.abs(h).toString(36); }

function registerUser(u, p) {
  const a = getAccounts();
  if (!u || u.length < 3) return { ok: false, error: 'Логин от 3 до 20 символов' };
  if (!/^[a-zA-Z0-9_а-яА-Я]+$/.test(u)) return { ok: false, error: 'Логин: буквы, цифры, _' };
  if (a[u.toLowerCase()]) return { ok: false, error: 'Логин уже занят' };
  if (!p || p.length < 4) return { ok: false, error: 'Пароль минимум 4 символа' };
  a[u.toLowerCase()] = { username: u, passwordHash: hashPassword(p), createdAt: Date.now() };
  saveAccounts(a);
  return { ok: true };
}
function loginUser(u, p) {
  const a = getAccounts();
  const acc = a[u.toLowerCase()];
  if (!acc) return { ok: false, error: 'Пользователь не найден' };
  if (acc.passwordHash !== hashPassword(p)) return { ok: false, error: 'Неверный пароль' };
  return { ok: true, user: { username: acc.username } };
}
function saveSession(u) { localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({ username: u.username, at: Date.now() })); }
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION) || 'null');
    if (!s) return null;
    const a = getAccounts();
    if (!a[s.username.toLowerCase()]) return null;
    return { username: a[s.username.toLowerCase()].username };
  } catch(e) { return null; }
}
function clearSession() { localStorage.removeItem(STORAGE_KEYS.SESSION); }

// ==================== TOAST ====================
let toastTimer = null;
function showToast(msg, duration) {
  duration = duration || 2600;
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('visible'); }, duration);
}

// ==================== ЭКРАНЫ ====================
const SCREENS = ['menu', 'login', 'register', 'lobby', 'room'];
function showScreen(name) {
  for (let i = 0; i < SCREENS.length; i++) {
    const el = document.getElementById('screen-' + SCREENS[i]);
    if (el) el.classList.toggle('active', SCREENS[i] === name);
  }
  document.getElementById('gameContainer').classList.toggle('active', name === 'game');
}

// ==================== ЦВЕТА ====================
const PLAYER_COLORS = [
  { id: 'blue',   hex: 0x3498db, css: '#3498db', dark: 0x1f6690, roof: 0xa02020, name: 'Синий' },
  { id: 'red',    hex: 0xe74c3c, css: '#e74c3c', dark: 0xa02820, roof: 0x203060, name: 'Красный' },
  { id: 'green',  hex: 0x2ecc71, css: '#2ecc71', dark: 0x1a8a4a, roof: 0xd4a020, name: 'Зелёный' },
  { id: 'orange', hex: 0xf39c12, css: '#f39c12', dark: 0xa06a10, roof: 0x502090, name: 'Оранжевый' }
];

let currentUser = null;
let myColorIdx = 0;

// ==================== UI АВТОРИЗАЦИИ ====================
function updateMenuUserUI() {
  const badge = document.getElementById('menuUserBadge');
  const showLoginReg = document.getElementById('btnShowLogin');
  const showRegister = document.getElementById('btnShowRegister');
  const showLogout = document.getElementById('btnLogout');
  const showCreate = document.getElementById('btnCreateRoom');
  const showJoin = document.getElementById('btnShowJoin');
  const showSwitch = document.getElementById('btnSwitchAccount');
  const joinForm = document.getElementById('joinForm');

  if (currentUser) {
    badge.style.display = 'flex';
    document.getElementById('menuUserName').textContent = currentUser.username;
    document.getElementById('menuAvatar').textContent = currentUser.username[0].toUpperCase();
    showLoginReg.style.display = 'none';
    showRegister.style.display = 'none';
    showLogout.style.display = 'block';
    showCreate.style.display = 'block';
    showJoin.style.display = 'block';
    showSwitch.style.display = 'block';
  } else {
    badge.style.display = 'none';
    showLoginReg.style.display = 'block';
    showRegister.style.display = 'block';
    showLogout.style.display = 'none';
    showCreate.style.display = 'none';
    showJoin.style.display = 'none';
    showSwitch.style.display = 'none';
    joinForm.style.display = 'none';
  }
}

document.getElementById('btnShowLogin').onclick = function() {
  document.getElementById('loginError').classList.remove('visible');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  showScreen('login');
  setTimeout(function() { document.getElementById('loginUsername').focus(); }, 100);
};
document.getElementById('btnShowRegister').onclick = function() {
  document.getElementById('registerError').classList.remove('visible');
  document.getElementById('registerSuccess').classList.remove('visible');
  document.getElementById('regUsername').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regPassword2').value = '';
  showScreen('register');
  setTimeout(function() { document.getElementById('regUsername').focus(); }, 100);
};
document.getElementById('btnBackFromLogin').onclick = function() { showScreen('menu'); };
document.getElementById('btnBackFromRegister').onclick = function() { showScreen('menu'); };
document.getElementById('btnLogout').onclick = function() { clearSession(); currentUser = null; updateMenuUserUI(); showToast('Вы вышли'); };
document.getElementById('btnSwitchAccount').onclick = function() {
  clearSession(); currentUser = null; updateMenuUserUI();
  showScreen('login');
  setTimeout(function() { document.getElementById('loginUsername').focus(); }, 100);
};

document.getElementById('btnDoLogin').onclick = function() {
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'Введите логин и пароль'; err.classList.add('visible'); return; }
  const r = loginUser(u, p);
  if (!r.ok) { err.textContent = r.error; err.classList.add('visible'); return; }
  currentUser = r.user;
  saveSession(currentUser);
  err.classList.remove('visible');
  showToast('Добро пожаловать, ' + currentUser.username + '!');
  updateMenuUserUI();
  showScreen('menu');
};

document.getElementById('btnDoRegister').onclick = function() {
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const p2 = document.getElementById('regPassword2').value;
  const err = document.getElementById('registerError');
  const suc = document.getElementById('registerSuccess');
  err.classList.remove('visible'); suc.classList.remove('visible');
  if (p !== p2) { err.textContent = 'Пароли не совпадают'; err.classList.add('visible'); return; }
  const r = registerUser(u, p);
  if (!r.ok) { err.textContent = r.error; err.classList.add('visible'); return; }
  suc.textContent = 'Аккаунт создан! Входим...'; suc.classList.add('visible');
  setTimeout(function() {
    const lr = loginUser(u, p);
    if (lr.ok) { currentUser = lr.user; saveSession(currentUser); updateMenuUserUI(); showToast('Добро пожаловать!'); showScreen('menu'); }
  }, 500);
};

['loginUsername', 'loginPassword'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('btnDoLogin').click(); });
});
['regUsername', 'regPassword', 'regPassword2'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('btnDoRegister').click(); });
});

// ==================== ЛОББИ ====================
function renderColorPicker() {
  const picker = document.getElementById('lobbyColorPicker');
  picker.innerHTML = '';
  PLAYER_COLORS.forEach(function(color, i) {
    const div = document.createElement('div');
    div.className = 'color-option' + (i === myColorIdx ? ' selected' : '');
    div.style.background = color.css;
    div.style.color = color.css;
    div.title = color.name;
    div.onclick = function() { myColorIdx = i; renderColorPicker(); };
    picker.appendChild(div);
  });
}

document.getElementById('btnCreateRoom').onclick = function() {
  if (!currentUser) return;
  myColorIdx = 0;
  renderColorPicker();
  showScreen('lobby');
};
document.getElementById('btnShowJoin').onclick = function() {
  if (!currentUser) return;
  const form = document.getElementById('joinForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('joinCodeInput').value = '';
    setTimeout(function() { document.getElementById('joinCodeInput').focus(); }, 100);
  }
};
document.getElementById('btnCancelJoin').onclick = function() { document.getElementById('joinForm').style.display = 'none'; };
document.getElementById('btnJoinRoom').onclick = function() {
  const code = document.getElementById('joinCodeInput').value.toUpperCase().trim();
  if (code.length !== 4) { showToast('Код из 4 символов'); return; }
  attemptJoinRoom(code);
};
document.getElementById('joinCodeInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('btnJoinRoom').click(); });
document.getElementById('btnLobbyCreate').onclick = function() { createRoom(); };
document.getElementById('btnLobbyJoin').onclick = function() {
  const f = document.getElementById('lobbyJoinForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
  if (f.style.display === 'block') setTimeout(function() { document.getElementById('lobbyJoinCode').focus(); }, 100);
};
document.getElementById('btnLobbyJoinCancel').onclick = function() { document.getElementById('lobbyJoinForm').style.display = 'none'; };
document.getElementById('btnLobbyJoinGo').onclick = function() {
  const code = document.getElementById('lobbyJoinCode').value.toUpperCase().trim();
  if (code.length !== 4) { showToast('Код из 4 символов'); return; }
  attemptJoinRoom(code);
};
document.getElementById('lobbyJoinCode').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('btnLobbyJoinGo').click(); });
document.getElementById('btnBackToMenu').onclick = function() { showScreen('menu'); };

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
(function() {
  const saved = loadSession();
  if (saved) { currentUser = saved; updateMenuUserUI(); }
  renderColorPicker();
  showScreen('menu');
})();

console.log('[auth] OK');