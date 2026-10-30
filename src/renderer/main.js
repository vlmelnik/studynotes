// App shell: tabs (Library + open notebooks), notebook loading, settings.
import { h, toast, modal, debounce, confirmDialog, shortcutKey } from './ui.js';
import { icon } from './icons.js';
import { LibraryView } from './library-view.js';
import { Editor, defaultToolState } from './editor.js';
import { PdfDoc } from './pdfdoc.js';
import { uid } from './tools.js';
import { maybeShowWhatsNew, showWhatsNew } from './whats-new.js';
import { setLang } from './i18n.js';

class App {
  async init() {
    this.info = await window.api.info();
    this.settings = { mouseDraws: true, shapeHold: true, sidebarHidden: false, pasteFormatting: false, favorites: [], recentPens: [], recentColors: [], theme: 'light', ...(this.info.settings || {}) };
    this.applyTheme();
    setLang(this.settings.lang || 'en');
    window.api.onCloudStatus((st) => this.onCloudStatus(st));
    window.api.onCloudRequestSync(() => this.syncAll({ quiet: true }));
    window.api.onLibraryChanged(() => { if (!this.active) this.library.load(); });
    this.toolState = { ...defaultToolState(), ...(this.settings.toolState || {}) };
    for (const k of ['pen', 'hl', 'eraser', 'shape', 'text', 'laser']) this.toolState[k] = { ...defaultToolState()[k], ...(this.toolState[k] || {}) };
    if (this.toolState.tool === 'hand') this.toolState.tool = 'pen';
    this.saveSettings = debounce(() => window.api.setSettings({ ...this.settings, toolState: this.toolState }), 400);
    this.saveToolState = this.saveSettings;

    this.editors = []; // { editor, tabEl }
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
    window.addEventListener('paste', (e) => {
      const t = e.target;
      if (!this.active || document.querySelector('.modal-backdrop')) return;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      this.active.onPaste(e);
    });
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
    if (this.active) { this.active.flush(); this.active.el.remove(); }
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
    for (const src of Object.keys(nb.sources || {})) textIndexes[src] = await window.api.readText(rel, src).catch(() => null);
    if (!nb.pages.length) nb.pages.push({ id: uid(), kind: 'paper', paper: nb.paperDefault || 'lined', w: 595.28, h: 841.89 });
    window.api.cleanupPages(rel).catch(() => {});
    return { rel, nb, pdfs, pages, textIndexes };
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

  showSettings() {
    const s = this.settings;
    const libPath = h('code', { class: 'path' }, this.info.libraryRoot);
    const check = (label, key, hint) => {
      const input = h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; this.saveSettings(); } });
      return h('label', { class: 'check' }, input, h('span', {}, label, hint ? h('small', {}, hint) : null));
    };
    modal({
      title: 'Settings',
      width: 560,
      body: h('div', { class: 'form' },
        h('div', { class: 'field' }, h('span', {}, 'Library folder'), libPath,
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: async () => {
              const r = await window.api.chooseLibrary();
              if (r) { this.info.libraryRoot = r; libPath.textContent = r; await this.closeAll(); this.library.load(''); toast('Library folder changed'); }
            } }, 'Change…'),
            h('button', { class: 'btn', onclick: () => window.api.showLibraryFolder() }, 'Open in Explorer')),
          h('small', { class: 'hint' }, 'Sync: choose a folder inside OneDrive, Google Drive or Dropbox and your notes sync between PCs automatically. Avoid editing the same notebook on two PCs at the same time.')),
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
        check('Mouse can draw', 'mouseDraws', 'Turn off to scroll with the mouse and draw only with the pen'),
        check('Draw & hold to create shapes', 'shapeHold', 'Hold the pen still at the end of a stroke to snap it to a line, rectangle, triangle or ellipse'),
        check('Pasted text keeps formatting', 'pasteFormatting', 'Off: text is always pasted as plain text. On: bold, italic, underline and lists are kept'),
        h('div', { class: 'field' }, h('span', {}, 'Backup & moving to a new version or PC'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', onclick: () => this.exportSettings() }, 'Export settings…'),
            h('button', { class: 'btn', onclick: () => this.importSettings() }, 'Import settings…'),
            h('button', { class: 'btn', onclick: () => this.exportBackup() }, 'Back up all notes…'),
            h('button', { class: 'btn', onclick: () => this.importBackup() }, 'Import notes…'),
            h('button', { class: 'btn', onclick: () => window.api.backupOpenFolder() }, 'Open automatic backups')),
          h('small', { class: 'hint' }, 'Settings include your tools, favourite pens and colours. A notes backup (.studynotes) contains every folder and notebook; importing it never overwrites anything – it goes into a new folder. Files from older versions always open in newer ones. Automatic backups: every hour, next to your library (right-click a notebook → Restore from backup).')),
        this.driveSettings(),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => showWhatsNew(this.info.version) }, "What's new"),
          h('button', { class: 'btn', onclick: () => this.showAbout() }, 'About StudyNotes')),
        h('small', { class: 'hint' }, `StudyNotes ${this.info.version}. Graphics tablet: pressure works when "Windows Ink" is enabled in the tablet driver (Wacom: Wacom Tablet Properties → Mapping → Use Windows Ink).`)),
      actions: [{ label: 'Done', primary: true, result: true }],
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
      ['V', 'Select & move'], ['P / H / E', 'Pen / Highlighter / Eraser'], ['L / S / T', 'Lasso / Shapes / Text'], ['Space + drag', 'Pan (any tool)'],
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
