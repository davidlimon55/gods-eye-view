import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOverMyHouse } from '../../overhead/controller.js';

/**
 * The Over My House view as its owner (src/overhead/controller.js)
 * presents it, and the owner's controls. `start()` creates the owner once
 * per page and connects it to this store.
 */
export const useOverMyHouseStore = defineStore('gev-over-my-house', () => {
  /** The owner's latest presentation, or null before it starts. */
  const view = shallowRef(null);
  /** `{open, close, locate, searchPlace, ...}` or null. */
  const controls = shallowRef(null);

  function publish(next) {
    view.value = next && markRaw(next);
  }

  /**
   * Start the owner (once). `openAtStart` opens the sky view straight away,
   * as the direct link and the light page do.
   */
  function start(options = {}) {
    if (controls.value) {
      if (options.openAtStart) void controls.value.open();
      return controls.value;
    }
    controls.value = markRaw(createOverMyHouse({ ...options, publish }));
    return controls.value;
  }

  function stop() {
    controls.value?.destroy();
    controls.value = null;
    view.value = null;
  }

  return { view, controls, publish, start, stop };
});
