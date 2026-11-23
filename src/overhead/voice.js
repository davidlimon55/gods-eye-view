/**
 * Speak instead of typing: the browser's free Web Speech API, where the
 * browser has it (Safari, Chrome). Returns null when it does not, so the
 * view can hide the microphone button.
 */
export function createVoiceInput({
  windowRef = globalThis,
  lang = 'en-US',
} = {}) {
  const Recognition =
    windowRef?.SpeechRecognition ?? windowRef?.webkitSpeechRecognition;
  if (typeof Recognition !== 'function') return null;
  return {
    /** Listen once; resolves with the words heard, or '' on silence/error. */
    listen() {
      return new Promise((resolve) => {
        let done = false;
        const finish = (text) => {
          if (done) return;
          done = true;
          resolve(String(text || '').trim());
        };
        try {
          const recognizer = new Recognition();
          recognizer.lang = lang;
          recognizer.interimResults = false;
          recognizer.maxAlternatives = 1;
          recognizer.onresult = (event) =>
            finish(event.results?.[0]?.[0]?.transcript);
          recognizer.onerror = () => finish('');
          recognizer.onend = () => finish('');
          recognizer.start();
        } catch {
          finish('');
        }
      });
    },
  };
}
