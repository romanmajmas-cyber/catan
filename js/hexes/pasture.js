/* ============================================================
   pasture.js — пастбище с овцами, пастухом, забором и кустами
   Обёрнуто в IIFE, чтобы не конфликтовать с другими hex-модулями
   (forest.js и т.п.), у которых есть одноимённые функции.
   ============================================================ */
(function () {
  'use strict';

  // ============================================================
  // НАСТРОЙКИ
  // ============================================================
  const CFG = {
    // --- Овцы ---
    SHEEP_COUNT_MIN: 20,
    SHEEP_COUNT_MAX: 25,
    SHEEP_SCALE: 0.50,
    SHEEP_SPEED: 0.1,
    SHEEP_TURN_SPEED: 2.0,
    SHEEP_GRAZE_TIME_MIN: 2.0,
    SHEEP_GRAZE_TIME_MAX: 3.0,
    SHEEP_STEPS_MIN: 6,
    SHEEP_STEPS_MAX: 7,
    SHEEP_STEP_TIME: 0.7,
    SHEEP_MIN_DIST: 0.09,

    // --- Пастух ---
    SHEPHERD_SCALE: 0.28,
    SHEPHERD_SPEED: 0.05,
    SHEPHERD_RADIUS: 0.60,
    SHEPHERD_AVOID_RADIUS: 0.14,
    SHEPHERD_AVOID_STRENGTH: 3.0,
    SHEPHERD_TURN_SMOOTH: 3.0,

    // --- Гекс ---
    HEX_RADIUS: 0.9,
    HEX_MARGIN: 0.10,
    SAFE_ZONE_RADIUS: 0.13,

    // --- Забор по периметру ---
    FENCE_RADIUS_SCALE: 0.94,
    FENCE_POST_H: 0.08,
    FENCE_POST_W: 0.012,
    FENCE_RAIL_H: 0.008,
    FENCE_RAIL_T: 0.004,
    FENCE_POST_SPACING: 0.10,

    // --- Кусты ---
    BUSH_COUNT: 10,
    BUSH_SCALE_MIN: 0.7,
    BUSH_SCALE_MAX: 1.3,
  };

  // ============================================================
  // МАТЕРИАЛЫ (локальные, чтобы не затирать чужие)
  // ============================================================
  const _woodMat      = (typeof MAT !== 'undefined' && MAT.wood)     || new THREE.MeshStandardMaterial({ color: 0x8B6B3D, roughness: 0.85 });
  const _postMat      = (typeof MAT !== 'undefined' && MAT.woodDark) || new THREE.MeshStandardMaterial({ color: 0x5D4527, roughness: 0.9  });
  const _shepherdMat  = (typeof MAT !== 'undefined' && MAT.cloth)    || new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.9  });
  const _shepherdSkin = (typeof MAT !== 'undefined' && MAT.skin)     || new THREE.MeshStandardMaterial({ color: 0xF1C27D, roughness: 0.8  });
  const _eyeMat       = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const _bushDarkMat  = new THREE.MeshStandardMaterial({ color: 0x2D4A1F, roughness: 0.95 });
  const _bushLightMat = new THREE.MeshStandardMaterial({ color: 0x4A7A2E, roughness: 0.95 });
  const _bushBerryMat = new THREE.MeshStandardMaterial({ color: 0x8B1A1A, roughness: 0.7  });

  // ============================================================
  // ГЕОМЕТРИЯ ГЕКСА (pointy-top)
  // ============================================================
  function _hexBoundaryDist(angle, R) {
    const apothem = R * Math.sqrt(3) / 2;
    const phi = Math.round(angle / (Math.PI / 3)) * (Math.PI / 3);
    return apothem / Math.cos(angle - phi);
  }

  function _clampToHex(x, z, cx, cz, R) {
    const dx = x - cx, dz = z - cz;
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) return [x, z];
    const angle = Math.atan2(dz, dx);
    const maxR = _hexBoundaryDist(angle, R);
    if (r > maxR) {
      const k = maxR / r;
      return [cx + dx * k, cz + dz * k];
    }
    return [x, z];
  }

  // ============================================================
  // МОДЕЛИ
  // ============================================================
  function _createSheepModel(scaleMul) {
    scaleMul = scaleMul || 1;
    const g = new THREE.Group();

    // 0: Тело
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), MAT.sheepWool);
    body.scale.set(1, 0.85, 1.32);
    body.position.y = 0.075;
    body.castShadow = true;
    g.add(body);

    // 1: Голова (индекс 1 — для анимации пастьбы)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), MAT.sheepSkin);
    head.position.set(0, 0.08, 0.125);
    head.castShadow = true;
    const eyeGeo = new THREE.SphereGeometry(0.006, 5, 4);
    const eyeL = new THREE.Mesh(eyeGeo, _eyeMat);
    eyeL.position.set(-0.014, 0.005, 0.028);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.014;
    head.add(eyeR);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), _eyeMat);
    nose.position.set(0, -0.008, 0.032);
    nose.scale.set(1.2, 0.8, 0.6);
    head.add(nose);
    g.add(head);

    // 2,3: Уши
    const earGeo = new THREE.SphereGeometry(0.011, 5, 4);
    const earL = new THREE.Mesh(earGeo, MAT.sheepSkin);
    earL.position.set(-0.031, 0.108, 0.125);
    earL.scale.set(0.8, 1.6, 0.5);
    earL.rotation.z = -0.4;
    g.add(earL);
    const earR = earL.clone();
    earR.position.x = 0.031;
    earR.rotation.z = 0.4;
    g.add(earR);

    // 4–7: Ноги
    const legGeo = new THREE.CylinderGeometry(0.007, 0.006, 0.06, 5);
    [[-0.04, 0.03, -0.05], [0.04, 0.03, -0.05],
     [-0.04, 0.03,  0.05], [0.04, 0.03,  0.05]].forEach(function (p) {
      const leg = new THREE.Mesh(legGeo, MAT.sheepSkin);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    // 8: Хвостик
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), MAT.sheepWool);
    tail.position.set(0, 0.085, -0.115);
    tail.scale.set(1, 1, 1.4);
    tail.castShadow = true;
    g.add(tail);

    const s = CFG.SHEEP_SCALE * scaleMul;
    g.scale.set(s, s, s);
    return g;
  }

  function _createShepherdModel() {
    const g = new THREE.Group();

    // Ноги
    const legGeo = new THREE.CylinderGeometry(0.018, 0.015, 0.09, 5);
    const legL = new THREE.Mesh(legGeo, _shepherdMat);
    legL.position.set(-0.022, 0.045, 0);
    legL.castShadow = true;
    g.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.022;
    g.add(legR);

    // Тело
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.17, 7), _shepherdMat);
    body.position.y = 0.175;
    body.castShadow = true;
    g.add(body);

    // Руки
    const armGeo = new THREE.CylinderGeometry(0.014, 0.012, 0.13, 5);
    const armL = new THREE.Mesh(armGeo, _shepherdMat);
    armL.position.set(-0.06, 0.19, 0.005);
    armL.rotation.z = 0.35;
    armL.castShadow = true;
    g.add(armL);
    const armR = new THREE.Mesh(armGeo, _shepherdMat);
    armR.position.set(0.06, 0.19, 0.005);
    armR.rotation.z = -0.35;
    armR.rotation.x = -0.15;
    armR.castShadow = true;
    g.add(armR);

    // Кисти рук
    const handGeo = new THREE.SphereGeometry(0.018, 5, 4);
    const handL = new THREE.Mesh(handGeo, _shepherdSkin);
    handL.position.set(-0.085, 0.128, 0.008);
    g.add(handL);
    const handR = new THREE.Mesh(handGeo, _shepherdSkin);
    handR.position.set(0.083, 0.13, 0.005);
    g.add(handR);

    // Голова
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), _shepherdSkin);
    head.position.y = 0.30;
    head.castShadow = true;
    g.add(head);

    // Глаза
    const eyeGeo = new THREE.SphereGeometry(0.007, 5, 4);
    const eyeL = new THREE.Mesh(eyeGeo, _eyeMat);
    eyeL.position.set(-0.017, 0.008, 0.043);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.017;
    head.add(eyeR);

    // Шляпа
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 10), _postMat);
    brim.position.y = 0.345;
    brim.castShadow = true;
    g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.045, 8), _postMat);
    top.position.y = 0.371;
    top.castShadow = true;
    g.add(top);

    // Посох
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.46, 5), _woodMat);
    staff.position.set(0.10, 0.23, 0.01);
    staff.rotation.z = 0.10;
    staff.castShadow = true;
    g.add(staff);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 4, 10, Math.PI * 1.2), _woodMat);
    hook.position.set(0.10 + Math.sin(0.10) * 0.23, 0.23 + Math.cos(0.10) * 0.23, 0.01);
    hook.rotation.z = Math.PI / 2 + 0.10;
    g.add(hook);

    const s = CFG.SHEPHERD_SCALE;
    g.scale.set(s, s, s);
    return g;
  }

  // Локальный "makeBush", чтобы имя не пересекалось с forest.js
  function _makePastureBush(x, y, z, scale, ctx) {
    const g = new THREE.Group();

    const parts = [
      { x:  0.00,  y: 0.045, z:  0.00,  r: 0.048, mat: _bushDarkMat  },
      { x:  0.030, y: 0.060, z:  0.020, r: 0.038, mat: _bushLightMat },
      { x: -0.030, y: 0.052, z:  0.012, r: 0.036, mat: _bushLightMat },
      { x:  0.008, y: 0.075, z: -0.028, r: 0.034, mat: _bushDarkMat  },
      { x: -0.012, y: 0.030, z: -0.038, r: 0.030, mat: _bushDarkMat  },
    ];
    parts.forEach(function (p) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(p.r, 7, 6), p.mat);
      s.position.set(p.x, p.y, p.z);
      s.scale.set(1, 0.85, 1);
      s.castShadow = true;
      s.receiveShadow = true;
      g.add(s);
    });

    if (ctx.rng() < 0.6) {
      for (let i = 0; i < 2; i++) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), _bushBerryMat);
        const a = ctx.rng() * Math.PI * 2;
        const r = 0.03 + ctx.rng() * 0.02;
        berry.position.set(Math.cos(a) * r, 0.05 + ctx.rng() * 0.03, Math.sin(a) * r);
        g.add(berry);
      }
    }

    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    return g;
  }

  // ============================================================
  // ЗАБОР ПО ПЕРИМЕТРУ ГЕКСА
  // ============================================================
  function _buildPerimeterFence(cx, cy, cz, ctx) {
    const objs = [];
    const Rf = CFG.HEX_RADIUS * CFG.FENCE_RADIUS_SCALE;

    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      verts.push({
        x: cx + Math.cos(a) * Rf,
        z: cz + Math.sin(a) * Rf,
      });
    }

    for (let i = 0; i < 6; i++) {
      const v1 = verts[i];
      const v2 = verts[(i + 1) % 6];
      const dx = v2.x - v1.x;
      const dz = v2.z - v1.z;
      const sideLen = Math.hypot(dx, dz);
      const midX = (v1.x + v2.x) / 2;
      const midZ = (v1.z + v2.z) / 2;
      const railRotY = Math.atan2(-dz, dx);

      const postCount = Math.max(2, Math.round(sideLen / CFG.FENCE_POST_SPACING) + 1);
      for (let j = 0; j < postCount; j++) {
        const t = j / (postCount - 1);
        const px = v1.x + dx * t;
        const pz = v1.z + dz * t;
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(CFG.FENCE_POST_W, CFG.FENCE_POST_H, CFG.FENCE_POST_W),
          _postMat
        );
        post.position.set(px, cy + CFG.FENCE_POST_H / 2, pz);
        post.castShadow = true;
        post.receiveShadow = true;
        ctx.boardGroup.add(post);
        objs.push(post);
      }

      [CFG.FENCE_POST_H * 0.75, CFG.FENCE_POST_H * 0.38].forEach(function (y) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(sideLen, CFG.FENCE_RAIL_H, CFG.FENCE_RAIL_T),
          _woodMat
        );
        rail.position.set(midX, cy + y, midZ);
        rail.rotation.y = railRotY;
        rail.castShadow = true;
        rail.receiveShadow = true;
        ctx.boardGroup.add(rail);
        objs.push(rail);
      });
    }

    return objs;
  }

  // ============================================================
  // СБОРКА ДЕКОРАЦИЙ
  // ============================================================
  function _buildPastureDecor(cx, cy, cz, ctx) {
    const objs = [];

    // Забор по периметру
    _buildPerimeterFence(cx, cy, cz, ctx).forEach(function (o) { objs.push(o); });

    // Кусты
    const maxRForBush = CFG.HEX_RADIUS * CFG.FENCE_RADIUS_SCALE - 0.05;
    let placedBushes = 0, bushAttempts = 0;
    const bushPositions = [];
    while (placedBushes < CFG.BUSH_COUNT && bushAttempts < 200) {
      bushAttempts++;
      const a = ctx.rng() * Math.PI * 2;
      const r = Math.sqrt(ctx.rng()) * maxRForBush;
      const bx = cx + Math.cos(a) * r;
      const bz = cz + Math.sin(a) * r;

      if (Math.hypot(bx - cx, bz - cz) < CFG.SAFE_ZONE_RADIUS + 0.06) continue;

      let ok = true;
      for (let k = 0; k < bushPositions.length; k++) {
        if (Math.hypot(bushPositions[k].x - bx, bushPositions[k].z - bz) < 0.12) { ok = false; break; }
      }
      if (!ok) continue;

      bushPositions.push({ x: bx, z: bz });
      const scale = CFG.BUSH_SCALE_MIN + ctx.rng() * (CFG.BUSH_SCALE_MAX - CFG.BUSH_SCALE_MIN);
      const bush = _makePastureBush(bx, cy, bz, scale, ctx);
      ctx.boardGroup.add(bush);
      objs.push(bush);
      placedBushes++;
    }

    // Травяные кустики
    for (let i = 0; i < 8; i++) {
      const a = ctx.rng() * Math.PI * 2;
      const d = 0.46 + ctx.rng() * 0.25;
      const gx = cx + Math.cos(a) * d;
      const gz = cz + Math.sin(a) * d;
      if (Math.hypot(gx - cx, gz - cz) < CFG.SAFE_ZONE_RADIUS) continue;
      const tuft = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.09 + ctx.rng() * 0.04, 4),
        MAT.grass
      );
      tuft.position.set(gx, cy + 0.05, gz);
      ctx.boardGroup.add(tuft);
      objs.push(tuft);
    }

    // Овцы
    const targetCount = CFG.SHEEP_COUNT_MIN + Math.floor(
      ctx.rng() * (CFG.SHEEP_COUNT_MAX - CFG.SHEEP_COUNT_MIN + 1)
    );
    const placed = [];
    const maxR = CFG.HEX_RADIUS * (1 - CFG.HEX_MARGIN) - 0.06;
    let attempts = 0;
    const minSpawnDist = CFG.SHEEP_MIN_DIST * 1.5;

    while (placed.length < targetCount && attempts < 1500) {
      attempts++;
      const a = ctx.rng() * Math.PI * 2;
      const r = Math.sqrt(ctx.rng()) * maxR;
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;

      if (Math.hypot(px - cx, pz - cz) < CFG.SAFE_ZONE_RADIUS + 0.04) continue;

      let ok = true;
      for (let k = 0; k < placed.length; k++) {
        if (Math.hypot(placed[k].x - px, placed[k].z - pz) < minSpawnDist) { ok = false; break; }
      }
      if (!ok) continue;
      for (let k = 0; k < bushPositions.length; k++) {
        if (Math.hypot(bushPositions[k].x - px, bushPositions[k].z - pz) < 0.10) { ok = false; break; }
      }
      if (!ok) continue;

      placed.push({ x: px, z: pz });
    }

    const sheepList = [];
    placed.forEach(function (p) {
      const sheep = _createSheepModel();
      sheep.position.set(p.x, cy, p.z);
      ctx.boardGroup.add(sheep);
      objs.push(sheep);
      sheepList.push(sheep);
    });

    // Пастух
    const shepherd = _createShepherdModel();
    shepherd.position.set(cx + CFG.SHEPHERD_RADIUS, cy, cz);
    shepherd.rotation.y = Math.PI / 2;
    ctx.boardGroup.add(shepherd);
    objs.push(shepherd);

    return { objs: objs, sheepList: sheepList, shepherd: shepherd };
  }

  // ============================================================
  // СОСТОЯНИЕ АНИМАЦИИ
  // ============================================================
  function _createPastureAnim(cx, cy, cz, ctx, decorData) {
    const sheepStates = decorData.sheepList.map(function (mesh) {
      const angle = ctx.rng() * Math.PI * 2;
      const startGraze = ctx.rng() < 0.5;
      return {
        mesh: mesh,
        angle: angle,
        targetAngle: angle,
        state: startGraze ? 'GRAZE' : 'WALK',
        timer: startGraze
          ? (CFG.SHEEP_GRAZE_TIME_MIN + ctx.rng() * (CFG.SHEEP_GRAZE_TIME_MAX - CFG.SHEEP_GRAZE_TIME_MIN))
          : (0.5 + ctx.rng() * 2),
        stepsLeft: CFG.SHEEP_STEPS_MIN + Math.floor(ctx.rng() * (CFG.SHEEP_STEPS_MAX - CFG.SHEEP_STEPS_MIN + 1)),
        stepTimer: CFG.SHEEP_STEP_TIME * ctx.rng(),
        headY: startGraze ? 0.045 : 0.08,
        targetHeadY: startGraze ? 0.045 : 0.08,
        bobPhase: ctx.rng() * Math.PI * 2,
      };
    });

    return {
      cx: cx, cz: cz,
      sheep: sheepStates,
      shepherd: { mesh: decorData.shepherd },
      localTime: 0,
    };
  }

  // ============================================================
  // ОБНОВЛЕНИЕ АНИМАЦИИ
  // ============================================================
  function _updatePastureAnim(state, dt, now) {
    if (!state || !state.sheep) return;

    state.localTime += dt;
    const t = state.localTime;

    const cx = state.cx, cz = state.cz;
    const R = CFG.HEX_RADIUS;
    const safeR = CFG.SAFE_ZONE_RADIUS;
    const sheep = state.sheep;
    const n = sheep.length;
    const maxR = R * (1 - CFG.HEX_MARGIN) - 0.02;

    // 1. Логика овец
    for (let i = 0; i < n; i++) {
      const s = sheep[i];

      if (s.state === 'WALK') {
        s.timer -= dt;
        s.stepTimer -= dt;

        let dA = s.targetAngle - s.angle;
        while (dA >  Math.PI) dA -= Math.PI * 2;
        while (dA < -Math.PI) dA += Math.PI * 2;
        const maxTurn = CFG.SHEEP_TURN_SPEED * dt;
        if (Math.abs(dA) > maxTurn) dA = Math.sign(dA) * maxTurn;
        s.angle += dA;

        s.mesh.position.x += Math.cos(s.angle) * CFG.SHEEP_SPEED * dt;
        s.mesh.position.z += Math.sin(s.angle) * CFG.SHEEP_SPEED * dt;

        if (s.stepTimer <= 0) {
          s.stepsLeft--;
          s.stepTimer = CFG.SHEEP_STEP_TIME;
        }

        if (s.stepsLeft <= 0 || s.timer <= 0) {
          s.state = 'GRAZE';
          s.timer = CFG.SHEEP_GRAZE_TIME_MIN + Math.random() * (CFG.SHEEP_GRAZE_TIME_MAX - CFG.SHEEP_GRAZE_TIME_MIN);
          s.targetHeadY = 0.045;
        }
      } else {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = 'WALK';
          s.stepsLeft = CFG.SHEEP_STEPS_MIN + Math.floor(Math.random() * (CFG.SHEEP_STEPS_MAX - CFG.SHEEP_STEPS_MIN + 1));
          s.stepTimer = CFG.SHEEP_STEP_TIME;
          s.targetHeadY = 0.08;
          s.targetAngle = s.angle + (Math.random() - 0.5) * Math.PI * 1.7;
        }
      }

      s.headY += (s.targetHeadY - s.headY) * Math.min(1, dt * 4);
    }

    // 2. Расталкивание
    const pushX = new Array(n).fill(0);
    const pushZ = new Array(n).fill(0);
    const minD = CFG.SHEEP_MIN_DIST;
    const minD2 = minD * minD;

    for (let i = 0; i < n; i++) {
      const pi = sheep[i].mesh.position;
      for (let j = i + 1; j < n; j++) {
        const pj = sheep[j].mesh.position;
        const dx = pi.x - pj.x;
        const dz = pi.z - pj.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const force = ((minD - d) / minD) * 0.5;
          const fx = (dx / d) * force;
          const fz = (dz / d) * force;
          pushX[i] += fx; pushZ[i] += fz;
          pushX[j] -= fx; pushZ[j] -= fz;
        }
      }
    }

    // 3. Границы и применение
    for (let i = 0; i < n; i++) {
      const s = sheep[i];
      const mesh = s.mesh;

      let newX = mesh.position.x + pushX[i];
      let newZ = mesh.position.z + pushZ[i];

      const sdx = newX - cx;
      const sdz = newZ - cz;
      const sd2 = sdx * sdx + sdz * sdz;
      if (sd2 < safeR * safeR) {
        const d = Math.sqrt(sd2) || 1e-6;
        newX = cx + (sdx / d) * safeR;
        newZ = cz + (sdz / d) * safeR;
      }

      const clamped = _clampToHex(newX, newZ, cx, cz, maxR);
      mesh.position.x = clamped[0];
      mesh.position.z = clamped[1];

      mesh.rotation.y = Math.PI / 2 - s.angle;

      const bob = Math.sin(t * 6 + s.bobPhase) * 0.003;
      mesh.children[1].position.y = s.headY + bob;
    }

    // 4. Пастух
    const sh = state.shepherd;
    if (sh && sh.mesh) {
      const mesh = sh.mesh;
      const px = mesh.position.x;
      const pz = mesh.position.z;

      const angleAround = Math.atan2(pz - cz, px - cx);
      const r = Math.hypot(px - cx, pz - cz);

      let vx = -Math.sin(angleAround);
      let vz =  Math.cos(angleAround);

      const radialErr = r - CFG.SHEPHERD_RADIUS;
      vx -= Math.cos(angleAround) * radialErr * 3.0;
      vz -= Math.sin(angleAround) * radialErr * 3.0;

      const avoidR = CFG.SHEPHERD_AVOID_RADIUS;
      for (let i = 0; i < n; i++) {
        const sp = sheep[i].mesh.position;
        const dx = px - sp.x;
        const dz = pz - sp.z;
        const d = Math.hypot(dx, dz);
        if (d < avoidR && d > 1e-6) {
          const strength = ((avoidR - d) / avoidR) * CFG.SHEPHERD_AVOID_STRENGTH;
          vx += (dx / d) * strength;
          vz += (dz / d) * strength;
        }
      }

      const dSafeR = safeR + 0.06;
      if (r < dSafeR && r > 1e-6) {
        const strength = ((dSafeR - r) / dSafeR) * 3.0;
        vx += (px - cx) / r * strength;
        vz += (pz - cz) / r * strength;
      }

      const vLen = Math.hypot(vx, vz);
      if (vLen > 1e-6) {
        vx /= vLen;
        vz /= vLen;

        const nx = px + vx * CFG.SHEPHERD_SPEED * dt;
        const nz = pz + vz * CFG.SHEPHERD_SPEED * dt;

        const cl = _clampToHex(nx, nz, cx, cz, R * CFG.FENCE_RADIUS_SCALE - 0.04);
        mesh.position.x = cl[0];
        mesh.position.z = cl[1];
      }

      const targetRot = Math.atan2(vx, vz);
      let dR = targetRot - mesh.rotation.y;
      while (dR >  Math.PI) dR -= Math.PI * 2;
      while (dR < -Math.PI) dR += Math.PI * 2;
      mesh.rotation.y += dR * Math.min(1, dt * CFG.SHEPHERD_TURN_SMOOTH);
    }
  }

  // ============================================================
  // ЭКСПОРТ
  // ============================================================
  window.HexPasture = {
    create: function (cx, cy, cz, ctx) {
      const decorData = _buildPastureDecor(cx, cy, cz, ctx);
      const anim = _createPastureAnim(cx, cy, cz, ctx, decorData);
      return { decor: decorData.objs, anim: anim };
    },
    update: function (state, dt, now) {
      if (state && state.anim) _updatePastureAnim(state.anim, dt, now);
    },
    destroy: function (state) {
      if (state && state.decor) {
        state.decor.forEach(function (o) {
          if (o.parent) o.parent.remove(o);
        });
      }
    }
  };

  console.log('[HexPasture] OK — овцы, пастух, забор и кусты загружены');
})();