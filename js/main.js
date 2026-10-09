// ==================== ИНИЦИАЛИЗАЦИЯ ====================
// Three.js уже загружен синхронно в <head>, можно стартовать сразу
function initGame() {
  console.log('[main] Инициализация игры...');

  initThreeScene();
  window.startGameFromLobby = startGameFromLobby;
  setupCameraButtons();
  setupPointerEvents();
  window.addEventListener('resize', onResize);
  requestAnimationFrame(animate);
  document.getElementById('loadingOverlay').classList.add('hidden');
  console.log('[main] Игра готова');
}

// Запускаем сразу — three.js точно уже есть
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}

// ==================== СТАРТ ИГРЫ ====================
function startGameFromLobby() {
  if (!currentRoom) { showToast('Нет комнаты'); return; }

  players = currentRoom.players.map(function(rp) {
    return {
      name: rp.username, colorIdx: rp.colorIdx, tabId: rp.tabId,
      wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0,
      settlements: [], cities: [], roads: [],
      devCards: [], newDevCards: [], vpCards: 0,
      knightsPlayed: 0, hasLongestRoad: false, hasLargestArmy: false,
      ports: {}
    };
  });

  myPlayerIndex = players.findIndex(function(p) { return p.tabId === TAB_ID; });
  if (myPlayerIndex < 0) myPlayerIndex = 0;
  rng = mulberry32(currentRoom.seed);

  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('gameContainer').classList.add('active');

  setTimeout(function() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }, 100);

  gameActive = true;
  buildBoardGame();
  addLog('🎮 Игра началась! Игроков: ' + players.length);
  addLog('Вы — ' + players[myPlayerIndex].name);
  showToast(isMyTurn() ? '▶ Ваш ход!' : ('Ход: ' + players[currentPlayer].name), 2500);
  showMarkers();
  updateUI();
}

// ==================== ПОСТРОЕНИЕ ПОЛЯ ====================
function buildBoardGame() {
  clearGroup(boardGroup); clearGroup(pieceGroup); clearGroup(markerGroup);
  clearGroup(deckGroup); clearGroup(robberGroup);
  destroyAllHexInstances();

  turnState = { hasRolled: false, buildMode: null, robberMoveMode: null, playedDevCard: false, roadBuildingLeft: 0 };
  lastPlacedSettlement = null;
  gamePhase = 'setup_settlement';
  currentPlayer = 0;
  robberMesh = null; robberHexIdx = -1;
  allPorts = [];
  initDevDeck();
  discardDeck = [];
  document.getElementById('log').innerHTML = '';
  document.getElementById('die1').textContent = '?';
  document.getElementById('die2').textContent = '?';

  hexList = generateTerrain();
  const nbrs = computeNeighbors(hexList);
  placeNumbers(hexList, nbrs);
  const graph = computeGraph(hexList);
  vertices = graph.vertices;
  edges = graph.edges;

  const hexCtx = { boardGroup: boardGroup, M: M, MAT: MAT, rng: rng };

  hexList.forEach(function(h) {
    const info = TERRAIN[h.terrain];
    const base = new THREE.Mesh(makeHexGeo(HEX_R, BASE_H), MAT.darkBase);
    base.position.set(h.x, BASE_Y, h.z);
    base.receiveShadow = true; base.castShadow = true;
    boardGroup.add(base);
    const topMat = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.9, metalness: 0.05, flatShading: true });
    const top = new THREE.Mesh(makeHexGeo(HEX_R * 0.94, TOP_H), topMat);
    top.position.set(h.x, TOP_Y, h.z);
    top.receiveShadow = true; top.castShadow = true;
    boardGroup.add(top);
    registerHexInstance(h.terrain, h.x, TERRAIN_Y, h.z, hexCtx);
  });

  // Номера на жетонах
  hexList.forEach(function(h) {
    if (h.number === null) return;
    const isHot = (h.number === 6 || h.number === 8);
    const discR = 0.22;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(discR, discR, 0.04, 32),
      new THREE.MeshStandardMaterial({ color: isHot ? 0xe0b0b0 : 0xd4c8a8, roughness: 0.6, metalness: 0.1 }));
    disc.position.set(h.x, TERRAIN_Y + 0.022, h.z);
    boardGroup.add(disc);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    const dots = { 2:1,12:1,3:2,11:2,4:3,10:3,5:4,9:4,6:5,8:5 }[h.number] || 0;
    const col = isHot ? '#a81818' : '#1a3a5c';
    ctx.fillStyle = col;
    for (let i = 0; i < dots; i++) { ctx.beginPath(); ctx.arc(128 + (i - (dots-1)/2) * 18, 35, 6, 0, Math.PI*2); ctx.fill(); }
    ctx.font = 'bold 150px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(h.number, 128, 165);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    tm.rotation.x = -Math.PI/2;
    tm.position.set(h.x, TERRAIN_Y + 0.045, h.z);
    boardGroup.add(tm);
  });

  // Разбойник
  const desertIdx = hexList.findIndex(function(h) { return h.terrain === 'desert'; });
  if (desertIdx >= 0) placeRobber(desertIdx);

  // Порты
  const exposed = findExposedEdges(hexList);
  const portEdges = selectPortEdges(exposed);
  const portTypes = sShuffle([
    { ratio: '2:1', resource: 'wood' }, { ratio: '2:1', resource: 'brick' },
    { ratio: '2:1', resource: 'sheep' }, { ratio: '2:1', resource: 'wheat' },
    { ratio: '2:1', resource: 'ore' },
    { ratio: '3:1', resource: null }, { ratio: '3:1', resource: null },
    { ratio: '3:1', resource: null }, { ratio: '3:1', resource: null }
  ]);
  portEdges.forEach(function(edge, i) {
    if (i >= portTypes.length) return;
    const port = createPort(edge, portTypes[i].ratio, portTypes[i].resource);
    boardGroup.add(port.group);
    allPorts.push({ ratio: portTypes[i].ratio, resource: portTypes[i].resource, vertexIdxs: port.vertexIdxs });
  });

  buildResourceDecks();
}

