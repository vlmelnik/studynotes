// "What's new" window: shown once after an update (and from Settings).
import { h, modal } from './ui.js';
import { icon } from './icons.js';

// Newest first. Each item: [icon, title, one line].
export const RELEASES = [
  {
    version: '1.7',
    tagline: 'Edit scanned text, handwriting to text, eyedropper',
    items: [
      ['text', 'Make scanned text editable', 'Lasso tool → "Text area": draw a rectangle around text on a scan, photo or PDF – or use the page button in the toolbar for the whole page. The text is recognised (English, German, Russian) – also on photos with shadows, glare, blur, a tilt or light text on a dark background – the paper is cleaned behind it, and it comes back as text boxes in a matching font, size, colour and tilt. Add-on "Editable scans": turned on once (asked at the first use, or Settings → Add-ons); works offline.'],
      ['text', 'Match the document', 'Edited text looks like the photo around it: as soft (blurred), in the same perspective (letters leaning, the far side smaller) and the same light (glare, shadow). On by itself for recognised text; the new button in the text bar turns it on or off. Straight and sharp while you type; also in the PDF export.'],
      ['pen', 'Handwriting in photos', 'Handwritten pages and notes in photos become typed text in the handwriting font that looks most like them (or any other font). "Read better with Google" reads them once more online (optional) – better for untidy writing.'],
      ['text', 'More fonts', '14 widely used fonts: Cambria, Georgia, Garamond styles, Open Sans, Roboto, Inter, Lato, Source Sans, Fira Sans, Montserrat, Noto Sans / Serif, PT Sans / Serif, and 4 handwriting fonts. Recognised text picks the one that fits best.'],
      ['notebook', 'Sharper PDFs and better reading', 'Letters of PDFs are drawn smooth and sharp at every zoom (Settings → Round PDF letters). Highlighter with a round tip that blends like a real marker (black text stays black); Shift = straight line. Text selection keeps columns apart. Shift + wheel scrolls fast. Scanned PDFs become searchable by themselves when opened: search, select, copy and highlight their text like in any PDF – the pages stay as they are. Thanks to Pedro Falbo for these ideas and code.'],
      ['text', 'Text in its layout', 'Paragraphs and centred titles become one text box with the scan\'s line spacing; underlined words are recognised; logos stay as they are. Select several text boxes → "Combine".'],
      ['text', 'Smarter recognition', 'Recognised words are checked against dictionaries (Russian, English, German): Latin look-alike letters in Russian words ("Tak" → "Так") and lost spaces are corrected. Single bold words stay bold.'],
      ['pen', 'Handwriting to text', 'Select your handwriting → "Copy as text" or "To text". Read by Windows on your PC, or by Google online (Settings → Add-ons). Optionally the PDF export adds it as searchable, copyable text.'],
      ['settings', 'Add-ons', 'Settings → Add-ons: every add-on with its own switch and settings – searchable scans, editable scans, handwriting to text.'],
      ['pen', 'Eyedropper', 'Next to the colours (and in "More colours"): take any colour from the page. Shortcut: press I and click, or hold Alt and click.'],
      ['notebook', 'Fixes', 'Selecting PDF text works by whole lines, also in tables; dragging on highlighted text selects the text. Double-click edits text with the lasso too. Going back from the library keeps your page and zoom. Things dragged onto the next page stay in front and move to that page.'],
    ],
  },
  {
    version: '1.6.1',
    tagline: 'A new line engine, tablet buttons and text box fixes',
    items: [
      ['pen', 'New line engine', 'Letters stay exactly as you write them – no wobble, no thin tails with a dot, no spikes in small curls. Pen pressure feels more even.'],
      ['pen', 'Pencil', 'A fine, soft graphite grain instead of noisy pixels.'],
      ['settings', 'Tablet buttons', 'Ctrl+Z works with every keyboard layout. If a tablet button still does something else: Settings → Graphics tablet → Set… and press it. "Pen check" shows what the pen sends.'],
      ['eraser', 'Scribble erases text too', 'Optional: Settings → Scribbling also erases text.'],
      ['notebook', 'Back where you left off', 'A notebook opens at the page and zoom you left it, also after closing the app.'],
      ['text', 'Text boxes', 'The frame always fits the text; drag anywhere along the side to change the width; mouse wheel over a size field changes the size.'],
    ],
  },
  {
    version: '1.6',
    tagline: 'Steadier ink, PDF text and scribble to erase',
    items: [
      ['pen', 'Steady handwriting', 'The line no longer shakes while you write; small loops and dots (i, ä, full stops) come out right. Optional: Settings → Smooth my handwriting.'],
      ['eraser', 'Scribble to erase', 'Scribble back and forth over handwriting with the pen to erase it – like GoodNotes.'],
      ['highlighter', 'Printed PDF text', 'Select text in a PDF with the select tool to copy, highlight or underline it. The highlighter snaps to text lines.'],
      ['fillSign', 'PDF forms anywhere', 'Click into a form field of any PDF and type – no tool needed.'],
      ['formatPaint', 'Format painter', 'Copy the style of one text to another with one click.'],
      ['pageDelete', 'Delete a page fast', 'New button in the toolbar; Ctrl+Z brings the page back.'],
      ['text', 'Text fixes', 'Paragraphs stay when you colour a word, the colour goes only where you selected, double-click selects one word, pasting works with every tool and lands on top.'],
    ],
  },
  {
    version: '1.5',
    tagline: 'Fill & sign, calmer ink and a Russian interface',
    items: [
      ['settings', 'Russian interface', 'Switch the language in Settings → Language. Changes at once, no restart.'],
      ['fillSign', 'Fill & sign', 'Fill in PDF forms, add your signature (drawn or from a picture, saved for next time), date and ✓ – then save the PDF.'],
      ['pen', 'Calmer ink', 'The tip of the line no longer wiggles while you write, and lines stay still while you erase.'],
      ['eraser', 'Better eraser', '"Exact circle" erases exactly the eraser circle. "Text & pictures too" also removes text boxes and pictures.'],
      ['pen', 'Pen button', 'Hold the side button of the pen to erase – let go and you write again.'],
      ['zoomIn', 'Alt + wheel', 'Resize what is selected, or change the pen / highlighter / eraser / text size.'],
      ['text', 'Size field for every tool', 'Pen, highlighter and eraser get the same size field as text, with much bigger maximums.'],
    ],
  },
  {
    version: '1.4',
    tagline: 'Covers, templates and PDFs from your computer',
    items: [
      ['templates', 'New notebook: covers & templates', 'Pick a cover and a paper (lined, grid, dotted, Cornell, planner…), cream, white or dark paper, portrait or landscape.'],
      ['importPdf', 'Open any PDF with StudyNotes', 'Right-click a PDF → Open with → StudyNotes. Your notes are saved into that PDF file, so every PDF reader shows them – and they stay editable here.'],
      ['group', 'Group & rotate', 'Select lines and pictures → Group (Ctrl+G). Rotate text, shapes and groups with the round handle.'],
      ['text', 'Text size menu', 'Common sizes in a list, plus ▲▼ to step. The text frame disappears when you finish typing.'],
      ['pen', 'Better pens', 'Your own pen sizes. Shapes keep the pen look (fountain, pencil, brush, neon). The brush paints smoothly. The eraser can erase part of a shape.'],
      ['table', 'Tables', 'Click into a cell and type.'],
      ['addPage', 'Pages', 'Pull past the last page for half a second to add one. The add-page menu always fits the window.'],
      ['center', 'Endless board', '"Back to centre" button.'],
      ['cloudSync', 'Faster Google Drive sync', 'Just opening a notebook no longer uploads anything. Sign in with Google in one click – no setup.'],
      ['settings', 'Keyboard', 'Shortcuts work with the Russian keyboard layout too.'],
    ],
  },
  {
    version: '1.3',
    tagline: 'Pictures, shapes and safer sync',
    items: [
      ['image', 'Pictures', 'Crop, rotate, transparency and AI background removal.'],
      ['shapes', 'Shapes', 'Clean corners, fill colour.'],
      ['backup', 'Backups', 'Hourly local backups and repair after a crash or power cut.'],
    ],
  },
];

