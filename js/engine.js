/* ===========================================================================
   Выживание на Марсе за 100 дней — игровой движок (HTML5 Canvas, чистый JS)
   Глобальный объект G хранит состояние, помощники рисования, ввод и сцены.
   =========================================================================== */
(function () {
  "use strict";

  const G = (window.G = {});

  /* ---- Логическое разрешение (iPad, ландшафт 4:3) ---- */
  G.VIEW = { w: 1024, h: 768 };
  // Низкое «8-битное» разрешение бэкстора (4:3). Холст растягивается с image-rendering: pixelated.
  G.LOW_W = 384; G.LOW_H = 288;

  /* ---- Шрифт интерфейса ---- */
  G.FONT = "-apple-system, system-ui, sans-serif";
  G.f = (px, weight) => `${weight ? weight + " " : ""}${px}px ${G.FONT}`;
  const PAL = (G.PAL = {
    black: "#0b0712", night: "#15131f", dark: "#241712", darker: "#120a08",
    red: "#d12b29", orange: "#ef7d29", rust: "#7a2218", marsHi: "#e08a4a", marsMid: "#b8552a", marsLo: "#5a2718",
    sand: "#e6c170", sandMid: "#caa066", sandDk: "#9a743f", sandLo: "#6a4e28",
    white: "#fff1e8", cream: "#ffe6c8", grey: "#c2c3c7", greyDk: "#5f574f",
    steel: "#aeb7c2", steelMid: "#8a95a0", steelDk: "#3a4250", visor: "#29adff", visorLt: "#8ff1ff",
    green: "#33c24d", greenDk: "#1a7a3a", greenLt: "#8df0a0",
    purple: "#a86bff", yellow: "#ffd24a",
    stone: "#6e5746", stoneMid: "#5a4636", stoneDk: "#3a2c22", brick: "#6e5746", brickDk: "#4a3a2e",
    diamond: "#8ff1ff", diamondMid: "#5ac8ff", diamondDk: "#2a82c0",
  });

  /* ---- Состояние игры / инвентарь ---- */
  G.defaultState = function () {
    return {
      day: 1,
      battery: 100,
      minerals: 0,        // 0..3 собрано энергоминералов
      hasShovel: false,
      hasBlueprint: false,
      hasDrill: false,
      // Глава 2 — пост-бур:
      hasBaseBlueprint: false,
      superMinerals: 0,
      // Многоэтапная постройка базы:
      hasBaseFrame: false,    // 1) каркас
      hasBaseSolar: false,    // 2) солнечная панель
      hasBaseReactor: false,  // 3) реактор → база готова
      hasBase: false,
      baseDefended: false,    // отбита волновая осада базы (опц. испытание)
      // Улучшения базы-крепости (строятся на карте за супер-минералы):
      baseTurrets: 0,         // пушки обороны (0..3) — авто-огонь по врагам
      baseFence: 0,           // энергозабор (0..2) — тормозит врагов
      hasTurretBlueprint: false, // чертёж турели (найти в шахтах, затем печатать)
      hasFenceBlueprint: false,  // чертёж энергозабора
      printerTier: 0,            // апгрейд 3D-принтера (нужен для печати забора)
      baseReactorLvl: 1,      // реактор базы (1..3) — мощнее зарядка/оборона
      baseThreat: 0,          // накопление угрозы нападения (0..1)
      baseHP: 100,            // прочность базы (катаклизмы вредят, чинить за супер)
      mapEvent: null,         // активное событие карты (метеорит/сигнал бедствия)
      // Апгрейды робота (печатаются на базе за супер-минералы):
      upgShield: false,       // броня — урон −40%
      upgSpeed: false,        // ускорение — скорость +25%
      upgBattery: false,      // ёмкая батарея — разряд −25%, солнце мощнее
      upgPunch: false,        // усиленный удар — двойной урон + шире зона
      hasDrone: true,         // дрон-помощник «Лев» летает рядом с самого начала
      logs: 0,                // найденные дневники экспедиции (0..3)
      logIds: {},             // какие дневники уже прочитаны
      mapSites: [],           // карта Марса: шахты (генерятся при первом входе)
      mapArtifacts: [],       // древние артефакты-аномалии на карте (дают плюшки)
      roverX: null, roverY: null, // позиция ровера на карте (едет к локациям)
      mapExplored: [],        // маяки исследованной территории (открывают туман)
      artBattery: false,      // плюшка: −15% разряд батареи
      artMapReveal: false,    // плюшка: карта раскрыта (как сканер)
      hasSwordBlueprint: false,
      hasSword: false,
      bossDefeated: false,
      _bossSeen: false,
      // Глава 3 — сканер древних и космический корабль:
      hasScannerBlueprint: false, // выпадает с поверженного босса
      wonderMinerals: 0,          // чудо-минералы (нужно 2)
      hasZCrystal: false,         // Z-кристалл (нужен 1)
      hasScanner: false,          // сканер напечатан → x-ray зрение
      hasArtifact: false,         // артефакт аккуратно откопан
      printerUpgraded: false,     // артефакт вставлен в принтер
      // Сборка древнего корабля (многоэтапно):
      hasShipHull: false,         // корпус
      hasShipWings: false,        // крылья/шасси
      hasShipEngine: false,       // двигатель
      fuelUnits: 0,               // топливо (нужно 2) — добывается в шахтах
      navMaps: 0,                 // навигационные карты (нужно 2) — добываются в шахтах
      shipLaunched: false,        // корабль запущен → финал
      _sawMapIntro: false,        // показали кат-сцену первого выхода на карту
      _tutMap: false, _tutBase: false, // показаны подсказки-онбординг (карта/база)
      // Крафт расходников: лом выпадает с врагов, тратится на верстаке
      scrap: 0,
      cons: { medkit: 0, emp: 0, mine: 0 },
      deaths: 0,                  // счётчик разрядов (влияет на ранг + стоит дней)
      // Глава 2 — ледяная луна (после побега с Марса):
      iceCores: 0,            // собранные крио-ядра на поверхности (нужно 3)
      hasFrostCrystal: false, // морозный кристалл-катализатор (добыт в пещере)
      iceBossDefeated: false, // Морозный Страж повержен
      hasGuardianCore: false, // сердечник Стража (выпадает с босса)
      hasJumpDrive: false,    // прыжковый двигатель собран → финал
      iceLogs: 0,             // найденные ледяные дневники (лор)
      upgIceCleats: false,    // ледовые шипы на колёса: цепкость + −холод
      _iceStarted: false,     // выдан стартовый набор главы 2
      sound: true,
    };
  };
  G.state = G.defaultState();
  G.resetState = function () { G.state = G.defaultState(); G.dayCycle = 0.42; };

  /* ---- Уровни сложности (от детского до хардкора) ----
     eHp — HP врагов, eDmg — урон по роботу, drain — расход батареи,
     recharge — солнечная подзарядка базы, deathPenalty — штраф за разряд,
     floor — заряд после аварийного перезапуска. */
  const DIFFICULTY = [
    { key: "easy",     name: "Лёгкий",  icon: "🟢", eHp: 0.55, eDmg: 0.45, drain: 0.55, recharge: 1.8, deathPenalty: 0.0, floor: 70, hint: "для самых маленьких — враги слабее, заряд не садится, без штрафов" },
    { key: "normal",   name: "Обычный", icon: "🟡", eHp: 1.0,  eDmg: 1.0,  drain: 1.0,  recharge: 1.0, deathPenalty: 1.0, floor: 48, hint: "сбалансированно — как задумано" },
    { key: "hard",     name: "Сложный", icon: "🟠", eHp: 1.4,  eDmg: 1.4,  drain: 1.25, recharge: 0.8, deathPenalty: 1.5, floor: 40, hint: "для опытных — враги крепче и больнее" },
    { key: "hardcore", name: "Хардкор", icon: "🔴", eHp: 1.85, eDmg: 1.9,  drain: 1.5,  recharge: 0.55, deathPenalty: 2.2, floor: 28, hint: "без права на ошибку — каждый разряд дорог" },
  ];
  G.DIFFICULTY = DIFFICULTY;
  G.difficulty = 1;
  try { const d = localStorage.getItem("mars_difficulty"); if (d != null) G.difficulty = clamp(parseInt(d, 10) || 0, 0, 3); } catch (e) {}
  G.diff = function () { return DIFFICULTY[G.difficulty] || DIFFICULTY[1]; };
  G.setDifficulty = function (i) { G.difficulty = clamp(i | 0, 0, 3); try { localStorage.setItem("mars_difficulty", G.difficulty); } catch (e) {} };
  G.cycleDifficulty = function () { G.setDifficulty((G.difficulty + 1) % DIFFICULTY.length); };

  /* ---- Сохранение прогресса (localStorage автосейв) ---- */
  const SAVE_KEY = "mars_save_v1";
  G.saveGame = function () {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state: G.state, dayCycle: G.dayCycle, room: G._lastRoom || "surface" })); } catch (e) {}
  };
  G.hasSave = function () { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };
  G.loadGame = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null;
      const d = JSON.parse(raw);
      G.state = Object.assign(G.defaultState(), d.state || {}); // merge — новые поля берут дефолт
      G.dayCycle = (d.dayCycle != null) ? d.dayCycle : 0.42;
      return d.room || "surface";
    } catch (e) { return null; }
  };
  G.clearSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} };

  /* ---- Математика ---- */
  const clamp = (G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v));
  const lerp = (G.lerp = (a, b, t) => a + (b - a) * t);
  const dist = (G.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by));
  G.rectHit = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  /* =========================================================================
     ВВОД: клавиатура + указатель (мышь/тач) + динамический джойстик
     ========================================================================= */
  const input = (G.input = {
    keys: {},
    joy: { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, mag: 0 },
    pointer: { x: 0, y: 0, down: false },
  });

  // Вектор движения из клавиш + джойстика, нормализованный (|v| <= 1)
  G.moveDir = function () {
    let x = 0, y = 0;
    const k = input.keys;
    if (k.ArrowLeft || k.KeyA) x -= 1;
    if (k.ArrowRight || k.KeyD) x += 1;
    if (k.ArrowUp || k.KeyW) y -= 1;
    if (k.ArrowDown || k.KeyS) y += 1;
    if (input.joy.active && input.joy.mag > 0.12) {
      x += input.joy.dx;
      y += input.joy.dy;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  };

  G.actionPressed = false; // одноразовый импульс «Действие» (E/Space/Enter/кнопка)

  function toLogical(clientX, clientY) {
    const r = G.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * G.VIEW.w,
      y: ((clientY - r.top) / r.height) * G.VIEW.h,
    };
  }
  G.toLogical = toLogical;

  // Зоны UI, по которым НЕ запускается джойстик (кнопки и т.п.).
  // Сцена может задать G.uiBlock = [{x,y,w,h}, ...] на кадр.
  G.uiBlock = [];
  function inUiBlock(x, y) {
    for (const b of G.uiBlock) if (G.rectHit(b, x, y)) return true;
    return false;
  }

  G.initInput = function () {
    const cv = G.canvas;

    window.addEventListener("keydown", (e) => {
      if (e.repeat) { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault(); return; }
      input.keys[e.code] = true;
      if (e.code === "KeyE" || e.code === "Space" || e.code === "Enter") {
        G.actionPressed = true;
        const s = G.scene;
        if (s && s.onAction) s.onAction();
      }
      // рывок: Shift
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        const s = G.scene; if (s && s.onDash) s.onDash();
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => { input.keys[e.code] = false; });

    const onDown = (id, cx, cy) => {
      G.audio.resume();
      const p = toLogical(cx, cy);
      input.pointer.x = p.x; input.pointer.y = p.y; input.pointer.down = true;
      p.id = id; p.t0 = performance.now(); p.moved = 0; p.sx = p.x; p.sy = p.y;
      pointerStarts[id] = p;

      const s = G.scene;
      if (s && s.onPointerDown) s.onPointerDown(p.x, p.y);

      // запуск джойстика, если сцена это позволяет и тап не по UI
      if (s && s.useJoystick && !input.joy.active && !inUiBlock(p.x, p.y)) {
        input.joy.active = true;
        input.joy.id = id;
        input.joy.ox = p.x; input.joy.oy = p.y;
        input.joy.x = p.x; input.joy.y = p.y;
        input.joy.dx = 0; input.joy.dy = 0; input.joy.mag = 0;
      }
    };

    const onMove = (id, cx, cy) => {
      const p = toLogical(cx, cy);
      input.pointer.x = p.x; input.pointer.y = p.y;
      const st = pointerStarts[id];
      if (st) st.moved = Math.max(st.moved, dist(st.sx, st.sy, p.x, p.y));

      if (input.joy.active && input.joy.id === id) {
        const R = 78;
        let dx = p.x - input.joy.ox, dy = p.y - input.joy.oy;
        const m = Math.hypot(dx, dy);
        if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
        input.joy.x = input.joy.ox + dx;
        input.joy.y = input.joy.oy + dy;
        input.joy.dx = dx / R; input.joy.dy = dy / R;
        input.joy.mag = Math.min(1, m / R);
      }
      const s = G.scene;
      if (s && s.onPointerMove) s.onPointerMove(p.x, p.y);
    };

    const onUp = (id, cx, cy) => {
      const p = toLogical(cx, cy);
      const st = pointerStarts[id];
      const s = G.scene;
      if (s && s.onPointerUp) s.onPointerUp(p.x, p.y);
      // тап = короткое касание без существенного сдвига
      if (st && st.moved < 14 && performance.now() - st.t0 < 400) {
        if (s && s.onTap) s.onTap(p.x, p.y);
      }
      if (input.joy.id === id) {
        input.joy.active = false; input.joy.id = null;
        input.joy.dx = 0; input.joy.dy = 0; input.joy.mag = 0;
      }
      delete pointerStarts[id];
      if (Object.keys(pointerStarts).length === 0) input.pointer.down = false;
    };

    const pointerStarts = {};

    if (window.PointerEvent) {
      cv.addEventListener("pointerdown", (e) => { e.preventDefault(); onDown(e.pointerId, e.clientX, e.clientY); }, { passive: false });
      cv.addEventListener("pointermove", (e) => { onMove(e.pointerId, e.clientX, e.clientY); }, { passive: false });
      window.addEventListener("pointerup", (e) => { onUp(e.pointerId, e.clientX, e.clientY); });
      window.addEventListener("pointercancel", (e) => { onUp(e.pointerId, e.clientX, e.clientY); });
    } else {
      cv.addEventListener("mousedown", (e) => { e.preventDefault(); onDown("m", e.clientX, e.clientY); });
      window.addEventListener("mousemove", (e) => { onMove("m", e.clientX, e.clientY); });
      window.addEventListener("mouseup", (e) => { onUp("m", e.clientX, e.clientY); });
      cv.addEventListener("touchstart", (e) => { e.preventDefault(); for (const t of e.changedTouches) onDown(t.identifier, t.clientX, t.clientY); }, { passive: false });
      cv.addEventListener("touchmove", (e) => { e.preventDefault(); for (const t of e.changedTouches) onMove(t.identifier, t.clientX, t.clientY); }, { passive: false });
      cv.addEventListener("touchend", (e) => { for (const t of e.changedTouches) onUp(t.identifier, t.clientX, t.clientY); });
    }
  };

  /* =========================================================================
     ЗВУК: лёгкие синтезированные тоны через WebAudio
     ========================================================================= */
  G.audio = {
    ctx: null,
    resume() {
      if (!G.state.sound) return;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
        // запускаем фоновую музыку под текущую сцену (после жеста пользователя)
        if (G.music) { G.music.setScene(G.scene ? G.scene.name : "menu"); }
      } catch (e) {}
    },
    tone(freq, dur, type = "square", vol = 0.06) {
      if (!G.state.sound || !this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    },
    blip() { this.tone(660, 0.07, "square", 0.05); },
    pickup() { this.tone(520, 0.08); this.tone(780, 0.12); setTimeout(() => this.tone(1040, 0.14), 70); },
    hit() { this.tone(140, 0.18, "sawtooth", 0.09); },
    door() { this.tone(220, 0.18, "triangle", 0.07); setTimeout(() => this.tone(330, 0.22, "triangle", 0.07), 120); },
    boom() {
      if (!G.state.sound || !this.ctx) return;
      const t = this.ctx.currentTime, b = this.ctx.createBuffer(1, 4410 * 2, 44100);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = this.ctx.createBufferSource(); src.buffer = b;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      src.connect(g); g.connect(this.ctx.destination); src.start(t);
    },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.08), i * 130)); },
  };

  /* =========================================================================
     ПРОЦЕДУРНАЯ ФОНОВАЯ МУЗЫКА — лёгкий step-секвенсор поверх WebAudio
     Настроения подбираются по сцене; громкость низкая (эмбиент, не мешает).
     ========================================================================= */
  // Настроения: bpm, корневая нота (Гц), лад (полутона), басовый и арп-узор (индексы лада).
  const MUSIC_MOODS = {
    calm:    { bpm: 68,  root: 196.0, scale: [0, 3, 5, 7, 10], bass: [0, 0, 3, 5], arp: [0, 2, 4, 2, 3, 2, 1, 0], bassType: "triangle", leadType: "sine",     vol: 0.085 },
    mystery: { bpm: 58,  root: 174.6, scale: [0, 2, 3, 7, 8],  bass: [0, 0, 4, 3], arp: [0, 3, 4, 2, 4, 3, 1, 2], bassType: "sine",     leadType: "triangle", vol: 0.07  },
    tense:   { bpm: 122, root: 110.0, scale: [0, 2, 3, 5, 7, 8, 10], bass: [0, 0, 3, 0, 5, 5, 3, 0], arp: [0, 4, 6, 4, 2, 4, 6, 7], bassType: "sawtooth", leadType: "square", vol: 0.075 },
    triumph: { bpm: 96,  root: 130.8, scale: [0, 2, 4, 5, 7, 9, 11], bass: [0, 0, 4, 4, 5, 5, 3, 3], arp: [0, 2, 4, 6, 4, 6, 4, 2], bassType: "triangle", leadType: "square", vol: 0.08 },
  };
  // Сопоставление сцен с настроением (по имени). Без записи → дефолт calm.
  const SCENE_MOOD = {
    menu: "calm", challenges: "calm", base_manage: "calm", printer: "calm", mars_map: "calm",
    surface: "calm", sand: "calm", drill_site: "calm",
    tomb_entrance: "mystery", arrows: "mystery", falling_tiles: "mystery", mummies: "mystery", scarab: "mystery",
    mineral1: "mystery", mineral2: "mystery", mineral3: "mystery", xray_field: "mystery", mirror_hall: "mystery",
    coliseum: "tense", base_defense: "tense", arena: "tense", sandstorm: "tense", flooded_hall: "tense", sphinx: "tense",
    final_victory: "triumph", victory: "triumph",
  };

  G.music = {
    master: null, filter: null, mood: null, step: 0, nextT: 0, playing: false,
    ensure() {
      const ac = G.audio.ctx; if (!ac) return false;
      if (!this.master) {
        this.filter = ac.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = 1400;
        this.master = ac.createGain(); this.master.gain.value = 0.9;
        this.filter.connect(this.master); this.master.connect(ac.destination);
      }
      return true;
    },
    setMood(mood) {
      if (!MUSIC_MOODS[mood]) mood = "calm";
      if (this.mood === mood) { this.start(); return; }
      this.mood = mood;
      this.start();
    },
    setScene(name) { this.setMood(SCENE_MOOD[name] || "calm"); },
    start() {
      if (!G.state.sound) return;
      if (!this.ensure()) return;
      if (!this.playing) { this.playing = true; this.nextT = G.audio.ctx.currentTime + 0.08; }
    },
    stop() {
      this.playing = false;
      if (this.master && G.audio.ctx) {
        const t = G.audio.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(this.master.gain.value, t);
        this.master.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      }
    },
    note(freq, time, dur, type, vol) {
      const ac = G.audio.ctx; if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(vol, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(this.filter);
      o.start(time); o.stop(time + dur + 0.05);
    },
    tick() {
      if (!this.playing || !this.mood || !G.state.sound) return;
      const ac = G.audio.ctx; if (!ac) return;
      if (this.master) { // плавно поднимаем громкость после start
        const target = 0.9;
        if (Math.abs(this.master.gain.value - target) > 0.01) this.master.gain.setTargetAtTime(target, ac.currentTime, 0.4);
      }
      const m = MUSIC_MOODS[this.mood];
      const stepDur = 60 / m.bpm / 2; // восьмые
      let guard = 0;
      while (this.nextT < ac.currentTime + 0.3 && guard++ < 32) {
        const s = this.step;
        const deg2semi = (d) => m.scale[((d % m.scale.length) + m.scale.length) % m.scale.length];
        // бас — на каждую долю (каждый 2-й шаг)
        if (s % 2 === 0) {
          const bsemi = m.bass[(s / 2) % m.bass.length];
          this.note(m.root * Math.pow(2, bsemi / 12) / 2, this.nextT, stepDur * 1.7, m.bassType, m.vol * 1.15);
        }
        // ведущий арпеджио — на каждую восьмую
        const asemi = deg2semi(m.arp[s % m.arp.length]);
        this.note(m.root * 2 * Math.pow(2, asemi / 12), this.nextT, stepDur * 0.85, m.leadType, m.vol * 0.55);
        // редкое «эхо» через октаву для воздуха
        if (s % 4 === 2) this.note(m.root * 4 * Math.pow(2, asemi / 12), this.nextT + stepDur * 0.5, stepDur * 0.4, m.leadType, m.vol * 0.22);
        this.nextT += stepDur;
        this.step = (this.step + 1) % 16;
      }
    },
  };

  /* =========================================================================
     ЭФФЕКТЫ: частицы (взрыв, пыль, искры принтера)
     ========================================================================= */
  G.fx = {
    parts: [],
    rings: [],
    burst(x, y, color, n = 24, spread = 240, life = 0.8) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * spread;
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color, r: 2 + Math.random() * 3 });
      }
    },
    // Ударная волна-кольцо (для попаданий/взрывов) — «боевой сок»
    ring(x, y, color = "#fff2c2", maxR = 60, life = 0.35) {
      this.rings.push({ x, y, color, r: 6, maxR, life, max: life });
    },
    update(dt) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life -= dt; if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.vx *= 0.98;
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt; if (r.life <= 0) { this.rings.splice(i, 1); continue; }
        r.r = r.maxR * (1 - r.life / r.max);
      }
    },
    draw(ctx) {
      for (const p of this.parts) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
      for (const r of this.rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = clamp(k, 0, 1) * 0.8;
        ctx.strokeStyle = r.color; ctx.lineWidth = 2 + 4 * k;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    clear() { this.parts.length = 0; this.rings.length = 0; },
  };

  /* =========================================================================
     БОЕВОЙ СОК: тряска экрана + hit-stop (короткая заморозка удара)
     ========================================================================= */
  G.shakeAmt = 0;
  G.shake = function (amt) { G.shakeAmt = Math.min(18, Math.max(G.shakeAmt, amt)); };
  G.hitStopT = 0;
  G.hitStop = function (sec) { G.hitStopT = Math.max(G.hitStopT, sec); };

  /* =========================================================================
     МЕНЕДЖЕР СЦЕН + переход с затемнением
     ========================================================================= */
  G.scenes = {};
  G.scene = null;
  G.time = 0;
  const fade = { a: 0, dir: 0, next: null, cb: null };

  /* ---- Цикл день/ночь ---- */
  // dayCycle: 0..1 за полный круг (0 — полночь, 0.5 — полдень). Старт — день.
  G.dayCycle = 0.42;
  const DAY_PERIOD = 105; // секунд на полный цикл день+ночь
  // sunHeight: -1 (глубокая ночь) … +1 (полдень)
  G.sunHeight = function () { return -Math.cos(G.dayCycle * Math.PI * 2); };
  G.daylight = function () { return clamp(G.sunHeight(), 0, 1); };       // 0 ночью … 1 в полдень
  // множитель разряда батареи: ночью тратим больше, днём меньше
  G.dayDrainFactor = function () { return 1.5 - 0.65 * G.daylight(); };
  G.isNight = function () { return G.sunHeight() < -0.1; };
  // Глобальный оверлей атмосферы (рисуется только в игровых комнатах)
  G.dayNightOverlay = function (ctx) {
    const sh = G.sunHeight();
    if (sh >= 0.6) return; // яркий полдень — без налёта
    let r, g, b, a;
    if (sh < 0) { a = 0.12 + (-sh) * 0.34; r = 18; g = 30; b = 74; }       // ночь — синий
    else { a = (0.6 - sh) * 0.42; r = 96; g = 46; b = 20; }                // закат/рассвет — тёплый
    ctx.save();
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    ctx.fillRect(0, 0, G.VIEW.w, G.VIEW.h);
    // звёзды в ночи (детерминированные позиции, мерцание через time)
    if (sh < -0.05) {
      const sa = clamp(-sh, 0, 1);
      for (let i = 0; i < 36; i++) {
        const x = (i * 137.5) % G.VIEW.w;
        const y = (i * 61.7) % (G.VIEW.h * 0.55);
        const tw = 0.4 + 0.6 * (Math.sin(G.time * 2 + i) + 1) / 2;
        ctx.fillStyle = `rgba(220,235,255,${(0.5 * sa * tw).toFixed(3)})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.restore();
  };

  G.addScene = function (name, scene) { scene.name = name; G.scenes[name] = scene; };

  G.go = function (name, instant) {
    const target = G.scenes[name];
    if (!target) { console.warn("Нет сцены:", name); return; }
    if (instant) { swap(target); return; }
    fade.dir = 1; fade.next = target; // затемняем, затем меняем
  };

  function swap(target) {
    if (G.scene && G.scene.exit) G.scene.exit();
    G.fx.clear();
    G.scene = target;
    if (target.dayValue) {
      // пост-базовая часть кампании длинная — сжимаем dayValue>84, чтобы счётчик
      // не вылезал за 100 («за 100 дней»). Ранняя часть (≤84) не трогается.
      let dv = target.dayValue;
      if (dv > 84) dv = Math.round(84 + (dv - 84) * 0.25);
      G.state.day = Math.min(100, Math.max(G.state.day, dv));
    }
    if (target.recharge !== false) G.state.battery = Math.min(100, G.state.battery + 12); // небольшой отдых при переходе
    if (target.enter) target.enter();
    if (G.music) G.music.setScene(target.name); // подобрать фоновую музыку под сцену
    // автосейв на каждом переходе, кроме финальных экранов (там — отдельная логика)
    if (G.saveGame && !["menu", "gameover", "final_victory", "victory"].includes(target.name)) G.saveGame();
  }

  function updateFade(dt) {
    if (fade.dir === 1) {
      fade.a += dt * 2.6;
      if (fade.a >= 1) { fade.a = 1; swap(fade.next); fade.next = null; fade.dir = -1; }
    } else if (fade.dir === -1) {
      fade.a -= dt * 2.6;
      if (fade.a <= 0) { fade.a = 0; fade.dir = 0; }
    }
  }

  /* =========================================================================
     РИСОВАНИЕ: робот, окружение, UI-помощники
     ========================================================================= */
  // Робот-марсоход. face: 1 вправо, -1 влево. walk — фаза анимации шага.
  G.drawRobot = function (ctx, x, y, r, face = 1, walk = 0, glow = "#8fe9ff") {
    const t = G.time;
    const step = Math.sin(walk * 9);
    const bob = step * 2.0 * (r / 22) + Math.sin(t * 2) * 0.8 * (r / 22); // шаг + лёгкое парение
    const u = r / 22;
    ctx.save();
    ctx.translate(x, y + bob);

    // мягкая тень (не зеркалится)
    ctx.save();
    ctx.globalAlpha = 0.3;
    const sh = ctx.createRadialGradient(0, r * 1.12, 2, 0, r * 1.12, r * 1.05);
    sh.addColorStop(0, "rgba(0,0,0,0.55)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.ellipse(0, r * 1.12 - bob * 0.4, r * 1.0, r * 0.32, 0, 0, 7); ctx.fill();
    ctx.restore();

    ctx.scale(face, 1);
    ctx.lineJoin = "round";

    // --- дальняя рука (за корпусом) ---
    const arm = (sx, behind) => {
      const sway = Math.sin(walk * 9 + (sx > 0 ? 0 : Math.PI)) * 0.22 + 0.05;
      ctx.save();
      ctx.translate(sx * r * 0.74, -r * 0.18);
      ctx.rotate(sway);
      ctx.fillStyle = behind ? "#828b95" : "#a7b0ba";
      rr(ctx, -r * 0.13, 0, r * 0.26, r * 0.5, r * 0.12); ctx.fill();
      ctx.fillStyle = behind ? "#5f676f" : "#788089";
      ctx.beginPath(); ctx.arc(0, r * 0.52, r * 0.16, 0, 7); ctx.fill();
      ctx.restore();
    };
    arm(-1, true);

    // --- база / колёса ---
    const baseG = ctx.createLinearGradient(0, r * 0.3, 0, r * 0.98);
    baseG.addColorStop(0, "#3c434c"); baseG.addColorStop(1, "#1b1f25");
    ctx.fillStyle = baseG;
    rr(ctx, -r * 0.96, r * 0.32, r * 1.92, r * 0.64, r * 0.28); ctx.fill();
    const cleats = G.state && G.state.upgIceCleats;
    for (const wx of [-r * 0.52, r * 0.52]) {
      ctx.fillStyle = "#14171b"; ctx.beginPath(); ctx.arc(wx, r * 0.7, r * 0.27, 0, 7); ctx.fill();
      // ледовые шипы по ободу (апгрейд против скольжения)
      if (cleats) {
        ctx.save(); ctx.translate(wx, r * 0.7); ctx.rotate(walk * 6);
        ctx.fillStyle = "#dff2ff";
        for (let k = 0; k < 8; k++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath(); ctx.moveTo(-r * 0.05, -r * 0.27); ctx.lineTo(r * 0.05, -r * 0.27); ctx.lineTo(0, -r * 0.4); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      ctx.fillStyle = "#2c323a"; ctx.beginPath(); ctx.arc(wx, r * 0.7, r * 0.16, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(wx, r * 0.7); ctx.rotate(walk * 6);
      ctx.strokeStyle = cleats ? "#7fb4d8" : "#4a525c"; ctx.lineWidth = 2 * u; ctx.lineCap = "round";
      for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-r * 0.13, 0); ctx.lineTo(r * 0.13, 0); ctx.stroke(); }
      ctx.restore();
    }

    // --- корпус ---
    const body = ctx.createLinearGradient(-r * 0.7, -r * 0.6, r * 0.7, r * 0.55);
    body.addColorStop(0, "#f4f7fa"); body.addColorStop(0.45, "#ccd3da"); body.addColorStop(1, "#959fa9");
    ctx.fillStyle = body;
    rr(ctx, -r * 0.8, -r * 0.62, r * 1.6, r * 1.12, r * 0.28); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2.4 * u; ctx.stroke();
    // боковая панель-тень + блик сверху
    ctx.fillStyle = "rgba(70,78,88,0.45)";
    rr(ctx, r * 0.44, -r * 0.5, r * 0.3, r * 0.96, r * 0.12); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    rr(ctx, -r * 0.66, -r * 0.54, r * 0.9, r * 0.12, r * 0.06); ctx.fill();
    // болты
    ctx.fillStyle = "#7c8590";
    for (const bx of [-r * 0.62, r * 0.62]) for (const by of [-r * 0.42, r * 0.4]) { ctx.beginPath(); ctx.arc(bx, by, r * 0.06, 0, 7); ctx.fill(); }

    // --- грудной индикатор (свечение) ---
    const cg = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 0.34);
    cg.addColorStop(0, "#d6ffe0"); cg.addColorStop(0.45, "#5fd06a"); cg.addColorStop(1, "rgba(95,208,106,0)");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, r * 0.02, r * 0.34, 0, 7); ctx.fill();
    ctx.fillStyle = "#2f8f3e"; ctx.beginPath(); ctx.arc(0, r * 0.02, r * 0.1, 0, 7); ctx.fill();

    // --- ближняя рука ---
    arm(1, false);

    // --- шея ---
    ctx.fillStyle = "#8b95a0"; rr(ctx, -r * 0.22, -r * 0.78, r * 0.44, r * 0.22, r * 0.06); ctx.fill();

    // --- голова ---
    const headG = ctx.createLinearGradient(0, -r * 1.34, 0, -r * 0.5);
    headG.addColorStop(0, "#f1f5f9"); headG.addColorStop(1, "#a9b2bb");
    ctx.fillStyle = headG;
    rr(ctx, -r * 0.62, -r * 1.34, r * 1.24, r * 0.84, r * 0.3); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2.4 * u; ctx.stroke();
    // визор (тёмное стекло)
    ctx.fillStyle = "#0e151b";
    rr(ctx, -r * 0.5, -r * 1.18, r * 1.0, r * 0.54, r * 0.22); ctx.fill();
    // свечение глаза + зрачок (плавно водит)
    const ex = Math.sin(t * 1.2) * r * 0.14, ey = -r * 0.9;
    const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, r * 0.34);
    eg.addColorStop(0, "#ffffff"); eg.addColorStop(0.28, glow); eg.addColorStop(1, "rgba(40,173,255,0)");
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(ex, ey, r * 0.32, 0, 7); ctx.fill();
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ex, ey, r * 0.14, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + r * 0.05, ey - r * 0.05, r * 0.05, 0, 7); ctx.fill();
    // блик на стекле
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    rr(ctx, -r * 0.5, -r * 1.18, r * 1.0, r * 0.16, r * 0.1); ctx.fill();

    // --- антенна с огоньком ---
    ctx.strokeStyle = "#6b737d"; ctx.lineWidth = 2.4 * u; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.02, -r * 1.32); ctx.lineTo(r * 0.16, -r * 1.66); ctx.stroke();
    const blink = (Math.sin(t * 6) + 1) / 2;
    const ag = ctx.createRadialGradient(r * 0.16, -r * 1.7, 0, r * 0.16, -r * 1.7, r * 0.42);
    ag.addColorStop(0, `rgba(255,120,90,${0.45 + blink * 0.5})`); ag.addColorStop(1, "rgba(255,120,90,0)");
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(r * 0.16, -r * 1.7, r * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = `rgb(255,${Math.round(80 + blink * 70)},70)`;
    ctx.beginPath(); ctx.arc(r * 0.16, -r * 1.7, r * 0.12, 0, 7); ctx.fill();

    ctx.restore();
  };

  // скруглённый прямоугольник
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  G.rr = rr;

  // Каменные стены + пол гробницы внутри bounds
  G.drawTombRoom = function (ctx, b, opt = {}) {
    const W = G.VIEW.w, H = G.VIEW.h;
    // фон вне комнаты
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, opt.top || "#241712"); bg.addColorStop(1, opt.bot || "#120a08");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // пол
    const floor = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    floor.addColorStop(0, opt.floorTop || "#5a4636"); floor.addColorStop(1, opt.floorBot || "#3a2c22");
    ctx.fillStyle = floor; ctx.fillRect(b.x, b.y, b.w, b.h);
    // плитка пола
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2;
    for (let gx = b.x; gx <= b.x + b.w; gx += 64) { ctx.beginPath(); ctx.moveTo(gx, b.y); ctx.lineTo(gx, b.y + b.h); ctx.stroke(); }
    for (let gy = b.y; gy <= b.y + b.h; gy += 64) { ctx.beginPath(); ctx.moveTo(b.x, gy); ctx.lineTo(b.x + b.w, gy); ctx.stroke(); }

    // каменная рамка-стены
    const th = 26;
    drawBricks(ctx, b.x - th, b.y - th, b.w + th * 2, th, true);   // верх
    drawBricks(ctx, b.x - th, b.y + b.h, b.w + th * 2, th, true);  // низ
    drawBricks(ctx, b.x - th, b.y, th, b.h, false);                // лево
    drawBricks(ctx, b.x + b.w, b.y, th, b.h, false);               // право

    // декор: иероглифический фриз вдоль верхней стены
    for (let fx = b.x + 90; fx < b.x + b.w - 90; fx += 72) {
      if (fx > b.x && fx < b.x + 64) continue;            // место под левый факел
      if (fx > b.x + b.w - 64 && fx < b.x + b.w) continue; // под правый факел
      const k = (Math.abs((fx * 13) | 0)) % 4;
      ctx.save(); ctx.translate(fx, b.y - th / 2);
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(-9, -8, 18, 16);
      ctx.fillStyle = "rgba(220,180,120,0.45)";
      ctx.strokeStyle = "rgba(220,180,120,0.5)"; ctx.lineWidth = 1.1;
      if (k === 0) {
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 2.5, 0, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, 7); ctx.fill();
      } else if (k === 1) {
        ctx.fillRect(-0.5, -2, 1, 7); ctx.fillRect(-4, 1, 8, 1);
        ctx.beginPath(); ctx.arc(0, -4, 2, 0, 7); ctx.stroke();
      } else if (k === 2) {
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
          ctx.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
          ctx.stroke();
        }
      } else {
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-5, 4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // трещины на стенах (детерминированные)
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    for (const x of [220, 420, 620, 820]) {
      ctx.beginPath();
      ctx.moveTo(b.x + x, b.y - th + 2);
      ctx.lineTo(b.x + x + 5, b.y - th + 9);
      ctx.lineTo(b.x + x - 3, b.y - th + 16);
      ctx.lineTo(b.x + x + 4, b.y - 4);
      ctx.stroke();
    }
    for (const x of [140, 360, 560, 760]) {
      ctx.beginPath();
      ctx.moveTo(b.x + x, b.y + b.h + 2);
      ctx.lineTo(b.x + x - 5, b.y + b.h + 9);
      ctx.lineTo(b.x + x + 3, b.y + b.h + 16);
      ctx.lineTo(b.x + x - 2, b.y + b.h + 22);
      ctx.stroke();
    }
    for (const y of [80, 230, 380]) {
      ctx.beginPath();
      ctx.moveTo(b.x - 2, b.y + y);
      ctx.lineTo(b.x - 10, b.y + y + 5);
      ctx.lineTo(b.x - 18, b.y + y - 3);
      ctx.lineTo(b.x - 24, b.y + y + 4);
      ctx.stroke();
    }
    for (const y of [120, 280, 440]) {
      ctx.beginPath();
      ctx.moveTo(b.x + b.w + 2, b.y + y);
      ctx.lineTo(b.x + b.w + 10, b.y + y + 5);
      ctx.lineTo(b.x + b.w + 18, b.y + y - 3);
      ctx.lineTo(b.x + b.w + 24, b.y + y + 4);
      ctx.stroke();
    }
    // тонкие царапины-трещины на полу (ближе к стенам)
    ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = 1;
    const _fp = [[80, 100], [80, 380], [b.w - 100, 200], [b.w - 80, 420], [180, 50], [580, 480], [340, 50]];
    for (const fp of _fp) {
      const fx = b.x + fp[0], fy = b.y + fp[1];
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + 22, fy + 3);
      ctx.lineTo(fx + 40, fy - 2);
      ctx.lineTo(fx + 56, fy + 5);
      ctx.stroke();
    }
    // виньетка для глубины (до факелов — чтобы свет оставался ярким)
    G.vignette(ctx, 0.4);
    if (opt.torches !== false) {
      drawTorch(ctx, b.x + 30, b.y - 4);
      drawTorch(ctx, b.x + b.w - 30, b.y - 4);
    }
    G.dust(ctx, b, 26);
  };

  function drawBricks(ctx, x, y, w, h, horizontal) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, "#6e5746"); grad.addColorStop(1, "#4a3a2e");
    ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2;
    const bw = 52;
    if (horizontal) {
      for (let i = x; i < x + w; i += bw) { ctx.beginPath(); ctx.moveTo(i, y); ctx.lineTo(i, y + h); ctx.stroke(); }
    } else {
      for (let i = y; i < y + h; i += bw) { ctx.beginPath(); ctx.moveTo(x, i); ctx.lineTo(x + w, i); ctx.stroke(); }
    }
  }
  G.drawBricks = drawBricks;

  function drawTorch(ctx, x, y) {
    const t = G.time;
    const fl = Math.sin(t * 12 + x) * 0.16 + Math.sin(t * 31 + x) * 0.06;
    // тёплый свет, льющийся в комнату
    const pool = ctx.createRadialGradient(x, y - 4, 6, x, y + 50, 160);
    pool.addColorStop(0, "rgba(255,170,70,0.16)"); pool.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(x, y + 64, 130, 160, 0, 0, 7); ctx.fill();
    // кронштейн
    ctx.fillStyle = "#2a1d12"; ctx.fillRect(x - 4, y, 8, 26);
    ctx.fillStyle = "#15100a"; ctx.fillRect(x - 7, y + 22, 14, 6);
    // ореол
    const g = ctx.createRadialGradient(x, y - 8, 2, x, y - 8, 36 * (1 + fl));
    g.addColorStop(0, "rgba(255,236,170,0.95)"); g.addColorStop(0.45, "rgba(255,150,50,0.5)"); g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 8, 36 * (1 + fl), 0, 7); ctx.fill();
    // языки пламени
    const flame = (h, w, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.quadraticCurveTo(x - w, y - 6 - h * 0.5, x, y - 6 - h); ctx.quadraticCurveTo(x + w, y - 6 - h * 0.5, x, y - 6); ctx.fill(); };
    flame(24 + fl * 12, 9, "rgba(255,120,30,0.9)");
    flame(16 + fl * 9, 6, "rgba(255,190,60,0.95)");
    flame(9 + fl * 5, 3.5, "rgba(255,247,205,1)");
    // искра
    if ((Math.floor(t * 8 + x) % 7) === 0) { ctx.fillStyle = "rgba(255,200,120,0.8)"; ctx.fillRect(x - 1, y - 30 - ((t * 22) % 14), 2, 2); }
  }
  G.drawTorch = drawTorch;

  // Дверной проём (выход). open=true — открыт.
  G.drawDoor = function (ctx, x, y, w, h, open, label) {
    ctx.fillStyle = open ? "#1a0f0a" : "#2a1c12";
    rr(ctx, x, y, w, h, 8); ctx.fill();
    ctx.strokeStyle = open ? "#ffd17a" : "#6e5746"; ctx.lineWidth = 4; ctx.stroke();
    if (open) {
      const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w);
      g.addColorStop(0, "rgba(255,210,120,0.35)"); g.addColorStop(1, "rgba(255,210,120,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 20, y - 20, w + 40, h + 40);
    }
    if (label) {
      ctx.fillStyle = open ? "#ffe6b0" : "#9a8a78";
      ctx.font = "16px system-ui"; ctx.textAlign = "center";
      ctx.fillText(label, x + w / 2, y - 10);
    }
    ctx.textAlign = "left";
  };

  /* ---- Виньетка (затемнение по краям для глубины) ---- */
  G.vignette = function (ctx, strength = 0.5) {
    const W = G.VIEW.w, H = G.VIEW.h;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.9);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };

  /* ---- Парящие пылинки (процедурно, без состояния) ---- */
  G.dust = function (ctx, b, n = 24, rgb = "255,235,205") {
    const t = G.time;
    for (let i = 0; i < n; i++) {
      const baseX = b.x + ((i * 131.3) % b.w);
      const baseY = b.y + ((i * 71.7) % b.h);
      const x = baseX + Math.sin(t * 0.4 + i * 1.3) * 14;
      const y = b.y + (((baseY - b.y - t * (7 + (i % 4) * 4)) % b.h) + b.h) % b.h;
      const a = 0.1 + 0.22 * ((Math.sin(t * 1.5 + i) + 1) / 2);
      const s = 1 + (i % 3);
      ctx.fillStyle = `rgba(${rgb},${a.toFixed(2)})`;
      ctx.fillRect(x | 0, y | 0, s, s);
    }
  };

  /* ---- Кнопка (для меню/UI) ---- */
  G.button = function (ctx, b, hot) {
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, hot ? "#ffac5e" : "#c9531f"); g.addColorStop(1, hot ? "#d4711f" : "#8a3411");
    ctx.fillStyle = g; rr(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,220,170,0.7)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = `600 ${b.fs || 24}px system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  };

  /* ---- Текстовая подложка (нарратив) ---- */
  G.wrapText = function (ctx, text, x, y, maxW, lh) {
    const words = text.split(" ");
    let line = "", yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
    return yy;
  };

  G.narrationBox = function (ctx, text) {
    if (!text) return;
    ctx.save();
    ctx.font = "18px system-ui";
    ctx.textAlign = "center";
    const lines = wrapCount(ctx, text, 760);
    const h = 26 + lines * 24;
    const y = G.VIEW.h - h - 12;
    ctx.fillStyle = "rgba(10,6,4,0.78)";
    rr(ctx, G.VIEW.w / 2 - 410, y, 820, h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,180,120,0.5)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#ffe6c8";
    drawWrapCentered(ctx, text, G.VIEW.w / 2, y + 30, 760, 24);
    ctx.restore();
  };
  function wrapCount(ctx, text, maxW) {
    const words = text.split(" "); let line = "", n = 1;
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { n++; line = w; } else line = t; }
    return n;
  }
  function drawWrapCentered(ctx, text, cx, y, maxW, lh) {
    const words = text.split(" "); let line = "", yy = y;
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, cx, yy); line = w; yy += lh; } else line = t; }
    if (line) ctx.fillText(line, cx, yy);
  }

  /* =========================================================================
     HUD: день, батарея, инвентарь
     ========================================================================= */
  G.drawHUD = function (ctx) {
    const s = G.state;
    ctx.save();
    // плашка
    ctx.fillStyle = "rgba(8,5,3,0.55)";
    rr(ctx, 12, 10, 320, 54, 10); ctx.fill();

    // день + индикатор времени суток (солнце/луна по циклу)
    const tod = G.sunHeight ? G.sunHeight() : 1;
    const todIcon = tod > 0.25 ? "☀" : tod < -0.25 ? "🌙" : "🌅";
    ctx.fillStyle = "#ffd9a0"; ctx.font = "600 20px system-ui"; ctx.textBaseline = "middle";
    ctx.fillText(`${todIcon} День ${s.day}/100`, 26, 37);

    // батарея
    const bx = 186, bw = 120, by = 26, bh = 22;
    ctx.fillStyle = "#2a2118"; rr(ctx, bx, by, bw, bh, 5); ctx.fill();
    const lvl = clamp(s.battery / 100, 0, 1);
    ctx.fillStyle = lvl > 0.45 ? "#5fd06a" : lvl > 0.2 ? "#e0c34e" : "#e0573e";
    rr(ctx, bx + 2, by + 2, (bw - 4) * lvl, bh - 4, 3); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText(`🔋 ${Math.ceil(s.battery)}%`, bx + bw / 2, by + bh / 2 + 1);
    ctx.textAlign = "left";

    // инвентарь (справа)
    const items = [];
    items.push({ icon: "💠", txt: `${s.minerals}/3` });
    if (s.hasShovel) items.push({ icon: "⛏️", txt: "" });
    if (s.hasBlueprint) items.push({ icon: "📘", txt: "" });
    if (s.hasDrill) items.push({ icon: "🛠️", txt: "" });
    let ix = G.VIEW.w - 12;
    ctx.font = "24px system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      ctx.fillStyle = "rgba(8,5,3,0.55)";
      const w = it.txt ? 78 : 46;
      rr(ctx, ix - w, 10, w, 44, 8); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText((it.txt ? it.txt + " " : "") + it.icon, ix - 8, 33);
      ix -= w + 6;
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

    // полоса апгрейдов/дрона/дневников под основной плашкой (слева)
    const badges = [];
    if (s.upgShield) badges.push("🛡");
    if (s.upgSpeed) badges.push("👟");
    if (s.upgBattery) badges.push("🔋");
    if (s.upgPunch) badges.push("👊");
    if (s.upgIceCleats) badges.push("❄");
    if (s.hasDrone) badges.push("🤖");
    if (s.logs > 0) badges.push("📜" + s.logs);
    if (s.iceLogs > 0) badges.push("🧊" + s.iceLogs);
    if (badges.length) {
      const str = badges.join("  ");
      ctx.font = "18px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const w = ctx.measureText(str).width + 20;
      ctx.fillStyle = "rgba(8,5,3,0.5)"; rr(ctx, 12, 70, w, 30, 8); ctx.fill();
      ctx.fillStyle = "#cfe6f0"; ctx.fillText(str, 22, 86);
      ctx.textBaseline = "alphabetic";
    }

    if (s.battery < 25) {
      const a = (Math.sin(G.time * 8) + 1) / 2;
      ctx.fillStyle = `rgba(224,87,62,${0.25 + a * 0.4})`;
      ctx.font = "600 22px system-ui"; ctx.textAlign = "center";
      ctx.fillText("⚠ Низкий заряд — нужен минерал!", G.VIEW.w / 2, 30);
      ctx.textAlign = "left";
    }
    ctx.restore();
  };

  /* ---- Виртуальный джойстик ---- */
  G.drawJoystick = function (ctx) {
    if (!input.joy.active) return;
    const j = input.joy;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#ffd9a0"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(j.ox, j.oy, 78, 0, 7); ctx.stroke();
    ctx.fillStyle = "rgba(255,180,120,0.5)";
    ctx.beginPath(); ctx.arc(j.x, j.y, 34, 0, 7); ctx.fill();
    ctx.restore();
  };

  /* ---- Кнопка «Действие» (контекстная) ---- */
  G.actionButton = function (ctx, label) {
    // Поднята над блоком повествования (тот занимает примерно нижние 80–100px)
    const fs = 22;
    const text = "▲ " + (label || "Действие");
    ctx.save(); ctx.font = `600 ${fs}px system-ui`;
    const tw = ctx.measureText(text).width;
    ctx.restore();
    const w = Math.max(200, Math.ceil(tw + 44));
    const h = 64, x = G.VIEW.w / 2 - w / 2, y = G.VIEW.h - h - 130;
    const b = { x, y, w, h, text, fs };
    const hot = (Math.sin(G.time * 4) + 1) / 2;
    ctx.save(); ctx.globalAlpha = 0.92 + hot * 0.08;
    G.button(ctx, b, true);
    ctx.restore();
    G.uiBlock.push({ x, y, w, h }); // не запускать джойстик по этой кнопке
    return b;
  };

  /* =========================================================================
     ЦИКЛ
     ========================================================================= */
  let last = 0;
  function frameBody(ts) {
    const dtReal = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    // hit-stop: короткая заморозка симуляции и анимаций в момент удара
    let dt = dtReal;
    if (G.hitStopT > 0) { G.hitStopT = Math.max(0, G.hitStopT - dtReal); dt = 0; }
    G.time += dt;
    // продвигаем сутки только в игровых комнатах (не в меню/кат-сценах)
    if (G.scene && G.scene.isRoom && fade.dir !== 1) G.dayCycle = (G.dayCycle + dt / DAY_PERIOD) % 1;
    G.uiBlock = [];

    if (G.scene && G.scene.update && fade.dir !== 1) G.scene.update(dt);
    G.fx.update(dt);
    updateFade(dtReal);            // переходы идут по реальному времени (не залипают в hit-stop)
    if (G.music) G.music.tick();   // планируем фоновую музыку
    G.actionPressed = false;

    const ctx = G.ctx;
    ctx.clearRect(0, 0, G.VIEW.w, G.VIEW.h);
    // глобальная тряска экрана — оборачиваем отрисовку мира
    let shook = false;
    if (G.shakeAmt > 0.4) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * G.shakeAmt, (Math.random() - 0.5) * G.shakeAmt);
      G.shakeAmt *= Math.pow(0.0025, dtReal); // плавный спад (~0.86/кадр при 60fps)
      shook = true;
    } else G.shakeAmt = 0;
    try {
      if (G.scene && G.scene.draw) G.scene.draw(ctx);
      G.fx.draw(ctx);
    } finally {
      if (shook) ctx.restore(); // тряска всегда сбрасывается, даже если draw упал
    }

    if (fade.a > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade.a})`;
      ctx.fillRect(0, 0, G.VIEW.w, G.VIEW.h);
    }
  }
  // Главный цикл: один сбойный кадр НЕ должен замораживать игру —
  // ловим ошибку, чиним контекст и всегда планируем следующий кадр.
  function frame(ts) {
    try {
      frameBody(ts);
    } catch (e) {
      try { if (window.console && console.error) console.error("[frame]", e); } catch (_) {}
      // восстановить базовый трансформ холста (сбросить недоснятую тряску/save)
      try {
        const c = G.canvas, x = G.ctx;
        if (c && x) x.setTransform((c.width / G.VIEW.w) || 1, 0, 0, (c.height / G.VIEW.h) || 1, 0, 0);
      } catch (_) {}
      G.shakeAmt = 0; G.hitStopT = 0;
    }
    requestAnimationFrame(frame);
  }
  G.startLoop = function () { requestAnimationFrame(frame); };

})();
