// Real typewriter key, CC0 by Cassie-OrbitGames / OpenGameArt.
// The local sample is trimmed and softened; no synthetic hiss or error buzz.
let context = null;
let sample = null;
let preparing = null;
let enabled = true;

export function setSoundEnabled(value) { enabled = Boolean(value); }

export function prepareKeySound() {
  if (preparing) return preparing;
  preparing = (async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context ??= new AudioContext();
    const response = await fetch(new URL('../assets/audio/typewriter-key.wav', import.meta.url));
    if (!response.ok) throw new Error('Sound unavailable');
    sample = await context.decodeAudioData(await response.arrayBuffer());
  })().catch(() => { preparing = null; });
  return preparing;
}

export function playKeySound(_isError = false, isBackspace = false) {
  if (!enabled) return;
  try {
    if (!context || !sample) { void prepareKeySound(); return; }
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const source = context.createBufferSource(); source.buffer = sample;
    source.playbackRate.value = isBackspace ? 0.95 : 0.99 + Math.random() * 0.025;
    const volume = context.createGain(); volume.gain.value = isBackspace ? 0.18 : 0.22;
    source.connect(volume); volume.connect(context.destination); source.start();
    source.onended = () => { source.disconnect(); volume.disconnect(); };
  } catch { /* Audio support must never prevent typing. */ }
}