const newer = (a, b) => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

/** Call at start: shows the window once after an update. */
export function maybeShowWhatsNew(app) {
  const now = app.info.version;
  const seen = app.settings.lastSeenVersion;
  if (seen === now) return false;
  app.settings.lastSeenVersion = now;
  app.saveSettings();
  if (!seen) return false; // first install: nothing "new" yet
  if (!newer(now, seen)) return false;
  showWhatsNew(now, seen);
  return true;
}

export function showWhatsNew(version, since = null) {
  const fresh = RELEASES.filter((r) => !since || newer(r.version.split('.').length < 3 ? r.version + '.0' : r.version, since));
  const shown = fresh.length ? fresh : RELEASES.slice(0, 1);
  const [main, ...older] = shown;
  const card = ([ic, title, text], i) => h('div', { class: 'wn-card', style: { animationDelay: (60 + i * 45) + 'ms' } },
    h('div', { class: 'wn-icon', html: icon(ic, 22) }),
    h('div', {}, h('div', { class: 'wn-title' }, title), h('div', { class: 'wn-text' }, text)));
  const body = h('div', { class: 'whats-new' },
    h('div', { class: 'wn-hero' },
      h('div', { class: 'wn-badge' }, 'Version ' + version),
      h('div', { class: 'wn-tagline' }, main.tagline)),
    h('div', { class: 'wn-grid' }, ...main.items.map(card)),
    ...older.map((r) => h('details', { class: 'wn-older' }, h('summary', {}, `Also new since your last version: ${r.version} – ${r.tagline}`),
      h('div', { class: 'wn-grid' }, ...r.items.map(card)))));
  return modal({ title: "What's new in StudyNotes", width: 720, body, actions: [{ label: "Let's go", primary: true, result: true }] });
}
