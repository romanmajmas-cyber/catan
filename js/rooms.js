'use strict';

// ==================== BROADCAST ====================
let channel;
try { channel = new BroadcastChannel('catan_multiplayer_v3'); }
catch(e) { channel = { postMessage: function(){}, onmessage: null }; }
const TAB_ID = 'tab_' + Math.random().toString(36).slice(2, 10);
let currentRoom = null;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function broadcastMessage(type, data) {
  data = data || {};
  channel.postMessage({ type: type, data: data, senderTabId: TAB_ID, sender: currentUser ? currentUser.username : '', ts: Date.now() });
}

const pendingRoomLookups = new Map();

channel.onmessage = function(event) {
  const msg = event.data || {};
  const type = msg.type, data = msg.data || {}, senderTabId = msg.senderTabId;
  if (senderTabId === TAB_ID) return;

  if (type === 'room_probe') {
    if (currentRoom && currentRoom.code === data.code) {
      broadcastMessage('room_probe_response', { code: data.code, exists: true, started: currentRoom.started, playersCount: currentRoom.players.length, toTab: senderTabId });
    }
    return;
  }
  if (type === 'room_probe_response') {
    if (data.toTab === TAB_ID && pendingRoomLookups.has(data.code)) {
      const cb = pendingRoomLookups.get(data.code); pendingRoomLookups.delete(data.code); cb(data);
    }
    return;
  }
  if (type === 'room_join_request') {
    if (currentRoom && currentRoom.code === data.code && !currentRoom.started) {
      let taken = false;
      for (let i = 0; i < currentRoom.players.length; i++) if (currentRoom.players[i].colorIdx === data.colorIdx) taken = true;
      if (taken) { broadcastMessage('room_join_rejected', { toTab: senderTabId, reason: 'Этот цвет занят' }); return; }
      if (currentRoom.players.length >= 4) { broadcastMessage('room_join_rejected', { toTab: senderTabId, reason: 'Комната заполнена' }); return; }
      let dup = false;
      for (let i = 0; i < currentRoom.players.length; i++) if (currentRoom.players[i].username === data.username) dup = true;
      if (dup) { broadcastMessage('room_join_rejected', { toTab: senderTabId, reason: 'Имя занято' }); return; }
      currentRoom.players.push({ username: data.username, colorIdx: data.colorIdx, tabId: senderTabId, isHost: false });
      broadcastMessage('room_join_accepted', { toTab: senderTabId, room: currentRoom });
      broadcastMessage('room_update', { room: currentRoom });
      updateRoomUI();
      showToast(data.username + ' присоединился');
    } else if (currentRoom && currentRoom.code === data.code && currentRoom.started) {
      broadcastMessage('room_join_rejected', { toTab: senderTabId, reason: 'Игра уже началась' });
    }
    return;
  }
  if (type === 'room_join_accepted') {
    if (data.toTab === TAB_ID) { currentRoom = data.room; showScreen('room'); updateRoomUI(); showToast('Вы вошли в комнату'); }
    return;
  }
  if (type === 'room_join_rejected') {
    if (data.toTab === TAB_ID) { showToast('❌ ' + (data.reason || 'Ошибка'), 3500); currentRoom = null; showScreen('lobby'); }
    return;
  }
  if (type === 'room_update') {
    if (currentRoom && currentRoom.code === data.room.code) { currentRoom = data.room; updateRoomUI(); }
    return;
  }
  if (type === 'room_leave') {
    if (currentRoom && currentRoom.code === data.code) {
      let idx = -1;
      for (let i = 0; i < currentRoom.players.length; i++) if (currentRoom.players[i].tabId === senderTabId) idx = i;
      if (idx >= 0) {
        const left = currentRoom.players.splice(idx, 1)[0];
        if (left.isHost && currentRoom.players.length > 0) {
          currentRoom.players[0].isHost = true;
          currentRoom.hostTabId = currentRoom.players[0].tabId;
          currentRoom.host = currentRoom.players[0].username;
        }
        updateRoomUI();
        showToast(left.username + ' покинул комнату');
      }
    }
    return;
  }
  if (type === 'game_start') {
    if (currentRoom && currentRoom.code === data.code) {
      currentRoom = data.room;
      if (typeof window.startGameFromLobby === 'function') window.startGameFromLobby();
      else {
        let w = 0;
        const chk = setInterval(function() {
          w += 200;
          if (typeof window.startGameFromLobby === 'function') { clearInterval(chk); window.startGameFromLobby(); }
          else if (w > 5000) { clearInterval(chk); showToast('❌ Ошибка запуска', 3000); }
        }, 200);
      }
    }
    return;
  }
  if (type === 'game_action') {
    if (currentRoom && currentRoom.started && currentRoom.code === data.code) {
      if (typeof window.applyRemoteAction === 'function') window.applyRemoteAction(data.action);
    }
    return;
  }
};

