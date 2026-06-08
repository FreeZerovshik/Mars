/* ===========================================================================
   Сцены игры «Выживание на Марсе за 100 дней»
   =========================================================================== */
(function () {
  "use strict";
  const G = window.G;
  const { clamp, lerp, dist, rr, rectHit } = {
    clamp: G.clamp, lerp: G.lerp, dist: G.dist, rr: G.rr, rectHit: G.rectHit,
  };
  const VIEW = G.VIEW;
  const PI = Math.PI;
  const PAL = G.PAL;
  const f = G.f;

  /* ---------- общие помощники движения ---------- */
  function resolveCircleRect(c, o) {
    if (o.passable) return;
    const px = clamp(c.x, o.x, o.x + o.w);
    const py = clamp(c.y, o.y, o.y + o.h);
    let dx = c.x - px, dy = c.y - py;
    let d = Math.hypot(dx, dy);
    if (d < c.r) {
      if (d === 0) { dx = 0; dy = -1; d = 1; }
      const push = c.r - d;
      c.x += (dx / d) * push; c.y += (dy / d) * push;
    }
  }
  function moveRobot(s, dt) {
    const rb = s.robot;
    // заморозка (дыхание Морозного Стража) — робот скован льдом, не двигается
    if (rb.frozen > 0) { rb.frozen -= dt; rb.ivx = 0; rb.ivy = 0; return; }
    // РЫВОК (dash): быстрый бросок в зафиксированном направлении + i-frames
    if (rb.dashT > 0) {
      rb.dashT -= dt;
      const dsp = s.speed * 3.6;
      rb.x += rb.dashDX * dsp * dt; rb.y += rb.dashDY * dsp * dt;
      if (rb.dashDX > 0.05) rb.face = 1; else if (rb.dashDX < -0.05) rb.face = -1;
      rb.walk += dt * 2;
      rb.ivx = rb.dashDX * dsp * 0.4; rb.ivy = rb.dashDY * dsp * 0.4; // лёгкий доскок на льду
      if (!rb._dashTrail) rb._dashTrail = [];
      rb._dashTrail.push({ x: rb.x, y: rb.y, face: rb.face, t: 0.22 });
      const b0 = s.bounds, r0 = rb.r;
      for (const o of s.obstacles) resolveCircleRect(rb, o);
      rb.x = clamp(rb.x, b0.x + r0, b0.x + b0.w - r0);
      rb.y = clamp(rb.y, b0.y + r0, b0.y + b0.h - r0);
      return;
    }
    const d = G.moveDir();
    const sp = s.speed * (G.state.upgSpeed ? 1.25 : 1); // апгрейд ускорения
    if (s.ice && !G.state.upgIceCleats) {
      // ЛЁД без шипов: движение по инерции — робот разгоняется и скользит
      if (s.robot.ivx == null) { s.robot.ivx = 0; s.robot.ivy = 0; }
      s.robot.ivx += d.x * sp * 7 * dt;
      s.robot.ivy += d.y * sp * 7 * dt;
      const fr = Math.pow(0.16, dt); // слабое трение → скольжение
      s.robot.ivx *= fr; s.robot.ivy *= fr;
      const vmax = sp * 1.15, vm = Math.hypot(s.robot.ivx, s.robot.ivy);
      if (vm > vmax) { s.robot.ivx *= vmax / vm; s.robot.ivy *= vmax / vm; }
      s.robot.x += s.robot.ivx * dt; s.robot.y += s.robot.ivy * dt;
      if (s.robot.ivx > 6) s.robot.face = 1; else if (s.robot.ivx < -6) s.robot.face = -1;
      if (vm > 10) s.robot.walk += dt;
    } else {
      // обычное управление (земля ИЛИ лёд с ледовыми шипами — цепкость)
      s.robot.x += d.x * sp * dt;
      s.robot.y += d.y * sp * dt;
      if (d.x > 0.05) s.robot.face = 1; else if (d.x < -0.05) s.robot.face = -1;
      if (d.mag > 0.05) s.robot.walk += dt;
      // на льду с шипами порыв ветра ещё чуть сносит (остаточный дрейф, быстро гаснет)
      if (s.ice && (s.robot.ivx || s.robot.ivy)) {
        const fr = Math.pow(0.0002, dt);
        s.robot.ivx *= fr; s.robot.ivy *= fr;
        s.robot.x += s.robot.ivx * dt; s.robot.y += s.robot.ivy * dt;
      }
    }
    const b = s.bounds, r = s.robot.r;
    for (const o of s.obstacles) resolveCircleRect(s.robot, o);
    s.robot.x = clamp(s.robot.x, b.x + r, b.x + b.w - r);
    s.robot.y = clamp(s.robot.y, b.y + r, b.y + b.h - r);
  }
  function angleNorm(a) { return ((a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI; }

  // УДАР ПО ЛЬДУ (бонус ледовых шипов): робот бьёт по льду — морозная волна
  // оглушает и слегка ранит врагов вокруг, выбивает зарытых, прерывает телеграф босса.
  function iceSlam(s) {
    const R = 134;
    G.fx.ring(s.robot.x, s.robot.y, "#bfeeff", R * 1.7, 0.5);
    G.fx.ring(s.robot.x, s.robot.y, "#eaffff", R, 0.32);
    G.fx.burst(s.robot.x, s.robot.y + 10, "#dff2ff", 24, 260, 0.7);
    G.shake(8); G.hitStop(0.04); G.audio.tone(150, 0.2, "sawtooth", 0.06); G.audio.tone(90, 0.18, "square", 0.04);
    if (s.mutants) for (const mu of s.mutants) {
      if (mu.goal) continue; // осадные идут к базе — не трогаем
      if (mu.buried) { mu.buried = false; mu.surfaceT = 0; } // выбивает бурильщиков
      const d = Math.hypot(mu.x - s.robot.x, mu.y - s.robot.y);
      if (d < R) {
        mu.stun = Math.max(mu.stun || 0, 1.3); mu.hp -= 1; mu.hitT = 0.3; mu.aware = true; mu.awareT = 0;
        const ang = Math.atan2(mu.y - s.robot.y, mu.x - s.robot.x);
        mu.vx = Math.cos(ang) * 240; mu.vy = Math.sin(ang) * 240;
      }
    }
    // прерываем замах Морозного Стража, если он близко
    const b = s.data && s.data.boss;
    if (b && b.hp > 0 && b.telegT > 0 && Math.hypot(b.x - s.robot.x, b.y - s.robot.y) < R + 50) { b.telegT = 0; b.mode = "idle"; b.cd = Math.max(b.cd || 0, 0.9); }
  }

  // ===== УДАР РОБОТА =====
  // Зона удара перед роботом, когда robot.punching > 0
  function punchZone(robot) {
    if (!robot.punching || robot.punching <= 0) return null;
    const face = robot.face || 1;
    const ext = G.state.upgPunch ? 22 : 0; // усиленный удар — шире зона
    return {
      x: face > 0 ? robot.x + robot.r - 6 : robot.x - robot.r - 44 - ext,
      y: robot.y - 18 - ext / 3,
      w: 50 + ext,
      h: 36 + ext / 1.5,
    };
  }
  function drawPunchArm(ctx, robot) {
    const t = robot.punching;
    if (!t || t <= 0) return;
    const face = robot.face || 1;
    // p: 0 в начале → 1 в момент удара → 0 в конце
    const p = t > 0.15 ? (0.3 - t) / 0.15 : t / 0.15;
    const prog = Math.max(0, p);
    // короткий замах: в самом начале кулак чуть уходит назад
    const wind = t > 0.24 ? (t - 0.24) / 0.06 : 0;   // 1 в начале, спадает к 0
    const extend = prog * 34 - wind * 8;
    const sx = robot.x + face * (robot.r - 6);
    const ay = robot.y - 6;
    const ex = sx + face * extend;
    // локоть слегка приподнимается на пике удара (живая дуга)
    const elbowX = sx + face * extend * 0.5;
    const elbowY = ay - 4 - prog * 4;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // плечевой сустав
    ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.arc(sx, ay, 5, 0, 7); ctx.fill();
    // двусегментная рука (плечо → локоть → кулак)
    ctx.strokeStyle = "#cdd4db"; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(sx, ay); ctx.lineTo(elbowX, elbowY); ctx.lineTo(ex, ay); ctx.stroke();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, ay); ctx.lineTo(elbowX, elbowY); ctx.lineTo(ex, ay); ctx.stroke();
    // кулак
    ctx.fillStyle = "#cdd4db"; ctx.beginPath(); ctx.arc(ex, ay, 8, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.arc(ex, ay, 4, 0, 7); ctx.fill();
    // удар-блик в момент пика
    if (t > 0.14 && t < 0.22) {
      ctx.fillStyle = "rgba(255,232,150,0.75)";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        ctx.beginPath(); ctx.arc(ex + Math.cos(a) * 14, ay + Math.sin(a) * 14, 3, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ===== ДНЕВНИКИ ЭКСПЕДИЦИИ (собираемые) =====
  const LOG_TEXTS = {
    surface: "Дневник, день 2: «Капсула цела. Сигнал с орбиты молчит. Вижу странные руины в скале — будто кто-то был здесь до нас…»",
    drill:   "Дневник, день 40: «Под песком — залежи неизвестных кристаллов. Древние что-то охраняли. Бур почти готов. Если читаешь это — копай глубже.»",
    tomb:    "Дневник, день 70: «Это не марсиане. Это МЫ — прошлая экспедиция. Древний хранит ключ к кораблю. Собери сканер. Найди артефакт. Улетай.»",
  };
  function placeLog(s, id, x, y) {
    if (G.state.logIds[id]) return;
    s.interactables.push({
      x, y, r: 70, pickup: true, icon: "📜", _logId: id,
      label: () => "Прочитать дневник 📜",
      ready: () => !G.state.logIds[id],
      act(sc) {
        if (G.state.logIds[id]) return;
        G.state.logIds[id] = true; G.state.logs += 1;
        G.audio.pickup(); G.fx.burst(x, y - 10, "#bfe0ff", 20, 160, 0.8);
        sc.toast(LOG_TEXTS[id] || "Древний дневник…", 6.0);
      },
    });
  }
  // Чертёж технологии базы (найти в шахтах → собрать в управлении базой)
  function placeTechBlueprint(s, id, x, y) {
    const flag = id === "turret" ? "hasTurretBlueprint" : "hasFenceBlueprint";
    if (G.state[flag]) return;
    s.interactables.push({
      x, y, r: 72, pickup: true, _tech: id,
      label: () => "Забрать чертёж 📐",
      ready: () => !G.state[flag],
      act(sc) {
        if (G.state[flag]) return;
        G.state[flag] = true; G.audio.win(); G.fx.burst(x, y - 10, "#7be0ff", 26, 220, 0.9);
        sc.toast(id === "turret"
          ? "Найден ЧЕРТЁЖ ТУРЕЛИ! Соберите её в «Управлении базой» (карта → база)."
          : "Найден ЧЕРТЁЖ ЭНЕРГОЗАБОРА! Соберите в «Управлении базой».", 4.5);
      },
    });
  }
  function drawPickup(ctx, it) {
    const t = G.time;
    const yy = it.y + Math.sin(t * 2 + it.x) * 4;
    const gl = (Math.sin(t * 3) + 1) / 2;
    // ореол
    const rg = ctx.createRadialGradient(it.x, yy, 2, it.x, yy, 30);
    rg.addColorStop(0, `rgba(150,210,255,${0.35 + gl * 0.3})`); rg.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(it.x, yy, 30, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(it.x, yy); ctx.rotate(Math.sin(t * 1.5) * 0.08);
    if (it._tech) {
      // синий чертёж-схема со значком структуры
      ctx.fillStyle = "#173a5e"; rr(ctx, -16, -14, 32, 28, 3); ctx.fill();
      ctx.strokeStyle = "#7be0ff"; ctx.lineWidth = 1.5; ctx.strokeRect(-12, -10, 24, 20);
      ctx.strokeStyle = "rgba(150,210,255,0.5)"; ctx.lineWidth = 0.7;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-12, -10 + i * 5); ctx.lineTo(12, -10 + i * 5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-12 + i * 6, -10); ctx.lineTo(-12 + i * 6, 10); ctx.stroke(); }
      ctx.fillStyle = "#cfe6ff"; ctx.font = f(13, "800"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(it._tech === "turret" ? "🔫" : "⚡", 0, 0); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    } else {
      // планшет-дневник
      ctx.fillStyle = "#2a3850"; rr(ctx, -13, -16, 26, 32, 3); ctx.fill();
      ctx.strokeStyle = "#7be0ff"; ctx.lineWidth = 1.5; rr(ctx, -10, -12, 20, 24, 2); ctx.stroke();
      ctx.strokeStyle = "rgba(180,220,255,0.7)"; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-7, -7 + i * 5); ctx.lineTo(7, -7 + i * 5); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ===== ДРОН-ПОМОЩНИК =====
  function drawPetDrone(ctx, x, y) {
    const t = G.time;
    const bob = Math.sin(t * 4) * 3;
    const cy = y + bob;
    // фонарь — конус/ореол света (ярче ночью)
    const night = G.daylight ? (1 - G.daylight()) : 0;
    if (night > 0.15) {
      const lg = ctx.createRadialGradient(x, cy + 6, 6, x, cy + 6, 90);
      lg.addColorStop(0, `rgba(180,230,255,${0.18 + night * 0.22})`);
      lg.addColorStop(1, "rgba(120,200,255,0)");
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(x, cy + 6, 90, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.save(); ctx.translate(x, cy);
    // тень на земле
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(0, 40 - bob, 12, 3, 0, 0, 7); ctx.fill();
    // антенна-винт
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -16); ctx.stroke();
    const rot = Math.sin(t * 30) * 10;
    ctx.strokeStyle = "rgba(180,210,240,0.7)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-10 + Math.abs(rot) * 0, -16); ctx.lineTo(10, -16); ctx.stroke();
    // корпус
    const g = ctx.createLinearGradient(0, -10, 0, 12);
    g.addColorStop(0, "#dfe6ee"); g.addColorStop(1, "#7a8694");
    ctx.fillStyle = g; rr(ctx, -12, -10, 24, 20, 7); ctx.fill();
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5; rr(ctx, -12, -10, 24, 20, 7); ctx.stroke();
    // глаз-объектив
    const eg = ctx.createRadialGradient(-1, -1, 1, 0, 0, 6);
    eg.addColorStop(0, "#eaffff"); eg.addColorStop(0.5, "#7be0ff"); eg.addColorStop(1, "#1a6a9a");
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = "#2a3a44"; ctx.lineWidth = 1.5; ctx.stroke();
    // боковые дюзы
    ctx.fillStyle = "#5a6470"; rr(ctx, -16, 2, 5, 6, 1); ctx.fill(); rr(ctx, 11, 2, 5, 6, 1); ctx.fill();
    const fl = (Math.sin(t * 18) + 1) / 2;
    ctx.fillStyle = `rgba(123,224,255,${0.4 + fl * 0.4})`;
    ctx.beginPath(); ctx.arc(-13.5, 9, 1.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(13.5, 9, 1.6, 0, 7); ctx.fill();
    ctx.restore();
    // именная табличка дрона — Лев (в честь автора идеи)
    ctx.save();
    ctx.font = `800 11px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const nw = ctx.measureText("Лев").width + 14;
    ctx.fillStyle = "rgba(20,40,60,0.7)"; rr(ctx, x - nw / 2, cy - 30, nw, 15, 5); ctx.fill();
    ctx.fillStyle = "#bfe9ff"; ctx.fillText("Лев", x, cy - 22);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  // ===== МУТАНТЫ =====
  // Виды мутантов (Strategy via data): обычный, быстрый разведчик, тяжёлый громила
  const MUTANT_KINDS = {
    grunt: { hp: 2, chase: 75,  patrol: 32, dmg: 10, scale: 1.0,  c0: "#a8e870", c1: "#3a7e2e", spike: "#2a6020", eye: "#d12b29", blind: true,  sight: 140 },
    // scout — налётчик: подлетает, бьёт и отскакивает (hit-and-run), сложно поймать без рывка
    scout: { hp: 1, chase: 150, patrol: 64, dmg: 7,  scale: 0.78, c0: "#9fe6ff", c1: "#2a7ea8", spike: "#1a5a78", eye: "#ff7a3a", blind: false, sight: 340, harry: true },
    // brute — таран: телеграф → рывок по прямой; уклонись дэшем, после промаха оглушён (окно)
    brute: { hp: 4, chase: 42,  patrol: 22, dmg: 20, scale: 1.45, c0: "#ffb070", c1: "#a83a1e", spike: "#7a2410", eye: "#ffe14a", blind: true,  sight: 230, charge: true },
    // drone — виляет из стороны в сторону при подлёте (дёрганый, трудно попасть)
    drone: { hp: 1, chase: 168, patrol: 90, dmg: 5,  scale: 0.62, c0: "#d7a0ff", c1: "#6a2aaf", spike: "#4a1a8a", eye: "#ff5af0", blind: false, sight: 360, fly: true, weave: true },
    // spitter — стреляет С УПРЕЖДЕНИЕМ (целит куда бежишь), держит дистанцию
    spitter:  { hp: 2, chase: 56, patrol: 28, dmg: 7,  scale: 0.95, c0: "#c8f0a0", c1: "#3a7a2e", spike: "#244a1a", eye: "#ffe14a", blind: false, sight: 380, ranged: true, range: 250, fireGap: 1.5, lead: true },
    burrower: { hp: 3, chase: 132, patrol: 26, dmg: 12, scale: 1.12, c0: "#caa07a", c1: "#7a4a2a", spike: "#3a2410", eye: "#ff5a3a", blind: true,  sight: 230, burrow: true },
    // Глава 2 (ледяная луна): кристаллический мороженый хищник
    frostling: { hp: 2, chase: 92, patrol: 40, dmg: 8, scale: 1.05, c0: "#dff2ff", c1: "#4a8ad0", spike: "#2a5a9a", eye: "#9af0ff", blind: false, sight: 320, frost: true },
  };
  function makeMutant(x, y, hp, kind) {
    kind = kind || "grunt";
    const K = MUTANT_KINDS[kind] || MUTANT_KINDS.grunt;
    const h = Math.max(1, Math.round((hp || K.hp) * G.diff().eHp)); // HP × сложность
    return {
      x, y, kind, hp: h, maxHp: h,
      vx: 0, vy: 0, hitT: 0, atkT: 0, walk: 0, face: 1,
      // слепые: не видят робота на расстоянии, ходят по маршруту
      blind: K.blind, aware: !K.blind, awareT: 999,
      patrolDir: Math.random() > 0.5 ? 1 : -1, patrolT: 0,
      goal: null, // {x,y,r,hp} — для режима осады базы
      stun: 0,            // оглушение (EMP)
      fireT: K.fireGap ? K.fireGap * (0.5 + Math.random()) : 0, // перезарядка плевка
      buried: false, burrowT: 0, surfaceT: 0, // состояние бурильщика
      elite: false,
    };
  }
  // Повышение врага до ЭЛИТЫ: ×2.2 HP, крупнее, больнее, больше лома, золотая аура.
  function makeElite(mu) {
    mu.elite = true;
    mu.maxHp = Math.ceil(mu.maxHp * 2.0); mu.hp = mu.maxHp;
    mu._scrap = 4;
    return mu;
  }
  // Перемещение с учётом стен (возвращает true, если шаг прошёл)
  function mutantTryMove(s, mu, dx, dy) {
    const oldX = mu.x, oldY = mu.y;
    const overlapsAny = () => {
      if (!s.obstacles) return false;
      for (const o of s.obstacles) {
        if (o.passable) continue;
        if (mu.x + 14 > o.x && mu.x - 14 < o.x + o.w &&
            mu.y + 14 > o.y && mu.y - 14 < o.y + o.h) return true;
      }
      return false;
    };
    mu.x = oldX + dx; mu.y = oldY + dy;
    if (overlapsAny()) {
      mu.x = oldX + dx; mu.y = oldY;
      if (overlapsAny()) {
        mu.x = oldX; mu.y = oldY + dy;
        if (overlapsAny()) { mu.x = oldX; mu.y = oldY; return false; }
      }
      return false;
    }
    return true;
  }
  function updateMutant(s, mu, dt) {
    const K = MUTANT_KINDS[mu.kind] || MUTANT_KINDS.grunt;
    const eDmg = K.dmg * (mu.elite ? 1.45 : 1); // элита бьёт больнее
    if (mu.hitT > 0) mu.hitT -= dt;
    if (mu.atkT > 0) mu.atkT -= dt;
    if (mu.fireT > 0) mu.fireT -= dt;
    mu.awareT += dt;
    // оглушение от EMP — стоит на месте, но получает удары (см. блок удара ниже)
    const stunned = mu.stun > 0;
    if (stunned) { mu.stun -= dt; mu.x += mu.vx * dt; mu.y += mu.vy * dt; mu.vx *= 0.9; mu.vy *= 0.9; }

    // === Режим осады базы: идём к реактору, бьём его, не отвлекаясь на робота ===
    if (mu.goal) {
      const gx = mu.goal.x - mu.x, gy = mu.goal.y - mu.y, gd = Math.hypot(gx, gy) || 1;
      if (mu.hitT <= 0) {
        if (gd > mu.goal.r + 12) {
          // энергозабор тормозит врага на подступах
          const fslow = (s.data && s.data.fenceR && Math.abs(gd - s.data.fenceR) < 28) ? (s.data.fenceSlow || 1) : 1;
          const sp = K.chase * fslow;
          mutantTryMove(s, mu, (gx / gd) * sp * dt, (gy / gd) * sp * dt);
          mu.face = gx > 0 ? 1 : -1; mu.walk += dt;
        } else if (mu.atkT <= 0) {
          // достиг реактора — наносит урон и гибнет (волновая осада)
          mu.goal.hp = Math.max(0, mu.goal.hp - eDmg);
          G.fx.burst(mu.x, mu.y, "#ff6a4a", 18, 200, 0.7); G.audio.boom();
          mu.hp = 0; mu.noScrap = true;
        }
      } else { mu.x += mu.vx * dt; mu.y += mu.vy * dt; mu.vx *= 0.85; mu.vy *= 0.85; }
      // удар робота по осаждающему
      const pzs = punchZone(s.robot);
      if (pzs && mu.hitT <= 0 && rectHit(pzs, mu.x, mu.y)) {
        mu.hp -= (G.state.upgPunch ? 2 : 1); mu.hitT = 0.4;
        const kd = mu.x > s.robot.x ? 1 : -1; mu.vx = (kd * 220) / K.scale; mu.vy = -40;
        G.audio.hit();
        G.shake(6); G.hitStop(0.045); G.fx.ring(mu.x, mu.y, "#d7ffae", 36, 0.28);
        if (mu.hp <= 0) { G.shake(9); G.hitStop(0.06); }
      }
      return;
    }

    // Чувство-зрение: видят робота в радиусе sightRange, теряют — на loseRange
    const dx = s.robot.x - mu.x, dy = s.robot.y - mu.y;
    const d = Math.hypot(dx, dy);
    const sightRange = K.sight, loseRange = K.sight + 80;
    if (mu.blind) {
      if (mu.aware) {
        if (d > loseRange) { mu.aware = false; mu.patrolT = 0; }
      } else {
        if (d < sightRange) { mu.aware = true; mu.awareT = 0; G.audio.tone(420, 0.08, "square", 0.04); }
      }
    } else { mu.aware = true; }

    let handledMove = false;
    // === БУРИЛЬЩИК: зарывается под землю (неуязвим) и выныривает у робота ===
    if (K.burrow && !stunned) {
      if (mu.buried) {
        mu.burrowT -= dt;
        const sp = K.chase * 1.18;
        mu.x += (dx / d) * sp * dt; mu.y += (dy / d) * sp * dt; mu.face = dx > 0 ? 1 : -1; mu.walk += dt;
        if (mu.burrowT <= 0 || d < 38) {
          mu.buried = false; mu.surfaceT = 0; mu.atkT = 0.2;
          G.fx.burst(mu.x, mu.y, "#caa07a", 18, 180, 0.7); G.audio.tone(120, 0.22, "sawtooth", 0.06); G.shake(5);
        }
        handledMove = true;
      } else {
        mu.surfaceT += dt;
        if (mu.aware && mu.surfaceT > 1.6 && d > 95 && mu.hitT <= 0) {
          mu.buried = true; mu.burrowT = 1.3; G.fx.burst(mu.x, mu.y, "#7a4a2a", 14, 150, 0.6); G.audio.tone(90, 0.2, "sawtooth", 0.05);
          handledMove = true;
        }
      }
    }
    // === ПЛЕВАЛЬЩИК: держит дистанцию и стреляет кислотой ===
    if (K.ranged && mu.aware && !stunned && mu.hitT <= 0 && !handledMove) {
      const range = K.range || 240;
      if (d < range * 0.55) { // слишком близко — отступает
        mutantTryMove(s, mu, (-dx / d) * K.chase * dt, (-dy / d) * K.chase * dt);
        mu.face = dx > 0 ? 1 : -1; mu.walk += dt;
      } else if (d > range) {  // далеко — подходит
        mutantTryMove(s, mu, (dx / d) * K.chase * dt, (dy / d) * K.chase * dt);
        mu.face = dx > 0 ? 1 : -1; mu.walk += dt;
      } else { mu.face = dx > 0 ? 1 : -1; }
      // выстрел (с упреждением для lead — целит, куда бежит робот)
      if (mu.fireT <= 0 && d < range * 1.1) {
        mu.fireT = K.fireGap;
        if (!s.enemyShots) s.enemyShots = [];
        const sp = 320;
        let ax = dx, ay = dy;
        if (K.lead) { const mv = G.moveDir(); ax += mv.x * 95; ay += mv.y * 95; }
        const am = Math.hypot(ax, ay) || 1;
        s.enemyShots.push({ x: mu.x, y: mu.y - 6, vx: (ax / am) * sp, vy: (ay / am) * sp, life: 2.2, dmg: eDmg, r: 7 });
        G.audio.tone(260, 0.12, "square", 0.05);
      }
      handledMove = true;
    }
    // === ТАРАН (brute): телеграф → рывок по прямой → оглушение при промахе в стену ===
    if (K.charge && mu.aware && !stunned && !handledMove) {
      if (!mu.chMode) mu.chMode = "idle";
      if (mu.chMode === "idle") {
        // держит дистанцию-наскок ~100px, ждёт перезарядки тарана
        if (d > 120) { mutantTryMove(s, mu, (dx / d) * K.chase * dt, (dy / d) * K.chase * dt); mu.face = dx > 0 ? 1 : -1; mu.walk += dt; }
        else if (d < 72) { mutantTryMove(s, mu, (-dx / d) * K.chase * 0.7 * dt, (-dy / d) * K.chase * 0.7 * dt); mu.face = dx > 0 ? 1 : -1; mu.walk += dt; }
        mu.chCd = (mu.chCd || 0) - dt;
        if (mu.chCd <= 0 && d < 340 && mu.hitT <= 0) { mu.chMode = "tele"; mu.chT = 0.7; }
      } else if (mu.chMode === "tele") {
        mu.chT -= dt; mu.face = dx > 0 ? 1 : -1; mu.chAng = Math.atan2(dy, dx); // следящая стрелка
        if (mu.chT <= 0) { mu.chMode = "charge"; mu.chT = 0.5; const m = Math.hypot(dx, dy) || 1; mu.chDX = dx / m; mu.chDY = dy / m; G.audio.tone(150, 0.22, "sawtooth", 0.07); }
      } else if (mu.chMode === "charge") {
        mu.chT -= dt;
        const moved = mutantTryMove(s, mu, mu.chDX * K.chase * 6 * dt, mu.chDY * K.chase * 6 * dt);
        mu.walk += dt * 2.5;
        if (mu.atkT <= 0 && d < s.robot.r + 18 * K.scale) { s.hurt(eDmg, { x: mu.chDX * 32, y: mu.chDY * 32 }); mu.atkT = 0.6; mu.chMode = "recover"; mu.chT = 0.6; G.shake(8); }
        else if (!moved) { mu.chMode = "recover"; mu.chT = 1.0; mu.stun = Math.max(mu.stun || 0, 1.0); G.shake(7); G.audio.boom(); G.fx.burst(mu.x, mu.y, "#ffb070", 16, 200, 0.6); }
        else if (mu.chT <= 0) { mu.chMode = "recover"; mu.chT = 0.5; }
      } else { mu.chT -= dt; if (mu.chT <= 0) { mu.chMode = "idle"; mu.chCd = 1.7; } }
      handledMove = true;
    }
    // === НАЛЁТЧИК (scout): подлетает, бьёт и отскакивает по дуге (hit-and-run) ===
    if (K.harry && mu.aware && !stunned && !handledMove) {
      if (!mu.hMode) mu.hMode = "approach";
      if (mu.hMode === "approach") {
        if (d > 30) { mutantTryMove(s, mu, (dx / d) * K.chase * dt, (dy / d) * K.chase * dt); mu.face = dx > 0 ? 1 : -1; mu.walk += dt * 1.4; }
        if (d < 36) { if (mu.atkT <= 0) { s.hurt(eDmg, { x: (mu.x < s.robot.x ? 14 : -14), y: 0 }); mu.atkT = 0.5; } mu.hMode = "retreat"; mu.hT = 0.55 + Math.random() * 0.35; mu.hSide = Math.random() > 0.5 ? 1 : -1; }
      } else {
        mu.hT -= dt;
        const px = -dy / (d || 1), py = dx / (d || 1);
        mutantTryMove(s, mu, (-dx / d * 0.7 + px * mu.hSide * 0.8) * K.chase * dt, (-dy / d * 0.7 + py * mu.hSide * 0.8) * K.chase * dt);
        mu.face = dx > 0 ? 1 : -1; mu.walk += dt * 1.6;
        if (mu.hT <= 0) mu.hMode = "approach";
      }
      handledMove = true;
    }
    // === ВИЛЯНИЕ (drone): подлетает зигзагом, труднее попасть ===
    if (K.weave && mu.aware && !stunned && !handledMove) {
      if (d > 26) {
        const px = -dy / (d || 1), py = dx / (d || 1), w = Math.sin(G.time * 6 + mu.x * 0.05) * 0.85;
        mutantTryMove(s, mu, (dx / d + px * w) * K.chase * dt, (dy / d + py * w) * K.chase * dt);
        mu.face = dx > 0 ? 1 : -1; mu.walk += dt;
      }
      handledMove = true;
    }

    if (!handledMove && !stunned && !mu.buried) {
      if (mu.hitT <= 0) {
        if (mu.aware) {
          // Преследование
          if (d > 28) {
            const sp = K.chase;
            mutantTryMove(s, mu, (dx / d) * sp * dt, (dy / d) * sp * dt);
            mu.face = dx > 0 ? 1 : -1; mu.walk += dt;
          }
        } else {
          // Патруль — медленно ходит туда-сюда, разворачивается у стены
          mu.patrolT += dt;
          const sp = K.patrol;
          const moved = mutantTryMove(s, mu, mu.patrolDir * sp * dt, 0);
          if (!moved) { mu.patrolDir *= -1; mu.patrolT = 0; }
          mu.face = mu.patrolDir; mu.walk += dt * 0.55;
          if (mu.patrolT > 2.2 + ((mu.x * 7) % 1) * 2.0) { mu.patrolDir *= -1; mu.patrolT = 0; }
        }
      } else {
        mu.x += mu.vx * dt; mu.y += mu.vy * dt;
        mu.vx *= 0.85; mu.vy *= 0.85;
      }
    }
    // ограничение по границам комнаты
    if (s.bounds) {
      const oldX = mu.x;
      mu.x = clamp(mu.x, s.bounds.x + 16, s.bounds.x + s.bounds.w - 16);
      mu.y = clamp(mu.y, s.bounds.y + 16, s.bounds.y + s.bounds.h - 16);
      if (mu.x !== oldX && mu.hitT <= 0) mu.patrolDir *= -1;
    }
    // контактный урон роботу (плевальщик/зарытый/таран/налётчик — со своей логикой)
    if (mu.atkT <= 0 && !mu.buried && !K.ranged && !K.charge && !K.harry) {
      if (d < s.robot.r + 14 * K.scale * (mu.elite ? 1.3 : 1)) {
        s.hurt(eDmg, { x: (mu.x < s.robot.x ? 18 : -18), y: 0 });
        mu.atkT = 0.8;
        if (!mu.aware) { mu.aware = true; mu.awareT = 0; }
      }
    }
    // получаем удар робота — слепой просыпается мгновенно; зарытого бурильщика не достать
    const pz = punchZone(s.robot);
    if (pz && mu.hitT <= 0 && !mu.buried && rectHit(pz, mu.x, mu.y)) {
      mu.hp -= (G.state.upgPunch ? 2 : 1); mu.hitT = 0.45;
      mu.aware = true; mu.awareT = 0;
      const kd = mu.x > s.robot.x ? 1 : -1;
      mu.vx = (kd * 220) / K.scale; mu.vy = -40;
      G.audio.hit();
      // боевой сок: попадание робота по врагу
      G.shake(6); G.hitStop(0.045); G.fx.ring(mu.x, mu.y, "#d7ffae", 36, 0.28);
      if (mu.hp <= 0) { G.shake(9); G.hitStop(0.06); }
    }
  }
  // Обновление вражеских снарядов (плевок кислотой) — вызывается из makeRoom
  function updateEnemyShots(s, dt) {
    if (!s.enemyShots || !s.enemyShots.length) return;
    for (let i = s.enemyShots.length - 1; i >= 0; i--) {
      const p = s.enemyShots[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (Math.hypot(p.x - s.robot.x, p.y - s.robot.y) < s.robot.r + (p.r || 7)) {
        s.hurt(p.dmg || 8, { x: p.vx * 0.03, y: p.vy * 0.03 });
        s.enemyShots.splice(i, 1); continue;
      }
      const b = s.bounds;
      if (p.life <= 0 || (b && (p.x < b.x - 20 || p.x > b.x + b.w + 20 || p.y < b.y - 20 || p.y > b.y + b.h + 20))) s.enemyShots.splice(i, 1);
    }
  }
  function drawEnemyShots(ctx, s) {
    if (!s.enemyShots) return;
    for (const p of s.enemyShots) {
      const wob = Math.sin(G.time * 20 + p.x) * 1.5;
      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 9);
      g.addColorStop(0, "#e8ff9a"); g.addColorStop(0.6, "#7ec23a"); g.addColorStop(1, "rgba(60,120,30,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 9 + wob, 0, 7); ctx.fill();
      ctx.fillStyle = "#3a5a1e"; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
    }
  }

  /* =========================================================================
     КРАФТ РАСХОДНИКОВ: лом с врагов → аптечка / ЭМИ / мина (верстак у принтера)
     ========================================================================= */
  // выпадение лома при гибели врага
  function dropScrap(s, mu) {
    const amt = mu._scrap != null ? mu._scrap : 1;
    G.state.scrap += amt;
    G.fx.burst(mu.x, mu.y - 6, "#b8c0c8", 8, 120, 0.6);
    if (s) s._scrapFloat = { x: mu.x, y: mu.y - 20, t: 0.9, amt };
  }
  // Тематический разлёт частей при гибели врага (свои цвета/эффект под вид)
  const DEATH_FX = {
    grunt:     { c: ["#9ce06a", "#5aa83a"], ring: "#9ce06a" },
    scout:     { c: ["#9fe6ff", "#2a7ea8", "#eaffff"], ring: "#9fe6ff" },
    brute:     { c: ["#ffb070", "#a83a1e", "#ffe9c8"], ring: "#ffb070" },
    drone:     { c: ["#d7a0ff", "#ff5af0", "#efe6ff"], ring: "#ff5af0", zap: true },
    spitter:   { c: ["#c8f0a0", "#7ec23a", "#3a5a1e"], ring: "#9cd060" },
    burrower:  { c: ["#caa07a", "#7a4a2a", "#3a2410"], ring: "#caa07a" },
    frostling: { c: ["#eaffff", "#7be0ff", "#4a8ad0"], ring: "#bfeeff", shard: true },
  };
  function mutantDeathFx(s, mu) {
    const d = DEATH_FX[mu.kind] || DEATH_FX.grunt, m = mu.elite ? 1.7 : 1;
    for (let i = 0; i < d.c.length; i++) G.fx.burst(mu.x, mu.y - 4, d.c[i], Math.round(13 * m), (230 + i * 30) * m, 0.85);
    G.fx.ring(mu.x, mu.y, d.ring, 56 * m, 0.34);
    if (d.zap) { G.fx.ring(mu.x, mu.y, "#ffffff", 30, 0.2); G.audio.tone(180, 0.1, "square", 0.05); }
    if (d.shard) { G.fx.burst(mu.x, mu.y - 4, "#ffffff", 8, 300, 0.7); G.audio.tone(900, 0.08, "triangle", 0.05); }
    if (mu.elite) { G.fx.burst(mu.x, mu.y - 4, "#ffd24a", 26, 420, 1.1); G.fx.ring(mu.x, mu.y, "#ffe14a", 95, 0.5); G.shake(11); G.hitStop(0.05); G.audio.win(); }
  }
  // Таблица расходников (Strategy via data): иконка, цена в ломе, эффект.
  const CONSUMABLES = {
    medkit: { icon: "➕", name: "Аптечка", cost: 2, color: "#4ad06a", desc: "+42% заряда батареи",
      use(s) { G.state.battery = Math.min(100, G.state.battery + 42); G.fx.ring(s.robot.x, s.robot.y, "#7de08a", 54, 0.5); G.fx.burst(s.robot.x, s.robot.y - 6, "#9cf0a8", 16, 140, 0.7); G.audio.pickup(); s.toast("➕ +42% заряда", 1.4); } },
    emp: { icon: "⚡", name: "ЭМИ", cost: 5, color: "#6ad0ff", desc: "оглушает всех врагов + урон",
      use(s) {
        let n = 0;
        if (s.mutants) for (const mu of s.mutants) { if (mu.goal) continue; mu.stun = Math.max(mu.stun || 0, 3); if (mu.buried) { mu.buried = false; mu.surfaceT = 0; } mu.hp -= 1; mu.hitT = 0.3; n++; if (mu.hp <= 0) { mu._dead = true; } }
        const b = s.data && s.data.boss; if (b && b.telegT > 0) { b.telegT = 0; b.attackT = Math.max(b.attackT, 1.0); }
        G.fx.ring(s.robot.x, s.robot.y, "#7be0ff", 340, 0.6); G.fx.ring(s.robot.x, s.robot.y, "#bfe9ff", 220, 0.45);
        G.fx.burst(s.robot.x, s.robot.y, "#bfe9ff", 30, 360, 0.7); G.shake(9); G.hitStop(0.05); G.audio.boom();
        s.toast(n ? `⚡ ЭМИ оглушил врагов: ${n}` : "⚡ ЭМИ-разряд", 1.6);
      } },
    mine: { icon: "💣", name: "Мина", cost: 4, color: "#ff8a4a", desc: "взрывается рядом с врагом",
      use(s) { if (!s.mines) s.mines = []; s.mines.push({ x: s.robot.x, y: s.robot.y + 12, arm: 0.7, r: 50, life: 40, blink: 0 }); G.audio.tone(300, 0.1, "square", 0.05); s.toast("💣 Мина установлена", 1.3); } },
  };
  function canCraft(kind) { return G.state.scrap >= CONSUMABLES[kind].cost; }
  function craftConsumable(kind) {
    const c = CONSUMABLES[kind]; if (!c || G.state.scrap < c.cost) return false;
    G.state.scrap -= c.cost; G.state.cons[kind] = (G.state.cons[kind] || 0) + 1;
    G.audio.pickup(); return true;
  }
  function useConsumable(s, kind) {
    if (!G.state.cons[kind] || G.state.cons[kind] <= 0) return false;
    G.state.cons[kind]--; CONSUMABLES[kind].use(s); return true;
  }
  // расставленные мины
  function updateMines(s, dt) {
    if (!s.mines || !s.mines.length) return;
    for (let i = s.mines.length - 1; i >= 0; i--) {
      const m = s.mines[i]; m.life -= dt; m.blink += dt;
      if (m.arm > 0) { m.arm -= dt; continue; }
      let trig = false;
      if (s.mutants) for (const mu of s.mutants) { if (!mu.buried && !mu.goal && Math.hypot(mu.x - m.x, mu.y - m.y) < m.r) { trig = true; break; } }
      if (trig) {
        G.fx.burst(m.x, m.y, "#ff8a4a", 40, 380, 0.9); G.fx.ring(m.x, m.y, "#ffd17a", m.r * 1.7, 0.5);
        G.shake(13); G.hitStop(0.06); G.audio.boom();
        if (s.mutants) for (const mu of s.mutants) {
          const dd = Math.hypot(mu.x - m.x, mu.y - m.y);
          if (!mu.buried && dd < m.r * 1.35) { mu.hp -= 3; mu.hitT = 0.4; const k = mu.x > m.x ? 1 : -1; mu.vx = k * 260; mu.vy = -80; }
        }
        s.mines.splice(i, 1); continue;
      }
      if (m.life <= 0) s.mines.splice(i, 1);
    }
  }
  function drawMines(ctx, s) {
    if (!s.mines) return;
    for (const m of s.mines) {
      const armed = m.arm <= 0;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(m.x, m.y + 4, 14, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#3a3f47"; ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, 7); ctx.fill();
      ctx.strokeStyle = "#1a1e24"; ctx.lineWidth = 2; ctx.stroke();
      // три ножки
      ctx.strokeStyle = "#2a2e34"; ctx.lineWidth = 2;
      for (const a of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + Math.sin(a + 1.6) * 14, m.y + 8); ctx.stroke(); }
      const blink = armed ? (Math.sin(m.blink * 14) > 0 ? 1 : 0.25) : 0.4 + 0.6 * (1 - m.arm / 0.7);
      ctx.fillStyle = `rgba(255,${armed ? 60 : 180},40,${blink})`;
      ctx.beginPath(); ctx.arc(m.x, m.y - 2, 3, 0, 7); ctx.fill();
    }
  }
  // плавающая надпись «+лом» (таймер тикается в makeRoom.update)
  function drawScrapFloat(ctx, s) {
    if (!s._scrapFloat) return;
    const f0 = s._scrapFloat, k = f0.t / 0.9;
    ctx.fillStyle = `rgba(200,210,220,${Math.min(1, k * 1.4)})`;
    ctx.strokeStyle = `rgba(20,20,24,${k})`; ctx.lineWidth = 3;
    ctx.font = `900 16px ${G.FONT}`; ctx.textAlign = "center";
    const yy = f0.y - (1 - k) * 22;
    ctx.strokeText(`+${f0.amt} ⚙`, f0.x, yy); ctx.fillText(`+${f0.amt} ⚙`, f0.x, yy);
    ctx.textAlign = "left";
  }
  // Панель расходников + лома (рисуется в makeRoom, справа). Возвращает rect-кнопки.
  function drawConsumablesBar(ctx, s) {
    const order = ["medkit", "emp", "mine"];
    const btns = [];
    const x0 = VIEW.w - 96, y0 = 300, gap = 88;
    // счётчик лома над кнопками
    ctx.fillStyle = "rgba(0,0,0,0.5)"; rr(ctx, x0 - 4, y0 - 48, 84, 34, 8); ctx.fill();
    ctx.fillStyle = "#cfd6dd"; ctx.font = `800 18px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`⚙ ${G.state.scrap}`, x0 + 38, y0 - 31);
    for (let i = 0; i < order.length; i++) {
      const kind = order[i], c = CONSUMABLES[kind], n = (G.state.cons && G.state.cons[kind]) || 0;
      const b = { x: x0, y: y0 + i * gap, w: 76, h: 72, kind };
      const enabled = n > 0;
      ctx.globalAlpha = enabled ? 1 : 0.42;
      ctx.fillStyle = "rgba(15,18,24,0.82)"; rr(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
      ctx.strokeStyle = c.color; ctx.lineWidth = 2.5; rr(ctx, b.x, b.y, b.w, b.h, 12); ctx.stroke();
      ctx.fillStyle = c.color; ctx.font = `900 30px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(c.icon, b.x + b.w / 2, b.y + 30);
      ctx.fillStyle = "#fff"; ctx.font = `800 14px ${G.FONT}`;
      ctx.fillText(`×${n}`, b.x + b.w / 2, b.y + 58);
      ctx.globalAlpha = 1;
      btns.push(b);
      if (G.uiBlock) G.uiBlock.push({ x: b.x, y: b.y, w: b.w, h: b.h }); // не запускать джойстик по кнопке
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    return btns;
  }
  // Силуэт врага по виду (рисуется в локальных коорд., нос/перёд = +x). asleep — слепой не заметил.
  function drawMutantBody(ctx, mu, K, asleep) {
    const t = G.time;
    const eyesOpen = (lx, ly, r) => { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-lx, ly, r, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(lx, ly, r, 0, 7); ctx.fill(); ctx.fillStyle = K.eye; ctx.beginPath(); ctx.arc(-lx + 0.6, ly, r * 0.52, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(lx + 0.6, ly, r * 0.52, 0, 7); ctx.fill(); };
    const eyesShut = (lx, ly, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-lx - 3, ly); ctx.lineTo(-lx + 3, ly); ctx.stroke(); ctx.beginPath(); ctx.moveTo(lx - 3, ly); ctx.lineTo(lx + 3, ly); ctx.stroke(); };
    switch (mu.kind) {
      case "scout": { // обтекаемый дротик-разведчик
        ctx.rotate(Math.sin(t * 9 + mu.x * 0.1) * 0.09); // быстрая дрожь-наскок
        ctx.fillStyle = K.spike;
        ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-20, -15); ctx.lineTo(-7, -8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(-20, 15); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
        const g = ctx.createLinearGradient(-12, 0, 18, 0); g.addColorStop(0, K.c1); g.addColorStop(1, K.c0);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(18, 0); ctx.quadraticCurveTo(6, -13, -10, -8); ctx.quadraticCurveTo(-15, 0, -10, 8); ctx.quadraticCurveTo(6, 13, 18, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#143a4a"; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.ellipse(-1, -4, 7, 2.4, -0.3, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(5, -1, 5, 0, 7); ctx.fill();
        ctx.fillStyle = K.eye; ctx.beginPath(); ctx.arc(7, -1, 2.6, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(8, -2, 0.9, 0, 7); ctx.fill();
        break;
      }
      case "brute": { // широкий бронированный таран с рогами
        if (mu.chMode === "tele") ctx.translate(-4 * (1 - (mu.chT || 0) / 0.7), 0); // замах назад
        else if (mu.chMode === "charge") ctx.translate(7, 0); // подаётся вперёд в рывке
        else ctx.translate(0, Math.sin(t * 2 + mu.x) * 0.8); // тяжёлое дыхание
        const bg = ctx.createRadialGradient(-3, -4, 3, 0, 2, 24); bg.addColorStop(0, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = K.c1; ctx.beginPath(); ctx.arc(-14, -3, 7, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(14, -3, 7, 0, 7); ctx.fill();
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 3, 20, 16, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = "#5a1e0e"; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = "#7a2410"; ctx.beginPath(); ctx.moveTo(-18, -5); ctx.quadraticCurveTo(0, -22, 18, -5); ctx.quadraticCurveTo(0, -13, -18, -5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#ffe9c8"; ctx.strokeStyle = "#7a4a1a"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(14, -1); ctx.quadraticCurveTo(25, -5, 25, 3); ctx.quadraticCurveTo(20, 0, 13, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(13, 9); ctx.quadraticCurveTo(24, 11, 23, 17); ctx.quadraticCurveTo(19, 12, 12, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (asleep) eyesShut(6, 0, "#3a1a0a");
        else { ctx.fillStyle = "#1a0a04"; ctx.fillRect(-10, -2, 8, 4); ctx.fillRect(2, -2, 8, 4); ctx.fillStyle = K.eye; ctx.fillRect(-9, -1, 6, 1.6); ctx.fillRect(3, -1, 6, 1.6); }
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(-10, 10); ctx.lineTo(-7, 16); ctx.lineTo(-3, 10); ctx.lineTo(0, 16); ctx.lineTo(4, 10); ctx.lineTo(8, 16); ctx.lineTo(10, 10); ctx.closePath(); ctx.fill();
        break;
      }
      case "drone": { // парящий механический шар с винтом
        ctx.rotate(Math.sin(t * 5 + mu.x * 0.05) * 0.26); // крен при вилянии
        ctx.strokeStyle = "rgba(210,180,255,0.85)"; ctx.lineWidth = 2; ctx.lineCap = "round";
        const sp = Math.abs(Math.sin(t * 26)) * 12 + 2;
        ctx.beginPath(); ctx.moveTo(-sp, -16); ctx.lineTo(sp, -16); ctx.stroke();
        ctx.strokeStyle = "#9aa3ad"; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, -10); ctx.stroke();
        const bg = ctx.createRadialGradient(-5, -5, 2, 0, 0, 16); bg.addColorStop(0, "#efe6ff"); bg.addColorStop(0.5, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
        ctx.strokeStyle = "#3a1a5a"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#5a4a7a"; rr(ctx, -18, 1, 6, 7, 2); ctx.fill(); rr(ctx, 12, 1, 6, 7, 2); ctx.fill();
        const fl = (Math.sin(t * 16) + 1) / 2; ctx.fillStyle = `rgba(255,90,240,${0.4 + fl * 0.5})`;
        ctx.beginPath(); ctx.arc(-15, 9, 2.4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(15, 9, 2.4, 0, 7); ctx.fill();
        const eg = ctx.createRadialGradient(-1, -1, 1, 0, 0, 6); eg.addColorStop(0, "#fff"); eg.addColorStop(0.5, K.eye); eg.addColorStop(1, "#6a1a6a");
        ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
        ctx.strokeStyle = "#3a1a5a"; ctx.lineWidth = 1.4; ctx.stroke();
        break;
      }
      case "spitter": { // приземистая жаба с кислотным зобом
        const charge = mu.fireT < 0.5 ? 1 - mu.fireT / 0.5 : 0;
        const sacBreath = Math.max(0, Math.sin(t * 2.5 + mu.x)) * 1.6; // зоб дышит
        ctx.fillStyle = `rgba(150,230,70,${0.7 + charge * 0.3})`; ctx.beginPath(); ctx.arc(-9, -2, 9 + charge * 2.5 + sacBreath, 0, 7); ctx.fill();
        ctx.strokeStyle = "#3a5a1e"; ctx.lineWidth = 1.5; ctx.stroke();
        const bg = ctx.createRadialGradient(-2, -3, 3, 2, 3, 20); bg.addColorStop(0, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(2, 3, 16, 13, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = "#244a1a"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#244a1a"; ctx.beginPath(); ctx.ellipse(14, 5, 5, 6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(180,255,90,${0.5 + charge * 0.5})`; ctx.beginPath(); ctx.arc(15, 5, 2.5 + charge * 1.5, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(2, -7, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(10, -6, 4, 0, 7); ctx.fill();
        ctx.fillStyle = K.eye; ctx.beginPath(); ctx.arc(3, -7, 2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(11, -6, 2, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(150,230,70,0.6)"; ctx.beginPath(); ctx.arc(14, 12, 2, 0, 7); ctx.fill();
        break;
      }
      case "burrower": { // крот-копатель с огромными когтями
        const bg = ctx.createRadialGradient(-3, -3, 2, 0, 0, 18); bg.addColorStop(0, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(-2, 2, 15, 14, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = "rgba(58,36,16,0.5)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-10, -8); ctx.quadraticCurveTo(-12, 2, -10, 12); ctx.stroke();
        ctx.fillStyle = "#caa07a"; ctx.beginPath(); ctx.moveTo(10, -2); ctx.lineTo(18, 2); ctx.lineTo(10, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#5a3a1e"; ctx.beginPath(); ctx.arc(16, 2, 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = "#8a6a4a"; ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(5, 8); ctx.lineTo(20, 12); ctx.lineTo(18, 19); ctx.lineTo(5, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e8dcc8"; for (const cx of [9, 13, 17]) { ctx.beginPath(); ctx.moveTo(cx, 11); ctx.lineTo(cx + 4, 17); ctx.lineTo(cx + 1, 13.5); ctx.closePath(); ctx.fill(); }
        if (asleep) eyesShut(4, -3, "#3a2410");
        else { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-4, -3, 3, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(2, -3, 3, 0, 7); ctx.fill(); ctx.fillStyle = K.eye; ctx.beginPath(); ctx.arc(-3, -3, 1.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(3, -3, 1.5, 0, 7); ctx.fill(); }
        break;
      }
      case "frostling": { // кристаллическое ледяное создание (гранёное)
        const bg = ctx.createLinearGradient(0, -16, 0, 16); bg.addColorStop(0, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(14, -6); ctx.lineTo(13, 9); ctx.lineTo(0, 16); ctx.lineTo(-13, 9); ctx.lineTo(-14, -6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#2a5a9a"; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 16); ctx.moveTo(-14, -6); ctx.lineTo(14, -6); ctx.stroke();
        ctx.fillStyle = "#eaffff"; for (const cx2 of [-9, 0, 9]) { ctx.beginPath(); ctx.moveTo(cx2 - 3, -13); ctx.lineTo(cx2 + 3, -13); ctx.lineTo(cx2, -24); ctx.closePath(); ctx.fill(); }
        const corePulse = 8 + Math.sin(t * 4 + mu.x) * 1.8; // ядро пульсирует
        const cg = ctx.createRadialGradient(0, 2, 1, 0, 2, corePulse); cg.addColorStop(0, "#fff"); cg.addColorStop(1, "rgba(150,240,255,0)");
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 2, corePulse, 0, 7); ctx.fill();
        const eyeB = 0.7 + 0.3 * Math.sin(t * 4 + mu.x);
        ctx.fillStyle = K.eye; ctx.globalAlpha = eyeB; ctx.beginPath(); ctx.arc(-5, -2, 2.2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(5, -2, 2.2, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        break;
      }
      default: { // grunt — классический колючий блоб
        const bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, 18); bg.addColorStop(0, K.c0); bg.addColorStop(1, K.c1);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
        ctx.strokeStyle = "#1a3a14"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = K.spike; for (const dx of [-8, -2, 4, 10]) { ctx.beginPath(); ctx.moveTo(dx - 2, -14); ctx.lineTo(dx + 2, -14); ctx.lineTo(dx, -20); ctx.closePath(); ctx.fill(); }
        if (asleep) eyesShut(5.5, -3, "#1a3a14");
        else eyesOpen(5, -3, 4);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(-4, 9); ctx.lineTo(-1, 4); ctx.lineTo(2, 9); ctx.lineTo(5, 4); ctx.lineTo(7, 9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill();
      }
    }
  }
  function drawMutant(ctx, mu) {
    const K = MUTANT_KINDS[mu.kind] || MUTANT_KINDS.grunt;
    // Бурильщик под землёй — только движущийся бугор грунта + летящая пыль
    if (mu.buried) {
      ctx.save(); ctx.translate(mu.x, mu.y);
      ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(0, 6, 26, 8, 0, 0, 7); ctx.fill();
      const mg = ctx.createLinearGradient(0, -10, 0, 10);
      mg.addColorStop(0, "#8a5a34"); mg.addColorStop(1, "#5a3a1e");
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.moveTo(-24, 8);
      for (let i = -24; i <= 24; i += 6) ctx.lineTo(i, 8 - 14 * Math.exp(-(i * i) / 320) + Math.sin(G.time * 18 + i) * 1.2);
      ctx.lineTo(24, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(120,80,48,0.6)";
      for (let i = 0; i < 4; i++) { const a = G.time * 10 + i * 1.7; ctx.fillRect(Math.cos(a) * 18, 4 - Math.abs(Math.sin(a)) * 10, 2.5, 2.5); }
      ctx.restore();
      return;
    }
    const drone = K.fly;
    const esc = mu.elite ? 1.32 : 1;          // элита крупнее
    const sc = K.scale * esc;
    // ЭЛИТНАЯ АУРА (золотое свечение + вращающиеся искры) — под телом, в мировых коорд.
    if (mu.elite) {
      const er = 30 * sc, pulse = 0.5 + 0.5 * Math.sin(G.time * 4 + mu.x);
      const ag = ctx.createRadialGradient(mu.x, mu.y, er * 0.35, mu.x, mu.y, er);
      ag.addColorStop(0, "rgba(255,210,90,0)"); ag.addColorStop(0.62, `rgba(255,200,80,${0.2 + pulse * 0.18})`); ag.addColorStop(1, "rgba(255,180,60,0)");
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(mu.x, mu.y, er, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,228,140,${0.6 + pulse * 0.3})`;
      for (let i = 0; i < 6; i++) { const a = G.time * 1.4 + i * 1.047; ctx.beginPath(); ctx.arc(mu.x + Math.cos(a) * er * 0.78, mu.y + Math.sin(a) * er * 0.58, 2.4, 0, 7); ctx.fill(); }
    }
    const bob = drone ? Math.sin(G.time * 4 + mu.x * 0.1) * 4 : Math.sin(mu.walk * 6) * 2;
    ctx.save(); ctx.translate(mu.x, mu.y + bob);
    // тень (у дрона — парящий ореол вместо контактной тени)
    if (drone) { ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(0, 22 - bob, 11 * esc, 3.5 * esc, 0, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ctx.ellipse(0, 17 * sc, 16 * sc, 4 * sc, 0, 0, 7); ctx.fill(); }
    ctx.scale(mu.face * sc, sc);
    // золотой контур элиты
    if (mu.elite) { ctx.save(); ctx.lineWidth = 2.5 / esc; ctx.strokeStyle = `rgba(255,215,100,${0.5 + 0.3 * Math.sin(G.time * 5)})`; ctx.beginPath(); ctx.arc(0, 0, 19, 0, 7); ctx.stroke(); ctx.restore(); }
    // тело по виду (у каждого свой силуэт)
    drawMutantBody(ctx, mu, K, mu.blind && !mu.aware);
    // вспышка урона
    if (mu.hitT > 0) { ctx.fillStyle = `rgba(255,80,60,${(mu.hitT / 0.45) * 0.6})`; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill(); }
    ctx.restore();
    // Индикатор: «z» когда спит, «!» когда только что заметил робота
    if (mu.blind && !mu.aware) {
      const zo = Math.sin(G.time * 2.4) * 2;
      ctx.fillStyle = "rgba(200,230,255,0.65)";
      ctx.font = `900 italic 14px ${G.FONT}`; ctx.textAlign = "center";
      ctx.fillText("z", mu.x + 14, mu.y - 22 + zo);
      ctx.textAlign = "left";
    } else if (mu.aware && mu.awareT < 0.55) {
      const pop = 1 - mu.awareT / 0.55;
      ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 4;
      ctx.fillStyle = "#ffd24a";
      ctx.font = `900 italic ${22 + pop * 14}px ${G.FONT}`; ctx.textAlign = "center";
      ctx.strokeText("!", mu.x, mu.y - 28);
      ctx.fillText("!", mu.x, mu.y - 28);
      ctx.textAlign = "left";
    }
    // золотая корона элиты + более широкая золотая HP-полоса
    if (mu.elite) {
      const cy = mu.y - 34 * (mu.elite ? 1.32 : 1) - 8 + Math.sin(G.time * 3) * 1.5;
      ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#7a5a10"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mu.x - 9, cy + 5); ctx.lineTo(mu.x - 9, cy - 4); ctx.lineTo(mu.x - 4.5, cy + 1); ctx.lineTo(mu.x, cy - 6); ctx.lineTo(mu.x + 4.5, cy + 1); ctx.lineTo(mu.x + 9, cy - 4); ctx.lineTo(mu.x + 9, cy + 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // полоска HP (у элиты — шире и золотая)
    if (mu.hp < mu.maxHp) {
      const hw = mu.elite ? 22 : 14, hy = mu.y - 36 * (mu.elite ? 1.18 : 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(mu.x - hw, hy, hw * 2, 4);
      ctx.fillStyle = mu.elite ? "#ffd24a" : "#7de08a"; ctx.fillRect(mu.x - hw, hy, hw * 2 * (mu.hp / mu.maxHp), 4);
    }
    // оглушение EMP / таран-в-стену — электро-искры над врагом
    if (mu.stun > 0) {
      ctx.strokeStyle = `rgba(140,220,255,${0.6 + 0.4 * Math.sin(G.time * 30)})`; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const a = G.time * 8 + i * 2.1, rr2 = 16 * K.scale + 4;
        ctx.beginPath(); ctx.moveTo(mu.x + Math.cos(a) * rr2, mu.y - 6 + Math.sin(a) * rr2 * 0.5);
        ctx.lineTo(mu.x + Math.cos(a + 0.4) * (rr2 + 5), mu.y - 6 + Math.sin(a + 0.4) * (rr2 + 5) * 0.5); ctx.stroke();
      }
    }
    // ТЕЛЕГРАФ ТАРАНА (brute): красная стрелка-направление + пульс — успей увернуться дэшем
    if (mu.chMode === "tele") {
      const k = 1 - (mu.chT || 0) / 0.7, pulse = 0.5 + 0.5 * Math.sin(G.time * 22);
      const ang = mu.chAng || 0;
      const len = 40 + k * 60;
      ctx.save();
      ctx.strokeStyle = `rgba(255,70,40,${0.5 + pulse * 0.4})`; ctx.lineWidth = 4 + k * 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(mu.x + Math.cos(ang) * 20, mu.y + Math.sin(ang) * 20);
      ctx.lineTo(mu.x + Math.cos(ang) * len, mu.y + Math.sin(ang) * len); ctx.stroke();
      // наконечник
      ctx.fillStyle = `rgba(255,90,50,${0.6 + pulse * 0.4})`;
      ctx.beginPath();
      const hx = mu.x + Math.cos(ang) * len, hy = mu.y + Math.sin(ang) * len;
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - Math.cos(ang - 0.5) * 14, hy - Math.sin(ang - 0.5) * 14);
      ctx.lineTo(hx - Math.cos(ang + 0.5) * 14, hy - Math.sin(ang + 0.5) * 14);
      ctx.closePath(); ctx.fill();
      // дрожь-кольцо вокруг таранщика
      ctx.strokeStyle = `rgba(255,120,60,${pulse * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mu.x, mu.y, 24 * K.scale + k * 6, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  function drawToast(ctx, t) {
    ctx.save();
    ctx.globalAlpha = clamp(t.t * 2.5, 0, 1);
    const msg = t.msg || "";
    const maxTextW = 800; // длинные дневники переносим по строкам
    ctx.font = "600 20px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    // перенос по словам
    const words = msg.split(" ");
    const lines = []; let line = "";
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > maxTextW && line) { lines.push(line); line = wd; }
      else line = test;
    }
    if (line) lines.push(line);
    // ширина блока по самой длинной строке, высота — по числу строк
    let textW = 0; for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);
    const lh = 27, padX = 26, padY = 15;
    const boxW = Math.min(VIEW.w - 36, textW + padX * 2);
    const boxH = lines.length * lh + padY * 2 - 6;
    const bx = VIEW.w / 2 - boxW / 2, by = 74;
    ctx.fillStyle = "rgba(20,10,6,0.93)"; rr(ctx, bx, by, boxW, boxH, 10); ctx.fill();
    ctx.strokeStyle = "rgba(255,200,140,0.6)"; ctx.lineWidth = 1.5; rr(ctx, bx, by, boxW, boxH, 10); ctx.stroke();
    ctx.fillStyle = "#ffe6c8"; ctx.textBaseline = "middle";
    let yy = by + padY + lh / 2 - 1;
    for (const l of lines) { ctx.fillText(l, VIEW.w / 2, yy); yy += lh; }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  // призрачный след рывка
  function drawDashTrail(ctx, robot) {
    if (!robot._dashTrail || !robot._dashTrail.length) return;
    ctx.save();
    for (const g of robot._dashTrail) {
      ctx.globalAlpha = clamp(g.t / 0.22, 0, 1) * 0.4;
      ctx.fillStyle = "#bfe9ff";
      ctx.beginPath(); ctx.ellipse(g.x, g.y, robot.r * 0.7, robot.r * 0.85, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.restore();
  }
  // кнопка рывка (правый-нижний угол), с индикатором кулдауна
  function drawDashButton(ctx, robot) {
    const cd = robot.dashCd || 0;
    const ready = cd <= 0 && !(robot.dashT > 0);
    const cx = VIEW.w - 74, cy = VIEW.h - 80, r = 44;
    const rect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    ctx.save();
    ctx.globalAlpha = ready ? 0.96 : 0.5;
    const g = ctx.createRadialGradient(cx, cy - 8, 4, cx, cy, r);
    g.addColorStop(0, ready ? "#6ad0ff" : "#3a4a55"); g.addColorStop(1, ready ? "#1f6f9a" : "#1a2630");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = ready ? "#bfeeff" : "#3a4a55"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = ready ? "#fff" : "#9aa3ad"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 32px ${G.FONT}`; ctx.fillText("»", cx, cy - 3);
    ctx.font = `800 12px ${G.FONT}`; ctx.fillText("РЫВОК", cx, cy + 22);
    if (cd > 0) {
      ctx.strokeStyle = "rgba(190,235,255,0.8)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, r - 3, -PI / 2, -PI / 2 + (1 - cd / 0.85) * PI * 2); ctx.stroke();
    }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.restore();
    if (G.uiBlock) G.uiBlock.push(rect);
    return rect;
  }

  function rightExit(s, extra) {
    const b = s.bounds;
    return Object.assign({ x: b.x + b.w - 50, y: b.y + b.h / 2 - 48, w: 54, h: 96, label: "→ Дальше" }, extra || {});
  }

  /* =========================================================================
     БАЗОВЫЙ КОНСТРУКТОР КОМНАТЫ (робот ходит, собирает, уворачивается)
     ========================================================================= */
  function makeRoom(opt) {
    const s = {
      name: opt.name,
      dayValue: opt.dayValue,
      recharge: opt.recharge,
      useJoystick: true,
      isRoom: true, // игровая комната — для цикла день/ночь
      robot: { x: 0, y: 0, r: 22, vx: 0, vy: 0, face: 1, walk: 0, punching: 0 },
      mutants: [],
      bounds: opt.bounds || { x: 70, y: 150, w: 884, h: 520 },
      speed: opt.speed || 235,
      drain: opt.drain != null ? opt.drain : 0.45,
      ice: !!opt.ice, // ледяной биом — скользкое движение по инерции
      noBaseCharge: !!opt.noBaseCharge, // вне досягаемости базы (глава 2) — без солнечной подзарядки
      dashAlways: !!opt.dash, // показывать кнопку рывка даже без врагов (опасные сцены)
      obstacles: [], interactables: [], exitZone: null,
      narr: opt.narr || "",
      _toast: null, _flash: 0, _invuln: 0, _actBtn: null, data: {},

      // длительность не меньше времени чтения (по длине текста) — длинные дневники успеваешь прочесть
      toast(msg, dur) { const readT = 1.8 + (msg ? msg.length : 0) * 0.045; this._toast = { msg, t: Math.max(dur || 2.2, readT) }; },
      hurt(amount, knock) {
        if (this._invuln > 0) return;
        this._invuln = 0.6; this._flash = 0.5;
        let amt = amount || 8;
        if (G.state.upgShield) amt *= 0.6; // апгрейд брони
        amt *= G.diff().eDmg;              // множитель сложности
        G.state.battery = Math.max(0, G.state.battery - amt);
        G.audio.hit();
        // боевой сок: тряска + короткая заморозка + вспышка-кольцо
        G.shake(Math.min(13, 5 + amt * 0.4)); G.hitStop(0.04);
        G.fx.ring(this.robot.x, this.robot.y, "#ff6a4a", 40, 0.3);
        if (knock) { this.robot.x += knock.x || 0; this.robot.y += knock.y || 0; }
      },
      fail(msg) {
        this.toast(msg || "Неудача! Попробуйте снова.", 2.2);
        this.robot.x = this._sx; this.robot.y = this._sy;
        this._flash = 0.6; this._invuln = 1.0; G.audio.hit();
        if (opt.onFail) opt.onFail(this);
      },

      enter() {
        G._lastRoom = this.name;
        this.obstacles = []; this.interactables = []; this.exitZone = null;
        this._toast = null; this._flash = 0; this._invuln = 0; this.data = {};
        this.mutants = [];
        this.enemyShots = []; this.mines = [];
        const st = opt.start || { x: this.bounds.x + 50, y: this.bounds.y + this.bounds.h / 2 };
        this.robot.x = st.x; this.robot.y = st.y; this.robot.walk = 0; this.robot.face = 1;
        this.robot.punching = 0; this.robot.frozen = 0; this.robot.ivx = 0; this.robot.ivy = 0;
        this.robot.dashT = 0; this.robot.dashCd = 0; this.robot._dashTrail = [];
        this._sx = st.x; this._sy = st.y;
        if (opt.build) opt.build(this);
      },

      update(dt) {
        if (this._toast) { this._toast.t -= dt; if (this._toast.t <= 0) this._toast = null; }
        if (this._flash > 0) this._flash -= dt;
        if (this._invuln > 0) this._invuln -= dt;
        if (this.robot.dashCd > 0) this.robot.dashCd = Math.max(0, this.robot.dashCd - dt);
        // затухание следа рывка
        if (this.robot._dashTrail && this.robot._dashTrail.length) {
          for (let i = this.robot._dashTrail.length - 1; i >= 0; i--) { const g = this.robot._dashTrail[i]; g.t -= dt; if (g.t <= 0) this.robot._dashTrail.splice(i, 1); }
        }

        const canMove = opt.shouldMove ? opt.shouldMove(this) : true;
        if (canMove) moveRobot(this, dt);

        const d = G.moveDir();
        // ночью разряд быстрее, днём медленнее (цикл день/ночь); апгрейд батареи −25%
        const battUpg = (G.state.upgBattery ? 0.75 : 1) * (G.state.artBattery ? 0.85 : 1);
        const cleatUpg = (this.ice && G.state.upgIceCleats) ? 0.7 : 1; // шипы: меньше борьбы со льдом → −30% холода
        G.state.battery -= dt * (this.drain * (d.mag > 0.05 ? 1 : 0.4)) * G.dayDrainFactor() * battUpg * cleatUpg * G.diff().drain;
        // база подзаряжает робота днём (апгрейд усиливает, повреждённая база — слабее).
        // На ледяной луне (noBaseCharge) база недосягаема — холод не компенсируется.
        // База подзаряжает робота днём — но умеренно, чтобы заряд оставался ресурсом
        // (раньше +1.6/с гасил почти любой расход и убивал напряжение).
        if (G.state.hasBase && !this.noBaseCharge) { const hpf = (G.state.baseHP != null ? G.state.baseHP : 100) / 100; G.state.battery = Math.min(100, G.state.battery + dt * G.daylight() * (G.state.upgBattery ? 1.2 : 0.7) * (0.4 + 0.6 * hpf) * G.diff().recharge); }
        if (G.state.battery <= 0) { G.state.battery = 0; G.go("gameover"); return; }

        if (opt.update) opt.update(this, dt);
        // дрон-помощник летит за роботом
        if (G.state.hasDrone) {
          if (!G.drone) G.drone = { x: this.robot.x - 40, y: this.robot.y - 40 };
          const tx = this.robot.x - this.robot.face * 36, ty = this.robot.y - 38;
          G.drone.x += (tx - G.drone.x) * Math.min(1, dt * 4);
          G.drone.y += (ty - G.drone.y) * Math.min(1, dt * 4);
        }
        // мутанты
        if (this.mutants && this.mutants.length) {
          for (let i = this.mutants.length - 1; i >= 0; i--) {
            updateMutant(this, this.mutants[i], dt);
            if (this.mutants[i].hp <= 0) { const dm = this.mutants[i]; if (!dm.noScrap) { dropScrap(this, dm); mutantDeathFx(this, dm); } this.mutants.splice(i, 1); }
          }
        }
        if (this._scrapFloat) { this._scrapFloat.t -= dt; if (this._scrapFloat.t <= 0) this._scrapFloat = null; }
        updateEnemyShots(this, dt);   // вражеские снаряды (плевок)
        updateMines(this, dt);        // расставленные мины-расходники
        if (this.data._slamCd > 0) this.data._slamCd = Math.max(0, this.data._slamCd - dt); // кулдаун удара по льду
        // таймер удара робота
        if (this.robot.punching > 0) this.robot.punching = Math.max(0, this.robot.punching - dt);
        this._checkExit();
      },

      onAction() { this._tryInteract(); },
      _nearInteractable() {
        let best = null, bd = 1e9;
        for (const it of this.interactables) {
          if (it.ready && !it.ready(this)) continue;
          const dd = dist(this.robot.x, this.robot.y, it.x, it.y);
          if (dd < (it.r || 78) && dd < bd) { bd = dd; best = it; }
        }
        return best;
      },
      onDash() { this._tryDash(); },
      _tryDash() {
        const rb = this.robot;
        if (rb.frozen > 0 || rb.dashT > 0 || (rb.dashCd || 0) > 0) return;
        const d = G.moveDir();
        let dx = d.x, dy = d.y;
        if (d.mag < 0.12) { dx = rb.face || 1; dy = 0; } // нет ввода → рывок по направлению взгляда
        const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
        rb.dashDX = dx; rb.dashDY = dy;
        rb.dashT = 0.18; rb.dashCd = 0.85;
        this._invuln = Math.max(this._invuln, 0.26); // i-frames на время рывка (уворот)
        G.audio.tone(680, 0.09, "sine", 0.045);
        G.fx.burst(rb.x, rb.y, "#bfe9ff", 10, 150, 0.4);
      },
      _tryInteract() {
        if (this.robot.frozen > 0) return; // скован льдом — ни ударить, ни взять
        const it = this._nearInteractable();
        if (it) { it.act(this); }
        else if (this.robot.punching <= 0) {
          this.robot.punching = 0.3;
          G.audio.tone(900, 0.06, "square", 0.05);
          // бонус ледовых шипов: удар по льду — морозная волна (на кулдауне)
          if (this.ice && G.state.upgIceCleats && !(this.data._slamCd > 0)) { iceSlam(this); this.data._slamCd = 1.6; }
        }
      },
      _checkExit() {
        const e = this.exitZone; if (!e) return;
        if (e.ready && !e.ready(this)) return;
        if (rectHit(e, this.robot.x, this.robot.y)) {
          if (e._fired) return; e._fired = true;
          G.audio.door();
          if (e.onExit) e.onExit(this); else if (e.to) G.go(e.to);
        }
      },

      onTap(x, y) {
        // кнопка рывка
        if (this._dashBtn && rectHit(this._dashBtn, x, y)) { this._tryDash(); return; }
        // расходники (аптечка/ЭМИ/мина)
        if (this._consBtns) {
          for (const b of this._consBtns) {
            if (rectHit(b, x, y)) {
              if (G.state.cons[b.kind] > 0) useConsumable(this, b.kind);
              else { G.audio.tone(180, 0.1, "square", 0.04); this.toast("Нет расходника — скрафти на верстаке у принтера", 2.0); }
              return;
            }
          }
        }
        if (this._actBtn && rectHit(this._actBtn, x, y)) { this._tryInteract(); return; }
        if (opt.onTap) opt.onTap(this, x, y);
      },
      onPointerDown(x, y) { if (opt.onPointerDown) opt.onPointerDown(this, x, y); },
      onPointerMove(x, y) { if (opt.onPointerMove) opt.onPointerMove(this, x, y); },
      onPointerUp(x, y) { if (opt.onPointerUp) opt.onPointerUp(this, x, y); },

      draw(ctx) {
        if (opt.bg) opt.bg(ctx, this); else G.drawTombRoom(ctx, this.bounds, opt.roomStyle || {});
        if (opt.drawUnder) opt.drawUnder(this, ctx);

        const e = this.exitZone;
        if (e && e.draw !== false) {
          const open = !e.ready || e.ready(this);
          const lbl = typeof e.label === "function" ? e.label(this) : e.label;
          G.drawDoor(ctx, e.x, e.y, e.w, e.h, open, lbl);
        }
        if (opt.drawProps) opt.drawProps(this, ctx);
        // собираемые предметы (дневники и т.п.) — обобщённый рендер
        for (const it of this.interactables) {
          if (it.pickup && (!it.ready || it.ready(this))) drawPickup(ctx, it);
        }
        // мины (на земле, под роботом) и мутанты
        drawMines(ctx, this);
        if (this.mutants) for (const mu of this.mutants) drawMutant(ctx, mu);
        drawEnemyShots(ctx, this);
        drawDashTrail(ctx, this.robot); // призрачный след рывка
        G.drawRobot(ctx, this.robot.x, this.robot.y, this.robot.r, this.robot.face, this.robot.walk);
        if (this.robot.frozen > 0) drawFrozenShell(ctx, this.robot);
        if (this.robot.punching > 0 && !(this.robot.frozen > 0)) drawPunchArm(ctx, this.robot);
        if (opt.drawOver) opt.drawOver(this, ctx);

        // атмосферный налёт день/ночь — поверх мира, но под HUD/кнопками
        G.dayNightOverlay(ctx);

        // дрон-помощник (с фонарём — рисуем ПОВЕРХ налёта, чтобы светил ночью)
        if (G.state.hasDrone && G.drone) drawPetDrone(ctx, G.drone.x, G.drone.y);

        drawScrapFloat(ctx, this);
        if (this._flash > 0) { ctx.fillStyle = `rgba(255,40,30,${this._flash * 0.5})`; ctx.fillRect(0, 0, VIEW.w, VIEW.h); }

        G.drawHUD(ctx);
        G.narrationBox(ctx, typeof opt.narr === "function" ? opt.narr(this) : this.narr);

        const it = this._nearInteractable();
        const hasEnemies = (this.mutants && this.mutants.length > 0) || (this.data && this.data.boss && this.data.boss.hp > 0);
        const lbl = it ? (typeof it.label === "function" ? it.label() : it.label) : (hasEnemies ? "Удар 👊" : null);
        this._actBtn = (it || hasEnemies) ? G.actionButton(ctx, lbl) : null;

        // панель расходников — когда есть что применить или идёт бой
        const totalCons = G.state.cons ? (G.state.cons.medkit + G.state.cons.emp + G.state.cons.mine) : 0;
        this._consBtns = (totalCons > 0 || hasEnemies) ? drawConsumablesBar(ctx, this) : null;

        // кнопка РЫВКА — только в бою/опасных сценах (вне боя не захламляем)
        this._dashBtn = (hasEnemies || this.dashAlways) ? drawDashButton(ctx, this.robot) : null;

        if (this._toast) drawToast(ctx, this._toast);
        G.drawJoystick(ctx);
      },
    };
    return s;
  }

  /* =========================================================================
     ФОНЫ
     ========================================================================= */
  function starfield(ctx, n, seed) {
    let r = seed || 1;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    ctx.fillStyle = "#fff";
    for (let i = 0; i < n; i++) {
      const x = rnd() * VIEW.w, y = rnd() * VIEW.h * 0.7, a = 0.3 + rnd() * 0.7;
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(G.time * 2 + i));
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
  }
  function drawMarsSky(ctx) {
    const sh = G.sunHeight ? G.sunHeight() : 0.85;     // -1 ночь … +1 полдень
    const nl = clamp(-sh, 0, 1);                       // уровень ночи
    const sunset = clamp(1 - Math.abs(sh) * 2.2, 0, 1); // пик на закате/рассвете
    // цветовая палитра неба по времени суток
    const top = lerpHex("#2a0e0c", "#070818", nl);
    const mid = lerpHex("#7a2e18", "#121130", nl);
    let hor = lerpHex("#e6a25a", "#221a32", nl);
    hor = lerpHex(hor, "#e0663a", sunset * 0.55);       // тёплый закатный подмес
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, top); g.addColorStop(0.42, mid);
    g.addColorStop(0.74, lerpHex(mid, hor, 0.6)); g.addColorStop(1, hor);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // звёзды — ярче ночью
    starfield(ctx, 70, 7);
    if (nl > 0.08) {
      for (let i = 0; i < 60; i++) {
        const x = (i * 167.3) % VIEW.w, y = (i * 89.7) % (VIEW.h * 0.5);
        const tw = 0.4 + 0.6 * (Math.sin(G.time * 2 + i) + 1) / 2;
        ctx.fillStyle = `rgba(220,235,255,${(0.6 * nl * tw).toFixed(3)})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // спутник Фобос (всегда виден как небольшая луна Марса)
    ctx.fillStyle = "#9a8a7a"; ctx.beginPath(); ctx.arc(180, 120, 14, 0, 7); ctx.fill();
    ctx.fillStyle = "#7d6e60"; ctx.beginPath(); ctx.arc(184, 124, 11, 0, 7); ctx.fill();
    ctx.fillStyle = "#615448"; ctx.beginPath(); ctx.arc(175, 115, 3.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(189, 123, 2.5, 0, 7); ctx.fill();
    // СОЛНЦЕ или ЛУНА по дуге (зависит от dayCycle)
    const cyc = G.dayCycle != null ? G.dayCycle : 0.42;
    if (sh > -0.05) {
      // солнце: дуга от рассвета (слева) к закату (справа)
      const p = clamp((cyc - 0.25) / 0.5, -0.15, 1.15);
      const sx = VIEW.w * p, sy = 210 - Math.max(0, sh) * 155;
      const rays = ctx.createRadialGradient(sx, sy, 10, sx, sy, 300);
      rays.addColorStop(0, `rgba(255,220,170,${0.20 + sunset * 0.18})`); rays.addColorStop(1, "rgba(255,200,150,0)");
      ctx.fillStyle = rays; ctx.beginPath(); ctx.arc(sx, sy, 300, 0, 7); ctx.fill();
      const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 80);
      const core = lerpHex("#fff6de", "#ff9a5a", sunset);
      sg.addColorStop(0, "rgba(255,246,222,0.98)"); sg.addColorStop(0.4, "rgba(255,224,178,0.8)"); sg.addColorStop(1, "rgba(255,200,150,0)");
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 80, 0, 7); ctx.fill();
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, 28, 0, 7); ctx.fill();
    } else {
      // луна: ночная дуга (восход на закате слева → заход на рассвете справа)
      const np = clamp(((cyc - 0.75 + 1) % 1) / 0.5, 0, 1);
      const mx = VIEW.w * np, my = 200 - nl * 130;
      const halo = ctx.createRadialGradient(mx, my, 8, mx, my, 110);
      halo.addColorStop(0, "rgba(200,220,255,0.25)"); halo.addColorStop(1, "rgba(160,190,255,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 110, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8eeff"; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(150,170,210,0.5)"; // кратеры
      ctx.beginPath(); ctx.arc(mx - 8, my - 6, 5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + 7, my + 5, 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + 2, my - 10, 3, 0, 7); ctx.fill();
    }
    // пыльная дымка у горизонта
    const haze = ctx.createLinearGradient(0, VIEW.h * 0.42, 0, VIEW.h * 0.72);
    haze.addColorStop(0, "rgba(230,150,90,0)"); haze.addColorStop(1, `rgba(232,150,88,${0.4 - nl * 0.25})`);
    ctx.fillStyle = haze; ctx.fillRect(0, VIEW.h * 0.42, VIEW.w, VIEW.h * 0.3);
  }

  function drawMountains(ctx, baseY) {
    // дальний хребет (в дымке — светлее)
    ctx.fillStyle = "#9a5736";
    ctx.beginPath(); ctx.moveTo(0, baseY);
    const far = [[0, baseY], [140, baseY - 95], [300, baseY - 45], [480, baseY - 125], [680, baseY - 65], [860, baseY - 110], [1024, baseY - 55], [1024, baseY]];
    for (const p of far) ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.fill();
    // средний хребет
    ctx.fillStyle = "#5a2718";
    ctx.beginPath(); ctx.moveTo(0, baseY);
    const peaks = [[0, baseY], [120, baseY - 150], [240, baseY - 60], [400, baseY - 200], [560, baseY - 90], [720, baseY - 170], [900, baseY - 70], [1024, baseY - 140], [1024, baseY]];
    for (const p of peaks) ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.fill();
    // солнечная подсветка гребня (со стороны солнца)
    ctx.strokeStyle = "rgba(255,190,120,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(560, baseY - 90); ctx.lineTo(720, baseY - 170); ctx.lineTo(900, baseY - 70); ctx.stroke();
    // ближний хребет (тёмный)
    ctx.fillStyle = "#3a160d";
    ctx.beginPath(); ctx.moveTo(0, baseY);
    const peaks2 = [[0, baseY], [180, baseY - 90], [340, baseY - 40], [520, baseY - 120], [700, baseY - 50], [880, baseY - 110], [1024, baseY - 60], [1024, baseY]];
    for (const p of peaks2) ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.fill();
  }

  // Нормальный вход в пещеру: скальная арка, глубина, сталактиты, валуны, свечение.
  // cx — центр, baseY — линия пола, w — полуширина проёма, h — высота.
  function drawCaveEntrance(ctx, cx, baseY, w, h) {
    ctx.save();
    // скальный массив вокруг проёма
    const rock = ctx.createLinearGradient(cx, baseY - h * 1.3, cx, baseY);
    rock.addColorStop(0, "#4a3122"); rock.addColorStop(1, "#291910");
    ctx.fillStyle = rock;
    ctx.beginPath();
    ctx.moveTo(cx - w * 1.7, baseY + 8);
    ctx.quadraticCurveTo(cx - w * 1.85, baseY - h * 0.85, cx - w * 0.7, baseY - h * 1.12);
    ctx.quadraticCurveTo(cx - w * 0.2, baseY - h * 1.32, cx + w * 0.18, baseY - h * 1.28);
    ctx.quadraticCurveTo(cx + w * 1.05, baseY - h * 1.16, cx + w * 1.8, baseY - h * 0.7);
    ctx.quadraticCurveTo(cx + w * 1.95, baseY - h * 0.2, cx + w * 1.7, baseY + 8);
    ctx.closePath(); ctx.fill();
    // объёмная тень скалы у проёма
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(cx, baseY - h * 0.55, w * 1.35, h * 0.78, 0, 0, 7); ctx.fill();
    // подсветка камня сверху-слева
    ctx.strokeStyle = "rgba(255,200,150,0.18)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - w * 1.45, baseY - h * 0.55);
    ctx.quadraticCurveTo(cx - w * 0.6, baseY - h * 1.1, cx + w * 0.12, baseY - h * 1.22);
    ctx.stroke();

    // сам проём с уходящей вглубь темнотой
    const depth = ctx.createRadialGradient(cx, baseY - h * 0.62, h * 0.05, cx, baseY - h * 0.45, h);
    depth.addColorStop(0, "#000000"); depth.addColorStop(0.55, "#0b0705"); depth.addColorStop(1, "#1c1009");
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.moveTo(cx - w, baseY);
    ctx.quadraticCurveTo(cx - w * 1.05, baseY - h * 0.5, cx - w * 0.42, baseY - h * 0.92);
    ctx.quadraticCurveTo(cx - w * 0.14, baseY - h * 1.06, cx, baseY - h * 1.06);
    ctx.quadraticCurveTo(cx + w * 0.14, baseY - h * 1.06, cx + w * 0.42, baseY - h * 0.92);
    ctx.quadraticCurveTo(cx + w * 1.05, baseY - h * 0.5, cx + w, baseY);
    ctx.closePath(); ctx.fill();

    // манящее свечение из глубины
    const gl = ctx.createRadialGradient(cx, baseY - h * 0.42, 2, cx, baseY - h * 0.42, h * 0.55);
    const pulse = 0.12 + ((Math.sin(G.time * 1.6) + 1) / 2) * 0.1;
    gl.addColorStop(0, `rgba(255,170,90,${pulse})`); gl.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, baseY - h * 0.42, h * 0.55, 0, 7); ctx.fill();

    // сталактиты сверху внутри
    ctx.fillStyle = "#241710";
    for (let i = -2; i <= 2; i++) {
      const sx = cx + i * w * 0.32;
      const sh = h * (0.12 + ((i + 2) % 3) * 0.05);
      ctx.beginPath(); ctx.moveTo(sx - 5, baseY - h * 0.98); ctx.lineTo(sx + 5, baseY - h * 0.98); ctx.lineTo(sx, baseY - h * 0.98 + sh); ctx.closePath(); ctx.fill();
    }
    // валуны у основания
    ctx.fillStyle = "#352115";
    ctx.beginPath(); ctx.ellipse(cx - w * 0.92, baseY - 2, w * 0.42, h * 0.12, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + w * 0.86, baseY, w * 0.5, h * 0.13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#46301f";
    ctx.beginPath(); ctx.ellipse(cx - w * 0.92, baseY - 5, w * 0.3, h * 0.07, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawSandFloor(ctx, b) {
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, "#caa066"); g.addColorStop(1, "#9a743f");
    ctx.fillStyle = g; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "rgba(120,90,50,0.4)"; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const yy = b.y + 40 + i * 60;
      ctx.moveTo(b.x, yy);
      for (let x = b.x; x <= b.x + b.w; x += 40) ctx.lineTo(x, yy + Math.sin((x + i * 30) * 0.03) * 6);
      ctx.stroke();
    }
  }

  /* =========================================================================
     1. МЕНЮ
     ========================================================================= */
  G.addScene("menu", {
    recharge: false,
    enter() {
      const has = G.hasSave && G.hasSave();
      this.hasSave = has;
      let y0 = has ? 400 : 440;
      this.bContinue = has ? { x: VIEW.w / 2 - 150, y: y0, w: 300, h: 60, text: "▶ Продолжить", fs: 25 } : null;
      if (has) y0 += 72;
      this.bStart = { x: VIEW.w / 2 - 150, y: y0, w: 300, h: has ? 52 : 64, text: has ? "🔄 Новая игра" : "▶ Начать игру", fs: has ? 22 : 26 };
      this.bChallenge = { x: VIEW.w / 2 - 150, y: y0 + (has ? 64 : 76), w: 300, h: 50, text: "🎯 Испытания", fs: 22 };
      this.bDifficulty = { x: VIEW.w / 2 - 150, y: this.bChallenge.y + 58, w: 300, h: 48, text: "", fs: 19 };
      this.bSound = { x: VIEW.w / 2 - 110, y: this.bDifficulty.y + 54, w: 220, h: 40, text: "", fs: 16 };
    },
    update() {},
    onTap(x, y) {
      if (this.bContinue && rectHit(this.bContinue, x, y)) { G.audio.blip(); const room = G.loadGame(); G.go(room || "surface"); return; }
      if (rectHit(this.bStart, x, y)) { G.audio.blip(); G.resetState(); G.clearSave(); G.go("cutscene"); }
      else if (rectHit(this.bChallenge, x, y)) { G.audio.blip(); G.go("challenges"); }
      else if (rectHit(this.bDifficulty, x, y)) { G.cycleDifficulty(); G.audio.blip(); }
      else if (rectHit(this.bSound, x, y)) { G.state.sound = !G.state.sound; if (G.state.sound) { G.audio.resume(); G.audio.blip(); } else if (G.music) G.music.stop(); }
    },
    draw(ctx) {
      drawMarsSky(ctx);
      drawMountains(ctx, 470);
      // земля
      ctx.fillStyle = "#7a4a26"; ctx.fillRect(0, 460, VIEW.w, VIEW.h - 460);
      // вход в пещеру
      drawCaveEntrance(ctx, 888, 462, 46, 104);

      G.drawRobot(ctx, 250, 430, 40, 1, G.time);

      // заголовок
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.45)"; rr(ctx, VIEW.w / 2 - 380, 76, 760, 168, 18); ctx.fill();
      ctx.fillStyle = "#ffd9a0"; ctx.font = f(52, "800");
      ctx.fillText("ВЫЖИВАНИЕ НА МАРСЕ", VIEW.w / 2, 146);
      ctx.fillStyle = "#ff8a4a"; ctx.font = f(36, "800");
      ctx.fillText("за 100 дней", VIEW.w / 2, 194);
      // авторская подпись — идея и сюжет придуманы Львом (6 лет)
      const credPulse = 0.7 + 0.3 * Math.sin(G.time * 2);
      ctx.fillStyle = `rgba(150,225,255,${credPulse})`; ctx.font = f(15, "700");
      ctx.fillText("✦ designed by Lev Popchenko · по сюжету Льва (6 лет) ✦", VIEW.w / 2, 226);

      this.bSound.text = G.state.sound ? "🔊 Звук: вкл" : "🔇 Звук: выкл";
      const dfc = G.diff();
      this.bDifficulty.text = `${dfc.icon} Сложность: ${dfc.name}`;
      if (this.bContinue) G.button(ctx, this.bContinue, true);
      G.button(ctx, this.bStart, !this.bContinue);
      G.button(ctx, this.bChallenge, false);
      G.button(ctx, this.bDifficulty, false);
      G.button(ctx, this.bSound, false);

      ctx.fillStyle = "rgba(255,230,200,0.8)"; ctx.font = f(13);
      const hy = Math.max(648, this.bSound.y + this.bSound.h + 20);
      ctx.fillText("Тащите пальцем для движения • тапайте «Действие» для взаимодействия", VIEW.w / 2, hy);
      ctx.fillText("(на компьютере: стрелки/WASD и клавиша E)", VIEW.w / 2, hy + 21);
      ctx.textAlign = "left";
    },
  });

  /* =========================================================================
     2. КАТ-СЦЕНА (вступление)
     ========================================================================= */
  G.addScene("cutscene", {
    recharge: false,
    enter() { this.i = 0; this.t = 0; this.boomed = false; this.beats = makeBeats(); },
    update(dt) {
      this.t += dt;
      const b = this.beats[this.i];
      if (b.onTime) b.onTime(this, dt);
      if (this.t > b.dur) this.next();
    },
    next() {
      this.i++; this.t = 0; this.boomed = false; G.fx.clear();
      if (this.i >= this.beats.length) G.go("surface");
    },
    onTap(x, y) {
      if (rectHit({ x: VIEW.w - 156, y: 24, w: 138, h: 40 }, x, y)) { G.go("surface"); return; }
      this.next();
    },
    draw(ctx) {
      const b = this.beats[this.i] || this.beats[this.beats.length - 1];
      b.draw(ctx, Math.min(this.t, b.dur), this);
      // комикс-рамка панели
      ctx.lineJoin = "miter"; ctx.strokeStyle = INK; ctx.lineWidth = 14; ctx.strokeRect(7, 7, VIEW.w - 14, VIEW.h - 14);
      // жёлтый комикс-капшн
      const cw = 884, ch = 96, cx = VIEW.w / 2 - cw / 2, cy = VIEW.h - ch - 28;
      ctx.fillStyle = "#fff2c2"; ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.strokeRect(cx, cy, cw, ch);
      ctx.fillStyle = "#2a1a10"; ctx.font = `700 21px ${G.FONT}`; ctx.textAlign = "center";
      G.wrapText(ctx, b.text, VIEW.w / 2, cy + 36, cw - 70, 28);
      ctx.font = `600 13px ${G.FONT}`; ctx.fillStyle = "rgba(40,20,10,0.55)";
      ctx.fillText("тап — далее", VIEW.w / 2, cy + ch - 12);
      // кнопка «Пропустить» (комикс)
      const sb = { x: VIEW.w - 156, y: 24, w: 138, h: 40 };
      ctx.fillStyle = "#ffe14a"; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
      ctx.fillStyle = INK; ctx.font = `800 16px ${G.FONT}`; ctx.textBaseline = "middle";
      ctx.fillText("Пропустить ▶", sb.x + sb.w / 2, sb.y + sb.h / 2); ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    },
  });

  /* ===== Комикс-стиль кат-сцены: жирные контуры, плоские цвета, halftone, SFX ===== */
  const INK = "#1d1424";
  function ink(ctx, lw) { ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(); }
  function halftoneGrad(ctx, x, y, w, h, rgb, sp, fromTop) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = `rgb(${rgb})`;
    const max = sp * 0.5;
    for (let yy = y; yy < y + h + sp; yy += sp) {
      const row = Math.round((yy - y) / sp);
      for (let xx = x - sp + (row % 2) * sp / 2; xx < x + w + sp; xx += sp) {
        const tt = (yy - y) / h, fc = fromTop ? 1 - tt : tt;
        const r = max * (fc < 0 ? 0 : fc > 1 ? 1 : fc);
        if (r > 0.5) { ctx.beginPath(); ctx.arc(xx, yy, r, 0, 7); ctx.fill(); }
      }
    }
    ctx.restore();
  }
  function comicStar(ctx, x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = "#fff7d6"; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; const rr2 = i % 2 ? r * 0.34 : r; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fill(); ink(ctx, 2); ctx.restore();
  }
  function burstShape(ctx, cx, cy, rOut, rIn, spikes, fill, outline, rot) {
    if (rOut <= 1) return;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot || 0); ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * PI * 2;
      const base = i % 2 ? rIn : rOut;
      const jit = i % 2 ? 1 : 0.84 + ((i * 37) % 11) / 34;
      ctx.lineTo(Math.cos(a) * base * jit, Math.sin(a) * base * jit);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (outline) { ctx.lineJoin = "round"; ctx.strokeStyle = outline; ctx.lineWidth = 5; ctx.stroke(); }
    ctx.restore();
  }
  function sfxText(ctx, text, cx, cy, size, fill, rot) {
    if (size < 3) return;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot || 0);
    ctx.font = `900 italic ${size}px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(3, size * 0.18); ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill; ctx.fillText(text, 0, 0);
    ctx.textBaseline = "alphabetic"; ctx.restore();
  }
  function speedLines(ctx, cx, cy, rIn, rOut, n, color, alpha) {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2 + 0.15; const j = 0.7 + ((i * 53) % 10) / 22; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn); ctx.lineTo(cx + Math.cos(a) * rOut * j, cy + Math.sin(a) * rOut * j); ctx.stroke(); }
    ctx.restore();
  }
  function comicFlame(ctx, bx, by, len, hw, dir) {
    ctx.save(); ctx.translate(bx, by); ctx.rotate(dir || 0);
    const ls = [[len, hw, "#ff5a2a"], [len * 0.68, hw * 0.7, "#ffb43a"], [len * 0.4, hw * 0.42, "#ffe9a0"]];
    for (const l of ls) { ctx.fillStyle = l[2]; ctx.beginPath(); ctx.moveTo(0, -l[1]); ctx.quadraticCurveTo(-l[0] * 0.5, -l[1] * 0.4, -l[0], 0); ctx.quadraticCurveTo(-l[0] * 0.5, l[1] * 0.4, 0, l[1]); ctx.closePath(); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(0, -hw); ctx.quadraticCurveTo(-len * 0.5, -hw * 0.4, -len, 0); ctx.quadraticCurveTo(-len * 0.5, hw * 0.4, 0, hw); ink(ctx, 4);
    ctx.restore();
  }

  function comicSpaceBg(ctx) {
    ctx.fillStyle = "#241a3a"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    halftoneGrad(ctx, 0, 0, VIEW.w, VIEW.h, "16,11,32", 20, false);
    const ss = [[160, 140, 15], [700, 110, 11], [930, 300, 19], [430, 430, 9], [1000, 520, 13], [120, 560, 12], [560, 250, 8]];
    for (const p of ss) comicStar(ctx, p[0], p[1], p[2]);
  }
  function comicShip(ctx, x, y, scale, broken) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.lineJoin = "round";
    if (!broken) { const fl = 1 + Math.sin(G.time * 20) * 0.18; comicFlame(ctx, -92, 0, 66 * fl, 22, 0); }
    ctx.fillStyle = "#c0492a"; ctx.beginPath(); ctx.moveTo(-58, -20); ctx.lineTo(-86, -48); ctx.lineTo(-44, -26); ctx.closePath(); ctx.fill(); ink(ctx, 4);
    ctx.beginPath(); ctx.moveTo(-58, 20); ctx.lineTo(-86, 48); ctx.lineTo(-44, 26); ctx.closePath(); ctx.fill(); ink(ctx, 4);
    ctx.fillStyle = "#eef2f6"; rr(ctx, -92, -30, 186, 60, 30); ctx.fill();
    ctx.save(); rr(ctx, -92, -30, 186, 60, 30); ctx.clip();
    ctx.fillStyle = "#b9c2cc"; ctx.fillRect(-92, 8, 186, 26);
    ctx.fillStyle = "#9aa3ad"; rr(ctx, -92, -30, 54, 60, 28); ctx.fill();
    ctx.restore();
    rr(ctx, -92, -30, 186, 60, 30); ink(ctx, 5);
    ctx.fillStyle = "#d9531f"; rr(ctx, -24, -7, 84, 14, 4); ctx.fill();
    for (let i = 0; i < 3; i++) { const ix = -50 + i * 20; ctx.fillStyle = "#7fe0ff"; ctx.beginPath(); ctx.arc(ix, -4, 7, 0, 7); ctx.fill(); ink(ctx, 3); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ix - 2, -6, 2.4, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#7fe0ff"; ctx.beginPath(); ctx.arc(48, 0, 18, 0, 7); ctx.fill();
    ctx.fillStyle = "#39b6e0"; ctx.beginPath(); ctx.moveTo(48, 0); ctx.arc(48, 0, 18, 0.15 * PI, 0.95 * PI); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(48, 0, 18, 0, 7); ink(ctx, 5);
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(42, -6, 5, 0, 7); ctx.fill();
    ctx.restore();
  }
  function comicCapsuleC(ctx, x, y, scale, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(scale, scale); ctx.lineJoin = "round";
    const path = () => { ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(28, -12, 24, 30); ctx.lineTo(-24, 30); ctx.quadraticCurveTo(-28, -12, 0, -34); ctx.closePath(); };
    ctx.fillStyle = "#eef2f6"; path(); ctx.fill();
    ctx.save(); path(); ctx.clip(); ctx.fillStyle = "#b9c2cc"; ctx.fillRect(2, -34, 30, 70); ctx.restore();
    path(); ink(ctx, 5);
    ctx.fillStyle = "#7fe0ff"; ctx.beginPath(); ctx.arc(0, -8, 12, 0, 7); ctx.fill(); ink(ctx, 4);
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-4, -11, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#d9531f"; rr(ctx, -24, 26, 48, 10, 3); ctx.fill(); ink(ctx, 4);
    ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-16, 34); ctx.lineTo(-26, 46); ctx.moveTo(16, 34); ctx.lineTo(26, 46); ctx.stroke();
    ctx.restore();
  }
  function comicRobot(ctx, x, y, scale, opts) {
    opts = opts || {}; ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.lineJoin = "round";
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(0, 42, 34, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#3a4048"; rr(ctx, -30, 18, 60, 22, 9); ctx.fill(); ink(ctx, 4);
    ctx.fillStyle = "#15181c"; for (const wx of [-16, 16]) { ctx.beginPath(); ctx.arc(wx, 38, 9, 0, 7); ctx.fill(); ink(ctx, 3); }
    ctx.fillStyle = "#eef2f6"; rr(ctx, -26, -16, 52, 38, 11); ctx.fill();
    ctx.save(); rr(ctx, -26, -16, 52, 38, 11); ctx.clip(); ctx.fillStyle = "#c2cad2"; ctx.fillRect(6, -16, 22, 40); ctx.restore();
    rr(ctx, -26, -16, 52, 38, 11); ink(ctx, 5);
    ctx.fillStyle = "#5fd06a"; ctx.beginPath(); ctx.arc(0, 5, 7, 0, 7); ctx.fill(); ink(ctx, 3);
    ctx.fillStyle = "#eef2f6"; rr(ctx, -22, -46, 44, 32, 10); ctx.fill();
    ctx.save(); rr(ctx, -22, -46, 44, 32, 10); ctx.clip(); ctx.fillStyle = "#c2cad2"; ctx.fillRect(4, -46, 18, 34); ctx.restore();
    rr(ctx, -22, -46, 44, 32, 10); ink(ctx, 5);
    ctx.fillStyle = "#10161c"; rr(ctx, -17, -42, 34, 21, 8); ctx.fill(); ink(ctx, 3);
    const eye = opts.eye || "normal";
    if (eye === "shock") { for (const ex of [-7, 7]) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, -31, 5.5, 0, 7); ctx.fill(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(ex, -31, 2.2, 0, 7); ctx.fill(); } }
    else if (eye === "happy") { ctx.strokeStyle = "#8fe9ff"; ctx.lineWidth = 3.5; ctx.lineCap = "round"; for (const ex of [-7, 7]) { ctx.beginPath(); ctx.arc(ex, -29, 4.5, PI * 1.05, PI * 1.95); ctx.stroke(); } }
    else { ctx.fillStyle = "#8fe9ff"; for (const ex of [-7, 7]) { ctx.beginPath(); ctx.arc(ex, -31, 3.6, 0, 7); ctx.fill(); } }
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(7, -60); ctx.stroke();
    ctx.fillStyle = Math.sin(G.time * 6) > 0 ? "#ff5a3a" : "#c0492a"; ctx.beginPath(); ctx.arc(7, -62, 5, 0, 7); ctx.fill(); ink(ctx, 3);
    if (opts.sweat) { ctx.fillStyle = "#7fd0ff"; ctx.beginPath(); ctx.moveTo(22, -40); ctx.quadraticCurveTo(29, -31, 22, -27); ctx.quadraticCurveTo(15, -31, 22, -40); ctx.closePath(); ctx.fill(); ink(ctx, 2); }
    ctx.restore();
  }
  function comicMountains(ctx, baseY) {
    const tri = (a, b, c, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill(); ink(ctx, 4); };
    tri([40, baseY], [230, baseY - 150], [410, baseY], "#7a3a1e");
    tri([330, baseY], [540, baseY - 195], [740, baseY], "#8a4422");
    tri([620, baseY], [840, baseY - 150], [1030, baseY], "#7a3a1e");
  }
  function comicCave(ctx, cx, baseY, w, h) {
    ctx.fillStyle = "#4a3122"; ctx.beginPath();
    ctx.moveTo(cx - w * 1.5, baseY + 6); ctx.quadraticCurveTo(cx - w * 1.6, baseY - h, cx - w * 0.4, baseY - h * 1.15);
    ctx.quadraticCurveTo(cx, baseY - h * 1.3, cx + w * 0.4, baseY - h * 1.15); ctx.quadraticCurveTo(cx + w * 1.6, baseY - h, cx + w * 1.5, baseY + 6);
    ctx.closePath(); ctx.fill(); ink(ctx, 5);
    ctx.fillStyle = "#0a0608"; ctx.beginPath();
    ctx.moveTo(cx - w, baseY); ctx.quadraticCurveTo(cx - w * 1.04, baseY - h * 0.5, cx - w * 0.4, baseY - h * 0.92);
    ctx.quadraticCurveTo(cx, baseY - h * 1.06, cx + w * 0.4, baseY - h * 0.92); ctx.quadraticCurveTo(cx + w * 1.04, baseY - h * 0.5, cx + w, baseY);
    ctx.closePath(); ctx.fill(); ink(ctx, 4);
    ctx.fillStyle = "#241710"; for (let i = -1; i <= 1; i++) { const sx = cx + i * w * 0.46; ctx.beginPath(); ctx.moveTo(sx - 6, baseY - h * 0.9); ctx.lineTo(sx + 6, baseY - h * 0.9); ctx.lineTo(sx, baseY - h * 0.66); ctx.closePath(); ctx.fill(); }
  }

  // Облачко реплики (с «хвостом» к говорящему)
  function speechBubble(ctx, text, cx, cy, w, h, tailToX, tailToY) {
    ctx.save();
    const x = cx - w / 2, y = cy - h / 2, r = Math.min(w, h) * 0.2;
    const baseCX = Math.max(x + r + 18, Math.min(x + w - r - 18, tailToX));
    ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(baseCX + 12, y + h);
    ctx.lineTo(tailToX, tailToY);
    ctx.lineTo(baseCX - 12, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `700 17px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    G.wrapText(ctx, text, cx, cy - 2, w - 22, 20);
    ctx.textBaseline = "alphabetic"; ctx.restore();
  }
  // Отдельная панель комикс-страницы (клип + жирная рамка)
  function comicPanel(ctx, p, contentFn) {
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
    ctx.translate(p.x, p.y);
    contentFn(ctx, p.w, p.h);
    ctx.restore();
    ctx.lineJoin = "miter"; ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
  function drawCapsule(ctx, x, y, scale, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(scale, scale);
    const bg = ctx.createLinearGradient(-22, 0, 22, 0);
    bg.addColorStop(0, "#eef2f6"); bg.addColorStop(0.5, "#cdd4db"); bg.addColorStop(1, "#9aa3ad");
    ctx.fillStyle = bg; ctx.beginPath();
    ctx.moveTo(0, -32); ctx.quadraticCurveTo(27, -10, 23, 30); ctx.lineTo(-23, 30); ctx.quadraticCurveTo(-27, -10, 0, -32); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#7a838d"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = "rgba(90,98,108,0.5)"; ctx.beginPath(); ctx.moveTo(-19, 6); ctx.lineTo(19, 6); ctx.stroke();
    // окно со свечением
    const wg = ctx.createRadialGradient(0, -8, 1, 0, -8, 13);
    wg.addColorStop(0, "#bff0ff"); wg.addColorStop(0.6, "#3aa0d8"); wg.addColorStop(1, "#0a3a4a");
    ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(0, -8, 11, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(-3, -11, 3.5, 0, 7); ctx.fill();
    // тепловой щит / основание
    ctx.fillStyle = "#c9531f"; rr(ctx, -23, 26, 46, 9, 3); ctx.fill();
    ctx.fillStyle = "#8a3411"; rr(ctx, -23, 32, 46, 3, 2); ctx.fill();
    // опоры
    ctx.strokeStyle = "#6b7480"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-16, 32); ctx.lineTo(-24, 42); ctx.moveTo(16, 32); ctx.lineTo(24, 42); ctx.stroke();
    ctx.restore();
  }
  function makeBeats() {
    return [
      { dur: 4.8, text: "Грузовой корабль возвращался с дальней миссии. На борту — робот-инженер, единственный член экипажа.",
        draw(ctx, t) {
          comicSpaceBg(ctx);
          ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 3; ctx.lineCap = "round";
          for (let i = 0; i < 7; i++) { const yy = 230 + i * 34; ctx.beginPath(); ctx.moveTo(40, yy); ctx.lineTo(300 - (i % 2) * 50, yy); ctx.stroke(); } ctx.restore();
          const shipX = 560 + Math.sin(t * 1.5) * 8;
          comicShip(ctx, shipX, 330, 1.6, false);
          if (t > 0.4) speechBubble(ctx, "Скоро домой!", shipX + 210, 200, 200, 70, shipX + 80, 320);
        } },
      { dur: 5.4, text: "Робот потянулся к панели управления... и случайно нажал НЕ ТУ кнопку!",
        draw(ctx, t) {
          // фон страницы виден в проёмах между панелями
          ctx.fillStyle = "#fdedc4"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
          halftoneGrad(ctx, 0, 0, VIEW.w, VIEW.h, "230,190,110", 22, false);
          // ПАНЕЛЬ А: робот размышляет у пульта
          comicPanel(ctx, { x: 14, y: 14, w: 386, h: 630 }, (c, w, h) => {
            const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#3d4c70"); g.addColorStop(1, "#1a2238"); c.fillStyle = g; c.fillRect(0, 0, w, h);
            halftoneGrad(c, 0, 0, w, h, "12,18,36", 16, false);
            c.fillStyle = "#46597e"; rr(c, 20, h - 230, w - 40, 210, 16); c.fill(); ink(c, 6);
            c.fillStyle = "#2c3850"; rr(c, 40, h - 210, w - 80, 50, 8); c.fill();
            for (let i = 0; i < 4; i++) { c.fillStyle = "#3a8fd0"; c.beginPath(); c.arc(70 + i * 80, h - 110, 22, 0, 7); c.fill(); ink(c, 4); c.fillStyle = "#bfe6ff"; c.beginPath(); c.arc(64 + i * 80, h - 116, 6, 0, 7); c.fill(); }
            comicRobot(c, w / 2, h - 310, 1.65, { eye: "normal" });
            speechBubble(c, "Хм... а это что за кнопка?", w / 2, 120, w - 60, 100, w / 2 + 24, h - 360);
          });
          // ПАНЕЛЬ B: крупный план — рука к красной кнопке
          comicPanel(ctx, { x: 410, y: 14, w: 600, h: 306 }, (c, w, h) => {
            const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#33405e"); g.addColorStop(1, "#1a2238"); c.fillStyle = g; c.fillRect(0, 0, w, h);
            halftoneGrad(c, 0, 0, w, h, "12,18,36", 14, false);
            c.fillStyle = "#46597e"; rr(c, 0, h - 140, w, 140, 14); c.fill(); ink(c, 6);
            c.fillStyle = "#ffe14a"; rr(c, w * 0.58 - 130, h - 200, 260, 36, 6); c.fill(); ink(c, 4);
            c.fillStyle = INK; c.font = `800 17px ${G.FONT}`; c.textAlign = "center"; c.fillText("!! САМОЛИКВИДАЦИЯ !!", w * 0.58, h - 176); c.textAlign = "left";
            c.fillStyle = "#5a1410"; c.beginPath(); c.arc(w * 0.58, h - 80, 70, 0, 7); c.fill(); ink(c, 7);
            c.fillStyle = "#ff3b2e"; c.beginPath(); c.arc(w * 0.58, h - 90, 60, 0, 7); c.fill(); ink(c, 6);
            c.fillStyle = "rgba(255,255,255,0.5)"; c.beginPath(); c.arc(w * 0.58 - 16, h - 102, 16, 0, 7); c.fill();
            const reach = Math.min(1, t / 1.9);
            const hx = lerp(40, w * 0.58 - 60, reach), hy = lerp(h / 2 - 10, h - 90, reach);
            c.strokeStyle = "#cdd4db"; c.lineWidth = 22; c.lineCap = "round"; c.beginPath(); c.moveTo(20, h / 2 - 40); c.lineTo(hx, hy); c.stroke();
            c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.moveTo(20, h / 2 - 40); c.lineTo(hx, hy); c.stroke();
            c.fillStyle = "#cdd4db"; c.beginPath(); c.arc(hx, hy, 18, 0, 7); c.fill(); ink(c, 5);
            if (t < 1.9) speedLines(c, hx, hy, 30, 70, 8, "#ffd24a", 0.32);
          });
          // ПАНЕЛЬ C: КЛИК! + шок робота с «ОЙ!»
          comicPanel(ctx, { x: 410, y: 330, w: 600, h: 314 }, (c, w, h) => {
            const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#5a3f3a"); g.addColorStop(1, "#241828"); c.fillStyle = g; c.fillRect(0, 0, w, h);
            halftoneGrad(c, 0, 0, w, h, "200,140,40", 14, false);
            const pressed = t > 1.9;
            if (pressed) {
              speedLines(c, w * 0.4, h * 0.55, 70, 320, 26, "#ffd24a", 0.72);
              burstShape(c, w * 0.4, h * 0.55, 140, 84, 14, "#ff3b1e", INK, 0.05);
              burstShape(c, w * 0.4, h * 0.55, 96, 56, 12, "#ffe14a", INK, 0.25);
              c.fillStyle = "#5a1410"; c.beginPath(); c.arc(w * 0.4, h * 0.62, 56, 0, 7); c.fill(); ink(c, 6);
              c.fillStyle = "#c41f1a"; c.beginPath(); c.arc(w * 0.4, h * 0.64, 42, 0, 7); c.fill(); ink(c, 5);
              const pop = Math.min(1, (t - 1.9) / 0.25);
              sfxText(c, "КЛИК!", w * 0.4, h * 0.5, 60 * pop, "#fff7d6", -0.12);
            } else {
              c.fillStyle = "#5a1410"; c.beginPath(); c.arc(w * 0.4, h * 0.6, 60, 0, 7); c.fill(); ink(c, 6);
              c.fillStyle = "#ff3b2e"; c.beginPath(); c.arc(w * 0.4, h * 0.55, 50, 0, 7); c.fill(); ink(c, 6);
            }
            comicRobot(c, w * 0.82, h * 0.62, 1.85, { eye: pressed ? "shock" : "normal", sweat: pressed });
            if (pressed) speechBubble(c, "ОЙ!", w * 0.82, 70, 130, 70, w * 0.82 - 22, 130);
          });
        } },
      { dur: 3.4, text: "БА-БАХ!!! Корабль разорвало на части.",
        onTime(sc) { if (!sc.boomed && sc.t > 0.05) { sc.boomed = true; G.audio.boom(); G.fx.burst(VIEW.w / 2, 320, "#ffe08a", 46, 440, 1.2); G.fx.burst(VIEW.w / 2, 320, "#ff6a2a", 38, 340, 1.0); } },
        draw(ctx, t) {
          comicSpaceBg(ctx);
          const cx = VIEW.w / 2, cy = 320, f = Math.min(1, t / 0.4);
          if (t < 0.45) { ctx.fillStyle = `rgba(255,246,224,${(0.45 - t) / 0.45 * 0.6})`; ctx.fillRect(0, 0, VIEW.w, VIEW.h); }
          speedLines(ctx, cx, cy, 130 * f, 470, 26, "#ffd24a", 0.6);
          burstShape(ctx, cx, cy, 240 * f, 150 * f, 16, "#ff3b1e", INK, 0.03);
          burstShape(ctx, cx, cy, 180 * f, 110 * f, 14, "#ff9b2a", INK, 0.22);
          burstShape(ctx, cx, cy, 116 * f, 70 * f, 12, "#ffe14a", INK, 0.46);
          burstShape(ctx, cx, cy, 58 * f, 34 * f, 10, "#fff7d6", null, 0.7);
          if (t < 1.3) { ctx.fillStyle = "#aeb7c2"; for (let i = 0; i < 5; i++) { const a = i / 5 * PI * 2 + 0.3; const dd = t * (260 + i * 30); ctx.save(); ctx.translate(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd); ctx.rotate(t * 4 + i); ctx.fillRect(-9, -7, 18, 14); ink(ctx, 3); ctx.restore(); } }
          if (t > 0.12) { const pop = Math.min(1, (t - 0.12) / 0.3); sfxText(ctx, "БА-БАХ!", cx, cy, 66 * pop, "#ffe14a", -0.06); }
        } },
      { dur: 3.8, text: "Но за миг до взрыва успела отделиться спасательная капсула.",
        draw(ctx, t) {
          comicSpaceBg(ctx);
          burstShape(ctx, 820, 220, 80, 50, 12, "#ff7a2a", INK, 0.2);
          const x = lerp(740, 360, t / 3.8), y = lerp(250, 380, t / 3.8);
          ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 3; ctx.lineCap = "round"; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x + 50 + i * 10, y - 60 + i * 18); ctx.lineTo(x + 150, y - 130 + i * 18); ctx.stroke(); } ctx.restore();
          comicCapsuleC(ctx, x, y, 1.5, -0.5);
          sfxText(ctx, "ВЖУХ!", x - 80, y + 80, 40, "#7fe0ff", -0.18);
          if (t > 0.5 && t < 3.2) speechBubble(ctx, "Спасся!", x - 70, y - 100, 160, 64, x - 18, y - 50);
        } },
      { dur: 3.8, text: "Капсула устремилась к красной планете — Марсу.",
        draw(ctx, t) {
          const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#241a3a"); g.addColorStop(1, "#5a1e12"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
          halftoneGrad(ctx, 0, 0, VIEW.w, VIEW.h, "20,14,40", 20, true);
          comicStar(ctx, 160, 130, 12); comicStar(ctx, 920, 150, 16); comicStar(ctx, 520, 90, 9);
          const pcx = VIEW.w / 2, pcy = 1120, pr = 760;
          ctx.fillStyle = "#d8743a"; ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 7); ctx.fill();
          ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 7); ctx.clip();
          halftoneGrad(ctx, pcx - pr, pcy - pr, pr * 2, pr, "150,70,30", 16, true);
          ctx.fillStyle = "rgba(90,40,20,0.5)"; for (const c of [[420, 480, 56], [700, 440, 40], [560, 560, 48]]) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, 7); ctx.fill(); }
          ctx.restore();
          ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 7); ink(ctx, 6);
          const y = lerp(110, 540, t / 3.8), x = lerp(560, 470, t / 3.8);
          comicFlame(ctx, x, y - 34, 130, 26, -PI / 2);
          comicCapsuleC(ctx, x, y, 1.5, 0.2);
        } },
      { dur: 5.4, text: "Капсула приземлилась у подножия гор. Робот выбрался наружу и увидел тёмный вход в пещеру...",
        draw(ctx, t) {
          ctx.fillStyle = "#fdedc4"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
          // ПАНЕЛЬ A: посадка с пылью
          comicPanel(ctx, { x: 14, y: 14, w: 494, h: 630 }, (c, w, h) => {
            const gy = h * 0.6;
            const g = c.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, "#7a2e18"); g.addColorStop(1, "#c2602f"); c.fillStyle = g; c.fillRect(0, 0, w, gy);
            halftoneGrad(c, 0, 0, w, gy, "120,46,24", 16, true);
            c.fillStyle = "#fff0c8"; c.beginPath(); c.arc(w - 80, 90, 42, 0, 7); c.fill(); ink(c, 5);
            c.fillStyle = "#8a5530"; c.fillRect(0, gy, w, h - gy);
            c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.moveTo(0, gy); c.lineTo(w, gy); c.stroke();
            const tri = (a, b, ccc, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(ccc[0], ccc[1]); c.closePath(); c.fill(); ink(c, 4); };
            tri([20, gy], [180, gy - 140], [340, gy], "#7a3a1e");
            tri([220, gy], [380, gy - 170], [w + 10, gy], "#8a4422");
            comicCapsuleC(c, w / 2, gy + 16, 1.7, 0.05);
            if (t < 1.6) {
              c.fillStyle = "rgba(190,150,110,0.5)";
              for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(w / 2 + Math.sin(G.time * 1.2 + i) * (12 + i * 4), gy - i * 10 - 14, 16 + i * 5, 0, 7); c.fill(); }
              sfxText(c, "ПУФ", w / 2, gy - 100, 34, "#e6c9a0", -0.1);
            }
            if (t > 0.8 && t < 3.0) speechBubble(c, "Жив!", w * 0.3, 200, 140, 64, w / 2 - 40, gy - 30);
          });
          // ПАНЕЛЬ B: робот идёт к пещере и замечает её
          comicPanel(ctx, { x: 520, y: 14, w: 490, h: 630 }, (c, w, h) => {
            const gy = h * 0.6;
            const g = c.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, "#6a2614"); g.addColorStop(1, "#b8501f"); c.fillStyle = g; c.fillRect(0, 0, w, gy);
            halftoneGrad(c, 0, 0, w, gy, "110,40,20", 18, true);
            c.fillStyle = "#8a5530"; c.fillRect(0, gy, w, h - gy);
            c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.moveTo(0, gy); c.lineTo(w, gy); c.stroke();
            const tri = (a, b, ccc, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(ccc[0], ccc[1]); c.closePath(); c.fill(); ink(c, 4); };
            tri([w - 230, gy], [w - 80, gy - 140], [w + 30, gy], "#7a3a1e");
            comicCave(c, w * 0.72, gy + 14, 76, 200);
            const rx = lerp(60, w * 0.42, clamp(t / 3.0, 0, 1));
            comicRobot(c, rx, gy - 8, 1.55, { eye: t > 1.8 ? "happy" : "normal" });
            if (t > 1.8) {
              sfxText(c, "!", rx + 44, gy - 110, 52, "#ffe14a", 0.12);
              speechBubble(c, "Пещера! Туда!", w * 0.32, 130, 240, 78, rx + 12, gy - 110);
            }
          });
        } },
    ];
  }

  /* =========================================================================
     3. ПОВЕРХНОСТЬ МАРСА — дойти до пещеры
     ========================================================================= */
  G.addScene("surface", makeRoom({
    name: "surface", dayValue: 1,
    start: { x: 200, y: 470 },
    bounds: { x: 40, y: 360, w: 944, h: 320 },
    drain: 0.4,
    narr: "Вы на Марсе! Дойдите до входа в пещеру справа. Тащите палец (или стрелки/WASD), чтобы идти.",
    bg(ctx) { drawMarsSky(ctx); drawMountains(ctx, 380); ctx.fillStyle = "#7a4a26"; ctx.fillRect(0, 360, VIEW.w, VIEW.h - 360);
      // мелкие камни
      ctx.fillStyle = "#5e371d"; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(120 + i * 100, 540 + (i % 3) * 40, 10 + (i % 4) * 4, 0, 7); ctx.fill(); } },
    build(s) {
      s.exitZone = { x: 905, y: 380, w: 80, h: 200, label: "", draw: false, to: "tomb_entrance" };
      placeLog(s, "surface", 470, 520); // дневник прошлой экспедиции
    },
    drawProps(s, ctx) {
      // капсула
      drawCapsule(ctx, 150, 470, 1.4, 0.1);
      // вход в пещеру
      drawCaveEntrance(ctx, 952, 528, 58, 150);
      ctx.fillStyle = "#ffd9a0"; ctx.font = f(17); ctx.textAlign = "center";
      ctx.fillText("⛰ ПЕЩЕРА", 905, 352); ctx.textAlign = "left";
    },
  }));

  /* =========================================================================
     4. ВХОД В ГРОБНИЦУ — каменная гробница, гигантский алмаз
     ========================================================================= */
  G.addScene("tomb_entrance", makeRoom({
    name: "tomb_entrance", dayValue: 3,
    start: { x: 130, y: 410 },
    narr: "Внутри пещеры — древняя каменная гробница. На входе сияет гигантский алмаз! Подойдите к дверям и войдите.",
    build(s) {
      s.data.seen = false;
      s.exitZone = { x: VIEW.w / 2 - 55, y: 152, w: 110, h: 70, label: "Войти в гробницу", draw: false, to: "arrows" };
      s.interactables.push({ x: VIEW.w / 2, y: 250, r: 110, label: "Осмотреть алмаз 💎",
        ready: () => true, act(sc) { sc.data.seen = true; sc.toast("Алмаз слишком огромен и врос в камень. Идём дальше.", 2.6); } });
    },
    drawProps(s, ctx) {
      const cx = VIEW.w / 2;
      const t = G.time;
      // Каменная плита-площадка перед гробницей
      ctx.fillStyle = "#5a4636"; rr(ctx, cx - 110, 305, 220, 14, 2); ctx.fill();
      ctx.fillStyle = "#3a2c22"; ctx.fillRect(cx - 110, 317, 220, 4);
      ctx.strokeStyle = "rgba(255,210,160,0.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 100, 308); ctx.lineTo(cx + 100, 308); ctx.stroke();
      // Фланкирующие колонны
      for (const side of [-1, 1]) {
        const colX = cx + side * 110;
        // База
        ctx.fillStyle = "#3a2c22"; ctx.fillRect(colX - 22, 295, 44, 20);
        ctx.fillStyle = "#5a4636"; ctx.fillRect(colX - 18, 297, 36, 14);
        // Тело колонны (градиент)
        const cgrad = ctx.createLinearGradient(colX - 18, 0, colX + 18, 0);
        cgrad.addColorStop(0, "#3a2c22"); cgrad.addColorStop(0.5, "#6a5a44"); cgrad.addColorStop(1, "#3a2c22");
        ctx.fillStyle = cgrad; ctx.fillRect(colX - 18, 140, 36, 155);
        // Капитель сверху
        ctx.fillStyle = "#3a2c22"; ctx.fillRect(colX - 24, 130, 48, 14);
        ctx.fillStyle = "#5a4636"; ctx.fillRect(colX - 22, 132, 44, 8);
        // Резные символы на колонне
        ctx.strokeStyle = "rgba(220,180,120,0.4)"; ctx.lineWidth = 1.5;
        // Анх
        ctx.beginPath(); ctx.moveTo(colX, 195); ctx.lineTo(colX, 240); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(colX - 8, 215); ctx.lineTo(colX + 8, 215); ctx.stroke();
        ctx.beginPath(); ctx.arc(colX, 185, 6, 0, 7); ctx.stroke();
        // Овальный картуш ниже
        ctx.beginPath(); ctx.ellipse(colX, 260, 9, 12, 0, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(colX - 5, 258); ctx.lineTo(colX + 5, 258);
        ctx.moveTo(colX - 5, 262); ctx.lineTo(colX + 5, 262); ctx.stroke();
      }
      // Основная стена фасада (между колоннами)
      ctx.fillStyle = "#4a3a2e"; ctx.fillRect(cx - 92, 140, 184, 165);
      const wgrad = ctx.createLinearGradient(0, 140, 0, 305);
      wgrad.addColorStop(0, "rgba(255,220,180,0.1)"); wgrad.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = wgrad; ctx.fillRect(cx - 92, 140, 184, 165);
      // Ступенчатый педимент сверху
      ctx.fillStyle = "#5a4636"; ctx.fillRect(cx - 110, 120, 220, 22);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.5; ctx.strokeRect(cx - 110, 120, 220, 22);
      ctx.fillStyle = "#6a5a44"; ctx.fillRect(cx - 80, 100, 160, 22);
      ctx.strokeRect(cx - 80, 100, 160, 22);
      // Треугольный пик
      ctx.fillStyle = "#7a6a54";
      ctx.beginPath(); ctx.moveTo(cx - 60, 100); ctx.lineTo(cx, 70); ctx.lineTo(cx + 60, 100); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,160,0.4)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - 60, 100); ctx.lineTo(cx, 70); ctx.lineTo(cx + 60, 100); ctx.stroke();
      // Лентель с иероглифами над дверью
      ctx.fillStyle = "#3a2c22"; ctx.fillRect(cx - 92, 145, 184, 28);
      ctx.strokeStyle = "rgba(255,210,140,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 92, 145); ctx.lineTo(cx + 92, 145);
      ctx.moveTo(cx - 92, 173); ctx.lineTo(cx + 92, 173);
      ctx.stroke();
      for (let i = 0; i < 5; i++) drawHieroglyph(ctx, cx - 72 + i * 36, 159, i);
      // Дверной проём
      ctx.fillStyle = "#3a2c22"; ctx.fillRect(cx - 65, 180, 130, 130);
      ctx.fillStyle = "#0a0604"; ctx.fillRect(cx - 50, 195, 100, 115);
      const dPulse = (Math.sin(t * 1.5) + 1) / 2;
      const innerGl = ctx.createLinearGradient(0, 195, 0, 310);
      innerGl.addColorStop(0, `rgba(140,210,255,${0.06 + dPulse * 0.06})`);
      innerGl.addColorStop(1, `rgba(140,210,255,${0.02 + dPulse * 0.04})`);
      ctx.fillStyle = innerGl; ctx.fillRect(cx - 50, 195, 100, 115);
      // Резная подсветка рамы двери
      ctx.fillStyle = "rgba(220,180,120,0.2)";
      ctx.fillRect(cx - 65, 180, 130, 4);
      ctx.fillRect(cx - 65, 180, 4, 130);
      ctx.fillRect(cx + 61, 180, 4, 130);
      // Око Гора над дверью
      ctx.strokeStyle = "rgba(220,180,120,0.45)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, 188, 14, 5, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = "rgba(220,180,120,0.5)";
      ctx.beginPath(); ctx.arc(cx, 188, 2, 0, 7); ctx.fill();
      // Лучи вокруг алмаза
      const dy = 76 + Math.sin(t * 2) * 3;
      ctx.save(); ctx.translate(cx, dy); ctx.rotate(t * 0.15);
      const rays = ctx.createRadialGradient(0, 0, 20, 0, 0, 200);
      rays.addColorStop(0, "rgba(255,240,180,0.3)");
      rays.addColorStop(0.4, "rgba(255,220,150,0.15)");
      rays.addColorStop(1, "rgba(255,220,150,0)");
      ctx.fillStyle = rays;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const d = i % 2 === 0 ? 180 : 70;
        ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // Золотая оправа (10-конечная звезда вокруг алмаза)
      ctx.save(); ctx.translate(cx, dy);
      ctx.fillStyle = "#a87830";
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
        const d = i % 2 === 0 ? 58 : 44;
        ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#d8a050";
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,230,180,0.5)";
      ctx.beginPath(); ctx.arc(-12, -12, 8, 0, 7); ctx.fill();
      ctx.restore();
      // Сам алмаз
      drawDiamond(ctx, cx, dy, 32);
      if ((Math.sin(t * 3) + 1) / 2 > 0.7) G.fx.burst(cx + (Math.random() - 0.5) * 80, dy + (Math.random() - 0.5) * 40, "#bfefff", 1, 40, 0.6);
      // Подпись
      ctx.fillStyle = "#cfe9ff"; ctx.font = `600 18px ${G.FONT}`; ctx.textAlign = "center";
      ctx.fillText("ГРОБНИЦА", cx, 350); ctx.textAlign = "left";
    },
  }));

  function drawDiamond(ctx, x, y, r) {
    ctx.save(); ctx.translate(x, y);
    const t = G.time;
    // Пульсирующий нимб
    const pulse = 0.9 + (Math.sin(t * 2) + 1) * 0.05;
    const halo = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.2 * pulse);
    halo.addColorStop(0, "rgba(180,240,255,0.55)");
    halo.addColorStop(0.5, "rgba(140,200,240,0.18)");
    halo.addColorStop(1, "rgba(180,240,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.2 * pulse, 0, 7); ctx.fill();
    // Вершины бриллианта (8 на силуэте + 3 внутренних)
    const A = [-r * 0.65, -r * 0.92], B = [r * 0.65, -r * 0.92];
    const C = [r * 0.95, -r * 0.4], D = [r * 0.85, r * 0.1];
    const E = [r * 0.4, r * 0.95], F = [-r * 0.4, r * 0.95];
    const Gv = [-r * 0.85, r * 0.1], H = [-r * 0.95, -r * 0.4];
    const TA = [-r * 0.35, -r * 0.7], TB = [r * 0.35, -r * 0.7];
    const M = [0, r * 0.5];
    const poly = (verts, col) => {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(verts[0][0], verts[0][1]);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i][0], verts[i][1]);
      ctx.closePath(); ctx.fill();
    };
    // Фон-силуэт (закрашивает любые щели)
    poly([A, B, C, D, E, F, Gv, H], "#1a3a58");
    // 9 граней: ярко (верх-лево, солнце) → темно (низ-право)
    poly([A, B, TB, TA], "#e8f5ff");   // Стол (верх)
    poly([A, H, TA], "#c4e3f4");        // Корона верх-лево
    poly([B, C, TB], "#a4d0eb");        // Корона верх-право
    poly([TA, TB, M], "#7ab8d6");       // Звезда (под столом)
    poly([H, Gv, M, TA], "#86c0d8");    // Корона низ-лево
    poly([C, D, M, TB], "#5a9cc0");     // Корона низ-право
    poly([Gv, F, M], "#4a8aaa");        // Павильон лево
    poly([F, E, M], "#2e6c8a");         // Павильон низ
    poly([D, E, M], "#1a5070");         // Павильон право (темнее всех)
    // Белый блик на столе
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.85);
    ctx.lineTo(-r * 0.1, -r * 0.85);
    ctx.lineTo(-r * 0.22, -r * 0.72);
    ctx.lineTo(-r * 0.42, -r * 0.72);
    ctx.closePath(); ctx.fill();
    // Тонкие линии граней
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(A[0], A[1]);
    [B, C, D, E, F, Gv, H].forEach(v => ctx.lineTo(v[0], v[1]));
    ctx.closePath();
    ctx.moveTo(TA[0], TA[1]); ctx.lineTo(TB[0], TB[1]);
    ctx.moveTo(H[0], H[1]); ctx.lineTo(TA[0], TA[1]);
    ctx.moveTo(C[0], C[1]); ctx.lineTo(TB[0], TB[1]);
    ctx.moveTo(Gv[0], Gv[1]); ctx.lineTo(M[0], M[1]);
    ctx.moveTo(D[0], D[1]); ctx.lineTo(M[0], M[1]);
    ctx.moveTo(F[0], F[1]); ctx.lineTo(M[0], M[1]);
    ctx.moveTo(E[0], E[1]); ctx.lineTo(M[0], M[1]);
    ctx.moveTo(TA[0], TA[1]); ctx.lineTo(M[0], M[1]);
    ctx.moveTo(TB[0], TB[1]); ctx.lineTo(M[0], M[1]);
    ctx.stroke();
    // Вращающиеся блёстки вокруг
    for (let i = 0; i < 4; i++) {
      const a = t * 1.5 + i * (Math.PI / 2);
      const sx = Math.cos(a) * r * 0.95, sy = Math.sin(a) * r * 0.95;
      const sp = Math.abs(Math.sin(t * 2 + i * 1.7));
      if (sp > 0.3) {
        const ss = (4 + (i % 2) * 2) * sp;
        ctx.fillStyle = `rgba(255,255,255,${sp * 0.9})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy - ss);
        ctx.lineTo(sx + ss * 0.25, sy - ss * 0.25);
        ctx.lineTo(sx + ss, sy);
        ctx.lineTo(sx + ss * 0.25, sy + ss * 0.25);
        ctx.lineTo(sx, sy + ss);
        ctx.lineTo(sx - ss * 0.25, sy + ss * 0.25);
        ctx.lineTo(sx - ss, sy);
        ctx.lineTo(sx - ss * 0.25, sy - ss * 0.25);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  // Маленький стилизованный иероглиф (для отделки гробницы)
  function drawHieroglyph(ctx, x, y, kind) {
    ctx.save(); ctx.translate(x, y);
    // Углублённый фон
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-11, -9, 22, 18);
    ctx.fillStyle = "rgba(220,180,120,0.55)";
    ctx.strokeStyle = "rgba(220,180,120,0.55)";
    ctx.lineWidth = 1.5; ctx.lineCap = "round";
    const k = ((kind % 5) + 5) % 5;
    if (k === 0) { // Око
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.fill();
    } else if (k === 1) { // Анх
      ctx.fillRect(-1, -3, 2, 10);
      ctx.fillRect(-5, -1, 10, 2);
      ctx.beginPath(); ctx.arc(0, -6, 3, 0, 7); ctx.stroke();
    } else if (k === 2) { // Солнечный диск с лучами
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.stroke();
      }
    } else if (k === 3) { // Жук-скарабей
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 4, 0, 0, 7); ctx.fill();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-5, i * 2); ctx.lineTo(-8, i * 2);
        ctx.moveTo(5, i * 2); ctx.lineTo(8, i * 2);
        ctx.stroke();
      }
    } else { // Пирамида
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(-7, 5); ctx.lineTo(7, 5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* =========================================================================
     5. ЛОВУШКА СО СТРЕЛАМИ — уворачиваться
     ========================================================================= */
  G.addScene("arrows", makeRoom({
    name: "arrows", dayValue: 8,
    start: { x: 110, y: 410 },
    narr: "Ловушка! Из стены вылетают стрелы. Двигайтесь вправо к выходу, уворачиваясь вверх и вниз.",
    drain: 0.4,
    build(s) {
      s.data.arrows = []; s.data.spawn = 0;
      s.exitZone = rightExit(s, { label: "→ Выход", to: "falling_tiles" });
    },
    update(s, dt) {
      const b = s.bounds, d = s.data;
      d.spawn -= dt;
      if (d.spawn <= 0) {
        d.spawn = 0.55 + Math.random() * 0.4;
        const y = b.y + 50 + Math.random() * (b.h - 100);
        d.arrows.push({ x: b.x + b.w - 30, y, vx: -300 - Math.random() * 120 });
      }
      for (let i = d.arrows.length - 1; i >= 0; i--) {
        const a = d.arrows[i]; a.x += a.vx * dt;
        if (a.x < b.x - 40) { d.arrows.splice(i, 1); continue; }
        if (Math.abs(a.x - s.robot.x) < s.robot.r + 14 && Math.abs(a.y - s.robot.y) < s.robot.r + 6) {
          d.arrows.splice(i, 1); s.hurt(9, { x: -26, y: 0 });
        }
      }
    },
    drawProps(s, ctx) {
      // стрелометы на правой стене
      const b = s.bounds;
      ctx.fillStyle = "#2a1c12";
      for (let yy = b.y + 30; yy < b.y + b.h; yy += 70) { rr(ctx, b.x + b.w - 8, yy - 8, 14, 16, 3); ctx.fill(); }
      for (const a of s.data.arrows) {
        ctx.save(); ctx.translate(a.x, a.y);
        ctx.strokeStyle = "#d9c8a0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, 0); ctx.stroke();
        ctx.fillStyle = "#e8e2d0"; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-2, -6); ctx.lineTo(-2, 6); ctx.fill();
        ctx.strokeStyle = "#b86b3a"; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(22, -5); ctx.moveTo(18, 0); ctx.lineTo(22, 5); ctx.stroke();
        ctx.restore();
      }
    },
  }));

  /* =========================================================================
     6. ПАДАЮЩИЕ ПЛИТЫ — выбрать 1 из 3 путей
     ========================================================================= */
  G.addScene("falling_tiles", makeRoom({
    name: "falling_tiles", dayValue: 16,
    start: { x: 110, y: 410 },
    narr: "Гекс-соты. Светится только следующий правильный шаг — наступишь, загорится следующий. Неверный гекс рушится — успей отступить!",
    drain: 0.35,
    build(s) {
      const b = s.bounds;
      s.data.leftPlat = { x: b.x, y: b.y, w: 150, h: b.h };
      s.data.rightPlat = { x: b.x + b.w - 150, y: b.y, w: 150, h: b.h };
      // Гекс-сетка крупная: pointy-top, нечётные ряды сдвинуты вправо на W/2
      const R = 46;
      const W = Math.sqrt(3) * R;        // ширина гекса ≈ 79.7
      const dy = 1.5 * R;                // вертикальный шаг = 69
      const nCols = 9, nRows = 5;
      const gridX0 = b.x + 150;          // = 220
      // Среднюю строку (r=2) выравниваем по стартовой y робота — иначе игрок
      // идёт прямо и проваливается мимо подсвеченного гекса.
      const gridY0 = 410 - 2 * dy;       // ≈ 272 → row 2 ровно на y=410
      s.data.hex = { R, W, dy, nCols, nRows, gridX0, gridY0 };
      s.data.tiles = [];
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const cx = gridX0 + c * W + (r % 2 ? W / 2 : 0);
          const cy = gridY0 + r * dy;
          s.data.tiles.push({ col: c, row: r, cx, cy, state: "solid", t: 0, off: 0 });
        }
      }
      // Безопасный путь зигзагом. Каждая пара (c,r) — соседи в hex-сетке (odd-r offset).
      // Начало (0,2) совпадает с y робота, конец (8,2) накрывает правую платформу.
      s.data.safePath = [
        { c: 0, r: 2 }, { c: 1, r: 2 }, { c: 1, r: 1 }, { c: 2, r: 1 },
        { c: 3, r: 1 }, { c: 3, r: 0 }, { c: 4, r: 0 }, { c: 4, r: 1 },
        { c: 5, r: 1 }, { c: 5, r: 2 }, { c: 6, r: 2 }, { c: 6, r: 3 },
        { c: 7, r: 3 }, { c: 7, r: 2 }, { c: 8, r: 2 },
      ];
      s.data.safeMap = {};
      s.data.safePath.forEach((p, idx) => { s.data.safeMap[p.c + "," + p.r] = idx; });
      s.data.maxDoneIdx = -1;
      s.exitZone = rightExit(s, { label: "→ Выход", to: "mummies" });
    },
    update(s, dt) {
      const d = s.data, rb = s.robot;
      let supported = rectHit(d.leftPlat, rb.x, rb.y) || rectHit(d.rightPlat, rb.x, rb.y);
      // Находим ближайший активный гекс под роботом
      if (!supported) {
        let best = null, bd = 1e9;
        for (const t of d.tiles) {
          if (t.state === "gone") continue;
          const dd = Math.hypot(rb.x - t.cx, rb.y - t.cy);
          if (dd < bd) { bd = dd; best = t; }
        }
        // Внутри Вороной-ячейки расстояние до центра ≤ R. Берём небольшой
        // запас (1.02), чтобы на вершинах между тремя гексами не было «дыр»,
        // в которых робот проваливался даже стоя на подсвеченной плитке.
        if (best && bd < d.hex.R * 1.02) {
          supported = true;
          const safeIdx = d.safeMap[best.col + "," + best.row];
          if (safeIdx !== undefined) {
            if (best.state === "solid") best.state = "done";
            if (safeIdx > d.maxDoneIdx) d.maxDoneIdx = safeIdx;
          } else if (best.state === "solid") {
            best.state = "crumbling"; best.t = 0.55;
          }
        }
      }
      // Крошение
      for (const t of d.tiles) {
        if (t.state === "crumbling") {
          t.t -= dt; t.off = Math.sin(G.time * 40) * 3;
          if (t.t <= 0) t.state = "gone";
        }
      }
      if (!supported) {
        s.toast("Провал! Иди только по светящемуся гексу впереди.", 2.0);
        rb.x = s._sx; rb.y = s._sy;
        for (const t of d.tiles) { t.state = "solid"; t.t = 0; t.off = 0; }
        d.maxDoneIdx = -1;
        G.audio.hit();
      }
    },
    drawUnder(s, ctx) {
      const b = s.bounds, d = s.data;
      // Пропасть
      ctx.fillStyle = "#0a0604"; ctx.fillRect(b.x + 150, b.y, b.w - 300, b.h);
      // Платформы
      for (const p of [d.leftPlat, d.rightPlat]) {
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0, "#5a4636"); g.addColorStop(1, "#3a2c22");
        ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      // Подсветка следующего гекса по пути
      const nextIdx = d.maxDoneIdx + 1;
      const next = nextIdx < d.safePath.length ? d.safePath[nextIdx] : null;
      const gl = (Math.sin(G.time * 4) + 1) / 2;
      // Гексы (соты) — рисуем все: одна светится, пройденные тусклые, остальные обычный камень
      const R = d.hex.R;
      const hexPath = (cx, cy) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      for (const t of d.tiles) {
        if (t.state === "gone") continue;
        const isDone = t.state === "done";
        const isNextLit = next && t.col === next.c && t.row === next.r && !isDone;
        const shake = t.state === "crumbling" ? t.off : 0;
        let fill;
        if (t.state === "crumbling") fill = "#7a4a32";
        else if (isDone) fill = "#5a5e44";
        else if (isNextLit) fill = "#6f6048";
        else fill = "#4a3a2e";
        ctx.fillStyle = fill;
        hexPath(t.cx + shake, t.cy); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2;
        hexPath(t.cx + shake, t.cy); ctx.stroke();
        if (isNextLit) {
          ctx.strokeStyle = `rgba(120,230,160,${0.75 + gl * 0.25})`; ctx.lineWidth = 3;
          hexPath(t.cx, t.cy); ctx.stroke();
          ctx.fillStyle = `rgba(120,230,160,${0.6 + gl * 0.4})`;
          ctx.font = f(22); ctx.textAlign = "center";
          ctx.fillText("⟁", t.cx, t.cy + 8);
          ctx.textAlign = "left";
        } else if (isDone) {
          ctx.strokeStyle = "rgba(120,230,160,0.4)"; ctx.lineWidth = 1.5;
          hexPath(t.cx, t.cy); ctx.stroke();
          ctx.fillStyle = "rgba(120,230,160,0.35)";
          ctx.font = f(15); ctx.textAlign = "center";
          ctx.fillText("⟁", t.cx, t.cy + 5);
          ctx.textAlign = "left";
        }
      }
    },
  }));

  /* =========================================================================
     7. МУМИИ — следят, иногда тянут руки
     ========================================================================= */
  G.addScene("mummies", makeRoom({
    name: "mummies", dayValue: 24,
    start: { x: 110, y: 410 },
    narr: "Коридор мумий. Они следят за вами и время от времени выбрасывают руки. Проходите мимо, когда они спокойны!",
    drain: 0.35,
    build(s) {
      const b = s.bounds;
      s.data.mummies = [];
      // больше мумий и плотнее по коридору — теперь нужно реально уворачиваться
      const xs = [b.x + 180, b.x + 320, b.x + 460, b.x + 600, b.x + 740];
      for (const x of xs) {
        for (const side of [-1, 1]) {
          s.data.mummies.push({ x, side, y: side < 0 ? b.y + 6 : b.y + b.h - 6, state: "idle", t: 0.6 + Math.random() * 1.4, reach: 0 });
        }
      }
      s.exitZone = rightExit(s, { label: "→ Выход", to: "scarab" });
    },
    update(s, dt) {
      for (const m of s.data.mummies) {
        m.t -= dt;
        if (m.state === "idle" && m.t <= 0) { m.state = "shiver"; m.t = 0.4; }
        else if (m.state === "shiver" && m.t <= 0) { m.state = "lunge"; m.t = 0.5; G.audio.tone(110, 0.12, "sawtooth", 0.06); }
        else if (m.state === "lunge") {
          // длинные руки дотягиваются до середины коридора (b.h/2 ≈ 260)
          m.reach = Math.sin((0.5 - m.t) / 0.5 * PI) * 230;
          if (m.t <= 0) { m.state = "idle"; m.t = 0.7 + Math.random() * 1.6; m.reach = 0; }
          // захват — горизонтально широкая зона, по вертикали — насколько вытянулась рука
          if (Math.abs(s.robot.x - m.x) < 60 && Math.abs(s.robot.y - m.y) < m.reach + s.robot.r + 20) {
            s.hurt(12, { x: (s.robot.x < m.x ? -22 : 22), y: 0 });
          }
        }
      }
    },
    drawProps(s, ctx) {
      for (const m of s.data.mummies) drawMummy(ctx, m, s.robot);
    },
  }));

  function drawMummy(ctx, m, robot) {
    ctx.save(); ctx.translate(m.x, m.y);
    const jit = m.state === "shiver" ? (Math.random() - 0.5) * 4 : 0;
    ctx.translate(jit, 0);
    const h = 96, top = m.side < 0 ? 0 : -h;
    // саркофаг-ниша
    ctx.fillStyle = "#2a1c12"; rr(ctx, -34, top, 68, h, 8); ctx.fill();
    // тело-мумия
    ctx.fillStyle = "#cfc2a0"; rr(ctx, -24, top + 8, 48, h - 16, 18); ctx.fill();
    ctx.strokeStyle = "rgba(120,100,70,0.6)"; ctx.lineWidth = 2;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-24, top + 8 + i * (h - 16) / 6); ctx.lineTo(24, top + 8 + i * (h - 16) / 6 + 4); ctx.stroke(); }
    // глаза, следят за роботом
    const ey = m.side < 0 ? top + 26 : top + h - 60;
    const look = clamp((robot.x - m.x) / 200, -1, 1);
    ctx.fillStyle = "#000"; rr(ctx, -16, ey, 32, 12, 4); ctx.fill();
    ctx.fillStyle = m.state === "lunge" ? "#ff5a3a" : "#ffd24a";
    ctx.beginPath(); ctx.arc(-8 + look * 4, ey + 6, 3.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(8 + look * 4, ey + 6, 3.2, 0, 7); ctx.fill();
    // руки тянутся к коридору
    if (m.reach > 0) {
      ctx.strokeStyle = "#cfc2a0"; ctx.lineWidth = 9; ctx.lineCap = "round";
      const dir = m.side < 0 ? 1 : -1;
      const baseY = m.side < 0 ? top + h - 16 : top + 16;
      ctx.beginPath(); ctx.moveTo(-12, baseY); ctx.lineTo(-12, baseY + dir * m.reach); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, baseY); ctx.lineTo(12, baseY + dir * m.reach); ctx.stroke();
    }
    ctx.restore();
  }

  /* =========================================================================
     8. ДВЕРЬ-СКАРАБЕЙ — повернуть фигуру
     ========================================================================= */
  G.addScene("scarab", {
    dayValue: 32, recharge: false, useJoystick: false,
    enter() {
      this.cx = VIEW.w / 2; this.cy = 330; this.R = 110;
      this.angle = 2.4; this.solved = false; this.solveT = 0; this.dragging = false; this.lastA = 0;
      this.bL = { x: this.cx - 230, y: 470, w: 90, h: 60, text: "↺", fs: 34 };
      this.bR = { x: this.cx + 140, y: 470, w: 90, h: 60, text: "↻", fs: 34 };
    },
    update(dt) {
      if (this.solved) { this.solveT += dt; if (this.solveT > 1.4) G.go("mineral1"); return; }
      if (Math.abs(angleNorm(this.angle)) < 0.22) { this.solved = true; G.audio.door(); G.fx.burst(this.cx, this.cy, "#ffd17a", 50, 260, 1.0); }
    },
    onPointerDown(x, y) {
      if (dist(x, y, this.cx, this.cy) < this.R + 30) { this.dragging = true; this.lastA = Math.atan2(y - this.cy, x - this.cx); }
    },
    onPointerMove(x, y) {
      if (!this.dragging || this.solved) return;
      const a = Math.atan2(y - this.cy, x - this.cx);
      this.angle += angleNorm(a - this.lastA); this.lastA = a;
    },
    onPointerUp() { this.dragging = false; },
    onTap(x, y) {
      if (this.solved) return;
      if (rectHit(this.bL, x, y)) { this.angle -= PI / 10; G.audio.blip(); }
      else if (rectHit(this.bR, x, y)) { this.angle += PI / 10; G.audio.blip(); }
    },
    draw(ctx) {
      G.drawTombRoom(ctx, { x: 120, y: 120, w: 784, h: 540 }, {});
      // каменная дверь
      ctx.fillStyle = "#4a3a2e"; rr(ctx, this.cx - 170, 160, 340, 420, 10); ctx.fill();
      G.drawBricks(ctx, this.cx - 170, 160, 340, 36, true);
      // диск
      ctx.fillStyle = "#2a1c12"; ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R + 22, 0, 7); ctx.fill();
      ctx.fillStyle = this.solved ? "#caa24a" : "#6e5746"; ctx.beginPath(); ctx.arc(this.cx, this.cy, this.R + 14, 0, 7); ctx.fill();
      // целевая метка сверху
      ctx.fillStyle = this.solved ? "#7de08a" : "#ffd17a"; ctx.font = f(24); ctx.textAlign = "center";
      ctx.fillText("▼", this.cx, this.cy - this.R - 18);
      // скарабей
      drawScarab(ctx, this.cx, this.cy, this.R, this.angle, this.solved);

      if (this.solved) {
        ctx.fillStyle = "#7de08a"; ctx.font = f(26, "600");
        ctx.fillText("Замок открыт!", this.cx, 130);
      } else {
        G.button(ctx, this.bL, false); G.button(ctx, this.bR, false);
        ctx.fillStyle = "#ffe6c8"; ctx.font = f(18);
        ctx.fillText("Поверните скарабея головой ВВЕРХ (к ▼)", this.cx, 130);
        ctx.font = f(14); ctx.fillStyle = "rgba(255,220,180,0.7)";
        ctx.fillText("тащите жука пальцем или жмите ↺ ↻", this.cx, 600);
      }
      ctx.textAlign = "left";
      G.drawHUD(ctx);
    },
  });

  function drawScarab(ctx, cx, cy, R, angle, solved) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, solved ? "#7de0a0" : "#3a7a4a"); g.addColorStop(1, solved ? "#3a9a6a" : "#1f4a2e");
    // ноги
    ctx.strokeStyle = "#143a22"; ctx.lineWidth = 7; ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const yy = -R * 0.3 + i * R * 0.4;
      ctx.beginPath(); ctx.moveTo(-R * 0.45, yy); ctx.lineTo(-R * 0.85, yy - R * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R * 0.45, yy); ctx.lineTo(R * 0.85, yy - R * 0.12); ctx.stroke();
    }
    // тело
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, R * 0.05, R * 0.55, R * 0.8, 0, 0, 7); ctx.fill();
    // голова сверху (ориентир)
    ctx.fillStyle = solved ? "#9af0b0" : "#2f6a3e"; ctx.beginPath(); ctx.arc(0, -R * 0.72, R * 0.26, 0, 7); ctx.fill();
    // рожки
    ctx.strokeStyle = solved ? "#9af0b0" : "#2f6a3e"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-R * 0.14, -R * 0.92); ctx.lineTo(-R * 0.28, -R * 1.08);
    ctx.moveTo(R * 0.14, -R * 0.92); ctx.lineTo(R * 0.28, -R * 1.08); ctx.stroke();
    // линия надкрылий
    ctx.strokeStyle = "rgba(255,230,180,0.55)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -R * 0.4); ctx.lineTo(0, R * 0.78); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, R * 0.05, R * 0.55, R * 0.8, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }

  /* =========================================================================
     МИНЕРАЛЫ (фабрика залов с пьедесталом)
     ========================================================================= */
  function mineralRoom(name, dayValue, next, color, variant) {
    return makeRoom({
      name, dayValue,
      start: { x: 120, y: 410 },
      narr: () => "Чудо-минерал — источник энергии для 3D-принтера. Подойдите к пьедесталу и заберите его.",
      build(s) {
        s.data.taken = false; s.data.color = color; s.data.variant = variant || 0;
        const px = VIEW.w / 2, py = s.bounds.y + s.bounds.h / 2;
        s.data.px = px; s.data.py = py;
        // пьедестал — препятствие
        s.obstacles.push({ x: px - 44, y: py - 30, w: 88, h: 80 });
        s.interactables.push({ x: px, y: py, r: 110, label: "Взять минерал 💠",
          ready: (sc) => !sc.data.taken,
          act(sc) {
            sc.data.taken = true; G.state.minerals = Math.min(3, G.state.minerals + 1);
            G.state.battery = Math.min(100, G.state.battery + 30);
            G.audio.pickup(); G.fx.burst(px, py - 60, color, 40, 220, 0.9);
            sc.toast(`Минерал ${G.state.minerals}/3 собран! (+заряд)`, 2.4);
          } });
        s.exitZone = rightExit(s, { label: "→ Дальше", to: next, ready: (sc) => sc.data.taken });
      },
      drawProps(s, ctx) {
        const px = s.data.px, py = s.data.py;
        const v = s.data.variant || 0;
        const t = G.time;
        // Цвета камня под вариант (0=лёд/синий, 1=аметист/тёмный камень, 2=жеода/земля)
        const base = v === 0 ? "#2c3540" : v === 1 ? "#3a2c22" : "#3a2818";
        const baseLt = v === 0 ? "#4c5a6c" : v === 1 ? "#5a4636" : "#5c4028";
        const mid = v === 0 ? "#5a6c7e" : v === 1 ? "#6a5a44" : "#6c4a30";
        const col1 = v === 0 ? "#3a4858" : v === 1 ? "#3a2c22" : "#3a2818";
        const col2 = v === 0 ? "#6a8090" : v === 1 ? "#7a5644" : "#7a5a3a";
        // Нижняя плита
        ctx.fillStyle = base; rr(ctx, px - 60, py + 56, 120, 16, 3); ctx.fill();
        ctx.fillStyle = baseLt; rr(ctx, px - 58, py + 50, 116, 8, 3); ctx.fill();
        // Средняя ступень
        ctx.fillStyle = mid; rr(ctx, px - 52, py + 40, 104, 14, 4); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(px - 52, py + 51, 104, 3);
        // Колонна
        const cgrad = ctx.createLinearGradient(px - 44, 0, px + 44, 0);
        cgrad.addColorStop(0, col1); cgrad.addColorStop(0.5, col2); cgrad.addColorStop(1, col1);
        ctx.fillStyle = cgrad;
        if (v === 2) {
          // Неровная колонна-жеода с зазубринами
          ctx.beginPath();
          ctx.moveTo(px - 44, py + 46);
          ctx.lineTo(px - 46, py + 30); ctx.lineTo(px - 42, py + 18);
          ctx.lineTo(px - 45, py + 4); ctx.lineTo(px - 44, py - 4);
          ctx.lineTo(px + 44, py - 4); ctx.lineTo(px + 45, py + 6);
          ctx.lineTo(px + 42, py + 18); ctx.lineTo(px + 46, py + 32);
          ctx.lineTo(px + 44, py + 46);
          ctx.closePath(); ctx.fill();
        } else {
          rr(ctx, px - 44, py - 4, 88, 50, 4); ctx.fill();
        }
        // Символ на колонне (свой для каждого варианта)
        if (v === 0) {
          // Снежинка
          ctx.strokeStyle = "rgba(220,240,255,0.6)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const ex = px + Math.cos(a) * 12, ey = py + 22 + Math.sin(a) * 12;
            ctx.beginPath(); ctx.moveTo(px, py + 22); ctx.lineTo(ex, ey); ctx.stroke();
            const bx = px + Math.cos(a) * 7, by = py + 22 + Math.sin(a) * 7;
            ctx.beginPath();
            ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 0.5) * 3, by + Math.sin(a + 0.5) * 3);
            ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a - 0.5) * 3, by + Math.sin(a - 0.5) * 3);
            ctx.stroke();
          }
        } else if (v === 1) {
          // Вертикальные борозды + резная розетка
          ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.2;
          for (const dx of [-20, -10, 10, 20]) {
            ctx.beginPath(); ctx.moveTo(px + dx, py - 2); ctx.lineTo(px + dx, py + 44); ctx.stroke();
          }
          ctx.strokeStyle = "rgba(220,180,120,0.5)"; ctx.lineWidth = 1.5;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(a) * 4, py + 22 + Math.sin(a) * 4);
            ctx.lineTo(px + Math.cos(a) * 13, py + 22 + Math.sin(a) * 13);
            ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(px, py + 22, 14, 0, 7); ctx.stroke();
          ctx.fillStyle = "rgba(220,180,120,0.5)";
          ctx.beginPath(); ctx.arc(px, py + 22, 4, 0, 7); ctx.fill();
        } else {
          // Оранжевые кристаллы вкраплены в породу
          ctx.fillStyle = "rgba(255,138,74,0.6)";
          for (const p of [[-15, 12, 4], [10, 25, 3], [-8, 30, 3], [16, 8, 3], [-20, 36, 2]]) {
            ctx.save();
            ctx.translate(px + p[0], py + p[1]);
            ctx.rotate(p[0] * 0.1);
            ctx.beginPath();
            ctx.moveTo(0, -p[2]); ctx.lineTo(p[2] * 0.45, 0);
            ctx.lineTo(0, p[2]); ctx.lineTo(-p[2] * 0.45, 0);
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
        }
        // Верхняя платформа
        if (v === 2) {
          // Чаша для жеоды (вогнутый верх)
          ctx.fillStyle = "#4a3220";
          ctx.beginPath();
          ctx.moveTo(px - 52, py - 4);
          ctx.quadraticCurveTo(px, py - 16, px + 52, py - 4);
          ctx.lineTo(px + 50, py - 12);
          ctx.quadraticCurveTo(px, py - 22, px - 50, py - 12);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.beginPath(); ctx.ellipse(px, py - 8, 46, 6, 0, 0, 7); ctx.fill();
        } else {
          ctx.fillStyle = mid; rr(ctx, px - 50, py - 12, 100, 14, 3); ctx.fill();
          ctx.fillStyle = v === 0 ? "#7a8a9c" : "#6a5a44";
          rr(ctx, px - 50, py - 12, 100, 4, 1); ctx.fill();
          ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px - 50, py - 2, 100, 2);
        }
        // Декор у платформы
        if (v === 0) {
          // Сосульки свисают с краёв платформы
          ctx.fillStyle = "rgba(220,240,255,0.75)";
          for (const dx of [-44, -28, -12, 4, 22, 38]) {
            const len = 4 + (Math.abs(dx) % 9);
            ctx.beginPath();
            ctx.moveTo(px + dx - 3, py + 2);
            ctx.lineTo(px + dx + 3, py + 2);
            ctx.lineTo(px + dx, py + 2 + len);
            ctx.closePath(); ctx.fill();
          }
          // Иней-зубчики на верхней грани
          ctx.strokeStyle = "rgba(220,240,255,0.55)"; ctx.lineWidth = 1.2;
          for (let i = 0; i < 5; i++) {
            const x = px - 40 + i * 20;
            ctx.beginPath();
            ctx.moveTo(x, py - 8); ctx.lineTo(x + 4, py - 13); ctx.lineTo(x + 8, py - 8);
            ctx.stroke();
          }
        } else if (v === 1) {
          // Аметистовые камни вкраплены по краю платформы
          ctx.fillStyle = "rgba(176,107,255,0.7)";
          ctx.strokeStyle = "rgba(176,107,255,0.9)"; ctx.lineWidth = 1;
          for (const dx of [-40, -20, 20, 40]) {
            ctx.beginPath();
            ctx.moveTo(px + dx, py - 14); ctx.lineTo(px + dx + 4, py - 10);
            ctx.lineTo(px + dx, py - 5); ctx.lineTo(px + dx - 4, py - 10);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        } else {
          // Каменные осколки у основания (геода)
          for (const p of [[-66, 70, 6], [-52, 76, 4], [62, 72, 7], [70, 78, 4], [-58, 80, 4], [54, 81, 3]]) {
            ctx.fillStyle = "#5a3a22";
            ctx.beginPath(); ctx.arc(px + p[0], py + p[1], p[2], 0, 7); ctx.fill();
            ctx.fillStyle = "#7a5a3a";
            ctx.fillRect(px + p[0] - p[2] * 0.4, py + p[1] - p[2] * 0.7, p[2] * 0.6, 1);
          }
        }
        if (!s.data.taken) {
          const fy = py - 56 + Math.sin(t * 2) * 6;
          // Свечение под кристаллом на платформе
          const undGlow = ctx.createRadialGradient(px, py - 10, 4, px, py - 10, 50);
          undGlow.addColorStop(0, s.data.color + "66");
          undGlow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = undGlow;
          ctx.beginPath(); ctx.ellipse(px, py - 10, 46, 14, 0, 0, 7); ctx.fill();
          drawMineral(ctx, px, fy, 26, s.data.color, s.data.variant);
          if (Math.random() > 0.85) G.fx.burst(px, fy, s.data.color, 1, 40, 0.6);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = f(15); ctx.textAlign = "center";
          ctx.fillText("(пусто)", px, py - 30); ctx.textAlign = "left";
        }
      },
    });
  }
  function drawMineral(ctx, x, y, r, color, variant) {
    variant = variant || 0;
    ctx.save(); ctx.translate(x, y);
    const t = G.time;
    // Парсим hex → RGB для генерации оттенков
    const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const cr = m ? parseInt(m[1], 16) : 128;
    const cg = m ? parseInt(m[2], 16) : 128;
    const cb = m ? parseInt(m[3], 16) : 128;
    const mix = (a, b, k) => Math.round(a + (b - a) * k);
    const dim = `rgb(${mix(cr, 0, 0.55)},${mix(cg, 0, 0.55)},${mix(cb, 0, 0.55)})`;
    const lit = `rgb(${mix(cr, 255, 0.4)},${mix(cg, 255, 0.4)},${mix(cb, 255, 0.4)})`;
    const veryLit = `rgb(${mix(cr, 255, 0.75)},${mix(cg, 255, 0.75)},${mix(cb, 255, 0.75)})`;
    // Цветной нимб с пульсацией
    const pulse = 0.9 + (Math.sin(t * 2.5) + 1) * 0.05;
    const halo = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.4 * pulse);
    halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.45)`);
    halo.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.15)`);
    halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4 * pulse, 0, 7); ctx.fill();
    // Один шард-кристалл (шестиугольная призма видом спереди)
    const shard = (cx, cy, hh, ww, rot, lightLeft) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      const fL = lightLeft ? lit : color;
      const fR = lightLeft ? color : lit;
      // Силуэт-контур
      ctx.fillStyle = dim;
      ctx.beginPath();
      ctx.moveTo(0, -hh * 0.5);
      ctx.lineTo(ww * 0.55, -hh * 0.32);
      ctx.lineTo(ww * 0.5, hh * 0.42);
      ctx.lineTo(0, hh * 0.55);
      ctx.lineTo(-ww * 0.5, hh * 0.42);
      ctx.lineTo(-ww * 0.55, -hh * 0.32);
      ctx.closePath(); ctx.fill();
      // Левая грань
      ctx.fillStyle = fL;
      ctx.beginPath();
      ctx.moveTo(0, -hh * 0.5);
      ctx.lineTo(-ww * 0.55, -hh * 0.32);
      ctx.lineTo(-ww * 0.5, hh * 0.42);
      ctx.lineTo(0, hh * 0.55);
      ctx.closePath(); ctx.fill();
      // Правая грань
      ctx.fillStyle = fR;
      ctx.beginPath();
      ctx.moveTo(0, -hh * 0.5);
      ctx.lineTo(ww * 0.55, -hh * 0.32);
      ctx.lineTo(ww * 0.5, hh * 0.42);
      ctx.lineTo(0, hh * 0.55);
      ctx.closePath(); ctx.fill();
      // Центральное ребро (блик)
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -hh * 0.5); ctx.lineTo(0, hh * 0.55); ctx.stroke();
      // Тёмный контур
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -hh * 0.5);
      ctx.lineTo(ww * 0.55, -hh * 0.32);
      ctx.lineTo(ww * 0.5, hh * 0.42);
      ctx.lineTo(0, hh * 0.55);
      ctx.lineTo(-ww * 0.5, hh * 0.42);
      ctx.lineTo(-ww * 0.55, -hh * 0.32);
      ctx.closePath(); ctx.stroke();
      // Яркий блик на вершине
      ctx.fillStyle = veryLit;
      ctx.beginPath();
      ctx.moveTo(0, -hh * 0.5);
      ctx.lineTo(-ww * 0.18, -hh * 0.38);
      ctx.lineTo(ww * 0.05, -hh * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    // Форма кластера зависит от варианта (0 — тонкий ледяной, 1 — радиальный веер, 2 — жеода)
    const layouts = [
      [
        [-0.42, 0.3, 0.95, 0.3, -0.22, true],
        [0.44, 0.32, 0.7, 0.26, 0.28, false],
        [0, -0.05, 1.85, 0.42, 0, true],
      ],
      [
        [-0.72, 0.34, 0.78, 0.28, -0.5, true],
        [-0.42, 0.18, 1.05, 0.3, -0.25, true],
        [0, -0.08, 1.6, 0.5, 0, true],
        [0.42, 0.18, 1.05, 0.3, 0.25, false],
        [0.72, 0.34, 0.78, 0.28, 0.5, false],
      ],
      [
        [-0.5, 0.38, 0.62, 0.34, -0.18, true],
        [0.5, 0.42, 0.56, 0.32, 0.2, false],
        [0, 0.06, 1.35, 0.66, 0, true],
        [-0.2, 0.46, 0.5, 0.26, 0.12, true],
        [0.3, 0.5, 0.42, 0.24, -0.14, true],
      ],
    ];
    const layout = layouts[variant] || layouts[0];
    for (const sh of layout) shard(r * sh[0], r * sh[1], r * sh[2], r * sh[3], sh[4], sh[5]);
    // Орбитальные осколки-кристаллики (медленно вращаются вокруг кластера)
    const orbitPhases = [0, 1.26, 2.51, 3.77, 5.03];
    for (let oi = 0; oi < orbitPhases.length; oi++) {
      const a = t * 0.5 + orbitPhases[oi];
      const ox = Math.cos(a) * r * 1.5;
      const oy = Math.sin(a) * r * 0.55 - r * 0.1;
      const bob = Math.sin(t * 1.4 + orbitPhases[oi]) * r * 0.05;
      const sz = r * (0.14 + (oi % 3) * 0.03);
      ctx.save();
      ctx.translate(ox, oy + bob);
      ctx.rotate(a * 1.3 + oi);
      // тёмный контур осколка
      ctx.fillStyle = dim;
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.2); ctx.lineTo(sz * 0.45, 0); ctx.lineTo(0, sz * 1.2); ctx.lineTo(-sz * 0.45, 0);
      ctx.closePath(); ctx.fill();
      // левая (светлая) грань
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.2); ctx.lineTo(-sz * 0.45, 0); ctx.lineTo(0, sz * 1.2);
      ctx.closePath(); ctx.fill();
      // правая (тёмная) грань
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.2); ctx.lineTo(sz * 0.45, 0); ctx.lineTo(0, sz * 1.2);
      ctx.closePath(); ctx.fill();
      // блик на вершине
      ctx.fillStyle = veryLit;
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.2); ctx.lineTo(-sz * 0.15, -sz * 0.7); ctx.lineTo(sz * 0.1, -sz * 0.8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Парящие искры
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + i * 2.094;
      const sx = Math.cos(a) * r * 1.1;
      const sy = Math.sin(a) * r * 0.7 - r * 0.2;
      const sp = Math.abs(Math.sin(t * 1.8 + i * 1.5));
      if (sp > 0.3) {
        const ss = 4 * sp;
        ctx.fillStyle = `rgba(255,255,255,${sp * 0.85})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy - ss);
        ctx.lineTo(sx + ss * 0.25, sy - ss * 0.25);
        ctx.lineTo(sx + ss, sy);
        ctx.lineTo(sx + ss * 0.25, sy + ss * 0.25);
        ctx.lineTo(sx, sy + ss);
        ctx.lineTo(sx - ss * 0.25, sy + ss * 0.25);
        ctx.lineTo(sx - ss, sy);
        ctx.lineTo(sx - ss * 0.25, sy - ss * 0.25);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  G.addScene("mineral1", mineralRoom("mineral1", 40, "spikes", "#7be0ff", 0));
  G.addScene("mineral2", mineralRoom("mineral2", 56, "darkmaze", "#b06bff", 1));
  G.addScene("mineral3", mineralRoom("mineral3", 72, "sand", "#ff8a4a", 2));

  /* =========================================================================
     9. ШИПЫ (доп. уровень между минералом 1 и 2)
     ========================================================================= */
  G.addScene("spikes", makeRoom({
    name: "spikes", dayValue: 48,
    start: { x: 110, y: 410 },
    narr: "Зал с шипами! Они то выскакивают, то прячутся. Перебегайте по очереди, пока шипы опущены.",
    drain: 0.35,
    build(s) {
      const b = s.bounds;
      s.data.spikes = [];
      const cols = 10, x0 = b.x + 70, tw = (b.w - 140) / cols;
      // 5 рядов — плотнее, без свободного коридора по высоте
      // Статичные «столбы» шипов образуют барьеры — нельзя идти по прямой, надо обходить
      const staticWalls = {
        "2,0": 1, "2,1": 1, "2,2": 1,           // верхний барьер, проход внизу (3,4)
        "5,2": 1, "5,3": 1, "5,4": 1,           // нижний барьер, проход сверху (0,1)
        "8,0": 1, "8,1": 1, "8,3": 1, "8,4": 1, // двойной барьер с проходом по центру (row 2)
      };
      for (let c = 0; c < cols; c++) {
        for (let row = 0; row < 5; row++) {
          const isStatic = !!staticWalls[c + "," + row];
          s.data.spikes.push({
            x: x0 + c * tw + tw / 2,
            y: b.y + 70 + row * 105,
            phase: c * 0.5 + row * 0.4,
            w: tw,
            isStatic,
          });
        }
      }
      s.exitZone = rightExit(s, { label: "→ Выход", to: "mineral2" });
    },
    update(s, dt) {
      for (const sp of s.data.spikes) {
        sp.up = sp.isStatic ? true : (Math.sin(G.time * 2.4 + sp.phase) > 0.25);
        if (sp.up && Math.abs(s.robot.x - sp.x) < sp.w / 2 + 2 && Math.abs(s.robot.y - sp.y) < s.robot.r + 40) s.hurt(9, null);
      }
    },
    drawProps(s, ctx) {
      for (const sp of s.data.spikes) {
        const h = sp.up ? 26 : 6;
        // основание
        ctx.fillStyle = sp.isStatic ? "#4a1a14" : "#3a2c22";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.w / 2 - 6, 0, 7); ctx.fill();
        if (sp.isStatic) {
          ctx.strokeStyle = "rgba(255,80,60,0.5)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.w / 2 - 4, 0, 7); ctx.stroke();
        }
        // шипы
        ctx.fillStyle = sp.up ? "#cfd6dd" : "#6a5a44";
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(sp.x + i * 14 - 6, sp.y + 6);
          ctx.lineTo(sp.x + i * 14, sp.y + 6 - h);
          ctx.lineTo(sp.x + i * 14 + 6, sp.y + 6);
          ctx.fill();
        }
      }
    },
  }));

  /* =========================================================================
     10. ТЁМНЫЙ ЛАБИРИНТ (доп. уровень между минералом 2 и 3)
     ========================================================================= */
  G.addScene("darkmaze", makeRoom({
    name: "darkmaze", dayValue: 64,
    start: { x: 110, y: 200 },
    narr: "Тёмный лабиринт. Стены силуэтом, ловушки-шипы и мутанты во мраке. Действие — удар кулаком.",
    drain: 0.4,
    build(s) {
      const b = s.bounds;
      s.obstacles = [
        // Базовые стены лабиринта
        { x: b.x + 200, y: b.y, w: 30, h: 360 },
        { x: b.x + 200, y: b.y + 360, w: 360, h: 30 },
        { x: b.x + 430, y: b.y + 120, w: 30, h: 270 },
        { x: b.x + 600, y: b.y + 140, w: 30, h: b.h - 140 },
        { x: b.x + 600, y: b.y + 140, w: 200, h: 30 },
        // Дополнительные стены — тупики и развилки
        { x: b.x + 70, y: b.y + 250, w: 130, h: 26 },    // верх-левый тупик
        { x: b.x + 250, y: b.y + 440, w: 30, h: 70 },    // короткая стенка в нижней
        { x: b.x + 770, y: b.y + 400, w: 30, h: 110 },   // отросток справа
        { x: b.x + 320, y: b.y + 200, w: 110, h: 26 },   // верхний разделитель
        { x: b.x + 350, y: b.y + 460, w: 100, h: 26 },   // короткий перешеек снизу
      ];
      // Стационарные ловушки-шипы (с пульсацией)
      s.data.traps = [
        { x: b.x + 380, y: b.y + 410, phase: 0 },
        { x: b.x + 540, y: b.y + 280, phase: 1.2 },
        { x: b.x + 740, y: b.y + 360, phase: 0.6 },
      ];
      // Мутанты охраняют коридоры
      s.mutants.push(makeMutant(b.x + 420, b.y + 500, 2));
      s.mutants.push(makeMutant(b.x + 850, b.y + 470, 2));
      s.exitZone = { x: b.x + b.w - 70, y: b.y + b.h - 96, w: 60, h: 90, label: "→ Выход", to: "mineral3" };
    },
    update(s, dt) {
      for (const tr of s.data.traps) {
        tr.up = Math.sin(G.time * 2.0 + tr.phase) > 0.05;
        if (tr.up && Math.abs(s.robot.x - tr.x) < 26 && Math.abs(s.robot.y - tr.y) < s.robot.r + 22) {
          s.hurt(7, null);
        }
      }
    },
    drawUnder(s, ctx) {
      // Стены
      for (const o of s.obstacles) {
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        grad.addColorStop(0, "#6e5746"); grad.addColorStop(1, "#3a2c22");
        ctx.fillStyle = grad; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2; ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "rgba(220,170,110,0.35)"; ctx.fillRect(o.x, o.y, o.w, 2);
      }
      // Ловушки-шипы из пола
      for (const tr of s.data.traps) {
        // основание (всегда видно)
        ctx.fillStyle = "#3a2c22"; ctx.beginPath(); ctx.arc(tr.x, tr.y, 18, 0, 7); ctx.fill();
        ctx.strokeStyle = "#1a0c08"; ctx.lineWidth = 2; ctx.stroke();
        if (tr.up) {
          // выскочившие шипы
          ctx.fillStyle = "#cfd6dd";
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(tr.x + i * 8 - 4, tr.y + 4);
            ctx.lineTo(tr.x + i * 8, tr.y - 16);
            ctx.lineTo(tr.x + i * 8 + 4, tr.y + 4);
            ctx.closePath(); ctx.fill();
          }
          ctx.strokeStyle = "rgba(255,80,60,0.55)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(tr.x, tr.y, 18, 0, 7); ctx.stroke();
        } else {
          // отверстия в основании, когда шипы внутри
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          for (let i = -1; i <= 1; i++) {
            ctx.fillRect(tr.x + i * 8 - 2, tr.y - 3, 4, 4);
          }
        }
      }
    },
    drawOver(s, ctx) {
      const g = ctx.createRadialGradient(s.robot.x, s.robot.y, 30, s.robot.x, s.robot.y, 210);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.55, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.82)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    },
  }));

  /* =========================================================================
     11. ПЕСОК — закопанный предмет (нужна лопата → чертёж)
     ========================================================================= */
  G.addScene("sand", makeRoom({
    name: "sand", dayValue: 80,
    start: { x: 240, y: 410 },
    drain: 0.4,
    narr: (s) => {
      if (G.state.hasBlueprint) return "Чертёж уже выкопан. Идите к 3D-принтеру и распечатайте бур.";
      if (G.state.hasShovel) return "У вас есть лопата! Подойдите к холмику и откопайте предмет.";
      return "В песке что-то закопано! Голыми руками не выкопать — нужна лопата с 3D-принтера.";
    },
    bg(ctx, s) { const b = s.bounds; const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#3a2a18"); g.addColorStop(1, "#1a120a"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h); drawSandFloor(ctx, b); G.drawBricks(ctx, b.x - 26, b.y - 26, b.w + 52, 26, true); G.drawBricks(ctx, b.x - 26, b.y + b.h, b.w + 52, 26, true); },
    build(s) {
      const mx = VIEW.w / 2 + 60, my = s.bounds.y + s.bounds.h / 2;
      s.data.mx = mx; s.data.my = my; s.data.digging = 0;
      s.interactables.push({ x: mx, y: my, r: 100,
        label: () => G.state.hasShovel && !G.state.hasBlueprint ? "Копать лопатой ⛏️" : "Копать руками ✋",
        ready: () => !G.state.hasBlueprint,
        act(sc) {
          if (!G.state.hasShovel) { sc.toast("Слишком твёрдо! Нужна лопата (3D-принтер).", 2.6); return; }
          if (sc.data.digging <= 0) sc.data.digging = 1.3;
        } });
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: "← К 3D-принтеру", to: "printer" };
      // запасной проход в пещеры за минералами — появляется, только если их не хватает
      s.data.caveExit = (!G.state.hasShovel && G.state.minerals < 3)
        ? { x: s.bounds.x + s.bounds.w - 66, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: "→ В пещеры (минералы)", to: "mineral3", _fired: false }
        : null;
    },
    update(s, dt) {
      const ce = s.data.caveExit;
      if (ce && !ce._fired && G.rectHit(ce, s.robot.x, s.robot.y)) { ce._fired = true; G.audio.door(); G.go("mineral3"); return; }
      if (s.data.digging > 0) {
        s.data.digging -= dt;
        if (Math.random() > 0.5) G.fx.burst(s.data.mx + (Math.random() - 0.5) * 40, s.data.my, "#caa066", 2, 120, 0.5);
        if (s.data.digging <= 0 && !G.state.hasBlueprint) {
          G.state.hasBlueprint = true; G.audio.pickup();
          G.fx.burst(s.data.mx, s.data.my, "#4aa0ff", 40, 240, 1.0);
          s.toast("Найден СИНИЙ ЧЕРТЁЖ — гигантский БУР! 📘", 3.0);
        }
      }
    },
    drawProps(s, ctx) {
      const mx = s.data.mx, my = s.data.my;
      if (s.data.caveExit) { const e = s.data.caveExit; G.drawDoor(ctx, e.x, e.y, e.w, e.h, true, e.label); }
      // ловушка-лейбл интерактивной кнопки динамический: обновим label
      for (const it of s.interactables) if (typeof it.label === "function") it._lbl = it.label();
      if (!G.state.hasBlueprint) {
        ctx.fillStyle = "#8a6a3a"; ctx.beginPath(); ctx.ellipse(mx, my + 18, 60, 26, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#6a4e28"; ctx.beginPath(); ctx.ellipse(mx, my + 10, 44, 18, 0, 0, 7); ctx.fill();
        const gl = (Math.sin(G.time * 4) + 1) / 2;
        ctx.fillStyle = `rgba(120,180,255,${0.3 + gl * 0.4})`; ctx.font = f(20); ctx.textAlign = "center";
        ctx.fillText("✦", mx, my); ctx.textAlign = "left";
      } else {
        // выкопанный чертёж лежит
        ctx.save(); ctx.translate(mx, my); ctx.fillStyle = "#1f5fae"; rr(ctx, -26, -18, 52, 36, 4); ctx.fill();
        ctx.strokeStyle = "#8fc2ff"; ctx.lineWidth = 2; ctx.strokeRect(-20, -12, 40, 24);
        ctx.fillStyle = "#8fc2ff"; ctx.font = f(12); ctx.textAlign = "center"; ctx.fillText("БУР", 0, 4); ctx.textAlign = "left";
        ctx.restore();
      }
    },
  }));

  /* =========================================================================
     12. 3D-ПРИНТЕР — печать лопаты, затем бура
     ========================================================================= */
  G.addScene("printer", makeRoom({
    name: "printer", dayValue: 84,
    start: { x: 240, y: 410 },
    drain: 0.35,
    shouldMove: (s) => !(s.data.printing && s.data.printing.t > 0),
    narr: (s) => {
      const st = G.state;
      // --- Глава 4: сборка корабля → топливо/карты → запуск ---
      if (st.printerUpgraded) {
        const shipBuilt = st.hasShipHull && st.hasShipWings && st.hasShipEngine;
        if (shipBuilt && st.fuelUnits >= 2 && st.navMaps >= 2)
          return "Корабль собран, топливо залито, карты загружены! Подойдите к кораблю (слева) и жмите ЗАПУСК 🚀!";
        if (shipBuilt) {
          const miss = [];
          if (st.fuelUnits < 2) miss.push(`топливо ×${2 - st.fuelUnits}`);
          if (st.navMaps < 2) miss.push(`карты ×${2 - st.navMaps}`);
          return `Корабль собран! Осталось добыть в шахтах: ${miss.join(", ")}.`;
        }
        if (!st.hasShipHull) return "Артефакт встроен — марсианские технологии активны! Печатайте КОРПУС 🛸 корабля.";
        if (!st.hasShipWings) return st.superMinerals >= 1 ? "Корпус собран. Печатайте КРЫЛЬЯ 🪽." : "Нужен 1 супер-минерал на крылья — бурите в шахтах.";
        if (!st.hasShipEngine) return st.superMinerals >= 1 ? "Печатайте ДВИГАТЕЛЬ 🚀 корабля." : "Нужен 1 супер-минерал на двигатель — бурите в шахтах.";
        return "Корабль почти готов!";
      }
      if (st.hasScanner) {
        return "Сканер 📡 включён! Выход слева → с X-RAY зрением отыщите древний артефакт под землёй и аккуратно откопайте.";
      }
      if (st.hasScannerBlueprint) {
        const haveAll = st.superMinerals >= 2 && st.wonderMinerals >= 2 && st.hasZCrystal;
        if (haveAll) return "Все руды собраны! Подойдите и распечатайте СКАНЕР 📡 древних предметов.";
        const miss = [];
        if (st.superMinerals < 2) miss.push(`супер ×${2 - st.superMinerals}`);
        if (st.wonderMinerals < 2) miss.push(`чудо ×${2 - st.wonderMinerals}`);
        if (!st.hasZCrystal) miss.push("Z-кристалл ×1");
        return `Чертёж сканера у вас. Добудьте в шахтах (слева): ${miss.join(", ")}.`;
      }
      if (st.hasSword && !st.bossDefeated) return "У вас есть меч! Идите в колизей и сразите Древнего.";
      if (st.hasSwordBlueprint && st.superMinerals >= 3) return "Чертёж меча и 3 супер-минерала. Подойдите и распечатайте МЕЧ ⚔!";
      if (st.hasSwordBlueprint) return `Чертёж меча у вас. Нужно ещё ${3 - st.superMinerals} супер-минерал(а) — бурите в шахтах.`;
      if (st.hasBase) return "База построена и работает. Нужен чертёж меча — поищите его в гробницах.";
      // многоэтапная сборка базы
      if (st.hasBaseBlueprint) {
        if (st.hasBaseSolar && !st.hasBaseReactor) {
          return st.superMinerals >= 1
            ? "Модуль пристыкован, батареи развёрнуты! Печатайте РЕАКТОР ⚛ — база оживёт."
            : "Нужен 1 супер-минерал для реактора — бурите в шахтах (слева).";
        }
        if (st.hasBaseFrame && !st.hasBaseSolar) {
          return st.superMinerals >= 1
            ? "Модуль стоит. Печатайте СОЛНЕЧНЫЕ БАТАРЕИ ☀ — 1 супер-минерал."
            : "Модуль установлен. Нужен 1 супер-минерал на батареи — бурите в шахтах.";
        }
        if (!st.hasBaseFrame) {
          return st.superMinerals >= 1
            ? "Чертёж базы у вас. Начните с ЖИЛОГО МОДУЛЯ 🛰 — 1 супер-минерал."
            : `Чертёж базы у вас. Нужен 1 супер-минерал на первую деталь — бурите в шахтах.`;
        }
      }
      if (st.hasDrill) return "Бур у вас! Найдите чертёж базы (слева).";
      if (st.hasBlueprint) return "Чертёж бура у вас. Подойдите к принтеру и нажмите «Действие» — напечатать БУР!";
      if (st.hasShovel) return "Лопата готова. Идите к раскопкам (выход слева) и откопайте чертёж.";
      if (st.minerals >= 3) return "У вас уже есть 3 минерала! Подойдите к принтеру и нажмите «Действие», чтобы напечатать лопату.";
      return `Минералов ${st.minerals}/3 — не хватает. Идите в раскопки (слева): там есть проход в пещеры за минералами.`;
    },
    build(s) {
      // Восстановление: артефакт добыт, но апгрейд принтера не применился
      // (доигрываем кат-сцену, которая ставит printerUpgraded). Спасает старые
      // сейвы, застрявшие из-за бага xray-выхода. Принтер всё равно достраиваем,
      // чтобы он корректно отрисовался на время затемнения-перехода.
      if (G.state.hasArtifact && !G.state.printerUpgraded) G.go("cutscene_artifact");
      const px = VIEW.w / 2 + 140, py = s.bounds.y + s.bounds.h / 2;
      s.data.px = px; s.data.py = py; s.data.printing = null; s.data.plate = 0;
      s.data.nozzleX = 0;     // -1..+1 положение печатающей головки
      s.data.dropT = 0;       // таймер искр/капель из сопла
      s.obstacles.push({ x: px - 100, y: py - 130, w: 200, h: 260 });
      s.interactables.push({ x: px - 130, y: py + 40, r: 130,
        label: () => printerJob() ? printerJob().label : (G.state.hasBase ? "Подзарядка 🔋" : "Печать"),
        ready: () => !(s.data.printing) && (!!printerJob() || (G.state.hasBase && G.state.battery < 99)),
        act(sc) {
          const job = printerJob();
          if (job) { sc.data.printing = { what: job.what, t: job.time, total: job.time }; G.audio.tone(300, 0.2, "square", 0.05); return; }
          if (G.state.hasBase && G.state.battery < 99) { G.state.battery = 100; sc.toast("Заряжено до 100% 🔋", 2.0); G.audio.pickup(); }
        } });
      // ЗАПУСК корабля — интерактив у стартовой площадки (слева)
      s.data.shipX = px - 380; s.data.shipY = py + 40;
      s.interactables.push({
        x: s.data.shipX, y: s.data.shipY - 30, r: 120,
        label: () => "ЗАПУСК 🚀",
        ready: () => shipReadyToLaunch() && !s.data.printing,
        act(sc) { G.state.shipLaunched = true; G.audio.win(); G.go("cutscene_launch"); }
      });
      // Опц. испытание: оборона базы (даёт апгрейды; можно переигрывать, пока есть незакрытые)
      s.interactables.push({
        x: px - 360, y: py - 10, r: 120,
        label: () => nextUpgrade() ? "🛡 Оборона базы" : "🛡 База защищена",
        ready: () => G.state.hasBase && !G.state.printerUpgraded && !s.data.printing && !!nextUpgrade(),
        act(sc) { G.go("base_defense"); }
      });
      // ЦЕХ ОБОРОНЫ: печать турелей/забора + апгрейд принтера (нужен чертёж + супер)
      s.interactables.push({
        x: px + 150, y: py + 40, r: 120,
        label: () => { const j = defenseFabJob(); return j ? j.label : "🛠 Цех обороны"; },
        ready: () => !s.data.printing && !!defenseFabJob(),
        act(sc) {
          const j = defenseFabJob();
          if (j) { sc.data.printing = { what: j.what, t: j.time, total: j.time }; G.audio.tone(300, 0.2, "square", 0.05); }
        }
      });
      // ВЕРСТАК: крафт расходников из лома
      s.data.benchX = px + 150; s.data.benchY = py - 120;
      s.interactables.push({
        x: s.data.benchX, y: s.data.benchY, r: 115,
        label: () => `🛠 Верстак (лом ⚙${G.state.scrap})`,
        ready: () => !s.data.printing,
        act() { G.audio.blip(); G.go("workbench"); }
      });
      // Слева — динамический выход в зависимости от стадии
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => {
          const st = G.state;
          if (!st.hasDrill) return "← К раскопкам";
          if (!st.hasBaseBlueprint) return "← К чертежу базы";
          if (!st.hasBase) return "← В шахты";
          if (!st.hasSwordBlueprint && !st.bossDefeated) return "← К чертежу меча";
          if (st.hasSword && !st.bossDefeated) return "→ В колизей";
          if (st.hasScanner && !st.hasArtifact) return "→ X-RAY раскопки";
          return "← Карта Марса 🛰";
        },
        onExit: (sc) => {
          const st = G.state;
          if (!st.hasDrill) G.go("sand");
          else if (!st.hasBaseBlueprint) G.go("base_blueprint");
          else if (!st.hasBase) G.go("drill_site");
          else if (!st.hasSwordBlueprint && !st.bossDefeated) G.go("sword_blueprint");
          else if (st.hasSword && !st.bossDefeated) G.go(st._bossSeen ? "coliseum" : "cutscene_boss");
          else if (st.hasScanner && !st.hasArtifact) G.go("xray_field");
          else if (!st._sawMapIntro) { st._sawMapIntro = true; G.go("cutscene_mars_intro"); } // первый выход на карту
          else G.go("mars_map"); // база построена → карта Марса
        },
        ready: () => !s.data.printing
      };
    },
    update(s, dt) {
      const p = s.data.printing; if (!p) return;
      p.t -= dt; s.data.plate = 1 - p.t / p.total;
      // печатающая головка качается влево-вправо
      s.data.nozzleX = Math.sin(G.time * 3.2) * 1;
      // капли расплава из сопла на деталь
      s.data.dropT -= dt;
      if (s.data.dropT <= 0) {
        s.data.dropT = 0.08 + Math.random() * 0.06;
        const itemHeight = printItemHeight(p.what);
        const platTop = s.data.py + 30;
        const surfaceY = platTop - itemHeight * s.data.plate;
        const dropX = s.data.px + s.data.nozzleX * 44;
        G.fx.burst(dropX, surfaceY + 6, "#ffd17a", 1, 60, 0.35);
        G.fx.burst(dropX, surfaceY - 4, "#7be0ff", 2, 100, 0.45);
      }
      G.audio.tone(200 + s.data.plate * 300, 0.04, "square", 0.02);
      if (p.t <= 0) {
        const what = p.what;
        s.data.printing = null; s.data.plate = 0; s.data.nozzleX = 0; G.audio.pickup();
        // вспышка "ГОТОВО"
        G.fx.burst(s.data.px, s.data.py - 10, "#7be0ff", 36, 240, 1.0);
        if (what === "shovel") {
          G.state.hasShovel = true; G.state.minerals = 0;
          s.toast("Лопата готова! Идите к раскопкам ⛏", 3.0);
        } else if (what === "drill") {
          G.state.hasDrill = true; G.audio.win();
          G.go("cutscene_drill"); return;
        } else if (what === "frame") {
          G.state.hasBaseFrame = true; G.state.superMinerals -= 1; G.audio.win();
          s.toast("Жилой модуль 🛰 пристыкован к платформе!", 2.6);
        } else if (what === "solar") {
          G.state.hasBaseSolar = true; G.state.superMinerals -= 1; G.audio.win();
          s.toast("Солнечная батарея ☀ развёрнута!", 2.6);
        } else if (what === "reactor") {
          G.state.hasBaseReactor = true; G.state.superMinerals -= 1;
          G.state.hasBase = true; G.audio.win();
          G.go("cutscene_base"); return;
        } else if (what === "sword") {
          G.state.hasSword = true; G.state.superMinerals = 0; G.audio.win();
          G.go("cutscene_sword"); return;
        } else if (what === "scanner") {
          G.state.hasScanner = true;
          G.state.superMinerals -= 2; G.state.wonderMinerals -= 2; G.state.hasZCrystal = false;
          G.audio.win();
          G.go("cutscene_scanner"); return;
        } else if (what === "hull") {
          G.state.hasShipHull = true; G.audio.win(); // бесплатно — артефакт запускает печать
          s.toast("Корпус корабля 🛸 собран! Дальше нужны супер-минералы — бурите в шахтах.", 3.2);
        } else if (what === "wings") {
          G.state.hasShipWings = true; G.state.superMinerals -= 1; G.audio.win();
          s.toast("Крылья 🪽 пристыкованы к кораблю!", 2.6);
        } else if (what === "engine") {
          G.state.hasShipEngine = true; G.state.superMinerals -= 1; G.audio.win();
          s.toast("Двигатель 🚀 установлен! Теперь нужны топливо и навигационные карты.", 3.0);
        } else if (what === "turret") {
          G.state.baseTurrets = Math.min(3, G.state.baseTurrets + 1); G.state.superMinerals -= 1; G.audio.win();
          s.toast(`🔫 Турель напечатана и установлена на базу! (${G.state.baseTurrets}/3)`, 3.0);
        } else if (what === "fence") {
          G.state.baseFence = Math.min(2, G.state.baseFence + 1); G.state.superMinerals -= 1; G.audio.win();
          s.toast(`⚡ Секция энергозабора готова! (${G.state.baseFence}/2)`, 3.0);
        } else if (what === "printerup") {
          G.state.printerTier = 1; G.state.superMinerals -= 2; G.audio.win();
          s.toast("🔧 Принтер улучшен! Теперь можно печатать энергозабор.", 3.4);
        }
      }
    },
    drawProps(s, ctx) {
      for (const it of s.interactables) if (typeof it.label === "function") it._lbl = it.label();
      const px = s.data.px, py = s.data.py;
      drawPrinterRig(ctx, s, px, py);
      if (s.data.benchX) drawWorkbench(ctx, s.data.benchX, s.data.benchY);
      // Глава 4: показываем стартовую площадку корабля; иначе — сборку базы
      if (G.state.printerUpgraded) drawShipAssembly(ctx, s, s.data.shipX, s.data.shipY);
      else drawBaseAssembly(ctx, s, px - 360, py + 40);
    },
  }));
  function shipReadyToLaunch() {
    const st = G.state;
    return st.hasShipHull && st.hasShipWings && st.hasShipEngine && st.fuelUnits >= 2 && st.navMaps >= 2;
  }
  // маленький верстак-станок (визуал у принтера)
  function drawWorkbench(ctx, x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(0, 44, 50, 10, 0, 0, 7); ctx.fill();
    // столешница
    ctx.fillStyle = "#4a4f57"; rr(ctx, -48, 6, 96, 14, 3); ctx.fill();
    ctx.fillStyle = "#2b2f35"; for (const lx of [-40, 34]) ctx.fillRect(lx, 18, 8, 26);
    // тиски + инструменты
    ctx.fillStyle = "#6a7079"; rr(ctx, -34, -2, 22, 12, 2); ctx.fill();
    ctx.fillStyle = "#3a3f47"; ctx.fillRect(-26, -10, 6, 10);
    // ящик с ломом
    ctx.fillStyle = "#3a2c22"; rr(ctx, 8, -8, 34, 16, 3); ctx.fill();
    ctx.fillStyle = "#9aa3ad"; for (const g of [[14, 0], [24, -2], [32, 1]]) { ctx.beginPath(); ctx.arc(g[0], g[1], 3, 0, 7); ctx.fill(); }
    // вывеска
    ctx.fillStyle = "#1a1e24"; rr(ctx, -30, -34, 60, 18, 4); ctx.fill();
    ctx.fillStyle = "#ffd24a"; ctx.font = `800 12px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ВЕРСТАК", 0, -25); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.restore();
  }
  // === СЦЕНА: ВЕРСТАК (крафт расходников из лома) ===
  G.addScene("workbench", {
    recharge: false, useJoystick: false,
    enter() { this.back = { x: 36, y: 34, w: 210, h: 50, text: "← К принтеру", fs: 20 }; this.t = 0; this._cards = []; this._flashK = null; this._flashT = 0; },
    update(dt) { this.t += dt; if (this._flashT > 0) this._flashT -= dt; },
    onTap(x, y) {
      if (rectHit(this.back, x, y)) { G.audio.blip(); G.go("printer"); return; }
      for (const c of this._cards) {
        if (rectHit(c.btn, x, y)) {
          if (craftConsumable(c.kind)) { this._flashK = c.kind; this._flashT = 0.45; }
          else { G.audio.tone(170, 0.12, "square", 0.04); this._noScrapT = 1.2; }
          return;
        }
      }
    },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#241c16"); g.addColorStop(1, "#0e0a07"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      // верстак-фон по низу
      ctx.fillStyle = "#3a2c22"; ctx.fillRect(0, VIEW.h - 90, VIEW.w, 90);
      ctx.fillStyle = "#2a2018"; for (let x = 0; x < VIEW.w; x += 40) ctx.fillRect(x, VIEW.h - 90, 20, 90);
      // заголовок
      ctx.fillStyle = "#ffd24a"; ctx.font = f(40, "800"); ctx.textAlign = "center";
      ctx.fillText("🛠 ВЕРСТАК", VIEW.w / 2, 118);
      ctx.fillStyle = "#cfd6dd"; ctx.font = f(20, "700");
      ctx.fillText(`Лом для крафта: ⚙ ${G.state.scrap}   (лом выпадает с врагов)`, VIEW.w / 2, 156);
      // карточки
      const order = ["medkit", "emp", "mine"];
      const cw = 280, ch = 320, gap = 28, total = order.length * cw + (order.length - 1) * gap;
      const x0 = (VIEW.w - total) / 2, y0 = 210;
      this._cards = [];
      for (let i = 0; i < order.length; i++) {
        const kind = order[i], c = CONSUMABLES[kind], owned = G.state.cons[kind] || 0;
        const cx = x0 + i * (cw + gap), cyy = y0;
        const afford = G.state.scrap >= c.cost;
        const flash = (this._flashK === kind && this._flashT > 0) ? this._flashT / 0.45 : 0;
        ctx.fillStyle = "rgba(15,18,24,0.9)"; rr(ctx, cx, cyy, cw, ch, 16); ctx.fill();
        ctx.strokeStyle = c.color; ctx.lineWidth = 3 + flash * 4; rr(ctx, cx, cyy, cw, ch, 16); ctx.stroke();
        // иконка
        ctx.fillStyle = c.color; ctx.font = `900 70px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(c.icon, cx + cw / 2, cyy + 78);
        ctx.textBaseline = "alphabetic";
        // имя/описание
        ctx.fillStyle = "#fff"; ctx.font = f(26, "800"); ctx.fillText(c.name, cx + cw / 2, cyy + 148);
        ctx.fillStyle = "#aeb6bf"; ctx.font = f(15);
        G.wrapText(ctx, c.desc, cx + cw / 2, cyy + 178, cw - 36, 20);
        ctx.fillStyle = "#ffd24a"; ctx.font = f(18, "800");
        ctx.fillText(`Цена: ⚙ ${c.cost}`, cx + cw / 2, cyy + 222);
        ctx.fillStyle = "#9ce0a8"; ctx.font = f(16, "700");
        ctx.fillText(`В наличии: ×${owned}`, cx + cw / 2, cyy + 246);
        // кнопка крафта
        const btn = { x: cx + 30, y: cyy + ch - 60, w: cw - 60, h: 44, kind };
        ctx.fillStyle = afford ? c.color : "rgba(90,96,104,0.6)"; rr(ctx, btn.x, btn.y, btn.w, btn.h, 10); ctx.fill();
        ctx.fillStyle = afford ? "#0d1016" : "#cfd6dd"; ctx.font = f(20, "800"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(afford ? "СКРАФТИТЬ" : "мало лома", btn.x + btn.w / 2, btn.y + btn.h / 2);
        ctx.textBaseline = "alphabetic";
        this._cards.push({ kind, btn });
      }
      ctx.textAlign = "left";
      G.button(ctx, this.back, true);
    },
  });
  // ====== Апгрейды робота (награды за испытания) ======
  const UPGRADES = [
    { key: "upgShield",  icon: "🛡", name: "БРОНЯ", desc: "урон −40%" },
    { key: "upgSpeed",   icon: "👟", name: "УСКОРИТЕЛЬ", desc: "скорость +25%" },
    { key: "upgBattery", icon: "🔋", name: "ЁМКАЯ БАТАРЕЯ", desc: "разряд −25%, солнце ×1.5" },
    { key: "upgPunch",   icon: "👊", name: "УСИЛЕННЫЙ УДАР", desc: "двойной урон, шире зона" },
  ];
  function nextUpgrade() { return UPGRADES.find((u) => !G.state[u.key]) || null; }
  function grantNextUpgrade(s) {
    const u = nextUpgrade();
    if (!u) { if (s) s.toast("Все апгрейды уже установлены!", 2.4); return null; }
    G.state[u.key] = true;
    if (s) s.toast(`Апгрейд: ${u.icon} ${u.name} (${u.desc})!`, 3.4);
    G.audio.win();
    return u;
  }
  // Награда-выбор: вместо принудительного порядка игрок САМ берёт апгрейд.
  // Возвращает true и уводит на экран выбора, если есть что брать.
  function awardUpgrade(returnScene) {
    if (!nextUpgrade()) return false;
    G.state._upgReturn = returnScene || "challenges";
    G.go("upgrade_pick");
    return true;
  }
  // === ЭКРАН ВЫБОРА АПГРЕЙДА ===
  G.addScene("upgrade_pick", {
    recharge: false, useJoystick: false,
    enter() {
      this.t = 0; this._cards = [];
      this.opts = UPGRADES.filter((u) => !G.state[u.key]);
      // подсказки синергии с рывком/боем
      this._hint = {
        upgShield: "Меньше урона — дольше живёшь в окружении.",
        upgSpeed: "Быстрее ходишь и дэшишь дальше — кайтить врагов легко.",
        upgBattery: "Заряд бережётся — реже разряд, меньше потерь дней.",
        upgPunch: "×2 урон и шире зона — боссы и толпы тают вдвое быстрее.",
      };
      if (!this.opts.length) { const r = G.state._upgReturn || "challenges"; G.state._upgReturn = null; G.go(r); }
    },
    update(dt) { this.t += dt; },
    onTap(x, y) {
      for (const c of this._cards) {
        if (rectHit(c.b, x, y)) {
          G.state[c.u.key] = true; G.audio.win();
          G.fx.burst(c.b.x + c.b.w / 2, c.b.y + c.b.h / 2, "#ffd17a", 40, 280, 1.0);
          const r = G.state._upgReturn || "challenges"; G.state._upgReturn = null;
          G.go(r); return;
        }
      }
    },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#10243a"); g.addColorStop(1, "#0a0f18"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      starfield(ctx, 70, 9);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd9a0"; ctx.font = f(40, "800");
      ctx.fillText("🏅 ИСПЫТАНИЕ ПРОЙДЕНО", VIEW.w / 2, 130);
      ctx.fillStyle = "rgba(255,230,200,0.8)"; ctx.font = f(20, "600");
      ctx.fillText("Выбери награду — апгрейд робота (взять можно только ОДИН):", VIEW.w / 2, 172);
      const opts = this.opts, n = opts.length;
      const cw = 250, gap = 26, total = n * cw + (n - 1) * gap, x0 = (VIEW.w - total) / 2, y0 = 230, ch = 330;
      this._cards = [];
      for (let i = 0; i < n; i++) {
        const u = opts[i], bx = x0 + i * (cw + gap), pulse = (Math.sin(this.t * 4 + i) + 1) / 2;
        ctx.fillStyle = "rgba(15,22,32,0.92)"; rr(ctx, bx, y0, cw, ch, 16); ctx.fill();
        ctx.strokeStyle = `rgba(255,209,122,${0.5 + pulse * 0.4})`; ctx.lineWidth = 3; rr(ctx, bx, y0, cw, ch, 16); ctx.stroke();
        ctx.fillStyle = "#ffd17a"; ctx.font = `900 64px ${G.FONT}`; ctx.textBaseline = "middle";
        ctx.fillText(u.icon, bx + cw / 2, y0 + 76); ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#fff"; ctx.font = f(24, "800"); ctx.fillText(u.name, bx + cw / 2, y0 + 150);
        ctx.fillStyle = "#9ce0a8"; ctx.font = f(17, "700"); ctx.fillText(u.desc, bx + cw / 2, y0 + 182);
        ctx.fillStyle = "#aeb6bf"; ctx.font = f(14);
        G.wrapText(ctx, this._hint[u.key] || "", bx + cw / 2, y0 + 214, cw - 28, 19);
        const b = { x: bx + 26, y: y0 + ch - 56, w: cw - 52, h: 42, u };
        ctx.fillStyle = "#ffd17a"; rr(ctx, b.x, b.y, b.w, b.h, 10); ctx.fill();
        ctx.fillStyle = "#0d1016"; ctx.font = f(19, "800"); ctx.textBaseline = "middle";
        ctx.fillText("ВЗЯТЬ", b.x + b.w / 2, b.y + b.h / 2); ctx.textBaseline = "alphabetic";
        this._cards.push({ b, u });
      }
      ctx.textAlign = "left";
    },
  });

  // ====== Что печатать сейчас (единый источник: label/ready/act) ======
  // Возвращает { what, label, time } или null. Recharge — отдельная ветка.
  function printerJob() {
    const st = G.state;
    if (!st.hasShovel && st.minerals >= 3) return { what: "shovel", label: "Печать ЛОПАТЫ ⛏", time: 3.0 };
    if (st.hasBlueprint && !st.hasDrill) return { what: "drill", label: "Печать БУРА 🛠", time: 4.0 };
    if (st.hasBaseBlueprint && !st.hasBaseFrame && st.superMinerals >= 1) return { what: "frame", label: "Печать МОДУЛЯ 🛰", time: 4.0 };
    if (st.hasBaseFrame && !st.hasBaseSolar && st.superMinerals >= 1) return { what: "solar", label: "Печать БАТАРЕЙ ☀", time: 4.0 };
    if (st.hasBaseSolar && !st.hasBaseReactor && st.superMinerals >= 1) return { what: "reactor", label: "Печать РЕАКТОРА ⚛", time: 5.0 };
    if (st.hasSwordBlueprint && !st.hasSword && st.superMinerals >= 3) return { what: "sword", label: "Печать МЕЧА ⚔", time: 4.0 };
    if (st.hasScannerBlueprint && !st.hasScanner && st.superMinerals >= 2 && st.wonderMinerals >= 2 && st.hasZCrystal) return { what: "scanner", label: "Печать СКАНЕРА 📡", time: 5.0 };
    // Сборка корпуса корабля (по 1 супер-минералу за деталь)
    if (st.printerUpgraded && !st.hasShipHull) return { what: "hull", label: "Печать КОРПУСА 🛸", time: 5.0 }; // первый модуль бесплатный — артефакт запускает печать
    if (st.printerUpgraded && st.hasShipHull && !st.hasShipWings && st.superMinerals >= 1) return { what: "wings", label: "Печать КРЫЛЬЕВ 🪽", time: 4.0 };
    if (st.printerUpgraded && st.hasShipWings && !st.hasShipEngine && st.superMinerals >= 1) return { what: "engine", label: "Печать ДВИГАТЕЛЯ 🚀", time: 6.0 };
    return null;
  }
  // ====== Цех обороны: печать турелей/забора + апгрейд принтера ======
  function defenseFabJob() {
    const st = G.state;
    if (!st.hasBase) return null;
    // турель: чертёж + 1 супер, до 3 шт
    if (st.hasTurretBlueprint && st.baseTurrets < 3 && st.superMinerals >= 1)
      return { what: "turret", label: "Печать ТУРЕЛИ 🔫", time: 4.0 };
    // забор требует апгрейда принтера
    if (st.hasFenceBlueprint && st.printerTier < 1 && st.superMinerals >= 2)
      return { what: "printerup", label: "Апгрейд ПРИНТЕРА 🔧", time: 5.0 };
    if (st.hasFenceBlueprint && st.printerTier >= 1 && st.baseFence < 2 && st.superMinerals >= 1)
      return { what: "fence", label: "Печать ЗАБОРА ⚡", time: 4.0 };
    return null;
  }

  // ====== Иконки печатаемых предметов: bottomY — низ предмета ======
  // Каждая функция рисует предмет с НИЗОМ на координате bottomY, центром по x.
  // printItemHeight возвращает высоту предмета для клиппинга.
  function printItemHeight(what) {
    return ({ shovel: 78, drill: 84, frame: 78, solar: 70, reactor: 86, sword: 96, scanner: 92, hull: 96, wings: 64, engine: 96, turret: 64, fence: 60, printerup: 72 })[what] || 80;
  }
  function drawPrintedItem(ctx, what, x, bottomY) {
    if (what === "shovel") drawShovelItem(ctx, x, bottomY);
    else if (what === "drill") drawDrillItem(ctx, x, bottomY);
    else if (what === "frame") drawFrameItem(ctx, x, bottomY);
    else if (what === "solar") drawSolarItem(ctx, x, bottomY);
    else if (what === "reactor") drawReactorItem(ctx, x, bottomY);
    else if (what === "sword") drawSwordItem(ctx, x, bottomY);
    else if (what === "scanner") drawScannerItem(ctx, x, bottomY);
    else if (what === "hull") drawShipHullItem(ctx, x, bottomY);
    else if (what === "wings") drawShipWingsItem(ctx, x, bottomY);
    else if (what === "engine") drawShipPartItem(ctx, x, bottomY);
    else if (what === "turret") drawTurretItem(ctx, x, bottomY);
    else if (what === "fence") drawFenceItem(ctx, x, bottomY);
    else if (what === "printerup") drawPrinterUpItem(ctx, x, bottomY);
  }
  function drawTurretItem(ctx, x, by) {
    ctx.save(); ctx.translate(x, by);
    // основание
    ctx.fillStyle = "#3a424c"; rr(ctx, -16, -10, 32, 10, 3); ctx.fill();
    // опора
    ctx.fillStyle = "#5a6470"; rr(ctx, -8, -28, 16, 20, 3); ctx.fill();
    // турель-голова
    const g = ctx.createLinearGradient(-14, -44, 14, -44); g.addColorStop(0, "#5a6470"); g.addColorStop(0.5, "#cfd6dd"); g.addColorStop(1, "#5a6470");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -34, 12, Math.PI, 0); ctx.fill(); rr(ctx, -12, -34, 24, 8, 2); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.stroke();
    // ствол
    ctx.fillStyle = "#7a8290"; rr(ctx, 8, -38, 22, 5, 1); ctx.fill();
    ctx.fillStyle = "#ff8a4a"; ctx.beginPath(); ctx.arc(30, -35.5, 2.5, 0, 7); ctx.fill();
    // прицел
    ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(-3, -36, 3, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawFenceItem(ctx, x, by) {
    ctx.save(); ctx.translate(x, by);
    // два столба
    for (const px2 of [-20, 20]) { ctx.fillStyle = "#5a6470"; rr(ctx, px2 - 4, -52, 8, 52, 2); ctx.fill(); ctx.fillStyle = "#3a424c"; rr(ctx, px2 - 8, -2, 16, 4, 1); ctx.fill(); }
    // эмиттеры
    const gl = (Math.sin(G.time * 6) + 1) / 2;
    for (const px2 of [-20, 20]) { ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(px2, -52, 4, 0, 7); ctx.fill(); }
    // энергополе между столбами
    ctx.strokeStyle = `rgba(120,210,255,${0.4 + gl * 0.4})`; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const yy = -46 + i * 12; ctx.beginPath(); ctx.moveTo(-20, yy); ctx.lineTo(20, yy + Math.sin(G.time * 5 + i) * 2); ctx.stroke(); }
    ctx.fillStyle = `rgba(120,210,255,${0.12 + gl * 0.1})`; ctx.fillRect(-20, -52, 40, 50);
    ctx.restore();
  }
  function drawPrinterUpItem(ctx, x, by) {
    ctx.save(); ctx.translate(x, by);
    // плата-модуль апгрейда
    const g = ctx.createLinearGradient(0, -64, 0, 0); g.addColorStop(0, "#2a5a3a"); g.addColorStop(1, "#13351f");
    ctx.fillStyle = g; rr(ctx, -22, -64, 44, 64, 5); ctx.fill();
    ctx.strokeStyle = "#7de08a"; ctx.lineWidth = 1.5; ctx.strokeRect(-22, -64, 44, 64);
    // дорожки
    ctx.strokeStyle = "rgba(123,224,160,0.6)"; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-18, -58 + i * 11); ctx.lineTo(18, -58 + i * 11); ctx.stroke(); }
    // чип
    const gl = (Math.sin(G.time * 4) + 1) / 2;
    ctx.fillStyle = "#1a3a24"; rr(ctx, -10, -40, 20, 20, 2); ctx.fill();
    ctx.fillStyle = `rgba(123,224,255,${0.6 + gl * 0.4})`; ctx.beginPath(); ctx.arc(0, -30, 5, 0, 7); ctx.fill();
    ctx.fillStyle = "#cfe6f0"; ctx.font = f(9, "700"); ctx.textAlign = "center"; ctx.fillText("v2", 0, -6); ctx.textAlign = "left";
    ctx.restore();
  }
  function drawShovelItem(ctx, x, by) {
    // лопата высотой 78 (от -78 до 0 относительно by)
    ctx.save(); ctx.translate(x, by);
    // черенок
    const grad = ctx.createLinearGradient(-4, -78, 4, -78);
    grad.addColorStop(0, "#7a4a1f"); grad.addColorStop(0.5, "#b07a3a"); grad.addColorStop(1, "#7a4a1f");
    ctx.fillStyle = grad; rr(ctx, -4, -78, 8, 58, 2); ctx.fill();
    // рукоятка-набалдашник
    ctx.fillStyle = "#6a3f18"; rr(ctx, -10, -78, 20, 8, 3); ctx.fill();
    ctx.fillStyle = "#a06a2c"; rr(ctx, -10, -78, 20, 3, 2); ctx.fill();
    // соединение черенка с ковшом
    ctx.fillStyle = "#9aa3ad"; rr(ctx, -3, -22, 6, 6, 1); ctx.fill();
    // ковш — трапеция
    const blade = ctx.createLinearGradient(0, -20, 0, 0);
    blade.addColorStop(0, "#dfe5ec"); blade.addColorStop(1, "#7e8893");
    ctx.fillStyle = blade;
    ctx.beginPath();
    ctx.moveTo(-16, -20); ctx.lineTo(16, -20);
    ctx.lineTo(12, 0); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill();
    // ребро ковша
    ctx.strokeStyle = "#4a525c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(14, -10); ctx.stroke();
    ctx.restore();
  }
  function drawDrillItem(ctx, x, by) {
    // бур высотой 84
    ctx.save(); ctx.translate(x, by);
    // корпус-мотор
    const body = ctx.createLinearGradient(-26, -84, 26, -84);
    body.addColorStop(0, "#5a6470"); body.addColorStop(0.5, "#cfd6dd"); body.addColorStop(1, "#5a6470");
    ctx.fillStyle = body; rr(ctx, -26, -84, 52, 46, 8); ctx.fill();
    // вентиляция
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(-18, -72 + i * 7); ctx.lineTo(18, -72 + i * 7); ctx.stroke();
    }
    // светодиод
    ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(14, -76, 3, 0, 7); ctx.fill();
    // рукоятка
    ctx.fillStyle = "#3a424c"; rr(ctx, -10, -38, 20, 14, 3); ctx.fill();
    // патрон
    ctx.fillStyle = "#9aa3ad"; rr(ctx, -14, -28, 28, 12, 3); ctx.fill();
    ctx.fillStyle = "#5a6470"; rr(ctx, -10, -22, 20, 6, 2); ctx.fill();
    // спиральный наконечник
    const tip = ctx.createLinearGradient(0, -16, 0, 0);
    tip.addColorStop(0, "#ffd17a"); tip.addColorStop(1, "#a85a16");
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.moveTo(-12, -16); ctx.lineTo(12, -16); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5a3010"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(7, -8); ctx.moveTo(-7, -4); ctx.lineTo(5, -2); ctx.stroke();
    ctx.restore();
  }
  function drawFrameItem(ctx, x, by) {
    // ЖИЛОЙ МОДУЛЬ — горизонтальный цилиндр с иллюминаторами и шлюзом
    // высота 78, ширина ~76
    ctx.save(); ctx.translate(x, by);
    // посадочные опоры
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-30, 0); ctx.lineTo(-22, -22); ctx.moveTo(30, 0); ctx.lineTo(22, -22);
    ctx.moveTo(-10, 0); ctx.lineTo(-10, -18); ctx.moveTo(10, 0); ctx.lineTo(10, -18);
    ctx.stroke();
    // тарелочки на лапах
    ctx.fillStyle = "#3a424c";
    for (const fx of [-30, -10, 10, 30]) { rr(ctx, fx - 5, -3, 10, 4, 1); ctx.fill(); }
    // корпус-капсула
    const body = ctx.createLinearGradient(0, -60, 0, -22);
    body.addColorStop(0, "#cfd6dd"); body.addColorStop(0.4, "#eef2f8"); body.addColorStop(1, "#7a8290");
    ctx.fillStyle = body;
    rr(ctx, -34, -60, 68, 38, 18); ctx.fill();
    // тёмная нижняя кромка
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(-32, -22); ctx.lineTo(32, -22); ctx.stroke();
    // иллюминаторы
    for (const px of [-18, 6]) {
      ctx.fillStyle = "#0a1a2a"; ctx.beginPath(); ctx.arc(px, -42, 6, 0, 7); ctx.fill();
      const ig = ctx.createRadialGradient(px - 2, -44, 1, px, -42, 6);
      ig.addColorStop(0, "#aae0ff"); ig.addColorStop(1, "#1a4a7a");
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(px, -42, 4.5, 0, 7); ctx.fill();
      ctx.strokeStyle = "#4a525c"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, -42, 6, 0, 7); ctx.stroke();
    }
    // шлюз справа
    ctx.fillStyle = "#3a424c"; rr(ctx, 18, -52, 14, 28, 4); ctx.fill();
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 1.5; ctx.strokeRect(20, -50, 10, 22);
    ctx.fillStyle = "#ffd17a"; ctx.beginPath(); ctx.arc(25, -42, 1.5, 0, 7); ctx.fill();
    // антенна-мачта на крыше
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -60); ctx.lineTo(-14, -78); ctx.stroke();
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-20, -76); ctx.lineTo(-8, -76);
    ctx.moveTo(-18, -72); ctx.lineTo(-10, -72);
    ctx.stroke();
    // мигающий маячок
    const blink = (Math.sin(G.time * 4) + 1) / 2;
    ctx.fillStyle = `rgba(255,90,60,${0.5 + blink * 0.5})`;
    ctx.beginPath(); ctx.arc(-14, -78, 2.5, 0, 7); ctx.fill();
    // логотип ★ на боку
    ctx.fillStyle = "#ff5a3a"; ctx.font = f(10, "700"); ctx.textAlign = "center";
    ctx.fillText("★", -10, -28); ctx.textAlign = "left";
    ctx.restore();
  }
  function drawSolarItem(ctx, x, by) {
    // СОЛНЕЧНАЯ БАТАРЕЯ — мачта + два крыла-панели как у МКС
    // высота 70
    ctx.save(); ctx.translate(x, by);
    // основание
    ctx.fillStyle = "#3a424c"; rr(ctx, -14, -4, 28, 4, 1); ctx.fill();
    ctx.fillStyle = "#5a6470"; rr(ctx, -10, -8, 20, 4, 1); ctx.fill();
    // мачта
    ctx.fillStyle = "#7a8290"; rr(ctx, -3, -50, 6, 46, 2); ctx.fill();
    // вращающийся узел вверху мачты
    ctx.fillStyle = "#3a424c"; ctx.beginPath(); ctx.arc(0, -52, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = "#caa066"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, -52, 5, 0, 7); ctx.stroke();
    // лёгкое колебание панелей "следит за солнцем"
    const sway = Math.sin(G.time * 0.6) * 0.08;
    // правое крыло
    drawSolarWing(ctx, 0, -52, 1, sway);
    // левое крыло
    drawSolarWing(ctx, 0, -52, -1, -sway);
    ctx.restore();
  }
  function drawSolarWing(ctx, hx, hy, dir, tilt) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(tilt);
    // штанга к панели
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dir * 8, 0); ctx.stroke();
    // панель
    const pg = ctx.createLinearGradient(dir * 8, -10, dir * 36, -10);
    pg.addColorStop(0, "#1a2a4a"); pg.addColorStop(0.5, "#3a5aaa"); pg.addColorStop(1, "#0a1a3a");
    ctx.fillStyle = pg;
    const wx = dir > 0 ? 8 : -36;
    rr(ctx, wx, -10, 28, 20, 1); ctx.fill();
    // сетка ячеек 4×3
    ctx.strokeStyle = "rgba(130,180,255,0.6)"; ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(wx + i * 7, -10); ctx.lineTo(wx + i * 7, 10); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(wx, 0); ctx.lineTo(wx + 28, 0); ctx.stroke();
    // обрамление
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.2;
    ctx.strokeRect(wx, -10, 28, 20);
    // блик
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(wx + 4, -8); ctx.lineTo(wx + 14, -8); ctx.lineTo(wx + 2, 8); ctx.lineTo(wx + 2, 0); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function drawReactorItem(ctx, x, by) {
    // ПЛАЗМЕННЫЙ РЕАКТОР — цилиндр с радиаторами и тороидальной камерой
    // высота 86, ширина ~76
    ctx.save(); ctx.translate(x, by);
    // основание
    ctx.fillStyle = "#3a424c"; rr(ctx, -32, -8, 64, 8, 2); ctx.fill();
    // ножки-стойки
    ctx.fillStyle = "#5a6470";
    rr(ctx, -28, -16, 6, 12, 1); ctx.fill();
    rr(ctx, 22, -16, 6, 12, 1); ctx.fill();
    // боковые радиаторы (рёбра охлаждения)
    ctx.fillStyle = "#7a8290";
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        rr(ctx, side * 28 + (side < 0 ? -8 : 0), -68 + i * 14, 12, 4, 1); ctx.fill();
      }
    }
    // главный корпус
    const body = ctx.createLinearGradient(-22, 0, 22, 0);
    body.addColorStop(0, "#3a424c"); body.addColorStop(0.4, "#7a8290"); body.addColorStop(0.7, "#5a6470"); body.addColorStop(1, "#2a3038");
    ctx.fillStyle = body;
    rr(ctx, -22, -72, 44, 60, 6); ctx.fill();
    // полосы-рёбра жёсткости
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-22, -56); ctx.lineTo(22, -56);
    ctx.moveTo(-22, -28); ctx.lineTo(22, -28);
    ctx.stroke();
    // верхняя купольная крышка
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath();
    ctx.moveTo(-22, -72); ctx.quadraticCurveTo(0, -86, 22, -72); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5; ctx.stroke();
    // плазменное окно — тороидальная камера
    const cy = -44;
    const glow = ctx.createRadialGradient(0, cy, 2, 0, cy, 20);
    glow.addColorStop(0, "#fffbe6"); glow.addColorStop(0.3, "#7be0ff"); glow.addColorStop(0.7, "#3a6ad6"); glow.addColorStop(1, "#0a1a3a");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, cy, 18, 0, 7); ctx.fill();
    // обод окна
    ctx.strokeStyle = "#1a2a4a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, cy, 18, 0, 7); ctx.stroke();
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, cy, 16, 0, 7); ctx.stroke();
    // вращающиеся магнитные петли — иллюзия плазмы
    ctx.strokeStyle = "rgba(180,230,255,0.85)"; ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.translate(0, cy); ctx.rotate(G.time * 2.4 + i * Math.PI / 3);
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 5, 0, 0, 7); ctx.stroke();
      ctx.restore();
    }
    // искра-сердцевина
    const pulse = 1 + 0.3 * Math.sin(G.time * 6);
    ctx.fillStyle = "rgba(255,250,200,0.95)";
    ctx.beginPath(); ctx.arc(0, cy, 2.5 * pulse, 0, 7); ctx.fill();
    // экран статуса
    ctx.fillStyle = "#0a1a2a"; rr(ctx, -14, -22, 28, 8, 2); ctx.fill();
    ctx.fillStyle = "#7be0ff"; ctx.font = f(7, "600"); ctx.textAlign = "center";
    ctx.fillText("FUSION", 0, -16); ctx.textAlign = "left";
    ctx.restore();
  }
  function drawSwordItem(ctx, x, by) {
    // меч высотой 96
    ctx.save(); ctx.translate(x, by);
    // навершие
    ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.arc(0, -92, 6, 0, 7); ctx.fill();
    // рукоять
    ctx.fillStyle = "#5a3a1a"; rr(ctx, -4, -88, 8, 18, 2); ctx.fill();
    ctx.strokeStyle = "#caa066"; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-4, -86 + i * 4); ctx.lineTo(4, -84 + i * 4); ctx.stroke(); }
    // крестовина
    ctx.fillStyle = "#caa066"; rr(ctx, -18, -72, 36, 6, 2); ctx.fill();
    ctx.fillStyle = "#8a6a2c"; rr(ctx, -18, -69, 36, 3, 1); ctx.fill();
    // клинок
    const blade = ctx.createLinearGradient(-6, -66, 6, -66);
    blade.addColorStop(0, "#7e8893"); blade.addColorStop(0.5, "#eef2f8"); blade.addColorStop(1, "#7e8893");
    ctx.fillStyle = blade;
    ctx.beginPath();
    ctx.moveTo(-6, -66); ctx.lineTo(6, -66); ctx.lineTo(3, -4); ctx.lineTo(0, 0); ctx.lineTo(-3, -4); ctx.closePath(); ctx.fill();
    // долл клинка
    ctx.strokeStyle = "rgba(60,80,100,0.6)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(0, -10); ctx.stroke();
    ctx.restore();
  }
  function drawScannerItem(ctx, x, by) {
    // СКАНЕР ДРЕВНИХ — тренога + параболическая антенна + детектор
    // высота 92
    ctx.save(); ctx.translate(x, by);
    // тренога
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -44); ctx.lineTo(-20, 0);
    ctx.moveTo(0, -44); ctx.lineTo(20, 0);
    ctx.moveTo(0, -44); ctx.lineTo(0, -2);
    ctx.stroke();
    ctx.fillStyle = "#3a424c";
    for (const fx of [-20, 0, 20]) { rr(ctx, fx - 4, -3, 8, 4, 1); ctx.fill(); }
    // блок-детектор
    const body = ctx.createLinearGradient(-14, -58, 14, -44);
    body.addColorStop(0, "#cfd6dd"); body.addColorStop(1, "#5a6470");
    ctx.fillStyle = body; rr(ctx, -16, -58, 32, 16, 4); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1; ctx.strokeRect(-16, -58, 32, 16);
    // мигающие индикаторы
    const bl = (Math.sin(G.time * 6) + 1) / 2;
    ctx.fillStyle = `rgba(123,224,160,${0.5 + bl * 0.5})`; ctx.beginPath(); ctx.arc(-8, -50, 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#ff8a4a"; ctx.beginPath(); ctx.arc(0, -50, 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(8, -50, 2.5, 0, 7); ctx.fill();
    // штанга к антенне
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(0, -70); ctx.stroke();
    // параболическая тарелка
    ctx.save(); ctx.translate(0, -74); ctx.rotate(-0.3);
    const dish = ctx.createLinearGradient(-24, 0, 24, 0);
    dish.addColorStop(0, "#8a96a6"); dish.addColorStop(0.5, "#eef2f8"); dish.addColorStop(1, "#8a96a6");
    ctx.fillStyle = dish;
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 9, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 1.5; ctx.stroke();
    // вогнутость
    ctx.strokeStyle = "rgba(60,80,100,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 6, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, 7); ctx.stroke();
    // облучатель
    ctx.fillStyle = "#ff8a4a"; ctx.beginPath(); ctx.arc(0, -10, 2.5, 0, 7); ctx.fill();
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  function drawShipPartItem(ctx, x, by) {
    // ДВИГАТЕЛЬ ДРЕВНЕГО КОРАБЛЯ — сопло + плазменная камера (марс-техно)
    // высота 96
    ctx.save(); ctx.translate(x, by);
    // сопло (колокол) внизу
    const noz = ctx.createLinearGradient(-22, -30, 22, -30);
    noz.addColorStop(0, "#3a424c"); noz.addColorStop(0.5, "#9aa3ad"); noz.addColorStop(1, "#3a424c");
    ctx.fillStyle = noz;
    ctx.beginPath();
    ctx.moveTo(-12, -48); ctx.lineTo(12, -48); ctx.lineTo(22, 0); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#1a2026"; ctx.lineWidth = 1.5; ctx.stroke();
    // рёбра сопла
    ctx.strokeStyle = "rgba(40,50,60,0.6)"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const yy = -48 + i * 12, ww = 12 + i * 3.3;
      ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
    }
    // светящееся жерло
    const fire = ctx.createRadialGradient(0, -6, 2, 0, -6, 18);
    fire.addColorStop(0, "#fff6d0"); fire.addColorStop(0.5, "#7be0ff"); fire.addColorStop(1, "rgba(60,120,220,0)");
    ctx.fillStyle = fire; ctx.beginPath(); ctx.ellipse(0, -4, 16, 5, 0, 0, 7); ctx.fill();
    // камера сгорания
    const ch = ctx.createLinearGradient(-16, -86, 16, -48);
    ch.addColorStop(0, "#5a6470"); ch.addColorStop(0.5, "#cfd6dd"); ch.addColorStop(1, "#5a6470");
    ctx.fillStyle = ch; rr(ctx, -16, -84, 32, 38, 6); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.strokeRect(-16, -84, 32, 38);
    // трубопроводы
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-16, -74); ctx.lineTo(-24, -74); ctx.lineTo(-24, -56);
    ctx.moveTo(16, -74); ctx.lineTo(24, -74); ctx.lineTo(24, -56); ctx.stroke();
    // верхний купол
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath(); ctx.moveTo(-16, -84); ctx.quadraticCurveTo(0, -96, 16, -84); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.stroke();
    // ядро-окно с марсианским символом
    const core = ctx.createRadialGradient(0, -64, 2, 0, -64, 12);
    core.addColorStop(0, "#fff0c0"); core.addColorStop(0.5, "#ff8a4a"); core.addColorStop(1, "#7a2a10");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, -64, 10, 0, 7); ctx.fill();
    ctx.strokeStyle = "#3a1a0a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -64, 10, 0, 7); ctx.stroke();
    // вращающиеся орбитали ядра
    ctx.strokeStyle = "rgba(255,200,120,0.8)"; ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      ctx.save(); ctx.translate(0, -64); ctx.rotate(G.time * 3 + i * Math.PI / 2);
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 3.5, 0, 0, 7); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  function drawShipHullItem(ctx, x, by) {
    // КОРПУС КОРАБЛЯ — обтекаемый фюзеляж с иллюминатором (высота 96)
    ctx.save(); ctx.translate(x, by);
    const hull = ctx.createLinearGradient(-26, 0, 26, 0);
    hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(0, -96); ctx.quadraticCurveTo(26, -52, 22, 0);
    ctx.lineTo(-22, 0); ctx.quadraticCurveTo(-26, -52, 0, -96); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 2; ctx.stroke();
    // секционные швы
    ctx.strokeStyle = "rgba(40,50,60,0.5)"; ctx.lineWidth = 1;
    for (const yy of [-66, -34]) { ctx.beginPath(); ctx.moveTo(-20, yy); ctx.lineTo(20, yy); ctx.stroke(); }
    // иллюминатор
    ctx.fillStyle = "#0a1a2a"; ctx.beginPath(); ctx.arc(0, -56, 9, 0, 7); ctx.fill();
    const ig = ctx.createRadialGradient(-2, -58, 1, 0, -56, 9);
    ig.addColorStop(0, "#aae0ff"); ig.addColorStop(1, "#1a4a7a");
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(0, -56, 6.5, 0, 7); ctx.fill();
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -56, 9, 0, 7); ctx.stroke();
    // марсианский глиф
    ctx.fillStyle = "#ff8a4a"; ctx.font = `700 16px ${G.FONT}`; ctx.textAlign = "center"; ctx.fillText("☥", 0, -22); ctx.textAlign = "left";
    // нос-маячок
    const bl = (Math.sin(G.time * 5) + 1) / 2;
    ctx.fillStyle = `rgba(255,90,60,${0.5 + bl * 0.5})`; ctx.beginPath(); ctx.arc(0, -94, 3, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawShipWingsItem(ctx, x, by) {
    // КРЫЛЬЯ/ШАССИ — пара треугольных стабилизаторов с опорами (высота 64)
    ctx.save(); ctx.translate(x, by);
    for (const dir of [-1, 1]) {
      const wg = ctx.createLinearGradient(dir * 6, -50, dir * 34, -10);
      wg.addColorStop(0, "#9aa3ad"); wg.addColorStop(1, "#4a525c");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(dir * 6, -52); ctx.lineTo(dir * 34, -6); ctx.lineTo(dir * 6, -14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.stroke();
      // посадочная опора
      ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(dir * 26, -10); ctx.lineTo(dir * 30, 0); ctx.stroke();
      ctx.fillStyle = "#3a424c"; rr(ctx, dir * 30 - 5, -2, 10, 4, 1); ctx.fill();
      // акцентная полоса
      ctx.strokeStyle = "#ff8a4a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(dir * 10, -44); ctx.lineTo(dir * 26, -14); ctx.stroke();
    }
    // центральная стойка-крепление
    ctx.fillStyle = "#5a6470"; rr(ctx, -5, -52, 10, 46, 2); ctx.fill();
    ctx.restore();
  }

  // ====== Сам принтер ======
  function drawPrinterRig(ctx, s, px, py) {
    const printing = s.data.printing;
    const plate = s.data.plate || 0;
    const platTop = py + 30;
    // основание-постамент
    ctx.fillStyle = "#1a1e24"; rr(ctx, px - 110, py + 40, 220, 18, 4); ctx.fill();
    ctx.fillStyle = "#2b3038"; rr(ctx, px - 100, py + 56, 200, 6, 2); ctx.fill();
    // корпус
    const bodyG = ctx.createLinearGradient(px - 100, py - 130, px + 100, py + 40);
    bodyG.addColorStop(0, "#3a414a"); bodyG.addColorStop(1, "#1f2329");
    ctx.fillStyle = bodyG; rr(ctx, px - 100, py - 130, 200, 170, 12); ctx.fill();
    // стойки гантри
    ctx.fillStyle = "#5a6470"; rr(ctx, px - 96, py - 130, 8, 170, 3); ctx.fill();
    rr(ctx, px + 88, py - 130, 8, 170, 3); ctx.fill();
    // верхняя поперечина (гантри Y)
    ctx.fillStyle = "#6fd0ff"; rr(ctx, px - 92, py - 122, 184, 6, 3); ctx.fill();
    // печатающая головка движется по поперечине
    const nx = px + (s.data.nozzleX || 0) * 56;
    ctx.fillStyle = "#2b3038"; rr(ctx, nx - 18, py - 120, 36, 22, 4); ctx.fill();
    ctx.fillStyle = "#6fd0ff"; rr(ctx, nx - 14, py - 118, 28, 4, 1); ctx.fill();
    // сопло
    ctx.fillStyle = "#cfd6dd";
    ctx.beginPath(); ctx.moveTo(nx - 6, py - 98); ctx.lineTo(nx + 6, py - 98); ctx.lineTo(nx + 3, py - 88); ctx.lineTo(nx - 3, py - 88); ctx.closePath(); ctx.fill();
    // расплав/нить вниз
    if (printing) {
      const itemH = printItemHeight(printing.what);
      const surfaceY = platTop - itemH * plate;
      ctx.strokeStyle = "rgba(255,180,80,0.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(nx, py - 88); ctx.lineTo(nx, surfaceY); ctx.stroke();
      // капля на конце
      ctx.fillStyle = "#ffd17a"; ctx.beginPath(); ctx.arc(nx, surfaceY + 2, 3, 0, 7); ctx.fill();
    }
    // платформа печати — стекло с подсветкой
    ctx.fillStyle = "#3a3f47"; rr(ctx, px - 70, platTop, 140, 14, 3); ctx.fill();
    if (printing) {
      ctx.fillStyle = "rgba(123,224,255,0.25)"; rr(ctx, px - 64, platTop + 2, 128, 4, 2); ctx.fill();
    }
    // печатаемый объект — низ привязан к платформе, рост ВВЕРХ
    if (printing) {
      const itemH = printItemHeight(printing.what);
      const visibleH = itemH * plate;
      ctx.save();
      // клип: рисуем только нижнюю plate-долю предмета
      ctx.beginPath(); ctx.rect(px - 80, platTop - visibleH, 160, visibleH); ctx.clip();
      drawPrintedItem(ctx, printing.what, px, platTop);
      ctx.restore();
      // мерцающий горизонтальный лазер по верхней кромке
      ctx.strokeStyle = `rgba(123,224,255,${0.5 + Math.sin(G.time * 14) * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px - 60, platTop - visibleH); ctx.lineTo(px + 60, platTop - visibleH); ctx.stroke();
    } else {
      // в покое — если ничего ещё не сделано, платформа пустая; готовый предмет показываем коротко через всплеск.
    }
    // экран статуса
    ctx.fillStyle = "#0a2a1a"; rr(ctx, px - 86, py - 100, 172, 32, 5); ctx.fill();
    ctx.strokeStyle = "#2a6a3a"; ctx.lineWidth = 1; ctx.strokeRect(px - 86, py - 100, 172, 32);
    ctx.fillStyle = "#7de08a"; ctx.font = f(13, "600"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let st = "3D-ПРИНТЕР";
    if (printing) st = printingLabel(printing.what) + " " + Math.round(plate * 100) + "%";
    else if (G.state.printerUpgraded) st = "★ МАРС-ТЕХНО ★";
    else if (G.state.hasScannerBlueprint && !G.state.hasScanner) st = "ЧЕРТЁЖ СКАНЕРА";
    else if (!G.state.hasShovel && G.state.minerals >= 3) st = "ГОТОВ • 3 мин";
    else if (G.state.hasBlueprint && !G.state.hasDrill) st = "ЧЕРТЁЖ БУРА";
    else if (G.state.hasBaseBlueprint && !G.state.hasBase) st = "СБОРКА БАЗЫ";
    else if (G.state.hasSwordBlueprint && !G.state.hasSword && !G.state.bossDefeated) st = "ЧЕРТЁЖ МЕЧА";
    else if (G.state.hasBase) st = "БАЗА ОНЛАЙН";
    ctx.fillText(st, px, py - 84); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    // прогресс-бар внизу
    if (printing) {
      ctx.fillStyle = "#1a1e24"; rr(ctx, px - 100, py + 84, 200, 14, 5); ctx.fill();
      ctx.fillStyle = "#7be0ff"; rr(ctx, px - 98, py + 86, 196 * plate, 10, 4); ctx.fill();
    }
    // встроенный древний артефакт-апгрейд (свечение на боку принтера)
    if (G.state.printerUpgraded) {
      const gl = (Math.sin(G.time * 3) + 1) / 2;
      ctx.save(); ctx.translate(px + 80, py - 110);
      const ag = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
      ag.addColorStop(0, `rgba(255,210,120,${0.5 + gl * 0.4})`); ag.addColorStop(1, "rgba(255,160,60,0)");
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
      // сам артефакт-кристалл (мини)
      ctx.fillStyle = "#caa066"; rr(ctx, -8, -10, 16, 20, 3); ctx.fill();
      ctx.strokeStyle = "#fff0c0"; ctx.lineWidth = 1.5; ctx.strokeRect(-8, -10, 16, 20);
      ctx.fillStyle = `rgba(123,224,255,${0.6 + gl * 0.4})`; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  function printingLabel(what) {
    return ({
      shovel: "ЛОПАТА", drill: "БУР", frame: "МОДУЛЬ",
      solar: "БАТАРЕИ", reactor: "РЕАКТОР", sword: "МЕЧ",
      scanner: "СКАНЕР", hull: "КОРПУС", wings: "КРЫЛЬЯ", engine: "ДВИГАТЕЛЬ",
      turret: "ТУРЕЛЬ", fence: "ЗАБОР", printerup: "АПГРЕЙД"
    })[what] || "ПЕЧАТЬ";
  }
  // ====== Площадка сборки базы — рядом с принтером ======
  function drawBaseAssembly(ctx, s, x, baseY) {
    // фундамент-плита (видна всегда)
    const built = G.state.hasBase;
    ctx.fillStyle = built ? "#3a5a4a" : "#2a3038";
    rr(ctx, x - 70, baseY - 4, 140, 10, 2); ctx.fill();
    ctx.strokeStyle = built ? "#7be0a0" : "#5a6470"; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 70, baseY - 4, 140, 10);
    // подпись только пока строим
    if (G.state.hasBaseBlueprint && !built) {
      ctx.fillStyle = "rgba(120,160,200,0.7)"; ctx.font = f(11); ctx.textAlign = "center";
      ctx.fillText("СБОРОЧНАЯ ПЛАТФОРМА", x, baseY + 22); ctx.textAlign = "left";
    }
    // каркас
    if (G.state.hasBaseFrame) drawFrameItem(ctx, x, baseY - 4);
    else if (G.state.hasBaseBlueprint) drawGhostOutline(ctx, x, baseY - 4, 60, 78);
    // солнечная панель — над каркасом, чуть правее
    if (G.state.hasBaseSolar) drawSolarItem(ctx, x + 50, baseY - 4);
    else if (G.state.hasBaseFrame) drawGhostOutline(ctx, x + 50, baseY - 4, 60, 70);
    // реактор — слева, под крышей каркаса
    if (G.state.hasBaseReactor) drawReactorItem(ctx, x - 50, baseY - 4);
    else if (G.state.hasBaseSolar) drawGhostOutline(ctx, x - 50, baseY - 4, 60, 86);
    // светящаяся индикация готовности
    if (built) {
      const gl = (Math.sin(G.time * 3) + 1) / 2;
      ctx.fillStyle = `rgba(123,224,160,${0.15 + gl * 0.15})`;
      ctx.beginPath(); ctx.arc(x, baseY - 30, 90, 0, 7); ctx.fill();
    }
  }
  function drawGhostOutline(ctx, x, by, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(120,160,200,0.4)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(x - w / 2, by - h, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(120,160,200,0.5)"; ctx.font = f(20, "600"); ctx.textAlign = "center";
    ctx.fillText("?", x, by - h / 2 + 6); ctx.textAlign = "left";
    ctx.restore();
  }
  // ====== Стартовая площадка корабля (Глава 4) ======
  function drawShipAssembly(ctx, s, x, baseY) {
    const st = G.state;
    const ready = shipReadyToLaunch();
    // стартовая платформа
    ctx.fillStyle = "#2a3038"; rr(ctx, x - 70, baseY - 4, 140, 12, 2); ctx.fill();
    ctx.fillStyle = "#3a424c"; rr(ctx, x - 60, baseY + 6, 120, 6, 2); ctx.fill();
    // фермы-опоры по бокам
    ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 56, baseY - 4); ctx.lineTo(x - 50, baseY - 120);
    ctx.moveTo(x + 56, baseY - 4); ctx.lineTo(x + 50, baseY - 120);
    ctx.stroke();
    // === собранный корабль (снизу вверх: двигатель → корпус+крылья) ===
    const cx = x, cy = baseY - 6;
    // подпись
    ctx.fillStyle = "rgba(120,160,200,0.7)"; ctx.font = f(11); ctx.textAlign = "center";
    ctx.fillText("СТАРТОВАЯ ПЛОЩАДКА", x, baseY + 26); ctx.textAlign = "left";
    // крылья (шасси) — у основания
    if (st.hasShipWings) drawShipWingsItem(ctx, cx, cy);
    else if (st.hasShipHull) drawGhostOutline(ctx, cx, cy, 70, 60);
    // двигатель — под корпусом
    if (st.hasShipEngine) { ctx.save(); ctx.scale(1, 1); drawShipPartItem(ctx, cx, cy); ctx.restore(); }
    else if (st.hasShipWings) drawGhostOutline(ctx, cx, cy, 50, 90);
    // корпус — сверху (рисуем последним, чуть выше)
    if (st.hasShipHull) drawShipHullItem(ctx, cx, cy - (st.hasShipEngine ? 70 : 0));
    else drawGhostOutline(ctx, cx, cy, 50, 96);
    // топливные баки слева от площадки
    for (let i = 0; i < 2; i++) {
      const tx = x - 86, ty = baseY - 10 - i * 36;
      const filled = st.fuelUnits > i;
      ctx.fillStyle = filled ? "#1a3a4a" : "#22262c"; rr(ctx, tx - 10, ty - 26, 20, 30, 4); ctx.fill();
      ctx.strokeStyle = filled ? "#7be0ff" : "#3a424c"; ctx.lineWidth = 1.5; rr(ctx, tx - 10, ty - 26, 20, 30, 4); ctx.stroke();
      if (filled) {
        const gl = (Math.sin(G.time * 3 + i) + 1) / 2;
        ctx.fillStyle = `rgba(123,224,255,${0.4 + gl * 0.4})`; rr(ctx, tx - 7, ty - 22, 14, 22, 2); ctx.fill();
      }
      ctx.fillStyle = "#7be0ff"; ctx.font = f(9, "600"); ctx.textAlign = "center";
      ctx.fillText("⛽", tx, ty - 8); ctx.textAlign = "left";
    }
    // навигационные карты справа от площадки
    for (let i = 0; i < 2; i++) {
      const mx = x + 86, my = baseY - 12 - i * 30;
      const have = st.navMaps > i;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(-0.1 + i * 0.2);
      ctx.fillStyle = have ? "#3a2410" : "#22262c"; rr(ctx, -12, -16, 24, 18, 2); ctx.fill();
      ctx.strokeStyle = have ? "#ff8a4a" : "#3a424c"; ctx.lineWidth = 1.2; rr(ctx, -12, -16, 24, 18, 2); ctx.stroke();
      if (have) {
        ctx.strokeStyle = "rgba(255,180,120,0.7)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(6, -6); ctx.lineTo(-4, 0); ctx.stroke();
        ctx.fillStyle = "#ff8a4a"; ctx.beginPath(); ctx.arc(4, -4, 1.5, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    // готов к запуску — пульсирующее свечение + дымка
    if (ready) {
      const gl = (Math.sin(G.time * 4) + 1) / 2;
      ctx.fillStyle = `rgba(255,200,120,${0.12 + gl * 0.15})`;
      ctx.beginPath(); ctx.arc(cx, cy - 60, 110, 0, 7); ctx.fill();
      // пар у дюз
      ctx.fillStyle = "rgba(200,220,240,0.25)";
      for (let i = 0; i < 5; i++) {
        const a = G.time * 2 + i;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 30, cy + 8 + Math.sin(a) * 4, 8 + i * 2, 0, 7); ctx.fill();
      }
      ctx.fillStyle = "#ffe14a"; ctx.font = f(13, "800"); ctx.textAlign = "center";
      ctx.fillText("К ЗАПУСКУ ГОТОВ", cx, baseY - 150); ctx.textAlign = "left";
    }
  }

  /* =========================================================================
     ГЛАВА 2: чертёж базы → шахты с мутантами → база → меч → колизей
     ========================================================================= */

  // -- Чертёж базы на пьедестале --
  G.addScene("base_blueprint", makeRoom({
    name: "base_blueprint", dayValue: 102,
    start: { x: 120, y: 410 },
    narr: () => G.state.hasBaseBlueprint
      ? "Чертёж базы у вас. Идите к 3D-принтеру и добудьте 2 супер-минерала в шахтах."
      : "На пьедестале лежит светящийся чертёж — это база! Подойдите и заберите его.",
    build(s) {
      const px = VIEW.w / 2, py = s.bounds.y + s.bounds.h / 2;
      s.data.px = px; s.data.py = py;
      s.obstacles.push({ x: px - 44, y: py - 30, w: 88, h: 80 });
      s.interactables.push({
        x: px, y: py, r: 110, label: "Взять чертёж 🏠",
        ready: () => !G.state.hasBaseBlueprint,
        act(sc) {
          G.state.hasBaseBlueprint = true; G.audio.pickup();
          G.fx.burst(px, py - 60, "#7be0ff", 36, 240, 1.0);
          G.go("cutscene_base_blueprint");
        }
      });
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: "← Назад", to: "printer", ready: () => G.state.hasBaseBlueprint };
    },
    drawProps(s, ctx) {
      const px = s.data.px, py = s.data.py;
      // Пьедестал базы
      ctx.fillStyle = "#3a2c22"; rr(ctx, px - 60, py + 56, 120, 16, 3); ctx.fill();
      ctx.fillStyle = "#5a4636"; rr(ctx, px - 58, py + 50, 116, 8, 3); ctx.fill();
      ctx.fillStyle = "#6a5a44"; rr(ctx, px - 52, py + 40, 104, 14, 4); ctx.fill();
      const cg = ctx.createLinearGradient(px - 44, 0, px + 44, 0);
      cg.addColorStop(0, "#3a2c22"); cg.addColorStop(0.5, "#6a5a44"); cg.addColorStop(1, "#3a2c22");
      ctx.fillStyle = cg; rr(ctx, px - 44, py - 4, 88, 50, 4); ctx.fill();
      // Резная пиктограмма «дом» на колонне
      ctx.strokeStyle = "rgba(220,180,120,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 12, py + 30); ctx.lineTo(px - 12, py + 18); ctx.lineTo(px, py + 8); ctx.lineTo(px + 12, py + 18); ctx.lineTo(px + 12, py + 30); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "#5a4636"; rr(ctx, px - 50, py - 12, 100, 14, 3); ctx.fill();
      ctx.fillStyle = "#6a5a44"; rr(ctx, px - 50, py - 12, 100, 4, 1); ctx.fill();
      if (!G.state.hasBaseBlueprint) {
        const fy = py - 50 + Math.sin(G.time * 2) * 6;
        const gl = (Math.sin(G.time * 3) + 1) / 2;
        ctx.fillStyle = `rgba(120,200,255,${0.3 + gl * 0.4})`;
        ctx.beginPath(); ctx.arc(px, fy, 36, 0, 7); ctx.fill();
        // синий чертёж
        ctx.save(); ctx.translate(px, fy);
        ctx.fillStyle = "#1f5fae"; rr(ctx, -28, -18, 56, 36, 4); ctx.fill();
        ctx.strokeStyle = "#8fc2ff"; ctx.lineWidth = 2; ctx.strokeRect(-22, -12, 44, 24);
        // мини-домик внутри
        ctx.strokeStyle = "#bfe0ff"; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-10, 6); ctx.lineTo(-10, -4); ctx.lineTo(0, -10); ctx.lineTo(10, -4); ctx.lineTo(10, 6); ctx.stroke();
        ctx.strokeRect(-3, 0, 6, 6);
        ctx.fillStyle = "#bfe0ff"; ctx.font = f(10); ctx.textAlign = "center";
        ctx.fillText("БАЗА", 0, 16); ctx.textAlign = "left";
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = f(15); ctx.textAlign = "center";
        ctx.fillText("(пусто)", px, py - 30); ctx.textAlign = "left";
      }
    },
  }));

  /* =========================================================================
     КАРТА МАРСА — стратегический вид сверху после постройки базы.
     Процедурные шахты (?), туман войны; сканер раскрывает всё.
     ========================================================================= */
  G.addScene("mars_map", {
    recharge: false, useJoystick: false,
    enter() {
      this.back = { x: 36, y: 34, w: 180, h: 48, text: "← К базе", fs: 20 };
      // Один раз генерируем шахты вокруг базы (случайные позиции)
      if (!G.state.mapSites || !G.state.mapSites.length) {
        const sites = [], bx = VIEW.w / 2, by = VIEW.h / 2 + 30;
        const kinds = ["super", "wonder", "zcrystal", "fuel", "navchip"];
        for (let i = 0; i < 6; i++) {
          let x, y, ok = false, tries = 0;
          while (!ok && tries < 80) {
            const a = Math.random() * Math.PI * 2, r = 170 + Math.random() * 240;
            x = bx + Math.cos(a) * r * 1.25; y = by + Math.sin(a) * r * 0.7;
            ok = x > 130 && x < VIEW.w - 130 && y > 150 && y < VIEW.h - 120 && Math.hypot(x - bx, y - by) > 150;
            for (const s of sites) if (Math.hypot(s.x - x, s.y - y) < 150) ok = false;
            tries++;
          }
          sites.push({ x, y, explored: false, id: i, kind: kinds[i % kinds.length] });
        }
        G.state.mapSites = sites;
      }
      // Древние артефакты — 3 случайных типа в случайных точках (один раз)
      if (!G.state.mapArtifacts || !G.state.mapArtifacts.length) {
        const pool = Object.keys(ARTIFACTS).slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const arts = [], bx = VIEW.w / 2, by = VIEW.h / 2 + 30, sites = G.state.mapSites;
        for (let i = 0; i < 3; i++) {
          let x, y, ok = false, tries = 0;
          while (!ok && tries < 80) {
            const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 250;
            x = bx + Math.cos(a) * r * 1.25; y = by + Math.sin(a) * r * 0.7;
            ok = x > 120 && x < VIEW.w - 120 && y > 150 && y < VIEW.h - 120 && Math.hypot(x - bx, y - by) > 130;
            for (const s of sites) if (Math.hypot(s.x - x, s.y - y) < 110) ok = false;
            for (const s of arts) if (Math.hypot(s.x - x, s.y - y) < 130) ok = false;
            tries++;
          }
          arts.push({ x, y, kind: pool[i], collected: false, id: i, trial: ["lock", "memory", "guard"][Math.floor(Math.random() * 3)] });
        }
        G.state.mapArtifacts = arts;
      }
      this.sites = G.state.mapSites;
      this.artifacts = G.state.mapArtifacts;
      this.bx = VIEW.w / 2; this.by = VIEW.h / 2 + 30;
      this._M = { x: 58, y: 116, w: VIEW.w - 116, h: VIEW.h - 188 };
      // ровер: позиция сохраняется между визитами
      if (G.state.roverX == null) { G.state.roverX = this.bx; G.state.roverY = this.by + 46; }
      this.rover = { x: G.state.roverX, y: G.state.roverY };
      this._lastBeacon = { x: this.rover.x, y: this.rover.y };
      // исследованная территория (маяки тумана) — база всегда открыта
      if (!G.state.mapExplored.length) G.state.mapExplored = [{ x: this.bx, y: this.by }, { x: this.rover.x, y: this.rover.y }];
      this.explored = G.state.mapExplored;
      this.travel = null; this.banner = null; this.msgT = 0;
      // нападение / события
      this.attackers = []; this.spawnQ = []; this.spawnT = 0; this.attackActive = false;
      this.turretCd = []; this.turretBeams = [];
      this.weather = null; this.dust = null;
      this.event = G.state.mapEvent; // активное событие карты сохраняется до сбора
      if (G.state.hasBase) {
        G.state.baseThreat = clamp((G.state.baseThreat || 0) + 0.16 + Math.random() * 0.12, 0, 1.2);
        if (G.state.baseThreat >= 1) {
          G.state.baseThreat = 0;
          const n = 3 + Math.floor(Math.random() * 3), kinds = ["grunt", "scout", "drone", "brute"];
          for (let i = 0; i < n; i++) this.spawnQ.push(kinds[Math.floor(Math.random() * kinds.length)]);
          this.spawnT = 0.3; this.attackActive = true;
          this.banner = "🚨 НАПАДЕНИЕ на базу!"; this.msgT = 3;
          G.audio.tone(140, 0.3, "sawtooth", 0.08);
        } else {
          const roll = Math.random();
          if (roll < 0.22) {
            // КАТАКЛИЗМ: пылевая буря или молниевый шторм — урон базе
            const storm = Math.random() < 0.5;
            const dmg = storm ? 22 + Math.floor(Math.random() * 12) : 12 + Math.floor(Math.random() * 8);
            G.state.baseHP = clamp((G.state.baseHP || 100) - dmg, 0, 100);
            this.weather = { type: storm ? "storm" : "dust", t: 5 };
            this.dust = []; for (let i = 0; i < 120; i++) this.dust.push({ x: Math.random() * VIEW.w, y: Math.random() * VIEW.h, v: 200 + Math.random() * 320, r: 1 + Math.random() * 2 });
            this.banner = `${storm ? "⚡ МОЛНИЕВЫЙ ШТОРМ" : "🌪 ПЫЛЕВАЯ БУРЯ"}! База −${dmg} HP. Почините в управлении базой.`; this.msgT = 5;
            G.audio.tone(storm ? 90 : 130, 0.4, "sawtooth", 0.08);
          } else if (!this.event && roll < 0.34) {
            // МЕТЕОРИТ — упал ресурс
            const M = this._M, mx = M.x + 80 + Math.random() * (M.w - 160), my = M.y + 70 + Math.random() * (M.h - 140);
            this.event = G.state.mapEvent = { kind: "meteor", x: mx, y: my };
            this.banner = "☄ Метеорит упал! Доберитесь — там супер-минералы."; this.msgT = 5; G.audio.boom();
          } else if (!this.event && roll < 0.42) {
            // СИГНАЛ БЕДСТВИЯ — спасти робота-союзника
            const M = this._M, mx = M.x + 80 + Math.random() * (M.w - 160), my = M.y + 70 + Math.random() * (M.h - 140);
            this.event = G.state.mapEvent = { kind: "distress", x: mx, y: my };
            this.banner = "📡 Сигнал бедствия! Спасите робота — будет награда."; this.msgT = 5; G.audio.tone(700, 0.2, "sine", 0.05);
          }
        }
      }
      // первый вход — подсказка по карте (не перекрываем тревоги/события)
      if (!G.state._tutMap) { G.state._tutMap = true; if (!this.banner) { this.banner = "Тапай по карте — ровер едет туда. Радар открывает только объезженное. Шахты ⛏ — добыча, база 🛰 — апгрейды, аномалии ✦ — реликвии."; this.msgT = 9; } }
    },
    addBeacon() {
      const x = this.rover.x, y = this.rover.y;
      for (const b of this.explored) if (Math.hypot(b.x - x, b.y - y) < 42) { this._lastBeacon = { x, y }; return; }
      this.explored.push({ x, y });
      if (this.explored.length > 60) this.explored.splice(1, 1);
      this._lastBeacon = { x, y }; G.state.mapExplored = this.explored;
    },
    travelTo(tx, ty, action) {
      const M = this._M;
      this.travel = { tx: clamp(tx, M.x + 16, M.x + M.w - 16), ty: clamp(ty, M.y + 16, M.y + M.h - 16), action };
      G.audio.blip();
    },
    breakthrough() {
      this.attackActive = false; G.state._baseAttack = true;
      this.banner = "⚔ Мутанты прорвались! В бой!"; this.msgT = 2;
      G.go("base_defense");
    },
    update(dt) {
      const sc = this;
      if (sc.msgT > 0) sc.msgT -= dt;
      // === КАТАКЛИЗМ: визуал бури ===
      if (sc.weather) {
        sc.weather.t -= dt; if (sc.weather.t <= 0) sc.weather = null;
        else if (sc.dust) for (const p of sc.dust) { p.x -= p.v * dt; if (p.x < 0) { p.x = VIEW.w; p.y = Math.random() * VIEW.h; } }
      }
      // === ПЕРЕДВИЖЕНИЕ РОВЕРА (Fallout-style travel) ===
      if (sc.travel) {
        const dx = sc.travel.tx - sc.rover.x, dy = sc.travel.ty - sc.rover.y, d = Math.hypot(dx, dy), sp = 165;
        if (d < sp * dt + 2) {
          sc.rover.x = sc.travel.tx; sc.rover.y = sc.travel.ty; sc.addBeacon();
          const act = sc.travel.action; sc.travel = null; if (act) act();
        } else {
          sc.rover.x += dx / d * sp * dt; sc.rover.y += dy / d * sp * dt;
          if (Math.hypot(sc.rover.x - sc._lastBeacon.x, sc.rover.y - sc._lastBeacon.y) > 34) sc.addBeacon();
        }
        G.state.roverX = sc.rover.x; G.state.roverY = sc.rover.y;
      }
      // === ЖИВОЕ НАПАДЕНИЕ: спавн → турели → движение к базе ===
      if (sc.attackActive) {
        if (sc.spawnQ.length) {
          sc.spawnT -= dt;
          if (sc.spawnT <= 0) {
            sc.spawnT = 0.45 + Math.random() * 0.4;
            const kind = sc.spawnQ.shift(), M = sc._M, edge = Math.floor(Math.random() * 4); let x, y;
            if (edge === 0) { x = M.x + 8; y = M.y + 20 + Math.random() * (M.h - 40); }
            else if (edge === 1) { x = M.x + M.w - 8; y = M.y + 20 + Math.random() * (M.h - 40); }
            else if (edge === 2) { x = M.x + 20 + Math.random() * (M.w - 40); y = M.y + 8; }
            else { x = M.x + 20 + Math.random() * (M.w - 40); y = M.y + M.h - 8; }
            const K = MUTANT_KINDS[kind] || MUTANT_KINDS.grunt;
            sc.attackers.push({ x, y, kind, hp: K.hp, maxHp: K.hp, hit: 0 });
          }
        }
        // турели стреляют
        const tpos = [];
        for (let i = 0; i < G.state.baseTurrets; i++) { const a = (Math.PI * 2 / 3) * i - Math.PI / 2; tpos.push({ x: sc.bx + Math.cos(a) * 30, y: sc.by + Math.sin(a) * 30 }); }
        while (sc.turretCd.length < tpos.length) sc.turretCd.push(0);
        for (let i = sc.turretBeams.length - 1; i >= 0; i--) { sc.turretBeams[i].t -= dt; if (sc.turretBeams[i].t <= 0) sc.turretBeams.splice(i, 1); }
        tpos.forEach((tp, i) => {
          sc.turretCd[i] -= dt;
          if (sc.turretCd[i] <= 0 && sc.attackers.length) {
            let best = null, bd = 210; for (const m of sc.attackers) { const dd = Math.hypot(m.x - tp.x, m.y - tp.y); if (dd < bd) { bd = dd; best = m; } }
            if (best) { best.hp -= 1; best.hit = 0.2; sc.turretCd[i] = 0.6; sc.turretBeams.push({ x1: tp.x, y1: tp.y, x2: best.x, y2: best.y, t: 0.14 }); G.audio.tone(600, 0.04, "square", 0.03); if (best.hp <= 0) G.fx.burst(best.x, best.y, "#9ce06a", 12, 140, 0.5); }
          }
        });
        // мутанты идут к базе (забор тормозит)
        const fenceR = G.state.baseFence > 0 ? 46 + G.state.baseFence * 4 : 0, fenceSlow = G.state.baseFence >= 2 ? 0.45 : 0.65;
        for (let i = sc.attackers.length - 1; i >= 0; i--) {
          const m = sc.attackers[i];
          if (m.hit > 0) m.hit -= dt;
          if (m.hp <= 0) { sc.attackers.splice(i, 1); continue; }
          const dx = sc.bx - m.x, dy = sc.by - m.y, d = Math.hypot(dx, dy) || 1;
          if (d < 36) { sc.breakthrough(); return; }
          const slow = (fenceR && Math.abs(d - fenceR) < 20) ? fenceSlow : 1;
          const sp = MUTANT_KINDS[m.kind].chase * 0.5 * slow;
          m.x += dx / d * sp * dt; m.y += dy / d * sp * dt;
        }
        if (!sc.spawnQ.length && !sc.attackers.length) { sc.attackActive = false; sc.banner = "🛡 Нападение отбито обороной базы!"; sc.msgT = 4; G.audio.win(); }
      }
    },
    onTap(x, y) {
      if (rectHit(this.back, x, y)) { G.audio.blip(); G.go("printer"); return; }
      if (this.travel) return; // едем — ждём прибытия
      // база → доехать и открыть управление
      if (Math.hypot(x - this.bx, y - this.by) < 50) { this.travelTo(this.bx, this.by + 46, () => G.go("base_manage")); return; }
      // событие карты (метеорит/сигнал) → доехать и забрать
      if (this.event && Math.hypot(this.event.x - x, this.event.y - y) < 40) {
        const ev = this.event;
        this.travelTo(ev.x, ev.y + 24, () => {
          if (ev.kind === "meteor") { G.state.superMinerals += 2; this.banner = "☄ Собрано: +2 супер-минерала!"; }
          else { G.state.superMinerals += 1; G.state.baseHP = clamp((G.state.baseHP || 100) + 25, 0, 100); this.banner = "📡 Робот спасён! +1 супер-минерал, +25 HP базе."; }
          this.msgT = 5; G.audio.win(); G.fx.burst(ev.x, ev.y, ev.kind === "meteor" ? "#ffb070" : "#7be0ff", 30, 240, 1.1);
          this.event = null; G.state.mapEvent = null;
        });
        return;
      }
      // видимый артефакт → доехать и забрать
      for (const ar of this.artifacts) {
        if (!ar.collected && isExploredPt(this, ar.x, ar.y) && Math.hypot(ar.x - x, ar.y - y) < 40) {
          this.travelTo(ar.x, ar.y + 28, () => { G.state._activeArtifact = ar.id; G.go("artifact_trial"); });
          return;
        }
      }
      // видимая шахта → доехать и спуститься
      for (const st of this.sites) {
        if (isExploredPt(this, st.x, st.y) && Math.hypot(st.x - x, st.y - y) < 46) {
          this.travelTo(st.x, st.y + 28, () => { st.explored = true; G.go("drill_site"); });
          return;
        }
      }
      // пустое место → просто едем туда (разведка тумана)
      this.travelTo(x, y, null);
    },
    draw(ctx) { drawMarsMap(ctx, this); },
  });
  function isExploredPt(sc, x, y) {
    if (G.state.artMapReveal) return true; // артефакт-картограф раскрывает всё
    for (const b of sc.explored) if (Math.hypot(b.x - x, b.y - y) < 92) return true;
    return false;
  }
  function drawMapRover(ctx, x, y, moving) {
    const t = G.time;
    ctx.save(); ctx.translate(x, y);
    // ореол-подсветка
    ctx.fillStyle = "rgba(123,224,160,0.18)"; ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.fill();
    // колёса
    ctx.fillStyle = "#1a1e24";
    for (const wx of [-9, 9]) for (const wy of [-6, 6]) { rr(ctx, wx - 3, wy - 2, 6, 4, 1); ctx.fill(); }
    // корпус
    const g = ctx.createLinearGradient(0, -8, 0, 8); g.addColorStop(0, "#dfe6ee"); g.addColorStop(1, "#7a8694");
    ctx.fillStyle = g; rr(ctx, -10, -7, 20, 14, 4); ctx.fill();
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.2; rr(ctx, -10, -7, 20, 14, 4); ctx.stroke();
    // глаз-объектив
    ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill();
    // антенна-маячок
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, -12); ctx.stroke();
    ctx.fillStyle = `rgba(255,90,60,${0.5 + 0.5 * Math.sin(t * 6)})`; ctx.beginPath(); ctx.arc(0, -12, 1.6, 0, 7); ctx.fill();
    // пыль при движении
    if (moving) { ctx.fillStyle = "rgba(180,140,100,0.3)"; for (let i = 0; i < 3; i++) ctx.fillRect(-12 - i * 3, 4 + (i % 2) * 3, 3, 2); }
    ctx.restore();
  }
  function hexPathMap(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
  }
  function drawMarsMap(ctx, sc) {
    const sites = sc.sites, bx = sc.bx, by = sc.by, scan = G.state.hasScanner, t = G.time;
    const AMB = "255,176,92";   // янтарный HUD
    const M = sc._M;
    // фон вне планшета — глубокий космос
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    bg.addColorStop(0, "#140a08"); bg.addColorStop(1, "#0a0604"); ctx.fillStyle = bg; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    starfield(ctx, 50, 11);

    // === содержимое планшета (клип) ===
    ctx.save(); rr(ctx, M.x, M.y, M.w, M.h, 14); ctx.clip();
    // марсианская поверхность
    const g = ctx.createRadialGradient(bx, by, 40, bx, by, 560);
    g.addColorStop(0, "#7a3a1e"); g.addColorStop(0.6, "#5a2a16"); g.addColorStop(1, "#2a1409");
    ctx.fillStyle = g; ctx.fillRect(M.x, M.y, M.w, M.h);
    // кратеры
    for (let i = 0; i < 34; i++) {
      const cx = M.x + (i * 197.3) % M.w, cy = M.y + (i * 113.7) % M.h, r = 7 + (i % 5) * 6;
      ctx.fillStyle = "rgba(30,14,8,0.45)"; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(160,96,54,0.10)"; ctx.beginPath(); ctx.ellipse(cx - 2, cy - 2, r * 0.7, r * 0.5, 0, 0, 7); ctx.fill();
    }
    // тактическая сетка
    ctx.strokeStyle = `rgba(${AMB},0.10)`; ctx.lineWidth = 1;
    for (let gx = M.x; gx < M.x + M.w; gx += 46) { ctx.beginPath(); ctx.moveTo(gx, M.y); ctx.lineTo(gx, M.y + M.h); ctx.stroke(); }
    for (let gy = M.y; gy < M.y + M.h; gy += 46) { ctx.beginPath(); ctx.moveTo(M.x, gy); ctx.lineTo(M.x + M.w, gy); ctx.stroke(); }
    // дальностные кольца от базы
    ctx.strokeStyle = `rgba(${AMB},0.18)`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 7]);
    for (const rr2 of [95, 175, 255]) { ctx.beginPath(); ctx.arc(bx, by, rr2, 0, 7); ctx.stroke(); }
    ctx.setLineDash([]);
    // радар-развёртка (вращается от базы)
    const sweep = (t * 0.6) % (Math.PI * 2);
    ctx.save(); ctx.translate(bx, by);
    for (let k = 0; k < 8; k++) {
      const a = sweep - k * 0.05;
      ctx.strokeStyle = `rgba(${scan ? "123,224,255" : AMB},${(0.16 - k * 0.018).toFixed(3)})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 300, Math.sin(a) * 300); ctx.stroke();
    }
    ctx.restore();
    // линия маршрута ровера
    if (sc.travel) {
      ctx.strokeStyle = `rgba(${AMB},0.6)`; ctx.lineWidth = 2; ctx.setLineDash([5, 6]); ctx.lineDashOffset = -t * 24;
      ctx.beginPath(); ctx.moveTo(sc.rover.x, sc.rover.y); ctx.lineTo(sc.travel.tx, sc.travel.ty); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const mp = (Math.sin(t * 8) + 1) / 2;
      ctx.strokeStyle = `rgba(${AMB},${0.5 + mp * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sc.travel.tx, sc.travel.ty, 8 + mp * 4, 0, 7); ctx.stroke();
    }
    // ШАХТЫ — только на исследованной территории; радар (сканер) типизирует руду
    for (const st of sites) if (isExploredPt(sc, st.x, st.y)) drawMapShaft(ctx, st, scan, AMB);
    drawMapBase(ctx, bx, by);
    // ровер
    drawMapRover(ctx, sc.rover.x, sc.rover.y, !!sc.travel);
    // === ТУМАН ВОЙНЫ — из маяков исследованной территории ===
    const centers = [{ x: bx, y: by, r: 150 }];
    for (const b of sc.explored) centers.push({ x: b.x, y: b.y, r: 92 });
    const maxFog = G.state.artMapReveal ? 0.12 : 0.85, cell = 32;
    for (let gx = M.x; gx < M.x + M.w; gx += cell) {
      for (let gy = M.y; gy < M.y + M.h; gy += cell) {
        let nd = 1e9; const ccx = gx + cell / 2, ccy = gy + cell / 2;
        for (const c of centers) { const d = Math.hypot(ccx - c.x, ccy - c.y) - c.r; if (d < nd) nd = d; if (nd < -20) break; }
        const a = clamp(nd / 120, 0, 1) * maxFog;
        if (a > 0.02) { ctx.fillStyle = `rgba(6,10,16,${a.toFixed(3)})`; ctx.fillRect(gx, gy, cell + 1, cell + 1); }
      }
    }
    // ДРЕВНИЕ АРТЕФАКТЫ — видны на изученной земле, но радар НЕ раскрывает их тип
    if (sc.artifacts) for (const ar of sc.artifacts) if (ar.collected || isExploredPt(sc, ar.x, ar.y)) drawMapArtifact(ctx, ar, false);
    // внутренняя виньетка
    const vg = ctx.createRadialGradient(bx, by, M.h * 0.3, bx, by, M.h * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg; ctx.fillRect(M.x, M.y, M.w, M.h);
    // нападающие + лучи турелей — ПОВЕРХ тумана (база засекает их радаром)
    for (const be of (sc.turretBeams || [])) { ctx.strokeStyle = `rgba(255,220,120,${be.t / 0.14})`; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(be.x1, be.y1); ctx.lineTo(be.x2, be.y2); ctx.stroke(); }
    for (const m of sc.attackers) drawMapAttacker(ctx, m);
    // событие карты (метеорит/сигнал) — сигнал пробивается сквозь туман
    if (sc.event) drawMapEvent(ctx, sc.event);
    // === ПОГОДНЫЙ КАТАКЛИЗМ ===
    if (sc.weather) {
      if (sc.weather.type === "dust") {
        ctx.fillStyle = "rgba(150,100,50,0.28)"; ctx.fillRect(M.x, M.y, M.w, M.h);
        ctx.fillStyle = "rgba(210,170,110,0.5)";
        for (const p of (sc.dust || [])) ctx.fillRect(p.x, p.y, p.r * 3, p.r);
      } else { // молниевый шторм
        ctx.fillStyle = "rgba(20,20,40,0.4)"; ctx.fillRect(M.x, M.y, M.w, M.h);
        if (Math.sin(t * 13) > 0.85 || Math.sin(t * 7.3) > 0.9) {
          ctx.fillStyle = "rgba(200,220,255,0.25)"; ctx.fillRect(M.x, M.y, M.w, M.h);
          // молния-зигзаг
          ctx.strokeStyle = "rgba(220,235,255,0.9)"; ctx.lineWidth = 2;
          const lx = M.x + 100 + (t * 137 % (M.w - 200)); ctx.beginPath(); ctx.moveTo(lx, M.y);
          for (let yy = M.y; yy < M.y + M.h; yy += 30) ctx.lineTo(lx + (Math.sin(yy + t * 50) * 18), yy);
          ctx.stroke();
        }
      }
    }
    // тревожная рамка при нападении / буре
    if (sc.attackActive || sc.weather) { const pa = (Math.sin(t * 6) + 1) / 2; const col = sc.attackActive ? "255,60,40" : "180,200,255"; ctx.strokeStyle = `rgba(${col},${0.3 + pa * 0.4})`; ctx.lineWidth = 6; rr(ctx, M.x, M.y, M.w, M.h, 14); ctx.stroke(); }
    ctx.restore(); // конец клипа

    // === HUD-хром поверх планшета ===
    // двойная рамка
    ctx.strokeStyle = `rgba(${AMB},0.5)`; ctx.lineWidth = 2; rr(ctx, M.x, M.y, M.w, M.h, 14); ctx.stroke();
    ctx.strokeStyle = `rgba(${AMB},0.2)`; ctx.lineWidth = 1; rr(ctx, M.x + 5, M.y + 5, M.w - 10, M.h - 10, 11); ctx.stroke();
    // уголки-скобки
    ctx.strokeStyle = `rgba(${AMB},0.9)`; ctx.lineWidth = 3; const cl = 26;
    for (const [cx, cy, sx, sy] of [[M.x, M.y, 1, 1], [M.x + M.w, M.y, -1, 1], [M.x, M.y + M.h, 1, -1], [M.x + M.w, M.y + M.h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * cl, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * cl); ctx.stroke();
    }
    // координатные тики по верхней и левой кромке
    ctx.fillStyle = `rgba(${AMB},0.5)`; ctx.font = f(9, "600"); ctx.textAlign = "center";
    for (let i = 1; i * 92 < M.w; i++) { const gx = M.x + i * 92; ctx.fillRect(gx, M.y, 1, 6); ctx.fillText((i * 12).toString(), gx, M.y + 16); }
    ctx.textAlign = "left";
    for (let i = 1; i * 80 < M.h; i++) { const gy = M.y + i * 80; ctx.fillRect(M.x, gy, 6, 1); ctx.fillText(String.fromCharCode(64 + i), M.x + 9, gy + 3); }
    // компас (правый верх планшета)
    const cmx = M.x + M.w - 34, cmy = M.y + 34;
    ctx.strokeStyle = `rgba(${AMB},0.6)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cmx, cmy, 16, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgba(${AMB},0.95)`; ctx.beginPath(); ctx.moveTo(cmx, cmy - 13); ctx.lineTo(cmx - 5, cmy + 2); ctx.lineTo(cmx + 5, cmy + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(120,140,160,0.7)"; ctx.beginPath(); ctx.moveTo(cmx, cmy + 13); ctx.lineTo(cmx - 5, cmy - 2); ctx.lineTo(cmx + 5, cmy - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffd9a0"; ctx.font = f(9, "700"); ctx.textAlign = "center"; ctx.fillText("С", cmx, cmy - 19); ctx.textAlign = "left";
    // легенда (левый низ планшета)
    const lx = M.x + 14, ly = M.y + M.h - 22;
    ctx.fillStyle = "rgba(8,6,4,0.5)"; rr(ctx, lx - 6, ly - 16, 300, 26, 6); ctx.fill();
    ctx.font = f(12, "600"); ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${AMB},0.95)`; ctx.fillText("?", lx + 2, ly - 2); ctx.fillStyle = "rgba(230,210,180,0.8)"; ctx.fillText("шахта", lx + 14, ly - 2);
    ctx.fillStyle = "#caa0ff"; ctx.fillText("◆", lx + 92, ly - 2); ctx.fillStyle = "rgba(230,210,180,0.8)"; ctx.fillText("руда", lx + 108, ly - 2);
    ctx.fillStyle = "#ffd17a"; ctx.fillText("✦", lx + 168, ly - 2); ctx.fillStyle = "rgba(230,210,180,0.8)"; ctx.fillText("аномалия", lx + 184, ly - 2);
    ctx.textBaseline = "alphabetic";

    // заголовок-плашка HUD
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,7,4,0.7)"; rr(ctx, VIEW.w / 2 - 250, 26, 500, 62, 12); ctx.fill();
    ctx.strokeStyle = `rgba(${AMB},0.4)`; ctx.lineWidth = 1.5; rr(ctx, VIEW.w / 2 - 250, 26, 500, 62, 12); ctx.stroke();
    const blink = (Math.sin(t * 4) + 1) / 2;
    ctx.fillStyle = `rgba(${scan ? "123,224,160" : "255,120,80"},${0.5 + blink * 0.5})`; ctx.beginPath(); ctx.arc(VIEW.w / 2 - 200, 50, 5, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd9a0"; ctx.font = f(28, "800"); ctx.fillText("КАРТА МАРСА", VIEW.w / 2, 58);
    ctx.fillStyle = `rgba(${AMB},0.8)`; ctx.font = f(13, "600");
    ctx.fillText(sc.travel ? "▸ Ровер в пути…" : (scan ? "◉ Радар активен — руда видна на изученной земле" : "◌ Тапайте, чтобы ехать. Туман открывается по пути."), VIEW.w / 2, 78);
    ctx.textAlign = "left";
    G.button(ctx, sc.back, false);
    // счётчик врагов при нападении
    if (sc.attackActive) {
      ctx.fillStyle = "rgba(40,8,6,0.85)"; rr(ctx, VIEW.w - 220, 30, 190, 34, 8); ctx.fill();
      ctx.strokeStyle = "#ff5a3a"; ctx.lineWidth = 1.5; rr(ctx, VIEW.w - 220, 30, 190, 34, 8); ctx.stroke();
      ctx.fillStyle = "#ff8a6a"; ctx.font = f(15, "800"); ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`🚨 Враги: ${sc.attackers.length + sc.spawnQ.length}`, VIEW.w - 208, 47);
      ctx.textBaseline = "alphabetic";
    }
    // === баннер событий (нападение / отбито / артефакт / подсказка) — с переносом ===
    if (sc.banner && sc.msgT > 0) {
      const danger = /НАПАДЕНИЕ|прорв|БУРЯ|ШТОРМ/.test(sc.banner);
      ctx.globalAlpha = Math.min(1, sc.msgT);
      ctx.font = f(16, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const maxW = 760, words = sc.banner.split(" "), lines = []; let line = "";
      for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line);
      let tw = 0; for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
      const lh = 22, padX = 22, padY = 12;
      const bw = Math.min(VIEW.w - 30, tw + padX * 2), bh = lines.length * lh + padY * 2 - 4;
      const bx = VIEW.w / 2 - bw / 2, by = VIEW.h - 22 - bh;
      ctx.fillStyle = danger ? "rgba(40,8,6,0.92)" : "rgba(10,30,16,0.9)"; rr(ctx, bx, by, bw, bh, 10); ctx.fill();
      ctx.strokeStyle = danger ? "#ff5a3a" : "#7de08a"; ctx.lineWidth = 2; rr(ctx, bx, by, bw, bh, 10); ctx.stroke();
      ctx.fillStyle = danger ? "#ff9a7a" : "#aef0c0";
      let yy = by + padY + lh / 2;
      for (const l of lines) { ctx.fillText(l, VIEW.w / 2, yy); yy += lh; }
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.globalAlpha = 1;
    }
  }
  function drawMapAttacker(ctx, m) {
    const K = MUTANT_KINDS[m.kind] || MUTANT_KINDS.grunt, t = G.time;
    ctx.save(); ctx.translate(m.x, m.y);
    // тельце
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 9 * K.scale);
    g.addColorStop(0, K.c0); g.addColorStop(1, K.c1);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 8 * K.scale, 0, 7); ctx.fill();
    ctx.strokeStyle = "#1a3a14"; ctx.lineWidth = 1; ctx.stroke();
    // глазки
    ctx.fillStyle = K.eye; ctx.beginPath(); ctx.arc(-2.5, -1, 1.4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(2.5, -1, 1.4, 0, 7); ctx.fill();
    // вспышка урона
    if (m.hit > 0) { ctx.fillStyle = `rgba(255,90,60,${m.hit / 0.2 * 0.6})`; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill(); }
    ctx.restore();
    // полоска HP
    if (m.hp < m.maxHp) { ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(m.x - 9, m.y - 15, 18, 3); ctx.fillStyle = "#ff8a4a"; ctx.fillRect(m.x - 9, m.y - 15, 18 * (m.hp / m.maxHp), 3); }
  }
  function drawMapEvent(ctx, ev) {
    const t = G.time, gl = (Math.sin(t * 4) + 1) / 2;
    const col = ev.kind === "meteor" ? "255,170,90" : "120,220,255";
    ctx.save(); ctx.translate(ev.x, ev.y);
    // пульс-сигнал
    const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 32);
    rg.addColorStop(0, `rgba(${col},${0.4 + gl * 0.4})`); rg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 32, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${col},${0.5 + gl * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 20 - gl * 6, 0, 7); ctx.stroke();
    if (ev.kind === "meteor") {
      // дымящийся кратер с метеоритом
      ctx.fillStyle = "#2a1810"; ctx.beginPath(); ctx.ellipse(0, 6, 18, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#5a3a1a"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,140,60,${0.6 + gl * 0.4})`; ctx.beginPath(); ctx.arc(-2, -2, 3, 0, 7); ctx.fill();
    } else {
      // маяк-передатчик
      ctx.fillStyle = "#5a6470"; rr(ctx, -5, -4, 10, 14, 2); ctx.fill();
      ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, -16); ctx.stroke();
      ctx.fillStyle = `rgba(120,220,255,${0.5 + gl * 0.5})`; ctx.beginPath(); ctx.arc(0, -16, 3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "rgba(8,6,4,0.6)"; const lbl = ev.kind === "meteor" ? "☄ МЕТЕОРИТ" : "📡 SOS";
    ctx.font = f(10, "700"); ctx.textAlign = "center"; const lw = ctx.measureText(lbl).width + 12;
    rr(ctx, -lw / 2, 18, lw, 14, 4); ctx.fill();
    ctx.fillStyle = `rgba(${col},1)`; ctx.textBaseline = "middle"; ctx.fillText(lbl, 0, 26); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.restore();
  }
  function drawMapBase(ctx, x, y) {
    const st = G.state, gl = (Math.sin(G.time * 3) + 1) / 2, t = G.time;
    ctx.save(); ctx.translate(x, y);
    // === ЭНЕРГОЗАБОР === светящееся кольцо вокруг базы (по уровню)
    if (st.baseFence > 0) {
      const fr = 46 + st.baseFence * 4;
      for (let lvl = 0; lvl < st.baseFence; lvl++) {
        const rr2 = fr - lvl * 7;
        ctx.strokeStyle = `rgba(120,210,255,${0.35 + gl * 0.3})`; ctx.lineWidth = 2;
        hexPathMap(ctx, 0, 0, rr2); ctx.stroke();
      }
      // искрящиеся узлы по периметру
      ctx.fillStyle = `rgba(180,235,255,${0.6 + gl * 0.4})`;
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(a) * fr, Math.sin(a) * fr, 2.5, 0, 7); ctx.fill(); }
    }
    // === ПУШКИ ОБОРОНЫ === турели по периметру (по количеству)
    for (let i = 0; i < st.baseTurrets; i++) {
      const a = (Math.PI * 2 / 3) * i - Math.PI / 2;
      const tx = Math.cos(a) * 30, ty = Math.sin(a) * 30;
      ctx.save(); ctx.translate(tx, ty);
      ctx.fillStyle = "#3a4250"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 1; ctx.stroke();
      // ствол медленно сканирует
      ctx.rotate(Math.sin(t * 0.8 + i) * 0.6);
      ctx.fillStyle = "#7a8290"; rr(ctx, -1.5, -10, 3, 10, 1); ctx.fill();
      ctx.fillStyle = `rgba(255,120,80,${0.5 + gl * 0.5})`; ctx.beginPath(); ctx.arc(0, -10, 1.5, 0, 7); ctx.fill();
      ctx.restore();
    }
    // ореол
    const halo = ctx.createRadialGradient(0, 0, 6, 0, 0, 56);
    halo.addColorStop(0, `rgba(123,224,170,${0.22 + gl * 0.15})`); halo.addColorStop(1, "rgba(123,224,170,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 56, 0, 7); ctx.fill();
    // солнечные крылья
    ctx.fillStyle = "#1a2f55"; ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.5;
    for (const dir of [-1, 1]) {
      rr(ctx, dir > 0 ? 22 : -44, -9, 22, 18, 2); ctx.fill(); ctx.strokeRect(dir > 0 ? 22 : -44, -9, 22, 18);
      ctx.strokeStyle = "rgba(140,190,255,0.5)"; ctx.lineWidth = 0.8;
      for (let c = 1; c < 3; c++) { const cx2 = (dir > 0 ? 22 : -44) + c * 7; ctx.beginPath(); ctx.moveTo(cx2, -9); ctx.lineTo(cx2, 9); ctx.stroke(); }
      ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.5;
    }
    // мачта к крыльям
    ctx.strokeStyle = "#7a8290"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke();
    // шестиугольный хаб
    hexPathMap(ctx, 0, 0, 22);
    const dome = ctx.createRadialGradient(-5, -5, 2, 0, 0, 22);
    dome.addColorStop(0, "#eef2f8"); dome.addColorStop(1, "#5a6470");
    ctx.fillStyle = dome; ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 2; hexPathMap(ctx, 0, 0, 22); ctx.stroke();
    // внутреннее кольцо-коридор
    ctx.strokeStyle = "rgba(40,50,60,0.6)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.stroke();
    // реактор-ядро (ярче и больше с уровнем)
    const cr = 5 + st.baseReactorLvl * 1.5;
    ctx.fillStyle = `rgba(123,224,255,${0.65 + gl * 0.35})`; ctx.beginPath(); ctx.arc(0, 0, cr, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(180,240,255,0.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, cr, 0, 7); ctx.stroke();
    if (st.baseReactorLvl >= 2) { ctx.strokeStyle = `rgba(123,224,255,${0.4 + gl * 0.3})`; ctx.lineWidth = 1; for (let i = 0; i < st.baseReactorLvl - 1; i++) { ctx.save(); ctx.rotate(t * 2 + i * 2); ctx.beginPath(); ctx.ellipse(0, 0, cr + 4, 2.5, 0, 0, 7); ctx.stroke(); ctx.restore(); } }
    // вращающаяся радар-тарелка
    ctx.save(); ctx.rotate(G.time * 1.5); ctx.strokeStyle = "#cfd6dd"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18); ctx.stroke(); ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.ellipse(0, -18, 5, 2.5, 0, 0, 7); ctx.fill(); ctx.restore();
    // посадочные узлы по вершинам
    ctx.fillStyle = "#5a6470";
    for (let i = 0; i < 3; i++) { const a = (Math.PI * 2 / 3) * i + Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(a) * 24, Math.sin(a) * 24, 4, 0, 7); ctx.fill(); }
    // маяк
    ctx.fillStyle = `rgba(255,90,60,${0.4 + gl * 0.6})`; ctx.beginPath(); ctx.arc(0, -22, 3, 0, 7); ctx.fill();
    // повреждения базы (искры/дым при низком HP)
    const hp = st.baseHP != null ? st.baseHP : 100;
    if (hp < 80) {
      ctx.strokeStyle = "rgba(40,40,50,0.7)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-2, 4); ctx.lineTo(-6, 10); ctx.stroke();
      if (hp < 50) { const sp = (Math.sin(t * 14) + 1) / 2; ctx.fillStyle = `rgba(255,${120 + sp * 80},60,${0.6 + sp * 0.4})`; for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2; ctx.fillRect(Math.cos(a) * 14, Math.sin(a) * 12 - 4, 2, 2); } }
    }
    ctx.restore();
    // подпись + HP + подсказка
    ctx.fillStyle = "rgba(8,12,10,0.6)"; rr(ctx, x - 64, y + 30, 128, 44, 6); ctx.fill();
    ctx.fillStyle = "#7de08a"; ctx.font = f(12, "800"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🛰 БАЗА", x, y + 40);
    // HP-бар базы
    ctx.fillStyle = "rgba(0,0,0,0.5)"; rr(ctx, x - 40, y + 48, 80, 6, 2); ctx.fill();
    ctx.fillStyle = hp > 50 ? "#7de08a" : hp > 25 ? "#ffd17a" : "#ff6a4a"; rr(ctx, x - 39, y + 49, 78 * (hp / 100), 4, 2); ctx.fill();
    ctx.fillStyle = `rgba(255,210,140,${0.6 + gl * 0.4})`; ctx.font = f(9, "600");
    ctx.fillText("тап — управление ⚙", x, y + 66);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    // пульс тревоги, если угроза высокая
    if ((st.baseThreat || 0) > 0.5) {
      const pa = (Math.sin(t * 6) + 1) / 2;
      ctx.strokeStyle = `rgba(255,70,50,${0.3 + pa * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 50 + pa * 8, 0, 7); ctx.stroke();
    }
  }
  const ORE_LABEL = { super: "СУПЕР", wonder: "ЧУДО", zcrystal: "Z-КР", fuel: "ТОПЛИВО", navchip: "КАРТЫ" };
  function drawMapShaft(ctx, st, scan, AMB) {
    const revealed = st.explored || scan;
    const t = G.time, gl = (Math.sin(t * 2.5 + st.id) + 1) / 2;
    ctx.save(); ctx.translate(st.x, st.y);
    if (revealed) {
      const K = (typeof ORE_KINDS !== "undefined" && ORE_KINDS[st.kind]) ? ORE_KINDS[st.kind] : null;
      const col = K ? K.gems[1] : "#caa0ff";
      // подсветка руды
      const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.35 + gl * 0.25; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      // гекс-площадка
      hexPathMap(ctx, 0, 0, 22); ctx.fillStyle = "#2e2014"; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; hexPathMap(ctx, 0, 0, 22); ctx.stroke();
      // буровая вышка (X-каркас)
      ctx.strokeStyle = "#aab4c0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-11, 12); ctx.lineTo(0, -16); ctx.lineTo(11, 12); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(-9, 6); ctx.lineTo(9, 6); ctx.stroke();
      // самоцвет руды
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, -2); ctx.lineTo(0, 8); ctx.lineTo(-6, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(1, -3); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
      // подпись типа руды
      ctx.fillStyle = "rgba(8,6,4,0.6)"; const lbl = ORE_LABEL[st.kind] || "РУДА";
      ctx.font = f(10, "700"); ctx.textAlign = "center"; const lw = ctx.measureText(lbl).width + 12;
      rr(ctx, -lw / 2, 24, lw, 15, 4); ctx.fill();
      ctx.fillStyle = col; ctx.textBaseline = "middle"; ctx.fillText(lbl, 0, 32); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    } else {
      // нераскрытая шахта — гекс с «?» и крутящимся прицелом
      hexPathMap(ctx, 0, 0, 21); ctx.fillStyle = "rgba(24,16,10,0.92)"; ctx.fill();
      ctx.strokeStyle = `rgba(${AMB},${0.5 + gl * 0.4})`; ctx.lineWidth = 2; hexPathMap(ctx, 0, 0, 21); ctx.stroke();
      // прицел-ретикл (вращается)
      ctx.save(); ctx.rotate(t * 0.6); ctx.strokeStyle = `rgba(${AMB},0.4)`; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -31); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = `rgba(255,210,140,${0.75 + gl * 0.25})`; ctx.font = f(24, "900"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 1); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    }
    ctx.restore();
  }

  // ====== ДРЕВНИЕ АРТЕФАКТЫ на карте — аномалии с плюшками ======
  const ARTIFACTS = {
    relic_core:   { icon: "🔋", color: "#7be0ff", name: "Энергоядро древних", effect: "разряд −15% навсегда",
      grant: () => { G.state.artBattery = true; G.state.battery = 100; } },
    relic_weapon: { icon: "⚔", color: "#ff8a4a", name: "Боевой модуль", effect: "улучшение робота",
      grant: (sc) => { if (nextUpgrade()) grantNextUpgrade(null); else G.state.baseTurrets = Math.min(3, G.state.baseTurrets + 1); } },
    relic_map:    { icon: "🗺", color: "#7de08a", name: "Картограф древних", effect: "карта раскрыта + 1 навиг. карта",
      grant: () => { G.state.artMapReveal = true; G.state.navMaps = (G.state.navMaps || 0) + 1; } },
    relic_vein:   { icon: "✦", color: "#caa0ff", name: "Залежь древних", effect: "+2 супер-минерала",
      grant: () => { G.state.superMinerals += 2; } },
    relic_aegis:  { icon: "🛡", color: "#aef0c0", name: "Эгида древних", effect: "усиление обороны базы",
      grant: () => { if (G.state.baseFence < 2) G.state.baseFence++; else G.state.baseTurrets = Math.min(3, G.state.baseTurrets + 1); } },
  };
  function drawMapArtifact(ctx, ar, reveal) {
    const t = G.time, gl = (Math.sin(t * 3 + ar.id * 2) + 1) / 2;
    const A = ARTIFACTS[ar.kind] || ARTIFACTS.relic_vein;
    ctx.save(); ctx.translate(ar.x, ar.y);
    if (ar.collected) {
      // забранный — тусклый постамент с галочкой
      ctx.fillStyle = "rgba(60,50,40,0.6)"; hexPathMap(ctx, 0, 0, 16); ctx.fill();
      ctx.strokeStyle = "rgba(123,224,160,0.5)"; ctx.lineWidth = 1.5; hexPathMap(ctx, 0, 0, 16); ctx.stroke();
      ctx.fillStyle = "rgba(123,224,160,0.7)"; ctx.font = f(16, "900"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("✓", 0, 1); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      ctx.restore(); return;
    }
    // пульсирующий ореол-сигнал (виден даже сквозь туман)
    const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    rg.addColorStop(0, A.color); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.35 + gl * 0.35; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    // обелиск-реликвия (ромб)
    ctx.save(); ctx.rotate(Math.sin(t * 1.2 + ar.id) * 0.1);
    const og = ctx.createLinearGradient(0, -18, 0, 14);
    og.addColorStop(0, "#e8e0c8"); og.addColorStop(0.5, A.color); og.addColorStop(1, "#3a2c1a");
    ctx.fillStyle = og; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(11, -2); ctx.lineTo(6, 14); ctx.lineTo(-6, 14); ctx.lineTo(-11, -2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    // глиф-сердцевина
    ctx.fillStyle = `rgba(255,255,255,${0.6 + gl * 0.4})`; ctx.beginPath(); ctx.arc(0, -1, 3, 0, 7); ctx.fill();
    ctx.restore();
    // орбитальные точки
    ctx.fillStyle = A.color;
    for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * 2.1; ctx.beginPath(); ctx.arc(Math.cos(a) * 18, Math.sin(a) * 10 - 2, 1.6, 0, 7); ctx.fill(); }
    // подпись: «?» аномалия или название (если раскрыто)
    ctx.fillStyle = "rgba(8,6,4,0.65)"; const lbl = reveal ? "АРТЕФАКТ" : "✦ АНОМАЛИЯ";
    ctx.font = f(10, "700"); ctx.textAlign = "center"; const lw = ctx.measureText(lbl).width + 12;
    rr(ctx, -lw / 2, 18, lw, 14, 4); ctx.fill();
    ctx.fillStyle = A.color; ctx.textBaseline = "middle"; ctx.fillText(lbl, 0, 26); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.restore();
  }

  /* =========================================================================
     УПРАВЛЕНИЕ БАЗОЙ — строительство и улучшение крепости
     ========================================================================= */
  // Оборонная мощь базы (для авто-отражения нападений)
  function baseDefensePower() { return G.state.baseTurrets * 2 + G.state.baseFence; }
  const BASE_STRUCTURES = [
    { key: "repair", icon: "🔧", name: "Ремонт базы", repair: true,
      status: () => `Прочность ${Math.round(G.state.baseHP != null ? G.state.baseHP : 100)}% · катаклизмы вредят` },
    { key: "reactor", icon: "⚛", name: "Реактор базы", desc: "Мощнее зарядка от солнца",
      level: () => G.state.baseReactorLvl, max: 3, cost: 2, build: () => { G.state.baseReactorLvl++; } },
    { key: "turret", icon: "🔫", name: "Пушки обороны", info: true, max: 3, level: () => G.state.baseTurrets,
      status: () => !G.state.hasTurretBlueprint ? "🔍 Найдите чертёж в шахтах" : `${G.state.baseTurrets}/3 · 🖨 печать в цеху принтера (1✦)` },
    { key: "fence", icon: "⚡", name: "Энергозабор", info: true, max: 2, level: () => G.state.baseFence,
      status: () => !G.state.hasFenceBlueprint ? "🔍 Найдите чертёж в шахтах" : G.state.printerTier < 1 ? "🔧 Нужен апгрейд принтера (в цеху)" : `${G.state.baseFence}/2 · 🖨 печать в цеху принтера (1✦)` },
    { key: "scanner", icon: "📡", name: "Сканер древних", campaign: true,
      status: () => G.state.hasScanner ? "Установлен ✓" : "Постройте по сюжету",
      built: () => G.state.hasScanner },
    { key: "launchpad", icon: "🚀", name: "Стартовая площадка", campaign: true,
      status: () => (G.state.hasShipHull && G.state.hasShipWings && G.state.hasShipEngine) ? "Корабль собран ✓" : G.state.printerUpgraded ? "Сборка корабля…" : "Откройте марс-техно",
      built: () => G.state.printerUpgraded },
  ];
  G.addScene("base_manage", {
    recharge: false, useJoystick: false,
    enter() { this.back = { x: 36, y: 34, w: 180, h: 48, text: "← Карта", fs: 20 }; this._btns = []; },
    update() {},
    onTap(x, y) {
      if (rectHit(this.back, x, y)) { G.audio.blip(); G.go("mars_map"); return; }
      for (const b of this._btns) {
        if (rectHit(b, x, y)) {
          const s = b.struct;
          if (s.repair) {
            if ((G.state.baseHP != null ? G.state.baseHP : 100) >= 100) return;
            if (G.state.superMinerals < 1) { this._warn = 1.2; G.audio.tone(160, 0.12, "square", 0.05); return; }
            G.state.superMinerals -= 1; G.state.baseHP = 100; G.audio.win(); this._flash = b.key; this._flashT = 0.6; return;
          }
          if (s.campaign || s.info || (s.blueprint && !G.state[s.blueprint]) || (s.level && s.level() >= s.max)) return;
          if (G.state.superMinerals < s.cost) { this._warn = 1.2; G.audio.tone(160, 0.12, "square", 0.05); return; }
          G.state.superMinerals -= s.cost; s.build(); G.audio.win();
          this._flash = b.key; this._flashT = 0.6;
          return;
        }
      }
    },
    draw(ctx) { drawBaseManage(ctx, this); },
  });
  function drawBaseManage(ctx, sc) {
    const t = G.time;
    if (sc._flashT > 0) sc._flashT -= 0.016;
    if (sc._warn > 0) sc._warn -= 0.016;
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    bg.addColorStop(0, "#1a1208"); bg.addColorStop(1, "#0a0604"); ctx.fillStyle = bg; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    starfield(ctx, 40, 17);
    // заголовок
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd9a0"; ctx.font = f(34, "800"); ctx.fillText("🏰 УПРАВЛЕНИЕ БАЗОЙ", VIEW.w / 2, 64);
    // ресурс + оборона + угроза
    ctx.font = f(16, "700");
    ctx.fillStyle = "#caa0ff"; ctx.fillText(`✦ Супер-минералы: ${G.state.superMinerals}`, VIEW.w / 2 - 220, 96);
    ctx.fillStyle = "#9fe6ff"; ctx.fillText(`🛡 Оборона: ${baseDefensePower()}`, VIEW.w / 2 + 60, 96);
    // полоса угрозы
    const thr = clamp(G.state.baseThreat || 0, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = f(13, "600"); ctx.textAlign = "right";
    ctx.fillText("Угроза нападения:", VIEW.w / 2 + 150, 122);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(0,0,0,0.5)"; rr(ctx, VIEW.w / 2 + 160, 112, 180, 14, 4); ctx.fill();
    ctx.fillStyle = thr > 0.66 ? "#ff5a3a" : thr > 0.33 ? "#ffd17a" : "#7de08a";
    rr(ctx, VIEW.w / 2 + 162, 114, 176 * thr, 10, 3); ctx.fill();
    ctx.textAlign = "left";
    // карточки структур
    sc._btns = [];
    const cw = 760, cx = VIEW.w / 2 - cw / 2, ch = 82, gap = 10;
    let cy = 150;
    for (const s of BASE_STRUCTURES) {
      const flash = sc._flash === s.key && sc._flashT > 0;
      ctx.fillStyle = flash ? "rgba(60,80,50,0.95)" : "rgba(34,28,20,0.92)"; rr(ctx, cx, cy, cw, ch, 12); ctx.fill();
      ctx.strokeStyle = s.campaign ? "rgba(120,160,200,0.4)" : "#7a5a3a"; ctx.lineWidth = 2; rr(ctx, cx, cy, cw, ch, 12); ctx.stroke();
      // иконка
      ctx.font = f(38); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(s.icon, cx + 44, cy + ch / 2);
      // имя + описание/статус
      ctx.textAlign = "left"; ctx.fillStyle = "#ffe9c8"; ctx.font = f(22, "700");
      ctx.fillText(s.name, cx + 84, cy + 30);
      const statusOnly = s.campaign || s.info || s.repair;
      const locked = s.blueprint && !G.state[s.blueprint]; // нет чертежа
      ctx.fillStyle = statusOnly ? "rgba(220,200,170,0.78)" : "rgba(220,200,170,0.7)"; ctx.font = f(14);
      ctx.fillText(statusOnly ? s.status() : (locked ? s.findHint : s.desc), cx + 84, cy + 56);
      // уровень-пипсы / HP-бар
      if (s.repair) {
        const hp = G.state.baseHP != null ? G.state.baseHP : 100;
        ctx.fillStyle = "rgba(0,0,0,0.4)"; rr(ctx, cx + 440, cy + 22, 100, 12, 4); ctx.fill();
        ctx.fillStyle = hp > 50 ? "#7de08a" : hp > 25 ? "#ffd17a" : "#ff6a4a"; rr(ctx, cx + 442, cy + 24, 96 * (hp / 100), 8, 3); ctx.fill();
      } else if (!s.campaign && s.level) {
        const lv = s.level();
        for (let i = 0; i < s.max; i++) {
          ctx.fillStyle = i < lv ? "#7de08a" : "rgba(255,255,255,0.18)";
          ctx.beginPath(); ctx.arc(cx + 470 + i * 18, cy + 28, 6, 0, 7); ctx.fill();
        }
      }
      // кнопка
      const bw = 150, bx = cx + cw - bw - 14, byy = cy + 18, bh = ch - 36;
      const maxed = !statusOnly && s.level && s.level() >= s.max;
      let label, enabled;
      if (s.repair) { const dmg = (G.state.baseHP != null ? G.state.baseHP : 100) < 100; label = dmg ? "🔧 Починить (1✦)" : "✓ Цела"; enabled = dmg && G.state.superMinerals >= 1; }
      else if (s.campaign) { label = s.built() ? "✓ Готово" : "по сюжету"; enabled = false; }
      else if (s.info) { label = "🖨 в цеху"; enabled = false; }
      else if (locked) { label = "🔒 нет чертежа"; enabled = false; }
      else if (maxed) { label = "МАКС"; enabled = false; }
      else { label = `🖨 Печать (${s.cost}✦)`; enabled = G.state.superMinerals >= s.cost; }
      ctx.fillStyle = !enabled ? "rgba(50,44,34,0.9)" : "#caa066";
      rr(ctx, bx, byy, bw, bh, 8); ctx.fill();
      if (enabled) { ctx.strokeStyle = "#ffe9c8"; ctx.lineWidth = 1.5; rr(ctx, bx, byy, bw, bh, 8); ctx.stroke(); }
      ctx.fillStyle = enabled ? "#1d1208" : "rgba(220,200,170,0.5)"; ctx.font = f(16, "700");
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, bx + bw / 2, byy + bh / 2);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      if (enabled) sc._btns.push({ x: bx, y: byy, w: bw, h: bh, struct: s, key: s.key });
      cy += ch + gap;
    }
    // предупреждение «мало ресурсов»
    if (sc._warn > 0) {
      ctx.fillStyle = `rgba(255,90,60,${Math.min(0.9, sc._warn)})`; ctx.font = f(18, "700"); ctx.textAlign = "center";
      ctx.fillText("Не хватает супер-минералов — бурите в шахтах!", VIEW.w / 2, VIEW.h - 36);
      ctx.textAlign = "left";
    } else {
      // постоянная подсказка-онбординг (что тут делать)
      ctx.fillStyle = "rgba(255,230,200,0.55)"; ctx.font = f(14, "600"); ctx.textAlign = "center";
      ctx.fillText("Качай реактор за супер-минералы (буром в шахтах). Турели/забор печатаются в «Цеху обороны» у принтера. Чини базу после бурь.", VIEW.w / 2, VIEW.h - 30);
      ctx.textAlign = "left";
    }
    G.button(ctx, sc.back, false);
  }

  /* =========================================================================
     ИСПЫТАНИЕ АРТЕФАКТА — мини-игра при добыче (3 разные механики)
     ========================================================================= */
  G.addScene("artifact_trial", {
    recharge: false, useJoystick: false,
    enter() {
      this.ar = (G.state.mapArtifacts || [])[G.state._activeArtifact] || { kind: "relic_vein", trial: "lock" };
      this.A = ARTIFACTS[this.ar.kind] || ARTIFACTS.relic_vein;
      this.trial = this.ar.trial || "lock";
      this.back = { x: 36, y: 34, w: 180, h: 46, text: "← Отступить", fs: 18 };
      this.done = false; this.winT = 0; this.failT = 0;
      if (this.trial === "lock") this.initLock();
      else if (this.trial === "memory") this.initMemory();
      else this.initGuard();
    },
    succeed() {
      if (this.done) return;
      this.done = true; this.winT = 2.2; this.ar.collected = true; this.A.grant(null);
      G.audio.win(); G.fx.burst(VIEW.w / 2, 360, this.A.color, 50, 300, 1.4);
    },
    fail(msg) { this.failT = 1.2; this.failMsg = msg || "Не вышло — попробуйте снова"; G.audio.hit(); },
    // ===== Замок-ротор =====
    initLock() {
      this.rings = [
        { ang: Math.random() * 7, sp: 1.6, locked: false },
        { ang: Math.random() * 7, sp: -2.2, locked: false },
        { ang: Math.random() * 7, sp: 2.8, locked: false },
      ];
    },
    // ===== Память (Simon) =====
    initMemory() {
      this.seq = []; for (let i = 0; i < 4; i++) this.seq.push(Math.floor(Math.random() * 4));
      this.phase = "show"; this.showI = 0; this.showT = 0.7; this.inI = 0; this.flash = -1; this.flashT = 0;
    },
    // ===== Стражи (рефлекс) =====
    initGuard() {
      this.guards = []; this.gtoClear = 6; this.gcleared = 0; this.stability = 100; this.gspawnT = 0.6;
    },
    update(dt) {
      if (this.winT > 0) { this.winT -= dt; if (this.winT <= 0) G.go("mars_map"); return; }
      if (this.failT > 0) this.failT -= dt;
      if (this.done) return;
      if (this.trial === "lock") {
        for (const r of this.rings) if (!r.locked) r.ang += r.sp * dt;
      } else if (this.trial === "memory") {
        if (this.phase === "show") {
          this.showT -= dt;
          if (this.flashT > 0) this.flashT -= dt; else this.flash = -1;
          if (this.showT <= 0) {
            if (this.showI < this.seq.length) { this.flash = this.seq[this.showI]; this.flashT = 0.35; this.showI++; this.showT = 0.6; G.audio.tone(380 + this.flash * 90, 0.12, "sine", 0.05); }
            else { this.phase = "input"; this.flash = -1; }
          }
        }
      } else { // guard
        this.gspawnT -= dt;
        if (this.gspawnT <= 0 && this.gcleared + this.guards.length < this.gtoClear) {
          this.gspawnT = 0.7 + Math.random() * 0.5;
          const a = Math.random() * 7, r = 230;
          this.guards.push({ x: VIEW.w / 2 + Math.cos(a) * r, y: 380 + Math.sin(a) * r * 0.7, hp: 1 });
        }
        for (let i = this.guards.length - 1; i >= 0; i--) {
          const gd = this.guards[i]; const dx = VIEW.w / 2 - gd.x, dy = 380 - gd.y, d = Math.hypot(dx, dy) || 1;
          gd.x += dx / d * 42 * dt; gd.y += dy / d * 42 * dt;
          if (d < 40) { this.stability -= 18; this.guards.splice(i, 1); G.audio.boom(); if (this.stability <= 0) { this.stability = 100; this.gcleared = 0; this.guards.length = 0; this.fail("Стражи прорвались! Заново."); } }
        }
        if (this.gcleared >= this.gtoClear) this.succeed();
      }
    },
    onTap(x, y) {
      if (rectHit(this.back, x, y)) { G.audio.blip(); G.go("mars_map"); return; }
      if (this.done) return;
      if (this.trial === "lock") {
        const r = this.rings.find((rr2) => !rr2.locked); if (!r) return;
        // нотч у вершины? (угол около -PI/2)
        const a = ((r.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const diff = Math.min(Math.abs(a - (Math.PI * 1.5)), Math.PI * 2 - Math.abs(a - (Math.PI * 1.5)));
        if (diff < 0.32) { r.locked = true; G.audio.tone(620, 0.08, "square", 0.05); if (this.rings.every((rr2) => rr2.locked)) this.succeed(); }
        else this.fail("Мимо! Ловите метку у вершины.");
      } else if (this.trial === "memory") {
        if (this.phase !== "input") return;
        const b = this._memBtns && this._memBtns.find((bb) => rectHit(bb, x, y)); if (!b) return;
        G.audio.tone(380 + b.idx * 90, 0.12, "sine", 0.05); this.flash = b.idx; this.flashT = 0.2;
        if (b.idx === this.seq[this.inI]) { this.inI++; if (this.inI >= this.seq.length) this.succeed(); }
        else { this.fail("Неверная последовательность!"); this.initMemory(); }
      } else { // guard
        for (let i = this.guards.length - 1; i >= 0; i--) {
          if (Math.hypot(this.guards[i].x - x, this.guards[i].y - y) < 26) {
            G.fx.burst(this.guards[i].x, this.guards[i].y, "#9ce06a", 12, 140, 0.5); this.guards.splice(i, 1); this.gcleared++; G.audio.hit(); return;
          }
        }
      }
    },
    draw(ctx) { drawArtifactTrial(ctx, this); },
  });
  function drawArtifactTrial(ctx, sc) {
    const t = G.time, A = sc.A, cx = VIEW.w / 2, cy = 360;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#16101e"); g.addColorStop(1, "#080610");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h); starfield(ctx, 50, 31);
    // заголовок
    ctx.textAlign = "center"; ctx.fillStyle = "#ffd9a0"; ctx.font = f(30, "800");
    ctx.fillText(`${A.icon} ИСПЫТАНИЕ АРТЕФАКТА`, cx, 70);
    const titles = { lock: "Древний замок — остановите метку у вершины (×3)", memory: "Код древних — повторите последовательность", guard: "Стражи! Тапайте дронов, не пускайте к ядру" };
    ctx.fillStyle = "rgba(220,200,170,0.8)"; ctx.font = f(15); ctx.fillText(titles[sc.trial], cx, 98);
    ctx.textAlign = "left";
    if (sc.done) {
      const p = 1 - sc.winT / 2.2;
      ctx.fillStyle = A.color; ctx.beginPath(); ctx.arc(cx, cy, 30 + p * 30, 0, 7); ctx.fill();
      ctx.fillStyle = "#aef0c0"; ctx.font = f(26, "800"); ctx.textAlign = "center";
      ctx.fillText("АРТЕФАКТ ДОБЫТ!", cx, cy - 70);
      ctx.fillStyle = "#ffe9c8"; ctx.font = f(18, "600"); ctx.fillText(`${A.icon} ${A.name}: ${A.effect}`, cx, cy + 80);
      ctx.textAlign = "left"; G.button(ctx, sc.back, false); return;
    }
    if (sc.trial === "lock") {
      // метка-вершина
      ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.moveTo(cx, cy - 116); ctx.lineTo(cx - 9, cy - 132); ctx.lineTo(cx + 9, cy - 132); ctx.closePath(); ctx.fill();
      sc.rings.forEach((r, i) => {
        const rad = 50 + i * 28;
        ctx.strokeStyle = r.locked ? "#7de08a" : "rgba(180,200,220,0.4)"; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke();
        // нотч
        const nx = cx + Math.cos(r.ang) * rad, ny = cy + Math.sin(r.ang) * rad;
        ctx.fillStyle = r.locked ? "#7de08a" : A.color; ctx.beginPath(); ctx.arc(nx, ny, 8, 0, 7); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      });
      // ядро
      const gl = (Math.sin(t * 4) + 1) / 2; ctx.fillStyle = `rgba(255,255,255,${0.4 + gl * 0.4})`; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(230,210,180,0.8)"; ctx.font = f(15, "600"); ctx.textAlign = "center";
      ctx.fillText("Тап — застопорить кольцо", cx, VIEW.h - 120); ctx.textAlign = "left";
    } else if (sc.trial === "memory") {
      sc._memBtns = [];
      const cols = ["#ff6a4a", "#ffd24a", "#7de08a", "#7be0ff"]; const r = 56, gap = 28; const total = r * 2 * 4 + gap * 3; let bx0 = cx - total / 2;
      for (let i = 0; i < 4; i++) {
        const bx = bx0 + i * (r * 2 + gap) + r, byy = cy + 10;
        const rect = { x: bx - r, y: byy - r, w: r * 2, h: r * 2, idx: i }; sc._memBtns.push(rect);
        const lit = sc.flash === i && sc.flashT > 0;
        ctx.fillStyle = lit ? cols[i] : "rgba(40,44,54,0.9)"; ctx.beginPath(); ctx.arc(bx, byy, r, 0, 7); ctx.fill();
        ctx.strokeStyle = cols[i]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bx, byy, r, 0, 7); ctx.stroke();
        if (lit) { ctx.fillStyle = `rgba(255,255,255,0.5)`; ctx.beginPath(); ctx.arc(bx, byy, r * 0.6, 0, 7); ctx.fill(); }
      }
      ctx.fillStyle = "rgba(230,210,180,0.8)"; ctx.font = f(15, "600"); ctx.textAlign = "center";
      ctx.fillText(sc.phase === "show" ? "Запоминайте…" : `Повторите: ${sc.inI}/${sc.seq.length}`, cx, VIEW.h - 120); ctx.textAlign = "left";
    } else { // guard
      // ядро
      const gl = (Math.sin(t * 3) + 1) / 2;
      const cg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 34); cg.addColorStop(0, A.color); cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, 7); ctx.fill();
      drawAncientArtifact(ctx, cx, cy + 14, 1, 0);
      // дроны-стражи
      for (const gd of sc.guards) {
        ctx.save(); ctx.translate(gd.x, gd.y);
        ctx.fillStyle = "#6a2aaf"; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
        ctx.strokeStyle = "#d7a0ff"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#ff5af0"; ctx.beginPath(); ctx.arc(-3, -1, 2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(3, -1, 2, 0, 7); ctx.fill();
        ctx.restore();
      }
      // стабильность
      ctx.fillStyle = "rgba(0,0,0,0.5)"; rr(ctx, cx - 130, VIEW.h - 140, 260, 16, 5); ctx.fill();
      ctx.fillStyle = sc.stability > 50 ? "#7de08a" : "#ff6a4a"; rr(ctx, cx - 128, VIEW.h - 138, 256 * (sc.stability / 100), 12, 4); ctx.fill();
      ctx.fillStyle = "#cfe6f0"; ctx.font = f(13, "600"); ctx.textAlign = "center";
      ctx.fillText(`Стабильность ядра · обезврежено ${sc.gcleared}/${sc.gtoClear}`, cx, VIEW.h - 110); ctx.textAlign = "left";
    }
    if (sc.failT > 0) { ctx.fillStyle = `rgba(255,80,60,${Math.min(0.6, sc.failT)})`; ctx.font = f(20, "800"); ctx.textAlign = "center"; ctx.fillText(sc.failMsg, cx, 130); ctx.textAlign = "left"; }
    G.button(ctx, sc.back, false);
  }

  // -- Шахта с мутантами (бурить можно, охраняется) --
  G.addScene("drill_site", makeRoom({
    name: "drill_site", dayValue: 105,
    start: { x: 240, y: 410 },
    drain: 0.4,
    narr: (s) => {
      if (s.mutants && s.mutants.length) return "МУТАНТЫ! Защищают залежи. Бейте «Действием» — кулак.";
      const spots = s.data.spots || [];
      if (spots.length && spots.every(sp => sp.done)) return "Жилы выработаны. Вернитесь к 3D-принтеру (слева).";
      if (G.state.printerUpgraded && !G.state.shipLaunched) {
        return "Для корабля: супер-минералы на детали, голубое ТОПЛИВО ⛽ и оранжевые НАВИГАЦИОННЫЕ КАРТЫ 🗺. Бейте буром!";
      }
      if (G.state.hasScannerBlueprint && !G.state.hasScanner) {
        return "Для сканера нужны разные руды: фиолетовые супер-, золотые чудо-минералы и зелёный Z-кристалл. Бейте буром!";
      }
      return "Подойдите к жиле и бейте «Действием» — несколько ударов буром, чтобы пробить породу!";
    },
    bg(ctx, s) {
      G.drawTombRoom(ctx, s.bounds, { floorTop: "#4a3a2a", floorBot: "#2a1e14" });
    },
    build(s) {
      const b = s.bounds;
      s.data.drillT = 0; s.data.drillTarget = null;
      // Какие руды добывать в этот визит — выводим из цели (Strategy via data)
      const kinds = neededMineKinds().slice(0, 3); // 3 жилы за визит — меньше беготни к принтеру
      if (kinds.length === 0) kinds.push("super");
      const positions = [{ x: b.x + 300, y: b.y + 200 }, { x: b.x + 620, y: b.y + 410 }, { x: b.x + 770, y: b.y + 170 }];
      s.data.spots = kinds.map((kind, i) => ({
        x: positions[i].x, y: positions[i].y, kind,
        hits: 0, maxHits: kind === "zcrystal" ? 4 : 3,
        chipT: 0, shake: 0, done: false, id: i + 1, seed: 1.3 + i * 1.4,
      }));
      // По интерактиву на каждую жилу (без копипаста — цикл)
      s.data.spots.forEach((sp) => {
        s.interactables.push({
          x: sp.x, y: sp.y, r: 90,
          label: () => `Бить буром ${sp.hits}/${sp.maxHits} 🛠`,
          ready: () => !sp.done && sp.chipT <= 0 && (!s.mutants || !s.mutants.length),
          act(sc) { chipOre(sc, sp); },
        });
      });
      // Мутанты-стражи: 2 в первый визит, 1 в последующие
      const guards = G.state.hasBase ? 1 : 2;
      for (let i = 0; i < guards; i++) {
        s.mutants.push(makeMutant(b.x + 500 + i * 80, b.y + 260 + i * 60, 2));
      }
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => "← К 3D-принтеру", to: "printer",
        ready: () => !s.data.drillT
      };
      placeLog(s, "drill", b.x + 200, b.y + b.h - 70); // дневник в шахте
      // чертежи обороны базы — находятся по очереди (нужна база)
      if (G.state.hasBase) {
        if (!G.state.hasTurretBlueprint) placeTechBlueprint(s, "turret", b.x + 180, b.y + 110);
        else if (!G.state.hasFenceBlueprint) placeTechBlueprint(s, "fence", b.x + 760, b.y + 130);
      }
    },
    update(s, dt) {
      // обновление анимации удара по каждой жиле
      for (const sp of s.data.spots) {
        if (sp.chipT > 0) {
          sp.chipT -= dt;
          sp.shake = sp.chipT > 0 ? Math.sin(G.time * 60) * 3 : 0;
          const k = ORE_KINDS[sp.kind] || ORE_KINDS.super;
          // искры во время удара цветом руды
          if (Math.random() > 0.3) G.fx.burst(sp.x + (Math.random() - 0.5) * 30, sp.y - 14, k.spark, 1, 90, 0.3);
          if (sp.chipT <= 0 && !sp.done && sp.hits >= sp.maxHits) {
            // финальный взрыв породы — выдаём ресурс по типу
            sp.done = true;
            grantOre(sp.kind);
            G.fx.burst(sp.x, sp.y - 10, "#ffd17a", 24, 220, 0.9);
            G.fx.burst(sp.x, sp.y - 10, k.spark, 24, 200, 0.85);
            G.audio.pickup();
            s.toast(`Добыт ${k.label}!`, 2.4);
          }
        }
      }
    },
    drawProps(s, ctx) {
      for (const sp of s.data.spots) drawOreVein(ctx, sp);
    },
    drawOver(s, ctx) {
      // счётчики ресурсов — показываем то, что относится к текущей цели
      const rows = [];
      if (G.state.printerUpgraded && !G.state.shipLaunched) {
        rows.push(["✦ Супер", `${G.state.superMinerals}`, "#caa0ff"]);
        rows.push(["⛽ Топливо", `${G.state.fuelUnits}/2`, "#7be0ff"]);
        rows.push(["🗺 Карты", `${G.state.navMaps}/2`, "#ff8a4a"]);
      } else if (G.state.hasScannerBlueprint && !G.state.hasScanner) {
        rows.push(["✦ Супер", `${G.state.superMinerals}/2`, "#caa0ff"]);
        rows.push(["✶ Чудо", `${G.state.wonderMinerals}/2`, "#ffd17a"]);
        rows.push(["Z-кристалл", G.state.hasZCrystal ? "✓" : "0/1", "#7be0a0"]);
      } else {
        rows.push(["✦ Супер-минералы", `${G.state.superMinerals}`, "#caa0ff"]);
      }
      const w = 210, x = VIEW.w - w - 20;
      ctx.fillStyle = "rgba(8,5,3,0.62)"; rr(ctx, x, 76, w, 26 + rows.length * 24, 8); ctx.fill();
      ctx.font = f(15, "600"); ctx.textBaseline = "middle";
      rows.forEach((r, i) => {
        ctx.fillStyle = r[2]; ctx.textAlign = "left"; ctx.fillText(r[0], x + 12, 100 + i * 24);
        ctx.textAlign = "right"; ctx.fillText(r[1], x + w - 12, 100 + i * 24);
      });
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    },
  }));

  // ====== Типы руды (Strategy via data) ======
  const ORE_KINDS = {
    super:    { label: "супер-минерал", spark: "#caa0ff", glow: "200,160,255",
                gems: ["#9a5acf", "#caa0ff", "#7a3aaf"], coreLo: "#1a0a2a", coreHi: "#e0c0ff" },
    wonder:   { label: "чудо-минерал",  spark: "#ffd17a", glow: "255,210,120",
                gems: ["#e0962a", "#ffe9a0", "#c87a1a"], coreLo: "#3a2208", coreHi: "#fff0c0" },
    zcrystal: { label: "Z-кристалл",    spark: "#7be0a0", glow: "120,255,170",
                gems: ["#1fa05a", "#aaffcc", "#137a44"], coreLo: "#06241a", coreHi: "#d0ffe4" },
    fuel:     { label: "топливо ⛽",     spark: "#7be0ff", glow: "120,210,255",
                gems: ["#2a8acf", "#aae6ff", "#1a6aa0"], coreLo: "#06203a", coreHi: "#d0f0ff" },
    navchip:  { label: "навигационную карту 🗺", spark: "#ff8a4a", glow: "255,150,90",
                gems: ["#c85a1a", "#ffc080", "#a04010"], coreLo: "#3a1a08", coreHi: "#ffe0c0" },
  };
  // Что нужно добыть прямо сейчас — выводим из состояния (без хардкода в сцене)
  function neededMineKinds() {
    const st = G.state;
    // Глава 4: сборка корабля — супер на детали, затем топливо и карты
    if (st.printerUpgraded && !st.shipLaunched) {
      const need = [];
      // корпус бесплатный; супер нужен только на крылья и двигатель
      const partsLeft = (st.hasShipWings ? 0 : 1) + (st.hasShipEngine ? 0 : 1);
      for (let i = st.superMinerals; i < partsLeft; i++) need.push("super");
      for (let i = st.fuelUnits; i < 2; i++) need.push("fuel");
      for (let i = st.navMaps; i < 2; i++) need.push("navchip");
      return need.length ? need : ["super", "super"];
    }
    // Глава 3: сканер
    if (st.hasScannerBlueprint && !st.hasScanner) {
      const need = [];
      for (let i = st.superMinerals; i < 2; i++) need.push("super");
      for (let i = st.wonderMinerals; i < 2; i++) need.push("wonder");
      if (!st.hasZCrystal) need.push("zcrystal");
      return need;
    }
    return ["super", "super"]; // фазы базы и меча
  }
  function grantOre(kind) {
    if (kind === "wonder") G.state.wonderMinerals += 1;
    else if (kind === "zcrystal") G.state.hasZCrystal = true;
    else if (kind === "fuel") G.state.fuelUnits += 1;
    else if (kind === "navchip") G.state.navMaps += 1;
    else G.state.superMinerals += 1;
  }

  // ====== Механика добычи: удар по жиле + рисование руды ======
  function chipOre(sc, sp) {
    if (sp.done || sp.chipT > 0) return;
    sp.hits = Math.min(sp.maxHits, sp.hits + 1);
    sp.chipT = 0.4;
    sp.shake = 4;
    G.audio.tone(sp.hits < sp.maxHits ? 220 - sp.hits * 40 : 110, 0.12, "sawtooth", 0.07);
    // мгновенный всплеск осколков
    G.fx.burst(sp.x, sp.y - 14, "#caa066", 12, 140, 0.5);
  }
  function drawOreVein(ctx, sp) {
    const t = G.time;
    const cx = sp.x + (sp.shake || 0) * Math.sin(t * 80);
    const cy = sp.y;
    if (sp.done) {
      // выработанная воронка
      ctx.fillStyle = "rgba(20,10,6,0.7)";
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 36, 14, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,180,80,0.3)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 36, 14, 0, 0, 7); ctx.stroke();
      // мелкие осколки на земле
      ctx.fillStyle = "rgba(120,80,50,0.6)";
      for (let i = 0; i < 5; i++) {
        const a = sp.seed + i * 1.3;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 26, cy + Math.sin(a) * 10 + 4, 2, 0, 7); ctx.fill();
      }
      return;
    }
    const k = ORE_KINDS[sp.kind] || ORE_KINDS.super;
    // мягкое свечение цветом руды
    const gl = (Math.sin(t * 2.5 + sp.id) + 1) / 2;
    const rg = ctx.createRadialGradient(cx, cy - 8, 4, cx, cy - 8, 70);
    rg.addColorStop(0, `rgba(${k.glow},${0.35 + gl * 0.35})`);
    rg.addColorStop(1, `rgba(${k.glow},0)`);
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy - 8, 70, 0, 7); ctx.fill();
    // тёмная порода (неровная форма)
    ctx.fillStyle = "#3a2a1c";
    ctx.beginPath();
    ctx.moveTo(cx - 36, cy + 14);
    ctx.lineTo(cx - 42, cy - 6);
    ctx.lineTo(cx - 30, cy - 24);
    ctx.lineTo(cx - 8, cy - 32);
    ctx.lineTo(cx + 16, cy - 30);
    ctx.lineTo(cx + 36, cy - 16);
    ctx.lineTo(cx + 40, cy + 6);
    ctx.lineTo(cx + 28, cy + 18);
    ctx.closePath(); ctx.fill();
    // светлый край сверху
    ctx.strokeStyle = "#6a4a30"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 36, cy + 14);
    ctx.lineTo(cx - 42, cy - 6);
    ctx.lineTo(cx - 30, cy - 24);
    ctx.lineTo(cx - 8, cy - 32);
    ctx.lineTo(cx + 16, cy - 30);
    ctx.lineTo(cx + 36, cy - 16);
    ctx.stroke();
    // прогрессирующие трещины
    if (sp.hits >= 1) {
      ctx.strokeStyle = "#1a1008"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx - 18, cy - 26); ctx.lineTo(cx + 4, cy - 12); ctx.lineTo(cx - 8, cy + 6); ctx.stroke();
    }
    if (sp.hits >= 2) {
      ctx.strokeStyle = "#1a1008"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + 18, cy - 22); ctx.lineTo(cx + 4, cy - 8); ctx.lineTo(cx + 22, cy + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 28, cy - 6); ctx.lineTo(cx - 10, cy + 4); ctx.stroke();
    }
    // кристальный кластер цветом руды
    drawCrystalCluster(ctx, cx, cy - 18, sp.hits, t + sp.seed, k);
    // плавающий хинт удара
    ctx.fillStyle = "rgba(20,10,6,0.7)"; rr(ctx, cx - 28, cy - 56, 56, 18, 6); ctx.fill();
    ctx.fillStyle = "#ffd17a"; ctx.font = f(13, "600"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${sp.hits}/${sp.maxHits}`, cx, cy - 47);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    // анимация бура во время удара
    if (sp.chipT > 0) drawDescendingDrill(ctx, cx, cy - 18, sp.chipT);
  }
  function drawCrystalCluster(ctx, cx, cy, hits, ph, kind) {
    const k = kind || ORE_KINDS.super;
    // 3 кристалла, чем больше hits — тем больше осколков отлетело (мельче)
    const pulse = 1 + 0.08 * Math.sin(ph * 4);
    const gems = [
      { dx: -10, dy: 2, h: 18, w: 8, c: k.gems[0] },
      { dx: 2, dy: -2, h: 22, w: 10, c: k.gems[1] },
      { dx: 12, dy: 0, h: 16, w: 7, c: k.gems[2] },
    ];
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      const scale = pulse * Math.max(0.35, 1 - hits * 0.18);
      const w = g.w * scale, h = g.h * scale;
      const x = cx + g.dx, y = cy + g.dy;
      // призма
      const grad = ctx.createLinearGradient(x - w, y - h, x + w, y);
      grad.addColorStop(0, k.coreLo); grad.addColorStop(0.5, g.c); grad.addColorStop(1, k.coreHi);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + w * 0.6, y - h * 0.3);
      ctx.lineTo(x + w * 0.4, y);
      ctx.lineTo(x - w * 0.4, y);
      ctx.lineTo(x - w * 0.6, y - h * 0.3);
      ctx.closePath(); ctx.fill();
      // блик
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.2, y - h * 0.8);
      ctx.lineTo(x + w * 0.15, y - h * 0.4);
      ctx.lineTo(x - w * 0.1, y - h * 0.1);
      ctx.closePath(); ctx.fill();
    }
  }
  function drawDescendingDrill(ctx, cx, oreY, chipT) {
    // бур спускается сверху во время удара и трясётся
    const phase = 1 - chipT / 0.4; // 0..1
    const drillY = oreY - 60 + 50 * phase;
    const sh = Math.sin(G.time * 100) * 2;
    ctx.save(); ctx.translate(cx + sh, drillY);
    // корпус мини-бура
    ctx.fillStyle = "#5a6470"; rr(ctx, -10, -24, 20, 18, 3); ctx.fill();
    ctx.fillStyle = "#cfd6dd"; rr(ctx, -8, -22, 16, 4, 1); ctx.fill();
    // спиральный бит
    ctx.fillStyle = "#caa066";
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5a3010"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(3, 4); ctx.stroke();
    ctx.restore();
  }

  // -- Чертёж меча в древнем зале --
  G.addScene("sword_blueprint", makeRoom({
    name: "sword_blueprint", dayValue: 112,
    start: { x: 120, y: 410 },
    narr: () => G.state.hasSwordBlueprint
      ? "Чертёж меча у вас! Нужны 3 супер-минерала и 3D-принтер на базе."
      : "На древнем алтаре — чертёж меча. Заберите его, чтобы сразиться с Древним.",
    build(s) {
      const px = VIEW.w / 2, py = s.bounds.y + s.bounds.h / 2;
      s.data.px = px; s.data.py = py;
      s.obstacles.push({ x: px - 44, y: py - 30, w: 88, h: 80 });
      s.interactables.push({
        x: px, y: py, r: 110, label: "Взять чертёж ⚔",
        ready: () => !G.state.hasSwordBlueprint,
        act(sc) {
          G.state.hasSwordBlueprint = true; G.audio.pickup();
          G.fx.burst(px, py - 60, "#ffd17a", 36, 240, 1.0);
          G.go("cutscene_sword_blueprint");
        }
      });
      // ещё пара мутантов охраняют чертёж меча
      s.mutants.push(makeMutant(s.bounds.x + 600, s.bounds.y + 250, 2));
      s.mutants.push(makeMutant(s.bounds.x + 700, s.bounds.y + 450, 2));
      placeLog(s, "tomb", s.bounds.x + 150, s.bounds.y + 130); // дневник: «это были МЫ»
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: "← Назад", to: "printer", ready: () => G.state.hasSwordBlueprint };
    },
    drawProps(s, ctx) {
      const px = s.data.px, py = s.data.py;
      // Алтарь
      ctx.fillStyle = "#3a2c22"; rr(ctx, px - 60, py + 56, 120, 16, 3); ctx.fill();
      ctx.fillStyle = "#5a4636"; rr(ctx, px - 58, py + 50, 116, 8, 3); ctx.fill();
      ctx.fillStyle = "#6a5a44"; rr(ctx, px - 52, py + 40, 104, 14, 4); ctx.fill();
      const cg = ctx.createLinearGradient(px - 44, 0, px + 44, 0);
      cg.addColorStop(0, "#3a2c22"); cg.addColorStop(0.5, "#7a5644"); cg.addColorStop(1, "#3a2c22");
      ctx.fillStyle = cg; rr(ctx, px - 44, py - 4, 88, 50, 4); ctx.fill();
      // Меч-эмблема на колонне
      ctx.strokeStyle = "rgba(220,180,120,0.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py + 8); ctx.lineTo(px, py + 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 8, py + 14); ctx.lineTo(px + 8, py + 14); ctx.stroke();
      ctx.fillStyle = "#5a4636"; rr(ctx, px - 50, py - 12, 100, 14, 3); ctx.fill();
      ctx.fillStyle = "#6a5a44"; rr(ctx, px - 50, py - 12, 100, 4, 1); ctx.fill();
      if (!G.state.hasSwordBlueprint) {
        const fy = py - 50 + Math.sin(G.time * 2) * 6;
        const gl = (Math.sin(G.time * 3) + 1) / 2;
        ctx.fillStyle = `rgba(255,200,120,${0.3 + gl * 0.4})`;
        ctx.beginPath(); ctx.arc(px, fy, 36, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(px, fy);
        ctx.fillStyle = "#1f5fae"; rr(ctx, -28, -18, 56, 36, 4); ctx.fill();
        ctx.strokeStyle = "#8fc2ff"; ctx.lineWidth = 2; ctx.strokeRect(-22, -12, 44, 24);
        // мини-меч
        ctx.strokeStyle = "#fff7d6"; ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(6, -4); ctx.stroke();
        ctx.fillStyle = "#bfe0ff"; ctx.font = f(10); ctx.textAlign = "center";
        ctx.fillText("МЕЧ", 0, 16); ctx.textAlign = "left";
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = f(15); ctx.textAlign = "center";
        ctx.fillText("(пусто)", px, py - 30); ctx.textAlign = "left";
      }
    },
  }));

  // -- КОЛИЗЕЙ: босс «Древний Египтянин» --
  G.addScene("coliseum", makeRoom({
    name: "coliseum", dayValue: 120,
    start: { x: 140, y: 480 },
    drain: 0.25,
    narr: (s) => {
      if (G.state.bossDefeated) return "ВЫ ПОБЕДИЛИ! Идите дальше — победа!";
      if (s.data.boss && s.data.boss.hp <= 2) return "Древний обезоружен! Добейте его!";
      return "ДРЕВНИЙ ЕГИПТЯНИН! Бейте «Действием» — мечом наносится больше урона.";
    },
    bg(ctx, s) {
      // Песчаная арена с трибунами
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#3a2410"); g.addColorStop(1, "#1a0e08");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      // песок арены
      ctx.fillStyle = "#a87844"; ctx.fillRect(s.bounds.x, s.bounds.y, s.bounds.w, s.bounds.h);
      const sg = ctx.createLinearGradient(0, s.bounds.y, 0, s.bounds.y + s.bounds.h);
      sg.addColorStop(0, "rgba(0,0,0,0.25)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg; ctx.fillRect(s.bounds.x, s.bounds.y, s.bounds.w, s.bounds.h);
      // окружающие стены с арками
      ctx.fillStyle = "#5a4636";
      ctx.fillRect(s.bounds.x - 26, s.bounds.y - 26, s.bounds.w + 52, 26);
      ctx.fillRect(s.bounds.x - 26, s.bounds.y + s.bounds.h, s.bounds.w + 52, 26);
      ctx.fillRect(s.bounds.x - 26, s.bounds.y, 26, s.bounds.h);
      ctx.fillRect(s.bounds.x + s.bounds.w, s.bounds.y, 26, s.bounds.h);
      // арки на верхней стене
      ctx.fillStyle = "#1a0e06";
      for (let i = 0; i < 6; i++) {
        const ax = s.bounds.x + 80 + i * 140;
        ctx.beginPath(); ctx.arc(ax, s.bounds.y - 13, 13, PI, 0); ctx.fill();
      }
    },
    build(s) {
      s.data.boss = {
        x: VIEW.w / 2 + 200, y: s.bounds.y + 240, hp: 5, maxHp: 5,
        attackT: 1.5, attackKind: 0, telegT: 0, swingT: 0,
        armsLeft: true, armsRight: true, hitT: 0,
        stones: [], pounds: [], debris: [],
      };
      s.data.cameraShake = 0;
      // Препятствие — большая колонна посередине верха
      s.obstacles.push({ x: VIEW.w / 2 - 30, y: s.bounds.y + 60, w: 60, h: 50 });
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => G.state.bossDefeated ? "→ Дальше" : "← Отступить",
        onExit: () => { if (G.state.bossDefeated) G.go("cutscene_scanner_blueprint"); else G.go("printer"); }
      };
    },
    update(s, dt) {
      const bs = s.data.boss;
      if (!bs) return;
      if (G.state.bossDefeated) return;
      if (bs.hitT > 0) bs.hitT -= dt;
      if (bs.swingT > 0) bs.swingT = Math.max(0, bs.swingT - dt);
      bs.telegT = Math.max(0, bs.telegT - dt);
      bs.attackT -= dt;
      // удар робота по боссу — проверяем перекрытие зоны удара и тела босса
      const pz = punchZone(s.robot);
      const bossOverlap = pz && (pz.x + pz.w > bs.x - 50) && (pz.x < bs.x + 50) && (pz.y + pz.h > bs.y - 60) && (pz.y < bs.y + 90);
      if (pz && bs.hitT <= 0 && bossOverlap) {
        const dmg = G.state.hasSword ? 1 : 0.5;
        bs.hp -= dmg; bs.hitT = 0.55;
        G.audio.hit(); s.data.cameraShake = 6;
        G.shake(8); G.hitStop(0.06); G.fx.ring(bs.x, bs.y - 10, "#ffe6a0", 64, 0.34);
        G.fx.burst(bs.x, bs.y, "#ffd17a", 18, 200, 0.6);
        // На 3 HP отбиваем руки
        if (bs.hp <= 3 && bs.armsRight) { bs.armsRight = false; s.toast("Отбили правую руку!", 2); }
        else if (bs.hp <= 2 && bs.armsLeft) { bs.armsLeft = false; s.toast("Отбили левую руку! Теперь добивайте.", 2.4); }
        if (bs.hp <= 0) {
          bs.hp = 0; G.state.bossDefeated = true;
          G.state.hasScannerBlueprint = true; // с босса выпадает чертёж сканера
          G.audio.win(); G.fx.burst(bs.x, bs.y, "#ffe14a", 80, 460, 1.6);
          s.toast("ДРЕВНИЙ ПОВЕРЖЕН! Он обронил странный чертёж... Идите к выходу слева.", 4.0);
          return;
        }
      }
      // Босс атакует
      if (bs.attackT <= 0 && bs.telegT <= 0) {
        const canStones = bs.armsRight || bs.armsLeft;
        const choices = [];
        if (canStones) choices.push("stones");
        choices.push("pound");
        if (bs.hp >= 3) choices.push("walls");
        bs.attackKind = choices[Math.floor(Math.random() * choices.length)];
        bs.telegT = 0.6;
      }
      if (bs.telegT > 0 && bs.telegT < 0.05) {
        // launch — запускаем взмах рукой (follow-through)
        bs.swingT = 0.3;
        if (bs.attackKind === "stones") {
          // 2-3 камня в робота
          const n = 2 + (bs.armsLeft && bs.armsRight ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const dx = s.robot.x - bs.x, dy = s.robot.y - bs.y;
            const d = Math.hypot(dx, dy) || 1;
            const sp = 260;
            const spread = (i - (n - 1) / 2) * 0.2;
            const ang = Math.atan2(dy, dx) + spread;
            bs.stones.push({ x: bs.x, y: bs.y - 30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 2.5 });
          }
          G.audio.tone(200, 0.18, "square", 0.07);
        } else if (bs.attackKind === "pound") {
          bs.pounds.push({ x: bs.x, y: bs.y + 20, r: 0, max: 180, life: 0.6 });
          s.data.cameraShake = 10; G.shake(14); G.hitStop(0.05);
          G.audio.boom();
        } else if (bs.attackKind === "walls") {
          // 4-5 кусков стен падают сверху
          for (let i = 0; i < 5; i++) {
            const dx = s.bounds.x + 120 + Math.random() * (s.bounds.w - 240);
            bs.debris.push({ x: dx, y: s.bounds.y - 20, vy: 0, telegraph: 0.6, life: 2 });
          }
          G.audio.tone(120, 0.4, "sawtooth", 0.06);
        }
        bs.attackT = bs.hp <= 2 ? 1.8 : 2.4; // быстрее во второй фазе
      }
      // Движение камней
      for (let i = bs.stones.length - 1; i >= 0; i--) {
        const st = bs.stones[i];
        st.x += st.vx * dt; st.y += st.vy * dt; st.vy += 240 * dt; st.life -= dt;
        if (Math.hypot(st.x - s.robot.x, st.y - s.robot.y) < s.robot.r + 14) {
          s.hurt(10, { x: st.vx * 0.04, y: st.vy * 0.04 });
          bs.stones.splice(i, 1); continue;
        }
        if (st.life <= 0 || st.y > s.bounds.y + s.bounds.h + 40) bs.stones.splice(i, 1);
      }
      // Pound шок
      for (let i = bs.pounds.length - 1; i >= 0; i--) {
        const p = bs.pounds[i];
        p.r += 320 * dt; p.life -= dt;
        const dr = Math.hypot(s.robot.x - p.x, s.robot.y - p.y);
        if (Math.abs(dr - p.r) < 18 && p.life > 0.2 && (!p._hit)) {
          p._hit = true; s.hurt(11, { x: (s.robot.x - p.x) * 0.04, y: (s.robot.y - p.y) * 0.04 });
        }
        if (p.life <= 0 || p.r > p.max) bs.pounds.splice(i, 1);
      }
      // Падающие обломки
      for (let i = bs.debris.length - 1; i >= 0; i--) {
        const d = bs.debris[i];
        if (d.telegraph > 0) { d.telegraph -= dt; continue; }
        d.vy += 600 * dt; d.y += d.vy * dt; d.life -= dt;
        if (d.y > s.robot.y - 20 && Math.abs(d.x - s.robot.x) < 22) {
          s.hurt(12, { x: 0, y: 20 });
          bs.debris.splice(i, 1); continue;
        }
        if (d.life <= 0 || d.y > s.bounds.y + s.bounds.h + 30) bs.debris.splice(i, 1);
      }
      if (s.data.cameraShake > 0) s.data.cameraShake = Math.max(0, s.data.cameraShake - dt * 50);
    },
    drawProps(s, ctx) {
      const bs = s.data.boss;
      if (!bs) return;
      // Камера-шейк
      if (s.data.cameraShake > 0) {
        ctx.save();
        ctx.translate((Math.random() - 0.5) * s.data.cameraShake, (Math.random() - 0.5) * s.data.cameraShake);
      }
      // Обломки-телеграф (тень падения + предупреждающий маркер)
      for (const d of bs.debris) {
        if (d.telegraph > 0) {
          const tp = 1 - d.telegraph / 0.6;
          // мигающая красная зона на полу
          ctx.fillStyle = `rgba(220,40,40,${0.3 + 0.3 * Math.abs(Math.sin(G.time * 16))})`;
          ctx.beginPath(); ctx.ellipse(d.x, s.robot.y + 6, 24, 8, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = `rgba(255,180,40,${0.8})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(d.x, s.robot.y + 6, 24, 8, 0, 0, 7); ctx.stroke();
          // силуэт надвигающегося обломка
          ctx.fillStyle = `rgba(58,44,34,${0.5 + tp * 0.4})`;
          drawDebrisChunk(ctx, d.x, s.bounds.y - 18 - tp * 6, 0);
          // линии падения
          ctx.strokeStyle = `rgba(255,180,40,${0.25 + tp * 0.25})`; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(d.x - 10, s.bounds.y); ctx.lineTo(d.x - 10, s.robot.y + 6);
          ctx.moveTo(d.x + 10, s.bounds.y); ctx.lineTo(d.x + 10, s.robot.y + 6);
          ctx.stroke();
        } else {
          // летящий обломок с вращением
          const rotAng = (d.y * 0.02);
          drawDebrisChunk(ctx, d.x, d.y, rotAng);
          // лёгкий шлейф пыли
          ctx.fillStyle = "rgba(150,120,90,0.25)";
          ctx.beginPath(); ctx.ellipse(d.x, d.y + 18, 14, 4, 0, 0, 7); ctx.fill();
        }
      }
      // Камни — летят с вращением и пылевым шлейфом
      for (const st of bs.stones) {
        // шлейф
        ctx.fillStyle = "rgba(150,120,90,0.25)";
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(st.x - st.vx * i * 0.025, st.y - st.vy * i * 0.025, 7 - i * 1.5, 0, 7);
          ctx.fill();
        }
        // камень
        const rot = Math.atan2(st.vy, st.vx) + (st.life * 8);
        drawProjectileStone(ctx, st.x, st.y, rot);
      }
      // Ударные волны — двойное кольцо + трещины на земле
      for (const p of bs.pounds) {
        const lp = Math.max(0, Math.min(1, p.life / 0.6));
        // внешнее кольцо
        ctx.strokeStyle = `rgba(255,180,80,${0.75 * lp})`; ctx.lineWidth = 7 * lp;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke();
        // внутреннее кольцо ярче
        ctx.strokeStyle = `rgba(255,240,180,${0.9 * lp})`; ctx.lineWidth = 3 * lp;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 6, 0, 7); ctx.stroke();
        // радиальные трещины
        ctx.strokeStyle = `rgba(50,30,18,${0.55 * lp})`; ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const ang = i * Math.PI / 4 + p.r * 0.01;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(ang) * (p.r - 8), p.y + Math.sin(ang) * (p.r - 8));
          ctx.lineTo(p.x + Math.cos(ang) * (p.r + 4), p.y + Math.sin(ang) * (p.r + 4));
          ctx.stroke();
        }
        // облачко пыли по периметру
        ctx.fillStyle = `rgba(180,140,100,${0.18 * lp})`;
        for (let i = 0; i < 12; i++) {
          const ang = i * Math.PI / 6;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(ang) * p.r, p.y + Math.sin(ang) * p.r, 12 * lp, 0, 7); ctx.fill();
        }
      }
      // БОСС
      drawBoss(ctx, bs);
      // полоска HP сверху
      const bx = VIEW.w / 2 - 200, by = 82, bw = 400;
      ctx.fillStyle = "rgba(0,0,0,0.65)"; rr(ctx, bx, by, bw, 24, 6); ctx.fill();
      ctx.fillStyle = "#d12b29"; rr(ctx, bx + 3, by + 3, (bw - 6) * (bs.hp / bs.maxHp), 18, 4); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, 24);
      ctx.fillStyle = "#fff"; ctx.font = f(15, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`ДРЕВНИЙ ЕГИПТЯНИН ${Math.ceil(bs.hp)}/${bs.maxHp}`, bx + bw / 2, by + 12);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      // Если меч у робота — рисуем меч в руке
      if (G.state.hasSword) drawRobotSword(ctx, s.robot);
      if (s.data.cameraShake > 0) ctx.restore();
    },
  }));
  function drawBoss(ctx, bs) {
    const t = G.time;
    // Дыхание + лёгкое покачивание корпусом
    const breath = Math.sin(t * 1.6) * 4;
    const sway = Math.sin(t * 0.9) * 3;
    // При телеграфе — наклон корпуса + дрожь
    const tele = bs.telegT > 0;
    const teleP = tele ? 1 - bs.telegT / 0.6 : 0;
    const teleShake = tele ? Math.sin(t * 60) * 2.5 * teleP : 0;
    const hurtP = bs.hitT > 0 ? bs.hitT / 0.55 : 0;
    const hurtShake = hurtP > 0 ? Math.sin(t * 80) * 4 * hurtP : 0;
    const bx = bs.x + sway + teleShake + hurtShake;
    const by = bs.y + breath;
    ctx.save(); ctx.translate(bx, by);
    // тень (дышит)
    const shAlpha = 0.4 + Math.abs(breath) * 0.005;
    ctx.fillStyle = `rgba(0,0,0,${shAlpha})`;
    ctx.beginPath(); ctx.ellipse(0, 90, 60 + Math.abs(breath) * 0.4, 14, 0, 0, 7); ctx.fill();
    // ноги-сандалии (короткие, с лямками)
    const legSway = Math.sin(t * 1.6 + 1) * 2;
    for (const lx of [-16, 16]) {
      ctx.fillStyle = "#caa066";
      rr(ctx, lx - 9, 78, 18, 10, 2); ctx.fill();
      ctx.fillStyle = "#5a3a16"; rr(ctx, lx - 11, 86, 22, 4, 1); ctx.fill();
      // ремешки
      ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx - 7, 78); ctx.lineTo(lx, 86); ctx.moveTo(lx + 7, 78); ctx.lineTo(lx, 86); ctx.stroke();
    }
    // нижние половые ленты (передник)
    ctx.fillStyle = "#caa066";
    for (let i = -2; i <= 2; i++) {
      rr(ctx, i * 12 - 5, 42 + legSway * 0.3, 10, 40, 2); ctx.fill();
    }
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) ctx.strokeRect(i * 12 - 5, 42 + legSway * 0.3, 10, 40);
    // тело — туника с поясом
    const tunic = ctx.createLinearGradient(0, -10, 0, 80);
    tunic.addColorStop(0, "#dac0a0"); tunic.addColorStop(0.5, "#caa066"); tunic.addColorStop(1, "#9a7842");
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.moveTo(-46, 50); ctx.quadraticCurveTo(-40, 20, -36, -10);
    ctx.lineTo(36, -10);
    ctx.quadraticCurveTo(40, 20, 46, 50); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 3; ctx.stroke();
    // царапины от ранений (становятся видны после потери HP)
    if (bs.hp <= 3) {
      ctx.strokeStyle = "#7a2a18"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-20, 12); ctx.lineTo(-8, 28); ctx.stroke();
    }
    if (bs.hp <= 2) {
      ctx.strokeStyle = "#7a2a18"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(18, 8); ctx.lineTo(28, 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(6, 18); ctx.stroke();
    }
    // пояс с золотыми вставками
    const belt = ctx.createLinearGradient(0, 30, 0, 42);
    belt.addColorStop(0, "#caa066"); belt.addColorStop(0.5, "#7a5a2a"); belt.addColorStop(1, "#5a3a16");
    ctx.fillStyle = belt; ctx.fillRect(-46, 30, 92, 12);
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 1.5; ctx.strokeRect(-46, 30, 92, 12);
    ctx.fillStyle = "#ffd24a";
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * 18, 36, 2.5, 0, 7); ctx.fill(); }
    // золотая пектораль с гравировкой
    const pect = ctx.createLinearGradient(0, -8, 0, 28);
    pect.addColorStop(0, "#fff0a0"); pect.addColorStop(0.5, "#ffd24a"); pect.addColorStop(1, "#a87830");
    ctx.fillStyle = pect; ctx.beginPath();
    ctx.moveTo(-28, -8); ctx.lineTo(28, -8); ctx.lineTo(36, 18); ctx.lineTo(0, 30); ctx.lineTo(-36, 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 2; ctx.stroke();
    // глиф на пекторали — анх
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 6, 4, 0, 7);
    ctx.moveTo(0, 10); ctx.lineTo(0, 22);
    ctx.moveTo(-6, 16); ctx.lineTo(6, 16);
    ctx.stroke();
    // === Руки ===
    // Анимация рук: idle / telegraph (замах) / swing (взмах) / hurt
    let lAng = -0.3, rAng = 0.3;
    let lLift = 0, rLift = 0;
    const swinging = bs.swingT > 0 && !tele;
    if (tele) {
      if (bs.attackKind === "stones") {
        // рука с камнем поднята над головой для броска
        if (bs.armsRight) { rAng = -1.9 - 0.3 * teleP; rLift = -22 * teleP; }
        else if (bs.armsLeft) { lAng = 1.9 + 0.3 * teleP; lLift = -22 * teleP; }
      } else if (bs.attackKind === "pound") {
        // обе руки подняты над головой
        if (bs.armsLeft) { lAng = 1.1; lLift = -40 * teleP; }
        if (bs.armsRight) { rAng = -1.1; rLift = -40 * teleP; }
      } else if (bs.attackKind === "walls") {
        // руки развёрнуты в стороны "колдует"
        if (bs.armsLeft) { lAng = -1.4 - 0.2 * teleP; lLift = -10 * teleP; }
        if (bs.armsRight) { rAng = 1.4 + 0.2 * teleP; rLift = -10 * teleP; }
      }
    } else if (swinging) {
      // sw: 0 в момент пуска → 1 в конце взмаха; e — быстрый старт, плавный доводчик
      const sw = 1 - bs.swingT / 0.3;
      const e = Math.sin(sw * PI / 2);
      const bump = Math.sin(sw * PI);
      if (bs.attackKind === "stones") {
        // бросковая рука хлёстко идёт вниз-вперёд через тело
        if (bs.armsRight) { rAng = -1.9 * (1 - e) + 0.3 * e + 0.9 * bump; rLift = -22 * (1 - e); }
        else if (bs.armsLeft) { lAng = 1.9 * (1 - e) - 0.3 * e - 0.9 * bump; lLift = -22 * (1 - e); }
      } else if (bs.attackKind === "pound") {
        // обе руки обрушиваются вниз — кулаки бьют в землю
        if (bs.armsLeft) { lAng = 1.1 * (1 - e) - 0.3 * e; lLift = -40 * (1 - e) + 22 * bump; }
        if (bs.armsRight) { rAng = -1.1 * (1 - e) + 0.3 * e; rLift = -40 * (1 - e) + 22 * bump; }
      } else if (bs.attackKind === "walls") {
        // резкий толчок руками наружу-вверх (каст)
        if (bs.armsLeft) { lAng = -1.4 * (1 - e) - 0.3 * e - 0.35 * bump; lLift = -10 * (1 - e) - 10 * bump; }
        if (bs.armsRight) { rAng = 1.4 * (1 - e) + 0.3 * e + 0.35 * bump; rLift = -10 * (1 - e) - 10 * bump; }
      }
    } else {
      const handAng = Math.sin(t * 2.5) * 0.18;
      lAng = -0.3 + handAng; rAng = 0.3 - handAng;
    }
    drawBossArm(ctx, -36, 5 + lLift, lAng, bs.armsLeft, true, tele && bs.attackKind === "stones" && !bs.armsRight, teleP);
    drawBossArm(ctx, 36, 5 + rLift, rAng, bs.armsRight, false, tele && bs.attackKind === "stones" && bs.armsRight, teleP);
    // === Голова и немес ===
    const headTurn = tele ? Math.sin(t * 6) * 0.05 : Math.sin(t * 0.7) * 0.06;
    ctx.save(); ctx.translate(0, -22); ctx.rotate(headTurn);
    // боковые крылья немеса
    ctx.fillStyle = "#1a3a58"; ctx.beginPath();
    ctx.moveTo(-30, 4); ctx.lineTo(-46, 14); ctx.lineTo(-28, 28); ctx.lineTo(-26, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(30, 4); ctx.lineTo(46, 14); ctx.lineTo(28, 28); ctx.lineTo(26, 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#0a1a3a"; ctx.lineWidth = 2; ctx.stroke();
    // лицо
    ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.ellipse(0, 0, 22, 26, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2.5; ctx.stroke();
    // подводка глаз (макияж фараона)
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-14, -2); ctx.lineTo(-4, 0);
    ctx.moveTo(4, 0); ctx.lineTo(14, -2);
    ctx.stroke();
    // глаза
    if (bs.hp > 2) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-8, 0, 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(8, 0, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "#1a2a4a"; ctx.beginPath(); ctx.arc(-8, 0, 2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(8, 0, 2, 0, 7); ctx.fill();
      // блик
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-7, -1, 0.6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -1, 0.6, 0, 7); ctx.fill();
    } else {
      // злые горящие щёлочки во второй фазе
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(-13, -2, 10, 3); ctx.fillRect(3, -2, 10, 3);
      ctx.fillStyle = "#ff5a3a"; ctx.fillRect(-12, -1, 8, 1); ctx.fillRect(4, -1, 8, 1);
      // огонь над глазами
      const fg = (Math.sin(t * 8) + 1) / 2;
      ctx.fillStyle = `rgba(255,90,40,${0.5 + fg * 0.3})`;
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-8, -10 - fg * 4); ctx.lineTo(-6, -4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(8, -10 - fg * 4); ctx.lineTo(10, -4); ctx.fill();
    }
    // борода-плетёнка
    ctx.fillStyle = "#1a1a1a"; ctx.beginPath();
    ctx.moveTo(-6, 20); ctx.lineTo(6, 20); ctx.lineTo(4, 38); ctx.lineTo(-4, 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#caa066"; ctx.fillRect(-5, 36, 10, 2); // золотой колпачок
    // немес-верх (полосатый)
    ctx.fillStyle = "#1a3a58"; ctx.beginPath();
    ctx.moveTo(-26, -20); ctx.quadraticCurveTo(0, -34, 26, -20);
    ctx.lineTo(26, 6); ctx.lineTo(-26, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#0a1a3a"; ctx.lineWidth = 2; ctx.stroke();
    // полосы золотом
    ctx.fillStyle = "#ffd24a";
    for (let i = 0; i < 4; i++) ctx.fillRect(-26, -16 + i * 6, 52, 2);
    // змея-урей на лбу (объёмная)
    ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.arc(0, -18, 5, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd24a"; ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(-5, -10); ctx.lineTo(0, -14); ctx.lineTo(5, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc(-1.5, -18, 0.8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(1.5, -18, 0.8, 0, 7); ctx.fill();
    ctx.restore();
    // === Эффекты ===
    // вспышка урона
    if (hurtP > 0) {
      ctx.fillStyle = `rgba(255,80,60,${hurtP * 0.55})`;
      ctx.fillRect(-52, -52, 104, 144);
      // мелкие осколки разлетающиеся
      for (let i = 0; i < 3; i++) {
        const a = (t * 6 + i) * 1.7, d = 30 + hurtP * 20;
        ctx.fillStyle = "rgba(255,180,40,0.6)";
        ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 3, 3);
      }
    }
    // телеграф атаки — внутри тела (отметка под ногами)
    if (tele) {
      const color = bs.attackKind === "stones" ? "rgba(255,140,40,$A)" :
                    bs.attackKind === "pound" ? "rgba(255,80,40,$A)" : "rgba(180,80,200,$A)";
      const alpha = (Math.sin(t * 12) + 1) / 2 * 0.6 + 0.3;
      ctx.fillStyle = color.replace("$A", alpha.toFixed(2));
      ctx.beginPath(); ctx.ellipse(0, 90, 60, 16, 0, 0, 7); ctx.fill();
      // подпись атаки
      ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#1a0a04"; ctx.lineWidth = 4;
      ctx.font = `900 italic 22px ${G.FONT}`; ctx.textAlign = "center";
      const lbl = bs.attackKind === "stones" ? "БРОСОК!" : bs.attackKind === "pound" ? "ЗЕМЛЕТРЯСЕНИЕ!" : "ОБРУШЕНИЕ!";
      ctx.strokeText(lbl, 0, -84);
      ctx.fillText(lbl, 0, -84);
      ctx.textAlign = "left";
      // светящаяся аура заряжающейся атаки
      const auraR = 70 + teleP * 28;
      const aura = ctx.createRadialGradient(0, 30, 20, 0, 30, auraR);
      const ac = bs.attackKind === "stones" ? "255,160,60" : bs.attackKind === "pound" ? "255,80,50" : "180,90,210";
      aura.addColorStop(0, `rgba(${ac},${0.3 + teleP * 0.3})`);
      aura.addColorStop(1, `rgba(${ac},0)`);
      ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(0, 30, auraR, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function drawBossArm(ctx, ox, oy, angle, present, isLeft, holdingStone, teleP) {
    if (!present) {
      // культя — кровавый обрубок
      ctx.fillStyle = "#5a3a16";
      ctx.beginPath(); ctx.arc(ox, oy + 3, 12, 0, 7); ctx.fill();
      ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#7a2a18"; ctx.beginPath(); ctx.arc(ox, oy + 3, 6, 0, 7); ctx.fill();
      // капли
      ctx.fillStyle = "rgba(122,42,24,0.6)";
      ctx.beginPath(); ctx.arc(ox - 3, oy + 14, 1.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + 4, oy + 18, 1.5, 0, 7); ctx.fill();
      return;
    }
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(angle);
    // плечевой браслет (золото)
    ctx.fillStyle = "#ffd24a"; rr(ctx, -10, -2, 20, 6, 1); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1; ctx.strokeRect(-10, -2, 20, 6);
    // верхнее плечо (плотнее)
    const armG = ctx.createLinearGradient(0, 0, 0, 56);
    armG.addColorStop(0, "#caa066"); armG.addColorStop(0.5, "#a07a44"); armG.addColorStop(1, "#7a5a2a");
    ctx.fillStyle = armG; rr(ctx, -9, 4, 18, 50, 4); ctx.fill();
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2; ctx.strokeRect(-9, 4, 18, 50);
    // нарукавник
    ctx.fillStyle = "#ffd24a"; rr(ctx, -10, 30, 20, 5, 1); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1; ctx.strokeRect(-10, 30, 20, 5);
    // кулак
    const fistG = ctx.createRadialGradient(0, 60, 2, 0, 60, 14);
    fistG.addColorStop(0, "#dab080"); fistG.addColorStop(1, "#7a5a2a");
    ctx.fillStyle = fistG; ctx.beginPath(); ctx.arc(0, 60, 12, 0, 7); ctx.fill();
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2; ctx.stroke();
    // кольца на пальцах
    ctx.fillStyle = "#ffd24a";
    for (let i = -1; i <= 1; i++) { ctx.fillRect(i * 4 - 1, 60, 2, 4); }
    // камень в кулаке (если телеграф stones)
    if (holdingStone) {
      const scale = 0.6 + teleP * 0.4;
      ctx.save(); ctx.translate(0, 60); ctx.scale(scale, scale);
      ctx.fillStyle = "#6a5a44";
      ctx.beginPath();
      ctx.moveTo(-12, 0); ctx.lineTo(-8, -10); ctx.lineTo(6, -12); ctx.lineTo(12, -4); ctx.lineTo(10, 8); ctx.lineTo(-4, 10); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2; ctx.stroke();
      // трещины
      ctx.strokeStyle = "rgba(50,30,18,0.7)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(4, 4); ctx.stroke();
      // искры/пыль во время заряда
      ctx.fillStyle = `rgba(255,180,40,${teleP * 0.6})`;
      for (let i = 0; i < 4; i++) {
        const a = (G.time * 8 + i) * 1.5;
        ctx.fillRect(Math.cos(a) * 16, Math.sin(a) * 12, 2, 2);
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function drawProjectileStone(ctx, x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 14);
    g.addColorStop(0, "#9a8a6a"); g.addColorStop(1, "#3a2c22");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(-8, -10); ctx.lineTo(4, -12); ctx.lineTo(11, -3); ctx.lineTo(9, 7); ctx.lineTo(-3, 11); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#1a0e08"; ctx.lineWidth = 1.5; ctx.stroke();
    // трещины
    ctx.strokeStyle = "rgba(20,14,8,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(2, 0); ctx.lineTo(-2, 6); ctx.stroke();
    // блик
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath(); ctx.arc(-4, -4, 2.5, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawDebrisChunk(ctx, x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    // основной кирпич-камень
    const g = ctx.createLinearGradient(-14, -14, 14, 14);
    g.addColorStop(0, "#6a5a44"); g.addColorStop(1, "#2a1e14");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-14, -12); ctx.lineTo(12, -14); ctx.lineTo(14, 10); ctx.lineTo(-10, 14); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#1a0e06"; ctx.lineWidth = 2; ctx.stroke();
    // иероглифический скол на боку
    ctx.strokeStyle = "rgba(20,14,8,0.6)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(2, -4); ctx.lineTo(-4, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(8, 4); ctx.stroke();
    // мшистые края
    ctx.fillStyle = "rgba(255,200,120,0.1)";
    ctx.fillRect(-12, -10, 4, 18);
    ctx.restore();
  }
  function drawRobotSword(ctx, robot) {
    const face = robot.face || 1;
    const punch = robot.punching || 0;
    const total = 0.3;
    // Фазы: 0..0.33 замах вверх-назад, 0.33..0.66 удар по дуге, 0.66..1 возврат
    const phase = punch > 0 ? (total - punch) / total : -1;
    let angle, lift;
    if (phase < 0) { angle = 0.55; lift = 0; }
    else if (phase < 0.33) { const p = phase / 0.33; angle = 0.55 + (Math.PI * 0.55) * p; lift = -7 * p; }
    else if (phase < 0.66) { const p = (phase - 0.33) / 0.33; angle = 2.28 - (Math.PI * 1.5) * p; lift = -7 + 9 * p; }
    else { const p = (phase - 0.66) / 0.34; angle = -2.43 + (2.43 + 0.55) * p; lift = 2 - 2 * p; }
    // плечо робота (точка вращения руки) — на корпусе со стороны лица
    const sx = robot.x + face * 8, sy = robot.y - 5 + lift;
    const HAND = 20; // длина предплечья от плеча до кисти

    // Трейл клинка во время удара (в системе плеча)
    if (phase >= 0.3 && phase < 0.66) {
      ctx.save(); ctx.translate(sx, sy); ctx.scale(face, 1);
      const tprog = (phase - 0.33) / 0.33;
      for (let i = 0; i < 7; i++) {
        const trailP = tprog - i * 0.045; if (trailP < 0) continue;
        const a = 2.28 - (Math.PI * 1.5) * trailP;
        ctx.save(); ctx.rotate(a);
        ctx.strokeStyle = `rgba(190,230,255,${(1 - i / 7) * 0.55})`;
        ctx.lineWidth = 5 - i * 0.6; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(HAND + 6, 0); ctx.lineTo(HAND + 44, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // === РУКА + МЕЧ вращаются вокруг плеча ===
    ctx.save(); ctx.translate(sx, sy); ctx.scale(face, 1); ctx.rotate(angle);
    // плечевой сустав
    ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 1.5; ctx.stroke();
    // предплечье (двигается вместе с мечом)
    ctx.strokeStyle = "#cdd4db"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(HAND, 0); ctx.stroke();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(HAND - 2, 0); ctx.stroke();
    // кисть-захват
    ctx.fillStyle = "#aeb6bf"; ctx.beginPath(); ctx.arc(HAND, 0, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 1.5; ctx.stroke();
    // === МЕЧ (рукоять у кисти, x≈HAND) ===
    const h = HAND;
    const blade = ctx.createLinearGradient(0, -5, 0, 5);
    blade.addColorStop(0, "#9aa6b3"); blade.addColorStop(0.5, "#f0f4fa"); blade.addColorStop(1, "#7e8893");
    ctx.fillStyle = blade;
    ctx.beginPath();
    ctx.moveTo(h + 14, -6); ctx.lineTo(h + 48, -2); ctx.lineTo(h + 54, 0); ctx.lineTo(h + 48, 2); ctx.lineTo(h + 14, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = "rgba(60,80,100,0.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(h + 18, 0); ctx.lineTo(h + 46, 0); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(h + 20, -3, 22, 1.2);
    // крестовина
    const cg = ctx.createLinearGradient(0, -10, 0, 10);
    cg.addColorStop(0, "#ffd24a"); cg.addColorStop(0.5, "#caa066"); cg.addColorStop(1, "#7a5a2a");
    ctx.fillStyle = cg; rr(ctx, h + 8, -10, 8, 20, 1); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1; ctx.strokeRect(h + 8, -10, 8, 20);
    // рукоять (в кисти)
    ctx.fillStyle = "#5a3a16"; rr(ctx, h - 2, -3, 10, 6, 1); ctx.fill();
    ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.arc(h - 4, 0, 3, 0, 7); ctx.fill();
    ctx.restore();
    // Вспышка при попадании (середина дуги)
    if (phase >= 0.45 && phase < 0.6) {
      const t = (phase - 0.45) / 0.15;
      ctx.save(); ctx.translate(robot.x + face * 56, robot.y);
      ctx.fillStyle = `rgba(255,250,200,${(1 - t) * 0.5})`;
      ctx.beginPath(); ctx.arc(0, 0, 18 * (1 - t * 0.5), 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  // -- ФИНАЛЬНАЯ ПОБЕДА --
  G.addScene("final_victory", {
    recharge: false, useJoystick: false,
    enter() { this.t = 0; this.b = { x: VIEW.w / 2 - 130, y: 690, w: 260, h: 56, text: "В меню", fs: 24 }; },
    update(dt) {
      this.t += dt;
      if (Math.random() > 0.5) G.fx.burst(Math.random() * VIEW.w, -10, ["#7be0ff", "#ff8a4a", "#7de08a", "#ffd17a", "#d12b29"][Math.floor(Math.random() * 5)], 1, 70, 1.8);
    },
    onTap(x, y) { if (rectHit(this.b, x, y)) { G.clearSave(); G.resetState(); G.go("menu"); } },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#0a1830"); g.addColorStop(1, "#0a0608");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      starfield(ctx, 90, 33);
      const cx = VIEW.w / 2;
      // взлетающий древний корабль с плазменным выхлопом
      const rise = Math.min(1, this.t / 2.5);
      const shipY = 420 - rise * 60 + Math.sin(G.time * 2) * 4;
      // выхлоп двигателя
      const fl = (Math.sin(G.time * 20) + 1) / 2;
      const flame = ctx.createLinearGradient(cx, shipY + 40, cx, shipY + 140 + fl * 30);
      flame.addColorStop(0, "rgba(255,250,200,0.95)"); flame.addColorStop(0.4, "rgba(123,224,255,0.7)"); flame.addColorStop(1, "rgba(60,120,220,0)");
      ctx.fillStyle = flame;
      ctx.beginPath(); ctx.moveTo(cx - 22, shipY + 40); ctx.lineTo(cx + 22, shipY + 40); ctx.lineTo(cx + 8, shipY + 150 + fl * 30); ctx.lineTo(cx - 8, shipY + 150 + fl * 30); ctx.closePath(); ctx.fill();
      // корпус корабля
      ctx.save(); ctx.translate(cx, shipY);
      const hull = ctx.createLinearGradient(-40, 0, 40, 0);
      hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
      ctx.fillStyle = hull;
      ctx.beginPath(); ctx.moveTo(0, -80); ctx.quadraticCurveTo(34, -40, 30, 40); ctx.lineTo(-30, 40); ctx.quadraticCurveTo(-34, -40, 0, -80); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 2; ctx.stroke();
      // иллюминатор
      ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -30, 11, 0, 7); ctx.fill();
      ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 2; ctx.stroke();
      // марсианский глиф на борту
      ctx.fillStyle = "#ff8a4a"; ctx.font = `700 18px ${G.FONT}`; ctx.textAlign = "center"; ctx.fillText("☥", 0, 14);
      // крылья-стабилизаторы
      ctx.fillStyle = "#9aa3ad";
      ctx.beginPath(); ctx.moveTo(-30, 20); ctx.lineTo(-52, 50); ctx.lineTo(-30, 40); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(30, 20); ctx.lineTo(52, 50); ctx.lineTo(30, 40); ctx.closePath(); ctx.fill();
      ctx.restore();
      // заголовок
      ctx.textAlign = "center";
      const ice = G.state.hasJumpDrive;
      ctx.fillStyle = "#ffd17a"; ctx.font = `800 50px ${G.FONT}`;
      ctx.fillText(ice ? "ДОРОГА ДОМОЙ!" : "ПОБЕГ С МАРСА!", cx, 120);
      // Концовка зависит от собранных дневников (разные финалы)
      const logs = G.state.logs || 0;
      let story;
      const ilogs = G.state.iceLogs || 0;
      if (ice) {
        story = ilogs >= 3
          ? "Ледяные журналы сложились в правду: луна — кладбище кораблей прошлой экспедиции, а Страж хранил сердечник их двигателя. Робот разбил лёд, забрал сердечник и улетает домой — поклявшись вернуться за теми, кто застрял здесь."
          : "Побег с Марса был лишь половиной пути: прыжок забросил робота на ледяную луну. Он собрал 3 крио-ядра, вырубил морозный кристалл и вырвал сердечник у Морозного Стража — двигатель собран. Курс домой проложен.";
      } else if (logs >= 3) story = "Дневники раскрыли правду: гробницы построила ПРОШЛАЯ экспедиция. Робот разгадал тайну, собрал корабль и улетает — чтобы вернуться с подмогой за теми, кто остался.";
      else if (logs >= 1) story = "Робот сразил Древнего, собрал сканер и построил двигатель древнего корабля. Обрывки чужих дневников намекают: он здесь не первый… Пора домой!";
      else story = "Робот сразил Древнего, собрал сканер, откопал артефакт и по марсианским технологиям построил двигатель корабля. Тайна Марса осталась за спиной. Пора домой!";
      ctx.fillStyle = "#ffe9c8"; ctx.font = f(20);
      G.wrapText(ctx, story, cx, 520, 840, 27);
      // ИТОГОВЫЙ СЧЁТ (score-attack): меньше дней, меньше разрядов, больше дневников = выше ранг
      const deaths = G.state.deaths || 0, day = G.state.day;
      const score = Math.max(0, Math.round((100 - day) * 10 + (logs + ilogs) * 60 + (3 - Math.min(3, deaths)) * 80 - deaths * 40));
      const tier = score >= 700 ? "★★★ ЛЕГЕНДА" : score >= 450 ? "★★ Герой" : score >= 220 ? "★ Выживший" : "Спасшийся";
      const rank = ice ? (ilogs >= 3 ? "покоритель двух миров" : "ледяной первопроходец") : (logs >= 3 ? "разгадавший тайну Марса" : "беглец с Марса");
      ctx.fillStyle = "#ffd17a"; ctx.font = `800 30px ${G.FONT}`;
      ctx.fillText(`${tier} · ${score} очков`, cx, 600);
      ctx.fillStyle = "#7de08a"; ctx.font = `600 19px ${G.FONT}`;
      ctx.fillText(`☀ День ${day}/100 · 📜 ${logs}/3${ice ? ` · 🧊 ${ilogs}/3` : ""} · 🔋 разрядов: ${deaths} · ${rank}`, cx, 634);
      // авторская подпись
      ctx.fillStyle = `rgba(150,225,255,${0.7 + 0.3 * Math.sin(G.time * 2)})`; ctx.font = f(15, "700");
      ctx.fillText("✦ designed by Lev Popchenko · игра по сюжету Льва, 6 лет ✦", cx, 664);
      G.button(ctx, this.b, true);
      ctx.textAlign = "left";
    },
  });

  /* =========================================================================
     ПОБЕДА
     ========================================================================= */
  G.addScene("victory", {
    dayValue: 100, recharge: false, useJoystick: false,
    enter() { this.t = 0; this.b = { x: VIEW.w / 2 - 130, y: 590, w: 260, h: 60, text: "В меню", fs: 24 }; },
    update(dt) { this.t += dt; if (Math.random() > 0.6) G.fx.burst(Math.random() * VIEW.w, -10, ["#7be0ff", "#ff8a4a", "#7de08a", "#ffd17a"][Math.floor(Math.random() * 4)], 1, 60, 1.6); },
    onTap(x, y) { if (rectHit(this.b, x, y)) { G.clearSave(); G.resetState(); G.go("menu"); } },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#0a2a3a"); g.addColorStop(1, "#1a0d0a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      starfield(ctx, 80, 33);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd17a"; ctx.font = f(46, "800");
      ctx.fillText("БУР НАПЕЧАТАН!", VIEW.w / 2, 150);
      G.drawRobot(ctx, VIEW.w / 2 - 70, 330, 44, 1, G.time);
      drawDrillItem(ctx, VIEW.w / 2 + 80, 342);
      ctx.fillStyle = "#ffe9c8"; ctx.font = f(20);
      G.wrapText(ctx, "Робот собрал минералы, напечатал лопату, откопал чертёж и построил гигантский бур. Теперь он пробурит путь к подземным ресурсам Марса — и выживет!", VIEW.w / 2, 420, 760, 30);
      ctx.fillStyle = "#7de08a"; ctx.font = f(24, "600");
      ctx.fillText(`☀ Вы продержались до Дня ${G.state.day} из 100`, VIEW.w / 2, 540);
      ctx.fillStyle = "rgba(255,220,180,0.7)"; ctx.font = f(15);
      ctx.fillText("Продолжение следует...", VIEW.w / 2, 670);
      G.button(ctx, this.b, true);
      ctx.textAlign = "left";
    },
  });

  /* =========================================================================
     GAME OVER (разряд батареи)
     ========================================================================= */
  G.addScene("gameover", {
    recharge: false, useJoystick: false,
    enter() {
      this.b = { x: VIEW.w / 2 - 140, y: 470, w: 280, h: 64, text: "↻ Продолжить", fs: 24 };
      // Реальные ставки: разряд стоит дней, лома и заряда — по сложности.
      if (!this._counted) {
        this._counted = true;
        const dp = G.diff().deathPenalty;
        G.state.deaths = (G.state.deaths || 0) + 1;
        this._lostScrap = Math.min(G.state.scrap || 0, Math.floor((G.state.scrap || 0) * 0.5 * dp));
        G.state.scrap = (G.state.scrap || 0) - this._lostScrap;
        this._lostDays = Math.floor(2 * dp);
        G.state.day = Math.min(100, G.state.day + this._lostDays);
      }
    },
    exit() { this._counted = false; },
    update() {},
    onTap(x, y) { if (rectHit(this.b, x, y)) { G.state.battery = G.diff().floor; G.go(G._lastRoom || "surface"); } },
    draw(ctx) {
      ctx.fillStyle = "#1a0606"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      starfield(ctx, 40, 17);
      ctx.textAlign = "center";
      ctx.fillStyle = "#e0573e"; ctx.font = f(48, "800");
      ctx.fillText("🔋 РОБОТ РАЗРЯДИЛСЯ", VIEW.w / 2, 250);
      ctx.fillStyle = "#ffe9c8"; ctx.font = f(20);
      const noPenalty = this._lostDays <= 0 && this._lostScrap <= 0;
      ctx.fillText(noPenalty ? "Аварийный перезапуск. Заряд восстановлен — пробуй снова!" : "Аварийный перезапуск — но это дорого обошлось:", VIEW.w / 2, 320);
      ctx.fillStyle = "#ff8a6a"; ctx.font = f(22, "700");
      ctx.fillText(noPenalty ? `разрядов: ${G.state.deaths}` : `−${this._lostDays} дн · −${this._lostScrap} лома ⚙ · разрядов: ${G.state.deaths}`, VIEW.w / 2, 360);
      ctx.fillStyle = "rgba(255,220,180,0.7)"; ctx.font = f(16);
      ctx.fillText(`День ${G.state.day}/100 · следи за зарядом — грейся, печатай аптечки, не лезь напролом`, VIEW.w / 2, 405);
      G.button(ctx, this.b, true);
      ctx.textAlign = "left";
    },
  });

  /* =========================================================================
     МИНИ-КАТ-СЦЕНЫ — оживляют ключевые моменты
     ========================================================================= */
  function makeMiniCutscene(name, dayValue, beats, onEnd) {
    G.addScene(name, {
      name, dayValue, recharge: false, useJoystick: false,
      enter() { this.i = 0; this.t = 0; this.beats = beats; },
      update(dt) {
        this.t += dt;
        const b = this.beats[this.i];
        if (!b) return; // последний бит уже завершён — ждём перехода
        if (b.onTime) b.onTime(this, dt);
        // авто-переход не раньше времени чтения (по длине текста). Тап листает вручную.
        const readT = Math.max(b.dur || 3, 2.6 + (b.text ? b.text.length : 0) * 0.055);
        if (this.t > readT) this.next();
      },
      next() {
        this.i++; this.t = 0; G.fx.clear();
        if (this.i >= this.beats.length) { if (typeof onEnd === "string") G.go(onEnd); else onEnd(); }
      },
      onTap(x, y) {
        if (rectHit({ x: VIEW.w - 156, y: 24, w: 138, h: 40 }, x, y)) {
          if (typeof onEnd === "string") G.go(onEnd); else onEnd();
          return;
        }
        if (this.t < 0.4) return; // защита от случайного пропуска бита (тап входа/двойной тап)
        this.next();
      },
      draw(ctx) {
        const b = this.beats[this.i] || this.beats[this.beats.length - 1];
        b.draw(ctx, Math.min(this.t, b.dur), this);
        // комикс-рамка
        ctx.lineJoin = "miter"; ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, VIEW.w - 14, VIEW.h - 14);
        // жёлтый капшн
        const cw = 884, ch = 92, cx = VIEW.w / 2 - cw / 2, cy = VIEW.h - ch - 28;
        ctx.fillStyle = "#fff2c2"; ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 5; ctx.strokeRect(cx, cy, cw, ch);
        ctx.fillStyle = "#2a1a10"; ctx.font = `700 21px ${G.FONT}`; ctx.textAlign = "center";
        G.wrapText(ctx, b.text, VIEW.w / 2, cy + 34, cw - 70, 28);
        ctx.font = `600 13px ${G.FONT}`; ctx.fillStyle = "rgba(40,20,10,0.55)";
        ctx.fillText("тап — далее", VIEW.w / 2, cy + ch - 12);
        // кнопка «пропустить»
        const sb = { x: VIEW.w - 156, y: 24, w: 138, h: 40 };
        ctx.fillStyle = "#ffe14a"; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
        ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 4; ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
        ctx.fillStyle = "#1d1424"; ctx.font = `800 16px ${G.FONT}`; ctx.textBaseline = "middle";
        ctx.fillText("Пропустить ▶", sb.x + sb.w / 2, sb.y + sb.h / 2); ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
      },
    });
  }

  function darkTombBg(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, "#2a1c14"); g.addColorStop(1, "#0e0805");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // парящие пылинки
    G.dust(ctx, { x: 60, y: 60, w: VIEW.w - 120, h: VIEW.h - 220 }, 30);
    // факелы по углам
    G.drawTorch(ctx, 80, 110); G.drawTorch(ctx, VIEW.w - 80, 110);
  }
  function ancientHallBg(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, "#3a2410"); g.addColorStop(1, "#120a06");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // молнии у горизонта
    if (Math.floor(G.time * 4) % 7 === 0) {
      ctx.strokeStyle = "rgba(170,220,255,0.55)"; ctx.lineWidth = 2;
      ctx.beginPath();
      const x = 200 + Math.random() * (VIEW.w - 400);
      ctx.moveTo(x, 60); ctx.lineTo(x + 14, 120); ctx.lineTo(x - 10, 180); ctx.lineTo(x + 20, 240);
      ctx.stroke();
    }
    G.dust(ctx, { x: 60, y: 60, w: VIEW.w - 120, h: VIEW.h - 220 }, 24);
  }
  // Маленькая иконка-чертёж в воздухе (для драматизации)
  function drawBlueprintIcon(ctx, x, y, kind) {
    ctx.save(); ctx.translate(x, y);
    // мягкий нимб
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
    halo.addColorStop(0, kind === "sword" ? "rgba(255,180,90,0.45)" : "rgba(120,200,255,0.45)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 70, 0, 7); ctx.fill();
    // лист
    ctx.fillStyle = kind === "sword" ? "#a83a18" : "#1f5fae";
    rr(ctx, -42, -28, 84, 56, 6); ctx.fill();
    ctx.strokeStyle = kind === "sword" ? "#ffd17a" : "#8fc2ff"; ctx.lineWidth = 2;
    ctx.strokeRect(-34, -20, 68, 40);
    if (kind === "sword") {
      // иконка меча
      ctx.strokeStyle = "#fff7d6"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(-22, 6); ctx.stroke();
      ctx.fillStyle = "#ffd24a"; ctx.fillRect(-26, -4, 4, 8);
    } else if (kind === "base") {
      ctx.strokeStyle = "#bfe0ff"; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-16, 12); ctx.lineTo(-16, -2); ctx.lineTo(0, -14); ctx.lineTo(16, -2); ctx.lineTo(16, 12); ctx.stroke();
      ctx.strokeRect(-4, 0, 8, 10);
    }
    ctx.restore();
  }
  // Большой бур (для эпичной кат-сцены)
  function drawBigDrill(ctx, x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.beginPath(); ctx.ellipse(0, 110, 60, 12, 0, 0, 7); ctx.fill();
    // корпус
    const cg = ctx.createLinearGradient(0, -70, 0, 30);
    cg.addColorStop(0, "#eef2f6"); cg.addColorStop(1, "#828b95");
    ctx.fillStyle = cg; rr(ctx, -44, -68, 88, 90, 10); ctx.fill();
    ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 3; ctx.stroke();
    // окошко-индикатор
    ctx.fillStyle = "#7be0ff"; ctx.fillRect(-22, -56, 44, 14);
    ctx.strokeStyle = "#0a3a4a"; ctx.lineWidth = 2; ctx.strokeRect(-22, -56, 44, 14);
    // ручка-захват
    ctx.fillStyle = "#5a4636"; rr(ctx, -16, 20, 32, 18, 4); ctx.fill();
    // бур-наконечник
    ctx.fillStyle = "#ffb04a"; ctx.beginPath(); ctx.moveTo(-28, 38); ctx.lineTo(28, 38); ctx.lineTo(0, 110); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#7a4a1a"; ctx.lineWidth = 2; ctx.stroke();
    // спираль
    ctx.strokeStyle = "#7a4a1a"; ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-24 + i * 4, 50 + i * 13); ctx.lineTo(24 - i * 4, 56 + i * 13);
      ctx.stroke();
    }
    ctx.restore();
  }

  // === КАТ-СЦЕНА: «Бур готов» ===
  makeMiniCutscene("cutscene_drill", 84, [
    {
      dur: 3.0, text: "БУР ГОТОВ! Робот замер от восхищения...",
      draw(ctx, t) {
        darkTombBg(ctx);
        // огромный бур по центру с лёгкой вибрацией
        const sh = Math.sin(G.time * 16) * 1.2;
        drawBigDrill(ctx, VIEW.w / 2 + 40 + sh, 380, 1.7);
        // робот слева смотрит вверх с восклицанием
        G.drawRobot(ctx, 280, 480, 36, 1, 0);
        // восклицание-облачко мысли
        if (t > 0.6) {
          ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(330, 380, 28, 0, 7); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(316, 416, 8, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#d12b29"; ctx.font = `900 italic 36px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("!", 330, 380); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        }
      }
    },
    {
      dur: 2.8, text: "Этим можно пробурить что угодно!",
      onTime(sc) {
        if (sc.t > 0.1 && Math.random() > 0.7) G.fx.burst(VIEW.w / 2 + 40 + (Math.random() - 0.5) * 80, 440, "#ffd17a", 1, 80, 0.5);
      },
      draw(ctx, t) {
        darkTombBg(ctx);
        const sh = Math.sin(G.time * 20) * 2;
        drawBigDrill(ctx, VIEW.w / 2 + 40 + sh, 380, 1.7);
        // искры
        ctx.fillStyle = "rgba(255,210,140,0.5)";
        for (let i = 0; i < 5; i++) {
          const a = G.time * 3 + i;
          ctx.fillRect(VIEW.w / 2 + 40 + Math.cos(a) * 70, 480 + Math.sin(a) * 14, 3, 3);
        }
        G.drawRobot(ctx, 280, 480, 36, 1, G.time);
      }
    },
    {
      dur: 3.2, text: "Древние что-то построили в недрах... ищи ЧЕРТЁЖ БАЗЫ (выход слева).",
      draw(ctx, t) {
        darkTombBg(ctx);
        // дверной проём слева светится
        const gl = (Math.sin(G.time * 2) + 1) / 2;
        ctx.fillStyle = `rgba(120,200,255,${0.1 + gl * 0.18})`;
        ctx.fillRect(50, 280, 90, 220);
        ctx.fillStyle = "#0a0604"; ctx.fillRect(60, 290, 70, 200);
        ctx.strokeStyle = "#ffd17a"; ctx.lineWidth = 3; ctx.strokeRect(50, 280, 90, 220);
        // робот идёт к двери
        const rx = lerp(420, 220, clamp(t / 3.2, 0, 1));
        G.drawRobot(ctx, rx, 480, 30, -1, G.time);
        drawBigDrill(ctx, VIEW.w / 2 + 160, 380, 1.3);
      }
    },
  ], "printer");

  // === КАТ-СЦЕНА: «Чертёж базы найден» ===
  makeMiniCutscene("cutscene_base_blueprint", 102, [
    {
      dur: 2.6, text: "СИНИЙ ЧЕРТЁЖ! Древняя БАЗА — теперь можно построить свой дом на Марсе.",
      onTime(sc) { if (Math.random() > 0.6) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 80, 380, "#7be0ff", 1, 60, 0.6); },
      draw(ctx, t) {
        darkTombBg(ctx);
        // пьедестал
        const px = VIEW.w / 2, py = 460;
        ctx.fillStyle = "#3a2c22"; rr(ctx, px - 60, py + 56, 120, 16, 3); ctx.fill();
        ctx.fillStyle = "#5a4636"; rr(ctx, px - 58, py + 50, 116, 8, 3); ctx.fill();
        ctx.fillStyle = "#6a5a44"; rr(ctx, px - 52, py + 40, 104, 14, 4); ctx.fill();
        const cg = ctx.createLinearGradient(px - 44, 0, px + 44, 0);
        cg.addColorStop(0, "#3a2c22"); cg.addColorStop(0.5, "#6a5a44"); cg.addColorStop(1, "#3a2c22");
        ctx.fillStyle = cg; rr(ctx, px - 44, py - 4, 88, 50, 4); ctx.fill();
        ctx.fillStyle = "#5a4636"; rr(ctx, px - 50, py - 12, 100, 14, 3); ctx.fill();
        // чертёж парит над
        const fy = py - 80 + Math.sin(G.time * 2) * 6;
        drawBlueprintIcon(ctx, px, fy, "base");
        // робот тянется
        G.drawRobot(ctx, px - 110, py + 10, 32, 1, G.time);
      }
    },
    {
      dur: 3.0, text: "Нужны 2 СУПЕР-МИНЕРАЛА — добудь их буром в шахтах (слева у принтера).",
      draw(ctx, t) {
        darkTombBg(ctx);
        // робот держит чертёж
        G.drawRobot(ctx, VIEW.w / 2 - 60, 440, 36, 1, 0);
        drawBlueprintIcon(ctx, VIEW.w / 2 + 10, 410, "base");
        // мысли: 2 минерала + бур
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 3;
        const bx = VIEW.w / 2 + 140, by = 200;
        rr(ctx, bx, by, 260, 100, 12); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx - 30, by + 110, 8, 0, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx - 50, by + 130, 4, 0, 7); ctx.fill(); ctx.stroke();
        // содержимое: 2 минерала и стрелка к домику
        drawMineral(ctx, bx + 50, by + 50, 18, "#ffd17a", 0);
        drawMineral(ctx, bx + 100, by + 50, 18, "#ffd17a", 0);
        ctx.fillStyle = "#1d1424"; ctx.font = `900 30px ${G.FONT}`; ctx.textAlign = "center";
        ctx.fillText("→", bx + 150, by + 60);
        // домик
        ctx.strokeStyle = "#1f5fae"; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bx + 180, by + 70); ctx.lineTo(bx + 180, by + 50); ctx.lineTo(bx + 200, by + 30); ctx.lineTo(bx + 220, by + 50); ctx.lineTo(bx + 220, by + 70); ctx.stroke();
        ctx.strokeRect(bx + 195, by + 50, 10, 20);
        ctx.textAlign = "left";
      }
    },
  ], "drill_site");

  // === КАТ-СЦЕНА: «База построена» ===
  makeMiniCutscene("cutscene_base", 110, [
    {
      dur: 2.4, text: "Принтер раскалился... сборка идёт!",
      onTime(sc) { if (Math.random() > 0.4) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 100, 430, "#ffe9a0", 1, 140, 0.6); },
      draw(ctx, t) {
        darkTombBg(ctx);
        // принтер по центру светится
        const cx = VIEW.w / 2, cy = 420;
        const pulse = (Math.sin(G.time * 14) + 1) / 2;
        const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 180);
        halo.addColorStop(0, `rgba(255,240,170,${0.5 + pulse * 0.3})`);
        halo.addColorStop(1, "rgba(255,200,100,0)");
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, 180, 0, 7); ctx.fill();
        ctx.fillStyle = "#2b3038"; rr(ctx, cx - 90, cy - 80, 180, 180, 10); ctx.fill();
        ctx.fillStyle = "#1a1e24"; rr(ctx, cx - 76, cy - 66, 152, 120, 6); ctx.fill();
        ctx.fillStyle = "#6fd0ff"; rr(ctx, cx - 70, cy - 56, 140, 8, 3); ctx.fill();
        ctx.fillStyle = "#fff7d6"; rr(ctx, cx - 30 + Math.sin(G.time * 22) * 20, cy - 30, 8, 16, 2); ctx.fill();
        G.drawRobot(ctx, cx - 180, cy + 40, 30, 1, 0);
      }
    },
    {
      dur: 2.8, text: "Модули стыкуются — МАРСИАНСКАЯ БАЗА РАСТЁТ!",
      onTime(sc) { if (Math.random() > 0.5) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 120, 470, "#7be0ff", 1, 90, 0.6); },
      draw(ctx, t) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 460, baseY = cy + 50;
        // принтер слева
        ctx.fillStyle = "#2b3038"; rr(ctx, cx - 300, cy - 50, 110, 120, 10); ctx.fill();
        ctx.fillStyle = "#1a1e24"; rr(ctx, cx - 290, cy - 40, 90, 76, 6); ctx.fill();
        ctx.fillStyle = "#6fd0ff"; rr(ctx, cx - 285, cy - 34, 80, 6, 2); ctx.fill();
        // луч печати к площадке
        ctx.strokeStyle = "rgba(120,224,255,0.4)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx - 190, cy); ctx.lineTo(cx, baseY - 40); ctx.stroke();
        // сборочная площадка
        ctx.fillStyle = "#2a3038"; rr(ctx, cx - 96, baseY - 4, 192, 12, 3); ctx.fill();
        // поэтапная стыковка модулей (марс-техно)
        const phase = clamp(t / 2.8, 0, 1);
        if (phase > 0.08) { ctx.save(); ctx.globalAlpha = clamp((phase - 0.08) / 0.3, 0, 1); drawFrameItem(ctx, cx, baseY); ctx.restore(); }
        if (phase > 0.45) { ctx.save(); ctx.globalAlpha = clamp((phase - 0.45) / 0.3, 0, 1); drawSolarItem(ctx, cx + 76, baseY); ctx.restore(); }
        if (phase > 0.72) { ctx.save(); ctx.globalAlpha = clamp((phase - 0.72) / 0.28, 0, 1); drawReactorItem(ctx, cx - 76, baseY); ctx.restore(); }
        G.drawRobot(ctx, cx - 340, cy + 40, 30, 1, 0);
      }
    },
    {
      dur: 3.0, text: "БАЗА ОНЛАЙН! Здесь можно подзаряжаться от солнца и печатать новые модули.",
      onTime(sc) { if (Math.random() > 0.6) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 160, 360, "#7be0a0", 1, 80, 0.8); },
      draw(ctx, t) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 460, baseY = cy + 50;
        // свечение готовности
        const gl = (Math.sin(G.time * 3) + 1) / 2;
        const halo = ctx.createRadialGradient(cx, baseY - 60, 20, cx, baseY - 60, 210);
        halo.addColorStop(0, `rgba(123,224,170,${0.16 + gl * 0.16})`); halo.addColorStop(1, "rgba(123,224,170,0)");
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, baseY - 60, 210, 0, 7); ctx.fill();
        // площадка
        ctx.fillStyle = "#3a5a4a"; rr(ctx, cx - 96, baseY - 4, 192, 12, 3); ctx.fill();
        ctx.strokeStyle = "#7be0a0"; ctx.lineWidth = 2; ctx.strokeRect(cx - 96, baseY - 4, 192, 12);
        // космическая база: реактор + жилой модуль + солнечные батареи
        drawReactorItem(ctx, cx - 76, baseY);
        drawFrameItem(ctx, cx, baseY);
        drawSolarItem(ctx, cx + 76, baseY);
        // вывеска
        ctx.fillStyle = "#0a2a1a"; rr(ctx, cx - 96, baseY - 156, 192, 32, 7); ctx.fill();
        ctx.strokeStyle = "#2a6a3a"; ctx.lineWidth = 2; rr(ctx, cx - 96, baseY - 156, 192, 32, 7); ctx.stroke();
        ctx.fillStyle = "#7de08a"; ctx.font = `900 17px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🛰 БАЗА ОНЛАЙН", cx, baseY - 140); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        // робот рядом
        G.drawRobot(ctx, cx - 230, baseY - 10, 32, 1, 0);
      }
    },
  ], "printer");

  // === КАТ-СЦЕНА: «Чертёж меча найден» ===
  makeMiniCutscene("cutscene_sword_blueprint", 116, [
    {
      dur: 2.6, text: "Древний алтарь. На нём — чертёж МЕЧА. Только им можно сразить Древнего.",
      draw(ctx, t) {
        ancientHallBg(ctx);
        // алтарь
        const cx = VIEW.w / 2, cy = 460;
        ctx.fillStyle = "#3a2c22"; rr(ctx, cx - 70, cy + 60, 140, 18, 3); ctx.fill();
        ctx.fillStyle = "#5a4636"; rr(ctx, cx - 60, cy - 10, 120, 70, 4); ctx.fill();
        ctx.strokeStyle = "rgba(220,180,120,0.5)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + 50); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 12, cy + 18); ctx.lineTo(cx + 12, cy + 18); ctx.stroke();
        // чертёж меча в нимбе
        const fy = cy - 50 + Math.sin(G.time * 2) * 6;
        drawBlueprintIcon(ctx, cx, fy, "sword");
        // молнии вокруг
        if (Math.floor(G.time * 6) % 4 === 0) {
          ctx.strokeStyle = "rgba(170,220,255,0.7)"; ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx - 70, 60); ctx.lineTo(cx - 60, 110); ctx.lineTo(cx - 80, 170); ctx.lineTo(cx - 70, 220);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx + 70, 60); ctx.lineTo(cx + 60, 110); ctx.lineTo(cx + 80, 170); ctx.lineTo(cx + 70, 220);
          ctx.stroke();
        }
        G.drawRobot(ctx, cx - 130, cy + 20, 32, 1, G.time);
      }
    },
    {
      dur: 2.8, text: "Нужно 3 СУПЕР-МИНЕРАЛА и принтер на базе.",
      draw(ctx, t) {
        ancientHallBg(ctx);
        G.drawRobot(ctx, VIEW.w / 2 - 60, 440, 36, 1, 0);
        drawBlueprintIcon(ctx, VIEW.w / 2 + 10, 410, "sword");
        // мысль: 3 минерала
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1d1424"; ctx.lineWidth = 3;
        const bx = VIEW.w / 2 + 140, by = 220;
        rr(ctx, bx, by, 280, 80, 12); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx - 30, by + 95, 7, 0, 7); ctx.fill(); ctx.stroke();
        drawMineral(ctx, bx + 50, by + 40, 18, "#ffd17a", 0);
        drawMineral(ctx, bx + 100, by + 40, 18, "#ffd17a", 0);
        drawMineral(ctx, bx + 150, by + 40, 18, "#ffd17a", 0);
        ctx.fillStyle = "#1d1424"; ctx.font = `900 24px ${G.FONT}`; ctx.textAlign = "center";
        ctx.fillText("→ ⚔", bx + 230, by + 50);
        ctx.textAlign = "left";
      }
    },
  ], "drill_site");

  // === КАТ-СЦЕНА: «Меч выкован» ===
  makeMiniCutscene("cutscene_sword", 124, [
    {
      dur: 2.4, text: "Принтер раскалился добела... МЕЧ КУЁТСЯ!",
      onTime(sc) { G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 60, 440 + (Math.random() - 0.5) * 40, "#ffe9a0", 1, 160, 0.5); },
      draw(ctx, t) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 440;
        const pulse = (Math.sin(G.time * 16) + 1) / 2;
        const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 220);
        halo.addColorStop(0, `rgba(255,240,180,${0.55 + pulse * 0.35})`);
        halo.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, 220, 0, 7); ctx.fill();
        // принтер
        ctx.fillStyle = "#2b3038"; rr(ctx, cx - 90, cy - 80, 180, 200, 10); ctx.fill();
        ctx.fillStyle = "#1a1e24"; rr(ctx, cx - 76, cy - 66, 152, 150, 6); ctx.fill();
        // силуэт меча внутри
        const swordPhase = clamp(t / 2.4, 0, 1);
        ctx.fillStyle = `rgba(255,240,200,${0.4 + swordPhase * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 30); ctx.lineTo(cx - 6, cy + 20 - 80 * swordPhase); ctx.lineTo(cx, cy + 16 - 90 * swordPhase); ctx.lineTo(cx + 6, cy + 20 - 80 * swordPhase); ctx.closePath();
        ctx.fill();
        G.drawRobot(ctx, cx - 200, cy + 60, 32, 1, 0);
      }
    },
    {
      dur: 2.6, text: "МЕЧ ВЫКОВАН!",
      draw(ctx, t) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 440;
        ctx.fillStyle = "#2b3038"; rr(ctx, cx - 90, cy - 80, 180, 200, 10); ctx.fill();
        ctx.fillStyle = "#1a1e24"; rr(ctx, cx - 76, cy - 66, 152, 150, 6); ctx.fill();
        // меч поднимается из принтера
        const rise = Math.min(1, t / 1.0);
        const swordY = cy + 40 - rise * 130;
        ctx.save(); ctx.translate(cx, swordY); ctx.rotate(-0.2);
        // клинок
        ctx.fillStyle = "#cdd4db"; ctx.beginPath();
        ctx.moveTo(0, -60); ctx.lineTo(8, -50); ctx.lineTo(6, 20); ctx.lineTo(-6, 20); ctx.lineTo(-8, -50); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2; ctx.stroke();
        // гарда
        ctx.fillStyle = "#ffd24a"; ctx.fillRect(-20, 20, 40, 8);
        ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 2; ctx.strokeRect(-20, 20, 40, 8);
        // рукоять
        ctx.fillStyle = "#7a4422"; ctx.fillRect(-5, 28, 10, 22);
        ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(0, 54, 7, 0, 7); ctx.fill();
        ctx.restore();
        // искры
        for (let i = 0; i < 4; i++) {
          const a = G.time * 2 + i;
          ctx.fillStyle = "rgba(255,240,150,0.7)";
          ctx.fillRect(cx + Math.cos(a) * 40, swordY + Math.sin(a) * 30, 3, 3);
        }
        G.drawRobot(ctx, cx - 200, cy + 60, 32, 1, 0);
      }
    },
    {
      dur: 2.6, text: "Готов к битве с ДРЕВНИМ!",
      draw(ctx, t) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 460;
        // робот в героической позе с мечом
        G.drawRobot(ctx, cx, cy, 44, 1, 0);
        // меч поднят вверх
        ctx.save(); ctx.translate(cx + 30, cy - 30); ctx.rotate(-0.35);
        ctx.fillStyle = "#cdd4db"; ctx.beginPath();
        ctx.moveTo(0, -60); ctx.lineTo(8, -50); ctx.lineTo(6, 20); ctx.lineTo(-6, 20); ctx.lineTo(-8, -50); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#ffd24a"; ctx.fillRect(-20, 20, 40, 8);
        ctx.fillStyle = "#7a4422"; ctx.fillRect(-5, 28, 10, 18);
        ctx.restore();
        // свечение
        const gl = (Math.sin(G.time * 4) + 1) / 2;
        ctx.fillStyle = `rgba(255,240,180,${0.2 + gl * 0.3})`;
        ctx.beginPath(); ctx.arc(cx + 50, cy - 80, 80, 0, 7); ctx.fill();
      }
    },
  ], "printer");

  // === КАТ-СЦЕНА: «Колизей и Древний» ===
  makeMiniCutscene("cutscene_boss", 130, [
    {
      dur: 2.4, text: "Древний колизей открыл свои ворота...",
      draw(ctx, t) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#5a3a1e"); g.addColorStop(1, "#1a0a04"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // силуэты арок
        ctx.fillStyle = "#1a0a04";
        for (let i = 0; i < 7; i++) {
          const ax = 100 + i * 130;
          ctx.beginPath(); ctx.arc(ax, 220, 32, PI, 0); ctx.fillRect(ax - 32, 220, 64, 0); ctx.fill();
        }
        // ворота открываются
        const open = clamp(t / 2.4, 0, 1);
        const gw = 200, gx = VIEW.w / 2 - gw / 2;
        ctx.fillStyle = "#3a2410"; ctx.fillRect(gx, 320, gw, 250);
        ctx.fillStyle = "#0a0604"; ctx.fillRect(gx + 10 + gw / 2 * open, 330, gw / 2 - 20, 230);
        ctx.fillStyle = "#0a0604"; ctx.fillRect(gx + 10, 330, gw / 2 - 20 - gw / 2 * open + gw / 2, 230);
        // пыль из ворот
        if (t > 0.3) {
          for (let i = 0; i < 8; i++) {
            const a = G.time + i;
            ctx.fillStyle = `rgba(190,150,110,${0.3 - (t / 5)})`;
            ctx.beginPath(); ctx.arc(VIEW.w / 2 + Math.cos(a) * 60, 480 + Math.sin(a) * 30, 12 + i * 4, 0, 7); ctx.fill();
          }
        }
      }
    },
    {
      dur: 3.0, text: "ДРЕВНИЙ ЕГИПТЯНИН! Восстал из тысячелетнего сна.",
      onTime(sc) { if (sc.t > 0.3 && Math.floor(sc.t * 3) % 2 === 0) sc.shake = 8; else sc.shake = 0; },
      draw(ctx, t, sc) {
        ctx.save();
        if (sc.shake) ctx.translate((Math.random() - 0.5) * sc.shake, (Math.random() - 0.5) * sc.shake);
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#2a1810"); g.addColorStop(1, "#0a0408"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // лучик света сверху на босса
        const cx = VIEW.w / 2;
        const beam = ctx.createLinearGradient(cx, 60, cx, 600);
        beam.addColorStop(0, "rgba(255,210,140,0.4)"); beam.addColorStop(1, "rgba(255,210,140,0)");
        ctx.fillStyle = beam;
        ctx.beginPath(); ctx.moveTo(cx - 100, 60); ctx.lineTo(cx + 100, 60); ctx.lineTo(cx + 180, 600); ctx.lineTo(cx - 180, 600); ctx.closePath(); ctx.fill();
        // босс крупным планом
        const reveal = clamp(t / 1.5, 0, 1);
        ctx.save(); ctx.translate(cx, 460); ctx.scale(2.2, 2.2);
        // силуэт
        ctx.fillStyle = `rgba(20,10,20,${1 - reveal * 0.7})`;
        ctx.beginPath(); ctx.moveTo(-46, 80); ctx.lineTo(-36, -10); ctx.lineTo(36, -10); ctx.lineTo(46, 80); ctx.closePath(); ctx.fill();
        // тело
        ctx.globalAlpha = reveal;
        ctx.fillStyle = "#caa066"; ctx.beginPath();
        ctx.moveTo(-46, 80); ctx.lineTo(-36, -10); ctx.lineTo(36, -10); ctx.lineTo(46, 80); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2; ctx.stroke();
        // голова с немесом
        ctx.fillStyle = "#1a3a58"; ctx.beginPath();
        ctx.moveTo(-26, -42); ctx.quadraticCurveTo(0, -54, 26, -42); ctx.lineTo(26, -16); ctx.lineTo(-26, -16); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#ffd24a";
        for (let i = 0; i < 4; i++) ctx.fillRect(-26, -38 + i * 6, 52, 2);
        ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.ellipse(0, -22, 22, 26, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
        // светящиеся глаза
        const eg = (Math.sin(G.time * 8) + 1) / 2;
        ctx.fillStyle = `rgba(255,${50 + eg * 80},40,${reveal})`;
        ctx.beginPath(); ctx.arc(-8, -22, 4, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(8, -22, 4, 0, 7); ctx.fill();
        ctx.restore();
        // надпись через всю сцену
        if (t > 1.4) {
          ctx.fillStyle = "#d12b29"; ctx.font = `900 italic 56px ${G.FONT}`;
          ctx.lineJoin = "round"; ctx.lineWidth = 8; ctx.strokeStyle = "#1d1424"; ctx.textAlign = "center";
          const pop = Math.min(1, (t - 1.4) / 0.3);
          ctx.save(); ctx.translate(cx, 180); ctx.scale(pop, pop);
          ctx.strokeText("ДРЕВНИЙ!", 0, 0);
          ctx.fillText("ДРЕВНИЙ!", 0, 0);
          ctx.restore();
          ctx.textAlign = "left";
        }
        ctx.restore();
      }
    },
    {
      dur: 2.6, text: "Меч поднят. Битва за Марс!",
      draw(ctx, t) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#5a3a1e"); g.addColorStop(1, "#2a1810"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // песок арены
        ctx.fillStyle = "#a87844"; ctx.fillRect(0, VIEW.h * 0.55, VIEW.w, VIEW.h * 0.45);
        // робот слева с мечом vs босс справа
        G.drawRobot(ctx, 300, 480, 38, 1, 0);
        ctx.save(); ctx.translate(330, 460); ctx.rotate(-0.3);
        ctx.fillStyle = "#cdd4db"; ctx.beginPath();
        ctx.moveTo(0, -50); ctx.lineTo(6, -40); ctx.lineTo(5, 20); ctx.lineTo(-5, 20); ctx.lineTo(-6, -40); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#5b636d"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#ffd24a"; ctx.fillRect(-16, 20, 32, 6);
        ctx.restore();
        // босс справа (упрощённо)
        ctx.save(); ctx.translate(1100, 460); ctx.scale(1.8, 1.8);
        ctx.fillStyle = "#caa066"; ctx.beginPath();
        ctx.moveTo(-46, 80); ctx.lineTo(-36, -10); ctx.lineTo(36, -10); ctx.lineTo(46, 80); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#1a3a58"; ctx.beginPath();
        ctx.moveTo(-26, -42); ctx.quadraticCurveTo(0, -54, 26, -42); ctx.lineTo(26, -16); ctx.lineTo(-26, -16); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#caa066"; ctx.beginPath(); ctx.ellipse(0, -22, 22, 26, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#d12b29"; ctx.beginPath(); ctx.arc(-8, -22, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(8, -22, 3, 0, 7); ctx.fill();
        ctx.restore();
        // искры между ними
        for (let i = 0; i < 4; i++) {
          const xx = lerp(360, 1040, i / 3);
          ctx.fillStyle = "rgba(255,240,150,0.4)";
          ctx.beginPath(); ctx.arc(xx, 420 + Math.sin(G.time * 4 + i) * 6, 3, 0, 7); ctx.fill();
        }
      }
    },
  ], () => { G.state._bossSeen = true; G.go("coliseum"); });

  /* =========================================================================
     ОБОРОНА БАЗЫ — опциональное волновое испытание (после постройки базы)
     ========================================================================= */
  G.addScene("base_defense", makeRoom({
    name: "base_defense", dayValue: 95,
    start: { x: 150, y: 410 },
    drain: 0.18,
    narr: (s) => {
      const d = s.data;
      if (d.failed) return "Реактор разрушен! Вернитесь к принтеру и попробуйте снова.";
      if (d.done) return "Все волны отбиты! База в безопасности. Выход слева.";
      return `🛡 Защитите реактор! Волна ${Math.min(d.wave + 1, d.waves.length)}/${d.waves.length}. Бейте врагов «Действием».`;
    },
    bg(ctx, s) { G.drawTombRoom(ctx, s.bounds, { floorTop: "#3a4250", floorBot: "#161c24" }); },
    build(s) {
      const b = s.bounds;
      G.dayCycle = 0.32; // честная сложность вне зависимости от времени суток
      const R = s.data.reactor = { x: b.x + b.w * 0.52, y: b.y + b.h * 0.44, r: 44, hp: 100, maxHp: 100 };
      s.data.attack = !!G.state._baseAttack; // режим нападения (с карты) vs испытание
      s.data.wave = 0; s.data.spawnT = 1.4; s.data.between = 2.2; s.data.done = false; s.data.failed = false;
      s.data.waves = s.data.attack ? [
        ["grunt", "scout", "drone"],
        ["grunt", "scout", "scout", "brute"],
      ] : [
        ["grunt", "grunt", "scout"],
        ["grunt", "scout", "drone", "drone", "brute"],
        ["drone", "drone", "scout", "scout", "grunt", "brute", "brute"],
      ];
      s.data.queue = s.data.waves[0].slice();
      // === оборона базы из улучшений ===
      // турели вокруг реактора
      s.data.turrets = [];
      for (let i = 0; i < G.state.baseTurrets; i++) {
        const a = (Math.PI * 2 / 3) * i - Math.PI / 2;
        s.data.turrets.push({ x: R.x + Math.cos(a) * 70, y: R.y + Math.sin(a) * 70, cd: 0, ang: a, beam: 0, target: null });
      }
      // энергозабор: радиус и фактор замедления
      if (G.state.baseFence > 0) { s.data.fenceR = R.r + 70; s.data.fenceSlow = G.state.baseFence >= 2 ? 0.4 : 0.6; }
      // реактор — препятствие
      s.obstacles.push({ x: R.x - 34, y: R.y - 34, w: 68, h: 68 });
      s.exitZone = {
        x: b.x, y: b.y + b.h / 2 - 48, w: 66, h: 96,
        label: () => (s.data.done || s.data.failed) ? (s.data.attack ? "← На карту" : "← К 3D-принтеру") : "← Отступить",
        onExit: () => { G.state._baseAttack = false; G.go(s.data.attack ? "mars_map" : "printer"); },
        ready: () => true,
      };
    },
    update(s, dt) {
      const d = s.data;
      // === ТУРЕЛИ авто-огонь ===
      for (const tr of d.turrets) {
        if (tr.beam > 0) tr.beam -= dt;
        tr.cd -= dt;
        if (tr.cd <= 0 && s.mutants.length) {
          // ближайший враг в радиусе
          let best = null, bd = 340;
          for (const m of s.mutants) { const dd = Math.hypot(m.x - tr.x, m.y - tr.y); if (dd < bd) { bd = dd; best = m; } }
          if (best) {
            tr.target = best; tr.ang = Math.atan2(best.y - tr.y, best.x - tr.x);
            best.hp -= 1; best.hitT = Math.max(best.hitT, 0.2);
            tr.beam = 0.12; tr.cd = 0.7; G.audio.tone(620, 0.05, "square", 0.04);
            G.fx.burst(best.x, best.y, "#ffd17a", 6, 120, 0.3);
          }
        }
      }
      if (d.done || d.failed) return;
      if (d.reactor.hp <= 0) { d.failed = true; s.toast(d.attack ? "База повреждена! Отступайте." : "Реактор разрушен! Отступайте.", 3.0); G.audio.boom(); return; }
      if (d.queue.length) {
        d.spawnT -= dt;
        if (d.spawnT <= 0) {
          d.spawnT = 0.9 + Math.random() * 0.7;
          const kind = d.queue.shift();
          const b = s.bounds; let x, y; const side = Math.floor(Math.random() * 3);
          if (side === 0) { x = b.x + 24; y = b.y + 50 + Math.random() * (b.h - 100); }
          else if (side === 1) { x = b.x + 120 + Math.random() * (b.w - 200); y = b.y + 24; }
          else { x = b.x + 120 + Math.random() * (b.w - 200); y = b.y + b.h - 24; }
          const mu = makeMutant(x, y, null, kind); mu.goal = d.reactor;
          if (d.wave >= 2 && Math.random() < 0.35) makeElite(mu); // поздние волны осады — элиты
          s.mutants.push(mu);
        }
      } else if (s.mutants.length === 0) {
        d.wave++;
        if (d.wave >= d.waves.length) {
          d.done = true; G.state.battery = 100; G.audio.win();
          if (d.attack) {
            G.state.baseThreat = 0;
            s.toast("Нападение отбито! База в безопасности 🛡", 3.4);
          } else {
            if (!G.state.baseDefended) { G.state.baseDefended = true; G.state.superMinerals += 1; }
            s.toast("Все волны отбиты! База заряжена 🔋", 3.0);
            if (!awardUpgrade("printer")) grantNextUpgrade(s); // награда — ВЫБОР апгрейда
          }
          return;
        }
        d.queue = d.waves[d.wave].slice(); d.spawnT = d.between;
        s.toast(`Волна ${d.wave + 1}!`, 1.6);
      }
    },
    drawProps(s, ctx) {
      const d = s.data, R = d.reactor;
      // энергозабор — светящийся гекс-периметр
      if (d.fenceR) {
        const gl = (Math.sin(G.time * 4) + 1) / 2;
        ctx.save(); ctx.translate(R.x, R.y);
        ctx.strokeStyle = `rgba(120,210,255,${0.3 + gl * 0.3})`; ctx.lineWidth = 3; hexPathMap(ctx, 0, 0, d.fenceR); ctx.stroke();
        ctx.strokeStyle = `rgba(180,235,255,${0.15 + gl * 0.2})`; ctx.lineWidth = 1; hexPathMap(ctx, 0, 0, d.fenceR - 5); ctx.stroke();
        ctx.fillStyle = `rgba(180,235,255,${0.5 + gl * 0.4})`;
        for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(a) * d.fenceR, Math.sin(a) * d.fenceR, 3, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      drawDefenseReactor(ctx, R);
      // турели + лучи
      for (const tr of d.turrets) {
        if (tr.beam > 0 && tr.target) {
          ctx.strokeStyle = `rgba(255,220,120,${tr.beam / 0.12})`; ctx.lineWidth = 3; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.target.x, tr.target.y); ctx.stroke();
        }
        ctx.save(); ctx.translate(tr.x, tr.y);
        ctx.fillStyle = "#2a3038"; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
        ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 2; ctx.stroke();
        ctx.rotate(tr.ang + Math.PI / 2);
        ctx.fillStyle = "#7a8290"; rr(ctx, -3, -20, 6, 20, 2); ctx.fill();
        ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,140,90,${tr.beam > 0 ? 1 : 0.5})`; ctx.beginPath(); ctx.arc(0, -20, 2.5, 0, 7); ctx.fill();
        ctx.restore();
      }
    },
    drawOver(s, ctx) {
      const d = s.data, R = d.reactor;
      // полоса HP реактора над ним
      ctx.fillStyle = "rgba(0,0,0,0.6)"; rr(ctx, R.x - 60, R.y - 76, 120, 12, 4); ctx.fill();
      const hc = R.hp > 50 ? "#7be0a0" : R.hp > 25 ? "#ffd17a" : "#ff6a4a";
      ctx.fillStyle = hc; rr(ctx, R.x - 58, R.y - 74, 116 * (R.hp / R.maxHp), 8, 3); ctx.fill();
      ctx.fillStyle = "#cfe6f0"; ctx.font = f(11, "600"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("РЕАКТОР " + Math.ceil(R.hp) + "%", R.x, R.y - 70); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      // счётчик волн справа
      ctx.fillStyle = "rgba(8,12,20,0.62)"; rr(ctx, VIEW.w - 200, 76, 180, 32, 8); ctx.fill();
      ctx.fillStyle = "#9fe6ff"; ctx.font = f(15, "700"); ctx.textBaseline = "middle";
      ctx.fillText(`🛡 Волна ${Math.min(d.wave + 1, d.waves.length)}/${d.waves.length}`, VIEW.w - 188, 93);
      ctx.fillStyle = "#ff8a4a"; ctx.textAlign = "right"; ctx.fillText("враги: " + s.mutants.length, VIEW.w - 30, 93);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
  }));
  function drawDefenseReactor(ctx, R) {
    ctx.save(); ctx.translate(R.x, R.y);
    // основание
    ctx.fillStyle = "#2a3038"; rr(ctx, -38, 20, 76, 16, 4); ctx.fill();
    // корпус
    const body = ctx.createLinearGradient(-30, -34, 30, 34);
    body.addColorStop(0, "#5a6470"); body.addColorStop(1, "#2a3038");
    ctx.fillStyle = body; rr(ctx, -32, -34, 64, 60, 8); ctx.fill();
    ctx.strokeStyle = "#1a2026"; ctx.lineWidth = 2; ctx.strokeRect(-32, -34, 64, 60);
    // светящееся ядро
    const dmg = 1 - R.hp / R.maxHp;
    const pulse = (Math.sin(G.time * (4 + dmg * 8)) + 1) / 2;
    const core = ctx.createRadialGradient(0, -4, 2, 0, -4, 24);
    const cc = dmg > 0.7 ? "255,120,80" : "123,224,255";
    core.addColorStop(0, `rgba(${cc},${0.85})`); core.addColorStop(0.5, `rgba(${cc},${0.4 + pulse * 0.3})`); core.addColorStop(1, "rgba(40,80,160,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, -4, 22, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${cc},0.9)`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, -4, 16, 0, 7); ctx.stroke();
    // орбитали
    ctx.strokeStyle = `rgba(${cc},0.7)`; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(G.time * 2 + i * Math.PI / 3); ctx.beginPath(); ctx.ellipse(0, -4, 14, 5, 0, 0, 7); ctx.stroke(); ctx.restore(); }
    // защитный купол-щит
    ctx.strokeStyle = `rgba(140,210,255,${0.18 + pulse * 0.12})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -4, 56, 0, 7); ctx.stroke();
    ctx.restore();
  }

  /* =========================================================================
     ИСПЫТАНИЯ — отдельный режим из меню (награда за каждое — апгрейд робота)
     ========================================================================= */
  G.addScene("challenges", {
    recharge: false,
    enter() {
      this.back = { x: 40, y: 36, w: 150, h: 48, text: "← Меню", fs: 20 };
      this.items = [
        { key: "base_defense", title: "🛡 Оборона базы", desc: "волны врагов к реактору" },
        { key: "sandstorm", title: "🌪 Песчаная буря", desc: "выжить в буре с червём" },
        { key: "arena", title: "⚔ Арена", desc: "волны всех видов врагов" },
        { key: "flooded_hall", title: "🌊 Затопленный зал", desc: "успеть наверх до потопа" },
        { key: "mirror_hall", title: "🔆 Зеркальный зал", desc: "направь луч в приёмник" },
        { key: "sphinx", title: "🦁 Страж-сфинкс", desc: "загадка и битва" },
        { key: "shaft_boss", title: "🪨 Страж шахты", desc: "мини-босс: бур + кислота" },
        { key: "champion", title: "👑 Альфа-мутант", desc: "босс-чемпион · апгрейд в дропе" },
      ];
      // сетка 2 колонки × 4 ряда
      this.items.forEach((it, i) => {
        const col = i % 2, row = (i / 2) | 0;
        it.b = { x: VIEW.w / 2 - 400 + col * 410, y: 206 + row * 116, w: 390, h: 96 };
      });
    },
    update() {},
    onTap(x, y) {
      if (rectHit(this.back, x, y)) { G.audio.blip(); G.go("menu"); return; }
      for (const it of this.items) {
        if (rectHit(it.b, x, y)) { G.audio.blip(); G.go(it.key); return; }
      }
    },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#2a1810"); g.addColorStop(1, "#0a0608"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      starfield(ctx, 70, 21);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd9a0"; ctx.font = f(40, "800");
      ctx.fillText("🎯 ИСПЫТАНИЯ", VIEW.w / 2, 150);
      ctx.fillStyle = "rgba(255,230,200,0.7)"; ctx.font = f(16);
      ctx.fillText("Бонус-режимы. За каждое пройденное — апгрейд робота.", VIEW.w / 2, 185);
      for (const it of this.items) {
        const b = it.b;
        ctx.fillStyle = "rgba(40,30,24,0.85)"; rr(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
        ctx.strokeStyle = "#7a5a3a"; ctx.lineWidth = 2; rr(ctx, b.x, b.y, b.w, b.h, 12); ctx.stroke();
        ctx.fillStyle = "#ffe9c8"; ctx.font = f(26, "700"); ctx.textAlign = "left";
        ctx.fillText(it.title, b.x + 26, b.y + 38);
        ctx.fillStyle = "rgba(220,200,170,0.7)"; ctx.font = f(16);
        ctx.fillText(it.desc, b.x + 26, b.y + 66);
      }
      ctx.textAlign = "center";
      const owned = UPGRADES.filter((u) => G.state[u.key]).length;
      ctx.fillStyle = "#7de08a"; ctx.font = f(17, "600");
      ctx.fillText(`Апгрейдов установлено: ${owned}/${UPGRADES.length}`, VIEW.w / 2, 712);
      G.button(ctx, this.back, false);
      ctx.textAlign = "left";
    },
  });
  // helper: завершить испытание — выдать апгрейд и вернуться в меню испытаний
  function finishChallenge(s) {
    // выбор апгрейда вместо принудительного порядка; иначе — обычная задержка
    if (awardUpgrade("challenges")) return;
    grantNextUpgrade(s); // все апгрейды уже взяты → просто тост
    s.data._winT = 2.6;
  }

  // ===== ПЕСЧАНАЯ БУРЯ — выжить под ветром, песком и червём =====
  G.addScene("sandstorm", makeRoom({
    name: "sandstorm", dayValue: 1, dash: true,
    start: { x: VIEW.w / 2, y: 460 },
    drain: 0.5,
    narr: (s) => s.data.done ? "Буря стихла! Вы выстояли." : `🌪 Переживите бурю! Уклоняйтесь от выбросов червя. Осталось ${Math.ceil(s.data.timer)} с.`,
    bg(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#6a4424"); g.addColorStop(1, "#2a1810"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.fillStyle = "#7a4a26"; ctx.fillRect(0, 360, VIEW.w, VIEW.h - 360);
    },
    build(s) {
      G.dayCycle = 0.32; // испытание всегда при дневном свете — честный разряд
      s.data.timer = 26; s.data.done = false; s.data._winT = 0;
      s.data.wind = 0; s.data.worms = []; s.data.wormT = 2.4; s.data.spawnT = 3;
      s.data.sand = [];
      for (let i = 0; i < 90; i++) s.data.sand.push({ x: Math.random() * VIEW.w, y: Math.random() * VIEW.h, v: 200 + Math.random() * 300, r: 1 + Math.random() * 2 });
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: () => "← Выход", to: "challenges", ready: () => true };
    },
    update(s, dt) {
      const d = s.data;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      d.timer -= dt;
      if (d.timer <= 0) { d.done = true; s.toast("Буря пройдена!", 2.4); finishChallenge(s); return; }
      // ветер толкает робота
      d.wind = Math.sin(G.time * 0.7) * 120 + Math.sin(G.time * 2.3) * 40;
      s.robot.x = clamp(s.robot.x + d.wind * dt, s.bounds.x + s.robot.r, s.bounds.x + s.bounds.w - s.robot.r);
      // песчинки летят
      for (const p of d.sand) { p.x -= p.v * dt; if (p.x < 0) { p.x = VIEW.w; p.y = Math.random() * VIEW.h; } }
      // червь: телеграф → выброс
      d.wormT -= dt;
      if (d.wormT <= 0) {
        d.wormT = 1.6 + Math.random() * 1.2;
        const wx = clamp(s.robot.x + (Math.random() - 0.5) * 220, s.bounds.x + 40, s.bounds.x + s.bounds.w - 40);
        const wy = clamp(s.robot.y + (Math.random() - 0.5) * 120, s.bounds.y + 60, s.bounds.y + s.bounds.h - 30);
        d.worms.push({ x: wx, y: wy, tele: 0.9, erupt: 0 });
      }
      for (let i = d.worms.length - 1; i >= 0; i--) {
        const w = d.worms[i];
        if (w.tele > 0) {
          w.tele -= dt;
          if (w.tele <= 0) {
            w.erupt = 0.5; G.audio.boom(); s.data.cameraShake = 8;
            if (Math.hypot(s.robot.x - w.x, s.robot.y - w.y) < 52) s.hurt(12, { x: (s.robot.x < w.x ? -20 : 20), y: -10 });
            G.fx.burst(w.x, w.y, "#caa066", 30, 240, 0.9);
          }
        } else { w.erupt -= dt; if (w.erupt <= 0) d.worms.splice(i, 1); }
      }
    },
    drawProps(s, ctx) {
      for (const w of s.data.worms) drawSandWorm(ctx, w);
    },
    drawOver(s, ctx) {
      const d = s.data;
      // песок
      ctx.fillStyle = "rgba(210,170,110,0.5)";
      for (const p of d.sand) ctx.fillRect(p.x, p.y, p.r * 3, p.r);
      // дымка бури по краям + сужение видимости
      const vis = ctx.createRadialGradient(s.robot.x, s.robot.y, 80, s.robot.x, s.robot.y, 360);
      vis.addColorStop(0, "rgba(120,80,40,0)"); vis.addColorStop(1, "rgba(90,60,30,0.6)");
      ctx.fillStyle = vis; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      // таймер
      ctx.fillStyle = "rgba(8,5,3,0.6)"; rr(ctx, VIEW.w / 2 - 90, 76, 180, 34, 8); ctx.fill();
      ctx.fillStyle = "#ffd17a"; ctx.font = f(18, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`🌪 ${Math.ceil(Math.max(0, d.timer))} с`, VIEW.w / 2, 93);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
  }));
  function drawSandWorm(ctx, w) {
    if (w.tele > 0) {
      // телеграф — тёмное колышущееся пятно
      const p = 1 - w.tele / 0.9;
      ctx.fillStyle = `rgba(40,24,12,${0.3 + p * 0.4})`;
      ctx.beginPath(); ctx.ellipse(w.x, w.y, 30 + p * 20, 12 + p * 8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,160,60,${0.4 + 0.4 * Math.abs(Math.sin(G.time * 14))})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(w.x, w.y, 30 + p * 20, 12 + p * 8, 0, 0, 7); ctx.stroke();
      return;
    }
    // выброс червя
    const e = 1 - w.erupt / 0.5;
    const h = 90 * Math.sin(Math.min(1, e) * PI);
    ctx.save(); ctx.translate(w.x, w.y);
    // тело
    const bg = ctx.createLinearGradient(0, -h, 0, 10);
    bg.addColorStop(0, "#caa472"); bg.addColorStop(1, "#5a3a1a");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(-22, 10); ctx.quadraticCurveTo(-18, -h, 0, -h - 6); ctx.quadraticCurveTo(18, -h, 22, 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2; ctx.stroke();
    // сегменты
    ctx.strokeStyle = "rgba(60,36,16,0.6)"; ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) { const yy = -h * (i / 4); ctx.beginPath(); ctx.moveTo(-16 + i * 2, yy); ctx.lineTo(16 - i * 2, yy); ctx.stroke(); }
    // пасть с зубами
    ctx.fillStyle = "#2a1408"; ctx.beginPath(); ctx.ellipse(0, -h - 2, 14, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#e8d0a0";
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 10, -h - 2 + Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 6, -h - 2 + Math.sin(a) * 5); ctx.lineTo(Math.cos(a + 0.4) * 9, -h - 2 + Math.sin(a + 0.4) * 8); ctx.fill(); }
    ctx.restore();
  }

  // ===== АРЕНА — волны всех видов врагов (преследуют робота) =====
  G.addScene("arena", makeRoom({
    name: "arena", dayValue: 1,
    start: { x: VIEW.w / 2, y: VIEW.h / 2 },
    drain: 0.15,
    narr: (s) => s.data.done ? "Арена очищена! Вы выстояли." : `⚔ Волна ${Math.min(s.data.wave + 1, s.data.waves.length)}/${s.data.waves.length}. Бейте врагов «Действием»!`,
    bg(ctx, s) { G.drawTombRoom(ctx, s.bounds, { floorTop: "#4a3650", floorBot: "#1a1420" }); },
    build(s) {
      G.dayCycle = 0.32; // честная сложность вне зависимости от времени суток
      s.data.wave = 0; s.data.spawnT = 1.0; s.data.between = 2.0; s.data.done = false; s.data._winT = 0;
      s.data.waves = [
        ["grunt", "scout", "spitter"],
        ["scout", "drone", "spitter", "burrower", "brute"],
        ["drone", "spitter", "spitter", "burrower", "burrower", "brute", "grunt"],
      ];
      s.data.queue = s.data.waves[0].slice();
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: () => "← Выход", to: "challenges", ready: () => true };
    },
    update(s, dt) {
      const d = s.data;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      if (d.queue.length) {
        d.spawnT -= dt;
        if (d.spawnT <= 0) {
          d.spawnT = 0.8 + Math.random() * 0.5;
          const kind = d.queue.shift();
          const b = s.bounds, edge = Math.floor(Math.random() * 4);
          let x, y;
          if (edge === 0) { x = b.x + 24; y = b.y + 40 + Math.random() * (b.h - 80); }
          else if (edge === 1) { x = b.x + b.w - 24; y = b.y + 40 + Math.random() * (b.h - 80); }
          else if (edge === 2) { x = b.x + 60 + Math.random() * (b.w - 120); y = b.y + 24; }
          else { x = b.x + 60 + Math.random() * (b.w - 120); y = b.y + b.h - 24; }
          const mu = makeMutant(x, y, null, kind); mu.aware = true; mu.blind = false;
          if (d.wave >= 2 && Math.random() < 0.35) makeElite(mu); // финальная волна — элиты
          s.mutants.push(mu);
        }
      } else if (s.mutants.length === 0) {
        d.wave++;
        if (d.wave >= d.waves.length) { d.done = true; s.toast("Все волны очищены!", 2.4); finishChallenge(s); return; }
        d.queue = d.waves[d.wave].slice(); d.spawnT = d.between; s.toast(`Волна ${d.wave + 1}!`, 1.6);
      }
    },
    drawOver(s, ctx) {
      ctx.fillStyle = "rgba(8,5,12,0.6)"; rr(ctx, VIEW.w - 200, 76, 180, 32, 8); ctx.fill();
      ctx.fillStyle = "#d7a0ff"; ctx.font = f(15, "700"); ctx.textBaseline = "middle";
      ctx.fillText(`⚔ Волна ${Math.min(s.data.wave + 1, s.data.waves.length)}/${s.data.waves.length}`, VIEW.w - 188, 93);
      ctx.fillStyle = "#ff8a4a"; ctx.textAlign = "right"; ctx.fillText("враги: " + s.mutants.length, VIEW.w - 30, 93);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
  }));

  // ===== СТРАЖ ШАХТЫ — мини-босс: зарывается и плюётся кислотой =====
  G.addScene("shaft_boss", makeRoom({
    name: "shaft_boss", dayValue: 1,
    start: { x: VIEW.w / 2, y: VIEW.h - 160 },
    drain: 0.16,
    narr: (s) => s.data.done ? "Страж шахты повержен! Глубины ваши." :
      "🪨 СТРАЖ ШАХТЫ! Бейте, когда вынырнет. Под землёй он неуязвим — уворачивайтесь от кислоты и подкопов.",
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#2a1c14"); g.addColorStop(1, "#0a0704"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      G.drawTombRoom(ctx, s.bounds, { floorTop: "#42352a", floorBot: "#1a120c" });
      // сталактиты сверху
      ctx.fillStyle = "#2a2018";
      for (let i = 0; i < 8; i++) { const x = s.bounds.x + 40 + i * (s.bounds.w - 80) / 7; ctx.beginPath(); ctx.moveTo(x - 10, s.bounds.y); ctx.lineTo(x + 10, s.bounds.y); ctx.lineTo(x, s.bounds.y + 28 + (i % 3) * 12); ctx.closePath(); ctx.fill(); }
    },
    build(s) {
      G.dayCycle = 0.32;
      s.data.done = false; s.data._winT = 0;
      const b = s.bounds;
      s.data.mb = {
        x: b.x + b.w / 2, y: b.y + 150, hp: 12, maxHp: 12,
        mode: "idle", cd: 1.4, telegT: 0, buried: false, surfaceT: 0, hitT: 0, spitN: 0, spitT: 0, face: 1,
      };
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: () => "← Выход", to: "challenges", ready: () => true };
    },
    update(s, dt) {
      const d = s.data, mb = d.mb;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      if (mb.hitT > 0) mb.hitT -= dt;
      mb.face = s.robot.x < mb.x ? -1 : 1;
      const dx = s.robot.x - mb.x, dy = s.robot.y - mb.y, dd = Math.hypot(dx, dy) || 1;

      if (mb.mode === "idle") {
        mb.cd -= dt;
        if (mb.cd <= 0) {
          const r = Math.random();
          if (r < 0.4) { mb.mode = "spit"; mb.telegT = 0.7; }
          else if (r < 0.75) { mb.mode = "burrow"; mb.telegT = 0.6; }
          else { mb.mode = "summon"; mb.telegT = 0.7; }
        }
      } else if (mb.mode === "spit") {
        mb.telegT -= dt;
        if (mb.telegT <= 0 && mb.spitN === 0) { mb.spitN = 3; mb.spitT = 0; }
        if (mb.spitN > 0) {
          mb.spitT -= dt;
          if (mb.spitT <= 0) {
            mb.spitT = 0.18; mb.spitN--;
            if (!s.enemyShots) s.enemyShots = [];
            const spread = (mb.spitN - 1) * 0.16;
            const ang = Math.atan2(dy, dx) + spread, sp = 300;
            s.enemyShots.push({ x: mb.x, y: mb.y - 4, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 2.4, dmg: 9, r: 8 });
            G.audio.tone(240, 0.12, "square", 0.05);
            if (mb.spitN === 0) { mb.mode = "idle"; mb.cd = 1.2; }
          }
        }
      } else if (mb.mode === "burrow") {
        mb.telegT -= dt;
        if (mb.telegT <= 0) {
          if (!mb.buried) { mb.buried = true; mb.surfaceT = 1.5; G.fx.burst(mb.x, mb.y, "#7a4a2a", 22, 200, 0.8); G.audio.tone(90, 0.25, "sawtooth", 0.06); G.shake(7); }
          else {
            mb.surfaceT -= dt;
            const sp = 150;
            mb.x += (dx / dd) * sp * dt; mb.y += (dy / dd) * sp * dt;
            const b = s.bounds; mb.x = clamp(mb.x, b.x + 60, b.x + b.w - 60); mb.y = clamp(mb.y, b.y + 80, b.y + b.h - 60);
            if (mb.surfaceT <= 0 || dd < 50) {
              mb.buried = false; mb.mode = "idle"; mb.cd = 1.3;
              G.fx.burst(mb.x, mb.y, "#caa07a", 28, 260, 0.9); G.audio.boom(); G.shake(11); G.hitStop(0.05);
              if (dd < 90) s.hurt(16, { x: dx < 0 ? 24 : -24, y: -10 });
            }
          }
        }
      } else if (mb.mode === "summon") {
        mb.telegT -= dt;
        if (mb.telegT <= 0) {
          const adds = ["spitter", "grunt"];
          for (let i = 0; i < 2; i++) {
            const b = s.bounds, ex = b.x + 60 + Math.random() * (b.w - 120), ey = b.y + 50 + Math.random() * 60;
            const mu = makeMutant(ex, ey, null, adds[i]); mu.aware = true; mu.blind = false; mu._scrap = 1; s.mutants.push(mu);
          }
          G.fx.burst(mb.x, mb.y - 10, "#d7a0ff", 24, 220, 0.8); G.audio.tone(360, 0.18, "sawtooth", 0.05);
          mb.mode = "idle"; mb.cd = 1.6;
        }
      }

      // удар робота по боссу (только когда не зарыт)
      const pz = punchZone(s.robot);
      if (pz && mb.hitT <= 0 && !mb.buried) {
        const overlap = (pz.x + pz.w > mb.x - 46) && (pz.x < mb.x + 46) && (pz.y + pz.h > mb.y - 44) && (pz.y < mb.y + 40);
        if (overlap) {
          mb.hp -= (G.state.upgPunch ? 2 : 1); mb.hitT = 0.42;
          G.audio.hit(); G.shake(8); G.hitStop(0.06); G.fx.ring(mb.x, mb.y, "#ffe6a0", 60, 0.34);
          G.fx.burst(mb.x, mb.y, "#caa07a", 16, 180, 0.6);
          if (mb.hp <= 0) {
            mb.hp = 0; d.done = true; d._winT = 2.8;
            G.state.scrap += 8; G.fx.burst(mb.x, mb.y, "#ffd17a", 60, 360, 1.4); G.audio.win(); G.shake(14);
            s.toast("Страж повержен! +8 лома ⚙", 2.6); finishChallenge(s); return;
          }
        }
      }
      // контактный урон от зарытого подкопа уже обработан при выныривании
    },
    drawProps(s, ctx) { drawShaftBoss(ctx, s.data.mb); },
    drawOver(s, ctx) {
      const mb = s.data.mb;
      const bx = VIEW.w / 2 - 180, by = 74, bw = 360;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; rr(ctx, bx, by, bw, 22, 6); ctx.fill();
      ctx.fillStyle = "#c98a3a"; rr(ctx, bx + 3, by + 3, (bw - 6) * (Math.max(0, mb.hp) / mb.maxHp), 16, 4); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = f(14, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`🪨 СТРАЖ ШАХТЫ ${Math.max(0, Math.ceil(mb.hp))}/${mb.maxHp}`, VIEW.w / 2, by + 11);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    },
  }));
  function drawShaftBoss(ctx, mb) {
    const t = G.time;
    // зарытый — большой движущийся бугор
    if (mb.buried) {
      ctx.save(); ctx.translate(mb.x, mb.y);
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(0, 16, 52, 14, 0, 0, 7); ctx.fill();
      const mg = ctx.createLinearGradient(0, -24, 0, 18); mg.addColorStop(0, "#8a5a34"); mg.addColorStop(1, "#4a2e18");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.moveTo(-50, 16);
      for (let i = -50; i <= 50; i += 8) ctx.lineTo(i, 16 - 34 * Math.exp(-(i * i) / 900) + Math.sin(t * 16 + i) * 2);
      ctx.lineTo(50, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(120,80,48,0.7)";
      for (let i = 0; i < 7; i++) { const a = t * 9 + i * 1.4; ctx.fillRect(Math.cos(a) * 34, 8 - Math.abs(Math.sin(a)) * 22, 3, 3); }
      ctx.restore();
      return;
    }
    const breath = Math.sin(t * 2) * 3;
    const teleShake = mb.telegT > 0 ? Math.sin(t * 50) * 3 : 0;
    const hurt = mb.hitT > 0 ? mb.hitT / 0.42 : 0;
    ctx.save(); ctx.translate(mb.x + teleShake + (hurt ? Math.sin(t * 70) * 3 : 0), mb.y + breath);
    ctx.scale(mb.face, 1);
    // тень
    ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.beginPath(); ctx.ellipse(0, 40, 50, 12, 0, 0, 7); ctx.fill();
    // тело-валун с бронепластинами
    const body = ctx.createRadialGradient(-8, -10, 6, 0, 0, 48);
    body.addColorStop(0, "#8a6a48"); body.addColorStop(1, "#4a3320");
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 46, 38, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#2a1c12"; ctx.lineWidth = 3; ctx.stroke();
    // кристаллы на спине
    for (const c of [[-26, -26, 10], [-6, -34, 13], [16, -28, 9]]) {
      ctx.fillStyle = "#9ce0a8"; ctx.beginPath();
      ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] - 5, c[1] + c[2]); ctx.lineTo(c[0] + 5, c[1] + c[2]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#3a6a44"; ctx.lineWidth = 1; ctx.stroke();
    }
    // бронепластины
    ctx.fillStyle = "#5a4530"; for (const p of [[-20, 6], [4, 10], [24, 2]]) { rr(ctx, p[0] - 9, p[1], 18, 14, 3); ctx.fill(); }
    // челюсти-жвалы
    ctx.fillStyle = "#3a2a1a";
    ctx.beginPath(); ctx.moveTo(34, -8); ctx.lineTo(52, -16); ctx.lineTo(44, -2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(34, 10); ctx.lineTo(52, 18); ctx.lineTo(44, 4); ctx.closePath(); ctx.fill();
    // кислотная пасть (светится перед плевком)
    const charge = mb.mode === "spit" && mb.telegT > 0 ? 1 - mb.telegT / 0.7 : (mb.spitN > 0 ? 1 : 0);
    ctx.fillStyle = `rgba(150,230,70,${0.5 + charge * 0.45})`;
    ctx.beginPath(); ctx.arc(34, 1, 8 + charge * 4, 0, 7); ctx.fill();
    ctx.strokeStyle = "#2a4a14"; ctx.lineWidth = 1.5; ctx.stroke();
    // глаза
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(8, -10, 5, 0, 7); ctx.arc(22, -8, 5, 0, 7); ctx.fill();
    ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc(9, -10, 2, 0, 7); ctx.arc(23, -8, 2, 0, 7); ctx.fill();
    // вспышка урона
    if (hurt) { ctx.fillStyle = `rgba(255,80,60,${hurt * 0.5})`; ctx.beginPath(); ctx.ellipse(0, 0, 50, 42, 0, 0, 7); ctx.fill(); }
    ctx.restore();
    // подпись атаки
    if (mb.telegT > 0 && mb.mode !== "idle") {
      const lbl = mb.mode === "spit" ? "КИСЛОТА!" : mb.mode === "burrow" ? "ПОДКОП!" : "ЗОВ!";
      ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#1a0a04"; ctx.lineWidth = 4;
      ctx.font = `900 italic 20px ${G.FONT}`; ctx.textAlign = "center";
      ctx.strokeText(lbl, mb.x, mb.y - 56); ctx.fillText(lbl, mb.x, mb.y - 56); ctx.textAlign = "left";
    }
  }

  // ===== БОСС-ЧЕМПИОН: АЛЬФА-МУТАНТ (8-е испытание, гарантированный апгрейд) =====
  G.addScene("champion", makeRoom({
    name: "champion", dayValue: 1, drain: 0.16,
    start: { x: 140, y: VIEW.h - 170 },
    narr: (s) => s.data.done ? "АЛЬФА-МУТАНТ повержен! Забирай награду." :
      "👑 АЛЬФА-МУТАНТ — вожак стаи! Уклоняйся дэшем от тарана и кислоты, бей в окнах. При 50% он звереет.",
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#241430"); g.addColorStop(1, "#0e0814"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      G.drawTombRoom(ctx, s.bounds, { floorTop: "#3a2c4a", floorBot: "#1a1224" });
    },
    build(s) {
      G.dayCycle = 0.32; s.data.done = false; s.data._winT = 0; s.champRings = [];
      const b = s.bounds;
      s.data.boss = {
        x: b.x + b.w / 2, y: b.y + 130, hp: 22, maxHp: 22,
        mode: "idle", cd: 1.4, telegT: 0, swingT: 0, hitT: 0, face: 1,
        chDX: 0, chDY: 0, spitN: 0, spitT: 0, _fired: false,
      };
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => "← Выход", to: "challenges", ready: () => true,
      };
    },
    update(s, dt) {
      const d = s.data, c = d.boss;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      if (c.hitT > 0) c.hitT -= dt;
      if (c.swingT > 0) c.swingT = Math.max(0, c.swingT - dt);
      c.face = s.robot.x < c.x ? -1 : 1;
      const dx = s.robot.x - c.x, dy = s.robot.y - c.y, dd = Math.hypot(dx, dy) || 1;
      const rage = c.hp <= c.maxHp / 2;

      if (c.mode === "idle") {
        // медленно подбирается, держит средний бой
        if (dd > 150) { c.x += (dx / dd) * 46 * dt; c.y += (dy / dd) * 46 * dt; }
        else if (dd < 90) { c.x -= (dx / dd) * 36 * dt; c.y -= (dy / dd) * 36 * dt; }
        c.cd -= dt;
        if (c.cd <= 0) {
          const opts = rage ? ["charge", "spit", "summon", "slam", "charge"] : ["charge", "spit", "summon", "slam"];
          c.mode = opts[Math.floor(Math.random() * opts.length)];
          c.telegT = c.mode === "charge" ? 0.65 : 0.7; c._fired = false;
        }
      } else if (c.mode === "charge") {
        c.telegT -= dt; c.chAng = Math.atan2(dy, dx);
        if (c.telegT <= 0) {
          if (!c._fired) { c._fired = true; const m = Math.hypot(dx, dy) || 1; c.chDX = dx / m; c.chDY = dy / m; c.chT = 0.55; c.swingT = 0.3; G.audio.tone(140, 0.24, "sawtooth", 0.07); }
          c.chT -= dt;
          const b = s.bounds, nx = c.x + c.chDX * 560 * dt, ny = c.y + c.chDY * 560 * dt;
          const hitWall = nx < b.x + 50 || nx > b.x + b.w - 50 || ny < b.y + 40 || ny > b.y + b.h - 40;
          c.x = clamp(nx, b.x + 50, b.x + b.w - 50); c.y = clamp(ny, b.y + 40, b.y + b.h - 40);
          if (c.hitT <= 0 && dd < 56) { s.hurt(18, { x: c.chDX * 30, y: c.chDY * 30 }); G.shake(9); c.mode = "recover"; c.cd = rage ? 0.7 : 1.2; }
          else if (hitWall) { c.mode = "recover"; c.cd = rage ? 0.8 : 1.4; c.stunT = 1.1; G.shake(10); G.hitStop(0.05); G.audio.boom(); G.fx.burst(c.x, c.y, "#d7a0ff", 20, 220, 0.7); }
          else if (c.chT <= 0) { c.mode = "recover"; c.cd = rage ? 0.8 : 1.4; }
        }
      } else if (c.mode === "spit") {
        c.telegT -= dt;
        if (c.telegT <= 0 && c.spitN === 0 && !c._fired) { c._fired = true; c.spitN = rage ? 6 : 4; c.spitT = 0; }
        if (c.spitN > 0) {
          c.spitT -= dt;
          if (c.spitT <= 0) {
            c.spitT = 0.12; c.spitN--;
            if (!s.enemyShots) s.enemyShots = [];
            const spread = (c.spitN - 2.5) * 0.16, ang = Math.atan2(dy, dx) + spread, sp = 300;
            s.enemyShots.push({ x: c.x, y: c.y + 10, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 2.6, dmg: 9, r: 8 });
            G.audio.tone(240, 0.1, "square", 0.05);
            if (c.spitN === 0) { c.mode = "idle"; c.cd = rage ? 0.9 : 1.3; }
          }
        }
      } else if (c.mode === "summon") {
        c.telegT -= dt;
        if (c.telegT <= 0 && !c._fired) {
          c._fired = true;
          const kinds = ["grunt", "scout", "spitter"];
          for (let i = 0; i < 2; i++) { const b = s.bounds, ex = b.x + 80 + Math.random() * (b.w - 160); const mu = makeMutant(ex, b.y + 60, null, kinds[Math.floor(Math.random() * kinds.length)]); mu.aware = true; mu.blind = false; mu._scrap = 1; if (rage && i === 0) makeElite(mu); s.mutants.push(mu); }
          G.fx.burst(c.x, c.y - 10, "#d7a0ff", 24, 220, 0.8); G.audio.tone(360, 0.18, "sawtooth", 0.05);
          c.mode = "idle"; c.cd = 1.8;
        }
      } else if (c.mode === "slam") {
        c.telegT -= dt;
        if (c.telegT <= 0 && !c._fired) { c._fired = true; if (!s.champRings) s.champRings = []; s.champRings.push({ x: c.x, y: c.y + 30, r: 0, max: 300, life: 0.6 }); G.shake(13); G.hitStop(0.05); G.audio.boom(); c.mode = "idle"; c.cd = rage ? 1.0 : 1.5; }
      } else if (c.mode === "recover") {
        if (c.stunT > 0) c.stunT -= dt;
        c.cd -= dt; if (c.cd <= 0) { c.mode = "idle"; c.cd = rage ? 0.5 : 0.9; c.stunT = 0; }
      }
      // slam-кольца
      if (s.champRings) for (let i = s.champRings.length - 1; i >= 0; i--) {
        const p = s.champRings[i]; p.life -= dt; p.r = p.max * (1 - p.life / 0.6);
        if (!p._dmg && p.r > 40 && Math.abs(Math.hypot(s.robot.x - p.x, s.robot.y - p.y) - p.r) < 26) { p._dmg = true; s.hurt(13, { x: (s.robot.x - p.x) * 0.1, y: (s.robot.y - p.y) * 0.1 }); }
        if (p.life <= 0) s.champRings.splice(i, 1);
      }
      // удар робота (бьём, когда не в неуязвимом телеграфе… он всегда уязвим)
      const pz = punchZone(s.robot);
      if (pz && c.hitT <= 0) {
        const ov = (pz.x + pz.w > c.x - 46) && (pz.x < c.x + 46) && (pz.y + pz.h > c.y - 44) && (pz.y < c.y + 46);
        if (ov) {
          const dmg = (G.state.upgPunch ? 2 : 1) * (c.stunT > 0 ? 2 : 1); // оглушённого бьём вдвое
          c.hp -= dmg; c.hitT = 0.4;
          G.audio.hit(); G.shake(8); G.hitStop(0.06); G.fx.ring(c.x, c.y, "#e0b0ff", 64, 0.34); G.fx.burst(c.x, c.y, "#d7a0ff", 16, 200, 0.6);
          if (c.hp <= 0) {
            c.hp = 0; d.done = true; d._winT = 3.0;
            G.state.scrap += 14; G.fx.burst(c.x, c.y, "#ffd24a", 70, 420, 1.5); G.fx.ring(c.x, c.y, "#ffe14a", 120, 0.6); G.shake(15); G.audio.win();
            s.toast("АЛЬФА-МУТАНТ ПОВЕРЖЕН! +14 лома ⚙ и апгрейд!", 3.2);
            s.mutants.length = 0; s.enemyShots = []; s.champRings = [];
            awardUpgrade("challenges"); // гарантированный выбор апгрейда
            return;
          }
        }
      }
    },
    drawProps(s, ctx) {
      if (!s.data.done) drawChampion(ctx, s.data.boss);
      if (s.champRings) for (const p of s.champRings) { ctx.strokeStyle = `rgba(200,150,255,${Math.max(0, p.life / 0.6) * 0.9})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke(); }
    },
    drawOver(s, ctx) {
      const c = s.data.boss;
      if (s.data.done) return;
      const bx = VIEW.w / 2 - 190, by = 70, bw = 380;
      ctx.fillStyle = "rgba(0,0,0,0.55)"; rr(ctx, bx, by, bw, 22, 6); ctx.fill();
      const rage = c.hp <= c.maxHp / 2;
      ctx.fillStyle = rage ? "#ff5a3a" : "#c98aff"; rr(ctx, bx + 3, by + 3, (bw - 6) * (Math.max(0, c.hp) / c.maxHp), 16, 4); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = f(14, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`👑 АЛЬФА-МУТАНТ ${Math.max(0, Math.ceil(c.hp))}/${c.maxHp}${rage ? "  ⚡ЯРОСТЬ" : ""}`, VIEW.w / 2, by + 11);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    },
  }));
  function drawChampion(ctx, c) {
    const t = G.time;
    const breath = Math.sin(t * 2) * 3;
    const tele = c.telegT > 0 && c.mode !== "idle" && c.mode !== "recover";
    const teleShake = tele ? Math.sin(t * 50) * 3 : 0;
    const hurt = c.hitT > 0 ? c.hitT / 0.4 : 0;
    const rage = c.hp <= c.maxHp / 2;
    let lean = 0;
    if (c.mode === "charge" && c.telegT > 0) lean = -5 * (1 - c.telegT / 0.65);
    else if (c.mode === "charge") lean = 9;
    ctx.save(); ctx.translate(c.x + teleShake + (hurt ? Math.sin(t * 70) * 3 : 0), c.y + breath);
    // золотая аура вожака
    const ar = 60, pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const ag = ctx.createRadialGradient(0, 0, 20, 0, 0, ar);
    ag.addColorStop(0, "rgba(216,160,255,0)"); ag.addColorStop(0.6, `rgba(${rage ? "255,90,60" : "200,140,255"},${0.18 + pulse * 0.16})`); ag.addColorStop(1, "rgba(200,140,255,0)");
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, ar, 0, 7); ctx.fill();
    // тень
    ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.beginPath(); ctx.ellipse(0, 44, 56, 13, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.scale(c.face, 1); ctx.translate(lean, 0);
    // тело — огромный колючий вожак
    const bg = ctx.createRadialGradient(-8, -10, 6, 0, 0, 46);
    bg.addColorStop(0, "#b8f088"); bg.addColorStop(0.6, "#5aa83a"); bg.addColorStop(1, "#2a5a1e");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 4, 40, 36, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#173a10"; ctx.lineWidth = 3; ctx.stroke();
    // боевая раскраска
    ctx.strokeStyle = "rgba(120,40,160,0.6)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(-10, 8); ctx.moveTo(14, -8); ctx.lineTo(22, 6); ctx.stroke();
    // массивные шипы на спине
    ctx.fillStyle = "#2a5a1e";
    for (const sx of [-26, -14, 0, 14, 26]) { ctx.beginPath(); ctx.moveTo(sx - 5, -28); ctx.lineTo(sx + 5, -28); ctx.lineTo(sx, -28 - (16 + Math.abs(sx) * 0.2)); ctx.closePath(); ctx.fill(); }
    // костяная корона
    ctx.fillStyle = "#efe6d0"; ctx.strokeStyle = "#9a8a6a"; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-22, -30); ctx.lineTo(-22, -44); ctx.lineTo(-11, -36); ctx.lineTo(0, -50); ctx.lineTo(11, -36); ctx.lineTo(22, -44); ctx.lineTo(22, -30);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rage ? "#ff5a3a" : "#caa0ff"; ctx.beginPath(); ctx.arc(0, -42, 3, 0, 7); ctx.fill(); // самоцвет в короне
    // горящие глаза
    const eg = rage ? "#ff5030" : "#ff3a2a";
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-12, -6, 6, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(12, -6, 6, 0, 7); ctx.fill();
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(-11, -6, 3.2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(13, -6, 3.2, 0, 7); ctx.fill();
    if (rage || tele) { ctx.fillStyle = `rgba(255,80,40,${0.4 + 0.3 * Math.sin(t * 12)})`; ctx.beginPath(); ctx.arc(-12, -6, 9, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(12, -6, 9, 0, 7); ctx.fill(); }
    // клыкастая пасть (светится перед плевком)
    const spitCharge = c.mode === "spit" && (c.telegT > 0 || c.spitN > 0) ? 1 : 0;
    ctx.fillStyle = spitCharge ? `rgba(150,230,70,${0.6 + 0.3 * Math.sin(t * 18)})` : "#1a3a10";
    ctx.beginPath(); ctx.ellipse(0, 16, 18, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(-16, 11); ctx.lineTo(-12, 22); ctx.lineTo(-7, 11); ctx.lineTo(-2, 22); ctx.lineTo(3, 11); ctx.lineTo(8, 22); ctx.lineTo(13, 11); ctx.lineTo(16, 18); ctx.lineTo(-16, 14); ctx.closePath(); ctx.fill();
    // вспышка урона
    if (hurt) { ctx.fillStyle = `rgba(255,80,60,${hurt * 0.5})`; ctx.beginPath(); ctx.ellipse(0, 4, 44, 40, 0, 0, 7); ctx.fill(); }
    ctx.restore();
    ctx.restore();
    // телеграф тарана — красная стрела к роботу
    if (c.mode === "charge" && c.telegT > 0) {
      const ang = c.chAng || 0, k = 1 - c.telegT / 0.65, len = 50 + k * 80, pl = 0.5 + 0.5 * Math.sin(t * 22);
      ctx.save(); ctx.strokeStyle = `rgba(255,70,40,${0.5 + pl * 0.4})`; ctx.lineWidth = 5 + k * 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(c.x + Math.cos(ang) * 40, c.y + Math.sin(ang) * 40); ctx.lineTo(c.x + Math.cos(ang) * len, c.y + Math.sin(ang) * len); ctx.stroke();
      ctx.restore();
    }
    // подпись атаки
    if (tele) {
      const lbl = c.mode === "charge" ? "ТАРАН!" : c.mode === "spit" ? "ЗАЛП КИСЛОТЫ!" : c.mode === "summon" ? "ЗОВ СТАИ!" : "ЗЕМЛЕТРЯСЕНИЕ!";
      ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#1a0a14"; ctx.lineWidth = 4;
      ctx.font = `900 italic 22px ${G.FONT}`; ctx.textAlign = "center";
      ctx.strokeText(lbl, c.x, c.y - 64); ctx.fillText(lbl, c.x, c.y - 64); ctx.textAlign = "left";
    }
  }

  // ===== ЗАТОПЛЕННЫЙ ЗАЛ — успеть к выходу наверху, пока поднимается вода =====
  G.addScene("flooded_hall", makeRoom({
    name: "flooded_hall", dayValue: 1, dash: true,
    start: { x: VIEW.w / 2, y: 0 }, // переопределим ниже на низ комнаты
    drain: 0.2,
    narr: (s) => s.data.done ? "Шлюз открыт — вода уходит! Зал пройден." : "🌊 Вода прибывает снизу! Доберитесь до ВЫХОДА наверху. В воде робот вязнет.",
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#1a2e3a"); g.addColorStop(1, "#0a161e"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      G.drawTombRoom(ctx, s.bounds, { floorTop: "#2a4250", floorBot: "#15242e" });
    },
    build(s) {
      const b = s.bounds;
      // старт снизу по центру
      s.robot.x = b.x + b.w / 2; s.robot.y = b.y + b.h - 30; s._sx = s.robot.x; s._sy = s.robot.y;
      G.dayCycle = 0.32;               // честный разряд при дневном свете
      s.data.waterTop = b.y + b.h;     // уровень воды (сверху вниз меньше = выше)
      s.data.rise = (b.h - 60) / 27;   // подъём за ~27 c до почти верха
      s.data.done = false; s.data._winT = 0;
      // барьеры-стены, создающие змейку-путь наверх
      s.obstacles.push({ x: b.x + 160, y: b.y + 360, w: b.w - 320, h: 26 });
      s.obstacles.push({ x: b.x, y: b.y + 230, w: b.w - 260, h: 26 });
      s.obstacles.push({ x: b.x + 260, y: b.y + 110, w: b.w - 260, h: 26 });
      // выход — наверху
      s.exitZone = {
        x: b.x + b.w - 110, y: b.y - 6, w: 96, h: 60,
        label: () => "↑ ВЫХОД", to: "challenges",
        ready: () => true,
        onExit: () => { s.data.done = true; s.toast("Шлюз открыт!", 2.0); finishChallenge(s); s.data._winT = 2.4; }
      };
    },
    drawProps(s, ctx) {
      // видимые каменные уступы-барьеры (иначе бьёшься в невидимые стены)
      for (const o of s.obstacles) {
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        g.addColorStop(0, "#5a6a72"); g.addColorStop(1, "#2a3a42");
        ctx.fillStyle = g; rr(ctx, o.x, o.y, o.w, o.h, 5); ctx.fill();
        ctx.fillStyle = "rgba(180,210,225,0.25)"; rr(ctx, o.x, o.y, o.w, 4, 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; rr(ctx, o.x, o.y, o.w, o.h, 5); ctx.stroke();
      }
    },
    update(s, dt) {
      const d = s.data;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      // вода поднимается
      d.waterTop = Math.max(s.bounds.y + 20, d.waterTop - d.rise * dt);
      // робот в воде — вязнет и теряет заряд
      if (s.robot.y > d.waterTop) {
        s.robot.y -= 10 * dt;                // плавучесть выталкивает вверх
        G.state.battery = Math.max(0, G.state.battery - dt * 4);
        if (G.state.battery <= 0) { G.state.battery = 0; G.go("gameover"); return; }
      }
    },
    drawOver(s, ctx) {
      const d = s.data, b = s.bounds;
      // вода
      const wy = d.waterTop;
      const wg = ctx.createLinearGradient(0, wy, 0, b.y + b.h);
      wg.addColorStop(0, "rgba(90,170,210,0.55)"); wg.addColorStop(1, "rgba(30,90,130,0.75)");
      ctx.fillStyle = wg; ctx.fillRect(b.x, wy, b.w, b.y + b.h - wy);
      // блики на поверхности
      ctx.strokeStyle = "rgba(180,230,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = b.x; x < b.x + b.w; x += 10) {
        const yy = wy + Math.sin(x * 0.05 + G.time * 3) * 3;
        if (x === b.x) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
      // индикатор глубины
      ctx.fillStyle = "rgba(8,16,22,0.6)"; rr(ctx, VIEW.w / 2 - 80, 76, 160, 30, 8); ctx.fill();
      const depth = Math.round((1 - (wy - b.y) / b.h) * 100);
      ctx.fillStyle = "#7be0ff"; ctx.font = f(15, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`🌊 Вода: ${depth}%`, VIEW.w / 2, 91); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
  }));

  // ===== ЗЕРКАЛЬНЫЙ ЗАЛ — направь лазер в приёмник, вращая зеркала =====
  G.addScene("mirror_hall", makeRoom({
    name: "mirror_hall", dayValue: 1,
    start: { x: VIEW.w / 2, y: VIEW.h - 110 },
    drain: 0.12,
    narr: (s) => s.data.done ? "Луч в приёмнике — путь открыт!" : "🔆 Поверни зеркала «Действием», чтобы довести луч от излучателя до приёмника.",
    bg(ctx, s) { G.drawTombRoom(ctx, s.bounds, { floorTop: "#2a2a3e", floorBot: "#14141f" }); },
    build(s) {
      const b = s.bounds;
      // сетка координат
      s.data.gx = b.x + 90; s.data.gy = b.y + 90; s.data.cell = 120;
      const C = (cx, cy) => ({ x: s.data.gx + cx * s.data.cell, y: s.data.gy + cy * s.data.cell });
      s.data.emitter = { cell: [0, 0], dir: [1, 0] };       // излучатель слева сверху, луч вправо
      s.data.receiver = { cell: [5, 3] };                    // приёмник справа
      // зеркала: ориентация '/' или '\\', переключаются роботом. По умолчанию '/'.
      // Решение: оба узловых зеркала → '\\'. Третье — отвлекающее (вне пути луча).
      s.data.mirrors = [
        { cell: [3, 0], o: "/" },  // узел 1: вправо→вниз (нужно '\')
        { cell: [3, 3], o: "/" },  // узел 2: вниз→вправо (нужно '\')
        { cell: [1, 2], o: "/" },  // отвлекающее зеркало (луч его не задевает)
      ];
      s.data.C = C; s.data.done = false; s.data._winT = 0; s.data.beam = [];
      // интерактивы — вращение каждого зеркала
      s.data.mirrors.forEach((m) => {
        const p = C(m.cell[0], m.cell[1]);
        s.interactables.push({
          x: p.x, y: p.y, r: 78,
          label: () => "Повернуть зеркало 🔄",
          ready: () => !s.data.done,
          act() { m.o = m.o === "/" ? "\\" : "/"; G.audio.tone(480, 0.06, "sine", 0.05); }
        });
      });
      s.exitZone = { x: b.x, y: b.y + b.h / 2 - 48, w: 66, h: 96, label: () => s.data.done ? "→ Выход" : "← Выход", to: "challenges", ready: () => true };
    },
    update(s, dt) {
      const d = s.data;
      if (d.done) { d._winT -= dt; if (d._winT <= 0) G.go("challenges"); return; }
      // трассируем луч по клеткам
      d.beam = traceBeam(d);
      const last = d.beam[d.beam.length - 1];
      if (last && last.hitReceiver) {
        d.done = true; s.toast("Луч пойман приёмником!", 2.2); finishChallenge(s); d._winT = 2.4;
      }
    },
    drawProps(s, ctx) { drawMirrorRoom(ctx, s.data); },
  }));

  // трассировка лазера: список точек до стены/приёмника/предела
  function traceBeam(d) {
    const pts = [];
    let [cx, cy] = d.emitter.cell;
    let [dx, dy] = d.emitter.dir;
    const start = d.C(cx, cy); pts.push({ x: start.x, y: start.y });
    const mirrorAt = (x, y) => d.mirrors.find((m) => m.cell[0] === x && m.cell[1] === y);
    for (let step = 0; step < 40; step++) {
      cx += dx; cy += dy;
      // вышли за поле (0..6 x, 0..4 y) → стоп у стены
      if (cx < -1 || cx > 7 || cy < -1 || cy > 5) { const p = d.C(cx, cy); pts.push({ x: p.x, y: p.y, wall: true }); break; }
      const p = d.C(cx, cy);
      if (d.receiver.cell[0] === cx && d.receiver.cell[1] === cy) { pts.push({ x: p.x, y: p.y, hitReceiver: true }); break; }
      const m = mirrorAt(cx, cy);
      if (m) {
        // отражение
        if (m.o === "/") { const t = dx; dx = -dy; dy = -t; }
        else { const t = dx; dx = dy; dy = t; }
        pts.push({ x: p.x, y: p.y, mirror: true });
      } else {
        pts.push({ x: p.x, y: p.y });
      }
    }
    return pts;
  }
  function drawMirrorRoom(ctx, d) {
    const C = d.C;
    // излучатель
    const e = C(d.emitter.cell[0], d.emitter.cell[1]);
    ctx.fillStyle = "#7a8290"; rr(ctx, e.x - 18, e.y - 14, 30, 28, 4); ctx.fill();
    ctx.fillStyle = "#ff5a3a"; ctx.beginPath(); ctx.arc(e.x + 12, e.y, 6, 0, 7); ctx.fill();
    // приёмник
    const r = C(d.receiver.cell[0], d.receiver.cell[1]);
    const lit = d.done || (d.beam[d.beam.length - 1] && d.beam[d.beam.length - 1].hitReceiver);
    ctx.fillStyle = lit ? "#7be0a0" : "#3a4250"; rr(ctx, r.x - 16, r.y - 16, 32, 32, 6); ctx.fill();
    ctx.strokeStyle = lit ? "#aaffd0" : "#5a6470"; ctx.lineWidth = 2; rr(ctx, r.x - 16, r.y - 16, 32, 32, 6); ctx.stroke();
    ctx.fillStyle = lit ? "#063" : "#1a2028"; ctx.beginPath(); ctx.arc(r.x, r.y, 8, 0, 7); ctx.fill();
    if (lit) { ctx.fillStyle = `rgba(123,224,160,${0.4 + 0.3 * Math.sin(G.time * 6)})`; ctx.beginPath(); ctx.arc(r.x, r.y, 22, 0, 7); ctx.fill(); }
    // луч
    if (d.beam && d.beam.length > 1) {
      ctx.save(); ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,90,60,0.35)"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(d.beam[0].x, d.beam[0].y); for (let i = 1; i < d.beam.length; i++) ctx.lineTo(d.beam[i].x, d.beam[i].y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,${160 + 60 * Math.sin(G.time * 10)},120,0.95)`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.beam[0].x, d.beam[0].y); for (let i = 1; i < d.beam.length; i++) ctx.lineTo(d.beam[i].x, d.beam[i].y); ctx.stroke();
      ctx.restore();
    }
    // зеркала
    for (const m of d.mirrors) {
      const p = C(m.cell[0], m.cell[1]);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(m.o === "/" ? -Math.PI / 4 : Math.PI / 4);
      const mg = ctx.createLinearGradient(-22, 0, 22, 0);
      mg.addColorStop(0, "#aab6c4"); mg.addColorStop(0.5, "#eef4fa"); mg.addColorStop(1, "#7a8694");
      ctx.fillStyle = mg; rr(ctx, -22, -4, 44, 8, 3); ctx.fill();
      ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 1.5; rr(ctx, -22, -4, 44, 8, 3); ctx.stroke();
      ctx.restore();
      // подставка
      ctx.fillStyle = "#3a424c"; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill();
    }
  }

  // ===== БОСС №2 — СТРАЖ-СФИНКС: загадка + бой =====
  const SPHINX_RIDDLES = [
    { q: "Что нужно, чтобы напечатать предмет?", a: ["Минералы", "Вода", "Песок"], correct: 0 },
    { q: "Кто построил эти гробницы?", a: ["Марсиане", "Прошлая экспедиция", "Никто"], correct: 1 },
    { q: "Чем заправляют древний корабль?", a: ["Топливом", "Песком", "Светом"], correct: 0 },
    { q: "Что даёт сканер древних?", a: ["X-RAY зрение", "Скорость", "Щит"], correct: 0 },
  ];
  G.addScene("sphinx", makeRoom({
    name: "sphinx", dayValue: 1,
    start: { x: 150, y: VIEW.h / 2 },
    drain: 0.12,
    narr: (s) => {
      const b = s.data.boss;
      if (s.data.done) return "Сфинкс склонился. Мудрость и сила победили!";
      if (b.mode === "riddle") return "🦁 Сфинкс загадывает загадку — выбери верный ответ!";
      return "Сфинкс уязвим! Бейте «Действием». Уклоняйтесь от луча из глаз.";
    },
    bg(ctx, s) { G.drawTombRoom(ctx, s.bounds, { floorTop: "#4a3a26", floorBot: "#1e1810" }); },
    build(s) {
      s.data.boss = {
        x: VIEW.w / 2 + 230, y: s.bounds.y + s.bounds.h / 2, hp: 5, maxHp: 5,
        mode: "riddle", riddle: 0, vulnT: 0, beamT: 0, telegT: 0, hitT: 0, askT: 0, beams: [],
      };
      s.data.done = false; s.data._winT = 0; s.data.answer = null;
      s.data.riddleOrder = [0, 1, 2, 3];
      s.exitZone = { x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96, label: () => "← Выход", to: "challenges", ready: () => true };
    },
    update(s, dt) {
      const b = s.data.boss;
      if (s.data.done) { s.data._winT -= dt; if (s.data._winT <= 0) G.go("challenges"); return; }
      if (b.hitT > 0) b.hitT -= dt;
      if (b.mode === "vulnerable") {
        b.vulnT -= dt;
        // луч-телеграф и выстрел во время уязвимости (нужно уворачиваться и бить)
        b.beamT -= dt;
        if (b.beamT <= 0) { b.beamT = 1.6; b.beams.push({ y: s.robot.y, tele: 0.7, life: 0.5 }); }
        for (let i = b.beams.length - 1; i >= 0; i--) {
          const be = b.beams[i];
          if (be.tele > 0) { be.tele -= dt; if (be.tele <= 0 && Math.abs(s.robot.y - be.y) < 26) s.hurt(12, { x: -20, y: 0 }); }
          else { be.life -= dt; if (be.life <= 0) b.beams.splice(i, 1); }
        }
        // удар робота по сфинксу
        const pz = punchZone(s.robot);
        const overlap = pz && (pz.x + pz.w > b.x - 60) && (pz.x < b.x + 60) && (pz.y + pz.h > b.y - 60) && (pz.y < b.y + 70);
        if (pz && b.hitT <= 0 && overlap) {
          b.hp -= (G.state.upgPunch ? 2 : 1); b.hitT = 0.5; G.audio.hit();
          G.fx.burst(b.x, b.y, "#ffd24a", 18, 200, 0.6); s.data.cameraShake = 6;
          G.shake(8); G.hitStop(0.06); G.fx.ring(b.x, b.y - 10, "#ffe6a0", 60, 0.34);
          if (b.hp <= 0) { b.hp = 0; s.data.done = true; s.toast("Сфинкс повержен!", 2.6); finishChallenge(s); s.data._winT = 2.6; return; }
        }
        if (b.vulnT <= 0) { b.mode = "riddle"; b.beams = []; s.data.answer = null; }
      }
    },
    drawProps(s, ctx) { drawSphinx(ctx, s.data.boss); },
    drawOver(s, ctx) {
      const b = s.data.boss;
      // HP
      const bx = VIEW.w / 2 - 180, by = 74, bw = 360;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; rr(ctx, bx, by, bw, 22, 6); ctx.fill();
      ctx.fillStyle = "#d1a02b"; rr(ctx, bx + 3, by + 3, (bw - 6) * (b.hp / b.maxHp), 16, 4); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = f(14, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`СТРАЖ-СФИНКС ${Math.max(0, Math.ceil(b.hp))}/${b.maxHp}`, VIEW.w / 2, by + 11);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      // лучи
      for (const be of b.beams) {
        if (be.tele > 0) { ctx.strokeStyle = `rgba(255,80,60,${0.4 + 0.4 * Math.sin(G.time * 16)})`; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(b.x, be.y); ctx.lineTo(s.bounds.x, be.y); ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.strokeStyle = "rgba(255,120,80,0.95)"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(b.x, be.y); ctx.lineTo(s.bounds.x, be.y); ctx.stroke(); ctx.fillStyle = "rgba(255,230,150,0.8)"; ctx.beginPath(); ctx.arc(b.x, be.y, 6, 0, 7); ctx.fill(); }
      }
      // панель загадки
      if (b.mode === "riddle" && !s.data.done) drawRiddlePanel(ctx, s);
    },
    onTap(s, x, y) {
      const b = s.data.boss;
      if (s.data.done || b.mode !== "riddle" || !s.data._opts) return;
      for (const o of s.data._opts) {
        if (rectHit(o, x, y)) {
          const R = SPHINX_RIDDLES[s.data.riddleOrder[b.riddle % s.data.riddleOrder.length]];
          if (o.idx === R.correct) {
            b.mode = "vulnerable"; b.vulnT = 5.0; b.beamT = 1.4; b.riddle++;
            s.toast("Верно! Сфинкс открылся — бей!", 2.0); G.audio.win();
          } else {
            s.hurt(14, { x: 0, y: 0 }); s.toast("Неверно! Сфинкс бьёт лучом.", 2.0);
            b.beams.push({ y: s.robot.y, tele: 0.01, life: 0.4 });
            b.riddle++;
          }
          return;
        }
      }
    },
  }));
  function drawRiddlePanel(ctx, s) {
    const b = s.data.boss;
    const R = SPHINX_RIDDLES[s.data.riddleOrder[b.riddle % s.data.riddleOrder.length]];
    const pw = 720, px = VIEW.w / 2 - pw / 2, py = VIEW.h - 340;
    ctx.fillStyle = "rgba(10,8,16,0.85)"; rr(ctx, px, py, pw, 46, 10); ctx.fill();
    ctx.fillStyle = "#ffe9c8"; ctx.font = f(20, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(R.q, VIEW.w / 2, py + 23); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    // три кнопки-ответа
    s.data._opts = [];
    const ow = 228, gap = 14, total = ow * 3 + gap * 2, ox = VIEW.w / 2 - total / 2, oy = py + 58;
    for (let i = 0; i < 3; i++) {
      const bx = ox + i * (ow + gap);
      const rect = { x: bx, y: oy, w: ow, h: 56, idx: i };
      s.data._opts.push(rect);
      ctx.fillStyle = "rgba(60,46,30,0.95)"; rr(ctx, bx, oy, ow, 56, 10); ctx.fill();
      ctx.strokeStyle = "#caa066"; ctx.lineWidth = 2; rr(ctx, bx, oy, ow, 56, 10); ctx.stroke();
      ctx.fillStyle = "#ffe9c8"; ctx.font = f(18, "600"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(R.a[i], bx + ow / 2, oy + 28);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    }
  }
  function drawSphinx(ctx, b) {
    const t = G.time;
    const breath = Math.sin(t * 1.4) * 3;
    const hurt = b.hitT > 0 ? b.hitT / 0.5 : 0;
    // Состояние лучей: заряд (charging) и выстрел (firing) двигают голову и лапу
    let charging = 0, firing = 0;
    if (b.beams) for (const be of b.beams) {
      if (be.tele > 0) charging = Math.max(charging, 1 - be.tele / 0.7);
      else firing = Math.max(firing, be.life / 0.5);
    }
    const lunge = charging * 5 + firing * 12;     // голова выдаётся вперёд (к роботу, -x)
    const pawLift = firing * 20;                   // передняя лапа взмётывается при выстреле
    ctx.save(); ctx.translate(b.x + (hurt ? Math.sin(t * 80) * 4 : 0), b.y + breath);
    // тень
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.ellipse(0, 84, 90, 18, 0, 0, 7); ctx.fill();
    // тело-лев (лежит)
    const body = ctx.createLinearGradient(0, -20, 0, 80);
    body.addColorStop(0, "#e0b878"); body.addColorStop(1, "#9a6a34");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-96, 80); ctx.quadraticCurveTo(-110, 10, -60, 6); ctx.lineTo(60, 6); ctx.quadraticCurveTo(110, 10, 96, 80); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 2; ctx.stroke();
    // передние лапы (левая взмахивает при выстреле)
    ctx.fillStyle = "#caa066";
    ctx.save(); ctx.translate(-81, 73 - pawLift); ctx.rotate(-pawLift * 0.012);
    rr(ctx, -15, -13, 30, 26, 6); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1.5; ctx.strokeRect(-15, -13, 30, 26);
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 1.5;
    for (const cx of [-9, 3]) { ctx.beginPath(); ctx.moveTo(cx, 13); ctx.lineTo(cx, 13 - 6 - pawLift * 0.2); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "#caa066"; rr(ctx, 66, 60, 30, 26, 6); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1.5; ctx.strokeRect(66, 60, 30, 26);
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 1.5;
    for (const lx of [72, 84]) { ctx.beginPath(); ctx.moveTo(lx, 86); ctx.lineTo(lx, 80); ctx.stroke(); }
    // голова-фараон с немесом (выдаётся вперёд при заряде/выстреле луча)
    ctx.save(); ctx.translate(-lunge, -34 + charging * 2);
    // немес
    ctx.fillStyle = "#1a3a58"; ctx.beginPath();
    ctx.moveTo(-44, -6); ctx.quadraticCurveTo(0, -56, 44, -6); ctx.lineTo(40, 44); ctx.lineTo(-40, 44); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#0a1a3a"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#ffd24a"; for (let i = 0; i < 5; i++) ctx.fillRect(-44, -2 + i * 9, 88, 3);
    // лицо
    ctx.fillStyle = "#dcb37e"; ctx.beginPath(); ctx.ellipse(0, 8, 32, 36, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 2; ctx.stroke();
    // глаза — светятся в режиме уязвимости/атаки
    const eyeOn = b.mode === "vulnerable";
    ctx.fillStyle = eyeOn ? "#ff6a3a" : "#1a1a1a";
    ctx.beginPath(); ctx.ellipse(-12, 2, 6, 4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(12, 2, 6, 4, 0, 0, 7); ctx.fill();
    if (eyeOn) {
      const eg = 0.4 + 0.3 * Math.sin(t * 10) + charging * 0.5 + firing * 0.6;
      const er = 10 + charging * 5 + firing * 7;
      ctx.fillStyle = `rgba(255,150,80,${Math.min(0.95, eg)})`;
      ctx.beginPath(); ctx.arc(-12, 2, er, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(12, 2, er, 0, 7); ctx.fill();
      if (firing > 0.4) { ctx.fillStyle = "rgba(255,240,200,0.9)"; ctx.beginPath(); ctx.arc(-12, 2, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(12, 2, 4, 0, 7); ctx.fill(); }
    }
    // нос/рот
    ctx.strokeStyle = "#5a3a16"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, 20); ctx.moveTo(-8, 26); ctx.lineTo(8, 26); ctx.stroke();
    // борода фараона
    ctx.fillStyle = "#1a1a1a"; rr(ctx, -5, 40, 10, 16, 2); ctx.fill();
    ctx.restore();
    // вспышка урона
    if (hurt) { ctx.fillStyle = `rgba(255,80,60,${hurt * 0.5})`; ctx.beginPath(); ctx.ellipse(0, 30, 100, 80, 0, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  /* =========================================================================
     ГЛАВА 3: сканер древних → X-RAY → артефакт → апгрейд принтера → корабль
     ========================================================================= */

  // --- Рисунок артефакта (частично откопанный) ---
  function drawAncientArtifact(ctx, x, y, exposed, cracks) {
    // exposed 0..1 — насколько откопан; cracks 0..3 — повреждения
    ctx.save(); ctx.translate(x, y);
    // подземная ниша/грунт вокруг
    const dirtH = 70 * (1 - exposed);
    // сам артефакт — обелиск-кристалл с золотом и светящимся ядром
    const grad = ctx.createLinearGradient(0, -70, 0, 10);
    grad.addColorStop(0, "#caa066"); grad.addColorStop(0.5, "#8a6a3a"); grad.addColorStop(1, "#5a3a1a");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -78); ctx.lineTo(18, -58); ctx.lineTo(18, 8); ctx.lineTo(-18, 8); ctx.lineTo(-18, -58);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2; ctx.stroke();
    // золотые грани/иероглифы
    ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-12, -50); ctx.lineTo(12, -50); ctx.moveTo(-12, -36); ctx.lineTo(12, -36); ctx.stroke();
    ctx.fillStyle = "#ffd24a"; ctx.font = `700 12px ${G.FONT}`; ctx.textAlign = "center";
    ctx.fillText("☥", 0, -42); ctx.fillText("◈", 0, -22); ctx.textAlign = "left";
    // светящееся ядро
    const gl = (Math.sin(G.time * 3) + 1) / 2;
    const cg = ctx.createRadialGradient(0, -14, 1, 0, -14, 14);
    cg.addColorStop(0, `rgba(123,224,255,${0.7 + gl * 0.3})`); cg.addColorStop(1, "rgba(60,120,220,0)");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, -14, 14, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(200,240,255,${0.8})`; ctx.beginPath(); ctx.arc(0, -14, 4, 0, 7); ctx.fill();
    // трещины от неаккуратной добычи
    if (cracks >= 1) { ctx.strokeStyle = "#2a1808"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-8, -56); ctx.lineTo(2, -40); ctx.lineTo(-4, -24); ctx.stroke(); }
    if (cracks >= 2) { ctx.beginPath(); ctx.moveTo(10, -50); ctx.lineTo(2, -34); ctx.lineTo(12, -18); ctx.stroke(); }
    if (cracks >= 3) { ctx.beginPath(); ctx.moveTo(-14, -30); ctx.lineTo(-4, -10); ctx.stroke(); }
    // грунт, скрывающий нижнюю часть (тает по мере exposed)
    if (dirtH > 1) {
      ctx.fillStyle = "#4a3424";
      ctx.beginPath(); ctx.ellipse(0, 8 - dirtH + 70, 46, 22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#3a2818";
      ctx.beginPath(); ctx.ellipse(0, 8 - dirtH + 76, 40, 16, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // === КАТ-СЦЕНА: «Чертёж сканера выпал с босса» ===
  makeMiniCutscene("cutscene_scanner_blueprint", 132, [
    {
      dur: 3.0, text: "Из праха Древнего выпала тёмная пластина — ЧЕРТЁЖ СКАНЕРА древних предметов!",
      onTime() { if (Math.random() > 0.6) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 100, 400, "#7be0ff", 1, 80, 0.7); },
      draw(ctx) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 440;
        // куча праха
        ctx.fillStyle = "#2a1c12"; ctx.beginPath(); ctx.ellipse(cx, cy + 60, 90, 22, 0, 0, 7); ctx.fill();
        // чертёж-пластина парит
        const fy = cy - Math.sin(G.time * 2) * 8;
        const gl = (Math.sin(G.time * 3) + 1) / 2;
        ctx.fillStyle = `rgba(120,200,255,${0.3 + gl * 0.4})`;
        ctx.beginPath(); ctx.arc(cx, fy, 40, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(cx, fy);
        ctx.fillStyle = "#1f3f5e"; rr(ctx, -30, -20, 60, 40, 4); ctx.fill();
        ctx.strokeStyle = "#7be0ff"; ctx.lineWidth = 2; ctx.strokeRect(-24, -14, 48, 28);
        // мини-антенна на пластине
        ctx.strokeStyle = "#bfe0ff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 2, 14, 6, 0, PI, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -8); ctx.stroke();
        ctx.fillStyle = "#bfe0ff"; ctx.font = `700 9px ${G.FONT}`; ctx.textAlign = "center";
        ctx.fillText("СКАНЕР", 0, 18); ctx.textAlign = "left";
        ctx.restore();
        G.drawRobot(ctx, cx - 150, cy + 40, 32, 1, G.time);
      }
    },
    {
      dur: 3.2, text: "Чтобы напечатать сканер, нужны 2 супер-минерала, 2 чудо-минерала и Z-кристалл. Добудьте их буром в шахтах!",
      draw(ctx) {
        darkTombBg(ctx);
        const cx = VIEW.w / 2, cy = 430;
        // три образца руды
        drawMiniGem(ctx, cx - 120, cy, "#caa0ff", "супер");
        drawMiniGem(ctx, cx, cy, "#ffd17a", "чудо");
        drawMiniGem(ctx, cx + 120, cy, "#7be0a0", "Z-крист");
        G.drawRobot(ctx, cx - 230, cy + 30, 30, 1, G.time);
      }
    },
  ], "drill_site");
  function drawMiniGem(ctx, x, y, color, label) {
    const gl = (Math.sin(G.time * 3 + x) + 1) / 2;
    const rg = ctx.createRadialGradient(x, y, 2, x, y, 36);
    rg.addColorStop(0, color); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5 + gl * 0.3; ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, 36, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    const grad = ctx.createLinearGradient(x - 12, y - 22, x + 12, y + 10);
    grad.addColorStop(0, "#1a0a2a"); grad.addColorStop(0.5, color); grad.addColorStop(1, "#fff");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y - 24); ctx.lineTo(x + 13, y - 6); ctx.lineTo(x + 8, y + 12); ctx.lineTo(x - 8, y + 12); ctx.lineTo(x - 13, y - 6);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#ffe9c8"; ctx.font = `600 13px ${G.FONT}`; ctx.textAlign = "center";
    ctx.fillText(label, x, y + 36); ctx.textAlign = "left";
  }

  // === КАТ-СЦЕНА: «Сканер напечатан → X-RAY онлайн» ===
  makeMiniCutscene("cutscene_scanner", 138, [
    {
      dur: 3.0, text: "СКАНЕР собран! Включается X-RAY зрение — теперь робот видит ресурсы и артефакты под землёй.",
      onTime() { if (Math.random() > 0.5) G.fx.burst(Math.random() * VIEW.w, Math.random() * 300 + 150, "#7be0ff", 1, 60, 0.8); },
      draw(ctx, t) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#0a1a2a"); g.addColorStop(1, "#05101a"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // x-ray сетка
        ctx.strokeStyle = "rgba(123,224,255,0.12)"; ctx.lineWidth = 1;
        for (let i = 0; i < VIEW.w; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, VIEW.h); ctx.stroke(); }
        for (let j = 0; j < VIEW.h; j += 40) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(VIEW.w, j); ctx.stroke(); }
        // развёртка-радар
        const cx = VIEW.w / 2, cy = 360;
        const sweep = (G.time % 2) / 2 * Math.PI * 2;
        ctx.strokeStyle = "rgba(123,224,255,0.5)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * 200, cy + Math.sin(sweep) * 200); ctx.stroke();
        for (let r = 50; r <= 200; r += 50) { ctx.strokeStyle = "rgba(123,224,255,0.18)"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
        // подземные «находки» — точки
        ctx.fillStyle = "#ffd17a";
        for (const [dx, dy] of [[-90, 60], [120, -40], [40, 110], [-140, -20]]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 5, 0, 7); ctx.fill(); }
        G.drawRobot(ctx, cx, cy + 130, 36, 1, G.time);
      }
    },
  ], "xray_field");

  // === X-RAY ПОЛЕ: найти и аккуратно откопать артефакт ===
  G.addScene("xray_field", makeRoom({
    name: "xray_field", dayValue: 140,
    start: { x: 160, y: 410 },
    drain: 0.3,
    narr: (s) => {
      const d = s.data;
      if (d.done) return "Артефакт извлечён целым! Несём к принтеру...";
      return "X-RAY: артефакт торчит из грунта. Бейте «Действием» ТОЛЬКО когда стрелка в зелёной зоне — иначе повредите!";
    },
    bg(ctx, s) {
      // подземный срез породы
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#3a2a1c"); g.addColorStop(1, "#160e08");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      G.drawTombRoom(ctx, s.bounds, { floorTop: "#4a3624", floorBot: "#241810" });
    },
    build(s) {
      s._routed = false; s._artifactGoT = 0; // сброс авто-перехода (сцена — синглтон)
      const ax = VIEW.w / 2 + 130, ay = s.bounds.y + s.bounds.h / 2 - 10;
      s.data.ax = ax; s.data.ay = ay;
      s.data.clumps = 6; s.data.cleared = 0; s.data.integrity = 100;
      s.data.meter = 0; s.data.meterDir = 1; s.data.done = false; s.data.warnT = 0; s.data.shake = 0;
      // декоративные подземные залежи (для x-ray «видно ресурсы»)
      s.data.buried = [
        { x: s.bounds.x + 120, y: s.bounds.y + 360, c: "#caa0ff" },
        { x: s.bounds.x + 300, y: s.bounds.y + 150, c: "#ffd17a" },
        { x: s.bounds.x + 760, y: s.bounds.y + 420, c: "#7be0a0" },
        { x: s.bounds.x + 600, y: s.bounds.y + 120, c: "#caa0ff" },
      ];
      s.interactables.push({
        x: ax, y: ay + 30, r: 110,
        label: () => `Чистить кисточкой 🖌 ${s.data.cleared}/${s.data.clumps}`,
        ready: () => !s.data.done,
        act(sc) { brushArtifact(sc); }
      });
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => "← К 3D-принтеру",
        // извлёк артефакт → к кат-сцене апгрейда; ушёл раньше → просто к принтеру
        onExit: (sc) => { if (G.state.hasArtifact) { if (!sc._routed) { sc._routed = true; G.go("cutscene_artifact"); } } else G.go("printer"); },
        ready: () => true
      };
    },
    update(s, dt) {
      const d = s.data;
      if (d.warnT > 0) d.warnT -= dt;
      if (d.shake > 0) d.shake = Math.max(0, d.shake - dt * 40);
      if (d.done) {
        // артефакт извлечён → через короткую паузу авто-переход к кат-сцене
        // апгрейда принтера (она ставит printerUpgraded). Без этого принтер
        // не предложит сборку корабля и игрок «застревает».
        if (!s._routed) { s._artifactGoT = (s._artifactGoT || 0) + dt; if (s._artifactGoT > 2.2) { s._routed = true; G.go("cutscene_artifact"); } }
        return;
      }
      // маятник-стрелка; ускоряется по мере прогресса
      const speed = 0.7 + d.cleared * 0.12;
      d.meter += d.meterDir * dt * speed;
      if (d.meter >= 1) { d.meter = 1; d.meterDir = -1; }
      else if (d.meter <= 0) { d.meter = 0; d.meterDir = 1; }
      // медленная регенерация целостности
      if (d.integrity < 100) d.integrity = Math.min(100, d.integrity + dt * 4);
    },
    drawProps(s, ctx) {
      const d = s.data;
      const sx = (d.shake || 0) * Math.sin(G.time * 60);
      // артефакт
      drawAncientArtifact(ctx, d.ax + sx, d.ay, d.cleared / d.clumps, d.cracksShown || 0);
    },
    drawOver(s, ctx) {
      const d = s.data;
      // ===== X-RAY оверлей =====
      ctx.save();
      ctx.fillStyle = "rgba(20,60,90,0.22)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      // скан-линии
      ctx.fillStyle = "rgba(123,224,255,0.05)";
      for (let y = (G.time * 60) % 6; y < VIEW.h; y += 6) ctx.fillRect(0, y, VIEW.w, 2);
      // подземные залежи светятся сквозь грунт
      for (const b of d.buried) {
        const gl = (Math.sin(G.time * 2 + b.x) + 1) / 2;
        const rg = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, 30);
        rg.addColorStop(0, b.c); rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.35 + gl * 0.25; ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(b.x, b.y, 30, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill();
      }
      ctx.restore();
      // X-RAY бейдж
      ctx.fillStyle = "rgba(10,30,45,0.7)"; rr(ctx, 24, 120, 120, 30, 6); ctx.fill();
      ctx.fillStyle = "#7be0ff"; ctx.font = f(15, "700"); ctx.textBaseline = "middle";
      const bl = (Math.sin(G.time * 4) + 1) / 2;
      ctx.fillStyle = `rgba(123,224,255,${0.6 + bl * 0.4})`;
      ctx.fillText("◉ X-RAY", 38, 136); ctx.textBaseline = "alphabetic";

      if (d.done) return;
      // ===== Полоса точности (timing-метр) =====
      const mw = 420, mh = 26, mx = VIEW.w / 2 - mw / 2, my = VIEW.h - 250;
      ctx.fillStyle = "rgba(8,10,14,0.8)"; rr(ctx, mx - 6, my - 28, mw + 12, mh + 50, 8); ctx.fill();
      // подпись
      ctx.fillStyle = "#cfe6f0"; ctx.font = f(14, "600"); ctx.textAlign = "center";
      ctx.fillText("Бейте, когда стрелка в ЗЕЛЁНОЙ зоне", VIEW.w / 2, my - 12);
      ctx.textAlign = "left";
      // фон шкалы (красный)
      ctx.fillStyle = "#5a1a14"; rr(ctx, mx, my, mw, mh, 5); ctx.fill();
      // зелёная безопасная зона (центр)
      const safeLo = 0.40, safeHi = 0.60;
      ctx.fillStyle = "#1f8a4a"; ctx.fillRect(mx + mw * safeLo, my, mw * (safeHi - safeLo), mh);
      // жёлтые предупреждающие края у зелёной зоны
      ctx.fillStyle = "rgba(220,180,40,0.6)";
      ctx.fillRect(mx + mw * (safeLo - 0.08), my, mw * 0.08, mh);
      ctx.fillRect(mx + mw * safeHi, my, mw * 0.08, mh);
      // рамка
      ctx.strokeStyle = "#cfe6f0"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mw, mh);
      // стрелка-маркер
      const px = mx + mw * d.meter;
      ctx.fillStyle = "#fff"; ctx.beginPath();
      ctx.moveTo(px, my - 6); ctx.lineTo(px - 7, my - 16); ctx.lineTo(px + 7, my - 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(px - 2, my, 4, mh);
      // целостность артефакта
      const iw = 300, ix = VIEW.w / 2 - iw / 2, iy = my + mh + 12;
      ctx.fillStyle = "rgba(8,10,14,0.6)"; rr(ctx, ix, iy, iw, 14, 4); ctx.fill();
      const ic = d.integrity > 50 ? "#7be0a0" : d.integrity > 25 ? "#ffd17a" : "#ff6a4a";
      ctx.fillStyle = ic; rr(ctx, ix + 2, iy + 2, (iw - 4) * (d.integrity / 100), 10, 3); ctx.fill();
      ctx.fillStyle = "#cfe6f0"; ctx.font = f(11, "600"); ctx.textAlign = "center";
      ctx.fillText(`Целостность артефакта ${Math.round(d.integrity)}%`, VIEW.w / 2, iy + 11);
      ctx.textAlign = "left";
      // предупреждение
      if (d.warnT > 0) {
        ctx.fillStyle = `rgba(255,60,40,${Math.min(0.5, d.warnT)})`; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        ctx.fillStyle = "#ff8a6a"; ctx.font = f(26, "800"); ctx.textAlign = "center";
        ctx.fillText("ОСТОРОЖНЕЕ!", VIEW.w / 2, 200); ctx.textAlign = "left";
      }
    },
  }));
  // механика аккуратной раскопки
  function brushArtifact(sc) {
    const d = sc.data;
    if (d.done) return;
    const safeLo = 0.40, safeHi = 0.60;
    const warnLo = 0.32, warnHi = 0.68;
    const m = d.meter;
    if (m >= safeLo && m <= safeHi) {
      // точное попадание — снимаем слой грунта
      d.cleared = Math.min(d.clumps, d.cleared + 1);
      G.audio.tone(520 + d.cleared * 40, 0.08, "sine", 0.05);
      G.fx.burst(d.ax, d.ay + 20, "#caa066", 10, 120, 0.4);
      if (d.cleared >= d.clumps) {
        d.done = true; G.state.hasArtifact = true;
        G.audio.win(); G.fx.burst(d.ax, d.ay - 20, "#7be0ff", 40, 280, 1.2);
        sc.toast("Артефакт извлечён целым! 🏺", 2.6);
        sc._artifactGoT = 0;
      }
    } else if (m >= warnLo && m <= warnHi) {
      // близко, но мимо — мелкая осыпь, без урона
      G.audio.tone(200, 0.08, "square", 0.04);
      G.fx.burst(d.ax, d.ay, "#9a7448", 6, 90, 0.3);
    } else {
      // удар по артефакту — повреждение
      d.integrity = Math.max(0, d.integrity - 26);
      d.cracksShown = Math.min(3, (d.cracksShown || 0) + 1);
      d.warnT = 0.6; d.shake = 6;
      G.audio.hit();
      G.fx.burst(d.ax, d.ay - 14, "#ff6a4a", 14, 160, 0.5);
      if (d.integrity <= 0) {
        // не даём «сломать» совсем — откат прогресса, как обучающий штраф
        d.integrity = 50; d.cleared = Math.max(0, d.cleared - 2); d.cracksShown = 1;
        sc.toast("Чуть не раскололи! Действуйте аккуратнее.", 2.8);
      }
    }
  }

  // === КАТ-СЦЕНА: артефакт оказался апгрейдом принтера ===
  makeMiniCutscene("cutscene_artifact", 142, [
    {
      dur: 3.2, text: "Артефакт ожил в руках! Это древний МОДУЛЬ — улучшение для 3D-принтера.",
      onTime() { if (Math.random() > 0.5) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 120, 360, "#7be0ff", 1, 90, 0.8); },
      draw(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#1a2a3a"); g.addColorStop(1, "#0a1018"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        const cx = VIEW.w / 2, cy = 340;
        const gl = (Math.sin(G.time * 3) + 1) / 2;
        ctx.fillStyle = `rgba(123,224,255,${0.2 + gl * 0.25})`;
        ctx.beginPath(); ctx.arc(cx, cy, 110, 0, 7); ctx.fill();
        drawAncientArtifact(ctx, cx, cy + 40, 1, 0);
        G.drawRobot(ctx, cx - 180, cy + 70, 34, 1, G.time);
      }
    },
    {
      dur: 3.4, text: "Вставив его в принтер, можно печатать запчасти ДРЕВНЕГО КОСМИЧЕСКОГО КОРАБЛЯ — по марсианским технологиям!",
      draw(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#1a2a3a"); g.addColorStop(1, "#0a1018"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        const cx = VIEW.w / 2, cy = 360;
        // принтер
        ctx.fillStyle = "#2b3038"; rr(ctx, cx - 90, cy - 80, 180, 170, 12); ctx.fill();
        ctx.fillStyle = "#1a1e24"; rr(ctx, cx - 76, cy - 66, 152, 120, 6); ctx.fill();
        // артефакт вставляется сверху
        const ins = (Math.sin(G.time * 1.5) + 1) / 2;
        ctx.save(); ctx.translate(cx + 70, cy - 90 + ins * 10); drawAncientArtifact(ctx, 0, 0, 1, 0); ctx.restore();
        // голограмма корабля над принтером
        const gl = (Math.sin(G.time * 4) + 1) / 2;
        ctx.globalAlpha = 0.4 + gl * 0.3;
        ctx.strokeStyle = "#7be0ff"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 50, cy - 120); ctx.lineTo(cx + 50, cy - 120);
        ctx.lineTo(cx + 30, cy - 150); ctx.lineTo(cx - 30, cy - 150); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 150); ctx.lineTo(cx, cy - 175); ctx.stroke();
        ctx.globalAlpha = 1;
        G.drawRobot(ctx, cx - 180, cy + 60, 32, 1, G.time);
      }
    },
  ], () => { G.state.printerUpgraded = true; G.go("printer"); });

  // === КАТ-СЦЕНА: «Старт с Марса» (перед финалом) ===
  // Робот грузится в корабль → обратный отсчёт → отрыв от поверхности.
  function launchBg(ctx, dusk) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, dusk ? "#3a1c2a" : "#6a3a28");
    g.addColorStop(0.5, dusk ? "#5a2a22" : "#a85a38");
    g.addColorStop(1, "#1a0d0a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // звёзды вверху
    starfield(ctx, 50, 11);
    // далёкие дюны
    ctx.fillStyle = "#7a3f28";
    ctx.beginPath(); ctx.moveTo(0, 560);
    for (let x = 0; x <= VIEW.w; x += 80) ctx.lineTo(x, 540 + Math.sin(x * 0.012) * 26);
    ctx.lineTo(VIEW.w, VIEW.h); ctx.lineTo(0, VIEW.h); ctx.closePath(); ctx.fill();
    // грунт
    ctx.fillStyle = "#52301f"; ctx.fillRect(0, 600, VIEW.w, VIEW.h - 600);
  }
  // Корабль на стартовой площадке (bottomY — низ опор)
  function drawLaunchShip(ctx, cx, bottomY, riseY, thrust) {
    ctx.save(); ctx.translate(cx, bottomY - riseY);
    // выхлоп под кораблём
    if (thrust > 0) {
      const fl = (Math.sin(G.time * 24) + 1) / 2;
      const flame = ctx.createLinearGradient(0, 18, 0, 60 + (60 + fl * 50) * thrust);
      flame.addColorStop(0, "rgba(255,250,210,0.95)");
      flame.addColorStop(0.4, `rgba(255,150,70,${0.6 + thrust * 0.3})`);
      flame.addColorStop(1, "rgba(180,40,30,0)");
      ctx.fillStyle = flame;
      const fw = 20 + thrust * 8;
      ctx.beginPath(); ctx.moveTo(-fw, 18); ctx.lineTo(fw, 18);
      ctx.lineTo(7, 70 + (70 + fl * 50) * thrust); ctx.lineTo(-7, 70 + (70 + fl * 50) * thrust); ctx.closePath(); ctx.fill();
      // ядро пламени
      ctx.fillStyle = "rgba(255,255,235,0.9)";
      ctx.beginPath(); ctx.moveTo(-9, 18); ctx.lineTo(9, 18); ctx.lineTo(0, 54 + 30 * thrust); ctx.closePath(); ctx.fill();
    }
    // корпус
    const hull = ctx.createLinearGradient(-34, 0, 34, 0);
    hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
    ctx.fillStyle = hull;
    ctx.beginPath(); ctx.moveTo(0, -84); ctx.quadraticCurveTo(30, -42, 26, 18); ctx.lineTo(-26, 18); ctx.quadraticCurveTo(-30, -42, 0, -84); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 2; ctx.stroke();
    // иллюминатор со светящимся роботом-пилотом
    ctx.fillStyle = "#0a3a4a"; ctx.beginPath(); ctx.arc(0, -34, 11, 0, 7); ctx.fill();
    ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -34, 7, 0, 7); ctx.fill();
    ctx.fillStyle = "#173a44"; ctx.fillRect(-3, -36, 6, 5); // силуэт головы пилота
    ctx.strokeStyle = "#3a424c"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -34, 11, 0, 7); ctx.stroke();
    // глиф на борту
    ctx.fillStyle = "#ff8a4a"; ctx.font = `700 16px ${G.FONT}`; ctx.textAlign = "center"; ctx.fillText("☥", 0, -10);
    // стабилизаторы
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath(); ctx.moveTo(-26, 2); ctx.lineTo(-46, 24); ctx.lineTo(-26, 18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(26, 2); ctx.lineTo(46, 24); ctx.lineTo(26, 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#2a323a"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = "left";
    ctx.restore();
  }
  function drawGantry(ctx, cx, baseY) {
    // ферма-площадка
    ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - 70, baseY); ctx.lineTo(cx - 56, baseY - 120); ctx.stroke();
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const y = baseY - i * 26; ctx.beginPath(); ctx.moveTo(cx - 70 + i * 2.6, y); ctx.lineTo(cx - 40, y - 8); ctx.stroke(); }
    // платформа-основание
    ctx.fillStyle = "#2b2018"; rr(ctx, cx - 64, baseY, 128, 16, 4); ctx.fill();
    ctx.fillStyle = "#caa066"; for (let i = -2; i <= 2; i++) { ctx.fillRect(cx + i * 24 - 2, baseY + 2, 4, 12); }
  }
  makeMiniCutscene("cutscene_launch", 99, [
    {
      dur: 3.0, text: "Корабль собран, топливо залито, карты проложены. Робот в последний раз окидывает взглядом Красную планету...",
      onTime() { if (Math.random() > 0.7) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 80, 600, "#caa066", 1, 50, 1.0); },
      draw(ctx) {
        launchBg(ctx, false);
        const cx = VIEW.w / 2, baseY = 600;
        drawGantry(ctx, cx, baseY);
        drawLaunchShip(ctx, cx, baseY, 0, 0);
        // робот идёт к трапу
        const wx = cx - 150 + Math.min(60, G.time * 24 % 120);
        G.drawRobot(ctx, cx - 120, baseY - 12, 26, 1, G.time);
      }
    },
    {
      dur: 2.6, text: "Зажигание! 3… 2… 1… Двигатели Древних оживают, площадку заволакивает пылью.",
      onTime() { G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 120, 640, ["#ff8a4a", "#ffd17a", "#caa066"][Math.floor(Math.random() * 3)], 1, 140, 0.9); },
      draw(ctx, t) {
        launchBg(ctx, true);
        const cx = VIEW.w / 2, baseY = 600;
        drawGantry(ctx, cx, baseY);
        const thrust = Math.min(1, t / 1.2);
        drawLaunchShip(ctx, cx, baseY, Math.max(0, (t - 1.6) * 30), thrust);
        // обратный отсчёт
        const n = Math.max(0, 3 - Math.floor(t / 0.8));
        if (n > 0) {
          ctx.fillStyle = "#ffe14a"; ctx.font = `900 90px ${G.FONT}`; ctx.textAlign = "center";
          ctx.globalAlpha = 1 - (t / 0.8 - Math.floor(t / 0.8));
          ctx.fillText(n, cx, 260); ctx.globalAlpha = 1; ctx.textAlign = "left";
        }
      }
    },
    {
      dur: 3.0, text: "ОТРЫВ! Корабль свечой уходит в марсианское небо, оставляя гробницы и тайны позади.",
      onTime() { if (Math.random() > 0.3) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 60, 560, "#ff8a4a", 1, 120, 0.7); },
      draw(ctx, t) {
        launchBg(ctx, true);
        const cx = VIEW.w / 2, baseY = 600;
        drawGantry(ctx, cx, baseY);
        // корабль взмывает с ускорением
        const rise = 40 + t * t * 150;
        drawLaunchShip(ctx, cx, baseY, rise, 1);
        // длинный шлейф дыма вниз
        ctx.fillStyle = "rgba(220,180,140,0.3)";
        for (let i = 0; i < 8; i++) {
          const yy = baseY - rise + 70 + i * 30;
          ctx.beginPath(); ctx.arc(cx + Math.sin(i + G.time) * (6 + i * 2), yy, 14 + i * 4, 0, 7); ctx.fill();
        }
      }
    },
  ], () => G.go("cutscene_ice_arrival"));

  // === КАТ-СЦЕНА: первый выход на поверхность Марса (обзор карты) ===
  // Проигрывается один раз, когда база построена и открыт оверворлд.
  makeMiniCutscene("cutscene_mars_intro", 90, [
    {
      dur: 3.4, text: "База на ногах. Робот разворачивает марсоход и впервые выходит на бескрайнюю поверхность Марса — впереди разведка.",
      onTime() { if (Math.random() > 0.7) G.fx.burst(Math.random() * VIEW.w, 700, "#a85a38", 1, 40, 1.0); },
      draw(ctx) {
        // вид с орбиты на красную пустыню
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#1a0d12"); g.addColorStop(0.45, "#7a3a24"); g.addColorStop(1, "#3a1c12");
        ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        starfield(ctx, 60, 7);
        // изгиб горизонта планеты
        ctx.fillStyle = "#a85a38";
        ctx.beginPath(); ctx.ellipse(VIEW.w / 2, 1180, 1300, 640, 0, PI, 0); ctx.fill();
        // кратеры
        ctx.fillStyle = "rgba(60,30,18,0.4)";
        for (const c of [[260, 560, 50], [780, 600, 70], [520, 660, 40], [980, 540, 34]]) {
          ctx.beginPath(); ctx.ellipse(c[0], c[1], c[2], c[2] * 0.4, 0, 0, 7); ctx.fill();
        }
        // база с антенной
        const bx = VIEW.w / 2, by = 540;
        ctx.fillStyle = "#cdd4db"; rr(ctx, bx - 26, by - 20, 52, 26, 5); ctx.fill();
        ctx.fillStyle = "#1f5fae"; rr(ctx, bx - 18, by - 14, 36, 14, 2); ctx.fill();
        ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + 20, by - 20); ctx.lineTo(bx + 30, by - 46); ctx.stroke();
        ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(bx + 30, by - 46, 3, 0, 7); ctx.fill();
        // марсоход выезжает
        const rx = bx + 40 + Math.min(120, G.time * 30);
        drawMiniRover(ctx, rx, by + 16);
        // пылевой след
        ctx.fillStyle = "rgba(200,150,110,0.3)";
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(rx - 18 - i * 12, by + 18, 5 + i * 2, 0, 7); ctx.fill(); }
      }
    },
    {
      dur: 3.2, text: "Радар марсохода видит лишь то, что уже объехал. Где-то в тумане — шахты с минералами и аномалии Древних. Пора в путь!",
      draw(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
        g.addColorStop(0, "#241018"); g.addColorStop(1, "#3a1c12"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // схема-карта с туманом
        const cx = VIEW.w / 2, cy = 360;
        ctx.fillStyle = "#1a0d0a"; rr(ctx, cx - 320, cy - 200, 640, 400, 16); ctx.fill();
        ctx.strokeStyle = "#5a3a24"; ctx.lineWidth = 3; ctx.strokeRect(cx - 320, cy - 200, 640, 400);
        // радар-кольца вокруг центра
        const gl = (Math.sin(G.time * 2) + 1) / 2;
        ctx.strokeStyle = `rgba(123,224,255,${0.3 + gl * 0.3})`;
        for (let r = 40; r < 200; r += 50) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r + gl * 8, 0, 7); ctx.stroke(); }
        // развёртка-луч
        const a = G.time * 1.4;
        ctx.strokeStyle = "rgba(123,224,255,0.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 190, cy + Math.sin(a) * 190); ctx.stroke();
        // база в центре
        drawMiniRover(ctx, cx, cy + 4);
        // туманные метки
        for (const p of [[-180, -90], [150, 60], [-120, 110], [210, -120]]) {
          ctx.fillStyle = "rgba(255,200,120,0.5)"; ctx.beginPath(); ctx.arc(cx + p[0], cy + p[1], 6, 0, 7); ctx.fill();
        }
      }
    },
  ], () => G.go("mars_map"));

  // мини-марсоход для кат-сцен (вид сверху-сбоку)
  function drawMiniRover(ctx, x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "#2a2a2a"; ctx.beginPath(); ctx.arc(-9, 6, 4, 0, 7); ctx.arc(9, 6, 4, 0, 7); ctx.fill();
    ctx.fillStyle = "#c94f3a"; rr(ctx, -13, -6, 26, 12, 3); ctx.fill();
    ctx.fillStyle = "#7be0ff"; rr(ctx, -2, -10, 12, 7, 2); ctx.fill();
    ctx.strokeStyle = "#5a2418"; ctx.lineWidth = 1.5; ctx.strokeRect(-13, -6, 26, 12);
    ctx.restore();
  }

  /* =========================================================================
     ГЛАВА 2: ЛЕДЯНАЯ ЛУНА — после побега с Марса корабль садится на спутник.
     Скользкий лёд, лютый холод (быстрый разряд), морозные хищники.
     Собрать 3 крио-ядра → пещера → прыжковый двигатель → домой.
     ========================================================================= */
  function auroraSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, "#06121f"); g.addColorStop(0.5, "#0d2740"); g.addColorStop(1, "#16384f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    starfield(ctx, 70, 13);
    // полярное сияние
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.14 + 0.06 * Math.sin(G.time * 0.7 + k);
      const grad = ctx.createLinearGradient(0, 60 + k * 30, 0, 260 + k * 40);
      grad.addColorStop(0, k === 1 ? "#7bffd0" : "#7be0ff"); grad.addColorStop(1, "rgba(60,120,200,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(0, 120 + k * 26);
      for (let x = 0; x <= VIEW.w; x += 40) ctx.lineTo(x, 120 + k * 26 + Math.sin(x * 0.01 + G.time * 0.8 + k) * 40);
      ctx.lineTo(VIEW.w, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function iceField(ctx, s) {
    const b = s.bounds;
    // ледяная равнина с бликами
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, "#cfe6f5"); g.addColorStop(1, "#8fb6d0");
    ctx.fillStyle = g; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.fill();
    ctx.strokeStyle = "#5a7e98"; ctx.lineWidth = 3; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.stroke();
    // трещины во льду (детерминированные)
    ctx.strokeStyle = "rgba(90,126,152,0.5)"; ctx.lineWidth = 1.5;
    let r = 99;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (let i = 0; i < 14; i++) {
      let x = b.x + 30 + rnd() * (b.w - 60), y = b.y + 30 + rnd() * (b.h - 60);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // блики-искры
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 10; i++) {
      const x = b.x + ((i * 173) % (b.w - 40)) + 20, y = b.y + ((i * 211) % (b.h - 40)) + 20;
      const tw = (Math.sin(G.time * 3 + i) + 1) / 2;
      ctx.globalAlpha = tw * 0.8; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  // Крио-ядро — собираемый кристалл энергии
  function drawCryoCore(ctx, x, y) {
    const t = G.time, yy = y + Math.sin(t * 2 + x) * 5, gl = (Math.sin(t * 3) + 1) / 2;
    const rg = ctx.createRadialGradient(x, yy, 2, x, yy, 34);
    rg.addColorStop(0, `rgba(150,240,255,${0.4 + gl * 0.35})`); rg.addColorStop(1, "rgba(120,200,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, yy, 34, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, yy); ctx.rotate(Math.sin(t * 1.2) * 0.15);
    const cg = ctx.createLinearGradient(0, -20, 0, 20);
    cg.addColorStop(0, "#eaffff"); cg.addColorStop(0.5, "#7be0ff"); cg.addColorStop(1, "#2a8ad0");
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(13, -6); ctx.lineTo(9, 18); ctx.lineTo(-9, 18); ctx.lineTo(-13, -6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#bfeeff"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 12); ctx.stroke();
    ctx.restore();
  }
  // тонкий холодный налёт поверх мира + индикатор холода
  function coldOverlay(ctx, intensity) {
    ctx.fillStyle = `rgba(120,180,230,${0.1 + intensity * 0.14})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // изморозь по углам экрана
    ctx.fillStyle = `rgba(220,240,255,${0.12 + intensity * 0.12})`;
    for (const c of [[0, 0], [VIEW.w, 0], [0, VIEW.h], [VIEW.w, VIEW.h]]) {
      const rg = ctx.createRadialGradient(c[0], c[1], 10, c[0], c[1], 220);
      rg.addColorStop(0, `rgba(210,238,255,${0.22 + intensity * 0.16})`); rg.addColorStop(1, "rgba(210,238,255,0)");
      ctx.fillStyle = rg; ctx.fillRect(Math.min(c[0], VIEW.w - 220) - 0, Math.min(c[1], VIEW.h - 220), 220, 220);
    }
  }
  // Робот в ледяной корке (заморожен дыханием Стража)
  function drawFrozenShell(ctx, robot) {
    ctx.save(); ctx.translate(robot.x, robot.y);
    ctx.fillStyle = "rgba(170,220,255,0.42)";
    ctx.beginPath(); ctx.moveTo(-26, 24); ctx.lineTo(-30, -20); ctx.lineTo(-10, -32); ctx.lineTo(12, -30); ctx.lineTo(30, -16); ctx.lineTo(28, 24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
    for (const a of [-1.2, -0.2, 0.8]) { ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.stroke(); }
    // острые сосульки сверху
    ctx.fillStyle = "rgba(220,245,255,0.7)";
    for (const dx of [-16, 0, 16]) { ctx.beginPath(); ctx.moveTo(dx - 5, -22); ctx.lineTo(dx + 5, -22); ctx.lineTo(dx, -40); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  // Тепловой гейзер — зона обогрева (откат холода + подзарядка)
  function drawHeatVent(ctx, v, active) {
    const t = G.time;
    // тёплое сияние на земле
    const gl = (Math.sin(t * 3 + v.x) + 1) / 2;
    const rg = ctx.createRadialGradient(v.x, v.y, 4, v.x, v.y, v.r);
    rg.addColorStop(0, `rgba(255,170,80,${(active ? 0.5 : 0.32) + gl * 0.15})`);
    rg.addColorStop(0.5, "rgba(255,120,50,0.12)"); rg.addColorStop(1, "rgba(255,100,40,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 7); ctx.fill();
    // жерло
    ctx.fillStyle = "#3a2a22"; ctx.beginPath(); ctx.ellipse(v.x, v.y + 6, 22, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#1a120e"; ctx.beginPath(); ctx.ellipse(v.x, v.y + 6, 14, 5, 0, 0, 7); ctx.fill();
    // угли
    ctx.fillStyle = `rgba(255,${120 + gl * 80},40,${0.7 + gl * 0.3})`;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(v.x + i * 7, v.y + 6, 2.5, 0, 7); ctx.fill(); }
    // пар/тепло вверх
    ctx.fillStyle = "rgba(255,210,170,0.18)";
    for (let i = 0; i < 4; i++) { const yy = v.y - (t * 40 + i * 22) % 70; ctx.beginPath(); ctx.arc(v.x + Math.sin(t * 2 + i) * 8, yy, 6 + i * 2, 0, 7); ctx.fill(); }
  }
  // обработка тепловых гейзеров: возле жерла холод откатывается, идёт подзарядка
  function updateHeatVents(s, dt) {
    s.data.warming = false;
    if (!s.data.vents) return;
    for (const v of s.data.vents) {
      if (Math.hypot(s.robot.x - v.x, s.robot.y - v.y) < v.r * 0.8) {
        s.data.warming = true;
        G.state.battery = Math.min(100, G.state.battery + dt * 2.2);
        if (s.robot.frozen > 0) s.robot.frozen = 0; // тепло размораживает
        break;
      }
    }
  }
  // Ледяные дневники прошлой экспедиции (лор главы 2)
  const ICE_LOG_TEXTS = {
    ice1: "Бортовой журнал, обломок 1: «…прыжок зашвырнул нас сюда же. Эта луна — кладбище кораблей. Двигатели глохнут от холода. Мы не первые…»",
    ice2: "Бортовой журнал, обломок 2: «В пещерах — ОНО. Древние заморозили Стража вместе с сердечником прыжкового двигателя. Без сердечника не улететь.»",
    ice3: "Бортовой журнал, обломок 3: «Если читаешь это — ты дошёл дальше нас. Разбей лёд Стража, забери сердечник. И возвращайся домой за нами. Прошу.»",
  };
  function placeIceLog(s, id, x, y) {
    if (G.state['_iceLog_' + id]) return;
    s.interactables.push({
      x, y, r: 66, _icelog: id,
      label: () => "Прочитать журнал 🧊",
      ready: () => !G.state['_iceLog_' + id],
      act(sc) {
        if (G.state['_iceLog_' + id]) return;
        G.state['_iceLog_' + id] = true; G.state.iceLogs++;
        G.audio.pickup(); G.fx.burst(x, y - 10, "#bfe0ff", 20, 160, 0.8);
        sc.toast(ICE_LOG_TEXTS[id] || "Замёрзший журнал…", 6.0);
      },
    });
  }
  function drawIceLog(ctx, x, y) {
    const t = G.time, yy = y + Math.sin(t * 2 + x) * 4, gl = (Math.sin(t * 3) + 1) / 2;
    const rg = ctx.createRadialGradient(x, yy, 2, x, yy, 28);
    rg.addColorStop(0, `rgba(150,210,255,${0.3 + gl * 0.3})`); rg.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, yy, 28, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, yy); ctx.rotate(Math.sin(t * 1.5) * 0.1);
    // вмёрзший планшет
    ctx.fillStyle = "rgba(190,225,245,0.5)"; rr(ctx, -16, -19, 32, 38, 4); ctx.fill();
    ctx.fillStyle = "#2a3850"; rr(ctx, -12, -15, 24, 30, 3); ctx.fill();
    ctx.strokeStyle = "#7be0ff"; ctx.lineWidth = 1.2; ctx.strokeRect(-9, -11, 18, 22);
    ctx.strokeStyle = "rgba(180,220,255,0.7)"; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-6, -7 + i * 5); ctx.lineTo(6, -7 + i * 5); ctx.stroke(); }
    ctx.restore();
  }
  // Вмёрзший ящик с экипировкой (ледовые шипы)
  function drawIceCrate(ctx, x, y) {
    const t = G.time, gl = (Math.sin(t * 3) + 1) / 2;
    const rg = ctx.createRadialGradient(x, y, 4, x, y, 44);
    rg.addColorStop(0, `rgba(150,230,255,${0.25 + gl * 0.25})`); rg.addColorStop(1, "rgba(120,200,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 44, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, y);
    // ящик
    ctx.fillStyle = "#6a5236"; rr(ctx, -24, -20, 48, 40, 4); ctx.fill();
    ctx.fillStyle = "#7e6242"; rr(ctx, -24, -20, 48, 10, 3); ctx.fill();
    ctx.strokeStyle = "#3a2c1c"; ctx.lineWidth = 2; rr(ctx, -24, -20, 48, 40, 4); ctx.stroke();
    // металлические уголки + замок
    ctx.fillStyle = "#9aa3ad"; for (const cx of [-24, 18]) for (const cy of [-20, 14]) ctx.fillRect(cx, cy, 6, 6);
    ctx.fillStyle = "#cdd4db"; rr(ctx, -5, -4, 10, 10, 2); ctx.fill();
    // снег/лёд сверху + сосульки
    ctx.fillStyle = "rgba(230,248,255,0.85)"; rr(ctx, -26, -24, 52, 8, 3); ctx.fill();
    ctx.fillStyle = "rgba(210,240,255,0.6)";
    for (const dx of [-16, 0, 16]) { ctx.beginPath(); ctx.moveTo(dx - 3, 18); ctx.lineTo(dx + 3, 18); ctx.lineTo(dx, 28); ctx.closePath(); ctx.fill(); }
    // значок шипа
    ctx.fillStyle = "#dff2ff"; ctx.font = `900 16px ${G.FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("❄", 0, 2); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.restore();
  }

  // === КАТ-СЦЕНА: прибытие на ледяную луну ===
  makeMiniCutscene("cutscene_ice_arrival", 99, [
    {
      dur: 3.2, text: "Двигатель Древних перегрелся в прыжке. Корабль сходит с курса и тормозит у ледяного спутника на краю системы...",
      onTime() { if (Math.random() > 0.7) G.fx.burst(Math.random() * VIEW.w, Math.random() * 200, "#7be0ff", 1, 60, 1.0); },
      draw(ctx) {
        auroraSky(ctx);
        // ледяная луна крупным планом
        const mx = VIEW.w / 2 + 230, my = 360;
        const mg = ctx.createRadialGradient(mx - 40, my - 40, 20, mx, my, 200);
        mg.addColorStop(0, "#eafaff"); mg.addColorStop(0.6, "#9cc8e6"); mg.addColorStop(1, "#3a6a96");
        ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 200, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(120,160,190,0.4)";
        for (const c of [[mx - 80, my - 30, 24], [mx + 40, my + 60, 34], [mx - 20, my + 100, 18]]) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, 7); ctx.fill(); }
        // корабль входит в атмосферу с тормозным факелом
        const sx = 240 + Math.min(120, G.time * 40), sy = 250 + Math.sin(G.time) * 10;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(0.5);
        ctx.fillStyle = "rgba(255,150,70,0.7)"; ctx.beginPath(); ctx.moveTo(-10, 14); ctx.lineTo(10, 14); ctx.lineTo(0, 70); ctx.closePath(); ctx.fill();
        const hull = ctx.createLinearGradient(-20, 0, 20, 0); hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
        ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(16, -16, 14, 14); ctx.lineTo(-14, 14); ctx.quadraticCurveTo(-16, -16, 0, -34); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -12, 6, 0, 7); ctx.fill();
        ctx.restore();
      }
    },
    {
      dur: 3.4, text: "Робот выходит на скользкий лёд. Холод стремительно сажает батарею — спасают лишь тепловые гейзеры. Двигатель мёртв: нужны 3 крио-ядра, морозный кристалл и сердечник из глубин.",
      draw(ctx) {
        auroraSky(ctx);
        // севший корабль на льду
        const cx = VIEW.w / 2, horizon = 520;
        ctx.fillStyle = "#bcd8ea"; ctx.fillRect(0, horizon, VIEW.w, VIEW.h - horizon);
        ctx.fillStyle = "#a6c6dc"; for (let x = 0; x < VIEW.w; x += 60) { ctx.beginPath(); ctx.moveTo(x, horizon); ctx.lineTo(x + 30, horizon - 12); ctx.lineTo(x + 60, horizon); ctx.fill(); }
        // ледяные пики
        ctx.fillStyle = "#cfeaf6";
        for (const p of [[180, 130], [820, 160], [560, 90]]) { ctx.beginPath(); ctx.moveTo(p[0] - p[1] * 0.5, horizon); ctx.lineTo(p[0], horizon - p[1]); ctx.lineTo(p[0] + p[1] * 0.5, horizon); ctx.closePath(); ctx.fill(); }
        // корабль
        ctx.save(); ctx.translate(cx + 150, horizon - 6); ctx.rotate(0.12);
        const hull = ctx.createLinearGradient(-30, 0, 30, 0); hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
        ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(0, -64); ctx.quadraticCurveTo(26, -30, 22, 14); ctx.lineTo(-22, 14); ctx.quadraticCurveTo(-26, -30, 0, -64); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -26, 9, 0, 7); ctx.fill();
        ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-40, 18); ctx.lineTo(-22, 12); ctx.fill();
        ctx.restore();
        // робот
        G.drawRobot(ctx, cx - 220, horizon - 6, 26, 1, G.time);
        coldOverlay(ctx, 0.5);
      }
    },
  ], () => G.go("ice_surface"));

  // === ЛЕДЯНАЯ ПОВЕРХНОСТЬ — собрать 3 крио-ядра ===
  G.addScene("ice_surface", makeRoom({
    name: "ice_surface", dayValue: 99, ice: true, drain: 0.8, noBaseCharge: true,
    start: { x: 160, y: 410 },
    narr: (s) => G.state.iceCores >= 3
      ? "Все крио-ядра собраны! К буре (выход справа) — за ней пещеры Стража."
      : `❄ Крио-ядра: ${G.state.iceCores}/3. Грейтесь у гейзеров — холод сажает батарею. Бейте морозных тварей.`,
    bg(ctx, s) { auroraSky(ctx); iceField(ctx, s); },
    build(s) {
      G.dayCycle = 0.5;
      s.robot.ivx = 0; s.robot.ivy = 0;
      s.data.gust = 0; s.data.gustT = 3 + Math.random() * 3;
      // тепловые гейзеры — зоны обогрева (греемся, откатываем холод)
      s.data.vents = [{ x: 200, y: 320, r: 78 }, { x: 760, y: 280, r: 78 }];
      // ледяной журнал прошлой экспедиции (лор)
      placeIceLog(s, "ice1", 430, 540);
      // вмёрзший ящик прошлой экспедиции — ЛЕДОВЫЕ ШИПЫ (апгрейд)
      if (!G.state.upgIceCleats) {
        s.interactables.push({
          x: 330, y: 430, r: 70, _icecrate: true,
          label: () => "Вскрыть ящик 📦",
          ready: () => !G.state.upgIceCleats,
          act(sc) {
            if (G.state.upgIceCleats) return;
            G.state.upgIceCleats = true; G.audio.win();
            G.fx.burst(330, 420, "#dff2ff", 34, 260, 1.0); G.fx.ring(330, 430, "#bfeeff", 76, 0.5); G.shake(6);
            sc.toast("📦 ЛЕДОВЫЕ ШИПЫ! Цепкость + меньше холода. А удар по льду «Действием» бьёт морозной волной — оглушает врагов вокруг!", 5.0);
          }
        });
      }
      // Стартовый набор главы 2 (один раз): запас заряда + расходники, чтобы освоиться
      if (!G.state._iceStarted) {
        G.state._iceStarted = true;
        G.state.battery = Math.max(G.state.battery, 80);
        G.state.cons.medkit += 2; G.state.scrap += 6;
        s.toast("❄ Холод сажает батарею. Выдан стартовый набор: 2 аптечки + лом.", 4.0);
      }
      // ледяные глыбы-препятствия
      s.obstacles.push({ x: 360, y: 260, w: 70, h: 60 });
      s.obstacles.push({ x: 620, y: 430, w: 80, h: 56 });
      // три крио-ядра в углах
      const cores = [{ x: 300, y: 540 }, { x: 540, y: 230 }, { x: 800, y: 520 }];
      cores.forEach((c, i) => {
        if (G.state['_iceCore' + i]) return;
        s.interactables.push({
          x: c.x, y: c.y, r: 64, _cryo: true, _ci: i,
          label: () => "Взять крио-ядро ❄",
          ready: () => !G.state['_iceCore' + i],
          act(sc) {
            if (G.state['_iceCore' + i]) return;
            G.state['_iceCore' + i] = true; G.state.iceCores++;
            G.audio.pickup(); G.fx.burst(c.x, c.y - 10, "#7be0ff", 26, 220, 0.9); G.fx.ring(c.x, c.y, "#bfeeff", 60, 0.5);
            sc.toast(`❄ Крио-ядро ${G.state.iceCores}/3`, 1.8);
          }
        });
      });
      // морозные хищники (двое — добивают холод, не толпа)
      for (const p of [[520, 320], [700, 470]]) {
        const mu = makeMutant(p[0], p[1], null, "frostling"); mu.aware = false; s.mutants.push(mu);
      }
      // выход в бурю (нижний-правый угол, чтобы не пересекаться с панелью расходников)
      s.exitZone = {
        x: s.bounds.x + s.bounds.w - 66, y: s.bounds.y + s.bounds.h - 100, w: 66, h: 96,
        label: () => G.state.iceCores >= 3 ? "→ В бурю" : "🔒 Сначала 3 крио-ядра",
        ready: () => G.state.iceCores >= 3, to: "ice_blizzard"
      };
    },
    update(s, dt) {
      updateHeatVents(s, dt); // обогрев у гейзеров
      // порывы ледяного ветра — толкают робота и добавляют холод
      s.data.gustT -= dt;
      if (s.data.gustT <= 0) { s.data.gustT = 3 + Math.random() * 3; s.data.gust = 1.2; s.data.gustDir = Math.random() > 0.5 ? 1 : -1; G.audio.tone(140, 0.5, "sawtooth", 0.03); }
      if (s.data.gust > 0) {
        s.data.gust -= dt;
        s.robot.ivx = (s.robot.ivx || 0) + s.data.gustDir * 240 * (G.state.upgIceCleats ? 0.35 : 1) * dt;
        if (!s.data.warming) G.state.battery -= dt * 0.5; // дополнительный холод в порыв
      }
    },
    drawProps(s, ctx) {
      if (s.data.vents) for (const v of s.data.vents) drawHeatVent(ctx, v, s.data.warming);
      for (const it of s.interactables) if (it._icelog && (!it.ready || it.ready(s))) drawIceLog(ctx, it.x, it.y);
      for (const it of s.interactables) if (it._icecrate && (!it.ready || it.ready(s))) drawIceCrate(ctx, it.x, it.y);
      // ядра рисуются как pickup'ы (drawPickup) — но используем красивый кристалл
      for (const it of s.interactables) if (it._cryo && (!it.ready || it.ready(s))) drawCryoCore(ctx, it.x, it.y);
      // ледяные глыбы
      for (const o of s.obstacles) {
        const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        g.addColorStop(0, "#eafaff"); g.addColorStop(1, "#8fb6d0");
        ctx.fillStyle = g; rr(ctx, o.x, o.y, o.w, o.h, 8); ctx.fill();
        ctx.strokeStyle = "#5a7e98"; ctx.lineWidth = 2; rr(ctx, o.x, o.y, o.w, o.h, 8); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; rr(ctx, o.x + 6, o.y + 6, o.w * 0.4, 6, 3); ctx.fill();
      }
    },
    drawOver(s, ctx) {
      coldOverlay(ctx, s.data.warming ? 0.12 : 0.45 + (s.data.gust > 0 ? 0.3 : 0));
      iceStatusBar(ctx, `❄ Крио-ядра ${G.state.iceCores}/3`, s.data.warming);
      if (s.data.gust > 0 && !s.data.warming) { ctx.fillStyle = "#cfe6ff"; ctx.font = f(22, "800"); ctx.textAlign = "center"; ctx.fillText("❄ ЛЕДЯНОЙ ПОРЫВ!", VIEW.w / 2, 130); ctx.textAlign = "left"; }
    },
  }));
  // общий статус-бар ледяных сцен (счётчик + индикатор «грею батарею»)
  function iceStatusBar(ctx, label, warming) {
    ctx.fillStyle = "rgba(8,20,32,0.7)"; rr(ctx, VIEW.w / 2 - 110, 70, 220, 34, 8); ctx.fill();
    ctx.fillStyle = "#bfeeff"; ctx.font = f(18, "800"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, VIEW.w / 2, 87);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (warming) {
      ctx.fillStyle = "#ffb060"; ctx.font = f(20, "800"); ctx.textAlign = "center";
      ctx.fillText("🔥 Грею батарею…", VIEW.w / 2, 128); ctx.textAlign = "left";
    }
  }

  // === ЛЕДЯНАЯ БУРЯ — пробиться сквозь белую мглу к пещере ===
  G.addScene("ice_blizzard", makeRoom({
    name: "ice_blizzard", dayValue: 108, ice: true, drain: 0.95, noBaseCharge: true,
    start: { x: 120, y: 410 },
    narr: () => "🌨 БУРЯ! Видимость почти ноль. Прыгайте между гейзерами к выходу справа, уклоняйтесь от ледяных шипов.",
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#16384f"); g.addColorStop(1, "#21506a"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      iceField(ctx, s);
    },
    build(s) {
      G.dayCycle = 0.46; s.robot.ivx = 0; s.robot.ivy = 0;
      // цепочка гейзеров-вех к выходу
      s.data.vents = [{ x: 280, y: 300, r: 76 }, { x: 500, y: 500, r: 76 }, { x: 720, y: 280, r: 76 }];
      s.data.spikes = []; s.data.spikeT = 1.6;
      s.data.windT = 0;
      // пара морозных тварей в мгле
      for (const p of [[420, 360], [640, 440]]) { const mu = makeMutant(p[0], p[1], null, "frostling"); mu.aware = true; mu.blind = false; s.mutants.push(mu); }
      s.exitZone = {
        x: s.bounds.x + s.bounds.w - 66, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => "→ В пещеру", ready: () => true, to: "ice_cave"
      };
    },
    update(s, dt) {
      updateHeatVents(s, dt);
      // постоянный ветер сдувает робота вбок (нарастает и спадает)
      s.data.windT += dt;
      const wind = Math.sin(s.data.windT * 0.7) * 200 * (G.state.upgIceCleats ? 0.35 : 1);
      s.robot.ivx = (s.robot.ivx || 0) + wind * dt;
      if (!s.data.warming) G.state.battery -= dt * 0.35; // буря студит сильнее
      // ледяные шипы выстреливают из-под земли (телеграф → удар → спад)
      s.data.spikeT -= dt;
      if (s.data.spikeT <= 0) {
        s.data.spikeT = 0.9 + Math.random() * 0.8;
        const ang = Math.random() * 7, d = 40 + Math.random() * 90;
        s.data.spikes.push({ x: clamp(s.robot.x + Math.cos(ang) * d, s.bounds.x + 30, s.bounds.x + s.bounds.w - 30), y: clamp(s.robot.y + Math.sin(ang) * d, s.bounds.y + 30, s.bounds.y + s.bounds.h - 30), tele: 0.7, life: 0 });
      }
      for (let i = s.data.spikes.length - 1; i >= 0; i--) {
        const sp = s.data.spikes[i];
        if (sp.tele > 0) {
          sp.tele -= dt;
          if (sp.tele <= 0) {
            sp.life = 0.5; G.audio.tone(200, 0.12, "sawtooth", 0.05); G.shake(5);
            if (Math.hypot(sp.x - s.robot.x, sp.y - s.robot.y) < s.robot.r + 26) s.hurt(12, { x: (s.robot.x - sp.x) * 0.1, y: (s.robot.y - sp.y) * 0.1 });
          }
        } else { sp.life -= dt; if (sp.life <= 0) s.data.spikes.splice(i, 1); }
      }
    },
    drawProps(s, ctx) {
      if (s.data.vents) for (const v of s.data.vents) drawHeatVent(ctx, v, s.data.warming);
      // ледяные шипы
      for (const sp of s.data.spikes) {
        if (sp.tele > 0) {
          const k = 1 - sp.tele / 0.7;
          ctx.strokeStyle = `rgba(140,210,255,${0.4 + 0.5 * Math.sin(G.time * 18)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 26 * (0.6 + k * 0.4), 0, 7); ctx.stroke();
        } else {
          const h = 54 * Math.min(1, sp.life / 0.5 + 0.4);
          const g = ctx.createLinearGradient(sp.x, sp.y, sp.x, sp.y - h);
          g.addColorStop(0, "#7fb4d8"); g.addColorStop(1, "#eafaff");
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sp.x - 14, sp.y); ctx.lineTo(sp.x + 14, sp.y); ctx.lineTo(sp.x, sp.y - h); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = "#bfeeff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    },
    drawOver(s, ctx) {
      // белая мгла: чистый «пузырь» вокруг робота, дальше — белая стена
      const rg = ctx.createRadialGradient(s.robot.x, s.robot.y, 95, s.robot.x, s.robot.y, 340);
      rg.addColorStop(0, "rgba(226,240,252,0)"); rg.addColorStop(1, `rgba(226,240,252,${s.data.warming ? 0.55 : 0.8})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      // несущийся снег
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 60; i++) {
        const x = (i * 173 + G.time * 520) % (VIEW.w + 80) - 40;
        const y = (i * 251 + G.time * 130) % VIEW.h;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 12, y + 5); ctx.stroke();
      }
      coldOverlay(ctx, s.data.warming ? 0.1 : 0.4);
      iceStatusBar(ctx, "🌨 Пробейся к пещере →", s.data.warming);
    },
  }));

  // === ЛЕДЯНАЯ ПЕЩЕРА — добыть морозный кристалл-катализатор ===
  G.addScene("ice_cave", makeRoom({
    name: "ice_cave", dayValue: 120, ice: true, drain: 0.55, noBaseCharge: true,
    start: { x: 160, y: 410 },
    narr: (s) => G.state.hasFrostCrystal
      ? "Кристалл добыт! Глубже — логово Стража (выход справа). Готовьтесь к бою."
      : `🧊 Вырубите МОРОЗНЫЙ КРИСТАЛЛ из жилы (бейте «Действием»): ${(s.data.node ? s.data.node.taps : 0)}/${(s.data.node ? s.data.node.need : 8)}. Грейтесь у гейзера.`,
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#1e4763"); g.addColorStop(1, "#13303f"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      const b = s.bounds;
      const fg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      fg.addColorStop(0, "#5a86a4"); fg.addColorStop(1, "#33586e");
      ctx.fillStyle = fg; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.fill();
      ctx.strokeStyle = "#2a4a60"; ctx.lineWidth = 3; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.stroke();
      // мерцающие ледяные жилы на полу
      ctx.strokeStyle = "rgba(150,220,255,0.3)"; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const y = b.y + 80 + i * 90; ctx.beginPath(); ctx.moveTo(b.x + 20, y); for (let x = b.x + 20; x < b.x + b.w; x += 60) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 14); ctx.stroke(); }
      // ледяные сталактиты/сталагмиты
      ctx.fillStyle = "#bfe0f0";
      for (let i = 0; i < 9; i++) { const x = b.x + 50 + i * (b.w - 100) / 8; ctx.beginPath(); ctx.moveTo(x - 12, b.y); ctx.lineTo(x + 12, b.y); ctx.lineTo(x, b.y + 30 + (i % 3) * 16); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x - 10, b.y + b.h); ctx.lineTo(x + 10, b.y + b.h); ctx.lineTo(x, b.y + b.h - 24 - (i % 2) * 14); ctx.closePath(); ctx.fill(); }
    },
    build(s) {
      G.dayCycle = 0.42; s.robot.ivx = 0; s.robot.ivy = 0;
      s.data.px = VIEW.w / 2 + 250; s.data.py = s.bounds.y + s.bounds.h / 2 - 20;
      s.data.vents = [{ x: 200, y: 470, r: 76 }];
      // жила морозного кристалла — рубится «Действием»
      s.data.node = { x: s.data.px, y: s.data.py, taps: 0, need: 8 };
      s.obstacles.push({ x: s.data.px - 46, y: s.data.py - 6, w: 92, h: 70 });
      s.interactables.push({
        x: s.data.px, y: s.data.py + 20, r: 100,
        label: () => G.state.hasFrostCrystal ? "Кристалл добыт ✔" : `Рубить кристалл 🧊 (${s.data.node.taps}/${s.data.node.need})`,
        ready: () => !G.state.hasFrostCrystal,
        act(sc) {
          if (G.state.hasFrostCrystal) return;
          const n = sc.data.node; n.taps++;
          G.audio.tone(300 + n.taps * 40, 0.06, "square", 0.05); G.fx.burst(n.x, n.y - 10, "#bfeeff", 8, 120, 0.5); G.shake(3);
          if (n.taps >= n.need) {
            G.state.hasFrostCrystal = true; G.audio.win();
            G.fx.burst(n.x, n.y - 10, "#7be0ff", 44, 280, 1.2); G.fx.ring(n.x, n.y, "#bfeeff", 80, 0.5); G.shake(7);
            sc.toast("🧊 Морозный кристалл добыт! Глубже — Страж (выход справа).", 3.2);
          }
        }
      });
      // ледяной журнал (лор) + стражи кристалла
      placeIceLog(s, "ice2", 360, 540);
      for (const p of [[420, 300, "frostling"], [560, 470, "spitter"]]) {
        const mu = makeMutant(p[0], p[1], null, p[2]); mu.aware = true; mu.blind = false; s.mutants.push(mu);
      }
      s.exitZone = {
        x: s.bounds.x + s.bounds.w - 66, y: s.bounds.y + s.bounds.h - 100, w: 66, h: 96,
        label: () => G.state.hasFrostCrystal ? "→ К Стражу" : "🔒 Сначала кристалл",
        ready: () => G.state.hasFrostCrystal, to: "cutscene_ice_guardian"
      };
    },
    update(s, dt) { updateHeatVents(s, dt); },
    drawProps(s, ctx) {
      if (s.data.vents) for (const v of s.data.vents) drawHeatVent(ctx, v, s.data.warming);
      for (const it of s.interactables) if (it._icelog && (!it.ready || it.ready(s))) drawIceLog(ctx, it.x, it.y);
      drawFrostVein(ctx, s.data.node, G.state.hasFrostCrystal);
    },
    drawOver(s, ctx) {
      coldOverlay(ctx, s.data.warming ? 0.08 : 0.18);
      iceStatusBar(ctx, G.state.hasFrostCrystal ? "🧊 Кристалл добыт" : `🧊 Кристалл ${s.data.node.taps}/${s.data.node.need}`, s.data.warming);
    },
  }));
  // Жила морозного кристалла (рубится по тапам), либо выдолбленная лунка
  function drawFrostVein(ctx, node, mined) {
    const x = node.x, y = node.y, t = G.time;
    // ледяная порода-постамент
    ctx.fillStyle = "#33586e"; rr(ctx, x - 50, y + 30, 100, 22, 5); ctx.fill();
    ctx.fillStyle = "#2a4a60"; rr(ctx, x - 44, y + 24, 88, 12, 4); ctx.fill();
    if (mined) {
      // лунка от добычи
      ctx.fillStyle = "#16303f"; ctx.beginPath(); ctx.ellipse(x, y + 6, 30, 18, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(150,220,255,0.3)"; for (let i = 0; i < 5; i++) { const a = i * 1.3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 20, y + 6 + Math.sin(a) * 10, 2, 0, 7); ctx.fill(); }
      return;
    }
    const dmg = node.taps / node.need; // 0..1 степень разрушения
    const gl = (Math.sin(t * 3) + 1) / 2;
    const rg = ctx.createRadialGradient(x, y, 4, x, y, 60);
    rg.addColorStop(0, `rgba(123,224,255,${0.35 + gl * 0.3})`); rg.addColorStop(1, "rgba(60,120,220,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 60, 0, 7); ctx.fill();
    // кристаллы (сжимаются по мере добычи)
    const sc = 1 - dmg * 0.4;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    for (const c of [[0, -8, 46], [-20, 6, 30], [20, 4, 34]]) {
      const cg = ctx.createLinearGradient(c[0], c[1], c[0], c[1] - c[2]);
      cg.addColorStop(0, "#3a8ad0"); cg.addColorStop(1, "#eaffff");
      ctx.fillStyle = cg; ctx.beginPath();
      ctx.moveTo(c[0] - 9, c[1]); ctx.lineTo(c[0] + 9, c[1]); ctx.lineTo(c[0] + 4, c[1] - c[2]); ctx.lineTo(c[0] - 4, c[1] - c[2]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#bfeeff"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
    // трещины от ударов
    if (dmg > 0) { ctx.strokeStyle = `rgba(20,40,60,${dmg})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 14, y - 30); ctx.lineTo(x - 4, y - 10); ctx.lineTo(x - 12, y + 6); ctx.stroke(); }
  }

  // === КАТ-СЦЕНА: логово Морозного Стража ===
  makeMiniCutscene("cutscene_ice_guardian", 128, [
    {
      dur: 3.4, text: "Глубже льды расступаются. В вечной мерзлоте вмёрзло ОНО — МОРОЗНЫЙ СТРАЖ, и в его груди — сердечник прыжкового двигателя. Лёд трескается. Оно просыпается.",
      onTime() { if (Math.random() > 0.6) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 200, 300 + Math.random() * 160, "#bfe0ff", 1, 80, 0.9); },
      draw(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#0a2236"); g.addColorStop(1, "#13303f");
        ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        // глыба льда с силуэтом Стража
        const cx = VIEW.w / 2, cy = 360;
        ctx.fillStyle = "rgba(120,180,220,0.25)"; rr(ctx, cx - 150, cy - 160, 300, 340, 20); ctx.fill();
        const mb = { x: cx, y: cy + 30, hp: 1, maxHp: 1, mode: "idle", telegT: 0, hitT: 0, buried: false, frozenIn: 1, eye: 1 };
        drawIceBoss(ctx, mb);
        // трещины
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
        for (const c of [[cx - 80, cy - 120, cx - 30, cy], [cx + 70, cy - 100, cx + 20, cy + 40]]) { ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[2], c[3]); ctx.stroke(); }
        G.drawRobot(ctx, cx - 250, cy + 110, 28, 1, G.time);
      }
    },
  ], () => G.go("ice_boss"));

  // === БОСС: МОРОЗНЫЙ СТРАЖ ===
  G.addScene("ice_boss", makeRoom({
    name: "ice_boss", dayValue: 132, ice: true, drain: 0.5, noBaseCharge: true,
    start: { x: 150, y: 560 },
    narr: (s) => G.state.iceBossDefeated
      ? "СТРАЖ ПОВЕРЖЕН! Сердечник ваш. К выходу — собрать двигатель и домой."
      : "❄ МОРОЗНЫЙ СТРАЖ! Бейте «Действием». Уклоняйтесь от ледяных осколков, дыхания-заморозки и тарана. Грейтесь у гейзеров.",
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, "#0a2236"); g.addColorStop(1, "#16384c"); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      const b = s.bounds;
      const fg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      fg.addColorStop(0, "#3a6076"); fg.addColorStop(1, "#22455a");
      ctx.fillStyle = fg; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.fill();
      ctx.strokeStyle = "#1a3346"; ctx.lineWidth = 3; rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.stroke();
      ctx.fillStyle = "#bfe0f0";
      for (let i = 0; i < 11; i++) { const x = b.x + 40 + i * (b.w - 80) / 10; ctx.beginPath(); ctx.moveTo(x - 12, b.y); ctx.lineTo(x + 12, b.y); ctx.lineTo(x, b.y + 34 + (i % 3) * 16); ctx.closePath(); ctx.fill(); }
    },
    build(s) {
      G.dayCycle = 0.42; s.robot.ivx = 0; s.robot.ivy = 0;
      s.data.vents = [{ x: 150, y: 300, r: 72 }, { x: 880, y: 560, r: 72 }];
      s.data.shards = []; s.data.breath = null;
      placeIceLog(s, "ice3", 150, 470); // последний дневник у входа
      s.data.boss = {
        x: s.bounds.x + s.bounds.w / 2, y: s.bounds.y + 130, hp: 18, maxHp: 18,
        mode: "idle", cd: 1.6, telegT: 0, swingT: 0, hitT: 0, buried: false, eye: 1, face: 1,
      };
      // выход слева (не под панелью расходников справа)
      s.exitZone = {
        x: s.bounds.x, y: s.bounds.y + s.bounds.h / 2 - 48, w: 66, h: 96,
        label: () => G.state.iceBossDefeated ? "→ Домой 🚀" : "🔒 Победите Стража",
        ready: () => G.state.iceBossDefeated, to: "cutscene_ice_victory"
      };
    },
    update(s, dt) {
      updateHeatVents(s, dt);
      const d = s.data, b = d.boss;
      if (G.state.iceBossDefeated) return;
      if (b.hitT > 0) b.hitT -= dt;
      if (b.swingT > 0) b.swingT = Math.max(0, b.swingT - dt);
      b.face = s.robot.x < b.x ? -1 : 1;
      const dx = s.robot.x - b.x, dy = s.robot.y - b.y, dd = Math.hypot(dx, dy) || 1;
      const enraged = b.hp <= b.maxHp / 2;

      if (b.mode === "idle") {
        b.cd -= dt;
        if (b.cd <= 0) {
          const opts = enraged ? ["shards", "breath", "slam", "summon"] : ["shards", "slam", "summon"];
          b.mode = opts[Math.floor(Math.random() * opts.length)];
          b.telegT = b.mode === "breath" ? 0.9 : 0.6; b._fired = false;
        }
      } else {
        b.telegT -= dt;
        if (b.telegT <= 0 && !b._fired) {
          b._fired = true; b.swingT = 0.3;
          if (b.mode === "shards") {
            const n = enraged ? 5 : 3;
            for (let i = 0; i < n; i++) {
              const a = Math.atan2(dy, dx) + (i - (n - 1) / 2) * 0.22, sp = 300;
              d.shards.push({ x: b.x, y: b.y + 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2.4 });
            }
            G.audio.tone(300, 0.14, "triangle", 0.05); G.shake(5);
          } else if (b.mode === "breath") {
            d.breath = { y: s.robot.y, dir: b.face, t: 0.7, hit: false };
            G.audio.tone(120, 0.6, "sawtooth", 0.05);
          } else if (b.mode === "slam") {
            d.shards.push({ ring: true, x: b.x, y: b.y + 40, r: 0, max: 260, life: 0.6 });
            G.shake(13); G.hitStop(0.05); G.audio.boom();
          } else if (b.mode === "summon") {
            for (let i = 0; i < 2; i++) { const ex = s.bounds.x + 80 + Math.random() * (s.bounds.w - 160); const mu = makeMutant(ex, s.bounds.y + 60, null, "frostling"); mu.aware = true; mu.blind = false; mu._scrap = 1; s.mutants.push(mu); }
            G.fx.burst(b.x, b.y, "#bfe0ff", 22, 220, 0.8); G.audio.tone(360, 0.18, "sawtooth", 0.05);
          }
          b.cd = enraged ? 1.1 : 1.6;
          b.mode = (b.mode === "breath") ? "breathing" : "idle";
        }
        // длящееся дыхание-заморозка
        if (d.breath) {
          d.breath.t -= dt;
          if (!d.breath.hit && Math.abs(s.robot.y - d.breath.y) < 34 && ((d.breath.dir < 0 && s.robot.x < b.x) || (d.breath.dir > 0 && s.robot.x > b.x))) {
            d.breath.hit = true; s.hurt(10, null); s.robot.frozen = 1.1; G.fx.ring(s.robot.x, s.robot.y, "#cfeeff", 50, 0.4);
          }
          if (d.breath.t <= 0) { d.breath = null; b.mode = "idle"; }
        }
      }
      // снаряды-осколки + slam-кольцо
      for (let i = d.shards.length - 1; i >= 0; i--) {
        const p = d.shards[i];
        if (p.ring) {
          p.life -= dt; p.r = p.max * (1 - p.life / 0.6);
          if (!p._dmg && p.r > 30 && Math.hypot(s.robot.x - p.x, s.robot.y - p.y) < p.r + 10 && Math.hypot(s.robot.x - p.x, s.robot.y - p.y) > p.r - 30) { p._dmg = true; s.hurt(12, { x: (s.robot.x - p.x) * 0.12, y: (s.robot.y - p.y) * 0.12 }); }
          if (p.life <= 0) d.shards.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (Math.hypot(p.x - s.robot.x, p.y - s.robot.y) < s.robot.r + 12) { s.hurt(9, { x: p.vx * 0.03, y: p.vy * 0.03 }); d.shards.splice(i, 1); continue; }
        if (p.life <= 0 || p.x < s.bounds.x || p.x > s.bounds.x + s.bounds.w || p.y > s.bounds.y + s.bounds.h) d.shards.splice(i, 1);
      }
      // удар робота по Стражу (вес: ядро в груди — слабое место)
      const pz = punchZone(s.robot);
      if (pz && b.hitT <= 0) {
        const ov = (pz.x + pz.w > b.x - 50) && (pz.x < b.x + 50) && (pz.y + pz.h > b.y - 40) && (pz.y < b.y + 60);
        if (ov) {
          b.hp -= (G.state.upgPunch ? 2 : 1); b.hitT = 0.45;
          G.audio.hit(); G.shake(8); G.hitStop(0.06); G.fx.ring(b.x, b.y, "#bfeeff", 64, 0.34); G.fx.burst(b.x, b.y, "#cfeeff", 16, 200, 0.6);
          if (b.hp <= 0) {
            b.hp = 0; G.state.iceBossDefeated = true; G.state.hasGuardianCore = true; G.state.hasJumpDrive = true;
            G.audio.win(); G.fx.burst(b.x, b.y, "#7be0ff", 80, 420, 1.6); G.shake(15); d.shards = []; d.breath = null;
            s.toast("МОРОЗНЫЙ СТРАЖ ПОВЕРЖЕН! Сердечник двигателя ваш. К выходу!", 4.0);
          }
        }
      }
    },
    drawProps(s, ctx) {
      if (s.data.vents) for (const v of s.data.vents) drawHeatVent(ctx, v, s.data.warming);
      for (const it of s.interactables) if (it._icelog && (!it.ready || it.ready(s))) drawIceLog(ctx, it.x, it.y);
      if (!G.state.iceBossDefeated) drawIceBoss(ctx, s.data.boss);
      // осколки + slam-кольцо
      for (const p of s.data.shards) {
        if (p.ring) { ctx.strokeStyle = `rgba(180,230,255,${Math.max(0, p.life / 0.6) * 0.9})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke(); continue; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
        const g = ctx.createLinearGradient(-10, 0, 10, 0); g.addColorStop(0, "#3a8ad0"); g.addColorStop(1, "#eaffff");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-11, -5); ctx.lineTo(12, 0); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // дыхание-заморозка (телеграф луча)
      const br = s.data.breath;
      if (br) {
        const x2 = br.dir < 0 ? s.bounds.x : s.bounds.x + s.bounds.w;
        ctx.strokeStyle = `rgba(190,235,255,${0.5 + 0.4 * Math.sin(G.time * 18)})`; ctx.lineWidth = 30; ctx.lineCap = "round";
        ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(s.data.boss.x, br.y); ctx.lineTo(x2, br.y); ctx.stroke(); ctx.globalAlpha = 1;
        // кристаллики инея вдоль луча
        ctx.fillStyle = "#eaffff"; for (let i = 0; i < 10; i++) { const xx = s.data.boss.x + (x2 - s.data.boss.x) * (i / 10); ctx.fillRect(xx - 2, br.y - 3 + Math.sin(G.time * 10 + i) * 4, 4, 6); }
      }
    },
    drawOver(s, ctx) {
      coldOverlay(ctx, s.data.warming ? 0.08 : 0.18);
      const b = s.data.boss;
      if (!G.state.iceBossDefeated) {
        const bx = VIEW.w / 2 - 190, by = 70, bw = 380;
        ctx.fillStyle = "rgba(0,0,0,0.55)"; rr(ctx, bx, by, bw, 22, 6); ctx.fill();
        ctx.fillStyle = "#7be0ff"; rr(ctx, bx + 3, by + 3, (bw - 6) * (Math.max(0, b.hp) / b.maxHp), 16, 4); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = f(14, "700"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`❄ МОРОЗНЫЙ СТРАЖ ${Math.max(0, Math.ceil(b.hp))}/${b.maxHp}`, VIEW.w / 2, by + 11);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
      if (s.data.warming) { ctx.fillStyle = "#ffb060"; ctx.font = f(18, "800"); ctx.textAlign = "center"; ctx.fillText("🔥 Грею батарею…", VIEW.w / 2, 120); ctx.textAlign = "left"; }
    },
  }));
  // Рисунок Морозного Стража — кристаллический ледяной голем со светящимся ядром-сердечником
  function drawIceBoss(ctx, b) {
    const t = G.time;
    const breath = Math.sin(t * 1.4) * 4;
    const tele = b.telegT > 0;
    const teleShake = tele ? Math.sin(t * 50) * 3 : 0;
    const hurt = b.hitT > 0 ? b.hitT / 0.45 : 0;
    const sw = b.swingT > 0 ? 1 - b.swingT / 0.3 : 0;
    ctx.save(); ctx.translate(b.x + teleShake + (hurt ? Math.sin(t * 70) * 4 : 0), b.y + breath);
    ctx.scale(b.face || 1, 1);
    // тень
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(0, 70, 70, 16, 0, 0, 7); ctx.fill();
    // ноги-глыбы
    ctx.fillStyle = "#3a6a90";
    for (const lx of [-34, 34]) { rr(ctx, lx - 16, 36, 32, 40, 5); ctx.fill(); }
    // тело — кристаллическая глыба
    const body = ctx.createLinearGradient(0, -50, 0, 50);
    body.addColorStop(0, "#bfe6ff"); body.addColorStop(0.5, "#6aa6d6"); body.addColorStop(1, "#34678e");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-52, 46); ctx.lineTo(-60, -20); ctx.lineTo(-30, -54); ctx.lineTo(30, -54); ctx.lineTo(60, -20); ctx.lineTo(52, 46); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#22455a"; ctx.lineWidth = 3; ctx.stroke();
    // грани/блики
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-30, -54); ctx.lineTo(-14, 20); ctx.moveTo(30, -54); ctx.lineTo(14, 20); ctx.stroke();
    // ледяные шипы на спине/плечах
    ctx.fillStyle = "#eaffff";
    for (const c of [[-52, -22, 26], [-30, -54, 32], [0, -64, 40], [30, -54, 32], [52, -22, 26]]) {
      ctx.beginPath(); ctx.moveTo(c[0] - 7, c[1]); ctx.lineTo(c[0] + 7, c[1]); ctx.lineTo(c[0], c[1] - c[2]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#bfeeff"; ctx.lineWidth = 1; ctx.stroke();
    }
    // ядро-сердечник в груди (слабое место, светится)
    const cg = (Math.sin(t * 3) + 1) / 2;
    const core = ctx.createRadialGradient(0, 4, 2, 0, 4, 22 + cg * 4);
    core.addColorStop(0, "#eaffff"); core.addColorStop(0.5, `rgba(123,224,255,${0.8 + cg * 0.2})`); core.addColorStop(1, "rgba(60,120,220,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 4, 22 + cg * 4, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 4, 6, 0, 7); ctx.fill();
    // руки (поднимаются на телеграфе, бьют на swing)
    const armUp = tele ? -0.6 - 0.3 * (1 - b.telegT / 0.6) : 0;
    const armSwing = sw > 0 ? Math.sin(sw * PI) * 0.7 : 0;
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * 56, -16); ctx.rotate(side * (armUp - armSwing));
      ctx.fillStyle = "#4a7a9e"; rr(ctx, -10, 0, 20, 46, 6); ctx.fill();
      ctx.strokeStyle = "#22455a"; ctx.lineWidth = 2; ctx.strokeRect(-10, 0, 20, 46);
      ctx.fillStyle = "#eaffff"; ctx.beginPath(); ctx.moveTo(-10, 46); ctx.lineTo(10, 46); ctx.lineTo(0, 64); ctx.closePath(); ctx.fill(); // кулак-кристалл
      ctx.restore();
    }
    // голова
    ctx.fillStyle = "#7fb4d8"; ctx.beginPath(); ctx.moveTo(-22, -54); ctx.lineTo(22, -54); ctx.lineTo(16, -84); ctx.lineTo(-16, -84); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#22455a"; ctx.lineWidth = 2; ctx.stroke();
    // глаза (горят ярче при атаке/ярости)
    const eyeGlow = 0.5 + (tele ? 0.5 : 0) + (b.hp <= b.maxHp / 2 ? 0.2 : 0);
    ctx.fillStyle = `rgba(150,235,255,${Math.min(1, eyeGlow)})`;
    ctx.beginPath(); ctx.arc(-8, -68, 4, 0, 7); ctx.arc(8, -68, 4, 0, 7); ctx.fill();
    if (tele) { ctx.fillStyle = "rgba(190,245,255,0.4)"; ctx.beginPath(); ctx.arc(-8, -68, 9, 0, 7); ctx.arc(8, -68, 9, 0, 7); ctx.fill(); }
    // вспышка урона
    if (hurt) { ctx.fillStyle = `rgba(255,120,90,${hurt * 0.4})`; ctx.beginPath(); ctx.ellipse(0, -8, 64, 60, 0, 0, 7); ctx.fill(); }
    ctx.restore();
    // подпись атаки
    if (tele && b.mode && b.mode !== "idle") {
      const lbl = b.mode === "shards" ? "ОСКОЛКИ!" : b.mode === "breath" ? "ЗАМОРОЗКА!" : b.mode === "slam" ? "ТАРАН!" : "ЗОВ!";
      ctx.fillStyle = "#bfeeff"; ctx.strokeStyle = "#0a2236"; ctx.lineWidth = 4;
      ctx.font = `900 italic 22px ${G.FONT}`; ctx.textAlign = "center";
      ctx.strokeText(lbl, b.x, b.y - 96); ctx.fillText(lbl, b.x, b.y - 96); ctx.textAlign = "left";
    }
  }

  // === КАТ-СЦЕНА: ледяная луна позади — настоящий финал ===
  makeMiniCutscene("cutscene_ice_victory", 140, [
    {
      dur: 3.6, text: "Сердечник Стража + морозный кристалл + три крио-ядра — прыжковый двигатель собран и заправлен. Корабль оживает и поднимается со льда.",
      onTime() { if (Math.random() > 0.5) G.fx.burst(VIEW.w / 2 + (Math.random() - 0.5) * 120, 560, "#7be0ff", 1, 120, 0.8); },
      draw(ctx) {
        auroraSky(ctx);
        const cx = VIEW.w / 2, horizon = 540;
        ctx.fillStyle = "#bcd8ea"; ctx.fillRect(0, horizon, VIEW.w, VIEW.h - horizon);
        const rise = Math.min(1, G.time % 4 / 4);
        const sy = horizon - 40 - rise * 80;
        ctx.fillStyle = "rgba(123,224,255,0.7)"; ctx.beginPath(); ctx.moveTo(cx - 16, sy + 30); ctx.lineTo(cx + 16, sy + 30); ctx.lineTo(cx, sy + 110); ctx.closePath(); ctx.fill();
        ctx.save(); ctx.translate(cx, sy);
        const hull = ctx.createLinearGradient(-30, 0, 30, 0); hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
        ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(0, -60); ctx.quadraticCurveTo(24, -28, 20, 30); ctx.lineTo(-20, 30); ctx.quadraticCurveTo(-24, -28, 0, -60); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -22, 9, 0, 7); ctx.fill();
        ctx.restore();
      }
    },
    {
      dur: 3.4, text: "Курс на родную систему проложен. Робот пережил гробницы Марса И ледяную луну — и наконец летит домой. Конец пути.",
      draw(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, VIEW.h); g.addColorStop(0, "#06121f"); g.addColorStop(1, "#020912");
        ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
        starfield(ctx, 110, 5);
        // корабль уходит в звёзды
        const cx = VIEW.w / 2, cy = VIEW.h / 2;
        ctx.fillStyle = "rgba(123,224,255,0.6)"; ctx.beginPath(); ctx.moveTo(cx - 8, cy + 16); ctx.lineTo(cx + 8, cy + 16); ctx.lineTo(cx, cy + 80 + Math.sin(G.time * 10) * 14); ctx.closePath(); ctx.fill();
        ctx.save(); ctx.translate(cx, cy);
        const hull = ctx.createLinearGradient(-18, 0, 18, 0); hull.addColorStop(0, "#5a6470"); hull.addColorStop(0.5, "#eef2f8"); hull.addColorStop(1, "#5a6470");
        ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(14, -16, 12, 16); ctx.lineTo(-12, 16); ctx.quadraticCurveTo(-14, -16, 0, -34); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#7be0ff"; ctx.beginPath(); ctx.arc(0, -12, 6, 0, 7); ctx.fill();
        ctx.restore();
      }
    },
  ], () => G.go("final_victory"));

})();
