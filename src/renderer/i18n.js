// Interface language. The app is written in English; for Russian, every
// interface text that appears on screen is translated as it appears (one
// observer for the whole window), so no screen needs special code. Notes,
// titles and other things the user wrote are never touched.
import RU from '../shared/i18n-ru.js';

const DICTS = { ru: RU };
const SKIP = '.page, .textbox, .card-title, .nb-title, .tab:not(.lib-tab) .tab-label, .result-snippet, .result-nb, .cover-label, .cover-title, .folder-pick-item, .crumb:not(:first-child), [contenteditable="true"], .no-i18n, .tp-title, script, style';
const ATTRS = ['title', 'placeholder', 'aria-label'];
// skipped for their text, but their tooltip / placeholder is interface text
const ATTRS_ANYWAY = '.nb-title, .tp-title';
// tooltips that show user content (a notebook card shows its title)
const NO_ATTRS = '.nb-card, .page, .page *';

let lang = 'en';
let dict = null;
let observer = null;
const originals = new WeakMap(); // text node → English text
const attrOriginals = new WeakMap(); // element → { attr: English }

/** Translate one English text into the current language (unchanged if unknown). */
export function t(s) {
  if (!dict || typeof s !== 'string') return s;
  const key = s.trim();
  if (!key) return s;
  const w = dict.words[key];
  if (w) return s.replace(key, w);
  for (const [re, rep] of dict.patterns) {
    if (re.test(key)) return s.replace(key, key.replace(re, rep));
  }
  return s;
}

export function getLang() { return lang; }

function skipped(el) {
  return !!(el && el.closest && el.closest(SKIP));
}

function doText(node) {
  const en = originals.has(node) ? originals.get(node) : node.data;
  const out = lang === 'en' ? en : t(en);
  if (out !== en && !originals.has(node)) originals.set(node, en);
  if (node.data !== out) node.data = out;
}

function doAttrs(el) {
  if (el.matches(NO_ATTRS)) return;
  let o = attrOriginals.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a);
    if (o && o[a] !== undefined && cur !== (lang === 'en' ? o[a] : t(o[a]))) o[a] = cur; // changed by the app since
    const en = o && o[a] !== undefined ? o[a] : cur;
    const out = lang === 'en' ? en : t(en);
    if (out !== en) { if (!o) { o = {}; attrOriginals.set(el, o); } if (o[a] === undefined) o[a] = en; }
    if (cur !== out) el.setAttribute(a, out);
  }
}

function walk(root) {
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1) return;
  if (skipped(root)) { if (root.matches(ATTRS_ANYWAY)) doAttrs(root); return; }
  doAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType !== 1 || !n.matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
      if (n.matches(ATTRS_ANYWAY)) doAttrs(n);
      return NodeFilter.FILTER_REJECT;
    },
  });
  let n = tw.nextNode();
  while (n) {
    if (n.nodeType === 3) doText(n); else doAttrs(n);
    n = tw.nextNode();
  }
}

/** Switch the interface language ('en' or 'ru'); everything on screen follows at once. */
export function setLang(l) {
  lang = DICTS[l] ? l : 'en';
  dict = DICTS[lang] || null;
  document.documentElement.lang = lang;
  if (!observer) {
    observer = new MutationObserver((list) => {
      if (lang === 'en' && !observer._wasRu) return;
      observer.disconnect();
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) { originals.delete(m.target); doText(m.target); } }
        else if (m.type === 'attributes' && (!skipped(m.target) || m.target.matches(ATTRS_ANYWAY))) doAttrs(m.target);
      }
      connect();
    });
  }
  observer._wasRu = observer._wasRu || lang !== 'en';
  observer.disconnect();
  walk(document.body);
  connect();
}

function connect() {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
