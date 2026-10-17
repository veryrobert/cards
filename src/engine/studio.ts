// @ts-nocheck
// Card renderer, ported as-is from the Card studio artifact. It's a tuned,
// imperative three.js engine, so it stays plain JS behind a small API;
// the React UI only calls the methods returned by createStudio().
import * as THREE from 'three'
import type { Options } from './options'
import { drawArt, type Art } from './art'

// Where things sit on a face, in centimetres, for the artwork guides
export type Zone = { label: string; x: number; y: number; w: number; h: number }
export type Guides = { w: number; h: number; r: number; safe: number; px: [number, number]; zones: Zone[] }

type LayoutCard = { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number; back?: boolean; alt?: boolean }

export type Studio = {
  set(patch: Partial<Options>): void
  setImage(slot: 'mark' | 'issuer', img: HTMLImageElement | null): void
  setFlipped(flipped: boolean): void
  // Space a panel covers, so the card is framed in what's left: right on desktop, bottom on phones
  setViewInset(inset: { right?: number; bottom?: number }): void
  resetView(): void
  setArt(face: 'front' | 'back', art: Art | null): void
  refreshText(): void // redraw after a typeface has been registered
  guides(face: 'front' | 'back'): Guides
  exportImage(fmt: 'png' | 'jpg', size: Options['exportSize'], background: Options['exportBg']): Promise<Blob | null>
  recordVideo(opts: { seconds: number; motion: 'spin' | 'drift' | 'both'; onProgress?: (seconds: number) => void }): Promise<{ blob: Blob; ext: 'mp4' | 'webm' } | null>
  layouts: { id: string; name: string; cards: LayoutCard[] }[]
  dispose(): void
}

