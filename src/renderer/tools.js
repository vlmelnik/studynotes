// Pointer input: select ("finger"), pen, highlighter, eraser, lasso, text,
// shapes, panning – plus the selection (move / resize / restyle) shared by
// the select tool, the lasso and paste.
import { h, showMenu } from './ui.js';
import { icon } from './icons.js';
import { drawLive, drawStrokes } from './inkrender.js';
import { releaseCanvas } from './viewer.js';
import {
  strokeHit, eraseFromStroke, strokeInLasso, pointInPolygon, transformStroke, recognizeShape, mapCuts, isScribble,
  shapeStrokes, snapAngle, strokeBBox, round2, distToStroke, rectsIntersect, LINE_SHAPES,
} from '../shared/geometry.js';
import { FONTS } from '../shared/fonts.js';
import { restack, stacked } from '../shared/stacking.js';
import { Laser } from './laser.js';
import { isClosedShape } from '../shared/ink.js';
import { placeAt } from './fill-sign.js';
import { TextSelection, peekLayout, charAt, spanBetween, highlightStrokes } from './pdf-text.js';
import { PenFilter, smoothStroke } from '../shared/pen-filter.js';

const HOLD_MS = 550;
const LINE_H = 1.3;
let idCounter = 0;
export function uid() {
  return Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
}

// Rotate (x, y) by `deg` (clockwise on screen) around (cx, cy).
export function rotPt(x, y, cx, cy, deg) {
  if (!deg) return [x, y];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// Axis-aligned box around a w×h box at (x, y) turned by deg around its centre.
function turnedBox(x, y, w, hh, deg) {
  if (!deg) return [x, y, x + w, y + hh];
  const cx = x + w / 2, cy = y + hh / 2;
  const a = (deg * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (w * c + hh * s) / 2, hh2 = (w * s + hh * c) / 2;
  return [cx - hw, cy - hh2, cx + hw, cy + hh2];
}

// Does the eraser segment (a→b, radius r) touch the rectangle b = [x0, y0, x1, y1]?
function segTouchesRect(ax, ay, bx, by, r, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, r / 2)));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
    const dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]);
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

// Eraser end of the pen (32) or its side button (2) pressed.
function penButton(e) {
  return !!((e.buttons & 32) || (e.buttons & 2) || e.button === 5 || e.button === 2);
}

export function textBBox(t) {
  // Height comes from the line count measured on screen (kept up to date by the editor).
  const lines = Math.max(1, t.lines || String(t.text || '').split('\n').length);
  const hh = t.h > 0 ? t.h : lines * t.fs * LINE_H;
  return turnedBox(t.x, t.y, t.w, hh, t.r);
}

