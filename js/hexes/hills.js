/* ============================================================
   hills.js — глиняное болото: вязкая глина, рельеф, рабочие
   Обёрнуто в IIFE, чтобы не конфликтовать с другими hex-модулями
   ============================================================ */
(function () {
  'use strict';

  // ============================================================
  // НАСТРОЙКИ
  // ============================================================
  const CFG = {
    HEX_RADIUS: 0.9,
    HEX_MARGIN: 0.14,              // отступ от края гекса для всех объектов
    SAFE_ZONE_RADIUS: 0.17,        // зона вокруг цифры — никто не заходит

    // Рабочие
    WORKER_SCALE: 0.3,
    WORKER_WALK_SPEED: 0.09,
    WORKER_TURN_SMOOTH: 4.0,

    // Копатель
    DIGGER_RELOCATE_TIME: 13.0,    // каждые 13 сек — новая точка
    DIGGER_WALK_SPEED: 0.09,
    DIGGER_WALK_ZONE_MIN: 0.40,    // мин. радиус от центра, где копает
    DIGGER_WALK_ZONE_MAX: 0.60,    // макс. радиус от центра

    // Кучки
    PILE_MIN_SCALE: 0.78,
    PILE_MAX_SCALE: 1.12,

    // Движение тачки (рад/сек по циклу)
    CARRIER_CYCLE_SPEED: 0.42,
    DIG_ANIM_SPEED: 3.0,

    // Рельеф
    CLAY_PATCHES: 18,
    CLAY_HILLS: 5,
    HILL_SCALE_MIN: 0.6,
    HILL_SCALE_MAX: 1.05,
  };

  // ============================================================
  // МАТЕРИАЛЫ (вязкая глина — низкая шероховатость, лёгкий блеск)
  // ============================================================
  const _clayColors = [0xA0623C, 0x8B4A28, 0xB8794E, 0x9B6B44, 0x7A5030, 0xA9704A, 0x8D5A3A, 0xC58B5D];

  function _makeClay(c) {
    return new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.55,      // влажная, вязкая
      metalness: 0.05,
      flatShading: false,   // ГЛАДКО
    });
  }
  const _clayMats = _clayColors.map(_makeClay);

  const _clayWetMat = new THREE.MeshStandardMaterial({
    color: 0x6B4423, roughness: 0.35, metalness: 0.12, flatShading: false,
  });

  const _vestMat     = new THREE.MeshStandardMaterial({ color: 0xFF7A1A, roughness: 0.65, emissive: 0x552200, emissiveIntensity: 0.15 });
  const _vestStripe  = new THREE.MeshStandardMaterial({ color: 0xEEEEEE, roughness: 0.6 });
  const _helmetMat   = new THREE.MeshStandardMaterial({ color: 0xFAFAFA, roughness: 0.35, metalness: 0.08 });
  const _skinMat     = new THREE.MeshStandardMaterial({ color: 0xE8B07A, roughness: 0.85 });
  const _pantsMat    = new THREE.MeshStandardMaterial({ color: 0x2A3A5C, roughness: 0.9 });
  const _bootMat     = new THREE.MeshStandardMaterial({ color: 0x3A2515, roughness: 0.9 });
  const _woodMat     = new THREE.MeshStandardMaterial({ color: 0x8B6B3D, roughness: 0.85 });
  const _metalMat    = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.6 });
  const _wheelMat    = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.8 });
  const _eyeMat      = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });

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

  // Эффективный радиус для объектов заданного размера
  function _safeRadiusFor(objR) {
    return CFG.HEX_RADIUS * (1 - CFG.HEX_MARGIN) - objR;
  }

  function _inSafeZone(x, z, cx, cz, extra) {
    extra = extra || 0;
    const dx = x - cx, dz = z - cz;
    return Math.hypot(dx, dz) < CFG.SAFE_ZONE_RADIUS + extra;
  }

  // ============================================================
  // ВЯЗКАЯ ГЛИНА — гладкая деформация сферы
  // ============================================================
  function _smoothDeform(geo, amp, freq, squashY) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // мягкие волны — не шум, поэтому поверхность гладкая
      const n = 1 + amp * (
        Math.sin(x * freq + y * freq * 0.7) * 0.5 +
        Math.cos(z * freq * 1.1 - y * freq * 0.5) * 0.5
      );
      pos.setX(i, x * n);
      pos.setY(i, y * n * (squashY || 1));
      pos.setZ(i, z * n);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ============================================================
  // КУЧКА ГЛИНЫ (гладкая, вязкая)
  // ============================================================
  function _createClayPile(radius, mat, ctx) {
    const g = new THREE.Group();

    // Основной бугор — гладкая сплющенная сфера
    const baseGeo = new THREE.SphereGeometry(radius, 24, 18);
    _smoothDeform(baseGeo, 0.14, 14, 0.62);
    const base = new THREE.Mesh(baseGeo, mat);
    base.position.y = radius * 0.32;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Натёки сверху — несколько гладких «капель», сливающихся в кучу
    const lumpCount = 5;
    for (let i = 0; i < lumpCount; i++) {
      const lr = radius * (0.42 + ctx.rng() * 0.22);
      const lumpGeo = new THREE.SphereGeometry(lr, 16, 12);
      _smoothDeform(lumpGeo, 0.12, 11, 0.68);
      const lump = new THREE.Mesh(lumpGeo, mat);
      const a = (i / lumpCount) * Math.PI * 2 + ctx.rng() * 0.7;
      const r = radius * 0.45 * ctx.rng();
      lump.position.set(
        Math.cos(a) * r,
        radius * (0.30 + ctx.rng() * 0.22),
        Math.sin(a) * r
      );
      lump.castShadow = true;
      g.add(lump);
    }

    // Влажный блик сверху
    const sheen = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 12, 10), _clayWetMat);
    sheen.position.set(0, radius * 0.78, 0);
    sheen.scale.y = 0.4;
    g.add(sheen);

    return g;
  }

  // ============================================================
  // ХОЛМИК ГЛИНЫ (гладкий)
  // ============================================================
  function _createClayHill(x, y, z, scale, ctx) {
    const g = new THREE.Group();
    const mat = _clayMats[Math.floor(ctx.rng() * _clayMats.length)];

    const geo = new THREE.SphereGeometry(0.17, 20, 14);
    _smoothDeform(geo, 0.16, 9, 0.62);

    const base = new THREE.Mesh(geo, mat);
    base.position.y = 0.055;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Один-два натёка сверху
    for (let i = 0; i < 3; i++) {
      const lr = 0.045 + ctx.rng() * 0.03;
      const lumpGeo = new THREE.SphereGeometry(lr, 12, 10);
      _smoothDeform(lumpGeo, 0.12, 13, 0.7);
      const lump = new THREE.Mesh(lumpGeo, _clayMats[Math.floor(ctx.rng() * _clayMats.length)]);
      const a = ctx.rng() * Math.PI * 2;
      const r = 0.05 + ctx.rng() * 0.05;
      lump.position.set(Math.cos(a) * r, 0.10 + ctx.rng() * 0.035, Math.sin(a) * r);
      lump.castShadow = true;
      g.add(lump);
    }

    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    return g;
  }

  // ============================================================
  // РАБОЧИЙ
  // ============================================================
  function _createWorker(kind) {
    const g = new THREE.Group();
    g.userData.kind = kind;

    // Ноги
    const legGeo = new THREE.CylinderGeometry(0.028, 0.024, 0.16, 6);
    const legL = new THREE.Mesh(legGeo, _pantsMat);
    legL.position.set(-0.035, 0.08, 0);
    legL.castShadow = true;
    g.add(legL);
    const legR = new THREE.Mesh(legGeo, _pantsMat);
    legR.position.set(0.035, 0.08, 0);
    legR.castShadow = true;
    g.add(legR);
    g.userData.legL = legL;
    g.userData.legR = legR;

    // Ботинки
    const bootGeo = new THREE.BoxGeometry(0.055, 0.03, 0.08);
    const bootL = new THREE.Mesh(bootGeo, _bootMat);
    bootL.position.set(-0.035, 0.015, 0.015);
    g.add(bootL);
    const bootR = new THREE.Mesh(bootGeo, _bootMat);
    bootR.position.set(0.035, 0.015, 0.015);
    g.add(bootR);

    // Торс (жилет)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.18, 10), _vestMat);
    torso.position.y = 0.25;
    torso.castShadow = true;
    g.add(torso);
    g.userData.torso = torso;

    // Полосы жилета
    const stripe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 12), _vestStripe);
    stripe1.position.y = 0.28;
    g.add(stripe1);
    const stripe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 12), _vestStripe);
    stripe2.position.y = 0.23;
    g.add(stripe2);

    // Руки
    const armGeo = new THREE.CylinderGeometry(0.018, 0.016, 0.14, 6);
    const armL = new THREE.Mesh(armGeo, _vestMat);
    armL.position.set(-0.075, 0.24, 0);
    armL.rotation.z = 0.28;
    armL.castShadow = true;
    g.add(armL);
    const armR = new THREE.Mesh(armGeo, _vestMat);
    armR.position.set(0.075, 0.24, 0);
    armR.rotation.z = -0.28;
    armR.castShadow = true;
    g.add(armR);
    g.userData.armL = armL;
    g.userData.armR = armR;

    // Кисти
    const handGeo = new THREE.SphereGeometry(0.02, 7, 5);
    const handL = new THREE.Mesh(handGeo, _skinMat);
    handL.position.set(-0.10, 0.17, 0);
    g.add(handL);
    const handR = new THREE.Mesh(handGeo, _skinMat);
    handR.position.set(0.10, 0.17, 0);
    g.add(handR);

    // Голова
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 9), _skinMat);
    head.position.y = 0.385;
    head.castShadow = true;
    g.add(head);
    const eyeGeo = new THREE.SphereGeometry(0.006, 6, 5);
    const eyeL = new THREE.Mesh(eyeGeo, _eyeMat);
    eyeL.position.set(-0.017, 0.005, 0.043);
    head.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, _eyeMat);
    eyeR.position.set(0.017, 0.005, 0.043);
    head.add(eyeR);

    // Каска
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      _helmetMat
    );
    helmet.position.y = 0.405;
    helmet.scale.set(1, 0.85, 1);
    helmet.castShadow = true;
    g.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.006, 16), _helmetMat);
    brim.position.set(0, 0.402, 0.02);
    g.add(brim);

    // Аксессуары
    if (kind === 'digger') {
      const shovel = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.28, 6), _woodMat);
      shaft.position.y = -0.14;
      shovel.add(shaft);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), _woodMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.y = 0.0;
      shovel.add(grip);
      const collet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8), _metalMat);
      collet.position.y = -0.27;
      shovel.add(collet);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.012), _metalMat);
      blade.position.y = -0.315;
      shovel.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.04, 4), _metalMat);
      tip.position.y = -0.37;
      tip.rotation.y = Math.PI / 4;
      shovel.add(tip);

      shovel.position.set(0.10, 0.17, 0.02);
      shovel.rotation.z = 0.5;
      g.add(shovel);
      g.userData.shovel = shovel;

    } else if (kind === 'carrier') {
      const barrow = new THREE.Group();

      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.22), _metalMat);
      tray.position.y = 0.02;
      tray.castShadow = true;
      barrow.add(tray);
      const wallF = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.012), _metalMat);
      wallF.position.set(0, 0.045, 0.11);
      barrow.add(wallF);
      const wallB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.012), _metalMat);
      wallB.position.set(0, 0.045, -0.11);
      barrow.add(wallB);
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.22), _metalMat);
      wallL.position.set(-0.08, 0.045, 0);
      barrow.add(wallL);
      const wallR = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.22), _metalMat);
      wallR.position.set(0.08, 0.045, 0);
      barrow.add(wallR);

      // Глиняная масса — гладкая
      const loadGeo = new THREE.SphereGeometry(0.075, 14, 10);
      _smoothDeform(loadGeo, 0.1, 16, 0.55);
      const load = new THREE.Mesh(loadGeo, _clayWetMat);
      load.position.y = 0.075;
      load.scale.set(1, 0.55, 1.3);
      barrow.add(load);
      barrow.userData.load = load;

      const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6);
      const handleL = new THREE.Mesh(handleGeo, _woodMat);
      handleL.rotation.x = Math.PI / 2;
      handleL.position.set(-0.075, 0.04, -0.19);
      barrow.add(handleL);
      const handleR = new THREE.Mesh(handleGeo, _woodMat);
      handleR.rotation.x = Math.PI / 2;
      handleR.position.set(0.075, 0.04, -0.19);
      barrow.add(handleR);

      const supportGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.1, 5);
      const supL = new THREE.Mesh(supportGeo, _metalMat);
      supL.position.set(-0.06, -0.02, -0.08);
      supL.rotation.x = 0.15;
      barrow.add(supL);
      const supR = new THREE.Mesh(supportGeo, _metalMat);
      supR.position.set(0.06, -0.02, -0.08);
      supR.rotation.x = 0.15;
      barrow.add(supR);

      const wheelPivot = new THREE.Group();
      wheelPivot.position.set(0, -0.025, 0.10);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 18), _wheelMat);
      tire.rotation.z = Math.PI / 2;
      wheelPivot.add(tire);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 8, 22), _metalMat);
      rim.rotation.y = Math.PI / 2;
      wheelPivot.add(rim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 10), _metalMat);
      hub.rotation.z = Math.PI / 2;
      wheelPivot.add(hub);
      for (let i = 0; i < 4; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.088, 0.004), _metalMat);
        spoke.rotation.x = i * Math.PI / 4;
        wheelPivot.add(spoke);
      }
      barrow.add(wheelPivot);
      barrow.userData.wheel = wheelPivot;

      barrow.position.set(0, 0.06, 0.14);
      g.add(barrow);
      g.userData.barrow = barrow;
    }

    g.scale.setScalar(CFG.WORKER_SCALE);
    return g;
  }

  // ============================================================
  // ГЛИНЯНЫЙ РЕЛЬЕФ — пятна, впадины, бугры
  // ============================================================
  function _buildClayTerrain(cx, cy, cz, ctx) {
    const objs = [];
    const margin = 0.03;

    // 1) Плоские пятна глины на полу (с учётом их радиуса)
    for (let i = 0; i < CFG.CLAY_PATCHES; i++) {
      const rad = 0.08 + ctx.rng() * 0.12;
      const maxR = _safeRadiusFor(rad + margin);
      if (maxR <= 0.05) continue;

      const a = ctx.rng() * Math.PI * 2;
      const r = Math.sqrt(ctx.rng()) * maxR;
      let px = cx + Math.cos(a) * r;
      let pz = cz + Math.sin(a) * r;
      const cl = _clampToHex(px, pz, cx, cz, maxR);
      px = cl[0]; pz = cl[1];

      if (_inSafeZone(px, pz, cx, cz, rad * 0.8)) continue;

      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(rad, 24),
        _clayMats[Math.floor(ctx.rng() * _clayMats.length)]
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(px, cy + 0.008 + ctx.rng() * 0.005, pz);
      patch.receiveShadow = true;
      ctx.boardGroup.add(patch);
      objs.push(patch);

      // Влажный блик — гладкий круг меньшего радиуса
      if (ctx.rng() < 0.55) {
        const wet = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.5, 20), _clayWetMat);
        wet.rotation.x = -Math.PI / 2;
        wet.position.set(px, cy + 0.013, pz);
        ctx.boardGroup.add(wet);
        objs.push(wet);
      }
    }

    // 2) Рельеф — плавные бугры, вросшие в землю
    const hillCount = 3 + Math.floor(ctx.rng() * (CFG.CLAY_HILLS - 2));
    let attempts = 0;
    let placed = 0;
    while (placed < hillCount && attempts < 60) {
      attempts++;
      const scale = CFG.HILL_SCALE_MIN + ctx.rng() * (CFG.HILL_SCALE_MAX - CFG.HILL_SCALE_MIN);
      const hillRadius = 0.17 * scale * 0.7; // приблизительный радиус подошвы
      const maxR = _safeRadiusFor(hillRadius);
      if (maxR <= 0.1) break;

      const a = ctx.rng() * Math.PI * 2;
      const r = 0.32 + ctx.rng() * (maxR - 0.32);
      let hx = cx + Math.cos(a) * r;
      let hz = cz + Math.sin(a) * r;
      const cl = _clampToHex(hx, hz, cx, cz, maxR);
      hx = cl[0]; hz = cl[1];

      if (_inSafeZone(hx, hz, cx, cz, hillRadius)) continue;

      const hill = _createClayHill(hx, cy, hz, scale, ctx);
      ctx.boardGroup.add(hill);
      objs.push(hill);
      placed++;
    }

    return objs;
  }

  // ============================================================
  // ПОИСК ТОЧКИ ДЛЯ КОПАТЕЛЯ
  // ============================================================
  function _pickDiggerPosition(cx, cz, pilePos) {
    const baseAngle = Math.atan2(pilePos.z - cz, pilePos.x - cx);
    for (let i = 0; i < 40; i++) {
      const a = baseAngle + (Math.random() - 0.5) * Math.PI * 1.4;
      const r = CFG.DIGGER_WALK_ZONE_MIN +
                Math.random() * (CFG.DIGGER_WALK_ZONE_MAX - CFG.DIGGER_WALK_ZONE_MIN);
      let px = cx + Math.cos(a) * r;
      let pz = cz + Math.sin(a) * r;

      const maxR = _safeRadiusFor(0.05);
      const cl = _clampToHex(px, pz, cx, cz, maxR);
      px = cl[0]; pz = cl[1];

      if (_inSafeZone(px, pz, cx, cz, 0.05)) continue;
      // не слишком далеко от pile (чтобы визуально копал рядом)
      if (Math.hypot(px - pilePos.x, pz - pilePos.z) > 0.55) continue;
      return { x: px, z: pz };
    }
    // Fallback
    const cl = _clampToHex(cx - 0.42, cz + 0.24, cx, cz, _safeRadiusFor(0.05));
    return { x: cl[0], z: cl[1] };
  }

  // ============================================================
  // ПОСТРОЕНИЕ ГЕКСА
  // ============================================================
  function _buildHillsDecor(cx, cy, cz, ctx) {
    const objs = [];

    // 1) Рельеф (пятна + бугры)
    _buildClayTerrain(cx, cy, cz, ctx).forEach(function (o) { objs.push(o); });

    // 2) Главная кучка (её копает digger)
    const pilePos = { x: cx - 0.38, z: cz + 0.22 };
    const clPile = _clampToHex(pilePos.x, pilePos.z, cx, cz, _safeRadiusFor(0.09));
    pilePos.x = clPile[0]; pilePos.z = clPile[1];

    const mainPile = _createClayPile(0.085, _clayMats[0], ctx);
    mainPile.position.set(pilePos.x, cy, pilePos.z);
    ctx.boardGroup.add(mainPile);
    objs.push(mainPile);

    // 3) Крайняя кучка
    const edgeAngle = -Math.PI * 0.35;
    const edgeR = _safeRadiusFor(0.10) * 0.85;
    const edgePos = {
      x: cx + Math.cos(edgeAngle) * edgeR,
      z: cz + Math.sin(edgeAngle) * edgeR,
    };
    const edgePile = _createClayPile(0.095, _clayMats[2], ctx);
    edgePile.position.set(edgePos.x, cy, edgePos.z);
    ctx.boardGroup.add(edgePile);
    objs.push(edgePile);

    // 4) Копатель
    const digger = _createWorker('digger');
    const digStart = _pickDiggerPosition(cx, cz, pilePos);
    digger.position.set(digStart.x, cy, digStart.z);
    digger.rotation.y = Math.atan2(pilePos.x - digStart.x, pilePos.z - digStart.z);
    ctx.boardGroup.add(digger);
    objs.push(digger);

    // 5) Возчик с тачкой
    const carrier = _createWorker('carrier');
    carrier.position.set(pilePos.x + 0.05, cy, pilePos.z + 0.14);
    ctx.boardGroup.add(carrier);
    objs.push(carrier);

    return {
      objs: objs,
      digger: digger,
      carrier: carrier,
      mainPile: mainPile,
      edgePile: edgePile,
      pilePos: pilePos,
      edgePos: edgePos,
      cx: cx, cy: cy, cz: cz,
    };
  }

  // ============================================================
  // АНИМАЦИЯ
  // ============================================================
  function _createHillsAnim(cx, cy, cz, ctx) {
    return { cx: cx, cy: cy, cz: cz, time: 0 };
  }

  function _updateHillsAnim(state, dt, now) {
    if (!state) return;
    state.time += dt;
    const t = state.time;

    const decor = state._decor;
    if (!decor) return;

    const cx = decor.cx, cz = decor.cz, cy = decor.cy;
    const safeR = CFG.SAFE_ZONE_RADIUS;

    // --- Цикл тачки ---
    const cycle = (t * CFG.CARRIER_CYCLE_SPEED) % (Math.PI * 2);
    const prog = 0.5 - 0.5 * Math.cos(cycle);

    // --- Кучки ---
    const pileScale = CFG.PILE_MIN_SCALE + (CFG.PILE_MAX_SCALE - CFG.PILE_MIN_SCALE) * prog;
    if (decor.mainPile) decor.mainPile.scale.setScalar(pileScale);
    if (decor.edgePile) decor.edgePile.scale.setScalar(0.72 + 0.46 * prog);

    // --- Копатель: релокация каждые 13 сек ---
    const dg = decor.digger;
    if (dg) {
      if (!dg.userData.relocateTimer) {
        dg.userData.relocateTimer = CFG.DIGGER_RELOCATE_TIME;
        dg.userData.targetPos = { x: dg.position.x, z: dg.position.z };
        dg.userData.walking = false;
      }

      dg.userData.relocateTimer -= dt;
      if (dg.userData.relocateTimer <= 0) {
        dg.userData.relocateTimer = CFG.DIGGER_RELOCATE_TIME;
        dg.userData.targetPos = _pickDiggerPosition(cx, cz, decor.pilePos);
        dg.userData.walking = true;
      }

      // Плавное движение к цели
      if (dg.userData.walking) {
        const tp = dg.userData.targetPos;
        const dx = tp.x - dg.position.x;
        const dz = tp.z - dg.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.02) {
          dg.userData.walking = false;
        } else {
          const step = Math.min(CFG.DIGGER_WALK_SPEED * dt, dist);
          let nx = dg.position.x + (dx / dist) * step;
          let nz = dg.position.z + (dz / dist) * step;

          // Обход safe zone
          if (_inSafeZone(nx, nz, cx, cz, 0)) {
            const sdx = nx - cx, sdz = nz - cz;
            const sd = Math.hypot(sdx, sdz) || 1e-6;
            nx = cx + (sdx / sd) * safeR;
            nz = cz + (sdz / sd) * safeR;
          }
          // Ограничение гексом
          const cl = _clampToHex(nx, nz, cx, cz, _safeRadiusFor(0.05));
          dg.position.x = cl[0];
          dg.position.z = cl[1];

          // Поворот к цели
          const targetRot = Math.atan2(dx, dz);
          let dR = targetRot - dg.rotation.y;
          while (dR >  Math.PI) dR -= Math.PI * 2;
          while (dR < -Math.PI) dR += Math.PI * 2;
          dg.rotation.y += dR * Math.min(1, dt * CFG.WORKER_TURN_SMOOTH);

          // Шаги
          const walk = Math.sin(t * 11) * 0.22;
          if (dg.userData.legL) dg.userData.legL.rotation.x =  walk;
          if (dg.userData.legR) dg.userData.legR.rotation.x = -walk;
        }
      } else {
        // Стоит и копает — ноги на месте, лопата машет
        if (dg.userData.legL) dg.userData.legL.rotation.x *= 0.85;
        if (dg.userData.legR) dg.userData.legR.rotation.x *= 0.85;

        const digPhase = (t * CFG.DIG_ANIM_SPEED) % (Math.PI * 2);
        const swing = Math.sin(digPhase);
        if (dg.userData.torso) dg.userData.torso.rotation.x = swing * 0.12;
        if (dg.userData.shovel) {
          dg.userData.shovel.rotation.x = 0.3 + swing * 0.6;
          dg.userData.shovel.rotation.z = 0.5 + Math.cos(digPhase) * 0.1;
          dg.userData.shovel.position.y = 0.17 + Math.sin(digPhase * 2) * 0.02;
        }
      }
    }

    // --- Возчик ---
    const cr = decor.carrier;
    if (cr) {
      const barrow = cr.userData.barrow;
      const wheelPivot = barrow ? barrow.userData.wheel : null;
      const load = barrow ? barrow.userData.load : null;

      const start = decor.pilePos;
      const end = decor.edgePos;

      const px = start.x + (end.x - start.x) * prog;
      const pz = start.z + (end.z - start.z) * prog;

      cr.position.x = px;
      cr.position.z = pz;

      const dProg = Math.sin(cycle);
      const dirX = (end.x - start.x) * Math.sign(dProg || 1);
      const dirZ = (end.z - start.z) * Math.sign(dProg || 1);

      if (Math.abs(dirX) + Math.abs(dirZ) > 0.001) {
        const targetRot = Math.atan2(dirX, dirZ);
        let dR = targetRot - cr.rotation.y;
        while (dR >  Math.PI) dR -= Math.PI * 2;
        while (dR < -Math.PI) dR += Math.PI * 2;
        cr.rotation.y += dR * Math.min(1, dt * 4);
      }

      if (load) {
        const loadAmt = dProg > 0 ? 1 : 0.15;
        const cur = load.scale.y / 0.55;
        const next = cur + (loadAmt - cur) * Math.min(1, dt * 3);
        load.scale.set(1, 0.55 * next, 1.3);
        load.visible = next > 0.25;
      }

      if (wheelPivot) {
        wheelPivot.rotation.x += dt * 7 * (dProg > 0 ? 1 : -1);
      }

      const bob = Math.sin(t * 9) * 0.005;
      cr.position.y = cy + Math.abs(bob);

      const walk = Math.sin(t * 11) * 0.22;
      if (cr.userData.legL) cr.userData.legL.rotation.x =  walk;
      if (cr.userData.legR) cr.userData.legR.rotation.x = -walk;

      // На всякий случай — не пустить на цифру
      if (_inSafeZone(cr.position.x, cr.position.z, cx, cz, 0)) {
        const dx = cr.position.x - cx, dz = cr.position.z - cz;
        const d = Math.hypot(dx, dz) || 1e-6;
        cr.position.x = cx + (dx / d) * safeR;
        cr.position.z = cz + (dz / d) * safeR;
      }
    }
  }

  // ============================================================
  // ЭКСПОРТ
  // ============================================================
  window.HexHills = {
    create: function (cx, cy, cz, ctx) {
      const decorData = _buildHillsDecor(cx, cy, cz, ctx);
      const anim = _createHillsAnim(cx, cy, cz, ctx);
      anim._decor = decorData;
      anim._ctx = ctx;
      return { decor: decorData.objs, anim: anim };
    },
    update: function (state, dt, now) {
      if (state && state.anim) _updateHillsAnim(state.anim, dt, now);
    },
    destroy: function (state) {
      if (state && state.decor) {
        state.decor.forEach(function (o) { if (o.parent) o.parent.remove(o); });
      }
    }
  };

  console.log('[HexHills] OK — вязкая глина, рельеф, рабочие');
})();