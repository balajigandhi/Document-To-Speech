// ==UserScript==
// @name         Wiki TTS
// @namespace    ai-tts-tools
// @version      5.23
// @description  Read wiki page content aloud via local TTS sidecar (localhost:8080)
// @author       bgandhi
// @match        https://*.wikipedia.org/wiki/*
// @match        https://*.fandom.com/wiki/*
// @match        https://wiki.*
// @match        https://wiki.corp.adobe.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '5.23';

  const API_FROM_HTML    = 'http://localhost:8080/tts/from-html';
  const API_SENTENCES    = 'http://localhost:8080/sentences';
  const API_CACHE_CLEAR  = 'http://localhost:8080/cache/clear';
  const API_CACHE_EXPIRE = 'http://localhost:8080/cache/expire';
  const VOICE            = 'af_sarah';
  const BOUNDARY         = 'tts_boundary';
  const AVG_SECS_PER_SENTENCE = 4.5;

  let currentSpeed = 1.35;

  // ── Styles ───────────────────────────────────────────────────────────────────

  GM_addStyle(`
    /* Floating controls bar */
    #tts-bar {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
      background: rgba(255,255,255,0.97);
      border: 1px solid rgba(180,180,180,0.5);
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      color: #333;
      user-select: none;
      cursor: move;
      overflow: hidden;
    }
    #tts-bar-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px 6px;
    }
    #tts-status-row {
      padding: 0 12px 6px;
      font-size: 11px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #tts-progress-row {
      padding: 0 12px 6px;
      display: none;
    }
    #tts-progress-bg {
      background: #e8eaed;
      border-radius: 4px;
      height: 4px;
      overflow: hidden;
    }
    #tts-progress-fill {
      background: #1a73e8;
      height: 4px;
      width: 0%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    #tts-bar button {
      border: 1px solid #ccc;
      background: none;
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 12px;
      cursor: pointer;
      color: #444;
      white-space: nowrap;
    }
    #tts-bar button:hover { background: #f0f0f0; }
    #tts-bar button:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
    #tts-btn-play {
      background: #1a73e8 !important;
      color: #fff !important;
      border-color: #1a73e8 !important;
      font-weight: 600;
    }
    #tts-btn-play:hover { background: #1558b0 !important; }
    #tts-speed-slider {
      width: 70px;
      accent-color: #1a73e8;
      cursor: pointer;
    }
    #tts-speed-val {
      min-width: 28px;
      font-weight: 600;
      color: #1a73e8;
    }
    #tts-timer {
      min-width: 70px;
      font-weight: 600;
      color: #1a73e8;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
    }
    #tts-status-row { display: none; }
    #tts-status { font-size: 11px; color: #888; }
    /* Page highlight */
    .tts-reading {
      background: #fff9c4 !important;
      border-left: 3px solid #f9a825 !important;
      padding-left: 6px !important;
      border-radius: 2px;
      transition: background 0.2s;
    }
    /* Trigger button */
    #tts-trigger {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999998;
      padding: 9px 16px;
      font-size: 13px;
      font-weight: 600;
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    #tts-trigger:hover { background: #1558b0; }
  `);

  // ── DOM helpers ───────────────────────────────────────────────────────────────

  function extractHTML() {
    const content =
      document.querySelector('#main-content') ||
      document.querySelector('.wiki-content') ||
      document.querySelector('#content .view') ||
      document.querySelector('#mw-content-text .mw-parser-output') ||
      document.querySelector('#mw-content-text') ||
      document.querySelector('article') ||
      document.querySelector('main');
    return (content || document.body).innerHTML;
  }

  function getContentRoot() {
    return (
      document.querySelector('#main-content') ||
      document.querySelector('.wiki-content') ||
      document.querySelector('#content .view') ||
      document.querySelector('#mw-content-text .mw-parser-output') ||
      document.querySelector('#mw-content-text') ||
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.body
    );
  }

  // ── Page highlight (block-ancestor approach) ──────────────────────────────────

  const BLOCK_TAGS = new Set(['P','LI','H1','H2','H3','H4','H5','H6','TD','TH','BLOCKQUOTE','PRE','DT','DD']);
  let activeHighlight = null;

  function findBlockAncestor(el) {
    let node = el;
    while (node && node !== document.body) {
      if (BLOCK_TAGS.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return el;
  }

  function normalize(str) {
    return str.replace(/[-–—]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function highlightPageSentence(sentence) {
    if (activeHighlight) {
      activeHighlight.classList.remove('tts-reading');
      activeHighlight = null;
    }
    if (!sentence || sentence.length < 8) return;

    // Use first 50 chars of normalized sentence as needle — long enough to be
    // unique, short enough to survive partial text-node splits at sentence end.
    const needle = normalize(sentence).slice(0, 50);
    if (!needle) return;

    const root = getContentRoot();
    // Query all block elements and match against their full textContent.
    // This handles sentences split across inline elements (span, strong, a, etc.)
    const blocks = root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dt, dd');
    for (const block of blocks) {
      if (normalize(block.textContent).includes(needle)) {
        block.classList.add('tts-reading');
        block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        activeHighlight = block;
        return;
      }
    }
  }

  function clearPageHighlight() {
    if (activeHighlight) {
      activeHighlight.classList.remove('tts-reading');
      activeHighlight = null;
    }
  }

  // ── Bar state ─────────────────────────────────────────────────────────────────

  let bar = null;
  let playBtn, stopBtn, refreshBtn;
  let statusEl, timerEl, progressRow, progressFill;
  let currentSentences = [];

  function formatDuration(secs) {
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    const row = document.getElementById('tts-status-row');
    if (row) row.style.display = text ? 'block' : 'none';
  }

  function buildBar() {
    if (bar) bar.remove();

    bar = document.createElement('div');
    bar.id = 'tts-bar';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:11px;color:#555;margin-right:2px;';
    title.textContent = '🔊';

    playBtn = document.createElement('button');
    playBtn.id = 'tts-btn-play';
    playBtn.textContent = '▶ Play';

    stopBtn = document.createElement('button');
    stopBtn.id = 'tts-btn-stop';
    stopBtn.textContent = '⏹';
    stopBtn.title = 'Stop';
    stopBtn.onclick = () => stopPlayback();

    refreshBtn = document.createElement('button');
    refreshBtn.id = 'tts-btn-refresh';
    refreshBtn.textContent = '↺';
    refreshBtn.title = 'Clear cache and re-generate';
    refreshBtn.onclick = () => {
      stopPlayback();
      setProcessing(true);
      refreshBtn.textContent = '…';
      GM_xmlhttpRequest({
        method:  'POST',
        url:     API_CACHE_CLEAR,
        headers: { 'Content-Type': 'application/json' },
        data:    JSON.stringify({ sentences: currentSentences, voice_profile: VOICE, speed: currentSpeed }),
        onload()  { refreshBtn.textContent = '↺'; startTTS(extractHTML(), currentSentences.length); },
        onerror() { refreshBtn.textContent = '↺'; setProcessing(false); },
      });
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.onclick = () => { stopPlayback(); bar.remove(); bar = null; };

    // Speed
    const speedLbl = document.createElement('span');
    speedLbl.style.color = '#888';
    speedLbl.textContent = 'Speed';

    const slider = document.createElement('input');
    slider.type = 'range'; slider.id = 'tts-speed-slider';
    slider.min = 0.5; slider.max = 2.0; slider.step = 0.05;
    slider.value = currentSpeed;

    const speedVal = document.createElement('span');
    speedVal.id = 'tts-speed-val';
    speedVal.textContent = currentSpeed.toFixed(2) + '×';

    slider.oninput = () => {
      currentSpeed = parseFloat(slider.value);
      speedVal.textContent = currentSpeed.toFixed(2) + '×';
      if (currentSentences.length) {
        timerTotal = Math.round((currentSentences.length * AVG_SECS_PER_SENTENCE) / currentSpeed);
        updateTimerDisplay();
      }
    };

    timerEl = document.createElement('span');
    timerEl.id = 'tts-timer';

    const controls = document.createElement('div');
    controls.id = 'tts-bar-controls';
    controls.append(title, playBtn, stopBtn, refreshBtn, speedLbl, slider, speedVal, timerEl, closeBtn);

    const statusRow = document.createElement('div');
    statusRow.id = 'tts-status-row';
    statusEl = document.createElement('span');
    statusEl.id = 'tts-status';
    statusRow.appendChild(statusEl);

    progressRow = document.createElement('div');
    progressRow.id = 'tts-progress-row';
    const progressBg = document.createElement('div');
    progressBg.id = 'tts-progress-bg';
    progressFill = document.createElement('div');
    progressFill.id = 'tts-progress-fill';
    progressBg.appendChild(progressFill);
    progressRow.appendChild(progressBg);

    bar.append(controls, statusRow, progressRow);
    document.body.appendChild(bar);
    makeDraggable(bar);

    playBtn.onclick = () => {
      const t = playBtn.textContent;
      if (t === '⏸ Pause') {
        pausePlayback();
      } else if (t === '▶ Resume') {
        resumePlayback();
      } else {
        stopped = false;
        paused  = false;
        playBtn.textContent = '⏸ Pause';
        startTimer(Math.round((currentSentences.length * AVG_SECS_PER_SENTENCE) / currentSpeed));
        playerLoop(totalSentences || audioQueue.length);
      }
    };
  }

  function setProcessing(busy) {
    if (playBtn)    playBtn.disabled    = busy;
    if (stopBtn)    stopBtn.disabled    = busy;
    if (refreshBtn) refreshBtn.disabled = busy;
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────

  function makeDraggable(el) {
    let ox, oy;
    el.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      let dragging = false;
      const onMove = e => {
        if (!dragging) { dragging = true; el.style.right = 'auto'; }
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top  = (e.clientY - oy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Audio queue ───────────────────────────────────────────────────────────────

  let stopped        = false;
  let paused         = false;
  let currentAudio   = null;
  let audioQueue     = [];
  let queueResolve   = null;
  let pauseResolve   = null;
  let totalSentences = 0;

  let timerInterval  = null;
  let timerElapsed   = 0;
  let timerTotal     = 0;

  function updateTimerDisplay() {
    if (!timerEl) return;
    timerEl.textContent = timerTotal > 0
      ? `${formatDuration(timerElapsed)} / ${formatDuration(timerTotal)}`
      : formatDuration(timerElapsed);
  }

  function startTimer(totalSecs) {
    timerTotal = totalSecs || 0;
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      if (!paused) { timerElapsed++; updateTimerDisplay(); }
    }, 1000);
    updateTimerDisplay();
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerElapsed  = 0;
    timerTotal    = 0;
    if (timerEl) timerEl.textContent = '';
  }

  function stopPlayback() {
    stopped = true;
    paused  = false;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    audioQueue = [];
    if (queueResolve) { queueResolve(); queueResolve = null; }
    if (pauseResolve) { pauseResolve(); pauseResolve = null; }
    stopTimer();
    clearPageHighlight();
    if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
    if (progressRow) progressRow.style.display = 'none';
    setStatus('');
  }

  function pausePlayback() {
    paused = true;
    if (currentAudio) currentAudio.pause();
    if (playBtn) playBtn.textContent = '▶ Resume';
  }

  function resumePlayback() {
    paused = false;
    if (currentAudio) currentAudio.play();
    else if (pauseResolve) { pauseResolve(); pauseResolve = null; }
    if (playBtn) playBtn.textContent = '⏸ Pause';
  }

  function waitForResume() {
    return new Promise(resolve => { pauseResolve = resolve; });
  }

  function pushChunk(chunk) {
    audioQueue.push(chunk);
    if (queueResolve) { queueResolve(); queueResolve = null; }
  }

  function waitForChunk() {
    return new Promise(resolve => { queueResolve = resolve; });
  }

  function playWav(arrayBuffer) {
    return new Promise(resolve => {
      const blob  = new Blob([arrayBuffer], { type: 'audio/wav' });
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      audio.play();
    });
  }

  async function playerLoop(total) {
    let played = 0;
    while (!stopped && played < total) {
      if (paused && !currentAudio) await waitForResume();
      if (stopped) break;
      if (audioQueue.length === 0) await waitForChunk();
      if (stopped) break;

      const chunk = audioQueue.shift();
      highlightPageSentence(chunk.sentence);
      setStatus(chunk.sentence.slice(0, 50) + (chunk.sentence.length > 50 ? '…' : ''));
      await playWav(chunk.wav);

      if (paused && !stopped) await waitForResume();
      played++;
    }
    if (!stopped) {
      stopTimer();
      clearPageHighlight();
      if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
      setStatus('Done');
    }
  }

  // ── Multipart streaming parser ────────────────────────────────────────────────

  function enc(str) { return new TextEncoder().encode(str); }

  function indexOfBytes(buf, needle, start = 0) {
    const h = new Uint8Array(buf);
    const n = needle instanceof Uint8Array ? needle : new Uint8Array(needle.buffer ?? needle);
    outer: for (let i = start; i <= h.length - n.length; i++) {
      for (let j = 0; j < n.length; j++) if (h[i+j] !== n[j]) continue outer;
      return i;
    }
    return -1;
  }

  function parseAvailable(buffer, fromPos, total, doneCount) {
    const dec   = new TextDecoder();
    const bound = enc(`--${BOUNDARY}`);
    let pos     = fromPos;
    let done    = doneCount;

    while (pos < buffer.byteLength) {
      const bStart = indexOfBytes(buffer, bound, pos);
      if (bStart === -1) break;
      pos = bStart + bound.byteLength;

      if (pos + 2 <= buffer.byteLength) {
        const tail = new Uint8Array(buffer, pos, 2);
        if (tail[0] === 45 && tail[1] === 45) { pos += 2; break; }
      }
      pos += 2;

      const headerEnd = indexOfBytes(buffer, enc('\r\n\r\n'), pos);
      if (headerEnd === -1) { pos = bStart; break; }

      const headerText = dec.decode(new Uint8Array(buffer, pos, headerEnd - pos));
      pos = headerEnd + 4;

      const idxMatch = headerText.match(/X-Sentence-Index:\s*(\d+)/i);
      const lenMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      const txtMatch = headerText.match(/X-Sentence-Text:\s*(\S+)/i);
      if (!idxMatch || !lenMatch) continue;

      const idx = parseInt(idxMatch[1], 10);
      const len = parseInt(lenMatch[1], 10);

      if (pos + len > buffer.byteLength) { pos = bStart; break; }

      const wav      = buffer.slice(pos, pos + len);
      const sentence = txtMatch ? atob(txtMatch[1]) : '';
      pos += len + 2;
      done++;

      setStatus(`Generating… ${done} / ${total}`);
      if (progressFill && total > 0) progressFill.style.width = Math.round((done / total) * 100) + '%';
      pushChunk({ idx, wav, sentence });
    }

    return { pos, done };
  }

  // ── Main TTS flow ─────────────────────────────────────────────────────────────

  let generationDone = false;

  function startTTS(html, knownTotal = 0) {
    stopped        = false;
    audioQueue     = [];
    generationDone = false;
    totalSentences = knownTotal;
    if (playBtn) playBtn.textContent = '▶ Play';
    setProcessing(true);
    setStatus(knownTotal > 0 ? `Generating… 0 / ${knownTotal}` : 'Generating…');
    if (progressRow) { progressRow.style.display = 'block'; }
    if (progressFill) { progressFill.style.width = '0%'; }

    let fakeProgress  = 0;
    const totalEstMs  = knownTotal > 0 ? knownTotal * (0.5 / currentSpeed) * 1000 : 30000;
    const ticker = setInterval(() => {
      if (generationDone || stopped) { clearInterval(ticker); return; }
      fakeProgress = Math.min(fakeProgress + 1, 95);
      if (progressFill) progressFill.style.width = fakeProgress + '%';
    }, totalEstMs / 100);

    let parsePos    = 0;
    let parsedCount = 0;
    let accumBuffer = null;

    // totalReceived tracks how many bytes we've already copied into accumBuffer,
    // so each onprogress call only appends the truly new tail of res.response.
    let totalReceived = 0;

    function appendBytes(newBuf) {
      if (!accumBuffer) { accumBuffer = newBuf.slice(0); return; }
      const merged = new Uint8Array(accumBuffer.byteLength + newBuf.byteLength);
      merged.set(new Uint8Array(accumBuffer), 0);
      merged.set(new Uint8Array(newBuf), accumBuffer.byteLength);
      accumBuffer = merged.buffer;
    }

    // After parsing, discard already-consumed bytes so accumBuffer stays small.
    function trimBuffer() {
      if (!accumBuffer || parsePos === 0) return;
      accumBuffer = accumBuffer.slice(parsePos);
      parsePos = 0;
    }

    GM_xmlhttpRequest({
      method:       'POST',
      url:          API_FROM_HTML,
      headers:      { 'Content-Type': 'application/json' },
      data:         JSON.stringify({ html, voice_profile: VOICE, speed: currentSpeed }),
      responseType: 'arraybuffer',

      onloadstart(res) {
        const m = (res.responseHeaders || '').match(/X-Total-Sentences:\s*(\d+)/i);
        if (m) { totalSentences = parseInt(m[1], 10); }
      },

      onprogress(res) {
        if (!res.response) return;
        const newBytes = res.response.slice(totalReceived);
        totalReceived = res.response.byteLength;
        appendBytes(newBytes);
        if (!totalSentences) {
          const m = (res.responseHeaders || '').match(/X-Total-Sentences:\s*(\d+)/i);
          if (m) totalSentences = parseInt(m[1], 10);
        }
        const result = parseAvailable(accumBuffer, parsePos, totalSentences, parsedCount);
        parsePos = result.pos; parsedCount = result.done;
        trimBuffer();
      },

      onload(res) {
        const newBytes = res.response ? res.response.slice(totalReceived) : null;
        if (newBytes && newBytes.byteLength > 0) appendBytes(newBytes);
        if (!totalSentences) {
          const m = (res.responseHeaders || '').match(/X-Total-Sentences:\s*(\d+)/i);
          totalSentences = m ? parseInt(m[1], 10) : parsedCount;
        }
        if (accumBuffer) {
          const result = parseAvailable(accumBuffer, parsePos, totalSentences, parsedCount);
          parsedCount = result.done;
        }
        accumBuffer = null; // free remaining memory
        generationDone = true;
        setProcessing(false);
        if (progressFill) progressFill.style.width = '100%';
        setTimeout(() => { if (progressRow) progressRow.style.display = 'none'; }, 800);
        if (queueResolve) { queueResolve(); queueResolve = null; }
        // Fetch cache size and show in status
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'http://localhost:8080/cache/stats',
          onload(r) {
            try {
              const { files, mb } = JSON.parse(r.responseText);
              setStatus(`Ready — ${parsedCount} sentences · cache ${mb} MB (${files} files)`);
            } catch { setStatus(`Ready — ${parsedCount} sentences`); }
          },
          onerror() { setStatus(`Ready — ${parsedCount} sentences`); },
        });
      },

      onerror() {
        setProcessing(false);
        if (playBtn) playBtn.textContent = '▶ Play';
        setStatus('Error — sidecar unreachable');
        if (progressRow) progressRow.style.display = 'none';
        alert('Cannot reach localhost:8080 — is the sidecar running?');
      },
    });
  }

  // ── Trigger button ────────────────────────────────────────────────────────────

  const trigger = document.createElement('button');
  trigger.id = 'tts-trigger';
  trigger.textContent = `🔊 TTS v${VERSION}`;
  trigger.title = 'Checking backend…';

  function setTriggerState(online) {
    trigger.style.background = online ? '#1a73e8' : '#999';
    trigger.title = online
      ? `Backend online — v${VERSION}`
      : 'Backend offline — start uvicorn demo.api:app --port 8080';
  }

  function checkBackend() {
    GM_xmlhttpRequest({
      method: 'GET',
      url:    'http://localhost:8080/health',
      onload(res)  { setTriggerState(res.status === 200); },
      onerror()    { setTriggerState(false); },
    });
  }

  checkBackend();
  setInterval(checkBackend, 15000);

  trigger.onclick = () => {
    if (bar) { stopPlayback(); bar.remove(); bar = null; return; }

    // Purge stale cache entries (fire-and-forget)
    GM_xmlhttpRequest({ method: 'POST', url: API_CACHE_EXPIRE });

    buildBar();
    setProcessing(true);
    setStatus('Loading…');

    const html = extractHTML();
    GM_xmlhttpRequest({
      method:  'POST',
      url:     API_SENTENCES,
      headers: { 'Content-Type': 'application/json' },
      data:    JSON.stringify({ html }),
      onload(res) {
        if (res.status !== 200) { setStatus('Failed to extract text'); setProcessing(false); return; }
        const { sentences, count } = JSON.parse(res.responseText);
        currentSentences = sentences;
        setStatus(`${count} sentences — generating…`);
        startTTS(extractHTML(), count);
      },
      onerror() {
        setTriggerState(false);
        setStatus('Cannot reach localhost:8080');
        setProcessing(false);
      },
    });
  };

  document.body.appendChild(trigger);

})();
