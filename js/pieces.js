// ==================== ФИГУРЫ ИГРОКОВ ====================
function createSettlementMesh(pi, setup) {
  const g = new THREE.Group();
  const mats = getPlayerMats(players[pi].colorIdx, setup);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.16), mats.base);
  base.position.y = 0.075; base.castShadow = true; g.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.11, 4), mats.roof);
  roof.position.y = 0.19; roof.rotation.y = Math.PI/4; roof.castShadow = true; g.add(roof);
  return g;
}
function createCityMesh(pi) {
  const g = new THREE.Group();
  const mats = getPlayerMats(players[pi].colorIdx);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), mats.base);
  base.position.y = 0.10; base.castShadow = true; g.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 4), mats.roof);
  roof.position.y = 0.26; roof.rotation.y = Math.PI/4; roof.castShadow = true; g.add(roof);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.30, 0.09), mats.dark);
  tower.position.set(0.10, 0.16, -0.10); tower.castShadow = true; g.add(tower);
  const towerTop = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.10, 4), MAT.armorGold);
  towerTop.position.set(0.10, 0.36, -0.10);
  towerTop.rotation.y = Math.PI/4;
  g.add(towerTop);
  return g;
}
function createRoadMesh(length, angle, pi, setup) {
  const g = new THREE.Group();
  const mats = getPlayerMats(players[pi].colorIdx, setup);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, length * 0.92), mats.base);
  beam.position.y = 0.025; beam.castShadow = true; g.add(beam);
  const dashes = Math.max(2, Math.floor(length/0.1));
  for (let i = 0; i < dashes; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.015), mats.dark);
    d.position.set(0, 0.025, ((i+0.5)/dashes - 0.5) * length * 0.92);
    g.add(d);
  }
  g.rotation.y = angle;
  return g;
}
function placeSettlement(vIdx, pi, setup) {
  const v = vertices[vIdx];
  const mesh = createSettlementMesh(pi, setup);
  mesh.position.set(v.x, TERRAIN_Y, v.z);
  pieceGroup.add(mesh);
  v.building = { type: 'settlement', player: pi, mesh: mesh };
  players[pi].settlements.push(vIdx);
  updatePlayerPorts(pi);
  updateLongestRoad();
}
function placeCity(vIdx, pi) {
  const v = vertices[vIdx];
  if (v.building && v.building.mesh) {
    pieceGroup.remove(v.building.mesh);
    const si = players[pi].settlements.indexOf(vIdx);
    if (si >= 0) players[pi].settlements.splice(si, 1);
  }
  const mesh = createCityMesh(pi);
  mesh.position.set(v.x, TERRAIN_Y, v.z);
  pieceGroup.add(mesh);
  v.building = { type: 'city', player: pi, mesh: mesh };
  players[pi].cities.push(vIdx);
  updatePlayerPorts(pi);
  updateLongestRoad();
}
function placeRoad(eIdx, pi, setup) {
  const e = edges[eIdx];
  const mesh = createRoadMesh(e.length, e.angle, pi, setup);
  mesh.position.set(e.x, TERRAIN_Y, e.z);
  pieceGroup.add(mesh);
  e.road = { player: pi, mesh: mesh };
  players[pi].roads.push(eIdx);
  updateLongestRoad();
}

