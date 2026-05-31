// web/lodestar_tts.js
// Best-effort in-browser neural TTS (Kokoro) for the Lodestar demo.
// Injected into the page via the export preset's html/head_include, then driven
// from Godot through window.lsSpeak / window.lsCancel.
//
// Everything is wrapped in try/catch and gated on a readiness flag: if the model
// fails to load (CDN down, old browser, no WASM), there is simply no voice and
// the game runs normally. Watch the browser console for "[ls-tts]" logs.
//
// Kokoro is ~80 MB (q8) and downloads on first load, so the first lines may be
// silent until it is ready; generation runs on WASM, so audio can lag the text.

(async () => {
  const TAG = "[ls-tts]";
  window.__lsReady = false;
  let tts = null, ctx = null, curSrc = null, queue = [], running = false;

  const resume = () => { try { if (ctx && ctx.state === "suspended") ctx.resume(); } catch (e) {} };
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function stopCur() { if (curSrc) { try { curSrc.stop(); } catch (e) {} curSrc = null; } }

  try {
    console.log(TAG, "loading Kokoro…");
    const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js/dist/kokoro.web.js");
    tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
    window.__lsReady = true;
    console.log(TAG, "ready");
  } catch (e) {
    console.warn(TAG, "load failed — running without voice:", e);
    return;
  }

  async function speakOne(job) {
    let audio;
    try {
      audio = await tts.generate(job.text, { voice: job.voice || "af_heart" });
    } catch (e) { console.warn(TAG, "generate failed:", e); return; }
    await new Promise((resolve) => {
      try {
        const c = getCtx();
        resume();
        const f32 = audio.audio;
        const sr = audio.sampling_rate || 24000;
        const buf = c.createBuffer(1, f32.length, sr);
        buf.copyToChannel(f32, 0);
        stopCur();
        const src = c.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = job.speed || 1.0;
        src.connect(c.destination);
        src.onended = () => { if (curSrc === src) curSrc = null; resolve(); };
        curSrc = src;
        src.start();
      } catch (e) { console.warn(TAG, "play failed:", e); resolve(); }
    });
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) await speakOne(queue.shift());
    running = false;
  }

  // Drive from Godot. We keep at most the current line plus the newest pending
  // one, so audio tracks the conversation instead of falling endlessly behind.
  window.lsSpeak = function (text, voice, speed) {
    if (!window.__lsReady || !text) return;
    const job = { text: String(text), voice: voice, speed: speed };
    if (queue.length > 1) queue = [queue[0]];
    queue.push(job);
    pump();
  };
  window.lsCancel = function () { queue = []; stopCur(); };
})();
