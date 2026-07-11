// ==UserScript==
// @name         Wiki TTS
// @namespace    ai-tts-tools
// @version      5.15
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

  const API_FROM_HTML   = 'http://localhost:8080/tts/from-html';
  const API_SENTENCES   = 'http://localhost:8080/sentences';
  const API_CACHE_CLEAR = 'http://localhost:8080/cache/clear';
  const API_CACHE_EXPIRE = 'http://localhost:8080/cache/expire';
  const VOICE          = 'af_sarah';
  const BOUNDARY       = 'tts_boundary';
  const AVG_SECS_PER_SENTENCE = 4.5; // rough average sentence audio duration

  let currentSpeed = 1.35;

  // ── Styles ──────────────────────────────────────────────────────────────────

  GM_addStyle(`
    #tts-panel {
      position: fixed;
      top: 60px;
      right: 16px;
      width: 340px;
      height: 500px;
      min-width: 260px;
      min-height: 220px;
      background: rgba(255,255,255,0.78);
      color: #1a1a1a;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      border: 1px solid rgba(180,180,180,0.5);
      display: flex;
      flex-direction: column;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.7;
      overflow: hidden;
    }
    #tts-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: rgba(245,245,245,0.7);
      border-bottom: 1px solid rgba(200,200,200,0.4);
      border-radius: 12px 12px 0 0;
      flex-shrink: 0;
      cursor: move;
      user-select: none;
    }
    #tts-title {
      font-weight: 600;
      font-size: 12px;
      color: #555;
      flex: 1;
    }
    #tts-btn-play {
      padding: 4px 12px;
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #tts-btn-play:disabled,
    #tts-btn-stop:disabled,
    #tts-btn-refresh:disabled { opacity: 0.45; cursor: default; pointer-events: none; }
    #tts-btn-stop {
      background: none;
      border: 1px solid #ccc;
      color: #555;
      font-size: 13px;
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      flex-shrink: 0;
    }
    #tts-btn-stop:hover { background: #f5f5f5; color: #e53935; border-color: #e53935; }
    #tts-btn-refresh {
      background: none;
      border: 1px solid #ccc;
      color: #555;
      font-size: 13px;
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      flex-shrink: 0;
    }
    #tts-btn-refresh:hover { background: #f5f5f5; color: #1a73e8; border-color: #1a73e8; }
    #tts-time-est {
      font-size: 10px;
      color: #888;
      padding: 2px 12px 4px;
      background: transparent;
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
    }
    #tts-timer {
      font-weight: 600;
      color: #1a73e8;
      font-variant-numeric: tabular-nums;
      flex: 1;
    }
    #tts-btn-close {
      background: none;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      flex-shrink: 0;
    }
    #tts-btn-close:hover { color: #e53935; }
    #tts-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(250,250,250,0.6);
      border-bottom: 1px solid rgba(200,200,200,0.35);
      flex-shrink: 0;
      font-size: 11px;
      color: #666;
    }
    #tts-speed-slider {
      flex: 1;
      accent-color: #1a73e8;
      cursor: pointer;
    }
    #tts-speed-val {
      min-width: 32px;
      text-align: right;
      font-weight: 600;
      color: #1a73e8;
    }
    #tts-progress-row {
      padding: 4px 12px 6px;
      background: rgba(250,250,250,0.6);
      border-bottom: 1px solid rgba(200,200,200,0.35);
      flex-shrink: 0;
      display: none;
    }
    #tts-progress-bar-bg {
      background: #e8eaed;
      border-radius: 4px;
      height: 4px;
      overflow: hidden;
    }
    #tts-progress-bar-fill {
      background: #1a73e8;
      height: 4px;
      width: 0%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    #tts-progress-label {
      font-size: 10px;
      color: #888;
      margin-top: 3px;
    }
    #tts-body {
      overflow-y: auto;
      padding: 14px;
      flex: 1;
      background: transparent;
    }
    .tts-sent {
      display: inline;
      border-radius: 3px;
      padding: 1px 0;
      color: #333;
      background: none !important;
    }
    .tts-sent.active {
      background: #fff176 !important;
      color: #111;
      padding: 1px 2px;
    }
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
    .tts-grip {
      position: absolute;
      z-index: 10;
    }
    .tts-grip-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: se-resize; }
    .tts-grip-sw { bottom: 0; left:  0; width: 14px; height: 14px; cursor: sw-resize; }
    .tts-grip-e  { top: 20%; right: 0; width: 6px; height: 60%; cursor: e-resize; }
    .tts-grip-w  { top: 20%; left:  0; width: 6px; height: 60%; cursor: w-resize; }
    .tts-grip-s  { bottom: 0; left: 20%; width: 60%; height: 6px; cursor: s-resize; }
  `);

  // ── DOM helpers ──────────────────────────────────────────────────────────────

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

  // ── Panel state ──────────────────────────────────────────────────────────────

  let panel = null;
  let playBtn, stopBtn, refreshBtn, progressRow, progressFill, progressLabel, bodyEl, timeEstEl;
  let spans = [];
  let currentSentences = [];

  function formatDuration(secs) {
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function buildPanel(sentences) {
    const old = panel ? {
      top: panel.style.top, left: panel.style.left,
      width: panel.style.width, height: panel.style.height,
    } : null;
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'tts-panel';
    if (old) {
      if (old.left)   panel.style.left   = old.left;
      if (old.top)    panel.style.top    = old.top;
      if (old.width)  panel.style.width  = old.width;
      if (old.height) panel.style.height = old.height;
    }

    // Header
    const header = document.createElement('div');
    header.id = 'tts-header';

    const title = document.createElement('span');
    title.id = 'tts-title';
    title.textContent = `🔊 TTS Read-Along v${VERSION}`;

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
      refreshBtn.disabled = true;
      refreshBtn.textContent = '…';
      GM_xmlhttpRequest({
        method:  'POST',
        url:     API_CACHE_CLEAR,
        headers: { 'Content-Type': 'application/json' },
        data:    JSON.stringify({ sentences: currentSentences, voice_profile: VOICE, speed: currentSpeed }),
        onload() {
          refreshBtn.textContent = '↺';
          refreshBtn.disabled = false;
          startTTS(extractHTML(), currentSentences.length);
        },
        onerror() { refreshBtn.textContent = '↺'; refreshBtn.disabled = false; },
      });
    };

    const closeBtn = document.createElement('button');
    closeBtn.id = 'tts-btn-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => { stopPlayback(); panel.remove(); panel = null; };

    header.append(title, playBtn, stopBtn, refreshBtn, closeBtn);

    // Speed controls
    const controls = document.createElement('div');
    controls.id = 'tts-controls';
    const speedLbl = document.createElement('span');
    speedLbl.textContent = 'Speed';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.id = 'tts-speed-slider';
    slider.min = 0.5; slider.max = 2.0; slider.step = 0.1;
    slider.value = currentSpeed;
    const speedVal = document.createElement('span');
    speedVal.id = 'tts-speed-val';
    speedVal.textContent = currentSpeed.toFixed(1) + '×';
    slider.oninput = () => {
      currentSpeed = parseFloat(slider.value);
      speedVal.textContent = currentSpeed.toFixed(1) + '×';
      if (currentSentences.length) {
        timerTotal = Math.round((currentSentences.length * AVG_SECS_PER_SENTENCE) / currentSpeed);
        updateTimerDisplay();
      }
    };
    controls.append(speedLbl, slider, speedVal);

    // Timer row: "0:00 / 13:35  ·  63 sentences"
    timeEstEl = document.createElement('div');
    timeEstEl.id = 'tts-time-est';
    timerEl = document.createElement('span');
    timerEl.id = 'tts-timer';
    const sentCountLbl = document.createElement('span');
    sentCountLbl.textContent = sentences.length > 1 ? `${sentences.length} sentences` : '';
    timeEstEl.append(timerEl, sentCountLbl);

    // Progress bar
    progressRow = document.createElement('div');
    progressRow.id = 'tts-progress-row';
    const barBg = document.createElement('div');
    barBg.id = 'tts-progress-bar-bg';
    progressFill = document.createElement('div');
    progressFill.id = 'tts-progress-bar-fill';
    barBg.appendChild(progressFill);
    progressLabel = document.createElement('div');
    progressLabel.id = 'tts-progress-label';
    progressRow.append(barBg, progressLabel);

    // Body with sentences
    bodyEl = document.createElement('div');
    bodyEl.id = 'tts-body';
    spans = sentences.map((s, i) => {
      const mark = document.createElement('mark');
      mark.className = 'tts-sent';
      mark.dataset.idx = i;
      mark.textContent = s + ' ';
      bodyEl.appendChild(mark);
      return mark;
    });

    // Resize grips
    [
      { cls: 'tts-grip tts-grip-se', dx:  1, dy:  1 },
      { cls: 'tts-grip tts-grip-sw', dx: -1, dy:  1 },
      { cls: 'tts-grip tts-grip-e',  dx:  1, dy:  0 },
      { cls: 'tts-grip tts-grip-w',  dx: -1, dy:  0 },
      { cls: 'tts-grip tts-grip-s',  dx:  0, dy:  1 },
    ].forEach(({ cls, dx, dy }) => {
      const grip = document.createElement('div');
      grip.className = cls;
      panel.appendChild(grip);
      grip.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const startW = panel.offsetWidth, startH = panel.offsetHeight;
        const startL = panel.getBoundingClientRect().left;
        const onMove = e => {
          if (dx ===  1) panel.style.width  = Math.max(260, startW + (e.clientX - startX)) + 'px';
          if (dx === -1) {
            const newW = Math.max(260, startW - (e.clientX - startX));
            panel.style.width = newW + 'px';
            panel.style.left  = (startL + startW - newW) + 'px';
            panel.style.right = 'auto';
          }
          if (dy ===  1) panel.style.height = Math.max(200, startH + (e.clientY - startY)) + 'px';
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    currentSentences = sentences.filter(s => s !== 'Loading…' && s !== 'Failed to extract text.' && s !== 'Cannot reach localhost:8080 — start the sidecar first.');
    panel.append(header, controls, timeEstEl, progressRow, bodyEl);
    document.body.appendChild(panel);
    makeDraggable(panel, header);

    playBtn.onclick = () => {
      const t = playBtn.textContent;
      if (t === '⏸ Pause') {
        pausePlayback();
      } else if (t === '▶ Resume') {
        resumePlayback();
      } else if (t === '⏹ Stop') {
        stopPlayback();
      } else {
        // ▶ Play — start playback
        stopped = false;
        paused  = false;
        playBtn.textContent = '⏸ Pause';
        startTimer(Math.round((currentSentences.length * AVG_SECS_PER_SENTENCE) / currentSpeed));
        playerLoop(totalSentences || audioQueue.length);
      }
    };
  }

  function setProcessing(busy) {
    if (playBtn)    { playBtn.disabled    = busy; }
    if (stopBtn)    { stopBtn.disabled    = busy; }
    if (refreshBtn) { refreshBtn.disabled = busy; }
  }

  function setProgress(done, total) {
    if (!progressRow) return;
    progressRow.style.display = 'block';
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = pct + '%';
    progressLabel.textContent = `Generating audio… ${done} / ${total} sentences`;
  }

  function clearProgress() {
    if (!progressRow) return;
    progressRow.style.display = 'none';
    progressFill.style.width = '0%';
    progressLabel.textContent = '';
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let ox, oy;
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      let dragging = false;
      const onMove = e => {
        if (!dragging) {
          dragging = true;
          el.style.right = 'auto';
        }
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top  = (e.clientY - oy) + 'px';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Highlight ─────────────────────────────────────────────────────────────────

  function highlightSentence(idx) {
    spans.forEach((el, i) => el.classList.toggle('active', i === idx));
    if (spans[idx]) spans[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearHighlights() { spans.forEach(el => el.classList.remove('active')); }

  // ── Page scroll sync ──────────────────────────────────────────────────────────

  // Find a text node in the page containing the given sentence and scroll to it.
  // Uses a simple substring search on text nodes in the content area.
  function scrollPageToSentence(sentence) {
    if (!sentence || sentence.length < 10) return;
    const content =
      document.querySelector('#main-content') ||
      document.querySelector('.wiki-content') ||
      document.querySelector('#content .view') ||
      document.querySelector('#mw-content-text .mw-parser-output') ||
      document.querySelector('#mw-content-text') ||
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.body;

    // First 60 chars of sentence stripped of punctuation for a robust match
    const needle = sentence.replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 60).toLowerCase();
    if (!needle) return;

    // Walk text nodes, find one containing the needle
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.nodeValue.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();
      if (txt.includes(needle)) {
        const el = node.parentElement;
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
    }
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
  let timerTotal     = 0;  // estimated total seconds
  let timerEl        = null;

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
      if (!paused) {
        timerElapsed++;
        updateTimerDisplay();
      }
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
    if (queueResolve)  { queueResolve();  queueResolve  = null; }
    if (pauseResolve)  { pauseResolve();  pauseResolve  = null; }
    stopTimer();
    clearHighlights();
    clearProgress();
    if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
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

  // Player loop — runs concurrently with streaming
  async function playerLoop(total) {
    let played = 0;
    while (!stopped && played < total) {
      // Wait if paused (and no audio playing yet)
      if (paused && !currentAudio) await waitForResume();
      if (stopped) break;

      if (audioQueue.length === 0) await waitForChunk();
      if (stopped) break;

      const chunk = audioQueue.shift();
      highlightSentence(chunk.idx);
      scrollPageToSentence(chunk.sentence);
      await playWav(chunk.wav);

      // If paused mid-sentence, wait here before playing next
      if (paused && !stopped) await waitForResume();
      played++;
    }
    if (!stopped) {
      stopTimer();
      clearHighlights();
      clearProgress();
      if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
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

  // Parse whatever bytes we have so far, return leftover offset
  function parseAvailable(buffer, fromPos, total, doneCount) {
    const dec   = new TextDecoder();
    const bound = enc(`--${BOUNDARY}`);
    let pos     = fromPos;
    let done    = doneCount;

    while (pos < buffer.byteLength) {
      const bStart = indexOfBytes(buffer, bound, pos);
      if (bStart === -1) break;
      pos = bStart + bound.byteLength;

      // Final boundary check (--)
      if (pos + 2 <= buffer.byteLength) {
        const tail = new Uint8Array(buffer, pos, 2);
        if (tail[0] === 45 && tail[1] === 45) { pos += 2; break; }
      }
      pos += 2; // skip \r\n after boundary

      const headerEnd = indexOfBytes(buffer, enc('\r\n\r\n'), pos);
      if (headerEnd === -1) { pos = bStart; break; } // incomplete header, wait for more

      const headerText = dec.decode(new Uint8Array(buffer, pos, headerEnd - pos));
      pos = headerEnd + 4;

      const idxMatch = headerText.match(/X-Sentence-Index:\s*(\d+)/i);
      const lenMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      const txtMatch = headerText.match(/X-Sentence-Text:\s*(\S+)/i);
      if (!idxMatch || !lenMatch) continue;

      const idx = parseInt(idxMatch[1], 10);
      const len = parseInt(lenMatch[1], 10);

      if (pos + len > buffer.byteLength) { pos = bStart; break; } // incomplete body, wait

      const wav      = buffer.slice(pos, pos + len);
      const sentence = txtMatch ? atob(txtMatch[1]) : '';
      pos += len + 2;
      done++;

      setProgress(done, total);
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

    // Show progress bar immediately
    if (progressRow) {
      progressRow.style.display = 'block';
      progressFill.style.width  = '0%';
      progressLabel.textContent = knownTotal > 0
        ? `Generating audio… 0 / ${knownTotal} sentences`
        : 'Generating audio…';
    }

    // Animate progress bar with a timer since GM arraybuffer doesn't stream
    let fakeProgress = 0;
    const secPerSentence = 0.5 / currentSpeed;
    const totalEstMs = knownTotal > 0 ? knownTotal * secPerSentence * 1000 : 30000;
    const ticker = setInterval(() => {
      if (generationDone || stopped) { clearInterval(ticker); return; }
      fakeProgress = Math.min(fakeProgress + (100 / (totalEstMs / 200)), 95);
      if (progressFill) progressFill.style.width = fakeProgress + '%';
    }, 200);

    let parsePos       = 0;
    let parsedCount    = 0;
    let playerStarted  = false;
    let accumBuffer    = null; // ArrayBuffer grown via Uint8Array concat

    function appendBytes(newBuf) {
      if (!accumBuffer) { accumBuffer = newBuf.slice(0); return; }
      const merged = new Uint8Array(accumBuffer.byteLength + newBuf.byteLength);
      merged.set(new Uint8Array(accumBuffer), 0);
      merged.set(new Uint8Array(newBuf), accumBuffer.byteLength);
      accumBuffer = merged.buffer;
    }

    GM_xmlhttpRequest({
      method:       'POST',
      url:          API_FROM_HTML,
      headers:      { 'Content-Type': 'application/json' },
      data:         JSON.stringify({ html, voice_profile: VOICE, speed: currentSpeed }),
      responseType: 'arraybuffer',

      onloadstart(res) {
        const hdr = res.responseHeaders || '';
        const m   = hdr.match(/X-Total-Sentences:\s*(\d+)/i);
        if (m) { totalSentences = parseInt(m[1], 10); setProgress(0, totalSentences); }
      },

      onprogress(res) {
        if (!res.response) return;
        const newBytes = res.response.slice(accumBuffer ? accumBuffer.byteLength : 0);
        appendBytes(newBytes);

        if (totalSentences === 0) {
          const hdr = res.responseHeaders || '';
          const m   = hdr.match(/X-Total-Sentences:\s*(\d+)/i);
          if (m) { totalSentences = parseInt(m[1], 10); setProgress(0, totalSentences); }
        }

        const result = parseAvailable(accumBuffer, parsePos, totalSentences, parsedCount);
        parsePos    = result.pos;
        parsedCount = result.done;
      },

      onload(res) {
        if (!accumBuffer && res.response) accumBuffer = res.response;
        else if (res.response) appendBytes(res.response.slice(accumBuffer ? accumBuffer.byteLength : 0));

        if (totalSentences === 0) {
          const hdr = res.responseHeaders || '';
          const m   = hdr.match(/X-Total-Sentences:\s*(\d+)/i);
          totalSentences = m ? parseInt(m[1], 10) : parsedCount;
        }

        if (accumBuffer) {
          const result = parseAvailable(accumBuffer, parsePos, totalSentences, parsedCount);
          parsedCount  = result.done;
        }

        generationDone = true;
        setProcessing(false);
        setProgress(parsedCount, totalSentences);
        progressLabel.textContent = `Ready — ${parsedCount} sentences`;
        // Signal player if it's already running
        if (queueResolve) { queueResolve(); queueResolve = null; }
      },

      onerror() {
        setProcessing(false);
        if (playBtn) playBtn.textContent = '▶ Play';
        alert('Cannot reach localhost:8080 — is the sidecar running?');
      },
    });
  }

  // ── Trigger button ────────────────────────────────────────────────────────────

  const VERSION = '5.15';

  const trigger = document.createElement('button');
  trigger.id = 'tts-trigger';
  trigger.textContent = `🔊 TTS v${VERSION}`;
  trigger.title = 'Checking backend…';

  function setTriggerState(online) {
    trigger.style.background = online ? '#1a73e8' : '#999';
    trigger.title = online ? `Backend online — v${VERSION}` : 'Backend offline — start uvicorn demo.api:app --port 8080';
  }

  function checkBackend() {
    GM_xmlhttpRequest({
      method: 'GET',
      url:    'http://localhost:8080/health',
      onload(res)  { setTriggerState(res.status === 200); },
      onerror()    { setTriggerState(false); },
    });
  }

  // Check on load, then every 15s
  checkBackend();
  setInterval(checkBackend, 15000);

  trigger.onclick = () => {
    if (panel) { panel.remove(); panel = null; return; }
    const html = extractHTML();

    // Fire-and-forget: purge cache entries older than 7 days
    GM_xmlhttpRequest({ method: 'POST', url: API_CACHE_EXPIRE });

    buildPanel(['Loading…']);
    setProcessing(true);

    GM_xmlhttpRequest({
      method:  'POST',
      url:     API_SENTENCES,
      headers: { 'Content-Type': 'application/json' },
      data:    JSON.stringify({ html }),
      onload(res) {
        if (res.status !== 200) {
          buildPanel(['Failed to extract text.']);
          setProcessing(false);
          return;
        }
        const { sentences, count } = JSON.parse(res.responseText);
        buildPanel(sentences);
        // Auto-start generation — audio queues in background while user reads
        startTTS(extractHTML(), count);
      },
      onerror() {
        setTriggerState(false);
        buildPanel(['Cannot reach localhost:8080 — start the sidecar first.']);
        setProcessing(false);
      },
    });
  };
  document.body.appendChild(trigger);

})();
