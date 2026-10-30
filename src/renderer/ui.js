// Small UI helpers: element builder, menus, modal dialogs, toasts.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconButton(name, title, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, html: icon(name), onclick: onClick });
}

// Shortcut key independent of the keyboard layout: with a Russian (or any)
// layout, the key in the "P" position still gives 'p'.
export function shortcutKey(e) {
  if (/^Key[A-Z]$/.test(e.code || '')) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code || '')) return e.code.slice(5);
  return (e.key || '').toLowerCase();
}

// ---------- context / dropdown menus ----------
let openMenu = null;
export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

/** items: [{label, icon, onClick, danger, disabled, submenu:[...]} | 'sep'] */
export function showMenu(items, x, y, anchor) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  const build = (list, container) => {
    for (const it of list) {
      if (it === 'sep') { container.append(h('div', { class: 'menu-sep' })); continue; }
      if (it.header) { container.append(h('div', { class: 'menu-header' }, it.header)); continue; }
      const btn = h('button', {
        class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`,
        disabled: it.disabled,
        role: 'menuitem',
      }, it.icon ? h('span', { class: 'mi-icon', html: icon(it.icon, 18) }) : h('span', { class: 'mi-icon' }), h('span', { class: 'mi-label' }, it.label));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        it.onClick && it.onClick();
      });
      container.append(btn);
    }
  };
  build(items, menu);
  document.body.append(menu);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.left; y = r.bottom + 4;
  }
  // Keep the menu inside the window – also when content is added after this
  // call (custom menus), hence the ResizeObserver.
  const place = () => {
    const mr = menu.getBoundingClientRect();
    menu.style.maxHeight = window.innerHeight - 16 + 'px';
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - mr.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - Math.min(mr.height, window.innerHeight - 16) - 8)) + 'px';
  };
  place();
  new ResizeObserver(place).observe(menu);
  openMenu = menu;
  return menu;
}

window.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

// ---------- modal dialogs ----------
export function modal({ title, body, actions, onClose, width }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: width ? { width: width + 'px' } : null });
  const footer = h('div', { class: 'modal-actions' });
  const close = (value) => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose(value);
  };
  for (const a of actions || []) {
    footer.append(h('button', { class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`, onclick: () => {
      const v = a.value ? a.value() : a.result;
      if (v === false) return; // validation failed
      close(v);
    } }, a.label));
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
      const primary = footer.querySelector('.btn-primary');
      if (primary) { e.preventDefault(); e.stopPropagation(); primary.click(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  box.append(h('div', { class: 'modal-title' }, title), h('div', { class: 'modal-body' }, body), footer);
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(null); });
  document.body.append(backdrop);
  const first = box.querySelector('input, select, textarea');
  if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
  return { close, box };
}

export function promptDialog(title, value = '', { label, okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', type: 'text', value });
    modal({
      title,
      body: h('label', { class: 'field' }, label ? h('span', {}, label) : null, input),
      actions: [
        { label: 'Cancel', result: null },
        { label: okLabel, primary: true, value: () => input.value.trim() || false },
      ],
      onClose: resolve,
    });
  });
}

export function confirmDialog(title, text, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { class: 'modal-text' }, text),
      actions: [
        { label: cancelLabel, result: false },
        { label: okLabel, primary: true, danger, result: true },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

// ---------- toasts ----------
let toastHost;
export function toast(message, { error = false, timeout = 3200, action } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast${error ? ' error' : ''}` }, h('span', {}, message));
  if (action) t.append(h('button', { class: 'toast-action', onclick: () => { action.onClick(); t.remove(); } }, action.label));
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, timeout);
  return t;
}

export function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function encodeRel(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

// maxWait: run at the latest this long after the first call, even if calls
// keep coming (e.g. saving while someone writes without pausing).
export function debounce(fn, ms, maxWait = 0) {
  let t, first = 0;
  const run = (...a) => { clearTimeout(t); first = 0; fn(...a); };
  const d = (...a) => {
    clearTimeout(t);
    const now = Date.now();
    if (!first) first = now;
    const wait = maxWait ? Math.max(0, Math.min(ms, first + maxWait - now)) : ms;
    t = setTimeout(() => run(...a), wait);
  };
  d.cancel = () => { clearTimeout(t); first = 0; };
  d.flush = (...a) => run(...a);
  return d;
}

// "1-5, 8, 11-13" -> [1,2,3,4,5,8,11,12,13] (null if invalid)
export function parseRange(v, max) {
  const out = [];
  for (const part of String(v).split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= max && !out.includes(k)) out.push(k);
  }
  return out;
}