export function createStudio(
  canvas: HTMLCanvasElement,
  initial: Partial<Options> = {},
  onChange: (patch: Partial<Options>) => void = () => {},
): Studio {
  // ---------- State ----------
  const state = {
    orient: 'v', layout: 'single', chipColor: 'gold', chipPattern: 'classic', exportSize: '4k', exportBg: 'include', zoom: 1, spin: false, amount: 1, speed: 1, turn: 0, tilt: -0.15, rollBase: -0.3, color2: '#141416', mood: 'studio', keyDir: 'left', bright: 1, expo: 1, bg: '#000000', shadow: true, material: 'brushed', color: '#c8cfdb', sparkle: 'off', edge: 'match', nameText: 'Cardholder Name', name: 'back', holo: 'none',
    markPos: 'br', markStyle: 'standard', ident: 'none', identText: '',
    issuerText: '', fAccount: 'none', contactless: true,
    stripe: 'standard', stripeColor: '#2b2f45', sig: true, cvv: 'panel', bAccount: 'none', service: true,
    shadowStrength: 0.22, shadowBlur: 4, shadowDist: 6.8, drift: false
  };
  Object.assign(state, initial);
  let markImg = null, issuerImg = null;
  const art = { front: null, back: null };   // full-face artwork, printed over the base

  // Multi-card compositions. x and y in units of the card's long side, z in cm.
  // back: shows the reverse; alt: uses the second card colour.
  const LAYOUTS = [
    { id: 'single',   name: 'Single',   cards: [{ x: 0, y: 0, z: 0 }] },
    // Front and back side by side, square to the camera: no tilt, roll or drift. Positions come from the
    // card's real size (see frame and resize); x here only draws the layout button's glyph
    { id: 'flat',     name: 'Flat',     flat: true, cards: [{ x: -0.55, y: 0, z: 0 }, { x: 0.55, y: 0, z: 0, back: true }] },
    { id: 'diagonal', name: 'Diagonal', cards: [{ x: -0.3, y: 0.2, z: 0, rz: -0.3 }, { x: 0.32, y: -0.22, z: -3.2, rz: -0.15, ry: 0.12, alt: true }] },
    { id: 'layers',   name: 'Layers',   cards: [{ x: -0.22, y: 0.06, z: 0, ry: -0.45, rx: -0.1 }, { x: 0.3, y: -0.08, z: -3.4, ry: -0.45, rx: -0.1, back: true }] },
    { id: 'hinge',    name: 'Hinge',    cards: [{ x: -0.32, y: 0.04, z: 0, ry: 0.4, rz: -0.05 }, { x: 0.36, y: -0.04, z: -2.4, ry: -0.55, rz: 0.05, back: true }] },
    { id: 'stack',    name: 'Stack',    cards: [{ x: 0.05, y: 0.24, z: 0, rz: -0.08, rx: -0.25 }, { x: -0.1, y: -0.26, z: -3.2, rz: -0.4, rx: -0.15, alt: true }] },
    { id: 'fan',      name: 'Fan',      cards: [{ x: -0.3, y: 0.02, z: -2.8, rz: 0.2, alt: true }, { x: 0.3, y: -0.04, z: 0, rz: -0.12 }] },
    { id: 'cascade',  name: 'Cascade',  cards: [{ x: 0.28, y: 0.16, z: 0, rz: -0.1 }, { x: -0.3, y: -0.28, z: -3, rz: 0.55, rx: 0.2 }] },
    { id: 'cross',    name: 'Cross',    cards: [{ x: -0.08, y: 0.22, z: 0, rz: 0.6, rx: -0.3 }, { x: 0.12, y: -0.22, z: -3, rz: -0.95, rx: -0.2, back: true }] },
    { id: 'trio',     name: 'Trio',     cards: [{ x: -0.4, y: 0.3, z: -3.8, rz: 0.35, alt: true }, { x: 0.42, y: 0.12, z: 0, rz: 0.3 }, { x: -0.05, y: -0.32, z: -1.9, rz: -1.15, alt: true }] }
  ];
  const currentLayout = () => LAYOUTS.find(l => l.id === state.layout) || LAYOUTS[0];
  const SPREAD = 0.62;   // tightens every layout; depth gaps stay as set so cards don't collide
  const FLAT_GAP = 0.9;  // cm between the two cards in the Flat layout
  const usesAlt = () => false;   // every card uses the main colour for now

  // Real-world finishes. surface: micro-texture in the normal map; aniso: brushed highlight stretch
  const MATERIALS = {
    polished: { rough: 0.1,  metal: 1.0, clearcoat: 0,   ccRough: 0.1,  surface: 'smooth',  amp: 2,  env: 'dark' },
    brushed:  { rough: 0.28, metal: 1.0, clearcoat: 0,   ccRough: 0.1,  surface: 'brushed', amp: 14, aniso: 0.85, env: 'dark' },
    blasted:  { rough: 0.48, metal: 1.0, clearcoat: 0,   ccRough: 0.1,  surface: 'blasted', amp: 22, env: 'dark' },
    gloss:    { rough: 0.4,  metal: 0.0, clearcoat: 1,   ccRough: 0.04, surface: 'smooth',  amp: 2,  env: 'light' },
    satin:    { rough: 0.38, metal: 0.06, clearcoat: 0.5, ccRough: 0.22, surface: 'grain',  amp: 6,  env: 'light' },
    soft:     { rough: 0.85, metal: 0.0, clearcoat: 0,   ccRough: 0.5,  surface: 'grain',   amp: 8,  sheen: 0.7, sheenRough: 0.85, env: 'light' },
    holo:     { rough: 0.16, metal: 1.0, clearcoat: 0,   ccRough: 0.1,  surface: 'smooth',  amp: 2,  irid: 1, env: 'dark' }
  };
  const ENVS = {
    dark:  { wall: '#0b0d15', panel: 7, panelTint: '#dfe6ff', lightI: 2.6, lightColor: '#dfe5ff' },
    light: { wall: '#85837f', panel: 5, panelTint: '#fff8f0', lightI: 2.2, lightColor: '#fff6ec' }
  };
  const EDGES = {
    silver: { c: '#c9ced8', m: 1.0, r: 0.28 },
    gold:   { c: '#d8b562', m: 1.0, r: 0.25 },
    copper: { c: '#e09068', m: 1.0, r: 0.22 }
  };
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function luminance(h) {
    return hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function shade(h, k) { return '#' + hexRgb(h).map(v => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')).join(''); }
  function finish(color) {
    const mt = MATERIALS[state.material];
    const light = luminance(color) > 0.3;
    const e = state.edge === 'match'
      ? { c: color, m: mt.metal, r: mt.rough }
      : EDGES[state.edge];
    return Object.assign({}, ENVS[mt.env], mt, {
      base: color, baseRough: mt.rough, baseMetal: mt.metal,
      ink: light ? '#141a2c' : '#f6f6f6', inkRough: 0.5, inkMetal: 0.0,
      edge: e.c, edgeMetal: e.m, edgeRough: e.r
    });
  }
  const FOILS = {
    silver: { color: '#d6d9df', rough: 0.16, metal: 1.0 },
    gold:   { color: '#d8b562', rough: 0.18, metal: 1.0 },
    black:  { color: '#1b1b1f', rough: 0.22, metal: 0.6 },
    rainbow:{ color: '#d6d9df', rough: 0.12, metal: 1.0, rainbow: true }
  };

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.useLegacyLights = false;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lin = (hex) => new THREE.Color(hex);   // colour management converts sRGB to linear

  function makeEnv(p, dark) {
    const mood = { studio: [1, 1], soft: [0.7, 1.7], contrast: [1.35, 0.4] }[state.mood];
    const kp = { left: [-13, 11, 15], top: [0, 19, 9], right: [13, 11, 15] }[state.keyDir];
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50),
      new THREE.MeshBasicMaterial({ color: lin(p.wall), side: THREE.BackSide })));
    const tint = lin(p.panelTint);
    const panel = (w, h, x, y, z, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(p.panel * k * 0.4), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    };
    if (state.mood === 'soft') panel(24, 16, kp[0], kp[1], kp[2], mood[0]);
    else panel(16, 11, kp[0], kp[1], kp[2], mood[0]);   // key softbox
    panel(14, 32, 18, 2, 4, 0.38 * Math.sqrt(mood[1]));     // diffused right panel, wraps the edge
    panel(24, 5, 0, 22, -4, 0.35);     // overhead
    panel(10, 3, 4, -14, 16, 0.15);    // low bounce
    panel(22, 16, 0, 1, 22, (dark ? 0.55 : 0.22) * mood[1]);     // broad fill behind the camera
    if (dark) panel(26, 7, 0, 12, 20, 0.9 * mood[1]);           // soft band above the camera so a dark face reads head-on
    panel(26, 6, 0, -13, 17, (dark ? 0.6 : 0.15) * mood[1]);      // strip below the camera, lifts the lower face and bottom edge
    panel(14, 30, -19, 0, 5, (dark ? 0.5 : 0.12) * mood[1]);      // diffused left panel, mirrors the right one for the other edge
    const rt = pmrem.fromScene(s, 0.02);
    s.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return rt;
  }

  const key = new THREE.DirectionalLight(0xffffff, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCF honours shadow.radius, so blur is adjustable
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShadowMaterial({ opacity: 0.22 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -6.8; floor.receiveShadow = true;
  scene.add(floor);
  scene.add(key, key.target);

  // ---------- Dimensions ----------
  const PX = 190;                       // texture pixels per centimetre
  const R = 0.318, T = 0.076, M = 0.5;  // corner radius, thickness, margin
  let W, H, TW, TH, V;
  function setDims() {
    V = state.orient === 'v';
    W = V ? 5.398 : 8.56; H = V ? 8.56 : 5.398;
    TW = Math.round(W * PX); TH = Math.round(H * PX);
  }

  // ---------- Canvas helpers (shapes in cm, text in pixels) ----------
  function layers() {
    const mk = () => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; return c; };
    const col = mk(), rmc = mk(), bmp = mk(), irc = mk();
    return { col, rmc, bmp, irc, c: col.getContext('2d'), m: rmc.getContext('2d'), b: bmp.getContext('2d'), i: irc.getContext('2d') };
  }

  const rmS = (r, mt) => `rgb(0,${Math.round(r * 255)},${Math.round(mt * 255)})`;
  const grey = v => `rgb(${v},${v},${v})`;
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
  // Typeface printed on the card. Numbers use it too, slightly tracked, as modern flat-printed cards do
  const FONTS = {
    helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    geist: '"Geist Variable", "Helvetica Neue", Helvetica, Arial, sans-serif',
    // FF Mark is licensed, so it's never bundled: the app registers "Card Mark" from an installed
    // copy or a file the person loads (see lib/cardFont.ts)
    mark: '"Card Mark", "Helvetica Neue", Helvetica, Arial, sans-serif',
  };
  const sans = () => FONTS[state.cardFont] || FONTS.helvetica;
  const NUMBER = { tracking: 0.06 };
  // Canvas won't load a web font on its own: fetch it first, then redraw
  const fontReady = () => {
    const family = state.cardFont === 'geist' ? '"Geist Variable"' : state.cardFont === 'mark' ? '"Card Mark"' : null;
    return family ? Promise.all([document.fonts.load(`400 40px ${family}`), document.fonts.load(`500 40px ${family}`)]).catch(() => {}) : Promise.resolve();
  };
  function text(ctx, str, x, y, size, opts) {
    opts = opts || {};
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const align = opts.align || 'left';
    // Safe area: keep every line inside the card margin, shrinking to fit if needed
    const room = align === 'left' ? W - M - x : align === 'right' ? x - M : 2 * Math.min(x - M, W - M - x);
    const maxW = Math.max(0.5, opts.maxW ? Math.min(opts.maxW, room) : room) * PX;
    let px = Math.round(size * PX);
    const setFont = () => {
      ctx.font = `${opts.style || ''} ${opts.weight || 400} ${px}px ${opts.family || sans()}`;
      ctx.letterSpacing = opts.tracking ? `${(px * opts.tracking).toFixed(1)}px` : '0px';
    };
    setFont();
    while (px > 8 && ctx.measureText(str).width > maxW) { px -= 1; setFont(); }
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = opts.fill;
    ctx.fillText(str, x * PX, y * PX);
    ctx.restore();
  }
  // Text on colour and material layers together
  function inkText(L, str, x, y, size, opts, fill, rmFill) {
    text(L.c, str, x, y, size, Object.assign({}, opts, { fill }));
    text(L.m, str, x, y, size, Object.assign({}, opts, { fill: rmFill }));
    text(L.b, str, x, y, size, Object.assign({}, opts, { fill: grey(178) }));   // printed ink sits slightly proud
  }
  function containRect(img, box, alignRight) {
    const ar = img.width / img.height;
    let w = box.w, h = box.w / ar;
    if (h > box.h) { h = box.h; w = h * ar; }
    const x = alignRight ? box.x + box.w - w : box.x;
    const y = box.y + (box.h - h) / 2;
    return { x, y, w, h };
  }
  // Fill an image's silhouette with a style, at rect (cm)
  function maskFill(ctx, img, rect, styleFn) {
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(rect.w * PX)); t.height = Math.max(1, Math.round(rect.h * PX));
    const tc = t.getContext('2d');
    tc.drawImage(img, 0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = styleFn(tc, t.width, t.height);
    tc.fillRect(0, 0, t.width, t.height);
    ctx.drawImage(t, rect.x, rect.y, rect.w, rect.h);
  }
  function rainbow(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    ['#ffd1dc', '#ffe9b0', '#c9f5d0', '#b9e4ff', '#d9c8ff', '#ffd1dc'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    return g;
  }

  // Surface micro-texture for the height map, cached per size, type and strength
  const noiseCache = {};
  function surfaceTex(type, amp) {
    const k = [TW, TH, type, amp].join(':');
    if (noiseCache[k]) return noiseCache[k];
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(TW, TH), d = img.data;
    for (let y = 0; y < TH; y++) {
      const row = Math.random() - 0.5, ph = Math.random() * 6.28, row2 = Math.random() - 0.5;
      for (let x = 0; x < TW; x++) {
        let n;
        if (type === 'brushed') n = row * 0.8 + row2 * 0.35 * Math.sin(x * 0.004 + ph) + (Math.random() - 0.5) * 0.15;
        else n = Math.random() - 0.5;
        const v = 170 + n * amp, i = (y * TW + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    noiseCache[k] = cv;
    return cv;
  }
  // Height map to tangent-space normal map (OpenGL convention, canvas top is +v)
  function heightToNormal(cv, strength) {
    const w = cv.width, h = cv.height;
    const src = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const img = octx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        const nx = -(src[(y * w + xr) * 4] - src[(y * w + xl) * 4]) * strength;
        const ny = (src[(yd * w + x) * 4] - src[(yu * w + x) * 4]) * strength;
        const l = Math.sqrt(nx * nx + ny * ny + 1), i = (y * w + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  function startLayers(p) {
    const L = layers();
    L.c.fillStyle = p.base; L.c.fillRect(0, 0, TW, TH);
    L.m.fillStyle = rmS(p.baseRough, p.baseMetal); L.m.fillRect(0, 0, TW, TH);
    L.b.drawImage(surfaceTex(p.surface, p.amp), 0, 0);
    L.i.fillStyle = p.irid ? '#fff' : '#000'; L.i.fillRect(0, 0, TW, TH);
    // Metallic flecks suspended in the finish
    if (state.sparkle !== 'off') {
      const n = Math.round(TW * TH * (state.sparkle === 'fine' ? 0.0015 : 0.005));
      let sd = 98765;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      L.m.fillStyle = rmS(0.1, 1.0);
      for (let i = 0; i < n; i++) {
        const x = rnd() * TW, y = rnd() * TH, sz = 1.5 + rnd() * 1.8, a = 0.25 + rnd() * 0.55;
        L.c.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
        L.c.fillRect(x, y, sz, sz);
        L.m.fillRect(x, y, sz, sz);
      }
    }
    [L.c, L.m, L.b, L.i].forEach(x => x.setTransform(PX, 0, 0, PX, 0, 0));
    return L;
  }

  // ---------- Layout ----------
  function chipRect() {
    return V ? { x: W - 1.72, y: 1.75, w: 0.86, h: 1.12 } : { x: 0.95, y: 1.85, w: 1.12, h: 0.86 };
  }
  function markBox() {
    const mw = 1.45, mh = 0.75, idH = identLabel() ? 0.38 : 0;
    const chip = chipRect();
    switch (state.markPos) {
      case 'tl': return { x: M, y: M, w: mw, h: mh, right: false };
      case 'tr': return { x: W - M - mw, y: M, w: mw, h: mh, right: true };
      case 'bl': return { x: M, y: H - M - mh - idH, w: mw, h: mh, right: false };
      case 'chip': return { x: chip.x - 0.35 - mw, y: chip.y + chip.h / 2 - mh / 2, w: mw, h: mh, right: true };
      default: return { x: W - M - mw, y: H - M - mh - idH, w: mw, h: mh, right: true };
    }
  }
  function identLabel() {
    if (state.ident === 'none') return '';
    if (state.ident === 'custom') return state.identText.trim();
    return state.ident;
  }
  function frontHoloRect() {
    return V ? { x: M, y: 1.55, w: 1.1, h: 0.75 } : { x: W - M - 1.1, y: 1.85, w: 1.1, h: 0.75 };
  }

  // Everything the card draws over a face, for the placement guides
  function guides(face) {
    setDims();
    const zones = [];
    const add = (label, r) => r && zones.push({ label, x: r.x, y: r.y, w: r.w, h: r.h });
    if (face === 'front') {
      const ch = chipRect();
      add('Chip', ch);
      if (state.contactless) add('Contactless', V ? { x: ch.x - 0.05, y: ch.y - 0.6, w: ch.w + 0.1, h: 0.5 } : { x: ch.x + ch.w + 0.05, y: ch.y - 0.05, w: 0.5, h: ch.h + 0.1 });
      if (markImg || identLabel()) add('Mark', markBox());
      if (issuerImg || state.issuerText.trim()) add('Issuer', { x: state.markPos === 'tl' ? W - M - 2 : M, y: M, w: 2, h: 0.62 });
      const lines = (state.name !== 'back' ? 1 : 0) + (state.fAccount === 'last4' ? 1 : state.fAccount === 'full' ? 2 : 0);
      if (lines) add(state.fAccount === 'none' ? 'Name' : 'Name and number', { x: M, y: H - M - lines * 0.5 - 0.1, w: W * 0.62, h: lines * 0.5 + 0.1 });
      if (state.holo === 'front') add('Hologram', frontHoloRect());
    } else {
      const stripe = state.stripe !== 'none';
      if (stripe) add('Stripe', V ? { x: 0.5, y: 0, w: 0.95, h: H } : { x: 0, y: 0.45, w: W, h: 0.95 });
      const cx = V ? (stripe ? 1.9 : M) : M, cy = V ? 0.9 : (stripe ? 1.85 : M), cw = V ? W - 0.45 - cx : 5.2;
      if (state.sig || state.cvv === 'box') add('Signature and code', { x: cx, y: cy, w: cw, h: 0.6 });
      if (state.name !== 'front' || state.bAccount === 'full') add('Name and number', { x: cx, y: cy + 1.0, w: cw, h: state.bAccount === 'full' ? 1.3 : 0.5 });
      if (state.service) add('Terms', V ? { x: cx, y: H - 1.15, w: W - 0.45 - cx, h: 0.65 } : { x: cx, y: H - 1.0, w: W - 2 * M, h: 0.5 });
      if (state.holo === 'back') add('Hologram', V ? { x: W - 0.45 - 1.1, y: H - 2.3, w: 1.1, h: 0.75 } : { x: W - M - 1.1, y: cy, w: 1.1, h: 0.75 });
    }
    return { w: W, h: H, r: R, safe: 0.3, px: [TW, TH], zones };
  }

  // ---------- Drawing parts ----------
  function drawChip(L, ch) {
    const portrait = ch.h > ch.w;
    const pw = Math.min(ch.w, ch.h), ph = Math.max(ch.w, ch.h);
    const cxm = ch.x + ch.w / 2, cym = ch.y + ch.h / 2;
    const px = 1 / PX;
    // Contact layouts, drawn in a portrait frame centred on the chip
    const PATTERNS = {
      classic: (ctx, x, y) => {
        const y1 = y + ph * 0.3, y2 = y + ph * 0.7, x1 = x + pw * 0.28, x2 = x + pw * 0.72;
        ctx.beginPath();
        ctx.moveTo(x, y1); ctx.lineTo(x1, y1); ctx.moveTo(x, y2); ctx.lineTo(x1, y2);
        ctx.moveTo(x2, y1); ctx.lineTo(x + pw, y1); ctx.moveTo(x2, y2); ctx.lineTo(x + pw, y2);
        ctx.moveTo(0, y); ctx.lineTo(0, y1); ctx.moveTo(0, y2); ctx.lineTo(0, y + ph);
        ctx.stroke();
        rr(ctx, x1, y1, x2 - x1, y2 - y1, 0.06); ctx.stroke();
      },
      grid: (ctx, x, y) => {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(0, y + ph);
        ctx.moveTo(x, y + ph / 3); ctx.lineTo(x + pw, y + ph / 3);
        ctx.moveTo(x, y + ph * 2 / 3); ctx.lineTo(x + pw, y + ph * 2 / 3);
        ctx.stroke();
      },
      eight: (ctx, x, y) => {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(0, y + ph);
        [0.25, 0.5, 0.75].forEach(f => { ctx.moveTo(x, y + ph * f); ctx.lineTo(x + pw, y + ph * f); });
        ctx.stroke();
      },
      organic: (ctx, x, y) => {
        const rx = pw * 0.2, ry = ph * 0.24;
        ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(0, -ry);
        ctx.moveTo(0, ry); ctx.lineTo(0, y + ph);
        [-1, 1].forEach(sx => [-1, 1].forEach(sy => {
          ctx.moveTo(sx * pw / 2, sy * ph * 0.22);
          ctx.quadraticCurveTo(sx * rx * 1.6, sy * ph * 0.22, sx * rx * 0.75, sy * ry * 0.72);
        }));
        ctx.stroke();
      },
      minimal: (ctx, x, y) => {
        rr(ctx, -pw * 0.2, -ph * 0.16, pw * 0.4, ph * 0.32, 0.05); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(0, -ph * 0.16); ctx.moveTo(0, ph * 0.16); ctx.lineTo(0, y + ph);
        ctx.stroke();
      }
    };
    const pattern = (ctx) => (PATTERNS[state.chipPattern] || PATTERNS.classic)(ctx, -pw / 2, -ph / 2);
    const CHIPS = {
      gold:     { stops: ['#e6d6a6', '#cbb47c', '#a58d58'], groove: 'rgba(92,74,40,0.85)',  rough: 0.24, metal: 1.0 },
      silver:   { stops: ['#eef0f3', '#c9cdd3', '#9ca2aa'], groove: 'rgba(70,76,86,0.8)',   rough: 0.22, metal: 1.0 },
      graphite: { stops: ['#62656b', '#45484d', '#2c2e32'], groove: 'rgba(18,18,22,0.85)',  rough: 0.3,  metal: 1.0 },
      black:    { stops: ['#2c2c2f', '#1c1c1e', '#111113'], groove: 'rgba(70,70,76,0.9)',   rough: 0.35, metal: 0.8 },
      rose:     { stops: ['#f1cdbd', '#d9a690', '#b8806b'], groove: 'rgba(110,60,45,0.75)', rough: 0.24, metal: 1.0 }
    };
    const cc = CHIPS[state.chipColor] || CHIPS.gold;
    const local = (ctx, fn) => {
      ctx.save(); ctx.translate(cxm, cym); if (!portrait) ctx.rotate(Math.PI / 2); fn(ctx); ctx.restore();
    };
    const body = (ctx) => rr(ctx, -pw / 2, -ph / 2, pw, ph, 0.13);
    // Colour
    local(L.c, ctx => {
      const g = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
      cc.stops.forEach((c, i) => g.addColorStop(i / 2, c));
      ctx.fillStyle = g; body(ctx); ctx.fill();
      ctx.lineWidth = 3 * px; ctx.strokeStyle = cc.groove; pattern(ctx);
    });
    // Material
    local(L.m, ctx => {
      ctx.fillStyle = rmS(cc.rough, cc.metal); body(ctx); ctx.fill();
      ctx.lineWidth = 3 * px; ctx.strokeStyle = rmS(0.65, 0.8); pattern(ctx);
    });
    // Height: 2px stepped pocket, shallow engraved gaps
    local(L.b, ctx => {
      [[3, 166], [2, 163], [1, 160], [0, 157]].forEach(([pad, g]) => {
        ctx.fillStyle = grey(g);
        rr(ctx, -pw / 2 - pad * px, -ph / 2 - pad * px, pw + pad * 2 * px, ph + pad * 2 * px, 0.13 + pad * px);
        ctx.fill();
      });
      ctx.lineWidth = 3 * px; ctx.strokeStyle = grey(149); pattern(ctx);
    });
  }

  function drawContactless(L, p, ch) {
    const arcs = (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const r = 0.12 + i * 0.1;
        if (V) ctx.arc(ch.x + ch.w / 2, ch.y - 0.12, r, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
        else ctx.arc(ch.x + ch.w + 0.12, ch.y + ch.h / 2, r, -0.6, 0.6);
        ctx.stroke();
      }
    };
    [[L.c, p.ink], [L.m, rmS(p.inkRough, p.inkMetal)], [L.b, grey(178)]].forEach(([ctx, s]) => {
      ctx.lineCap = 'round'; ctx.lineWidth = 0.042; ctx.strokeStyle = s; arcs(ctx);
    });
  }

  function drawHolo(L, r) {
    L.c.fillStyle = rainbow(L.c, r.x, r.y, r.x + r.w, r.y + r.h);
    rr(L.c, r.x, r.y, r.w, r.h, 0.06); L.c.fill();
    L.m.fillStyle = rmS(0.12, 1.0); rr(L.m, r.x, r.y, r.w, r.h, 0.06); L.m.fill();
    L.i.fillStyle = '#fff'; rr(L.i, r.x, r.y, r.w, r.h, 0.06); L.i.fill();
    // Fine diffraction lines in the height map
    L.b.save(); rr(L.b, r.x, r.y, r.w, r.h, 0.06); L.b.clip();
    L.b.fillStyle = grey(172); L.b.fillRect(r.x, r.y, r.w, r.h);
    L.b.strokeStyle = grey(162); L.b.lineWidth = 1.5 / PX;
    for (let d = -r.h; d < r.w; d += 4 / PX) {
      L.b.beginPath(); L.b.moveTo(r.x + d, r.y + r.h); L.b.lineTo(r.x + d + r.h, r.y); L.b.stroke();
    }
    L.b.restore();
  }

  function drawMark(L, p) {
    const box = markBox();
    const foil = FOILS[state.markStyle];
    let drawn = box;
    if (markImg) {
      const r = containRect(markImg, box, box.right);
      drawn = r;
      if (!foil) {
        L.c.drawImage(markImg, r.x, r.y, r.w, r.h);
        maskFill(L.m, markImg, r, () => rmS(p.inkRough, 0));
      } else {
        maskFill(L.c, markImg, r, (tc, w, h) => foil.rainbow ? rainbow(tc, 0, 0, w, h) : foil.color);
        if (foil.rainbow) maskFill(L.i, markImg, r, () => '#fff');
        maskFill(L.m, markImg, r, () => rmS(foil.rough, foil.metal));
        maskFill(L.b, markImg, r, () => grey(177));   // hot-stamped foil sits proud
      }
    }
    const id = identLabel();
    if (id) {
      const x = box.right ? drawn.x + drawn.w : drawn.x;
      const y = drawn.y + drawn.h + 0.3;
      const col = foil ? (foil.rainbow ? FOILS.silver.color : foil.color) : p.ink;
      const rmf = foil ? rmS(0.3, foil.metal * 0.5) : rmS(p.inkRough, p.inkMetal);
      inkText(L, id, x, y, 0.24, { align: box.right ? 'right' : 'left', weight: 500 }, col, rmf);
    }
    return box;
  }

  function drawIssuer(L, p) {
    const right = state.markPos === 'tl';
    const box = { x: right ? W - M - 2.0 : M, y: M, w: 2.0, h: 0.62 };
    if (V && right) box.y = M; // top right on vertical sits above the contactless symbol
    if (issuerImg) {
      const r = containRect(issuerImg, box, right);
      L.c.drawImage(issuerImg, r.x, r.y, r.w, r.h);
      maskFill(L.m, issuerImg, r, () => rmS(p.inkRough, p.inkMetal));
    } else if (state.issuerText.trim()) {
      inkText(L, state.issuerText.trim(), right ? W - M : M, M + 0.42, 0.4,
        { align: right ? 'right' : 'left', weight: 600 }, p.ink, rmS(p.inkRough, p.inkMetal));
    }
  }

  // ---------- Front and back ----------
  // Artwork is printed ink: its own colours, non-metallic, with the finish showing where it's transparent
  function paintArt(L, a) {
    if (!a) return;
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    drawArt(c.getContext('2d'), a.img, a.placement, TW, TH);
    L.c.drawImage(c, 0, 0, W, H);
    const g = c.getContext('2d'); g.globalCompositeOperation = 'source-in'; g.fillStyle = rmS(0.4, 0); g.fillRect(0, 0, TW, TH);
    L.m.drawImage(c, 0, 0, W, H);
  }

  function frontMaps(p) {
    const L = startLayers(p);
    paintArt(L, art.front);
    const ch = chipRect();
    drawChip(L, ch);
    if (state.contactless) drawContactless(L, p, ch);
    drawIssuer(L, p);
    const box = drawMark(L, p);
    if (state.holo === 'front') drawHolo(L, frontHoloRect());

    // Bottom-left stack: account details and name
    const ink = p.ink, inkRm = rmS(p.inkRough, p.inkMetal);
    const markBottomLeft = state.markPos === 'bl';
    let y = markBottomLeft ? box.y - 0.3 : H - 0.62;
    if (!V && !markBottomLeft) y = H - 0.55;
    if (state.name !== 'back') { inkText(L, state.nameText, M, y, 0.3, {}, ink, inkRm); y -= 0.5; }
    if (state.fAccount === 'last4') {
      inkText(L, '•••• 9010', M, y, 0.3, NUMBER, ink, inkRm);
    } else if (state.fAccount === 'full') {
      inkText(L, 'Good thru 12/29', M, y, 0.2, {}, ink, inkRm); y -= 0.42;
      // Keep the long number clear of a bottom-right mark
      if (state.markPos === 'br' && y > box.y - 0.1) y = box.y - 0.15;
      inkText(L, '4000 1234 5678 9010', M, y, V ? 0.33 : 0.42, { ...NUMBER, weight: 500 }, ink, inkRm);
    }
    return L;
  }

  function backMaps(p) {
    const L = startLayers(p);
    paintArt(L, art.back);
    const ink = p.ink, inkRm = rmS(p.inkRough, p.inkMetal);
    const hasStripe = state.stripe !== 'none';
    const stripeCol = state.stripe === 'custom' ? state.stripeColor : '#151518';

    // Magnetic stripe: along the long edge on vertical, across the top on horizontal
    let cx, cy, cw;   // content area
    if (V) {
      if (hasStripe) {
        L.c.fillStyle = stripeCol; L.c.fillRect(0.5, 0, 0.95, H);
        L.m.fillStyle = rmS(0.38, 0); L.m.fillRect(0.5, 0, 0.95, H);
        L.b.fillStyle = grey(173); L.b.fillRect(0.5, 0, 0.95, H);
      }
      cx = hasStripe ? 1.9 : M; cy = 0.9; cw = W - 0.45 - cx;
    } else {
      if (hasStripe) {
        L.c.fillStyle = stripeCol; L.c.fillRect(0, 0.45, W, 0.95);
        L.m.fillStyle = rmS(0.38, 0); L.m.fillRect(0, 0.45, W, 0.95);
        L.b.fillStyle = grey(173); L.b.fillRect(0, 0.45, W, 0.95);
      }
      cx = M; cy = hasStripe ? 1.85 : M; cw = 5.2;
    }

    // Signature panel and security code
    const boxW = 0.72, ph = 0.6;
    const panelW = state.cvv === 'box' ? cw - boxW - 0.1 : cw;
    if (state.sig) {
      L.c.fillStyle = '#efeee9'; L.c.fillRect(cx, cy, panelW, ph);
      L.c.save(); L.c.beginPath(); L.c.rect(cx, cy, panelW, ph); L.c.clip();
      L.c.strokeStyle = 'rgba(120,130,160,0.18)'; L.c.lineWidth = 0.012;
      for (let d = -ph; d < panelW; d += 0.06) { L.c.beginPath(); L.c.moveTo(cx + d, cy + ph); L.c.lineTo(cx + d + ph, cy); L.c.stroke(); }
      L.c.restore();
      L.m.fillStyle = rmS(0.8, 0); L.m.fillRect(cx, cy, panelW, ph);
      if (state.cvv === 'panel') text(L.c, '123', cx + panelW - 0.12, cy + 0.4, 0.24, { align: 'right', style: 'italic', fill: '#222' });
    }
    if (state.cvv === 'box') {
      const bx = state.sig ? cx + panelW + 0.1 : cx;
      L.c.fillStyle = '#ffffff'; L.c.fillRect(bx, cy, boxW, ph);
      L.m.fillStyle = rmS(0.7, 0); L.m.fillRect(bx, cy, boxW, ph);
      text(L.c, '123', bx + boxW / 2, cy + 0.4, 0.24, { align: 'center', style: 'italic', fill: '#222' });
    }
    let y = cy + (state.sig || state.cvv === 'box' ? ph + 0.55 : 0.3);
    if (state.cvv === 'printed' || (state.cvv === 'panel' && !state.sig)) {
      inkText(L, 'Security code 123', cx, y, 0.2, {}, ink, inkRm); y += 0.5;
    }

    // Account details and name
    if (state.bAccount === 'full') {
      inkText(L, '4000 1234 5678 9010', cx, y, V ? 0.3 : 0.38, { ...NUMBER, weight: 500 }, ink, inkRm); y += 0.42;
      inkText(L, 'Good thru 12/29', cx, y, 0.2, {}, ink, inkRm); y += 0.5;
    }
    if (state.name !== 'front') { inkText(L, state.nameText, cx, y, 0.28, {}, ink, inkRm); y += 0.5; }

    if (state.holo === 'back') {
      drawHolo(L, V ? { x: W - 0.45 - 1.1, y: H - 2.3, w: 1.1, h: 0.75 } : { x: W - M - 1.1, y: cy, w: 1.1, h: 0.75 });
    }
    if (state.service) {
      const sy = H - (V ? 0.95 : 0.7);
      // Bottom-up from the safe margin, line height about 1.35 × type size
      const last = H - 0.6;
      if (V) {
        inkText(L, 'the cardholder agreement.', cx, last, 0.14, {}, ink, inkRm);
        inkText(L, 'Use of this card is subject to', cx, last - 0.19, 0.14, {}, ink, inkRm);
        inkText(L, 'Customer service 0000 000 000', cx, last - 0.19 - 0.26, 0.17, {}, ink, inkRm);
      } else {
        inkText(L, 'Use of this card is subject to the cardholder agreement.', cx, last, 0.14, {}, ink, inkRm);
        inkText(L, 'Customer service 0000 000 000', cx, last - 0.26, 0.17, {}, ink, inkRm);
      }
    }
    return L;
  }

  // ---------- Geometry ----------
  const RC = T * 0.45;    // vertical radius of the edge profile
  const RCX = T * 0.5;    // how far the round-over reaches into the face
  // Rounded-rectangle outline inset from the card edge, with outward normals
  function outline(inset) {
    const pts = [], nrm = [], seg = 16;
    const r = Math.max(0.001, R - inset), cx = W / 2 - inset - r, cy = H / 2 - inset - r;
    [[cx, cy], [-cx, cy], [-cx, -cy], [cx, -cy]].forEach(([ox, oy], c) => {
      for (let i = 0; i <= seg; i++) {
        const a = c * Math.PI / 2 + (Math.PI / 2) * i / seg;
        const n = new THREE.Vector2(Math.cos(a), Math.sin(a));
        nrm.push(n); pts.push(new THREE.Vector2(ox + r * n.x, oy + r * n.y));
      }
    });
    return { pts, nrm };
  }
  function faceGeometry() {
    const g = new THREE.ShapeGeometry(new THREE.Shape(outline(RCX).pts), 1);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + H / 2) / H);
    return g;
  }
  // Swept round-over: the edge rolls from the face into the side, so it catches a thin highlight
  function edgeGeometry() {
    const { pts, nrm } = outline(RCX);
    const prof = [], ns = 8, flat = T / 2 - RC;
    // Elliptical round-over: wider across the face than it is deep, normals follow the ellipse
    const pt = th => { const nd = Math.cos(th) / RCX, nz = Math.sin(th) / RC, l = Math.hypot(nd, nz); return [RCX * Math.cos(th), RC * Math.sin(th), nd / l, nz / l]; };
    for (let j = 0; j <= ns; j++) { const q = pt(Math.PI / 2 - (Math.PI / 2) * j / ns); prof.push([q[0], flat + q[1], q[2], q[3]]); }
    for (let j = 0; j <= ns; j++) { const q = pt(-(Math.PI / 2) * j / ns); prof.push([q[0], -flat + q[1], q[2], q[3]]); }
    const N = pts.length, P = prof.length, pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < P; j++) {
      const [o, z, nd, nz] = prof[j];
      pos.push(pts[i].x + nrm[i].x * o, pts[i].y + nrm[i].y * o, z);
      nor.push(nrm[i].x * nd, nrm[i].y * nd, nz);
      uv.push(i / N, j / (P - 1));
    }
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      for (let j = 0; j < P - 1; j++) {
        const a = i * P + j, b = i2 * P + j, c = i2 * P + j + 1, d = i * P + j + 1;
        idx.push(a, d, b, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const makeSet = () => ({
    front: new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 1 }),
    back: new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 1 }),
    edge: new THREE.MeshPhysicalMaterial()
  });
  const matsA = makeSet(), matsB = makeSet();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const rig = new THREE.Group();          // whole composition, animated together
  scene.add(rig);
  const holders = [0, 1, 2].map(() => { const g = new THREE.Group(); rig.add(g); return g; });
  let cardMeshes = [];
  let builtOrient = null, cardGeos = null;
  function buildCard() {
    holders.forEach(g => g.children.slice().forEach(m => g.remove(m)));
    if (cardGeos) cardGeos.forEach(g => g.dispose());
    const fg = faceGeometry(); fg.translate(0, 0, T / 2);
    const bg = faceGeometry(); bg.translate(0, 0, T / 2); bg.rotateY(Math.PI);
    const eg = edgeGeometry();
    cardGeos = [fg, bg, eg];
    cardMeshes = holders.map(g => {
      const ms = [new THREE.Mesh(fg), new THREE.Mesh(bg), new THREE.Mesh(eg)];
      ms.forEach(m => { m.castShadow = true; m.receiveShadow = true; g.add(m); });
      return ms;
    });
    builtOrient = state.orient;
  }
  function arrange() {
    const L = currentLayout();
    holders.forEach((g, i) => {
      const c = L.cards[i];
      g.visible = !!c;
      if (!c) return;
      const set = matsA;
      const [f, b, e] = cardMeshes[i];
      f.material = set.front; b.material = set.back; e.material = set.edge;
    });
  }

  function tex(cv, srgb) {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }

  // ---------- Apply ----------
  let envRT = null, envFinish = '';
  const owned = [];
  function apply() {
    setDims();
    if (builtOrient !== state.orient) { buildCard(); resize(); }
    const p = finish(state.color);
    // Dark finishes reflect little, so lift the studio for them
    const liftOf = c => { const l = luminance(c); return l < 0.08 ? 1 + (0.08 - l) / 0.08 * 1.2 : 1; };
    const lift = Math.max(liftOf(state.color), usesAlt() ? liftOf(state.color2) : 1);
    owned.splice(0).forEach(t => t.dispose());
    const sets = [[matsA, p, liftOf(state.color)]];
    if (usesAlt()) sets.push([matsB, finish(state.color2), liftOf(state.color2)]);
    for (const [set, fp, lf] of sets) {
      const F = frontMaps(fp), B = backMaps(fp);
      for (const [mat, L] of [[set.front, F], [set.back, B]]) {
        const c = tex(L.col, true), r = tex(L.rmc, false), n = tex(heightToNormal(L.bmp, 1 / 40), false), ir = tex(L.irc, false);
        owned.push(c, r, n, ir);
        mat.map = c; mat.roughnessMap = r; mat.metalnessMap = r;
        mat.bumpMap = null; mat.normalMap = n; mat.normalScale.set(1, 1);
        mat.anisotropy = fp.aniso || 0; mat.anisotropyRotation = 0;
        mat.sheen = fp.sheen || 0; mat.sheenRoughness = fp.sheenRough || 0.8; mat.sheenColor.set(0xffffff);
        mat.iridescence = 1; mat.iridescenceMap = ir; mat.iridescenceIOR = 1.35; mat.iridescenceThicknessRange = [120, 420];
        mat.clearcoat = fp.clearcoat; mat.clearcoatRoughness = fp.ccRough;
        mat.envMapIntensity = lf;
        mat.needsUpdate = true;
      }
      set.edge.color = lin(fp.edge);
      set.edge.metalness = fp.edgeMetal;
      set.edge.roughness = fp.edgeRough;
      set.edge.clearcoat = fp.clearcoat; set.edge.clearcoatRoughness = fp.ccRough;
      set.edge.sheen = fp.sheen || 0; set.edge.iridescence = state.edge === 'match' ? (fp.irid || 0) : 0;
      set.edge.envMapIntensity = lf;
      set.edge.needsUpdate = true;
    }
    arrange();

    const envKey = [p.env, lift > 1, state.mood, state.keyDir].join(':');
    if (envFinish !== envKey) {
      if (envRT) envRT.dispose();
      envRT = makeEnv(p, lift > 1); scene.environment = envRT.texture; envFinish = envKey;
    }
    key.position.set(...{ left: [-9, 7, 9], top: [0, 14, 6], right: [9, 7, 9] }[state.keyDir]);
    lightBase = { p, lift, a: liftOf(state.color), b: liftOf(state.color2) };
    key.color = lin(p.lightColor);
    applyLight();
    scene.background = new THREE.Color(state.bg);
    floor.visible = state.shadow;
    resize();
  }
  // Brightness and exposure only touch lights and materials, so they update instantly
  let lightBase = null;
  function applyLight() {
    if (!lightBase) return;
    const { p, lift, a, b } = lightBase;
    const k = Math.pow(state.bright, 1.6);
    [matsA.front, matsA.back, matsA.edge].forEach(m => { m.envMapIntensity = a * k; });
    [matsB.front, matsB.back, matsB.edge].forEach(m => { m.envMapIntensity = b * k; });
    key.intensity = p.lightI * 0.55 * lift * k * { studio: 1, soft: 0.7, contrast: 1.35 }[state.mood];
    renderer.toneMappingExposure = 0.85 * (lift > 1 ? 1.1 : 1) * state.expo;
  }
  let pending = false;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; apply(); }); } }


  // ---------- Shadow ----------
  // Acts directly on the light and floor, no re-render of textures
  function applyShadow() {
    floor.material.opacity = state.shadowStrength;
    key.shadow.radius = state.shadowBlur;
    floor.position.y = -state.shadowDist;
  }

  // ---------- View ----------
  let inset = { right: 0, bottom: 0 };
  let recording = false; // while a video records, the canvas keeps the video's size
  // Keep the card centred in the space a panel leaves: left of a side panel, above a bottom one
  function viewOffset() {
    const w = window.innerWidth, h = window.innerHeight;
    if (inset.right) camera.setViewOffset(w, h, inset.right / 2, 0, w, h);
    else if (inset.bottom) camera.setViewOffset(w, h, 0, inset.bottom / 2, w, h);
    else camera.clearViewOffset();
  }
  function resize() {
    if (recording) return; // the canvas is held at the video's size until recording ends
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = 2 * Math.tan(THREE.MathUtils.degToRad(15));
    const Lc = currentLayout().cards, flat = currentLayout().flat;
    let needH = state.orient === 'v' ? 13 : 10.5, needW = state.orient === 'v' ? 9.5 : 11.5;
    if (flat) {
      needW = (2 * W + FLAT_GAP) * 1.18;
      needH = H * 1.6;
    } else if (Lc.length > 1) {
      const U = Math.max(W, H), r = 0.5 * Math.hypot(W, H);
      needW = 2.1 * Math.max(...Lc.map(c => Math.abs(c.x * U * SPREAD) + r));
      needH = 2.1 * Math.max(...Lc.map(c => Math.abs(c.y * U * SPREAD) + r));
    }
    // Fit into the height a bottom panel leaves, so the card shrinks rather than hiding behind it
    const hf = Math.max(0.3, (h - inset.bottom) / h);
    const d = Math.max(needH / (tan * hf), needW / (tan * camera.aspect)) / (state.zoom || 1);
    // Flat looks straight on; the others from a touch above
    if (flat) { camera.position.set(0, 0, d); camera.lookAt(0, 0, 0); }
    else { camera.position.set(0, d * 0.06, d); camera.lookAt(0, -0.4, 0); }
    camera.updateProjectionMatrix();
    viewOffset();
  }

  // ---------- Interaction ----------
  // One finger turns and tilts, two fingers twist to roll and pinch to zoom.
  // Desktop: drag to turn and tilt, shift-drag to roll, alt or right-drag to pan,
  // scroll to zoom. Double-tap resets. In multi-card layouts, dragging a card moves it.
  const MOTION_DEFAULTS = { amount: 1, speed: 1, turn: 0, tilt: -0.15, rollBase: -0.3 };
  let userYaw = 0, userPitch = 0, flipped = false, drift = !matchMedia('(prefers-reduced-motion: reduce)').matches && !!state.drift;
  let yaw = 0, pitch = -0.15, roll = -0.3;
  let dragging = false, lastX = 0, lastY = 0;
  const pts = new Map();
  let pinch = null, lastTap = 0;
  let panX = 0, panY = 0, panning = false, moving = -1;
  const cardOffsets = [0, 1, 2].map(() => new THREE.Vector3());
  const raycaster = new THREE.Raycaster();

  const setRoll = v => { state.rollBase = Math.max(-1.2, Math.min(1.2, v)); onChange({ rollBase: state.rollBase }); };
  const setZoom = v => { state.zoom = Math.max(0.5, Math.min(2.5, v)); resize(); };
  const pair = () => { const [a, b] = [...pts.values()]; return { ang: Math.atan2(b.y - a.y, b.x - a.x), dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  // Screen pixels to scene units at the card's depth
  const pxToWorld = () => 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(15)) / window.innerHeight;
  const panBy = (dx, dy) => { const s = pxToWorld(); panX += dx * s; panY -= dy * s; };

  function pickCard(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const objs = [];
    holders.forEach(g => { if (g.visible) objs.push(...g.children); });
    const hit = raycaster.intersectObjects(objs, false)[0];
    return hit ? holders.indexOf(hit.object.parent) : -1;
  }
  function resetView() {
    userYaw = 0; userPitch = 0; state.zoom = 1; panX = 0; panY = 0;
    cardOffsets.forEach(v => v.set(0, 0, 0));
    Object.assign(state, MOTION_DEFAULTS, { spin: false });
    onChange({ ...MOTION_DEFAULTS, spin: false });
    resize();
  }

  const onDown = e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { dragging = false; pinch = pair(); return; }
    const now = performance.now();
    if (now - lastTap < 300) { resetView(); lastTap = 0; return; }
    lastTap = now;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    panning = e.altKey || e.button === 2 || e.button === 1;
    moving = (!panning && currentLayout().cards.length > 1) ? pickCard(e) : -1;
  };
  const onMove = e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const now = pair();
      let da = now.ang - pinch.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      setRoll(state.rollBase - da);
      if (pinch.dist > 0) setZoom(state.zoom * now.dist / pinch.dist);
      panBy(now.mx - pinch.mx, now.my - pinch.my);
      pinch = now;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (moving >= 0) {
      // Move in the screen plane, converted into the group's own rotated space
      const s = pxToWorld();
      cardOffsets[moving].add(new THREE.Vector3(dx * s, -dy * s, 0).applyQuaternion(rig.quaternion.clone().invert()));
    } else if (panning) panBy(dx, dy);
    else if (e.shiftKey) setRoll(state.rollBase + dx * 0.008);
    else {
      userYaw += dx * 0.01;
      userPitch = Math.max(-1.2, Math.min(1.2, userPitch + dy * 0.008));
    }
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) { dragging = false; panning = false; moving = -1; }
  };
  const onWheel = e => { e.preventDefault(); setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015)); };
  const onContext = e => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  window.addEventListener('resize', resize);

  setDims();
  buildCard();
  resize();
  apply();
  applyShadow();
  fontReady().then(schedule);

  // ---------- Loop ----------
  const clock = new THREE.Clock();
  let phase = 0, lastT = 0, raf = 0;
  function frame() {
    const t = clock.getElapsedTime();
    const dt = Math.min(0.05, t - lastT); lastT = t;
    phase += dt * state.speed;                 // speed changes don't jump the motion
    const ph = phase;
    const amt = drift ? state.amount : 0;
    const dy = Math.sin(ph * 0.45) * 0.55 * amt;
    const dp = Math.sin(ph * 0.33) * 0.12 * amt;
    if (!dragging && drift) userPitch *= 0.985;
    const k = dragging ? 0.25 : 0.06;
    const Lc = currentLayout().cards, flat = currentLayout().flat;
    const multi = Lc.length > 1;
    if (flat) {
      // Square to the camera, still: ease any turn, tilt or roll out, then hold
      yaw += (0 - yaw) * 0.12; pitch += (0 - pitch) * 0.12; roll += (0 - roll) * 0.12;
      rig.rotation.set(pitch, yaw, roll, 'ZXY');
      rig.position.set(panX, panY, 0);
      Lc.forEach((c, i) => {
        const g = holders[i], o = cardOffsets[i];
        g.position.set((i ? 1 : -1) * (W + FLAT_GAP) / 2 + o.x, o.y, o.z);
        g.rotation.set(0, c.back ? Math.PI : 0, 0, 'ZXY');
      });
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
      return;
    }
    if (state.spin && !dragging) userYaw += dt * 0.7 * state.speed;
    const base = (flipped ? Math.PI : 0) + state.turn;
    let targetYaw, targetPitch = state.tilt + userPitch + dp;
    if (multi) {
      // The cards sit in one rigid rig, so the group can turn freely without them meeting
      targetYaw = base + userYaw + dy * 0.6;
      targetPitch = state.tilt + 0.05 + userPitch + dp * 0.6;
    } else {
      targetYaw = base + userYaw + dy;
    }
    yaw += (targetYaw - yaw) * k;
    pitch += (targetPitch - pitch) * k;
    const rollTarget = (multi ? state.rollBase + 0.3 : state.rollBase) + Math.sin(ph * 0.21) * 0.05 * amt;
    roll += (rollTarget - roll) * 0.05;
    rig.rotation.set(pitch, yaw, roll, 'ZXY');
    rig.position.set(panX, panY + Math.sin(ph * 0.8) * 0.12 * amt, 0);
    const U = Math.max(W, H);
    Lc.forEach((c, i) => {
      const g = holders[i];
      const bob = multi ? Math.sin(ph * 0.7 + i * 1.7) * 0.1 * amt : 0;
      const sway = multi ? Math.sin(ph * 0.5 + i * 2.3) * 0.025 * amt : 0;
      const o = cardOffsets[i];
      g.position.set(c.x * U * SPREAD + o.x, c.y * U * SPREAD + bob + o.y, c.z + o.z);
      g.rotation.set(c.rx || 0, (c.ry || 0) + (c.back ? Math.PI : 0), (c.rz || 0) + sway, 'ZXY');
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---------- Export ----------
  // Re-renders the current view off-screen at full resolution.
  async function exportImage(fmt, size, background) {
    const w = window.innerWidth, h = window.innerHeight;
    const long = size === '4k' ? 3840 : 1920;
    const k = long / Math.max(w, h);
    const prevPR = renderer.getPixelRatio();
    const transparent = fmt === 'png' && background === 'transparent';
    renderer.setPixelRatio(1);
    renderer.setSize(Math.round(w * k), Math.round(h * k), false);
    camera.clearViewOffset();
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const bg = scene.background;
    if (transparent) { scene.background = null; renderer.setClearColor(0x000000, 0); }
    renderer.render(scene, camera);
    const blob = await new Promise(r => canvas.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.95));
    scene.background = bg;
    renderer.setPixelRatio(prevPR);
    resize();
    return blob;
  }

  const LIGHT_KEYS = new Set(['bright', 'expo']);
  const SHADOW_KEYS = new Set(['shadowStrength', 'shadowBlur', 'shadowDist']);
  // ---------- Video ----------
  // Records the live animation from the canvas, held at 1920 on the long side. Motion is switched on
  // just for the recording, then put back. MP4 where the browser can record it, otherwise WebM.
  async function recordVideo({ seconds, motion, onProgress = () => {} }) {
    if (recording || !canvas.captureStream || !window.MediaRecorder) return null;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const w = window.innerWidth, h = window.innerHeight, k = 1920 / Math.max(w, h);
    const W = Math.round(w * k / 2) * 2, H = Math.round(h * k / 2) * 2;   // even sizes for H.264
    const prev = { spin: state.spin, drift, pr: renderer.getPixelRatio() };
    state.spin = motion !== 'drift'; drift = motion !== 'spin';
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.clearViewOffset(); camera.aspect = W / H; camera.updateProjectionMatrix();
    recording = true;
    const stream = canvas.captureStream(30), chunks = [];
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 16e6 } : undefined);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    rec.start(250);
    const t0 = performance.now();
    await new Promise(r => {
      const tick = () => { const t = (performance.now() - t0) / 1000; onProgress(Math.min(seconds, t)); if (t >= seconds) r(); else setTimeout(tick, 100); };
      tick();
    });
    rec.stop(); await done;
    stream.getTracks().forEach(t => t.stop());
    recording = false;
    state.spin = prev.spin; drift = prev.drift;
    renderer.setPixelRatio(prev.pr);
    resize();
    const mime = rec.mimeType || type || 'video/webm';
    const blob = new Blob(chunks, { type: mime });
    return blob.size ? { blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' } : null;
  }

  // Read each frame or only at export: changing them needs no texture rebuild
  const LIVE_KEYS = new Set(['amount', 'speed', 'turn', 'tilt', 'rollBase', 'spin', 'drift', 'exportSize', 'exportBg', 'videoSeconds', 'videoMotion']);

  return {
    // Merge changed options and redo only the work they need.
    set(patch) {
      Object.assign(state, patch);
      const keys = Object.keys(patch);
      if ('drift' in patch) drift = !!patch.drift;
      if ('layout' in patch) { cardOffsets.forEach(v => v.set(0, 0, 0)); resize(); }
      if (keys.some(k => LIGHT_KEYS.has(k))) applyLight();
      if (keys.some(k => SHADOW_KEYS.has(k))) applyShadow();
      if (keys.some(k => !LIGHT_KEYS.has(k) && !SHADOW_KEYS.has(k) && !LIVE_KEYS.has(k))) schedule();
      if ('cardFont' in patch) fontReady().then(schedule);
    },
    setImage(slot, img) {
      if (slot === 'mark') markImg = img; else issuerImg = img;
      schedule();
    },
    setFlipped(v) { flipped = v; },
    setArt(face, a) { art[face] = a; schedule(); },
    refreshText() { fontReady().then(schedule); },
    guides,
    setViewInset(i) { inset = { right: 0, bottom: 0, ...i }; resize(); },
    resetView,
    exportImage,
    recordVideo,
    layouts: LAYOUTS.map(l => ({ id: l.id, name: l.name, cards: l.cards })),
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      owned.forEach(t => t.dispose());
      if (envRT) envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

