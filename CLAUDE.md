# Mars Survival — Project Rules

iPad/web game, HTML5 Canvas 2D, vanilla JS. Russian UI text. No build step, no images — everything procedural.

## Язык общения

- **Всегда отвечай пользователю на русском языке.** Текст в чате, объяснения, summary — по-русски.
- Код, имена переменных, технические термины (commit, exit zone, eval) можно оставлять как есть.

## File Layout

- `index.html` — cache-busted script loader (`?t=Date.now()`). Edits to `js/*.js` apply on browser reload.
- `js/engine.js` — `G` global, default state, render helpers (`G.drawRobot`, `G.drawHUD`, `G.drawTombRoom`, `G.actionButton`, `G.narrationBox`, `G.fx.burst`, `G.audio.*`, `G.go`, `G.addScene`, `G.startLoop`). Also day/night cycle: `G.dayCycle` (0..1), `G.sunHeight()` (-1..1), `G.daylight()` (0..1), `G.dayDrainFactor()`, `G.dayNightOverlay(ctx)`.
- `js/scenes.js` — ALL scenes live here. ~3500+ lines. Use `Read` with `offset`/`limit`, not whole-file reads.
- `js/main.js` — bootstrap only. Don't touch unless changing canvas setup.
- `css/style.css` — minimal, full-screen canvas with `touch-action: none`. Don't touch.

## Coding Conventions

- **No image assets.** Everything is `ctx.fillRect`, `ctx.arc`, gradients, paths.
- **IIFE pattern**: each file is `(function(){ "use strict"; const G = window.G || (window.G = {}); ... })()`.
- **Helpers** in scope inside `scenes.js`: `f(size, weight?)` for fonts, `rr(ctx, x, y, w, h, r)` for rounded rects, `rectHit(rect, x, y)`, `clamp`, `dist`, `lerp`, `VIEW` ({w:1024, h:768}), `PI`.
- **Scene factory**: `makeRoom({ name, start:{x,y}, narr, drain, build(s), update(s,dt), drawProps(s,ctx), drawOver(s,ctx), bg(ctx,s), shouldMove(s) })`. Returns object registered via `G.addScene(name, scene)`.
- **State**: read/write `G.state.*`. Add new flags in `engine.js` `G.defaultState()`.
- **Exit zones**: `s.exitZone = { x, y, w, h, label, to | onExit(sc), ready() }`. The robot's center entering the rect fires it ONCE (`_fired` flag).
- **Interactables**: `s.interactables.push({ x, y, r, label, ready(sc), act(sc) })`. Shown as action button when robot within `r`.
- **Items printed by 3D printer** are bottom-anchored: `drawXItem(ctx, x, bottomY)`. The bottom sits at `bottomY`, item grows upward.

## Russian UI text uses emojis

The game has Russian UI with emojis like 🛰 ☀ ⚛ ⛏ 🛠 ⚔ 🔋 already in strings. Leave them as-is.

## Архитектура, SOLID и паттерны

Соблюдай SOLID и современные практики проектирования — **но прагматично, под стиль этого проекта** (canvas-игра на vanilla JS, без классов/модулей-сборки). Не тащи сюда тяжёлый enterprise-ООП: интерфейсы, DI-контейнеры, абстрактные фабрики ради фабрик. Цель — чистый, расширяемый код, а не церемония.

Как принципы ложатся на текущую архитектуру:

- **SRP (единственная ответственность)** — одна функция = одна задача. Рисование (`drawXItem`), логика (`update`), ввод (`onTap`) разделены. Не смешивай рендер и игровую логику в одной функции. Хелперы вроде `chipOre`, `drawOreVein` выносятся отдельно, а не инлайнятся в сцену.
- **OCP (открыт/закрыт)** — новые сцены добавляются через `makeRoom(...)` + `G.addScene(...)` без правки движка. Новые печатаемые предметы — через `drawPrintedItem`/`printItemHeight` switch, не дублируя логику принтера. Расширяй через данные/коллбэки, а не через копипаст.
- **LSP / ISP** — все сцены подчиняются единому контракту (`build/update/draw*`). Не добавляй сцене методы, которые движок не вызывает. Опциональные хуки (`drawOver`, `shouldMove`) проверяй на существование перед вызовом.
- **DIP (инверсия зависимостей)** — сцены зависят от абстракций движка (`G.fx`, `G.audio`, `G.go`), а не лезут в DOM/canvas напрямую. Звук/частицы/переходы — только через `G.*`, не дёргай `ctx`/`AudioContext` из игровой логики.

