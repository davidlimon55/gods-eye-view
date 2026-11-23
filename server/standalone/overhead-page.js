/**
 * Keep the light Over My House page light: vite-plugin-cesium adds the
 * Cesium script and widget stylesheet (several MB, render-blocking) to every
 * HTML page, and /overhead.html uses none of Cesium. Runs after that plugin
 * and removes both tags from this one page only.
 */
const CESIUM_TAGS = [
  /\s*<link\b[^>]*href="[^"]*\/cesium\/Widgets\/widgets\.css"[^>]*>/g,
  /\s*<script\b[^>]*src="[^"]*\/cesium\/Cesium\.js"[^>]*>\s*<\/script>/g,
];

/** Remove the Cesium script and stylesheet tags from one HTML document. */
export function stripCesiumTags(html) {
  return CESIUM_TAGS.reduce((out, pattern) => out.replace(pattern, ''), html);
}

/** Whether a Vite HTML context is the Over My House page. */
export function isOverheadPage(context = {}) {
  const name = String(context.filename || context.path || '');
  return /(^|[\\/])overhead\.html$/.test(name);
}

export function overheadPagePlugin() {
  return {
    name: 'over-my-house-page',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        return isOverheadPage(context) ? stripCesiumTags(html) : html;
      },
    },
  };
}