// ==================== ПОРТЫ ====================
function findExposedEdges(list) {
  const offsets = [
    { dx: SQRT3, dz: 0 }, { dx: SQRT3/2, dz: -1.5 }, { dx: -SQRT3/2, dz: -1.5 },
    { dx: -SQRT3, dz: 0 }, { dx: -SQRT3/2, dz: 1.5 }, { dx: SQRT3/2, dz: 1.5 }
  ];
  const result = [];
  list.forEach(function(h, hi) {
    offsets.forEach(function(off) {
      const nx = h.x + off.dx, nz = h.z + off.dz;
      if (!list.some(function(o) { return Math.abs(o.x - nx) < 0.1 && Math.abs(o.z - nz) < 0.1; })) {
        result.push({ x: h.x + off.dx/2, z: h.z + off.dz/2, angle: Math.atan2(off.dz, off.dx), angleFromCenter: Math.atan2(h.z + off.dz/2, h.x + off.dx/2), hexIdx: hi, offset: off });
      }
    });
  });
  return result;
}
function selectPortEdges(edges) {
  if (edges.length < 9) return edges;
  edges.sort(function(a, b) { return a.angleFromCenter - b.angleFromCenter; });
  const picks = [];
  for (let i = 0; i < 9; i++) {
    const target = -Math.PI + i * 2 * Math.PI / 9;
    let best = null, bestDist = Infinity;
    for (let e = 0; e < edges.length; e++) {
      const ed = edges[e];
      if (picks.indexOf(ed) >= 0) continue;
      let d = Math.abs(ed.angleFromCenter - target);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < bestDist) { bestDist = d; best = ed; }
    }
    if (best) picks.push(best);
  }
  return picks;
}
function createPort(edge, ratio, resource) {
  const g = new THREE.Group();
  const dockLen = 0.90, dockW = 0.50, deckY = 0.20;
  for (let i = 0; i < 8; i++) {
    const t = (i/7) - 0.5;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(dockLen/8 * 0.92, 0.05, dockW), i % 2 === 0 ? MAT.wood : MAT.woodLight);
    plank.position.set(t * (dockLen - dockLen/8), deckY, 0);
    plank.castShadow = true;
    g.add(plank);
  }
  [[-dockLen/2 + 0.10, -dockW/2 + 0.08], [-dockLen/2 + 0.10, dockW/2 - 0.08],
   [dockLen/2 - 0.10, -dockW/2 + 0.08], [dockLen/2 - 0.10, dockW/2 - 0.08]].forEach(function(pos) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.55, 8), MAT.woodDark);
    p.position.set(pos[0], 0.125, pos[1]);
    g.add(p);
  });
  const mastH = 0.85, mastX = dockLen/2 - 0.08;
  [-dockW/2 + 0.10, dockW/2 - 0.10].forEach(function(zSide) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, mastH, 8), MAT.wood);
    mast.position.set(mastX, mastH/2 + 0.05, zSide);
    g.add(mast);
  });
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, '#f5e6c8'); grad.addColorStop(1, '#e0d0a8');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = '#5a3818'; ctx.lineWidth = 14; ctx.strokeRect(10, 10, 492, 300);
  ctx.fillStyle = '#1a3a5c'; ctx.font = 'bold 92px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ratio, 256, 95);
  if (resource) {
    ctx.font = '70px Arial, sans-serif';
    ctx.fillText(RES_NAMES[resource].icon, 170, 240);
    ctx.font = 'bold 40px Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText(RES_NAMES[resource].name, 240, 240);
  } else {
    ctx.fillStyle = '#d4a020'; ctx.beginPath(); ctx.arc(170, 230, 55, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 60px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('★', 170, 248);
    ctx.fillStyle = '#1a3a5c'; ctx.font = 'bold 40px Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText('Любой', 240, 240);
  }
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 16;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  sign.position.set(mastX, mastH - 0.26, 0);
  sign.rotation.y = -Math.PI/2;
  g.add(sign);
  g.position.set(edge.x, WATER_Y + 0.08, edge.z);
  g.rotation.y = -edge.angle;

  const h = hexList[edge.hexIdx];
  const candidates = [];
  for (let k = 0; k < 6; k++) {
    const o1 = HEX_VERT_OFFSETS[k], o2 = HEX_VERT_OFFSETS[(k+1)%6];
    const p1x = h.x + o1.dx, p1z = h.z + o1.dz, p2x = h.x + o2.dx, p2z = h.z + o2.dz;
    const midX = (p1x + p2x)/2, midZ = (p1z + p2z)/2;
    const d = Math.hypot(midX - (h.x + edge.offset.dx/2), midZ - (h.z + edge.offset.dz/2));
    candidates.push({ d: d, p1: { x: p1x, z: p1z }, p2: { x: p2x, z: p2z } });
  }
  candidates.sort(function(a, b) { return a.d - b.d; });
  const best = candidates[0];
  const vertIdxs = [];
  [best.p1, best.p2].forEach(function(vp) {
    for (let vi = 0; vi < vertices.length; vi++) {
      if (Math.abs(vertices[vi].x - vp.x) < 0.01 && Math.abs(vertices[vi].z - vp.z) < 0.01) { vertIdxs.push(vi); break; }
    }
  });
  return { group: g, ratio: ratio, resource: resource, vertexIdxs: vertIdxs };
}

