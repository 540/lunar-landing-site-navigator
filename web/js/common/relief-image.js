// The loader of the shared LOLA relief image (#331), without DOM: common/map.js gives it the Image factory, and
// test/relief-image.test.js a fake one. `state` is 'loading' | 'ready' | 'failed'; subscribers hear every change.
// `makeImage({ onload, onerror })` creates the image and hooks both handlers; the loader then sets its `src`, once.
export function createReliefLoader(src, makeImage) {
  const relief = { img: null, state: 'loading', listeners: new Set() };
  const setState = next => {
    relief.state = next;
    for (const fn of relief.listeners) fn(next);
  };
  /** The shared relief: { img, state, unsubscribe }. Pass `onChange` to hear when its state changes. */
  return function reliefImage(onChange) {
    if (!relief.img) {
      const img = makeImage({
        onload: () => setState(img.naturalWidth > 0 ? 'ready' : 'failed'),
        onerror: () => setState('failed'),
      });
      relief.img = img;
      img.src = src;
    }
    if (onChange) relief.listeners.add(onChange);
    return { img: relief.img, state: relief.state, unsubscribe: () => relief.listeners.delete(onChange) };
  };
}
