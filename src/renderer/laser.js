// Laser pointer: a glowing red dot that follows the pen/mouse, and (in trail
// mode) a smooth glowing line while the button is held, which fades out as a
// whole after release. Drawn on its own screen-sized canvas over the viewer –
// nothing is saved to the page.
const FADE_MS = 700;
const RED = '#ff2d2d';

export class Laser {
  constructor(tools) {
    this.tools = tools;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'laser-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.trails = [];      // [{ pts: [{x,y}], up: release time or 0 }] in host CSS pixels
    this.trail = null;
    this.dot = null;       // current pointer position
    this.active = false;   // button held
    this.raf = 0;
    this.host = null;
  }

  get state() { return this.tools.editor.toolState.laser; }

  attach(host) {
    this.host = host;
    host.append(this.canvas);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
  }

  resize() {
    if (!this.host) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.kick();
  }

  local(e) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    this.active = true;
    this.pointerId = e.pointerId;
    try { this.tools.viewer.scroller.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.dot = p;
    if (this.state.mode !== 'dot') { this.trail = { pts: [p], up: 0 }; this.trails.push(this.trail); }
    this.kick();
  }

  move(e) {
    const p = this.local(e);
    this.dot = p;
    if (this.active && this.trail) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) {
        const q = this.local(ev);
        const last = this.trail.pts[this.trail.pts.length - 1];
        if (Math.hypot(q.x - last.x, q.y - last.y) >= 1.5) this.trail.pts.push(q);
      }
    }
    this.kick();
  }

  up(e) {
    if (e && e.pointerId !== this.pointerId) return;
    this.active = false;
    if (this.trail) { this.trail.up = performance.now(); this.trail = null; }
    try { this.tools.viewer.scroller.releasePointerCapture(this.pointerId); } catch { /* ignore */ }
    this.kick();
  }

  hide() {
    this.dot = null;
    this.trails = [];
    this.trail = null;
    this.active = false;
    this.kick();
  }

  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  // One smooth path through the points (quadratic curves through midpoints).
  path(pts) {
    const p = new Path2D();
    p.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) { p.lineTo(pts[0].x + 0.1, pts[0].y); return p; }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      p.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const l = pts[pts.length - 1];
    p.lineTo(l.x, l.y);
    return p;
  }

  frame() {
    this.raf = 0;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now();
    this.trails = this.trails.filter((t) => !t.up || now - t.up < FADE_MS);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of this.trails) {
      const alpha = t.up ? 1 - (now - t.up) / FADE_MS : 1;
      const p = this.path(t.pts);
      ctx.globalAlpha = alpha;
      ctx.shadowColor = RED;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 6;
      ctx.stroke(p);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2;
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
    if (this.dot && this.tools.tool === 'laser') {
      const { x, y } = this.dot;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
      g.addColorStop(0, RED);
      g.addColorStop(0.35, RED);
      g.addColorStop(1, 'rgba(255,45,45,0)');
      ctx.shadowBlur = 0;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    if (this.trails.length || this.active) this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    this.canvas.remove();
  }
}