// ==================== МАРКЕРЫ ====================
const raycaster = new THREE.Raycaster();
const mouseVec = new THREE.Vector2();

function clearMarkers() { clearGroup(markerGroup); }

function addVertexMarker(v, i, color, yo, r) {
  yo = yo === undefined ? 0.06 : yo;
  r = r === undefined ? 0.13 : r;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 16), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55 }));
  m.position.set(v.x, TERRAIN_Y + yo, v.z);
  m.userData = { type: 'vertex', idx: i };
  markerGroup.add(m);
}
function addEdgeMarker(e, i, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, e.length * 0.85), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.65 }));
  m.position.set(e.x, TERRAIN_Y + 0.05, e.z);
  m.rotation.y = e.angle;
  m.userData = { type: 'edge', idx: i };
  markerGroup.add(m);
}
function addHexMarker(h, i, color) {
  const m = new THREE.Mesh(makeHexGeo(HEX_R * 0.75, 0.03), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55 }));
  m.position.set(h.x, TERRAIN_Y + 0.04, h.z);
  m.userData = { type: 'hex', idx: i };
  markerGroup.add(m);
}
function showMarkers() {
  clearMarkers();
  if (!gameActive) return;
  if (gamePhase === 'setup_settlement' || gamePhase === 'setup_settlement_2') {
    vertices.forEach(function(v, i) { if (canSetupSettlement(i)) addVertexMarker(v, i, 0x66ff66); });
    return;
  }
  if (gamePhase === 'setup_road' || gamePhase === 'setup_road_2') {
    if (lastPlacedSettlement !== null) {
      Array.from(vertices[lastPlacedSettlement].edgeIndices).forEach(function(eIdx) {
        if (canSetupRoad(eIdx, lastPlacedSettlement)) addEdgeMarker(edges[eIdx], eIdx, 0x88ccff);
      });
    }
    return;
  }
  if (turnState.robberMoveMode) {
    hexList.forEach(function(h, i) { if (i !== robberHexIdx) addHexMarker(h, i, 0xff4444); });
    return;
  }
  const mode = turnState.buildMode;
  if (!mode) return;
  if (mode === 'settlement') {
    vertices.forEach(function(v, i) { if (canPlaceSettlement(i, currentPlayer)) addVertexMarker(v, i, 0x66ff66); });
  } else if (mode === 'city') {
    vertices.forEach(function(v, i) { if (canPlaceCity(i, currentPlayer)) addVertexMarker(v, i, 0xffd700, 0.10, 0.15); });
  } else if (mode === 'road' || mode === 'roadBuilding') {
    if (mode === 'roadBuilding') {
      edges.forEach(function(e, i) {
        if (e.road) return;
        const v1 = vertices[e.v1], v2 = vertices[e.v2];
        const hasOwn = (v1.building && v1.building.player === currentPlayer) || (v2.building && v2.building.player === currentPlayer) ||
          Array.from(v1.edgeIndices).some(function(j) { return edges[j].road && edges[j].road.player === currentPlayer; }) ||
          Array.from(v2.edgeIndices).some(function(j) { return edges[j].road && edges[j].road.player === currentPlayer; });
        if (hasOwn) addEdgeMarker(e, i, 0x90ff90);
      });
    } else {
      edges.forEach(function(e, i) { if (canPlaceRoad(i, currentPlayer)) addEdgeMarker(e, i, 0x88ccff); });
    }
  }
}

console.log('[pieces] OK');