export function itemBBox(it) {
  if (it.type === 'table') {
    const w = (it.cw || []).reduce((a, b) => a + b, 0);
    const hh = (it.rh || []).reduce((a, b) => a + b, 0) || (it.cells || []).length * (it.fs || 12) * 2;
    return [it.x, it.y, it.x + w, it.y + hh];
  }
  if (it.r) {
    // Rotated picture: the box around its rotated corners.
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const a = (it.r * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (it.w * c + it.h * s) / 2, hh = (it.w * s + it.h * c) / 2;
    return [cx - hw, cy - hh, cx + hw, cy + hh];
  }
  return [it.x, it.y, it.x + (it.w || 0), it.y + (it.h || 0)];
}

function unionBox(a, b) {
  return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice();
}

function transformItem(it, s, tx, ty) {
  const out = { ...it, x: round2(it.x * s + tx), y: round2(it.y * s + ty) };
  if (it.type === 'table') {
    out.cw = it.cw.map((w) => round2(w * s));
    if (it.rh) out.rh = it.rh.map((x) => round2(x * s));
    out.fs = round2((it.fs || 12) * s);
  } else {
    out.w = round2(it.w * s);
    out.h = round2(it.h * s);
  }
  return out;
}

export class Tools {
  constructor(editor) {
    this.editor = editor;
    this.viewer = editor.viewer;
    this.state = editor.toolState;
    this.cur = null;        // active gesture
    this.sel = null;        // current selection
    this.clip = null;       // internal clipboard
    this.spaceHeld = false;
    this.lastPointer = null; // last pointer position over the pages (for paste placement)
    this.eraserCursor = h('div', { class: 'eraser-cursor' });
    this.laser = new Laser(this);
    this.textSel = new TextSelection(this, uid);
    this.laser.attach(editor.viewerHost);
    const s = this.viewer.scroller;
    s.addEventListener('pointerdown', (e) => this.onDown(e));
    s.addEventListener('pointermove', (e) => this.onMove(e));
    s.addEventListener('pointerup', (e) => this.onUp(e));
    s.addEventListener('pointercancel', (e) => this.onUp(e, true));
    s.addEventListener('pointerleave', () => { if (!this.cur) this.eraserCursor.remove(); if (!this.laser.active) { this.laser.dot = null; this.laser.kick(); } });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('lostpointercapture', (e) => { if (this.cur && this.cur.pointerId === e.pointerId) this.onUp(e, true); });
    s.addEventListener('dblclick', (e) => this.onDoubleClick(e));
  }

  get tool() { return this.state.tool; }
  get selecting() { return this.tool === 'select' || this.tool === 'lasso'; }

  // ---------- dispatch ----------
  onDown(e) {
    this.notePen(e);
    if (this.cur) return;
    const target = e.target;
    // Interactive elements inside pages handle themselves.
    if (target.closest('.sel-toolbar, .tb-handle, .table-tools')) return;
    if (target.isContentEditable) return; // editing text / a table cell
    if (this.tool === 'text' && target.closest('.textbox')) return;

    const isPen = e.pointerType === 'pen';
    const drawTool = ['pen', 'hl', 'eraser', 'shape'].includes(this.tool);
    // Fill & sign: the next click places the signature / date / ✓ (any pointer, any tool)
    if (this.editor.placing && e.button !== 1 && !this.spaceHeld) {
      const hit = this.viewer.hit(e.clientX, e.clientY);
      if (hit) { e.preventDefault(); return placeAt(this.editor, hit); }
    }
    const wantsPan = e.button === 1 || this.spaceHeld || this.tool === 'hand' || e.pointerType === 'touch' ||
      (e.pointerType === 'mouse' && e.button === 0 && !this.editor.settings.mouseDraws && drawTool);
    if (wantsPan) return this.startPan(e);
    // Some tablet drivers turn the pen's side button into a right mouse click:
    // a right click right after pen use is the pen button → erase.
    const penAsMouse = e.pointerType === 'mouse' && e.button === 2 && performance.now() - (this.lastPenAt || -1e9) < 1500;
    if (e.pointerType === 'mouse' && e.button !== 0 && !penAsMouse) return;
    // Text tool while a box is being edited: the first tap elsewhere only
    // finishes editing (the frame disappears); the next one starts a new box.
    const wasEditingText = !!this.editor.textEdit;
    this.editor.finishEditing();
    if (this.tool === 'text' && wasEditingText && !e.target.closest('.textbox')) {
      e.preventDefault();
      this.editor.finishEditing(true);
      if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
      this.viewer.scroller.focus({ preventScroll: true });
      return;
    }

    let tool = this.tool;
    const barrel = (isPen && penButton(e)) || penAsMouse;
    // Pen button pressed while the pen hovers: erase once it touches (see onMove).
    if (barrel && e.pressure === 0 && !(e.buttons & 1) && this.penHasPressure) { this.penButtonHeld = e.pointerId; e.preventDefault(); return; }
    if (barrel) tool = 'eraser'; // eraser end / side button held: erase until released

    // Handles / dragging inside the current selection
    if (this.sel && (tool === 'lasso' || tool === 'select')) {
      if (target.closest('.sel-rotate')) return this.startSelTransform(e, 'rotate');
      const handle = target.closest('.sel-handle');
      if (handle) return this.startSelTransform(e, 'scale', handle.dataset.corner);
      if (this.selContains(e)) return this.startSelTransform(e, 'move');
    }
    if (this.sel) this.clearSelection();
    this.textSel.clear();
    if (tool === 'laser') { e.preventDefault(); return this.laser.down(e); }

    const hit = this.viewer.hit(e.clientX, e.clientY);
    if (!hit) return;
    const view = this.viewer.view(hit.index);
    if (!view) return;
    e.preventDefault();
    this.viewer.scroller.focus({ preventScroll: true });

    switch (tool) {
      case 'select': return this.startSelect(e, hit, view);
      case 'pen': case 'hl': return this.startStroke(e, hit, view, tool);
      case 'eraser': this.startErase(e, hit, view); if (barrel && this.cur) this.cur.viaButton = true; return;
      case 'lasso': return this.startLasso(e, hit, view);
      case 'shape': return this.startShape(e, hit, view);
      case 'text': {
        // Text tool on a table: type into that cell.
        const cell = this.cellAt(e.clientX, e.clientY);
        const obj = cell && this.objectAt(hit.page.id, hit.x, hit.y);
        if (cell && obj && obj.kind === 'item') return this.editor.editCell(hit.page.id, obj.id, +cell.dataset.r, +cell.dataset.c);
        return this.createText(hit);
      }
    }
  }

  // remember what the pen can do (pressure? last use?) for the pen button
  notePen(e) {
    if (e.pointerType !== 'pen') return;
    this.lastPenAt = performance.now();
    if (e.pressure > 0 && e.pressure < 1 && e.pressure !== 0.5) this.penHasPressure = true;
  }

  onMove(e) {
    this.notePen(e);
    if (this.tool === 'laser') this.laser.move(e);
    const hit = this.viewer.hit(e.clientX, e.clientY);
    if (hit) this.lastPointer = { index: hit.index, x: hit.x, y: hit.y };
    if (hit && !this.cur && (this.tool === 'select' || this.tool === 'hl')) peekLayout(this.editor, hit.page); // ready before the click
    if (this.tool === 'eraser' || (this.cur && this.cur.kind === 'erase') || (e.pointerType === 'pen' && penButton(e))) this.moveEraserCursor(e);
    else if (e.pointerType === 'pen' && this.eraserCursor.isConnected && this.tool !== 'eraser') this.eraserCursor.remove();
    if (e.pointerType === 'pen' && this.penButtonSwitch(e)) return;
    const c = this.cur;
    if (!c || c.pointerId !== e.pointerId) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    switch (c.kind) {
      case 'pan': {
        const s = this.viewer.scroller;
        const want = c.st - (e.clientY - c.y);
        s.scrollLeft = c.sl - (e.clientX - c.x);
        s.scrollTop = want;
        // Pulling past the end with the hand (or a finger) adds a page, like scrolling on.
        if (want > s.scrollHeight - s.clientHeight + 4) this.viewer.pullPastEnd();
        else this.viewer.resetOverscroll();
        break;
      }
      case 'stroke': for (const ev of events.length ? events : [e]) this.addPoint(ev); this.requestLive(); break;
      case 'erase': for (const ev of events.length ? events : [e]) this.eraseTo(ev); break;
      case 'lasso': this.lassoTo(e); break;
      case 'band': this.bandTo(e); break;
      case 'ptext': { const [x, y] = this.pagePoint(c, e); this.textSel.move(x, y); break; }
      case 'shape': this.shapeTo(e); break;
      case 'seltransform': this.selTransformTo(e); break;
    }
  }

  onUp(e, cancelled = false) {
    if (this.laser.active) this.laser.up(e);
    const c = this.cur;
    if (!c || c.pointerId !== e.pointerId) return;
    this.cur = null;
    try { this.viewer.scroller.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    switch (c.kind) {
      case 'pan': this.viewer.scroller.classList.remove('panning'); this.viewer.resetOverscroll(); break;
      case 'stroke': this.endStroke(c, cancelled); break;
      case 'erase': this.endErase(c); break;
      case 'lasso': this.endLasso(c); break;
      case 'band': this.endBand(c); break;
      case 'ptext': if (!cancelled) this.textSel.end(e); else this.textSel.clear(); break;
      case 'shape': this.endShape(c, cancelled); break;
      case 'seltransform': this.endSelTransform(c, cancelled); break;
    }
  }

  // Pen side button / eraser end = eraser for as long as it is held, also
  // when pressed or released in the middle of a line; then back to the pen.
  penButtonSwitch(e) {
    const held = penButton(e);
    // Pens without pressure (no Windows Ink) report 0 even on the paper: then
    // "button held" has to count as touching, otherwise erasing stops at once.
    const touching = e.pressure > 0 || !!(e.buttons & 1) || (held && !this.penHasPressure);
    const c = this.cur;
    if (!held && this.penButtonHeld === e.pointerId && !c) this.penButtonHeld = null;
    if (!c && held && touching && this.penButtonHeld === e.pointerId) {
      // button was pressed while hovering, now the pen touches: erase
      const hit = this.viewer.hit(e.clientX, e.clientY);
      const view = hit && this.viewer.view(hit.index);
      if (!view) return true;
      if (this.sel) this.clearSelection();
      this.startErase(e, hit, view);
      this.cur.viaButton = true;
      return true;
    }
    if (!c || c.pointerId !== e.pointerId) return false;
    if (c.kind === 'erase' && c.viaButton && !touching) { this.onUp(e); this.penButtonHeld = held ? e.pointerId : null; return true; }
    const drawing = c.kind === 'stroke';
    if ((drawing && held) || (c.kind === 'erase' && c.viaButton && !held && touching && ['pen', 'hl'].includes(this.tool))) {
      this.onUp(e); // finish what was being done …
      const hit = this.viewer.hit(e.clientX, e.clientY);
      const view = hit && this.viewer.view(hit.index);
      if (!view) return true;
      if (held) { this.startErase(e, hit, view); this.cur.viaButton = true; } // … and continue with the other one
      else this.startStroke(e, hit, view, this.tool);
      return true;
    }
    return false;
  }

  capture(e) {
    try { this.viewer.scroller.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  pagePoint(c, ev) {
    const r = c.rect;
    return [(ev.clientX - r.left) / this.viewer.zoom, (ev.clientY - r.top) / this.viewer.zoom];
  }

  // ---------- panning ----------
  startPan(e) {
    e.preventDefault();
    const s = this.viewer.scroller;
    this.cur = { kind: 'pan', pointerId: e.pointerId, x: e.clientX, y: e.clientY, sl: s.scrollLeft, st: s.scrollTop };
    s.classList.add('panning');
    this.capture(e);
  }

  // ---------- object hit testing (select tool) ----------
  objectAt(pageId, x, y) {
    const d = this.editor.pageData(pageId);
    const tol = 6 / this.viewer.zoom;
    const hitObj = ({ kind, obj }) => {
      const b = kind === 'text' ? textBBox(obj) : itemBBox(obj);
      const t = kind === 'text' ? tol : 0;
      if (!(x >= b[0] - t && x <= b[2] + t && y >= b[1] - t && y <= b[3] + t)) return false;
      // Pictures: only where they are not transparent (clicks go through to what is behind).
      return kind !== 'item' || obj.type !== 'img' || this.editor.imageHit(obj, x, y, tol);
    };
    // Top to bottom: front objects, ink, back objects.
    const front = stacked(d, 'f');
    for (let i = front.length - 1; i >= 0; i--) if (hitObj(front[i])) return { kind: front[i].kind, id: front[i].obj.id };
    let best = null;
    for (let i = d.strokes.length - 1; i >= 0; i--) {
      const st = d.strokes[i];
      const b = strokeBBox(st);
      if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
      const dist = distToStroke(st, x, y) - st.s / 2;
      if (dist <= tol && (!best || dist < best.dist)) best = { kind: 'stroke', id: st.id, dist };
    }
    if (best) return best;
    const back = stacked(d, 'b');
    for (let i = back.length - 1; i >= 0; i--) if (hitObj(back[i])) return { kind: back[i].kind, id: back[i].obj.id };
    return null;
  }

  startSelect(e, hit, view) {
    const obj = this.objectAt(hit.page.id, hit.x, hit.y);
    if (obj) {
      const ids = { stroke: new Set(), text: new Set(), item: new Set() };
      ids[obj.kind].add(obj.id);
      this.select(hit.index, hit.page.id, ids.stroke, ids.text, ids.item);
      if (this.sel) this.startSelTransform(e, 'move');
      return;
    }
    // On printed PDF text: select the text (copy / highlight / underline).
    if (this.textSel.start(e, hit, view)) {
      this.cur = { kind: 'ptext', pointerId: e.pointerId, rect: this.viewer.pageClientRect(hit.index) };
      this.capture(e);
      return;
    }
    // Empty spot: rubber-band selection.
    const band = h('div', { class: 'band-rect' });
    view.overlay.append(band);
    this.cur = { kind: 'band', pointerId: e.pointerId, view, index: hit.index, pageId: hit.page.id, rect: this.viewer.pageClientRect(hit.index), start: [hit.x, hit.y], end: [hit.x, hit.y], band };
    this.capture(e);
  }

  bandTo(e) {
    const c = this.cur;
    c.end = this.pagePoint(c, e);
    const z = this.viewer.zoom;
    const [x0, y0] = c.start, [x1, y1] = c.end;
    Object.assign(c.band.style, {
      left: (Math.min(x0, x1) - c.view.ox) * z + 'px', top: (Math.min(y0, y1) - c.view.oy) * z + 'px',
      width: Math.abs(x1 - x0) * z + 'px', height: Math.abs(y1 - y0) * z + 'px',
    });
  }

  endBand(c) {
    c.band.remove();
    const [x0, y0] = c.start, [x1, y1] = c.end;
    const r = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    if (r[2] - r[0] < 2 && r[3] - r[1] < 2) return;
    const d = this.editor.pageData(c.pageId);
    const poly = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    const strokeIds = new Set(d.strokes.filter((st) => rectsIntersect(strokeBBox(st), r) && strokeInLasso(st, poly)).map((s) => s.id));
    const textIds = new Set(d.texts.filter((t) => rectsIntersect(textBBox(t), r)).map((t) => t.id));
    const itemIds = new Set(d.items.filter((it) => rectsIntersect(itemBBox(it), r)).map((it) => it.id));
    this.select(c.index, c.pageId, strokeIds, textIds, itemIds);
  }

  // The table cell under a screen point (the selection frame may lie on top).
  cellAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      const td = el.closest && el.closest('td[data-r]');
      if (td) return td;
    }
    return null;
  }

  onDoubleClick(e) {
    if (this.tool !== 'select') return;
    const hit = this.viewer.hit(e.clientX, e.clientY);
    if (!hit) return;
    const cell = this.cellAt(e.clientX, e.clientY);
    const obj = this.objectAt(hit.page.id, hit.x, hit.y);
    if (!obj) return;
    if (obj.kind === 'text') {
      this.clearSelection();
      this.editor.editText(hit.page.id, obj.id, { x: e.clientX, y: e.clientY });
    } else if (obj.kind === 'item' && cell) {
      this.clearSelection();
      this.editor.editCell(hit.page.id, obj.id, +cell.dataset.r, +cell.dataset.c);
    }
  }

  // ---------- pen / highlighter ----------
  startStroke(e, hit, view, tool) {
    const opts = tool === 'hl' ? this.state.hl : this.state.pen;
    const st = { id: uid(), t: tool === 'hl' ? 'hl' : 'pen', c: opts.color, s: opts.size, p: [], pf: 1 };
    if (tool === 'pen' && opts.style && opts.style !== 'ball') st.ps = opts.style;
    const live = view.makeRegionCanvas('live-canvas');
    this.cur = {
      kind: 'stroke', pointerId: e.pointerId, view, index: hit.index, pageId: hit.page.id, st, live,
      rect: this.viewer.pageClientRect(hit.index), isPen: e.pointerType === 'pen',
      straight: tool === 'hl' && this.state.hl.straight, holdAnchor: [e.clientX, e.clientY], snapped: false,
      pressures: new Set(),
      // pen jitter filter (a mouse doesn't shake; "Smooth my handwriting" filters it too)
      filter: (tool === 'hl' && this.state.hl.straight) || (e.pointerType !== 'pen' && !this.editor.settings.smoothInk)
        ? null : new PenFilter(this.editor.settings.smoothInk ? 1 : 0.5),
    };
    this.capture(e);
    this.addPoint(e);
    this.armHold(e);
    this.requestLive();
  }

  addPoint(ev) {
    const c = this.cur;
    if (!c || c.snapped) return;
    // filtered pen position (removes jitter, keeps curls – see pen-filter.js)
    const [fx, fy] = c.filter ? c.filter.push(ev.clientX, ev.clientY, ev.timeStamp) : [ev.clientX, ev.clientY];
    if (c.filter) c.rawEnd = this.pagePoint(c, ev); // where the pen really is (added when it lifts)
    const [x, y] = this.pagePoint(c, { clientX: fx, clientY: fy });
    let pr = c.isPen ? ev.pressure : 0.5;
    if (c.isPen && pr === 0) pr = 0.5; // some drivers send 0 on the first event
    pr = Math.max(0.05, Math.min(1, pr));
    c.pressures.add(Math.round(pr * 100));
    // Tablet pressure is noisy: smooth it a little so the width doesn't flicker.
    if (c.isPen) pr = c.prSmooth = c.prSmooth == null ? pr : c.prSmooth + 0.4 * (pr - c.prSmooth);
    const p = c.st.p;
    if (c.straight && p.length >= 6) p.length = 3;
    const n = p.length;
    if (n >= 3 && !c.straight) {
      // points closer than ~1 screen pixel only add jitter to the tip's direction
      const dx = x - p[n - 3], dy = y - p[n - 2];
      if (dx * dx + dy * dy < (1 / this.viewer.zoom) ** 2) return;
    }
    p.push(round2(x), round2(y), Math.round(pr * 1000) / 1000);
    if (Math.hypot(ev.clientX - c.holdAnchor[0], ev.clientY - c.holdAnchor[1]) > 4) {
      c.holdAnchor = [ev.clientX, ev.clientY];
      this.armHold(ev);
    }
  }

  armHold() {
    const c = this.cur;
    clearTimeout(this.holdTimer);
    if (!c || c.kind !== 'stroke' || c.st.t !== 'pen' || !this.editor.settings.shapeHold) return;
    this.holdTimer = setTimeout(() => {
      if (this.cur !== c || c.snapped) return;
      const pts = [];
      for (let i = 0; i < c.st.p.length; i += 3) pts.push([c.st.p[i], c.st.p[i + 1]]);
      const r = recognizeShape(pts);
      if (!r) return;
      c.snapped = true;
      c.st.sh = 1;
      c.st.shape = r.type; // which shape it was recognised as
      // the pen type (pencil, neon, brush …), colour and width are kept
      c.st.p = r.points.flatMap(([x, y]) => [round2(x), round2(y), 0.5]);
      this.requestLive();
    }, HOLD_MS);
  }

  requestLive() {
    if (this._liveRaf) return;
    this._liveRaf = requestAnimationFrame(() => {
      this._liveRaf = 0;
      const c = this.cur;
      if (!c) return;
      if (c.kind === 'stroke') {
        // same pressure rule as the finished stroke, so nothing changes when the pen lifts
        if (!c.isPen || c.pressures.size <= 1) c.st.np = 1; else delete c.st.np;
        drawLive(c.live.ctx, c.st, c.live.scale, c.live.rect);
      } else if (c.kind === 'shape') {
        c.live.ctx.setTransform(1, 0, 0, 1, 0, 0);
        c.live.ctx.clearRect(0, 0, c.live.canvas.width, c.live.canvas.height);
        for (const st of c.strokes) drawLive(c.live.ctx, st, c.live.scale, c.live.rect, false);
      }
    });
  }

  endStroke(c, cancelled) {
    clearTimeout(this.holdTimer);
    releaseCanvas(c.live.canvas);
    if (cancelled && c.st.p.length < 9) return;
    const st = c.st;
    // after a fast flick the filter lags behind: the line ends where the pen
    // was lifted (small gaps are just jitter – those stay smoothed)
    if (c.rawEnd && !c.snapped && !c.straight && st.p.length >= 3) {
      const n = st.p.length, [x, y] = c.rawEnd;
      if (Math.hypot(x - st.p[n - 3], y - st.p[n - 2]) > Math.max(1.5, st.s)) st.p.push(round2(x), round2(y), st.p[n - 1]);
    }
    if (!c.isPen || c.pressures.size <= 1) st.np = 1;
    if (st.p.length === 3) st.p.push(st.p[0] + 0.01, st.p[1] + 0.01, st.p[2]); // a dot
    // Settings → "Smooth my handwriting": even out the finished line a little more
    else if (this.editor.settings.smoothInk && st.t === 'pen' && !st.sh) st.p = smoothStroke(st.p);
    // Highlighter over printed PDF text: snap to the text lines (like GoodNotes)
    if (st.t === 'hl' && this.state.hl.snap !== false) {
      const page = this.viewer.pages[c.index];
      const layout = peekLayout(this.editor, page);
      const n = st.p.length;
      const a = charAt(layout, st.p[0], st.p[1], true), b = charAt(layout, st.p[n - 3], st.p[n - 2], true);
      // only a mark along the text: both ends on a text line, mostly horizontal
      const along = Math.abs(st.p[n - 3] - st.p[0]) > 2 * Math.abs(st.p[n - 2] - st.p[1]);
      if (a && b && along) {
        const span = spanBetween(layout, a, b);
        if (span.rects.length) {
          const strokes = highlightStrokes(span.rects, st.c, uid);
          const before = this.editor.pageData(c.pageId);
          this.editor.commit(c.pageId, before, { ...before, strokes: before.strokes.concat(strokes) });
          this.editor.rememberPen('hl');
          return;
        }
      }
    }
    if (c.straight && st.p.length === 6) {
      const [a, b] = snapAngle([st.p[0], st.p[1]], [st.p[3], st.p[4]]);
      st.p = [round2(a[0]), round2(a[1]), 0.5, round2(b[0]), round2(b[1]), 0.5];
    }
    // Scribble over ink to erase it (Settings → "Scribble to erase")
    if (st.t === 'pen' && !st.sh && this.editor.settings.scribbleErase !== false && isScribble(st)) {
      const data = this.editor.pageData(c.pageId);
      const p = st.p, r = Math.max(st.s, 2) / 2;
      // only ink the scribble really covers: touched, and its middle lies
      // inside the scribbled area (a long line merely crossed stays)
      const sb = strokeBBox(st), padX = (sb[2] - sb[0]) * 0.2, padY = (sb[3] - sb[1]) * 0.2;
      const hit = new Set(data.strokes.filter((o) => {
        const b = strokeBBox(o);
        // most of that ink must lie inside the scribbled area (hatching inside a
        // drawing, or shading next to it, doesn't delete the drawing)
        const ix = Math.max(0, Math.min(b[2], sb[2] + padX) - Math.max(b[0], sb[0] - padX));
        const iy = Math.max(0, Math.min(b[3], sb[3] + padY) - Math.max(b[1], sb[1] - padY));
        const area = Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
        if ((ix * iy) / area < 0.7) return false;
        for (let i = 0; i + 3 < p.length; i += 3) if (strokeHit(o, p[i], p[i + 1], p[i + 3], p[i + 4], r)) return true;
        return false;
      }).map((o) => o.id));
      if (hit.size) {
        this.editor.commit(c.pageId, data, { ...data, strokes: data.strokes.filter((o) => !hit.has(o.id)) });
        this.editor.toast(`Erased by scribbling – Ctrl+Z brings it back`);
        return;
      }
    }
    this.editor.addStroke(c.pageId, { ...st, p: st.p.slice() });
    this.editor.rememberPen(st.t === 'hl' ? 'hl' : 'pen');
  }

  // ---------- shapes tool (drag) ----------
  startShape(e, hit, view) {
    this.cur = {
      kind: 'shape', pointerId: e.pointerId, view, index: hit.index, pageId: hit.page.id, strokes: [],
      live: view.makeRegionCanvas('live-canvas'), rect: this.viewer.pageClientRect(hit.index), start: [hit.x, hit.y],
    };
    this.capture(e);
  }

  shapeTo(e) {
    const c = this.cur;
    let [x, y] = this.pagePoint(c, e);
    const [x0, y0] = c.start;
    const kind = this.state.shape.kind;
    let polys;
    if (LINE_SHAPES.includes(kind)) {
      let b = [x, y];
      if (!e.altKey) b = snapAngle([x0, y0], [x, y])[1]; // snaps to 0°/45°/90° within 6°; hold Alt for free angles
      polys = shapeStrokes(kind, [[x0, y0], b]);
    } else {
      if (e.shiftKey) { const d = Math.max(Math.abs(x - x0), Math.abs(y - y0)); x = x0 + Math.sign(x - x0 || 1) * d; y = y0 + Math.sign(y - y0 || 1) * d; }
      const box = [Math.min(x0, x), Math.min(y0, y), Math.max(x0, x), Math.max(y0, y)];
      polys = kind === 'ellipse'
        ? shapeStrokes('ellipse', [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, (box[2] - box[0]) / 2, (box[3] - box[1]) / 2])
        : shapeStrokes(kind, box);
    }
    const opts = this.state.pen;
    const fill = this.state.shape.fill;
    c.strokes = polys.map((pts, k) => ({
      id: c.strokes[k] ? c.strokes[k].id : uid(), t: 'pen', c: opts.color, s: opts.size, sh: 1, np: 1, ...(opts.style && opts.style !== 'ball' ? { ps: opts.style } : {}),
      p: pts.flatMap(([px, py]) => [round2(px), round2(py), 0.5]),
      ...(fill ? { f: fill } : {}), // only drawn when the shape is closed
    }));
    this.requestLive();
  }

  endShape(c, cancelled) {
    releaseCanvas(c.live.canvas);
    if (cancelled || !c.strokes.length) return;
    let b = null;
    for (const st of c.strokes) b = unionBox(b, strokeBBox(st));
    if (b[2] - b[0] < 3 && b[3] - b[1] < 3) return;
    this.editor.addStrokes(c.pageId, c.strokes.map((st) => ({ ...st, p: st.p.slice() })));
  }

  // ---------- eraser ----------
  eraserRadius() { return this.state.eraser.size / 2 / this.viewer.zoom; }

  moveEraserCursor(e) {
    const d = this.state.eraser.size;
    const s = this.eraserCursor.style;
    s.width = s.height = d + 'px';
    s.left = e.clientX - d / 2 + 'px';
    s.top = e.clientY - d / 2 + 'px';
    if (!this.eraserCursor.isConnected) document.body.append(this.eraserCursor);
  }

  startErase(e, hit, view) {
    const data = this.editor.pageData(hit.page.id);
    this.cur = {
      kind: 'erase', pointerId: e.pointerId, view, index: hit.index, pageId: hit.page.id,
      rect: this.viewer.pageClientRect(hit.index), last: [hit.x, hit.y], before: data, changed: false,
    };
    this.capture(e);
    this.moveEraserCursor(e);
    this.eraseTo(e);
  }

  eraseTo(ev) {
    const c = this.cur;
    const [x, y] = this.pagePoint(c, ev);
    const [lx, ly] = c.last;
    c.last = [x, y];
    const r = this.eraserRadius();
    const { mode, hlOnly, exact, objects } = this.state.eraser;
    const data = this.editor.pageData(c.pageId);
    let out = null;
    data.strokes.forEach((st, i) => {
      if (hlOnly && st.t !== 'hl') return;
      if (mode === 'stroke') {
        if (strokeHit(st, lx, ly, x, y, r)) { out = out || data.strokes.slice(0, i); return; }
      } else {
        const pieces = eraseFromStroke(st, lx, ly, x, y, r, !!exact);
        if (pieces) {
          out = out || data.strokes.slice(0, i);
          for (const pc of pieces) {
            const n = { ...st, id: uid(), p: pc.p.map(round2) };
            const k = mapCuts(pc.k, (px, py) => [px, py]);
            if (k) n.k = k; else delete n.k;
            out.push(n);
          }
          return;
        }
      }
      if (out) out.push(st);
    });
    // Option: the eraser also removes text boxes and pictures it touches.
    let texts = data.texts, items = data.items;
    if (objects && !hlOnly) {
      const touches = (b) => segTouchesRect(lx, ly, x, y, r, b);
      texts = data.texts.filter((t) => !touches(textBBox(t)));
      items = data.items.filter((it) => !touches(itemBBox(it)));
    }
    if (out || texts.length !== data.texts.length || items.length !== data.items.length) {
      c.changed = true;
      this.editor.setPageData(c.pageId, { ...data, strokes: out || data.strokes, texts, items }, { redraw: 'frame' });
    }
  }

  endErase(c) {
    if (c.changed) this.editor.pushUndo(c.pageId, c.before, this.editor.pageData(c.pageId));
  }

  // ---------- lasso ----------
  startLasso(e, hit, view) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lasso-svg');
    svg.setAttribute('viewBox', `${view.ox} ${view.oy} ${view.page.w} ${view.page.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    svg.append(poly);
    view.overlay.append(svg);
    this.cur = {
      kind: 'lasso', pointerId: e.pointerId, view, index: hit.index, pageId: hit.page.id,
      rect: this.viewer.pageClientRect(hit.index), pts: [[hit.x, hit.y]], svg, poly,
    };
    this.capture(e);
  }

  lassoTo(e) {
    const c = this.cur;
    const p = this.pagePoint(c, e);
    const last = c.pts[c.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5 / this.viewer.zoom) return;
    c.pts.push(p);
    c.poly.setAttribute('points', c.pts.map((q) => q.join(',')).join(' '));
  }

  endLasso(c) {
    c.svg.remove();
    if (c.pts.length < 3) return;
    const data = this.editor.pageData(c.pageId);
    const centerIn = (b) => pointInPolygon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, c.pts);
    const strokeIds = new Set(data.strokes.filter((st) => strokeInLasso(st, c.pts)).map((st) => st.id));
    const textIds = new Set(data.texts.filter((t) => centerIn(textBBox(t))).map((t) => t.id));
    const itemIds = new Set(data.items.filter((it) => centerIn(itemBBox(it))).map((it) => it.id));
    this.select(c.index, c.pageId, strokeIds, textIds, itemIds);
  }

  // ---------- selection ----------
  select(index, pageId, strokeIds, textIds, itemIds = new Set()) {
    this.clearSelection(true);
    const view = this.viewer.view(index);
    if (!view) return;
    const data = this.editor.pageData(pageId);
    // Grouped objects are always selected together.
    const groups = new Set();
    for (const [list, ids] of [[data.strokes, strokeIds], [data.texts, textIds], [data.items, itemIds]]) {
      for (const o of list) if (o.g && ids.has(o.id)) groups.add(o.g);
    }
    if (groups.size) {
      strokeIds = new Set(strokeIds); textIds = new Set(textIds); itemIds = new Set(itemIds);
      for (const [list, ids] of [[data.strokes, strokeIds], [data.texts, textIds], [data.items, itemIds]]) {
        for (const o of list) if (o.g && groups.has(o.g)) ids.add(o.id);
      }
    }
    const strokes = data.strokes.filter((s) => strokeIds.has(s.id));
    const texts = data.texts.filter((t) => textIds.has(t.id));
    const items = data.items.filter((it) => itemIds.has(it.id));
    if (!strokes.length && !texts.length && !items.length) { this.editor.onSelectionChange(false); return; }
    let b = null;
    for (const st of strokes) b = unionBox(b, strokeBBox(st));
    for (const t of texts) b = unionBox(b, textBBox(t));
    for (const it of items) b = unionBox(b, itemBBox(it));

    // Selected strokes are drawn on their own canvas so moving/scaling is just a CSS transform.
    view.inkSkip = strokeIds;
    view.drawInk(true);
    const reg = view.makeRegionCanvas('sel-canvas');
    drawStrokes(reg.ctx, strokes, reg.scale, { ox: -reg.rect[0] * reg.scale, oy: -reg.rect[1] * reg.scale });

    const box = h('div', { class: 'sel-box' },
      ...['nw', 'ne', 'sw', 'se'].map((corner) => h('div', { class: `sel-handle ${corner}`, dataset: { corner } })));
    // Anything except tables can be turned with the round handle under it.
    if (!items.some((it) => it.type === 'table')) box.append(h('div', { class: 'sel-rotate', title: 'Drag to rotate (snaps to 0°, 90°, 180°, 270°; Shift = 15° steps)' }));
    const domEls = [
      ...texts.map((t) => view.el.querySelector(`.textbox-wrap[data-id="${t.id}"]`)),
      ...items.map((it) => view.el.querySelector(`.item[data-id="${it.id}"]`)),
    ].filter(Boolean);
    domEls.forEach((el) => el.classList.add('selected'));
    this.sel = { index, pageId, view, strokeIds, textIds, itemIds, bbox: b, canvas: reg.canvas, canvasRect: reg.rect, box, bar: null, domEls };
    this.sel.bar = this.selectionToolbar();
    // Only text boxes selected: the floating text bar takes over.
    if (texts.length && !strokes.length && !items.length) this.sel.bar.classList.add('hidden');
    view.overlay.append(box, this.sel.bar);
    this.positionSelection();
    this.editor.onSelectionChange(true);
  }

  selectedObjects() {
    const sel = this.sel;
    const d = this.editor.pageData(sel.pageId);
    return {
      strokes: d.strokes.filter((s) => sel.strokeIds.has(s.id)),
      texts: d.texts.filter((t) => sel.textIds.has(t.id)),
      items: d.items.filter((it) => sel.itemIds.has(it.id)),
    };
  }

  selectionToolbar() {
    const btn = (ic, title, fn, cls = '') => h('button', { class: `icon-btn sm ${cls}`, title, html: icon(ic, 18), onclick: (e) => { e.stopPropagation(); fn(e); } });
    const tbtn = (label, title, fn, active) => h('button', { class: `chip sm${active ? ' active' : ''}`, title, onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
    const { strokes, texts, items } = this.selectedObjects();
    const tables = items.filter((it) => it.type === 'table');
    const parts = [
      btn('cut', 'Cut (Ctrl+X)', () => this.cut()),
      btn('copy', 'Copy (Ctrl+C)', () => this.copy()),
      btn('duplicate', 'Duplicate (Ctrl+D)', () => this.duplicate()),
      btn('trash', 'Delete (Del)', () => this.deleteSelection(), 'danger'),
    ];
    if (strokes.length || texts.length || tables.length) {
      parts.push(h('span', { class: 'sep' }),
        ...this.editor.quickColors().map((c) => h('button', {
          class: 'swatch sm', title: 'Colour', style: { background: c }, onclick: (e) => { e.stopPropagation(); this.restyle({ color: c }); },
        })),
        h('label', { class: 'swatch sm custom', title: 'Other colour' },
          h('input', { type: 'color', onchange: (e) => this.restyle({ color: e.target.value }) })));
    }
    if (strokes.length && !texts.length && !items.length) {
      parts.push(h('span', { class: 'sep' }), btn('minus', 'Thinner', () => this.restyle({ width: 0.8 })), btn('plus', 'Thicker', () => this.restyle({ width: 1.25 })));
    }
    const closed = strokes.filter((st) => isClosedShape(st));
    if (closed.length) {
      const cur = closed[0].f || null;
      parts.push(h('span', { class: 'sep' }), h('button', {
        class: 'chip sm fill-chip', title: 'Fill the inside of the shape',
        onclick: (e) => { e.stopPropagation(); this.editor.fillMenu(e.currentTarget, cur, (f) => this.restyle({ fill: f })); },
      }, h('span', { class: 'fill-prev' + (cur ? '' : ' none'), style: cur ? { background: cur } : {} }), 'Fill'));
    }
    if (texts.length || tables.length) {
      const all = [...texts, ...tables];
      const ff = all[0].ff || 'carlito';
      const fontBtn = h('button', { class: 'chip sm font-chip', title: 'Font', style: { fontFamily: `"${(FONTS[ff] || FONTS.carlito).css}"` },
        onclick: (e) => { e.stopPropagation(); this.fontMenu(e.currentTarget); } }, (FONTS[ff] || FONTS.carlito).label);
      const allB = texts.length && texts.every((t) => t.b), allI = texts.length && texts.every((t) => t.i), allU = texts.length && texts.every((t) => t.u);
      parts.push(h('span', { class: 'sep' }), fontBtn,
        btn('minus', 'Smaller text', () => this.restyle({ font: 1 / 1.15 })), btn('plus', 'Larger text', () => this.restyle({ font: 1.15 })));
      if (texts.length) {
        parts.push(
          tbtn(h('b', {}, 'B'), 'Bold (Ctrl+B)', () => this.restyle({ b: !allB }), allB),
          tbtn(h('i', {}, 'I'), 'Italic (Ctrl+I)', () => this.restyle({ i: !allI }), allI),
          tbtn(h('u', {}, 'U'), 'Underline (Ctrl+U)', () => this.restyle({ u: !allU }), allU));
      }
    }
    if (tables.length === 1 && !strokes.length && !texts.length && items.length === 1) {
      const t = tables[0];
      parts.push(h('span', { class: 'sep' }),
        tbtn('+ Row', 'Add row', () => this.editor.tableOp(this.sel.pageId, t.id, 'addRow')),
        tbtn('+ Col', 'Add column', () => this.editor.tableOp(this.sel.pageId, t.id, 'addCol')),
        tbtn('− Row', 'Remove last row', () => this.editor.tableOp(this.sel.pageId, t.id, 'delRow')),
        tbtn('− Col', 'Remove last column', () => this.editor.tableOp(this.sel.pageId, t.id, 'delCol')),
        tbtn('Header', 'First row as header', () => this.editor.tableOp(this.sel.pageId, t.id, 'header'), t.hdr));
    }
    const pics = items.filter((it) => it.type === 'img');
    if (pics.length === 1 && items.length === 1 && !strokes.length && !texts.length) {
      const it = pics[0];
      const op = h('input', { type: 'range', min: '10', max: '100', step: '5', value: String(Math.round((it.o ?? 1) * 100)), class: 'opacity-range', title: 'Transparency' });
      const pct = h('span', { class: 'opacity-val' }, Math.round((it.o ?? 1) * 100) + '%');
      op.addEventListener('pointerdown', (e) => e.stopPropagation());
      op.addEventListener('input', () => {
        pct.textContent = op.value + '%';
        const img = this.sel && this.sel.domEls[0] && this.sel.domEls[0].querySelector('img');
        if (img) img.style.opacity = String(op.value / 100);
      });
      op.addEventListener('change', () => this.restyleItem(it.id, { o: op.value >= 100 ? undefined : op.value / 100 }));
      parts.push(h('span', { class: 'sep' }),
        h('label', { class: 'opacity-box', title: 'Transparency' }, h('span', { class: 'opacity-ic', html: icon('opacity', 16) }), op, pct),
        h('button', { class: 'chip sm', title: 'Remove the background (works offline)', onclick: (e) => { e.stopPropagation(); this.editor.removePictureBackground(this.sel.pageId, it.id); } }, 'Remove background'));
    }
    if (!tables.length) {
      parts.push(h('span', { class: 'sep' }),
        btn('rotateL', 'Rotate left 90°', () => this.rotateSelection(-90)),
        btn('rotateR', 'Rotate right 90°', () => this.rotateSelection(90)));
    }
    const count = strokes.length + texts.length + items.length;
    const grouped = [...strokes, ...texts, ...items].some((o) => o.g);
    if (count > 1 || grouped) {
      parts.push(grouped
        ? btn('ungroup', 'Ungroup (Ctrl+Shift+G)', () => this.group(false))
        : btn('group', 'Group (Ctrl+G)', () => this.group(true)));
    }
    if (items.length || texts.length) {
      parts.push(h('span', { class: 'sep' }), btn('front', 'Bring to front', () => this.order(1)), btn('back', 'Send to back', () => this.order(-1)));
    }
    return h('div', { class: 'sel-toolbar' }, ...parts);
  }

  fontMenu(anchor) {
    showMenu(Object.entries(FONTS).map(([id, f]) => ({ label: f.label, onClick: () => this.restyle({ ff: id }) })), 0, 0, anchor);
  }

  positionSelection(tx = 0, ty = 0, s = 1, ax = 0, ay = 0) {
    const sel = this.sel;
    const z = this.viewer.zoom;
    const { ox, oy } = sel.view;
    const [x0, y0, x1, y1] = sel.bbox;
    const nx0 = ax + (x0 - ax) * s + tx, ny0 = ay + (y0 - ay) * s + ty;
    const nx1 = ax + (x1 - ax) * s + tx, ny1 = ay + (y1 - ay) * s + ty;
    const pad = 6;
    Object.assign(sel.box.style, {
      left: (nx0 - ox) * z - pad + 'px', top: (ny0 - oy) * z - pad + 'px',
      width: (nx1 - nx0) * z + pad * 2 + 'px', height: (ny1 - ny0) * z + pad * 2 + 'px',
    });
    Object.assign(sel.bar.style, { left: Math.max(0, (nx0 - ox) * z) + 'px', top: Math.max(-44, (ny0 - oy) * z - pad - 46) + 'px' });
    // p' = a + (p - a)·s + t. For an element whose top-left is at E:
    // translate((a - E)(1 - s) + t) scale(s), origin at the element's top-left.
    const R = sel.canvasRect;
    sel.canvas.style.transformOrigin = '0 0';
    sel.canvas.style.transform = `translate(${((ax - R[0]) * (1 - s) + tx) * z}px, ${((ay - R[1]) * (1 - s) + ty) * z}px) scale(${s})`;
    for (const el of sel.domEls) {
      el.style.transformOrigin = '0 0';
      // DOM layers are already scaled by zoom: translate in page units.
      el.style.transform = `translate(${(ax - el._x) * (1 - s) + tx}px, ${(ay - el._y) * (1 - s) + ty}px) scale(${s})`;
    }
  }

  selContains(e) {
    const r = this.sel.box.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  startSelTransform(e, mode, corner) {
    e.preventDefault();
    const sel = this.sel;
    const [x0, y0, x1, y1] = sel.bbox;
    const anchor = { nw: [x1, y1], ne: [x0, y1], sw: [x1, y0], se: [x0, y0] }[corner] || [0, 0];
    const d = this.editor.pageData(sel.pageId);
    for (const el of sel.domEls) {
      const o = d.texts.find((q) => q.id === el.dataset.id) || d.items.find((q) => q.id === el.dataset.id);
      el._x = o ? o.x : 0; el._y = o ? o.y : 0;
    }
    this.cur = { kind: 'seltransform', pointerId: e.pointerId, mode, anchor, start: [e.clientX, e.clientY], tx: 0, ty: 0, s: 1 };
    if (mode === 'rotate') {
      const [bx0, by0, bx1, by1] = sel.bbox;
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      const pr = this.viewer.pageClientRect(sel.index);
      const z = this.viewer.zoom, { ox, oy } = sel.view;
      // One object with its own rotation (picture / text box): snap its total angle.
      const objs = [...d.texts.filter((q) => sel.textIds.has(q.id)), ...d.items.filter((q) => sel.itemIds.has(q.id))];
      this.cur.base = !sel.strokeIds.size && objs.length === 1 ? (objs[0].r || 0) : 0;
      this.cur.pc = [cx, cy];
      this.cur.center = [pr.left + (cx - ox) * z, pr.top + (cy - oy) * z];
      this.cur.a0 = Math.atan2(e.clientY - this.cur.center[1], e.clientX - this.cur.center[0]);
      this.cur.delta = 0;
    }
    sel.bar.style.visibility = 'hidden';
    this.capture(e);
  }

  selTransformTo(e) {
    const c = this.cur;
    if (!this.sel) return; // selection was dropped (e.g. undo) while dragging
    const z = this.viewer.zoom;
    const dx = (e.clientX - c.start[0]) / z, dy = (e.clientY - c.start[1]) / z;
    if (c.mode === 'rotate') {
      const a = Math.atan2(e.clientY - c.center[1], e.clientX - c.center[0]);
      let total = c.base + ((a - c.a0) * 180) / Math.PI;
      total = ((total % 360) + 360) % 360;
      for (const snap of [0, 90, 180, 270, 360]) if (Math.abs(total - snap) < 4) total = snap % 360;
      if (e.shiftKey) total = (Math.round(total / 15) * 15) % 360;
      c.delta = Math.round((total - c.base) * 10) / 10;
      this.previewRotation(c.delta, c.pc);
      return;
    }
    if (c.mode === 'move') {
      c.tx = dx; c.ty = dy;
      this.positionSelection(dx, dy);
    } else {
      const [x0, y0, x1, y1] = this.sel.bbox;
      const [ax, ay] = c.anchor;
      const far = [ax === x0 ? x1 : x0, ay === y0 ? y1 : y0];
      const d0 = Math.hypot(far[0] - ax, far[1] - ay);
      const d1 = Math.hypot(far[0] + dx - ax, far[1] + dy - ay);
      c.s = Math.max(0.05, Math.min(20, d0 ? d1 / d0 : 1));
      this.positionSelection(0, 0, c.s, ax, ay);
    }
  }

  endSelTransform(c, cancelled) {
    const sel = this.sel;
    if (!sel) return;
    sel.bar.style.visibility = '';
    if (c.mode === 'rotate') {
      if (cancelled || !c.delta) { this.previewRotation(0, c.pc); this.positionSelection(); return; }
      return this.rotateSelection(c.delta, c.pc);
    }
    const moved = c.mode === 'move' ? (Math.abs(c.tx) + Math.abs(c.ty) > 0.01) : Math.abs(c.s - 1) > 1e-3;
    if (cancelled || !moved) { this.positionSelection(); return; }
    const [ax, ay] = c.mode === 'move' ? [0, 0] : c.anchor;
    const s = c.mode === 'move' ? 1 : c.s;
    const tx = ax * (1 - s) + c.tx, ty = ay * (1 - s) + c.ty;
    const before = this.editor.pageData(sel.pageId);
    this.recommit(before, this.scaledData(before, s, tx, ty));
  }

  // Commit a change to the selected objects and keep them selected.
  scaledData(before, s, tx, ty) {
    const sel = this.sel;
    return {
      ...before,
      strokes: before.strokes.map((st) => (sel.strokeIds.has(st.id) ? transformStroke(st, s, s, tx, ty) : st)),
      texts: before.texts.map((t) => (sel.textIds.has(t.id)
        ? { ...t, x: round2(t.x * s + tx), y: round2(t.y * s + ty), w: round2(t.w * s), fs: round2(t.fs * s) } : t)),
      items: before.items.map((it) => (sel.itemIds.has(it.id) ? transformItem(it, s, tx, ty) : it)),
    };
  }

  // Alt + mouse wheel on a selection: bigger / smaller around its centre.
  // Quick wheel notches are one undo step.
  scaleSelectionBy(f) {
    const sel = this.sel;
    if (!sel) return;
    const [cx, cy] = [(sel.bbox[0] + sel.bbox[2]) / 2, (sel.bbox[1] + sel.bbox[3]) / 2];
    const before = this.editor.pageData(sel.pageId);
    const stack = this.editor.undoStack, now = performance.now();
    const prev = this._wheelScale;
    this.recommit(before, this.scaledData(before, f, cx * (1 - f), cy * (1 - f)));
    if (prev && now - prev.t < 900 && stack[stack.length - 2] === prev.entry && prev.entry.pageId === sel.pageId) {
      prev.entry.after = stack.pop().after;
      prev.t = now;
    } else {
      this._wheelScale = { entry: stack[stack.length - 1], t: now };
    }
  }

  recommit(before, after) {
    const { index, pageId, strokeIds, textIds, itemIds } = this.sel;
    this.clearSelection(true);
    this.editor.commit(pageId, before, after);
    this.select(index, pageId, strokeIds, textIds, itemIds);
  }

  // Colour / width / font / bold … for everything selected.
  restyle({ color, width, font, ff, b, i, u, fill }) {
    const sel = this.sel;
    if (!sel) return;
    const before = this.editor.pageData(sel.pageId);
    const after = {
      ...before,
      strokes: before.strokes.map((st) => {
        if (!sel.strokeIds.has(st.id)) return st;
        const n = { ...st };
        if (color) n.c = color;
        if (width) n.s = round2(Math.max(0.3, st.s * width));
        if (fill !== undefined && st.sh) { if (fill) n.f = fill; else delete n.f; }
        return n;
      }),
      texts: before.texts.map((t) => {
        if (!sel.textIds.has(t.id)) return t;
        const n = { ...t };
        if (color) n.c = color;
        if (font) n.fs = round2(Math.max(4, t.fs * font));
        if (ff) n.ff = ff;
        if (b !== undefined) n.b = b;
        if (i !== undefined) n.i = i;
        if (u !== undefined) n.u = u;
        return n;
      }),
      items: before.items.map((it) => {
        if (!sel.itemIds.has(it.id) || it.type !== 'table') return it;
        const n = { ...it };
        if (color) n.c = color;
        if (font) n.fs = round2(Math.max(4, (it.fs || 12) * font));
        if (ff) n.ff = ff;
        if (font || ff) delete n.rh; // re-measured after rendering
        return n;
      }),
    };
    this.recommit(before, after);
  }

  // While dragging the rotate handle: turn the selection's canvas and objects with CSS.
  previewRotation(deg, [cx, cy]) {
    const sel = this.sel;
    const z = this.viewer.zoom;
    const R = sel.canvasRect;
    sel.canvas.style.transformOrigin = `${(cx - R[0]) * z}px ${(cy - R[1]) * z}px`;
    sel.canvas.style.transform = deg ? `rotate(${deg}deg)` : '';
    for (const el of sel.domEls) {
      el.style.transformOrigin = `${cx - el._x}px ${cy - el._y}px`;
      el.style.transform = deg ? `rotate(${deg}deg)` : '';
    }
    sel.box.style.transform = deg ? `rotate(${deg}deg)` : '';
  }

  // Turn everything selected by deg (clockwise) around (cx, cy).
  rotateSelection(deg, center) {
    const sel = this.sel;
    if (!sel || !deg) return;
    const [cx, cy] = center || [(sel.bbox[0] + sel.bbox[2]) / 2, (sel.bbox[1] + sel.bbox[3]) / 2];
    const turn = (r) => { const v = ((((r || 0) + deg) % 360) + 360) % 360; return Math.round(v * 10) / 10 || undefined; };
    const setR = (o, r) => { const n = { ...o, r }; if (!r) delete n.r; return n; };
    const before = this.editor.pageData(sel.pageId);
    const after = {
      ...before,
      strokes: before.strokes.map((st) => {
        if (!sel.strokeIds.has(st.id)) return st;
        const p = st.p.slice();
        for (let i = 0; i < p.length; i += 3) { const [x, y] = rotPt(p[i], p[i + 1], cx, cy, deg); p[i] = round2(x); p[i + 1] = round2(y); }
        const n = { ...st, p };
        if (st.k) { n.k = mapCuts(st.k, (x, y) => rotPt(x, y, cx, cy, deg)); if (!n.k) delete n.k; }
        return n;
      }),
      texts: before.texts.map((t) => {
        if (!sel.textIds.has(t.id)) return t;
        const hh = t.h || t.fs * LINE_H;
        const [nx, ny] = rotPt(t.x + t.w / 2, t.y + hh / 2, cx, cy, deg);
        return setR({ ...t, x: round2(nx - t.w / 2), y: round2(ny - hh / 2) }, turn(t.r));
      }),
      items: before.items.map((it) => {
        if (!sel.itemIds.has(it.id) || it.type !== 'img') return it;
        const [nx, ny] = rotPt(it.x + it.w / 2, it.y + it.h / 2, cx, cy, deg);
        return setR({ ...it, x: round2(nx - it.w / 2), y: round2(ny - it.h / 2) }, turn(it.r));
      }),
    };
    this.recommit(before, after);
  }

  // Group / ungroup what is selected (grouped objects are selected together).
  group(on = true) {
    const sel = this.sel;
    if (!sel) return;
    const g = on ? uid() : undefined;
    const set = (o, ids) => { if (!ids.has(o.id)) return o; const n = { ...o, g }; if (!g) delete n.g; return n; };
    const before = this.editor.pageData(sel.pageId);
    const after = {
      ...before,
      strokes: before.strokes.map((o) => set(o, sel.strokeIds)),
      texts: before.texts.map((o) => set(o, sel.textIds)),
      items: before.items.map((o) => set(o, sel.itemIds)),
    };
    this.recommit(before, after);
    this.editor.toast(on ? 'Grouped' : 'Ungrouped');
  }

  // Change fields of one item (picture), keep it selected, undoable.
  // A value of undefined removes the field.
  restyleItem(id, fields) {
    const sel = this.sel;
    if (!sel) return;
    const before = this.editor.pageData(sel.pageId);
    const after = { ...before, items: before.items.map((it) => {
      if (it.id !== id) return it;
      const n = { ...it, ...fields };
      for (const [k, v] of Object.entries(fields)) if (v === undefined) delete n[k];
      return n;
    }) };
    this.recommit(before, after);
  }

  // Bring to front / send to back: pictures, tables and text boxes.
  order(dir) {
    const sel = this.sel;
    if (!sel) return;
    const before = this.editor.pageData(sel.pageId);
    const ids = new Set([...sel.itemIds, ...sel.textIds]);
    if (!ids.size) return;
    this.recommit(before, restack(before, ids, dir));
  }

  // After the page's objects were re-rendered, point the selection at the new elements.
  refreshSelectionEls() {
    const sel = this.sel;
    const view = sel.view;
    for (const el of sel.domEls) el.classList.remove('selected');
    sel.domEls = [
      ...[...sel.textIds].map((id) => view.el.querySelector(`.textbox-wrap[data-id="${id}"]`)),
      ...[...sel.itemIds].map((id) => view.el.querySelector(`.item[data-id="${id}"]`)),
    ].filter(Boolean);
    sel.domEls.forEach((el) => el.classList.add('selected'));
  }

  clearSelection(silent = false) {
    const sel = this.sel;
    if (!sel) return;
    this.sel = null;
    releaseCanvas(sel.canvas); sel.box.remove(); sel.bar.remove();
    for (const el of sel.domEls) { el.classList.remove('selected'); el.style.transform = ''; }
    sel.view.inkSkip = null;
    if (sel.view.el.isConnected) sel.view.drawInk(true);
    if (!silent) this.editor.onSelectionChange(false);
  }

  selectionData() {
    const sel = this.sel;
    return { ...this.selectedObjects(), bbox: sel.bbox, pageId: sel.pageId };
  }

  copy() {
    if (!this.sel) return false;
    this.clip = this.selectionData();
    this.clip.stamp = Date.now();
    this.editor.onInternalCopy(this.clip);
    this.editor.toast('Copied');
    return true;
  }

  cut() {
    if (!this.copy()) return;
    this.deleteSelection();
  }

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    const before = this.editor.pageData(sel.pageId);
    const after = {
      ...before,
      strokes: before.strokes.filter((s) => !sel.strokeIds.has(s.id)),
      texts: before.texts.filter((t) => !sel.textIds.has(t.id)),
      items: before.items.filter((it) => !sel.itemIds.has(it.id)),
    };
    this.clearSelection();
    this.editor.commit(sel.pageId, before, after);
  }

  duplicate() {
    if (!this.sel) return;
    this.pasteClip(this.selectionData(), this.sel.index, 14);
  }

  // Internal clipboard (ink, text boxes, pictures, tables).
  pasteInternal() {
    if (!this.clip) return false;
    const index = this.sel ? this.sel.index : this.viewer.currentIndex;
    this.pasteClip(this.clip, index, this.clip.pageId === this.viewer.pages[index].id ? 14 : 0);
    return true;
  }

  pasteClip(clip, index, offset) {
    const page = this.viewer.pages[index];
    if (!page) return;
    const [x0, y0, x1, y1] = clip.bbox;
    // Keep the pasted block on the page (boards have no edges).
    let dx = offset, dy = offset;
    if (page.kind !== 'board') {
      if (x1 + dx > page.w) dx = page.w - x1;
      if (y1 + dy > page.h) dy = page.h - y1;
      if (x0 + dx < 0) dx = -x0;
      if (y0 + dy < 0) dy = -y0;
    }
    const strokes = clip.strokes.map((st) => transformStroke(st, 1, 1, dx, dy, uid()));
    const texts = clip.texts.map((t) => ({ ...t, id: uid(), x: round2(t.x + dx), y: round2(t.y + dy) }));
    const items = (clip.items || []).map((it) => ({ ...transformItem(it, 1, dx, dy), id: uid() }));
    this.placeObjects(index, { strokes, texts, items });
  }

  // Add new objects to a page and select them (paste, insert picture, …).
  placeObjects(index, { strokes = [], texts = [], items = [] }) {
    // Copies get their own group ids (a duplicated group is a new group).
    const gmap = new Map();
    const regroup = (o) => { if (!o.g) return o; if (!gmap.has(o.g)) gmap.set(o.g, uid()); return { ...o, g: gmap.get(o.g) }; };
    strokes = strokes.map(regroup); texts = texts.map(regroup); items = items.map(regroup);
    const page = this.viewer.pages[index];
    const before = this.editor.pageData(page.id);
    // What was pasted / inserted last lies on top of everything (front layer).
    // Text goes on top of everything; pictures / tables on top of the other
    // pictures but still below the ink (so you can write on them).
    const topOf = (layer) => stacked(before, layer).reduce((m, e) => Math.max(m, e.key), 0);
    let zf = Math.max(0, Math.ceil(topOf('f'))) + 1, zb = Math.max(0, Math.ceil(topOf('b'))) + 1;
    items = items.map((o) => ({ ...o, lay: 'b', z: zb++ }));
    texts = texts.map((o) => ({ ...o, lay: 'f', z: zf++ }));
    const after = { ...before, strokes: before.strokes.concat(strokes), texts: before.texts.concat(texts), items: before.items.concat(items) };
    this.clearSelection(true);
    this.editor.commit(page.id, before, after);
    if (this.state.tool !== 'select' && this.state.tool !== 'lasso') this.editor.setTool('select');
    this.viewer.update();
    this.select(index, page.id, new Set(strokes.map((s) => s.id)), new Set(texts.map((t) => t.id)), new Set(items.map((i) => i.id)));
  }

  // Where to put pasted content: under the pointer if it's over a visible
  // page, else the centre of the view. Returns { index, x, y }.
  // Where pasted things go: under the mouse if it's on a visible page,
  // otherwise the middle of the view. Pasting again without moving the mouse
  // shifts each new object a little so they don't cover each other.
  pastePoint() {
    const p = this.basePastePoint();
    const prev = this._lastPaste;
    const same = prev && prev.index === p.index && Math.abs(prev.bx - p.x) < 0.5 && Math.abs(prev.by - p.y) < 0.5;
    const n = same ? prev.n + 1 : 0;
    this._lastPaste = { index: p.index, bx: p.x, by: p.y, n };
    const step = 24 / Math.max(0.5, this.viewer.zoom);
    return { ...p, x: p.x + n * step, y: p.y + n * step };
  }

  basePastePoint() {
    const lp = this.lastPointer;
    const [first, last] = this.viewer.visibleRange();
    if (lp && lp.index >= first && lp.index <= last) {
      const vis = this.viewer.visibleWorldRect(lp.index);
      if (vis && lp.x >= vis[0] && lp.x <= vis[2] && lp.y >= vis[1] && lp.y <= vis[3]) return lp;
    }
    const index = this.viewer.currentIndex;
    const vis = this.viewer.visibleWorldRect(index);
    const p = this.viewer.pages[index];
    if (vis) return { index, x: (vis[0] + vis[2]) / 2, y: (vis[1] + vis[3]) / 2 };
    return { index, x: (p.ox || 0) + p.w / 2, y: (p.oy || 0) + p.h / 2 };
  }

  // ---------- text ----------
  createText(hit) {
    const ts = this.state.text;
    const fs = ts.size;
    const page = hit.page;
    // A new box starts thin and grows while typing (aw = auto width).
    const t = {
      id: uid(), x: round2(hit.x), y: round2(hit.y - fs * 0.65), w: round2(fs), aw: true, fs, c: this.state.pen.color, text: '',
      ff: ts.ff || 'carlito', b: !!ts.b, i: !!ts.i, u: !!ts.u, ...(ts.al && ts.al !== 'left' ? { al: ts.al } : {}),
    };
    this.editor.addText(page.id, t);
  }
}
