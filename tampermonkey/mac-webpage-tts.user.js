// ==UserScript==
// @name         Mac Webpage TTS
// @namespace    mac-tts-tools
// @version      1.3.0
// @description  Text-to-speech reader for educative.io using macOS Web Speech API
// @author       bgandhi
// @match        https://www.educative.io/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let articleEl = null;
  let currentRate = 1.25;
  let activeBlock = null;
  const RATES = [0.75, 1, 1.25, 1.5, 2];

  const VERSION = '1.3.0';

  // --- Content root ---
  const getArticle = () => {
    const selectors = [
      '.ed-lesson-content',
      '[class*="lessonPage_lesson-page"]',
      '.content-area',
      '.db-content',
      '[class*="EditorWrapper"]',
      '[class*="lesson-content"]',
      '[class*="content-body"]',
      'article',
      'main',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 40) return el;
    }
    return null;
  };

  // Collect header elements outside .ed-lesson-content (h1 + description p)
  const getHeaderEls = () => {
    const els = [];
    // h1 anywhere on page that's not inside the lesson content
    const h1 = document.querySelector('h1');
    if (h1 && !h1.closest('.ed-lesson-content')) els.push(h1);
    // description paragraph: <div dir="auto"><p class="markdown-viewer body-medium">
    const descP = document.querySelector('div[dir="auto"] p.markdown-viewer');
    if (descP && !descP.closest('.ed-lesson-content')) els.push(descP);
    return els;
  };

  // --- Text preprocessing ---
  const preprocessText = (text) => {
    return text
      .replace(/\b(\w+)\.com\b/gi, '$1 dot com')
      .replace(/\b(\w+)\.io\b/gi,  '$1 dot io')
      .replace(/\b(\w+)\.dev\b/gi, '$1 dot dev')
      .replace(/(\w)\.(\w)/g, '$1 dot $2')
      .replace(/\bAPI\b/gi, 'A.P.I.')
      .replace(/\bAPIs\b/g, 'A.P.I.s')
      .replace(/\bHTTPS?\b/g, m => m.split('').join('.') + '.')
      .replace(/\bSQL\b/g, 'sequel')
      .replace(/\bNoSQL\b/g, 'No-sequel')
      .replace(/\bUI\b/g, 'U.I.')
      .replace(/\bUX\b/g, 'U.X.')
      .replace(/\bOS\b/g, 'O.S.')
      .replace(/\bCPU\b/g, 'C.P.U.')
      .replace(/\bGPU\b/g, 'G.P.U.')
      .replace(/\bRAM\b/g, 'ram')
      .replace(/\b([A-Z]{2,5})\b/g, match => match.split('').join('.') + '.');
  };

  // --- Sentence splitter ---
  const sentenceSplit = (text) => {
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const results = parts.map(p => p.trim()).filter(Boolean);
    return results.length ? results : [text];
  };

  // --- Scroll to center ---
  const scrollToMiddle = (el) => {
    const rect = el.getBoundingClientRect();
    window.scrollBy({ top: rect.top + rect.height / 2 - window.innerHeight / 2, behavior: 'smooth' });
  };

  // --- Block highlight ---
  const BLOCK_TAGS = new Set(['P','LI','H1','H2','H3','H4','H5','H6','TD','TH','BLOCKQUOTE','PRE']);

  const highlightBlock = (el) => {
    clearHighlight();
    if (!el) return;
    let node = el;
    while (node && node !== document.body) {
      if (BLOCK_TAGS.has(node.tagName)) break;
      node = node.parentElement;
    }
    if (node && node !== document.body) {
      node.classList.add('tts-active-block');
      activeBlock = node;
      scrollToMiddle(node);
    }
  };

  const clearHighlight = () => {
    if (activeBlock) { activeBlock.classList.remove('tts-active-block'); activeBlock = null; }
  };

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    .tts-active-block {
      background: #fff9c4 !important;
      border-left: 3px solid #f9a825 !important;
      padding-left: 6px !important;
      border-radius: 2px;
      transition: background 0.2s;
    }
    #tts-bar button, #tts-bar select {
      background: transparent; border: none; color: #fff;
      font-size: 14px; cursor: pointer; padding: 4px 8px;
      border-radius: 6px; font-family: inherit;
    }
    #tts-bar button { font-size: 18px; }
    #tts-bar button:hover, #tts-bar select:hover { background: #333; }
    #tts-speed { font-size: 12px !important; font-weight: bold; min-width: 40px; text-align: center; }
    #tts-voice { max-width: 140px; font-size: 12px !important; background: #2a2a3e !important; border: 1px solid #555 !important; }
    #tts-voice option { background: #1a1a2e; color: #fff; }
    .tts-divider { width: 1px; background: #444; align-self: stretch; margin: 4px 0; }
  `;
  document.head.appendChild(style);

  // --- Voice helpers ---
  const getSelectedVoice = () => {
    const select = document.getElementById('tts-voice');
    const voices = speechSynthesis.getVoices();
    return voices.find(v => v.name === select?.value) || null;
  };

  const populateVoices = () => {
    const select = document.getElementById('tts-voice');
    if (!select) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    select.innerHTML = '';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.default) opt.selected = true;
      select.appendChild(opt);
    });
  };

  // --- Queue builder ---
  const nearestBlockAncestor = (el) => {
    let node = el.parentElement;
    while (node) {
      if (BLOCK_TAGS.has(node.tagName)) return node;
      if (node === articleEl) break;
      node = node.parentElement;
    }
    return null;
  };

  const buildQueue = () => {
    if (!articleEl) return [];

    const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT);
    const queue = [];

    const PAUSES = { H1: 900, H2: 750, H3: 600, H4: 500, P: 350, LI: 200, BLOCKQUOTE: 400, DEFAULT: 250 };
    const PITCH  = { H1: 1.2, H2: 1.15, H3: 1.1, H4: 1.05, DEFAULT: 1 };

    const addPause = (ms) => {
      if (ms <= 0) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = Math.max(0.1, (1000 / ms) * 0.15);
      queue.push({ type: 'pause', utterance: u });
    };

    let currentBlock = null;
    let currentText = '';

    const flush = () => {
      const text = currentText.trim();
      currentText = '';
      if (!text) { currentBlock = null; return; }
      const blockTag = currentBlock ? currentBlock.tagName : null;
      const blockEl = currentBlock;

      if (blockTag && /^H[1-4]$/.test(blockTag)) {
        addPause(PAUSES[blockTag] || PAUSES.DEFAULT);
        queue.push({ type: 'text', content: text, pitch: PITCH[blockTag] || PITCH.DEFAULT, rateMultiplier: 0.95, blockEl });
        addPause(300);
      } else {
        sentenceSplit(text).forEach(sentence => {
          const trimmed = sentence.trim();
          if (trimmed) queue.push({ type: 'text', content: trimmed, blockEl });
        });
        addPause(PAUSES[blockTag] || PAUSES.DEFAULT);
      }
      currentBlock = null;
    };

    const CODE_TAGS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE']);
    const isInsideCode = (n) => {
      let p = n.parentElement;
      while (p && p !== articleEl) {
        if (CODE_TAGS.has(p.tagName)) return true;
        p = p.parentElement;
      }
      return false;
    };

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text) continue;
      if (isInsideCode(node)) continue;
      const block = nearestBlockAncestor(node);
      if (block !== currentBlock) flush();
      currentBlock = block;
      currentText += ' ' + node.textContent;
    }
    flush();

    return queue;
  };

  // --- Speak ---
  const buildAndSpeak = () => {
    speechSynthesis.cancel();
    const voice = getSelectedVoice();
    const queue = buildQueue();

    // Prepend h1 + description paragraph that live outside the content root
    getHeaderEls().forEach((el, i) => {
      const text = el.textContent.trim();
      if (!text) return;
      const u = new SpeechSynthesisUtterance(preprocessText(text));
      u.lang = 'en-US';
      u.rate = currentRate * (i === 0 ? 0.9 : 1);
      u.pitch = i === 0 ? 1.2 : 1;
      if (voice) u.voice = voice;
      u.onstart = () => highlightBlock(el);
      speechSynthesis.speak(u);
    });

    queue.forEach(item => {
      if (item.type === 'pause') { speechSynthesis.speak(item.utterance); return; }
      const u = new SpeechSynthesisUtterance(preprocessText(item.content));
      u.lang = 'en-US';
      u.rate = currentRate * (item.rateMultiplier || 1);
      u.pitch = item.pitch || 1;
      if (voice) u.voice = voice;
      u.onstart = () => highlightBlock(item.blockEl);
      speechSynthesis.speak(u);
    });
  };

  const speakAll = () => {
    articleEl = getArticle() || document.body;
    buildAndSpeak();
  };

  // --- UI ---
  const inject = () => {
    if (document.getElementById('tts-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'tts-bar';
    bar.innerHTML = `
      <span style="font-size:10px;color:#888;padding:0 4px;user-select:none;">v${VERSION}</span>
      <div class="tts-divider"></div>
      <button id="tts-play"  title="Play">▶</button>
      <button id="tts-pause" title="Pause">⏸</button>
      <button id="tts-stop"  title="Stop">⏹</button>
      <div class="tts-divider"></div>
      <button id="tts-speed" title="Cycle speed">1.25×</button>
      <div class="tts-divider"></div>
      <select id="tts-voice" title="Choose voice"></select>
      <div class="tts-divider"></div>
      <button id="tts-close" title="Close">✕</button>
    `;

    Object.assign(bar.style, {
      position:      'fixed',
      top:           '72px',
      right:         '24px',
      zIndex:        '2147483647',
      display:       'flex',
      flexDirection: 'row',
      alignItems:    'center',
      gap:           '4px',
      background:    '#1a1a2e',
      border:        '1px solid #444',
      borderRadius:  '12px',
      padding:       '8px 12px',
      boxShadow:     '0 4px 12px rgba(0,0,0,0.4)',
      width:         'max-content',
      cursor:        'move',
    });

    document.body.appendChild(bar);
    populateVoices();
    speechSynthesis.onvoiceschanged = populateVoices;

    // Drag
    let ox, oy;
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      ox = e.clientX - bar.getBoundingClientRect().left;
      oy = e.clientY - bar.getBoundingClientRect().top;
      let dragging = false;
      const onMove = e => {
        if (!dragging) { dragging = true; bar.style.right = 'auto'; }
        bar.style.left = (e.clientX - ox) + 'px';
        bar.style.top  = (e.clientY - oy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    document.getElementById('tts-play').onclick = () => {
      if (speechSynthesis.paused) speechSynthesis.resume();
      else speakAll();
    };
    document.getElementById('tts-pause').onclick = () => speechSynthesis.pause();
    document.getElementById('tts-stop').onclick  = () => { speechSynthesis.cancel(); clearHighlight(); };
    document.getElementById('tts-close').onclick = () => { speechSynthesis.cancel(); clearHighlight(); bar.remove(); };
    document.getElementById('tts-speed').onclick = () => {
      const btn = document.getElementById('tts-speed');
      const idx = RATES.indexOf(currentRate);
      currentRate = RATES[(idx + 1) % RATES.length];
      btn.textContent = currentRate + '×';
    };
  };

  // Educative loads content via React — wait for content to appear
  const poll = setInterval(() => {
    const article = getArticle();
    if (article) {
      clearInterval(poll);
      inject();
    }
  }, 800);

})();
