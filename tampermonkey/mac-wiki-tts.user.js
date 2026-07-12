// ==UserScript==
// @name         Mac Wiki TTS
// @namespace    mac-tts-tools
// @description  Text-to-speech reader for wiki.corp.adobe.com pages
// @version      1.2.0
// @match        https://wiki.corp.adobe.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- State ---
  let originalHTML = null;
  let articleEl = null;
  let plainWords = [];
  let currentRate = 1.25;
  const RATES = [0.75, 1, 1.25, 1.5, 2];

  // --- Article helpers ---
  const ARTICLE_SELECTORS = [
    '#main-content .wiki-content',
    '.wiki-content',
    '#main-content',
    '#content-body',
    'article',
  ];

  const getArticle = () => {
    for (const sel of ARTICLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 40) return el;
    }
    return null;
  };

  // --- Text preprocessing ---
  const preprocessText = (text) => {
    return text
      .replace(/\b(\w+)\.com\b/gi, '$1 dot com')
      .replace(/\b(\w+)\.org\b/gi, '$1 dot org')
      .replace(/\b(\w+)\.net\b/gi, '$1 dot net')
      .replace(/\b(\w+)\.io\b/gi,  '$1 dot io')
      .replace(/\b(\w+)\.ai\b/gi,  '$1 dot ai')
      .replace(/\b(\w+)\.dev\b/gi, '$1 dot dev')
      .replace(/(\w)\.(\w)/g, '$1 dot $2')
      .replace(/\bAPI\b/gi, 'A.P.I.')
      .replace(/\bAPIs\b/g, 'A.P.I.s')
      .replace(/\bHTTPS?\b/g, m => m.split('').join('.') + '.')
      .replace(/\bIP\b/g, 'I.P.')
      .replace(/\bDNS\b/g, 'D.N.S.')
      .replace(/\bCDN\b/g, 'C.D.N.')
      .replace(/\bSQL\b/g, 'sequel')
      .replace(/\bNoSQL\b/g, 'No-sequel')
      .replace(/\bUI\b/g, 'U.I.')
      .replace(/\bUX\b/g, 'U.X.')
      .replace(/\bOS\b/g, 'O.S.')
      .replace(/\bCPU\b/g, 'C.P.U.')
      .replace(/\bGPU\b/g, 'G.P.U.')
      .replace(/\bRAM\b/g, 'ram')
      .replace(/\bRPC\b/g, 'R.P.C.')
      .replace(/\bSSL\b/g, 'S.S.L.')
      .replace(/\bTLS\b/g, 'T.L.S.')
      .replace(/\bTCP\b/g, 'T.C.P.')
      .replace(/\bUDP\b/g, 'U.D.P.')
      .replace(/\bLRU\b/g, 'L.R.U.')
      .replace(/\bCDC\b/g, 'C.D.C.')
      .replace(/\bACID\b/g, 'acid')
      .replace(/\bCAP\b/g, 'cap')
      .replace(/\b([A-Z]{2,5})\b/g, (match) => match.split('').join('.') + '.');
  };

  // --- Sentence splitter ---
  const sentenceSplit = (text) => {
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const results = parts.map(p => p.trim()).filter(Boolean);
    return results.length ? results : [text];
  };

  // --- Block highlighting (no DOM mutation) ---
  // Instead of wrapping words, highlight the nearest block ancestor of the
  // currently-speaking sentence. Zero DOM mutations — Confluence layout safe.

  let activeBlock = null;
  const HIGHLIGHT_BLOCK_TAGS = new Set(['P','LI','H1','H2','H3','H4','H5','H6','TD','TH','BLOCKQUOTE','PRE']);

  const highlightBlock = (el) => {
    clearHighlight();
    if (!el) return;
    let node = el;
    while (node && node !== document.body) {
      if (HIGHLIGHT_BLOCK_TAGS.has(node.tagName)) break;
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
    // legacy word spans (should not exist, but clean up just in case)
    plainWords.forEach(w => w.classList.remove('tts-active'));
  };

  // wrapWords / unwrapWords kept minimal — only used for click-to-seek word index
  const wrapWords = () => {
    articleEl = getArticle();
    if (!articleEl) return;
    // Don't mutate DOM — build plainWords from text nodes read-only for index tracking
    plainWords = [];
  };

  const unwrapWords = () => {
    plainWords = [];
  };

  // --- Scroll active element to viewport center ---
  const scrollToMiddle = (el) => {
    const rect = el.getBoundingClientRect();
    const elementCenter = rect.top + rect.height / 2;
    const viewportCenter = window.innerHeight / 2;
    window.scrollBy({ top: elementCenter - viewportCenter, behavior: 'smooth' });
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
  // Walks text nodes directly — no .tts-word spans, no DOM mutation.
  const BLOCK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'PRE']);

  const nearestBlockAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== articleEl) {
      if (BLOCK_TAGS.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return null;
  };

  const buildQueue = () => {
    if (!articleEl) return [];

    const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT);
    const queue = [];

    const PAUSES = {
      H1: 900, H2: 750, H3: 600, H4: 500,
      P: 350, LI: 200, BLOCKQUOTE: 400,
      DEFAULT: 250
    };

    const PITCH = {
      H1: 1.2, H2: 1.15, H3: 1.1, H4: 1.05,
      DEFAULT: 1
    };

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

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text) continue;
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

    queue.forEach(item => {
      if (item.type === 'pause') {
        speechSynthesis.speak(item.utterance);
        return;
      }

      const u = new SpeechSynthesisUtterance(preprocessText(item.content));
      u.lang = 'en-US';
      u.rate = currentRate * (item.rateMultiplier || 1);
      u.pitch = item.pitch || 1;
      if (voice) u.voice = voice;
      u.onstart = () => highlightBlock(item.blockEl);

      speechSynthesis.speak(u);
    });
  };

  // --- Full play from start ---
  const speakAll = () => {
    articleEl = getArticle();
    buildAndSpeak();
  };

  // --- UI ---
  const inject = () => {
    if (document.getElementById('tts-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'tts-bar';
    bar.innerHTML = `
      <button id="tts-play"  title="Play">▶</button>
      <button id="tts-pause" title="Pause">⏸</button>
      <button id="tts-stop"  title="Stop">⏹</button>
      <div class="tts-divider"></div>
      <button id="tts-speed" title="Cycle speed">1.25×</button>
      <div class="tts-divider"></div>
      <select id="tts-voice" title="Choose voice"></select>
    `;

    Object.assign(bar.style, {
      position:        'fixed',
      top:             '72px',
      right:           '24px',
      zIndex:          '2147483647',
      display:         'flex',
      flexDirection:   'row',
      alignItems:      'center',
      gap:             '4px',
      background:      '#1a1a2e',
      border:          '1px solid #444',
      borderRadius:    '12px',
      padding:         '8px 12px',
      boxShadow:       '0 4px 12px rgba(0,0,0,0.4)',
      width:           'max-content',
    });

    document.body.appendChild(bar);
    populateVoices();
    speechSynthesis.onvoiceschanged = populateVoices;

    document.getElementById('tts-play').onclick = () => {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
      } else {
        speakAll();
      }
    };

    document.getElementById('tts-pause').onclick = () => speechSynthesis.pause();

    document.getElementById('tts-stop').onclick = () => {
      speechSynthesis.cancel();
      clearHighlight();
    };

    document.getElementById('tts-speed').onclick = () => {
      const btn = document.getElementById('tts-speed');
      const idx = RATES.indexOf(currentRate);
      currentRate = RATES[(idx + 1) % RATES.length];
      btn.textContent = currentRate + '×';
    };
  };

  const poll = setInterval(() => {
    if (document.body) { clearInterval(poll); inject(); }
  }, 500);

})();
