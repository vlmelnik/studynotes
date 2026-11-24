import darkView from '../../shared/dark-view.js';

const { darkenImage, inkForDark, highlightBlend } = darkView;
const choices = [
  ['off', 'Dark pages: Off'],
  ['background', 'Dark pages: Background only'],
  ['full', 'Dark pages: Full'],
];

function modeOf(settings) {
  const mode = settings?.get('mode', 'off');
  return mode === 'background' || mode === 'full' ? mode : 'off';
}

const active = ({ pageKind, settings, isExternal }) => !isExternal && pageKind === 'pdf' && modeOf(settings) !== 'off';
const darkInk = (view) => active(view) && view.effect === true;

export default {
  id: 'dark-view',
  name: 'Dark pages',
  description: 'Darkens PDF pages on screen without changing your document or export.',
  apiVersion: 1,
  defaultEnabled: false,
  activate(host) {
    for (const [mode, label] of choices) {
      host.menus.add('view', {
        id: mode, label,
        when: ({ notebookSettings, isExternal }) => !!notebookSettings && !isExternal,
        checked: ({ notebookSettings }) => modeOf(notebookSettings) === mode,
        run({ notebookSettings, refreshView }) {
          if (modeOf(notebookSettings) === mode) return;
          notebookSettings.set('mode', mode);
          refreshView();
        },
      });
    }
    host.view.addPagePass(({ canvas, ctx, imageRegions, settings }) => {
      const { width, height } = canvas;
      const mode = modeOf(settings);
      if (mode === 'off' || !width || !height) return;
      if (imageRegions.some((r) => r.x0 <= 0 && r.y0 <= 0 && r.x1 >= width && r.y1 >= height)) return;
      const raster = ctx.getImageData(0, 0, width, height);
      darkenImage(raster, { mode, keep: imageRegions });
      ctx.putImageData(raster, 0, 0);
      return true;
    }, { when: active });
    host.view.setInkFilter((color, view) => darkInk(view) ? inkForDark(color) : color);
    host.view.setHighlighterBlend((view) => darkInk(view) ? highlightBlend(true) : null);
  },
};