Применяемые паттерны (узнавай их и переиспользуй, не изобретай заново):
- **Factory** — `makeRoom`, `makeMutant`, `makeMiniCutscene`.
- **Registry** — `G.addScene` / `G.go` (реестр сцен по имени).
- **State machine** — сцены = состояния; босс с `attackKind`/`telegT`; робот с `punching`.
- **Strategy via data** — таблицы (`printItemHeight`, `printingLabel`, attack-choices) вместо длинных `if/else`.
- **Object pool / entity list** — массивы `stones`, `debris`, `pounds`, `mutants` с обратным циклом `for(i=len-1;i>=0;i--)` для безопасного удаления.

Анти-паттерны, которых избегать:
- **Magic numbers без имени** в новой логике — выноси в `const` с понятным именем (координаты разовых элементов рисования — ОК инлайном).
- **God-функции** > ~80 строк, делающие всё сразу — дроби.
- **Дублирование** трёх и более раз — выноси в хелпер (правило «третьего раза»).
- **Скрытое состояние** через глобалы помимо `G.state` / `s.data` — весь игровой стейт живёт там.

При рефакторинге **не ломай рабочий геймплей ради чистоты** — сначала корректность, потом красота. Крупные структурные изменения согласовывай с пользователем.

## Gotchas (Bugs Already Hit — Don't Repeat)

