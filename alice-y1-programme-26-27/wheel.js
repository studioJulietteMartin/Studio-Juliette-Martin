(() => {
  'use strict';

  /* ==================================================================
     1. MEASURED OFF THE SHEET  --  only change if you replace the image
     ================================================================== */

  // The dial's centre inside the image, as an offset from the middle of
  // the image, in fractions of its width. The sheet is 4079 x 4079 but
  // the hub sits at (2034.2, 2057.2) -- about 18px low and 5px left.
  const HUB_FX = -0.0012993;
  const HUB_FY =  0.0043393;

  // The 52 printed radial rules, in degrees clockwise from twelve
  // o'clock on the dial. Every 6.9224deg starting at 0.022deg; no
  // printed line is more than 0.15deg off this.
  const STEP = 6.92240;
  const OFFSET = 0.0218;
  const WEEK  = Array.from({ length: 52 }, (_, i) => (OFFSET + i * STEP) % 360);

  // The subset drawn thick: the month boundaries.
  const MONTH = [0, 4, 8, 12, 17, 21, 25, 28, 31, 36, 40, 44, 48].map(i => WEEK[i]);

  const SNAP_TO = WEEK;              // <-- swap to MONTH for coarser stops


  /* ==================================================================
     2. THE THREE VIEWS  --  this is the block to tune
     ================================================================== */

  // The only zoom levels there are. Everything snaps to one of these.
  const ZOOM_STEPS = [1, 1.33, 1.66];

  /*  start      the zoom this view opens at; snapped to a ZOOM_STEP.

      focus      WHAT the view is built around: a radius on the dial, as
                 a fraction of the dial's radius. That ring is held at
                 the middle of the window at every zoom, so zooming
                 always closes in on it rather than drifting.

                   0.13  the outer edge of the hub ring
                   0.49  keeps the hub itself on the edge of the window
                   0.48 - 0.73   the week grid with the dates
                   0.75 - 0.95   the given / output briefs

                 Raise it to lift the framing outwards towards the rim,
                 lower it to drop back in towards the hub. Whatever it
                 asks for is capped by blank, below.

      blank      how much bare paper is allowed past the rim, as a
                 fraction of the window. 0 fills the window edge to
                 edge; 0.10 leaves a tenth of it as margin.

                 The cap bites when focus asks to go further out than
                 blank permits, and then blank alone sets the framing --
                 which is what the side views do, so their margin stays
                 the same tenth at every zoom step. On the bottom view
                 focus is well inside the cap and governs on its own.

      home       which of the 52 printed rules parks under the hand the
                 first time you open this view, as an index 0-51 counted
                 clockwise from twelve o'clock.

                   13   mid April, the middle of the spring semester
                   31   early September, the start of the year
                   39   late October, the middle of the autumn semester

      range      how far the hand may travel, as first and last rule
                 index. The side views are held inside their own
                 semester; null lets the view turn all the way round.

                   [6, 23]   22.02.27 to 07.06.27, spring
                   [30, 48]  04.09.26 to 17.12.26, autumn

      Press D for a crosshair on the point the view is built around.
  */
  const VIEW = {
    // The whole year, free to turn.
    bottom: { start: 1,    focus: 0.52, blank: 0.05, home: 31, range: null },

    // Spring semester, held to it.
    left:   { start: 1.66, focus: 0.85, blank: 0.10, home: 13, range: [6, 23] },

    // Autumn semester, held to it.
    right:  { start: 1.66, focus: 0.85, blank: 0.10, home: 39, range: [30, 48] }
  };


  /* ================================================================== */

  const stage   = document.getElementById('stage');
  const pan     = document.getElementById('pan');
  const zoomEl  = document.getElementById('zoom');
  const disc    = document.getElementById('disc');
  const hand    = document.getElementById('hand');
  const readout = document.getElementById('zoom-level');
  const hint    = document.getElementById('hint');

  // Unit vector each hand points along. 0deg = right, 90deg = down.
  const HAND = {
    bottom: { deg: -90, x:  0, y: -1 },
    right:  { deg: 180, x: -1, y:  0 },
    left:   { deg:   0, x:  1, y:  0 }
  };

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    anchor: 'bottom',
    rotation: 0,
    zoom: 1,
    zoomTarget: 1,
    radial: 0,
    debug: false
  };

  // Where each view was left, so switching back returns you to it.
  const memo = {};

  const view = () => VIEW[state.anchor];

  /* ------------------------------------------------------------------
     Geometry

     The hub is parked outside the window, on the midline of whichever
     edge it is anchored to, and can only ever slide further out along
     the hand. It never crosses into the window, so the far side of the
     dial is never exposed.

     How far out it sits follows from the focus ring: put that ring in
     the middle of the window and the hub lands wherever it lands.
  ------------------------------------------------------------------ */

  const depth = () => (state.anchor === 'bottom' ? innerHeight : innerWidth);
  const baseDiameter = () => depth() * 2 * 1.02;

  // The edge midpoint the hub is anchored to.
  function edgePoint() {
    if (state.anchor === 'bottom') return { x: innerWidth / 2, y: innerHeight };
    if (state.anchor === 'right')  return { x: innerWidth,     y: innerHeight / 2 };
    return { x: 0, y: innerHeight / 2 };
  }

  /*  How far beyond the edge the hub sits, for a given zoom.

      Two hard limits, either side of what focus asks for:
        0        the hub never comes inside the window, so the far side
                 of the dial is never exposed;
        outMax   the rim never comes inside the window either, so the
                 sheet's blank paper never shows.

      outMax is what the rim reaching the far edge implies:
        1.02 * depth * z  -  out  >=  depth
      which caps the useful focus at 0.510 at 100%, 0.631 at 133% and
      0.705 at 166%. Ask for more than that and you just get clamped.  */
  const ceiling = z => depth() * (1.02 * z - 1 + view().blank);
  const outMax = () => ceiling(state.zoom);

  function hubOffset(z) {
    const wanted = view().focus * 1.02 * depth() * z - depth() / 2;
    const base = Math.min(Math.max(0, wanted), ceiling(z));
    // Dragging along the hand may push further out, to reach the essays
    // printed in the sheet's corners.
    return Math.min(base + state.radial, ceiling(z) + depth() * 0.25);
  }

  function pivot() {
    const e = edgePoint(), d = HAND[state.anchor], out = hubOffset(state.zoom);
    return { x: e.x - d.x * out, y: e.y - d.y * out };
  }

  // Middle of the window, along the hand: where the focus ring lands.
  function focusPoint() {
    const e = edgePoint(), d = HAND[state.anchor], f = depth() / 2;
    return { x: e.x + d.x * f, y: e.y + d.y * f };
  }

  function clampRadial() {
    const wanted = view().focus * 1.02 * depth() * state.zoom - depth() / 2;
    const base = Math.min(Math.max(0, wanted), outMax());
    // Between the hub reaching the window and the rim clearing it,
    // plus a little slack outwards for the corner essays.
    state.radial = Math.min(outMax() - base + depth() * 0.25,
                            Math.max(-base, state.radial));
  }

  const LO = ZOOM_STEPS[0], HI = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const clampZoom = z => Math.max(LO, Math.min(HI, z));
  const nearestStep = z =>
    ZOOM_STEPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  const stepIndex = z => ZOOM_STEPS.indexOf(nearestStep(z));

  // The rotation that parks this view's home rule under the hand.
  const homeRotation = () => handClock() - WEEK[view().home];

  function layout() {
    const D = baseDiameter();
    disc.style.width  = D + 'px';
    disc.style.height = D + 'px';
    disc.style.transformOrigin = (50 + HUB_FX * 100) + '% ' + (50 + HUB_FY * 100) + '%';
    hand.style.width = Math.hypot(innerWidth, innerHeight) * 1.6 + 'px';
    hand.style.transform = 'rotate(' + HAND[state.anchor].deg + 'deg)';
    render();
  }

  // Keep the hand inside this view's stretch of the year.
  function clampRotation() {
    const rg = view().range;
    if (!rg) return;
    const hi = handClock() - WEEK[rg[1]];      // furthest clockwise
    const lo = handClock() - WEEK[rg[0]];      // furthest anticlockwise
    const mid = (lo + hi) / 2;
    const r = mid + ((((state.rotation - mid) % 360) + 540) % 360) - 180;
    const clamped = Math.min(lo, Math.max(hi, r));
    if (clamped !== state.rotation) velocity = 0;
    state.rotation = clamped;
  }

  function render() {
    clampRadial();
    clampRotation();
    const p = pivot();
    pan.style.transform    = 'translate(' + p.x + 'px, ' + p.y + 'px)';
    zoomEl.style.transform = 'scale(' + state.zoom + ')';
    disc.style.transform   =
      'translate(' + -(50 + HUB_FX * 100) + '%, ' + -(50 + HUB_FY * 100) + '%) ' +
      'rotate(' + state.rotation + 'deg)';
    readout.value = Math.round(state.zoomTarget * 100);
    if (state.debug) drawMarker();
  }

  /* ---------- snapping ---------- */

  // Where the hand points, in degrees clockwise from twelve o'clock.
  function handClock() { return (HAND[state.anchor].deg + 90 + 360) % 360; }

  // Shortest turn that would bring a printed rule under the hand.
  function snapDelta() {
    const target = handClock();
    const rg = view().range;
    let best = 0, bestAbs = Infinity;
    for (let k = 0; k < SNAP_TO.length; k++) {
      if (rg && SNAP_TO === WEEK && (k < rg[0] || k > rg[1])) continue;
      const a = SNAP_TO[k];
      const d = ((target - a - state.rotation) % 360 + 540) % 360 - 180;
      if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; }
    }
    return best;
  }

  let snapFrame = null;

  function settle() {
    cancelSnap();
    const to = state.rotation + snapDelta();
    if (reduceMotion) { state.rotation = to; render(); return; }
    const step = () => {
      const gap = to - state.rotation;
      if (Math.abs(gap) < 0.01) {
        state.rotation = to;
        snapFrame = null;
        render();
        return;
      }
      state.rotation += gap * 0.22;
      render();
      snapFrame = requestAnimationFrame(step);
    };
    snapFrame = requestAnimationFrame(step);
  }

  function cancelSnap() {
    if (snapFrame) cancelAnimationFrame(snapFrame);
    snapFrame = null;
  }

  /* ---------- eased zoom ---------- */

  let zoomAnim = null;

  /*  A step is a jump, so it is tweened over a fixed time rather than
      chased frame by frame: that way it lands at the same speed on any
      display, and the sheet's slide outwards stays locked to it. The
      interpolation is geometric, so 100 -> 133 and 133 -> 166 feel like
      the same move even though the arithmetic gaps differ.  */
  function setZoom(next, immediate) {
    const to = clampZoom(next);

    if (immediate || reduceMotion) {
      if (zoomAnim) { cancelAnimationFrame(zoomAnim); zoomAnim = null; }
      state.zoom = state.zoomTarget = to;
      render();
      return;
    }
    if (Math.abs(to - state.zoomTarget) < 1e-4) return;

    state.zoomTarget = to;
    const from = state.zoom;
    const t0 = performance.now();
    const dur = 340;

    if (zoomAnim) cancelAnimationFrame(zoomAnim);
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      // easeInOutCubic: leaves and arrives without a snap at either end
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      state.zoom = from * Math.pow(to / from, e);
      render();
      if (p < 1) {
        zoomAnim = requestAnimationFrame(step);
      } else {
        state.zoom = to;
        zoomAnim = null;
        render();
      }
    };
    zoomAnim = requestAnimationFrame(step);
  }

  // Move n places along ZOOM_STEPS.
  function stepZoom(n) {
    const i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, stepIndex(state.zoomTarget) + n));
    setZoom(ZOOM_STEPS[i]);
  }

  /* ---------- pivot side ---------- */

  function remember() {
    memo[state.anchor] = {
      rotation: state.rotation,
      zoom: state.zoomTarget,
      radial: state.radial
    };
  }

  function setAnchor(next) {
    if (next === state.anchor) return;
    cancelSpin();
    cancelSnap();
    remember();

    state.anchor = next;
    velocity = 0;

    const was = memo[next];
    state.rotation = was ? was.rotation : homeRotation();
    state.radial   = was ? was.radial   : 0;
    setZoom(clampZoom(was ? was.zoom : view().start), true);

    document.querySelectorAll('.anchor').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.anchor === next)));
    layout();
    settle();
  }

  // Back to how this view opens.
  function reset() {
    cancelSpin();
    cancelSnap();
    state.rotation = homeRotation();
    state.radial = 0;
    velocity = 0;
    setZoom(view().start, true);
    settle();
  }

  /* ---------- pointers ---------- */

  const pointers = new Map();
  let mode = null;                 // 'rotate' | 'slide' | 'pinch'
  let lastAngle = 0;
  let lastPoint = { x: 0, y: 0 };
  let pinchDist = 0, pinchZoom = 1;
  let velocity = 0, lastMove = 0, spin = null;
  // How far the finger was from the hub. On the side views the hub sits
  // most of a screen-width off stage, so the same flick is worth far
  // fewer degrees than it is on the bottom -- the throw has to be judged
  // in pixels travelled, not in degrees turned, or the sides never roll.
  let dragRadius = 1;
  const DEG = Math.PI / 180;
  const pxPerFrame = () => Math.abs(velocity) * DEG * dragRadius;

  function angleTo(x, y) {
    const p = pivot();
    return Math.atan2(y - p.y, x - p.x) * 180 / Math.PI;
  }

  function centroid() {
    const pts = [...pointers.values()];
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length
    };
  }

  // Movement along the hand only; the hub can never leave its axis.
  function slideBy(dx, dy) {
    const d = HAND[state.anchor];
    state.radial -= dx * d.x + dy * d.y;
    render();
  }

  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('#controls')) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelSpin();
    cancelSnap();
    hideHint();

    if (pointers.size === 2) {
      const two = [...pointers.values()];
      pinchDist = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
      pinchZoom = state.zoomTarget;
      lastPoint = centroid();
      mode = 'pinch';
      stage.classList.remove('dragging');
      stage.classList.add('sliding');
      return;
    }

    const wantsSlide = e.shiftKey || e.button === 1 || e.button === 2;
    mode = wantsSlide ? 'slide' : 'rotate';
    stage.classList.add(wantsSlide ? 'sliding' : 'dragging');

    lastPoint = { x: e.clientX, y: e.clientY };
    if (!wantsSlide) lastAngle = angleTo(e.clientX, e.clientY);
    velocity = 0;
    lastMove = performance.now();
  });

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'pinch' && pointers.size === 2) {
      const two = [...pointers.values()];
      const dist = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
      const c = centroid();
      slideBy(c.x - lastPoint.x, c.y - lastPoint.y);
      lastPoint = c;
      if (pinchDist > 0) setZoom(pinchZoom * (dist / pinchDist), true);
      return;
    }

    if (mode === 'slide') {
      slideBy(e.clientX - lastPoint.x, e.clientY - lastPoint.y);
      lastPoint = { x: e.clientX, y: e.clientY };
      return;
    }

    if (mode === 'rotate') {
      const p = pivot();
      dragRadius = Math.max(60, Math.hypot(e.clientX - p.x, e.clientY - p.y));
      const a = angleTo(e.clientX, e.clientY);
      let delta = a - lastAngle;
      if (delta >  180) delta -= 360;
      if (delta < -180) delta += 360;
      lastAngle = a;
      state.rotation += delta;

      const now = performance.now();
      const dt = Math.max(1, now - lastMove);
      lastMove = now;
      velocity = velocity * 0.6 + (delta / dt) * 16 * 0.4;
      render();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);

    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      lastAngle = angleTo(p.x, p.y);
      lastPoint = { x: p.x, y: p.y };
      mode = 'rotate';
      stage.classList.remove('sliding');
      stage.classList.add('dragging');
      return;
    }
    if (pointers.size > 0) return;

    stage.classList.remove('dragging', 'sliding');
    if (mode === 'rotate') {
      if (!reduceMotion && pxPerFrame() >= 1.4) startSpin();
      else settle();
    }
    if (mode === 'pinch') setZoom(nearestStep(state.zoomTarget));
    mode = null;
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('contextmenu', e => e.preventDefault());

  function startSpin() {
    const step = () => {
      state.rotation += velocity;
      velocity *= 0.957;
      render();
      // Coast until the rim is crawling, again judged in pixels.
      if (pxPerFrame() > 0.35 && velocity !== 0) {
        spin = requestAnimationFrame(step);
      } else {
        spin = null;
        settle();
      }
    };
    spin = requestAnimationFrame(step);
  }

  function cancelSpin() {
    if (spin) cancelAnimationFrame(spin);
    spin = null;
  }

  /* ---------- focus crosshair, for tuning VIEW ---------- */

  let marker = null;

  function drawMarker() {
    if (!marker) {
      marker = document.createElement('div');
      marker.id = 'focus-marker';
      marker.innerHTML = '<span></span><span></span>';
      document.body.appendChild(marker);
    }
    const f = focusPoint();
    marker.style.left = f.x + 'px';
    marker.style.top  = f.y + 'px';
    marker.title = state.anchor + ' focus ' + view().focus;
  }

  function toggleDebug() {
    state.debug = !state.debug;
    if (!state.debug && marker) { marker.remove(); marker = null; }
    else render();
  }

  /* ---------- wheel, keys, buttons ---------- */

  // Scrolling walks the steps rather than sliding between them. The
  // accumulator stops a single trackpad flick running the whole range.
  let wheelAccum = 0, wheelLock = 0;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    cancelSpin();
    hideHint();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelAccum += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (Math.abs(wheelAccum) < 45) return;
    stepZoom(wheelAccum < 0 ? 1 : -1);
    wheelAccum = 0;
    wheelLock = now + 300;
  }, { passive: false });

  function toggleZoom() {
    setZoom(state.zoomTarget > (LO + HI) / 2 ? LO : HI);
  }

  stage.addEventListener('dblclick', toggleZoom);

  // dblclick does not fire reliably under touch-action:none, so detect
  // the double tap by hand.
  let lastTap = 0;
  stage.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch') return;
    const now = performance.now();
    if (now - lastTap < 320 && Math.abs(velocity) < 0.4) { toggleZoom(); lastTap = 0; }
    else lastTap = now;
  });

  // One press steps exactly one printed rule.
  function stepRule(dir) {
    cancelSpin();
    cancelSnap();
    state.rotation += snapDelta() + dir * STEP;
    render();
    settle();
  }

  addEventListener('keydown', e => {
    if (e.target.matches('button, a')) return;
    switch (e.key) {
      case 'ArrowLeft':  stepRule(-1); break;
      case 'ArrowRight': stepRule(1); break;
      case 'ArrowUp':    slideBy(0, -14); break;
      case 'ArrowDown':  slideBy(0,  14); break;
      case '+': case '=': stepZoom(1); break;
      case '-': case '_': stepZoom(-1); break;
      case '1': setAnchor('left'); break;
      case '2': setAnchor('bottom'); break;
      case '3': setAnchor('right'); break;
      case 'd': case 'D': toggleDebug(); break;
      case '0': reset(); break;
      default: return;
    }
    e.preventDefault();
    hideHint();
  });

  /* ---------- the programme PDF, both sheets at once ---------- */

  const pdfBtn = document.getElementById('pdf');
  pdfBtn.addEventListener('click', () => {
    const files = pdfBtn.dataset.pdf.split(',');
    files.forEach((file, i) => {
      // Browsers throttle downloads fired in the same tick, so they are
      // spaced out; without the gap most of them keep only the first.
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = file.trim();
        a.download = file.trim().split('/').pop();
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 600);
    });
  });

  document.querySelectorAll('.anchor').forEach(b =>
    b.addEventListener('click', () => setAnchor(b.dataset.anchor)));
  document.getElementById('zoom-in').addEventListener('click', () => stepZoom(1));
  document.getElementById('zoom-out').addEventListener('click', () => stepZoom(-1));

  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() {
    clearTimeout(hintTimer);
    hint.classList.add('gone');
  }

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); settle(); }, 80);
  }
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);
  // Mobile browsers change the viewport when the toolbars slide away.
  if (window.visualViewport) visualViewport.addEventListener('resize', onResize);

  document.querySelector('.anchor[data-anchor="bottom"]').setAttribute('aria-pressed', 'true');
  state.rotation = homeRotation();
  state.zoom = state.zoomTarget = clampZoom(view().start);
  layout();
  settle();
  if (!disc.complete) disc.addEventListener('load', () => { layout(); settle(); }, { once: true });
})();
