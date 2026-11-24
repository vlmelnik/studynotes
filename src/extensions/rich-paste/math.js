import katex from 'katex';

export const KIND = 'rich-paste:math';

const options = (display) => ({
  displayMode: !!display,
  throwOnError: false,
  errorColor: '#b00020',
  trust: false,
  output: 'htmlAndMathml',
  maxSize: 50,
});

export function mathDefinition(host) {
  return {
    render(el, value, { display } = {}) {
      el.classList.add('rich-paste-math');
      katex.render(value, el, options(display));
      const error = el.querySelector('.katex-error');
      if (error) error.title = host.ui.t('Invalid LaTeX formula');
    },
    toText(value, { display } = {}) {
      const delimiter = display ? '$$' : '$';
      return delimiter + value + delimiter;
    },
    toHtml(value, { display } = {}) {
      return katex.renderToString(value, options(display));
    },
    async edit(value) {
      let input = value;
      let marker = '';
      let title = host.ui.t('Edit formula');
      if (/[\r\n]/.test(value)) {
        // The host uses a single-line input; removing a newline can extend a TeX comment.
        let i = 0;
        do { marker = i ? `⟨${i}↵⟩` : '⟨↵⟩'; i++; } while (value.includes(marker));
        input = value.replace(/\r\n?|\n/g, marker);
        title = host.ui.t('Edit formula ({break} marks a line break)').replace('{break}', marker);
      }
      const result = await host.ui.prompt({ title, value: input });
      if (result === null) return null;
      if (result === input.trim()) return value;
      return marker ? result.replaceAll(marker, '\n') : result;
    },
  };
}
