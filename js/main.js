/* Точка входа: настройка холста, масштабирование под экран, запуск игры */
(function () {
  "use strict";
  const G = window.G;
  const canvas = (G.canvas = document.getElementById("game"));
  const ctx = (G.ctx = canvas.getContext("2d"));

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ww = window.innerWidth, wh = window.innerHeight;
    const scale = Math.min(ww / G.VIEW.w, wh / G.VIEW.h);
    const cssW = Math.round(G.VIEW.w * scale);
    const cssH = Math.round(G.VIEW.h * scale);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(G.VIEW.w * dpr);
    canvas.height = Math.round(G.VIEW.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // рисуем в логических координатах 1024x768
    ctx.imageSmoothingEnabled = true;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  resize();

  G.initInput();
  G.go("menu", true);
  G.startLoop();
})();