1. **Don't leave numeric state negative.** `if (!s.data.drillT)` is `false` when `drillT == -0.013`. Always reset to 0 on completion.
2. **Start positions must be outside exit zones.** Exit zones at `(b.x, b.y + b.h/2 - 48, 66, 96)`. Use `start: { x: 240, y: 410 }` for left-exit rooms (printer, sand, drill_site).
3. **Items in the 3D printer must be bottom-anchored**, not center-anchored. Clip from `platTop - itemH*plate` to `platTop`.
4. **Falling-tile hex grid**: use threshold `R * 1.02`, not `R * 0.88` — otherwise robot falls at hex vertices.
5. **After picking up blueprints**, cutscene routes to `drill_site` (mines), not back to the blueprint scene.
6. **Multi-stage base**: `hasBase` is only true once `hasBaseFrame && hasBaseSolar && hasBaseReactor`. Each part costs 1 super-mineral.
7. **Punch/sword `punching`** is a 0.3s countdown timer on the robot. Visual phases: 0–33% wind-up, 33–66% strike, 66–100% follow-through.
8. **Drill_site veins are data-driven** via `neededMineKinds()` + `ORE_KINDS` table (super/wonder/zcrystal). Don't hardcode `superMinerals += 1`; use `grantOre(kind)`.
9. **Printer print-jobs come from `printerJob()`** — single source for label/ready/act (was triple-duplicated). Add new items there + `printItemHeight`/`printingLabel`/`drawPrintedItem`.
10. **X-ray excavation (`xray_field`)**: tap Действие only when `meter` ∈ [0.40, 0.60] (green). Red zone damages `integrity`; 0 → soft reset (no hard fail). Artifact extracted at `cleared >= clumps`.
11. **Day/night cycle** advances only in `isRoom` scenes (set by `makeRoom`); menu/cutscenes are frozen & untinted. Overlay is drawn inside `makeRoom.draw` AFTER the world but BEFORE the HUD (so HUD stays readable). Night raises battery drain (`G.dayDrainFactor()`); `hasBase` trickle-charges in daylight. `G.dayCycle` resets to 0.42 (afternoon) on new game.
12. **Enemy kinds** via `MUTANT_KINDS` table: `grunt` (default chaff), `scout` (`harry`: hit-and-run dart-in/retreat), `brute` (`charge`: telegraph→straight lunge→wall-stun, red aim-arrow via `mu.chMode`/`chT`/`chAng`, NO contact dmg — dodge with dash, punish in recover), `drone` (`weave`: zig-zag approach), `spitter` (`ranged`+`lead`: leads the shot toward `G.moveDir()`), `burrower` (`burrow`), `frostling` (`frost`). `makeMutant(x,y,hp,kind)`. Behavior branches in `updateMutant` use the `handledMove` flag; charge/harry deal their own damage (suppressed in the generic contact block). Set `mu.goal = {x,y,r,hp}` for siege mode (marches to target, ignores robot) — siege branch returns early, bypassing these patterns. For arena-style hunting set `mu.blind=false` so they don't lapse to patrol.
    - **Distinct silhouettes** (`drawMutantBody(ctx, mu, K, asleep)`, dispatched by `mu.kind`): grunt=spiky blob, scout=sleek dart+fins, brute=horned armored ram, drone=floating orb+rotor+lens (hovers, no contact shadow), spitter=toad+acid sac, burrower=mole+digging claws, frostling=faceted ice crystal+crown+core. Bodies drawn in local coords (front=+x, base radius ~16, outer transform scales by `K.scale`). `drawMutant` handles shared shadow/damage-flash/HP-bar/stun/`!`/`z`/charge-telegraph.
    - **Per-kind animation**: drone banks (`ctx.rotate` sine), brute leans back on `chMode==='tele'` / forward on `'charge'` (else heavy-breath bob), spitter sac breathes + charge-swells, frostling core/eyes pulse, scout darty jitter.
    - **Themed death FX** (`mutantDeathFx(s, mu)` + `DEATH_FX` table): kind-colored multi-burst part-scatter + ring, called ONCE at the `makeRoom` splice chokepoint (not per kill-site; siege `noScrap` deaths skip it). drone=electric pop, frostling=ice-shatter chime. Kill-sites keep only shake/hit-stop.
    - **Elite variants** (`mu.elite`, `makeElite(mu)` post-promote): ×2.2 HP, ×1.32 size, +45% dmg (`eDmg = K.dmg*(elite?1.45:1)` threaded through all player-hurt sites in `updateMutant`), `_scrap=4`. Visual: gold pulsing aura + orbiting sparks + gold outline + crown + wider gold HP-bar (`drawMutant`). Bigger gold death burst + win-chime. Spawned ~45% in arena final wave, ~35% in late `base_defense` waves (`d.wave>=2`).
    - **Champion boss** (`champion` scene = 8th `challenges` slot, `drawChampion`, `s.data.boss`): «АЛЬФА-МУТАНТ», HP 22, always-hittable. State machine `idle`→`charge`(red aim-arrow telegraph→lunge→wall-stun, stunned = 2× punch)/`spit`(4 shots, 6 enraged, into `s.enemyShots`)/`summon`(2 adds, 1 elite when enraged)/`slam`(`s.champRings` shockwave). Enrage at ≤50% HP (red aura/eyes, faster). Defeat → +14 scrap + `awardUpgrade("challenges")` (guaranteed upgrade pick). Visual: big spiky warlord + bone crown + glowing red eyes.
