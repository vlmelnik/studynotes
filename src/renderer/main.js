// App shell: tabs (Library + open notebooks), notebook loading, settings.
import { h, toast, errorText, modal, debounce, confirmDialog, shortcutKey, keySignature, describeKey } from './ui.js';
import { icon } from './icons.js';
import { LibraryView } from './library-view.js';
import { Editor, defaultToolState } from './editor.js';
import { PdfDoc } from './pdfdoc.js';
import { uid } from './tools.js';
import { maybeShowWhatsNew, showWhatsNew } from './whats-new.js';
import { setLang } from './i18n.js';
import { extensions } from './extensions.js';
import { McpTools } from './mcp.js';
import { notesStyleEditor } from './notes-style.js';
import { speechSettings, withProgress } from './speech.js';

class App {
  async init() {
    this.info = await window.api.info();
    this.settings = { mouseDraws: true, pdfShapes: true, shapeHold: true, scribbleErase: true, sidebarHidden: false, pasteFormatting: false, favorites: [], recentPens: [], recentColors: [], theme: 'light', ...(this.info.settings || {}) };
    this.applyTheme();
    setLang(this.settings.lang || 'en');
    window.api.onCloudStatus((st) => this.onCloudStatus(st));
    window.api.onCloudRequestSync(() => this.syncAll({ quiet: true }));
    window.api.onLibraryChanged(() => { if (!this.active) this.library.load(); });
    this.toolState = { ...defaultToolState(), ...(this.settings.toolState || {}) };
    for (const k of ['pen', 'hl', 'eraser', 'shape', 'text', 'laser']) this.toolState[k] = { ...defaultToolState()[k], ...(this.toolState[k] || {}) };
    // 1.7: the highlighter is a free marker now (straight lines with Shift); settings saved by older versions asked for straight bars
    if (!this.toolState.hl.free) this.toolState.hl = { ...this.toolState.hl, straight: false, snap: false, free: true };
    if (this.toolState.tool === 'hand') this.toolState.tool = 'pen';
    this.saveSettings = debounce(() => window.api.setSettings({ ...this.settings, toolState: this.toolState }), 400);
    this.saveToolState = this.saveSettings;

    this.editors = []; // { editor, tabEl }
    this.extensions = extensions;
    extensions.init(this); // after settings and saveSettings exist
    // Claude (MCP): the pipe opens only when the user switched it on
    this.mcp = new McpTools(this);
    if (this.settings.mcp) this.mcp.setEnabled(true).catch((err) => { this.settings.mcp = false; toast(String(err.message || err), { error: true }); });
    this.opening = new Set(); // rels being loaded right now
    this.active = null; // null = library
    this.loading = new Map();

    this.tabbar = h('div', { class: 'tabbar' });
    this.libTab = h('button', { class: 'tab lib-tab active', title: 'Library', onclick: () => this.showLibrary() }, h('span', { html: icon('home', 18) }), h('span', { class: 'tab-label' }, 'Library'));
    this.tabbar.append(this.libTab);
    this.main = h('main', { class: 'app-main' });
    this.library = new LibraryView(this);
    this.main.append(this.library.el);
    document.getElementById('app').append(this.tabbar, this.main);
    await this.library.load('');

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' && this.active) { this.active.tools.spaceHeld = false; this.active.el.classList.remove('space-pan'); }
    });
    window.addEventListener('blur', () => { if (this.active) { this.active.tools.spaceHeld = false; this.active.el.classList.remove('space-pan'); } });
    window.api.onBeforeClose(() => this.onWindowClose());
    // Paste anywhere in an open notebook (pictures, text, tables, files…).
    // Decided by where the keyboard focus is (a text box being typed in, a
    // field), not by the event target: Chromium sends the paste to an old
    // text selection even after editing has ended – with any tool.
    window.addEventListener('paste', (e) => {
      if (!this.active || document.querySelector('.modal-backdrop')) return;
      const f = document.activeElement;
      if (f && (f.isContentEditable || f.tagName === 'INPUT' || f.tagName === 'TEXTAREA')) return;
      if (e.target && e.target.isContentEditable && e.target === f) return;
      this.active.onPaste(e);
    }, true);
    // Prevent the window from navigating to dropped files.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    window.__app = this; // used by automated tests
    this.showStartupReport();
    maybeShowWhatsNew(this);
    // PDF files opened with StudyNotes from Explorer.
    window.api.onOpenFile((file) => this.openPdfFile(file));
    window.api.onExtError(({ message }) => toast('Could not save into the PDF: ' + message, { error: true, timeout: 6000 }));
    window.api.onExtConflict(({ path: p }) => toast(`The PDF was changed by another program, so it was not overwritten. Your notes are saved in "${p.split(/[\\/]/).pop()}" next to it.`, { timeout: 9000 }));
    for (const file of await window.api.extPending().catch(() => [])) this.openPdfFile(file);
  }

  // After a crash or power cut: say what happened and what was repaired.
  async showStartupReport() {
    const r = await window.api.startupReport().catch(() => null);
    if (!r || !r.crashed) return;
    const lines = [r.rendererCrash
      ? 'StudyNotes had a problem and was restarted. Your notes are saved up to the last ~2 seconds before that.'
      : 'StudyNotes was not closed normally last time (crash or power cut). Your notes are saved up to the last ~2 seconds before that.'];
    if (r.repaired && r.repaired.length) lines.push(`${r.repaired.length} damaged file(s) were restored from the backups.`);
    if (r.unrepairable && r.unrepairable.length) lines.push(`${r.unrepairable.length} damaged file(s) could not be restored (kept as ".damaged"). Older versions: right-click the notebook → Restore from backup.`);
    modal({ title: 'Your notes are safe', body: h('div', {}, ...lines.map((t) => h('p', {}, t))), actions: [{ label: 'OK', primary: true, result: true }] });
  }

  async onWindowClose() {
    window.api.closeAck();
    if (this._closingWindow) return;
    this._closingWindow = true;
    for (let attempt = 0; ; attempt++) {
      try {
        await Promise.all(this.editors.map(({ editor }) => editor.flush()));
        break;
      } catch (err) {
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
        const discard = await confirmDialog('Some changes could not be saved',
          `${err.message}\n\nClose anyway and lose the unsaved changes? Choose Cancel to keep the app open and try again later.`,
          { okLabel: 'Close anyway', danger: true });
        if (!discard) { this._closingWindow = false; return; }
        break;
      }
    }
    for (const { editor } of this.editors) editor.freezeSaves();
    // PDFs opened from the computer: the notes must reach the files.
    for (;;) {
      const failed = await window.api.extWriteAll().catch(() => []);
      if (!failed.length) break;
      const retry = await confirmDialog('Notes not saved into a PDF',
        failed.map((f) => `${f.path.split(/[\\/]/).pop()}: ${f.message}`).join('\n') + '\n\nClose the PDF in the other program and try again. If you close now, the notes stay in StudyNotes and are written the next time you open this file.',
        { okLabel: 'Try again', cancelLabel: 'Close anyway' });
      if (!retry) break;
    }
    await window.api.backupSnapshotNow().catch(() => {});
    await this.syncBeforeClose();
    window.api.closeReady();
  }

  // Closing: wait for Google Drive with a progress window (can be skipped).
  async syncBeforeClose() {
    const info = await window.api.cloudInfo().catch(() => null);
    if (!info || !info.account) return;
    this.closingSync = true;
    const msg = h('div', { class: 'sync-close-msg' }, 'Saving your notes to Google Drive…');
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
    let skip;
    const skipped = new Promise((resolve) => { skip = resolve; });
    const dlg = modal({
      title: 'Syncing before closing',
      body: h('div', {}, msg, bar),
      actions: [{ label: 'Close without syncing', result: 'skip' }],
      onClose: () => skip('skip'),
    });
    this.closeProgress = (st) => {
      msg.textContent = st.message || 'Syncing…';
      const p = st.progress;
      bar.firstChild.style.width = p && p.total ? Math.round((100 * p.done) / p.total) + '%' : '100%';
      bar.classList.toggle('indeterminate', !(p && p.total));
    };
    // Every notebook is closing now, so all of them can be synced in both directions.
    await window.api.cloudOpenNotebooks([]).catch(() => {});
    const result = await Promise.race([window.api.cloudSync({ publish: false }).catch(() => null), skipped]);
    this.closeProgress = null;
    if (result !== 'skip') dlg.close('done');
  }

  // Save every open notebook, then sync with Google Drive (if signed in).
  async syncAll({ quiet = false } = {}) {
    const info = await window.api.cloudInfo().catch(() => null);
    if (!info || !info.account) return false;
    if (!quiet) toast('Syncing with Google Drive…', { timeout: 1200 });
    await Promise.all(this.editors.map(({ editor }) => editor.flush().catch(() => {})));
    this.updateTabs();
    await window.api.cloudSync();
    return true;
  }

  // ---------- tabs ----------
  showLibrary() {
    if (this.active) { this.active.recordView(); this.active.flush(); this.active.el.remove(); }
    this.active = null;
    this.updateTabs();
    this.main.replaceChildren(this.library.el);
    this.library.load();
  }

  activate(editor) {
    if (this.active === editor) return;
    if (this.active) { this.active.recordView(); this.active.el.remove(); }
    else this.library.el.remove();
    this.active = editor;
    this.main.replaceChildren(editor.el);
    editor.activate();
    this.updateTabs();
  }

  updateTabs() {
    this.libTab.classList.toggle('active', !this.active);
    for (const t of this.editors) t.tabEl.classList.toggle('active', t.editor === this.active);
    // Drive sync leaves notebooks that are open alone until they are closed.
    window.api.cloudOpenNotebooks(this.openRels()).catch(() => {});
  }

  // Notebooks Drive sync must not write into: open ones and ones being opened.
  openRels() {
    return [...this.editors.map((t) => t.editor.rel), ...this.opening];
  }

  makeTab(editor) {
    const label = h('span', { class: 'tab-label' }, editor.doc.nb.title);
    const tabEl = h('div', { class: 'tab', title: editor.doc.nb.title, onclick: () => this.activate(editor), onauxclick: (e) => { if (e.button === 1) this.closeEditor(editor); } },
      h('span', { html: icon(editor.isBoard ? 'board' : editor.doc.nb.hasPdf ? 'page' : 'notebook', 16) }), label,
      h('button', { class: 'tab-close', title: 'Close (Ctrl+W)', html: icon('close', 14), onclick: (e) => { e.stopPropagation(); this.closeEditor(editor); } }));
    tabEl._label = label;
    this.tabbar.append(tabEl);
    return tabEl;
  }

  onEditorRenamed(editor) {
    const t = this.editors.find((x) => x.editor === editor);
    if (t) { t.tabEl._label.textContent = editor.doc.nb.title; t.tabEl.title = editor.doc.nb.title; }
    this.updateTabs(); // tell Drive sync the new folder name, so it keeps skipping this notebook
  }

  async closeEditor(editor) {
    if (editor.closing || !this.editors.some((x) => x.editor === editor)) return;
    editor.closing = true;
    try {
      await editor.flush();
      // Opened PDF file: put the notes into the file now (stays open on failure).
      if (editor.isExternal) await window.api.extWrite(editor.rel);
    } catch (err) {
      editor.closing = false;
      toast('Could not save, the notebook stays open: ' + err.message, { error: true, timeout: 6000 });
      return;
    }
    const i = this.editors.findIndex((x) => x.editor === editor); // re-check after the await
    if (i < 0) return;
    const [t] = this.editors.splice(i, 1);
    t.tabEl.remove();
    this.updateTabs(); // tell Drive sync this notebook is no longer open
    const wasActive = this.active === editor;
    editor.destroy();
    for (const pdf of editor.doc.pdfs.values()) pdf.destroy();
    if (wasActive) {
      this.active = null;
      const next = this.editors[Math.min(i, this.editors.length - 1)];
      if (next) this.activate(next.editor); else this.showLibrary();
    }
  }

  isOpen(rel) { return this.editors.some(({ editor }) => editor.rel === rel); }
  isOpenUnder(rel) { return this.editors.some(({ editor }) => editor.rel === rel || editor.rel.startsWith(rel + '/')); }

  async closeNotebooksUnder(rel) {
    for (const { editor } of this.editors.slice()) {
      if (editor.rel === rel || editor.rel.startsWith(rel + '/')) await this.closeEditor(editor);
    }
  }

  async flushNotebook(rel) {
    const t = this.editors.find(({ editor }) => editor.rel === rel);
    if (t) await t.editor.flush();
  }

  // ---------- opening ----------
  // A PDF file from the computer: edited in place, the notes go into that file.
  async openPdfFile(file, { fill = false } = {}) {
    try {
      const { rel, recovered, imported } = await window.api.extOpen(file);
      if (recovered) toast(`The PDF was changed outside StudyNotes. Notes that were not in it yet are kept in your library: "${recovered}".`, { timeout: 10000 });
      if (imported) toast('This PDF is protected, so it was added to your library instead of being edited in place.', { timeout: 7000 });
      if (recovered || imported) this.library.load().catch(() => {});
      if (fill) this.fillNext = rel;
      return await this.openNotebook(rel);
    } catch (err) {
      toast('Could not open the PDF: ' + (err.message || err), { error: true, timeout: 6000 });
      return null;
    }
  }

  async openNotebook(rel, pageIndex = null, query = null, hit = null) {
    const open = this.editors.find(({ editor }) => editor.rel === rel);
    if (open) {
      this.activate(open.editor);
      if (pageIndex !== null) hit ? open.editor.goToHit(hit, query) : open.editor.viewer.scrollToPage(pageIndex);
      return open.editor;
    }
    if (this.loading.has(rel)) return this.loading.get(rel);
    const p = this._open(rel, pageIndex, query, hit).finally(() => this.loading.delete(rel));
    this.loading.set(rel, p);
    return p;
  }

  async _open(rel, pageIndex, query, hit) {
    const overlay = h('div', { class: 'loading-overlay' }, h('div', { class: 'spinner' }), h('div', { class: 'loading-text' }, 'Opening…'));
    document.body.append(overlay);
    const setText = (t) => { overlay.lastChild.textContent = t; };
    let doc;
    // Tell Drive sync first, so it doesn't write into this notebook while it loads.
    this.opening.add(rel);
    await window.api.cloudOpenNotebooks(this.openRels()).catch(() => {});
    try {
      doc = await this.loadDoc(rel, setText);
    } catch (err) {
      this.opening.delete(rel);
      this.updateTabs();
      overlay.remove();
      console.error(err);
      toast('Could not open notebook: ' + (err.message || err), { error: true, timeout: 6000 });
      return null;
    }
    if (pageIndex !== null) doc.startPage = pageIndex;
    this.opening.delete(rel);
    const editor = new Editor(this, doc);
    if (this.fillNext === rel) { editor.fillMode = true; this.fillNext = null; }
    const tabEl = this.makeTab(editor);
    this.editors.push({ editor, tabEl });
    if (this.active) { this.active.recordView(); this.active.el.remove(); } else this.library.el.remove();
    this.active = editor;
    this.main.replaceChildren(editor.el);
    editor.mount();
    this.updateTabs();
    overlay.remove();
    if (hit) setTimeout(() => editor.goToHit(hit, query), 50);
    return editor;
  }

  async loadDoc(rel, setText = () => {}) {
    const nb = await window.api.readNotebook(rel);
    const pages = await window.api.readPages(rel);
    const pdfs = new Map();
    const textIndexes = {};
    const ocr = {};
    if (nb.hasPdf) {
      setText('Loading PDF…');
      const pdf = await PdfDoc.open(rel, (nb.sources && nb.sources.main && nb.sources.main.file) || 'source.pdf');
      pdfs.set('main', pdf);
      if (nb.needsInit || !nb.pages.length) {
        setText(`Preparing ${pdf.numPages} pages…`);
        const sizes = await pdf.pageSizes((n, total) => setText(`Preparing pages ${n} / ${total}…`));
        nb.pages = sizes.map((s, i) => ({ id: uid(), kind: 'pdf', pdfPage: i + 1, w: s.w, h: s.h }));
        nb.pdfPageCount = pdf.numPages;
        delete nb.needsInit;
        await window.api.writeNotebook(rel, nb);
      }
      if (!nb.coverVersion) {
        // Saved with the notebook by the editor's normal save (same object).
        this.makeCover(rel, pdf).then(() => {
          nb.coverVersion = 2;
          const t = this.editors.find(({ editor }) => editor.doc.nb === nb);
          if (t) t.editor.markDirty();
        }).catch((e) => console.warn('cover', e));
      }
    }
    for (const src of Object.keys(nb.sources || {})) {
      textIndexes[src] = await window.api.readText(rel, src).catch(() => null);
      const o = await window.api.readOcr(rel, src).catch(() => null);
      if (o && o.pages) ocr[src] = o;
    }
    if (!nb.pages.length) nb.pages.push({ id: uid(), kind: 'paper', paper: nb.paperDefault || 'lined', w: 595.28, h: 841.89 });
    window.api.cleanupPages(rel).catch(() => {});
    return { rel, nb, pdfs, pages, textIndexes, ocr };
  }

  // Page list + cover for a freshly imported PDF without opening it.
  async prepareNotebook(rel) {
    const nb = await window.api.readNotebook(rel);
    if (!nb.hasPdf || !nb.needsInit) return;
    const pdf = await PdfDoc.open(rel);
    try {
      const sizes = await pdf.pageSizes();
      nb.pages = sizes.map((s, i) => ({ id: uid(), kind: 'pdf', pdfPage: i + 1, w: s.w, h: s.h }));
      nb.pdfPageCount = pdf.numPages;
      delete nb.needsInit;
      await this.makeCover(rel, pdf).then(() => { nb.coverVersion = 2; }).catch(() => {});
      await window.api.writeNotebook(rel, nb);
    } finally {
      pdf.destroy();
    }
  }

  async makeCover(rel, pdf) {
    const vp = await pdf.viewport(1, 1);
    const scale = 360 / vp.width;
    const canvas = await pdf.render(1, scale, 50).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    canvas.width = canvas.height = 0;
    await window.api.writeCover(rel, buf);
  }

  // ---------- keyboard ----------
  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = shortcutKey(e);
    if (document.querySelector('.modal-backdrop')) return;
    if (ctrl && k === 'w' && this.active) { e.preventDefault(); this.closeEditor(this.active); return; }
    if (ctrl && k === 'tab') {
      e.preventDefault();
      const list = [null, ...this.editors.map((t) => t.editor)];
      const i = list.indexOf(this.active);
      const next = list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length];
      if (next) this.activate(next); else this.showLibrary();
      return;
    }
    const t = e.target;
    const typing = t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (typing || !this.active) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.active.tools.spaceHeld = true;
      this.active.el.classList.add('space-pan');
      return;
    }
    if (this.active.onKey(e)) e.preventDefault();
  }

  // ---------- dialogs ----------
  // ---------- theme ----------
  // 'light' | 'dark' | 'system'. Only the interface changes; pages stay white.
  applyTheme() {
    const pref = this.settings.theme || 'light';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const dark = pref === 'dark' || (pref === 'system' && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.api.setTheme(pref).catch(() => {});
    if (!this._themeWatch) {
      this._themeWatch = true;
      mq.addEventListener('change', () => { if ((this.settings.theme || 'light') === 'system') this.applyTheme(); });
    }
  }

  setTheme(pref) {
    this.settings.theme = pref;
    this.applyTheme();
    this.saveSettings();
  }

  toggleDark() {
    this.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  showSettings(tab = 'general') {
    const s = this.settings;
    const libPath = h('code', { class: 'path' }, this.info.libraryRoot);
    const check = (label, key, hint) => {
      const input = h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; this.saveSettings(); } });
      return h('label', { class: 'check' }, input, h('span', {}, label, hint ? h('small', {}, hint) : null));
    };
    // Sections on the left, one shown at a time (built when first opened).
    const sections = [
      ['general', 'General', 'settings', () => [
        h('div', { class: 'field' }, h('span', {}, 'Language'),
          h('div', { class: 'row' }, ...[['en', 'English'], ['ru', 'Русский']].map(([v, label]) => h('button', {
            class: `chip no-i18n${(s.lang || 'en') === v ? ' active' : ''}`, dataset: { lang: v },
            onclick: (e) => {
              s.lang = v; this.saveSettings(); setLang(v);
              e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget));
            },
          }, label)))),
        h('div', { class: 'field' }, h('span', {}, 'Appearance'),
          h('div', { class: 'row' }, ...[['light', 'Light'], ['dark', 'Dark'], ['system', 'Like Windows']].map(([v, label]) => h('button', {
            class: `chip${(s.theme || 'light') === v ? ' active' : ''}`,
            onclick: (e) => { this.setTheme(v); e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget)); },
          }, label)))),
        check('Round PDF letters', 'pdfShapes', 'Draws the letters of PDFs as smooth shapes (like other PDF readers) instead of through Windows text rendering, which makes small print angular. Applies to notebooks opened afterwards'),
      ]],
      ['pen', 'Pen & input', 'pen', () => [
        check('Mouse can draw', 'mouseDraws', 'Turn off to scroll with the mouse and draw only with the pen'),
        check('Scribble to erase', 'scribbleErase', 'Scribble back and forth over handwriting with the pen to erase it (like GoodNotes)'),
        check('Scribbling also erases text', 'scribbleText', 'Scribbling over a text box deletes it too (off: scribbling erases only handwriting)'),
        check('Smooth my handwriting', 'smoothInk', 'Removes shaking and evens out curves of your letters while keeping your own handwriting'),
        check('Draw & hold to create shapes', 'shapeHold', 'Hold the pen still at the end of a stroke to snap it to a line, rectangle, triangle or ellipse'),
        check('Pasted text keeps formatting', 'pasteFormatting', 'Off: text is always pasted as plain text. On: bold, italic, underline and lists are kept'),
        this.tabletSettings(),
      ]],
      ['library', 'Library & backups', 'folder', () => [
        h('div', { class: 'field' }, h('span', {}, 'Library folder'), libPath,
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: async () => {
              const r = await window.api.chooseLibrary();
              if (r) { this.info.libraryRoot = r; libPath.textContent = r; await this.closeAll(); this.library.load(''); toast('Library folder changed'); }
            } }, 'Change…'),
            h('button', { class: 'btn', onclick: () => window.api.showLibraryFolder() }, 'Open in Explorer')),
          h('small', { class: 'hint' }, 'Sync: choose a folder inside OneDrive, Google Drive or Dropbox and your notes sync between PCs automatically. Avoid editing the same notebook on two PCs at the same time.')),
        h('div', { class: 'field' }, h('span', {}, 'Backup & moving to a new version or PC'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', onclick: () => this.exportSettings() }, 'Export settings…'),
            h('button', { class: 'btn', onclick: () => this.importSettings() }, 'Import settings…'),
            h('button', { class: 'btn', onclick: () => this.exportBackup() }, 'Back up all notes…'),
            h('button', { class: 'btn', onclick: () => this.importBackup() }, 'Import notes…'),
            h('button', { class: 'btn', onclick: () => window.api.backupOpenFolder() }, 'Open automatic backups')),
          h('small', { class: 'hint' }, 'Settings include your tools, favourite pens and colours. A notes backup (.studynotes) contains every folder and notebook; importing it never overwrites anything – it goes into a new folder. Files from older versions always open in newer ones. Automatic backups: every hour, next to your library (right-click a notebook → Restore from backup).')),
      ]],
      ['sync', 'Google Drive', 'cloud', () => [this.driveSettings()]],
      ['ai', 'AI assistant', 'ai', () => [this.aiSettings()]],
      ['addons', 'Add-ons', 'star', () => [this.addonSettings()]],
      ['about', 'About', 'more', () => [
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => showWhatsNew(this.info.version) }, "What's new"),
          h('button', { class: 'btn', onclick: () => this.showAbout() }, 'About StudyNotes')),
        h('small', { class: 'hint' }, `StudyNotes ${this.info.version}. Graphics tablet: pressure works when the driver uses "Windows Ink" (newer Wacom drivers: Wacom Tablet Properties → Mapping → Use Windows Ink; older Bamboo drivers do it automatically).`),
      ]],
    ];
    const pane = h('div', { class: 'settings-pane form' });
    const built = new Map();
    const nav = h('nav', { class: 'settings-nav' });
    const show = (key) => {
      const sec = sections.find((x) => x[0] === key) || sections[0];
      if (!built.has(sec[0])) built.set(sec[0], h('div', { class: 'settings-section' }, h('h2', { class: 'settings-h' }, sec[1]), ...sec[3]().filter(Boolean)));
      pane.replaceChildren(built.get(sec[0]));
      pane.scrollTop = 0;
      for (const b of nav.children) b.classList.toggle('active', b.dataset.key === sec[0]);
    };
    for (const [key, label, ic] of sections) {
      nav.append(h('button', { class: 'settings-tab', dataset: { key }, onclick: () => show(key) }, h('span', { class: 'settings-ic', html: icon(ic, 18) }), h('span', {}, label)));
    }
    show(sections.some((x) => x[0] === tab) ? tab : 'general');
    modal({
      title: 'Settings',
      width: 920,
      body: h('div', { class: 'settings' }, nav, pane),
      actions: [{ label: 'Done', primary: true, result: true }],
    });
  }

  // ---------- AI assistant (Settings → AI assistant) ----------
  // Three ways to connect: the Claude app with the user's subscription (MCP),
  // an API key, or a model on this computer. Keys stay in the main process.
  aiSettings() {
    const s = this.settings;
    const ai = s.ai = { provider: '', model: '', baseUrl: '', monthlyLimit: 200, custom: '', enabled: false, ...(s.ai || {}) };
    ai.via ||= ai.provider === 'local' ? 'local' : ai.provider ? 'api' : (s.mcp ? 'claude' : 'api');
    const save = () => this.saveSettings();
    const sw = (on, onChange, label) => h('label', { class: 'switch', title: label },
      h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label, onchange: (e) => onChange(e.target.checked) }), h('span', { class: 'switch-track' }));
    const status = h('small', { class: 'hint ai-status' }, '');
    let info = null;
    const refresh = async () => {
      info = await window.api.aiInfo().catch(() => null);
      if (!info) return;
      const p = info.providers[ai.provider];
      status.textContent = ai.via === 'claude' || ai.via === 'claudecode' ? '' : !ai.provider ? 'Not set up'
        : `${p ? p.name : ai.provider}${p && p.key ? (info.keys[ai.provider] ? ' · key saved' : ' · no key yet') : ''}${ai.model ? ' · ' + ai.model : ''} · ${info.used} requests this month`;
      keyRow.hidden = !(p && p.key);
    };

    // --- Claude app (subscription) ---
    const testOut = h('div', { class: 'mcp-test' });
    const showTest = (r) => {
      const line = (ok, text) => h('div', { class: `mcp-line ${ok ? 'ok' : 'bad'}` }, h('span', { html: icon(ok ? 'check' : 'close', 14) }), h('span', { class: 'no-i18n' }, text));
      testOut.replaceChildren(
        ...r.files.map((f) => line(f.connected, `${f.connected ? 'Connected in' : f.exists ? 'Not connected in' : 'No file'}: ${f.file}`)),
        line(r.pipe, r.pipe ? 'StudyNotes is listening for Claude' : 'Claude access is switched off (switch above)'),
        line(r.bridge === 'ok' && r.tools > 0, r.bridge === 'ok' ? `The bridge answers: ${r.tools} tools` : `The bridge: ${r.error || 'no answer'}`));
    };
    const claudeBox = h('div', { class: 'ai-way-body' },
      h('div', { class: 'row' }, sw(!!s.mcp, (v) => { this.mcp.setEnabled(v).catch((err) => toast(String(err.message || err), { error: true })); }, 'Claude (MCP)'), h('b', {}, 'Let the Claude app use StudyNotes')),
      h('ol', { class: 'steps' },
        h('li', {}, 'Switch it on (above).'),
        h('li', {}, 'Click "Connect Claude Desktop".'),
        h('li', {}, 'Quit Claude Desktop completely (tray icon next to the clock → Quit) and start it again.'),
        h('li', {}, 'In Claude: "+" → Connectors → StudyNotes should be listed. Ask for example "Which notebooks do I have?"')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => {
          try {
            const r = await window.api.mcpInstallClaude();
            toast(`Added to Claude Desktop (${r.files.length} ${r.files.length === 1 ? 'file' : 'files'}). Quit Claude Desktop completely and start it again.`, { timeout: 7000 });
            showTest(await window.api.mcpTest());
          } catch (err) { toast(errorText(err), { error: true }); }
        } }, 'Connect Claude Desktop'),
        h('button', { class: 'btn ghost', onclick: async () => { testOut.replaceChildren(h('small', { class: 'hint' }, 'Testing…')); showTest(await window.api.mcpTest()); } }, 'Test connection')),
      testOut,
      h('small', { class: 'hint wrap' }, 'Uses your own Claude plan (Pro, Max), no API key. Claude asks before each change; Ctrl+Z in StudyNotes undoes it.'));

    // --- API key / local model ---
    const modelSel = h('select', { class: 'rec-select', 'aria-label': 'Model', onchange: () => { ai.model = modelSel.value; save(); refresh(); } });
    const setModels = (list) => {
      const all = [...new Set([ai.model, ...list].filter(Boolean))];
      modelSel.replaceChildren(h('option', { value: '' }, '– choose a model –'), ...all.map((m) => h('option', { value: m, class: 'no-i18n', selected: m === ai.model }, m)));
    };
    const provSel = h('select', { class: 'rec-select', 'aria-label': 'AI provider', onchange: () => { ai.provider = provSel.value; ai.model = ''; setModels([]); save(); refresh(); } },
      h('option', { value: '' }, '– choose –'),
      ...[['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI (GPT)'], ['gemini', 'Google (Gemini)']].map(([v, l]) => h('option', { value: v, selected: v === ai.provider }, l)));
    const keyIn = h('input', { type: 'password', class: 'ai-key', placeholder: 'API key', autocomplete: 'off', 'aria-label': 'API key' });
    const keyRow = h('div', { class: 'row' }, keyIn,
      h('button', { class: 'btn small', onclick: async () => {
        try { await window.api.aiSetKey(ai.provider, keyIn.value); keyIn.value = ''; toast('Key saved (encrypted on this computer)'); refresh(); } catch (err) { toast(errorText(err), { error: true }); }
      } }, 'Save key'),
      h('button', { class: 'btn ghost small', onclick: async () => { await window.api.aiSetKey(ai.provider, '').catch(() => {}); refresh(); } }, 'Remove key'));
    const baseIn = h('input', { type: 'text', value: ai.baseUrl || 'http://localhost:11434/v1', class: 'ai-base', 'aria-label': 'Server address', onchange: () => { ai.baseUrl = baseIn.value.trim(); save(); } });
    const modelRow = h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Model'), modelSel,
      h('button', { class: 'btn small', onclick: async () => {
        try { setModels(await window.api.aiModels({ provider: ai.provider, baseUrl: ai.baseUrl })); toast('Models loaded'); } catch (err) { toast(errorText(err), { error: true }); }
      } }, 'Load models'));
    const apiBox = h('div', { class: 'ai-way-body' }, h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Provider'), provSel), keyRow,
      h('small', { class: 'hint wrap' }, 'The key is stored encrypted on this computer and only sent to this provider. Requests are billed by the provider.'));
    const localBox = h('div', { class: 'ai-way-body' }, h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Server'), baseIn),
      h('small', { class: 'hint wrap' }, 'Ollama or LM Studio on this computer (or in your own network). Nothing leaves it.'));
    const shared = h('div', { class: 'ai-shared' },
      modelRow,
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Requests per month (0: no limit)'),
        h('input', { type: 'number', min: 0, step: 10, value: ai.monthlyLimit, class: 'ai-limit', 'aria-label': 'Monthly limit', onchange: (e) => { ai.monthlyLimit = Math.max(0, Number(e.target.value) || 0); save(); } })),
      h('textarea', { rows: 2, class: 'ai-custom', placeholder: 'Your standing instructions, e.g. "Answer in German, short, keep formulas in LaTeX."', 'aria-label': 'Standing instructions', onchange: (e) => { ai.custom = e.target.value; save(); } }, ai.custom || ''));

    // --- Claude Code: a chat in StudyNotes with the user's own Claude Code (subscription) ---
    const ccOut = h('div', { class: 'mcp-test' });
    const ccFind = async () => {
      const r = await window.api.chatInfo(ai.ccPath || '').catch((err) => ({ found: false, error: errorText(err) }));
      const ok = r.found;
      ccOut.replaceChildren(h('div', { class: `mcp-line ${ok ? 'ok' : 'bad'}` }, h('span', { html: icon(ok ? 'check' : 'close', 14) }),
        h('span', { class: 'no-i18n' }, ok ? `Claude Code found: ${r.path}${r.version ? ' (' + r.version + ')' : ''}` : 'Claude Code was not found. Install it, run "claude" once in a terminal and sign in – or enter its path below.')));
    };
    const ccBox = h('div', { class: 'ai-way-body' },
      h('ol', { class: 'steps' },
        h('li', {}, 'Install Claude Code and sign in once: in a terminal run "claude", then log in with your Claude account.'),
        h('li', {}, 'Switch on "AI button in notebooks" above and press Ctrl+J in a notebook: the chat opens on the right.')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: ccFind }, 'Find Claude Code')),
      ccOut,
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Path (optional)'),
        h('input', { type: 'text', class: 'ai-base', value: ai.ccPath || '', placeholder: 'found automatically', 'aria-label': 'Claude Code path', onchange: (e) => { ai.ccPath = e.target.value.trim(); save(); } })),
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Model'),
        h('select', { class: 'rec-select', 'aria-label': 'Claude Code model', onchange: (e) => { ai.ccModel = e.target.value; save(); } },
          ...[['', 'Default'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']].map(([v, l]) => h('option', { value: v, selected: (ai.ccModel || '') === v }, l)))),
      h('small', { class: 'hint wrap ai-note' }, 'Like the Claude plugins for Obsidian: StudyNotes starts your Claude Code, which uses your Claude plan. Anthropic allows a subscription only in its own apps; whether starting Claude Code from another app is covered is not settled – you decide. Claude can only use the StudyNotes tools here, not your files or commands.'));

    const ways = [
      ['claudecode', 'Claude Code', 'Chat here with your subscription', ccBox],
      ['claude', 'Claude app', 'With your Claude subscription', claudeBox],
      ['api', 'API key', 'Anthropic, OpenAI or Gemini', apiBox],
      ['local', 'Local model', 'Ollama, LM Studio – offline', localBox],
    ];
    const wayBody = h('div', {});
    const wayBtns = h('div', { class: 'ai-ways', role: 'radiogroup', 'aria-label': 'How to connect' });
    const pick = (key) => {
      ai.via = key;
      if (key === 'local') ai.provider = 'local';
      else if (key === 'api' && ai.provider === 'local') { ai.provider = ''; ai.model = ''; }
      provSel.value = ai.provider === 'local' ? '' : ai.provider;
      save();
      for (const b of wayBtns.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
      const w = ways.find((x) => x[0] === key);
      wayBody.replaceChildren(w[3], ...(key === 'claude' || key === 'claudecode' ? [] : [shared]));
      if (key === 'claudecode') ccFind();
      setModels([]);
      refresh();
    };
    for (const [key, title, sub] of ways) wayBtns.append(h('button', { class: 'ai-way', role: 'radio', 'aria-checked': 'false', dataset: { key }, onclick: () => pick(key) }, h('b', {}, title), h('small', {}, sub)));
    pick(ai.via);
    return h('div', { class: 'ai-settings' },
      h('div', { class: 'row ai-top' }, sw(!!ai.enabled, (v) => { ai.enabled = v; save(); }, 'AI assistant'),
        h('div', {}, h('b', {}, 'AI button in notebooks (Ctrl+J)'), h('small', { class: 'hint wrap' }, 'Ask about your notes, summarise, explain, glossaries, exam questions, underline key terms. You see what is sent; changes are previewed and undone with Ctrl+Z.'))),
      status,
      h('div', { class: 'settings-h3' }, 'How to connect'),
      wayBtns, wayBody,
      h('div', { class: 'settings-h3' }, 'Notes style'),
      h('small', { class: 'hint wrap' }, 'How Claude writes notes: on the lines of the paper, headings bigger and coloured, colours to suit white or dark paper. A notebook can have its own style (chat settings).'),
      notesStyleEditor(s.notesStyle, (v) => { s.notesStyle = v; save(); }));
  }

  // ---------- add-ons ----------
  // A list of add-ons: each with a switch and, when it has any, its settings
  // (opened with "Settings"). New add-ons go into ADDONS below.
  addonSettings() {
    const s = this.settings;
    const sw = (on, onChange, label) => {
      const input = h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
      return h('label', { class: 'switch', title: label }, input, h('span', { class: 'switch-track' }));
    };
    // A tile per add-on (icon, name, one line, switch); a click opens its page
    // with the full text and its settings.
    let list = null;
    const root = h('div', { class: 'addons' });
    const card = ({ name, about, on, setOn, state, settings, icon: ic = 'star' }) => {
      const short = (about.match(/^[^.!?]*[.!?]/) || [about])[0];
      let cur = on;
      const set = (v) => { cur = v; setOn(v); };
      const detail = () => {
        const back = h('button', { class: 'btn ghost small addon-back', onclick: () => root.replaceChildren(list) }, '← All add-ons');
        root.replaceChildren(h('div', { class: 'addon-detail' }, back,
          h('div', { class: 'addon-dhead' }, h('span', { class: 'addon-ic big', html: icon(ic, 28) }),
            h('div', { class: 'addon-title' }, h('b', {}, name), state ? state.cloneNode(true) : null),
            setOn ? sw(cur, set, name) : h('span', { class: 'addon-always' }, 'Always on')),
          h('p', { class: 'addon-about' }, about),
          settings ? h('div', { class: 'addon-settings' }, ...settings) : null));
      };
      const tile = h('div', { class: 'addon', tabindex: 0, onclick: (e) => { if (!e.target.closest('.switch')) detail(); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) detail(); } },
        h('div', { class: 'addon-head' }, h('span', { class: 'addon-ic', html: icon(ic, 20) }),
          h('div', { class: 'addon-title' }, h('b', {}, name), state || null),
          setOn ? sw(on, set, name) : h('span', { class: 'addon-always' }, 'Always on')),
        h('small', { class: 'hint wrap' }, short),
        settings ? h('button', { class: 'btn ghost small addon-more', onclick: (e) => { e.stopPropagation(); detail(); } }, 'Settings') : null);
      return tile;
    };

    // text recognition: built in
    const ocrState = h('small', { class: 'addon-state' }, '');
    window.api.ocrStatus().then((st) => {
      ocrState.textContent = st.installed ? 'Built in · English, German, Russian' : 'Language data missing – please reinstall StudyNotes';
    }, () => {});

    // handwriting to text: Windows (offline) or Google (online)
    const engine = s.inkEngine === 'google' ? 'google' : 'windows';
    const recSel = h('select', { class: 'rec-select', onchange: () => { s.inkRecognizer = recSel.value; this.saveSettings(); } }, h('option', { value: '' }, 'Windows default'));
    const recState = h('small', { class: 'hint' }, '');
    window.api.inkRecognizers().then((list) => {
      for (const n of list) recSel.append(h('option', { value: n, class: 'no-i18n' }, n));
      recSel.value = list.includes(s.inkRecognizer) ? s.inkRecognizer : '';
      if (!list.length) recState.textContent = 'Windows has no handwriting recognizer installed. Add one: Windows Settings → Time & language → Language → (language) → Options → Handwriting.';
    }, (err) => { recSel.disabled = true; recState.textContent = 'The Windows recognizer is not available on this PC: ' + errorText(err) + ' – choose Google above.'; });
    const winRow = h('div', { class: 'addon-sub', hidden: engine !== 'windows' },
      h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Recognizer'), recSel), recState);
    const exportRow = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s.exportInkText, onchange: (e) => { s.exportInkText = e.target.checked; this.saveSettings(); } }), h('span', {}, 'Export handwriting as text', h('small', {}, 'The exported PDF can be searched and copied (read by Windows, offline)')));
    const engineRow = h('div', { class: 'row' }, ...[['windows', 'Windows (offline)'], ['google', 'Google (online)']].map(([v, label]) => h('button', {
      class: `chip${engine === v ? ' active' : ''}`,
      onclick: (e) => {
        s.inkEngine = v; this.saveSettings();
        engineRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget));
        winRow.hidden = v !== 'windows';
      },
    }, label)));

    // speech to text (Whisper on this computer) for recordings in the chat
    const sp = s.speech = speechSettings(s);
    const spState = h('small', { class: 'addon-state' }, '');
    const spLine = h('small', { class: 'hint wrap' }, '');
    const spModel = h('select', { class: 'rec-select', 'aria-label': 'Speech model', onchange: () => { sp.model = spModel.value; this.saveSettings(); spRefresh(); } });
    const spLang = h('select', { class: 'rec-select', 'aria-label': 'Language of the recordings', onchange: () => { sp.language = spLang.value; this.saveSettings(); } });
    const spBtn = h('button', { class: 'btn small' }, 'Download the model');
    const spDel = h('button', { class: 'btn ghost small', hidden: true }, 'Delete the model');
    const spRefresh = async () => {
      const st = await window.api.speechStatus(sp.model).catch(() => null);
      const ok = !!(st && st.downloaded);
      spState.textContent = ok ? 'On this computer · offline' : 'Model not downloaded yet';
      spLine.textContent = ok ? `${(st.size / 1e6).toFixed(0)} MB in the StudyNotes data folder.` : 'Downloaded once from Hugging Face, then everything stays on this computer.';
      spBtn.hidden = ok; spDel.hidden = !ok;
    };
    spBtn.onclick = async () => {
      spBtn.disabled = true;
      try {
        await withProgress((id) => window.api.speechDownload(sp.model, id), (f) => { spLine.textContent = `Downloading… ${Math.round(f * 100)}%`; });
      } catch (err) { toast(errorText(err), { error: true }); }
      spBtn.disabled = false;
      spRefresh();
    };
    spDel.onclick = async () => { await window.api.speechRemove(sp.model).catch(() => {}); spRefresh(); };
    window.api.speechInfo().then((info) => {
      for (const [k, label] of Object.entries(info.models)) spModel.append(h('option', { value: k, selected: sp.model === k }, label));
      const names = { german: 'German', english: 'English', russian: 'Russian', french: 'French', spanish: 'Spanish', italian: 'Italian', ukrainian: 'Ukrainian', polish: 'Polish', turkish: 'Turkish' };
      for (const l of info.languages) spLang.append(h('option', { value: l, selected: sp.language === l }, names[l] || l));
      spRefresh();
    }, () => {});

    list = h('div', { class: 'addon-grid' },
      card({
        name: 'Speech to text', icon: 'mic',
        about: 'Recordings attached in the AI chat (lectures, voice notes; mp3, m4a, wav, ogg) become text on this computer with Whisper, and Claude works with the transcript. The model is downloaded once; nothing is sent anywhere.',
        state: spState, on: !!sp.enabled, setOn: (v) => { sp.enabled = v; this.saveSettings(); },
        settings: [
          h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Model'), spModel),
          h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Language'), spLang),
          h('div', { class: 'row wrap' }, spBtn, spDel), spLine,
        ],
      }),
      card({
        name: 'Searchable scans', icon: 'search',
        about: 'Scanned PDFs become searchable by themselves when they are opened: search, select, copy and highlight their text like in any PDF – the pages stay as they are. Offline.',
        state: ocrState, on: s.autoOcr !== false, setOn: (v) => { s.autoOcr = v; this.saveSettings(); },
        settings: [h('small', { class: 'hint' }, 'By hand: Search → "Recognize text (OCR)".')],
      }),
      card({
        name: 'Editable scans', icon: 'scanText',
        about: 'Turns text in scans, photos and PDFs into text boxes you can edit, in a matching font, size, colour, tilt and look (lasso → Text area, or the page button in the toolbar). Handwriting becomes typed text.',
        on: !!s.editableScans, setOn: (v) => { s.editableScans = v; this.saveSettings(); },
        settings: [
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.googleOcrOffer !== false, onchange: (e) => { s.googleOcrOffer = e.target.checked; this.saveSettings(); } }),
            h('span', {}, 'Offer "Read better with Google"', h('small', {}, 'After recognising handwriting or an unsure reading: read it once more with Google (online, your Google account; the pictures are deleted right away)'))),
        ],
      }),
      card({
        name: 'Handwriting to text', icon: 'pen',
        about: 'Your pen writing → text: select it → "Copy as text" or "To text". Windows reads it on this PC; Google reads it online with your Google account (better for untidy writing).',
        settings: [h('div', { class: 'row' }, h('span', { class: 'tk-label' }, 'Read with'), engineRow), winRow, exportRow],
      }),
      // extensions (src/extensions, docs/EXTENSIONS.md): off until switched on
      ...extensions.list().map((x) => card({
        name: x.name, about: x.description, icon: x.icon || 'star',
        state: x.error ? h('small', { class: 'addon-state' }, 'Could not start: ' + x.error) : h('small', { class: 'addon-state' }, 'Extension'),
        on: x.enabled, setOn: (v) => extensions.setEnabled(x.id, v),
      })));
    root.append(list);
    return root;
  }

  // ---------- graphics tablet ----------
  tabletSettings() {
    const s = this.settings;
    const row = (act, label) => {
      const val = h('code', { class: 'tk-val' }, describeKey(s.tabletKeys && s.tabletKeys[act]));
      const learn = h('button', { class: 'btn', onclick: () => {
        val.textContent = 'press the tablet button now… (Esc = cancel)';
        learn.disabled = true;
        const onKey = (e) => {
          // Settings closed meanwhile: stop listening, don't take the key
          if (!val.isConnected) { window.removeEventListener('keydown', onKey, true); return; }
          if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return; // wait for the real key
          e.preventDefault(); e.stopImmediatePropagation();
          window.removeEventListener('keydown', onKey, true);
          learn.disabled = false;
          if (e.key !== 'Escape') { s.tabletKeys = { ...(s.tabletKeys || {}), [act]: keySignature(e) }; this.saveSettings(); }
          val.textContent = describeKey(s.tabletKeys && s.tabletKeys[act]);
        };
        window.addEventListener('keydown', onKey, true);
      } }, 'Set…');
      const clear = h('button', { class: 'btn ghost', onclick: () => {
        if (s.tabletKeys) { delete s.tabletKeys[act]; this.saveSettings(); }
        val.textContent = describeKey(null);
      } }, 'Clear');
      return h('div', { class: 'row' }, h('span', { class: 'tk-label' }, label), val, learn, clear);
    };
    return h('div', { class: 'field' }, h('span', {}, 'Graphics tablet'),
      row('undo', 'Button for Undo'),
      row('redo', 'Button for Redo'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.showPenCheck() }, 'Pen check…')),
      h('small', { class: 'hint' }, 'If a tablet button set to Ctrl+Z does something else (e.g. with a German or Russian keyboard layout): click "Set…" and press that button (if it arrives as Ctrl+Y, Ctrl+Y on the keyboard then undoes too – redo stays on Ctrl+Shift+Z). "Pen check" shows what the pen sends – pressure, buttons, eraser – and can copy a report.'));
  }

  // Shows what the pen really sends (pressure, buttons, eraser) and lets the
  // user copy a report – for tablet drivers that behave differently.
  showPenCheck() {
    const log = [];
    const info = h('pre', { class: 'pen-info no-i18n' }, 'Draw here with the pen, then press its buttons while drawing and while hovering.');
    const cv = h('canvas', { class: 'pen-pad', width: 520, height: 220 });
    const ctx = cv.getContext('2d');
    const fmt = (e) => `${e.type.replace('pointer', '').padEnd(6)} ${e.pointerType.padEnd(5)} id=${e.pointerId} pressure=${e.pressure.toFixed(3)} buttons=${e.buttons} button=${e.button} tilt=${e.tiltX},${e.tiltY}${e.width > 1 ? ` w=${e.width}` : ''}`;
    let last = '';
    const onPtr = (e) => {
      e.preventDefault();
      const line = fmt(e);
      info.textContent = line + (e.buttons & 32 ? '\n→ eraser' : (e.buttons & 2) || e.button === 2 ? '\n→ side button' : '');
      // keep changes, not every identical move
      const sig = line.replace(/pressure=\S+ /, '').replace(/tilt=\S+/, '');
      if (sig !== last || e.type !== 'pointermove') { log.push(`${Math.round(e.timeStamp)} ${line}`); last = sig; if (log.length > 400) log.shift(); }
      if (e.buttons || e.pressure > 0) {
        const r = cv.getBoundingClientRect();
        ctx.fillStyle = e.buttons & 32 || e.buttons & 2 ? '#e5484d' : '#1d2b6b';
        const rad = 1 + 5 * (e.pressure || 0.5);
        ctx.beginPath(); ctx.arc((e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height), rad, 0, Math.PI * 2); ctx.fill();
      }
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout']) cv.addEventListener(t, onPtr);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    const onKey = (e) => { log.push(`${Math.round(e.timeStamp)} key key=${JSON.stringify(e.key)} code=${e.code} keyCode=${e.keyCode} ctrl=${e.ctrlKey} shift=${e.shiftKey} alt=${e.altKey}`); };
    window.addEventListener('keydown', onKey, true);
    modal({
      title: 'Pen check',
      onClose: () => window.removeEventListener('keydown', onKey, true),
      width: 600,
      body: h('div', { class: 'form' }, cv, info,
        h('small', { class: 'hint' }, 'Blue = drawing, red = eraser / side button. Tablet buttons pressed now are recorded too.')),
      actions: [
        { label: 'Copy report', value: () => {
          navigator.clipboard.writeText(`StudyNotes ${this.info.version} pen check\n${navigator.userAgent}\n${log.join('\n')}`).catch(() => {});
          toast('Report copied – paste it into a message', { timeout: 1800 });
          return false; // keep the window open
        } },
        { label: 'Close', primary: true, result: true },
      ],
    });
  }

  // ---------- Google Drive ----------
  // Cloud button in the library: sync now, or open the settings to sign in.
  async cloudClick() {
    if (!(await this.syncAll())) this.showSettings();
  }

  onCloudStatus(st) {
    if (this.closeProgress) this.closeProgress(st);
    const label = this.library && this.library.cloudLabel;
    if (label) {
      label.textContent = st.state === 'off' ? '' : st.state === 'syncing' ? (st.message || 'Syncing…')
        : st.state === 'error' ? 'Sync problem' : st.last ? `Synced ${new Date(st.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
      label.title = st.message || '';
    }
    const btn = this.library && this.library.cloudBtn;
    if (btn) {
      btn.dataset.state = st.state || 'off';
      btn.title = 'Google Drive: ' + (st.message || (st.state === 'off' ? 'not set up' : 'up to date'));
      btn.innerHTML = icon(st.state === 'syncing' ? 'cloudSync' : 'cloud', 20);
    }
    // New files arrived: refresh the library list.
    if (st.state !== 'syncing' && st.summary && (st.summary.downloaded || st.summary.deletedLocal) && !this.active) this.library.load();
    if (st.state === 'error' && st.message) toast(st.message, { error: true, timeout: 5000 });
  }

  driveSettings() {
    const box = h('div', { class: 'field drive-field' }, h('span', {}, 'Google Drive sync'));
    const render = async () => {
      let info;
      try { info = await window.api.cloudInfo(); } catch (err) { info = { configured: false, status: { message: err.message } }; }
      const d = this.settings.drive || {};
      const id = h('input', { class: 'input', type: 'text', placeholder: 'Client ID (…apps.googleusercontent.com)', value: d.clientId || '' });
      const secret = h('input', { class: 'input', type: 'password', placeholder: 'Client secret', value: d.clientSecret || '' });
      const auto = h('input', { type: 'checkbox', checked: d.auto !== false });
      const saveCfg = async () => {
        this.settings.drive = { clientId: id.value.trim(), clientSecret: secret.value.trim(), auto: auto.checked };
        await window.api.cloudConfigure(this.settings.drive);
      };
      const status = h('small', { class: 'hint drive-status' }, info.status && info.status.message ? info.status.message : '');
      const rows = [];
      if (info.account) {
        rows.push(h('div', { class: 'drive-account' }, h('span', { html: icon('cloud', 20) }),
          h('span', {}, 'Signed in as ', h('b', {}, info.account.email || info.account.name || 'Google account'))));
        rows.push(h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', onclick: async () => { status.textContent = 'Syncing…'; await this.syncAll({ quiet: true }); render(); } }, 'Sync now'),
          h('button', { class: 'btn', onclick: async () => { await window.api.cloudSignOut(); render(); } }, 'Sign out')));
        rows.push(h('label', { class: 'check' }, auto, h('span', {}, 'Sync automatically', h('small', {}, 'Every 15 minutes and when you close the app (also Ctrl+S and the cloud button). Changes from your other PC arrive in an open notebook after you close it.'))));
        auto.addEventListener('change', saveCfg);
      } else {
        const signIn = async () => {
          await saveCfg();
          status.textContent = 'Your browser opens – sign in to Google and allow access, then come back here.';
          try { await window.api.cloudSignIn(); toast('Signed in to Google Drive'); render(); } catch (err) { status.textContent = 'Sign-in failed: ' + err.message; }
        };
        rows.push(
          h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: signIn }, 'Sign in with Google')),
          h('small', { class: 'hint' }, 'Your notes are synced with your own Google Drive. StudyNotes only sees the files it created itself, nothing else in your Drive.'),
          // Own Google client (optional, for experts).
          h('details', { class: 'own-client', open: !!(d.clientId) || !info.configured },
            h('summary', {}, 'Advanced: use your own Google client ID'),
            id, secret,
            h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.driveHelp() }, 'How to get a client ID')),
            h('small', { class: 'hint' }, 'Leave empty to use StudyNotes’ own client.')));
      }
      box.replaceChildren(box.firstChild, ...rows, status);
    };
    render();
    return box;
  }

  driveHelp() {
    const steps = [
      'Open console.cloud.google.com and sign in with your Google account.',
      'Create a project (top left → New project), name it e.g. “StudyNotes”.',
      'APIs & Services → Library → search “Google Drive API” → Enable.',
      'APIs & Services → OAuth consent screen → External → fill in app name and your e-mail → add yourself under “Test users”.',
      'APIs & Services → Credentials → Create credentials → OAuth client ID → Application type “Desktop app” → Create.',
      'Copy the Client ID and Client secret into StudyNotes → Settings → Google Drive sync, then click “Sign in with Google”.',
      'Optional but recommended: OAuth consent screen → “Publish app”. Otherwise Google signs you out every 7 days (test mode). No review is needed, because StudyNotes only asks for its own files.',
    ];
    modal({
      title: 'Get a Google client ID (one time)',
      width: 560,
      body: h('ol', { class: 'help-steps' }, ...steps.map((t) => h('li', {}, t))),
      actions: [{ label: 'Open Google Cloud Console', value: () => { window.open('https://console.cloud.google.com/apis/credentials'); return false; } }, { label: 'Close', primary: true, result: true }],
    });
  }

  async exportSettings() {
    try {
      const f = await window.api.exportSettings({ ...this.settings, toolState: this.toolState });
      if (f) toast('Settings exported to ' + f);
    } catch (err) { toast('Export failed: ' + err.message, { error: true }); }
  }

  async importSettings() {
    try {
      const s = await window.api.importSettings();
      if (!s) return;
      Object.assign(this.settings, s);
      if (s.toolState) {
        const def = defaultToolState();
        this.toolState.tool = s.toolState.tool || this.toolState.tool;
        for (const k of ['pen', 'hl', 'eraser', 'shape', 'text', 'laser']) this.toolState[k] = { ...def[k], ...(s.toolState[k] || {}) };
      }
      for (const { editor } of this.editors) editor.renderOptions();
      toast('Settings imported');
    } catch (err) { toast('Import failed: ' + err.message, { error: true }); }
  }

  async exportBackup() {
    await Promise.all(this.editors.map(({ editor }) => editor.flush().catch(() => {})));
    const t = toast('Creating backup…', { timeout: 600000 });
    try {
      const r = await window.api.exportBackup();
      t.remove();
      if (r) toast(`Backup saved (${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB): ${r.file}`, { timeout: 7000 });
    } catch (err) { t.remove(); toast('Backup failed: ' + err.message, { error: true }); }
  }

  async importBackup() {
    const t = toast('Importing…', { timeout: 600000 });
    try {
      const r = await window.api.importBackup();
      t.remove();
      if (!r) return;
      document.querySelector('.modal-backdrop')?.remove();
      await this.showLibrary();
      this.library.load(r.rel);
      toast(`Imported ${r.files} files into the folder "${r.rel}"`, { timeout: 6000 });
    } catch (err) { t.remove(); toast('Import failed: ' + err.message, { error: true }); }
  }

  async closeAll() {
    for (const { editor } of this.editors.slice()) await this.closeEditor(editor);
  }

  showAbout() {
    const licences = async () => {
      const text = await window.api.notices().catch(() => '');
      modal({ title: 'Licences', width: 760, body: h('pre', { class: 'notices no-i18n' }, text || '—'), actions: [{ label: 'Close', result: true }] });
    };
    modal({
      title: 'About StudyNotes',
      width: 460,
      body: h('div', { class: 'about' },
        h('img', { class: 'about-logo', src: 'icon.png', alt: '' }),
        h('div', { class: 'about-name' }, 'StudyNotes'),
        h('div', { class: 'about-ver' }, 'Version ' + this.info.version),
        h('p', { class: 'no-i18n' }, '© 2026 vlmelnik · MIT'),
        h('p', {}, h('a', { href: 'https://github.com/vlmelnik/studynotes', target: '_blank', rel: 'noopener', class: 'no-i18n' }, 'github.com/vlmelnik/studynotes')),
        h('button', { class: 'btn', onclick: licences }, 'Licences')),
      actions: [{ label: 'Close', result: true }],
    });
  }

  showShortcuts() {
    const rows = [
      ['V', 'Select & move'], ['P / H / E', 'Pen / Highlighter / Eraser'], ['L / S / T', 'Lasso / Shapes / Text'], ['Space + drag', 'Pan (any tool)'], ['Shift + wheel', 'Scroll fast'], ['Shift + drag (highlighter)', 'Straight line'],
      ['Middle mouse drag', 'Pan'], ['Ctrl + wheel', 'Zoom'], ['Ctrl + 0', 'Fit width'], ['Ctrl + Z / Ctrl + Y', 'Undo / Redo'],
      ['Ctrl + C / X / D', 'Copy / Cut / Duplicate selection'], ['Ctrl + V', 'Paste pictures, text, tables, files'], ['Ctrl + A', 'Select everything on the page'],
      ['Del', 'Delete selection'], ['Ctrl + B / I / U', 'Bold / italic / underline'], ['Ctrl + F', 'Search in notebook'],
      ['Ctrl + Shift + B', 'Show / hide pages'], ['PgUp / PgDn', 'Previous / next page'], ['Ctrl + W', 'Close tab'], ['Ctrl + Tab', 'Next tab'],
      ['Pen eraser end / barrel button', 'Erase'], ['Hold the pen button', 'Erase, then back to the pen'], ['Alt + wheel', 'Resize selection or tool size'],
    ];
    modal({
      title: 'Keyboard shortcuts',
      width: 520,
      body: h('table', { class: 'shortcuts' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
      actions: [{ label: 'Close', primary: true, result: true }],
    });
  }
}

new App().init().catch((err) => {
  console.error(err);
  document.body.textContent = 'StudyNotes failed to start: ' + err.message;
});
