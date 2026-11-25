import 'katex/dist/katex.min.css';
import './styles.css';
import parser from '../../shared/paste-parse.js';
import richtext from '../../shared/richtext.js';
import { KIND, mathDefinition } from './math.js';

const AUTO = 'convertOnPaste';
const EMPTY_FORMULA = /<span data-x="rich-paste:math" data-v="([^"]*)"( data-display="1")?><\/span>/g;

export default {
  id: 'rich-paste',
  name: 'Formulas and formatting on paste',
  description: 'Shows LaTeX formulas, bold text, headings and lists from pasted text.',
  icon: 'text',
  apiVersion: 1,
  defaultEnabled: false,
  core: true,
  activate(host) {
    const t = host.ui.t;
    const auto = () => host.settings.get(AUTO, true);
    host.inline.register(KIND, mathDefinition(host));

    function convert(clip) {
      const parsed = parser.pasteToRich(clip);
      if (!parsed) return null;
      // The parser emits empty atoms. Store the host's readable source fallback with each.
      const html = parsed.html.replace(EMPTY_FORMULA, (_, source, display) => (
        host.inline.html(KIND, richtext.decode(source), { display: !!display })
      ));
      return { ...parsed, html };
    }

    host.paste.addTransform((clip) => (auto() ? convert(clip) : null));

    function manual(box) {
      if (!box) return null;
      const candidate = convert({ text: box.text || '' });
      if (!candidate) return null;
      const runs = richtext.parseRich(box.html || '').flat();
      // This action rebuilds from plain text. Leave styled runs and foreign inline elements alone.
      if (runs.some((r) => r.b || r.i || r.u || r.fs || r.ff || r.c || (r.ix && r.ix !== KIND))) return null;
      const atoms = runs.filter((r) => r.ix);
      if (candidate.formulas <= atoms.length && candidate.plain === box.text) return null;
      return candidate;
    }

    host.menus.add('textbox-more', {
      id: 'render-rich-text',
      label: t('Render formulas and formatting'),
      when: ({ textbox }) => !!manual(textbox),
      run: ({ textbox }) => {
        const candidate = manual(textbox);
        if (candidate) textbox.setHtml(candidate.html);
      },
    });

    // API v1 has storage but no add-on settings panel hook; use the view menu.
    for (const [on, label] of [[true, 'Disable conversion on paste'], [false, 'Enable conversion on paste']]) {
      host.menus.add('view', {
        id: on ? 'disable-convert-on-paste' : 'enable-convert-on-paste',
        label: t(label),
        when: () => auto() === on,
        run: () => host.settings.set(AUTO, !on),
      });
    }
  },
};
