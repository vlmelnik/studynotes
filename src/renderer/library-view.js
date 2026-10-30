// Library: folders, notebooks with covers, import, library-wide search.
import { h, iconButton, showMenu, promptDialog, confirmDialog, toast, modal, formatDate, encodeRel, debounce } from './ui.js';
import { icon } from './icons.js';
import { PAPERS, PAGE_SIZES, isDark } from '../shared/paper.js';
import { drawPaper } from './inkrender.js';
import { templatePicker } from './template-picker.js';

const COVER_COLORS = ['#3b6ea5', '#2f7d5b', '#b4483d', '#c98a2b', '#6b4fa0', '#2d8a96', '#4a4a4f', '#c45d8a'];
const PAPER_OPTIONS = PAPERS;

export class LibraryView {
  constructor(app) {
    this.app = app;
    this.folder = '';
    this.el = h('div', { class: 'library' });
    this.crumbs = h('nav', { class: 'crumbs' });
    this.searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: 'Search all notebooks…' });
    this.searchInput.addEventListener('input', debounce(() => this.runSearch(), 250));
    this.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.searchInput.value = ''; this.runSearch(); } });
    const newBtn = h('button', { class: 'btn btn-primary', onclick: (e) => this.newMenu(e.currentTarget) }, h('span', { html: icon('plus', 18) }), 'New');
    this.header = h('header', { class: 'lib-header' },
      this.crumbs,
      h('div', { class: 'lib-actions' }, this.searchInput,
        h('button', { class: 'btn', title: 'Fill in form fields and sign a PDF', onclick: () => this.fillAndSign() }, h('span', { html: icon('fillSign', 18) }), 'Fill & sign'),
        h('button', { class: 'btn', onclick: () => this.importPdf() }, h('span', { html: icon('importPdf', 18) }), 'Import PDF'),
        newBtn,
        this.cloudLabel = h('span', { class: 'cloud-label' }),
        this.cloudBtn = h('button', { class: 'icon-btn cloud-btn', title: 'Google Drive sync', html: icon('cloud', 20), onclick: () => this.app.cloudClick() }),
        iconButton('moon', 'Dark mode on / off', () => this.app.toggleDark()),
        iconButton('settings', 'Settings', () => this.app.showSettings())));
    this.grid = h('div', { class: 'lib-grid' });
    this.results = h('div', { class: 'lib-results' });
    this.empty = h('div', { class: 'lib-empty' });
    this.el.append(this.header, h('div', { class: 'lib-scroll' }, this.grid, this.empty, this.results));

    // Drag & drop PDFs from Explorer.
    this.el.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); this.el.classList.add('drop-target'); }
    });
    this.el.addEventListener('dragleave', (e) => { if (e.target === this.el || !this.el.contains(e.relatedTarget)) this.el.classList.remove('drop-target'); });
    this.el.addEventListener('drop', async (e) => {
      this.el.classList.remove('drop-target');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => /\.pdf$/i.test(p));
      if (!files.length) { toast('Only PDF files can be imported', { error: true }); return; }
      await this.doImport(() => window.api.importFiles(this.folder, files));
    });
  }

  async load(folder = this.folder) {
    this.folder = folder;
    let data;
    try {
      data = await window.api.list(folder);
    } catch (err) {
      if (folder) return this.load('');
      toast(err.message, { error: true });
      return;
    }
    this.renderCrumbs();
    this.grid.replaceChildren();
    for (const f of data.folders) this.grid.append(this.folderCard(f));
    for (const nb of data.notebooks) this.grid.append(this.notebookCard(nb));
    const isEmpty = !data.folders.length && !data.notebooks.length;
    this.empty.replaceChildren();
    if (isEmpty) {
      this.empty.append(
        h('div', { class: 'empty-art', html: icon('notebook', 56) }),
        h('h2', {}, folder ? 'This folder is empty' : 'Welcome to StudyNotes'),
        h('p', {}, 'Import a lecture script, or start a blank notebook. You can also drag PDF files into this window.'),
        h('div', { class: 'empty-actions' },
          h('button', { class: 'btn btn-primary', onclick: () => this.importPdf() }, 'Import PDF'),
          h('button', { class: 'btn', onclick: () => this.newNotebook() }, 'New notebook'),
          h('button', { class: 'btn', onclick: () => this.newFolder() }, 'New folder')));
    }
    if (this.searchInput.value.trim()) this.runSearch();
  }

  renderCrumbs() {
    this.crumbs.replaceChildren();
    const parts = this.folder ? this.folder.split('/') : [];
    const mk = (label, rel, isLast) => {
      const b = h('button', { class: `crumb${isLast ? ' current' : ''}`, onclick: () => this.load(rel) }, label);
      this.dropTarget(b, rel);
      return b;
    };
    this.crumbs.append(mk('Library', '', !parts.length));
    parts.forEach((p, i) => {
      this.crumbs.append(h('span', { class: 'crumb-sep', html: icon('chevronRight', 16) }));
      this.crumbs.append(mk(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1));
    });
  }

  dropTarget(el, rel) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-studynotes')) return;
      e.preventDefault();
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', async (e) => {
      const src = e.dataTransfer.getData('application/x-studynotes');
      el.classList.remove('drop-hover');
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      await this.move(src, rel);
    });
  }

  folderCard(f) {
    const card = h('div', { class: 'card folder-card', tabindex: '0', draggable: 'true' },
      h('div', { class: 'folder-art', html: icon('folder', 64) }),
      h('div', { class: 'card-title' }, f.name),
      h('button', { class: 'card-more', title: 'More', html: icon('more', 18), onclick: (e) => { e.stopPropagation(); this.folderMenu(f, e.clientX, e.clientY); } }));
    card.addEventListener('click', () => this.load(f.path));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.load(f.path); });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(f, e.clientX, e.clientY); });
    card.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-studynotes', f.path));
    this.dropTarget(card, f.path);
    return card;
  }

  notebookCard(nb) {
    const cover = h('div', { class: 'cover', style: { '--cover': nb.coverColor || '#3b6ea5' } });
    if (nb.hasPdf && nb.cover) {
      cover.classList.add('pdf-cover');
      cover.append(h('img', { src: `sn://lib/${encodeRel(nb.path)}/cover.png?v=${nb.cover}`, alt: '', draggable: 'false' }));
    } else if (nb.hasPdf) {
      cover.classList.add('pdf-cover', 'placeholder');
      cover.append(h('span', { html: icon('page', 40) }));
    } else if (nb.kind === 'board') {
      cover.classList.add('board-cover');
      cover.append(h('span', { html: icon('board', 44) }), h('div', { class: 'cover-label' }, nb.title));
    } else if (nb.first && nb.first.cover) {
      // The notebook's own cover page, with its title (always fitted).
      cover.classList.add('drawn-cover');
      cover.append(pageCanvas(nb.first), h('div', { class: 'cover-title', style: { color: isDark(nb.first.cover.color) ? '#fff' : '#2b2b2b' } }, nb.title));
    } else if (nb.first) {
      cover.classList.add('drawn-cover', 'paper-first');
      cover.append(pageCanvas(nb.first), h('div', { class: 'cover-label' }, nb.title));
    } else {
      cover.classList.add('paper-cover');
      cover.append(h('div', { class: 'cover-label' }, nb.title));
    }
    requestAnimationFrame(() => fitTitle(cover.querySelector('.cover-title, .cover-label')));
    const card = h('div', { class: 'card nb-card', tabindex: '0', draggable: 'true', title: nb.title },
      cover,
      h('div', { class: 'card-title' }, nb.title),
      h('div', { class: 'card-meta' }, `${nb.pageCount ? nb.pageCount + (nb.pageCount === 1 ? ' page' : ' pages') + ' · ' : ''}${formatDate(nb.modified)}`),
      h('button', { class: 'card-more', title: 'More', html: icon('more', 18), onclick: (e) => { e.stopPropagation(); this.notebookMenu(nb, e.clientX, e.clientY); } }));
    card.addEventListener('click', () => this.app.openNotebook(nb.path));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.app.openNotebook(nb.path); });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.notebookMenu(nb, e.clientX, e.clientY); });
    card.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-studynotes', nb.path));
    return card;
  }

  notebookMenu(nb, x, y) {
    showMenu([
      { label: 'Open', icon: 'notebook', onClick: () => this.app.openNotebook(nb.path) },
      { label: 'Rename…', icon: 'text', onClick: () => this.rename(nb.path, nb.title) },
      { label: 'Duplicate', icon: 'duplicate', onClick: () => this.duplicate(nb.path) },
      { label: 'Move to…', icon: 'folder', onClick: () => this.moveDialog(nb.path) },
      { label: 'Export as PDF…', icon: 'export', onClick: () => this.exportNb(nb.path) },
      { label: 'Restore from backup…', icon: 'history', onClick: () => this.restoreDialog(nb) },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => this.remove(nb.path, nb.title) },
    ], x, y);
  }

  folderMenu(f, x, y) {
    showMenu([
      { label: 'Open', icon: 'folder', onClick: () => this.load(f.path) },
      { label: 'Rename…', icon: 'text', onClick: () => this.rename(f.path, f.name) },
      { label: 'Move to…', icon: 'folder', onClick: () => this.moveDialog(f.path) },
      'sep',
      { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => this.remove(f.path, f.name, true) },
    ], x, y);
  }

  newMenu(anchor) {
    showMenu([
      { label: 'Notebook', icon: 'notebook', onClick: () => this.newNotebook() },
      { label: 'Endless board', icon: 'board', onClick: () => this.newBoard() },
      { label: 'Folder', icon: 'folder', onClick: () => this.newFolder() },
      { label: 'Import PDF…', icon: 'importPdf', onClick: () => this.importPdf() },
    ], 0, 0, anchor);
  }

  async newFolder() {
    const name = await promptDialog('New folder', 'New Folder', { okLabel: 'Create' });
    if (!name) return;
    try { await window.api.createFolder(this.folder, name); this.load(); } catch (err) { toast(err.message, { error: true }); }
  }

  async newNotebook() {
    const opts = await templatePicker({ mode: 'notebook' });
    if (!opts) return;
    try {
      const rel = await window.api.createNotebook(this.folder, {
        title: opts.title, paper: opts.paper, size: opts.size, landscape: opts.landscape, pc: opts.pc,
        cover: opts.cover ? { style: opts.cover.style, color: opts.cover.color, accent: opts.cover.accent } : null,
      });
      await this.load();
      this.app.openNotebook(rel);
    } catch (err) { toast(err.message, { error: true }); }
  }

  async newBoard() {
    const name = await promptDialog('New endless board', 'Board', { label: 'An endless whiteboard that grows in every direction', okLabel: 'Create' });
    if (!name) return;
    try {
      const rel = await window.api.createNotebook(this.folder, { title: name, kind: 'board', coverColor: '#4a4a4f' });
      await this.load();
      this.app.openNotebook(rel);
    } catch (err) { toast(err.message, { error: true }); }
  }

  // Fill & sign: open one PDF from the computer; it is saved into itself.
  async fillAndSign() {
    const file = await window.api.extPickFill();
    if (file) this.app.openPdfFile(file, { fill: true });
  }

  async importPdf() {
    await this.doImport(() => window.api.importDialog(this.folder));
  }

  async doImport(fn) {
    let rels;
    try { rels = await fn(); } catch (err) { toast('Import failed: ' + err.message, { error: true }); return; }
    if (!rels || !rels.length) return;
    await this.load();
    if (rels.length === 1) this.app.openNotebook(rels[0]);
    else {
      // Prepare page lists/covers in the background, one after another.
      toast(`Imported ${rels.length} PDFs`);
      for (const r of rels) await this.app.prepareNotebook(r).catch(() => {});
      this.load();
    }
  }

  async rename(rel, current) {
    const name = (await promptDialog('Rename', current, { okLabel: 'Rename' }) || '').trim();
    if (!name || name === current) return;
    // An open notebook is renamed through its editor (saves first, keeps the tab).
    const open = this.app.editors.find(({ editor }) => editor.rel === rel);
    if (open) { await open.editor.renameTo(name); this.load(); return; }
    if (this.app.isOpenUnder(rel)) { toast('Close the open notebooks in this folder first'); return; }
    try { await window.api.rename(rel, name); this.load(); } catch (err) { toast(err.message, { error: true }); }
  }

  async restoreDialog(nb) {
    const list = await window.api.backupList(nb.path).catch(() => []);
    if (!list.length) {
      modal({ title: 'Restore from backup', body: h('p', {}, 'There is no backup of this notebook yet. Backups are made every hour while you work.'), actions: [{ label: 'Open backup folder', result: 'open' }, { label: 'OK', primary: true, result: null }], onClose: (v) => { if (v === 'open') window.api.backupOpenFolder(); } });
      return;
    }
    let chosen = list[0].stamp;
    const rows = h('div', { class: 'backup-list' }, ...list.map((b, i) => h('label', { class: 'backup-row' },
      h('input', { type: 'radio', name: 'bk', checked: i === 0, onchange: () => { chosen = b.stamp; } }), h('span', {}, b.label))));
    modal({
      title: `Restore “${nb.title}”`,
      body: h('div', {}, h('p', { class: 'hint' }, 'The backup is added as a copy next to the notebook. Nothing is overwritten.'), rows),
      actions: [{ label: 'Open backup folder', result: 'open' }, { label: 'Cancel', result: null }, { label: 'Restore as copy', primary: true, result: 'restore' }],
      onClose: async (v) => {
        if (v === 'open') return window.api.backupOpenFolder();
        if (v !== 'restore') return;
        try { await window.api.backupRestore(nb.path, chosen); toast('Backup restored as a copy'); this.load(); } catch (err) { toast(err.message, { error: true }); }
      },
    });
  }

  async duplicate(rel) {
    if (this.app.isOpen(rel)) await this.app.flushNotebook(rel).catch(() => {});
    await this.app.flushNotebook(rel);
    try { await window.api.duplicate(rel); this.load(); } catch (err) { toast(err.message, { error: true }); }
  }

  async move(src, destFolder) {
    if (this.app.isOpenUnder(src)) { toast('Close the open notebook(s) first'); return; }
    try { await window.api.move(src, destFolder); this.load(); } catch (err) { toast(err.message, { error: true }); }
  }

  async moveDialog(rel) {
    const folders = (await window.api.allFolders()).filter((f) => f.path !== rel && !f.path.startsWith(rel + '/'));
    const list = h('div', { class: 'folder-pick' });
    let chosen = null;
    const close = modal({
      title: 'Move to',
      body: list,
      actions: [{ label: 'Cancel', result: null }, { label: 'Move', primary: true, value: () => chosen ?? false }],
      onClose: (dest) => { if (dest !== null && dest !== undefined) this.move(rel, dest); },
    });
    for (const f of folders) {
      const depth = f.path ? f.path.split('/').length : 0;
      const b = h('button', { class: 'folder-pick-item', style: { paddingLeft: 12 + depth * 18 + 'px' }, onclick: () => {
        chosen = f.path;
        list.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
        b.classList.add('active');
      }, ondblclick: () => { chosen = f.path; close.close(f.path); } }, h('span', { html: icon(f.path ? 'folder' : 'home', 18) }), f.name);
      list.append(b);
    }
  }

  async exportNb(rel) {
    await this.app.flushNotebook(rel);
    try {
      const f = await window.api.exportPdf(rel, null);
      if (f) toast('Exported to ' + f);
    } catch (err) { toast('Export failed: ' + err.message, { error: true }); }
  }

  async remove(rel, name, isFolder) {
    const ok = await confirmDialog(isFolder ? 'Delete folder' : 'Delete notebook',
      `"${name}"${isFolder ? ' and everything in it' : ''} will be moved to the Recycle Bin.`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    await this.app.closeNotebooksUnder(rel);
    try { await window.api.trash(rel); this.load(); } catch (err) { toast(err.message, { error: true }); }
  }

  async runSearch() {
    const q = this.searchInput.value.trim();
    this.el.classList.toggle('searching', !!q);
    this.results.replaceChildren();
    if (!q) return;
    const token = (this.searchToken = {});
    let res;
    try { res = await window.api.search(q); } catch (err) { toast(err.message, { error: true }); return; }
    if (token !== this.searchToken) return;
    if (!res.length) {
      this.results.append(h('div', { class: 'no-results' }, `No results for "${q}"`, h('small', {}, 'Text inside PDFs becomes searchable after a notebook has been opened once.')));
      return;
    }
    for (const r of res) {
      const group = h('div', { class: 'result-group' },
        h('button', { class: 'result-nb', onclick: () => this.app.openNotebook(r.path) }, h('span', { html: icon('notebook', 18) }), r.title, h('small', {}, r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '')));
      for (const hit of r.hits) {
        group.append(h('button', { class: 'result', onclick: () => this.app.openNotebook(r.path, hit.pageIndex, q, hit) },
          h('div', { class: 'result-page' }, `Page ${hit.pageIndex + 1}`, hit.source === 'note' ? h('span', { class: 'tag' }, 'note') : null),
          h('div', { class: 'result-snippet' }, hit.snippet)));
      }
      this.results.append(group);
    }
  }
}

// Thumbnail of a paper page (cover or first page) for a notebook card.
const CARD_W = 168;
function pageCanvas(p) {
  const dpr = window.devicePixelRatio || 1;
  const scale = (CARD_W / p.w) * dpr;
  const c = h('canvas', { class: 'cover-canvas' });
  c.width = Math.round(p.w * scale);
  c.height = Math.round(p.h * scale);
  drawPaper(c.getContext('2d'), { kind: 'paper', ...p }, scale);
  return c;
}

// Shrink a title until it fits its box (no cut-off words, at most 3 lines).
function fitTitle(el) {
  if (!el || !el.isConnected) return;
  let size = parseFloat(getComputedStyle(el).fontSize) || 16;
  const fits = () => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
  while (!fits() && size > 9) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}