function createRoom() {
  if (!currentUser) return;
  const code = generateRoomCode();
  currentRoom = {
    code: code,
    host: currentUser.username,
    hostTabId: TAB_ID,
    players: [{ username: currentUser.username, colorIdx: myColorIdx, tabId: TAB_ID, isHost: true }],
    started: false,
    seed: null
  };
  showScreen('room');
  updateRoomUI();
  showToast('Комната: ' + code);
}

function attemptJoinRoom(code) {
  if (!currentUser) return;
  let responded = false;
  const cb = function(data) {
    responded = true;
    if (data.exists && data.started) { showToast('❌ Игра уже началась'); return; }
    if (!data.exists) { showToast('❌ Комната не найдена'); return; }
    broadcastMessage('room_join_request', { code: code, username: currentUser.username, colorIdx: myColorIdx });
  };
  pendingRoomLookups.set(code, cb);
  broadcastMessage('room_probe', { code: code });
  setTimeout(function() {
    if (!responded && pendingRoomLookups.has(code)) {
      pendingRoomLookups.delete(code);
      showToast('❌ Комната не найдена');
    }
  }, 1000);
}

function updateRoomUI() {
  if (!currentRoom) return;
  document.getElementById('roomCodeDisplay').textContent = currentRoom.code;
  const list = document.getElementById('roomPlayerList');
  list.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = currentRoom.players[i];
    const div = document.createElement('div');
    if (p) {
      const color = PLAYER_COLORS[p.colorIdx];
      div.className = 'player-slot filled' + (p.isHost ? ' host' : '');
      div.innerHTML = '<div class="color-dot" style="background:' + color.css + ';color:' + color.css + '"></div>' +
        '<div class="info"><div class="name">' + p.username + (p.tabId === TAB_ID ? ' <span style="color:#90ff90;font-size:11px;">(вы)</span>' : '') + '</div>' +
        '<div class="tag">' + color.name + '</div></div>';
    } else {
      div.className = 'player-slot empty';
      div.innerHTML = '<div class="color-dot" style="background:#2a3a4a"></div><div class="info"><div class="name" style="color:#4a7a9a">Свободно</div></div>';
    }
    list.appendChild(div);
  }
  const isHost = currentRoom.hostTabId === TAB_ID;
  const canStart = currentRoom.players.length >= 1;
  const startBtn = document.getElementById('btnStartGame');
  if (isHost) {
    startBtn.style.display = 'block';
    startBtn.disabled = !canStart;
    startBtn.textContent = '🚀 Начать (' + currentRoom.players.length + ')';
  } else {
    startBtn.style.display = 'none';
  }
  const status = document.getElementById('roomStatus');
  if (isHost) {
    status.className = 'status-tag';
    status.textContent = currentRoom.players.length === 1 ? '💡 Можно начать одному' : '✅ Готово к запуску';
  } else {
    status.className = 'status-tag waiting';
    status.textContent = 'Ожидание хоста...';
  }
}

document.getElementById('btnStartGame').onclick = function() {
  if (!currentRoom || currentRoom.hostTabId !== TAB_ID) return;
  if (currentRoom.players.length < 1) return;

  const launch = function() {
    currentRoom.started = true;
    currentRoom.seed = Math.floor(Math.random() * 1e9);
    broadcastMessage('game_start', { code: currentRoom.code, room: currentRoom });
    window.startGameFromLobby();
  };

  if (typeof window.startGameFromLobby === 'function') { launch(); return; }
  let w = 0;
  const chk = setInterval(function() {
    w += 200;
    if (typeof window.startGameFromLobby === 'function') { clearInterval(chk); launch(); }
    else if (w > 10000) { clearInterval(chk); document.getElementById('fatalError').classList.add('active'); }
  }, 200);
};

document.getElementById('btnLeaveRoom').onclick = function() {
  if (currentRoom) { broadcastMessage('room_leave', { code: currentRoom.code }); currentRoom = null; }
  showScreen('menu');
};

window.addEventListener('beforeunload', function() { if (currentRoom) broadcastMessage('room_leave', { code: currentRoom.code }); });

console.log('[rooms] OK');