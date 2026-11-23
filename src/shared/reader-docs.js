'use strict';

const MAX_BYTES = 500_000_000;
const MAX_POSITIONS = 50;
const MAX_TABS = 12;
const EMPTY_VIEW = { page: 0, zoom: null, scrollY: 0, fit: true };

function docKey({ name, size }) {
  return JSON.stringify([name.toLowerCase(), size]);
}

function acceptDocs(files, open) {
  const seen = new Set(Array.from(open, (item) => typeof item === 'string' ? item : docKey(item)));
  const add = [];
  const skipped = [];
  for (const file of files) {
    const { name, size, type } = file;
    const key = docKey(file);
    let reason;
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(name) && type?.toLowerCase() !== 'application/pdf') reason = 'unsupported';
    else if (!(size > 0)) reason = 'empty';
    else if (size > MAX_BYTES) reason = 'too-large';
    else if (seen.has(key)) reason = 'already-open';
    if (reason) skipped.push({ name, reason });
    else {
      seen.add(key);
      add.push(file);
    }
  }
  return { add, skipped };
}

function remember(store, key, { page, zoom, scrollY, fit }) {
  const view = {
    page: Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : EMPTY_VIEW.page,
    zoom: Number.isFinite(zoom) ? Math.max(0.1, Math.min(8, zoom)) : EMPTY_VIEW.zoom,
    scrollY: Number.isFinite(scrollY) ? scrollY : EMPTY_VIEW.scrollY,
    fit: typeof fit === 'boolean' ? fit : EMPTY_VIEW.fit,
  };
  // Keep recency explicit so it survives JSON without relying on object keys.
  const earlier = (store.entries || []).filter((entry) => entry.key !== key);
  return { entries: [...earlier.slice(-(MAX_POSITIONS - 1)), { key, view }] };
}

function recall(store, key) {
  const entry = (store.entries || []).find((item) => item.key === key);
  return { ...(entry ? entry.view : EMPTY_VIEW) };
}

function activate(state, key) {
  if (state.active === key) return state;
  const latest = Math.max(0, ...Object.values(state.used));
  return { ...state, active: key, used: key === null ? state.used : { ...state.used, [key]: latest + 1 } };
}

function openTabs(state, docs) {
  const seen = new Set(state.tabs);
  const added = [];
  for (const doc of docs) {
    const key = docKey(doc);
    if (!seen.has(key)) {
      seen.add(key);
      added.push(key);
      if (added.length === MAX_TABS) break;
    }
  }
  if (!added.length) return state;
  const overflow = state.tabs.length + added.length - MAX_TABS;
  if (overflow <= 0) return activate({ ...state, tabs: [...state.tabs, ...added] }, added[0]);

  // Make room among existing tabs before opening the batch, so an accepted
  // file cannot immediately disappear because it has not been visited yet.
  const evicted = new Set([...state.tabs].sort((a, b) => (state.used[a] ?? 0) - (state.used[b] ?? 0)).slice(0, overflow));
  const tabs = [...state.tabs.filter((key) => !evicted.has(key)), ...added];
  const used = { ...state.used };
  for (const key of evicted) delete used[key];
  return activate({ ...state, tabs, used }, added[0]);
}

function closeTab(state, key) {
  const index = state.tabs.indexOf(key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab !== key);
  const used = { ...state.used };
  delete used[key];
  const next = { ...state, tabs, used };
  return state.active === key ? activate(next, tabs[index] ?? tabs[index - 1] ?? null) : next;
}

function moveTab(state, key, toIndex) {
  const from = state.tabs.indexOf(key);
  if (from < 0 || !Number.isFinite(toIndex)) return state;
  const to = Math.max(0, Math.min(state.tabs.length - 1, Math.trunc(toIndex)));
  if (from === to) return state;
  const tabs = [...state.tabs];
  tabs.splice(from, 1);
  tabs.splice(to, 0, key);
  return { ...state, tabs };
}

function stepTab(state, step) {
  const count = state.tabs.length;
  if (!count) return state;
  const current = state.tabs.indexOf(state.active);
  const index = current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count;
  return activate(state, state.tabs[index]);
}

function nextTab(state) { return stepTab(state, 1); }
function prevTab(state) { return stepTab(state, -1); }

module.exports = { acceptDocs, docKey, remember, recall, openTabs, closeTab, moveTab, nextTab, prevTab };
