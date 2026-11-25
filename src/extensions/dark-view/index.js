import darkView from '../../shared/dark-view.js';

const { darkenImage, inkForDark, highlightBlend } = darkView;
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
  icon: 'moon',
  apiVersion: 1,
  defaultEnabled: false,
  core: true,
  hidden: true,
  activate(host) {
    // One switch, like "Dark mode": on = full dark pages (older notebooks may
    // still say "background", which keeps working)
    host.menus.add('view', {
      id: 'toggle',
      label: 'Dark pages',
      when: ({ notebookSettings, isExternal }) => !!notebookSettings && !isExternal,
      checked: ({ notebookSettings }) => modeOf(notebookSettings) !== 'off',
      run({ notebookSettings, refreshView }) {
        notebookSettings.set('mode', modeOf(notebookSettings) === 'off' ? 'full' : 'off');
        refreshView();
      },
    });
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