// ==================== ВИДЫ КАМЕРЫ ====================
const views = {
  iso:   { pos: [8, 9, 10], target: [0, 0.4, 0] },
  top:   { pos: [0.01, 16, 0.01], target: [0, 0.4, 0] },
  close: { pos: [3.5, 4, 4.5], target: [0, 0.4, 0] },
  decks: { pos: [0, 5.5, 11], target: [0, 0.6, 5.5] }
};
function setView(name) {
  const v = views[name];
  if (!v) return;
  camAnim = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]),
    toTarget: new THREE.Vector3(v.target[0], v.target[1], v.target[2]),
    start: performance.now(),
    duration: 1000
  };
}
function setupCameraButtons() {
  document.querySelectorAll('#ui button[data-view]').forEach(function(btn) {
    btn.onclick = function() { setView(btn.dataset.view); };
  });
  document.getElementById('btnExitGame').onclick = function() {
    if (currentRoom) { broadcastMessage('room_leave', { code: currentRoom.code }); currentRoom = null; }
    gameActive = false;
    showScreen('menu');
  };
}

// ==================== ОБРАБОТКА КЛИКОВ ====================
function setupPointerEvents() {
  let ptrDown = null;
  renderer.domElement.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    ptrDown = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  renderer.domElement.addEventListener('pointerup', function(e) {
    if (e.button !== 0 || !ptrDown) return;
    const dx = Math.abs(e.clientX - ptrDown.x), dy = Math.abs(e.clientY - ptrDown.y);
    const dt = Date.now() - ptrDown.t;
    const isClick = dx < 5 && dy < 5 && dt < 700;
    ptrDown = null;
    if (!isClick || !gameActive) return;
    const inSetup = gamePhase.indexOf('setup_') === 0;
    if (inSetup || (gamePhase === 'playing' && (turnState.buildMode || turnState.robberMoveMode))) {
      handleClick(e);
    }
  });
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ==================== АНИМАЦИЯ ====================
let t = 0;
lastFrameTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  t += 0.02;

  if (camAnim) {
    const k = Math.min((now - camAnim.start) / camAnim.duration, 1);
    const ease = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, ease);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, ease);
    if (k >= 1) camAnim = null;
  }

  if (gameActive) {
    // Волны
    const pos = waves.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.6 + t) * 0.06 + Math.cos(y * 0.6 + t * 1.4) * 0.06);
    }
    pos.needsUpdate = true;

    // Пульсация маркеров
    const pulse = 0.5 + Math.sin(now * 0.003) * 0.15;
    markerGroup.children.forEach(function(m) {
      if (m.material && m.material.transparent) m.material.opacity = pulse;
    });

    // ★ Обновление всех гексов
    updateAllHexInstances(dt, now);
  }

  controls.update();
  if (gameActive) renderer.render(scene, camera);
}

console.log('[main] OK');