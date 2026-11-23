/**
 * The light Over My House page (/overhead.html): only the sky panel, with no
 * globe, tour or splash screen, so it opens fast from a phone's Home Screen.
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import OverMyHouseView from '../ui/views/OverMyHouseView.vue';

const host = document.getElementById('over-my-house');
if (host)
  createApp(OverMyHouseView, { standalone: true })
    .use(createPinia())
    .mount(host);