35. **Difficulty levels** (`G.DIFFICULTY` table + `G.diff()`/`G.setDifficulty`/`G.cycleDifficulty` in engine): `easy`/`normal`/`hard`/`hardcore`. Stored in `G.difficulty` (separate from `G.state` so `resetState` keeps it; persisted to `localStorage` key `mars_difficulty`). Multipliers applied live: `eHp` (`makeMutant`), `eDmg` (`s.hurt` chokepoint), `drain`+`recharge` (`makeRoom.update`), `deathPenalty`+`floor` (`gameover`). Boss HP is fixed (not scaled) but boss damage scales via `s.hurt`. Menu has a `bDifficulty` cycle button (🟢🟡🟠🔴). Easy = kid mode (½ dmg, ¬death-penalty, floor 70).
36. **Personal touches** (this game is by/for Lev Popchenko, 6yo, whose story it's based on): pet drone `hasDrone` is `true` by default (was a dormant feature) → «Лев» follows from the start with a nameplate in `drawPetDrone`. Author credit «designed by Lev Popchenko · по сюжету Льва (6 лет)» on the `menu` (under title) and `final_victory` (above В меню). Don't remove these.
13. **`base_defense`** — optional wave-survival scene; reachable from a printer interactable while `hasBase && !printerUpgraded && nextUpgrade()`. 3 waves → reward (full charge + an upgrade; +1 super-mineral first clear).
14. **Robot upgrades** — `UPGRADES` table (`upgShield` −40% dmg, `upgSpeed` +25%, `upgBattery` −25% drain/×2.4 solar, `upgPunch` 2× hit + wider zone). Granted via `grantNextUpgrade(s)` on challenge completion. Effects applied in `moveRobot`/`hurt`/`punchZone`/drain + mutant punch dmg. HUD shows owned-badges strip.
15. **Pet drone** (`hasDrone`): `G.drone` {x,y} lerps after robot in `makeRoom.update`; `drawPetDrone` drawn AFTER day/night overlay so its light shows at night.
16. **Collectible logs** (`placeLog(s,id,x,y)` + `LOG_TEXTS`): generic `pickup`-flagged interactables rendered by `drawPickup` loop in `makeRoom.draw`. `G.state.logs`/`logIds`. Placed in surface/drill_site/sword_blueprint. `final_victory` text + rank vary by logs (0/1+/3).
17. **Challenges menu** (`challenges` scene from main menu, 2×3 grid) → standalone bonus scenes, each calls `finishChallenge(s)` → grants an upgrade; they don't `resetState` (run on current state):
    - `base_defense` — waves siege the reactor (`mu.goal`).
    - `sandstorm` — survive timer; sand-worm telegraph→erupt; wind push; vignette.
    - `arena` — 3 waves of all enemy kinds hunting robot (`mu.blind=false`).
    - `flooded_hall` — water (`waterTop`) rises; reach top exit; in-water = slow + drain. Barrier obstacles are drawn in `drawProps` (don't leave them invisible).
    - `mirror_hall` — laser puzzle; `traceBeam(d)` steps the grid, mirrors `'/'`/`'\\'` toggle via Действие; beam reaching receiver wins. Keep distractor mirrors OFF the solution path.
    - `sphinx` — boss: `mode` `riddle`↔`vulnerable`. Riddle answers are tap-buttons via `opt.onTap`; correct → vulnerable window (punch it, dodge eye-beams); `SPHINX_RIDDLES` table.
18. **Mars map** (`mars_map`, Fallout-2-style live overworld): once `hasBase`, printer's left exit routes here. **Rover travels** to taps (`travelTo`/`travel`); fog opens only along the rover's path via `mapExplored` beacons (`isExploredPt`, ~92px) — `hasScanner` does NOT clear fog, it only types ore on already-explored shafts; `artMapReveal` artifact reveals all. Shafts/artifacts hidden until their area is explored; artifacts never show their type (radar). Tapping a visible shaft → rover drives there → `drill_site`; base → `base_manage`; empty space → just explore. **Live attacks**: on `baseThreat` overflow a wave (`spawnQ`→`attackers`) marches to the base; turrets auto-fire (`turretBeams`), fence slows; cleared → "отбито" banner; if one reaches the base → `breakthrough()` → `base_defense` (robot fights). Attackers/beams drawn AFTER fog (radar-detected).
19. **Base fortress**: `baseReactorLvl` (1–3) is built in `base_manage` (super-minerals). `baseTurrets` (0–3) and `baseFence` (0–2) are **printed at the real 3D-printer** via the "Цех обороны" interactable (`defenseFabJob()`): needs the found blueprint (`hasTurretBlueprint`/`hasFenceBlueprint`, `_tech` pickups in `drill_site`) + 1 super each; **fence first needs `printerTier`≥1** (print "Апгрейд ПРИНТЕРА" for 2 super). `base_manage` turret/fence cards are `info:true` (status-only, no build button). `baseDefensePower()` = turrets×2+fence; turrets/fence assist in `base_defense` and on the live map.
22. **Artifact trials** (`artifact_trial` scene): reaching a map artifact launches a procedural mini-game (`ar.trial`): `lock` (stop 3 rotating rings at the top marker), `memory` (Simon sequence), `guard` (tap incoming drones before they drain core stability). On success → `A.grant(null)` + `ar.collected=true` → back to `mars_map`. `_activeArtifact` indexes `mapArtifacts`.
20. **Attacks**: entering `mars_map` raises `baseThreat`; on overflow, if `baseDefensePower() >= threat` turrets auto-repel (banner), else `attackAlert` → "⚔ Защитить базу" → `base_defense` with `G.state._baseAttack=true` (shorter waves, exit → `mars_map`, no upgrade reward; turrets/fence assist the robot). Challenge-mode `base_defense` (from `challenges`) keeps upgrade reward + exit → `printer`.
21. **Map artifacts** (`G.state.mapArtifacts`, 3 random from `ARTIFACTS` table): glowing "✦ АНОМАЛИЯ" relics that pierce the fog; reaching one launches `artifact_trial`. `artMapReveal` acts like the scanner for shaft/fog reveal (use the `reveal = scan || artMapReveal` local).
23. **Map weather + events** (rolled in `mars_map.enter` when `hasBase`, mutually exclusive with attacks): `weather` (dust/lightning storm overlay) docks `G.state.baseHP` (repair in `base_manage` `repair` card for 1 super; damaged base = weaker solar trickle, see `makeRoom` drain). `G.state.mapEvent` = `{kind:'meteor'|'distress', x, y}` — drive the rover onto it to collect (meteor=+2 super, distress=+1 super +25 HP). Base HP bar shown under the map base; banner danger-color matches `/НАПАДЕНИЕ|прорв|БУРЯ|ШТОРМ/`.
24. **Combat juice** (engine): `G.shake(amt)` (global screen-shake, decays in the frame loop, wraps the whole scene draw), `G.hitStop(sec)` (freezes sim+`G.time` for a few frames — fade still runs on real dt), `G.fx.ring(x,y,color,maxR,life)` (expanding shockwave). Wired into `s.hurt`, punch-hits, enemy deaths, boss slams. Don't stack huge values — amounts are 5–14.
25. **Procedural music** (`G.music`, engine): a step-sequencer over WebAudio. Moods `calm`/`mystery`/`tense`/`triumph` in `MUSIC_MOODS`; `SCENE_MOOD` maps scene-name→mood (default `calm`). `swap()` calls `G.music.setScene(name)`; `G.audio.resume()` starts it (needs a user gesture). Sound toggle stops/starts it. `G.music.tick()` runs each frame to schedule notes ahead.
26. **Consumables/crafting**: enemies drop `G.state.scrap` (⚙) on death (`dropScrap`, skipped for siege `noScrap` kills). `CONSUMABLES` table (`medkit`/`emp`/`mine`) crafted in the `workbench` scene (reached from a printer interactable) via `craftConsumable`; used in-room via the right-edge bar (`drawConsumablesBar`→`s._consBtns`, handled in `makeRoom.onTap`)→`useConsumable`. EMP stuns all mutants (`mu.stun`) + force-surfaces burrowers; mine = `s.mines` entity (`updateMines`/`drawMines`); medkit = +42 battery. State: `scrap`, `cons:{medkit,emp,mine}`.
27. **New enemy kinds** (`MUTANT_KINDS`): `spitter` (ranged — kites + fires acid into `s.enemyShots`, `updateEnemyShots`/`drawEnemyShots`; never melees), `burrower` (`mu.buried` state — invulnerable underground mound, surfaces near robot to erupt). Both wired into `arena` waves. Enemy projectiles + mines live on the scene (`s.enemyShots`/`s.mines`, reset in `makeRoom.enter`, ticked/drawn in `makeRoom`).
28. **Shaft mini-boss** (`shaft_boss` challenge, 7th slot in the 2×4 `challenges` grid): `s.data.mb` state machine `idle`→`spit`/`burrow`/`summon`; invulnerable while `mb.buried`; punch it when surfaced. Defeat → +8 scrap + `finishChallenge` (upgrade). `drawShaftBoss`.
29. **Ice biome (Chapter 2)**: `makeRoom` `opt.ice` → `moveRobot` switches to momentum/friction sliding (`robot.ivx/ivy`); reset `ivx/ivy` in `build`. `frostling` enemy kind (`K.frost` → ice-crown in `drawMutant`). Helpers: `auroraSky`, `iceField`, `iceMoonBg`-style cave bg, `drawCryoCore`, `coldOverlay`. `ice_surface`/`ice_cave` are bright-on-purpose — keep cave palette light (day/night overlay is near-zero at `dayCycle 0.42`, so darkness must come only from the bg, not be relied on). Cryo cores are interactables WITHOUT `pickup:true` (drawn by `drawCryoCore` in `drawProps`, not the generic `drawPickup`). Ice rooms put their exit at the **bottom**-right to avoid the right-edge consumables bar.
    - **Heat vents** (`s.data.vents=[{x,y,r}]`, `updateHeatVents`/`drawHeatVent`): standing within `r*0.8` sets `s.data.warming`, recharges battery +2.2/s and thaws freeze. Show "🔥 Грею батарею…" via `iceStatusBar`.
    - **Freeze** (`robot.frozen` timer): set by the boss's breath; `moveRobot` skips movement and `_tryInteract` is blocked while >0; `drawFrozenShell` overlay; reset in `makeRoom.enter`; cleared by heat vents.
    - **Морозный Страж** (`ice_boss`, `s.data.boss`, `drawIceBoss`): always hittable at the chest **core** weak-point; modes `idle`→`shards`/`breath`/`slam`/`summon` (breath unlocks at ≤50% HP = enrage); `bs.swingT` whip on arms. Defeat sets `iceBossDefeated`+`hasGuardianCore`+`hasJumpDrive`. Shards/slam-ring live on `s.data.shards` (ring entries have `.ring`).
    - **Lore**: `ICE_LOG_TEXTS`/`placeIceLog`/`drawIceLog`, ids `ice1`(surface)/`ice2`(cave)/`ice3`(boss), `G.state.iceLogs` + `_iceLog_<id>` flags.
    - **Ice cleats upgrade** (`upgIceCleats`): frozen crate pickup early in `ice_surface` (`_icecrate`/`drawIceCrate`). When owned: `moveRobot` skips the slippery-inertia branch on ice (direct grippy control, only a fast-decaying wind drift) + ice cold drain ×0.7 + wind gusts ×0.35. `G.drawRobot` draws white studs on the wheels when `G.state.upgIceCleats`. HUD badge `❄` (+ `🧊N` ice-logs counter) in the `drawHUD` badge strip. NOT in the `UPGRADES` table (so challenges don't grant it).
    - **Ice slam** (`iceSlam(s)`, bonus of `upgIceCleats`): punching on an `ice` scene fires a frost shockwave — stuns (1.3s) + 1 dmg + knockback to mutants within R=134, force-surfaces burrowers, interrupts a nearby boss telegraph. Cooldown `s.data._slamCd` (1.6s, ticked in `makeRoom.update`); fired in `_tryInteract`.
30. **`noBaseCharge` (balance, important)**: once `hasBase` is built, `makeRoom.update` trickle-charges the battery in daylight (+1.6/s) — this is bigger than most drains, so it **silently cancels any room's drain mechanic** (the ice "cold" did nothing until fixed). Set `opt.noBaseCharge:true` on rooms where the base is out of reach (ice scenes) so the drain actually bites. When adding a survival/drain room post-base, decide whether the trickle should apply. `ice_surface` grants a one-time starter kit (battery floor 80 + 2 medkits + 6 scrap) via `_iceStarted` so the player can engage crafting on arrival.
31. **Tuned combat values** (current): punch = 1 dmg (2 with `upgPunch`); enemy HP grunt2/scout1/brute4/drone1/spitter2/burrower3/frostling2; mini-boss `shaft_boss` 12, coliseum boss tied to `bs.hp`. Consumable costs (scrap ⚙): medkit 2, mine 4, EMP 5; effects medkit +42 batt, mine 3 dmg AoE, EMP stun-all +1 dmg. Scrap drop = 1/kill (mini-boss +8, summon-adds 1). Ice cold drain ≈ −0.4/s idle, −0.8/s moving (with `noBaseCharge`).
32. **Dash/dodge** (`robot.dashT`/`dashCd`/`dashDX/DY`/`_dashTrail`): `_tryDash`/`onDash` in `makeRoom`; Shift key (engine keydown) or the bottom-right `drawDashButton`. 0.18s burst at 3.6× speed in move-dir (or facing if idle), grants `_invuln` i-frames (true dodge), 0.85s cooldown shown as an arc. `moveRobot` has a dash branch (before normal movement); `drawDashTrail` ghosts. Reset in `makeRoom.enter`.
33. **Real stakes + score-attack** (balance): base solar trickle cut to +0.7/s (1.2 with `upgBattery`) so battery stays a resource (consumables matter). `gameover` now costs **−2 days + half scrap + `deaths++`**, emergency recharge to 48% (`_counted` guard, reset in `exit()`). `final_victory` shows a **score** = `(100−day)*10 + logs*60 + (3−deaths)*80 − deaths*40` with a ★ tier. Day stays a real currency (deaths push it up; cap 100).
34. **Upgrade choice** (`upgrade_pick` scene + `awardUpgrade(returnScene)`): challenge/`base_defense` rewards route here instead of forced-order `grantNextUpgrade`. Player picks ONE of the un-owned `UPGRADES` (cards with synergy hints); grant → `G.go(_upgReturn)`. `drill_site` now spawns **3 veins/visit** (`neededMineKinds().slice(0,3)`) to cut printer round-trips. Onboarding: first-entry wrapped banner on `mars_map` (`_tutMap`), helper line in `base_manage`; the map `banner` renderer now wraps long text.

## Save & day counter

- **Autosave** (`G.saveGame`/`loadGame`/`hasSave`/`clearSave`, `localStorage` key `mars_save_v1`): saves `{state, dayCycle, room: G._lastRoom}` on every `swap()` except `menu`/`gameover`/`final_victory`/`victory`. Menu shows "▶ Продолжить" → `loadGame()` → resume at saved room; "Новая игра" → `resetState()+clearSave()`. Victory screens `clearSave()`. `loadGame` merges into `defaultState()` so new state fields don't break old saves.
- **Day counter** must stay ≤100. Post-base `dayValue`s are large (102–142); `swap()` compresses `dayValue>84` via `84 + (dv-84)*0.25` then clamps to 100. Keep new late scenes' `dayValue` in this scheme (don't display raw >100).

## Game Flow (for routing logic)

1. `menu` → `cutscene` → `surface` → `tomb_entrance`
2. Traps: `arrows` → `falling_tiles` (hex grid) → `mummies` → `scarab`
3. Minerals: `mineral1` → `mineral2` → `mineral3` (3 minerals total) → `printer`
4. Print shovel → `sand` → blueprint → `printer` → drill → `cutscene_drill` → `printer`
5. `base_blueprint` → `cutscene_base_blueprint` → `drill_site` (multi-tap chisel, 2 ore veins)
6. Print 3 base parts: frame (module) → solar → reactor → `cutscene_base` → `printer`
7. `sword_blueprint` → mine more → print sword → `coliseum` (boss)
8. Boss defeat → drops scanner blueprint → `cutscene_scanner_blueprint` → `drill_site`
9. Mine 2 super + 2 чудо + 1 Z-кристалл (typed veins) → print scanner → `cutscene_scanner` → `xray_field`
10. `xray_field`: x-ray overlay + brush-timing minigame (бить в зелёной зоне) → `cutscene_artifact` (sets `printerUpgraded`)
11. Ship assembly (multi-stage, like base): print `hull` → `wings` → `engine` (1 super each) at upgraded printer
12. Mine `fuel` ×2 + `navchip` ×2 (typed veins) in `drill_site`
13. When ship built + fuel≥2 + maps≥2 → launch interactable at ship pad (`shipReadyToLaunch()`) → `cutscene_launch` (blastoff) → **Chapter 2 (ice moon)**
14. **Chapter 2 — ледяная луна (полноценная глава)**: `cutscene_ice_arrival` → `ice_surface` (collect 3 крио-ядра `iceCores`, heat vents, lore log `ice1`) → `ice_blizzard` (whiteout traversal: visibility bubble around robot, driving snow, wind push, erupting ice spikes; heat vents = respite) → `ice_cave` (chisel the `hasFrostCrystal` vein N taps, log `ice2`) → `cutscene_ice_guardian` → `ice_boss` (Морозный Страж, log `ice3`) → `cutscene_ice_victory` → `final_victory`. Objective chain: 3 cores + frost crystal + guardian core = assembled `hasJumpDrive`. Ending uses `iceLogs` (0–3) for story/rank variants. dayValues progress 99→140 (compress to day 88→98).

## Animations & cutscenes (recently reworked)

- **Robot sword (`drawRobotSword`)** & **bare-fist punch (`drawPunchArm`)** are ARTICULATED: arm rotates around a shoulder joint (`sx,sy` on the body), forearm + gripper-hand move WITH the blade/fist through the 3 swing phases (`robot.punching` 0.3s). Don't draw a static blade — keep the shoulder/forearm synced to the angle.
- **Boss arms (`drawBoss`/`drawBossArm`)**: `bs.telegT` raises the arm during wind-up; the new `bs.swingT` (0.3s, set at launch) drives the FOLLOW-THROUGH whip (stones=down-forward, pound=slam-down, walls=cast-out). Decrement `swingT` in update; the arm-angle block reads it via `sw = 1 - bs.swingT/0.3`.
- **Sphinx (`drawSphinx`)**: head lunges + front paw swipes + eyes flare when a beam charges/fires (computed from `b.beams` `tele`/`life`).
- **New cutscenes**: `cutscene_launch` (ship blastoff, routes from launch interactable → `final_victory`) and `cutscene_mars_intro` (first overworld reveal, plays once via `G.state._sawMapIntro`, routes printer-exit → `mars_map`). Both via `makeMiniCutscene`.

## Token-Saving Rules

### Reading files
- `scenes.js` is huge. **Always pass `offset` + `limit` to `Read`.** Use `grep -n` via `Bash` to find line numbers first.
- Don't re-Read a file you just edited — Edit/Write would have erred if it failed.

### Verifying changes
- Prefer `mcp__Claude_Preview__preview_eval` returning structured JSON over `preview_screenshot`. Screenshots cost ~1500 image tokens each.
- **Skip screenshots when verifying state changes** (interactable.ready, scene transitions, counters). Only screenshot for visual/layout work (new icons, animations, UI alignment).
- Use eval to simulate user actions: `s.interactables[0].act(s); for (let i=0;i<150;i++) s.update(0.016)` — much cheaper than driving the browser.
- Preview server persists between turns. Always `preview_list` before `preview_start`.

### Editing
- Use `Edit` (string-replace) for changes ≤ ~50 lines. Use `Write` only for new files or full rewrites.
- Group related changes into one `Edit` call when the strings are unique enough.
- When adding helper functions, place them AFTER the scene that uses them but BEFORE `G.addScene` of unrelated scenes — keeps related code adjacent.

### Searching
- `grep -n "pattern" js/scenes.js | head -N` is fast and cheap. Use this before reading.
- Don't `cat`/`head`/`tail`/`sed` — always Read with offset.

### Debugging the game
- Game loop pauses when browser tab is hidden (rAF throttling). If state doesn't change during eval testing, run `s.update(dt)` manually in a loop.
- Mutants can be cleared with `s.mutants.length = 0` to test post-combat states.
- Skip cutscenes by setting state flags directly + `G.go('printer', true)`.
- Boss states: set `bs.hp`, `bs.armsLeft`, `bs.armsRight`, `bs.telegT`, `bs.attackKind` to test phases.

## Launching

```bash
cd /Users/matveypopchenko/IdeaProjects/Mars
python3 -m http.server 8123
# open http://localhost:8123
```

Or via Claude Code's `preview_start` with name `mars-game` (already in `.claude/launch.json`).

## PWA / iPad

The game is an installable offline PWA: `manifest.webmanifest`, `sw.js` (network-first cache, falls back to cache offline; uses `ignoreSearch` so the `?t=` cache-buster doesn't break it), and `icons/` (generated procedurally from `G.drawRobot` — do NOT hand-edit; regenerate via canvas `toDataURL` + `sips` downscale).

- **Service worker registers only in a secure context** (HTTPS or `localhost`). On a Mac LAN IP (`http://192.168…`) it will NOT register on the iPad → no offline. HTTPS hosting (e.g. GitHub Pages / Netlify) is required for offline on iPad.
- All paths are relative (`./`, `js/…`, `icons/…`) so it works under a GitHub Pages subpath.
- `.nojekyll` is present for GitHub Pages.
- On iPad: open the HTTPS URL in Safari → Share → «На экран Домой» → launches fullscreen (landscape), works offline after first load.

## Style preferences

- **No new docs** unless requested. No `README.md`. No `.md` files except this one.
- Comments in code: Russian or English, short, only when intent isn't obvious from names.
- Don't add tests. This is a hobby project.
- Don't run `git commit` unless explicitly asked.
