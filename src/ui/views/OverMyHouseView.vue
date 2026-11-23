<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useOverMyHouseStore } from '../stores/overMyHouse.js';
import UiButton from '../kit/UiButton.vue';
import UiIcon from '../kit/UiIcon.vue';
import OverMyHousePanel from './panels/overMyHouse/OverMyHousePanel.vue';

// Over My House inside the globe app: a launcher button over the globe and,
// once pressed, the full-screen sky panel. The light page (overhead.html)
// mounts the same panel on its own.
const props = defineProps({
  standalone: { type: Boolean, default: false },
});
const store = useOverMyHouseStore();
const { view, controls } = storeToRefs(store);

onMounted(() => {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  store.start({ openAtStart: props.standalone || params.get('view') === 'overhead' });
});
onBeforeUnmount(() => {
  if (props.standalone) store.stop();
});
</script>

<template>
  <div class="omh-root" :class="{ 'omh-root--standalone': props.standalone }">
    <UiButton
      v-if="!props.standalone && view && !view.open"
      class="omh-launcher"
      label="Over My House: what is in the sky above me?"
      @click="controls?.open()"
      ><UiIcon name="satellite_alt" :size="22" /><span class="omh-launcher-text">{{ 'Over My House' }}</span></UiButton
    >
    <div v-if="view && view.open && controls" class="omh-overlay">
      <OverMyHousePanel :view="view" :controls="controls" :standalone="props.standalone" />
    </div>
  </div>
</template>

<style scoped>
.omh-root {
  display: contents;
}
.omh-launcher {
  position: fixed;
  right: 12px;
  bottom: calc(var(--mobile-tab-space, 0px) + 200px);
  z-index: 1100;
  display: inline-flex !important;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 16px;
  border-radius: 26px;
  border: 2px solid #ffd166;
  background: rgba(11, 16, 32, 0.92);
  color: #fff;
  font: 600 15px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  cursor: pointer;
}
.omh-launcher:focus-visible {
  outline: 3px solid #ffd166;
  outline-offset: 2px;
}
.omh-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #0b1020;
}
.omh-root--standalone .omh-overlay {
  position: static;
  min-height: 100vh;
}
</style>
