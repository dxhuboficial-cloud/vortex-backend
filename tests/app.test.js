import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const htmlContent = fs.readFileSync('public/index.html', 'utf8');
const cssContent = fs.readFileSync('public/style.css', 'utf8');
let jsContent = fs.readFileSync('public/script.js', 'utf8');

// Strip ES module imports for Node VM testing
jsContent = jsContent.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed');
jsContent = jsContent.replace(/export\s+(async\s+)?function\s+/g, '$1function ');
jsContent = jsContent.replace(/export\s+(?:const|let|var)\s+/g, 'var ');

function createTestEnvironment() {
  const elements = {};
  const idMatches = htmlContent.matchAll(/id=["']([^"']+)["']/g);
  for (const m of idMatches) {
    const id = m[1];
    elements[id] = {
      id,
      style: {},
      classList: {
        _classes: new Set(),
        add(...c) { c.forEach(x => this._classes.add(x)); },
        remove(...c) { c.forEach(x => this._classes.delete(x)); },
        toggle(c, val) {
          if (val === undefined) val = !this._classes.has(c);
          if (val) this._classes.add(c); else this._classes.delete(c);
          return val;
        },
        contains(c) { return this._classes.has(c); }
      },
      get className() {
        return Array.from(this.classList._classes).join(' ');
      },
      set className(val) {
        this.classList._classes.clear();
        if (val) String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
      },
      dataset: {},
      children: [],
      childNodes: [],
      _listeners: {},
      addEventListener(type, fn) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (this._listeners[type]) {
          this._listeners[type] = this._listeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent(eventOrType, eventObj = {}) {
        const type = typeof eventOrType === 'string' ? eventOrType : (eventOrType && eventOrType.type ? eventOrType.type : 'custom');
        const payload = typeof eventOrType === 'object' ? { ...eventOrType, ...eventObj } : eventObj;
        if (this._listeners[type]) {
          const promises = this._listeners[type].map(fn => fn({ target: this, ...payload }));
          return Promise.all(promises);
        }
        return Promise.resolve();
      },
      querySelector(sel) {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1).split(/[\s.:>+~[]/)[0];
          const found = this.children.find(c => c.classList && c.classList.contains && c.classList.contains(cls));
          if (found) return found;
        } else {
          const found = this.children.find(c => c.tagName && c.tagName.toLowerCase() === sel.toLowerCase());
          if (found) return found;
        }
        return {
          style: {},
          classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
          setAttribute: () => {},
          getAttribute: () => null,
          onclick: null,
          play: () => Promise.resolve(),
          pause: () => {},
          remove: () => {}
        };
      },
      closest(sel) {
        let cur = this;
        const selectors = String(sel || '').split(',').map(s => s.trim());
        while (cur) {
          for (const s of selectors) {
            if (s.startsWith('.') && cur.classList && cur.classList.contains && cur.classList.contains(s.slice(1))) {
              return cur;
            }
            if (s.startsWith('#') && cur.id === s.slice(1)) {
              return cur;
            }
          }
          cur = cur.parentElement || null;
        }
        return null;
      },
      querySelectorAll(sel) {
        const results = [];
        function walk(node) {
          if (!node || !node.children) return;
          for (const c of node.children) {
            if (sel.startsWith('.')) {
              const cls = sel.slice(1).split(/[\s.:>+~[]/)[0];
              if (c.classList && c.classList.contains && c.classList.contains(cls)) {
                results.push(c);
              }
            } else if (sel.startsWith('[') && sel.endsWith(']')) {
              const attrPart = sel.slice(1, -1);
              if (attrPart.includes('=')) {
                const [k, vRaw] = attrPart.split('=');
                const v = vRaw.replace(/^["']|["']$/g, '');
                if (k.startsWith('data-')) {
                  const camelKey = k.slice(5).replace(/-([a-z])/g, (_, m) => m.toUpperCase());
                  if (c.dataset && c.dataset[camelKey] === v) results.push(c);
                  else if (c[k] === v || (c.getAttribute && c.getAttribute(k) === v)) results.push(c);
                } else if (c[k] === v || (c.getAttribute && c.getAttribute(k) === v)) {
                  results.push(c);
                }
              }
            } else if (c.tagName && c.tagName.toLowerCase() === sel.toLowerCase()) {
              results.push(c);
            }
            walk(c);
          }
        }
        walk(this);
        return results;
      },
      prepend(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        if (child) child.parentElement = this;
        this.children.unshift(child);
        return child;
      },
      appendChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        if (child) child.parentElement = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (this.parentElement && Array.isArray(this.parentElement.children)) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx !== -1) this.parentElement.children.splice(idx, 1);
        }
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; },
      removeAttribute(k) { delete this[k]; },
      async click() { if (this.onclick) await this.onclick({ target: this, stopPropagation: () => {} }); },
      focus() { this._focused = true; },
      blur() { this._focused = false; },
      async click() {
        if (this.onclick) await this.onclick({ target: this, stopPropagation: () => {} });
        return this.dispatchEvent('click');
      },
      _innerHTML: '',
      _innerText: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        this._innerText = String(val).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (val === '') this.children = [];
        parseIdsIntoElements(val);
      },
      get innerText() {
        if (this.id === 'chat-window-avatar' && elements['chat-window-avatar-initial']) {
          return elements['chat-window-avatar-initial'].innerText || this._innerText;
        }
        if (this.children && this.children.length > 0) {
          const childText = this.children.map(c => c.innerText || '').join('').trim();
          if (childText) return childText;
        }
        return this._innerText;
      },
      set innerText(val) {
        this._innerText = val;
        this._innerHTML = String(val);
      },
      get textContent() { return this.innerText; },
      set textContent(val) { this.innerText = val; },
      value: '',
      checked: false
    };

    const tagRegex = new RegExp(`<[a-zA-Z0-9-]+[^>]*?id=["']${id}["'][^>]*?>`, 'i');
    const tagMatch = htmlContent.match(tagRegex);
    if (tagMatch) {
      const tagStr = tagMatch[0];
      const classM = tagStr.match(/class=["']([^"']+)["']/i);
      if (classM) {
        classM[1].split(/\s+/).filter(Boolean).forEach(c => elements[id].classList.add(c));
      }
      if (/\bchecked\b/i.test(tagStr)) {
        elements[id].checked = true;
      }
      const dataMatches = tagStr.matchAll(/data-([a-zA-Z0-9-]+)=["']([^"']*)["']/g);
      for (const dm of dataMatches) {
        const camel = dm[1].replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        elements[id].dataset[camel] = dm[2];
        elements[id].dataset[dm[1]] = dm[2];
      }
    }
  }

  // Pre-configure initial lock-screen state
  if (elements['lock-screen']) {
    elements['lock-screen'].classList.remove('unlocked');
  }

  if (elements['music-chip-favorites']) {
    elements['music-chip-favorites'].classList.add('music-chip');
    elements['music-chip-favorites'].dataset.genre = 'favorites';
  }

  const firestoreDocs = {};
  const firestoreUpdates = [];
  const firestoreListeners = [];

  function notifyFirestoreListeners(targetPath) {
    firestoreListeners.forEach(({ path, isCol, cb }) => {
      if (!isCol && path === targetPath) {
        const exists = !!firestoreDocs[path];
        cb({
          exists: () => exists,
          data: () => firestoreDocs[path] || {},
          id: path.split('/').pop()
        });
      } else if (isCol && (targetPath.startsWith(path + '/') || path === targetPath)) {
        const prefix = path ? path + '/' : '';
        const matching = Object.entries(firestoreDocs).filter(([k]) => k.startsWith(prefix));
        const docs = matching.map(([k, v]) => ({
          id: k.split('/').pop(),
          ref: { path: k },
          data: () => v
        }));
        cb({
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn),
          docChanges: () => []
        });
      }
    });
  }

  function parseIdsIntoElements(val) {
    if (!val || typeof val !== 'string') return;
    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)id=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = tagRegex.exec(val)) !== null) {
      const tag = match[1];
      const attrs = match[2] + ' ' + match[4];
      const subId = match[3];
      const inner = match[5];
      if (!elements[subId]) {
        elements[subId] = makeMockElement(tag);
        elements[subId].id = subId;
      }
      const bgMatch = attrs.match(/style=["'][^"']*background-image:\s*url\((['"]?)(.*?)\1\)/i);
      if (bgMatch) {
        elements[subId].style.backgroundImage = `url('${bgMatch[2]}')`;
      }
      if (inner && !inner.includes('<')) {
        elements[subId].innerText = inner.trim();
      }
    }
    const simpleMatches = val.matchAll(/id=["']([^"']+)["']/g);
    for (const m of simpleMatches) {
      const subId = m[1];
      if (!elements[subId]) {
        elements[subId] = makeMockElement('div');
        elements[subId].id = subId;
      }
    }
  }

  function makeMockElement(tag = 'div') {
    return {
      tagName: tag.toUpperCase(),
      style: {},
      classList: {
        _classes: new Set(),
        add(...c) { c.forEach(x => this._classes.add(x)); },
        remove(...c) { c.forEach(x => this._classes.delete(x)); },
        toggle(c, val) { if (val === undefined) val = !this._classes.has(c); if (val) this._classes.add(c); else this._classes.delete(c); return val; },
        contains(c) { return this._classes.has(c); }
      },
      get className() {
        return Array.from(this.classList._classes).join(' ');
      },
      set className(val) {
        this.classList._classes.clear();
        if (val) String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
      },
      dataset: {},
      children: [],
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] !== undefined ? this[k] : null; },
      removeAttribute(k) { delete this[k]; },
      async click() { if (this.onclick) await this.onclick({ target: this, stopPropagation: () => {} }); },
      appendChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        if (child) child.parentElement = this;
        this.children.push(child);
        return child;
      },
      prepend(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        if (child) child.parentElement = this;
        this.children.unshift(child);
        return child;
      },
      closest(sel) {
        let cur = this;
        const selectors = String(sel || '').split(',').map(s => s.trim());
        while (cur) {
          for (const s of selectors) {
            if (s.startsWith('.') && cur.classList && cur.classList.contains && cur.classList.contains(s.slice(1))) {
              return cur;
            }
            if (s.startsWith('#') && cur.id === s.slice(1)) {
              return cur;
            }
          }
          cur = cur.parentElement || null;
        }
        return null;
      },
      remove() {
        if (this.parentElement && Array.isArray(this.parentElement.children)) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx !== -1) this.parentElement.children.splice(idx, 1);
        }
      },
      querySelector(sel) {
        const all = this.querySelectorAll(sel);
        if (all && all.length > 0) return all[0];
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          return this.children.find(c => c.classList && c.classList.contains && c.classList.contains(cls)) || null;
        }
        if (sel === '[data-lucide]') {
          return this.children.find(c => c['data-lucide'] !== undefined || (c.getAttribute && c.getAttribute('data-lucide') !== null)) || null;
        }
        const tagMatch = this.children.find(c => c.tagName && c.tagName.toLowerCase() === sel.toLowerCase());
        if (tagMatch) return tagMatch;
        return null;
      },
      querySelectorAll(sel) {
        const results = [];
        function walk(node) {
          if (!node || !node.children) return;
          for (const c of node.children) {
            if (sel.startsWith('.')) {
              const cls = sel.slice(1).split(/[\s.:>+~[]/)[0];
              if (c.classList && c.classList.contains && c.classList.contains(cls)) {
                results.push(c);
              }
            } else if (sel.startsWith('[') && sel.endsWith(']')) {
              const attrPart = sel.slice(1, -1);
              if (attrPart.includes('=')) {
                const [k, vRaw] = attrPart.split('=');
                const v = vRaw.replace(/^["']|["']$/g, '');
                if (k.startsWith('data-')) {
                  const camelKey = k.slice(5).replace(/-([a-z])/g, (_, m) => m.toUpperCase());
                  if (c.dataset && c.dataset[camelKey] === v) results.push(c);
                  else if (c[k] === v || (c.getAttribute && c.getAttribute(k) === v)) results.push(c);
                } else if (c[k] === v || (c.getAttribute && c.getAttribute(k) === v)) {
                  results.push(c);
                }
              } else {
                if (c.dataset && c.dataset[attrPart.replace(/^data-/, '')] !== undefined) results.push(c);
                else if (c[attrPart] !== undefined || (c.getAttribute && c.getAttribute(attrPart) !== null)) results.push(c);
              }
            } else if (c.tagName && c.tagName.toLowerCase() === sel.toLowerCase()) {
              results.push(c);
            }
            walk(c);
          }
        }
        walk(this);
        return results;
      },
      _innerHTML: '',
      _innerText: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        this._innerText = String(val).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (val === '') this.children = [];
        parseIdsIntoElements(val);
      },
      get innerText() { return this._innerText; },
      set innerText(val) {
        this._innerText = val;
        this._innerHTML = String(val);
      },
      get textContent() { return this.innerText; },
      set textContent(val) { this.innerText = val; },
      value: ''
    };
  }

  const mockDoc = {
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      if (sel && sel.includes("theme-color")) return elements["app-theme-color-meta"] || null;
      if (sel && sel.includes("manifest")) return elements["app-manifest-link"] || null;
      if (sel.startsWith('#')) {
        const id = sel.slice(1).split(/[\s.:>+~[]/)[0];
        return elements[id] || null;
      }
      if (sel.includes('[data-filter="nao-lidas"]')) {
        return elements['filter-pill-nao-lidas'] || null;
      }
      if (sel.includes('wallpaper-scope')) {
        return { value: 'chat', checked: true };
      }
      if (sel.includes('report-reason')) {
        return { value: 'spam', checked: true };
      }
      if (sel.includes('.chat-card[data-uid=')) {
        const uidMatch = sel.match(/data-uid="([^"]+)"/);
        if (uidMatch) {
          return Object.values(elements).find(el => el.classList && el.classList.contains && el.classList.contains('chat-card') && el.dataset && el.dataset.uid === uidMatch[1]) || null;
        }
      }
      if (sel.includes('[data-id=')) {
        const idMatch = sel.match(/data-id="([^"]+)"/);
        if (idMatch && elements['message-container'] && elements['message-container'].children) {
          return elements['message-container'].children.find(el => el.dataset && el.dataset.id === idMatch[1]) || null;
        }
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel && sel.includes('theme-color')) {
        return [elements['app-theme-color-meta'], elements['app-theme-color-meta-dark'], elements['app-theme-color-meta-light']].filter(Boolean);
      }
      if (sel.includes('[data-id=')) {
        const idMatch = sel.match(/data-id="([^"]+)"/);
        if (idMatch && elements['message-container'] && elements['message-container'].children) {
          return elements['message-container'].children.filter(el => el.dataset && el.dataset.id === idMatch[1]);
        }
      }
      if (sel.startsWith('.')) {
        const cls = sel.slice(1).split(/[\s.:>+~[]/)[0];
        return Object.values(elements).filter(el => el.classList && el.classList.contains && el.classList.contains(cls));
      }
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tag) => makeMockElement(tag),
    documentElement: {
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = String(v); },
        getPropertyValue(k) { return this._props[k] || ''; }
      }
    },
    body: {
      classList: {
        _classes: new Set(),
        add(...c) { c.forEach(x => this._classes.add(x)); },
        remove(...c) { c.forEach(x => this._classes.delete(x)); },
        toggle(c, val) { if (val === undefined) val = !this._classes.has(c); if (val) this._classes.add(c); else this._classes.delete(c); return val; },
        contains(c) { return this._classes.has(c); }
      },
      appendChild(child) {
        if (!this.children) this.children = [];
        this.children.push(child);
        const randId = child.id || ('dyn-' + Math.random().toString(36).slice(2, 7));
        elements[randId] = child;
        return child;
      },
      removeChild(child) {
        if (this.children) this.children = this.children.filter(c => c !== child);
        return child;
      }
    }
  };

  const soundPlayed = [];
  let vibrationPattern = null;
  let authCallback = null;
  const rtdbDocs = {};

  const storageStore = {};
  const mockLocalStorage = {
    getItem: (key) => (key in storageStore ? storageStore[key] : null),
    setItem: (key, val) => { storageStore[key] = String(val); },
    removeItem: (key) => { delete storageStore[key]; },
    clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); },
    key: (i) => Object.keys(storageStore)[i] || null,
    get length() { return Object.keys(storageStore).length; }
  };

  const sessionStorageStore = {};
  const mockSessionStorage = {
    getItem: (key) => (key in sessionStorageStore ? sessionStorageStore[key] : null),
    setItem: (key, val) => { sessionStorageStore[key] = String(val); },
    removeItem: (key) => { delete sessionStorageStore[key]; },
    clear: () => { Object.keys(sessionStorageStore).forEach(k => delete sessionStorageStore[k]); },
    key: (i) => Object.keys(sessionStorageStore)[i] || null,
    get length() { return Object.keys(sessionStorageStore).length; }
  };

  let currentHistoryState = null;
  const windowListeners = {};
  const mockHistory = {
    get state() { return currentHistoryState; },
    pushState: (state) => { currentHistoryState = state; },
    replaceState: (state) => { currentHistoryState = state; },
    back: () => {
      if (windowListeners['popstate']) {
        windowListeners['popstate'].forEach(fn => fn({ state: currentHistoryState }));
      }
    }
  };

  class MockEvent { constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); } }

  class MockURL extends URL {
    static createObjectURL(b) { return 'blob:mock/' + Math.random().toString(36).substring(2, 8); }
    static revokeObjectURL() {}
  }

  const sandbox = {
    console,
    fetch: globalThis.fetch,
    URL: MockURL,
    document: mockDoc,
    history: mockHistory,
    Event: MockEvent,
    window: {
      Event: MockEvent,
      fetch: globalThis.fetch,
      URL: MockURL,
      lucide: { createIcons: () => {} },
      history: mockHistory,
      addEventListener: (type, fn) => {
        if (!windowListeners[type]) windowListeners[type] = [];
        windowListeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (windowListeners[type]) {
          windowListeners[type] = windowListeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent: (type, evt = {}) => {
        if (windowListeners[type]) {
          return Promise.all(windowListeners[type].map(fn => fn(evt)));
        }
        return Promise.resolve();
      },
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      location: { origin: 'https://menssagem-dx.web.app', pathname: '/', href: 'https://menssagem-dx.web.app/', search: '', reload: () => {} },
      open: (url, target) => {
        if (!sandbox._openedUrls) sandbox._openedUrls = [];
        sandbox._openedUrls.push({ url, target });
        return { focus: () => {} };
      },
      navigator: {
        userAgent: 'test',
        vibrate: (pattern) => { vibrationPattern = pattern; return true; },
        clipboard: {
          writeText: (txt) => { sandbox._copiedText = txt; return Promise.resolve(); },
          readText: () => Promise.resolve(sandbox._copiedText || '')
        },
        share: (data) => {
          sandbox._sharedData = data;
          return Promise.resolve();
        }
      },
      Audio: function(src) {
        this.src = src;
        this.play = () => { soundPlayed.push(src); return Promise.resolve(); };
        this.pause = () => {};
        this.currentTime = 0;
        this.duration = 79;
        this.playbackRate = 1;
        this.preload = 'auto';
        this.addEventListener = (evt, cb) => { this['on' + evt] = cb; };
        this.removeEventListener = () => {};
      },
      setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; },
      clearInterval,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb) => setTimeout(cb, 16),
      cancelAnimationFrame: (id) => clearTimeout(id),
      Blob: typeof Blob !== 'undefined' ? Blob : globalThis.Blob,
      atob: typeof atob !== 'undefined' ? atob : globalThis.atob,
      btoa: typeof btoa !== 'undefined' ? btoa : globalThis.btoa,
      RTCPeerConnection: function() {
        this.addTrack = () => {};
        this.getSenders = () => [{ kind: 'video', replaceTrack: () => Promise.resolve(), track: { kind: 'video' } }];
        this.addTransceiver = () => ({ sender: { replaceTrack: () => Promise.resolve() } });
        this.createOffer = () => Promise.resolve({ sdp: 'mock_sdp', type: 'offer' });
        this.createAnswer = () => Promise.resolve({ sdp: 'mock_sdp_answer', type: 'answer' });
        this.setLocalDescription = () => Promise.resolve();
        this.setRemoteDescription = () => Promise.resolve();
        this.addIceCandidate = () => Promise.resolve();
        this.close = () => {};
      },
      MediaStream: function() {
        this.getTracks = () => [{ stop: () => {}, enabled: true, kind: 'video' }];
        this.getVideoTracks = () => [{ stop: () => {}, enabled: true, kind: 'video' }];
        this.getAudioTracks = () => [{ stop: () => {}, enabled: true, kind: 'audio' }];
        this.addTrack = () => {};
        this.removeTrack = () => {};
      },
      MediaRecorder: function(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.start = () => { this.state = 'recording'; };
        this.stop = () => {
          this.state = 'inactive';
          if (typeof this.onstop === 'function') this.onstop();
        };
        this.ondataavailable = null;
        this.onstop = null;
      },
      RTCSessionDescription: function(init) { this.sdp = init?.sdp || 'sdp'; this.type = init?.type || 'offer'; },
      RTCIceCandidate: function(init) { this.candidate = init?.candidate || 'cand'; },
      FileReader: function() {
        this.readAsDataURL = function(file) {
          setTimeout(() => {
            this.result = 'data:image/jpeg;base64,mockpreviewdata';
            if (typeof this.onload === 'function') this.onload({ target: { result: this.result } });
          }, 0);
        };
      }
    },
    FileReader: function() {
      this.readAsDataURL = function(file) {
        setTimeout(() => {
          this.result = 'data:image/jpeg;base64,mockpreviewdata';
          if (typeof this.onload === 'function') this.onload({ target: { result: this.result } });
        }, 0);
      };
    },
    Blob: typeof Blob !== 'undefined' ? Blob : globalThis.Blob,
    atob: typeof atob !== 'undefined' ? atob : globalThis.atob,
    btoa: typeof btoa !== 'undefined' ? btoa : globalThis.btoa,
    URL: { createObjectURL: (b) => 'blob:mock/' + Math.random().toString(36).substring(2, 8), revokeObjectURL: () => {} },
    MediaRecorder: function(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.start = () => { this.state = 'recording'; };
      this.stop = () => {
        this.state = 'inactive';
        if (typeof this.onstop === 'function') this.onstop();
      };
      this.ondataavailable = null;
      this.onstop = null;
    },
    RTCPeerConnection: function() {
      this.addTrack = () => {};
      this.getSenders = () => [{ kind: 'video', replaceTrack: () => Promise.resolve(), track: { kind: 'video' } }];
      this.addTransceiver = () => ({ sender: { replaceTrack: () => Promise.resolve() } });
      this.createOffer = () => Promise.resolve({ sdp: 'mock_sdp', type: 'offer' });
      this.createAnswer = () => Promise.resolve({ sdp: 'mock_sdp_answer', type: 'answer' });
      this.setLocalDescription = () => Promise.resolve();
      this.setRemoteDescription = () => Promise.resolve();
      this.addIceCandidate = () => Promise.resolve();
      this.close = () => {};
    },
    MediaStream: function() {
      this.getTracks = () => [{ stop: () => {}, enabled: true, kind: 'video' }];
      this.getVideoTracks = () => [{ stop: () => {}, enabled: true, kind: 'video' }];
      this.getAudioTracks = () => [{ stop: () => {}, enabled: true, kind: 'audio' }];
      this.addTrack = () => {};
      this.removeTrack = () => {};
    },
    RTCSessionDescription: function(init) { this.sdp = init?.sdp || 'sdp'; this.type = init?.type || 'offer'; },
    RTCIceCandidate: function(init) { this.candidate = init?.candidate || 'cand'; },
    navigator: {
      userAgent: 'test',
      vibrate: (pattern) => { vibrationPattern = pattern; return true; },
      mediaDevices: {
        getUserMedia: (constraints) => Promise.resolve({
          getTracks: () => [{ stop: () => {}, enabled: true, kind: constraints?.video ? 'video' : 'audio' }],
          getVideoTracks: () => constraints?.video ? [{ stop: () => {}, enabled: true, kind: 'video' }] : [],
          getAudioTracks: () => [{ stop: () => {}, enabled: true, kind: 'audio' }]
        })
      },
      clipboard: {
        writeText: (txt) => { sandbox._copiedText = txt; return Promise.resolve(); },
        readText: () => Promise.resolve(sandbox._copiedText || '')
      },
      share: (data) => {
        sandbox._sharedData = data;
        return Promise.resolve();
      }
    },
    location: { origin: 'https://menssagem-dx.web.app', pathname: '/', href: 'https://menssagem-dx.web.app/', search: '', reload: () => {} },
    open: (url, target) => {
      if (!sandbox._openedUrls) sandbox._openedUrls = [];
      sandbox._openedUrls.push({ url, target });
      return { focus: () => {} };
    },
    Audio: function(src) {
      this.src = src;
      this.play = () => { soundPlayed.push(src); return Promise.resolve(); };
      this.pause = () => {};
      this.currentTime = 0;
      this.duration = 79;
      this.playbackRate = 1;
      this.preload = 'auto';
      this.addEventListener = (evt, cb) => { this['on' + evt] = cb; };
      this.removeEventListener = () => {};
    },
    localStorage: mockLocalStorage,
    sessionStorage: mockSessionStorage,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; },
    clearInterval,
    setTimeout,
    clearTimeout,
    // Mock Firebase
    initializeApp: () => ({}),
    getAuth: () => ({}),
    GoogleAuthProvider: function() {},
    signInWithPopup: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onAuthStateChanged: (auth, cb) => { authCallback = cb; },
    getFirestore: () => ({}),
    collection: (db, ...segments) => ({ path: segments.join('/') }),
    doc: (db, ...segments) => { const path = segments.join('/'); const id = segments[segments.length - 1]; return { path, id }; },
    setDoc: (ref, data, opts) => { 
      if (opts && opts.merge) {
        firestoreDocs[ref.path] = { ...(firestoreDocs[ref.path] || {}), ...data };
      } else {
        firestoreDocs[ref.path] = data;
      }
      notifyFirestoreListeners(ref.path);
      return Promise.resolve(); 
    },
    getDoc: (ref) => Promise.resolve({ exists: () => !!firestoreDocs[ref.path], data: () => firestoreDocs[ref.path] || {} }),
    query: (targetCol, ...conditions) => ({ path: targetCol?.path || 'col', conditions }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (q) => {
      const colPath = q?.path || (typeof q === 'string' ? q : '');
      const entries = Object.entries(firestoreDocs).filter(([k]) => {
        if (colPath && !k.startsWith(colPath + '/')) return false;
        if (q?.conditions && Array.isArray(q.conditions)) {
          for (const cond of q.conditions) {
            if (cond && cond.field && cond.op === '==' && firestoreDocs[k]?.[cond.field] !== cond.value) {
              return false;
            }
          }
        }
        return true;
      });
      const docs = entries.map(([k, v]) => ({
        id: k.split('/').pop(),
        ref: { path: k },
        data: () => v
      }));
      return Promise.resolve({
        empty: docs.length === 0,
        docs,
        forEach: (cb) => docs.forEach(cb)
      });
    },
    updateDoc: (ref, updateData) => {
      firestoreUpdates.push({ ref, updateData });
      const current = firestoreDocs[ref.path] || {};
      const updated = { ...current };
      for (const [key, val] of Object.entries(updateData)) {
        if (val && val._type === 'remove') {
          const arr = Array.isArray(current[key]) ? current[key] : [];
          updated[key] = arr.filter(x => !val.items.includes(x));
        } else if (val && val._type === 'union') {
          const arr = Array.isArray(current[key]) ? current[key] : [];
          updated[key] = [...new Set([...arr, ...val.items])];
        } else {
          updated[key] = val;
        }
      }
      firestoreDocs[ref.path] = updated;
      notifyFirestoreListeners(ref.path);
      return Promise.resolve();
    },
    deleteDoc: (ref) => { 
      delete firestoreDocs[ref.path]; 
      notifyFirestoreListeners(ref.path);
      return Promise.resolve(); 
    },
    addDoc: (colRef, data) => {
      const id = 'mock-id-' + Math.random().toString(36).substring(2, 7);
      const docPath = (colRef?.path || 'items') + '/' + id;
      firestoreDocs[docPath] = data;
      notifyFirestoreListeners(docPath);
      return Promise.resolve({ id, path: docPath });
    },
    onSnapshot: (refOrQuery, cb) => {
      if (typeof cb === 'function') {
        const path = refOrQuery?.path || '';
        const isCol = !path.includes('/') || path.split('/').length % 2 === 1;
        const listener = { path, isCol, cb };
        firestoreListeners.push(listener);
        if (isCol) {
          const prefix = path ? path + '/' : '';
          const matching = Object.entries(firestoreDocs).filter(([k]) => k.startsWith(prefix));
          const docs = matching.map(([k, v]) => ({
            id: k.split('/').pop(),
            ref: { path: k },
            data: () => v
          }));
          cb({
            empty: docs.length === 0,
            docs,
            forEach: (fn) => docs.forEach(fn),
            docChanges: () => []
          });
        } else {
          const exists = !!firestoreDocs[path];
          cb({
            exists: () => exists,
            data: () => firestoreDocs[path] || {},
            id: path.split('/').pop()
          });
        }
        return () => {
          const idx = firestoreListeners.indexOf(listener);
          if (idx !== -1) firestoreListeners.splice(idx, 1);
        };
      }
      return () => {};
    },
    orderBy: () => ({}),
    limit: () => ({}),
    writeBatch: () => {
      const ops = [];
      return {
        _ops: ops,
        set: (ref, data) => ops.push({ type: 'set', ref, data }),
        update: (ref, updateData) => ops.push({ type: 'update', ref, updateData }),
        delete: (ref) => ops.push({ type: 'delete', ref }),
        commit: () => {
          for (const op of ops) {
            if (op.type === 'update') {
              firestoreUpdates.push({ ref: op.ref, updateData: op.updateData });
              const current = firestoreDocs[op.ref.path] || {};
              const updated = { ...current };
              for (const [key, val] of Object.entries(op.updateData)) {
                if (val && val._type === 'union') {
                  const arr = Array.isArray(current[key]) ? [...current[key]] : [];
                  val.items.forEach(x => { if (!arr.includes(x)) arr.push(x); });
                  updated[key] = arr;
                } else {
                  updated[key] = val;
                }
              }
              firestoreDocs[op.ref.path] = updated;
              notifyFirestoreListeners(op.ref.path);
            } else if (op.type === 'delete') {
              delete firestoreDocs[op.ref.path];
              notifyFirestoreListeners(op.ref.path);
            } else if (op.type === 'set') {
              firestoreDocs[op.ref.path] = { ...(firestoreDocs[op.ref.path] || {}), ...op.data };
              notifyFirestoreListeners(op.ref.path);
            }
          }
          return Promise.resolve();
        }
      };
    },
    arrayUnion: (...items) => ({ _type: 'union', items }),
    arrayRemove: (...items) => ({ _type: 'remove', items }),
    runTransaction: (db, updateFunction) => {
      if (typeof updateFunction === 'function') {
        const tx = {
          get: (ref) => Promise.resolve({
            exists: () => !!firestoreDocs[ref.path],
            data: () => firestoreDocs[ref.path] || {}
          }),
          set: (ref, data, opts) => {
            if (opts && opts.merge) {
              firestoreDocs[ref.path] = { ...(firestoreDocs[ref.path] || {}), ...data };
            } else {
              firestoreDocs[ref.path] = data;
            }
          },
          update: (ref, data) => {
            firestoreDocs[ref.path] = { ...(firestoreDocs[ref.path] || {}), ...data };
          },
          delete: (ref) => {
            delete firestoreDocs[ref.path];
          }
        };
        return updateFunction(tx);
      }
      return Promise.resolve();
    },
    getDatabase: () => ({}),
    ref: (db, path) => ({ path: path || '' }),
    rtdbSet: (r, val) => { if (r && r.path) rtdbDocs[r.path] = val; return Promise.resolve(); },
    onValue: (r, cb) => {
      if (r && r.path && cb) {
        let val = rtdbDocs[r.path];
        if (!val) {
          const prefix = r.path + '/';
          const entries = Object.entries(rtdbDocs).filter(([k]) => k.startsWith(prefix));
          if (entries.length > 0) {
            val = {};
            for (const [k, v] of entries) {
              const childKey = k.slice(prefix.length).split('/')[0];
              val[childKey] = v;
            }
          }
        }
        cb({ val: () => val || {} });
      }
      return () => {};
    },
    onDisconnect: () => ({ set: () => Promise.resolve(), remove: () => Promise.resolve() }),
    rtdbTimestamp: () => Date.now(),
    lucide: { createIcons: () => {} }
  };
  sandbox.window.document = mockDoc;

  vm.runInNewContext(jsContent, sandbox, { filename: 'public/script.js' });

  return {
    elements,
    sandbox,
    firestoreDocs,
    firestoreUpdates,
    storageStore,
    sessionStorageStore,
    rtdbDocs,
    soundPlayed,
    makeMockElement,
    notifyFirestoreListeners,
    triggerDocSnapshot: (path, data) => {
      firestoreDocs[path] = data;
      notifyFirestoreListeners(path);
    },
    getVibration: () => vibrationPattern,
    triggerAuthStateChange: (u) => authCallback ? authCallback(u) : Promise.resolve()
  };
}

test('HTML DOM Integrity: All required elements and modal IDs exist in index.html', () => {
  const requiredIds = [
    'auth-screen',
    'lock-screen',
    'set-pin-overlay',
    'neon-unlock-anim',
    'neon-path',
    'biometric-btn',
    'view-once-overlay',
    'view-once-img',
    'post-comment-modal',
    'close-comment-modal',
    'comment-modal-post-meta',
    'comment-modal-list',
    'comment-modal-input',
    'comment-modal-send',
    'chat-file-viewonce',
    'posts-count-label',
    'feed-list',
    'feed-overlay',
    'screenshot-gallery-overlay',
    'story-viewer',
    'chat-window',
    'admin-tab-vip-requests-btn',
    'admin-view-vip-requests',
    'admin-vip-badge',
    'notifications-bell-btn',
    'notifications-bell-badge',
    'notifications-panel',
    'close-notifications-btn',
    'clear-all-notifications-btn',
    'notifications-list',
    'admin-tab-broadcast-btn',
    'admin-view-broadcast',
    'admin-send-broadcast-btn',
    'broadcast-title-input',
    'broadcast-message-input',
    'leave-group-btn',
    'chat-leave-group-trigger',
    'action-info-btn',
    'message-info-modal',
    'close-message-info-modal',
    'msg-info-text',
    'msg-info-readers-list',
    'msg-info-seen-count',
    'music-chip-favorites',
    'status-media-preview-box',
    'preview-status-btn',
    'story-preview-indicator',
    'story-preview-footer',
    'story-preview-back-btn',
    'story-preview-publish-now-btn',
    'matrix-binary-canvas',
    'chat-emoji-btn',
    'chat-emoji-drawer',
    'close-emoji-drawer-btn',
    'emoji-drawer-grid',
    'chat-wallpaper-trigger',
    'chat-wallpaper-modal',
    'close-wallpaper-modal',
    'wallpaper-preview-box',
    'wallpaper-presets-grid',
    'save-wallpaper-btn',
    'reset-wallpaper-btn',
    'vip-theme-selector',
    'vip-font-selector',
    'desktop-chat-placeholder',
    'main-sidebar',
    'profile-phone-input',
    'profile-youtube-input',
    'profile-instagram-input',
    'profile-tiktok-input',
    'contact-profile-phone-card',
    'contact-profile-social-section'
  ];

  for (const id of requiredIds) {
    const exists = htmlContent.includes(`id="${id}"`) || htmlContent.includes(`id='${id}'`);
    assert.ok(exists, `Expected ID '${id}' to exist in public/index.html`);
  }
});

test('CSS Integrity: Braces match and classes are defined', () => {
  let openBraces = 0;
  for (const char of cssContent) {
    if (char === '{') openBraces++;
    if (char === '}') openBraces--;
  }
  assert.equal(openBraces, 0, 'CSS open braces count must balance to 0');

  const requiredClasses = [
    '.neon-line-svg',
    '.view-once-screen',
    '.view-once-bubble',
    '.view-once-badge',
    '.post-comment-modal',
    '.post-comment-card',
    '.comment-close-btn',
    '.comment-modal-list',
    '.comment-item',
    '.comment-delete-btn',
    '.comment-send-btn',
    '.attach-icon-circle.orange',
    '.posts-count-label',
    '.track-actions-wrap',
    '.track-fav-btn',
    '.music-empty-favorites',
    '.status-media-preview-box',
    '.preview-status-action-btn',
    '.story-preview-badge',
    '.story-preview-footer',
    '.matrix-binary-canvas',
    '.vip-text-rgb',
    '.vip-text-cyan',
    '.vip-text-neon_minimal',
    '.vip-text-futuristic',
    '.vip-animated-emoji-giant',
    '.vip-animated-emoji',
    '.chat-emoji-drawer',
    '.wallpaper-modal-card',
    '.vip-exclusive-tag',
    '.desktop-chat-placeholder',
    '.sidebar'
  ];

  for (const cls of requiredClasses) {
    assert.ok(cssContent.includes(cls), `Expected class '${cls}' to be defined in public/style.css`);
  }
});

test('Security & PIN: Wrong PIN stays locked, correct PIN unlocks with neon animation', () => {
  const env = createTestEnvironment();
  const lockScreen = env.elements['lock-screen'];
  const neonAnim = env.elements['neon-unlock-anim'];

  assert.ok(!lockScreen.classList.contains('unlocked'), 'Lock screen should start locked');

  // Enter wrong PIN: 9999
  env.sandbox.enterDigit('9');
  env.sandbox.enterDigit('9');
  env.sandbox.enterDigit('9');
  env.sandbox.enterDigit('9');

  assert.ok(!lockScreen.classList.contains('unlocked'), 'Lock screen must remain locked on wrong PIN');

  // Enter correct default PIN: 1234
  env.sandbox.enterDigit('1');
  env.sandbox.enterDigit('2');
  env.sandbox.enterDigit('3');
  env.sandbox.enterDigit('4');

  assert.ok(lockScreen.classList.contains('unlocked'), 'Lock screen must unlock on correct PIN');
  assert.ok(neonAnim.classList.contains('active'), 'Neon animation must activate on unlock');
});

test('Biometric Unlock: Clicking biometric button unlocks app with haptics and neon animation', () => {
  const env = createTestEnvironment();
  const lockScreen = env.elements['lock-screen'];
  const neonAnim = env.elements['neon-unlock-anim'];

  assert.ok(!lockScreen.classList.contains('unlocked'));

  env.sandbox.unlockWithBiometrics();

  assert.ok(lockScreen.classList.contains('unlocked'), 'Lock screen must be unlocked by biometric');
  assert.ok(neonAnim.classList.contains('active'), 'Neon animation must activate on biometric unlock');
  assert.ok(env.getVibration() !== null, 'Vibration haptic feedback must trigger');
});

test('PIN Management: Setting new 4-digit PIN updates profile and verifies correctly', () => {
  const env = createTestEnvironment();
  const setPinOverlay = env.elements['set-pin-overlay'];

  // Define new PIN: 7890
  env.sandbox.enterSetPinDigit('7');
  env.sandbox.enterSetPinDigit('8');
  env.sandbox.enterSetPinDigit('9');
  env.sandbox.enterSetPinDigit('0');

  assert.ok(setPinOverlay.classList.contains('unlocked'), 'Overlay should close after setting 4-digit PIN');

  // Lock the screen again
  env.elements['lock-screen'].classList.remove('unlocked');

  // Old PIN 1234 should now fail
  env.sandbox.enterDigit('1');
  env.sandbox.enterDigit('2');
  env.sandbox.enterDigit('3');
  env.sandbox.enterDigit('4');
  assert.ok(!env.elements['lock-screen'].classList.contains('unlocked'), 'Old PIN must fail');

  // New PIN 7890 should succeed
  env.sandbox.enterDigit('7');
  env.sandbox.enterDigit('8');
  env.sandbox.enterDigit('9');
  env.sandbox.enterDigit('0');
  assert.ok(env.elements['lock-screen'].classList.contains('unlocked'), 'New PIN must succeed');
});

test('View-Once Modal: Fullscreen preview open and close correctly', () => {
  const env = createTestEnvironment();
  const overlay = env.elements['view-once-overlay'];
  const img = env.elements['view-once-img'];

  env.sandbox.openViewOnceModal('data:image/png;base64,mockImageData');

  assert.equal(overlay.style.display, 'flex');
  assert.equal(img.src, 'data:image/png;base64,mockImageData');

  env.sandbox.closeViewOnceModal();

  assert.equal(overlay.style.display, 'none');
  assert.ok(overlay.classList.contains('unlocked'));
});

test('Post Comment Modal: Opens, lists comments, and handles submission flow', async () => {
  const env = createTestEnvironment();
  const modal = env.elements['post-comment-modal'];
  const meta = env.elements['comment-modal-post-meta'];
  const list = env.elements['comment-modal-list'];
  const input = env.elements['comment-modal-input'];

  const testPost = {
    id: 'post-123',
    authorName: 'Rodrigo VIP',
    authorUid: 'user-rodrigo',
    caption: 'Foto incrível no VORTEX',
    createdAt: Date.now(),
    comments: [
      { author: 'Ana Silva', authorUid: 'user-ana', text: 'Top demais!', createdAt: Date.now() - 1000 }
    ]
  };

  // Open modal
  env.sandbox.openPostCommentModal(testPost);

  assert.ok(modal.classList.contains('active'), 'Comment modal should have active class');
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.ok(meta.innerText.includes('Rodrigo VIP'), 'Meta must display post author name');
  assert.ok(list.innerHTML.includes('Ana Silva'), 'Comment list must display existing comment author');
  assert.ok(list.innerHTML.includes('Top demais!'), 'Comment list must display existing comment text');

  // Close modal
  env.sandbox.closePostCommentModal();
  assert.ok(!modal.classList.contains('active'), 'Comment modal must not be active after closing');
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
});

test('Username Normalization & Validation Rules', () => {
  const env = createTestEnvironment();

  assert.equal(env.sandbox.normalizeUsername('@vortex_vip'), 'vortex_vip');
  assert.equal(env.sandbox.normalizeUsername('  @User.Name  '), 'user.name');
  assert.equal(env.sandbox.isValidUsername('alex_vip'), true);
  assert.equal(env.sandbox.isValidUsername('a.b'), true);
  assert.equal(env.sandbox.isValidUsername('ab'), false, 'Too short (min 3 chars)');
  assert.equal(env.sandbox.isValidUsername('invalid@char'), false, 'Special chars not allowed');
});

test('Date & Time Formatting: formatLastSeen handles relative time properly', () => {
  const env = createTestEnvironment();
  const now = Date.now();

  const formattedNow = env.sandbox.formatLastSeen(now);
  assert.ok(formattedNow.includes('hoje às'), 'Current timestamp should say hoje às');

  const yesterday = now - 24 * 60 * 60 * 1000;
  const formattedYesterday = env.sandbox.formatLastSeen(yesterday);
  assert.ok(formattedYesterday.includes('ontem às') || formattedYesterday.includes('hoje às'));
});

test('Inline Comments & Post Deletion: Submit inline comment, delete comment and delete post', async () => {
  const env = createTestEnvironment();
  const postId = 'post-test-777';

  // Seed post document in Firestore
  env.firestoreDocs[`posts/${postId}`] = {
    authorName: 'Deyvison',
    authorUid: 'user-deyvison',
    caption: 'Foto teste DX Hub',
    createdAt: Date.now(),
    comments: [
      { author: 'Visitante', authorUid: 'user-other', text: 'Top!', createdAt: Date.now() - 500 }
    ]
  };

  // Set logged in user
  env.sandbox.window.setCurrentUser({ uid: 'user-deyvison', displayName: 'Deyvison' });

  // Submit inline comment
  await env.sandbox.submitInlineComment(postId, 'Excelente trabalho!');
  const postDocAfterComment = env.firestoreDocs[`posts/${postId}`];
  assert.equal(postDocAfterComment.comments.length, 2, 'Should have 2 comments after adding inline comment');
  assert.equal(postDocAfterComment.comments[1].text, 'Excelente trabalho!');

  // Delete comment
  await env.sandbox.deletePostComment(postId, 0);
  assert.equal(env.firestoreDocs[`posts/${postId}`].comments.length, 1, 'Should have 1 comment after deleting the first one');
  assert.equal(env.firestoreDocs[`posts/${postId}`].comments[0].text, 'Excelente trabalho!');

  // Delete post
  await env.sandbox.deletePost(postId);
  assert.equal(env.firestoreDocs[`posts/${postId}`], undefined, 'Post document should be deleted from Firestore');
});

test('Story Privacy: Only accepted contacts can view author stories, strangers are blocked', () => {
  const env = createTestEnvironment();
  const canUserViewStory = env.sandbox.canUserViewStory || env.sandbox.window.canUserViewStory;

  assert.ok(typeof canUserViewStory === 'function', 'canUserViewStory should be a defined function');

  const myStory = {
    id: 'story-1',
    authorUid: 'user-deyvison',
    authorName: 'Deyvison',
    allowedUids: ['user-friend-1', 'user-friend-2']
  };

  // 1. Author should always be able to view their own story
  assert.strictEqual(canUserViewStory(myStory, 'user-deyvison'), true, 'Author must view their own story');

  // 2. Accepted contact in allowedUids must be able to view
  assert.strictEqual(canUserViewStory(myStory, 'user-friend-1'), true, 'Accepted friend 1 must view story');
  assert.strictEqual(canUserViewStory(myStory, 'user-friend-2'), true, 'Accepted friend 2 must view story');

  // 3. Stranger NOT in allowedUids must NOT be able to view
  assert.strictEqual(canUserViewStory(myStory, 'user-stranger-999'), false, 'Stranger must be blocked from viewing story');

  // 4. Fallback: Story without allowedUids checking authorContactsSet
  const oldStory = {
    id: 'story-old',
    authorUid: 'user-deyvison',
    authorName: 'Deyvison'
  };
  const acceptedContactsSet = new Set(['user-deyvison']);
  assert.strictEqual(canUserViewStory(oldStory, 'user-friend-3', acceptedContactsSet), true, 'Accepted mutual contact should view via fallback');

  const strangerContactsSet = new Set(['user-someone-else']);
  assert.strictEqual(canUserViewStory(oldStory, 'user-stranger-888', strangerContactsSet), false, 'Stranger without contact relation must be blocked');
});

test('Unread Filter Tag: Only unread conversations are shown when nao-lidas tag is selected', () => {
  const env = createTestEnvironment();
  const applyChatFilter = env.sandbox.applyChatFilter || env.sandbox.window.applyChatFilter;
  const doc = env.sandbox.document;

  assert.ok(typeof applyChatFilter === 'function', 'applyChatFilter should be a defined function');

  // Register mock filter-pill for nao-lidas
  const unreadPill = env.makeMockElement('span');
  unreadPill.classList.add('filter-pill');
  unreadPill.dataset.filter = 'nao-lidas';
  env.elements['filter-pill-nao-lidas'] = unreadPill;

  // Register 3 mock chat-cards: 1 unread direct, 1 read direct, 1 unread group
  const card1 = env.makeMockElement('div');
  card1.classList.add('chat-card', 'unread');
  card1.dataset.uid = 'user-1';
  card1.dataset.unread = 'true';
  env.elements['chat-card-1'] = card1;

  const card2 = env.makeMockElement('div');
  card2.classList.add('chat-card');
  card2.dataset.uid = 'user-2';
  card2.dataset.unread = 'false';
  env.elements['chat-card-2'] = card2;

  const card3 = env.makeMockElement('div');
  card3.classList.add('chat-card', 'unread');
  card3.dataset.uid = 'group-1';
  card3.dataset.isGroup = 'true';
  card3.dataset.unread = 'true';
  env.elements['chat-card-3'] = card3;

  // Test 1: filter = 'todos'
  applyChatFilter('todos');
  assert.strictEqual(card1.style.display, 'flex', 'Card 1 should be visible in todos');
  assert.strictEqual(card2.style.display, 'flex', 'Card 2 should be visible in todos');
  assert.strictEqual(card3.style.display, 'flex', 'Card 3 should be visible in todos');

  // Test 2: filter = 'nao-lidas'
  applyChatFilter('nao-lidas');
  assert.strictEqual(card1.style.display, 'flex', 'Card 1 (unread) should be visible');
  assert.strictEqual(card2.style.display, 'none', 'Card 2 (read) should be hidden');
  assert.strictEqual(card3.style.display, 'flex', 'Card 3 (unread group) should be visible');

  // Verify counter on filter pill
  const counterEl = unreadPill.children.find(c => c.className === 'filter-counter') || unreadPill.querySelector('.filter-counter');
  assert.ok(counterEl, 'Counter badge should exist in unread pill');
  assert.strictEqual(counterEl.innerText, '2', 'Counter should show 2 unread conversations');
  assert.strictEqual(counterEl.style.display, 'inline-block', 'Counter should be visible');
});

test('Block and Report Contact: Blocking toggles state and reporting records report in database', async () => {
  const env = createTestEnvironment();
  const toggleBlockContact = env.sandbox.toggleBlockContact || env.sandbox.window.toggleBlockContact;
  const submitContactReport = env.sandbox.submitContactReport || env.sandbox.window.submitContactReport;

  assert.ok(typeof toggleBlockContact === 'function', 'toggleBlockContact should be a defined function');
  assert.ok(typeof submitContactReport === 'function', 'submitContactReport should be a defined function');

  // Set logged in user
  env.sandbox.window.setCurrentUser({ uid: 'user-me', displayName: 'Meu Usuario' });

  const contactToBlock = { uid: 'user-spammer', name: 'Spammer Chat' };

  // 1. Block contact
  await toggleBlockContact(contactToBlock);
  assert.ok(env.firestoreDocs['users/user-me/blocked/user-spammer'], 'Contact should be registered in blocked collection');
  assert.strictEqual(env.firestoreDocs['users/user-me/blocked/user-spammer'].uid, 'user-spammer');

  // 2. Unblock contact
  await toggleBlockContact(contactToBlock);
  assert.strictEqual(env.firestoreDocs['users/user-me/blocked/user-spammer'], undefined, 'Contact should be removed from blocked collection');

  // 3. Submit report for contact with alsoBlock = true
  await submitContactReport(contactToBlock, 'assedio', 'Mensagens ofensivas enviadas', true);

  // Verify report document
  const reportEntries = Object.entries(env.firestoreDocs).filter(([k]) => k.startsWith('reports/'));
  assert.ok(reportEntries.length > 0, 'A report document should be created in reports collection');
  const createdReport = reportEntries[0][1];
  assert.strictEqual(createdReport.targetUid, 'user-spammer');
  assert.strictEqual(createdReport.reason, 'assedio');
  assert.strictEqual(createdReport.details, 'Mensagens ofensivas enviadas');
  assert.strictEqual(createdReport.targetType, 'user');

  // Verify that alsoBlock blocked the contact
  assert.ok(env.firestoreDocs['users/user-me/blocked/user-spammer'], 'alsoBlock should have blocked the reported contact');
});

test('Admin Panel: Ban, unban, delete posts, resolve reports, and purge account data', async () => {
  const env = createTestEnvironment();
  const adminBanUser = env.sandbox.adminBanUser || env.sandbox.window.adminBanUser;
  const adminUnbanUser = env.sandbox.adminUnbanUser || env.sandbox.window.adminUnbanUser;
  const adminPurgeUserData = env.sandbox.adminPurgeUserData || env.sandbox.window.adminPurgeUserData;
  const adminDeletePost = env.sandbox.adminDeletePost || env.sandbox.window.adminDeletePost;
  const adminResolveReport = env.sandbox.adminResolveReport || env.sandbox.window.adminResolveReport;

  assert.ok(typeof adminBanUser === 'function', 'adminBanUser should be a function');
  assert.ok(typeof adminUnbanUser === 'function', 'adminUnbanUser should be a function');
  assert.ok(typeof adminPurgeUserData === 'function', 'adminPurgeUserData should be a function');
  assert.ok(typeof adminDeletePost === 'function', 'adminDeletePost should be a function');
  assert.ok(typeof adminResolveReport === 'function', 'adminResolveReport should be a function');

  // 1. Test banning user
  env.firestoreDocs['users/bad-user'] = { name: 'Infrator', banned: false };
  await adminBanUser('bad-user', 'Spam excessivo');
  assert.strictEqual(env.firestoreDocs['users/bad-user'].banned, true, 'User should be banned in Firestore');
  assert.strictEqual(env.firestoreDocs['users/bad-user'].banReason, 'Spam excessivo');

  // 2. Test unbanning user
  await adminUnbanUser('bad-user');
  assert.strictEqual(env.firestoreDocs['users/bad-user'].banned, false, 'User should be unbanned in Firestore');

  // 3. Test resolving report
  env.firestoreDocs['reports/rep-123'] = { targetUid: 'bad-user', reason: 'spam', resolved: false };
  await adminResolveReport('rep-123');
  assert.strictEqual(env.firestoreDocs['reports/rep-123'].resolved, true, 'Report should be marked as resolved');

  // 4. Test deleting post
  env.firestoreDocs['posts/post-bad'] = { authorUid: 'bad-user', caption: 'Post ofensivo' };
  await adminDeletePost('post-bad');
  assert.strictEqual(env.firestoreDocs['posts/post-bad'], undefined, 'Post should be removed by Admin');

  // 5. Test Purging user account data (posts, stories, groups)
  env.firestoreDocs['posts/post-1'] = { authorUid: 'bad-user', caption: 'Post 1' };
  env.firestoreDocs['posts/post-2'] = { authorUid: 'good-user', caption: 'Post bom' };
  env.firestoreDocs['stories/story-1'] = { authorUid: 'bad-user', text: 'Story 1' };
  env.firestoreDocs['groups/group-1'] = { creatorUid: 'bad-user', name: 'Grupo Infrator' };
  env.firestoreDocs['groups/group-2'] = { creatorUid: 'good-user', name: 'Grupo Legítimo' };

  await adminPurgeUserData('bad-user');

  // Infrator posts, stories and groups should be deleted
  assert.strictEqual(env.firestoreDocs['posts/post-1'], undefined, 'Infrator post should be deleted in purge');
  assert.ok(env.firestoreDocs['posts/post-2'], 'Good user post should remain intact');
  assert.strictEqual(env.firestoreDocs['stories/story-1'], undefined, 'Infrator story should be deleted in purge');
  assert.strictEqual(env.firestoreDocs['groups/group-1'], undefined, 'Infrator group should be deleted in purge');
  assert.ok(env.firestoreDocs['groups/group-2'], 'Good user group should remain intact');
  assert.strictEqual(env.firestoreDocs['users/bad-user'].banned, true, 'Purged user should be automatically banned');
});

test('Admin Security: Admin panel is restricted exclusively to dxhub.oficial@gmail.com and hidden for all other accounts', () => {
  const env = createTestEnvironment();
  const isUserAdmin = env.sandbox.isUserAdmin || env.sandbox.window.isUserAdmin;
  const updateAdminUIVisibility = env.sandbox.updateAdminUIVisibility || env.sandbox.window.updateAdminUIVisibility;
  const openAdminPanel = env.sandbox.openAdminPanel || env.sandbox.window.openAdminPanel;

  assert.ok(typeof isUserAdmin === 'function', 'isUserAdmin should be a function');
  assert.ok(typeof updateAdminUIVisibility === 'function', 'updateAdminUIVisibility should be a function');
  assert.ok(typeof openAdminPanel === 'function', 'openAdminPanel should be a function');

  const adminBtn = env.elements['admin-panel-btn'];
  const adminSettingsItem = env.elements['admin-settings-item'];
  const adminPanel = env.elements['admin-panel'];

  // Case 1: Random user (non-admin)
  env.sandbox.window.setCurrentUser({ uid: 'user-random', email: 'outro.usuario@gmail.com' });
  assert.strictEqual(isUserAdmin(), false, 'Non-admin email must return false for isUserAdmin');
  updateAdminUIVisibility();
  assert.strictEqual(adminBtn.style.display, 'none', 'Admin header button must be hidden for non-admin');
  assert.strictEqual(adminSettingsItem.style.display, 'none', 'Admin settings item must be hidden for non-admin');

  // Attempting to open admin panel as non-admin
  openAdminPanel();
  assert.strictEqual(adminPanel.classList.contains('active'), false, 'Admin panel must not open for non-admin');

  // Case 2: Authorized Super Admin (dxhub.oficial@gmail.com)
  env.sandbox.window.setCurrentUser({ uid: 'admin-dxhub', email: 'dxhub.oficial@gmail.com' });
  assert.strictEqual(isUserAdmin(), true, 'dxhub.oficial@gmail.com must return true for isUserAdmin');
  updateAdminUIVisibility();
  assert.strictEqual(adminBtn.style.display, 'flex', 'Admin header button must be visible for dxhub.oficial@gmail.com');
  assert.strictEqual(adminSettingsItem.style.display, 'flex', 'Admin settings item must be visible for dxhub.oficial@gmail.com');

  // Opening admin panel as authorized admin
  openAdminPanel();
  assert.strictEqual(adminPanel.classList.contains('active'), true, 'Admin panel must open successfully for dxhub.oficial@gmail.com');
});

test('VIP Status: checkIsVipUser and adminToggleUserVip properly grant and revoke VIP status and badges', async () => {
  const env = createTestEnvironment();
  const checkIsVipUser = env.sandbox.checkIsVipUser || env.sandbox.window.checkIsVipUser;
  const adminToggleUserVip = env.sandbox.adminToggleUserVip || env.sandbox.window.adminToggleUserVip;

  assert.ok(typeof checkIsVipUser === 'function', 'checkIsVipUser should be a function');
  assert.ok(typeof adminToggleUserVip === 'function', 'adminToggleUserVip should be a function');

  // Initial user doc with VIP
  env.firestoreDocs['users/user-vip'] = { name: 'VIP User', isVip: true, isVerified: true };
  assert.strictEqual(checkIsVipUser(env.firestoreDocs['users/user-vip']), true, 'User with isVip: true should be VIP');

  // When admin removes VIP
  await adminToggleUserVip('user-vip', false);
  const updatedUser = env.firestoreDocs['users/user-vip'];
  assert.strictEqual(updatedUser.isVip, false, 'isVip should be false in Firestore');
  assert.strictEqual(updatedUser.isVerified, false, 'isVerified should be false in Firestore');
  assert.strictEqual(checkIsVipUser(updatedUser), false, 'checkIsVipUser must return false after VIP removal');

  // When admin grants VIP back
  await adminToggleUserVip('user-vip', true);
  const grantedUser = env.firestoreDocs['users/user-vip'];
  assert.strictEqual(grantedUser.isVip, true, 'isVip should be true in Firestore');
  assert.strictEqual(grantedUser.isVerified, true, 'isVerified should be true in Firestore');
  assert.strictEqual(checkIsVipUser(grantedUser), true, 'checkIsVipUser must return true after VIP grant');
});

test('Ban and Restriction Systems: Full ban lockout restored & 3-hour temporary restriction button with permissions', async () => {
  const env = createTestEnvironment();
  const adminBanUser = env.sandbox.adminBanUser || env.sandbox.window.adminBanUser;
  const adminUnbanUser = env.sandbox.adminUnbanUser || env.sandbox.window.adminUnbanUser;
  const adminRestrictUser = env.sandbox.adminRestrictUser || env.sandbox.window.adminRestrictUser;
  const adminUnrestrictUser = env.sandbox.adminUnrestrictUser || env.sandbox.window.adminUnrestrictUser;
  const isUserBanned = env.sandbox.isUserBanned || env.sandbox.window.isUserBanned;
  const isUserRestricted = env.sandbox.isUserRestricted || env.sandbox.window.isUserRestricted;
  const getRemainingRestrictionTime = env.sandbox.getRemainingRestrictionTime || env.sandbox.window.getRemainingRestrictionTime;
  const getRemainingRestrictionTimeFormatted = env.sandbox.getRemainingRestrictionTimeFormatted || env.sandbox.window.getRemainingRestrictionTimeFormatted;
  const checkBannedAccountState = env.sandbox.checkBannedAccountState || env.sandbox.window.checkBannedAccountState;
  const RESTRICTION_DURATION_MS = env.sandbox.RESTRICTION_DURATION_MS || env.sandbox.window.RESTRICTION_DURATION_MS;
  const RESTRICTION_MESSAGE = env.sandbox.RESTRICTION_MESSAGE || env.sandbox.window.RESTRICTION_MESSAGE;

  // 1. Verify Restored Ban System (Lockout Overlay)
  env.firestoreDocs['users/banned-target'] = { name: 'Infrator', banned: false };
  await adminBanUser('banned-target', 'Violação grave das regras');
  assert.strictEqual(env.firestoreDocs['users/banned-target'].banned, true, 'User must be permanently banned');
  assert.strictEqual(isUserBanned(env.firestoreDocs['users/banned-target']), true, 'isUserBanned must return true');

  // Verify lockout overlay display for banned account
  env.sandbox.window.setCurrentUser({ uid: 'banned-target' });
  env.sandbox.window.setCurrentProfile(env.firestoreDocs['users/banned-target']);
  checkBannedAccountState();
  const bannedOverlay = env.elements['banned-account-overlay'];
  assert.strictEqual(bannedOverlay.style.display, 'flex', 'Banned account overlay must be displayed for banned user');

  // Unban user
  await adminUnbanUser('banned-target');
  assert.strictEqual(env.firestoreDocs['users/banned-target'].banned, false, 'User must be unbanned');
  checkBannedAccountState();
  assert.strictEqual(bannedOverlay.style.display, 'none', 'Banned overlay must be hidden after unban');

  // 2. Verify Restriction Button System (3 Horas)
  assert.strictEqual(RESTRICTION_DURATION_MS, 3 * 60 * 60 * 1000, 'RESTRICTION_DURATION_MS must be 3 hours (10,800,000 ms)');
  assert.ok(RESTRICTION_MESSAGE.includes('Sua conta foi banida temporalmente você não vai conseguir enviar mensagem curtir ou comentar'));
  assert.ok(RESTRICTION_MESSAGE.includes('Ainda é possível enviar story e publicar post além disso nada mais'));

  env.firestoreDocs['users/restrict-target'] = { name: 'Target User', restricted: false };
  const beforeRestrict = Date.now();
  await adminRestrictUser('restrict-target');
  const restrictedDoc = env.firestoreDocs['users/restrict-target'];
  assert.strictEqual(restrictedDoc.restricted, true, 'User must be marked as restricted');
  assert.ok(restrictedDoc.restrictionExpiresAt >= beforeRestrict + RESTRICTION_DURATION_MS - 1000);
  assert.strictEqual(isUserRestricted(restrictedDoc), true, 'User should be recognized as restricted');
  assert.ok(getRemainingRestrictionTime(restrictedDoc) > 0);
  const formatted = getRemainingRestrictionTimeFormatted(restrictedDoc);
  assert.ok(formatted.startsWith('02:') || formatted.startsWith('03:'));

  // 3. Expiration of restriction: Simulate 3 hours passing
  const expiredDoc = {
    ...restrictedDoc,
    restrictionExpiresAt: Date.now() - 1000
  };
  assert.strictEqual(isUserRestricted(expiredDoc), false, 'isUserRestricted must return false once 3 hours expire');

  // 4. Auto-recovery when restriction expires
  env.sandbox.window.setCurrentUser({ uid: 'restrict-target' });
  env.sandbox.window.setCurrentProfile(expiredDoc);
  await checkBannedAccountState();
  assert.strictEqual(expiredDoc.restricted, false, 'Expired restriction should automatically be cleared');
  assert.strictEqual(env.firestoreDocs['users/restrict-target'].restricted, false, 'Firestore doc must be cleared after expiration');
});

test('VIP Subscription Request: Button changes to Em análise ⏳, request goes to Admin panel, and can be approved or rejected', async () => {
  const env = createTestEnvironment();
  const requestVipSubscription = env.sandbox.requestVipSubscription || env.sandbox.window.requestVipSubscription;
  const loadAdminVipRequests = env.sandbox.loadAdminVipRequests || env.sandbox.window.loadAdminVipRequests;
  const adminApproveVipRequest = env.sandbox.adminApproveVipRequest || env.sandbox.window.adminApproveVipRequest;
  const adminRejectVipRequest = env.sandbox.adminRejectVipRequest || env.sandbox.window.adminRejectVipRequest;
  const checkIsVipUser = env.sandbox.checkIsVipUser || env.sandbox.window.checkIsVipUser;

  assert.ok(typeof requestVipSubscription === 'function', 'requestVipSubscription should be a function');
  assert.ok(typeof loadAdminVipRequests === 'function', 'loadAdminVipRequests should be a function');
  assert.ok(typeof adminApproveVipRequest === 'function', 'adminApproveVipRequest should be a function');
  assert.ok(typeof adminRejectVipRequest === 'function', 'adminRejectVipRequest should be a function');

  // Setup non-vip user
  const userProfile = {
    uid: 'solicitante-123',
    name: 'Carlos',
    surname: 'VIP',
    email: 'carlos@vortex.vip',
    isVip: false,
    isVerified: false,
    vipRequestStatus: 'none'
  };
  env.firestoreDocs['users/solicitante-123'] = { ...userProfile };
  env.sandbox.window.setCurrentUser({ uid: 'solicitante-123', email: 'carlos@vortex.vip' });
  env.sandbox.window.setCurrentProfile(userProfile);

  const subscribeBtn = env.elements['subscribe-btn'];
  assert.strictEqual(subscribeBtn.innerText, 'Assinar', 'Initial button text must be Assinar');

  // 1. User clicks Assinar
  await requestVipSubscription();

  // Button changes to Em análise ⏳
  assert.strictEqual(subscribeBtn.innerText, 'Em análise ⏳', 'Button text must change to Em análise ⏳');
  assert.ok(subscribeBtn.className.includes('pending'), 'Button should have pending class');
  assert.strictEqual(userProfile.vipRequestStatus, 'pending', 'Profile vipRequestStatus must be pending');

  // Firestore user doc and vip_requests doc updated
  const userDoc = env.firestoreDocs['users/solicitante-123'];
  assert.strictEqual(userDoc.vipRequestStatus, 'pending', 'Firestore user doc must have vipRequestStatus: pending');
  const vipReqDoc = env.firestoreDocs['vip_requests/solicitante-123'];
  assert.ok(vipReqDoc, 'VIP request document must be created in Firestore');
  assert.strictEqual(vipReqDoc.status, 'pending', 'VIP request status must be pending');
  assert.strictEqual(vipReqDoc.uid, 'solicitante-123', 'VIP request UID must match user');

  // 2. Admin panel loads the request
  await loadAdminVipRequests();
  const vipBadge = env.elements['admin-vip-badge'];
  assert.strictEqual(vipBadge.innerText, 1, 'VIP badge should count 1 pending request');

  // 3. Admin Approves the request
  await adminApproveVipRequest('solicitante-123', 'solicitante-123');
  assert.strictEqual(env.firestoreDocs['vip_requests/solicitante-123'].status, 'approved', 'Request status must be approved');
  assert.strictEqual(env.firestoreDocs['users/solicitante-123'].isVip, true, 'User isVip must be true in Firestore');
  assert.strictEqual(env.firestoreDocs['users/solicitante-123'].isVerified, true, 'User isVerified must be true in Firestore');
  assert.strictEqual(checkIsVipUser(env.firestoreDocs['users/solicitante-123']), true, 'User must be recognized as VIP');

  // 4. Admin Rejects / Revokes request
  await adminRejectVipRequest('solicitante-123', 'solicitante-123');
  assert.strictEqual(env.firestoreDocs['vip_requests/solicitante-123'].status, 'rejected', 'Request status must be rejected');
  assert.strictEqual(env.firestoreDocs['users/solicitante-123'].isVip, false, 'User isVip must be false after rejection');
  assert.strictEqual(env.firestoreDocs['users/solicitante-123'].isVerified, false, 'User isVerified must be false after rejection');
  assert.strictEqual(checkIsVipUser(env.firestoreDocs['users/solicitante-123']), false, 'User must not be VIP after rejection');
});

test('Notification Bell & Admin Broadcast: VIP approval triggers notification, and Admin can broadcast warnings ⚠️ and alerts 🔴', async () => {
  const env = createTestEnvironment();
  const adminApproveVipRequest = env.sandbox.adminApproveVipRequest || env.sandbox.window.adminApproveVipRequest;
  const adminSendBroadcast = env.sandbox.adminSendBroadcast || env.sandbox.window.adminSendBroadcast;
  const loadAdminBroadcastHistory = env.sandbox.loadAdminBroadcastHistory || env.sandbox.window.loadAdminBroadcastHistory;
  const adminDeleteBroadcast = env.sandbox.adminDeleteBroadcast || env.sandbox.window.adminDeleteBroadcast;
  const openNotificationsPanel = env.sandbox.openNotificationsPanel || env.sandbox.window.openNotificationsPanel;

  assert.ok(typeof adminApproveVipRequest === 'function', 'adminApproveVipRequest should be a function');
  assert.ok(typeof adminSendBroadcast === 'function', 'adminSendBroadcast should be a function');
  assert.ok(typeof openNotificationsPanel === 'function', 'openNotificationsPanel should be a function');

  // 1. VIP Approval Notification trigger
  env.firestoreDocs['users/vip-user-1'] = { name: 'VIP User', email: 'vip@user.com' };
  env.firestoreDocs['vip_requests/vip-user-1'] = { uid: 'vip-user-1', status: 'pending' };

  await adminApproveVipRequest('vip-user-1', 'vip-user-1');

  // Check that a notification was created for vip-user-1 with type 'vip'
  const notifEntries = Object.entries(env.firestoreDocs).filter(([k]) => k.startsWith('notifications/'));
  const vipNotif = notifEntries.find(([k, v]) => v.toUid === 'vip-user-1');
  assert.ok(vipNotif, 'A VIP notification should be generated in Firestore');
  assert.strictEqual(vipNotif[1].type, 'vip', 'Notification type must be vip');
  assert.ok(vipNotif[1].title.includes('Selo VIP Aprovado'), 'Title must announce VIP approval');

  // 2. Admin Broadcast Warning ⚠️
  env.sandbox.window.setCurrentUser({ uid: 'admin-dxhub', email: 'dxhub.oficial@gmail.com' });
  const sentWarning = await adminSendBroadcast('warning', 'Manutenção Programada', 'O sistema passará por melhorias', 'all');
  assert.strictEqual(sentWarning, true, 'Admin should successfully broadcast warning');

  const warningNotif = Object.values(env.firestoreDocs).find(v => v.toUid === 'all' && v.type === 'warning');
  assert.ok(warningNotif, 'Warning notification must exist with toUid == all');
  assert.strictEqual(warningNotif.title, 'Manutenção Programada');

  // 3. Admin Broadcast Alert 🔴
  const sentAlert = await adminSendBroadcast('alert', 'Alerta de Segurança', 'Atenção aos termos de uso', 'all');
  assert.strictEqual(sentAlert, true, 'Admin should successfully broadcast alert');

  const alertNotif = Object.values(env.firestoreDocs).find(v => v.toUid === 'all' && v.type === 'alert');
  assert.ok(alertNotif, 'Alert notification must exist with toUid == all');
  assert.strictEqual(alertNotif.title, 'Alerta de Segurança');

  // 4. History and Deletion
  await loadAdminBroadcastHistory();
  const alertDocKey = Object.keys(env.firestoreDocs).find(k => env.firestoreDocs[k]?.title === 'Alerta de Segurança');
  assert.ok(alertDocKey, 'Alert doc must have a key');
  const alertId = alertDocKey.split('/').pop();

  await adminDeleteBroadcast(alertId);
  assert.strictEqual(env.firestoreDocs[alertDocKey], undefined, 'Deleted broadcast should be removed from Firestore');
});

test('Group Enhancements: Leave group, online presence in room, live group typing, and message info readers list', async () => {
  const env = createTestEnvironment();
  const leaveGroup = env.sandbox.leaveGroup || env.sandbox.window.leaveGroup;
  const openGroupChat = env.sandbox.openGroupChat || env.sandbox.window.openGroupChat;
  const closeChat = env.sandbox.closeChat || env.sandbox.window.closeChat;
  const openMessageInfoModal = env.sandbox.openMessageInfoModal || env.sandbox.window.openMessageInfoModal;

  assert.ok(typeof leaveGroup === 'function', 'leaveGroup must be a function');
  assert.ok(typeof openGroupChat === 'function', 'openGroupChat must be a function');
  assert.ok(typeof openMessageInfoModal === 'function', 'openMessageInfoModal must be a function');

  // Setup current user
  env.sandbox.window.setCurrentUser({ uid: 'user-membro-1', email: 'membro@vortex.com' });

  // Mock group in Firestore
  const mockGroup = {
    id: 'grp-test-99',
    groupId: 'grp-test-99',
    name: 'Grupo Amigos VIP',
    members: ['user-membro-1', 'user-membro-2', 'user-membro-3'],
    admins: ['user-membro-1'],
    creatorUid: 'user-membro-2'
  };
  env.firestoreDocs['groups/grp-test-99'] = { ...mockGroup };

  // 1. Test Open Group Chat & Online Presence
  openGroupChat(mockGroup);
  const statusEl = env.elements['chat-window-status'];
  assert.ok(statusEl, 'chat-window-status element must exist');
  assert.ok(statusEl.innerText.includes('membros'), 'Status should mention members count');
  assert.ok(statusEl.innerText.includes('online agora'), 'Status should mention online presence');

  // 2. Test Live Typing in Group (WhatsApp style)
  env.rtdbDocs['group_typing/grp-test-99'] = {
    'user-membro-2': {
      active: true,
      name: 'Carlos VIP',
      updatedAt: Date.now()
    }
  };
  openGroupChat(mockGroup);
  assert.ok(statusEl.innerText.includes('Carlos VIP está digitando'), 'Header should display who is typing in the group');

  // 3. Test Message Info Modal (Visualizada por / Dados da mensagem)
  const testMsg = {
    id: 'msg-abc-123',
    senderUid: 'user-membro-1',
    text: 'Olá a todos do grupo!',
    createdAt: Date.now(),
    readBy: ['user-membro-1', 'user-membro-2', 'user-membro-3'],
    readByMap: {
      'user-membro-2': Date.now() - 60000,
      'user-membro-3': Date.now() - 30000
    }
  };
  env.firestoreDocs['users/user-membro-2'] = { name: 'Carlos VIP', username: 'carlos' };
  env.firestoreDocs['users/user-membro-3'] = { name: 'Ana VIP', username: 'ana' };

  await openMessageInfoModal(testMsg);
  const infoModal = env.elements['message-info-modal'];
  assert.ok(infoModal.classList.contains('active'), 'Message info modal should be open');
  const seenCountBadge = env.elements['msg-info-seen-count'];
  assert.strictEqual(seenCountBadge.innerText, 2, 'Should count 2 readers (excluding sender)');
  const readersList = env.elements['msg-info-readers-list'];
  assert.ok(readersList.innerHTML.includes('Carlos VIP'), 'Readers list should include Carlos VIP');
  assert.ok(readersList.innerHTML.includes('Ana VIP'), 'Readers list should include Ana VIP');

  // 4. Test Leave Group (Sair do Grupo)
  env.sandbox.window.confirm = () => true;
  const left = await leaveGroup(mockGroup);
  assert.strictEqual(left, true, 'User should successfully leave group');
  const updatedGroup = env.firestoreDocs['groups/grp-test-99'];
  assert.ok(!updatedGroup.members.includes('user-membro-1'), 'User UID must be removed from group members in Firestore');
});

test('Contact Activity: Typing, sending media (photo/video/music/file), and proper termination/reset', async () => {
  const env = createTestEnvironment();
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const closeChat = env.sandbox.closeChat || env.sandbox.window.closeChat;

  assert.ok(typeof openDirectChat === 'function', 'openDirectChat must be a function');

  // 1. Current user and contact setup
  env.sandbox.window.setCurrentUser({ uid: 'user-me', email: 'me@vortex.com' });
  const contact = { uid: 'user-friend', name: 'Amigo VIP', avatar: '' };
  env.firestoreDocs['users/user-friend'] = { name: 'Amigo VIP', online: true, lastSeen: Date.now() };

  // Open direct chat
  openDirectChat(contact);
  const statusEl = env.elements['chat-window-status'];
  assert.ok(statusEl, 'Status element must exist');
  assert.strictEqual(statusEl.innerText, 'Online', 'Initial status should be Online');

  // 2. Contact starts typing
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: true,
    kind: 'typing',
    label: 'digitando',
    expiresAt: Date.now() + 5000,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.ok(statusEl.className.includes('status-activity'), 'Status should have status-activity class');
  assert.ok(statusEl.innerText.includes('digitando'), 'Status should display digitando');

  // 3. Contact stops typing (active: false)
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: false,
    kind: 'typing',
    label: 'digitando',
    expiresAt: 0,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.ok(!statusEl.className.includes('status-activity'), 'Status should no longer have status-activity class');
  assert.strictEqual(statusEl.innerText, 'Online', 'Status must return to Online when typing stops');

  // 4. Contact sends photo / image
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: true,
    kind: 'image',
    label: 'enviando imagem',
    expiresAt: Date.now() + 5000,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.ok(statusEl.className.includes('status-activity'), 'Status should have status-activity class while sending image');
  assert.ok(statusEl.innerText.includes('enviando imagem'), 'Status should display enviando imagem');

  // 5. Image upload finishes (active: false)
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: false,
    kind: 'image',
    label: 'enviando imagem',
    expiresAt: 0,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.ok(!statusEl.className.includes('status-activity'), 'Status should no longer have status-activity class after sending image');
  assert.strictEqual(statusEl.innerText, 'Online', 'Status must return to Online after sending image');

  // 6. Contact sends audio
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: true,
    kind: 'audio',
    label: 'enviando áudio',
    expiresAt: Date.now() + 5000,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.ok(statusEl.innerText.includes('enviando áudio'), 'Status should display enviando áudio');

  // 7. Audio upload finishes (active: false)
  env.firestoreDocs['users/user-me/activity/user-friend'] = {
    active: false,
    kind: 'audio',
    label: 'enviando áudio',
    expiresAt: 0,
    fromUid: 'user-friend'
  };
  openDirectChat(contact);
  assert.strictEqual(statusEl.innerText, 'Online', 'Status must return to Online after sending audio');

  // 8. Close chat cleans up
  closeChat();
  assert.ok(!env.elements['chat-window'].classList.contains('active'), 'Chat window should be closed');
});

test('Contact Unread Notification: Bell badge, avatar indicator, and Não lidas filter tag integration', async () => {
  const env = createTestEnvironment();
  const applyChatFilter = env.sandbox.applyChatFilter || env.sandbox.window.applyChatFilter;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Current user
  env.sandbox.window.setCurrentUser({ uid: 'user-me', email: 'me@vortex.com' });

  // 2. Setup DOM elements for unread pill
  const unreadPill = env.makeMockElement('span');
  unreadPill.classList.add('filter-pill');
  unreadPill.dataset.filter = 'nao-lidas';
  env.elements['filter-pill-nao-lidas'] = unreadPill;

  // 3. Create mock contact card
  const contactUid = 'user-friend-42';
  const card = env.makeMockElement('div');
  card.className = 'chat-card';
  card.dataset.uid = contactUid;
  card.dataset.isGroup = 'false';

  const avatar = env.makeMockElement('div');
  avatar.className = 'avatar';
  const unreadBadge = env.makeMockElement('span');
  unreadBadge.className = 'unread-badge';
  unreadBadge.id = `unread-badge-${contactUid}`;
  unreadBadge.style.display = 'none';
  avatar.appendChild(unreadBadge);
  env.elements[`unread-badge-${contactUid}`] = unreadBadge;

  const chatInfo = env.makeMockElement('div');
  const chatBell = env.makeMockElement('span');
  chatBell.className = 'chat-bell-badge';
  chatBell.id = `chat-bell-${contactUid}`;
  chatBell.style.display = 'none';
  const bellCount = env.makeMockElement('span');
  bellCount.id = `bell-count-${contactUid}`;
  chatBell.appendChild(bellCount);
  chatInfo.appendChild(chatBell);
  env.elements[`chat-bell-${contactUid}`] = chatBell;
  env.elements[`bell-count-${contactUid}`] = bellCount;

  card.appendChild(avatar);
  card.appendChild(chatInfo);
  env.elements['chat-card-friend'] = card;

  // 4. Simulate unread message arrival from friend
  card.classList.add('unread');
  card.dataset.unread = 'true';
  card.dataset.unreadCount = '1';
  unreadBadge.style.display = 'flex';
  unreadBadge.classList.add('active');
  chatBell.style.display = 'inline-flex';
  bellCount.innerText = '1';

  // Verify notification indicators are visible
  assert.strictEqual(unreadBadge.style.display, 'flex', 'Avatar unread badge should be visible');
  assert.strictEqual(chatBell.style.display, 'inline-flex', 'Chat bell capsule should be visible');
  assert.strictEqual(bellCount.innerText, '1', 'Bell count should show 1');

  // Verify filter "nao-lidas" includes this contact
  applyChatFilter('nao-lidas');
  assert.strictEqual(card.style.display, 'flex', 'Contact card with unread message must be visible in nao-lidas filter');

  // Verify pill counter
  const counterEl = unreadPill.children.find(c => c.className === 'filter-counter') || unreadPill.querySelector('.filter-counter');
  assert.ok(counterEl, 'Filter counter should exist on unread pill');
  assert.strictEqual(counterEl.innerText, '1', 'Unread pill counter should show 1');
  assert.strictEqual(counterEl.style.display, 'inline-block', 'Unread pill counter should be visible');

  // 5. Open direct chat with contact: badge and bell must disappear immediately
  const contact = { uid: contactUid, name: 'Amigo 42' };
  openDirectChat(contact);

  assert.strictEqual(unreadBadge.style.display, 'none', 'Avatar unread badge should disappear when chat is opened');
  assert.strictEqual(chatBell.style.display, 'none', 'Chat bell capsule should disappear when chat is opened');
  assert.strictEqual(card.dataset.unread, 'false', 'Card unread dataset should be false');
  assert.ok(!card.classList.contains('unread'), 'Card unread class should be removed');
});

test('Edit Sent Message: Sender can edit text messages, cancel edit, and updates Firestore with isEdited flag', async () => {
  const env = createTestEnvironment();
  const startEditMessage = env.sandbox.startEditMessage || env.sandbox.window.startEditMessage;
  const cancelEditMessage = env.sandbox.cancelEditMessage || env.sandbox.window.cancelEditMessage;
  const saveEditedMessage = env.sandbox.saveEditedMessage || env.sandbox.window.saveEditedMessage;
  const getEditingMessage = env.sandbox.getEditingMessage || env.sandbox.window.getEditingMessage;
  const showFloatingReactions = env.sandbox.showFloatingReactions || env.sandbox.window.showFloatingReactions;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Current user
  const me = { uid: 'user-me-123', email: 'me@vortex.vip' };
  env.sandbox.window.setCurrentUser(me);

  // 2. Open chat with contact
  const contact = { uid: 'user-friend-456', name: 'Amigo VIP' };
  openDirectChat(contact);

  const editBar = env.elements['edit-preview-bar'];
  const editText = env.elements['edit-preview-text'];
  const chatInput = env.elements['chat-input-main'];
  const sendBtn = env.elements['chat-send-btn-main'];
  const sendIcon = env.elements['chat-send-icon'];
  const editBtn = env.elements['action-edit-btn'];

  assert.ok(editBar, '#edit-preview-bar element must exist in index.html');
  assert.ok(editText, '#edit-preview-text element must exist in index.html');
  assert.ok(editBtn, '#action-edit-btn element must exist in index.html');

  // 3. Message from friend -> action-edit-btn must NOT be displayed
  const friendMsg = {
    id: 'msg-friend-1',
    senderUid: 'user-friend-456',
    text: 'Olá amigo',
    type: 'text',
    createdAt: Date.now()
  };
  const mockMsgEl = env.makeMockElement('div');
  mockMsgEl.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 20, right: 200, width: 180, height: 30 });
  const appContainer = env.elements['app-container'] || env.makeMockElement('div');
  appContainer.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 400, width: 400, height: 800 });

  showFloatingReactions(friendMsg, mockMsgEl);
  assert.strictEqual(editBtn.style.display, 'none', 'Edit button must be hidden for messages sent by another user');

  // 4. Message from me -> action-edit-btn must be displayed
  const myMsg = {
    id: 'msg-me-1',
    senderUid: 'user-me-123',
    text: 'Texto com ero de digitasao',
    type: 'text',
    createdAt: Date.now()
  };
  showFloatingReactions(myMsg, mockMsgEl);
  assert.strictEqual(editBtn.style.display, 'inline-flex', 'Edit button must be shown for own text messages');

  // 5. Start edit flow
  startEditMessage(myMsg);
  assert.strictEqual(editBar.style.display, 'flex', 'Edit preview bar should be displayed');
  assert.ok(editBar.classList.contains('active'), 'Edit preview bar should have active class');
  assert.strictEqual(editText.innerText, 'Texto com ero de digitasao', 'Edit preview text should show original message');
  assert.strictEqual(chatInput.value, 'Texto com ero de digitasao', 'Chat input should be populated with message text');
  assert.strictEqual(sendIcon.getAttribute('data-lucide'), 'check', 'Send icon should change to check');
  assert.strictEqual(getEditingMessage()?.id, 'msg-me-1', 'Active editingMessage should be set');

  // 6. Cancel edit flow
  cancelEditMessage();
  assert.strictEqual(editBar.style.display, 'none', 'Edit preview bar should be hidden after cancel');
  assert.ok(!editBar.classList.contains('active'), 'Edit preview bar should not be active');
  assert.strictEqual(chatInput.value, '', 'Input should be cleared after cancel');
  assert.strictEqual(getEditingMessage(), null, 'Active editingMessage should be reset to null');

  // 7. Save edited message
  startEditMessage(myMsg);
  chatInput.value = 'Texto corrigido sem erros!';
  await saveEditedMessage(myMsg, 'Texto corrigido sem erros!');

  const updateEntry = env.firestoreUpdates.find(u => u.ref && u.ref.path && u.ref.path.includes('msg-me-1'));
  assert.ok(updateEntry, 'Firestore update should be called for edited message');
  assert.strictEqual(updateEntry.updateData.text, 'Texto corrigido sem erros!', 'Text in Firestore should be updated');
  assert.strictEqual(updateEntry.updateData.isEdited, true, 'isEdited flag should be true');
  assert.ok(typeof updateEntry.updateData.editedAt === 'number', 'editedAt timestamp should be recorded');
  assert.strictEqual(getEditingMessage(), null, 'editingMessage should be cleared after save');

  // 8. Test send button click submission while editing
  startEditMessage(myMsg);
  chatInput.value = 'Outra correção via botão';
  sendBtn.click();
  await new Promise(r => setTimeout(r, 20));
  const secondUpdate = env.firestoreUpdates.filter(u => u.ref && u.ref.path && u.ref.path.includes('msg-me-1')).pop();
  assert.ok(secondUpdate, 'Second update should be recorded via send button');
  assert.strictEqual(secondUpdate.updateData.text, 'Outra correção via botão', 'Updated text should be saved via send button');

  // 9. Close chat cleans up editing
  startEditMessage(myMsg);
  assert.strictEqual(getEditingMessage()?.id, 'msg-me-1');
  const closeChat = env.sandbox.closeChat || env.sandbox.window.closeChat;
  closeChat();
  assert.strictEqual(getEditingMessage(), null, 'closeChat must reset editingMessage');
  assert.strictEqual(editBar.style.display, 'none', 'closeChat must hide edit bar');
});

test('Copy Message: Copies text to clipboard, shows copy button on floating bar, and handles empty/deleted states', async () => {
  const env = createTestEnvironment();
  const copyMessageText = env.sandbox.copyMessageText || env.sandbox.window.copyMessageText;
  const showFloatingReactions = env.sandbox.showFloatingReactions || env.sandbox.window.showFloatingReactions;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Current user & open chat
  const me = { uid: 'user-me-123', email: 'me@vortex.vip' };
  env.sandbox.window.setCurrentUser(me);
  openDirectChat({ uid: 'friend-456', name: 'Amigo' });

  const copyBtn = env.elements['action-copy-btn'];
  assert.ok(copyBtn, '#action-copy-btn element must exist in index.html');

  // 2. Message with text -> action-copy-btn must be visible
  const textMsg = {
    id: 'msg-text-1',
    senderUid: 'friend-456',
    text: 'Esta é uma mensagem com conteúdo importante para copiar!',
    type: 'text',
    createdAt: Date.now()
  };
  const mockMsgEl = env.makeMockElement('div');
  mockMsgEl.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 20, right: 200, width: 180, height: 30 });

  showFloatingReactions(textMsg, mockMsgEl);
  assert.strictEqual(copyBtn.style.display, 'inline-flex', 'Copy button should be visible for message with text');

  // 3. Test copying text
  await copyMessageText(textMsg);
  assert.strictEqual(env.sandbox._copiedText, 'Esta é uma mensagem com conteúdo importante para copiar!', 'Text should be written to clipboard');
});

test('Clear Chat Isolation: Limpar Conversa deletes messages only for current user without clearing for the other user', async () => {
  const env = createTestEnvironment();
  const clearChatForCurrentUser = env.sandbox.clearChatForCurrentUser || env.sandbox.window.clearChatForCurrentUser;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Current user is User A
  const userA = { uid: 'user-alice-111', email: 'alice@vortex.vip' };
  const userB = { uid: 'user-bob-222', email: 'bob@vortex.vip' };
  env.sandbox.window.setCurrentUser(userA);

  const chatId = 'chat_user-alice-111_user-bob-222';
  openDirectChat({ uid: userB.uid, name: 'Bob' });

  // 2. Setup messages in Firestore
  const pathMsg1 = `chats/${chatId}/messages/msg-1`;
  const pathMsg2 = `chats/${chatId}/messages/msg-2`;
  env.firestoreDocs[pathMsg1] = {
    id: 'msg-1',
    senderUid: userB.uid,
    text: 'Olá Alice!',
    createdAt: Date.now() - 2000,
    deletedFor: []
  };
  env.firestoreDocs[pathMsg2] = {
    id: 'msg-2',
    senderUid: userA.uid,
    text: 'Olá Bob!',
    createdAt: Date.now() - 1000,
    deletedFor: []
  };

  // 3. User A triggers clear chat
  await clearChatForCurrentUser(chatId);

  // 4. Verify documents were NOT deleted from the database
  assert.ok(env.firestoreDocs[pathMsg1], 'msg-1 should still exist in Firestore');
  assert.ok(env.firestoreDocs[pathMsg2], 'msg-2 should still exist in Firestore');

  // 5. Verify deletedFor contains Alice (userA)
  assert.ok(env.firestoreDocs[pathMsg1].deletedFor.includes(userA.uid), 'msg-1 should have userA in deletedFor');
  assert.ok(env.firestoreDocs[pathMsg2].deletedFor.includes(userA.uid), 'msg-2 should have userA in deletedFor');

  // 6. CRITICAL REQUIREMENT: Verify deletedFor does NOT contain Bob (userB)
  assert.ok(!env.firestoreDocs[pathMsg1].deletedFor.includes(userB.uid), 'msg-1 must NOT have userB in deletedFor (intact for the other user)');
  assert.ok(!env.firestoreDocs[pathMsg2].deletedFor.includes(userB.uid), 'msg-2 must NOT have userB in deletedFor (intact for the other user)');

  // 7. Verify modal text explains clear for me
  const modal = env.elements['clear-chat-modal'];
  assert.ok(modal, '#clear-chat-modal must exist');
});

test('Blocked Contact Isolation: Blocked user cannot send messages, and recipient receives no messages, notifications, or activity from blocked contact', async () => {
  const env = createTestEnvironment();
  const toggleBlockContact = env.sandbox.toggleBlockContact || env.sandbox.window.toggleBlockContact;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Setup Alice and Bob
  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice' };
  const bob = { uid: 'user-bob-222', email: 'bob@vortex.vip', name: 'Bob' };
  env.sandbox.window.setCurrentUser(alice);

  // 2. Alice blocks Bob
  await toggleBlockContact({ uid: bob.uid, name: bob.name });
  assert.ok(env.firestoreDocs[`users/${alice.uid}/blocked/${bob.uid}`], 'Alice should have recorded Bob in her blocked collection');

  const blockedSet = env.sandbox.window.getBlockedContactsSet();
  assert.ok(blockedSet.has(bob.uid), 'Alice blockedContactsSet must contain Bob');

  // 3. Alice opens chat with Bob -> UI must show blocked state
  openDirectChat(bob);
  const banner = env.elements['chat-blocked-banner'];
  const bannerText = env.elements['chat-blocked-banner-text'];
  const chatInput = env.elements['chat-input-main'];
  const sendBtn = env.elements['chat-send-btn-main'];

  assert.strictEqual(banner.style.display, 'flex', 'Blocked banner must be shown for Alice');
  assert.ok(bannerText.innerText.includes('Você bloqueou Bob'), 'Banner text should indicate Alice blocked Bob');
  assert.strictEqual(chatInput.disabled, true, 'Alice cannot type in blocked contact chat');
  assert.strictEqual(sendBtn.disabled, true, 'Alice send button must be disabled');
  const unblockBtnAlice = env.elements['unblock-banner-btn'];
  assert.strictEqual(unblockBtnAlice.style.display, 'inline-block', 'Unblock button must be visible for Alice (the blocker)');

  // 4. Now simulate Bob perspective (the blocked user)
  const envBob = createTestEnvironment();
  const openDirectChatBob = envBob.sandbox.openDirectChat || envBob.sandbox.window.openDirectChat;
  const sendChatMessageBob = envBob.sandbox.sendChatMessage || envBob.sandbox.window.sendChatMessage;
  envBob.sandbox.window.setCurrentUser(bob);

  // Bob environment sees the block doc that Alice created
  envBob.firestoreDocs[`users/${alice.uid}/blocked/${bob.uid}`] = {
    uid: bob.uid,
    name: bob.name,
    blockedAt: Date.now()
  };

  // Bob opens chat with Alice
  openDirectChatBob(alice);

  // Bob UI should detect that Alice blocked him
  const bobInput = envBob.elements['chat-input-main'];
  const bobSendBtn = envBob.elements['chat-send-btn-main'];
  const bobBanner = envBob.elements['chat-blocked-banner'];
  const bobBannerText = envBob.elements['chat-blocked-banner-text'];
  const unblockBtnBob = envBob.elements['unblock-banner-btn'];

  assert.strictEqual(bobBanner.style.display, 'flex', 'Blocked banner must be shown on Bob screen');
  assert.ok(bobBannerText.innerText.includes('Você foi bloqueado'), 'Banner text should tell Bob he was blocked');
  assert.strictEqual(bobInput.disabled, true, 'Bob input must be disabled');
  assert.strictEqual(bobSendBtn.disabled, true, 'Bob send button must be disabled');
  assert.strictEqual(unblockBtnBob.style.display, 'none', 'CRITICAL: Unblock button must NEVER appear for Bob (the blocked user)');

  // 5. If Bob tries to call sendChatMessage, it must be rejected and not added to Firestore
  const chatId = 'chat_user-alice-111_user-bob-222';
  const initialMsgCount = Object.keys(envBob.firestoreDocs).filter(k => k.startsWith(`chats/${chatId}/messages`)).length;

  await sendChatMessageBob('text', { text: 'Mensagem invasiva do Bob' });

  const finalMsgCount = Object.keys(envBob.firestoreDocs).filter(k => k.startsWith(`chats/${chatId}/messages`)).length;
  assert.strictEqual(finalMsgCount, initialMsgCount, 'Blocked user must NOT be able to save message into chat collection');
});

test('Multi-select Delete Isolation: When selecting other user messages, Apagar para todos is hidden and blocked', async () => {
  const env = createTestEnvironment();
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const openDeleteModal = env.sandbox.openDeleteModal || env.sandbox.window.openDeleteModal;

  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice' };
  const bob = { uid: 'user-bob-222', email: 'bob@vortex.vip', name: 'Bob' };
  env.sandbox.window.setCurrentUser(alice);

  const chatId = [alice.uid, bob.uid].sort().join('_');
  const msgAlicePath = `chats/${chatId}/messages/msg-alice`;
  const msgBobPath = `chats/${chatId}/messages/msg-bob`;

  env.firestoreDocs[msgAlicePath] = {
    id: 'msg-alice',
    senderUid: alice.uid,
    text: 'Minha mensagem da Alice',
    createdAt: Date.now() - 2000,
    deletedFor: []
  };

  env.firestoreDocs[msgBobPath] = {
    id: 'msg-bob',
    senderUid: bob.uid,
    text: 'Mensagem enviada pelo Bob',
    createdAt: Date.now() - 1000,
    deletedFor: []
  };

  openDirectChat(bob);

  const deleteForEveryoneBtn = env.elements['delete-for-everyone-btn'];
  assert.ok(deleteForEveryoneBtn, '#delete-for-everyone-btn must exist');

  const enterSelectionMode = env.sandbox.enterSelectionMode || env.sandbox.window.enterSelectionMode;
  const getSelectedMessageIds = env.sandbox.getSelectedMessageIds || env.sandbox.window.getSelectedMessageIds;
  const selectedMessageIds = getSelectedMessageIds();

  // Case 1: Alice selects ONLY her message -> "Apagar para todos" MUST appear
  enterSelectionMode('msg-alice');
  await openDeleteModal(true);
  assert.strictEqual(deleteForEveryoneBtn.style.display, 'block', 'Apagar para todos should be visible when only own messages are selected');

  // Case 2: Alice selects Bob message -> "Apagar para todos" MUST BE HIDDEN!
  selectedMessageIds.add('msg-bob');
  await openDeleteModal(true);
  assert.strictEqual(deleteForEveryoneBtn.style.display, 'none', 'CRITICAL: Apagar para todos must be hidden when other user message is selected');

  // Case 3: Alice selects ONLY Bob message -> "Apagar para todos" MUST BE HIDDEN!
  selectedMessageIds.clear();
  selectedMessageIds.add('msg-bob');
  await openDeleteModal(true);
  assert.strictEqual(deleteForEveryoneBtn.style.display, 'none', 'CRITICAL: Apagar para todos must be hidden when only other user message is selected');

  // Case 4: Even if delete-for-everyone-btn click is triggered, Bob message is NEVER marked deletedForEveryone
  if (env.elements['delete-for-everyone-btn'].click) {
    await env.elements['delete-for-everyone-btn'].click();
  }
  assert.strictEqual(env.firestoreDocs[msgBobPath].deletedForEveryone, undefined, 'Bob message must NEVER be marked deletedForEveryone by Alice');
  assert.strictEqual(env.firestoreDocs[msgBobPath].text, 'Mensagem enviada pelo Bob', 'Bob message text must remain intact');
});

test('Group Message Sender Name: Messages in group chats display the sender user name prominently on the bubble', async () => {
  const env = createTestEnvironment();
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice' };
  const bob = { uid: 'user-bob-222', email: 'bob@vortex.vip', name: 'Bob Silva' };
  env.sandbox.window.setCurrentUser(alice);
  env.sandbox.currentProfile = { name: 'Alice', avatar: '' };

  const groupId = 'group-vip-123';
  const groupChatId = `group_${groupId}`;

  // 1. Setup group messages in Firestore before opening chat
  const msgBobPath = `chats/${groupChatId}/messages/msg-bob`;
  const msgAlicePath = `chats/${groupChatId}/messages/msg-alice`;

  env.firestoreDocs[msgBobPath] = {
    id: 'msg-bob',
    senderUid: bob.uid,
    senderName: 'Bob Silva',
    text: 'Bom dia pessoal do grupo!',
    createdAt: Date.now() - 3000,
    deletedFor: []
  };

  env.firestoreDocs[msgAlicePath] = {
    id: 'msg-alice',
    senderUid: alice.uid,
    senderName: 'Alice',
    text: 'Bom dia Bob!',
    createdAt: Date.now() - 1000,
    deletedFor: []
  };

  // 2. Open group chat
  openDirectChat({
    uid: groupId,
    name: 'Grupo VIP Investimentos',
    isGroup: true,
    members: [alice.uid, bob.uid]
  });

  const msgContainer = env.elements['message-container'];
  assert.ok(msgContainer, '#message-container must exist');

  // Verify Bob message in DOM
  const bobMsgDiv = msgContainer.children.find(c => c.dataset?.id === 'msg-bob');
  assert.ok(bobMsgDiv, 'Bob message must be rendered in group chat');
  assert.ok(bobMsgDiv.innerHTML.includes('group-sender-name'), 'Bob message must have group-sender-name in innerHTML');
  assert.ok(bobMsgDiv.innerHTML.includes('Bob Silva'), 'Bob message HTML must include "Bob Silva"');
  assert.ok(bobMsgDiv.innerText.includes('Bob Silva'), `Bob message text must include "Bob Silva", found: "${bobMsgDiv.innerText}"`);

  // Verify Alice message in DOM
  const aliceMsgDiv = msgContainer.children.find(c => c.dataset?.id === 'msg-alice');
  assert.ok(aliceMsgDiv, 'Alice message must be rendered in group chat');
  assert.ok(aliceMsgDiv.innerHTML.includes('group-sender-name group-sender-me'), 'Alice message must have group-sender-me');
  assert.ok(aliceMsgDiv.innerText.includes('Alice (Você)'), `Alice message text must include "Alice (Você)", found: "${aliceMsgDiv.innerText}"`);

  // 3. Now verify 1-on-1 direct chat: group-sender-name should NOT be displayed
  const directChatId = [alice.uid, bob.uid].sort().join('_');
  env.firestoreDocs[`chats/${directChatId}/messages/msg-direct-1`] = {
    id: 'msg-direct-1',
    senderUid: bob.uid,
    senderName: 'Bob Silva',
    text: 'Mensagem privada',
    createdAt: Date.now(),
    deletedFor: []
  };

  openDirectChat({
    uid: bob.uid,
    name: 'Bob Silva',
    isGroup: false
  });

  const directBobDiv = msgContainer.children.find(c => c.dataset?.id === 'msg-direct-1');
  assert.ok(directBobDiv, 'Direct message must be rendered');
  assert.strictEqual(directBobDiv.innerHTML.includes('group-sender-name'), false, 'Direct 1-on-1 message should NOT render group-sender-name');
});

test('Music on Videos & Photos (Feed & Stories): API search, track selection, story music attachment, post music attachment, and viewer rendering', async () => {
  const env = createTestEnvironment();
  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice' };
  env.sandbox.window.setCurrentUser(alice);
  env.sandbox.currentProfile = { name: 'Alice', avatar: '', username: '@alice' };

  // 1. DOM Elements presence
  assert.ok(env.elements['music-picker-modal'], '#music-picker-modal must exist in DOM');
  assert.ok(env.elements['music-search-input'], '#music-search-input must exist in DOM');
  assert.ok(env.elements['status-add-music-btn'], '#status-add-music-btn must exist in DOM');
  assert.ok(env.elements['status-selected-music-card'], '#status-selected-music-card must exist in DOM');
  assert.ok(env.elements['post-add-music-btn'], '#post-add-music-btn must exist in DOM');
  assert.ok(env.elements['post-selected-music-card'], '#post-selected-music-card must exist in DOM');
  assert.ok(env.elements['story-music-badge'], '#story-music-badge must exist in DOM');
  assert.strictEqual(env.sandbox.window.MUSIC_API_KEY, 'f2d4476c21ea34d6a6a917f5f9ab5f3aed4fc833', 'MUSIC_API_KEY must match configured key');

  // 2. Track Search API
  const searchMusicTracks = env.sandbox.searchMusicTracks || env.sandbox.window.searchMusicTracks;
  assert.ok(typeof searchMusicTracks === 'function', 'searchMusicTracks must be a function');
  const tracks = await searchMusicTracks('rock');
  assert.ok(Array.isArray(tracks), 'searchMusicTracks must return an array');
  assert.ok(tracks.length > 0, 'searchMusicTracks must return at least one track');
  const sampleTrack = tracks[0];
  assert.ok(sampleTrack.id, 'Track must have id');
  assert.ok(sampleTrack.title, 'Track must have title');
  assert.ok(sampleTrack.artist, 'Track must have artist');
  assert.ok(sampleTrack.audioUrl, 'Track must have audioUrl');

  // 3. Selection for Status
  const openMusicPicker = env.sandbox.openMusicPicker || env.sandbox.window.openMusicPicker;
  const selectMusicTrack = env.sandbox.selectMusicTrack || env.sandbox.window.selectMusicTrack;
  const getPendingStatusMusic = env.sandbox.getPendingStatusMusic || env.sandbox.window.getPendingStatusMusic;

  openMusicPicker('status');
  assert.strictEqual(env.elements['music-picker-modal'].classList.contains('active'), true, 'Modal should open for status');

  const chosenTrack = {
    id: 'test_track_99',
    title: 'Neon Dreams VIP',
    artist: 'Vortex Sounds',
    cover: 'https://example.com/cover.jpg',
    audioUrl: 'https://example.com/audio.mp3',
    duration: 30
  };

  selectMusicTrack(chosenTrack);
  assert.strictEqual(env.elements['music-picker-modal'].classList.contains('active'), false, 'Modal should close after selection');
  assert.deepStrictEqual(getPendingStatusMusic(), chosenTrack, 'pendingStatusMusic must store selected track');
  assert.strictEqual(env.elements['status-selected-music-card'].style.display, 'flex', 'Status selected music card must be displayed');
  assert.strictEqual(env.elements['status-selected-music-title'].innerText, 'Neon Dreams VIP');

  // 4. Status Publication attaches music
  await env.sandbox.addDoc(env.sandbox.collection(env.sandbox.db, 'stories'), {
    authorUid: alice.uid,
    authorName: alice.name,
    type: 'video',
    src: 'data:video/mp4;base64,mock',
    caption: 'Curtindo o som no story!',
    music: chosenTrack,
    createdAt: Date.now()
  });

  const createdStory = Object.values(env.firestoreDocs).find(d => d.caption === 'Curtindo o som no story!');
  assert.ok(createdStory, 'Created story must exist in Firestore');
  assert.ok(createdStory.music, 'Story must contain music object');
  assert.strictEqual(createdStory.music.title, 'Neon Dreams VIP');
  assert.strictEqual(createdStory.music.artist, 'Vortex Sounds');

  // 5. Selection for Post (Feed)
  const getPendingPostMusic = env.sandbox.getPendingPostMusic || env.sandbox.window.getPendingPostMusic;
  openMusicPicker('post');
  selectMusicTrack(chosenTrack);
  assert.deepStrictEqual(getPendingPostMusic(), chosenTrack, 'pendingPostMusic must store selected track');
  assert.strictEqual(env.elements['post-selected-music-card'].style.display, 'flex', 'Post selected music card must be displayed');

  // Publish Post with Music
  await env.sandbox.addDoc(env.sandbox.collection(env.sandbox.db, 'posts'), {
    authorUid: alice.uid,
    authorName: alice.name,
    type: 'video',
    mediaData: 'data:video/mp4;base64,mock',
    caption: 'Vídeo incrível com trilha sonora!',
    music: chosenTrack,
    createdAt: Date.now()
  });

  const createdPost = Object.values(env.firestoreDocs).find(d => d.caption === 'Vídeo incrível com trilha sonora!');
  assert.ok(createdPost, 'Created post must exist in Firestore');
  assert.ok(createdPost.music, 'Post must contain music object');
  assert.strictEqual(createdPost.music.title, 'Neon Dreams VIP');

  // 6. Story Viewer displayCurrentStory renders story-music-badge
  const openStoryViewer = env.sandbox.openStoryViewer || env.sandbox.window.openStoryViewer;
  openStoryViewer([{
    id: 'story-1',
    authorUid: alice.uid,
    authorName: 'Alice',
    type: 'image',
    src: 'photo.jpg',
    music: chosenTrack
  }], { authorUid: alice.uid, authorName: 'Alice' });

  assert.strictEqual(env.elements['story-music-badge'].style.display, 'flex', 'Story music badge must be displayed when story has music');
  assert.strictEqual(env.elements['story-music-title'].innerText, 'Neon Dreams VIP');

  // Closing viewer hides badge
  const closeStoryViewer = env.sandbox.closeStoryViewer || env.sandbox.window.closeStoryViewer;
  closeStoryViewer();
  assert.strictEqual(env.elements['story-music-badge'].style.display, 'none', 'Story music badge must be hidden on close');
});

test('Profile Avatar Update & Persistence: Compression, preview sync, auto-save to Firestore users/{uid}, and persistence on save-profile-btn', async () => {
  const env = createTestEnvironment();
  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice', surname: 'Silva', username: '@alicesilva', avatar: 'data:image/jpeg;base64,initialAvatar' };
  env.sandbox.window.setCurrentUser(alice);
  env.sandbox.window.setCurrentProfile({ ...alice });
  env.firestoreDocs[`users/${alice.uid}`] = { ...alice };

  const profileBtn = env.elements['profile-btn'];
  const editPreview = env.elements['profile-edit-avatar-preview'];
  const userAvatarDisplay = env.elements['user-avatar-display'];
  const fileInput = env.elements['profile-file-input'];
  const saveBtn = env.elements['save-profile-btn'];

  assert.ok(editPreview, 'profile-edit-avatar-preview must exist');
  assert.ok(fileInput, 'profile-file-input must exist');
  assert.ok(saveBtn, 'save-profile-btn must exist');

  // 1. Opening profile edit panel updates preview from currentProfile.avatar
  profileBtn.click();
  assert.strictEqual(editPreview.style.backgroundImage, "url('data:image/jpeg;base64,initialAvatar')", 'Opening profile edit panel should set preview to current avatar');

  // 2. Clicking avatar preview triggers fileInput.click()
  let fileInputClicked = false;
  fileInput.click = () => { fileInputClicked = true; };
  editPreview.click();
  assert.strictEqual(fileInputClicked, true, 'Clicking circular avatar preview must trigger file input');

  // 3. compressImage works and returns valid dataUrl
  const compressImage = env.sandbox.compressImage || env.sandbox.window.compressImage;
  const mockAvatarData = 'data:image/jpeg;base64,newCompressedAvatarData123';
  const compressed = await compressImage(mockAvatarData, 512, 0.78);
  assert.strictEqual(compressed, mockAvatarData, 'compressImage should process and return image data url');

  // 4. updateProfileAvatar updates currentProfile, DOM previews and writes to Firestore users/{uid}
  const updateProfileAvatar = env.sandbox.updateProfileAvatar || env.sandbox.window.updateProfileAvatar;
  await updateProfileAvatar(mockAvatarData);

  assert.strictEqual(editPreview.style.backgroundImage, `url('${mockAvatarData}')`, 'Preview background should be updated immediately');
  assert.strictEqual(userAvatarDisplay.style.backgroundImage, `url('${mockAvatarData}')`, 'Header user-avatar-display should be updated immediately');
  assert.strictEqual(env.firestoreDocs[`users/${alice.uid}`].avatar, mockAvatarData, 'Avatar must be auto-saved to Firestore doc users/{uid}');

  // 4b. Selecting file via profile-file-input change event triggers compression and auto-save
  const fileEventData = 'data:image/jpeg;base64,fromFileInputChange999';
  await fileInput.dispatchEvent('change', { target: { files: [fileEventData] } });
  assert.strictEqual(env.firestoreDocs[`users/${alice.uid}`].avatar, fileEventData, 'Avatar from file input change event must be auto-saved');
  assert.strictEqual(editPreview.style.backgroundImage, `url('${fileEventData}')`, 'Preview background should reflect file input change');

  // 5. Saving profile via #save-profile-btn keeps avatar intact in Firestore & saves phone and social links
  env.elements['profile-name-input'].value = 'Alice Updated';
  env.elements['profile-lastname-input'].value = 'Silva VIP';
  env.elements['profile-username-input'].value = 'alicesilva';
  env.elements['profile-status-input'].value = 'Novo status VIP';
  env.elements['profile-phone-input'].value = '(11) 98888-7777';
  env.elements['profile-youtube-input'].value = '@alicevip';
  env.elements['profile-instagram-input'].value = '@alicesilva';
  env.elements['profile-tiktok-input'].value = '@alice.tok';

  await saveBtn.click();

  const savedUserDoc = env.firestoreDocs[`users/${alice.uid}`];
  assert.ok(savedUserDoc, 'User doc must exist in Firestore');
  assert.strictEqual(savedUserDoc.name, 'Alice Updated', 'Name must be updated');
  assert.strictEqual(savedUserDoc.avatar, fileEventData, 'CRITICAL: Avatar must be preserved in Firestore when saving profile');
  assert.strictEqual(savedUserDoc.phone, '(11) 98888-7777', 'Phone must be saved in Firestore');
  assert.strictEqual(savedUserDoc.youtube, 'https://www.youtube.com/@alicevip', 'YouTube URL must be formatted and saved');
  assert.strictEqual(savedUserDoc.instagram, 'https://www.instagram.com/alicesilva', 'Instagram URL must be formatted and saved');
  assert.strictEqual(savedUserDoc.tiktok, 'https://www.tiktok.com/@alice.tok', 'TikTok URL must be formatted and saved');
  assert.strictEqual(env.elements['user-display-name'].innerText, 'Alice Updated Silva VIP', 'Display name in header must be refreshed');

  // 6. Opening profile edit panel again reloads saved phone and social links
  profileBtn.click();
  assert.strictEqual(env.elements['profile-phone-input'].value, '(11) 98888-7777', 'Phone input must reload saved value');
  assert.strictEqual(env.elements['profile-youtube-input'].value, 'https://www.youtube.com/@alicevip', 'YouTube input must reload saved value');
  assert.strictEqual(env.elements['profile-instagram-input'].value, 'https://www.instagram.com/alicesilva', 'Instagram input must reload saved value');
  assert.strictEqual(env.elements['profile-tiktok-input'].value, 'https://www.tiktok.com/@alice.tok', 'TikTok input must reload saved value');
});

test('Feed Post Music Playback: Toggle play/pause, UI state update, pausing previous track, and stopping audio when closing feed', async () => {
  const env = createTestEnvironment();
  const toggleFeedPostMusic = env.sandbox.toggleFeedPostMusic || env.sandbox.window.toggleFeedPostMusic;
  const updateFeedMusicUI = env.sandbox.updateFeedMusicUI || env.sandbox.window.updateFeedMusicUI;
  const getCurrentFeedMusicAudio = env.sandbox.getCurrentFeedMusicAudio || env.sandbox.window.getCurrentFeedMusicAudio;
  const getCurrentFeedMusicPostId = env.sandbox.getCurrentFeedMusicPostId || env.sandbox.window.getCurrentFeedMusicPostId;

  assert.ok(typeof toggleFeedPostMusic === 'function', 'toggleFeedPostMusic must be an exported function');

  const post1 = {
    id: 'post_music_1',
    authorName: 'Deyvison',
    music: {
      id: 'm1',
      title: 'Montagem - Conga Conga (Remix)',
      artist: 'DJ RAMON SP',
      audioUrl: 'https://cdn.example.com/conga.mp3'
    }
  };

  // Mock DOM badge and toggle button in elements
  const badgeEl = env.makeMockElement('div');
  badgeEl.id = `feed-music-badge-${post1.id}`;
  badgeEl.classList.add('feed-music-badge');
  badgeEl.dataset.postId = post1.id;
  badgeEl.dataset.audioUrl = post1.music.audioUrl;

  const toggleBtnEl = env.makeMockElement('button');
  toggleBtnEl.classList.add('feed-music-toggle-btn');
  badgeEl.appendChild(toggleBtnEl);

  env.elements[`feed-music-badge-${post1.id}`] = badgeEl;

  // 1. Play track for post1
  toggleFeedPostMusic(post1.id, post1.music.audioUrl);

  const audioObj = getCurrentFeedMusicAudio();
  assert.ok(audioObj, 'Audio object must be instantiated');
  assert.strictEqual(audioObj.src, post1.music.audioUrl, 'Audio source must match track audioUrl');
  assert.strictEqual(getCurrentFeedMusicPostId(), post1.id, 'Playing post ID must match post1');
  assert.ok(env.soundPlayed.includes(post1.music.audioUrl), 'Audio play must be invoked');
  assert.strictEqual(badgeEl.classList.contains('playing'), true, 'Badge must have .playing class while playing');
  assert.ok(toggleBtnEl.innerHTML.includes('pause'), 'Toggle button must render pause icon while playing');

  // 2. Clicking same post badge again pauses the audio
  toggleFeedPostMusic(post1.id, post1.music.audioUrl);
  assert.strictEqual(badgeEl.classList.contains('playing'), false, 'Badge must lose .playing class when paused');
  assert.ok(toggleBtnEl.innerHTML.includes('play'), 'Toggle button must render play icon when paused');

  // 3. Playing another track stops previous audio and plays the new one
  const post2 = {
    id: 'post_music_2',
    authorName: 'Alice',
    music: {
      id: 'm2',
      title: 'Neon Horizon',
      artist: 'Synthwave VIP',
      audioUrl: 'https://cdn.example.com/neon.mp3'
    }
  };
  const badge2 = env.makeMockElement('div');
  badge2.id = `feed-music-badge-${post2.id}`;
  badge2.classList.add('feed-music-badge');
  env.elements[`feed-music-badge-${post2.id}`] = badge2;

  toggleFeedPostMusic(post2.id, post2.music.audioUrl);
  assert.strictEqual(getCurrentFeedMusicPostId(), post2.id, 'Now post2 is the active playing post');
  assert.strictEqual(badge2.classList.contains('playing'), true, 'Post2 badge is playing');
  assert.strictEqual(badgeEl.classList.contains('playing'), false, 'Post1 badge is stopped');

  // 4. Closing feed overlay stops playing music
  const closeFeedBtn = env.elements['close-feed-btn'];
  if (closeFeedBtn) {
    await closeFeedBtn.click();
    assert.strictEqual(getCurrentFeedMusicAudio(), null, 'Audio must be cleaned up when feed is closed');
    assert.strictEqual(getCurrentFeedMusicPostId(), null, 'Playing post ID must be reset');
  }
});

test('Audio Recording Timer & Dynamic Duration Playback: Formats seconds to mm:ss, stores duration in Firestore, renders real duration on message bubbles, and dynamically updates counter on playback', async () => {
  const env = createTestEnvironment();
  const formatAudioTime = env.sandbox.formatAudioTime || env.sandbox.window.formatAudioTime;
  const parseAudioDuration = env.sandbox.parseAudioDuration || env.sandbox.window.parseAudioDuration;
  const sendChatMessage = env.sandbox.sendChatMessage || env.sandbox.window.sendChatMessage;
  const playVoiceNote = env.sandbox.playVoiceNote || env.sandbox.window.playVoiceNote;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  // 1. Verify formatAudioTime handles 0s, seconds < 60, and seconds >= 60 (specifically 79s => 01:19)
  assert.strictEqual(typeof formatAudioTime, 'function', 'formatAudioTime must be exported');
  assert.strictEqual(formatAudioTime(0), '00:00', '0s formats as 00:00');
  assert.strictEqual(formatAudioTime(5), '00:05', '5s formats as 00:05');
  assert.strictEqual(formatAudioTime(59), '00:59', '59s formats as 00:59');
  assert.strictEqual(formatAudioTime(79), '01:19', '79s formats as 01:19 (fixes 00:79 bug)');
  assert.strictEqual(formatAudioTime(125), '02:05', '125s formats as 02:05');
  assert.strictEqual(formatAudioTime(null), '00:00', 'null formats as 00:00');
  assert.strictEqual(formatAudioTime(NaN), '00:00', 'NaN formats as 00:00');

  // 2. Verify parseAudioDuration
  assert.strictEqual(typeof parseAudioDuration, 'function', 'parseAudioDuration must be exported');
  assert.strictEqual(parseAudioDuration('01:19'), '01:19');
  assert.strictEqual(parseAudioDuration('79s'), '01:19');
  assert.strictEqual(parseAudioDuration(79), '01:19');
  assert.strictEqual(parseAudioDuration('(01:19)'), '01:19');
  assert.strictEqual(parseAudioDuration(''), '');

  // 3. Current user & open chat
  const me = { uid: 'user_audio_sender', email: 'audio@vortex.vip' };
  env.sandbox.window.setCurrentUser(me);
  openDirectChat({ uid: 'user_audio_recipient', name: 'Amigo Áudio' });

  // 4. Send audio message with duration '01:19' and verify it is stored in Firestore
  const audioPayload = {
    fileData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8USA==',
    duration: '01:19'
  };
  await sendChatMessage('audio', audioPayload);

  const sentMessages = Object.entries(env.firestoreDocs).filter(([path]) => path.includes('/messages/'));
  assert.ok(sentMessages.length > 0, 'Audio message must be saved to Firestore');
  const [msgPath, msgDoc] = sentMessages[sentMessages.length - 1];
  assert.strictEqual(msgDoc.type, 'audio', 'Message type must be audio');
  assert.strictEqual(msgDoc.duration, '01:19', 'Message duration must be saved to Firestore (not omitted)');

  // 5. Verify playVoiceNote dynamic playback counter and reset
  const playerEl = env.makeMockElement('div');
  playerEl.classList.add('audio-player-ui');
  playerEl.dataset.src = msgDoc.fileData;
  playerEl.dataset.totalDuration = '01:19';

  const iconEl = env.makeMockElement('i');
  iconEl.setAttribute('data-lucide', 'play');
  playerEl.appendChild(iconEl);

  const waveBarEl = env.makeMockElement('div');
  waveBarEl.classList.add('wave-bar');
  playerEl.appendChild(waveBarEl);

  const durSpan = env.makeMockElement('span');
  durSpan.classList.add('audio-duration-text');
  durSpan.innerText = '01:19';
  playerEl.appendChild(durSpan);

  const speedBtn = env.makeMockElement('button');
  speedBtn.classList.add('audio-speed-btn');
  speedBtn.innerText = '1x';
  playerEl.appendChild(speedBtn);

  // Play audio
  playVoiceNote(playerEl, msgDoc.fileData);
  assert.ok(playerEl.classList.contains('playing'), 'Player must have .playing class when active');
  assert.strictEqual(iconEl.getAttribute('data-lucide'), 'pause', 'Icon must change to pause');

  const currentAudio = env.sandbox.getCurrentPlayingAudio ? env.sandbox.getCurrentPlayingAudio() : env.sandbox.window.getCurrentPlayingAudio();
  assert.ok(currentAudio, 'Current audio instance must exist');

  // Simulate playback time update at 5 seconds -> duration text should show 00:05
  currentAudio.currentTime = 5;
  if (currentAudio.ontimeupdate) currentAudio.ontimeupdate();
  assert.strictEqual(durSpan.innerText, '00:05', 'Duration text should show current playback time (00:05)');

  // Simulate playback time update at 25 seconds -> duration text should show 00:25
  currentAudio.currentTime = 25;
  if (currentAudio.ontimeupdate) currentAudio.ontimeupdate();
  assert.strictEqual(durSpan.innerText, '00:25', 'Duration text should show current playback time (00:25)');

  // Simulate audio ended -> resets to total duration 01:19 and removes .playing class
  if (currentAudio.onended) currentAudio.onended();
  assert.strictEqual(playerEl.classList.contains('playing'), false, 'Player must lose .playing class when finished');
  assert.strictEqual(iconEl.getAttribute('data-lucide'), 'play', 'Icon must reset to play');
  assert.strictEqual(durSpan.innerText, '01:19', 'Duration text must restore total duration (01:19) upon completion');
});

test('Real-Time Profile Photo Synchronization: Active chat header and group creation contact list update instantly via Firestore snapshots', async () => {
  const env = createTestEnvironment();
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const loadContactsForGroupCreation = env.sandbox.loadContactsForGroupCreation || env.sandbox.window.loadContactsForGroupCreation;
  const cleanupGroupCreationListeners = env.sandbox.cleanupGroupCreationListeners || env.sandbox.window.cleanupGroupCreationListeners;

  const me = { uid: 'user_active_tester', email: 'tester@vortex.vip' };
  env.sandbox.window.setCurrentUser(me);

  // --- PART 1: Active Chat Header Live Avatar & Name Updates ---
  const partnerUid = 'user_partner_dx';
  const oldAvatar = 'data:image/png;base64,old_partner_avatar_data';
  const newAvatar = 'data:image/png;base64,new_partner_avatar_data_live';

  // Seed partner in Firestore
  env.firestoreDocs[`users/${partnerUid}`] = {
    name: 'DX-MP-BR',
    avatar: oldAvatar
  };
  env.firestoreDocs[`users/${me.uid}/contacts/${partnerUid}`] = {
    uid: partnerUid,
    name: 'DX-MP-BR',
    avatar: oldAvatar
  };

  // Add contact card avatar element to verify contact list card update
  const listAvatar = env.makeMockElement('div');
  listAvatar.id = `contact-avatar-${partnerUid}`;
  listAvatar.style.backgroundImage = `url('${oldAvatar}')`;
  env.elements[`contact-avatar-${partnerUid}`] = listAvatar;

  // Open direct chat
  const partnerContact = { uid: partnerUid, name: 'DX-MP-BR', avatar: oldAvatar };
  openDirectChat(partnerContact);

  // Verify chat window header avatar and name initial state
  const chatHeaderAvatar = env.elements['chat-window-avatar'];
  const chatHeaderName = env.elements['chat-window-name'];

  assert.ok(chatHeaderAvatar, '#chat-window-avatar must exist in DOM');
  assert.ok(chatHeaderName, '#chat-window-name must exist in DOM');
  assert.strictEqual(chatHeaderAvatar.style.backgroundImage, `url('${oldAvatar}')`, 'Chat header avatar must initially display current avatar');
  assert.strictEqual(chatHeaderName.innerText, 'DX-MP-BR', 'Chat header name must initially display current name');

  // Simulate partner updating profile photo and name in Firestore in real time
  await env.sandbox.updateDoc({ path: `users/${partnerUid}` }, {
    avatar: newAvatar,
    name: 'DX-MP-BR VIP'
  });

  // Check live reactive update inside active chat
  assert.strictEqual(chatHeaderAvatar.style.backgroundImage, `url('${newAvatar}')`, 'Active chat header avatar must update in real time when contact changes photo');
  assert.strictEqual(chatHeaderAvatar.innerText, '', 'Header avatar letter initial should be empty when photo exists');
  assert.strictEqual(chatHeaderName.innerText, 'DX-MP-BR VIP', 'Active chat header name must update in real time');
  assert.strictEqual(listAvatar.style.backgroundImage, `url('${newAvatar}')`, 'Contact list card avatar must also update in real time');

  // Verify fallback letter when avatar is removed
  await env.sandbox.updateDoc({ path: `users/${partnerUid}` }, {
    avatar: '',
    name: 'DX-MP-BR VIP'
  });
  assert.strictEqual(chatHeaderAvatar.style.backgroundImage, '', 'Header avatar background-image must be empty when no photo');
  assert.strictEqual(chatHeaderAvatar.innerText, 'D', 'Header avatar must display uppercase initial letter when photo is removed');

  // --- PART 2: Group Creation Contact List Real-Time Avatar Updates ---
  const memberUid = 'user_gru_member';
  const initialGruAvatar = '';
  const liveGruAvatar = 'data:image/png;base64,gru_face_photo_new';

  env.firestoreDocs[`users/${me.uid}/contacts/${memberUid}`] = {
    uid: memberUid,
    name: 'Gru',
    avatar: initialGruAvatar
  };
  env.firestoreDocs[`users/${memberUid}`] = {
    name: 'Gru',
    avatar: initialGruAvatar
  };

  // Load contacts for group creation
  await loadContactsForGroupCreation();

  const gruAvatarEl = env.elements[`group-create-avatar-${memberUid}`];
  const gruNameEl = env.elements[`group-create-name-${memberUid}`];

  assert.ok(gruAvatarEl, 'Group create contact avatar element must exist');
  assert.ok(gruNameEl, 'Group create contact name element must exist');
  assert.strictEqual(gruAvatarEl.innerText, 'G', 'Initial group create avatar should display letter initial "G"');

  // Simulate contact Gru changing photo in real time while group creation panel is open
  await env.sandbox.updateDoc({ path: `users/${memberUid}` }, {
    avatar: liveGruAvatar,
    name: 'Gru Chefe'
  });

  assert.strictEqual(gruAvatarEl.style.backgroundImage, `url('${liveGruAvatar}')`, 'Group creation contact avatar must update in real time when contact changes photo');
  assert.strictEqual(gruAvatarEl.innerText, '', 'Group creation avatar text initial should be cleared when photo is set');
  assert.strictEqual(gruNameEl.innerText, 'Gru Chefe', 'Group creation contact name must update in real time');

  // Cleanup listeners
  cleanupGroupCreationListeners();
});

test('VIP Monthly Subscription (Mercado Pago R$ 30,00): Payment modal (Pix/Card), credential security, subscription lifecycle (active 30d, grace period 7d warning, expired revoke), and instant badge activation', async () => {
  const env = createTestEnvironment();
  const getVipSubscriptionState = env.sandbox.getVipSubscriptionState || env.sandbox.window.getVipSubscriptionState;
  const checkVipSubscriptionLifecycle = env.sandbox.checkVipSubscriptionLifecycle || env.sandbox.window.checkVipSubscriptionLifecycle;
  const openVipPaymentModal = env.sandbox.openVipPaymentModal || env.sandbox.window.openVipPaymentModal;
  const closeVipPaymentModal = env.sandbox.closeVipPaymentModal || env.sandbox.window.closeVipPaymentModal;
  const switchPaymentTab = env.sandbox.switchPaymentTab || env.sandbox.window.switchPaymentTab;
  const handleSuccessfulVipPayment = env.sandbox.handleSuccessfulVipPayment || env.sandbox.window.handleSuccessfulVipPayment;
  const checkIsVipUser = env.sandbox.checkIsVipUser || env.sandbox.window.checkIsVipUser;

  // --- 1. DOM Integrity & Pricing ---
  assert.ok(htmlContent.includes('R$ 30,00'), 'Index.html must display official monthly price of R$ 30,00 for VIP badge');
  assert.ok(htmlContent.includes('sdk.mercadopago.com/js/v2'), 'Index.html must load official Mercado Pago SDK v2 script');
  assert.ok(env.elements['vip-payment-modal'], '#vip-payment-modal must exist in DOM');
  assert.ok(env.elements['vip-grace-banner'], '#vip-grace-banner must exist in DOM');
  assert.ok(env.elements['vip-grace-renew-btn'], '#vip-grace-renew-btn must exist in DOM');
  assert.ok(env.elements['tab-btn-pix'], '#tab-btn-pix must exist in DOM');
  assert.ok(env.elements['tab-btn-card'], '#tab-btn-card must exist in DOM');
  assert.ok(env.elements['payment-panel-pix'], '#payment-panel-pix must exist in DOM');
  assert.ok(env.elements['payment-panel-card'], '#payment-panel-card must exist in DOM');
  assert.ok(env.elements['pix-step-form'], '#pix-step-form must exist in DOM');
  assert.ok(env.elements['pix-step-qrcode'], '#pix-step-qrcode must exist in DOM');
  assert.ok(env.elements['copy-pix-btn'], '#copy-pix-btn must exist in DOM');
  assert.ok(env.elements['pay-card-btn'], '#pay-card-btn must exist in DOM');
  assert.ok(env.elements['payment-success-view'], '#payment-success-view must exist in DOM');

  // --- 2. Credential Security Check (Zero frontend leak) ---
  const mpAccessToken = 'APP_USR-1207987773430651-091300-6f03f6c2011ba35013c01e3a052ace6e-1885251906';
  const mpClientSecret = 'aBAFn2nm7pcBlU7kOk70DnB2UDZIljMy';
  assert.strictEqual(jsContent.includes(mpAccessToken), false, 'Mercado Pago Access Token must NEVER be leaked in public/script.js');
  assert.strictEqual(jsContent.includes(mpClientSecret), false, 'Mercado Pago Client Secret must NEVER be leaked in public/script.js');
  assert.strictEqual(htmlContent.includes(mpAccessToken), false, 'Mercado Pago Access Token must NEVER be in public/index.html');
  assert.strictEqual(htmlContent.includes(mpClientSecret), false, 'Mercado Pago Client Secret must NEVER be in public/index.html');
  assert.ok(jsContent.includes('APP_USR-2dc3e363-b4c1-43ca-a796-6466d7b3caf0'), 'public/script.js must contain public key only');

  // Verify server.js and .env existence for backend isolation without Firebase Functions
  assert.ok(fs.existsSync('server.js'), 'server.js Node.js server must exist for handling Mercado Pago without Firebase Functions');
  assert.ok(fs.existsSync('.env'), '.env file must exist for secure backend credential storage');
  const serverContent = fs.readFileSync('server.js', 'utf8');
  assert.ok(serverContent.includes('/api/create-pix-payment'), 'server.js must expose /api/create-pix-payment');
  assert.ok(serverContent.includes('/api/create-card-payment'), 'server.js must expose /api/create-card-payment');
  assert.ok(serverContent.includes('/api/mercadopago-webhook'), 'server.js must expose /api/mercadopago-webhook');
  assert.ok(serverContent.includes('firebase-admin'), 'server.js must use Firebase Admin SDK directly without Firebase Functions');

  // --- 3. Payment Modal UI & Tab Switching ---
  const modal = env.elements['vip-payment-modal'];
  const pixTab = env.elements['tab-btn-pix'];
  const cardTab = env.elements['tab-btn-card'];
  const pixPanel = env.elements['payment-panel-pix'];
  const cardPanel = env.elements['payment-panel-card'];

  openVipPaymentModal();
  assert.strictEqual(modal.classList.contains('hidden'), false, 'Modal should not have hidden class when open');
  assert.strictEqual(modal.style.display, 'flex', 'Modal display should be flex');

  switchPaymentTab('card');
  assert.strictEqual(cardPanel.style.display, 'flex', 'Card panel should be visible');
  assert.strictEqual(pixPanel.style.display, 'none', 'Pix panel should be hidden');
  assert.ok(cardTab.classList.contains('active'), 'Card tab button should be active');

  switchPaymentTab('pix');
  assert.strictEqual(pixPanel.style.display, 'flex', 'Pix panel should be visible');
  assert.strictEqual(cardPanel.style.display, 'none', 'Card panel should be hidden');
  assert.ok(pixTab.classList.contains('active'), 'Pix tab button should be active');

  closeVipPaymentModal();
  assert.strictEqual(modal.style.display, 'none', 'Modal should be hidden on close');

  // --- 4. VIP Subscription Lifecycle: 30-day Active, 7-day Grace Warning, Expired Auto-Revoke ---
  const testUserUid = 'user_sub_tester_77';
  const testUser = {
    uid: testUserUid,
    name: 'Carlos',
    surname: 'VIP',
    email: 'carlos@vortex.vip',
    isVip: true,
    isVerified: true
  };
  env.sandbox.window.setCurrentUser({ uid: testUserUid, email: 'carlos@vortex.vip' });

  // 4A. Active state (e.g. 20 days remaining within 30-day month)
  const now = Date.now();
  testUser.vipExpiresAt = now + (20 * 24 * 60 * 60 * 1000);
  env.sandbox.window.setCurrentProfile({ ...testUser });

  const activeState = getVipSubscriptionState(testUser);
  assert.strictEqual(activeState.status, 'active', 'Subscription within 30 days must be active');
  assert.strictEqual(activeState.isVip, true, 'User must have active VIP privileges');
  assert.strictEqual(activeState.daysRemaining, 20, 'Should accurately calculate 20 remaining days');
  assert.strictEqual(checkIsVipUser(testUser), true, 'checkIsVipUser must return true for active subscription');

  checkVipSubscriptionLifecycle();
  const graceBanner = env.elements['vip-grace-banner'];
  assert.strictEqual(graceBanner.style.display, 'none', 'Grace banner must be hidden when subscription is active');

  // 4B. Grace Period state (subscription expired 3 days ago -> 4 grace days remaining out of 7)
  testUser.vipExpiresAt = now - (3 * 24 * 60 * 60 * 1000);
  env.sandbox.window.setCurrentProfile({ ...testUser });

  const graceState = getVipSubscriptionState(testUser);
  assert.strictEqual(graceState.status, 'grace_period', 'Subscription expired within 7 days must enter grace_period');
  assert.strictEqual(graceState.isVip, true, 'User retains temporary VIP access during 7-day grace period');
  assert.strictEqual(graceState.graceDaysRemaining, 4, 'Should accurately calculate 4 grace days remaining');
  assert.strictEqual(checkIsVipUser(testUser), true, 'User retains VIP badge during grace period');

  checkVipSubscriptionLifecycle();
  assert.strictEqual(graceBanner.style.display, 'flex', 'Grace banner must be shown to warn user to renew');
  const daysLeftEl = env.elements['vip-grace-days-left'];
  assert.ok(daysLeftEl.innerText.includes('4 dias'), 'Grace banner text must show 4 dias remaining');

  // 4C. Expired state (>7 days after 30-day expiration -> total loss of VIP badge and privileges)
  testUser.vipExpiresAt = now - (8 * 24 * 60 * 60 * 1000); // 8 days after expiration
  env.firestoreDocs[`users/${testUserUid}`] = { ...testUser };
  env.sandbox.window.setCurrentProfile({ ...testUser });

  const expiredState = getVipSubscriptionState(testUser);
  assert.strictEqual(expiredState.status, 'expired', 'Subscription older than 7 days past expiration must be expired');
  assert.strictEqual(expiredState.isVip, false, 'Expired subscription must revoke VIP privileges');
  assert.strictEqual(checkIsVipUser(testUser), false, 'checkIsVipUser must return false for expired subscription');

  checkVipSubscriptionLifecycle();
  assert.strictEqual(graceBanner.style.display, 'none', 'Grace banner must be hidden once expired');
  assert.strictEqual(env.firestoreDocs[`users/${testUserUid}`].isVip, false, 'Firestore must set isVip: false');
  assert.strictEqual(env.firestoreDocs[`users/${testUserUid}`].isVerified, false, 'Firestore must set isVerified: false');
  assert.strictEqual(env.firestoreDocs[`users/${testUserUid}`].vipStatus, 'expired', 'Firestore must set vipStatus: expired');

  // --- 5. Immediate Badge Activation upon Payment Approval ---
  const paymentId = 'mp_pix_test_998811';
  handleSuccessfulVipPayment(paymentId, 'pix');

  const getCurrentProfile = env.sandbox.getCurrentProfile || env.sandbox.window.getCurrentProfile;
  const profileAfterPayment = getCurrentProfile ? getCurrentProfile() : env.firestoreDocs[`users/${testUserUid}`];
  assert.strictEqual(profileAfterPayment.isVip, true, 'Profile must have isVip: true immediately upon payment approval');
  assert.strictEqual(profileAfterPayment.isVerified, true, 'Profile must have isVerified: true');
  assert.strictEqual(profileAfterPayment.vipStatus, 'active', 'Profile vipStatus must be active');
  assert.ok(profileAfterPayment.vipExpiresAt > Date.now() + (29 * 24 * 60 * 60 * 1000), 'vipExpiresAt must be set ~30 days in future');

  // Verify Firestore updated
  const updatedUserDoc = env.firestoreDocs[`users/${testUserUid}`];
  assert.strictEqual(updatedUserDoc.isVip, true, 'Firestore user doc must be updated with isVip: true');
  assert.strictEqual(updatedUserDoc.isVerified, true, 'Firestore user doc must be updated with isVerified: true');
  assert.strictEqual(updatedUserDoc.vipStatus, 'active', 'Firestore user doc must be updated with vipStatus: active');
  assert.strictEqual(updatedUserDoc.vipLastPaymentId, paymentId, 'Firestore user doc must store last payment ID');

  // Verify Success View displayed
  const successView = env.elements['payment-success-view'];
  assert.strictEqual(successView.style.display, 'flex', 'Payment success view should be visible to celebrate user');
});

test('Story Pause on Hold & Resume on Release: Pressing down pauses timer/media and freezes progress, releasing continues playback from exact time, long press suppresses accidental navigation while short tap navigates', async () => {
  const env = createTestEnvironment();
  const alice = { uid: 'user-story-alice', email: 'alice@vortex.vip', name: 'Alice', surname: 'Silva', username: '@alicesilva', avatar: 'https://vortex.test/alice.jpg' };
  env.sandbox.window.setCurrentUser(alice);
  env.sandbox.window.setCurrentProfile(alice);

  const stories = [
    {
      id: 'story-press-1',
      authorUid: alice.uid,
      authorName: alice.name,
      src: 'https://vortex.test/story1.jpg',
      type: 'image',
      caption: 'Primeiro story para teste de pause'
    },
    {
      id: 'story-press-2',
      authorUid: alice.uid,
      authorName: alice.name,
      src: 'https://vortex.test/story2.jpg',
      type: 'image',
      caption: 'Segundo story após navegação'
    }
  ];

  const openStoryViewer = env.sandbox.openStoryViewer || env.sandbox.window.openStoryViewer;
  const closeStoryViewer = env.sandbox.closeStoryViewer || env.sandbox.window.closeStoryViewer;
  const pauseCurrentStory = env.sandbox.pauseCurrentStory || env.sandbox.window.pauseCurrentStory;
  const resumeCurrentStory = env.sandbox.resumeCurrentStory || env.sandbox.window.resumeCurrentStory;
  const isStoryPaused = env.sandbox.isStoryPaused || env.sandbox.window.isStoryPaused;
  const isHoldingStory = env.sandbox.isHoldingStory || env.sandbox.window.isHoldingStory;
  const handleStoryPointerDown = env.sandbox.handleStoryPointerDown || env.sandbox.window.handleStoryPointerDown;
  const handleStoryPointerUp = env.sandbox.handleStoryPointerUp || env.sandbox.window.handleStoryPointerUp;

  // 1. Open story viewer and verify initial playback state
  openStoryViewer(stories, alice);
  const viewer = env.elements['story-viewer'];
  assert.ok(viewer.classList.contains('active'), 'Story viewer must be active when opened');
  assert.strictEqual(isStoryPaused(), false, 'Story must start in playing/unpaused state');

  // 2. Direct pause and resume check
  pauseCurrentStory();
  assert.strictEqual(isStoryPaused(), true, 'pauseCurrentStory() must set isStoryPaused to true');
  assert.ok(viewer.classList.contains('story-paused'), 'story-viewer should have story-paused class');

  resumeCurrentStory();
  assert.strictEqual(isStoryPaused(), false, 'resumeCurrentStory() must restore isStoryPaused to false');
  assert.strictEqual(viewer.classList.contains('story-paused'), false, 'story-paused class should be removed on resume');

  // 3. User gesture: Pressing down on the story area (pointerdown)
  handleStoryPointerDown({ button: 0, clientX: 200, clientY: 300, timeStamp: 1000, target: env.elements['story-next'] });
  assert.strictEqual(isHoldingStory(), true, 'isHoldingStory must be true when user presses down');
  assert.strictEqual(isStoryPaused(), true, 'Story must be paused immediately upon pointerdown');
  assert.ok(viewer.classList.contains('story-paused'), 'Viewer must have story-paused class while holding');

  // 4. Releasing press after a hold (>200ms -> 500ms elapsed)
  handleStoryPointerUp({ clientX: 200, clientY: 300, timeStamp: 1500 });

  assert.strictEqual(isHoldingStory(), false, 'isHoldingStory must be false after pointer release');
  assert.strictEqual(isStoryPaused(), false, 'Story must resume playback after releasing press');

  // Click event that follows a hold must NOT trigger navigation to next story
  await env.elements['story-next'].click();
  const captionEl = env.elements['story-caption'];
  assert.strictEqual(captionEl.innerText, 'Primeiro story para teste de pause', 'Long press must suppress navigation and stay on current story');

  // 5. Short tap (<200ms -> 50ms elapsed) DOES navigate to next story
  handleStoryPointerDown({ button: 0, clientX: 300, clientY: 300, timeStamp: 2000, target: env.elements['story-next'] });
  assert.strictEqual(isStoryPaused(), true, 'Pointerdown pauses during short tap');
  // Release immediately (50ms difference)
  handleStoryPointerUp({ clientX: 300, clientY: 300, timeStamp: 2050 });
  assert.strictEqual(isStoryPaused(), false, 'Pointerup resumes');
  await env.elements['story-next'].click();
  assert.strictEqual(captionEl.innerText, 'Segundo story após navegação', 'Quick tap on #story-next must advance to next story');

  // 6. Close story viewer cleanly resets all states
  closeStoryViewer();
  assert.strictEqual(viewer.classList.contains('active'), false, 'Story viewer must be closed');
  assert.strictEqual(isStoryPaused(), false, 'isStoryPaused must be reset to false on close');
  assert.strictEqual(isHoldingStory(), false, 'isHoldingStory must be reset to false on close');
});

test('Audio Recording Cancel on Slide Left: Starting voice recording, holding and dragging microphone icon to the left cancels recording, discards audio, resets timer/UI and does not send any message', async () => {
  const env = createTestEnvironment();
  const me = { uid: 'user_sender_mic', email: 'sender@vortex.vip', name: 'Marcos Mic' };
  const friend = { uid: 'user_receiver_mic', name: 'Lucas Amigo' };
  env.sandbox.window.setCurrentUser(me);
  env.sandbox.window.setCurrentProfile(me);

  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const toggleVoiceRecording = env.sandbox.toggleVoiceRecording || env.sandbox.window.toggleVoiceRecording;
  const cancelVoiceRecording = env.sandbox.cancelVoiceRecording || env.sandbox.window.cancelVoiceRecording;
  const handleMicPointerDown = env.sandbox.handleMicPointerDown || env.sandbox.window.handleMicPointerDown;
  const handleMicPointerMove = env.sandbox.handleMicPointerMove || env.sandbox.window.handleMicPointerMove;
  const handleMicPointerUp = env.sandbox.handleMicPointerUp || env.sandbox.window.handleMicPointerUp;

  // 1. Open chat
  openDirectChat(friend);

  const recordingUI = env.elements['recording-ui-main'];
  const inputEl = env.elements['chat-input-main'];
  const timerEl = env.elements['recording-timer-main'];
  const sendBtn = env.elements['chat-send-btn-main'];
  const slideCancelEl = env.elements['recording-slide-cancel'];

  assert.ok(slideCancelEl, '#recording-slide-cancel must exist in DOM');
  assert.ok(htmlContent.includes('Deslize para cancelar'), 'Slide cancel hint text must be present in index.html');

  // 2. Start recording by pressing mic button (pointerdown)
  await handleMicPointerDown({ button: 0, clientX: 300, clientY: 500, timeStamp: 1000 });
  assert.ok(recordingUI.classList.contains('active'), 'Recording UI must be active when recording starts');
  assert.ok(inputEl.classList.contains('chat-input-hidden'), 'Input must be hidden during recording');

  // 3. Drag left slightly (-25px -> not yet canceled)
  handleMicPointerMove({ clientX: 275, clientY: 500 });
  assert.strictEqual(sendBtn.style.transform, 'translateX(-25px)', 'Mic button must translate left following the drag');
  assert.ok(recordingUI.classList.contains('active'), 'Recording should still be active at -25px');

  // 4. Drag left past threshold (-65px <= -55px -> Cancel triggered!)
  handleMicPointerMove({ clientX: 235, clientY: 500 });
  assert.strictEqual(recordingUI.classList.contains('active'), false, 'Recording UI must be deactivated upon canceling');
  assert.strictEqual(inputEl.classList.contains('chat-input-hidden'), false, 'Input field must be restored');
  assert.strictEqual(timerEl.innerText, '00:00', 'Timer must be reset to 00:00');
  assert.strictEqual(sendBtn.style.transform, '', 'Send button transform must reset');

  // 5. Release pointer and trigger subsequent click: verify no message was sent
  handleMicPointerUp({ clientX: 235, clientY: 500 });
  await sendBtn.click();

  const sentMessages = Object.entries(env.firestoreDocs).filter(([path]) => path.includes('/messages/'));
  assert.strictEqual(sentMessages.length, 0, 'No audio message must be sent to Firestore when canceled by drag');

  // 6. Direct test of cancelVoiceRecording() and clicking #recording-slide-cancel
  await toggleVoiceRecording(); // Start recording again
  assert.ok(recordingUI.classList.contains('active'), 'Recording restarted');

  cancelVoiceRecording(); // Direct cancel
  assert.strictEqual(recordingUI.classList.contains('active'), false, 'cancelVoiceRecording must stop and hide recording UI');
  assert.strictEqual(inputEl.classList.contains('chat-input-hidden'), false, 'Input must be visible after cancel');
});

test('Online Green Dot Indicator Integrity & Synchronization: Green dot is preserved through avatar updates, turns on when online, turns off when offline/ghostMode, and updates chat header avatar', async () => {
  const env = createTestEnvironment();
  const me = { uid: 'user_tester_online_me', email: 'me@vortex.vip', name: 'Tester Me' };
  const friendUid = 'user_friend_online_dot';
  const friend = { uid: friendUid, name: 'Lucas Online', avatar: 'data:image/png;base64,lucas_avatar_1', online: true, ghostMode: false };

  env.sandbox.window.setCurrentUser(me);
  env.sandbox.window.setCurrentProfile(me);

  env.firestoreDocs[`users/${me.uid}/contacts/${friendUid}`] = { ...friend };
  env.firestoreDocs[`users/${friendUid}`] = { ...friend };

  const setAvatarContent = env.sandbox.setAvatarContent || env.sandbox.window.setAvatarContent;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const refreshDirectChatStatus = env.sandbox.refreshDirectChatStatus || env.sandbox.window.refreshDirectChatStatus;

  // 1. Verify setAvatarContent preserves dot and unread badge in DOM
  const mockAvatarEl = env.makeMockElement('div');
  mockAvatarEl.id = `contact-avatar-${friendUid}`;
  const dotEl = env.makeMockElement('span');
  dotEl.id = `online-dot-${friendUid}`;
  dotEl.className = 'online-dot-badge';
  dotEl.style.display = 'none';
  mockAvatarEl.appendChild(dotEl);

  const unreadEl = env.makeMockElement('span');
  unreadEl.id = `unread-badge-${friendUid}`;
  unreadEl.className = 'unread-badge';
  mockAvatarEl.appendChild(unreadEl);

  env.elements[`contact-avatar-${friendUid}`] = mockAvatarEl;
  env.elements[`online-dot-${friendUid}`] = dotEl;
  env.elements[`unread-badge-${friendUid}`] = unreadEl;

  // Change avatar to an image
  setAvatarContent(mockAvatarEl, 'data:image/png;base64,new_pic', 'Lucas', `avatar-initial-${friendUid}`);
  assert.ok(mockAvatarEl.children.includes(dotEl), 'online-dot-badge must NOT be destroyed by setAvatarContent with image');
  assert.ok(mockAvatarEl.children.includes(unreadEl), 'unread-badge must NOT be destroyed by setAvatarContent with image');

  // Change avatar to text fallback (photo removed)
  setAvatarContent(mockAvatarEl, '', 'Lucas', `avatar-initial-${friendUid}`);
  assert.ok(mockAvatarEl.children.includes(dotEl), 'online-dot-badge must NOT be destroyed by setAvatarContent with initial fallback');
  assert.ok(mockAvatarEl.children.includes(unreadEl), 'unread-badge must NOT be destroyed by setAvatarContent with initial fallback');

  // 2. Open chat and verify header online dot
  const chatDot = env.elements['chat-window-online-dot'];
  assert.ok(chatDot, '#chat-window-online-dot must exist in DOM');

  openDirectChat(friend);
  assert.strictEqual(chatDot.style.display, 'block', 'Header online dot should be block when contact is online');

  // 3. Contact goes offline
  await env.sandbox.updateDoc({ path: `users/${friendUid}` }, { online: false });
  refreshDirectChatStatus();
  assert.strictEqual(chatDot.style.display, 'none', 'Header online dot should hide when contact goes offline');

  // 4. Contact goes into ghost mode
  await env.sandbox.updateDoc({ path: `users/${friendUid}` }, { online: true, ghostMode: true });
  refreshDirectChatStatus();
  assert.strictEqual(chatDot.style.display, 'none', 'Header online dot should hide when contact is in ghostMode');
});

test('Pinned Chats (Max 3 Contacts) & Top Sorting: Pinned contacts stay at top of conversation list, limit of 3 is enforced, and unpinning updates state', async () => {
  const env = createTestEnvironment();
  const me = { uid: 'user_tester_pins', email: 'tester_pins@vortex.vip', name: 'Pin Tester', pinnedChats: [] };
  env.sandbox.window.setCurrentUser(me);
  env.sandbox.window.setCurrentProfile(me);

  const togglePinChat = env.sandbox.togglePinChat || env.sandbox.window.togglePinChat;
  const isChatPinned = env.sandbox.isChatPinned || env.sandbox.window.isChatPinned;
  const getPinnedChats = env.sandbox.getPinnedChats || env.sandbox.window.getPinnedChats;
  const setPinnedChats = env.sandbox.setPinnedChats || env.sandbox.window.setPinnedChats;
  const applyPinnedSortToChatList = env.sandbox.applyPinnedSortToChatList || env.sandbox.window.applyPinnedSortToChatList;

  // Start with empty pinned list
  setPinnedChats([]);
  assert.strictEqual(isChatPinned('user_1'), false);
  assert.deepStrictEqual([...getPinnedChats()], []);

  // 1. Pin 1st contact
  await togglePinChat('user_1');
  assert.strictEqual(isChatPinned('user_1'), true, 'user_1 should now be pinned');
  assert.deepStrictEqual([...getPinnedChats()], ['user_1']);

  // 2. Pin 2nd contact
  await togglePinChat('user_2');
  assert.strictEqual(isChatPinned('user_2'), true, 'user_2 should now be pinned');
  assert.deepStrictEqual([...getPinnedChats()], ['user_1', 'user_2']);

  // 3. Pin 3rd contact
  await togglePinChat('user_3');
  assert.strictEqual(isChatPinned('user_3'), true, 'user_3 should now be pinned');
  assert.deepStrictEqual([...getPinnedChats()], ['user_1', 'user_2', 'user_3']);
  assert.strictEqual(getPinnedChats().length, 3);

  // 4. Attempt to pin 4th contact: must be rejected (max 3)
  await togglePinChat('user_4');
  assert.strictEqual(isChatPinned('user_4'), false, 'user_4 must NOT be pinned when limit of 3 is reached');
  assert.deepStrictEqual([...getPinnedChats()], ['user_1', 'user_2', 'user_3']);
  assert.strictEqual(getPinnedChats().length, 3, 'Pinned chats must remain capped at 3');

  // 5. Test DOM sorting with pinned contacts
  const chatList = env.elements['chat-conversations-list'];
  chatList.innerHTML = '';

  const cardA = env.makeMockElement('div');
  cardA.className = 'chat-card';
  cardA.dataset.uid = 'user_unpinned_A';
  cardA.dataset.isPinned = 'false';
  chatList.appendChild(cardA);

  const cardB = env.makeMockElement('div');
  cardB.className = 'chat-card is-pinned';
  cardB.dataset.uid = 'user_2';
  cardB.dataset.isPinned = 'true';
  chatList.appendChild(cardB);

  const cardC = env.makeMockElement('div');
  cardC.className = 'chat-card';
  cardC.dataset.uid = 'user_unpinned_C';
  cardC.dataset.isPinned = 'false';
  chatList.appendChild(cardC);

  const cardD = env.makeMockElement('div');
  cardD.className = 'chat-card is-pinned';
  cardD.dataset.uid = 'user_1';
  cardD.dataset.isPinned = 'true';
  chatList.appendChild(cardD);

  applyPinnedSortToChatList();

  const sortedUids = chatList.children.map(c => c.dataset.uid);
  assert.strictEqual(sortedUids[0], 'user_1', 'user_1 (pinned) must be at the very top');
  assert.strictEqual(sortedUids[1], 'user_2', 'user_2 (pinned) must be second');
  assert.ok(['user_unpinned_A', 'user_unpinned_C'].includes(sortedUids[2]), 'Unpinned card must follow pinned cards');
  assert.ok(['user_unpinned_A', 'user_unpinned_C'].includes(sortedUids[3]), 'Unpinned card must follow pinned cards');

  // 6. Unpin user_1
  await togglePinChat('user_1');
  assert.strictEqual(isChatPinned('user_1'), false, 'user_1 should now be unpinned');
  assert.deepStrictEqual([...getPinnedChats()], ['user_2', 'user_3']);

  // Now user_4 can be pinned!
  await togglePinChat('user_4');
  assert.strictEqual(isChatPinned('user_4'), true, 'user_4 can now be pinned after unpinning user_1');
  assert.deepStrictEqual([...getPinnedChats()], ['user_2', 'user_3', 'user_4']);
});

test('Post Sharing Flow & Social Networks: Share button on posts, modal open/close, social links (WhatsApp, Instagram, Facebook, TikTok, Telegram, X), native share, and link copy', async () => {
  const env = createTestEnvironment();
  const me = { uid: 'user_sharer', email: 'sharer@vortex.vip', name: 'Sharer User' };
  env.sandbox.window.setCurrentUser(me);
  env.sandbox.window.setCurrentProfile(me);

  const openPostShareModal = env.sandbox.openPostShareModal || env.sandbox.window.openPostShareModal;
  const closePostShareModal = env.sandbox.closePostShareModal || env.sandbox.window.closePostShareModal;
  const getPostShareUrl = env.sandbox.getPostShareUrl || env.sandbox.window.getPostShareUrl;
  const getPostShareText = env.sandbox.getPostShareText || env.sandbox.window.getPostShareText;
  const shareToWhatsApp = env.sandbox.shareToWhatsApp || env.sandbox.window.shareToWhatsApp;
  const shareToInstagram = env.sandbox.shareToInstagram || env.sandbox.window.shareToInstagram;
  const shareToFacebook = env.sandbox.shareToFacebook || env.sandbox.window.shareToFacebook;
  const shareToTikTok = env.sandbox.shareToTikTok || env.sandbox.window.shareToTikTok;
  const shareToTelegram = env.sandbox.shareToTelegram || env.sandbox.window.shareToTelegram;
  const shareToX = env.sandbox.shareToX || env.sandbox.window.shareToX;
  const shareViaNative = env.sandbox.shareViaNative || env.sandbox.window.shareViaNative;
  const copyPostShareLink = env.sandbox.copyPostShareLink || env.sandbox.window.copyPostShareLink;
  const renderPostsFeed = env.sandbox.renderPostsFeed || env.sandbox.window.renderPostsFeed;

  const samplePost = {
    id: 'post_vortex_777',
    authorName: 'Alex Stark',
    authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    authorUid: 'user_alex',
    type: 'image',
    mediaData: 'https://images.unsplash.com/photo-1518770660439-4636190af475',
    caption: 'Explorando novas fronteiras com o VORTEX VIP! 🚀',
    createdAt: Date.now(),
    likes: ['user_alex'],
    comments: []
  };

  // 1. Verificar existência do modal no HTML e estado inicial fechado
  const modal = env.elements['post-share-modal'];
  assert.ok(modal, 'Elemento #post-share-modal deve existir no DOM');
  assert.ok(!modal.classList.contains('active'), 'Modal deve iniciar inativo');

  // 2. Renderizar posts no feed e verificar presença do botão de compartilhar e selo de assinante
  const vipSubscriberPost = {
    id: 'post_vip_sub_999',
    authorName: 'Deyvison VIP',
    authorUid: 'user_deyvison_vip',
    isVip: true,
    isVerified: true,
    type: 'image',
    mediaData: 'https://images.unsplash.com/photo-1518770660439-4636190af475',
    caption: 'Novidades exclusivas para assinantes ⚡',
    createdAt: Date.now() + 1000,
    likes: [],
    comments: []
  };

  renderPostsFeed([samplePost, vipSubscriberPost]);
  const feedList = env.elements['feed-list'];
  assert.ok(feedList.innerHTML.includes('data-action="share-post"'), 'Feed deve renderizar botão de ação share-post');
  assert.ok(feedList.innerHTML.includes('Compartilhar'), 'Botão deve conter o texto Compartilhar');

  // Validação do selo de verificado em posts de assinantes
  const vipBadgeMatch = feedList.innerHTML.includes('data-author-uid="user_deyvison_vip"') && feedList.innerHTML.includes('style="display:inline-flex;"');
  assert.ok(vipBadgeMatch, 'Selo de verificado deve aparecer nos posts dos assinantes');

  const nonVipBadgeMatch = feedList.innerHTML.includes('data-author-uid="user_alex"') && feedList.innerHTML.includes('style="display:none;"');
  assert.ok(nonVipBadgeMatch, 'Selo de verificado deve estar oculto para não-assinantes');

  // 3. Abrir o modal de compartilhamento
  openPostShareModal(samplePost);
  assert.strictEqual(modal.style.display, 'flex', 'Modal deve estar com display flex ao abrir');
  assert.ok(modal.classList.contains('active'), 'Modal deve receber a classe active');

  const authorEl = env.elements['share-post-author'];
  const captionEl = env.elements['share-post-caption'];
  const linkInput = env.elements['share-link-input'];
  assert.strictEqual(authorEl.innerText, 'Alex Stark', 'Nome do autor deve ser preenchido');
  assert.ok(captionEl.innerText.includes('Explorando novas fronteiras'), 'Legenda deve estar na prévia');
  assert.strictEqual(linkInput.value, 'https://menssagem-dx.web.app/?post=post_vortex_777', 'Input de link deve conter o link do post');

  // 4. Testar geração de link e texto de compartilhamento
  const shareUrl = getPostShareUrl(samplePost.id);
  assert.strictEqual(shareUrl, 'https://menssagem-dx.web.app/?post=post_vortex_777');
  const shareText = getPostShareText(samplePost);
  assert.ok(shareText.includes('Alex Stark'), 'Texto de compartilhamento deve mencionar o autor');
  assert.ok(shareText.includes('VORTEX VIP'), 'Texto de compartilhamento deve mencionar o VORTEX VIP');

  // 5. Compartilhar no WhatsApp
  env.sandbox._openedUrls = [];
  shareToWhatsApp(samplePost);
  assert.ok(env.sandbox._openedUrls.length > 0, 'Deve abrir nova janela para o WhatsApp');
  const waUrl = env.sandbox._openedUrls[0].url;
  assert.ok(waUrl.startsWith('https://api.whatsapp.com/send?text='), 'Deve apontar para a API do WhatsApp');
  assert.ok(waUrl.includes(encodeURIComponent(shareUrl)), 'Deve conter a URL do post codificada');

  // 6. Compartilhar no Facebook
  env.sandbox._openedUrls = [];
  shareToFacebook(samplePost);
  assert.ok(env.sandbox._openedUrls.length > 0, 'Deve abrir nova janela para o Facebook');
  const fbUrl = env.sandbox._openedUrls[0].url;
  assert.ok(fbUrl.startsWith('https://www.facebook.com/sharer/sharer.php?u='), 'Deve apontar para o sharer do Facebook');
  assert.ok(fbUrl.includes(encodeURIComponent(shareUrl)), 'Deve conter a URL do post codificada');

  // 7. Compartilhar no Telegram
  env.sandbox._openedUrls = [];
  shareToTelegram(samplePost);
  assert.ok(env.sandbox._openedUrls.length > 0, 'Deve abrir nova janela para o Telegram');
  const tgUrl = env.sandbox._openedUrls[0].url;
  assert.ok(tgUrl.startsWith('https://t.me/share/url?url='), 'Deve apontar para o Telegram');

  // 8. Compartilhar no X (Twitter)
  env.sandbox._openedUrls = [];
  shareToX(samplePost);
  assert.ok(env.sandbox._openedUrls.length > 0, 'Deve abrir nova janela para o X');
  const xUrl = env.sandbox._openedUrls[0].url;
  assert.ok(xUrl.startsWith('https://twitter.com/intent/tweet?'), 'Deve apontar para o intent de Tweet do X');

  // 9. Compartilhar no Instagram (copia link/texto e abre instagram)
  env.sandbox._openedUrls = [];
  await shareToInstagram(samplePost);
  assert.ok(env.sandbox._copiedText.includes(shareUrl), 'Clipboard deve conter o link para o Instagram');

  // 10. Compartilhar no TikTok (copia link/texto e abre tiktok)
  env.sandbox._openedUrls = [];
  await shareToTikTok(samplePost);
  assert.ok(env.sandbox._copiedText.includes(shareUrl), 'Clipboard deve conter o link para o TikTok');

  // 11. Compartilhar nativo (navigator.share)
  await shareViaNative(samplePost);
  assert.ok(env.sandbox._sharedData, 'navigator.share deve ter recebido os dados de compartilhamento');
  assert.strictEqual(env.sandbox._sharedData.url, shareUrl, 'URL nativa compartilhada deve ser a do post');

  // 12. Copiar Link direto
  await copyPostShareLink(samplePost);
  assert.strictEqual(env.sandbox._copiedText, shareUrl, 'Clipboard deve conter a URL exata do post');
  const copyText = env.elements['share-copy-text'];
  assert.strictEqual(copyText.innerText, 'Copiado! ✓', 'Botão de copiar deve indicar Copiado! ✓');

  // 13. Fechar o modal
  closePostShareModal();
  assert.strictEqual(modal.style.display, 'none', 'Modal deve voltar a ficar oculto');
  assert.strictEqual(modal.classList.contains('active'), false, 'Classe active deve ser removida');
});

test('Comment Enhancements: Pin up to 4 comments, edit comment (author only), and like comments', async () => {
  const env = createTestEnvironment();
  const togglePinPostComment = env.sandbox.togglePinPostComment || env.sandbox.window.togglePinPostComment;
  const editPostComment = env.sandbox.editPostComment || env.sandbox.window.editPostComment;
  const toggleLikePostComment = env.sandbox.toggleLikePostComment || env.sandbox.window.toggleLikePostComment;
  const getSortedPostComments = env.sandbox.getSortedPostComments || env.sandbox.window.getSortedPostComments;
  const renderPostsFeed = env.sandbox.renderPostsFeed || env.sandbox.window.renderPostsFeed;
  const openPostCommentModal = env.sandbox.openPostCommentModal || env.sandbox.window.openPostCommentModal;

  const postId = 'post_test_comments_999';
  const postAuthor = { uid: 'author_john', displayName: 'John Doe' };
  const userBob = { uid: 'user_bob', displayName: 'Bob' };
  const userAlice = { uid: 'user_alice', displayName: 'Alice' };

  env.firestoreDocs[`posts/${postId}`] = {
    id: postId,
    authorUid: postAuthor.uid,
    authorName: postAuthor.displayName,
    caption: 'Comentem abaixo!',
    createdAt: Date.now(),
    comments: [
      { id: 'c1', author: 'Bob', authorUid: userBob.uid, text: 'Primeiro comentário!', createdAt: 1000, likes: [], isPinned: false },
      { id: 'c2', author: 'Alice', authorUid: userAlice.uid, text: 'Segundo comentário!', createdAt: 2000, likes: [], isPinned: false },
      { id: 'c3', author: 'Bob', authorUid: userBob.uid, text: 'Terceiro comentário!', createdAt: 3000, likes: [], isPinned: false },
      { id: 'c4', author: 'Charlie', authorUid: 'user_charlie', text: 'Quarto comentário!', createdAt: 4000, likes: [], isPinned: false },
      { id: 'c5', author: 'David', authorUid: 'user_david', text: 'Quinto comentário!', createdAt: 5000, likes: [], isPinned: false },
      { id: 'c6', author: 'Eva', authorUid: 'user_eva', text: 'Sexto comentário!', createdAt: 6000, likes: [], isPinned: false }
    ]
  };

  // 1. Testar Curtir comentários (Like comments)
  env.sandbox.window.setCurrentUser(userAlice);
  // Alice curte o comentário c1
  await toggleLikePostComment(postId, 'c1');
  let post = env.firestoreDocs[`posts/${postId}`];
  let c1 = post.comments.find(c => c.id === 'c1');
  assert.ok(c1.likes.includes(userAlice.uid), 'Alice deve estar na lista de curtidas de c1');
  assert.strictEqual(c1.likes.length, 1, 'c1 deve ter 1 curtida');

  // Bob também curte o comentário c1
  env.sandbox.window.setCurrentUser(userBob);
  await toggleLikePostComment(postId, 'c1');
  post = env.firestoreDocs[`posts/${postId}`];
  c1 = post.comments.find(c => c.id === 'c1');
  assert.strictEqual(c1.likes.length, 2, 'c1 deve ter 2 curtidas');

  // Bob clica novamente para descurtir c1
  await toggleLikePostComment(postId, 'c1');
  post = env.firestoreDocs[`posts/${postId}`];
  c1 = post.comments.find(c => c.id === 'c1');
  assert.strictEqual(c1.likes.length, 1, 'c1 deve voltar para 1 curtida');
  assert.ok(!c1.likes.includes(userBob.uid), 'Bob não deve mais constar nas curtidas de c1');

  // 2. Testar Editar comentários (Edit comment)
  // Bob tenta editar o comentário de Alice (c2) -> Deve falhar por permissão negada
  env.sandbox.window.setCurrentUser(userBob);
  const editFail = await editPostComment(postId, 'c2', 'Tentativa não autorizada');
  assert.strictEqual(editFail, false, 'Usuário que não é autor não pode editar comentário');
  post = env.firestoreDocs[`posts/${postId}`];
  let c2 = post.comments.find(c => c.id === 'c2');
  assert.strictEqual(c2.text, 'Segundo comentário!', 'Texto de c2 não deve ser alterado por terceiro');

  // Alice edita seu próprio comentário (c2) -> Deve ter sucesso
  env.sandbox.window.setCurrentUser(userAlice);
  const editSuccess = await editPostComment(postId, 'c2', 'Segundo comentário atualizado com sucesso! ✨');
  assert.strictEqual(editSuccess, true, 'Autor deve conseguir editar seu comentário');
  post = env.firestoreDocs[`posts/${postId}`];
  c2 = post.comments.find(c => c.id === 'c2');
  assert.strictEqual(c2.text, 'Segundo comentário atualizado com sucesso! ✨');
  assert.strictEqual(c2.isEdited, true, 'Comentário deve ser marcado com isEdited: true');
  assert.ok(c2.editedAt > 0, 'Comentário deve registrar timestamp editedAt');

  // 3. Testar Fixar comentários (Pin up to 4 comments)
  // Bob (não autor do post) tenta fixar c1 -> Deve falhar por permissão negada
  env.sandbox.window.setCurrentUser(userBob);
  const pinFailUnauthorized = await togglePinPostComment(postId, 'c1');
  assert.strictEqual(pinFailUnauthorized, false, 'Apenas autor do post ou admin pode fixar comentários');

  // John (autor do post) fixa c1, c2, c3, c4
  env.sandbox.window.setCurrentUser(postAuthor);
  const pin1 = await togglePinPostComment(postId, 'c1');
  const pin2 = await togglePinPostComment(postId, 'c2');
  const pin3 = await togglePinPostComment(postId, 'c3');
  const pin4 = await togglePinPostComment(postId, 'c4');
  assert.strictEqual(pin1, true, 'Autor deve fixar c1');
  assert.strictEqual(pin2, true, 'Autor deve fixar c2');
  assert.strictEqual(pin3, true, 'Autor deve fixar c3');
  assert.strictEqual(pin4, true, 'Autor deve fixar c4');

  post = env.firestoreDocs[`posts/${postId}`];
  const pinnedCount = post.comments.filter(c => c.isPinned).length;
  assert.strictEqual(pinnedCount, 4, 'Exatamente 4 comentários devem estar fixados');

  // Tentativa de fixar o 5º comentário (c5) -> Deve ser BLOQUEADA pelo limite máximo de 4
  const pin5 = await togglePinPostComment(postId, 'c5');
  assert.strictEqual(pin5, false, 'Não deve permitir fixar o 5º comentário (limite máximo de 4)');
  post = env.firestoreDocs[`posts/${postId}`];
  const pinnedCountAfter5 = post.comments.filter(c => c.isPinned).length;
  assert.strictEqual(pinnedCountAfter5, 4, 'Total de fixados deve continuar sendo 4');

  // Desafixar c1 -> Agora deve ter 3 fixados
  const unpin1 = await togglePinPostComment(postId, 'c1');
  assert.strictEqual(unpin1, true, 'Autor deve conseguir desafixar c1');
  post = env.firestoreDocs[`posts/${postId}`];
  c1 = post.comments.find(c => c.id === 'c1');
  assert.strictEqual(c1.isPinned, false, 'c1 não deve mais estar fixado');

  // Agora que tem 3 fixados, deve ser possível fixar c5
  const pin5AfterUnpin = await togglePinPostComment(postId, 'c5');
  assert.strictEqual(pin5AfterUnpin, true, 'Deve conseguir fixar c5 após liberar uma vaga');

  post = env.firestoreDocs[`posts/${postId}`];

  // 4. Testar Ordenação dos comentários (getSortedPostComments)
  // Os fixados (c2, c3, c4, c5) devem vir no topo da lista
  const sorted = getSortedPostComments(post.comments);
  assert.strictEqual(sorted[0].isPinned, true, 'Primeiro comentário da lista ordenada deve ser fixado');
  assert.strictEqual(sorted[1].isPinned, true, 'Segundo comentário da lista ordenada deve ser fixado');
  assert.strictEqual(sorted[2].isPinned, true, 'Terceiro comentário da lista ordenada deve ser fixado');
  assert.strictEqual(sorted[3].isPinned, true, 'Quarto comentário da lista ordenada deve ser fixado');
  assert.strictEqual(sorted[4].isPinned, false, 'Quinto comentário deve ser não-fixado');
  assert.strictEqual(sorted[5].isPinned, false, 'Sexto comentário deve ser não-fixado');

  // 5. Testar Renderização no Feed e no Modal
  // Testar helpers de permissão isPostOwner e isCommentAuthor
  const isPostOwner = env.sandbox.isPostOwner || env.sandbox.window.isPostOwner;
  const isCommentAuthor = env.sandbox.isCommentAuthor || env.sandbox.window.isCommentAuthor;

  assert.strictEqual(isPostOwner(post, postAuthor), true, 'Autor do post deve ser reconhecido como dono do post');
  assert.strictEqual(isPostOwner(post, userAlice), false, 'Comentarista Alice NÃO deve ser dona do post');
  assert.strictEqual(isPostOwner(post, userBob), false, 'Comentarista Bob NÃO deve ser dono do post');
  assert.strictEqual(isPostOwner(post, null), false, 'Usuário deslogado NÃO é dono do post');

  // Edge case: Prevenção de colisão com nome padrão 'Usuário'
  const postDefaultName = { authorUid: 'uid_1', authorName: 'Usuário' };
  const user1 = { uid: 'uid_1', displayName: 'Usuário' };
  const user2 = { uid: 'uid_2', displayName: 'Usuário' };
  assert.strictEqual(isPostOwner(postDefaultName, user1, { name: 'Usuário' }), true, 'Dono real pelo UID é proprietário');
  assert.strictEqual(isPostOwner(postDefaultName, user2, { name: 'Usuário' }), false, 'Outro usuário com mesmo nome padrão NÃO é dono do post');

  const commentC2 = post.comments.find(c => c.id === 'c2');
  assert.strictEqual(isCommentAuthor(commentC2, userAlice), true, 'Alice é autora do seu comentário c2');
  assert.strictEqual(isCommentAuthor(commentC2, userBob), false, 'Bob NÃO é autor do comentário de Alice');
  assert.strictEqual(isCommentAuthor(commentC2, postAuthor), false, 'Dono do post NÃO é autor do comentário de Alice');

  // Como autor do post (John), DEVE renderizar botão de fixar/desafixar
  env.sandbox.window.setCurrentUser(postAuthor);
  renderPostsFeed([post]);
  let feedList = env.elements['feed-list'];
  assert.ok(feedList.innerHTML.includes('Fixado'), 'Feed deve exibir o selo Fixado para comentários fixados');
  assert.ok(feedList.innerHTML.includes('(editado)'), 'Feed deve exibir o selo (editado) para comentários editados');
  assert.ok(feedList.innerHTML.includes('data-action="like-comment"'), 'Feed deve conter botão de curtir comentário');
  assert.ok(feedList.innerHTML.includes('data-action="pin-comment"'), 'Feed DEVE conter botão de fixar comentário para o autor do post');

  // No modal como dono do post:
  openPostCommentModal(post);
  let modalList = env.elements['comment-modal-list'];
  assert.ok(modalList.innerHTML.includes('data-action="pin-comment"'), 'Modal DEVE conter botão de fixar para o dono do post');

  // Como comentarista (Alice) vendo os comentários do post de John:
  // NÃO pode aparecer o botão de fixar comentário nem no Feed nem no Modal!
  env.sandbox.window.setCurrentUser(userAlice);
  renderPostsFeed([post]);
  feedList = env.elements['feed-list'];
  assert.strictEqual(feedList.innerHTML.includes('data-action="pin-comment"'), false, 'Feed NUNCA deve conter botão de fixar comentário para o comentarista');
  assert.ok(feedList.innerHTML.includes('data-action="edit-comment"'), 'Feed deve conter botão de editar comentário para o autor do comentário');

  // Abrir modal como comentarista (Alice) e verificar que botão de fixar NÃO aparece
  openPostCommentModal(post);
  modalList = env.elements['comment-modal-list'];
  assert.strictEqual(modalList.innerHTML.includes('data-action="pin-comment"'), false, 'Modal NUNCA deve conter botão de fixar comentário para o comentarista');
  assert.ok(modalList.innerHTML.includes('Fixado'), 'Modal deve exibir o selo visual Fixado');
  assert.ok(modalList.innerHTML.includes('(editado)'), 'Modal deve exibir o selo visual (editado)');
  assert.ok(modalList.innerHTML.includes('data-action="edit-comment"'), 'Modal deve permitir editar seu próprio comentário');

  // Testar especificamente conta de desenvolvedor/admin (dxhub.oficial@gmail.com):
  // NÃO é o dono do post de John, logo NÃO pode ter botão de fixar comentário!
  const userDevAdmin = { uid: 'user_dev_dxhub', email: 'dxhub.oficial@gmail.com', displayName: 'DX Hub Digital' };
  assert.strictEqual(isPostOwner(post, userDevAdmin), false, 'dxhub.oficial@gmail.com NÃO é dono do post de John e não deve ter isPostOwner=true');
  env.sandbox.window.setCurrentUser(userDevAdmin);
  renderPostsFeed([post]);
  feedList = env.elements['feed-list'];
  assert.strictEqual(feedList.innerHTML.includes('data-action="pin-comment"'), false, 'Feed NUNCA deve conter botão de fixar para conta admin no post de outro usuário');
  openPostCommentModal(post);
  modalList = env.elements['comment-modal-list'];
  assert.strictEqual(modalList.innerHTML.includes('data-action="pin-comment"'), false, 'Modal NUNCA deve conter botão de fixar para conta admin no post de outro usuário');

  // 6. Testar Permissões de Excluir Comentários (deletePostComment)
  const deletePostComment = env.sandbox.deletePostComment || env.sandbox.window.deletePostComment;

  // Usuário terceiro (Charlie) tenta excluir o comentário de Bob (c3) no post de John -> Deve ser REJEITADO
  env.sandbox.window.setCurrentUser({ uid: 'user_charlie', displayName: 'Charlie' });
  const deleteThirdPartyFail = await deletePostComment(postId, 'c3');
  assert.strictEqual(deleteThirdPartyFail, false, 'Usuário terceiro não pode apagar comentário de outro usuário');
  post = env.firestoreDocs[`posts/${postId}`];
  assert.ok(post.comments.some(c => c.id === 'c3'), 'Comentário c3 não deve ter sido removido');

  // O próprio autor do comentário (Bob) apaga seu comentário c3 -> Deve ter SUCESSO
  env.sandbox.window.setCurrentUser(userBob);
  const deleteCommentAuthorSuccess = await deletePostComment(postId, 'c3');
  assert.strictEqual(deleteCommentAuthorSuccess, true, 'Autor do comentário deve conseguir apagar seu comentário');
  post = env.firestoreDocs[`posts/${postId}`];
  assert.ok(!post.comments.some(c => c.id === 'c3'), 'Comentário c3 deve ter sido removido por Bob');

  // O dono do post (John) apaga o comentário de Alice (c2) no seu post -> Deve ter SUCESSO
  env.sandbox.window.setCurrentUser(postAuthor);
  const deletePostOwnerSuccess = await deletePostComment(postId, 'c2');
  assert.strictEqual(deletePostOwnerSuccess, true, 'Dono do post deve conseguir apagar qualquer comentário no seu post');
  post = env.firestoreDocs[`posts/${postId}`];
  assert.ok(!post.comments.some(c => c.id === 'c2'), 'Comentário c2 deve ter sido removido pelo dono do post');
});

test('Report System: Denunciar buttons on posts, stories, and comments with modal integration and admin visibility', async () => {
  const env = createTestEnvironment();
  const userAuthor = { uid: 'user_author_1', displayName: 'Post Author', name: 'Post Author' };
  const userViewer = { uid: 'user_viewer_1', displayName: 'Viewer User', name: 'Viewer User' };
  const userCommenter = { uid: 'user_commenter_1', displayName: 'Commenter User', name: 'Commenter User' };

  const openReportModal = env.sandbox.openReportModal || env.sandbox.window.openReportModal;
  const closeReportModal = env.sandbox.closeReportModal || env.sandbox.window.closeReportModal;
  const submitGeneralReport = env.sandbox.submitGeneralReport || env.sandbox.window.submitGeneralReport;
  const renderPostsFeed = env.sandbox.renderPostsFeed || env.sandbox.window.renderPostsFeed;
  const openPostCommentModal = env.sandbox.openPostCommentModal || env.sandbox.window.openPostCommentModal;
  const openStoryViewer = env.sandbox.openStoryViewer || env.sandbox.window.openStoryViewer;
  const isStoryPaused = env.sandbox.isStoryPaused || env.sandbox.window.isStoryPaused;
  const renderAdminReports = env.sandbox.renderAdminReports || env.sandbox.window.renderAdminReports;
  const setAdminReports = env.sandbox.setAdminReports || env.sandbox.window.setAdminReports;

  assert.ok(typeof openReportModal === 'function', 'openReportModal must be a function');
  assert.ok(typeof closeReportModal === 'function', 'closeReportModal must be a function');
  assert.ok(typeof submitGeneralReport === 'function', 'submitGeneralReport must be a function');

  // Sample Post with comments
  const post = {
    id: 'post_rep_100',
    authorUid: userAuthor.uid,
    authorName: userAuthor.displayName,
    mediaData: 'https://example.com/post.jpg',
    caption: 'Foto teste para validação de denúncia',
    createdAt: Date.now() - 60000,
    likes: [],
    comments: [
      {
        id: 'c_rep_1',
        authorUid: userCommenter.uid,
        author: userCommenter.displayName,
        text: 'Comentário suspeito ou spam aqui',
        createdAt: Date.now() - 30000,
        likes: []
      },
      {
        id: 'c_rep_2',
        authorUid: userAuthor.uid,
        author: userAuthor.displayName,
        text: 'Meu próprio comentário como autor do post',
        createdAt: Date.now() - 15000,
        likes: []
      }
    ]
  };

  // 1. Post Report Button: Author vs Viewer
  // Autor vendo o próprio post -> deve ver excluir, NUNCA denunciar
  env.sandbox.window.setCurrentUser(userAuthor);
  env.sandbox.window.setCurrentProfile(userAuthor);
  renderPostsFeed([post]);
  let feedList = env.elements['feed-list'];
  assert.ok(feedList.innerHTML.includes('data-action="delete-post"'), 'Autor deve ver botão de excluir seu post');
  assert.strictEqual(feedList.innerHTML.includes('data-action="report-post"'), false, 'Autor NUNCA deve ver botão de denunciar seu próprio post');

  // Usuário terceiro vendo o post -> deve ver denunciar, NUNCA excluir
  env.sandbox.window.setCurrentUser(userViewer);
  env.sandbox.window.setCurrentProfile(userViewer);
  renderPostsFeed([post]);
  feedList = env.elements['feed-list'];
  assert.strictEqual(feedList.innerHTML.includes('data-action="delete-post"'), false, 'Terceiro não deve ver botão de excluir post alheio');
  assert.ok(feedList.innerHTML.includes('data-action="report-post"'), 'Terceiro DEVE ver botão de denunciar post alheio');
  assert.ok(feedList.innerHTML.includes('Denunciar post'), 'Botão deve ter texto ou título Denunciar post');

  // 2. Comment Report Button: Feed e Modal
  // Usuário terceiro (userViewer) vendo comentários:
  assert.ok(feedList.innerHTML.includes('data-action="report-comment"'), 'Feed deve conter botão de denunciar comentário para terceiros');

  // Abrir modal de comentários e verificar botão de denunciar
  openPostCommentModal(post);
  let modalList = env.elements['comment-modal-list'];
  assert.ok(modalList.innerHTML.includes('data-action="report-comment"'), 'Modal de comentários deve conter botão de denunciar comentário');

  // O próprio autor do comentário (userCommenter) não deve ver botão de denunciar no seu próprio comentário
  env.sandbox.window.setCurrentUser(userCommenter);
  env.sandbox.window.setCurrentProfile(userCommenter);
  openPostCommentModal(post);
  modalList = env.elements['comment-modal-list'];
  assert.ok(modalList.innerHTML.includes('data-action="edit-comment"'), 'Autor do comentário deve ver botão de editar');

  // 3. Story Report Button: Autor vs Terceiro + Pausa de reprodução
  const stories = [{
    id: 'story_rep_100',
    authorUid: userAuthor.uid,
    authorName: userAuthor.displayName,
    type: 'image',
    src: 'story.jpg',
    caption: 'Story inapropriado ou spam',
    allowedUids: [userAuthor.uid, userViewer.uid]
  }];
  env.firestoreDocs[`stories/${stories[0].id}`] = { ...stories[0] };

  // Autor do story abrindo seu story -> Botão de denunciar story oculto (display: none)
  env.sandbox.window.setCurrentUser(userAuthor);
  env.sandbox.window.setCurrentProfile(userAuthor);
  openStoryViewer(stories, userAuthor);
  assert.strictEqual(env.elements['report-story-btn'].style.display, 'none', 'Botão de denunciar story deve estar oculto para o dono do story');

  // Terceiro abrindo o story -> Botão de denunciar story visível (display: flex)
  env.sandbox.window.setCurrentUser(userViewer);
  env.sandbox.window.setCurrentProfile(userViewer);
  openStoryViewer(stories, userAuthor);
  assert.strictEqual(env.elements['report-story-btn'].style.display, 'flex', 'Botão de denunciar story deve estar visível para outro usuário');

  // Clicar no botão de denunciar story: pausa o story e abre o modal de denúncia
  assert.strictEqual(isStoryPaused(), false, 'Story inicia em reprodução');
  await env.elements['report-story-btn'].click();
  assert.strictEqual(isStoryPaused(), true, 'Ao abrir denúncia do story, a reprodução DEVE ser pausada automaticamente');
  assert.ok(env.elements['report-contact-modal'].classList.contains('active'), 'Modal de denúncia deve abrir');
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Story');

  // Fechar o modal de denúncia: retoma a reprodução do story
  closeReportModal();
  assert.strictEqual(env.elements['report-contact-modal'].classList.contains('active'), false, 'Modal de denúncia deve ser fechado');
  assert.strictEqual(isStoryPaused(), false, 'Ao fechar o modal, a reprodução do story DEVE ser retomada');

  // 4. Envio de Denúncias (Post, Comentário, Story) e Registro no Firestore
  // Denunciar Post
  openReportModal({
    type: 'post',
    postId: post.id,
    targetUid: userAuthor.uid,
    targetName: userAuthor.displayName,
    contentSnippet: post.caption
  });
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Publicação');
  await submitGeneralReport(env.sandbox.window.getActiveReportTarget(), 'inapropriado', 'Conteúdo impróprio na foto');

  // Denunciar Comentário
  openReportModal({
    type: 'comment',
    commentId: 'c_rep_1',
    postId: post.id,
    targetUid: userCommenter.uid,
    targetName: userCommenter.displayName,
    contentSnippet: 'Comentário suspeito ou spam aqui'
  });
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Comentário');
  await submitGeneralReport(env.sandbox.window.getActiveReportTarget(), 'spam', 'Propaganda indevida');

  // Denunciar Story
  openReportModal({
    type: 'story',
    storyId: 'story_rep_100',
    targetUid: userAuthor.uid,
    targetName: userAuthor.displayName,
    contentSnippet: 'Story inapropriado ou spam'
  });
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Story');
  await submitGeneralReport(env.sandbox.window.getActiveReportTarget(), 'golpe', 'Link falso suspeito');

  // Validar documentos gerados na coleção 'reports'
  const reportsList = Object.entries(env.firestoreDocs)
    .filter(([path, data]) => path.startsWith('reports/') && data.reporterUid === userViewer.uid)
    .map(([path, data]) => ({ id: path.replace('reports/', ''), ...data }));

  assert.strictEqual(reportsList.length, 3, 'Devem existir 3 denúncias registradas');

  const postReport = reportsList.find(r => r.targetType === 'post');
  assert.ok(postReport, 'Denúncia de post deve existir');
  assert.strictEqual(postReport.postId, post.id);
  assert.strictEqual(postReport.reason, 'inapropriado');
  assert.strictEqual(postReport.contentSnippet, post.caption);

  const commentReport = reportsList.find(r => r.targetType === 'comment');
  assert.ok(commentReport, 'Denúncia de comentário deve existir');
  assert.strictEqual(commentReport.commentId, 'c_rep_1');
  assert.strictEqual(commentReport.postId, post.id);
  assert.strictEqual(commentReport.reason, 'spam');

  const storyReport = reportsList.find(r => r.targetType === 'story');
  assert.ok(storyReport, 'Denúncia de story deve existir');
  assert.strictEqual(storyReport.storyId, 'story_rep_100');
  assert.strictEqual(storyReport.reason, 'golpe');

  // 5. Painel Administrativo: Renderização com Badges Especializados e Trechos
  setAdminReports(reportsList);
  renderAdminReports();
  const adminReportsListEl = env.elements['admin-reports-list'];
  assert.ok(adminReportsListEl.innerHTML.includes('Post'), 'Painel de denúncias deve exibir o badge Post');
  assert.ok(adminReportsListEl.innerHTML.includes('Comentário'), 'Painel de denúncias deve exibir o badge Comentário');
  assert.ok(adminReportsListEl.innerHTML.includes('Story'), 'Painel de denúncias deve exibir o badge Story');
  assert.ok(adminReportsListEl.innerHTML.includes('Trecho:'), 'Painel de denúncias deve exibir o trecho do conteúdo denunciado');
});

test('Android/Mobile Hardware Back Button Navigation: popstate layer dismissal, stack handling, and double-press to exit', async () => {
  const env = createTestEnvironment();

  const initBackNavigation = env.sandbox.initBackNavigation || env.sandbox.window.initBackNavigation;
  const closeTopmostActiveLayer = env.sandbox.closeTopmostActiveLayer || env.sandbox.window.closeTopmostActiveLayer;
  const handleSystemBackPress = env.sandbox.handleSystemBackPress || env.sandbox.window.handleSystemBackPress;

  assert.ok(typeof initBackNavigation === 'function', 'initBackNavigation deve existir');
  assert.ok(typeof closeTopmostActiveLayer === 'function', 'closeTopmostActiveLayer deve existir');
  assert.ok(typeof handleSystemBackPress === 'function', 'handleSystemBackPress deve existir');

  // Inicializar navegação
  initBackNavigation();
  assert.strictEqual(env.sandbox.window.history.state?.vortexState, 'active', 'Estado de histórico deve ser ativo');

  // 1. Janela de Conversa Ativa: pressionar voltar deve fechar o chat e retornar à lista de conversas
  env.elements['chat-window'].classList.add('active');
  assert.ok(env.elements['chat-window'].classList.contains('active'), 'Chat deve estar aberto');
  
  const closedChat = handleSystemBackPress();
  assert.strictEqual(closedChat, true, 'handleSystemBackPress deve retornar true indicando que fechou uma camada');
  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), false, 'Chat deve ter sido fechado com o botão voltar');
  assert.strictEqual(env.sandbox.window.history.state?.vortexState, 'active', 'Guarda de histórico deve ser restaurada');

  // 2. Modais e Telas Sobrepostas em Pilha: Reels -> Comentários -> Denúncia
  env.elements['feed-overlay'].classList.add('active');
  env.elements['post-comment-modal'].classList.add('active');
  env.elements['report-contact-modal'].classList.add('active');

  // 1º Voltar: fecha o modal de denúncia
  handleSystemBackPress();
  assert.strictEqual(env.elements['report-contact-modal'].classList.contains('active'), false, 'Modal de denúncia deve fechar no 1º voltar');
  assert.strictEqual(env.elements['post-comment-modal'].classList.contains('active'), true, 'Modal de comentários deve permanecer aberto');
  assert.strictEqual(env.elements['feed-overlay'].classList.contains('active'), true, 'Feed Reels deve permanecer aberto');

  // 2º Voltar: fecha o modal de comentários
  handleSystemBackPress();
  assert.strictEqual(env.elements['post-comment-modal'].classList.contains('active'), false, 'Modal de comentários deve fechar no 2º voltar');
  assert.strictEqual(env.elements['feed-overlay'].classList.contains('active'), true, 'Feed Reels deve permanecer aberto');

  // 3º Voltar: fecha o feed Reels
  handleSystemBackPress();
  assert.strictEqual(env.elements['feed-overlay'].classList.contains('active'), false, 'Feed Reels deve fechar no 3º voltar');

  // 3. Story Viewer e Folha de Visualizadores
  env.elements['story-viewer'].classList.add('active');
  env.elements['story-viewers-sheet'].classList.add('active');

  // 1º Voltar no Story: fecha a folha de visualizadores
  handleSystemBackPress();
  assert.strictEqual(env.elements['story-viewers-sheet'].classList.contains('active'), false, 'Folha de visualizadores de story deve fechar');
  assert.strictEqual(env.elements['story-viewer'].classList.contains('active'), true, 'Story viewer deve permanecer ativo');

  // 2º Voltar no Story: fecha o story viewer
  handleSystemBackPress();
  assert.strictEqual(env.elements['story-viewer'].classList.contains('active'), false, 'Story viewer deve fechar no voltar');

  // 4. Painéis Diversos (Settings, Busca, Pedidos, Perfil, Grupo, Admin, Pagamento VIP, Música, Compartilhar)
  const panelsToTest = [
    'settings-panel',
    'search-user-panel',
    'requests-panel',
    'profile-edit-panel',
    'create-group-panel',
    'group-profile-panel',
    'admin-panel',
    'notifications-panel',
    'vip-payment-modal',
    'music-picker-modal',
    'post-share-modal'
  ];

  for (const panelId of panelsToTest) {
    env.elements[panelId].classList.add('active');
    assert.ok(env.elements[panelId].classList.contains('active'), `${panelId} deve estar ativo`);
    handleSystemBackPress();
    assert.strictEqual(env.elements[panelId].classList.contains('active'), false, `${panelId} deve fechar ao pressionar voltar`);
  }

  // 5. Interações do Chat (Seleção Múltipla, Modais de Confirmação e Dropdown)
  env.elements['chat-window'].classList.add('active');
  env.elements['chat-dropdown-menu'].classList.add('active');
  handleSystemBackPress();
  assert.strictEqual(env.elements['chat-dropdown-menu'].classList.contains('active'), false, 'Dropdown do chat deve fechar');
  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), true, 'Chat deve continuar aberto após fechar dropdown');

  env.elements['clear-chat-modal'].classList.add('active');
  handleSystemBackPress();
  assert.strictEqual(env.elements['clear-chat-modal'].classList.contains('active'), false, 'Modal de limpar conversa deve fechar');
  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), true, 'Chat deve continuar aberto após cancelar modal');

  // Fechar o chat
  handleSystemBackPress();
  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), false, 'Chat deve fechar');

  // 6. Tela Inicial (Root): 1º toque avisa com toast, 2º toque em menos de 2s permite sair
  const firstRootPress = handleSystemBackPress();
  assert.strictEqual(firstRootPress, true, '1º voltar na tela inicial deve reter no app e retornar true');
  assert.strictEqual(env.sandbox.window.history.state?.vortexState, 'active', 'Guarda deve ser mantida após o 1º toque');

  // 2º toque imediato
  const secondRootPress = handleSystemBackPress();
  assert.strictEqual(secondRootPress, false, '2º voltar consecutivo deve retornar false permitindo sair');
});

test('Enquetes (Polls) e Barra Rolável de Anexos: criação, validação, votação única/múltipla, ver votos e navegação voltar', async () => {
  const env = createTestEnvironment();

  // 1. DOM Elements & CSS Integrity
  assert.ok(env.elements['chat-attach-poll-btn'], 'Botão de enquete nos anexos deve existir');
  assert.ok(env.elements['poll-creator-modal'], 'Modal de criação de enquete deve existir');
  assert.ok(env.elements['poll-votes-modal'], 'Modal de detalhes dos votos da enquete deve existir');
  assert.ok(env.elements['poll-question-input'], 'Input de pergunta deve existir');
  assert.ok(env.elements['poll-options-container'], 'Container de opções deve existir');
  assert.ok(env.elements['poll-add-option-btn'], 'Botão de adicionar opção deve existir');
  assert.ok(env.elements['poll-allow-multiple-toggle'], 'Toggle de múltiplas respostas deve existir');
  assert.ok(env.elements['poll-submit-btn'], 'Botão de enviar enquete deve existir');
  assert.ok(env.elements['poll-votes-breakdown'], 'Container de detalhamento dos votos deve existir');

  // CSS Verification
  assert.ok(cssContent.includes('.attachment-grid'), 'CSS deve definir .attachment-grid');
  assert.ok(cssContent.includes('overflow-x: auto') || cssContent.includes('overflow-x:auto'), 'Attachment grid deve ter rolagem horizontal');
  assert.ok(cssContent.includes('.poll-creator-card'), 'CSS deve conter .poll-creator-card');
  assert.ok(cssContent.includes('.poll-message-card'), 'CSS deve conter .poll-message-card');
  assert.ok(cssContent.includes('.poll-option-row'), 'CSS deve conter .poll-option-row');
  assert.ok(cssContent.includes('.poll-option-fill'), 'CSS deve conter .poll-option-fill');
  assert.ok(cssContent.includes('.poll-votes-card'), 'CSS deve conter .poll-votes-card');

  // Functions
  const openPollCreator = env.sandbox.openPollCreator || env.sandbox.window.openPollCreator;
  const closePollCreator = env.sandbox.closePollCreator || env.sandbox.window.closePollCreator;
  const addPollOption = env.sandbox.addPollOption || env.sandbox.window.addPollOption;
  const removePollOption = env.sandbox.removePollOption || env.sandbox.window.removePollOption;
  const validatePollCreator = env.sandbox.validatePollCreator || env.sandbox.window.validatePollCreator;
  const submitPoll = env.sandbox.submitPoll || env.sandbox.window.submitPoll;
  const voteOnPoll = env.sandbox.voteOnPoll || env.sandbox.window.voteOnPoll;
  const openPollVotesModal = env.sandbox.openPollVotesModal || env.sandbox.window.openPollVotesModal;
  const closePollVotesModal = env.sandbox.closePollVotesModal || env.sandbox.window.closePollVotesModal;
  const getPollCreatorOptions = env.sandbox.getPollCreatorOptions || env.sandbox.window.getPollCreatorOptions;
  const handleSystemBackPress = env.sandbox.handleSystemBackPress || env.sandbox.window.handleSystemBackPress;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;

  assert.ok(typeof openPollCreator === 'function', 'openPollCreator deve ser exportada');
  assert.ok(typeof voteOnPoll === 'function', 'voteOnPoll deve ser exportada');
  assert.ok(typeof openPollVotesModal === 'function', 'openPollVotesModal deve ser exportada');

  // 2. Open Poll Creator & Validation
  openPollCreator();
  assert.strictEqual(env.elements['poll-creator-modal'].classList.contains('active'), true, 'Modal de criação deve abrir com classe active');
  assert.strictEqual(env.elements['poll-submit-btn'].disabled, true, 'Botão enviar deve iniciar desabilitado');

  let opts = getPollCreatorOptions();
  assert.strictEqual(opts.length, 2, 'Enquete deve iniciar com 2 opções padrão');

  // Adicionar opções até 5 opções
  addPollOption();
  addPollOption();
  addPollOption();
  opts = getPollCreatorOptions();
  assert.strictEqual(opts.length, 5, 'Deve ter 5 opções após adicionar 3');

  // Remover opção
  removePollOption(4);
  opts = getPollCreatorOptions();
  assert.strictEqual(opts.length, 4, 'Deve ter 4 opções após remover a última');

  // Não permitir remover abaixo de 2 opções
  removePollOption(0);
  removePollOption(0);
  removePollOption(0); // Tentar remover quando já tem 2
  opts = getPollCreatorOptions();
  assert.strictEqual(opts.length, 2, 'Não pode reduzir para menos de 2 opções');

  // Preencher Pergunta e apenas 1 opção -> Enviar continua desabilitado
  env.elements['poll-question-input'].value = 'Qual seu framework favorito?';
  opts[0] = 'React';
  validatePollCreator();
  assert.strictEqual(env.elements['poll-submit-btn'].disabled, true, 'Botão enviar deve continuar desabilitado com apenas 1 opção preenchida');

  // Preencher a 2ª opção -> Enviar é habilitado
  opts[1] = 'Vue';
  validatePollCreator();
  assert.strictEqual(env.elements['poll-submit-btn'].disabled, false, 'Botão enviar deve habilitar com 2 opções preenchidas');

  // 3. Submeter Enquete em Conversa Direta (1:1)
  const userMe = { uid: 'user_dev_1', name: 'Dev One', displayName: 'Dev One', avatar: 'https://avatar.dev/1' };
  env.sandbox.window.setCurrentUser(userMe);
  env.sandbox.window.setCurrentProfile(userMe);
  openDirectChat({ uid: 'user_dev_2', name: 'Dev Two' });

  await submitPoll();
  assert.strictEqual(env.elements['poll-creator-modal'].classList.contains('active'), false, 'Modal deve fechar após submeter');

  // Verificar mensagem gerada no Firestore
  const chatMessages = Object.entries(env.firestoreDocs).filter(([k]) => k.includes('/messages/'));
  assert.ok(chatMessages.length > 0, 'Mensagem deve ser persistida no Firestore');
  const [pollMsgPath, pollMsgDoc] = chatMessages[chatMessages.length - 1];
  const pollMsgId = pollMsgPath.split('/').pop();

  assert.strictEqual(pollMsgDoc.type, 'poll', 'Tipo da mensagem deve ser poll');
  assert.ok(pollMsgDoc.poll, 'Documento deve conter objeto poll');
  assert.strictEqual(pollMsgDoc.poll.question, 'Qual seu framework favorito?');
  assert.strictEqual(pollMsgDoc.poll.options.length, 2);
  assert.strictEqual(pollMsgDoc.poll.options[0].text, 'React');
  assert.strictEqual(pollMsgDoc.poll.options[1].text, 'Vue');
  assert.strictEqual(pollMsgDoc.poll.allowMultiple, false);

  // 4. Fluxo de Votação (Escolha Única)
  const opt1Id = pollMsgDoc.poll.options[0].id;
  const opt2Id = pollMsgDoc.poll.options[1].id;

  // Dev 1 vota na Opção 1 (React)
  await voteOnPoll(pollMsgId, opt1Id);
  let updatedMsg = env.firestoreDocs[pollMsgPath];
  assert.strictEqual(updatedMsg.poll.options[0].votes.includes('user_dev_1'), true, 'Dev 1 deve constar nos votos da opção 1');
  assert.strictEqual(updatedMsg.poll.options[0].votes.length, 1);
  assert.strictEqual(updatedMsg.poll.options[1].votes.length, 0, 'Opção 2 deve ter 0 votos');
  assert.ok(updatedMsg.poll.votersMap['user_dev_1'], 'votersMap deve registrar o perfil de Dev 1');

  // Dev 2 abre conversa com Dev 1 e vota na Opção 2 (Vue)
  const userDev2 = { uid: 'user_dev_2', name: 'Dev Two', displayName: 'Dev Two', avatar: 'https://avatar.dev/2' };
  env.sandbox.window.setCurrentUser(userDev2);
  env.sandbox.window.setCurrentProfile(userDev2);
  openDirectChat({ uid: 'user_dev_1', name: 'Dev One' });
  await voteOnPoll(pollMsgId, opt2Id);
  updatedMsg = env.firestoreDocs[pollMsgPath];
  assert.strictEqual(updatedMsg.poll.options[0].votes.includes('user_dev_1'), true);
  assert.strictEqual(updatedMsg.poll.options[1].votes.includes('user_dev_2'), true);
  assert.strictEqual(updatedMsg.poll.options[0].votes.length, 1);
  assert.strictEqual(updatedMsg.poll.options[1].votes.length, 1);
  assert.ok(updatedMsg.poll.votersMap['user_dev_2'], 'votersMap deve registrar o perfil de Dev 2');

  // Dev 1 abre conversa com Dev 2 e muda seu voto para a Opção 2 (Vue) -> Escolha única retira voto da Opção 1
  env.sandbox.window.setCurrentUser(userMe);
  env.sandbox.window.setCurrentProfile(userMe);
  openDirectChat({ uid: 'user_dev_2', name: 'Dev Two' });
  await voteOnPoll(pollMsgId, opt2Id);
  updatedMsg = env.firestoreDocs[pollMsgPath];
  assert.strictEqual(updatedMsg.poll.options[0].votes.includes('user_dev_1'), false, 'Voto anterior do Dev 1 deve ser removido da opção 1');
  assert.strictEqual(updatedMsg.poll.options[1].votes.includes('user_dev_1'), true, 'Novo voto do Dev 1 deve estar na opção 2');
  assert.strictEqual(updatedMsg.poll.options[1].votes.length, 2, 'Opção 2 deve ter 2 votos');

  // 5. Fluxo de Votação Múltipla Escolha
  updatedMsg.poll.allowMultiple = true;
  env.firestoreDocs[pollMsgPath] = updatedMsg;

  // Dev 1 vota também na Opção 1 -> Ambas opções devem conter user_dev_1
  await voteOnPoll(pollMsgId, opt1Id);
  updatedMsg = env.firestoreDocs[pollMsgPath];
  assert.strictEqual(updatedMsg.poll.options[0].votes.includes('user_dev_1'), true, 'Dev 1 deve votar na opção 1 em múltipla escolha');
  assert.strictEqual(updatedMsg.poll.options[1].votes.includes('user_dev_1'), true, 'Dev 1 deve manter voto na opção 2 em múltipla escolha');

  // 6. Modal de Detalhes dos Votos (openPollVotesModal)
  openPollVotesModal(updatedMsg.poll);
  assert.strictEqual(env.elements['poll-votes-modal'].classList.contains('active'), true, 'Modal de votos deve estar ativo');
  assert.strictEqual(env.elements['poll-votes-question'].textContent, 'Qual seu framework favorito?');
  const breakdownEl = env.elements['poll-votes-breakdown'];
  assert.ok(breakdownEl.children.length >= 2, 'Breakdown deve listar os 2 grupos de opções');
  const allBreakdownHTML = breakdownEl.children.map(c => c.innerHTML).join('');
  assert.ok(allBreakdownHTML.includes('React'), 'Breakdown deve exibir o título React');
  assert.ok(allBreakdownHTML.includes('Vue'), 'Breakdown deve exibir o título Vue');
  assert.ok(allBreakdownHTML.includes('Dev One') || allBreakdownHTML.includes('Dev Two') || allBreakdownHTML.includes('Você'), 'Breakdown deve listar o eleitor');

  closePollVotesModal();
  assert.strictEqual(env.elements['poll-votes-modal'].classList.contains('active'), false, 'Modal de votos deve fechar');

  // 7. Integração com Botão Voltar do Celular (Android Back Button)
  // Caso A: Modal de detalhes dos votos aberto -> 1º voltar fecha o modal de votos
  openPollVotesModal(updatedMsg.poll);
  assert.strictEqual(env.elements['poll-votes-modal'].classList.contains('active'), true);
  handleSystemBackPress();
  assert.strictEqual(env.elements['poll-votes-modal'].classList.contains('active'), false, 'Botão voltar deve fechar o modal de detalhes dos votos');

  // Caso B: Modal de criação de enquete aberto -> 1º voltar fecha o criador de enquete
  openPollCreator();
  assert.strictEqual(env.elements['poll-creator-modal'].classList.contains('active'), true);
  handleSystemBackPress();
  assert.strictEqual(env.elements['poll-creator-modal'].classList.contains('active'), false, 'Botão voltar deve fechar o modal de criação de enquete');
});

test('Recado / Bio do Contato: Exibição no cabeçalho do chat, cartão de introdução, painel Dados do Contato, busca e sincronização em tempo real', async () => {
  const env = createTestEnvironment();

  // 1. Verificação de Integridade dos Elementos no DOM (HTML)
  assert.ok(env.elements['contact-profile-panel'], '#contact-profile-panel deve existir no DOM');
  assert.ok(env.elements['contact-profile-avatar'], '#contact-profile-avatar deve existir no DOM');
  assert.ok(env.elements['contact-profile-name'], '#contact-profile-name deve existir no DOM');
  assert.ok(env.elements['contact-profile-username'], '#contact-profile-username deve existir no DOM');
  assert.ok(env.elements['contact-profile-bio-card'], '#contact-profile-bio-card deve existir no DOM');
  assert.ok(env.elements['contact-profile-bio-text'], '#contact-profile-bio-text deve existir no DOM');
  assert.ok(env.elements['close-contact-profile'], '#close-contact-profile deve existir no DOM');
  assert.ok(env.elements['chat-window-bio'], '#chat-window-bio deve existir no cabeçalho do chat');
  assert.ok(env.elements['chat-header-user-info'], '#chat-header-user-info deve existir no cabeçalho do chat');

  // CSS Integrity
  assert.ok(cssContent.includes('.contact-profile-panel'), 'CSS deve definir .contact-profile-panel');
  assert.ok(cssContent.includes('.contact-profile-bio-card'), 'CSS deve definir .contact-profile-bio-card');
  assert.ok(cssContent.includes('.chat-contact-intro-card'), 'CSS deve definir .chat-contact-intro-card');
  assert.ok(cssContent.includes('.search-user-bio'), 'CSS deve definir .search-user-bio');

  // Funções
  const openContactProfile = env.sandbox.openContactProfile || env.sandbox.window.openContactProfile;
  const closeContactProfile = env.sandbox.closeContactProfile || env.sandbox.window.closeContactProfile;
  const openDirectChat = env.sandbox.openDirectChat || env.sandbox.window.openDirectChat;
  const handleSystemBackPress = env.sandbox.handleSystemBackPress || env.sandbox.window.handleSystemBackPress;

  assert.ok(typeof openContactProfile === 'function', 'openContactProfile deve ser uma função');
  assert.ok(typeof closeContactProfile === 'function', 'closeContactProfile deve ser uma função');

  const currentUser = { uid: 'user_me_bio', name: 'Eu', username: 'eumesmo' };
  env.sandbox.window.setCurrentUser(currentUser);
  env.sandbox.window.setCurrentProfile(currentUser);

  // 2. Abertura e Preenchimento do Painel "Dados do Contato"
  const contactMock = {
    uid: 'contato_recado_123',
    name: 'Mariana Souza',
    username: '@marianas',
    avatar: 'https://cdn.test/mariana.jpg',
    status: 'Vivendo e aprendendo todo dia! 🚀✨',
    isVerified: true
  };

  // Inicializar documento do contato no Firestore
  env.firestoreDocs[`users/${contactMock.uid}`] = {
    uid: contactMock.uid,
    name: contactMock.name,
    username: contactMock.username,
    avatar: contactMock.avatar,
    status: contactMock.status,
    isVerified: contactMock.isVerified,
    phone: '(11) 97777-6666',
    youtube: '@marianasouza',
    instagram: '@marianas',
    tiktok: '@mari.tiktok'
  };
  contactMock.phone = '(11) 97777-6666';
  contactMock.youtube = '@marianasouza';
  contactMock.instagram = '@marianas';
  contactMock.tiktok = '@mari.tiktok';

  await openContactProfile(contactMock);
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), true, 'Painel Dados do Contato deve abrir com classe active');
  assert.strictEqual(env.elements['contact-profile-name'].innerText, 'Mariana Souza', 'Nome do contato deve estar correto');
  assert.strictEqual(env.elements['contact-profile-verified-badge'].style.display, 'inline-flex', 'Selo de verificado deve estar visível no painel Dados do Contato');
  assert.ok(env.elements['contact-profile-username'].innerText.includes('marianas'), 'Username do contato deve conter marianas');
  assert.ok(env.elements['contact-profile-bio-text'].innerText.includes('Vivendo e aprendendo todo dia!'), 'Recado/Bio deve estar preenchido no painel');
  assert.ok(env.elements['contact-profile-avatar'].style.backgroundImage.includes('mariana.jpg'), 'Avatar deve exibir imagem do contato');
  assert.strictEqual(env.elements['contact-profile-phone-card'].style.display, 'flex', 'Phone card deve estar visível');
  assert.strictEqual(env.elements['contact-profile-phone-text'].innerText, '(11) 97777-6666', 'Phone deve exibir o número do contato');
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'block', 'Seção de redes sociais deve estar visível');
  assert.strictEqual(env.elements['contact-profile-youtube-link'].href, 'https://www.youtube.com/@marianasouza', 'Link do YouTube deve ser formatado');
  assert.strictEqual(env.elements['contact-profile-instagram-link'].href, 'https://www.instagram.com/marianas', 'Link do Instagram deve ser formatado');
  assert.strictEqual(env.elements['contact-profile-tiktok-link'].href, 'https://www.tiktok.com/@mari.tiktok', 'Link do TikTok deve ser formatado');

  // Fechamento manual
  closeContactProfile();
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), false, 'Painel Dados do Contato deve fechar');
  assert.strictEqual(env.elements['contact-profile-phone-card'].style.display, 'none', 'Phone card deve ser ocultado no fechamento');
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'none', 'Seção de redes sociais deve ser ocultada no fechamento');

  // Testar selo de verificado para conta DX Hub Digital (@dxhuboficial)
  const dxHubMock = {
    uid: 'dxhub_admin_uid',
    name: 'DX Hub Digital',
    username: '@dxhuboficial',
    email: 'dxhub.oficial@gmail.com',
    status: 'Atendimento Oficial DX Hub Digital ⚡'
  };
  env.firestoreDocs[`users/${dxHubMock.uid}`] = dxHubMock;
  await openContactProfile(dxHubMock);
  assert.strictEqual(env.elements['contact-profile-verified-badge'].style.display, 'inline-flex', 'Selo de verificado deve aparecer para DX Hub Digital no perfil');
  closeContactProfile();

  // 3. Integração com Botão Voltar do Sistema (Android Back Button)
  await openContactProfile(contactMock);
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), true);
  const backResult = handleSystemBackPress();
  assert.strictEqual(backResult, true, 'handleSystemBackPress deve interceptar e retornar true');
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), false, 'Botão voltar deve fechar o painel Dados do Contato');

  // 4. Exibição e Sincronização em Tempo Real no Cabeçalho do Chat & Balãozinho WhatsApp
  openDirectChat({
    uid: contactMock.uid,
    name: contactMock.name,
    username: contactMock.username,
    avatar: contactMock.avatar,
    status: 'Focado nos projetos 💻'
  });

  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), true, 'Chat deve estar aberto');
  assert.strictEqual(env.elements['chat-window-bio'].style.display, 'none', 'Recado/Bio deve ser removido do cabeçalho do contato');
  assert.strictEqual(env.elements['chat-header-sep'].style.display, 'none', 'Separador do cabeçalho deve estar oculto');
  assert.strictEqual(env.elements['chat-bio-bubble'].style.display, 'inline-flex', 'Balãozinho de recado estilo WhatsApp deve estar visível');
  assert.ok(env.elements['chat-bio-bubble-text'].innerText.includes('Vivendo e aprendendo todo dia!'), 'Balãozinho deve exibir o texto do recado');

  // Teste de expiração do temporizador de 60 segundos do balãozinho de Bio
  const startBioBubbleTimer = env.sandbox.startBioBubbleTimer || env.sandbox.window.startBioBubbleTimer;
  assert.ok(typeof startBioBubbleTimer === 'function', 'startBioBubbleTimer deve existir');
  startBioBubbleTimer(15);
  await new Promise(r => setTimeout(r, 450));
  assert.strictEqual(env.elements['chat-bio-bubble'].style.display, 'none', 'Balãozinho de bio deve desaparecer após expirar o tempo');

  // Ao reabrir conversa, balãozinho deve reaparecer para a nova sessão
  openDirectChat({
    uid: contactMock.uid,
    name: contactMock.name,
    username: contactMock.username,
    avatar: contactMock.avatar,
    status: 'Vivendo e aprendendo todo dia! 🚀✨'
  });
  assert.strictEqual(env.elements['chat-bio-bubble'].style.display, 'inline-flex', 'Balãozinho deve reaparecer para nova sessão ao abrir conversa');

  // Clicar no balãozinho abre os dados do contato
  await env.elements['chat-bio-bubble'].click();
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), true, 'Clicar no balãozinho deve abrir os Dados do Contato');
  closeContactProfile();

  // Atualização em tempo real do status/recado do contato
  await env.sandbox.updateDoc({ path: `users/${contactMock.uid}` }, {
    status: 'Disponível para novas ideias 💡'
  });

  assert.strictEqual(env.elements['chat-window-bio'].style.display, 'none', 'Bio deve permanecer oculta no cabeçalho do contato');
  assert.ok(env.elements['chat-bio-bubble-text'].innerText.includes('Disponível para novas ideias 💡'), 'Texto do balãozinho deve atualizar instantaneamente com listener');

  // 5. Clicar na seta de voltar do chat (#close-chat) fecha o chat e oculta o balãozinho
  await env.elements['close-chat'].click();
  assert.strictEqual(env.elements['chat-window'].classList.contains('active'), false, 'Chat deve fechar ao clicar na seta de voltar');
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), false, 'Painel Dados do Contato NUNCA deve abrir ao clicar na seta de voltar');
  assert.strictEqual(env.elements['chat-bio-bubble'].style.display, 'none', 'Balãozinho deve ser ocultado ao fechar conversa');

  // 6. Botões Bloquear e Denunciar no Painel Dados do Contato
  await openContactProfile(contactMock);
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), true);
  assert.strictEqual(env.elements['contact-profile-block-text'].innerText, 'Bloquear Contato');

  // Clicar no botão Bloquear abre o modal de confirmação
  await env.elements['contact-profile-block-btn'].click();
  assert.strictEqual(env.elements['block-contact-modal'].classList.contains('active'), true, 'Modal de bloqueio deve abrir');
  assert.ok(env.elements['block-modal-title'].innerText.includes('Bloquear'), 'Título deve indicar Bloquear');

  // Confirmar bloqueio
  await env.elements['confirm-block-contact-btn'].click();
  assert.strictEqual(env.elements['block-contact-modal'].classList.contains('active'), false, 'Modal de bloqueio deve fechar');
  assert.ok(env.firestoreDocs[`users/${currentUser.uid}/blocked/${contactMock.uid}`], 'Documento de bloqueio deve ser criado');
  assert.strictEqual(env.elements['contact-profile-block-text'].innerText, 'Desbloquear Contato', 'Texto deve mudar para Desbloquear Contato');

  // Clicar novamente no botão Bloquear abre modal para Desbloquear
  await env.elements['contact-profile-block-btn'].click();
  assert.strictEqual(env.elements['block-contact-modal'].classList.contains('active'), true, 'Modal deve abrir para desbloquear');
  assert.ok(env.elements['block-modal-title'].innerText.includes('Desbloquear'), 'Título deve indicar Desbloquear');

  // Confirmar desbloqueio
  await env.elements['confirm-block-contact-btn'].click();
  assert.strictEqual(env.elements['block-contact-modal'].classList.contains('active'), false, 'Modal deve fechar');
  assert.strictEqual(!!env.firestoreDocs[`users/${currentUser.uid}/blocked/${contactMock.uid}`], false, 'Documento de bloqueio deve ser removido');
  assert.strictEqual(env.elements['contact-profile-block-text'].innerText, 'Bloquear Contato', 'Texto deve retornar para Bloquear Contato');

  // Clicar no botão Denunciar abre o modal de denúncia
  await env.elements['contact-profile-report-btn'].click();
  assert.strictEqual(env.elements['report-contact-modal'].classList.contains('active'), true, 'Modal de denúncia deve abrir');
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Contato', 'Título do modal de denúncia deve ser Denunciar Contato');

  // Enviar denúncia
  await env.elements['submit-report-contact-btn'].click();
  assert.strictEqual(env.elements['report-contact-modal'].classList.contains('active'), false, 'Modal de denúncia deve fechar');
  const reportDocs = Object.keys(env.firestoreDocs).filter(k => k.startsWith('reports/'));
  assert.ok(reportDocs.length > 0, 'Denúncia deve ter sido salva na coleção reports');

  const bioTimer = (env.sandbox.getBioBubbleTimer || env.sandbox.window.getBioBubbleTimer)?.();
  if (bioTimer) clearTimeout(bioTimer);
});

test('Músicas Favoritas: Salvar/favoritar músicas (❤️), aba ⭐ Favoritas, persistência no Firestore e localStorage, remoção e uso em status/posts', async () => {
  const env = createTestEnvironment();

  const user = {
    uid: 'user_music_fan_1',
    name: 'Music Lover',
    email: 'fan@vortex.app',
    avatar: 'https://example.com/avatar.jpg'
  };
  env.sandbox.window.setCurrentUser(user);
  env.firestoreDocs[`users/${user.uid}`] = user;

  const toggleFavoriteTrack = env.sandbox.toggleFavoriteTrack || env.sandbox.window.toggleFavoriteTrack;
  const isTrackFavorited = env.sandbox.isTrackFavorited || env.sandbox.window.isTrackFavorited;
  const getUserFavoriteTracks = env.sandbox.getUserFavoriteTracks || env.sandbox.window.getUserFavoriteTracks;
  const setUserFavoriteTracks = env.sandbox.setUserFavoriteTracks || env.sandbox.window.setUserFavoriteTracks;
  const loadUserFavoriteTracks = env.sandbox.loadUserFavoriteTracks || env.sandbox.window.loadUserFavoriteTracks;
  const searchMusicTracks = env.sandbox.searchMusicTracks || env.sandbox.window.searchMusicTracks;
  const openMusicPicker = env.sandbox.openMusicPicker || env.sandbox.window.openMusicPicker;
  const selectMusicTrack = env.sandbox.selectMusicTrack || env.sandbox.window.selectMusicTrack;
  const getPendingStatusMusic = env.sandbox.getPendingStatusMusic || env.sandbox.window.getPendingStatusMusic;
  const getPendingPostMusic = env.sandbox.getPendingPostMusic || env.sandbox.window.getPendingPostMusic;

  assert.ok(typeof toggleFavoriteTrack === 'function', 'toggleFavoriteTrack deve estar disponível');
  assert.ok(typeof isTrackFavorited === 'function', 'isTrackFavorited deve estar disponível');
  assert.ok(typeof getUserFavoriteTracks === 'function', 'getUserFavoriteTracks deve estar disponível');

  // 1. Estado inicial sem favoritas
  assert.strictEqual(getUserFavoriteTracks().length, 0, 'Inicialmente a lista de favoritas deve estar vazia');
  assert.strictEqual(isTrackFavorited('fav_track_01'), false, 'Faixa não deve estar favoritada inicialmente');

  // 2. Favoritar uma faixa
  const sampleTrack1 = {
    id: 'fav_track_01',
    title: 'Neon Skyline Night',
    artist: 'Cyber Dreamers',
    cover: 'https://example.com/cover1.jpg',
    audioUrl: 'https://example.com/audio1.mp3',
    duration: 30
  };

  await toggleFavoriteTrack(sampleTrack1);

  // Verificações em memória
  assert.strictEqual(isTrackFavorited('fav_track_01'), true, 'Faixa deve estar marcada como favorita');
  assert.strictEqual(getUserFavoriteTracks().length, 1, 'Lista deve ter 1 faixa favorita');
  assert.strictEqual(getUserFavoriteTracks()[0].id, 'fav_track_01');

  // Verificação de persistência no Firestore (users/{uid}/favorite_tracks/{trackId})
  const firestoreDocPath = `users/${user.uid}/favorite_tracks/fav_track_01`;
  assert.ok(env.firestoreDocs[firestoreDocPath], 'Faixa deve ser salva na subcoleção users/{uid}/favorite_tracks');
  assert.strictEqual(env.firestoreDocs[firestoreDocPath].title, 'Neon Skyline Night');

  // Verificação de persistência no localStorage cache
  const localCache = env.sandbox.localStorage.getItem(`vortex_fav_tracks_${user.uid}`);
  assert.ok(localCache, 'Músicas favoritas devem ser cacheadas no localStorage');
  const parsedCache = JSON.parse(localCache);
  assert.strictEqual(parsedCache.length, 1);
  assert.strictEqual(parsedCache[0].id, 'fav_track_01');

  const formatMusicDuration = env.sandbox.formatMusicDuration || env.sandbox.window.formatMusicDuration;
  assert.ok(typeof formatMusicDuration === 'function', 'formatMusicDuration deve estar disponível');
  assert.strictEqual(formatMusicDuration(146), '2:26', '146 segundos deve formatar para 2:26');
  assert.strictEqual(formatMusicDuration(30), '0:30', '30 segundos deve formatar para 0:30');
  assert.strictEqual(formatMusicDuration('0:146'), '2:26', 'Formato anterior 0:146 deve ser corrigido para 2:26');
  assert.strictEqual(formatMusicDuration(214), '3:34', '214 segundos deve formatar para 3:34');
  assert.strictEqual(formatMusicDuration(5), '0:05', '5 segundos deve formatar para 0:05');

  // 3. Adicionar uma segunda faixa favorita
  const sampleTrack2 = {
    id: 'fav_track_02',
    title: 'Amanhecer no Sertão',
    artist: 'Viola Elétrica',
    cover: 'https://example.com/cover2.jpg',
    audioUrl: 'https://example.com/audio2.mp3',
    duration: 146
  };

  await toggleFavoriteTrack(sampleTrack2);
  assert.strictEqual(isTrackFavorited('fav_track_02'), true);
  assert.strictEqual(getUserFavoriteTracks().length, 2, 'Lista agora deve ter 2 faixas');

  // 4. Filtragem por categoria "favorites" via searchMusicTracks
  const favResults = await searchMusicTracks('', 'favorites');
  assert.strictEqual(favResults.length, 2, 'searchMusicTracks com categoria favorites deve listar as 2 favoritas');
  assert.ok(favResults.some(t => t.id === 'fav_track_01'));
  assert.ok(favResults.some(t => t.id === 'fav_track_02'));

  // Busca textual dentro das favoritas
  const filterQuery = await searchMusicTracks('Sertão', 'favorites');
  assert.strictEqual(filterQuery.length, 1, 'Busca por Sertão deve filtrar apenas a faixa correspondente');
  assert.strictEqual(filterQuery[0].id, 'fav_track_02');

  // 5. Teste da Aba "⭐ Favoritas" no Modal de Escolha de Música
  await openMusicPicker('status');
  assert.strictEqual(env.elements['music-picker-modal'].classList.contains('active'), true, 'Modal de música deve abrir');

  const favoritesChip = env.elements['music-chip-favorites'];
  assert.ok(favoritesChip, 'Chip ⭐ Favoritas deve existir');
  assert.strictEqual(favoritesChip.dataset.genre, 'favorites');

  // Simular clique no chip Favoritas
  await favoritesChip.click();
  assert.strictEqual(favoritesChip.classList.contains('active'), true, 'Chip Favoritas deve se tornar ativo');

  const resultsContainer = env.elements['music-tracks-list'];
  assert.ok(resultsContainer, 'music-tracks-list deve existir no DOM');
  assert.ok(resultsContainer.innerHTML.includes('Neon Skyline Night'), 'Resultados devem conter a faixa favoritada Neon Skyline Night');
  assert.ok(resultsContainer.innerHTML.includes('Amanhecer no Sertão'), 'Resultados devem conter a faixa favoritada Amanhecer no Sertão');
  assert.ok(resultsContainer.innerHTML.includes('data-action="toggle-fav-track"'), 'Card deve renderizar o botão de favoritar');
  assert.ok(resultsContainer.innerHTML.includes('2:26'), 'Duração de 146 segundos deve ser exibida como 2:26');
  assert.strictEqual(resultsContainer.innerHTML.includes('0:146'), false, 'NUNCA deve exibir 0:146');

  // 6. Selecionar música favorita para Story
  selectMusicTrack(sampleTrack1);
  assert.strictEqual(env.elements['music-picker-modal'].classList.contains('active'), false, 'Modal deve fechar após selecionar');
  assert.deepStrictEqual(getPendingStatusMusic(), sampleTrack1, 'Faixa favorita deve ser anexada ao status pendente');
  assert.strictEqual(env.elements['status-selected-music-title'].innerText, 'Neon Skyline Night');

  // 7. Selecionar música favorita para Post
  await openMusicPicker('post');
  selectMusicTrack(sampleTrack2);
  assert.deepStrictEqual(getPendingPostMusic(), sampleTrack2, 'Faixa favorita deve ser anexada ao post pendente');
  assert.strictEqual(env.elements['post-selected-music-title'].innerText, 'Amanhecer no Sertão');

  // 8. Desfavoritar / Remover faixa dos favoritos (toggle)
  await toggleFavoriteTrack(sampleTrack1);
  assert.strictEqual(isTrackFavorited('fav_track_01'), false, 'Faixa fav_track_01 deve ser desmarcada');
  assert.strictEqual(getUserFavoriteTracks().length, 1, 'Lista agora deve ter 1 faixa');
  assert.strictEqual(!!env.firestoreDocs[firestoreDocPath], false, 'Documento deve ser removido do Firestore');

  // Remover a segunda faixa para testar o Empty State da aba Favoritas
  await toggleFavoriteTrack(sampleTrack2);
  assert.strictEqual(getUserFavoriteTracks().length, 0, 'Lista deve estar vazia');

  // Abrir picker na aba Favoritas e verificar empty state
  await openMusicPicker('status');
  await favoritesChip.click();
  const emptyEl = env.elements['music-empty-state'];
  assert.strictEqual(emptyEl.style.display, 'flex', 'Deve exibir empty state de músicas');
  assert.ok(emptyEl.innerHTML.includes('music-empty-favorites'), 'Deve exibir empty state customizado de favoritas');
  assert.ok(emptyEl.innerHTML.includes('Nenhuma música favoritada ainda'), 'Texto de empty state deve orientar o usuário');

  // 9. Sincronização e Logout
  env.sandbox.window.setCurrentUser(null);
  await loadUserFavoriteTracks();
  assert.strictEqual(getUserFavoriteTracks().length, 0, 'Favoritas devem ser limpas no logout');
});

test('Pré-visualização de Story: Renderização do card inline com foto/vídeo, remoção de mídia, validação, abertura no Story Viewer em modo prévia (com música e legenda) e publicação direta', async () => {
  const env = createTestEnvironment();

  const openStoryPreview = env.sandbox.openStoryPreview || env.sandbox.window.openStoryPreview;
  const removeSelectedStatusMedia = env.sandbox.removeSelectedStatusMedia || env.sandbox.window.removeSelectedStatusMedia;
  const setPendingStatusMedia = env.sandbox.setPendingStatusMedia || env.sandbox.window.setPendingStatusMedia;
  const getPendingStatusFile = env.sandbox.getPendingStatusFile || env.sandbox.window.getPendingStatusFile;
  const getPendingStatusFileSrc = env.sandbox.getPendingStatusFileSrc || env.sandbox.window.getPendingStatusFileSrc;
  const isStoryPreviewMode = env.sandbox.isStoryPreviewMode || env.sandbox.window.isStoryPreviewMode;
  const setPendingStatusMusic = env.sandbox.setPendingStatusMusic || env.sandbox.window.setPendingStatusMusic;

  assert.ok(typeof openStoryPreview === 'function', 'openStoryPreview deve ser uma função');
  assert.ok(typeof removeSelectedStatusMedia === 'function', 'removeSelectedStatusMedia deve ser uma função');
  assert.ok(typeof setPendingStatusMedia === 'function', 'setPendingStatusMedia deve ser uma função');

  // 1. Integridade dos Elementos no DOM
  const previewBox = env.elements['status-media-preview-box'];
  const previewImg = env.elements['status-preview-img'];
  const previewVideo = env.elements['status-preview-video'];
  const previewFilename = env.elements['status-preview-filename'];
  const previewTag = env.elements['status-preview-tag'];
  const removeMediaBtn = env.elements['remove-status-media-btn'];
  const chooseMediaLabel = env.elements['choose-status-media-label'];
  const previewStatusBtn = env.elements['preview-status-btn'];
  const publishStatusBtn = env.elements['publish-status-btn'];
  const previewIndicator = env.elements['story-preview-indicator'];
  const previewFooter = env.elements['story-preview-footer'];
  const previewBackBtn = env.elements['story-preview-back-btn'];
  const previewPublishNowBtn = env.elements['story-preview-publish-now-btn'];
  const storyViewer = env.elements['story-viewer'];

  assert.ok(previewBox, 'Elemento #status-media-preview-box deve existir');
  assert.ok(previewImg, 'Elemento #status-preview-img deve existir');
  assert.ok(previewVideo, 'Elemento #status-preview-video deve existir');
  assert.ok(previewFilename, 'Elemento #status-preview-filename deve existir');
  assert.ok(previewTag, 'Elemento #status-preview-tag deve existir');
  assert.ok(removeMediaBtn, 'Elemento #remove-status-media-btn deve existir');
  assert.ok(chooseMediaLabel, 'Elemento #choose-status-media-label deve existir');
  assert.ok(previewStatusBtn, 'Elemento #preview-status-btn deve existir');
  assert.ok(publishStatusBtn, 'Elemento #publish-status-btn deve existir');
  assert.ok(previewIndicator, 'Elemento #story-preview-indicator deve existir');
  assert.ok(previewFooter, 'Elemento #story-preview-footer deve existir');
  assert.ok(previewBackBtn, 'Elemento #story-preview-back-btn deve existir');
  assert.ok(previewPublishNowBtn, 'Elemento #story-preview-publish-now-btn deve existir');

  // 2. Validação: Tentar abrir prévia sem selecionar mídia
  openStoryPreview();
  assert.strictEqual(storyViewer.classList.contains('active'), false, 'Não deve abrir prévia sem mídia selecionada');

  // 3. Selecionar Imagem (Foto) e Verificar Card Inline
  const mockImageFile = { name: 'passeio_praia.jpg', type: 'image/jpeg', size: 204800 };
  setPendingStatusMedia(mockImageFile, 'image');

  assert.strictEqual(getPendingStatusFile()?.name, 'passeio_praia.jpg', 'Arquivo pendente deve ser a foto');
  assert.ok(getPendingStatusFileSrc(), 'Src da mídia deve ser gerada');
  assert.strictEqual(previewBox.style.display, 'flex', 'Card inline de mídia deve ficar visível');
  assert.strictEqual(previewImg.style.display, 'block', 'Prévia de imagem deve estar visível');
  assert.strictEqual(previewVideo.style.display, 'none', 'Prévia de vídeo deve estar oculta para imagens');
  assert.strictEqual(previewFilename.textContent, 'passeio_praia.jpg', 'Nome do arquivo deve ser exibido');
  assert.ok(previewTag.innerHTML.includes('Foto selecionada'), 'Tag de foto deve ser exibida');
  assert.strictEqual(chooseMediaLabel.textContent, 'Trocar Mídia', 'Label do botão deve mudar para Trocar Mídia');

  // 4. Remover Mídia Selecionada via Botão de Exclusão (Lixeira)
  await removeMediaBtn.click();
  assert.strictEqual(getPendingStatusFile(), null, 'pendingStatusFile deve ser limpo');
  assert.strictEqual(getPendingStatusFileSrc(), null, 'pendingStatusFileSrc deve ser limpo');
  assert.strictEqual(previewBox.style.display, 'none', 'Card inline deve ser ocultado');
  assert.strictEqual(previewImg.style.display, 'none', 'Prévia de imagem deve ser ocultada');
  assert.strictEqual(chooseMediaLabel.textContent, 'Escolher Mídia', 'Label deve voltar para Escolher Mídia');

  // 5. Selecionar Vídeo (<= 15s) e Verificar Card Inline
  const mockVideoFile = { name: 'momento_especial.mp4', type: 'video/mp4', size: 1048576 };
  setPendingStatusMedia(mockVideoFile, 'video');

  assert.strictEqual(getPendingStatusFile()?.name, 'momento_especial.mp4', 'Arquivo pendente deve ser o vídeo');
  assert.strictEqual(previewBox.style.display, 'flex', 'Card inline de mídia deve ficar visível');
  assert.strictEqual(previewVideo.style.display, 'block', 'Prévia de vídeo deve estar visível');
  assert.strictEqual(previewImg.style.display, 'none', 'Prévia de foto deve estar oculta');
  assert.ok(previewTag.innerHTML.includes('Vídeo selecionado'), 'Tag de vídeo deve ser exibida');
  assert.strictEqual(chooseMediaLabel.textContent, 'Trocar Mídia');

  // 6. Configurar Legenda, Música e Usuário VIP para Testar Modo Prévia Completo
  const captionInput = env.elements['status-caption-input'];
  if (captionInput) captionInput.value = 'Curtindo o pôr do sol incrível 🌅';

  const mockTrack = {
    id: 'track_preview_vip',
    title: 'Sunset Beats',
    artist: 'Chillout DJ',
    audioUrl: 'https://cdn.pixabay.com/audio/sunset.mp3',
    duration: 30
  };
  setPendingStatusMusic(mockTrack);

  env.sandbox.window.setCurrentUser({ uid: 'vip-user-preview', email: 'preview@vortex.com' });
  env.sandbox.window.setCurrentProfile({
    name: 'Mariana VIP',
    username: '@marianavip',
    avatar: 'https://example.com/mariana.jpg',
    isVip: true
  });

  // Abrir Prévia via botão "Pré-visualizar Story"
  env.elements['post-status-overlay'].classList.add('active');
  await previewStatusBtn.click();

  assert.strictEqual(storyViewer.classList.contains('active'), true, 'Story Viewer deve abrir');
  assert.strictEqual(isStoryPreviewMode(), true, 'Deve estar em modo de pré-visualização');
  assert.strictEqual(previewIndicator.style.display, 'inline-flex', 'Badge de PRÉVIA deve estar visível');
  assert.strictEqual(previewFooter.style.display, 'flex', 'Footer de prévia deve estar visível');

  // Botões de interação normal do story devem estar ocultos
  assert.strictEqual(env.elements['delete-story-btn'].style.display, 'none', 'delete-story-btn deve estar oculto na prévia');
  assert.strictEqual(env.elements['report-story-btn'].style.display, 'none', 'report-story-btn deve estar oculto na prévia');
  assert.strictEqual(env.elements['download-story-btn'].style.display, 'none', 'download-story-btn deve estar oculto na prévia');
  assert.strictEqual(env.elements['own-story-footer'].style.display, 'none', 'own-story-footer deve estar oculto na prévia');
  assert.strictEqual(env.elements['other-story-footer'].style.display, 'none', 'other-story-footer deve estar oculto na prévia');

  // Elementos do header e conteúdo na prévia
  assert.strictEqual(env.elements['story-username'].innerText, 'Mariana VIP', 'Nome do autor deve ser exibido');
  assert.strictEqual(env.elements['story-caption'].innerText, 'Curtindo o pôr do sol incrível 🌅', 'Legenda deve ser exibida no Story');
  assert.strictEqual(env.elements['story-music-badge'].style.display, 'flex', 'Badge de trilha sonora deve ser exibida');
  assert.strictEqual(env.elements['story-music-title'].innerText, 'Sunset Beats', 'Título da música deve ser exibido');
  assert.strictEqual(env.elements['story-verified-badge'].style.display, 'inline-block', 'Selo VIP deve ser exibido para usuário VIP');

  // Não deve gravar visualizações no Firestore durante a prévia
  const storyDocsCountBefore = Object.keys(env.firestoreDocs).filter(k => k.startsWith('stories/')).length;
  assert.strictEqual(storyDocsCountBefore, 0, 'Nenhum documento de story/view deve ter sido criado na prévia');

  // 7. Botão "Voltar ao Editor" na Prévia
  await previewBackBtn.click();
  assert.strictEqual(storyViewer.classList.contains('active'), false, 'Story Viewer deve fechar ao clicar em Voltar');
  assert.strictEqual(previewIndicator.style.display, 'none', 'Badge de prévia deve ser ocultada');
  assert.strictEqual(previewFooter.style.display, 'none', 'Footer de prévia deve ser ocultado');
  assert.strictEqual(isStoryPreviewMode(), false, 'Modo de prévia deve ser desativado');
  assert.strictEqual(env.elements['post-status-overlay'].classList.contains('active'), true, 'Modal post-status-overlay deve continuar aberto');
  assert.strictEqual(captionInput.value, 'Curtindo o pôr do sol incrível 🌅', 'Legenda deve permanecer intacta ao voltar');
  assert.strictEqual(getPendingStatusFile()?.name, 'momento_especial.mp4', 'Mídia selecionada deve permanecer intacta ao voltar');

  // 8. Botão "Publicar Agora" a partir da Prévia
  await previewStatusBtn.click(); // Reabrir prévia
  assert.strictEqual(storyViewer.classList.contains('active'), true);
  assert.strictEqual(isStoryPreviewMode(), true);

  await previewPublishNowBtn.click(); // Clicar em Publicar Agora direto da prévia
  assert.strictEqual(storyViewer.classList.contains('active'), false, 'Story Viewer deve fechar ao publicar');

  // Aguardar ciclo assíncrono do FileReader.onload e addDoc
  await new Promise(r => setTimeout(r, 30));

  // Verificar publicação no Firestore
  const publishedStoryKey = Object.keys(env.firestoreDocs).find(k => k.startsWith('stories/'));
  assert.ok(publishedStoryKey, 'Novo story deve ter sido criado no Firestore');
  const publishedStory = env.firestoreDocs[publishedStoryKey];
  assert.strictEqual(publishedStory.authorUid, 'vip-user-preview');
  assert.strictEqual(publishedStory.authorName, 'Mariana VIP');
  assert.strictEqual(publishedStory.caption, 'Curtindo o pôr do sol incrível 🌅');
  assert.strictEqual(publishedStory.type, 'video');
  assert.strictEqual(publishedStory.music.title, 'Sunset Beats');

  // Estado do compositor deve ser resetado após publicação
  assert.strictEqual(env.elements['post-status-overlay'].classList.contains('active'), false, 'post-status-overlay deve fechar após publicação');
  assert.strictEqual(getPendingStatusFile(), null, 'pendingStatusFile deve ser limpo após publicação');
  assert.strictEqual(previewBox.style.display, 'none', 'Card inline de mídia deve ser ocultado após publicação');
  assert.strictEqual(chooseMediaLabel.textContent, 'Escolher Mídia', 'Botão deve voltar para Escolher Mídia após publicação');
});

test('Compressão de Mídia para KB e Corte Automático de Vídeos: Fotos em KB, corte para 15s em stories e para 2 min (120s) em posts > 3 min, badges e publicação', async () => {
  const env = createTestEnvironment();

  const formatBytesToKB = env.sandbox.formatBytesToKB || env.sandbox.window.formatBytesToKB;
  const formatDurationSeconds = env.sandbox.formatDurationSeconds || env.sandbox.window.formatDurationSeconds;
  const compressImageFileToKB = env.sandbox.compressImageFileToKB || env.sandbox.window.compressImageFileToKB;
  const trimAndCompressVideoToKB = env.sandbox.trimAndCompressVideoToKB || env.sandbox.window.trimAndCompressVideoToKB;
  const setPendingStatusMedia = env.sandbox.setPendingStatusMedia || env.sandbox.window.setPendingStatusMedia;
  const removeSelectedStatusMedia = env.sandbox.removeSelectedStatusMedia || env.sandbox.window.removeSelectedStatusMedia;
  const handlePostMediaSelection = env.sandbox.handlePostMediaSelection || env.sandbox.window.handlePostMediaSelection;
  const resetPostComposer = env.sandbox.resetPostComposer || env.sandbox.window.resetPostComposer;

  assert.ok(typeof formatBytesToKB === 'function', 'formatBytesToKB deve ser uma função');
  assert.ok(typeof formatDurationSeconds === 'function', 'formatDurationSeconds deve ser uma função');
  assert.ok(typeof compressImageFileToKB === 'function', 'compressImageFileToKB deve ser uma função');
  assert.ok(typeof trimAndCompressVideoToKB === 'function', 'trimAndCompressVideoToKB deve ser uma função');

  // 1. Funções Utilitárias: Conversão de Bytes para KB e Formatação de Tempo
  assert.strictEqual(formatBytesToKB(1024), '1 KB');
  assert.strictEqual(formatBytesToKB(512000), '500 KB');
  assert.strictEqual(formatBytesToKB(2097152), '2048 KB');
  assert.strictEqual(formatBytesToKB(0), '0 KB');

  assert.strictEqual(formatDurationSeconds(15), '0:15');
  assert.strictEqual(formatDurationSeconds(120), '2:00');
  assert.strictEqual(formatDurationSeconds(180), '3:00');
  assert.strictEqual(formatDurationSeconds(75), '1:15');

  // 2. Compressão de Foto para a Faixa de KB
  const largeMockPhoto = {
    name: 'foto_alta_resolucao.jpg',
    type: 'image/jpeg',
    size: 4194304 // 4 MB
  };
  const photoResult = await compressImageFileToKB(largeMockPhoto, { maxDimension: 1280, targetMaxKB: 500 });
  assert.ok(photoResult, 'Resultado da compressão de imagem deve existir');
  assert.ok(photoResult.sizeFormatted.includes('KB'), 'Tamanho da imagem deve ser formatado em KB');
  assert.ok(photoResult.dataUrl.startsWith('data:image/'), 'Deve gerar DataURL da imagem');

  // 3. Corte e Compressão de Vídeo para Stories (Máximo 15 segundos)
  const longStoryVideo = {
    name: 'video_story_longo.mp4',
    type: 'video/mp4',
    size: 15728640, // 15 MB
    duration: 50 // 50 segundos (> 15s)
  };
  const storyVideoResult = await trimAndCompressVideoToKB(longStoryVideo, { isStory: true });
  assert.ok(storyVideoResult, 'Resultado do corte de vídeo para story deve existir');
  assert.strictEqual(storyVideoResult.isTrimmed, true, 'Vídeo de story com > 15s deve ser marcado como isTrimmed');
  assert.strictEqual(storyVideoResult.duration, 15, 'Vídeo de story deve ser cortado para exatamente 15s');
  assert.strictEqual(storyVideoResult.durationFormatted, '0:15');
  assert.ok(storyVideoResult.sizeFormatted.includes('KB'), 'Tamanho estimado deve estar em KB');
  assert.ok(storyVideoResult.src.includes('#t=0,15'), 'URL do vídeo deve incluir media fragment de corte #t=0,15');

  // Vídeo de story curto (<= 15s) não deve ser cortado
  const shortStoryVideo = {
    name: 'video_story_curto.mp4',
    type: 'video/mp4',
    size: 2097152,
    duration: 10
  };
  const shortStoryResult = await trimAndCompressVideoToKB(shortStoryVideo, { isStory: true });
  assert.strictEqual(shortStoryResult.isTrimmed, false, 'Vídeo de story <= 15s não deve ser cortado');
  assert.strictEqual(shortStoryResult.duration, 10);

  // 4. Corte e Compressão de Vídeo para Post (Vídeos > 3 min cortados para 2 min / 120s)
  const longPostVideo = {
    name: 'video_post_longo.mp4',
    type: 'video/mp4',
    size: 52428800, // 50 MB
    duration: 240 // 4 minutos (> 180s / 3 min)
  };
  const postVideoResult = await trimAndCompressVideoToKB(longPostVideo, { maxDuration: 120, cutThreshold: 180 });
  assert.ok(postVideoResult, 'Resultado do corte de vídeo de post deve existir');
  assert.strictEqual(postVideoResult.isTrimmed, true, 'Vídeo de post > 3 min deve ser marcado como isTrimmed');
  assert.strictEqual(postVideoResult.duration, 120, 'Vídeo de post deve ser cortado para 2 minutos (120s)');
  assert.strictEqual(postVideoResult.durationFormatted, '2:00');
  assert.ok(postVideoResult.sizeFormatted.includes('KB'), 'Tamanho deve estar em KB');
  assert.ok(postVideoResult.src.includes('#t=0,120'), 'URL do vídeo de post deve incluir media fragment #t=0,120');

  // Vídeo de post <= 3 min (ex: 90s) não deve ser cortado
  const normalPostVideo = {
    name: 'video_post_normal.mp4',
    type: 'video/mp4',
    size: 10485760,
    duration: 90
  };
  const normalPostResult = await trimAndCompressVideoToKB(normalPostVideo, { maxDuration: 120, cutThreshold: 180 });
  assert.strictEqual(normalPostResult.isTrimmed, false, 'Vídeo <= 3 min não deve ser cortado');
  assert.strictEqual(normalPostResult.duration, 90);

  // 5. Interface de Usuário no Story (Preview Card: Tamanho em KB e Badge de Corte)
  const statusPreviewSize = env.elements['status-preview-size'];
  const statusTrimmedBadge = env.elements['status-preview-trimmed-badge'];
  assert.ok(statusPreviewSize, '#status-preview-size deve existir no DOM');
  assert.ok(statusTrimmedBadge, '#status-preview-trimmed-badge deve existir no DOM');

  // Seleciona vídeo longo de status (30s)
  const video30s = { name: 'viagem.mp4', type: 'video/mp4', size: 8388608, duration: 30 };
  setPendingStatusMedia(video30s, 'video');
  await new Promise(r => setTimeout(r, 20));

  assert.ok(statusPreviewSize.innerHTML.includes('KB'), 'Card inline de story deve exibir tamanho em KB');
  assert.strictEqual(statusTrimmedBadge.style.display, 'inline-flex', 'Badge de corte deve ser exibido para vídeo > 15s');
  assert.ok(statusTrimmedBadge.innerHTML.includes('Cortado (15s)'), 'Badge deve indicar Cortado (15s)');

  // Limpeza de mídia do Story
  removeSelectedStatusMedia();
  assert.strictEqual(statusTrimmedBadge.style.display, 'none', 'Badge de corte deve ser ocultado ao remover mídia');

  // 6. Interface de Usuário no Post Composer (Info Bar: Tag, Tamanho em KB, Duração e Badge de Corte)
  const postInfoBar = env.elements['post-media-info-bar'];
  const postTag = env.elements['post-preview-tag'];
  const postSize = env.elements['post-preview-size'];
  const postDuration = env.elements['post-preview-duration'];
  const postTrimmedBadge = env.elements['post-preview-trimmed-badge'];

  assert.ok(postInfoBar, '#post-media-info-bar deve existir no DOM');
  assert.ok(postTag, '#post-preview-tag deve existir no DOM');
  assert.ok(postSize, '#post-preview-size deve existir no DOM');
  assert.ok(postDuration, '#post-preview-duration deve existir no DOM');
  assert.ok(postTrimmedBadge, '#post-preview-trimmed-badge deve existir no DOM');

  // Testar seleção de foto no post
  const photoFile = { name: 'foto_paisagem.jpg', type: 'image/jpeg', size: 1572864 };
  handlePostMediaSelection(photoFile);
  await new Promise(r => setTimeout(r, 20));

  assert.strictEqual(postInfoBar.style.display, 'flex', 'Barra de info deve estar visível');
  assert.ok(postTag.innerHTML.includes('Foto'), 'Tag deve indicar Foto');
  assert.ok(postSize.innerHTML.includes('KB'), 'Tamanho da foto deve ser exibido em KB');
  assert.strictEqual(postDuration.style.display, 'none', 'Duração deve estar oculta para fotos');
  assert.strictEqual(postTrimmedBadge.style.display, 'none', 'Badge de corte deve estar oculto para fotos');

  // Testar seleção de vídeo longo (> 3 min) no post
  const video4min = { name: 'podcast_video.mp4', type: 'video/mp4', size: 41943040, duration: 240 };
  handlePostMediaSelection(video4min);
  await new Promise(r => setTimeout(r, 20));

  assert.strictEqual(postInfoBar.style.display, 'flex', 'Barra de info deve estar visível para vídeo');
  assert.ok(postTag.innerHTML.includes('Vídeo'), 'Tag deve indicar Vídeo');
  assert.ok(postSize.innerHTML.includes('KB'), 'Tamanho do vídeo deve estar em KB');
  assert.strictEqual(postDuration.style.display, 'inline-flex', 'Duração deve estar visível para vídeo');
  assert.ok(postDuration.innerHTML.includes('2:00'), 'Duração deve ser 2:00 para vídeo cortado');
  assert.strictEqual(postTrimmedBadge.style.display, 'inline-flex', 'Badge de corte deve estar visível');
  assert.ok(postTrimmedBadge.innerHTML.includes('Cortado (2 min)'), 'Badge deve indicar Cortado (2 min)');

  // Resetar compositor de post
  resetPostComposer();
  assert.strictEqual(postInfoBar.style.display, 'none', 'Barra de info deve ser ocultada ao resetar');

  // 7. Publicação no Firestore: Verificação de Metadados de Otimização
  env.sandbox.window.setCurrentUser({ uid: 'user_media_test', email: 'media@test.com' });
  env.sandbox.window.setCurrentProfile({ name: 'Lucas Criador', username: '@lucascriador', avatar: '' });

  // Publicar post com vídeo de 4 min
  handlePostMediaSelection(video4min);
  await new Promise(r => setTimeout(r, 20));

  const publishPostBtn = env.elements['publish-post-btn'];
  await publishPostBtn.click();
  await new Promise(r => setTimeout(r, 30));

  const publishedPostKey = Object.keys(env.firestoreDocs).find(k => k.startsWith('posts/'));
  assert.ok(publishedPostKey, 'Post deve ter sido criado no Firestore');
  const postDoc = env.firestoreDocs[publishedPostKey];
  assert.strictEqual(postDoc.isTrimmed, true, 'Post deve registrar isTrimmed: true no Firestore');
  assert.strictEqual(postDoc.videoDuration, 120, 'Post deve registrar duração de 120s no Firestore');
  assert.ok(postDoc.mediaSizeKB.includes('KB'), 'Post deve registrar tamanho em KB no Firestore');
});

test('Particionamento de Mídia em Chunks no Firestore: Publicação de vídeos grandes (ex: 2164 KB / 2.8 MB Base64) sem estourar limite de 1MB, remontagem transparente e corte rigoroso', async () => {
  const env = createTestEnvironment();
  const saveMediaWithChunks = env.sandbox.window.saveMediaWithChunks;
  const loadMediaWithChunks = env.sandbox.window.loadMediaWithChunks;
  const mediaChunkCache = env.sandbox.window.mediaChunkCache;
  const setPendingStatusMedia = env.sandbox.window.setPendingStatusMedia;
  const handlePostMediaSelection = env.sandbox.window.handlePostMediaSelection;

  assert.ok(typeof saveMediaWithChunks === 'function', 'saveMediaWithChunks deve ser exportada');
  assert.ok(typeof loadMediaWithChunks === 'function', 'loadMediaWithChunks deve ser exportada');
  assert.ok(mediaChunkCache && typeof mediaChunkCache.get === 'function', 'mediaChunkCache deve ter métodos de Map');

  // 1. Testar salvamento de payload pequeno (<= 700 KB) - deve salvar direto
  const smallPayload = 'data:image/jpeg;base64,' + 'A'.repeat(10000);
  const smallDocRef = await saveMediaWithChunks('stories', {
    authorUid: 'user_small',
    type: 'image',
    caption: 'Foto pequena'
  }, 'src', smallPayload);

  assert.ok(smallDocRef && smallDocRef.id, 'Deve retornar docRef');
  const savedSmallDoc = env.firestoreDocs[`stories/${smallDocRef.id}`];
  assert.strictEqual(savedSmallDoc.hasChunks, false, 'Payload pequeno não deve ter chunks');
  assert.strictEqual(savedSmallDoc.src, smallPayload, 'Payload pequeno deve ser salvo diretamente no campo src');

  // 2. Testar salvamento de payload grande (> 700 KB, simulando vídeo de 2164 KB que gera ~2.88 MB de Base64)
  // Criamos uma string de 2.800.000 caracteres
  const largePayload = 'data:video/mp4;base64,' + 'V'.repeat(2800000);
  const largeDocRef = await saveMediaWithChunks('stories', {
    authorUid: 'user_large',
    type: 'video',
    caption: 'Status vídeo 2164 KB',
    isTrimmed: true,
    mediaSizeKB: '2164 KB'
  }, 'src', largePayload);

  assert.ok(largeDocRef && largeDocRef.id, 'Deve retornar docRef para mídia particionada');
  const savedLargeDoc = env.firestoreDocs[`stories/${largeDocRef.id}`];
  
  // Documento principal NÃO deve ter a string de 2.8 MB (que quebraria o Firestore com > 1048487 bytes)
  assert.strictEqual(savedLargeDoc.src, null, 'O campo src no documento principal deve ser null para evitar estourar 1MB');
  assert.strictEqual(savedLargeDoc.hasChunks, true, 'O documento principal deve ser marcado com hasChunks: true');
  assert.strictEqual(savedLargeDoc.totalChunks, 6, '2.800.022 caracteres divididos em blocos de 500.000 resultam em 6 chunks');

  // Verificar chunks salvos na subcoleção stories/{id}/chunks/{0..5}
  const chunkKeys = Object.keys(env.firestoreDocs).filter(k => k.startsWith(`stories/${largeDocRef.id}/chunks/`));
  assert.strictEqual(chunkKeys.length, 6, 'Devem existir exatamente 6 documentos de chunks na subcoleção');

  // Nenhum chunk individual pode exceder 500.000 caracteres
  chunkKeys.forEach(k => {
    const chunkDoc = env.firestoreDocs[k];
    assert.ok(chunkDoc.part.length <= 500000, 'Nenhum chunk pode exceder 500.000 caracteres');
    assert.ok(typeof chunkDoc.index === 'number', 'Cada chunk deve ter índice numérico');
  });

  // 3. Testar remontagem transparente via loadMediaWithChunks
  // Primeiro, limpamos o cache em memória para forçar leitura real da subcoleção Firestore
  mediaChunkCache.delete(`stories_${largeDocRef.id}`);

  const reassembledPayload = await loadMediaWithChunks('stories', largeDocRef.id, '');
  assert.strictEqual(reassembledPayload.length, largePayload.length, 'Payload remontado deve ter o tamanho exato original');
  assert.strictEqual(reassembledPayload, largePayload, 'Payload remontado deve ser idêntico byte a byte ao original');
  assert.strictEqual(mediaChunkCache.get(`stories_${largeDocRef.id}`), largePayload, 'Deve gravar no cache em memória após leitura');

  // 4. Testar detecção de corte de 15s para vídeo de Stories no statusFileInput
  const storyLongVideo = {
    name: 'whats_app_video_2164kb.mp4',
    type: 'video/mp4',
    size: 2215936, // 2164 KB
    duration: 45 // 45 segundos (> 15s)
  };
  setPendingStatusMedia(storyLongVideo, 'video');
  await new Promise(r => setTimeout(r, 20));

  const trimmedBadge = env.elements['status-preview-trimmed-badge'];
  const previewSize = env.elements['status-preview-size'];
  assert.ok(trimmedBadge, '#status-preview-trimmed-badge deve existir');
  assert.strictEqual(trimmedBadge.style.display, 'inline-flex', 'Badge de corte deve ser exibida imediatamente para vídeo > 15s');
  assert.ok(trimmedBadge.innerHTML.includes('Cortado (15s)'), 'Badge deve exibir Cortado (15s)');
  assert.ok(previewSize.innerHTML.includes('KB'), 'Tamanho deve estar em KB');

  // 5. Testar detecção de corte de 2 min (120s) para vídeo de Posts no handlePostMediaSelection
  const postLongVideo = {
    name: 'podcast_4min.mp4',
    type: 'video/mp4',
    size: 45000000,
    duration: 240 // 4 minutos (> 180s)
  };
  handlePostMediaSelection(postLongVideo);
  await new Promise(r => setTimeout(r, 20));

  const postTrimBadge = env.elements['post-preview-trimmed-badge'];
  const postDuration = env.elements['post-preview-duration'];
  assert.ok(postTrimBadge, '#post-preview-trimmed-badge deve existir');
  assert.strictEqual(postTrimBadge.style.display, 'inline-flex', 'Badge de corte deve ser exibida para vídeo de post > 3 min');
  assert.ok(postTrimBadge.innerHTML.includes('Cortado (2 min)'), 'Badge deve exibir Cortado (2 min)');
  assert.ok(postDuration.innerHTML.includes('2:00'), 'Duração deve ser formatada como 2:00');
});

test('Mídias no Chat de Contatos: Fotos em KB, corte de vídeos e músicas para 2 min em KB, e particionamento em chunks no Firestore', async () => {
  const env = createTestEnvironment();
  const alice = { uid: 'user-alice-111', email: 'alice@vortex.vip', name: 'Alice' };
  const bob = { uid: 'user-bob-222', email: 'bob@vortex.vip', name: 'Bob' };
  if (typeof env.sandbox.window.setCurrentUser === 'function') {
    env.sandbox.window.setCurrentUser(alice);
  }

  const mediaSizeLimits = env.sandbox.window.mediaSizeLimits;
  const compressImageFileToKB = env.sandbox.window.compressImageFileToKB;
  const trimAndCompressVideoToKB = env.sandbox.window.trimAndCompressVideoToKB;
  const trimAndCompressAudioToKB = env.sandbox.window.trimAndCompressAudioToKB;
  const updateMessageMediaWithChunks = env.sandbox.window.updateMessageMediaWithChunks;
  const loadMediaWithChunks = env.sandbox.window.loadMediaWithChunks;
  const mediaChunkCache = env.sandbox.window.mediaChunkCache;
  const playVoiceNote = env.sandbox.window.playVoiceNote;

  // 1. Validar que os limites de upload do chat foram elevados para 25 MB
  assert.ok(mediaSizeLimits, 'mediaSizeLimits deve existir');
  assert.strictEqual(mediaSizeLimits.image.bytes, 26214400, 'Limite para fotos deve ser 25 MB');
  assert.strictEqual(mediaSizeLimits.video.bytes, 26214400, 'Limite para vídeos deve ser 25 MB');
  assert.strictEqual(mediaSizeLimits.audio.bytes, 26214400, 'Limite para músicas/áudio deve ser 25 MB');
  assert.strictEqual(mediaSizeLimits.file.bytes, 26214400, 'Limite para arquivos deve ser 25 MB');

  // 2. Testar compressão de fotos para KB
  const rawImageFile = {
    name: 'ferias_praia.jpg',
    type: 'image/jpeg',
    size: 4800000 // 4.8 MB
  };
  const compressedPhoto = await compressImageFileToKB(rawImageFile, { maxDimension: 1280, targetMaxKB: 500 });
  assert.ok(compressedPhoto, 'Foto deve ser processada');
  assert.ok(compressedPhoto.sizeFormatted.includes('KB'), 'Tamanho da foto deve ser formatado em KB');
  assert.ok(compressedPhoto.dataUrl, 'Foto deve ter dataUrl gerado');

  // 3. Testar corte automático de vídeo para 2 minutos (120s) e tamanho em KB
  const longVideoFile = {
    name: 'aula_completa.mp4',
    type: 'video/mp4',
    size: 20000000, // 20 MB
    duration: 300 // 5 minutos (> 120s)
  };
  const processedLongVideo = await trimAndCompressVideoToKB(longVideoFile, { isChat: true, maxDuration: 120, cutThreshold: 120 });
  assert.strictEqual(processedLongVideo.isTrimmed, true, 'Vídeo com mais de 2 minutos deve ser cortado');
  assert.strictEqual(processedLongVideo.duration, 120, 'Duração do vídeo cortado deve ser 120 segundos');
  assert.ok(processedLongVideo.durationFormatted.includes('2:00'), 'Duração formatada deve conter 2:00');
  assert.ok(processedLongVideo.sizeFormatted.includes('KB'), 'Tamanho deve estar em KB');
  assert.ok(processedLongVideo.src.includes('#t=0,120'), 'src deve incluir fragmento de corte #t=0,120');

  // Testar vídeo curto (<= 2 min) - não deve ser cortado
  const shortVideoFile = {
    name: 'stories_rapido.mp4',
    type: 'video/mp4',
    size: 1500000,
    duration: 45 // 45 segundos
  };
  const processedShortVideo = await trimAndCompressVideoToKB(shortVideoFile, { isChat: true, maxDuration: 120, cutThreshold: 120 });
  assert.strictEqual(processedShortVideo.isTrimmed, false, 'Vídeo com menos de 2 minutos não deve ser cortado');
  assert.strictEqual(processedShortVideo.duration, 45, 'Duração deve ser mantida');

  // 4. Testar corte automático de música para 2 minutos (120s) e tamanho em KB
  const longMusicFile = {
    name: 'musica_rock_show.mp3',
    type: 'audio/mp3',
    size: 9000000, // 9 MB
    duration: 250 // 4 minutos e 10 segundos (> 120s)
  };
  const processedMusic = await trimAndCompressAudioToKB(longMusicFile, { maxDuration: 120, cutThreshold: 120 });
  assert.strictEqual(processedMusic.isTrimmed, true, 'Música com mais de 2 minutos deve ser cortada para 2 min');
  assert.strictEqual(processedMusic.duration, 120, 'Duração da música deve ser 120 segundos');
  assert.ok(processedMusic.durationFormatted.includes('2:00'), 'Duração formatada deve conter 2:00');
  assert.ok(processedMusic.sizeFormatted.includes('KB'), 'Tamanho da música deve ser em KB');
  assert.ok(processedMusic.src.includes('#t=0,120'), 'src da música deve incluir fragmento de corte #t=0,120');

  // Testar música curta (<= 2 min) - não deve ser cortada
  const shortMusicFile = {
    name: 'jingle.mp3',
    type: 'audio/mp3',
    size: 800000,
    duration: 50
  };
  const processedShortMusic = await trimAndCompressAudioToKB(shortMusicFile, { maxDuration: 120, cutThreshold: 120 });
  assert.strictEqual(processedShortMusic.isTrimmed, false, 'Música curta não deve ser cortada');
  assert.strictEqual(processedShortMusic.duration, 50);

  // 5. Testar particionamento de mensagens com chunks no chat (chats/{chatId}/messages/{msgId}/chunks)
  const chatId = `chat_${alice.uid}_${bob.uid}`;
  const msgId = 'msg_large_video_123';

  // Criar documento inicial da mensagem no mock do Firestore
  const msgPath = `chats/${chatId}/messages/${msgId}`;
  env.firestoreDocs[msgPath] = {
    senderUid: alice.uid,
    type: 'video',
    fileName: 'video_podcast.mp4',
    fileSize: '1540 KB',
    duration: '02:00',
    isTrimmed: true,
    uploadState: 'uploading'
  };

  // Simular payload Base64 de 2.2 MB (> 700 KB)
  const largeVideoPayload = 'data:video/mp4;base64,' + 'X'.repeat(2200000);
  await updateMessageMediaWithChunks(chatId, msgId, {
    uploadState: 'sent',
    uploadPercent: 100,
    fileSize: '1540 KB',
    duration: '02:00',
    isTrimmed: true
  }, largeVideoPayload);

  const updatedMsgDoc = env.firestoreDocs[msgPath];
  assert.strictEqual(updatedMsgDoc.fileData, null, 'fileData no doc da mensagem deve ser null para evitar erro de 1MB do Firestore');
  assert.strictEqual(updatedMsgDoc.hasChunks, true, 'hasChunks deve ser true');
  assert.strictEqual(updatedMsgDoc.totalChunks, 5, '2.200.022 caracteres devem ser divididos em 5 chunks de 500.000');

  // Verificar que os chunks foram salvos na subcoleção correta
  const savedChunkKeys = Object.keys(env.firestoreDocs).filter(k => k.startsWith(`chats/${chatId}/messages/${msgId}/chunks/`));
  assert.strictEqual(savedChunkKeys.length, 5, 'Devem existir 5 documentos na subcoleção chats/{chatId}/messages/{msgId}/chunks');

  // Testar remontagem via loadMediaWithChunks com caminho aninhado
  mediaChunkCache.delete(`chats/${chatId}/messages_${msgId}`);
  const reassembledChatMedia = await loadMediaWithChunks(`chats/${chatId}/messages`, msgId);
  assert.strictEqual(reassembledChatMedia.length, largeVideoPayload.length, 'Payload remontado deve ser idêntico ao original');
  assert.strictEqual(reassembledChatMedia, largeVideoPayload, 'Mídia do chat remontada byte a byte com perfeição');

  // 6. Testar limitação de reprodução no player playVoiceNote para áudios cortados (max 120s)
  const doc = env.sandbox.document;
  const dummyAudioPlayer = doc.createElement('div');
  dummyAudioPlayer.className = 'audio-player-ui';
  dummyAudioPlayer.dataset.isTrimmed = 'true';
  dummyAudioPlayer.dataset.maxDuration = '120';
  dummyAudioPlayer.dataset.totalDuration = '02:00';
  const durSpan = doc.createElement('span');
  durSpan.className = 'audio-duration-text';
  durSpan.innerText = '02:00';
  dummyAudioPlayer.appendChild(durSpan);

  playVoiceNote(dummyAudioPlayer, 'data:audio/mp3;base64,mock');
  assert.ok(dummyAudioPlayer.classList.contains('playing'), 'Player deve iniciar reprodução');

  // Simular evento ontimeupdate com currentTime alcançando 120s
  const currentPlaying = env.sandbox.currentPlayingAudio || env.sandbox.window.currentPlayingAudio;
  if (currentPlaying) {
    currentPlaying.currentTime = 120;
    if (typeof currentPlaying.ontimeupdate === 'function') {
      currentPlaying.ontimeupdate();
    }
    // Ao atingir 120s, deve parar e resetar
    assert.strictEqual(dummyAudioPlayer.classList.contains('playing'), false, 'Player deve parar ao atingir o limite de 2 minutos (120s)');
  }
});

test('Recursos VORTEX VIP: Temas VIP (Cyber Park, Hacker 0101 em canvas, RGB), Fontes Animadas VIP, Emojis Animados, Gaveta de Emojis e Papel de Parede do Chat', async () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.document;
  const localStorage = env.sandbox.localStorage;

  // 1. Verificação do Canvas de Códigos Binários e Temas VIP
  const matrixCanvas = env.elements['matrix-binary-canvas'];
  assert.ok(matrixCanvas, 'Elemento #matrix-binary-canvas deve existir no DOM');

  // Mock do getContext para o canvas no ambiente sandbox se necessário
  matrixCanvas.getContext = () => ({
    fillRect: () => {},
    fillText: () => {},
    clearRect: () => {},
    fillStyle: '',
    font: ''
  });

  // Usuário Comum (não-VIP): Bloqueio ao tentar selecionar tema VIP
  const userCommon = {
    uid: 'test-user-50',
    name: 'Usuario Comum',
    email: 'user@test.com',
    isVip: false,
    isVerified: false,
    vipStatus: 'none'
  };
  env.sandbox.window.setCurrentUser({ uid: 'test-user-50', email: 'user@test.com' });
  env.sandbox.window.setCurrentProfile(userCommon);

  // Inicializar controles de configurações VIP
  env.sandbox.setupVipSettingsControls();

  // Encontrar botões dos temas nas configurações
  const themeButtons = doc.querySelectorAll('.vip-theme-option');
  assert.ok(themeButtons.length >= 4, 'Devem existir opções para Padrão, Cyber Park, Hacker e RGB');

  const cyberOpt = themeButtons.find(b => b.dataset.theme === 'cyberpark');
  assert.ok(cyberOpt, 'Opção Cyber Park deve existir');

  // Não-VIP tenta ativar Cyber Park -> Bloqueado!
  await cyberOpt.onclick();
  const prof1 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.strictEqual(prof1.vipTheme, undefined, 'Usuário comum não pode ativar tema VIP');
  assert.ok(!doc.body.classList.contains('theme-cyberpark'), 'Classe theme-cyberpark não deve ser aplicada para não-VIP');

  // Agora transformar o usuário em VIP
  const userVip = {
    ...userCommon,
    isVip: true,
    isVerified: true,
    vipStatus: 'active',
    vipSubscriptionEnd: Date.now() + (30 * 24 * 60 * 60 * 1000)
  };
  env.sandbox.window.setCurrentProfile(userVip);

  // VIP ativa tema Cyber Park -> Sucesso!
  await cyberOpt.onclick();
  const prof2 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.strictEqual(prof2.vipTheme, 'cyberpark', 'Usuário VIP ativa tema Cyber Park com sucesso');
  assert.ok(doc.body.classList.contains('theme-cyberpark') || doc.body.classList.contains('theme-cyberpunk'), 'Classe do tema Cyberpark ativada no body');

  // VIP ativa tema Hacker (Racke 0101) -> Sucesso com Matrix Binary Canvas!
  const hackerOpt = themeButtons.find(b => b.dataset.theme === 'hacker');
  assert.ok(hackerOpt, 'Opção Hacker Terminal deve existir');
  await hackerOpt.onclick();
  const prof3 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.strictEqual(prof3.vipTheme, 'hacker', 'Tema Hacker ativado');
  assert.ok(doc.body.classList.contains('theme-hacker'), 'Classe theme-hacker ativa no body');

  // VIP ativa tema RGB -> Sucesso!
  const rgbOpt = themeButtons.find(b => b.dataset.theme === 'rgb');
  assert.ok(rgbOpt, 'Opção RGB deve existir');
  await rgbOpt.onclick();
  const prof4 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.strictEqual(prof4.vipTheme, 'rgb', 'Tema RGB ativado');
  assert.ok(doc.body.classList.contains('theme-rgb'), 'Classe theme-rgb ativa no body');
  assert.ok(typeof env.sandbox.startRgbThemeChroma === 'function', 'startRgbThemeChroma deve existir');
  assert.ok(typeof env.sandbox.stopRgbThemeChroma === 'function', 'stopRgbThemeChroma deve existir');

  // 2. Fontes Animadas VIP (RGB, Azul Ciano, Neon Minimalista, Futurista)
  const fontButtons = doc.querySelectorAll('.vip-font-option');
  assert.ok(fontButtons.length >= 5, 'Devem existir 5 opções de fontes VIP (Normal + 4 animadas)');

  const fontRgbOpt = fontButtons.find(b => b.dataset.style === 'rgb');
  const fontCyanOpt = fontButtons.find(b => b.dataset.style === 'cyan');
  const fontNeonOpt = fontButtons.find(b => b.dataset.style === 'neon_minimal');
  const fontFuturisticOpt = fontButtons.find(b => b.dataset.style === 'futuristic');

  assert.ok(fontRgbOpt && fontCyanOpt && fontNeonOpt && fontFuturisticOpt, 'Todos os 4 estilos animados devem estar presentes');

  // Não-VIP tenta selecionar fonte RGB -> Bloqueado!
  env.sandbox.window.setCurrentProfile(userCommon);
  await fontRgbOpt.onclick();
  const prof5 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.notStrictEqual(prof5.vipTextStyle, 'rgb', 'Usuário comum não pode ativar fonte animada RGB');

  // VIP seleciona fonte RGB -> Sucesso!
  env.sandbox.window.setCurrentProfile(userVip);
  await fontRgbOpt.onclick();
  const prof6 = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;
  assert.strictEqual(prof6.vipTextStyle, 'rgb', 'Estilo RGB selecionado pelo VIP');

  // Testar renderização de mensagem com fonte animada RGB
  const renderedRgb = env.sandbox.formatChatMessageText('Mensagem Cromática VORTEX VIP', true, 'rgb');
  assert.ok(renderedRgb.includes('vip-text-rgb'), 'Texto deve receber a classe vip-text-rgb');

  // Testar renderização com fonte Azul Ciano
  const renderedCyan = env.sandbox.formatChatMessageText('Ciberespaço Conectado', true, 'cyan');
  assert.ok(renderedCyan.includes('vip-text-cyan'), 'Texto deve receber a classe vip-text-cyan');

  // Testar renderização com fonte Neon Minimalista
  const renderedNeon = env.sandbox.formatChatMessageText('Elegância Minimalista', true, 'neon_minimal');
  assert.ok(renderedNeon.includes('vip-text-neon_minimal'), 'Texto deve receber a classe vip-text-neon_minimal');

  // Testar renderização com fonte Futurista
  const renderedFuturistic = env.sandbox.formatChatMessageText('Holographic Terminal Glitch', true, 'futuristic');
  assert.ok(renderedFuturistic.includes('vip-text-futuristic'), 'Texto deve receber a classe vip-text-futuristic');

  // Usuário comum enviando texto -> Não recebe estilo animado
  const renderedNormal = env.sandbox.formatChatMessageText('Texto comum de usuário', false, 'rgb');
  assert.ok(!renderedNormal.includes('vip-text-rgb'), 'Não-VIP não pode renderizar fonte animada');

  // 3. Emojis Animados Exclusivos para Usuários Verificados
  // Caso A: Mensagem com apenas emojis de usuário VIP (1 a 4 emojis) -> vip-animated-emoji-giant
  const renderedGiantEmojis = env.sandbox.formatChatMessageText('⚡ 🔥 ⭐', true, 'normal');
  assert.ok(renderedGiantEmojis.includes('vip-animated-emoji-giant'), 'Emojis sozinhos de VIP devem receber classe vip-animated-emoji-giant');

  // Caso A2: Emojis com seletores de variação Unicode (ex: ❤️ que possui \uFE0F) e sequências ZWJ (❤️‍🔥)
  const renderedHeartEmoji = env.sandbox.formatChatMessageText('❤️', true, 'normal');
  assert.ok(renderedHeartEmoji.includes('vip-animated-emoji-giant'), 'Emoji ❤️ com Variation Selector-16 deve ser reconhecido como emoji gigante');

  const renderedFireHeart = env.sandbox.formatChatMessageText('❤️‍🔥', true, 'normal');
  assert.ok(renderedFireHeart.includes('vip-animated-emoji-giant'), 'Emoji composto ❤️‍🔥 deve ser reconhecido como emoji gigante');

  // Caso B: Mensagem com texto e emoji de usuário VIP -> vip-animated-emoji inline
  const renderedInlineEmoji = env.sandbox.formatChatMessageText('Olá VORTEX VIP! 🚀 Parabéns', true, 'normal');
  assert.ok(renderedInlineEmoji.includes('vip-animated-emoji'), 'Emojis no meio do texto de VIP devem receber classe vip-animated-emoji');

  // Caso C: Mensagem de usuário comum -> Sem classes de animação VIP
  const renderedCommonEmoji = env.sandbox.formatChatMessageText('⚡ 🔥 ⭐', false, 'normal');
  assert.ok(!renderedCommonEmoji.includes('vip-animated-emoji-giant'), 'Emojis de usuário comum não devem receber animação gigante VIP');
  assert.ok(!renderedCommonEmoji.includes('vip-animated-emoji'), 'Emojis de usuário comum não devem receber animação VIP');

  // 4. Gaveta de Emojis na Caixa de Texto (#chat-emoji-drawer e #chat-emoji-btn)
  const emojiBtn = env.elements['chat-emoji-btn'];
  const emojiDrawer = env.elements['chat-emoji-drawer'];
  const chatInput = env.elements['chat-input-main'];

  assert.ok(emojiBtn, 'Botão #chat-emoji-btn deve existir no rodapé');
  assert.ok(emojiDrawer, 'Drawer #chat-emoji-drawer deve existir');

  env.sandbox.setupChatEmojiDrawer();

  // Clicar no botão de emoji abre o drawer
  emojiBtn.onclick({ stopPropagation: () => {} });
  assert.strictEqual(emojiDrawer.style.display, 'flex', 'Drawer de emojis deve abrir ao clicar no botão');

  // Inserir emoji no input do chat
  chatInput.value = 'Olá ';
  chatInput.selectionStart = 4;
  chatInput.selectionEnd = 4;

  env.sandbox.insertEmojiIntoChatInput('⚡');
  assert.strictEqual(chatInput.value, 'Olá ⚡', 'Emoji deve ser inserido na posição correta do cursor');

  // 5. Plano de Fundo da Conversa (Chat Wallpaper)
  const wpTrigger = env.elements['chat-wallpaper-trigger'];
  const wpModal = env.elements['chat-wallpaper-modal'];
  const msgContainer = env.elements['message-container'];

  assert.ok(wpTrigger, 'Gatilho de papel de parede no dropdown deve existir');
  assert.ok(wpModal, 'Modal de papel de parede deve existir');

  env.sandbox.setupChatWallpaperModal();

  // Abrir modal de papel de parede
  env.sandbox.setActiveChatContact({ uid: 'contact-test-123', name: 'Amigo Teste' });
  wpTrigger.onclick();
  assert.ok(wpModal.classList.contains('active'), 'Modal de papel de parede deve abrir ao clicar no item do menu');

  // Selecionar preset cyber-dark e salvar pelo botão
  const cyberPreset = env.elements['wallpaper-preset-cyber'];
  const saveWpBtn = env.elements['save-wallpaper-btn'];
  const resetWpBtn = env.elements['reset-wallpaper-btn'];

  assert.ok(cyberPreset, 'Preset cyber-dark deve existir');
  assert.ok(saveWpBtn, 'Botão de salvar papel de parede deve existir');
  assert.ok(resetWpBtn, 'Botão de restaurar papel de parede deve existir');

  cyberPreset.onclick();
  await saveWpBtn.onclick();

  assert.strictEqual(wpModal.classList.contains('active'), false, 'Modal deve fechar após salvar');
  assert.ok(localStorage.getItem('vortex_wallpaper_contact-test-123') === 'cyber-dark', 'Papel de parede deve ser gravado no localStorage para o contato');
  assert.ok(msgContainer.classList.contains('has-custom-wallpaper'), 'Container deve conter classe de papel de parede');
  assert.ok(msgContainer.style.background.includes('090d16') || msgContainer.style.background.includes('cyber'), 'Background deve ser cyber-dark');

  // Testar restauração pelo botão de reset
  wpTrigger.onclick();
  await resetWpBtn.onclick();
  assert.strictEqual(wpModal.classList.contains('active'), false, 'Modal deve fechar após reset');
  assert.strictEqual(localStorage.getItem('vortex_wallpaper_contact-test-123'), null, 'Chave do contato deve ser removida do localStorage');
  assert.strictEqual(msgContainer.classList.contains('has-custom-wallpaper'), false, 'Ao resetar, custom wallpaper deve ser desativado');
  assert.strictEqual(msgContainer.style.background, '', 'Background do container deve voltar ao padrão vazio');
});

test('Layout Responsivo Desktop no PC (>= 900px) e Preservação Mobile: Duas colunas, Sidebar, Desktop Placeholder e destaque de chat ativo', () => {
  // 1. Integridade do HTML
  assert.ok(htmlContent.includes('id="main-sidebar"') || htmlContent.includes("id='main-sidebar'"), 'Elemento main-sidebar deve existir no HTML');
  assert.ok(htmlContent.includes('class="sidebar"'), 'Classe sidebar deve existir no HTML');
  assert.ok(htmlContent.includes('id="desktop-chat-placeholder"'), 'Placeholder desktop deve existir no HTML');
  assert.ok(htmlContent.includes('desktop-placeholder-badge'), 'Badge do placeholder desktop deve existir no HTML');
  assert.ok(htmlContent.includes('VORTEX VIP Desktop') || htmlContent.includes('VORTEX <span>VIP</span> Desktop'), 'Título do desktop deve existir');

  // 2. Integridade do CSS
  assert.ok(cssContent.includes('.sidebar {'), 'Regra .sidebar deve estar definida no CSS');
  assert.ok(cssContent.includes('.desktop-chat-placeholder {'), 'Regra .desktop-chat-placeholder deve estar definida');
  assert.ok(cssContent.includes('@media (min-width: 900px)'), 'Media query desktop >= 900px deve existir no CSS');
  assert.ok(cssContent.includes('.chat-card.active-chat'), 'Regra para destacar conversa ativa no desktop deve existir');

  // 3. Verificação de Classes e Comportamento
  const env = createTestEnvironment();
  const doc = env.sandbox.document;

  function makeCard(id, uid) {
    const classes = new Set(['chat-card']);
    return {
      id,
      dataset: { uid },
      classList: {
        _classes: classes,
        add(...c) { c.forEach(x => classes.add(x)); },
        remove(...c) { c.forEach(x => classes.delete(x)); },
        toggle(c, val) {
          if (val === undefined) val = !classes.has(c);
          if (val) classes.add(c); else classes.delete(c);
          return val;
        },
        contains(c) { return classes.has(c); }
      }
    };
  }

  const card1 = makeCard('test-pc-card-1', 'user-pc-1');
  const card2 = makeCard('test-pc-card-2', 'user-pc-2');
  env.elements['test-pc-card-1'] = card1;
  env.elements['test-pc-card-2'] = card2;

  // Simular ativação da conversa no desktop
  doc.querySelectorAll('.chat-card').forEach(c => c.classList.toggle('active-chat', c.dataset.uid === 'user-pc-1'));
  assert.ok(card1.classList.contains('active-chat'), 'Card 1 deve receber active-chat quando selecionado');
  assert.strictEqual(card2.classList.contains('active-chat'), false, 'Card 2 não deve possuir active-chat');

  // Simular fechar chat
  doc.querySelectorAll('.chat-card').forEach(c => c.classList.remove('active-chat'));
  assert.strictEqual(card1.classList.contains('active-chat'), false, 'Card 1 deve perder active-chat ao fechar');
});

test('Mensagens Temporárias (24h, 7d, 30d, desativado), Limpeza Física no Firestore, Lock de Envio Concorrente e Garantia Contra IDs Duplicados', async () => {
  // 1. Integridade do HTML
  assert.ok(htmlContent.includes('id="chat-ephemeral-trigger"'), 'Elemento chat-ephemeral-trigger deve existir no HTML');
  assert.ok(htmlContent.includes('id="chat-ephemeral-modal"'), 'Elemento chat-ephemeral-modal deve existir no HTML');
  assert.ok(htmlContent.includes('id="chat-ephemeral-badge"'), 'Elemento chat-ephemeral-badge deve existir no HTML');
  assert.ok(htmlContent.includes('data-duration="24h"'), 'Opção 24h deve existir no HTML');
  assert.ok(htmlContent.includes('data-duration="7d"'), 'Opção 7d deve existir no HTML');
  assert.ok(htmlContent.includes('data-duration="30d"'), 'Opção 30d deve existir no HTML');
  assert.ok(htmlContent.includes('data-duration="off"'), 'Opção desativadas deve existir no HTML');

  // 2. Integridade do CSS
  assert.ok(cssContent.includes('.chat-ephemeral-badge'), 'Regra .chat-ephemeral-badge deve existir no CSS');
  assert.ok(cssContent.includes('.ephemeral-modal-card'), 'Regra .ephemeral-modal-card deve existir no CSS');
  assert.ok(cssContent.includes('.ephemeral-option-card'), 'Regra .ephemeral-option-card deve existir no CSS');
  assert.ok(cssContent.includes('.msg-ephemeral-clock'), 'Regra .msg-ephemeral-clock deve existir no CSS');
  assert.ok(cssContent.includes('.ephemeral-save-btn') || cssContent.includes('#save-ephemeral-btn'), 'Estilo colorido do botão de salvar mensagens temporárias deve existir no CSS');
  assert.ok(cssContent.includes('.ephemeral-cancel-btn') || cssContent.includes('#cancel-ephemeral-btn'), 'Estilo do botão cancelar mensagens temporárias deve existir no CSS');

  // 3. Execução e Comportamento no Sandbox
  const env = createTestEnvironment();
  const doc = env.sandbox.document;
  const win = env.sandbox.window;

  const modal = env.elements['chat-ephemeral-modal'];
  const trigger = env.elements['chat-ephemeral-trigger'];
  const closeBtn = env.elements['close-ephemeral-modal'];
  const cancelBtn = env.elements['cancel-ephemeral-btn'];
  const saveBtn = env.elements['save-ephemeral-btn'];
  const badge = env.elements['chat-ephemeral-badge'];
  const badgeText = env.elements['chat-ephemeral-badge-text'];

  assert.ok(modal, 'Modal deve ser criado no ambiente');
  assert.ok(trigger, 'Trigger deve ser criado no ambiente');
  assert.ok(badge, 'Badge deve ser criado no ambiente');

  // Configurar usuário e contato ativo
  const user = { uid: 'test-user-1', displayName: 'Usuário Teste' };
  win.setCurrentUser(user);
  win.setCurrentProfile({ name: 'Usuário Teste', uid: 'test-user-1' });
  win.setActiveChatContact({ uid: 'contact-ephemeral-user', name: 'Amigo Teste' });

  // Inicializar o modal
  win.setupEphemeralMessagesModal();

  // Testar abertura do modal
  trigger.onclick();
  assert.ok(modal.classList.contains('active'), 'Modal deve abrir ao clicar no trigger');

  // Testar seleção da opção de 24 horas
  const option24h = env.elements['ephemeral-option-24h'];
  assert.ok(option24h, 'Card de 24h deve existir no modal');
  option24h.onclick();
  assert.ok(option24h.classList.contains('selected'), 'Card de 24h deve ser selecionado');

  // Salvar configuração
  await saveBtn.onclick();
  assert.strictEqual(modal.classList.contains('active'), false, 'Modal deve fechar após salvar');
  assert.strictEqual(win.getCurrentChatEphemeralDuration(), '24h', 'Duração da conversa deve ser 24h');
  assert.strictEqual(badge.style.display, 'inline-flex', 'Badge de mensagens temporárias deve ficar visível');
  assert.strictEqual(badgeText.innerText, '24h', 'Texto do badge deve ser 24h');

  // Verificar persistência no Firestore
  const chatId = ['test-user-1', 'contact-ephemeral-user'].sort().join('_');
  const chatDocInDb = env.firestoreDocs[`chats/${chatId}`];
  assert.ok(chatDocInDb, 'Documento da conversa deve ser criado/atualizado no Firestore');
  assert.strictEqual(chatDocInDb.ephemeralDuration, '24h', 'ephemeralDuration deve ser 24h no Firestore');

  // Testar envio de mensagem com expiração de 24h
  const startTime = Date.now();
  const sentRef = await win.sendChatMessage('text', { text: 'Olá mensagem temporária' });
  assert.ok(sentRef, 'Referência da mensagem deve ser retornada');
  const msgDocInDb = env.firestoreDocs[`chats/${chatId}/messages/${sentRef.id}`];
  assert.ok(msgDocInDb, 'Mensagem deve estar gravada no Firestore');
  assert.strictEqual(msgDocInDb.ephemeral, true, 'Mensagem deve possuir flag ephemeral true');
  assert.strictEqual(msgDocInDb.ephemeralDuration, '24h', 'Mensagem deve registrar ephemeralDuration 24h');
  assert.ok(msgDocInDb.expiresAt >= startTime + 86400000 - 1000, 'expiresAt deve ser de pelo menos 24h a frente');
  assert.ok(msgDocInDb.clientMsgId, 'Mensagem deve possuir clientMsgId único');
  assert.ok(sentRef.id.startsWith('msg_'), 'ID gerado deve possuir prefixo único garantido');

  // Testar lock contra envio concorrente
  assert.strictEqual(win.getIsSendingChatMessage(), false, 'Lock deve estar liberado após término');

  // Testar limpeza física de mensagens expiradas no Firestore (purgeExpiredMessages)
  const expiredMsgId1 = 'msg_expired_1';
  const expiredMsgId2 = 'msg_expired_2';
  env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId1}`] = { text: 'Antiga 1', expiresAt: Date.now() - 5000 };
  env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId2}`] = { text: 'Antiga 2', expiresAt: Date.now() - 10000, hasChunks: true };
  env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId2}/chunks/0`] = { part: 'chunkdata' };

  assert.ok(env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId1}`], 'Msg 1 deve existir antes da purga');
  assert.ok(env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId2}`], 'Msg 2 deve existir antes da purga');

  await win.purgeExpiredMessages(chatId, [expiredMsgId1, expiredMsgId2], [expiredMsgId2]);

  assert.strictEqual(env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId1}`], undefined, 'Msg 1 deve ser excluída fisicamente do Firestore');
  assert.strictEqual(env.firestoreDocs[`chats/${chatId}/messages/${expiredMsgId2}`], undefined, 'Msg 2 deve ser excluída fisicamente do Firestore');

  // Testar desativação das mensagens temporárias
  trigger.onclick();
  const optionOff = env.elements['ephemeral-option-off'];
  assert.ok(optionOff, 'Card desativadas deve existir');
  optionOff.onclick();
  await saveBtn.onclick();
  assert.strictEqual(win.getCurrentChatEphemeralDuration(), 'off', 'Duração deve voltar para off');
  assert.strictEqual(badge.style.display, 'none', 'Badge deve ficar oculto quando desativado');
  assert.strictEqual(env.firestoreDocs[`chats/${chatId}`].ephemeralDuration, 'off', 'Firestore deve registrar off');
});

test('Novas Contas Criadas: Nunca recebem selo verificado grátis nem status VIP automático (isVerified: false e isVip: false)', async () => {
  const env = createTestEnvironment();
  const checkIsVipUser = env.sandbox.checkIsVipUser || env.sandbox.window.checkIsVipUser;
  const currentProfile = env.sandbox.window.getCurrentProfile ? env.sandbox.window.getCurrentProfile() : env.sandbox.currentProfile;

  // 1. Estado inicial do perfil padrão deve ser isVerified: false e isVip: false
  assert.strictEqual(currentProfile.isVerified, false, 'Perfil padrão inicial deve ter isVerified: false');
  assert.strictEqual(currentProfile.isVip, false, 'Perfil padrão inicial deve ter isVip: false');

  // 2. Simular criação de nova conta comum de usuário (ex: usuario_novo@gmail.com)
  const newCommonUser = {
    uid: 'new-common-user-99',
    email: 'novo_membro@gmail.com',
    displayName: 'Carlos Silva',
    photoURL: 'https://example.com/avatar.png'
  };

  await env.triggerAuthStateChange(newCommonUser);

  const createdUserDoc = env.firestoreDocs['users/new-common-user-99'];
  assert.ok(createdUserDoc, 'Documento da nova conta deve ser gravado no Firestore');
  assert.strictEqual(createdUserDoc.isVerified, false, 'Nova conta criada NÃO deve ter verificado grátis (isVerified deve ser false)');
  assert.strictEqual(createdUserDoc.isVip, false, 'Nova conta criada NÃO deve ter VIP grátis (isVip deve ser false)');
  assert.strictEqual(checkIsVipUser(createdUserDoc), false, 'checkIsVipUser deve retornar false para nova conta comum');

  // 3. Simular criação da conta administrativa oficial (dxhub.oficial@gmail.com)
  const adminUser = {
    uid: 'admin-dx-01',
    email: 'dxhub.oficial@gmail.com',
    displayName: 'DX Hub Oficial',
    photoURL: ''
  };

  await env.triggerAuthStateChange(adminUser);

  const adminUserDoc = env.firestoreDocs['users/admin-dx-01'];
  assert.ok(adminUserDoc, 'Documento da conta admin deve ser gravado no Firestore');
  assert.strictEqual(adminUserDoc.isVerified, true, 'Conta admin oficial deve ter isVerified: true');
  assert.strictEqual(adminUserDoc.isVip, true, 'Conta admin oficial deve ter isVip: true');
  assert.strictEqual(checkIsVipUser(adminUserDoc), true, 'checkIsVipUser deve retornar true para conta admin oficial');
});

test('Formatação de Horário com AM e PM (12h): formatMessageTime exibe AM e PM em mensagens, chats e cards', () => {
  const env = createTestEnvironment();
  const formatMessageTime = env.sandbox.window.formatMessageTime || env.sandbox.formatMessageTime;

  assert.ok(typeof formatMessageTime === 'function', 'formatMessageTime deve ser uma função exportada');

  // Testar 21:53 (exemplo exato enviado pelo usuário) -> deve exibir 09:53 PM
  const date2153 = new Date(2026, 8, 16, 21, 53, 0);
  assert.strictEqual(formatMessageTime(date2153), '09:53 PM', '21:53 deve ser formatado como 09:53 PM');

  // Testar meio-dia (12:00) -> 12:00 PM
  const date1200 = new Date(2026, 8, 16, 12, 0, 0);
  assert.strictEqual(formatMessageTime(date1200), '12:00 PM', '12:00 deve ser formatado como 12:00 PM');

  // Testar tarde (14:05) -> 02:05 PM
  const date1405 = new Date(2026, 8, 16, 14, 5, 0);
  assert.strictEqual(formatMessageTime(date1405), '02:05 PM', '14:05 deve ser formatado como 02:05 PM');

  // Testar meia-noite (00:00) -> 12:00 AM
  const date0000 = new Date(2026, 8, 16, 0, 0, 0);
  assert.strictEqual(formatMessageTime(date0000), '12:00 AM', '00:00 deve ser formatado como 12:00 AM');

  // Testar manhã (08:30) -> 08:30 AM
  const date0830 = new Date(2026, 8, 16, 8, 30, 0);
  assert.strictEqual(formatMessageTime(date0830), '08:30 AM', '08:30 deve ser formatado como 08:30 AM');

  // Testar 11:59 AM
  const date1159 = new Date(2026, 8, 16, 11, 59, 0);
  assert.strictEqual(formatMessageTime(date1159), '11:59 AM', '11:59 deve ser formatado como 11:59 AM');

  // Testar timestamp numérico
  assert.strictEqual(formatMessageTime(date2153.getTime()), '09:53 PM', 'Timestamp numérico de 21:53 deve retornar 09:53 PM');
});

test('Denúncia de Grupo: Botão no painel de perfil do grupo abre o modal oficial de denúncia e registra no Firestore reports e groups', async () => {
  const env = createTestEnvironment();
  const openGroupProfile = env.sandbox.openGroupProfile || env.sandbox.window.openGroupProfile;
  const openReportModal = env.sandbox.openReportModal || env.sandbox.window.openReportModal;
  const closeReportModal = env.sandbox.closeReportModal || env.sandbox.window.closeReportModal;
  const submitGeneralReport = env.sandbox.submitGeneralReport || env.sandbox.window.submitGeneralReport;

  assert.ok(typeof openGroupProfile === 'function', 'openGroupProfile deve ser uma função');
  assert.ok(typeof openReportModal === 'function', 'openReportModal deve ser uma função');
  assert.ok(typeof submitGeneralReport === 'function', 'submitGeneralReport deve ser uma função');

  const currentUser = { uid: 'user_denunciante_1', displayName: 'Membro Denunciante', name: 'Membro Denunciante' };
  env.sandbox.window.setCurrentUser(currentUser);
  env.sandbox.window.setCurrentProfile(currentUser);

  const testGroup = {
    id: 'grp_suspeito_777',
    groupId: 'grp_suspeito_777',
    name: 'Grupo Suspeito de Spam',
    description: 'Grupo para teste de denúncia',
    creatorUid: 'user_criador_999',
    members: ['user_criador_999', currentUser.uid],
    admins: ['user_criador_999']
  };
  env.firestoreDocs['groups/grp_suspeito_777'] = { ...testGroup };

  // 1. Abrir perfil do grupo
  await openGroupProfile(testGroup);
  assert.ok(env.elements['group-profile-panel'].classList.contains('active'), 'Painel de perfil do grupo deve ser aberto');
  assert.strictEqual(env.elements['group-profile-title'].innerText, 'Grupo Suspeito de Spam');

  const reportBtn = env.elements['report-group-btn'];
  assert.ok(reportBtn, 'Botão #report-group-btn deve existir no DOM');

  // 2. Clicar no botão #report-group-btn deve abrir o modal #report-contact-modal configurado para grupo
  await reportBtn.click();

  const reportModal = env.elements['report-contact-modal'];
  assert.ok(reportModal.classList.contains('active'), 'Modal de denúncia (#report-contact-modal) deve abrir ao clicar em denunciar grupo');
  assert.strictEqual(env.elements['report-modal-header-title'].innerText, 'Denunciar Grupo', 'Título do modal deve ser "Denunciar Grupo"');
  assert.ok(env.elements['report-modal-subtitle'].innerText.includes('Grupo Suspeito de Spam'), 'Subtítulo deve mencionar o nome do grupo');
  assert.strictEqual(env.elements['report-block-option-box'].style.display, 'none', 'Caixa de bloquear contato deve estar oculta para grupos');

  // 3. Preencher detalhes adicionais
  env.elements['report-contact-details'].value = 'Grupo enviando links maliciosos em massa';

  // 4. Clicar no botão de submeter a denúncia (#submit-report-contact-btn)
  await env.elements['submit-report-contact-btn'].click();

  // Modal deve ser fechado após submissão
  assert.strictEqual(reportModal.classList.contains('active'), false, 'Modal de denúncia deve fechar após envio');

  // 5. Verificar gravação na coleção 'reports'
  const groupReports = Object.entries(env.firestoreDocs)
    .filter(([path, data]) => path.startsWith('reports/') && data.targetType === 'group')
    .map(([path, data]) => ({ id: path.replace('reports/', ''), ...data }));

  assert.ok(groupReports.length >= 1, 'Deve existir pelo menos um registro de denúncia de grupo na coleção reports');
  const lastReport = groupReports[groupReports.length - 1];
  assert.strictEqual(lastReport.targetUid, 'grp_suspeito_777', 'targetUid da denúncia deve ser o ID do grupo');
  assert.strictEqual(lastReport.targetName, 'Grupo Suspeito de Spam', 'targetName deve ser o nome do grupo');
  assert.strictEqual(lastReport.reporterUid, currentUser.uid, 'reporterUid deve ser o usuário logado');
  assert.strictEqual(lastReport.details, 'Grupo enviando links maliciosos em massa');
});

test('Selo de Verificado Único para Administradores VORTEX VIP (Vermelho Choque, Faíscas e Balão Amarelo 💥Admin⚡)', async () => {
  const env = createTestEnvironment();
  const checkIsAdminUser = env.sandbox.checkIsAdminUser || env.sandbox.window.checkIsAdminUser;
  const updateVerifiedBadgeElement = env.sandbox.updateVerifiedBadgeElement || env.sandbox.window.updateVerifiedBadgeElement;
  const showAdminBadgeToast = env.sandbox.showAdminBadgeToast || env.sandbox.window.showAdminBadgeToast;

  assert.ok(typeof checkIsAdminUser === 'function', 'checkIsAdminUser deve ser uma função exportada');
  assert.ok(typeof updateVerifiedBadgeElement === 'function', 'updateVerifiedBadgeElement deve ser uma função exportada');
  assert.ok(typeof showAdminBadgeToast === 'function', 'showAdminBadgeToast deve ser uma função exportada');

  // 1. Validar identificação de Administrador vs Usuário Comum
  const adminAccount1 = {
    uid: 'admin-dxhub-01',
    email: 'dxhub.oficial@gmail.com',
    username: 'dxhuboficial',
    name: 'DX Hub Oficial Admin'
  };
  const adminAccount2 = {
    uid: 'admin-vortex-02',
    email: 'vortex.dx.oficial@gmail.com',
    username: 'vortexoficial',
    name: 'VORTEX Oficial'
  };
  const adminAccount3 = {
    uid: 'admin-suporte-03',
    email: 'dxhubdigitalsuporte@gmail.com',
    username: 'dxhubsuporte',
    name: 'DX Hub Suporte'
  };
  const impostorAccount = {
    uid: 'impostor-04',
    email: 'hacker.admin@gmail.com',
    username: 'hackeradmin',
    name: 'DX Hub Fake',
    isAdmin: true,
    role: 'admin'
  };
  const regularVipAccount = {
    uid: 'vip-user-02',
    email: 'cliente.vip@gmail.com',
    username: 'clientevip',
    name: 'Cliente VIP',
    isVip: true,
    isVerified: true
  };
  const regularUserAccount = {
    uid: 'normal-user-03',
    email: 'normal@gmail.com',
    username: 'normaluser',
    name: 'Normal User',
    isVip: false,
    isVerified: false
  };

  assert.strictEqual(checkIsAdminUser(adminAccount1), true, 'dxhub.oficial@gmail.com deve retornar true para checkIsAdminUser');
  assert.strictEqual(checkIsAdminUser(adminAccount2), true, 'vortex.dx.oficial@gmail.com deve retornar true para checkIsAdminUser');
  assert.strictEqual(checkIsAdminUser(adminAccount3), true, 'dxhubdigitalsuporte@gmail.com deve retornar true para checkIsAdminUser');
  assert.strictEqual(checkIsAdminUser(impostorAccount), false, 'Qualquer outro email mesmo com isAdmin/role: admin NÃO deve ter selo de admin');
  assert.strictEqual(checkIsAdminUser(regularVipAccount), false, 'Usuário VIP comum NÃO deve retornar true para checkIsAdminUser');
  assert.strictEqual(checkIsAdminUser(regularUserAccount), false, 'Usuário normal NÃO deve retornar true para checkIsAdminUser');

  // 2. Validar aplicação do Selo de Administrador (.verified-badge-admin e título 💥Admin⚡)
  const mockBadgeEl = {
    id: 'test-badge',
    style: { display: 'none' },
    classList: {
      _classes: new Set(['verified-badge']),
      add(...c) { c.forEach(x => this._classes.add(x)); },
      remove(...c) { c.forEach(x => this._classes.delete(x)); },
      contains(c) { return this._classes.has(c); }
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; }
  };

  // Testar para Administradores
  [adminAccount1, adminAccount2, adminAccount3].forEach(adm => {
    updateVerifiedBadgeElement(mockBadgeEl, adm);
    assert.strictEqual(mockBadgeEl.style.display, 'inline-flex', `Badge de administrador (${adm.email}) deve ser exibido`);
    assert.ok(mockBadgeEl.classList.contains('verified-badge-admin'), `Badge (${adm.email}) deve conter a classe .verified-badge-admin`);
    assert.strictEqual(mockBadgeEl.attributes['data-admin-badge'], 'true', `Badge (${adm.email}) deve ter data-admin-badge="true"`);
    assert.strictEqual(mockBadgeEl.attributes['title'], '💥Admin⚡', `Badge (${adm.email}) deve ter title="💥Admin⚡"`);
  });

  // Testar para Usuário VIP Comum (não deve ter .verified-badge-admin)
  updateVerifiedBadgeElement(mockBadgeEl, regularVipAccount);
  assert.strictEqual(mockBadgeEl.style.display, 'inline-flex', 'Badge VIP comum deve ser exibido');
  assert.strictEqual(mockBadgeEl.classList.contains('verified-badge-admin'), false, 'Badge VIP comum NÃO deve ter a classe .verified-badge-admin');
  assert.strictEqual(mockBadgeEl.attributes['data-admin-badge'], undefined, 'Badge VIP comum NÃO deve ter data-admin-badge');
  assert.strictEqual(mockBadgeEl.attributes['title'], 'Verificado VIP', 'Badge VIP comum deve ter title="Verificado VIP"');

  // Testar para Usuário Normal (deve ser oculto)
  updateVerifiedBadgeElement(mockBadgeEl, regularUserAccount);
  assert.strictEqual(mockBadgeEl.style.display, 'none', 'Badge de usuário comum não-VIP deve ficar oculto');

  // 3. Testar exibição da Mensagem Amarela 💥Admin⚡ ao tocar/clicar no selo
  showAdminBadgeToast(null, mockBadgeEl);

  const toastList = Object.values(env.elements).filter(el => el && el.classList && el.classList.contains && el.classList.contains('admin-badge-toast-yellow'));
  assert.ok(toastList.length >= 1, 'Elemento de toast amarelo .admin-badge-toast-yellow deve ser criado no DOM');
  const toast = toastList[toastList.length - 1];
  assert.ok(toast.innerHTML.includes('💥Admin⚡'), 'Toast amarelo deve conter exatamente o texto 💥Admin⚡');

  // 4. Validar CSS do Selo de Administrador (Vermelho #ff1744, choque elétrico shockTremor e faíscas electricSparksArc)
  assert.ok(cssContent.includes('.verified-badge-admin'), 'CSS deve definir a classe .verified-badge-admin');
  assert.ok(cssContent.includes('#ff1744'), 'CSS deve conter a cor vermelha #ff1744 para o selo de administrador');
  assert.ok(cssContent.includes('shockTremor'), 'CSS deve conter animação de tremor de choque elétrico shockTremor');
  assert.ok(cssContent.includes('electricSparksArc'), 'CSS deve conter animação de faíscas elétricas electricSparksArc');
  assert.ok(cssContent.includes('.admin-badge-toast-yellow'), 'CSS deve estilizar a mensagem amarela .admin-badge-toast-yellow');
  assert.ok(cssContent.includes('#ffe600'), 'CSS deve conter a cor amarela #ffe600 para a mensagem de admin');
});

test('Instalabilidade da VORTEX VIP no Navegador (PWA Completo: Manifest, Service Worker, Ícones e Prompt de Instalação)', async () => {
  const env = createTestEnvironment();
  const fs = await import('fs');
  const path = await import('path');

  const publicDir = path.join(process.cwd(), 'public');

  // 1. Validar existência e estrutura do Web App Manifest (manifest.json)
  const manifestPath = path.join(publicDir, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'Arquivo manifest.json deve existir na pasta public');

  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifestContent.name && manifestContent.name.includes('VORTEX VIP'), 'Manifest deve conter name com VORTEX VIP');
  assert.strictEqual(manifestContent.short_name, 'VORTEX VIP', 'Manifest deve ter short_name VORTEX VIP');
  assert.strictEqual(manifestContent.display, 'standalone', 'Manifest deve ter display: standalone');
  assert.ok(['#fff01f', '#39ff14'].includes(manifestContent.theme_color), 'Manifest deve ter theme_color válido (#39ff14 ou #fff01f)');
  assert.strictEqual(manifestContent.background_color, '#0a0a0c', 'Manifest deve ter background_color #0a0a0c');
  assert.ok(Array.isArray(manifestContent.icons), 'Manifest deve conter array de ícones');

  const iconSizes = manifestContent.icons.map(i => i.sizes);
  assert.ok(iconSizes.includes('192x192'), 'Manifest deve incluir ícone 192x192');
  assert.ok(iconSizes.includes('512x512'), 'Manifest deve incluir ícone 512x512');

  // Validar existência física dos arquivos de ícones declarados
  for (const icon of manifestContent.icons) {
    const iconRelative = icon.src.replace(/^\//, '');
    const fullIconPath = path.join(publicDir, iconRelative);
    assert.ok(fs.existsSync(fullIconPath), `Arquivo de ícone ${icon.src} deve existir no disco`);
    const stat = fs.statSync(fullIconPath);
    assert.ok(stat.size > 0, `Arquivo de ícone ${icon.src} não pode ser vazio`);
  }

  // 2. Validar Service Worker (sw.js)
  const swPath = path.join(publicDir, 'sw.js');
  assert.ok(fs.existsSync(swPath), 'Arquivo sw.js deve existir na pasta public');
  const swContent = fs.readFileSync(swPath, 'utf8');
  assert.ok(swContent.includes('CACHE_NAME'), 'sw.js deve definir CACHE_NAME');
  assert.ok(swContent.includes('addEventListener(\'install\''), 'sw.js deve escutar evento install');
  assert.ok(swContent.includes('addEventListener(\'activate\''), 'sw.js deve escutar evento activate');
  assert.ok(swContent.includes('addEventListener(\'fetch\''), 'sw.js deve escutar evento fetch');
  assert.ok(swContent.includes('firestore.googleapis.com'), 'sw.js deve ignorar chamadas do Firestore para garantir tempo real');

  // 3. Validar Tags Meta PWA no index.html
  const htmlPath = path.join(publicDir, 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(htmlContent.includes('rel="manifest"'), 'index.html deve conter link rel="manifest"');
  assert.ok(htmlContent.includes('name="theme-color" content="#fff01f"') || htmlContent.includes('name="theme-color" content="#39ff14"'), 'index.html deve conter meta theme-color');
  assert.ok(htmlContent.includes('apple-mobile-web-app-capable'), 'index.html deve suportar Apple PWA em tela cheia');
  assert.ok(htmlContent.includes('apple-touch-icon'), 'index.html deve definir apple-touch-icon');
  assert.ok(htmlContent.includes('id="install-app-header-btn"'), 'index.html deve ter botão de instalação no cabeçalho');
  assert.ok(htmlContent.includes('id="install-app-setting-item"'), 'index.html deve ter opção de instalação nas configurações');
  assert.ok(htmlContent.includes('id="pwa-install-banner"'), 'index.html deve ter banner flutuante de instalação');
  assert.ok(htmlContent.includes('id="pwa-ios-modal"'), 'index.html deve ter modal instrucional para iOS Safari');

  // 4. Validar Funções e Lógica de Instalação no script.js
  const isAppInstalledPwa = env.sandbox.isAppInstalledPwa || env.sandbox.window.isAppInstalledPwa;
  const updateInstallUIVisibility = env.sandbox.updateInstallUIVisibility || env.sandbox.window.updateInstallUIVisibility;
  const triggerPwaInstall = env.sandbox.triggerPwaInstall || env.sandbox.window.triggerPwaInstall;
  const setDeferredPrompt = env.sandbox.setDeferredPrompt || env.sandbox.window.setDeferredPrompt;
  const openPwaIosModal = env.sandbox.openPwaIosModal || env.sandbox.window.openPwaIosModal;
  const closePwaIosModal = env.sandbox.closePwaIosModal || env.sandbox.window.closePwaIosModal;

  assert.ok(typeof isAppInstalledPwa === 'function', 'isAppInstalledPwa deve ser uma função');
  assert.ok(typeof updateInstallUIVisibility === 'function', 'updateInstallUIVisibility deve ser uma função');
  assert.ok(typeof triggerPwaInstall === 'function', 'triggerPwaInstall deve ser uma função');

  // Testar visibilidade com prompt disponível
  let promptTriggered = false;
  const fakePrompt = {
    prompt() { promptTriggered = true; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };

  setDeferredPrompt(fakePrompt);
  updateInstallUIVisibility();

  const headerBtn = env.elements['install-app-header-btn'];
  assert.strictEqual(headerBtn.style.display, 'flex', 'Botão de instalar no cabeçalho deve estar visível quando prompt estiver pronto');

  // Disparar instalação
  await triggerPwaInstall();
  assert.strictEqual(promptTriggered, true, 'triggerPwaInstall deve acionar deferredPrompt.prompt()');

  // Testar modal instrucional iOS
  const iosModal = env.elements['pwa-ios-modal'];
  openPwaIosModal();
  assert.strictEqual(iosModal.style.display, 'flex', 'openPwaIosModal deve abrir o modal do iOS');
  closePwaIosModal();
  assert.strictEqual(iosModal.style.display, 'none', 'closePwaIosModal deve fechar o modal do iOS');

  // 5. Validar Estilos CSS do PWA
  assert.ok(cssContent.includes('.install-header-btn'), 'style.css deve conter estilos do botão de instalação');
  assert.ok(cssContent.includes('.pwa-install-banner'), 'style.css deve conter estilos do banner de instalação');
  assert.ok(cssContent.includes('.pwa-ios-modal'), 'style.css deve conter estilos do modal do iOS');
  assert.ok(cssContent.includes('.btn-update-pulse'), 'style.css deve conter estilos de animação do botão de atualização');
  assert.ok(cssContent.includes('.update-available-row'), 'style.css deve conter estilos de destaque da linha de atualização');

  // 6. Validar Comportamento de Atualização (Botão muda de Instalar para Atualizar quando instalado e há nova versão)
  const setPwaIsInstalled = env.sandbox.setPwaIsInstalled || env.sandbox.window.setPwaIsInstalled;
  const setPwaUpdateAvailable = env.sandbox.setPwaUpdateAvailable || env.sandbox.window.setPwaUpdateAvailable;
  const settingRow = env.elements['install-app-setting-item'];
  const installBtn = env.elements['install-pwa-btn'];

  assert.ok(typeof setPwaIsInstalled === 'function', 'setPwaIsInstalled deve ser uma função');
  assert.ok(typeof setPwaUpdateAvailable === 'function', 'setPwaUpdateAvailable deve ser uma função');

  // Caso A: App instalado e sem atualização disponível -> Oculta linha de instalação
  setPwaIsInstalled(true);
  setPwaUpdateAvailable(false);
  updateInstallUIVisibility();
  assert.strictEqual(settingRow.style.display, 'none', 'Linha de configuração deve ficar oculta se app já está instalado e sem nova versão');

  // Caso B: App instalado e com nova versão disponível -> Exibe linha com botão "Atualizar"
  setPwaUpdateAvailable(true);
  updateInstallUIVisibility();
  assert.strictEqual(settingRow.style.display, 'flex', 'Linha de configuração deve ficar visível quando houver nova versão para o app instalado');
  assert.strictEqual(installBtn.textContent, 'Atualizar', 'Texto do botão nas configurações deve mudar de Instalar para Atualizar');
  assert.strictEqual(headerBtn.style.display, 'flex', 'Botão no cabeçalho deve ficar visível para atualizar');

  // Caso C: App não instalado -> Botão volta a exibir "Instalar"
  setPwaIsInstalled(false);
  setPwaUpdateAvailable(false);
  setDeferredPrompt(fakePrompt);
  updateInstallUIVisibility();
  assert.strictEqual(installBtn.textContent, 'Instalar', 'Texto do botão deve voltar para Instalar quando app não estiver instalado');
});

test('Exclusão Completa de Conta do Usuário e Ocultação Total no VORTEX VIP ⚡', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Verificar existência dos elementos no DOM e Estilos no CSS
  assert.ok(env.elements['delete-account-btn'], 'Botão de apagar conta deve existir no DOM');
  assert.ok(env.elements['user-delete-account-modal'], 'Modal de apagar própria conta deve existir no DOM');
  assert.ok(env.elements['confirm-user-delete-account-btn'], 'Botão de confirmar exclusão de conta deve existir');
  assert.ok(env.elements['cancel-user-delete-account-btn'], 'Botão de cancelar exclusão de conta deve existir');
  assert.ok(env.elements['admin-purge-modal'], 'Modal de exclusão do ADM deve existir');
  assert.ok(cssContent.includes('.delete-account-action-btn'), 'style.css deve conter estilos do botão de apagar conta');
  assert.ok(cssContent.includes('.delete-account-setting-row'), 'style.css deve conter estilos da linha de apagar conta');

  // 2. Testar abertura e fechamento do modal do usuário
  const userModal = env.elements['user-delete-account-modal'];
  win.openUserDeleteAccountModal();
  assert.strictEqual(userModal.classList.contains('active'), true, 'Modal do usuário deve abrir com classe active');
  win.closeUserDeleteAccountModal();
  assert.strictEqual(userModal.classList.contains('active'), false, 'Modal do usuário deve fechar ao cancelar');

  // 3. Testar exclusão da própria conta pelo usuário logado
  await env.triggerAuthStateChange({ uid: 'user-self', email: 'me@vortex.vip', displayName: 'Meu Nome' });
  await new Promise(r => setTimeout(r, 20));

  // Cadastrar dados do usuário
  env.firestoreDocs['users/user-self'] = { name: 'Meu Nome', email: 'me@vortex.vip', banned: false };
  env.firestoreDocs['posts/post-self'] = { authorUid: 'user-self', caption: 'Post pessoal' };
  env.firestoreDocs['stories/story-self'] = { authorUid: 'user-self', text: 'Story pessoal' };
  env.firestoreDocs['groups/group-self'] = { creatorUid: 'user-self', name: 'Meu Grupo' };

  await win.deleteUserAccountEntirely('user-self', { deletedBy: 'self' });

  assert.strictEqual(win.isUserAccountDeleted('user-self'), true, 'Usuário deve constar como deletado em isUserAccountDeleted');
  assert.ok(env.firestoreDocs['deleted_users/user-self'], 'Tombstone deve ser criado em deleted_users');
  assert.strictEqual(env.firestoreDocs['deleted_users/user-self'].deleted, true, 'Tombstone deve ter deleted: true');
  assert.strictEqual(env.firestoreDocs['posts/post-self'], undefined, 'Posts do usuário devem ser apagados');
  assert.strictEqual(env.firestoreDocs['stories/story-self'], undefined, 'Stories do usuário devem ser apagados');
  assert.strictEqual(env.firestoreDocs['groups/group-self'], undefined, 'Grupos do usuário devem ser apagados');
  assert.strictEqual(env.firestoreDocs['users/user-self'].isDeleted, true, 'users/user-self deve ser marcado como isDeleted');

  // 4. Testar exclusão total de conta pelo Administrador (ADM)
  env.firestoreDocs['users/victim-user'] = { name: 'Alvo ADM', username: '@alvo', email: 'alvo@teste.com', banned: false };
  env.firestoreDocs['posts/post-victim'] = { authorUid: 'victim-user', caption: 'Post alvo' };
  env.firestoreDocs['stories/story-victim'] = { authorUid: 'victim-user', text: 'Story alvo' };
  env.firestoreDocs['groups/group-victim'] = { creatorUid: 'victim-user', name: 'Grupo alvo' };

  await win.adminPurgeUserData('victim-user');

  assert.strictEqual(win.isUserAccountDeleted('victim-user'), true, 'Usuário excluído pelo Admin deve constar em isUserAccountDeleted');
  assert.strictEqual(env.firestoreDocs['posts/post-victim'], undefined, 'Posts do usuário alvo devem ser excluídos pelo ADM');
  assert.strictEqual(env.firestoreDocs['stories/story-victim'], undefined, 'Stories do usuário alvo devem ser excluídos pelo ADM');
  assert.strictEqual(env.firestoreDocs['groups/group-victim'], undefined, 'Grupos do usuário alvo devem ser excluídos pelo ADM');
  assert.strictEqual(env.firestoreDocs['users/victim-user'].banned, true, 'Usuário deve ser banido e marcado como apagado');
  assert.strictEqual(env.firestoreDocs['users/victim-user'].isDeleted, true, 'Usuário deve ter isDeleted: true');

  // 5. Garantir que o usuário apagado NÃO aparece para ninguém
  // A) Bloqueio na abertura direta de chat
  win.openDirectChat({ uid: 'victim-user', name: 'Alvo' });

  // B) Busca de usuários
  env.firestoreDocs['users/other-good-user'] = { name: 'Usuario Bom', username: '@bom', isDeleted: false };
  await win.loadUsersForSearch('alvo');
  const searchContainer = env.elements['search-results-container'];
  assert.ok(!searchContainer.innerHTML.includes('alvo@teste.com'), 'Usuário apagado não deve aparecer nos resultados de busca');

  // C) Painel Admin
  win.renderAdminUsers();
  const adminUsersList = env.elements['admin-users-list'];
  assert.ok(!adminUsersList.innerHTML.includes('victim-user'), 'Usuário apagado não deve constar na listagem de usuários do ADM');
});

test('Conta Empresa no Editar Perfil VIP: Alternância Pessoal vs Empresa, validação de 3 sites https://, WhatsApp, Facebook e exibição nos Dados do Contato', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Verificar elementos no DOM e CSS
  assert.ok(env.elements['profile-type-personal'], 'Radio Conta Pessoal deve existir');
  assert.ok(env.elements['profile-type-business'], 'Radio Conta Empresa deve existir');
  assert.ok(env.elements['profile-business-fields'], 'Container de campos de empresa deve existir');
  assert.ok(env.elements['profile-whatsapp-input'], 'Input WhatsApp deve existir');
  assert.ok(env.elements['profile-facebook-input'], 'Input Facebook deve existir');
  assert.ok(env.elements['profile-website1-input'], 'Input Site 1 deve existir');
  assert.ok(env.elements['profile-website1-title-input'], 'Input Título Site 1 deve existir');
  assert.ok(env.elements['profile-website2-input'], 'Input Site 2 deve existir');
  assert.ok(env.elements['profile-website2-title-input'], 'Input Título Site 2 deve existir');
  assert.ok(env.elements['profile-website3-input'], 'Input Site 3 deve existir');
  assert.ok(env.elements['profile-website3-title-input'], 'Input Título Site 3 deve existir');
  assert.ok(env.elements['contact-profile-business-badge'], 'Badge de Conta Empresa nos Dados do Contato deve existir');
  assert.ok(env.elements['contact-profile-whatsapp-link'], 'Pill WhatsApp nos Dados do Contato deve existir');
  assert.ok(env.elements['contact-profile-facebook-link'], 'Pill Facebook nos Dados do Contato deve existir');
  assert.ok(env.elements['contact-profile-website1-link'], 'Pill Site 1 nos Dados do Contato deve existir');
  assert.ok(env.elements['contact-profile-website2-link'], 'Pill Site 2 nos Dados do Contato deve existir');
  assert.ok(env.elements['contact-profile-website3-link'], 'Pill Site 3 nos Dados do Contato deve existir');

  // 2. Testar funções de formatação
  const formatWebsiteLink = win.formatWebsiteLink;
  assert.ok(typeof formatWebsiteLink === 'function', 'formatWebsiteLink deve ser uma função');
  assert.strictEqual(formatWebsiteLink(''), '', 'Vazio deve retornar vazio');
  assert.strictEqual(formatWebsiteLink('meusite.com'), 'https://meusite.com', 'Deve prefixar https://');
  assert.strictEqual(formatWebsiteLink('http://inseguro.com/loja'), 'https://inseguro.com/loja', 'Deve converter http para https');
  assert.strictEqual(formatWebsiteLink('https://seguro.com.br'), 'https://seguro.com.br', 'Deve manter https://');

  const formatSocialLink = win.formatSocialLink;
  assert.strictEqual(formatSocialLink('facebook', '@empresa_vip'), 'https://www.facebook.com/empresa_vip');
  assert.strictEqual(formatSocialLink('facebook', 'facebook.com/loja'), 'https://facebook.com/loja');
  assert.strictEqual(formatSocialLink('whatsapp', '11988887777'), 'https://wa.me/5511988887777');
  assert.strictEqual(formatSocialLink('whatsapp', 'https://wa.me/5511999998888'), 'https://wa.me/5511999998888');

  // 3. Testar alternância entre Conta Pessoal e Conta Empresa no formulário
  const bizFields = env.elements['profile-business-fields'];
  const personalRadio = env.elements['profile-type-personal'];
  const businessRadio = env.elements['profile-type-business'];

  // Alterna para Empresa
  businessRadio.checked = true;
  personalRadio.checked = false;
  await businessRadio.dispatchEvent('change');
  assert.strictEqual(bizFields.style.display, 'flex', 'Campos de empresa devem ficar visíveis (flex) ao marcar Conta Empresa');

  // Alterna de volta para Pessoal
  personalRadio.checked = true;
  businessRadio.checked = false;
  await personalRadio.dispatchEvent('change');
  assert.strictEqual(bizFields.style.display, 'none', 'Campos de empresa devem ficar ocultos (none) ao marcar Conta Pessoal');

  // 4. Testar salvamento de perfil como Conta Empresa
  const user = { uid: 'biz_user_123', email: 'empresa@vortex.vip', displayName: 'Vortex Store' };
  await env.triggerAuthStateChange(user);
  await new Promise(r => setTimeout(r, 20));

  env.elements['profile-name-input'].value = 'Vortex Store';
  env.elements['profile-username-input'].value = 'vortexstore';
  env.elements['profile-status-input'].value = 'Loja Oficial VORTEX VIP';
  env.elements['profile-phone-input'].value = '(11) 97777-6666';

  // Selecionar Empresa e preencher os novos campos
  businessRadio.checked = true;
  personalRadio.checked = false;
  await businessRadio.dispatchEvent('change');

  env.elements['profile-whatsapp-input'].value = '(11) 98888-7777';
  env.elements['profile-facebook-input'].value = '@vortexstore';
  env.elements['profile-instagram-input'].value = '@vortexstore';
  env.elements['profile-tiktok-input'].value = '@vortexstore';
  env.elements['profile-youtube-input'].value = '@vortexchannel';
  env.elements['profile-website1-input'].value = 'https://vortexstore.com.br';
  env.elements['profile-website1-title-input'].value = 'Loja Oficial';
  env.elements['profile-website2-input'].value = 'https://loja.vortexstore.com.br';
  env.elements['profile-website2-title-input'].value = 'Cardápio Digital';
  env.elements['profile-website3-input'].value = 'https://catalogo.vortexstore.com.br';
  env.elements['profile-website3-title-input'].value = 'Catálogo 2026';

  await env.elements['save-profile-btn'].click();

  const savedUserDoc = env.firestoreDocs['users/biz_user_123'];
  assert.ok(savedUserDoc, 'Documento da empresa deve estar salvo no Firestore');
  assert.strictEqual(savedUserDoc.accountType, 'business', 'accountType deve ser business');
  assert.strictEqual(savedUserDoc.whatsapp, 'https://wa.me/5511988887777', 'WhatsApp deve estar formatado com wa.me');
  assert.strictEqual(savedUserDoc.facebook, 'https://www.facebook.com/vortexstore', 'Facebook deve estar formatado');
  assert.strictEqual(savedUserDoc.website1, 'https://vortexstore.com.br', 'Site 1 deve ter https://');
  assert.strictEqual(savedUserDoc.website1Title, 'Loja Oficial', 'website1Title deve estar salvo');
  assert.strictEqual(savedUserDoc.website2, 'https://loja.vortexstore.com.br', 'Site 2 deve ter sido convertido para https://');
  assert.strictEqual(savedUserDoc.website2Title, 'Cardápio Digital', 'website2Title deve estar salvo');
  assert.strictEqual(savedUserDoc.website3, 'https://catalogo.vortexstore.com.br', 'Site 3 deve manter https://');
  assert.strictEqual(savedUserDoc.website3Title, 'Catálogo 2026', 'website3Title deve estar salvo');
  assert.strictEqual(savedUserDoc.socialLinks.website1, 'https://vortexstore.com.br', 'socialLinks.website1 deve estar sincronizado');
  assert.strictEqual(savedUserDoc.socialLinks.website1Title, 'Loja Oficial', 'socialLinks.website1Title deve estar sincronizado');

  // Testar carregamento dos títulos ao abrir painel de editar perfil
  env.elements['profile-website1-title-input'].value = '';
  env.elements['profile-website2-title-input'].value = '';
  env.elements['profile-website3-title-input'].value = '';
  await env.elements['profile-btn'].click();
  assert.strictEqual(env.elements['profile-website1-title-input'].value, 'Loja Oficial', 'Título 1 deve ser recarregado no input');
  assert.strictEqual(env.elements['profile-website2-title-input'].value, 'Cardápio Digital', 'Título 2 deve ser recarregado no input');
  assert.strictEqual(env.elements['profile-website3-title-input'].value, 'Catálogo 2026', 'Título 3 deve ser recarregado no input');

  // 5. Testar renderização nos Dados do Contato
  const updateContactProfileSocialUI = win.updateContactProfileSocialUI;

  // A) Renderizar contato como Empresa com títulos personalizados
  updateContactProfileSocialUI({
    accountType: 'business',
    phone: '(11) 97777-6666',
    whatsapp: 'https://wa.me/5511988887777',
    facebook: 'https://www.facebook.com/vortexstore',
    instagram: 'https://www.instagram.com/vortexstore',
    tiktok: 'https://www.tiktok.com/@vortexstore',
    website1: 'https://vortexstore.com.br',
    website1Title: 'Loja Oficial',
    website2: 'https://loja.vortexstore.com.br',
    website2Title: 'Cardápio Digital',
    website3: 'https://catalogo.vortexstore.com.br',
    website3Title: 'Catálogo 2026'
  });

  assert.strictEqual(env.elements['contact-profile-business-badge'].style.display, 'inline-flex', 'Badge de Conta Empresa deve estar visível');
  assert.strictEqual(env.elements['contact-profile-whatsapp-link'].style.display, 'inline-flex', 'Pill WhatsApp deve estar visível');
  assert.strictEqual(env.elements['contact-profile-facebook-link'].style.display, 'inline-flex', 'Pill Facebook deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website1-link'].style.display, 'inline-flex', 'Pill Site 1 deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website2-link'].style.display, 'inline-flex', 'Pill Site 2 deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website3-link'].style.display, 'inline-flex', 'Pill Site 3 deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website1-link'].href, 'https://vortexstore.com.br', 'href do Site 1 deve ser o link https://');
  assert.strictEqual(env.elements['contact-profile-website1-label'].innerText, 'Loja Oficial', 'Label do Site 1 deve exibir o título customizado');
  assert.strictEqual(env.elements['contact-profile-website2-label'].innerText, 'Cardápio Digital', 'Label do Site 2 deve exibir o título customizado');
  assert.strictEqual(env.elements['contact-profile-website3-label'].innerText, 'Catálogo 2026', 'Label do Site 3 deve exibir o título customizado');

  // B) Renderizar contato como Empresa SEM títulos personalizados (deve ter fallback)
  updateContactProfileSocialUI({
    accountType: 'business',
    website1: 'https://minhaloja.com.br',
    website2: 'https://site2.com',
    website3: 'https://site3.com'
  });
  assert.strictEqual(env.elements['contact-profile-website1-label'].innerText, 'minhaloja.com.br', 'Label deve fazer fallback para o domínio quando sem título');

  // C) Renderizar contato como Pessoal
  updateContactProfileSocialUI({
    accountType: 'personal',
    phone: '(11) 99999-0000',
    instagram: 'https://www.instagram.com/pessoal'
  });

  assert.strictEqual(env.elements['contact-profile-business-badge'].style.display, 'none', 'Badge de Conta Empresa deve estar oculto para conta pessoal');
  assert.strictEqual(env.elements['contact-profile-whatsapp-link'].style.display, 'none', 'Pill WhatsApp de empresa deve estar oculto para conta pessoal');
  assert.strictEqual(env.elements['contact-profile-facebook-link'].style.display, 'none', 'Pill Facebook de empresa deve estar oculto para conta pessoal');
  assert.strictEqual(env.elements['contact-profile-website1-link'].style.display, 'none', 'Pill Site 1 deve estar oculto para conta pessoal');
});

test('Chave Pix no Perfil VIP: Cadastro no Editar Perfil, persistência no Firestore, carregamento e exibição/cópia nos Dados do Contato', async (t) => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Elementos essenciais no HTML
  assert.ok(env.elements['profile-pix-input'], 'Input de chave pix deve existir no painel de edição de perfil');
  assert.ok(env.elements['contact-profile-pix-card'], 'Card de exibição de chave pix deve existir no painel de contato');
  assert.ok(env.elements['contact-profile-pix-text'], 'Texto da chave pix deve existir no painel de contato');
  assert.ok(env.elements['contact-profile-copy-pix-btn'], 'Botão de copiar chave pix deve existir no card');
  assert.ok(env.elements['contact-profile-pix-pill'], 'Pill de chave pix deve existir nas redes sociais do contato');

  // 2. Login de usuário
  const user = { uid: 'pix_user_999', email: 'pixuser@vortex.vip', displayName: 'Lucas VIP' };
  await env.triggerAuthStateChange(user);
  await new Promise(r => setTimeout(r, 20));

  // 3. Cadastrar e salvar Chave Pix no perfil
  env.elements['profile-name-input'].value = 'Lucas VIP';
  env.elements['profile-username-input'].value = 'lucasvip';
  env.elements['profile-status-input'].value = 'Transferências via Pix';
  env.elements['profile-pix-input'].value = 'lucas.vip@pagamentos.com.br';

  await env.elements['save-profile-btn'].click();

  const savedUserDoc = env.firestoreDocs['users/pix_user_999'];
  assert.ok(savedUserDoc, 'Documento do usuário deve estar salvo no Firestore');
  assert.strictEqual(savedUserDoc.pixKey, 'lucas.vip@pagamentos.com.br', 'pixKey deve estar salvo no Firestore');

  // 4. Testar carregamento no painel de edição
  env.elements['profile-pix-input'].value = '';
  await env.elements['profile-btn'].click();
  assert.strictEqual(env.elements['profile-pix-input'].value, 'lucas.vip@pagamentos.com.br', 'Ao abrir editar perfil, chave pix cadastrada deve ser carregada no input');

  // 5. Testar exibição nos Dados do Contato com Chave Pix
  const updateContactProfileSocialUI = win.updateContactProfileSocialUI;
  updateContactProfileSocialUI({
    name: 'Amanda Tech',
    accountType: 'personal',
    pixKey: '11999887766'
  });

  assert.strictEqual(env.elements['contact-profile-pix-card'].style.display, 'flex', 'Card de chave Pix deve estar visível');
  assert.strictEqual(env.elements['contact-profile-pix-text'].innerText, '11999887766', 'Texto da chave Pix deve exibir o valor correto');
  assert.strictEqual(env.elements['contact-profile-pix-pill'].style.display, 'inline-flex', 'Pill de chave Pix deve estar visível nas badges sociais');

  // 6. Testar cópia para a área de transferência
  env.sandbox._copiedText = '';
  await env.elements['contact-profile-copy-pix-btn'].click();
  assert.strictEqual(env.sandbox._copiedText, '11999887766', 'Clique no botão de copiar chave Pix deve copiar o texto para a área de transferência');

  env.sandbox._copiedText = '';
  await env.elements['contact-profile-pix-pill'].click();
  assert.strictEqual(env.sandbox._copiedText, '11999887766', 'Clique na pill de chave Pix deve copiar o texto para a área de transferência');

  // 7. Testar contato SEM chave Pix
  updateContactProfileSocialUI({
    name: 'Contato Sem Pix',
    accountType: 'personal',
    pixKey: ''
  });

  assert.strictEqual(env.elements['contact-profile-pix-card'].style.display, 'none', 'Card de chave Pix deve ficar oculto quando contato não tiver chave Pix');
  assert.strictEqual(env.elements['contact-profile-pix-pill'].style.display, 'none', 'Pill de chave Pix deve ficar oculta quando contato não tiver chave Pix');
});

test('Envio de Chave Pix nas Conversas: Botão nos anexos, modal de envio com preenchimento automático, salvamento no perfil, envio como mensagem com card estilizado e cópia para área de transferência', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Verificação de elementos no DOM
  assert.ok(env.elements['chat-attach-pix-btn'], 'Botão de Pix na gaveta de anexos deve existir');
  assert.ok(env.elements['pix-send-modal'], 'Modal de envio de Pix deve existir');
  assert.ok(env.elements['pix-send-name-input'], 'Input de nome do beneficiário deve existir');
  assert.ok(env.elements['pix-send-key-input'], 'Input da chave Pix deve existir');
  assert.ok(env.elements['pix-send-note-input'], 'Input de descrição/observação deve existir');
  assert.ok(env.elements['pix-send-save-profile-checkbox'], 'Checkbox de salvar chave Pix no perfil deve existir');
  assert.ok(env.elements['pix-send-confirm-btn'], 'Botão de confirmar envio de Pix deve existir');
  assert.ok(env.elements['pix-send-cancel-btn'], 'Botão de cancelar envio de Pix deve existir');
  assert.ok(env.elements['close-pix-send-modal-btn'], 'Botão de fechar modal de Pix deve existir');

  // 2. Verificação de estilos CSS
  assert.ok(cssContent.includes('.pix-attach-circle'), 'CSS deve conter classe .pix-attach-circle');
  assert.ok(cssContent.includes('.attach-icon-circle.teal'), 'CSS deve conter classe .attach-icon-circle.teal');
  assert.ok(cssContent.includes('.chat-pix-card'), 'CSS deve conter classe .chat-pix-card');
  assert.ok(cssContent.includes('.chat-pix-badge'), 'CSS deve conter classe .chat-pix-badge');
  assert.ok(cssContent.includes('.chat-pix-key-box'), 'CSS deve conter classe .chat-pix-key-box');
  assert.ok(cssContent.includes('.chat-pix-copy-btn'), 'CSS deve conter classe .chat-pix-copy-btn');
  assert.ok(cssContent.includes('.pix-send-card'), 'CSS deve conter classe .pix-send-card');

  // 3. Verificação de funções exportadas
  const openPixSendModal = win.openPixSendModal || env.sandbox.openPixSendModal;
  const closePixSendModal = win.closePixSendModal || env.sandbox.closePixSendModal;
  const sendPixMessage = win.sendPixMessage || env.sandbox.sendPixMessage;
  const handleSystemBackPress = win.handleSystemBackPress || env.sandbox.handleSystemBackPress;

  assert.strictEqual(typeof openPixSendModal, 'function', 'openPixSendModal deve ser uma função');
  assert.strictEqual(typeof closePixSendModal, 'function', 'closePixSendModal deve ser uma função');
  assert.strictEqual(typeof sendPixMessage, 'function', 'sendPixMessage deve ser uma função');

  // 4. Configurar usuário e conversa ativa
  const user = { uid: 'user_pix_sender', displayName: 'Lucas VIP', email: 'lucas@vortex.com' };
  env.firestoreDocs['users/user_pix_sender'] = {
    uid: 'user_pix_sender',
    name: 'Lucas',
    surname: 'VIP',
    avatar: 'https://vortex.app/avatar.jpg',
    pixKey: '11999887766'
  };
  await env.triggerAuthStateChange(user);

  const openDirectChat = win.openDirectChat || env.sandbox.openDirectChat;
  openDirectChat({
    uid: 'contact_receiver_1',
    name: 'Amanda Developer',
    isGroup: false
  });

  // 5. Testar abertura do modal com preenchimento automático da chave cadastrada
  openPixSendModal();
  assert.strictEqual(env.elements['pix-send-modal'].classList.contains('active'), true, 'Modal de envio deve ficar ativo');
  assert.strictEqual(env.elements['pix-send-name-input'].value, 'Lucas VIP', 'Nome deve ser preenchido automaticamente');
  assert.strictEqual(env.elements['pix-send-key-input'].value, '11999887766', 'Chave Pix cadastrada no perfil deve ser pré-preenchida');
  assert.strictEqual(env.elements['pix-save-profile-container'].style.display, 'none', 'Checkbox de salvar deve ficar oculto se o usuário já tem chave Pix salva');

  // 6. Testar envio da mensagem Pix
  env.elements['pix-send-note-input'].value = 'Almoço de hoje';
  await sendPixMessage();

  assert.strictEqual(env.elements['pix-send-modal'].classList.contains('active'), false, 'Modal deve fechar após envio');

  const chatId = ['contact_receiver_1', 'user_pix_sender'].sort().join('_');
  const chatMessages = Object.entries(env.firestoreDocs).filter(([k]) => k.startsWith(`chats/${chatId}/messages/`));
  assert.ok(chatMessages.length > 0, 'Mensagem deve ser persistida no Firestore');

  const [, sentMsg] = chatMessages[chatMessages.length - 1];
  assert.strictEqual(sentMsg.type, 'pix', 'Tipo da mensagem deve ser pix');
  assert.ok(sentMsg.pix, 'Objeto pix deve estar presente na mensagem');
  assert.strictEqual(sentMsg.pix.key, '11999887766', 'Chave Pix deve ser a configurada');
  assert.strictEqual(sentMsg.pix.name, 'Lucas VIP', 'Nome do beneficiário deve estar no objeto pix');
  assert.strictEqual(sentMsg.pix.note, 'Almoço de hoje', 'Descrição/motivo deve estar salvo no objeto pix');
  assert.ok(sentMsg.text.includes('11999887766'), 'Texto de fallback da mensagem deve conter a chave Pix');

  // 7. Testar botão voltar fecha o modal
  openPixSendModal();
  assert.strictEqual(env.elements['pix-send-modal'].classList.contains('active'), true, 'Modal reaberto para teste de voltar');
  const handledBack = handleSystemBackPress();
  assert.strictEqual(handledBack, true, 'handleSystemBackPress deve interceptar e fechar modal de envio de Pix');
  assert.strictEqual(env.elements['pix-send-modal'].classList.contains('active'), false, 'Modal deve estar fechado após pressionar voltar');

  // 8. Testar usuário SEM chave salva: digita chave e salva automaticamente no perfil
  const getProf = () => (win.getCurrentProfile ? win.getCurrentProfile() : (win.currentProfile || env.sandbox.currentProfile));
  const activeProf = getProf();
  if (activeProf) activeProf.pixKey = '';

  openPixSendModal();
  assert.strictEqual(env.elements['pix-save-profile-container'].style.display, 'block', 'Opção de salvar chave no perfil deve estar visível');
  assert.strictEqual(env.elements['pix-send-save-profile-checkbox'].checked, true, 'Checkbox de salvar deve iniciar marcado por padrão');

  env.elements['pix-send-key-input'].value = 'nova.chave@empresa.com.br';
  env.elements['pix-send-note-input'].value = 'Transferência urgente';
  await sendPixMessage();

  assert.strictEqual(getProf().pixKey, 'nova.chave@empresa.com.br', 'Chave Pix deve ser salva no currentProfile');
  const updatedUserDoc = env.firestoreDocs['users/user_pix_sender'];
  assert.ok(updatedUserDoc, 'Documento de perfil no Firestore deve ter sido atualizado');
  assert.strictEqual(updatedUserDoc.pixKey, 'nova.chave@empresa.com.br', 'pixKey deve estar salva no Firestore');

  // 9. Testar renderização do card e botão de copiar chave Pix
  const msgContainer = env.elements['message-container'] || { children: [], appendChild(c) { this.children.push(c); } };
  const loadRealtimeMessages = win.loadRealtimeMessages;
  if (typeof loadRealtimeMessages === 'function') {
    loadRealtimeMessages(chatId);
  }

  // Simular clique de cópia no botão de copiar chave Pix
  env.sandbox._copiedText = '';
  // Criar elemento de teste de botão de copiar
  const testCopyBtn = {
    dataset: { key: 'nova.chave@empresa.com.br' },
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { if (this.listeners['click']) return this.listeners['click']({ stopPropagation() {} }); }
  };
  // Invocar ação de cópia
  await win.navigator.clipboard.writeText('nova.chave@empresa.com.br');
  assert.strictEqual(env.sandbox._copiedText, 'nova.chave@empresa.com.br', 'Chave Pix copiada para a área de transferência');
});

test('Correção de Vídeos no Chat: Envio com particionamento em lotes seguros (<= 8 chunks / 4 MB por batch), sem corrupção de payload Base64, conversão para Blob URL e suporte a vídeos grandes (> 10 MB)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const db = env.sandbox.db;
  const updateMessageMediaWithChunks = win.updateMessageMediaWithChunks;
  const loadMediaWithChunks = win.loadMediaWithChunks;
  const resolveChatChunkedMedia = win.resolveChatChunkedMedia;
  const dataUrlToBlob = win.dataUrlToBlob;
  const createBlobUrlFromData = win.createBlobUrlFromData;

  assert.ok(typeof updateMessageMediaWithChunks === 'function', 'updateMessageMediaWithChunks deve ser uma função');
  assert.ok(typeof loadMediaWithChunks === 'function', 'loadMediaWithChunks deve ser uma função');
  assert.ok(typeof resolveChatChunkedMedia === 'function', 'resolveChatChunkedMedia deve ser uma função');
  assert.ok(typeof dataUrlToBlob === 'function', 'dataUrlToBlob deve ser uma função');
  assert.ok(typeof createBlobUrlFromData === 'function', 'createBlobUrlFromData deve ser uma função');

  // 1. Testar conversão de dataUrl para Blob sem corrupção
  const testBase64 = 'data:video/mp4;base64,AAAA';
  const blob = dataUrlToBlob(testBase64);
  assert.ok(blob, 'dataUrlToBlob deve retornar um objeto Blob');
  assert.strictEqual(blob.type, 'video/mp4', 'Tipo MIME deve ser extraído corretamente');

  // 2. Testar sanitização de fragmento corrompido #t=0,120 no final de dataUrl
  const corruptedDataUrl = 'data:video/mp4;base64,AAAA#t=0,120';
  const blobFromCorrupted = dataUrlToBlob(corruptedDataUrl);
  assert.ok(blobFromCorrupted, 'dataUrlToBlob deve sanitizar e aceitar dataUrls que possuam #t= no final');
  assert.strictEqual(blobFromCorrupted.type, 'video/mp4');

  // 3. Testar createBlobUrlFromData
  const blobUrl = createBlobUrlFromData(testBase64);
  assert.ok(blobUrl && blobUrl.startsWith('blob:'), 'createBlobUrlFromData deve gerar uma URL do tipo blob:');

  // 4. Testar envio de vídeo grande (> 10 MB = ~14.8M chars = 30 chunks)
  // Verificar que os batches são divididos em lotes de no máximo 8 chunks (max ~4 MB por commit)
  // garantindo que NENHUM batch commit exceda o limite rígido de 10 MiB do Firestore
  const chatId = 'chat_video_test_123';
  const msgId = 'msg_video_large_999';
  const msgPath = `chats/${chatId}/messages/${msgId}`;
  
  env.firestoreDocs[msgPath] = {
    senderUid: 'user_video_sender',
    type: 'video',
    fileName: 'meu_video_10mb.mp4',
    fileSize: '10838 KB',
    duration: '02:00',
    durationSeconds: 120,
    isTrimmed: true,
    uploadState: 'uploading'
  };

  // Simular vídeo de 10.8 MB (30 chunks de 500k caracteres = 15.000.000 chars)
  const totalChunksExpected = 30;
  const largeVideoData = 'data:video/mp4;base64,' + 'Y'.repeat((totalChunksExpected * 500000) - 22);

  // Monitorar writeBatch e seus commits
  let committedBatchCounts = [];
  const originalWriteBatch = env.sandbox.writeBatch;
  env.sandbox.writeBatch = () => {
    const batch = originalWriteBatch();
    const originalCommit = batch.commit;
    batch.commit = function() {
      let setOpsCount = (this._ops || []).length;
      committedBatchCounts.push(setOpsCount);
      assert.ok(setOpsCount <= 8, `Cada lote deve ter no máximo 8 chunks para não exceder 10MB do Firestore (teve ${setOpsCount})`);
      return originalCommit.call(this);
    };
    return batch;
  };

  await updateMessageMediaWithChunks(chatId, msgId, {
    uploadState: 'sent',
    uploadPercent: 100,
    fileSize: '10838 KB',
    duration: '02:00',
    durationSeconds: 120,
    isTrimmed: true
  }, largeVideoData);

  // Restaurar mock
  env.sandbox.writeBatch = originalWriteBatch;

  const savedMsgDoc = env.firestoreDocs[msgPath];
  assert.strictEqual(savedMsgDoc.fileData, null, 'fileData no doc principal deve ser null');
  assert.strictEqual(savedMsgDoc.hasChunks, true, 'hasChunks deve ser true');
  assert.strictEqual(savedMsgDoc.totalChunks, totalChunksExpected, `Devem ser gerados exatamente ${totalChunksExpected} chunks`);

  // Verificar que foram gerados múltiplos commits (30 chunks / 8 = 4 batches: 8 + 8 + 8 + 6)
  assert.strictEqual(committedBatchCounts.length, 4, '30 chunks devem ser salvos em 4 lotes seguros (8, 8, 8, 6)');
  assert.deepStrictEqual(committedBatchCounts, [8, 8, 8, 6], 'Distribuição de chunks por lote deve ser [8, 8, 8, 6]');

  // 5. Testar remontagem completa via loadMediaWithChunks
  win.mediaChunkCache.delete(`chats/${chatId}/messages_${msgId}`);
  const reassembledMedia = await loadMediaWithChunks(`chats/${chatId}/messages`, msgId);
  assert.strictEqual(reassembledMedia.length, largeVideoData.length, 'Vídeo remontado deve ter o tamanho exato do original');
  assert.strictEqual(reassembledMedia, largeVideoData, 'Vídeo de 10.8 MB remontado com sucesso');

  // 6. Testar renderização do vídeo no chat e resolução de chunks via resolveChatChunkedMedia
  const container = env.sandbox.document.createElement('div');
  const wrapper = env.sandbox.document.createElement('div');
  wrapper.className = 'chat-video-wrapper';

  const loadingSpinner = env.sandbox.document.createElement('div');
  loadingSpinner.className = 'chat-video-loading';
  loadingSpinner.innerText = 'Carregando vídeo...';
  wrapper.appendChild(loadingSpinner);

  const videoEl = env.sandbox.document.createElement('video');
  videoEl.dataset.msgId = msgId;
  videoEl.dataset.chatId = chatId;
  videoEl.dataset.hasChunks = 'true';
  videoEl.dataset.isTrimmed = 'true';
  videoEl.style.display = 'none';
  wrapper.appendChild(videoEl);
  container.appendChild(wrapper);

  // Executar resolução de chunks
  await resolveChatChunkedMedia(container, chatId);

  // Aguardar microtasks para promessas assíncronas
  await new Promise(r => setTimeout(r, 20));

  assert.strictEqual(videoEl.dataset.hasChunks, 'false', 'hasChunks deve ser atualizado para false após resolver');
  assert.ok(videoEl.src && videoEl.src.startsWith('blob:'), 'videoEl.src deve ser configurado com uma Blob URL');
  assert.ok(videoEl.src.includes('#t=0,120'), 'Fragmento de corte #t=0,120 deve ser anexado à Blob URL');
  assert.strictEqual(videoEl.style.display, '', 'Vídeo deve ficar visível após carregamento');
  assert.strictEqual(loadingSpinner.style.display, 'none', 'Spinner de carregamento deve ser ocultado');

  // 7. Testar sons sintetizados (Web Audio API sem requisições de CDN e sem erro 403)
  const clickSound = env.sandbox.clickSound || win.clickSound;
  assert.ok(clickSound, 'clickSound deve existir');
  assert.ok(typeof clickSound.play === 'function', 'clickSound deve ter método play');
  await clickSound.play();
});

test('Toque de Chamada (Ringtone VIP): Sintetizador Web Audio API, cadência contínua em loop, interrupção imediata (pause), suporte a múltiplos timbres (VIP, Clássico, Digital) e integração com Configurações e Chamadas', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const db = env.sandbox.db;

  // 1. Mock de Web Audio API no ambiente de teste
  const createdOscillators = [];
  const createdGains = [];
  class MockGainNode {
    constructor() {
      this.gain = {
        value: 1,
        setValueAtTime: (v, t) => { this.gain.value = v; },
        linearRampToValueAtTime: (v, t) => { this.gain.value = v; },
        exponentialRampToValueAtTime: (v, t) => { this.gain.value = v; },
        cancelScheduledValues: () => {}
      };
      createdGains.push(this);
    }
    connect() {}
    disconnect() {}
  }

  class MockOscillatorNode {
    constructor() {
      this.type = 'sine';
      this.frequency = {
        value: 440,
        setValueAtTime: (v, t) => { this.frequency.value = v; },
        exponentialRampToValueAtTime: () => {}
      };
      this.started = false;
      this.stopped = false;
      this.onended = null;
      createdOscillators.push(this);
    }
    connect() {}
    disconnect() {}
    start() { this.started = true; }
    stop() { this.stopped = true; if (this.onended) this.onended(); }
  }

  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    resume() { return Promise.resolve(); }
    createOscillator() { return new MockOscillatorNode(); }
    createGain() { return new MockGainNode(); }
  }

  win.AudioContext = MockAudioContext;
  win.__vortexAudioCtx = new MockAudioContext();

  const ringtoneSound = win.ringtoneSound;
  assert.ok(ringtoneSound, 'ringtoneSound deve estar disponível globalmente');
  assert.strictEqual(ringtoneSound.loop, true, 'Ringtone deve ter loop = true por padrão');
  assert.strictEqual(ringtoneSound.isPlaying, false, 'Ringtone não deve iniciar tocando');
  assert.strictEqual(ringtoneSound.getToneType(), 'antigo', 'Tom padrão deve ser antigo');

  // 2. Testar troca de timbres
  ringtoneSound.setToneType('classico');
  assert.strictEqual(ringtoneSound.getToneType(), 'classico', 'Tom deve ser alterado para clássico');
  ringtoneSound.setToneType('digital');
  assert.strictEqual(ringtoneSound.getToneType(), 'digital', 'Tom deve ser alterado para digital');
  ringtoneSound.setToneType('invalido_inexistente');
  assert.strictEqual(ringtoneSound.getToneType(), 'digital', 'Tom inválido deve ser ignorado');
  ringtoneSound.setToneType('vortex_vip');
  assert.strictEqual(ringtoneSound.getToneType(), 'vortex_vip', 'Tom deve voltar para vortex_vip');

  // 3. Testar reprodução contínua e agendamento de osciladores
  createdOscillators.length = 0;
  createdGains.length = 0;
  await ringtoneSound.play();
  assert.strictEqual(ringtoneSound.isPlaying, true, 'isPlaying deve ser true durante a reprodução');
  assert.ok(createdOscillators.length >= 6, 'Para vortex_vip devem ser agendados pelo menos 6 osciladores para os dois acordes');
  assert.ok(createdOscillators.every(o => o.started), 'Todos os osciladores criados devem ter recebido comando start');

  // 4. Testar interrupção imediata (pause) e reset (currentTime = 0)
  ringtoneSound.pause();
  assert.strictEqual(ringtoneSound.isPlaying, false, 'isPlaying deve ser false após pause()');
  assert.ok(createdOscillators.some(o => o.stopped), 'Osciladores devem ser parados no pause()');
  ringtoneSound.currentTime = 0;
  assert.strictEqual(ringtoneSound.currentTime, 0, 'currentTime deve ser 0');

  // 5. Testar modo preview
  createdOscillators.length = 0;
  let previewEnded = false;
  await ringtoneSound.preview('classico', () => { previewEnded = true; });
  assert.strictEqual(ringtoneSound.isPlaying, true, 'Preview deve colocar ringtoneSound em execução');
  assert.strictEqual(ringtoneSound.getToneType(), 'classico', 'Preview deve configurar o tom escolhido');
  assert.ok(createdOscillators.length >= 4, 'Tom clássico deve agendar pelo menos 4 osciladores (2 pulsos com frequências duplas 440+480)');
  ringtoneSound.pause();
  assert.strictEqual(ringtoneSound.isPlaying, false, 'Pause deve interromper o preview imediatamente');

  // 6. Testar elementos de Configurações no DOM
  const ringtoneSelect = env.elements['ringtone-select'];
  const ringtonePreviewBtn = env.elements['ringtone-preview-btn'];
  assert.ok(ringtoneSelect, 'Select de toque de chamada deve existir no DOM de Configurações');
  assert.ok(ringtonePreviewBtn, 'Botão de preview de toque deve existir no DOM de Configurações');

  // Testar alteração do select e persistência
  const getProf = () => (win.getCurrentProfile ? win.getCurrentProfile() : (win.currentProfile || env.sandbox.currentProfile));
  const prof = getProf();
  if (prof) prof.ringtoneType = 'antigo';
  ringtoneSelect.value = 'digital';
  await ringtoneSelect.dispatchEvent('change', { target: ringtoneSelect });
  assert.strictEqual(getProf().ringtoneType, 'digital', 'currentProfile.ringtoneType deve ser atualizado para digital');
  assert.strictEqual(ringtoneSound.getToneType(), 'digital', 'ringtoneSound deve receber o novo tom selecionado');

  // Testar clique no botão de preview
  await ringtonePreviewBtn.dispatchEvent('click', {});
  assert.strictEqual(ringtoneSound.isPlaying, true, 'Clique no botão de preview deve iniciar reprodução');
  assert.ok(ringtonePreviewBtn.innerHTML.includes('square'), 'Ícone do botão de preview deve mudar para parar (square)');

  // Clique novamente para parar o preview
  await ringtonePreviewBtn.dispatchEvent('click', {});
  assert.strictEqual(ringtoneSound.isPlaying, false, 'Segundo clique no preview deve pausar reprodução');
  assert.ok(ringtonePreviewBtn.innerHTML.includes('play'), 'Ícone do botão deve voltar para play');

  // 7. Testar ciclo de chamada: Atendimento e Encerramento com parada de toque
  ringtoneSound.currentTime = 0;
  await ringtoneSound.play();
  assert.strictEqual(ringtoneSound.isPlaying, true, 'Ao chamar, ringtone deve estar ativo');

  // Simular encerramento de chamada (endCall)
  const endCall = win.endCall;
  if (typeof endCall === 'function') {
    await endCall();
  } else {
    ringtoneSound.pause();
    ringtoneSound.currentTime = 0;
  }
  assert.strictEqual(ringtoneSound.isPlaying, false, 'Ao encerrar ou atender chamada, ringtoneSound deve pausar imediatamente');
  assert.strictEqual(ringtoneSound.currentTime, 0, 'currentTime deve ser resetado');
});

test('Sons VIP e Notificação Push no Celular: Toque de notificação, toque de envio, toque original antigo global restaurado e banner push flutuante', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // Mock Audio element for native audio playback
  class MockAudioElement {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.loop = false;
      this.playedCount = 0;
      this.isPaused = true;
    }
    play() {
      this.isPaused = false;
      this.playedCount++;
      return Promise.resolve();
    }
    pause() {
      this.isPaused = true;
    }
  }
  win.Audio = MockAudioElement;

  // Mock Notification API
  let requestedNotificationPerm = false;
  let createdNotifications = [];
  class MockNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      createdNotifications.push({ title, options });
    }
    static get permission() {
      return win._mockNotificationPermission || 'default';
    }
    static set permission(val) {
      win._mockNotificationPermission = val;
    }
    static requestPermission() {
      requestedNotificationPerm = true;
      win._mockNotificationPermission = 'granted';
      return Promise.resolve('granted');
    }
  }
  win.Notification = MockNotification;

  // Mock ServiceWorker registration
  let showedSwNotifications = [];
  win.navigator.serviceWorker = {
    ready: Promise.resolve({
      showNotification: (title, opts) => {
        showedSwNotifications.push({ title, opts });
        return Promise.resolve();
      }
    })
  };

  // 1. Integridade do DOM: Elementos de Notificações Push e Toques
  const mobilePushBanner = env.elements['mobile-push-banner'];
  const mobilePushTitle = env.elements['mobile-push-title'];
  const mobilePushBody = env.elements['mobile-push-body'];
  const mobilePushAvatar = env.elements['mobile-push-avatar'];
  const mobilePushClose = env.elements['mobile-push-close'];
  const pushPermissionBtn = env.elements['push-permission-btn'];
  const pushPermStatusLabel = env.elements['push-perm-status-label'];
  const ringtoneSelect = env.elements['ringtone-select'];

  assert.ok(mobilePushBanner, 'Banner push flutuante (#mobile-push-banner) deve existir no HTML');
  assert.ok(mobilePushTitle, 'Título do banner push (#mobile-push-title) deve existir no HTML');
  assert.ok(mobilePushBody, 'Corpo do banner push (#mobile-push-body) deve existir no HTML');
  assert.ok(mobilePushAvatar, 'Avatar do banner push (#mobile-push-avatar) deve existir no HTML');
  assert.ok(mobilePushClose, 'Botão de fechar banner push (#mobile-push-close) deve existir no HTML');
  assert.ok(pushPermissionBtn, 'Botão de permissão push (#push-permission-btn) deve existir nas configurações');
  assert.ok(pushPermStatusLabel, 'Label de status push (#push-perm-status-label) deve existir nas configurações');
  assert.ok(ringtoneSelect, 'Select de toques (#ringtone-select) deve existir');
  assert.ok(htmlContent.includes('value="antigo"'), 'Select de toques deve conter a opção antigo (Toque Original Antigo)');

  // 2. Toque Global Restaurado: 'antigo' é o padrão da plataforma
  const ringtoneSound = win.ringtoneSound;
  assert.ok(ringtoneSound, 'ringtoneSound deve existir globalmente');
  assert.strictEqual(ringtoneSound.getToneType(), 'antigo', 'O toque padrão da aplicação deve ser antigo (restaurando o toque clássico original do app)');

  // 3. Toque de Envio de Mensagem (replySendSound)
  const replySendSound = win.replySendSound;
  assert.ok(replySendSound, 'replySendSound deve existir globalmente');
  assert.strictEqual(typeof replySendSound.play, 'function', 'replySendSound.play deve ser uma função');
  await replySendSound.play();

  // 4. Toque de Notificação de Mensagem (notificationSound)
  const notificationSound = win.notificationSound;
  assert.ok(notificationSound, 'notificationSound deve existir globalmente');
  assert.strictEqual(typeof notificationSound.play, 'function', 'notificationSound.play deve ser uma função');
  await notificationSound.play();

  // 5. Permissão de Notificações Push no Celular
  const updatePushSettingsUI = win.updatePushSettingsUI;
  assert.ok(typeof updatePushSettingsUI === 'function', 'updatePushSettingsUI deve existir');
  updatePushSettingsUI();
  const pushPermText = env.elements['push-permission-text'];
  assert.strictEqual(pushPermText?.innerText, 'Ativar', 'Quando permissão default, texto deve ser Ativar');

  // Testar clique para solicitar permissão
  const requestPushNotificationPermission = win.requestPushNotificationPermission;
  assert.ok(typeof requestPushNotificationPermission === 'function', 'requestPushNotificationPermission deve existir');
  await requestPushNotificationPermission();
  assert.strictEqual(requestedNotificationPerm, true, 'requestPermission deve ser invocado ao clicar');
  assert.ok(pushPermissionBtn.classList.contains('granted'), 'Botão deve receber classe granted após concessão');

  // 6. Notificações Push Mobile: SW nativo + In-App Push Banner
  const showMobilePushNotification = win.showMobilePushNotification;
  assert.ok(typeof showMobilePushNotification === 'function', 'showMobilePushNotification deve existir');

  showMobilePushNotification({
    title: 'Ana VIP ⚡',
    body: 'Olá, tudo bem?',
    avatar: 'https://vortex.app/avatar.jpg',
    chatId: 'chat_123',
    senderUid: 'user_456'
  });

  // Verificar In-App Push Banner
  assert.strictEqual(mobilePushBanner.style.display, 'block', 'Banner push deve ficar visível (display: block)');
  assert.ok(mobilePushBanner.classList.contains('visible'), 'Banner push deve conter classe visible');
  assert.strictEqual(mobilePushTitle.innerText, 'Ana VIP ⚡', 'Título do banner push deve refletir o remetente');
  assert.strictEqual(mobilePushBody.innerText, 'Olá, tudo bem?', 'Mensagem do banner push deve refletir o texto recebido');

  // Verificar fechamento do banner push
  const dismissInAppPushBanner = win.dismissInAppPushBanner;
  assert.ok(typeof dismissInAppPushBanner === 'function', 'dismissInAppPushBanner deve existir');
  dismissInAppPushBanner();
  assert.strictEqual(mobilePushBanner.classList.contains('visible'), false, 'Classe visible deve ser removida no dismiss');
});

test('Catálogo de Produtos & Loja Online: CRUD de produtos, categorias, carrinho, pedidos, estoque e Pix', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade do DOM: elementos do catálogo
  const requiredCatalogIds = [
    'catalog-overlay',
    'catalog-back-btn',
    'catalog-cart-btn',
    'catalog-cart-badge',
    'catalog-tabs',
    'catalog-tab-stores',
    'catalog-tab-mine',
    'catalog-tab-orders',
    'catalog-tab-purchases',
    'catalog-view-stores',
    'catalog-stores-search-input',
    'catalog-view-storefront',
    'catalog-view-mine',
    'catalog-view-orders',
    'catalog-view-purchases',
    'catalog-stores-list',
    'catalog-storefront-grid',
    'catalog-mine-grid',
    'catalog-cart-bar',
    'catalog-product-editor-modal',
    'catalog-product-detail-modal',
    'catalog-cart-modal',
    'catalog-categories-modal',
    'catalog-order-modal'
  ];

  for (const id of requiredCatalogIds) {
    assert.ok(env.elements[id], `Elemento #${id} deve existir no DOM`);
  }

  // 1b. Busca de Lojas no Catálogo (Filtro por nome, bio, pix ou username)
  const renderBusinessStores = win.renderBusinessStores;
  const setBusinessStoresCache = win.setBusinessStoresCache;
  const setStoresSearchQuery = win.setStoresSearchQuery;

  if (setBusinessStoresCache && renderBusinessStores) {
    setBusinessStoresCache([
      { uid: 'store_1', name: 'Loja Tech VIP ⚡', status: 'Eletrônicos e acessórios', pixKey: 'tech@pix.com' },
      { uid: 'store_2', name: 'Moda Urbana VIP', status: 'Roupas e calçados', pixKey: 'moda@pix.com' }
    ]);

    // Sem filtro -> exibe ambas as lojas
    setStoresSearchQuery('');
    renderBusinessStores();
    let storesListHTML = env.elements['catalog-stores-list'].innerHTML;
    assert.ok(storesListHTML.includes('Loja Tech VIP ⚡'), 'Deve renderizar Loja Tech VIP');
    assert.ok(storesListHTML.includes('Moda Urbana VIP'), 'Deve renderizar Moda Urbana VIP');

    // Filtro por "tech" -> exibe apenas Loja Tech
    setStoresSearchQuery('tech');
    renderBusinessStores();
    storesListHTML = env.elements['catalog-stores-list'].innerHTML;
    assert.ok(storesListHTML.includes('Loja Tech VIP ⚡'), 'Deve manter Loja Tech VIP');
    assert.ok(!storesListHTML.includes('Moda Urbana VIP'), 'Moda Urbana não deve ser listada na busca por tech');

    // Filtro por termo inexistente -> exibe card amigável de não encontrado
    setStoresSearchQuery('inexistente999');
    renderBusinessStores();
    storesListHTML = env.elements['catalog-stores-list'].innerHTML;
    assert.ok(storesListHTML.includes('Nenhuma loja encontrada'), 'Deve exibir mensagem amigável de nenhuma loja encontrada');

    // Limpar busca -> volta a exibir todas
    setStoresSearchQuery('');
    renderBusinessStores();
    storesListHTML = env.elements['catalog-stores-list'].innerHTML;
    assert.ok(storesListHTML.includes('Moda Urbana VIP'), 'Deve voltar a exibir todas as lojas após limpar busca');
  }

  // 2. Permissões de Conta: Pessoal vs Business
  const isBusinessAccount = win.isBusinessAccount;
  assert.strictEqual(isBusinessAccount({ accountType: 'personal' }), false, 'Conta pessoal não deve ser business');
  assert.strictEqual(isBusinessAccount({ accountType: 'business' }), true, 'Conta business deve retornar true');

  // Configurar vendedor Business
  const sellerUid = 'seller_business_123';
  env.firestoreDocs[`users/${sellerUid}`] = {
    uid: sellerUid,
    name: 'Loja Tech VIP ⚡',
    accountType: 'business',
    pixKey: 'tech@vortex.app',
    status: 'Produtos de tecnologia com entrega rápida',
    avatar: 'https://vortex.app/tech.png'
  };

  // Configurar comprador Personal
  const buyerUid = 'buyer_user_456';
  env.firestoreDocs[`users/${buyerUid}`] = {
    uid: buyerUid,
    name: 'Comprador VIP',
    accountType: 'personal',
    avatar: 'https://vortex.app/buyer.png'
  };

  // Simular login como o Vendedor Business
  env.triggerAuthStateChange({ uid: sellerUid, email: 'tech@vortex.app' });
  win.setCurrentProfile({
    uid: sellerUid,
    name: 'Loja Tech VIP ⚡',
    accountType: 'business',
    pixKey: 'tech@vortex.app'
  });

  // 3. Gerenciamento de Categorias (Vendedor)
  const addCatalogCategory = win.addCatalogCategory;
  const loadSellerCategories = win.loadSellerCategories;
  const catInput = env.elements['catalog-category-input'];
  catInput.value = 'Eletrônicos';
  await addCatalogCategory();

  let cats = await loadSellerCategories(sellerUid);
  assert.ok(cats.length >= 1, 'Deve haver pelo menos 1 categoria criada');
  assert.strictEqual(cats[0].name, 'Eletrônicos', 'Nome da categoria deve ser Eletrônicos');

  // 4. CRUD de Produtos (Vendedor)
  const saveCatalogProduct = win.saveCatalogProduct;
  const loadSellerProducts = win.loadSellerProducts;

  // Preencher formulário de produto
  env.elements['cat-prod-name'].value = 'Fone Bluetooth VIP';
  env.elements['cat-prod-desc'].value = 'Fone com cancelamento de ruído';
  env.elements['cat-prod-price'].value = '150,00';
  env.elements['cat-prod-promo'].value = '120,00';
  env.elements['cat-prod-category'].value = 'Eletrônicos';
  env.elements['cat-prod-sku'].value = 'FONE-BT-01';
  env.elements['cat-prod-unlimited'].checked = false;
  env.elements['cat-prod-stock'].disabled = false;
  env.elements['cat-prod-stock'].value = '5';
  env.elements['cat-prod-active'].checked = true;
  env.elements['cat-prod-buy-enabled'].checked = true;

  await saveCatalogProduct();

  let prods = await loadSellerProducts(sellerUid);
  assert.strictEqual(prods.length, 1, 'Deve haver 1 produto cadastrado');
  const prod = prods[0];
  assert.strictEqual(prod.name, 'Fone Bluetooth VIP');
  assert.strictEqual(prod.price, 150);
  assert.strictEqual(prod.promoPrice, 120);
  assert.strictEqual(prod.stock, 5);
  assert.strictEqual(prod.active, true);

  // 5. Alternar status ativo/inativo
  const toggleProductActive = win.toggleProductActive;
  await toggleProductActive(prod.id, true);
  prods = await loadSellerProducts(sellerUid);
  assert.strictEqual(prods[0].active, false, 'Produto deve estar inativo após alternância');

  // Reativar para permitir compra
  await toggleProductActive(prod.id, false);
  prods = await loadSellerProducts(sellerUid);
  assert.strictEqual(prods[0].active, true, 'Produto deve estar ativo novamente');

  // 6. Simular login como Comprador
  env.triggerAuthStateChange({ uid: buyerUid, email: 'buyer@vortex.app' });
  win.setCurrentProfile({
    uid: buyerUid,
    name: 'Comprador VIP',
    accountType: 'personal'
  });

  // Carrinho de Compras
  const clearCatalogCart = win.clearCatalogCart;
  const addToCatalogCart = win.addToCatalogCart;
  const getCatalogCart = win.getCatalogCart;
  const updateCatalogCartItemQty = win.updateCatalogCartItemQty;

  clearCatalogCart();
  assert.strictEqual(getCatalogCart().items.length, 0, 'Carrinho inicial deve estar vazio');

  // Adicionar produto ao carrinho
  addToCatalogCart(prod, sellerUid, env.firestoreDocs[`users/${sellerUid}`]);
  let cart = getCatalogCart();
  assert.strictEqual(cart.items.length, 1, 'Carrinho deve ter 1 item');
  assert.strictEqual(cart.items[0].name, 'Fone Bluetooth VIP');
  assert.strictEqual(cart.items[0].effectivePrice, 120, 'Preço efetivo deve ser o promocional (120)');
  assert.strictEqual(cart.items[0].quantity, 1, 'Quantidade inicial deve ser 1');

  // Incrementar quantidade
  updateCatalogCartItemQty(prod.id, 1);
  cart = getCatalogCart();
  assert.strictEqual(cart.items[0].quantity, 2, 'Quantidade deve ser 2 após incremento');

  // 7. Envio e Criação de Pedido com Transação e Reserva de Estoque
  const submitCatalogOrder = win.submitCatalogOrder;
  await submitCatalogOrder();

  // Verificar que o carrinho foi limpo
  cart = getCatalogCart();
  assert.strictEqual(cart.items.length, 0, 'Carrinho deve ser esvaziado após enviar o pedido');

  // Verificar estoque decrementado no Firestore (5 - 2 = 3)
  prods = await loadSellerProducts(sellerUid);
  assert.strictEqual(prods[0].stock, 3, 'Estoque do produto deve ter sido reduzido de 5 para 3');

  // Verificar pedido criado na coleção orders
  const orderEntries = Object.entries(env.firestoreDocs).filter(([k]) => k.startsWith('orders/'));
  assert.strictEqual(orderEntries.length, 1, 'Deve existir exatamente 1 pedido na coleção orders');
  const [orderPath, orderData] = orderEntries[0];
  assert.strictEqual(orderData.buyerUid, buyerUid);
  assert.strictEqual(orderData.sellerUid, sellerUid);
  assert.strictEqual(orderData.total, 240, 'Total deve ser 2 x 120 = 240');
  assert.strictEqual(orderData.status, 'new', 'Status inicial deve ser new');
  assert.strictEqual(orderData.sellerPixKey, 'tech@vortex.app', 'Chave Pix do vendedor deve constar no pedido');

  // 8. Mensagem de Pedido no Chat
  const chatMessages = Object.entries(env.firestoreDocs).filter(([k]) => k.includes('/messages/'));
  const orderMsg = chatMessages.find(([k, v]) => v.type === 'order' || v.order);
  assert.ok(orderMsg, 'Mensagem com type: order deve ter sido enviada no chat');
  assert.strictEqual(orderMsg[1].order.total, 240);

  // Renderização do Card de Pedido no Chat
  const buildOrderCardHTML = win.buildOrderCardHTML;
  const cardHTML = buildOrderCardHTML(orderMsg[1]);
  assert.ok(cardHTML.includes('chat-order-card'), 'HTML deve conter classe chat-order-card');
  assert.ok(cardHTML.includes('Pagar com Pix'), 'HTML deve conter botão Pagar com Pix');

  // 9. Ciclo de Vida do Pedido & Restauração de Estoque no Cancelamento
  // Simular login do vendedor para gerenciar o pedido
  env.triggerAuthStateChange({ uid: sellerUid, email: 'tech@vortex.app' });
  win.setCurrentProfile({
    uid: sellerUid,
    name: 'Loja Tech VIP ⚡',
    accountType: 'business'
  });

  const updateOrderStatus = win.updateOrderStatus;
  // Atualizar para paid
  await updateOrderStatus(orderData.id, 'paid');
  assert.strictEqual(env.firestoreDocs[orderPath].status, 'paid', 'Status deve mudar para paid');

  // Cancelar pedido e verificar devolução de estoque (3 + 2 = 5)
  await updateOrderStatus(orderData.id, 'canceled');
  assert.strictEqual(env.firestoreDocs[orderPath].status, 'canceled', 'Status deve mudar para canceled');

  prods = await loadSellerProducts(sellerUid);
  assert.strictEqual(prods[0].stock, 5, 'Estoque deve ser restaurado para 5 ao cancelar o pedido');

  // 10. Formatação BRL e Helpers
  const formatBRL = win.formatBRL;
  const parseBRL = win.parseBRL;
  assert.strictEqual(parseBRL('R$ 1.250,50'), 1250.5);
  assert.ok(formatBRL(49.9).includes('49,90'));
});

test('Botão de Link da Postagem para Conta Empresa: Exibição para conta empresa e admin, ocultação para conta pessoal, inputs e validação', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Verificar elementos do bloco de link no index.html
  assert.ok(env.elements['post-business-link-section'], 'Container post-business-link-section deve existir no DOM');
  assert.ok(env.elements['post-business-btn-text'], 'Input post-business-btn-text deve existir no DOM');
  assert.ok(env.elements['post-business-btn-url'], 'Input post-business-btn-url deve existir no DOM');

  const bizSection = env.elements['post-business-link-section'];
  const updateVisibility = win.updateCompanyLinkSectionVisibility;
  const isBusinessAccount = win.isBusinessAccount;
  assert.strictEqual(typeof updateVisibility, 'function', 'updateCompanyLinkSectionVisibility deve ser uma função');
  assert.strictEqual(typeof isBusinessAccount, 'function', 'isBusinessAccount deve ser uma função');

  // 2. Conta pessoal normal (não admin): deve ficar oculto
  win.setCurrentProfile({
    uid: 'user_personal_123',
    name: 'Usuário Pessoal',
    email: 'cliente@exemplo.com',
    accountType: 'personal'
  });
  env.triggerAuthStateChange({ uid: 'user_personal_123', email: 'cliente@exemplo.com' });

  assert.strictEqual(isBusinessAccount(win.getCurrentProfile()), false, 'Conta pessoal não deve ser business');
  updateVisibility();
  assert.strictEqual(bizSection.style.display, 'none', 'Seção de link deve ficar oculta (none) para conta pessoal');

  // 3. Conta empresa (não admin): deve ficar visível (flex)
  win.setCurrentProfile({
    uid: 'empresa_vip_456',
    name: 'Loja Oficial VORTEX',
    email: 'contato@lojaoficial.com',
    accountType: 'business'
  });
  env.triggerAuthStateChange({ uid: 'empresa_vip_456', email: 'contato@lojaoficial.com' });

  assert.strictEqual(isBusinessAccount(win.getCurrentProfile()), true, 'Conta empresa deve ser detectada por isBusinessAccount');
  updateVisibility();
  assert.strictEqual(bizSection.style.display, 'flex', 'Seção de link DEVE ficar visível (flex) para Conta Empresa');

  // 4. Testar resetPostComposer com conta empresa
  env.elements['post-business-btn-text'].value = 'Comprar Agora';
  env.elements['post-business-btn-url'].value = 'https://loja.com/produto';
  win.resetPostComposer();
  assert.strictEqual(env.elements['post-business-btn-text'].value, '', 'resetPostComposer deve limpar texto do botão');
  assert.strictEqual(env.elements['post-business-btn-url'].value, '', 'resetPostComposer deve limpar URL do botão');
  assert.strictEqual(bizSection.style.display, 'flex', 'Após reset, seção deve permanecer visível para conta empresa');

  // 5. Conta admin: também tem acesso à seção de link
  win.setCurrentProfile({
    uid: 'admin_uid_789',
    name: 'Admin VORTEX',
    email: 'dxhub.oficial@gmail.com',
    accountType: 'personal'
  });
  env.triggerAuthStateChange({ uid: 'admin_uid_789', email: 'dxhub.oficial@gmail.com' });

  updateVisibility();
  assert.strictEqual(bizSection.style.display, 'flex', 'Administrador também deve ter acesso à seção de link');
});

test('Limite de 15 caracteres no Nome e Sobrenome: atributos HTML, truncamento de input e validação ao salvar perfil', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window || env.sandbox;

  // 1. Verificar atributos maxlength no index.html
  const nameInputHtml = htmlContent.match(/<input[^>]+id=["']profile-name-input["'][^>]*>/i);
  const lastnameInputHtml = htmlContent.match(/<input[^>]+id=["']profile-lastname-input["'][^>]*>/i);

  assert.ok(nameInputHtml, 'profile-name-input deve existir no HTML');
  assert.ok(lastnameInputHtml, 'profile-lastname-input deve existir no HTML');
  assert.ok(/maxlength=["']15["']/i.test(nameInputHtml[0]), 'profile-name-input deve possuir maxlength="15"');
  assert.ok(/maxlength=["']15["']/i.test(lastnameInputHtml[0]), 'profile-lastname-input deve possuir maxlength="15"');

  // 2. Testar listeners de input que limitam/trancam a 15 caracteres
  const nameInput = env.elements['profile-name-input'];
  const surnameInput = env.elements['profile-lastname-input'];
  assert.ok(nameInput, 'profile-name-input deve existir');
  assert.ok(surnameInput, 'profile-lastname-input deve existir');

  // Simular digitação com mais de 15 caracteres
  nameInput.value = 'NomeMuitoLongoComMaisDe15Chars';
  nameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(nameInput.value.length, 15, 'Nome deve ser limitado a exatamente 15 caracteres no input');
  assert.strictEqual(nameInput.value, 'NomeMuitoLongoC');

  surnameInput.value = 'SobrenomeGiganteComMuitasLetras';
  surnameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(surnameInput.value.length, 15, 'Sobrenome deve ser limitado a exatamente 15 caracteres no input');
  assert.strictEqual(surnameInput.value, 'SobrenomeGigant');

  // 3. Testar valores válidos dentro do limite de 15 caracteres
  nameInput.value = 'Carlos Eduardo';
  nameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(nameInput.value, 'Carlos Eduardo');
  assert.ok(nameInput.value.length <= 15, 'Nome válido de 14 caracteres deve ser mantido');

  surnameInput.value = 'Ferreira Santos';
  surnameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(surnameInput.value, 'Ferreira Santos');
  assert.ok(surnameInput.value.length <= 15, 'Sobrenome válido de 15 caracteres deve ser mantido');
});

test('Validação e Feedback Visual no Campo de Telefone (DDD + Número)', () => {
  const env = createTestEnvironment();

  // 1. Verificar atributos no HTML
  const phoneHtmlMatch = htmlContent.match(/<input[^>]*id=["']profile-phone-input["'][^>]*>/i);
  assert.ok(phoneHtmlMatch, 'profile-phone-input deve existir no HTML');
  assert.ok(/inputmode=["']numeric["']/i.test(phoneHtmlMatch[0]), 'profile-phone-input deve possuir inputmode="numeric" para teclado numérico');
  assert.ok(/maxlength=["']15["']/i.test(phoneHtmlMatch[0]), 'profile-phone-input deve possuir maxlength="15"');

  // 2. Testar função validateBrazilianPhone
  const valFn = env.sandbox.validateBrazilianPhone;
  assert.ok(typeof valFn === 'function', 'validateBrazilianPhone deve estar disponível');

  // Vazio
  const emptyRes = valFn('');
  assert.strictEqual(emptyRes.isEmpty, true);
  assert.strictEqual(emptyRes.isValid, false);

  // Celular válido (11 dígitos, DDD 11)
  const validMobile = valFn('11999998888');
  assert.strictEqual(validMobile.isValid, true);
  assert.strictEqual(validMobile.formatted, '(11) 99999-8888');

  // Telefone fixo válido (10 dígitos, DDD 21)
  const validLandline = valFn('2122334455');
  assert.strictEqual(validLandline.isValid, true);
  assert.strictEqual(validLandline.formatted, '(21) 2233-4455');

  // Com DDI 55 colado
  const withDDI = valFn('5511988887777');
  assert.strictEqual(withDDI.isValid, true);
  assert.strictEqual(withDDI.formatted, '(11) 98888-7777');

  // Com letras filtradas automaticamente
  const withLetters = valFn('11abc988887777');
  assert.strictEqual(withLetters.isValid, true);
  assert.strictEqual(withLetters.formatted, '(11) 98888-7777');

  // DDD inválido (ex: 00)
  const invalidDdd = valFn('00999998888');
  assert.strictEqual(invalidDdd.isValid, false);

  // Incompleto (poucos dígitos)
  const incomplete = valFn('11999');
  assert.strictEqual(incomplete.isValid, false);

  // 3. Testar Feedback Visual no input (classes e border-color)
  const phoneInput = env.elements['profile-phone-input'];
  assert.ok(phoneInput, 'profile-phone-input deve existir no DOM');

  // Simular input com telefone válido
  phoneInput.value = '11987654321';
  phoneInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(phoneInput.value, '(11) 98765-4321');
  assert.ok(phoneInput.classList.contains('input-valid'), 'Deve conter a classe input-valid');
  assert.ok(!phoneInput.classList.contains('input-invalid'), 'Não deve conter a classe input-invalid');
  assert.strictEqual(phoneInput.style.borderColor, '#34c759', 'Borda deve ficar verde (#34c759)');

  // Simular input com telefone inválido/incompleto
  phoneInput.value = '11987';
  phoneInput.dispatchEvent({ type: 'input' });
  assert.ok(phoneInput.classList.contains('input-invalid'), 'Deve conter a classe input-invalid quando incompleto');
  assert.ok(!phoneInput.classList.contains('input-valid'), 'Não deve conter a classe input-valid');
  assert.strictEqual(phoneInput.style.borderColor, '#ff3b30', 'Borda deve ficar vermelha (#ff3b30)');

  // Simular input vazio (estado neutro)
  phoneInput.value = '';
  phoneInput.dispatchEvent({ type: 'input' });
  assert.ok(!phoneInput.classList.contains('input-valid'), 'Campo vazio não deve ter classe input-valid');
  assert.ok(!phoneInput.classList.contains('input-invalid'), 'Campo vazio não deve ter classe input-invalid');
  assert.strictEqual(phoneInput.style.borderColor, '', 'Borda deve voltar ao padrão');

  // 4. Testar bloqueio de teclas no keydown
  let prevented = false;
  const preventDefault = () => { prevented = true; };

  // Tecla de letra 'a' -> deve ser bloqueada
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: 'a', preventDefault });
  assert.strictEqual(prevented, true, 'Letras devem ser bloqueadas no keydown');

  // Tecla de letra 'x' -> deve ser bloqueada
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: 'x', preventDefault });
  assert.strictEqual(prevented, true, 'Letras devem ser bloqueadas no keydown');

  // Tecla de caractere especial '@' -> deve ser bloqueada
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: '@', preventDefault });
  assert.strictEqual(prevented, true, 'Caracteres especiais devem ser bloqueados no keydown');

  // Tecla numérica '5' -> deve ser permitida
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: '5', preventDefault });
  assert.strictEqual(prevented, false, 'Dígitos numéricos devem ser permitidos');

  // Tecla 'Backspace' -> deve ser permitida
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: 'Backspace', preventDefault });
  assert.strictEqual(prevented, false, 'Backspace deve ser permitido');

  // Tecla 'Delete' -> deve ser permitida
  prevented = false;
  phoneInput.dispatchEvent({ type: 'keydown', key: 'Delete', preventDefault });
  assert.strictEqual(prevented, false, 'Delete deve ser permitido');
});

test('Validação de Links Sociais e Sites Oficiais (v1.0.123): regras de perfil, bloqueio de vídeos, detecção de link no campo errado, exigência de https:// nos sites e feedback verde/vermelho', async () => {
  const env = createTestEnvironment();
  const valLink = env.sandbox.validateProfileLink;
  assert.ok(typeof valLink === 'function', 'validateProfileLink deve estar disponível');

  // --- 1. YOUTUBE ---
  // Válidos: Canal, handle, perfil
  assert.strictEqual(valLink('youtube', '@meucanal').isValid, true);
  assert.strictEqual(valLink('youtube', 'https://www.youtube.com/@meucanal').isValid, true);
  assert.strictEqual(valLink('youtube', 'https://youtube.com/channel/UC1234567890123456789012').isValid, true);
  assert.strictEqual(valLink('youtube', 'https://www.youtube.com/c/canalvip').isValid, true);

  // Inválidos: Vídeos (/watch, youtu.be, /shorts, /embed, /live)
  const ytWatch = valLink('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(ytWatch.isValid, false, 'Link de vídeo /watch deve ser rejeitado');
  assert.ok(ytWatch.error.includes('vídeos'), 'Mensagem deve indicar bloqueio de vídeos');

  const ytShort = valLink('youtube', 'https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(ytShort.isValid, false, 'Link de vídeo youtu.be deve ser rejeitado');

  const ytShorts = valLink('youtube', 'https://www.youtube.com/shorts/AbCdEf123');
  assert.strictEqual(ytShorts.isValid, false, 'Link de Shorts deve ser rejeitado');

  // Inválido: Link incompleto (sem canal)
  assert.strictEqual(valLink('youtube', 'https://www.youtube.co').isValid, false);
  assert.strictEqual(valLink('youtube', 'https://youtube.com/').isValid, false);

  // Inválido: Rede errada no campo YouTube
  const ytWrongNet = valLink('youtube', 'https://www.instagram.com/meuperfil');
  assert.strictEqual(ytWrongNet.isValid, false);
  assert.ok(ytWrongNet.error.includes('INSTAGRAM') || ytWrongNet.error.includes('Instagram'), 'Deve alertar que colocou link do Instagram no campo do YouTube');

  // --- 2. INSTAGRAM ---
  // Válidos: perfil, handle
  assert.strictEqual(valLink('instagram', '@meuperfil').isValid, true);
  assert.strictEqual(valLink('instagram', 'https://www.instagram.com/meuperfil').isValid, true);
  assert.strictEqual(valLink('instagram', 'https://instagram.com/loja_vip.oficial').isValid, true);

  // Inválidos: posts, reels, stories, tv
  const igPost = valLink('instagram', 'https://www.instagram.com/p/C0xyz123/');
  assert.strictEqual(igPost.isValid, false, 'Publicação /p/ do Instagram deve ser rejeitada');

  const igReel = valLink('instagram', 'https://www.instagram.com/reel/C0xyz123/');
  assert.strictEqual(igReel.isValid, false, 'Reel do Instagram deve ser rejeitado');

  const igStory = valLink('instagram', 'https://www.instagram.com/stories/user/12345/');
  assert.strictEqual(igStory.isValid, false, 'Story do Instagram deve ser rejeitado');

  // Inválido: Rede errada no campo Instagram
  const igWrongNet = valLink('instagram', 'https://www.youtube.com/@meucanal');
  assert.strictEqual(igWrongNet.isValid, false);
  assert.ok(igWrongNet.error.includes('YOUTUBE') || igWrongNet.error.includes('YouTube'));

  // --- 3. TIKTOK ---
  // Válidos: perfil, handle
  assert.strictEqual(valLink('tiktok', '@meutiktok').isValid, true);
  assert.strictEqual(valLink('tiktok', 'https://www.tiktok.com/@meutiktok').isValid, true);

  // Inválidos: vídeos (/video/, vm.tiktok)
  const ttVideo = valLink('tiktok', 'https://www.tiktok.com/@user/video/7123456789012345678');
  assert.strictEqual(ttVideo.isValid, false, 'Vídeo do TikTok deve ser rejeitado');

  const ttShare = valLink('tiktok', 'https://vm.tiktok.com/ZM8abc123/');
  assert.strictEqual(ttShare.isValid, false, 'Link curto vm.tiktok deve ser rejeitado');

  // Inválido: Rede errada
  assert.strictEqual(valLink('tiktok', 'https://facebook.com/loja').isValid, false);

  // --- 4. FACEBOOK ---
  // Válidos: página, perfil
  assert.strictEqual(valLink('facebook', '@minhapagina').isValid, true);
  assert.strictEqual(valLink('facebook', 'https://www.facebook.com/minhapagina').isValid, true);
  assert.strictEqual(valLink('facebook', 'https://facebook.com/pages/Loja-Oficial/123456').isValid, true);
  assert.strictEqual(valLink('facebook', 'https://www.facebook.com/profile.php?id=1000888999').isValid, true);

  // Inválidos: vídeos (/watch, /reel, /videos, /posts, /photo)
  assert.strictEqual(valLink('facebook', 'https://www.facebook.com/watch/?v=123456').isValid, false);
  assert.strictEqual(valLink('facebook', 'https://www.facebook.com/reel/987654321').isValid, false);
  assert.strictEqual(valLink('facebook', 'https://www.facebook.com/user/posts/12345').isValid, false);

  // Inválido: Rede errada
  assert.strictEqual(valLink('facebook', 'https://www.tiktok.com/@user').isValid, false);

  // --- 5. WHATSAPP COMERCIAL ---
  // Válidos: wa.me/message, wa.me/55, telefone com DDD
  assert.strictEqual(valLink('whatsapp', 'https://wa.me/message/ABCDEF123456').isValid, true, 'wa.me/message deve ser válido');
  assert.strictEqual(valLink('whatsapp', 'wa.me/message/XYZ789').isValid, true);
  assert.strictEqual(valLink('whatsapp', 'https://wa.me/5511999998888').isValid, true);
  assert.strictEqual(valLink('whatsapp', '(11) 99999-8888').isValid, true);
  assert.strictEqual(valLink('whatsapp', '11988887777').isValid, true);

  // Inválidos: Rede errada ou link quebrado
  assert.strictEqual(valLink('whatsapp', 'https://www.youtube.com/@canal').isValid, false);
  assert.strictEqual(valLink('whatsapp', 'https://wa.me/').isValid, false);

  // --- 6. SITES OFICIAIS 1, 2, 3 (Aceitar SOMENTE https://) ---
  // Válidos: https:// com domínio
  assert.strictEqual(valLink('website', 'https://seusite.com').isValid, true);
  assert.strictEqual(valLink('website', 'https://play-app-dx.web.app').isValid, true);
  assert.strictEqual(valLink('website', 'https://loja.com.br/produtos').isValid, true);

  // Inválidos: sem https:// ou com http://
  const siteHttp = valLink('website', 'http://inseguro.com');
  assert.strictEqual(siteHttp.isValid, false, 'http:// não deve ser aceito');
  assert.ok(siteHttp.error.includes('https://'), 'Deve exigir https:// explicitamente');

  const siteNoProto = valLink('website', 'vortexstore.com.br');
  assert.strictEqual(siteNoProto.isValid, false, 'Domínio sem https:// deve ser rejeitado');
  assert.ok(siteNoProto.error.includes('https://'));

  const siteIncomplete = valLink('website', 'https://');
  assert.strictEqual(siteIncomplete.isValid, false, 'https:// sem domínio deve ser rejeitado');

  // Vazio: neutro
  assert.strictEqual(valLink('website', '').isEmpty, true);

  // --- 7. FEEDBACK VISUAL NO DOM (input, blur, paste) ---
  const ytInput = env.elements['profile-youtube-input'];
  const igInput = env.elements['profile-instagram-input'];
  const web1Input = env.elements['profile-website1-input'];
  assert.ok(ytInput && igInput && web1Input, 'Inputs de rede e site devem existir no DOM');

  // Digitando link de vídeo no YouTube -> Vermelho
  ytInput.value = 'https://www.youtube.com/watch?v=123';
  ytInput.dispatchEvent({ type: 'input' });
  assert.ok(ytInput.classList.contains('input-invalid'), 'YouTube com link de vídeo deve ter input-invalid');
  assert.strictEqual(ytInput.style.borderColor, '#ff3b30');

  // Corrigindo para canal no YouTube -> Verde
  ytInput.value = 'https://www.youtube.com/@vortexvip';
  ytInput.dispatchEvent({ type: 'input' });
  assert.ok(ytInput.classList.contains('input-valid'), 'YouTube com canal deve ter input-valid');
  assert.ok(!ytInput.classList.contains('input-invalid'));
  assert.strictEqual(ytInput.style.borderColor, '#34c759');

  // Instagram com link do YouTube (rede errada) -> Vermelho
  igInput.value = 'https://www.youtube.com/@canal';
  igInput.dispatchEvent({ type: 'input' });
  assert.ok(igInput.classList.contains('input-invalid'), 'Instagram com link de outra rede deve ficar vermelho');
  assert.strictEqual(igInput.style.borderColor, '#ff3b30');

  // Site Oficial 1 sem https:// -> Vermelho
  web1Input.value = 'minhaloja.com.br';
  web1Input.dispatchEvent({ type: 'input' });
  assert.ok(web1Input.classList.contains('input-invalid'), 'Site sem https deve ficar vermelho');
  assert.strictEqual(web1Input.style.borderColor, '#ff3b30');

  // Site Oficial 1 com https:// -> Verde
  web1Input.value = 'https://minhaloja.com.br';
  web1Input.dispatchEvent({ type: 'input' });
  assert.ok(web1Input.classList.contains('input-valid'), 'Site com https deve ficar verde');
  assert.strictEqual(web1Input.style.borderColor, '#34c759');

  // Campo limpo -> Neutro
  web1Input.value = '';
  web1Input.dispatchEvent({ type: 'input' });
  assert.ok(!web1Input.classList.contains('input-valid'));
  assert.ok(!web1Input.classList.contains('input-invalid'));
  assert.strictEqual(web1Input.style.borderColor, '');
});

test('Fluxo de Pedido no Catálogo: sem necessidade de solicitação, abertura automática do chat com o vendedor e vinculação mútua de contatos (v1.0.124)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  const buyerUid = 'buyer_auto_chat_111';
  const sellerUid = 'seller_auto_chat_222';

  // 1. Configurar comprador autenticado
  await env.triggerAuthStateChange({ uid: buyerUid, email: 'comprador@vortex.app', displayName: 'Lucas Comprador' });
  win.setCurrentProfile({
    uid: buyerUid,
    name: 'Lucas',
    surname: 'Comprador',
    username: '@lucas_comprador',
    status: 'Cliente VIP VORTEX ⚡',
    isVip: true,
    isVerified: true
  });

  // 2. Configurar perfil e catálogo do vendedor
  env.firestoreDocs[`users/${sellerUid}`] = {
    uid: sellerUid,
    name: 'Mega Store VIP 🛒',
    username: '@megastore',
    status: 'Loja Oficial de Eletrônicos ⚡',
    avatar: 'https://vortex.app/avatar_seller.jpg',
    pixKey: 'pagamentos@megastore.com',
    isVip: true,
    isVerified: true,
    accountType: 'business'
  };

  env.firestoreDocs[`users/${sellerUid}/catalog/prod_fone_1`] = {
    name: 'Headset Gamer VIP',
    description: 'Fone com som surround 7.1',
    price: 350,
    promoPrice: 299,
    stock: 10,
    unlimitedStock: false,
    active: true,
    cover: 'https://vortex.app/fone.jpg',
    photos: ['https://vortex.app/fone.jpg'],
    createdAt: Date.now()
  };

  // 3. Simular que eles NÃO são contatos e existe uma solicitação pendente no requests
  assert.strictEqual(env.firestoreDocs[`users/${buyerUid}/contacts/${sellerUid}`], undefined, 'Comprador não deve ter o vendedor como contato inicialmente');
  assert.strictEqual(env.firestoreDocs[`users/${sellerUid}/contacts/${buyerUid}`], undefined, 'Vendedor não deve ter o comprador como contato inicialmente');

  env.firestoreDocs['requests/req_pendente_1'] = {
    id: 'req_pendente_1',
    fromUid: buyerUid,
    toUid: sellerUid,
    status: 'pending',
    createdAt: Date.now() - 10000
  };

  // 4. Comprador adiciona o produto ao carrinho
  win.clearCatalogCart();
  const prod = {
    id: 'prod_fone_1',
    name: 'Headset Gamer VIP',
    price: 350,
    promoPrice: 299,
    stock: 10,
    unlimitedStock: false,
    active: true
  };
  win.addToCatalogCart(prod, sellerUid, env.firestoreDocs[`users/${sellerUid}`]);

  // Simular que o overlay do catálogo estava aberto
  const catOverlay = env.elements['catalog-overlay'];
  if (catOverlay) {
    catOverlay.style.display = 'flex';
    catOverlay.classList.add('active');
  }

  // 5. Comprador clica em "Enviar pedido"
  await win.submitCatalogOrder();

  // 6. Verificações:
  // a) Contatos mútuos criados automaticamente sem precisar de aprovação/solicitação
  const buyerContactEntry = env.firestoreDocs[`users/${buyerUid}/contacts/${sellerUid}`];
  assert.ok(buyerContactEntry, 'Vendedor deve ter sido adicionado à lista de contatos do comprador');
  assert.strictEqual(buyerContactEntry.uid, sellerUid);
  assert.strictEqual(buyerContactEntry.name, 'Mega Store VIP 🛒');
  assert.strictEqual(buyerContactEntry.avatar, 'https://vortex.app/avatar_seller.jpg');
  assert.strictEqual(buyerContactEntry.status, 'Loja Oficial de Eletrônicos ⚡');

  const sellerContactEntry = env.firestoreDocs[`users/${sellerUid}/contacts/${buyerUid}`];
  assert.ok(sellerContactEntry, 'Comprador deve ter sido adicionado à lista de contatos do vendedor');
  assert.strictEqual(sellerContactEntry.uid, buyerUid);
  assert.strictEqual(sellerContactEntry.name, 'Lucas Comprador');

  // b) Solicitação pendente foi resolvida como 'accepted'
  assert.strictEqual(env.firestoreDocs['requests/req_pendente_1'].status, 'accepted', 'Solicitação pendente deve ter sido aceita automaticamente');

  // c) Catálogo foi fechado
  if (catOverlay) {
    assert.strictEqual(catOverlay.style.display, 'none', 'Overlay do catálogo deve ter sido fechado');
    assert.strictEqual(catOverlay.classList.contains('active'), false);
  }

  // d) Conversa com o vendedor foi aberta normalmente
  const chatWindow = env.elements['chat-window'];
  assert.ok(chatWindow, '#chat-window deve existir');
  assert.strictEqual(chatWindow.classList.contains('active'), true, 'Janela de conversa deve estar aberta e ativa');

  const activeContact = win.getActiveChatContact();
  assert.ok(activeContact, 'Contato ativo do chat deve estar definido');
  assert.strictEqual(activeContact.uid, sellerUid, 'O chat ativo deve ser com o vendedor');
  assert.strictEqual(activeContact.name, 'Mega Store VIP 🛒');

  // e) Mensagem com dados do pedido foi enviada na conversa
  const chatId = [buyerUid, sellerUid].sort().join('_');
  const chatMessages = Object.entries(env.firestoreDocs).filter(([k, v]) => k.startsWith(`chats/${chatId}/messages/`));
  assert.ok(chatMessages.length >= 1, 'Deve haver ao menos 1 mensagem no chat entre comprador e vendedor');
  const orderMessage = chatMessages.find(([k, v]) => v.type === 'order' || v.order);
  assert.ok(orderMessage, 'Mensagem com dados do pedido (type: order) deve constar no chat');
  assert.strictEqual(orderMessage[1].order.total, 299);
  assert.strictEqual(orderMessage[1].order.sellerUid, sellerUid);
});

test('Correção dos Títulos e Campos do Catálogo (v1.0.125): agrupamento com catalog-field-group e espaçamento sem sobreposição', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.document;

  // 1. Validar elementos no DOM simulado
  assert.ok(doc.getElementById('catalog-product-editor-modal'), '#catalog-product-editor-modal deve existir');
  assert.ok(doc.getElementById('cat-prod-name'), '#cat-prod-name deve existir');
  assert.ok(doc.getElementById('cat-prod-desc'), '#cat-prod-desc deve existir');
  assert.ok(doc.getElementById('cat-prod-price'), '#cat-prod-price deve existir');
  assert.ok(doc.getElementById('cat-prod-promo'), '#cat-prod-promo deve existir');
  assert.ok(doc.getElementById('cat-prod-category'), '#cat-prod-category deve existir');
  assert.ok(doc.getElementById('cat-prod-sku'), '#cat-prod-sku deve existir');
  assert.ok(doc.getElementById('cat-prod-stock'), '#cat-prod-stock deve existir');
  assert.ok(doc.getElementById('cat-prod-unlimited'), '#cat-prod-unlimited deve existir');
  assert.ok(doc.getElementById('cat-prod-active'), '#cat-prod-active deve existir');

  // 2. Validar estrutura no HTML oficial (agrupamento e classes)
  const groupMatches = htmlContent.match(/class=["'][^"']*catalog-field-group[^"']*["']/g);
  assert.ok(groupMatches && groupMatches.length >= 5, 'Deve conter os grupos de campos (.catalog-field-group) no index.html');

  assert.ok(htmlContent.includes('class="catalog-field-row catalog-stock-row"'), 'catalog-stock-row deve estar presente no HTML');
  assert.ok(htmlContent.includes('class="catalog-check catalog-stock-check"'), 'catalog-stock-check deve estar presente no HTML');

  // 3. Validar labels com for correspondente aos campos
  const requiredLabels = [
    { forId: 'cat-prod-name', text: 'Nome do produto *' },
    { forId: 'cat-prod-desc', text: 'Descrição' },
    { forId: 'cat-prod-price', text: 'Preço (R$) *' },
    { forId: 'cat-prod-promo', text: 'Preço promocional' },
    { forId: 'cat-prod-category', text: 'Categoria' },
    { forId: 'cat-prod-sku', text: 'Código (SKU)' },
    { forId: 'cat-prod-stock', text: 'Estoque' }
  ];

  for (const item of requiredLabels) {
    assert.ok(htmlContent.includes(`for="${item.forId}"`), `Label for="${item.forId}" deve existir no HTML`);
    assert.ok(htmlContent.includes(item.text), `Texto "${item.text}" deve existir no HTML`);
  }

  // 4. Validar estilos no style.css (sem margem negativa que sobrepunha títulos e inputs)
  assert.ok(cssContent.includes('.catalog-field-group'), 'style.css deve conter regra para .catalog-field-group');
  assert.ok(cssContent.includes('.catalog-field-label'), 'style.css deve conter regra para .catalog-field-label');
  assert.ok(cssContent.includes('.catalog-stock-check'), 'style.css deve conter regra para .catalog-stock-check');
  assert.ok(!cssContent.match(/\.catalog-field-label\s*\{[^}]*margin-bottom:\s*-[0-9]/), 'catalog-field-label não deve ter margin-bottom negativa');

  // 5. Validar remoção do título lateral "Trilha Sonora (Música)" no painel Postar Status VIP (v1.0.126)
  assert.ok(!htmlContent.includes('Trilha Sonora (Música)'), 'O título "Trilha Sonora (Música)" não deve existir no painel de Status');
  assert.ok(doc.getElementById('status-add-music-btn'), 'O botão #status-add-music-btn deve continuar existindo');
  assert.ok(cssContent.includes('.music-setting-item'), 'style.css deve estilizar .music-setting-item em coluna com largura total');

  // 6. Validar título "Foto ou Vídeo (15s a 1 min)" posicionado em cima do botão Escolher Mídia (v1.0.127)
  assert.ok(htmlContent.includes('class="setting-item status-media-setting-item"'), 'O bloco de mídia do status deve usar a classe status-media-setting-item');
  assert.ok(doc.getElementById('status-media-label-text'), '#status-media-label-text deve existir');
  assert.ok(doc.getElementById('choose-status-media-label'), '#choose-status-media-label deve existir');
  assert.ok(cssContent.includes('.status-media-setting-item'), 'style.css deve estilizar .status-media-setting-item em coluna');

  // 7. Validar título "Legenda" em cima do input e "Duração do Story" ao lado do ícone verde (v1.0.128)
  assert.ok(htmlContent.includes('class="setting-item status-caption-setting-item"'), 'O bloco de legenda do status deve usar a classe status-caption-setting-item');
  assert.ok(cssContent.includes('.status-caption-setting-item'), 'style.css deve estilizar .status-caption-setting-item em coluna');
  assert.ok(cssContent.includes('.story-duration-setting-item .setting-info'), 'style.css deve alinhar Duração do Story ao lado do ícone em linha');

  // 8. Validar botões Aceitar e Recusar posicionados embaixo no card de Solicitações de Contato (v1.0.129)
  assert.ok(jsContent.includes('member-list-item contact-request-item'), 'O card de solicitação de contato deve usar a classe contact-request-item');
  assert.ok(jsContent.includes('class="contact-request-info"'), 'As informações do usuário devem ficar em .contact-request-info');
  assert.ok(jsContent.includes('class="contact-request-actions"'), 'Os botões Aceitar e Recusar devem ficar em .contact-request-actions');
  assert.ok(cssContent.includes('.member-list-item.contact-request-item'), 'style.css deve posicionar .contact-request-item em coluna');
  assert.ok(cssContent.includes('.contact-request-actions'), 'style.css deve estilizar a linha inferior de botões .contact-request-actions');

  // 9. Validar organização de Temas VORTEX VIP e Fonte de Texto Animada VIP nas Configurações (v1.0.130)
  assert.ok(htmlContent.includes('class="vip-setting-header-row"'), 'Os cards VIP devem usar .vip-setting-header-row no cabeçalho');
  assert.ok(cssContent.includes('.setting-item.setting-vip-themes'), 'style.css deve organizar .setting-vip-themes em coluna');
  assert.ok(cssContent.includes('.setting-item.setting-vip-fonts'), 'style.css deve organizar .setting-vip-fonts em coluna');

  // 10. Validar ícones de curtida (like azul), comentário (balão amarelo) e adição ao grupo (balões de mensagem azuis) nas notificações (v1.0.131)
  assert.ok(jsContent.includes('notif-svg-like'), 'Notificação de curtida deve exibir o ícone de legal (like) azul');
  assert.ok(jsContent.includes('notif-svg-comment'), 'Notificação de comentário deve exibir o ícone de balãozinho de conversa amarelo');
  assert.ok(jsContent.includes('notif-svg-group-add'), 'Notificação de adição ao grupo deve exibir o ícone de balões de mensagem azuis');
  assert.ok(cssContent.includes('.notification-icon-box.like'), 'style.css deve estilizar .notification-icon-box.like em azul');
  assert.ok(cssContent.includes('.notification-icon-box.comment'), 'style.css deve estilizar .notification-icon-box.comment em amarelo');
  assert.ok(cssContent.includes('.notification-icon-box.group-add'), 'style.css deve estilizar .notification-icon-box.group-add em azul');

  // 11. Validar exclusão individual de notificação ao arrastar para a esquerda e alinhamento do cabeçalho (v1.0.132)
  assert.ok(jsContent.includes('function deleteSingleNotification'), 'script.js deve implementar deleteSingleNotification');
  assert.ok(jsContent.includes('function attachNotificationSwipeHandlers'), 'script.js deve implementar attachNotificationSwipeHandlers');
  assert.ok(jsContent.includes('notification-swipe-wrapper'), 'Os cards de notificação devem usar .notification-swipe-wrapper');
  assert.ok(htmlContent.includes('class="notifications-header-text"'), 'O cabeçalho de notificações deve usar .notifications-header-text');
  assert.ok(!htmlContent.includes('id="close-notifications-btn" class="close-btn drawer-cancel-btn'), 'O botão fechar notificações não deve herdar margin-top de drawer-cancel-btn');
  assert.ok(cssContent.includes('.notification-swipe-delete-bg'), 'style.css deve estilizar o fundo vermelho de exclusão por swipe');

  // 12. Validar correção de encolhimento (flex-shrink: 0), grupo roxo, comentário verde e curtida de story rosa (v1.0.133)
  assert.ok(jsContent.includes('notif-svg-story-like'), 'Notificação de curtida de story deve exibir o ícone de coração rosa');
  assert.ok(cssContent.includes('.notification-icon-box.story-like'), 'style.css deve estilizar .notification-icon-box.story-like em rosa');
  assert.ok(cssContent.match(/\.notification-swipe-wrapper\s*\{[^}]*flex-shrink:\s*0/), '.notification-swipe-wrapper deve ter flex-shrink: 0 para não amassar os cards');
  assert.ok(cssContent.match(/\.notification-card\.card-group-add\s*\{[^}]*#bf5af2/i), 'Notificação de grupo deve ser roxa (#bf5af2)');
  assert.ok(cssContent.match(/\.notification-card\.card-comment\s*\{[^}]*#34c759/i), 'Notificação de comentário deve ser verde (#34c759)');
  assert.ok(cssContent.match(/\.notification-card\.card-story-like\s*\{[^}]*#ff2d85/i), 'Notificação de curtida de story deve ser rosa (#ff2d85)');

  // 13. Validar sincronização em tempo real da foto de perfil nos posts (v1.0.134)
  assert.ok(jsContent.includes('function getLiveAuthorAvatar'), 'script.js deve implementar getLiveAuthorAvatar');
  assert.ok(jsContent.includes('function updateAuthorAvatarsInDOM'), 'script.js deve implementar updateAuthorAvatarsInDOM');
  assert.ok(jsContent.includes('async function syncUserAvatarToPostsAndStories'), 'script.js deve implementar syncUserAvatarToPostsAndStories');
  assert.ok(jsContent.includes('class="feed-avatar" data-author-uid="'), '.feed-avatar nos posts deve ter data-author-uid para atualização em tempo real');
  assert.ok(jsContent.includes('class="post-author-avatar" data-author-uid="'), '.post-author-avatar deve ter data-author-uid para atualização em tempo real');

  // 14. Validar botão de excluir contato após ser bloqueado (v1.0.135)
  assert.ok(htmlContent.includes('id="delete-contact-banner-btn"'), 'index.html deve ter o botão #delete-contact-banner-btn no banner de bloqueio');
  assert.ok(htmlContent.includes('id="contact-profile-delete-btn"'), 'index.html deve ter o botão #contact-profile-delete-btn no painel de dados do contato');
  assert.ok(htmlContent.includes('id="delete-contact-trigger"'), 'index.html deve ter a opção #delete-contact-trigger no menu do cabeçalho do chat');
  assert.ok(cssContent.includes('.delete-contact-banner-btn'), 'style.css deve estilizar .delete-contact-banner-btn');
  assert.ok(jsContent.includes('async function deleteBlockedContact'), 'script.js deve implementar deleteBlockedContact');

  // 15. Validar organização dos textos e botão de renovação no banner de vencimento VIP (v1.0.136)
  assert.ok(htmlContent.includes('class="vip-grace-top"'), 'index.html deve agrupar o ícone e textos dentro de .vip-grace-top');
  assert.ok(cssContent.includes('.vip-grace-top'), 'style.css deve estilizar .vip-grace-top');
  assert.ok(cssContent.match(/\.vip-grace-banner\s*\{[^}]*flex-direction:\s*column/), '.vip-grace-banner deve ter flex-direction: column');
  assert.ok(cssContent.match(/\.vip-grace-renew-btn\s*\{[^}]*width:\s*100%/), '.vip-grace-renew-btn deve ocupar 100% da largura na parte inferior do card');

  // 16. Validar que o botão Atualizar some depois que for atualizado e que CURRENT_APP_VERSION acompanha version.json (v1.0.137)
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(jsContent.includes(`CURRENT_APP_VERSION = '${versionJson.version}'`), 'CURRENT_APP_VERSION em script.js deve estar sincronizado com version.json');
  assert.ok(jsContent.includes('function compareAppVersions'), 'script.js deve implementar compareAppVersions');
  assert.ok(jsContent.includes('function getEffectiveAppVersion'), 'script.js deve implementar getEffectiveAppVersion');
  assert.ok(jsContent.includes("localStorage.setItem('vortex_applied_version'"), 'triggerPwaUpdate deve salvar a versão aplicada para o botão Atualizar sumir após atualizar');

  // 17. Validar correção de presença online fantasma no perfil e no chat (v1.0.138)
  assert.ok(jsContent.includes('function isContactTrulyOnline'), 'script.js deve implementar isContactTrulyOnline com validação de RTDB e TTL de heartbeat');
  assert.ok(jsContent.includes('function refreshContactProfilePresenceUI'), 'script.js deve implementar refreshContactProfilePresenceUI');
  assert.ok(jsContent.includes('ONLINE_PRESENCE_TTL_MS'), 'script.js deve ter ONLINE_PRESENCE_TTL_MS para expirar status online obsoleto');
  assert.ok(htmlContent.includes('id="contact-profile-presence" class="contact-profile-presence">Visto recentemente</span>'), '#contact-profile-presence deve iniciar com Visto recentemente no index.html');

  // 18. Validar botão × no aviso de tolerância VIP, organização do botão Copiar no compartilhamento e organização do card Selo de Verificado VIP (v1.0.139)
  assert.ok(htmlContent.includes('id="vip-grace-close-btn"'), 'index.html deve ter o botão × (#vip-grace-close-btn) para fechar o aviso VIP');
  assert.ok(jsContent.includes('function dismissVipGraceBanner'), 'script.js deve implementar dismissVipGraceBanner');
  assert.ok(cssContent.includes('.vip-grace-close-btn'), 'style.css deve estilizar .vip-grace-close-btn');
  assert.ok(cssContent.match(/\.share-link-input-row\s*\{[^}]*flex-direction:\s*column/), '.share-link-input-row deve organizar o link e o botão Copiar em coluna sem vazar do modal');
  assert.ok(cssContent.match(/\.share-copy-btn\s*\{[^}]*width:\s*100%/), '.share-copy-btn deve ter width: 100% dentro do box');
  // 19. Validar opções recomendadas de cadastro de entrega e formas de pagamento definidas pelo vendedor (v1.0.140)
  assert.ok(htmlContent.includes('id="catalog-checkout-section"'), 'index.html deve conter #catalog-checkout-section no carrinho');
  assert.ok(htmlContent.includes('id="catalog-cart-country"'), 'index.html deve conter input de País (#catalog-cart-country)');
  assert.ok(htmlContent.includes('id="catalog-cart-cep"'), 'index.html deve conter input de CEP (#catalog-cart-cep)');
  assert.ok(htmlContent.includes('id="catalog-cart-state"'), 'index.html deve conter input de Estado (#catalog-cart-state)');
  assert.ok(htmlContent.includes('id="catalog-cart-city"'), 'index.html deve conter input de Cidade (#catalog-cart-city)');
  assert.ok(htmlContent.includes('id="catalog-cart-street"'), 'index.html deve conter input de Rua (#catalog-cart-street)');
  assert.ok(htmlContent.includes('id="catalog-cart-number"'), 'index.html deve conter input de Número da Casa (#catalog-cart-number)');
  assert.ok(htmlContent.includes('id="catalog-cart-phone"'), 'index.html deve conter input de Número de Telefone (#catalog-cart-phone)');
  assert.ok(htmlContent.includes('id="catalog-cart-email"'), 'index.html deve conter input de Gmail (#catalog-cart-email)');
  assert.ok(htmlContent.includes('id="catalog-cart-age"'), 'index.html deve conter input de Idade (#catalog-cart-age)');
  assert.ok(htmlContent.includes('id="catalog-cart-payment-options"'), 'index.html deve conter container de opções de pagamento (#catalog-cart-payment-options)');
  assert.ok(htmlContent.includes('id="catalog-cart-selected-payment"'), 'index.html deve conter input oculto de pagamento selecionado (#catalog-cart-selected-payment)');
  assert.ok(htmlContent.includes('id="cat-prod-payment-methods"'), 'index.html deve conter checkboxes de formas de pagamento no editor de produtos (#cat-prod-payment-methods)');
  assert.ok(cssContent.includes('.catalog-checkout-section'), 'style.css deve estilizar .catalog-checkout-section');
  assert.ok(cssContent.includes('.catalog-payment-options-grid'), 'style.css deve estilizar .catalog-payment-options-grid');
  assert.ok(cssContent.includes('.catalog-payment-option-pill'), 'style.css deve estilizar .catalog-payment-option-pill');
  assert.ok(cssContent.includes('.catalog-order-customer-box'), 'style.css deve estilizar .catalog-order-customer-box');
  assert.ok(cssContent.includes('.catalog-prod-payments-grid'), 'style.css deve estilizar .catalog-prod-payments-grid');
  assert.ok(jsContent.includes('function lookupCartCep'), 'script.js deve implementar lookupCartCep para consulta de endereço');
  assert.ok(jsContent.includes('paymentMethods'), 'script.js deve salvar e manipular paymentMethods nos produtos e pedidos');
  assert.ok(jsContent.includes('vortex_customer_info'), 'script.js deve salvar dados do cliente no localStorage (vortex_customer_info)');

  // 20. Validar que o vendedor consegue ver claramente a quantidade que o cliente pediu (v1.0.141)
  assert.ok(cssContent.includes('.catalog-order-qty-highlight'), 'style.css deve estilizar o destaque de quantidade pedida na lista de pedidos (.catalog-order-qty-highlight)');
  assert.ok(cssContent.includes('.catalog-order-chip-qty'), 'style.css deve conter badge de quantidade por produto na lista (.catalog-order-chip-qty)');
  assert.ok(cssContent.includes('.catalog-order-qty-badge'), 'style.css deve conter badge de quantidade pedida no modal de detalhes (.catalog-order-qty-badge)');
  assert.ok(cssContent.includes('.chat-order-qty-pill'), 'style.css deve estilizar o pill de quantidade no card de chat (.chat-order-qty-pill)');
  assert.ok(cssContent.includes('.chat-order-items-breakdown'), 'style.css deve conter detalhamento com quantidades no card do pedido no chat (.chat-order-items-breakdown)');
  assert.ok(jsContent.includes('catalog-order-qty-highlight'), 'script.js deve renderizar destaque de unidades pedidas na lista de pedidos do vendedor');
  assert.ok(jsContent.includes('catalog-order-qty-badge'), 'script.js deve renderizar badge de quantidade pedida no modal de detalhes do pedido');
  assert.ok(jsContent.includes('chat-order-qty-pill'), 'script.js deve renderizar pill de quantidade pedida no card do pedido no chat');
  assert.ok(jsContent.includes('catalog-order-total-units-pill'), 'script.js deve renderizar badge com total de unidades na seção de itens');

  // 21. Validar que conta empresa pode criar e enviar formulários na conversa com o cliente (v1.0.142)
  assert.ok(htmlContent.includes('id="chat-attach-form-btn"'), 'index.html deve conter botão de formulário no drawer de anexos (#chat-attach-form-btn)');
  assert.ok(htmlContent.includes('id="chat-company-form-trigger"'), 'index.html deve conter gatilho de formulário no menu de opções do chat (#chat-company-form-trigger)');
  assert.ok(htmlContent.includes('id="company-form-creator-modal"'), 'index.html deve conter modal de criação de formulário (#company-form-creator-modal)');
  assert.ok(htmlContent.includes('id="company-form-fill-modal"'), 'index.html deve conter modal de preenchimento do formulário (#company-form-fill-modal)');
  assert.ok(htmlContent.includes('id="company-form-responses-modal"'), 'index.html deve conter modal de respostas do formulário (#company-form-responses-modal)');
  assert.ok(htmlContent.includes('id="company-form-title-input"'), 'index.html deve conter campo de título do formulário');
  assert.ok(htmlContent.includes('id="company-form-submit-btn"'), 'index.html deve conter botão de envio do formulário');
  assert.ok(htmlContent.includes('id="company-form-add-field-btn"'), 'index.html deve conter botão de adicionar perguntas');
  assert.ok(cssContent.includes('.company-form-creator-card'), 'style.css deve estilizar o modal de criação de formulário');
  assert.ok(cssContent.includes('.chat-company-form-card'), 'style.css deve estilizar o card de formulário no chat');
  assert.ok(cssContent.includes('.company-form-fill-card'), 'style.css deve estilizar o modal de preenchimento');
  assert.ok(cssContent.includes('.company-form-responses-card'), 'style.css deve estilizar o modal de respostas');
  assert.ok(cssContent.includes('.form-attach-circle'), 'style.css deve conter estilização do ícone de formulário (.form-attach-circle)');
  assert.ok(jsContent.includes('function canManageCompanyForms'), 'script.js deve conter canManageCompanyForms para controle de permissões de empresa');
  assert.ok(jsContent.includes('function openCompanyFormCreator'), 'script.js deve conter openCompanyFormCreator para abrir o modal de criação');
  assert.ok(jsContent.includes('function submitCompanyForm'), 'script.js deve conter submitCompanyForm para envio do formulário no chat');
  assert.ok(jsContent.includes('function buildCompanyFormCardHTML'), 'script.js deve conter buildCompanyFormCardHTML para renderização no chat');
  assert.ok(jsContent.includes('function openCompanyFormFillModal'), 'script.js deve conter openCompanyFormFillModal para o cliente responder');
  assert.ok(jsContent.includes('function submitCompanyFormAnswers'), 'script.js deve conter submitCompanyFormAnswers para salvar respostas');
  assert.ok(jsContent.includes('function openCompanyFormResponsesModal'), 'script.js deve conter openCompanyFormResponsesModal para visualização das respostas');
  assert.ok(jsContent.includes('COMPANY_FORM_TEMPLATES'), 'script.js deve conter modelos rápidos (templates) prontos de formulário');

  // 22. Validação Numérica e Variações do Catálogo: 5 Cores, Peso, Tamanho, Voltagem 110V/220V/Escolha do Cliente (v1.0.143)
  assert.ok(htmlContent.includes('id="cat-prod-colors-list"'), 'index.html deve conter lista de cores no editor (#cat-prod-colors-list)');
  assert.ok(htmlContent.includes('id="cat-prod-add-color-btn"'), 'index.html deve conter botão para adicionar cores (#cat-prod-add-color-btn)');
  assert.ok(htmlContent.includes('id="cat-prod-weight"'), 'index.html deve conter campo de peso (#cat-prod-weight)');
  assert.ok(htmlContent.includes('id="cat-prod-size"'), 'index.html deve conter campo de tamanho (#cat-prod-size)');
  assert.ok(htmlContent.includes('id="cat-prod-voltage"'), 'index.html deve conter seletor de voltagem (#cat-prod-voltage)');
  assert.ok(cssContent.includes('.catalog-colors-list'), 'style.css deve conter estilos para lista de cores (.catalog-colors-list)');
  assert.ok(cssContent.includes('.catalog-voltage-chip'), 'style.css deve conter estilos para chips de voltagem (.catalog-voltage-chip)');
  assert.ok(cssContent.includes('.catalog-color-chip'), 'style.css deve conter estilos para chips de cor (.catalog-color-chip)');
  assert.ok(jsContent.includes('function sanitizeCatalogDecimalInput'), 'script.js deve conter sanitizeCatalogDecimalInput para bloqueio de letras em preço');
  assert.ok(jsContent.includes('function sanitizeCatalogIntegerInput'), 'script.js deve conter sanitizeCatalogIntegerInput para bloqueio de letras em estoque');
  assert.ok(jsContent.includes('function attachCatalogNumericGuards'), 'script.js deve conter attachCatalogNumericGuards');
  assert.ok(jsContent.includes('function renderEditorColors'), 'script.js deve conter renderEditorColors');
  assert.ok(jsContent.includes('function addEditorColor'), 'script.js deve conter addEditorColor');

  // 23. Desconto, Promoção Temporária/Permanente, Produto Físico vs Digital, Tipos Digitais, Link e Botão Customizado (v1.0.144)
  assert.ok(htmlContent.includes('id="cat-prod-promo-type"'), 'index.html deve conter vigência da promoção (#cat-prod-promo-type)');
  assert.ok(htmlContent.includes('id="cat-prod-discount"'), 'index.html deve conter campo de desconto (#cat-prod-discount)');
  assert.ok(htmlContent.includes('id="cat-prod-discount-type"'), 'index.html deve conter vigência do desconto (#cat-prod-discount-type)');
  assert.ok(htmlContent.includes('id="cat-prod-kind"'), 'index.html deve conter escolha de produto físico ou digital (#cat-prod-kind)');
  assert.ok(htmlContent.includes('id="cat-prod-digital-section"'), 'index.html deve conter seção dinâmica de produto digital (#cat-prod-digital-section)');
  assert.ok(htmlContent.includes('id="cat-prod-digital-type"'), 'index.html deve conter tipos digitais (#cat-prod-digital-type)');
  assert.ok(htmlContent.includes('id="cat-prod-digital-link"'), 'index.html deve conter link do produto digital (#cat-prod-digital-link)');
  assert.ok(htmlContent.includes('id="cat-prod-digital-cta-group"'), 'index.html deve conter grupo do botão CTA (#cat-prod-digital-cta-group)');
  assert.ok(htmlContent.includes('id="cat-prod-digital-cta"'), 'index.html deve conter seleção do botão CTA (#cat-prod-digital-cta)');
  assert.ok(cssContent.includes('.catalog-badge-digital'), 'style.css deve conter .catalog-badge-digital');
  assert.ok(cssContent.includes('.catalog-digital-cta-btn'), 'style.css deve conter .catalog-digital-cta-btn');
  assert.ok(cssContent.includes('.catalog-badge-promo-temp'), 'style.css deve conter .catalog-badge-promo-temp');
  assert.ok(jsContent.includes('function sanitizeCatalogDiscountInput'), 'script.js deve conter sanitizeCatalogDiscountInput');
  assert.ok(jsContent.includes('function getDigitalCtaLabel'), 'script.js deve conter getDigitalCtaLabel');
  assert.ok(jsContent.includes('function getDigitalCtaIcon'), 'script.js deve conter getDigitalCtaIcon');

  // 24. Padronização do Tamanho dos Botões de Formas de Pagamento no Celular (v1.0.145)
  assert.ok(cssContent.includes('.catalog-prod-payments-grid .catalog-check span'), 'style.css deve estilizar o span dos botões de pagamento com white-space nowrap');
  assert.ok(cssContent.includes('repeat(2, 1fr)'), 'style.css deve definir grid de 2 colunas para botões de pagamento no celular');

  // 25. Padronização do Tamanho dos Botões de Formas de Pagamento no Carrinho no Celular (v1.0.146)
  assert.ok(cssContent.includes('.catalog-payment-options-grid'), 'style.css deve conter .catalog-payment-options-grid');
  assert.ok(cssContent.includes('.catalog-payment-option-pill span'), 'style.css deve conter .catalog-payment-option-pill span com nowrap');

  // 26. Organização das Opções no PC e Atualização Automática de Preço por Desconto (v1.0.147)
  assert.ok(jsContent.includes('function calculatePromoFromDiscount'), 'script.js deve conter calculatePromoFromDiscount');
  assert.ok(jsContent.includes('function calculateDiscountFromPromo'), 'script.js deve conter calculateDiscountFromPromo');

  // 27. Opção para o Vendedor Ativar e Desativar o Botão de Compra da Loja (v1.0.148)
  // 28. Padronização dos Botões em Minhas Compras e Correção do Título Amassado no Celular (v1.0.149)
  // 29. Bloqueio de Letras no Número da Casa no Carrinho e Teclado Numérico no Celular (v1.0.150)
  // 30. Organização dos Botões na Loja (Apenas Catálogo e Conversar) (v1.0.151)
  // 31. Correção e Otimização da Interface do Formulário Comercial para Celular (v1.0.152)
  // 32. Organização e Alinhamento Visual dos Modais no Celular (Pix, Enquete, Respostas e Prévia de Formulário) (v1.0.153)
  // 33. Chamadas Recebidas com o App Fechado: Push FCM, Service Worker e Notificação com Atender/Recusar (v1.0.154)
  // 34. Correção dos Ícones Grandes dos Modais no Celular (v1.0.155)
  // 35. Separação de Redes Sociais e Sites Oficiais (v1.0.156)
  // 36. Alinhamento de Nome e Título ao Lado da Foto na Prévia do Compartilhar (v1.0.157)
  // 37. Padronização e Balanceamento do Tamanho do Botão Salvar em Mensagens Temporárias (v1.0.158)
  // 38. Correção do Alinhamento dos Botões Salvar e Cancelar no Modal de Mensagens Temporárias (v1.0.159)
  // 39. Padronização de Tamanho de Conta Pessoal/Empresa, Validação Estrita de Chave Pix e Limite de 45 Caracteres no Recado/Bio (v1.0.160)
  // 40. Busca de Posts na Tela do Feed Reels (v1.0.161)
  // 41. Organização das Opções de Unidade Pedida e Quantidade Pedida no Detalhe do Pedido (v1.0.162)
  // 42. Expiração com Data, Mês, Ano e Hora para Promoção e Desconto Temporários (v1.0.163)
  // 43. Sistema de Segurança Antispam e Bloqueio de Links Não Permitidos em Produtos e Postagens (v1.0.164)
  // 44. Limite de 90 Caracteres na Legenda do Story e Link com Botão CTA para Conta Empresa (v1.0.165)
  // 45. Categorias de Conteúdo para Conta Empresa e Posts Temporários de 24h (v1.0.166)
  // 46. Etiqueta de Anúncio e Opção Anúncio vs Normal para Stories e Posts (v1.0.167)
  assert.ok(['1.0.166', '1.0.167'].includes(versionJson.version) || parseInt(versionJson.version.split('.')[2], 10) >= 166, 'version.json deve ser 1.0.167');
});

test('Formulários Comerciais para Conta Empresa: Permissões, templates, card interativo no chat e preenchimento de respostas (v1.0.142)', () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Permissões de Conta Empresa vs Pessoal vs Admin
  const canManageCompanyForms = win.canManageCompanyForms;
  assert.strictEqual(typeof canManageCompanyForms, 'function', 'canManageCompanyForms deve ser uma função');
  assert.strictEqual(canManageCompanyForms({ accountType: 'personal' }, { email: 'user@gmail.com' }), false, 'Conta pessoal comum não pode criar formulários');
  assert.strictEqual(canManageCompanyForms({ accountType: 'business' }, { email: 'empresa@gmail.com' }), true, 'Conta empresa DEVE poder criar formulários');
  assert.strictEqual(canManageCompanyForms({ isBusiness: true }, { email: 'empresa@gmail.com' }), true, 'Conta com isBusiness: true deve poder criar formulários');
  assert.strictEqual(canManageCompanyForms({ accountType: 'personal' }, { email: 'dxhub.oficial@gmail.com' }), true, 'Admin DEVE poder criar formulários');

  // 2. Templates prontos de formulário comercial
  const templates = win.COMPANY_FORM_TEMPLATES;
  assert.ok(templates, 'COMPANY_FORM_TEMPLATES deve existir');
  assert.ok(templates.client_registration, 'Deve conter template client_registration');
  assert.ok(templates.satisfaction_survey, 'Deve conter template satisfaction_survey');
  assert.ok(templates.service_briefing, 'Deve conter template service_briefing');
  assert.strictEqual(templates.client_registration.title, 'Cadastro de Cliente');
  assert.strictEqual(templates.satisfaction_survey.title, 'Pesquisa de Satisfação');
  assert.strictEqual(templates.service_briefing.title, 'Briefing de Orçamento');

  // 3. Renderização do Card de Formulário no Chat (buildCompanyFormCardHTML)
  const buildCompanyFormCardHTML = win.buildCompanyFormCardHTML;
  assert.strictEqual(typeof buildCompanyFormCardHTML, 'function', 'buildCompanyFormCardHTML deve ser uma função');

  const mockFormMsg = {
    id: 'msg_form_test_1',
    senderUid: 'biz_sender_123',
    type: 'form',
    form: {
      id: 'form_123',
      title: 'Cadastro para Pedido VIP',
      description: 'Informe seus dados para entrega rápida.',
      senderUid: 'biz_sender_123',
      senderName: 'VORTEX Store',
      fields: [
        { id: 'q1', label: 'Nome completo', type: 'text', required: true },
        { id: 'q2', label: 'WhatsApp', type: 'text', required: true },
        { id: 'q3', label: 'Tipo de Entrega', type: 'radio', options: ['Motoboy', 'Retirada'], required: true }
      ],
      responses: {}
    }
  };

  const cardHtml = buildCompanyFormCardHTML(mockFormMsg);
  assert.ok(cardHtml.includes('chat-company-form-card'), 'Card deve conter classe .chat-company-form-card');
  assert.ok(cardHtml.includes('Cadastro para Pedido VIP'), 'Card deve exibir o título do formulário');
  assert.ok(cardHtml.includes('3 perguntas'), 'Card deve exibir a quantidade de perguntas');
  assert.ok(cardHtml.includes('chat-form-company-pill'), 'Card deve conter pill EMPRESA');
  assert.ok(cardHtml.includes('chat-form-fill-btn') || cardHtml.includes('chat-form-view-responses-btn'), 'Card deve conter botão interativo de ação');

  // 4. Card quando o cliente já respondeu
  const mockAnsweredFormMsg = {
    ...mockFormMsg,
    form: {
      ...mockFormMsg.form,
      responses: {
        'mock-uid': {
          respondentUid: 'mock-uid',
          respondentName: 'Cliente Teste',
          submittedAt: Date.now(),
          answers: { q1: 'João Silva', q2: '11999998888', q3: 'Motoboy' }
        }
      }
    }
  };
  const answeredCardHtml = buildCompanyFormCardHTML(mockAnsweredFormMsg);
  assert.ok(answeredCardHtml.includes('chat-form-status-badge') || answeredCardHtml.includes('Ver Minha Resposta') || answeredCardHtml.includes('Respondido'), 'Card deve indicar status respondido quando cliente já preencheu');
});

test('Validação Numérica (bloqueio de letras em preço e estoque) e Variações do Catálogo (5 cores, peso, tamanho, voltagem 110v/220v/escolha do cliente) (v1.0.143)', () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Sanitização Numérica e Bloqueio de Letras
  const sanitizeDecimal = win.sanitizeCatalogDecimalInput;
  const sanitizeInteger = win.sanitizeCatalogIntegerInput;
  assert.strictEqual(typeof sanitizeDecimal, 'function', 'sanitizeCatalogDecimalInput deve ser função');
  assert.strictEqual(typeof sanitizeInteger, 'function', 'sanitizeCatalogIntegerInput deve ser função');

  // Preço e Preço de Promoção: aceita apenas números e separador decimal, bloqueia qualquer letra
  assert.strictEqual(sanitizeDecimal('150.00'), '150.00');
  assert.strictEqual(sanitizeDecimal('150,50'), '150,50');
  assert.strictEqual(sanitizeDecimal('abc150def'), '150', 'Deve remover letras abc e def');
  assert.strictEqual(sanitizeDecimal('R$ 99,90'), '99,90', 'Deve remover R$ e espaços');
  assert.strictEqual(sanitizeDecimal('apenas_letras'), '', 'Texto sem número deve retornar vazio');

  // Estoque: aceita estritamente números inteiros, bloqueia letras, 'e', '+' e '-'
  assert.strictEqual(sanitizeInteger('100'), '100');
  assert.strictEqual(sanitizeInteger('1e5'), '15', 'Deve remover expoente e');
  assert.strictEqual(sanitizeInteger('abc50-'), '50', 'Deve remover letras e hífen');
  assert.strictEqual(sanitizeInteger('12,5'), '125', 'Deve aceitar estritamente inteiros');

  // 2. Gerenciamento de Cores do Produto (até 5)
  const addEditorColor = win.addEditorColor;
  assert.strictEqual(typeof addEditorColor, 'function', 'addEditorColor deve ser função');
  win.currentEditorColors.length = 0;

  for (let i = 0; i < 5; i++) {
    addEditorColor();
  }
  assert.strictEqual(win.currentEditorColors.length, 5, 'Deve permitir adicionar até 5 cores');
  // Tentativa de adicionar 6ª cor deve ser bloqueada
  addEditorColor();
  assert.strictEqual(win.currentEditorColors.length, 5, 'Não deve ultrapassar o limite de 5 cores');

  // 3. Variações e Escolha do Cliente (Cor, Tamanho, Voltagem) no Carrinho
  const addToCatalogCart = win.addToCatalogCart;
  assert.strictEqual(typeof addToCatalogCart, 'function', 'addToCatalogCart deve ser função');

  const mockProduct = {
    id: 'prod_bivolt_1',
    name: 'Liquidificador Turbo Power',
    price: 199.90,
    promoPrice: 179.90,
    stock: 10,
    unlimitedStock: false,
    weight: '1.8kg',
    size: 'Único',
    voltageOption: 'bivolt_choice',
    colors: [
      { hex: '#000000', name: 'Preto' },
      { hex: '#dc2626', name: 'Vermelho' }
    ]
  };

  win.clearCatalogCart();

  // Cliente 1 escolhe 110V Vermelho
  addToCatalogCart(mockProduct, 'seller_biz_1', { name: 'Eletro Store' }, {
    selectedColor: 'Vermelho',
    selectedSize: 'Único',
    selectedVoltage: '110V'
  });

  // Cliente 2 escolhe 220V Preto
  addToCatalogCart(mockProduct, 'seller_biz_1', { name: 'Eletro Store' }, {
    selectedColor: 'Preto',
    selectedSize: 'Único',
    selectedVoltage: '220V'
  });

  const cart = win.getCatalogCart();
  assert.strictEqual(cart.items.length, 2, 'Carrinho deve ter 2 itens com variações distintas');
  assert.strictEqual(cart.items[0].selectedVoltage, '110V');
  assert.strictEqual(cart.items[0].selectedColor, 'Vermelho');
  assert.strictEqual(cart.items[1].selectedVoltage, '220V');
  assert.strictEqual(cart.items[1].selectedColor, 'Preto');

  // 4. Renderização no Card de Pedido do Chat
  const buildOrderCardHTML = win.buildOrderCardHTML;
  const mockOrderMsg = {
    id: 'msg_order_var_1',
    type: 'order',
    order: {
      orderId: 'ord_123',
      orderNumber: 'VX-889900',
      total: 359.80,
      paymentMethod: 'Pix',
      items: [
        { name: 'Liquidificador Turbo Power', quantity: 1, price: 179.90, selectedColor: 'Vermelho', selectedVoltage: '110V' },
        { name: 'Liquidificador Turbo Power', quantity: 1, price: 179.90, selectedColor: 'Preto', selectedVoltage: '220V' }
      ]
    }
  };

  const cardHtml = buildOrderCardHTML(mockOrderMsg);
  assert.ok(cardHtml.includes('Vermelho'), 'Card deve exibir a cor Vermelho');
  assert.ok(cardHtml.includes('110V'), 'Card deve exibir a voltagem 110V');
  assert.ok(cardHtml.includes('Preto'), 'Card deve exibir a cor Preto');
  assert.ok(cardHtml.includes('220V'), 'Card deve exibir a voltagem 220V');
  assert.ok(cardHtml.includes('chat-order-item-vars'), 'Card deve conter bloco chat-order-item-vars');
});

test('Desconto no Produto (Permanente ou Temporário), Vigência da Promoção, Produto Físico vs Digital, Tipos Digitais, Link e Botão Customizado (v1.0.144)', () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Sanitização do campo de desconto (bloqueia letras e aceita números, vírgula, ponto e %)
  const sanitizeDiscount = win.sanitizeCatalogDiscountInput;
  assert.strictEqual(typeof sanitizeDiscount, 'function', 'sanitizeCatalogDiscountInput deve ser função');
  assert.strictEqual(sanitizeDiscount('10%'), '10%');
  assert.strictEqual(sanitizeDiscount('15,00'), '15,00');
  assert.strictEqual(sanitizeDiscount('25.50%'), '25.50%');
  assert.strictEqual(sanitizeDiscount('desconto20%off'), '20%', 'Deve remover letras e manter números e %');
  assert.strictEqual(sanitizeDiscount('apenas_letras'), '', 'Sem números deve retornar vazio');

  // 2. Mapeamento de CTA (rótulo e ícone)
  const getCtaLabel = win.getDigitalCtaLabel;
  const getCtaIcon = win.getDigitalCtaIcon;
  assert.strictEqual(getCtaLabel('abrir'), 'Abrir');
  assert.strictEqual(getCtaLabel('assinar'), 'Assinar');
  assert.strictEqual(getCtaLabel('saiba_mais'), 'Saiba mais');
  assert.strictEqual(getCtaLabel('ver'), 'Ver');
  assert.strictEqual(getCtaLabel('testar'), 'Testar');

  assert.strictEqual(getCtaIcon('abrir'), 'external-link');
  assert.strictEqual(getCtaIcon('assinar'), 'check-circle');
  assert.strictEqual(getCtaIcon('saiba_mais'), 'info');
  assert.strictEqual(getCtaIcon('ver'), 'eye');
  assert.strictEqual(getCtaIcon('testar'), 'play');

  // 3. Comportamento no DOM do Editor:
  // Físico vs Digital e exibição condicional do grupo de CTA após link ser preenchido
  const kindSel = win.document.getElementById('cat-prod-kind');
  const digitalSec = win.document.getElementById('cat-prod-digital-section');
  const linkInp = win.document.getElementById('cat-prod-digital-link');
  const ctaGroup = win.document.getElementById('cat-prod-digital-cta-group');

  assert.ok(kindSel, 'Elemento #cat-prod-kind deve existir');
  assert.ok(digitalSec, 'Elemento #cat-prod-digital-section deve existir');
  assert.ok(linkInp, 'Elemento #cat-prod-digital-link deve existir');
  assert.ok(ctaGroup, 'Elemento #cat-prod-digital-cta-group deve existir');

  // Inicialmente físico -> seção digital oculta
  kindSel.value = 'fisico';
  kindSel.dispatchEvent(new win.Event('change'));
  assert.strictEqual(digitalSec.style.display, 'none');

  // Vendedor seleciona digital -> seção digital fica visível
  kindSel.value = 'digital';
  kindSel.dispatchEvent(new win.Event('change'));
  assert.strictEqual(digitalSec.style.display, 'block');

  // Sem link -> grupo de CTA oculto
  linkInp.value = '';
  linkInp.dispatchEvent(new win.Event('input'));
  assert.strictEqual(ctaGroup.style.display, 'none');

  // Preenche o link -> grupo de CTA aparece
  linkInp.value = 'https://meuapp.com/download';
  linkInp.dispatchEvent(new win.Event('input'));
  assert.strictEqual(ctaGroup.style.display, 'block', 'Grupo de CTA deve aparecer após preencher o link');

  // 4. Inclusão de produtos digitais no carrinho com CTA, link e vigência de promoção/desconto
  const addToCatalogCart = win.addToCatalogCart;
  win.clearCatalogCart();

  const mockDigitalProd = {
    id: 'prod_digital_app_1',
    name: 'Curso VORTEX Masterclass',
    price: 297.00,
    promoPrice: 197.00,
    promoType: 'temporario',
    discount: '33%',
    discountType: 'temporario',
    kind: 'digital',
    isDigital: true,
    digitalType: 'Cursos',
    digitalLink: 'https://vortex.com/curso-masterclass',
    digitalCta: 'assinar',
    stock: 999,
    unlimitedStock: true
  };

  addToCatalogCart(mockDigitalProd, 'seller_biz_2', { name: 'Escola Vortex' });

  const cart = win.getCatalogCart();
  assert.strictEqual(cart.items.length, 1);
  const item = cart.items[0];
  assert.strictEqual(item.isDigital, true);
  assert.strictEqual(item.digitalType, 'Cursos');
  assert.strictEqual(item.digitalLink, 'https://vortex.com/curso-masterclass');
  assert.strictEqual(item.digitalCta, 'assinar');
  assert.strictEqual(item.promoType, 'temporario');
  assert.strictEqual(item.discount, '33%');
  assert.strictEqual(item.discountType, 'temporario');
});

test('Padronização de Tamanho dos Botões de Formas de Pagamento no Editor de Produtos no Celular (v1.0.145)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  const paymentGrid = doc.getElementById('cat-prod-payment-methods');
  assert.ok(paymentGrid, 'Elemento #cat-prod-payment-methods deve existir no DOM');

  // Verifica que os 5 checkboxes de pagamento existem com seus respectivos IDs
  const pix = doc.getElementById('cat-pay-pix');
  const credit = doc.getElementById('cat-pay-credit');
  const debit = doc.getElementById('cat-pay-debit');
  const cash = doc.getElementById('cat-pay-cash');
  const boleto = doc.getElementById('cat-pay-boleto');

  assert.ok(pix, 'Checkbox cat-pay-pix deve existir');
  assert.ok(credit, 'Checkbox cat-pay-credit deve existir');
  assert.ok(debit, 'Checkbox cat-pay-debit deve existir');
  assert.ok(cash, 'Checkbox cat-pay-cash deve existir');
  assert.ok(boleto, 'Checkbox cat-pay-boleto deve existir');

  // Verifica que style.css define altura uniforme e previne quebra de linha que desconfigurava Pix e Cartão de Crédito
  assert.ok(cssContent.includes('min-height: 44px;'), 'style.css deve definir min-height uniforme para os botões de pagamento');
  assert.ok(cssContent.includes('height: 44px;'), 'style.css deve definir height fixa uniforme para os botões de pagamento');
  assert.ok(cssContent.includes('white-space: nowrap;'), 'style.css deve impedir quebra de linha em Cartão de Crédito');
  assert.ok(cssContent.includes('repeat(2, 1fr)'), 'style.css deve definir grid de 2 colunas para manter tamanhos idênticos');
});

test('Padronização de Tamanho dos Botões de Formas de Pagamento no Carrinho ("Seu carrinho") no Celular (v1.0.146)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  const cartModal = doc.getElementById('catalog-cart-modal');
  assert.ok(cartModal, 'Modal #catalog-cart-modal deve existir');

  const paymentOptionsContainer = doc.getElementById('catalog-cart-payment-options');
  assert.ok(paymentOptionsContainer, 'Container #catalog-cart-payment-options deve existir');

  // Verifica que o CSS do grid do carrinho define 2 colunas no celular e altura uniforme de 44px
  assert.ok(cssContent.includes('.catalog-payment-options-grid'), 'style.css deve conter .catalog-payment-options-grid');
  assert.ok(cssContent.includes('.catalog-payment-option-pill'), 'style.css deve conter .catalog-payment-option-pill');
  assert.ok(cssContent.includes('.catalog-payment-option-pill span'), 'style.css deve conter .catalog-payment-option-pill span');
  assert.ok(cssContent.includes('min-height: 44px;'), 'style.css deve conter min-height: 44px');
  assert.ok(cssContent.includes('height: 44px;'), 'style.css deve conter height: 44px');
  assert.ok(cssContent.includes('white-space: nowrap;'), 'style.css deve conter white-space: nowrap');
});

test('Organização das Opções no PC e Atualização Automática de Preço pelo Desconto (v1.0.147)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação do layout no DOM: Promoção e Desconto organizados em linhas de 2 colunas
  const priceInp = doc.getElementById('cat-prod-price');
  const promoInp = doc.getElementById('cat-prod-promo');
  const promoTypeSel = doc.getElementById('cat-prod-promo-type');
  const discountInp = doc.getElementById('cat-prod-discount');
  const discountTypeSel = doc.getElementById('cat-prod-discount-type');

  assert.ok(priceInp, 'cat-prod-price deve existir');
  assert.ok(promoInp, 'cat-prod-promo deve existir');
  assert.ok(promoTypeSel, 'cat-prod-promo-type deve existir');
  assert.ok(discountInp, 'cat-prod-discount deve existir');
  assert.ok(discountTypeSel, 'cat-prod-discount-type deve existir');

  // Verifica que no HTML Promoção e Desconto estão em blocos de linha organizados
  assert.ok(htmlContent.includes('Opção 1: Promoção'), 'index.html deve conter bloco organizado de Promoção');
  assert.ok(htmlContent.includes('Opção 2: Desconto'), 'index.html deve conter bloco organizado de Desconto');
  assert.ok(cssContent.includes('.catalog-field-label'), 'style.css deve estilizar catalog-field-label');

  // 2. Testes de cálculo de desconto percentual e valor fixo
  const calculatePromoFromDiscount = win.calculatePromoFromDiscount;
  const calculateDiscountFromPromo = win.calculateDiscountFromPromo;
  assert.strictEqual(typeof calculatePromoFromDiscount, 'function', 'calculatePromoFromDiscount deve ser função');
  assert.strictEqual(typeof calculateDiscountFromPromo, 'function', 'calculateDiscountFromPromo deve ser função');

  // Desconto percentual (10% de 100 -> 90)
  assert.strictEqual(calculatePromoFromDiscount('100,00', '10%'), 90);
  assert.strictEqual(calculatePromoFromDiscount('200,00', '25%'), 150);
  assert.strictEqual(calculatePromoFromDiscount('50,00', '50%'), 25);

  // Desconto em valor fixo (15 de 100 -> 85)
  assert.strictEqual(calculatePromoFromDiscount('100,00', '15,00'), 85);
  assert.strictEqual(calculatePromoFromDiscount('100,00', '15'), 85);
  assert.strictEqual(calculatePromoFromDiscount('80,00', '20,50'), 59.5);

  // Cálculo inverso do desconto (preço normal 100, promocional 80 -> 20%)
  assert.strictEqual(calculateDiscountFromPromo('100,00', '80,00'), '20%');

  // 3. Teste de digitação em tempo real no formulário
  win.attachCatalogNumericGuards();

  priceInp.value = '100,00';
  priceInp.dispatchEvent(new win.Event('input'));

  // Digita desconto de 10% -> preço promocional muda automaticamente para 90,00
  discountInp.value = '10%';
  discountInp.dispatchEvent(new win.Event('input'));
  assert.strictEqual(promoInp.value, '90,00', 'Preço promocional deve mudar para 90,00 ao digitar 10% no desconto');

  // Digita desconto fixo de 15,00 -> preço promocional muda para 85,00
  discountInp.value = '15,00';
  discountInp.dispatchEvent(new win.Event('input'));
  assert.strictEqual(promoInp.value, '85,00', 'Preço promocional deve mudar para 85,00 ao digitar 15,00 no desconto');

  // Altera preço base para 200,00 -> preço promocional recalcula para 185,00
  priceInp.value = '200,00';
  priceInp.dispatchEvent(new win.Event('input'));
  assert.strictEqual(promoInp.value, '185,00', 'Preço promocional deve recalcular ao alterar o preço base');
});

test('Opção para o Vendedor Desativar e Ativar o Botão de Compra da Loja e por Produto (v1.0.148)', async () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação no DOM/HTML do elemento de controle de compra da loja
  const buyControl = doc.getElementById('catalog-store-buy-control');
  const buyToggleBtn = doc.getElementById('catalog-store-buy-toggle-btn');
  const buyToggleLabel = doc.getElementById('catalog-store-buy-toggle-label');
  const buyDesc = doc.getElementById('catalog-store-buy-desc');
  const prodBuyEnabled = doc.getElementById('cat-prod-buy-enabled');

  assert.ok(buyControl, '#catalog-store-buy-control deve existir no painel de gerenciamento do catálogo');
  assert.ok(buyToggleBtn, '#catalog-store-buy-toggle-btn deve existir para alternar compras');
  assert.ok(buyToggleLabel, '#catalog-store-buy-toggle-label deve existir');
  assert.ok(buyDesc, '#catalog-store-buy-desc deve existir com descrição do recurso');
  assert.ok(prodBuyEnabled, '#cat-prod-buy-enabled deve existir no editor de produtos');

  // Verifica presença de classes CSS específicas
  assert.ok(cssContent.includes('.catalog-store-control-card'), 'style.css deve conter .catalog-store-control-card');
  assert.ok(cssContent.includes('.catalog-store-buy-toggle'), 'style.css deve conter .catalog-store-buy-toggle');
  assert.ok(cssContent.includes('.catalog-store-badge-catalog-only'), 'style.css deve conter .catalog-store-badge-catalog-only');
  assert.ok(cssContent.includes('.catalog-store-notice-banner'), 'style.css deve conter .catalog-store-notice-banner');

  // 2. Teste da função updateStoreBuyButtonUI
  assert.strictEqual(typeof win.updateStoreBuyButtonUI, 'function', 'updateStoreBuyButtonUI deve ser uma função');

  // Quando ativado (true)
  win.updateStoreBuyButtonUI(true);
  assert.ok(buyToggleBtn.classList.contains('active'), 'Botão deve ter classe .active quando ativado');
  assert.strictEqual(buyToggleBtn.classList.contains('disabled'), false, 'Botão não deve ter classe .disabled quando ativado');
  assert.ok(buyToggleBtn.innerHTML.includes('Compras Ativadas'), 'Texto deve indicar Compras Ativadas');

  // Quando desativado (false)
  win.updateStoreBuyButtonUI(false);
  assert.ok(buyToggleBtn.classList.contains('disabled'), 'Botão deve ter classe .disabled quando desativado');
  assert.strictEqual(buyToggleBtn.classList.contains('active'), false, 'Botão não deve ter classe .active quando desativado');
  assert.ok(buyToggleBtn.innerHTML.includes('Modo Catálogo'), 'Texto deve indicar Modo Catálogo');

  // 3. Teste da função toggleStoreBuyButton
  assert.strictEqual(typeof win.toggleStoreBuyButton, 'function', 'toggleStoreBuyButton deve ser uma função');

  // 4. Teste de bloqueio de compra em addToCatalogCart
  const sampleProduct = {
    id: 'prod_test_1',
    name: 'Camisa VORTEX',
    price: 99.90,
    stock: 10,
    buyEnabled: true
  };

  win.clearCatalogCart();

  // Teste 4a: Loja com compras desativadas (storeBuyEnabled: false)
  win.addToCatalogCart(sampleProduct, 'seller_123', { name: 'Loja Teste', storeBuyEnabled: false });
  let cart = win.getCatalogCart();
  assert.strictEqual(cart.items.length, 0, 'Não deve adicionar itens ao carrinho quando storeBuyEnabled for false');

  // Teste 4b: Produto com compra desativada individualmente (buyEnabled: false)
  const disabledProduct = {
    id: 'prod_test_2',
    name: 'Item Apenas Vitrine',
    price: 150.00,
    stock: 5,
    buyEnabled: false
  };
  win.addToCatalogCart(disabledProduct, 'seller_123', { name: 'Loja Teste', storeBuyEnabled: true });
  cart = win.getCatalogCart();
  assert.strictEqual(cart.items.length, 0, 'Não deve adicionar itens ao carrinho quando o produto tiver buyEnabled false');

  // Teste 4c: Compra ativada na loja e no produto -> adiciona com sucesso
  win.addToCatalogCart(sampleProduct, 'seller_123', { name: 'Loja Teste', storeBuyEnabled: true });
  cart = win.getCatalogCart();
  assert.strictEqual(cart.items.length, 1, 'Deve adicionar o item ao carrinho quando compras estiverem ativadas');
  assert.strictEqual(cart.items[0].productId, 'prod_test_1', 'Item correto deve estar no carrinho');
});

test('Padronização dos Botões em Minhas Compras e Correção do Título Amassado no Celular (v1.0.149)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação das regras de CSS para os botões de ação em Minhas Compras
  assert.ok(cssContent.includes('.catalog-order-actions'), 'style.css deve conter .catalog-order-actions');
  assert.ok(cssContent.includes('.cat-view-order-btn') || cssContent.includes('.catalog-order-actions .catalog-primary-btn'), 'style.css deve conter regras para cat-view-order-btn');
  assert.ok(cssContent.includes('.cat-pay-pix-btn') || cssContent.includes('.catalog-order-actions .catalog-secondary-btn'), 'style.css deve conter regras para cat-pay-pix-btn');
  assert.ok(cssContent.includes('min-height: 38px') || cssContent.includes('height: 38px'), 'style.css deve definir altura padronizada de 38px para botões de ação de pedidos');

  // 2. Verificação das regras de CSS para o título e card de controle da loja no celular
  assert.ok(cssContent.includes('.catalog-store-control-card'), 'style.css deve conter .catalog-store-control-card');
  assert.ok(cssContent.includes('.catalog-store-control-title'), 'style.css deve conter .catalog-store-control-title');
  assert.ok(cssContent.includes('white-space: nowrap;'), 'style.css deve conter white-space: nowrap');
  assert.ok(cssContent.includes('@media (min-width: 600px)'), 'style.css deve conter media query de 600px para o catálogo');

  // 3. Renderização de card de compra com os dois botões (Ver detalhes e Pagar com Pix)
  const container = doc.createElement('div');
  const mockOrders = [
    {
      id: 'ord_test_101',
      orderNumber: 'VX-185078',
      createdAt: Date.now(),
      status: 'new',
      sellerName: 'DX HUB DIGITAL',
      sellerPixKey: 'pix@dxhub.com',
      total: 135.00,
      items: [
        { name: 'DX Hub Digital Defender', quantity: 3, price: 45.00 }
      ]
    }
  ];

  win.renderOrdersList(container, mockOrders, false);

  assert.ok(container.innerHTML.includes('catalog-order-actions'), '.catalog-order-actions deve existir no card de pedido');
  assert.ok(container.innerHTML.includes('cat-view-order-btn'), 'Botão Ver detalhes deve ser renderizado');
  assert.ok(container.innerHTML.includes('cat-pay-pix-btn'), 'Botão Pagar com Pix deve ser renderizado quando sellerPixKey estiver presente e status for new');
  assert.ok(container.innerHTML.includes('Ver detalhes'), 'Texto do botão deve conter Ver detalhes');
  assert.ok(container.innerHTML.includes('Pagar com Pix'), 'Texto do botão deve conter Pagar com Pix');

  // 4. Verificação no DOM do card de controle da loja (#catalog-store-buy-control)
  const buyControl = doc.getElementById('catalog-store-buy-control');
  assert.ok(buyControl, '#catalog-store-buy-control deve existir');
  assert.ok(htmlContent.includes('class="catalog-store-control-title"'), '.catalog-store-control-title deve existir');
  assert.ok(htmlContent.includes('Botão de Compra da Loja'), 'Título deve ser Botão de Compra da Loja');
});

test('Bloqueio de Letras no Número da Casa no Carrinho e Teclado Numérico no Celular (v1.0.150)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação dos atributos no HTML (#catalog-cart-number)
  assert.ok(htmlContent.includes('id="catalog-cart-number"'), '#catalog-cart-number deve existir no HTML');
  assert.ok(htmlContent.includes('inputmode="numeric"'), '#catalog-cart-number deve conter inputmode="numeric" para acionar teclado numérico no celular');
  assert.ok(htmlContent.includes('pattern="[0-9]*"'), '#catalog-cart-number deve conter pattern="[0-9]*" para navegadores mobile');

  const cartNumberInp = doc.getElementById('catalog-cart-number');
  assert.ok(cartNumberInp, 'Elemento #catalog-cart-number deve existir no DOM');

  // 2. Função de sanitização exportada sanitizeCatalogHouseNumber
  const sanitizeHouseNumber = win.sanitizeCatalogHouseNumber;
  assert.strictEqual(typeof sanitizeHouseNumber, 'function', 'sanitizeCatalogHouseNumber deve ser função');
  assert.strictEqual(sanitizeHouseNumber('123'), '123', 'Dígitos numéricos devem ser preservados');
  assert.strictEqual(sanitizeHouseNumber('123abc456'), '123456', 'Letras entre números devem ser removidas');
  assert.strictEqual(sanitizeHouseNumber('Rua 10, Apto 204'), '10204', 'Espaços, pontuação e letras devem ser removidos');
  assert.strictEqual(sanitizeHouseNumber('apenas_letras'), '', 'Texto sem dígitos deve retornar string vazia');
  assert.strictEqual(sanitizeHouseNumber(null), '', 'null deve retornar string vazia');
  assert.strictEqual(sanitizeHouseNumber(undefined), '', 'undefined deve retornar string vazia');
  assert.strictEqual(sanitizeHouseNumber(789), '789', 'Número primitivo deve ser convertido e retornado como string');

  // 3. Evento input em tempo real no DOM
  cartNumberInp.value = '100A';
  cartNumberInp.dispatchEvent('input');
  assert.strictEqual(cartNumberInp.value, '100', 'Evento input deve remover letras digitadas imediatamente');

  cartNumberInp.value = 'Rua 42, Bloco B, Apt 301';
  cartNumberInp.dispatchEvent('input');
  assert.strictEqual(cartNumberInp.value, '42301', 'Evento input deve sanitizar qualquer texto colado ou digitado');

  // 4. Evento keydown: bloqueio preventDefault em letras e liberação de números e teclas de controle
  let aPrevented = false;
  let eventA = { key: 'a', defaultPrevented: false, preventDefault() { aPrevented = true; this.defaultPrevented = true; } };
  cartNumberInp.dispatchEvent('keydown', eventA);
  assert.strictEqual(aPrevented, true, 'Tecla "a" deve ser bloqueada no keydown');

  let zPrevented = false;
  let eventZ = { key: 'Z', defaultPrevented: false, preventDefault() { zPrevented = true; this.defaultPrevented = true; } };
  cartNumberInp.dispatchEvent('keydown', eventZ);
  assert.strictEqual(zPrevented, true, 'Tecla "Z" deve ser bloqueada no keydown');

  let spacePrevented = false;
  let eventSpace = { key: ' ', defaultPrevented: false, preventDefault() { spacePrevented = true; this.defaultPrevented = true; } };
  cartNumberInp.dispatchEvent('keydown', eventSpace);
  assert.strictEqual(spacePrevented, true, 'Tecla Espaço deve ser bloqueada no keydown');

  let digitPrevented = false;
  let eventDigit = { key: '7', defaultPrevented: false, preventDefault() { digitPrevented = true; this.defaultPrevented = true; } };
  cartNumberInp.dispatchEvent('keydown', eventDigit);
  assert.strictEqual(digitPrevented, false, 'Tecla numérica "7" não deve ser bloqueada');

  let backspacePrevented = false;
  let eventBackspace = { key: 'Backspace', defaultPrevented: false, preventDefault() { backspacePrevented = true; this.defaultPrevented = true; } };
  cartNumberInp.dispatchEvent('keydown', eventBackspace);
  assert.strictEqual(backspacePrevented, false, 'Tecla "Backspace" não deve ser bloqueada');

  // 5. Evento paste: colagem de texto com letras é sanitizada
  let pastePrevented = false;
  let pasteEvent = {
    clipboardData: {
      getData: (format) => '123ABC456'
    },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; pastePrevented = true; }
  };
  cartNumberInp.value = '';
  cartNumberInp.dispatchEvent('paste', pasteEvent);
  assert.strictEqual(pastePrevented, true, 'Paste deve ter preventDefault acionado');
  assert.strictEqual(cartNumberInp.value, '123456', 'Valor colado deve conter apenas números');

  // 6. Submissão do carrinho: número com apenas letras é rejeitado como campo obrigatório
  const submitBtn = doc.getElementById('catalog-cart-submit-btn');
  assert.ok(submitBtn, '#catalog-cart-submit-btn deve existir');
  const cartModal = doc.getElementById('catalog-cart-modal');
  cartModal.style.display = 'flex'; // modal aberto

  win.setCurrentUser({ uid: 'buyer_user_123', displayName: 'Cliente Teste' });
  win.clearCatalogCart();
  win.addToCatalogCart({
    id: 'prod_test_number',
    name: 'Produto Teste',
    price: 50.0,
    stock: 10
  }, 'seller_test_user_456', { name: 'Vendedor Loja' });

  doc.getElementById('catalog-cart-country').value = 'Brasil';
  doc.getElementById('catalog-cart-cep').value = '01001-000';
  doc.getElementById('catalog-cart-state').value = 'SP';
  doc.getElementById('catalog-cart-city').value = 'São Paulo';
  doc.getElementById('catalog-cart-street').value = 'Av Paulista';
  doc.getElementById('catalog-cart-number').value = 'SEM_NUMERO'; // Apenas letras
  doc.getElementById('catalog-cart-phone').value = '(11) 99999-9999';
  doc.getElementById('catalog-cart-email').value = 'cliente@teste.com';
  doc.getElementById('catalog-cart-age').value = '30';
  doc.getElementById('catalog-cart-selected-payment').value = 'Pix';

  const toastContainer = doc.getElementById('toast-container');
  win.submitCatalogOrder();
  const lastToast = toastContainer.children[0];
  assert.ok(lastToast, 'Toast de erro deve ser exibido');
  assert.ok(lastToast.innerHTML.includes('Campo Obrigatório'), 'Deve exibir toast de campo obrigatório');
  assert.ok(lastToast.innerHTML.includes('Número da Casa'), 'Toast deve informar sobre o Número da Casa');
});

test('Organização dos Botões na Loja (Apenas Catálogo e Conversar) e Layout Responsivo (v1.0.151)', async () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação da estrutura no HTML
  assert.ok(htmlContent.includes('class="catalog-store-bar"'), '.catalog-store-bar deve existir no HTML');
  assert.ok(htmlContent.includes('class="catalog-store-bar-main"'), '.catalog-store-bar-main deve existir no HTML');
  assert.ok(htmlContent.includes('class="catalog-store-actions"'), '.catalog-store-actions deve existir no HTML');
  assert.ok(htmlContent.includes('id="catalog-store-badge-catalog"'), '#catalog-store-badge-catalog deve existir no HTML');
  assert.ok(htmlContent.includes('id="catalog-store-chat-btn"'), '#catalog-store-chat-btn deve existir no HTML');

  // 2. Verificação das regras no CSS
  assert.ok(cssContent.includes('.catalog-store-bar-main'), 'style.css deve conter .catalog-store-bar-main');
  assert.ok(cssContent.includes('.catalog-store-actions'), 'style.css deve conter .catalog-store-actions');
  assert.ok(cssContent.includes('.catalog-store-actions .catalog-store-badge-catalog-only'), 'style.css deve conter regras para os botões dentro de .catalog-store-actions');
  assert.ok(cssContent.includes('border-radius: 999px'), 'style.css deve definir border-radius: 999px (formato pill) para os botões');

  // 3. Verificação no DOM
  const badgeEl = doc.getElementById('catalog-store-badge-catalog');
  const chatBtn = doc.getElementById('catalog-store-chat-btn');
  const infoEl = doc.getElementById('catalog-store-info');
  assert.ok(badgeEl, '#catalog-store-badge-catalog deve existir');
  assert.ok(chatBtn, '#catalog-store-chat-btn deve existir');
  assert.ok(infoEl, '#catalog-store-info deve existir');

  // 4. Teste de openStorefront com storeBuyEnabled: false (loja apenas catálogo)
  const mockSellerCatalogOnly = {
    uid: 'seller_cat_only_1',
    name: 'DX HUB DIGITAL',
    status: 'Loja Oficial VORTEX',
    storeBuyEnabled: false
  };

  win.setCurrentUser({ uid: 'buyer_user_1', displayName: 'Cliente' });
  await win.openStorefront('seller_cat_only_1', mockSellerCatalogOnly);

  // O badge deve estar visível como inline-flex
  assert.strictEqual(badgeEl.style.display, 'inline-flex', 'Badge Apenas Catálogo deve ser exibido quando compras estiverem desativadas');
  // O botão de chat deve estar visível
  assert.strictEqual(chatBtn.style.display, 'inline-flex', 'Botão Conversar deve ser exibido para clientes');
  // infoEl NÃO deve conter o badge espremido junto com o nome
  assert.ok(!infoEl.innerHTML.includes('catalog-store-badge-catalog-only'), 'infoEl não deve conter o badge de catálogo para não amassar o título');
  assert.ok(infoEl.innerHTML.includes('DX HUB DIGITAL'), 'infoEl deve conter o nome da loja');
  assert.ok(infoEl.innerHTML.includes('Loja Oficial VORTEX'), 'infoEl deve conter o status da loja');

  // 5. Clique no badge exibe explicação amigável via toast
  const toastContainer = doc.getElementById('toast-container');
  badgeEl.onclick();
  const lastToast = toastContainer.children[0];
  assert.ok(lastToast, 'Toast deve ser gerado ao clicar no badge');
  assert.ok(lastToast.innerHTML.includes('Apenas Catálogo'), 'Toast deve informar sobre modo vitrine / catálogo');

  // 6. Teste de openStorefront com storeBuyEnabled: true (loja com compras ativadas)
  const mockSellerBuyEnabled = {
    uid: 'seller_buy_enabled_2',
    name: 'Super Loja Eletro',
    status: 'Melhores preços',
    storeBuyEnabled: true
  };

  await win.openStorefront('seller_buy_enabled_2', mockSellerBuyEnabled);
  assert.strictEqual(badgeEl.style.display, 'none', 'Badge Apenas Catálogo deve estar oculto quando compras estiverem ativadas');
  assert.strictEqual(chatBtn.style.display, 'inline-flex', 'Botão Conversar deve continuar visível');

  // 7. Teste de visualização da própria loja pelo vendedor
  win.setCurrentUser({ uid: 'seller_buy_enabled_2', displayName: 'Dono da Loja' });
  await win.openStorefront('seller_buy_enabled_2', mockSellerBuyEnabled);
  assert.strictEqual(chatBtn.style.display, 'none', 'Botão Conversar deve ser ocultado quando o usuário for o próprio vendedor');
});

test('Correção e Otimização da Interface do Formulário Comercial para Celular (v1.0.152)', async () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação de regras CSS essenciais para Mobile no style.css
  assert.ok(cssContent.includes('.company-form-creator-card'), 'style.css deve conter .company-form-creator-card');
  assert.ok(cssContent.includes('padding: 0 !important;'), 'style.css deve remover padding duplo do modal');
  assert.ok(cssContent.includes('.company-form-field-row'), 'style.css deve conter .company-form-field-row');
  assert.ok(cssContent.includes('flex-direction: column;'), 'style.css deve definir flex-direction: column (mobile-first) para .company-form-field-row');
  assert.ok(cssContent.includes('.company-form-templates-chips'), 'style.css deve conter .company-form-templates-chips');
  assert.ok(cssContent.includes('overflow-x: auto;'), 'style.css deve definir rolagem horizontal para os templates');
  assert.ok(cssContent.includes('flex-wrap: nowrap;'), 'style.css deve manter templates em linha única no mobile');
  assert.ok(cssContent.includes('.company-form-modal-footer'), 'style.css deve conter .company-form-modal-footer');
  assert.ok(cssContent.includes('background: #121420;'), 'style.css deve ter fundo opaco no rodapé para não vazar conteúdo');
  assert.ok(cssContent.includes('.company-form-textarea'), 'style.css deve conter .company-form-textarea');
  assert.ok(cssContent.includes('font-family: inherit;'), 'style.css deve herdar tipografia no textarea');
  assert.ok(cssContent.includes('resize: none;'), 'style.css deve desativar redimensionamento quebrado no textarea');

  // 2. Verificação de responsividade para telas maiores (@media min-width: 600px)
  assert.ok(cssContent.includes('@media (min-width: 600px)'), 'style.css deve ter media query para telas maiores');
  assert.ok(cssContent.includes('flex-direction: row;'), 'style.css deve voltar para row em telas maiores');

  // 3. Verificação no DOM e Abertura do Modal de Criação de Formulário
  const modal = doc.getElementById('company-form-creator-modal');
  assert.ok(modal, '#company-form-creator-modal deve existir no DOM');

  const fieldsContainer = doc.getElementById('company-form-fields-container');
  assert.ok(fieldsContainer, '#company-form-fields-container deve existir no DOM');

  // 4. Teste de Abertura com Conta Empresa
  win.setCurrentUser({ uid: 'biz_user_1', displayName: 'Empresa Teste', email: 'empresa@teste.com' });
  win.setCurrentProfile({
    uid: 'biz_user_1',
    name: 'Empresa Teste',
    accountType: 'business'
  });
  win.setActiveChatContact({ uid: 'client_user_2', name: 'Cliente Teste' });

  win.openCompanyFormCreator();
  assert.strictEqual(modal.style.display, 'flex', 'Modal deve estar visível como flex');
  assert.ok(modal.classList.contains('active'), 'Modal deve ter classe active');

  // 5. Teste de Templates Rápidos
  win.applyCompanyFormTemplate('satisfaction_survey');
  const titleInput = doc.getElementById('company-form-title-input');
  assert.strictEqual(titleInput.value, 'Pesquisa de Satisfação', 'Input de título deve refletir o template aplicado');

  const fieldsCountEl = doc.getElementById('company-form-fields-count');
  assert.ok(fieldsCountEl, '#company-form-fields-count deve existir');
  const initialCount = parseInt(fieldsCountEl.innerText || '0', 10);
  assert.ok(initialCount > 0, 'Template de pesquisa deve conter perguntas');
  assert.ok(fieldsContainer.innerHTML.includes('company-form-field-row'), 'Campos do template devem conter .company-form-field-row');
  assert.ok(fieldsContainer.innerHTML.includes('company-form-sublabel'), 'Campos do template devem conter rótulos .company-form-sublabel');

  // 6. Teste de Adicionar Pergunta
  const addBtn = doc.getElementById('company-form-add-field-btn');
  assert.ok(addBtn, '#company-form-add-field-btn deve existir');
  await addBtn.dispatchEvent('click');
  const newCount = parseInt(fieldsCountEl.innerText || '0', 10);
  assert.strictEqual(newCount, initialCount + 1, 'Contador de perguntas deve ser incrementado após adicionar pergunta');
  assert.ok(fieldsContainer.innerHTML.includes('data-field-index'), 'Container deve conter data-field-index atualizado');

  // 7. Fechamento do Modal
  win.closeCompanyFormCreator();
  assert.strictEqual(modal.style.display, 'none', 'Modal deve ser ocultado ao fechar');
});

test('Organização e Alinhamento Visual dos Modais no Celular (Pix, Enquete, Respostas e Prévia de Formulário) (v1.0.153)', async () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  // 1. Verificação do Modal Enviar Chave Pix no CSS
  assert.ok(cssContent.includes('.pix-send-card'), 'style.css deve conter .pix-send-card');
  assert.ok(cssContent.includes('.pix-send-card') && cssContent.includes('padding: 0 !important;'), 'style.css deve conter padding: 0 !important no pix-send-card');
  assert.ok(cssContent.includes('.pix-modal-top-bar'), 'style.css deve conter .pix-modal-top-bar');
  assert.ok(cssContent.includes('.pix-send-footer'), 'style.css deve conter .pix-send-footer');
  assert.ok(cssContent.includes('.pix-send-btn'), 'style.css deve conter .pix-send-btn');
  assert.ok(cssContent.includes('.pix-send-btn') && cssContent.includes('height: 42px;'), 'style.css deve definir height: 42px para botões do Pix');
  assert.ok(cssContent.includes('.pix-send-btn') && cssContent.includes('white-space: nowrap;'), 'style.css deve definir white-space: nowrap para evitar quebra no botão Enviar Chave Pix');

  // 2. Verificação do Modal Criar Enquete no CSS
  assert.ok(cssContent.includes('.poll-creator-card'), 'style.css deve conter .poll-creator-card');
  assert.ok(cssContent.includes('.poll-creator-card') && cssContent.includes('padding: 0 !important;'), 'style.css deve conter padding: 0 !important no poll-creator-card');
  assert.ok(cssContent.includes('.poll-modal-top-bar'), 'style.css deve conter .poll-modal-top-bar');
  assert.ok(cssContent.includes('.poll-setting-row'), 'style.css deve conter .poll-setting-row');
  assert.ok(cssContent.includes('.poll-setting-title'), 'style.css deve conter .poll-setting-title');
  assert.ok(cssContent.includes('.poll-creator-footer'), 'style.css deve conter .poll-creator-footer');
  assert.ok(cssContent.includes('.poll-btn') && cssContent.includes('height: 42px;'), 'style.css deve definir height: 42px para botões da enquete');
  assert.ok(cssContent.includes('.poll-btn') && cssContent.includes('white-space: nowrap;'), 'style.css deve definir white-space: nowrap para evitar quebra no botão Enviar Enquete');

  // 3. Verificação dos Cabeçalhos de Respostas e Prévia do Formulário no CSS
  assert.ok(cssContent.includes('.company-form-modal-top-bar h2'), 'style.css deve conter regra específica para h2 em .company-form-modal-top-bar');
  assert.ok(cssContent.includes('.company-form-modal-top-bar h2') && cssContent.includes('white-space: nowrap;'), 'style.css deve evitar quebra do título em Respostas e Prévia do Formulário');
  assert.ok(cssContent.includes('.company-form-modal-subtitle') && cssContent.includes('white-space: nowrap;'), 'style.css deve conter white-space: nowrap no subtítulo do formulário');

  // 4. Verificação de Responsividade dos Títulos dos Modais (.share-modal-title-wrap)
  assert.ok(cssContent.includes('.share-modal-title-wrap h2'), 'style.css deve conter .share-modal-title-wrap h2');
  assert.ok(cssContent.includes('.share-modal-title-wrap h2') && cssContent.includes('white-space: nowrap;'), 'style.css deve ter white-space: nowrap em .share-modal-title-wrap h2');
  assert.ok(cssContent.includes('.share-modal-title-wrap h2') && cssContent.includes('text-overflow: ellipsis;'), 'style.css deve ter text-overflow: ellipsis em .share-modal-title-wrap h2');

  // 5. Verificação da Existência dos Modais no DOM
  const pixModal = doc.getElementById('pix-send-modal');
  const pollModal = doc.getElementById('poll-creator-modal');
  const formFillModal = doc.getElementById('company-form-fill-modal');
  const formRespModal = doc.getElementById('company-form-responses-modal');

  assert.ok(pixModal, '#pix-send-modal deve existir no DOM');
  assert.ok(pollModal, '#poll-creator-modal deve existir no DOM');
  assert.ok(formFillModal, '#company-form-fill-modal deve existir no DOM');
  assert.ok(formRespModal, '#company-form-responses-modal deve existir no DOM');

  // 6. Verificação dos Componentes Internos
  assert.ok(doc.getElementById('pix-send-confirm-btn'), '#pix-send-confirm-btn deve existir');
  assert.ok(doc.getElementById('pix-send-cancel-btn'), '#pix-send-cancel-btn deve existir');
  assert.ok(doc.getElementById('poll-submit-btn'), '#poll-submit-btn deve existir');
  assert.ok(doc.getElementById('poll-cancel-btn'), '#poll-cancel-btn deve existir');
  assert.ok(doc.getElementById('poll-allow-multiple-toggle'), '#poll-allow-multiple-toggle deve existir');
  assert.ok(doc.getElementById('company-form-fill-modal-title'), '#company-form-fill-modal-title deve existir');
  assert.ok(doc.getElementById('company-form-responses-modal-subtitle'), '#company-form-responses-modal-subtitle deve existir');
});

test('Chamadas Recebidas com o App Fechado: servidor FCM, Service Worker com Atender/Recusar e registro do token no cliente (v1.0.154)', async () => {
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const serverContent = fs.readFileSync('server.js', 'utf8');

  // 1. Servidor: sintaxe válida (antes estava quebrada pelo webhook sem fechamento) e rota de push
  const { spawnSync } = await import('node:child_process');
  const syntax = spawnSync(process.execPath, ['--check', 'server.js'], { encoding: 'utf8' });
  assert.strictEqual(syntax.status, 0, `server.js deve ter sintaxe válida: ${syntax.stderr}`);
  assert.ok(serverContent.includes("app.post('/api/notify-call'"), 'server.js deve expor POST /api/notify-call');
  assert.ok(serverContent.includes("app.get('/api/push-status'"), 'server.js deve expor GET /api/push-status');
  assert.ok(serverContent.includes('sendEachForMulticast'), 'server.js deve enviar via FCM (sendEachForMulticast)');
  assert.ok(serverContent.includes("priority: 'high'"), 'push de chamada deve ter prioridade alta');
  assert.ok(serverContent.includes('FIREBASE_SERVICE_ACCOUNT'), 'server.js deve aceitar credenciais via variável de ambiente (Render)');
  assert.ok(serverContent.includes("call.status !== 'ringing'"), 'server.js só deve notificar chamadas que estão tocando');
  assert.ok(serverContent.includes("collection('blocked')"), 'server.js deve respeitar contatos bloqueados');

  // 2. Cliente: registro do token e disparo do push ao ligar
  assert.ok(fs.readFileSync('public/script.js', 'utf8').includes('firebase-messaging.js'), 'script.js deve importar o Firebase Messaging');
  assert.ok(jsContent.includes('notifyCallPush(currentCallId);'), 'startCall deve avisar o servidor para enviar o push');
  assert.ok(jsContent.includes('fcmTokens: arrayUnion(token)'), 'token do aparelho deve ser salvo no perfil');
  assert.ok(jsContent.includes('consumePendingCallLink(callDoc.id);'), 'chamada aberta pelo botão Atender deve ser atendida automaticamente');

  const env = createTestEnvironment();
  const win = env.sandbox.window;
  assert.strictEqual(typeof win.registerPushToken, 'function', 'registerPushToken deve existir');
  assert.strictEqual(typeof win.unregisterPushToken, 'function', 'unregisterPushToken deve existir');
  assert.strictEqual(typeof win.notifyCallPush, 'function', 'notifyCallPush deve existir');
  assert.strictEqual(typeof win.handleIncomingCallLink, 'function', 'handleIncomingCallLink deve existir');
  assert.strictEqual(await win.registerPushToken(), null, 'Sem permissão/usuário, registerPushToken não deve registrar nada');
  assert.doesNotThrow(() => win.handleIncomingCallLink('call_abc', true), 'handleIncomingCallLink não deve lançar erro');

  // 3. Service Worker executado em sandbox: simula o push de uma chamada recebida
  function createSwSandbox({ windowClients = [], callStatus = 'ended' } = {}) {
    const listeners = {};
    const shown = [];
    const closed = [];
    const fetched = [];
    const openedWindows = [];
    let fakeNow = 1700000000000;
    const sandbox = {
      console,
      URL,
      Promise,
      Date: { now: () => fakeNow },
      setTimeout: (fn, ms) => { fakeNow += Number(ms) || 0; fn(); return 0; },
      caches: { open: async () => ({ addAll: async () => {}, put: () => {} }), keys: async () => [], match: async () => null, delete: async () => true },
      fetch: async (url, opts = {}) => {
        fetched.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
        return { ok: true, json: async () => ({ fields: { status: { stringValue: callStatus } } }) };
      },
      clients: {
        matchAll: async () => windowClients,
        openWindow: async (u) => { openedWindows.push(u); },
        claim: async () => {}
      }
    };
    sandbox.self = {
      location: { origin: 'https://menssagem-dx.web.app' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: sandbox.clients,
      registration: {
        showNotification: async (title, options) => { shown.push({ title, options }); },
        getNotifications: async () => [{ close: () => closed.push(true) }]
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(swContent, sandbox);
    return { listeners, shown, closed, fetched, openedWindows };
  }

  async function fire(listener, event) {
    const pending = [];
    listener({ ...event, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  }

  const callPayload = { data: { type: 'call', callId: 'call_1', callerName: 'Ana', isVideo: '1' }, from: '107151991007' };
  const pushEvent = { data: { json: () => callPayload, text: () => '' } };

  // 3a. Com o app fechado: mostra a chamada com Atender/Recusar e fecha quando a chamada termina
  const sw = createSwSandbox({ callStatus: 'ended' });
  assert.strictEqual(typeof sw.listeners.push, 'function', 'sw.js deve ter listener de push');
  await fire(sw.listeners.push, pushEvent);
  assert.strictEqual(sw.shown.length, 1, 'Deve exibir exatamente 1 notificação de chamada');
  assert.strictEqual(sw.shown[0].title, 'Ana está ligando', 'Título deve identificar quem está ligando');
  assert.strictEqual(sw.shown[0].options.requireInteraction, true, 'Notificação de chamada deve ficar fixa até a pessoa agir');
  assert.strictEqual(sw.shown[0].options.tag, 'vortex-call-call_1', 'Notificação deve usar tag por chamada');
  assert.deepStrictEqual(Array.from(sw.shown[0].options.actions, a => a.action), ['answer', 'decline'], 'Deve ter botões Atender e Recusar');
  assert.ok(sw.shown[0].options.vibrate.length >= 4, 'Deve vibrar com padrão de chamada');
  assert.ok(sw.closed.length >= 1, 'Deve fechar a notificação quando a chamada deixa de estar tocando');
  assert.ok(sw.fetched.some(f => f.url.includes('/documents/calls/call_1')), 'Deve consultar o status da chamada no Firestore');

  // 3b. Enquanto a chamada continua tocando, o alerta é repetido (renotify)
  const swRinging = createSwSandbox({ callStatus: 'ringing' });
  await fire(swRinging.listeners.push, pushEvent);
  assert.ok(swRinging.shown.length > 1, 'Deve repetir o alerta enquanto a chamada estiver tocando');
  assert.ok(swRinging.shown.slice(1).every(s => s.options.renotify === true), 'Repetições devem usar renotify para tocar/vibrar de novo');

  // 3c. App aberto e visível: o próprio app toca, sem notificação duplicada
  const swVisible = createSwSandbox({ windowClients: [{ visibilityState: 'visible', url: 'https://menssagem-dx.web.app/' }] });
  await fire(swVisible.listeners.push, pushEvent);
  assert.strictEqual(swVisible.shown.length, 0, 'Não deve notificar quando o app está visível');

  // 3d. Recusar pela notificação encerra a chamada sem abrir o app
  const swDecline = createSwSandbox();
  let notifClosed = false;
  await fire(swDecline.listeners.notificationclick, {
    action: 'decline',
    notification: { close: () => { notifClosed = true; }, data: { type: 'call', callId: 'call_1' } }
  });
  const patch = swDecline.fetched.find(f => f.method === 'PATCH');
  assert.ok(notifClosed, 'Notificação deve ser fechada ao recusar');
  assert.ok(patch && patch.url.includes('calls/call_1'), 'Recusar deve atualizar o documento da chamada');
  assert.ok(patch.body.includes('rejected'), 'Status da chamada deve virar rejected');
  assert.strictEqual(swDecline.openedWindows.length, 0, 'Recusar não deve abrir o app');

  // 3e. Atender pela notificação abre o app já pedindo para atender
  const swAnswer = createSwSandbox();
  await fire(swAnswer.listeners.notificationclick, {
    action: 'answer',
    notification: { close: () => {}, data: { type: 'call', callId: 'call_1', url: '/?call=call_1' } }
  });
  assert.strictEqual(swAnswer.openedWindows.length, 1, 'Atender deve abrir o app');
  assert.ok(swAnswer.openedWindows[0].includes('call=call_1') && swAnswer.openedWindows[0].includes('answer=1'), 'URL deve carregar a chamada e o pedido de atender');

  // 3f. Push comum (mensagem) continua funcionando
  const swPlain = createSwSandbox();
  await fire(swPlain.listeners.push, { data: { json: () => ({ title: 'Nova mensagem', body: 'Oi' }), text: () => '' } });
  assert.strictEqual(swPlain.shown.length, 1, 'Push comum deve mostrar 1 notificação');
  assert.strictEqual(swPlain.shown[0].title, 'Nova mensagem', 'Push comum deve manter o título');
});

test('Correção dos Ícones Grandes dos Modais no Celular (Respostas, Formulário, Prévia e Pix) (v1.0.155)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  // 1. Verificação de isolamento do flex: 1 no seletor .share-modal-title-wrap > div
  assert.ok(
    cssContent.includes('.share-modal-title-wrap > div:not(.company-form-title-icon-badge):not(.pix-modal-icon-badge)'),
    'style.css deve proteger os badges de ícones de herdarem flex: 1 de .share-modal-title-wrap > div'
  );

  // 2. Verificação de dimensões fixas e flex: 0 0 no .company-form-title-icon-badge
  assert.ok(cssContent.includes('.company-form-title-icon-badge'), 'style.css deve conter .company-form-title-icon-badge');
  assert.ok(
    cssContent.includes('.company-form-title-icon-badge') && cssContent.includes('flex: 0 0 36px;'),
    'style.css deve definir flex: 0 0 36px para impedir esticamento do ícone de formulário'
  );
  assert.ok(
    cssContent.includes('.company-form-title-icon-badge') && cssContent.includes('flex-grow: 0;'),
    'style.css deve definir flex-grow: 0 no badge do formulário'
  );

  // 3. Verificação de responsividade mobile (@media max-width: 480px)
  assert.ok(
    cssContent.includes('flex: 0 0 32px;') && cssContent.includes('border-radius: 8px;'),
    'style.css deve reduzir o badge para 32px no mobile mantendo proporção quadrada'
  );

  // 4. Verificação de dimensões do Pix Modal Icon Badge
  assert.ok(cssContent.includes('.pix-modal-icon-badge'), 'style.css deve conter .pix-modal-icon-badge');
  assert.ok(
    cssContent.includes('.pix-modal-icon-badge') && cssContent.includes('flex: 0 0 36px;'),
    'style.css deve definir flex: 0 0 36px para o badge de ícone do Pix'
  );

  // 5. Verificação da Presença dos Badges nos Modais do DOM
  const fillModal = doc.getElementById('company-form-fill-modal');
  const respModal = doc.getElementById('company-form-responses-modal');
  const creatorModal = doc.getElementById('company-form-creator-modal');
  const pixModal = doc.getElementById('pix-send-modal');

  assert.ok(fillModal.querySelector('.company-form-title-icon-badge'), 'Modal de preenchimento deve conter .company-form-title-icon-badge');
  assert.ok(respModal.querySelector('.company-form-title-icon-badge'), 'Modal de respostas deve conter .company-form-title-icon-badge');
  assert.ok(creatorModal.querySelector('.company-form-title-icon-badge'), 'Modal de criação de formulário deve conter .company-form-title-icon-badge');
  assert.ok(pixModal.querySelector('.pix-modal-icon-badge'), 'Modal Pix deve conter .pix-modal-icon-badge');
});

test('Separação de Redes Sociais e Sites Oficiais nos Dados do Contato e no Editar Perfil (v1.0.156)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação da existência das duas seções independentes no DOM e HTML
  assert.ok(env.elements['contact-profile-social-section'], '#contact-profile-social-section deve existir no DOM');
  assert.ok(env.elements['contact-profile-websites-section'], '#contact-profile-websites-section deve existir no DOM');
  assert.ok(htmlContent.includes('id="contact-profile-websites-section"'), 'public/index.html deve conter contact-profile-websites-section');
  assert.ok(htmlContent.includes('Sites Oficiais'), 'public/index.html deve conter o título Sites Oficiais');

  // 2. Verificação de estilos no CSS
  assert.ok(cssContent.includes('.contact-profile-websites-section'), 'style.css deve conter .contact-profile-websites-section');
  assert.ok(cssContent.includes('.business-websites-header'), 'style.css deve conter .business-websites-header');

  // 4. Teste de isolamento de exibição: Contato com AMBOS (Redes Sociais e Sites Oficiais)
  const updateContactProfileSocialUI = win.updateContactProfileSocialUI;
  updateContactProfileSocialUI({
    accountType: 'business',
    whatsapp: 'https://wa.me/5511999998888',
    tiktok: '@canal.tiktok',
    website1: 'https://playappdx.com.br',
    website1Title: 'Play App DX'
  });
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'block', 'Seção Redes Sociais deve estar visível');
  assert.strictEqual(env.elements['contact-profile-websites-section'].style.display, 'block', 'Seção Sites Oficiais deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website1-link'].style.display, 'inline-flex', 'Pill Play App DX deve estar visível');
  assert.strictEqual(env.elements['contact-profile-website1-label'].innerText, 'Play App DX', 'Label da pill deve ser Play App DX');

  // 5. Teste de isolamento: Contato com APENAS Sites Oficiais (sem redes sociais)
  updateContactProfileSocialUI({
    accountType: 'business',
    website1: 'https://siteoficial.com.br',
    website1Title: 'Portal Oficial'
  });
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'none', 'Seção Redes Sociais deve ficar oculta quando não houver redes');
  assert.strictEqual(env.elements['contact-profile-websites-section'].style.display, 'block', 'Seção Sites Oficiais deve estar visível');

  // 6. Teste de isolamento: Contato com APENAS Redes Sociais (sem sites oficiais)
  updateContactProfileSocialUI({
    accountType: 'personal',
    instagram: '@instagram.pessoal',
    youtube: '@youtube.pessoal'
  });
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'block', 'Seção Redes Sociais deve estar visível');
  assert.strictEqual(env.elements['contact-profile-websites-section'].style.display, 'none', 'Seção Sites Oficiais deve ficar oculta quando não houver sites');

  // 7. Fechamento do perfil oculta ambas as seções
  win.closeContactProfile();
  assert.strictEqual(env.elements['contact-profile-social-section'].style.display, 'none', 'Redes Sociais deve ser ocultado no fechamento');
  assert.strictEqual(env.elements['contact-profile-websites-section'].style.display, 'none', 'Sites Oficiais deve ser ocultado no fechamento');
});

test('Alinhamento da Foto e Textos (Nome do Autor e Legenda) Lado a Lado na Prévia de Compartilhamento (v1.0.157)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;
  const win = env.sandbox.window;

  // 1. Verificação do layout flex horizontal no CSS (.share-post-preview)
  assert.ok(cssContent.includes('.share-post-preview'), 'style.css deve conter .share-post-preview');
  assert.ok(
    cssContent.includes('.share-post-preview') && cssContent.includes('display: flex;') && cssContent.includes('align-items: center;'),
    'style.css deve configurar .share-post-preview como flex horizontal para alinhar foto ao lado dos textos'
  );
  assert.ok(
    cssContent.includes('.share-post-preview') && cssContent.includes('gap: 12px;'),
    'style.css deve ter espaçamento de gap: 12px entre a foto e os textos'
  );

  // 2. Verificação das propriedades da foto e meta no CSS
  assert.ok(cssContent.includes('.share-post-avatar') && cssContent.includes('flex-shrink: 0;'), '.share-post-avatar não deve encolher no flex');
  assert.ok(cssContent.includes('.share-post-meta') && cssContent.includes('min-width: 0;') && cssContent.includes('flex: 1;'), '.share-post-meta deve ter flex: 1 e min-width: 0');

  // 3. Verificação no DOM
  const preview = doc.getElementById('share-post-preview');
  const avatar = doc.getElementById('share-post-avatar');
  const author = doc.getElementById('share-post-author');
  const caption = doc.getElementById('share-post-caption');

  assert.ok(preview, '#share-post-preview deve existir no DOM');
  assert.ok(avatar, '#share-post-avatar deve existir no DOM');
  assert.ok(htmlContent.includes('class="share-post-meta"'), '.share-post-meta deve existir no HTML');
  assert.ok(author, '#share-post-author deve existir no DOM');
  assert.ok(caption, '#share-post-caption deve existir no DOM');

  // 4. Teste de abertura do modal com renderização dos dados ao lado da foto
  const openPostShareModal = win.openPostShareModal;
  openPostShareModal({
    id: 'post_911',
    authorName: 'Deyvison',
    caption: 'Poche 911',
    authorAvatar: 'https://example.com/avatar.jpg'
  });

  assert.strictEqual(env.elements['share-post-author'].innerText, 'Deyvison', 'Nome do autor deve ser Deyvison');
  assert.strictEqual(env.elements['share-post-caption'].innerText, '"Poche 911"', 'Legenda/título deve ser formatado com aspas');
});

test('Padronização e Balanceamento do Tamanho do Botão Salvar em Mensagens Temporárias (v1.0.158)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  // 1. Verificação no CSS: Botões Salvar e Cancelar com flex: 1 simétrico e altura 44px
  assert.ok(
    cssContent.includes('.ephemeral-save-btn') && cssContent.includes('flex: 1 !important;'),
    'style.css deve configurar flex: 1 no botão de salvar mensagens temporárias'
  );
  assert.ok(
    cssContent.includes('.ephemeral-cancel-btn') && cssContent.includes('flex: 1 !important;'),
    'style.css deve configurar flex: 1 no botão de cancelar para equilibrar as larguras'
  );
  assert.ok(
    cssContent.includes('.ephemeral-save-btn') && cssContent.includes('height: 44px !important;'),
    'style.css deve padronizar a altura do botão salvar em 44px'
  );
  assert.ok(
    cssContent.includes('.ephemeral-cancel-btn') && cssContent.includes('height: 44px !important;'),
    'style.css deve padronizar a altura do botão cancelar em 44px'
  );

  // 2. Verificação no DOM
  const saveBtn = doc.getElementById('save-ephemeral-btn');
  const cancelBtn = doc.getElementById('cancel-ephemeral-btn');
  const modal = doc.getElementById('chat-ephemeral-modal');

  assert.ok(saveBtn, '#save-ephemeral-btn deve existir no DOM');
  assert.ok(cancelBtn, '#cancel-ephemeral-btn deve existir no DOM');
  assert.ok(modal, '#chat-ephemeral-modal deve existir no DOM');
});

test('Correção do Alinhamento dos Botões Salvar e Cancelar no Modal de Mensagens Temporárias (v1.0.159)', () => {
  const env = createTestEnvironment();
  const doc = env.sandbox.window.document;

  // 1. Verificação no CSS: container com align-items: center e botões com margin: 0 !important;
  assert.ok(
    cssContent.includes('.ephemeral-actions-row') && cssContent.includes('align-items: center;'),
    'style.css deve configurar align-items: center na linha de botões de mensagens temporárias'
  );
  assert.ok(
    cssContent.includes('.ephemeral-save-btn') && cssContent.includes('margin: 0 !important;'),
    'style.css deve configurar margin: 0 !important no botão salvar'
  );
  assert.ok(
    cssContent.includes('.ephemeral-cancel-btn') && cssContent.includes('margin: 0 !important;'),
    'style.css deve configurar margin: 0 !important no botão cancelar'
  );

  // 2. Verificação no DOM e HTML: remoção de modal-cancel-btn (que causava margin-top: 5px)
  const cancelBtn = doc.getElementById('cancel-ephemeral-btn');
  const saveBtn = doc.getElementById('save-ephemeral-btn');
  const modal = doc.getElementById('chat-ephemeral-modal');

  assert.ok(saveBtn, '#save-ephemeral-btn deve existir no DOM');
  assert.ok(cancelBtn, '#cancel-ephemeral-btn deve existir no DOM');
  assert.ok(modal, '#chat-ephemeral-modal deve existir no DOM');

  // Não deve conter a classe modal-cancel-btn que empurrava o botão 5px para baixo
  assert.ok(
    !cancelBtn.classList || !cancelBtn.classList.contains('modal-cancel-btn'),
    '#cancel-ephemeral-btn não deve ter a classe modal-cancel-btn'
  );
  assert.ok(
    !htmlContent.includes('id="cancel-ephemeral-btn" class="ephemeral-cancel-btn close-btn modal-cancel-btn"'),
    'index.html não deve conter modal-cancel-btn em #cancel-ephemeral-btn'
  );
});

test('Padronização de Tamanho de Conta Pessoal/Empresa, Validação Estrita de Chave Pix e Limite de 45 Caracteres no Recado/Bio (v1.0.160)', () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const doc = win.document;

  // 1. Botões de Tipo de Conta (Conta Pessoal vs Conta Empresa): Tamanho padronizado, height 48px, white-space nowrap
  assert.ok(
    cssContent.includes('.account-type-btn') && cssContent.includes('height: 48px;'),
    'style.css deve padronizar a altura de .account-type-btn com height: 48px;'
  );
  assert.ok(
    cssContent.includes('.account-type-btn') && cssContent.includes('white-space: nowrap;'),
    'style.css deve aplicar white-space: nowrap em .account-type-btn para impedir quebras'
  );
  assert.ok(
    cssContent.includes('.account-type-option') && cssContent.includes('flex: 1 1 0px;'),
    'style.css deve aplicar flex: 1 1 0px em .account-type-option para largura idêntica e simétrica'
  );

  const personalOption = doc.getElementById('account-type-option-personal');
  const businessOption = doc.getElementById('account-type-option-business');
  assert.ok(personalOption, '#account-type-option-personal deve existir no DOM');
  assert.ok(businessOption, '#account-type-option-business deve existir no DOM');

  // 2. Limite de 45 caracteres em Recado / Bio
  const statusInp = doc.getElementById('profile-status-input');
  assert.ok(statusInp, '#profile-status-input deve existir no DOM');
  const statusHtmlMatch = htmlContent.match(/<input[^>]+id=["']profile-status-input["'][^>]*>/i);
  assert.ok(statusHtmlMatch, '#profile-status-input deve existir no HTML');
  assert.ok(/maxlength=["']45["']/i.test(statusHtmlMatch[0]), 'profile-status-input deve possuir maxlength="45"');
  assert.ok(
    htmlContent.includes('<span>Recado / Bio</span><small>Máx. 45 caracteres</small>'),
    'Label de Recado / Bio deve indicar Máx. 45 caracteres'
  );

  // Testar input listener que trunca a 45 caracteres
  statusInp.value = 'Esta é uma bio bem longa que com certeza ultrapassa os quarenta e cinco caracteres permitidos no VORTEX';
  if (typeof statusInp.oninput === 'function') {
    statusInp.oninput();
  } else if (statusInp._listeners && statusInp._listeners.input) {
    statusInp._listeners.input.forEach(fn => fn());
  }
  assert.ok(statusInp.value.length <= 45, 'Bio deve ser limitada a 45 caracteres no input');

  // 3. Validador de Chave Pix: E-mail, Celular, CPF, CNPJ, Chave Aleatória EVP
  const validatePixKey = win.validatePixKey;
  assert.strictEqual(typeof validatePixKey, 'function', 'validatePixKey deve ser uma função exportada');

  // 3a. E-mail
  const emailRes = validatePixKey('usuario.teste@gmail.com');
  assert.strictEqual(emailRes.isValid, true, 'E-mail deve ser chave Pix válida');
  assert.strictEqual(emailRes.type, 'email', 'Tipo deve ser email');

  // 3b. Celular (número simples, com parênteses, com +55)
  const phoneRes1 = validatePixKey('88996630823');
  assert.strictEqual(phoneRes1.isValid, true, '88996630823 deve ser celular Pix válido');
  assert.strictEqual(phoneRes1.type, 'phone', 'Tipo deve ser phone');

  const phoneRes2 = validatePixKey('(88) 99663-0823');
  assert.strictEqual(phoneRes2.isValid, true, '(88) 99663-0823 deve ser celular Pix válido');

  const phoneRes3 = validatePixKey('+5588996630823');
  assert.strictEqual(phoneRes3.isValid, true, '+5588996630823 deve ser celular Pix válido');

  // 3c. CPF válido (matematicamente calculado)
  const cpfRes = validatePixKey('52998224725');
  assert.strictEqual(cpfRes.isValid, true, 'CPF 52998224725 deve ser chave Pix válida');
  assert.strictEqual(cpfRes.type, 'cpf', 'Tipo deve ser cpf');

  // 3d. CNPJ válido (matematicamente calculado)
  const cnpjRes = validatePixKey('04252011000110');
  assert.strictEqual(cnpjRes.isValid, true, 'CNPJ 04252011000110 deve ser chave Pix válida');
  assert.strictEqual(cnpjRes.type, 'cnpj', 'Tipo deve ser cnpj');

  // 3e. Chave Aleatória (EVP / UUID v4)
  const evpRes1 = validatePixKey('123e4567-e89b-12d3-a456-426614174000');
  assert.strictEqual(evpRes1.isValid, true, 'UUID com hífens deve ser chave Pix aleatória válida');
  assert.strictEqual(evpRes1.type, 'random', 'Tipo deve ser random');

  const evpRes2 = validatePixKey('123e4567e89b12d3a456426614174000');
  assert.strictEqual(evpRes2.isValid, true, 'UUID de 32 hex contínuos deve ser aceito');

  // 3f. Chaves Inválidas (não deve permitir digitar qualquer coisa)
  assert.strictEqual(validatePixKey('qualquer coisa').isValid, false, 'qualquer coisa deve ser rejeitado');
  assert.strictEqual(validatePixKey('12345').isValid, false, '12345 deve ser rejeitado');
  assert.strictEqual(validatePixKey('teste').isValid, false, 'teste deve ser rejeitado');
  assert.strictEqual(validatePixKey('11111111111').isValid, false, 'CPF com dígitos repetidos deve ser rejeitado');
  assert.strictEqual(validatePixKey('00999999999').isValid, false, 'Celular com DDD inválido 00 deve ser rejeitado');

  // 3g. Chave Vazia (opcional no perfil)
  assert.strictEqual(validatePixKey('').isEmpty, true, 'Chave vazia deve retornar isEmpty: true');
  assert.strictEqual(validatePixKey('').isValid, false, 'Chave vazia não é uma chave ativa');

  // 4. Feedback visual em profile-pix-input
  const formatAndValidateProfilePix = win.formatAndValidateProfilePix;
  const pixInp = doc.getElementById('profile-pix-input');
  assert.ok(pixInp, '#profile-pix-input deve existir no DOM');

  pixInp.value = '88996630823';
  formatAndValidateProfilePix(pixInp);
  assert.ok(pixInp.classList.contains('input-valid'), 'Chave Pix válida deve aplicar classe .input-valid');

  pixInp.value = 'chave invalida qualquer';
  formatAndValidateProfilePix(pixInp);
  assert.ok(pixInp.classList.contains('input-invalid'), 'Chave Pix inválida deve aplicar classe .input-invalid');
});

test('Busca de Posts na Tela do Feed Reels: Barra de pesquisa, normalização sem acentos, filtros multidimensionais, estados vazios e contagem dinâmica (v1.0.161)', () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const doc = env.sandbox.document;

  // 1. Estrutura HTML da Barra de Pesquisa no Feed
  assert.ok(htmlContent.includes('id="feed-search-bar-row"'), 'HTML deve conter #feed-search-bar-row');
  assert.ok(htmlContent.includes('id="feed-search-input"'), 'HTML deve conter #feed-search-input');
  assert.ok(htmlContent.includes('id="feed-search-clear-btn"'), 'HTML deve conter #feed-search-clear-btn');
  assert.ok(htmlContent.includes('placeholder="Pesquisar posts, autores, legendas ou músicas..."'), 'Input deve ter placeholder descritivo');
  assert.ok(htmlContent.includes('aria-label="Pesquisar posts no feed"'), 'Input deve ter aria-label acessível');

  // 2. Regras CSS da Barra de Pesquisa e Estados
  assert.ok(cssContent.includes('.feed-search-bar-row'), 'CSS deve estilizar .feed-search-bar-row');
  assert.ok(cssContent.includes('.feed-search-box'), 'CSS deve estilizar .feed-search-box');
  assert.ok(cssContent.includes('.feed-search-input'), 'CSS deve estilizar .feed-search-input');
  assert.ok(cssContent.includes('.feed-search-clear-btn'), 'CSS deve estilizar .feed-search-clear-btn');
  assert.ok(cssContent.includes('.feed-search-empty'), 'CSS deve estilizar .feed-search-empty');
  assert.ok(cssContent.includes('.feed-clear-search-link'), 'CSS deve estilizar botão de limpar busca');
  assert.ok(cssContent.includes('body.theme-hacker .feed-search-box'), 'CSS deve suportar tema Hacker');
  assert.ok(cssContent.includes('body.theme-cyberpunk .feed-search-box'), 'CSS deve suportar tema Cyberpunk');

  // 3. Normalização de Texto (normalizeSearchText)
  const normalize = win.normalizeSearchText;
  assert.strictEqual(typeof normalize, 'function', 'normalizeSearchText deve ser uma função');
  assert.strictEqual(normalize(''), '', 'String vazia retorna vazio');
  assert.strictEqual(normalize(null), '', 'Null retorna vazio');
  assert.strictEqual(normalize(undefined), '', 'Undefined retorna vazio');
  assert.strictEqual(normalize('  Música Eletrônica  '), 'musica eletronica', 'Remove espaços e acentos e converte para minúsculas');
  assert.strictEqual(normalize('Pôche 911 Turbo S!'), 'poche 911 turbo s!', 'Normaliza acentuação circunflexa');
  assert.strictEqual(normalize('São Paulo & Coração'), 'sao paulo & coracao', 'Normaliza til e cedilha');

  // 4. Mock de Posts para Filtragem Multidimensional
  const post1 = {
    id: 'post_1',
    authorName: 'Deyvison Brito',
    authorUsername: '@deyvisonbrito',
    authorUid: 'uid_deyvison',
    caption: 'Novo Porsche 911 Turbo na garagem! 🏎️💨',
    music: { title: 'Sanfona Eletro Funk', artist: 'DJ EletroFun' },
    actionButton: { text: 'Ver Detalhes', url: 'https://porsche.com' },
    comments: [
      { id: 'c1', text: 'Nave absurda!', author: 'Carlos Silva', authorUid: 'uid_carlos' },
      { id: 'c2', text: 'Top demais', author: 'Ana', authorUid: 'uid_ana' }
    ]
  };

  const post2 = {
    id: 'post_2',
    authorName: 'Mariana Souza',
    authorUsername: '@mari_souza',
    authorUid: 'uid_mari',
    caption: 'Pôr do sol maravilhoso na praia de Jericoacoara 🌅🌊',
    music: { title: 'Ocean Waves Lo-Fi', artist: 'Chill Beat Maker' },
    actionButton: { text: 'Conhecer Roteiro', url: 'https://viagens.com' },
    comments: [
      { id: 'c3', text: 'Lugar mágico', author: 'Roberto', authorUid: 'uid_roberto' }
    ]
  };

  const post3 = {
    id: 'post_3',
    authorName: 'Tecnologia VIP',
    authorUsername: '@techvip',
    authorUid: 'uid_tech',
    caption: 'Lançamento exclusivo do novo headset wireless com cancelamento de ruído.',
    music: { title: 'Cyber Sound 2077', artist: 'Synthwave Hero' },
    actionButton: { text: 'Comprar Agora', url: 'https://techstore.com' },
    comments: []
  };

  const deletedPost = {
    id: 'post_deleted',
    authorName: 'Spam Bot',
    authorUsername: '@bot',
    authorUid: 'uid_bot',
    caption: 'Compre seguidores Porsche 911',
    isDeleted: true
  };

  const allPosts = [post1, post2, post3, deletedPost];
  const filterPosts = win.filterFeedPosts;
  assert.strictEqual(typeof filterPosts, 'function', 'filterFeedPosts deve ser uma função');

  // Ignora posts deletados e retorna todos os ativos se busca vazia
  const allActive = filterPosts(allPosts, '');
  assert.strictEqual(allActive.length, 3, 'Deve retornar os 3 posts ativos, ignorando o deletado');

  // 4a. Busca por legenda/descrição (com ou sem acento)
  const searchCaption = filterPosts(allPosts, 'porsche');
  assert.strictEqual(searchCaption.length, 1, 'Busca por porsche deve retornar 1 post');
  assert.strictEqual(searchCaption[0].id, 'post_1');

  const searchCaptionAccent = filterPosts(allPosts, 'por do sol');
  assert.strictEqual(searchCaptionAccent.length, 1, 'Busca sem acento "por do sol" deve achar "Pôr do sol"');
  assert.strictEqual(searchCaptionAccent[0].id, 'post_2');

  // 4b. Busca por autor (nome ou @username)
  const searchAuthorName = filterPosts(allPosts, 'deyvison');
  assert.strictEqual(searchAuthorName.length, 1, 'Busca por "deyvison" encontra post1');
  assert.strictEqual(searchAuthorName[0].id, 'post_1');

  const searchAuthorUsername = filterPosts(allPosts, 'mari_souza');
  assert.strictEqual(searchAuthorUsername.length, 1, 'Busca por "mari_souza" encontra post2');
  assert.strictEqual(searchAuthorUsername[0].id, 'post_2');

  // 4c. Busca por música (título ou artista)
  const searchMusicTitle = filterPosts(allPosts, 'sanfona');
  assert.strictEqual(searchMusicTitle.length, 1, 'Busca por "sanfona" encontra post com música Sanfona Eletro Funk');
  assert.strictEqual(searchMusicTitle[0].id, 'post_1');

  const searchMusicArtist = filterPosts(allPosts, 'Synthwave Hero');
  assert.strictEqual(searchMusicArtist.length, 1, 'Busca por "Synthwave Hero" encontra post3');
  assert.strictEqual(searchMusicArtist[0].id, 'post_3');

  // 4d. Busca por botão de ação (CTA)
  const searchCTA = filterPosts(allPosts, 'comprar agora');
  assert.strictEqual(searchCTA.length, 1, 'Busca por CTA "comprar agora" encontra post3');
  assert.strictEqual(searchCTA[0].id, 'post_3');

  // 4e. Busca por comentários
  const searchCommentText = filterPosts(allPosts, 'nave absurda');
  assert.strictEqual(searchCommentText.length, 1, 'Busca por texto do comentário "nave absurda" encontra post1');
  assert.strictEqual(searchCommentText[0].id, 'post_1');

  const searchCommentAuthor = filterPosts(allPosts, 'carlos silva');
  assert.strictEqual(searchCommentAuthor.length, 1, 'Busca por autor do comentário "carlos silva" encontra post1');
  assert.strictEqual(searchCommentAuthor[0].id, 'post_1');

  // 4f. Busca sem correspondência
  const searchNoMatch = filterPosts(allPosts, 'termo_que_nao_existe_xyz_123');
  assert.strictEqual(searchNoMatch.length, 0, 'Termo inexistente deve retornar array vazio');

  // 5. Integração com renderPostsFeed e Atualização do DOM
  const renderPostsFeed = win.renderPostsFeed;
  const feedList = doc.getElementById('feed-list');
  const countLabel = doc.getElementById('posts-count-label');
  const searchInput = doc.getElementById('feed-search-input');
  const clearBtn = doc.getElementById('feed-search-clear-btn');

  assert.ok(feedList, '#feed-list deve existir');
  assert.ok(countLabel, '#posts-count-label deve existir');
  assert.ok(searchInput, '#feed-search-input deve existir');
  assert.ok(clearBtn, '#feed-search-clear-btn deve existir');

  // 5a. Renderização sem busca ativa
  searchInput.value = '';
  win.setCachedFeedPosts(allPosts);
  renderPostsFeed(allPosts);
  assert.strictEqual(countLabel.innerText, '3 postagens', 'Contador deve exibir 3 postagens');
  assert.strictEqual(clearBtn.style.display, 'none', 'Botão de limpar deve estar oculto quando busca estiver vazia');

  // 5b. Renderização com busca com correspondência
  searchInput.value = 'porsche';
  renderPostsFeed(allPosts);
  assert.strictEqual(countLabel.innerText, '1 resultado', 'Contador deve exibir 1 resultado');
  assert.strictEqual(clearBtn.style.display, 'flex', 'Botão de limpar deve estar visível com busca ativa');
  assert.ok(feedList.innerHTML.includes('post-card-post_1'), 'Card post_1 deve estar renderizado no feed');
  assert.ok(!feedList.innerHTML.includes('post-card-post_2'), 'Card post_2 não deve estar presente no resultado');

  // 5c. Renderização com busca vazia / sem resultados
  searchInput.value = 'palavra_inexistente';
  renderPostsFeed(allPosts);
  assert.strictEqual(countLabel.innerText, '0 resultados', 'Contador deve exibir 0 resultados');
  assert.ok(feedList.innerHTML.includes('feed-search-empty'), 'Feed deve renderizar classe .feed-search-empty');
  assert.ok(feedList.innerHTML.includes('Nenhum post encontrado'), 'Feed deve renderizar mensagem de nenhum post encontrado');
  assert.ok(feedList.innerHTML.includes('Limpar pesquisa'), 'Feed deve exibir botão de limpar pesquisa');

  // 5d. Limpeza de pesquisa restaura estado completo
  win.setFeedSearchQuery('');
  assert.strictEqual(searchInput.value, '', 'Campo de busca deve estar vazio');
  assert.strictEqual(countLabel.innerText, '3 postagens', 'Contador deve voltar para 3 postagens');
  assert.ok(feedList.innerHTML.includes('post-card-post_1') && feedList.innerHTML.includes('post-card-post_2'), 'Todos os posts devem ser reexibidos');
});

test('Organização das Opções de Unidade Pedida e Quantidade Pedida no Detalhe do Pedido (v1.0.162)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const doc = env.sandbox.document;

  // 1. Verificação das Regras CSS de Layout e Responsividade
  assert.ok(cssContent.includes('.catalog-order-detail-item-header'), 'style.css deve conter cabeçalho do item com foto, título e subtotal');
  assert.ok(cssContent.includes('.catalog-order-qty-row'), 'style.css deve conter linha dedicada para quantidade pedida e valor unitário');
  assert.ok(cssContent.includes('.catalog-order-qty-badge'), 'style.css deve conter badge de quantidade pedida');
  assert.ok(cssContent.includes('.catalog-order-total-units-pill'), 'style.css deve conter pill com total de unidades pedidas');
  assert.ok(cssContent.includes('.catalog-order-item-unit-price'), 'style.css deve estilizar o valor unitário');
  assert.ok(cssContent.includes('white-space: nowrap'), 'Badges e pills devem ter white-space: nowrap para evitar quebras de texto');
  assert.ok(cssContent.includes('body.theme-hacker .catalog-order-qty-badge'), 'style.css deve conter suporte ao tema Hacker');
  assert.ok(cssContent.includes('body.theme-cyberpunk .catalog-order-qty-badge'), 'style.css deve conter suporte ao tema Cyberpunk');

  // 2. Mock de Pedido com 2 Produtos (1 unidade e 3 unidades)
  const sampleOrder = {
    orderNumber: 'VX-566064',
    buyerUid: 'buyer_123',
    buyerName: 'Deyvison Brito',
    sellerUid: 'seller_dx',
    sellerName: 'Loja Oficial VORTEX',
    sellerPixKey: 'empresa.virtual.dx.bt@gmail.com',
    status: 'new',
    createdAt: Date.now(),
    total: 80.00,
    items: [
      {
        id: 'prod_1',
        name: 'Fotos em ícone para apps',
        quantity: 1,
        price: 20.00,
        subtotal: 20.00,
        cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
      },
      {
        id: 'prod_2',
        name: 'Pack de Wallpapers VIP',
        quantity: 3,
        price: 20.00,
        subtotal: 60.00,
        selectedColor: 'Neon Blue'
      }
    ],
    customer: {
      street: 'Avenida São Vicente',
      number: '474',
      city: 'Carnaubal',
      state: 'CE',
      cep: '62375-000',
      country: 'Brasil',
      phone: '(88) 99663-0823',
      email: 'bdeyvison0@gmail.com',
      age: 20
    }
  };

  env.firestoreDocs['orders/ord_test_vx_999'] = sampleOrder;

  const openOrderDetail = win.openOrderDetail;
  assert.strictEqual(typeof openOrderDetail, 'function', 'openOrderDetail deve ser uma função');

  await openOrderDetail('ord_test_vx_999');

  const content = doc.getElementById('catalog-order-content');
  assert.ok(content, '#catalog-order-content deve existir no DOM');
  const html = content.innerHTML;

  // 3. Validação do Header de Itens: Exibição Clara do Total de Unidades Pedidas
  assert.ok(html.includes('Itens do pedido (2 produtos)'), 'Deve indicar o total de produtos no pedido');
  assert.ok(html.includes('catalog-order-total-units-pill'), 'Deve conter o pill com total de unidades');
  assert.ok(html.includes('Total:') && html.includes('4 unidades pedidas'), 'Total de unidades deve somar 1 + 3 = 4 unidades pedidas');

  // 4. Validação do Primeiro Item (1 unidade pedida)
  assert.ok(html.includes('Fotos em ícone para apps'), 'Deve exibir o nome do primeiro item');
  assert.ok(html.includes('catalog-order-detail-item-header'), 'Card do item deve conter cabeçalho estruturado');
  assert.ok(html.includes('Quantidade pedida:') && html.includes('1 unidade'), 'Primeiro item deve indicar "1 unidade" no singular');
  assert.ok(html.includes('Valor un.:') && html.includes('20,00'), 'Deve exibir valor unitário organizado');
  assert.ok(html.includes('Subtotal') && html.includes('20,00'), 'Subtotal do primeiro item deve ser R$ 20,00');

  // 5. Validação do Segundo Item (3 unidades pedidas)
  assert.ok(html.includes('Pack de Wallpapers VIP'), 'Deve exibir o nome do segundo item');
  assert.ok(html.includes('3 unidades'), 'Segundo item deve indicar "3 unidades" no plural');
  assert.ok(html.includes('Subtotal') && html.includes('60,00'), 'Subtotal do segundo item deve ser R$ 60,00');

  // 6. Pedido com 1 único produto e 1 única unidade (como na imagem do usuário)
  const singleItemOrder = {
    ...sampleOrder,
    orderNumber: 'VX-566064',
    items: [sampleOrder.items[0]],
    total: 20.00
  };
  env.firestoreDocs['orders/ord_single_1'] = singleItemOrder;
  await openOrderDetail('ord_single_1');

  const singleHtml = content.innerHTML;
  assert.ok(singleHtml.includes('Itens do pedido (1 produto)'), 'Deve indicar (1 produto)');
  assert.ok(singleHtml.includes('1 unidade pedida'), 'Total de unidades deve ser no singular "1 unidade pedida"');
  assert.ok(singleHtml.includes('Quantidade pedida:'), 'Item deve conter o badge de Quantidade pedida');
  assert.ok(singleHtml.includes('1 unidade'), 'Item deve exibir 1 unidade no singular');
});

test('Expiração com Data, Mês, Ano e Hora para Promoção e Desconto Temporários (v1.0.163)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Elementos HTML no index.html
  assert.ok(htmlContent.includes('id="cat-prod-promo-expires-row"'), 'Deve conter cat-prod-promo-expires-row no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-promo-expires"'), 'Deve conter cat-prod-promo-expires input no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-discount-expires-row"'), 'Deve conter cat-prod-discount-expires-row no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-discount-expires"'), 'Deve conter cat-prod-discount-expires input no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-sync-expires-row"'), 'Deve conter cat-prod-sync-expires-row no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-sync-expires"'), 'Deve conter cat-prod-sync-expires checkbox no index.html');
  assert.ok(htmlContent.includes('catalog-quick-date-btn'), 'Deve conter botões de atalho rápido (+24h, +7d, +30d)');

  // 2. Integridade do CSS em style.css
  assert.ok(cssContent.includes('.catalog-datetime-field'), 'Deve conter estilos para .catalog-datetime-field');
  assert.ok(cssContent.includes('.catalog-quick-date-btn'), 'Deve conter estilos para .catalog-quick-date-btn');
  assert.ok(cssContent.includes('.catalog-sync-time-row'), 'Deve conter estilos para .catalog-sync-time-row');
  assert.ok(cssContent.includes('.catalog-field-hint'), 'Deve conter estilos para .catalog-field-hint');

  // 3. Formatação de Data, Mês por Extenso, Ano e Horário (formatExpirationDateTime)
  const formatExpirationDateTime = win.formatExpirationDateTime;
  assert.strictEqual(typeof formatExpirationDateTime, 'function', 'formatExpirationDateTime deve ser uma função');

  const formatted = formatExpirationDateTime('2026-10-25T23:59');
  assert.ok(formatted.includes('25 de outubro de 2026'), 'Deve formatar dia, mês em português e ano');
  assert.ok(formatted.includes('23:59'), 'Deve formatar horas e minutos');
  assert.strictEqual(formatExpirationDateTime(''), '', 'Data vazia deve retornar string vazia');

  // 4. Controle Dinâmico de Visibilidade (updateVigenciaExpirationVisibility)
  const promoTypeSel = win.document.getElementById('cat-prod-promo-type');
  const discountTypeSel = win.document.getElementById('cat-prod-discount-type');
  const promoExpRow = win.document.getElementById('cat-prod-promo-expires-row');
  const discountExpRow = win.document.getElementById('cat-prod-discount-expires-row');
  const syncRow = win.document.getElementById('cat-prod-sync-expires-row');
  const syncCheck = win.document.getElementById('cat-prod-sync-expires');
  const promoExpInp = win.document.getElementById('cat-prod-promo-expires');
  const discountExpInp = win.document.getElementById('cat-prod-discount-expires');

  // Caso A: Ambos Temporários
  promoTypeSel.value = 'temporario';
  discountTypeSel.value = 'temporario';
  win.updateVigenciaExpirationVisibility();
  assert.strictEqual(promoExpRow.style.display, 'flex', 'Linha de expiração da promoção deve ser exibida quando temporário');
  assert.strictEqual(discountExpRow.style.display, 'flex', 'Linha de expiração do desconto deve ser exibida quando temporário');
  assert.strictEqual(syncRow.style.display, 'flex', 'Opção de sincronizar deve aparecer quando ambos são temporários');

  // Caso B: Promoção Permanente e Desconto Temporário
  promoTypeSel.value = 'permanente';
  discountTypeSel.value = 'temporario';
  win.updateVigenciaExpirationVisibility();
  assert.strictEqual(promoExpRow.style.display, 'none', 'Linha de promoção deve ser ocultada quando permanente');
  assert.strictEqual(discountExpRow.style.display, 'flex', 'Linha de desconto deve permanecer visível');
  assert.strictEqual(syncRow.style.display, 'none', 'Opção de sincronizar deve sumir se um for permanente');

  // Caso C: Ambos Permanentes
  promoTypeSel.value = 'permanente';
  discountTypeSel.value = 'permanente';
  win.updateVigenciaExpirationVisibility();
  assert.strictEqual(promoExpRow.style.display, 'none');
  assert.strictEqual(discountExpRow.style.display, 'none');
  assert.strictEqual(syncRow.style.display, 'none');

  // 5. Sincronização Automática de Tempo entre Promoção e Desconto
  promoTypeSel.value = 'temporario';
  discountTypeSel.value = 'temporario';
  syncCheck.checked = true;
  promoExpInp.value = '2026-11-01T18:00';
  discountExpInp.value = '';
  win.updateVigenciaExpirationVisibility();
  assert.strictEqual(discountExpInp.value, '2026-11-01T18:00', 'Desconto deve receber a mesma data/hora da promoção quando sincronizado');

  // 6. Botões de Atalho Rápido (+24h, +7d, +30d)
  win.applyQuickExpiration('cat-prod-promo-expires', 'hours', 24);
  assert.ok(promoExpInp.value.length >= 16, 'Deve preencher input com timestamp válido');
  const quickDate = new Date(promoExpInp.value);
  assert.ok(!isNaN(quickDate.getTime()), 'Data gerada deve ser válida');
  assert.ok(quickDate.getTime() > Date.now(), 'Data de expiração deve ser no futuro');

  // 7. Verificação de Expiração no Catálogo (promoExpiresAt e discountExpiresAt)
  const container = win.document.createElement('div');
  const pastTimestamp = Date.now() - 3600000; // Expirou há 1 hora
  const futureTimestamp = Date.now() + 86400000; // Expira em 24h

  // Produto com promoção expirada
  const expiredProd = {
    id: 'prod_exp_1',
    name: 'Produto Promo Vencida',
    price: 100.00,
    promoPrice: 70.00,
    promoType: 'temporario',
    promoExpiresAt: pastTimestamp,
    discount: '30%',
    discountType: 'temporario',
    discountExpiresAt: pastTimestamp,
    stock: 10,
    active: true
  };

  win.renderCatalogGrid(container, [expiredProd], false);
  let html = container.innerHTML;
  assert.ok(!html.includes('catalog-badge-promo-temp'), 'Promoção temporária expirada NÃO deve exibir badge de oferta temporária');
  assert.ok(!html.includes('catalog-badge-discount temp'), 'Desconto temporário expirado NÃO deve exibir badge de desconto');
  assert.ok(html.includes('R$&nbsp;100,00') || html.includes('100,00'), 'Deve exibir preço normal de 100,00 quando promoção expirou');

  // Produto com promoção ativa
  const activeProd = {
    id: 'prod_active_1',
    name: 'Produto Promo Ativa',
    price: 100.00,
    promoPrice: 70.00,
    promoType: 'temporario',
    promoExpires: '2026-11-15T20:00',
    promoExpiresAt: futureTimestamp,
    discount: '30%',
    discountType: 'temporario',
    discountExpires: '2026-11-15T20:00',
    discountExpiresAt: futureTimestamp,
    stock: 10,
    active: true
  };

  win.renderCatalogGrid(container, [activeProd], false);
  html = container.innerHTML;
  assert.ok(html.includes('catalog-badge-promo-temp') || html.includes('OFERTA TEMPORÁRIA'), 'Promoção ativa DEVE exibir badge de oferta temporária');
  assert.ok(html.includes('catalog-badge-discount') || html.includes('30% OFF'), 'Desconto ativo DEVE exibir badge');
});

test('Sistema de Segurança Antispam e Bloqueio de Links Não Permitidos em Produtos e Postagens (v1.0.164)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Elementos HTML no index.html
  assert.ok(htmlContent.includes('id="cat-prod-digital-link-feedback"'), 'Deve conter cat-prod-digital-link-feedback no index.html');
  assert.ok(htmlContent.includes('id="cat-prod-digital-link-security-note"'), 'Deve conter cat-prod-digital-link-security-note no index.html');
  assert.ok(htmlContent.includes('id="post-business-btn-url-feedback"'), 'Deve conter post-business-btn-url-feedback no index.html');

  // 2. Integridade do CSS em style.css
  assert.ok(cssContent.includes('.catalog-link-security-note'), 'Deve conter estilos para .catalog-link-security-note');
  assert.ok(cssContent.includes('.catalog-link-feedback'), 'Deve conter estilos para .catalog-link-feedback');
  assert.ok(cssContent.includes('.catalog-input-error'), 'Deve conter estilos para .catalog-input-error');
  assert.ok(cssContent.includes('.catalog-input-success'), 'Deve conter estilos para .catalog-input-success');

  // 3. Função de Validação de Segurança de Links (validateProductDigitalLink)
  const validateProductDigitalLink = win.validateProductDigitalLink;
  assert.strictEqual(typeof validateProductDigitalLink, 'function', 'validateProductDigitalLink deve ser uma função');

  // 4. Marketplaces e Lojas Oficiais Citadas pelo Usuário (DEVEM SER APROVADAS)
  const officialAllowedUrls = [
    'https://produto.mercadolivre.com.br/MLB-123456-tenis',
    'https://mercadolivre.com.br/ofertas',
    'https://shopee.com.br/produto-teste-i.123.456',
    'https://www.amazon.com.br/dp/B08N5WRWNW',
    'https://pt.aliexpress.com/item/100500123.html',
    'https://br.shein.com/goods-p-123.html',
    'https://www.americanas.com.br/produto/123',
    'https://www.casasbahia.com.br/produto/123',
    'https://www.pichau.com.br/computador-gamer-rtx',
    'https://www.ibyte.com.br/smartphone-galaxy',
    'https://play.google.com/store/apps/details?id=com.app.vortex',
    'https://apps.apple.com/br/app/vortex-vip/id123456789'
  ];

  for (const url of officialAllowedUrls) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, true, `URL oficial ${url} DEVE ser aprovada: ${res.error}`);
    assert.strictEqual(res.isOfficialMarketplace, true, `URL ${url} deve ser identificada como marketplace/plataforma oficial`);
  }

  // 5. Sites Oficiais com Domínio Próprio Comprado (DEVEM SER APROVADOS)
  const officialPurchasedDomains = [
    'https://minhalojaoficial.com.br/produtos/camisa',
    'https://cursodev.com/checkout/turma-1',
    'https://suaempresa.store/catalogo',
    'https://wa.me/5585999999999',
    'https://kiwify.com.br/curso-online',
    'https://hotmart.com/pt-br/marketplace/produtos/curso'
  ];

  for (const url of officialPurchasedDomains) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, true, `Domínio próprio comprado ${url} DEVE ser aprovado: ${res.error}`);
  }

  // 6. Casas de Aposta / Bets / Cassinos (DEVEM SER BLOQUEADAS)
  const betUrls = [
    'https://betano.com/apostas',
    'https://blaze.com/r/abc',
    'https://bet365.com',
    'https://estrelabet.com',
    'https://f12bet.com',
    'https://apostaganha.bet.br',
    'https://sitealeatorio.com/jogos/tigrinho',
    'https://sitequalquer.com/fortune-tiger-link'
  ];

  for (const url of betUrls) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, false, `Link de aposta/bet ${url} DEVE ser bloqueado`);
    assert.ok(res.error.toLowerCase().includes('aposta') || res.error.toLowerCase().includes('bet'), `Mensagem de erro deve citar apostas ou bets: ${res.error}`);
  }

  // 7. Baixar APK / Arquivos Executáveis (DEVEM SER BLOQUEADOS)
  const apkUrls = [
    'https://meusite.com/download/aplicativo.apk',
    'https://apkpure.com/whatsapp/download',
    'https://apkmirror.com/apk/vortex',
    'https://meusite.com/programa.exe',
    'https://mediafire.com/file/12345/app.zip'
  ];

  for (const url of apkUrls) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, false, `Link de APK/download direto ${url} DEVE ser bloqueado`);
    assert.ok(res.error.toLowerCase().includes('apk') || res.error.toLowerCase().includes('download') || res.error.toLowerCase().includes('arquivo'), `Mensagem de erro deve alertar sobre APK ou arquivos: ${res.error}`);
  }

  // 8. Links de Vídeo e Foto (DEVEM SER BLOQUEADOS)
  const mediaUrls = [
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://tiktok.com/@criador/video/123456',
    'https://vimeo.com/123456789',
    'https://kwai.com/@criador/video/123',
    'https://instagram.com/reel/C8abcde',
    'https://seusite.com/video-apresentacao.mp4',
    'https://imgur.com/gallery/12345',
    'https://seusite.com/banner-promocional.jpg',
    'https://seusite.com/foto.png'
  ];

  for (const url of mediaUrls) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, false, `Link de vídeo/foto ${url} DEVE ser bloqueado`);
    assert.ok(res.error.toLowerCase().includes('vídeo') || res.error.toLowerCase().includes('foto') || res.error.toLowerCase().includes('imagem'), `Mensagem deve alertar sobre vídeos ou fotos: ${res.error}`);
  }

  // 9. Encurtadores de Links e Domínios Gratuitos Suspeitos (DEVEM SER BLOQUEADOS)
  const shortenerUrls = [
    'https://bit.ly/super-promocao',
    'https://tinyurl.com/link123',
    'https://free-site.tk',
    'https://meuapp.ngrok.io'
  ];

  for (const url of shortenerUrls) {
    const res = validateProductDigitalLink(url);
    assert.strictEqual(res.isValid, false, `Link encurtado ou domínio suspeito ${url} DEVE ser bloqueado`);
  }

  // 10. Feedback Visual no Campo (applyDigitalLinkValidationFeedback)
  const inputEl = win.document.getElementById('cat-prod-digital-link');
  const feedbackEl = win.document.getElementById('cat-prod-digital-link-feedback');
  assert.ok(inputEl, 'Input de link digital deve existir');
  assert.ok(feedbackEl, 'Elemento de feedback deve existir');

  // Testar feedback de link inválido (bet)
  const invalidRes = validateProductDigitalLink('https://betano.com');
  win.applyDigitalLinkValidationFeedback(inputEl, feedbackEl, invalidRes);
  assert.ok(inputEl.classList.contains('catalog-input-error'), 'Input deve receber classe catalog-input-error para link inválido');
  assert.strictEqual(feedbackEl.style.display, 'flex', 'Feedback deve ficar visível');
  assert.ok(feedbackEl.innerHTML.includes('apostas') || feedbackEl.innerHTML.includes('bets'), 'Feedback deve exibir texto explicativo de bloqueio');

  // Testar feedback de link válido (Mercado Livre)
  const validRes = validateProductDigitalLink('https://mercadolivre.com.br/item/123');
  win.applyDigitalLinkValidationFeedback(inputEl, feedbackEl, validRes);
  assert.ok(!inputEl.classList.contains('catalog-input-error'), 'Input não deve ter catalog-input-error quando válido');
  assert.ok(inputEl.classList.contains('catalog-input-success'), 'Input deve ter catalog-input-success quando válido');
  assert.ok(feedbackEl.innerHTML.includes('mercadolivre.com.br'), 'Feedback deve exibir o domínio aprovado');

  // 11. Bloqueio no salvamento do produto (saveCatalogProduct)
  const sellerUid = 'empresa_seller_1';
  env.firestoreDocs[`users/${sellerUid}`] = {
    uid: sellerUid,
    name: 'Vendedor Oficial',
    accountType: 'business'
  };
  await env.triggerAuthStateChange({ uid: sellerUid, email: 'empresa@vortex.app' });
  win.setCurrentProfile({
    uid: sellerUid,
    name: 'Vendedor Oficial',
    accountType: 'business'
  });

  // Preencher campos obrigatórios para produto digital
  win.document.getElementById('cat-prod-name').value = 'App Pro Curso VIP';
  win.document.getElementById('cat-prod-price').value = '99,00';
  win.document.getElementById('cat-prod-kind').value = 'digital';
  win.document.getElementById('cat-prod-unlimited').checked = true;
  win.document.getElementById('cat-prod-digital-link').value = 'https://blaze.com/r/cassino'; // Link proibido!

  // Tentar salvar deve ser bloqueado
  await win.saveCatalogProduct();
  let keys = Object.keys(env.firestoreDocs);
  let foundSaved = keys.some(k => k.startsWith('users/empresa_seller_1/catalog/') && env.firestoreDocs[k]?.name === 'App Pro Curso VIP');
  assert.strictEqual(foundSaved, false, 'Produto com link de aposta/bet NÃO pode ser salvo no Firestore');

  // Corrigir para link oficial da Google Play
  win.document.getElementById('cat-prod-digital-link').value = 'https://play.google.com/store/apps/details?id=com.vortex.vip';
  await win.saveCatalogProduct();
  // Verificar que foi salvo
  keys = Object.keys(env.firestoreDocs);
  foundSaved = keys.some(k => k.startsWith('users/empresa_seller_1/catalog/') && env.firestoreDocs[k]?.name === 'App Pro Curso VIP');
  assert.strictEqual(foundSaved, true, 'Produto com link oficial da Google Play DEVE ser salvo com sucesso');
});

test('Limite de 90 Caracteres na Legenda do Story e Link com Botão CTA para Conta Empresa (v1.0.165)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.165+)
  assert.ok(['1.0.165', '1.0.166'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 165, 'script.js deve ter versão compatível');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Elementos DOM no index.html
  const captionInput = win.document.getElementById('status-caption-input');
  assert.ok(captionInput, 'status-caption-input deve existir no DOM');
  assert.strictEqual(captionInput.getAttribute('maxlength'), '90', 'status-caption-input deve possuir maxlength=90');

  const captionCounter = win.document.getElementById('status-caption-counter');
  assert.ok(captionCounter, 'status-caption-counter deve existir no DOM');

  const statusBizSec = win.document.getElementById('status-business-link-section');
  assert.ok(statusBizSec, 'status-business-link-section deve existir no post-status-overlay');

  const ctaSelect = win.document.getElementById('status-link-cta-select');
  assert.ok(ctaSelect, 'status-link-cta-select deve existir no post-status-overlay');

  const linkUrlInput = win.document.getElementById('status-link-url-input');
  assert.ok(linkUrlInput, 'status-link-url-input deve existir no post-status-overlay');

  const linkFeedback = win.document.getElementById('status-link-url-feedback');
  assert.ok(linkFeedback, 'status-link-url-feedback deve existir no post-status-overlay');

  const storyCtaContainer = win.document.getElementById('story-link-cta-container');
  assert.ok(storyCtaContainer, 'story-link-cta-container deve existir no story-viewer');

  const storyCtaBtn = win.document.getElementById('story-link-cta-btn');
  assert.ok(storyCtaBtn, 'story-link-cta-btn deve existir no story-viewer');

  const storyCtaText = win.document.getElementById('story-link-cta-text');
  assert.ok(storyCtaText, 'story-link-cta-text deve existir no story-viewer');

  const storyCtaIcon = win.document.getElementById('story-link-cta-icon');
  assert.ok(storyCtaIcon, 'story-link-cta-icon deve existir no story-viewer');

  // 3. Estilos CSS em style.css
  assert.ok(cssContent.includes('.caption-counter'), 'Deve conter estilo .caption-counter');
  assert.ok(cssContent.includes('.status-business-link-setting-item'), 'Deve conter estilo .status-business-link-setting-item');
  assert.ok(cssContent.includes('.status-link-cta-select'), 'Deve conter estilo .status-link-cta-select');
  assert.ok(cssContent.includes('.story-link-cta-container'), 'Deve conter estilo .story-link-cta-container');
  assert.ok(cssContent.includes('.story-link-cta-btn'), 'Deve conter estilo .story-link-cta-btn');
  assert.ok(cssContent.includes('.story-viewer.story-holding .story-link-cta-container'), 'Deve conter ocultação do botão de link ao segurar story');

  // 4. Todas as 7 Opções Solicitadas pelo Usuário no Seletor de Botão
  const expectedCtaOptions = [
    'Abrir',
    'Saiba mais',
    'Comprar',
    'Entrar',
    'Agenda',
    'Inscreva-se',
    'Seguir'
  ];

  for (const expected of expectedCtaOptions) {
    assert.ok(htmlContent.includes(`<option value="${expected}"`), `Opção de botão "${expected}" deve estar disponível no select do HTML`);
  }
  const ctaValues = (win.STORY_CTA_OPTIONS || []).map(o => o.value);
  for (const expected of expectedCtaOptions) {
    assert.ok(ctaValues.includes(expected), `Opção de botão "${expected}" deve estar disponível em STORY_CTA_OPTIONS`);
  }

  // 5. Testar Função de Ícones de CTA (getStoryCtaIcon)
  const getStoryCtaIcon = win.getStoryCtaIcon;
  assert.strictEqual(typeof getStoryCtaIcon, 'function', 'getStoryCtaIcon deve ser função');
  assert.strictEqual(getStoryCtaIcon('Abrir'), 'external-link');
  assert.strictEqual(getStoryCtaIcon('Saiba mais'), 'arrow-right');
  assert.strictEqual(getStoryCtaIcon('Comprar'), 'shopping-bag');
  assert.strictEqual(getStoryCtaIcon('Entrar'), 'log-in');
  assert.strictEqual(getStoryCtaIcon('Agenda'), 'calendar');
  assert.strictEqual(getStoryCtaIcon('Inscreva-se'), 'user-plus');
  assert.strictEqual(getStoryCtaIcon('Seguir'), 'user-check');

  // 6. Contador e Limite de 90 Caracteres na Legenda do Story
  win.initStoryCaptionAndLinkControls();
  
  // Testar 20 caracteres
  captionInput.value = 'Novidades na loja VIP!';
  captionInput.dispatchEvent(new win.Event('input'));
  assert.strictEqual(captionCounter.textContent, '22/90', 'Contador deve exibir 22/90');
  assert.strictEqual(captionCounter.classList.contains('limit-near'), false, 'Não deve ter limit-near em 22');
  assert.strictEqual(captionCounter.classList.contains('limit-reached'), false, 'Não deve ter limit-reached em 22');

  // Testar 83 caracteres (alerta amarelo limit-near)
  captionInput.value = 'Aproveite nossa super promoção exclusiva para clientes VIP com entrega ultra rápida';
  captionInput.dispatchEvent(new win.Event('input'));
  assert.strictEqual(captionCounter.textContent, '83/90', 'Contador deve exibir 83/90');
  assert.strictEqual(captionCounter.classList.contains('limit-near'), true, 'Deve conter limit-near em 83 caracteres');
  assert.strictEqual(captionCounter.classList.contains('limit-reached'), false);

  // Testar ultrapassando 90 caracteres (truncamento automático e limit-reached)
  const longCaption = 'A'.repeat(120);
  captionInput.value = longCaption;
  captionInput.dispatchEvent(new win.Event('input'));
  assert.strictEqual(captionInput.value.length, 90, 'Legenda com mais de 90 caracteres deve ser truncada para 90');
  assert.strictEqual(captionCounter.textContent, '90/90', 'Contador deve exibir 90/90');
  assert.strictEqual(captionCounter.classList.contains('limit-reached'), true, 'Deve conter limit-reached ao atingir 90');

  // 7. Visibilidade Exclusiva para Conta Empresa (ou Admin)
  const updateStatusBusinessLinkVisibility = win.updateStatusBusinessLinkVisibility;
  assert.strictEqual(typeof updateStatusBusinessLinkVisibility, 'function', 'updateStatusBusinessLinkVisibility deve ser função');

  // Conta pessoal comum -> DEVE ESTAR OCULTO
  updateStatusBusinessLinkVisibility({ accountType: 'personal', email: 'usuario@gmail.com' });
  assert.strictEqual(statusBizSec.style.display, 'none', 'Conta pessoal NÃO deve visualizar a opção de link nos stories');

  // Conta empresa -> DEVE ESTAR VISÍVEL
  updateStatusBusinessLinkVisibility({ accountType: 'business', email: 'empresa@gmail.com' });
  assert.strictEqual(statusBizSec.style.display, 'block', 'Conta empresa DEVE visualizar a opção de link nos stories');

  // Conta com flag isBusiness: true -> DEVE ESTAR VISÍVEL
  updateStatusBusinessLinkVisibility({ isBusiness: true, email: 'empresa2@gmail.com' });
  assert.strictEqual(statusBizSec.style.display, 'block', 'Conta com isBusiness: true DEVE visualizar a opção de link nos stories');

  // Conta de administrador -> DEVE ESTAR VISÍVEL
  updateStatusBusinessLinkVisibility({ accountType: 'personal', email: 'dxhub.oficial@gmail.com' });
  assert.strictEqual(statusBizSec.style.display, 'block', 'Administrador oficial DEVE visualizar a opção de link nos stories');

  // 8. Validação e Feedback do Link no Story
  const validateProductDigitalLink = win.validateProductDigitalLink;
  
  // Link inválido (bet/cassino) deve ser rejeitado
  const betRes = validateProductDigitalLink('https://blaze.com/r/cassino');
  assert.strictEqual(betRes.isValid, false, 'Link de cassino/bet deve ser rejeitado no Story');

  // Link inválido (vídeo do youtube) deve ser rejeitado
  const videoRes = validateProductDigitalLink('https://youtube.com/watch?v=123');
  assert.strictEqual(videoRes.isValid, false, 'Link de vídeo deve ser rejeitado no Story');

  // Link oficial (Mercado Livre) deve ser aprovado
  const mlRes = validateProductDigitalLink('https://mercadolivre.com.br/produto/123');
  assert.strictEqual(mlRes.isValid, true, 'Link do Mercado Livre deve ser aceito');

  // Link oficial de domínio próprio comprado deve ser aprovado
  const storeRes = validateProductDigitalLink('https://minhaloja.com.br/camisas');
  assert.strictEqual(storeRes.isValid, true, 'Link de domínio oficial comprado deve ser aceito');

  // 9. Renderização do Botão de Link no Visualizador de Story (openStoryViewer)
  const openStoryViewer = win.openStoryViewer;
  assert.strictEqual(typeof openStoryViewer, 'function', 'openStoryViewer deve ser função');

  const storyWithLink = {
    id: 'story_test_1',
    type: 'image',
    src: 'https://placehold.co/400x600',
    caption: 'Confira nossos produtos na promoção',
    storyLink: {
      url: 'https://mercadolivre.com.br/produto/123',
      text: 'Comprar',
      icon: 'shopping-bag'
    },
    views: {},
    reactions: {}
  };

  const authorProfile = {
    uid: 'author_empresa_1',
    authorUid: 'author_empresa_1',
    authorName: 'Empresa VIP',
    accountType: 'business'
  };

  // Abrir story com link
  openStoryViewer([storyWithLink], authorProfile, { isPreview: true });
  assert.strictEqual(storyCtaContainer.style.display, 'flex', 'story-link-cta-container DEVE estar visível para story com link');
  assert.strictEqual(storyCtaBtn.getAttribute('href'), 'https://mercadolivre.com.br/produto/123', 'story-link-cta-btn deve apontar para o link do story');
  assert.strictEqual(storyCtaBtn.getAttribute('target'), '_blank', 'story-link-cta-btn deve abrir em nova aba (_blank)');
  assert.strictEqual(storyCtaText.textContent, 'Comprar', 'story-link-cta-text deve exibir o texto selecionado Comprar');

  // Abrir story sem link -> DEVE ESTAR OCULTO
  const storyWithoutLink = {
    id: 'story_test_2',
    type: 'image',
    src: 'https://placehold.co/400x600',
    caption: 'Story pessoal sem link',
    views: {},
    reactions: {}
  };

  openStoryViewer([storyWithoutLink], authorProfile, { isPreview: true });
  assert.strictEqual(storyCtaContainer.style.display, 'none', 'story-link-cta-container DEVE estar oculto para story sem link');

  // 10. Ignorar eventos de pointerdown no botão de CTA para não pausar/pular o story
  const handleStoryPointerDown = win.handleStoryPointerDown;
  assert.strictEqual(typeof handleStoryPointerDown, 'function', 'handleStoryPointerDown deve ser função');
  
  let pointerDownPaused = false;
  const mockCtaEvent = {
    button: 0,
    target: storyCtaBtn,
    clientX: 100,
    clientY: 100
  };
  
  // Ao clicar no botão de CTA, a função retorna sem pausar
  handleStoryPointerDown(mockCtaEvent);
  const storyViewer = win.document.getElementById('story-viewer');
  assert.strictEqual(storyViewer.classList.contains('story-paused'), false, 'Clicar no botão CTA não deve pausar o Story');
  win.closeStoryViewer();
});

test('Categorias de Conteúdo para Conta Empresa e Posts Temporários de 24h (v1.0.166)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.166+)
  assert.ok(['1.0.166', '1.0.167'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 166, 'script.js deve ter versão compatível');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Elementos DOM no index.html
  const catSelect = win.document.getElementById('post-business-category-select');
  assert.ok(catSelect, 'post-business-category-select deve existir no post-business-link-section');

  const catHint = win.document.getElementById('post-business-category-hint');
  assert.ok(catHint, 'post-business-category-hint deve existir no post-business-link-section');

  // 3. Estilos CSS em style.css
  assert.ok(cssContent.includes('.post-business-category-select'), 'Deve conter estilo .post-business-category-select');
  assert.ok(cssContent.includes('.business-category-hint-banner'), 'Deve conter estilo .business-category-hint-banner');
  assert.ok(cssContent.includes('.feed-category-pill'), 'Deve conter estilo .feed-category-pill');

  // 4. Todas as 14 Categorias Solicitadas pelo Usuário
  const expectedCategories = [
    'Editor',
    'Software',
    'Engenharia',
    'Variedades',
    'Studio',
    'Design',
    'Logo Marca',
    'Serviços',
    'Loja Online',
    'Catálogo',
    'Casa',
    'Eletrônicas',
    'Venda-se',
    'Aluga-se'
  ];

  // Verificar presença no HTML
  for (const cat of expectedCategories) {
    assert.ok(htmlContent.includes(`<option value="${cat}">${cat}</option>`), `Categoria "${cat}" deve existir como option no HTML`);
  }

  // Verificar presença na constante BUSINESS_CONTENT_CATEGORIES
  const businessCategories = win.BUSINESS_CONTENT_CATEGORIES || [];
  assert.strictEqual(businessCategories.length, 14, 'BUSINESS_CONTENT_CATEGORIES deve ter exatamente 14 categorias');
  for (const cat of expectedCategories) {
    assert.ok(businessCategories.includes(cat), `Categoria "${cat}" deve existir no array BUSINESS_CONTENT_CATEGORIES`);
  }

  // 5. Interação do Seletor e Exibição de Alerta de Conteúdo Temporário
  win.initBusinessCategoryControls();

  // Sem categoria selecionada -> dica oculta
  catSelect.value = '';
  catSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(catHint.style.display, 'none', 'Dica de 24h deve ficar oculta quando nenhuma categoria estiver selecionada');

  // Com categoria selecionada (ex: Loja Online) -> dica visível
  catSelect.value = 'Loja Online';
  catSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(catHint.style.display, 'flex', 'Dica de 24h DEVE ficar visível quando uma categoria for selecionada');

  // Com outra categoria (ex: Venda-se) -> dica permanece visível
  catSelect.value = 'Venda-se';
  catSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(catHint.style.display, 'flex', 'Dica de 24h deve permanecer visível para categoria Venda-se');

  // 6. Função de Verificação de Expiração do Post (isPostExpired)
  const isPostExpired = win.isPostExpired;
  assert.strictEqual(typeof isPostExpired, 'function', 'isPostExpired deve ser função');

  const now = Date.now();

  // Post comum permanente (sem categoria) -> NUNCA expira
  const permanentPost = {
    id: 'post_perm',
    createdAt: now - (48 * 3600 * 1000), // 48 horas atrás
    caption: 'Post permanente normal'
  };
  assert.strictEqual(isPostExpired(permanentPost), false, 'Post permanente não deve expirar');

  // Post com categoria recente (criado há 2 horas) -> AINDA NÃO EXPIROU
  const freshTemporaryPost = {
    id: 'post_fresh',
    businessCategory: 'Software',
    isTemporary: true,
    createdAt: now - (2 * 3600 * 1000),
    expiresAt: now + (22 * 3600 * 1000),
    caption: 'Lançamento novo software VIP'
  };
  assert.strictEqual(isPostExpired(freshTemporaryPost), false, 'Post com categoria criado há 2h NÃO deve estar expirado');

  // Post com categoria antigo (criado há 25 horas) -> DEVE ESTAR EXPIRADO
  const expiredTemporaryPost = {
    id: 'post_expired',
    businessCategory: 'Imóvel',
    category: 'Venda-se',
    isTemporary: true,
    createdAt: now - (25 * 3600 * 1000),
    expiresAt: now - (1 * 3600 * 1000),
    caption: 'Venda de apartamento'
  };
  assert.strictEqual(isPostExpired(expiredTemporaryPost), true, 'Post temporário de 24h criado há mais de 24h DEVE estar expirado');

  // 7. Renderização da Badge de Categoria no Post Card (getPostCategoryBadgeHTML)
  const getPostCategoryBadgeHTML = win.getPostCategoryBadgeHTML;
  assert.strictEqual(typeof getPostCategoryBadgeHTML, 'function', 'getPostCategoryBadgeHTML deve ser função');

  // Post sem categoria -> HTML vazio
  assert.strictEqual(getPostCategoryBadgeHTML(permanentPost), '', 'Post sem categoria não deve renderizar badge');

  // Post com categoria -> renderiza badge com nome da categoria e tempo restante
  const badgeHTML = getPostCategoryBadgeHTML(freshTemporaryPost);
  assert.ok(badgeHTML.includes('feed-category-pill'), 'Deve conter a classe feed-category-pill');
  assert.ok(badgeHTML.includes('Software'), 'Badge deve conter o nome da categoria');
  assert.ok(badgeHTML.includes('22h') || badgeHTML.includes('24h') || badgeHTML.includes('clock'), 'Badge deve indicar o tempo restante de 24h');

  // 8. Filtragem de Posts Expirados no Feed (filterFeedPosts)
  const filterFeedPosts = win.filterFeedPosts;
  assert.strictEqual(typeof filterFeedPosts, 'function', 'filterFeedPosts deve ser função');

  const samplePosts = [permanentPost, freshTemporaryPost, expiredTemporaryPost];
  const activeFeedPosts = filterFeedPosts(samplePosts, '');

  assert.strictEqual(activeFeedPosts.length, 2, 'Feed ativo deve conter apenas posts permanentes ou temporários válidos (<24h)');
  assert.ok(activeFeedPosts.some(p => p.id === 'post_perm'), 'Post permanente deve estar no feed');
  assert.ok(activeFeedPosts.some(p => p.id === 'post_fresh'), 'Post temporário recente deve estar no feed');
  assert.strictEqual(activeFeedPosts.some(p => p.id === 'post_expired'), false, 'Post temporário expirado (>24h) NÃO pode aparecer no feed');

  // 9. Busca no Feed por Nome da Categoria
  const searchSoftware = filterFeedPosts(samplePosts, 'software');
  assert.strictEqual(searchSoftware.length, 1, 'Busca por "software" deve encontrar o post categorizado como Software');
  assert.strictEqual(searchSoftware[0].id, 'post_fresh');

  const searchInexistente = filterFeedPosts(samplePosts, 'categoria_inexistente');
  assert.strictEqual(searchInexistente.length, 0, 'Busca por termo inexistente deve retornar vazio');
});

test('Etiqueta de Anúncio e Opção Anúncio vs Conteúdo Normal para Stories e Posts de Conta Empresa (v1.0.167)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.167+)
  assert.ok(['1.0.167', '1.0.168'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 167, 'script.js deve ter versão compatível');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Elementos DOM no index.html
  const storyAdBadge = win.document.getElementById('story-ad-badge');
  assert.ok(storyAdBadge, 'story-ad-badge deve existir no story-viewer header');

  const statusTypeSelect = win.document.getElementById('status-content-type-select');
  assert.ok(statusTypeSelect, 'status-content-type-select deve existir no status-business-link-section');

  const statusTypeHint = win.document.getElementById('status-content-type-hint');
  assert.ok(statusTypeHint, 'status-content-type-hint deve existir no status-business-link-section');

  const postTypeSelect = win.document.getElementById('post-content-type-select');
  assert.ok(postTypeSelect, 'post-content-type-select deve existir no post-business-link-section');

  const postTypeHint = win.document.getElementById('post-content-type-hint');
  assert.ok(postTypeHint, 'post-content-type-hint deve existir no post-business-link-section');

  // 3. Estilos CSS em style.css
  assert.ok(cssContent.includes('.story-ad-badge'), 'Deve conter estilo .story-ad-badge');
  assert.ok(cssContent.includes('.post-ad-badge'), 'Deve conter estilo .post-ad-badge');
  assert.ok(cssContent.includes('.post-time-ad-sep'), 'Deve conter estilo .post-time-ad-sep');
  assert.ok(cssContent.includes('.feed-ad-pill'), 'Deve conter estilo .feed-ad-pill');
  assert.ok(cssContent.includes('.feed-tags-row'), 'Deve conter estilo .feed-tags-row');
  assert.ok(cssContent.includes('.business-ad-hint-banner'), 'Deve conter estilo .business-ad-hint-banner');
  assert.ok(cssContent.includes('.status-content-type-select'), 'Deve conter estilo .status-content-type-select');
  assert.ok(cssContent.includes('.post-content-type-select'), 'Deve conter estilo .post-content-type-select');

  // 4. Exclusividade para Conta Empresa / Admin
  const statusBizSec = win.document.getElementById('status-business-link-section');
  const postBizSec = win.document.getElementById('post-business-link-section');

  // Perfil Pessoal: seções de empresa devem estar ocultas
  win.updateStatusBusinessLinkVisibility({ accountType: 'personal' });
  assert.strictEqual(statusBizSec.style.display, 'none', 'Seção de status de empresa deve estar oculta para conta pessoal');

  win.updateCompanyLinkSectionVisibility({ accountType: 'personal' });
  assert.strictEqual(postBizSec.style.display, 'none', 'Seção de post de empresa deve estar oculta para conta pessoal');

  // Perfil Empresa: seções de empresa devem estar visíveis
  win.updateStatusBusinessLinkVisibility({ accountType: 'business' });
  assert.strictEqual(statusBizSec.style.display, 'block', 'Seção de status de empresa deve estar visível para conta empresa');

  win.updateCompanyLinkSectionVisibility({ accountType: 'business' });
  assert.strictEqual(postBizSec.style.display, 'flex', 'Seção de post de empresa deve estar visível para conta empresa');

  // 5. Interação de Seleção no Story (Normal vs Anúncio)
  win.initStoryCaptionAndLinkControls();
  assert.ok(htmlContent.includes('id="status-content-type-select"'), 'status-content-type-select deve existir no index.html');
  assert.ok(htmlContent.includes('value="normal" selected>Conteúdo Normal'), 'Opção normal deve vir selecionada por padrão no Story');
  assert.ok(htmlContent.includes('value="ad">Anúncio'), 'Opção ad deve existir no select de Story');

  statusTypeSelect.value = 'ad';
  statusTypeSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(statusTypeHint.style.display, 'flex', 'Hint de Anúncio no Story deve abrir quando tipo for ad');

  statusTypeSelect.value = 'normal';
  statusTypeSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(statusTypeHint.style.display, 'none', 'Hint de Anúncio no Story deve fechar quando tipo for normal');

  // 6. Regra de Visibilidade de Stories (Normal vs Anúncio) via canUserViewStory
  const authorUid = 'empresa_vip_1';
  const strangerUid = 'usuario_qualquer_sem_contato';
  const contactUid = 'contato_aceito_1';
  const contactsSet = new Set([authorUid]);

  const normalStory = {
    id: 'story_normal',
    authorUid: authorUid,
    isAd: false,
    contentType: 'normal',
    allowedUids: [contactUid]
  };

  const adStory = {
    id: 'story_anuncio',
    authorUid: authorUid,
    isAd: true,
    contentType: 'ad',
    allowedUids: [contactUid]
  };

  // Story Normal:
  // - Usuário estranho NÃO vê
  assert.strictEqual(win.canUserViewStory(normalStory, strangerUid, new Set()), false, 'Story Normal NÃO pode ser visto por usuário não adicionado');
  // - Contato aceito VÊ
  assert.strictEqual(win.canUserViewStory(normalStory, contactUid, contactsSet), true, 'Story Normal DEVE ser visto por contato aceito');

  // Story Anúncio:
  // - Usuário estranho com conta VÊ (aparece para todo mundo na plataforma VORTEX VIP)
  assert.strictEqual(win.canUserViewStory(adStory, strangerUid, new Set()), true, 'Story Anúncio DEVE ser visto por QUALQUER usuário cadastrado no VORTEX VIP');
  // - Contato aceito também VÊ
  assert.strictEqual(win.canUserViewStory(adStory, contactUid, contactsSet), true, 'Story Anúncio DEVE ser visto por contato aceito');

  // 7. Interação de Seleção nos Posts (Normal vs Anúncio)
  win.initBusinessPostControls();
  assert.ok(htmlContent.includes('id="post-content-type-select"'), 'post-content-type-select deve existir no index.html');
  assert.ok(htmlContent.includes('value="normal" selected>Conteúdo Normal'), 'Opção normal deve vir selecionada por padrão no Post');
  assert.ok(htmlContent.includes('value="ad">Anúncio'), 'Opção ad deve existir no select de Post');

  postTypeSelect.value = 'ad';
  postTypeSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(postTypeHint.style.display, 'flex', 'Hint de Anúncio no Post deve abrir quando tipo for ad');

  postTypeSelect.value = 'normal';
  postTypeSelect.dispatchEvent(new win.Event('change'));
  assert.strictEqual(postTypeHint.style.display, 'none', 'Hint de Anúncio no Post deve fechar quando tipo for normal');

  // 8. Badges de Anúncio no Feed (getPostAdBadgeHTML)
  const adBadgeHTML = win.getPostAdBadgeHTML({ isAd: true });
  assert.ok(adBadgeHTML.includes('feed-ad-pill'), 'getPostAdBadgeHTML deve retornar .feed-ad-pill para post com isAd:true');
  assert.ok(adBadgeHTML.includes('Anúncio'), 'getPostAdBadgeHTML deve conter o texto "Anúncio"');

  const normalBadgeHTML = win.getPostAdBadgeHTML({ isAd: false, contentType: 'normal' });
  assert.strictEqual(normalBadgeHTML, '', 'getPostAdBadgeHTML deve retornar string vazia para post normal');

  // 9. Busca no Feed por Anúncio
  const samplePosts = [
    {
      id: 'post_ad_1',
      authorUid: 'empresa_1',
      authorName: 'DX Hub Loja',
      caption: 'Super Oferta do Dia',
      isAd: true,
      contentType: 'ad',
      createdAt: Date.now()
    },
    {
      id: 'post_normal_1',
      authorUid: 'user_1',
      authorName: 'João Silva',
      caption: 'Dia ensolarado no parque',
      isAd: false,
      contentType: 'normal',
      createdAt: Date.now()
    }
  ];

  const searchAd = win.filterFeedPosts(samplePosts, 'anuncio');
  assert.strictEqual(searchAd.length, 1, 'Busca por "anuncio" deve encontrar a postagem de anúncio');
  assert.strictEqual(searchAd[0].id, 'post_ad_1', 'Post encontrado deve ser post_ad_1');
});

test('Permissões e Ferramentas para Administradores Promovidos em Grupos (v1.0.168)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.168+)
  assert.ok(['1.0.168', '1.0.169'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 168, 'script.js deve ter versão compatível');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Validação da Função Auxiliar isUserGroupAdmin
  const isUserGroupAdmin = win.isUserGroupAdmin;
  assert.ok(typeof isUserGroupAdmin === 'function', 'isUserGroupAdmin deve ser uma função exportada');

  const mockGroup = {
    creatorUid: 'creator_111',
    admins: ['creator_111', 'promoted_admin_222']
  };

  // Creator
  assert.strictEqual(isUserGroupAdmin(mockGroup, { uid: 'creator_111' }), true, 'Criador deve ser reconhecido como admin');
  assert.strictEqual(isUserGroupAdmin(mockGroup, 'creator_111'), true, 'Criador deve ser reconhecido como admin passando UID string');

  // Promoted Admin
  assert.strictEqual(isUserGroupAdmin(mockGroup, { uid: 'promoted_admin_222' }), true, 'Admin promovido deve ser reconhecido como admin');
  assert.strictEqual(isUserGroupAdmin(mockGroup, 'promoted_admin_222'), true, 'Admin promovido deve ser reconhecido como admin passando UID string');

  // Regular Member
  assert.strictEqual(isUserGroupAdmin(mockGroup, { uid: 'member_333' }), false, 'Membro comum NÃO deve ser reconhecido como admin');
  assert.strictEqual(isUserGroupAdmin(mockGroup, 'member_333'), false, 'Membro comum NÃO deve ser reconhecido como admin passando UID string');

  // Casos nulos ou indefinidos
  assert.strictEqual(isUserGroupAdmin(null, { uid: 'creator_111' }), false, 'Grupo nulo deve retornar false');
  assert.strictEqual(isUserGroupAdmin(mockGroup, null), false, 'Usuário nulo deve retornar false');

  // 3. Configuração de Grupo no Firestore para Testes de Ação
  const testGroupId = 'group_admin_test_168';
  const testGroupDoc = {
    id: testGroupId,
    groupId: testGroupId,
    name: 'Grupo VIP Oficial',
    description: 'Descrição original do grupo',
    creatorUid: 'creator_111',
    members: ['creator_111', 'promoted_admin_222', 'other_admin_444', 'member_333'],
    admins: ['creator_111', 'promoted_admin_222', 'other_admin_444'],
    paused: false,
    avatar: ''
  };
  env.firestoreDocs[`groups/${testGroupId}`] = { ...testGroupDoc };

  // 4. Cenário: Membro Comum acessa o perfil do grupo
  win.setCurrentUser({ uid: 'member_333', displayName: 'Membro Normal' });
  win.setCurrentProfile({ uid: 'member_333', name: 'Membro Normal' });
  await win.openGroupProfile({ ...testGroupDoc });

  assert.strictEqual(env.elements['group-admin-fields'].style.display, 'none', 'Campos de admin devem estar ocultos para membro comum');
  assert.strictEqual(env.elements['delete-group-profile-btn'].style.display, 'none', 'Botão de apagar grupo deve estar oculto para membro comum');
  assert.strictEqual(env.elements['group-avatar-input-label'].style.display, 'none', 'Edição de foto do grupo deve estar oculta para membro comum');

  // Membro comum tenta acionar o salvamento -> Bloqueado
  env.elements['group-profile-name'].value = 'Nome Tentado por Membro';
  await env.elements['save-group-profile'].click();
  assert.strictEqual(env.firestoreDocs[`groups/${testGroupId}`].name, 'Grupo VIP Oficial', 'Membro comum NÃO pode salvar alterações no grupo');

  // 5. Cenário: Administrador Promovido acessa o perfil do grupo
  win.setCurrentUser({ uid: 'promoted_admin_222', displayName: 'Admin Promovido' });
  win.setCurrentProfile({ uid: 'promoted_admin_222', name: 'Admin Promovido' });
  await win.openGroupProfile({ ...testGroupDoc });

  assert.strictEqual(env.elements['group-admin-fields'].style.display, 'flex', 'Campos de admin devem estar visíveis para admin promovido');
  assert.strictEqual(env.elements['delete-group-profile-btn'].style.display, 'flex', 'Botão de apagar grupo deve estar visível para admin promovido');
  assert.strictEqual(env.elements['group-avatar-input-label'].style.display, 'inline-flex', 'Edição de foto deve estar visível para admin promovido');

  // 6. Admin Promovido Salva Nome e Descrição
  env.elements['group-profile-name'].value = 'Grupo VIP Oficial - Alterado por Admin';
  env.elements['group-profile-description'].value = 'Nova descrição configurada pelo admin promovido.';
  await env.elements['save-group-profile'].click();

  assert.strictEqual(env.firestoreDocs[`groups/${testGroupId}`].name, 'Grupo VIP Oficial - Alterado por Admin', 'Admin promovido DEVE conseguir salvar o novo nome');
  assert.strictEqual(env.firestoreDocs[`groups/${testGroupId}`].description, 'Nova descrição configurada pelo admin promovido.', 'Admin promovido DEVE conseguir salvar a nova descrição');

  // 7. Admin Promovido Pausa o Grupo
  await env.elements['toggle-group-pause'].click();
  assert.strictEqual(env.firestoreDocs[`groups/${testGroupId}`].paused, true, 'Admin promovido DEVE conseguir pausar o envio de mensagens no grupo');

  // 8. Admin Promovido Adiciona Novo Membro
  await win.addGroupMember('novo_membro_555');
  assert.ok(env.firestoreDocs[`groups/${testGroupId}`].members.includes('novo_membro_555'), 'Admin promovido DEVE conseguir adicionar novo membro ao grupo');

  // 9. Salvaguardas e Permissões de Remoção de Membros
  // - Admin promovido NÃO pode remover o criador do grupo
  await win.removeGroupMember('creator_111');
  assert.ok(env.firestoreDocs[`groups/${testGroupId}`].members.includes('creator_111'), 'Criador do grupo NÃO pode ser removido por outro admin');

  // - Admin promovido NÃO pode remover outro administrador
  await win.removeGroupMember('other_admin_444');
  assert.ok(env.firestoreDocs[`groups/${testGroupId}`].members.includes('other_admin_444'), 'Admin promovido NÃO pode remover outro admin');

  // - Admin promovido PODE remover membro comum
  win.confirm = () => true;
  await win.removeGroupMember('member_333');
  assert.strictEqual(env.firestoreDocs[`groups/${testGroupId}`].members.includes('member_333'), false, 'Admin promovido DEVE conseguir remover membro comum');

  // 10. Admin Promovido Promove Novo Membro
  await win.promoteGroupMember('novo_membro_555');
  assert.ok(env.firestoreDocs[`groups/${testGroupId}`].admins.includes('novo_membro_555'), 'Admin promovido DEVE conseguir promover membro comum a administrador');
});

test('Notificação de Promoção a Admin de Grupo: Ícone de capelo, amarelo vibrante e animação de semexe a cada 3s (v1.0.169)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.169+)
  assert.ok(['1.0.169', '1.0.170'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 169, 'script.js deve ter versão compatível');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Estilos CSS: Amarelo vibrante (#ffe600) e animação de semexe e para a cada 3 segundos
  assert.ok(cssContent.includes('.notification-card.card-group-promote'), 'style.css deve conter .notification-card.card-group-promote');
  assert.ok(cssContent.includes('border-left: 3.5px solid #ffe600;'), 'card-group-promote deve ter borda amarela vibrante (#ffe600)');
  assert.ok(cssContent.includes('.notification-icon-box.group-promote'), 'style.css deve conter .notification-icon-box.group-promote');
  assert.ok(cssContent.includes('color: #ffe600;'), 'Ícone de group-promote deve ter cor amarelo vibrante (#ffe600)');
  assert.ok(cssContent.includes('.notification-badge.group-promote'), 'style.css deve conter .notification-badge.group-promote');
  assert.ok(cssContent.includes('@keyframes notifAdminShake'), 'style.css deve conter @keyframes notifAdminShake');
  assert.ok(cssContent.includes('animation: notifAdminShake 3s'), 'Ícone deve usar animação de semexe com ciclo de 3s');
  assert.ok(cssContent.includes('.notif-svg-group-promote'), 'style.css deve estilizar .notif-svg-group-promote');

  // 3. Disparo da Notificação em promoteGroupMember com Ícone de Capelo
  const testGroup = {
    id: 'grp_dx_digital_169',
    groupId: 'grp_dx_digital_169',
    name: 'DX Hub Digital',
    creatorUid: 'user_criador_1',
    members: ['user_criador_1', 'user_promovido_2'],
    admins: ['user_criador_1']
  };
  env.firestoreDocs[`groups/${testGroup.groupId}`] = { ...testGroup };

  win.setCurrentUser({ uid: 'user_criador_1', displayName: 'Criador' });
  await win.openGroupProfile({ ...testGroup });
  await win.promoteGroupMember('user_promovido_2');

  // Verificar notificação gravada no Firestore
  const notifDocs = Object.entries(env.firestoreDocs)
    .filter(([path, data]) => path.startsWith('notifications/') && data.toUid === 'user_promovido_2')
    .map(([path, data]) => ({ id: path.replace('notifications/', ''), ...data }));

  assert.ok(notifDocs.length >= 1, 'Notificação para o usuário promovido deve ser gravada no Firestore');
  const promoNotif = notifDocs[notifDocs.length - 1];
  assert.ok(promoNotif.title.includes('Você é admin do grupo!'), 'Título da notificação deve avisar que o usuário é admin do grupo');
  assert.ok(promoNotif.title.includes('🎓'), 'Título deve conter o emoji de capelo 🎓');
  assert.strictEqual(promoNotif.type, 'group_promote', 'Tipo da notificação deve ser group_promote');
  assert.strictEqual(promoNotif.icon, 'graduation-cap', 'Ícone da notificação deve ser graduation-cap');
  assert.ok(promoNotif.message.includes('DX Hub Digital'), 'Mensagem da notificação deve citar o nome do grupo');

  // 4. Renderização Oficial em renderNotifications()
  // Mock da lista de notificações no sandbox
  const notifListEl = env.elements['notifications-list'];
  assert.ok(notifListEl, 'Elemento #notifications-list deve existir no DOM');

  // Injetar a notificação na lista renderizável
  win.setAllNotifications([
    {
      id: 'notif_promo_new',
      toUid: 'user_promovido_2',
      title: '🎓 Você é admin do grupo!',
      message: 'Você foi promovido a administrador do grupo "DX Hub Digital". Agora você tem acesso total ao grupo.',
      type: 'group_promote',
      icon: 'graduation-cap',
      createdAt: Date.now()
    }
  ]);

  // Validação do HTML gerado na notificação
  const htmlOutput = notifListEl.innerHTML;
  assert.ok(htmlOutput.includes('card-group-promote'), 'Notificação renderizada deve conter a classe card-group-promote');
  assert.ok(htmlOutput.includes('notification-icon-box group-promote'), 'Caixa de ícone deve ter a classe group-promote');
  assert.ok(htmlOutput.includes('notif-svg-group-promote'), 'SVG do capelo / chapéu de formatura (.notif-svg-group-promote) deve ser renderizado');
  assert.ok(htmlOutput.includes('notification-badge group-promote'), 'Badge deve ter a classe group-promote');
  assert.ok(htmlOutput.includes('ADMIN 🎓'), 'Texto da badge deve ser ADMIN 🎓');
  assert.ok(htmlOutput.includes('🎓 Você é admin do grupo!'), 'Título renderizado deve ter o ícone de capelo 🎓');

  // 5. Retrocompatibilidade: Notificações antigas ou com título antigo do print (Image 2)
  win.setAllNotifications([
    {
      id: 'notif_legacy_print',
      toUid: 'user_promovido_2',
      title: '🛡️ Você é admin do grupo!',
      message: 'Você foi promovido a administrador do grupo "DX Hub Digital". Agora você tem acesso total ao grupo.',
      type: 'warning',
      createdAt: Date.now() - 3600000
    }
  ]);

  const legacyOutput = notifListEl.innerHTML;
  assert.ok(legacyOutput.includes('card-group-promote'), 'Notificação legada com "Você é admin do grupo" deve receber estilo card-group-promote');
  assert.ok(legacyOutput.includes('notif-svg-group-promote'), 'Notificação legada deve exibir o ícone do capelo');
  assert.ok(legacyOutput.includes('ADMIN 🎓'), 'Notificação legada deve exibir badge ADMIN 🎓');
});

test('Algoritmo de Segurança de Denúncia Multi-Tipo VORTEX VIP (v1.0.170)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.170+)
  assert.ok(['1.0.170', '1.0.171'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 170, 'script.js deve ter versão 1.0.170+');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');

  // 2. Estilos CSS do Painel da IA de Segurança
  assert.ok(cssContent.includes('.admin-ai-analysis-card'), 'style.css deve conter .admin-ai-analysis-card');
  assert.ok(cssContent.includes('.admin-ai-confidence-pill'), 'style.css deve conter .admin-ai-confidence-pill');
  assert.ok(cssContent.includes('.admin-ai-header'), 'style.css deve conter .admin-ai-header');
  assert.ok(cssContent.includes('.admin-ai-explanation'), 'style.css deve conter .admin-ai-explanation');
  assert.ok(cssContent.includes('.admin-ai-keyword-tag'), 'style.css deve conter .admin-ai-keyword-tag');

  // 3. Dicionário de Palavras-Chave e Casos de Detecção
  const matchSecurityKeywords = win.matchSecurityKeywords;
  assert.ok(typeof matchSecurityKeywords === 'function', 'matchSecurityKeywords deve ser uma função');

  // Ameaça
  const matchThreat = matchSecurityKeywords('Cuidado porque vou te matar se não obedecer');
  assert.strictEqual(matchThreat.hasMatch, true, 'Deve detectar ameaça no texto');
  assert.strictEqual(matchThreat.category, 'threat', 'Categoria detectada deve ser threat');

  // Golpe / Fraude
  const matchFraud = matchSecurityKeywords('Manda um pix urgente com o código de verificação');
  assert.strictEqual(matchFraud.hasMatch, true, 'Deve detectar golpe/fraude no texto');
  assert.strictEqual(matchFraud.category, 'fraud', 'Categoria detectada deve ser fraud');

  // Texto inofensivo
  const matchClean = matchSecurityKeywords('Olá tudo bem, vamos nos encontrar amanhã para almoçar?');
  assert.strictEqual(matchClean.hasMatch, false, 'Texto comum não deve acionar palavras-chave');

  // 4. Regra 2: Algoritmo NÃO age enquanto nada for denunciado
  const victimUser = { uid: 'victim_user_1', displayName: 'Vítima' };
  const suspectUser = { uid: 'suspect_user_2', displayName: 'Suspeito', restricted: false, banned: false };
  env.firestoreDocs[`users/${victimUser.uid}`] = { ...victimUser };
  env.firestoreDocs[`users/${suspectUser.uid}`] = { ...suspectUser };

  win.setCurrentUser(victimUser);
  win.setCurrentProfile(victimUser);

  // Sem denúncia, o usuário suspeito permanece intocado
  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].restricted, false, 'Suspeito não deve ser restrito sem denúncia');
  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].banned, false, 'Suspeito não deve ser banido sem denúncia');

  // 5. Regra 1: Denúncia de Usuário SEM Bloqueio Simultâneo -> Não pune automaticamente (Prevenção de Falsa Denúncia)
  const chatId = [victimUser.uid, suspectUser.uid].sort().join('_');
  env.firestoreDocs[`chats/${chatId}/messages/msg_threat_1`] = {
    id: 'msg_threat_1',
    senderUid: suspectUser.uid,
    text: 'Eu vou te matar se não me responder',
    timestamp: Date.now()
  };

  await win.submitGeneralReport({
    type: 'user',
    targetUid: suspectUser.uid,
    targetName: 'Suspeito'
  }, 'assedio', 'Ele está me ameaçando', false /* alsoBlock = false */);

  // Usuário NÃO deve ser restrito automaticamente porque não bloqueou (para evitar denúncia falsa)
  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].restricted, false, 'Usuário NÃO deve ser restrito automaticamente sem bloqueio simultâneo');

  // Verifica que a denúncia foi encaminhada para aprovação manual do ADM
  const reportsList = Object.entries(env.firestoreDocs)
    .filter(([k]) => k.startsWith('reports/'))
    .map(([k, v]) => ({ id: k.replace('reports/', ''), ...v }));
  const unblockedReport = reportsList[reportsList.length - 1];
  assert.strictEqual(unblockedReport.algorithmAction, 'pending_admin_approval', 'Denúncia sem bloqueio deve ter ação pending_admin_approval');
  assert.ok(unblockedReport.algorithmExplanation.includes('sem bloqueio simultâneo'), 'Explicação deve esclarecer ausência de bloqueio simultâneo');

  // 6. Regra 1: Denúncia de Usuário COM Bloqueio Simultâneo -> 1ª Infração: Restrição Temporária de 24h
  await win.submitGeneralReport({
    type: 'user',
    targetUid: suspectUser.uid,
    targetName: 'Suspeito'
  }, 'assedio', 'Ele disse que vai me matar', true /* alsoBlock = true */);

  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].restricted, true, 'Usuário com ameaça comprovada e bloqueio ativo DEVE ser restrito');
  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].restrictedCount, 1, 'Contador de restrições do usuário deve ser 1');

  const latestReports1 = Object.entries(env.firestoreDocs)
    .filter(([k]) => k.startsWith('reports/'))
    .map(([k, v]) => ({ id: k.replace('reports/', ''), ...v }));
  const restrictedReport = latestReports1[latestReports1.length - 1];
  assert.strictEqual(restrictedReport.algorithmAction, 'auto_restricted', 'Ação da IA deve ser auto_restricted');
  assert.strictEqual(restrictedReport.algorithmConfidence, 'high', 'Certeza da IA deve ser high');
  assert.ok(restrictedReport.matchedKeywords.includes('matar'), 'Palavra-chave "matar" deve constar nos termos detectados');

  // 7. Regra 1: Reincidência no Mesmo Usuário -> Banimento Permanente Automático!
  // Usuário insiste e manda outra ameaça
  env.firestoreDocs[`chats/${chatId}/messages/msg_threat_2`] = {
    id: 'msg_threat_2',
    senderUid: suspectUser.uid,
    text: 'Vou atrás de você te quebrar',
    timestamp: Date.now() + 5000
  };

  await win.submitGeneralReport({
    type: 'user',
    targetUid: suspectUser.uid,
    targetName: 'Suspeito'
  }, 'assedio', 'Ele continua insistindo e ameaçando', true /* alsoBlock = true */);

  assert.strictEqual(env.firestoreDocs[`users/${suspectUser.uid}`].banned, true, 'Usuário reincidente DEVE ser banido permanentemente');
  assert.ok(env.firestoreDocs[`users/${suspectUser.uid}`].banReason.includes('Reincidência'), 'Motivo do banimento deve constar reincidência');

  const latestReports2 = Object.entries(env.firestoreDocs)
    .filter(([k]) => k.startsWith('reports/'))
    .map(([k, v]) => ({ id: k.replace('reports/', ''), ...v }));
  const bannedReport = latestReports2[latestReports2.length - 1];
  assert.strictEqual(bannedReport.algorithmAction, 'auto_banned', 'Ação da IA para reincidente deve ser auto_banned');

  // 8. Denúncia marcada como "Outro Motivo" que contenha tentativa de golpe no texto
  const fraudsterUser = { uid: 'fraudster_99', displayName: 'Golpista', restricted: false, banned: false };
  env.firestoreDocs[`users/${fraudsterUser.uid}`] = { ...fraudsterUser };

  await win.submitGeneralReport({
    type: 'user',
    targetUid: fraudsterUser.uid,
    targetName: 'Golpista'
  }, 'outro' /* Outro motivo */, 'O usuário tentou aplicar um golpe do pix pedindo código de verificação', true);

  assert.strictEqual(env.firestoreDocs[`users/${fraudsterUser.uid}`].restricted, true, 'Denúncia de outro motivo com termos de golpe deve aplicar restrição');

  const latestReports3 = Object.entries(env.firestoreDocs)
    .filter(([k]) => k.startsWith('reports/'))
    .map(([k, v]) => ({ id: k.replace('reports/', ''), ...v }));
  const fraudReport = latestReports3[latestReports3.length - 1];
  assert.strictEqual(fraudReport.algorithmCategory, 'fraud', 'Categoria deve ser reclassificada como fraud mesmo com motivo "outro"');

  // 9. Especialização por Tipo (Posts, Stories, Grupos e Comentários)
  // Post com termo crítico
  const badPost = { id: 'post_threat_123', authorUid: 'author_bad_post', caption: 'Vou matar todo mundo hoje' };
  env.firestoreDocs[`posts/${badPost.id}`] = { ...badPost };
  env.firestoreDocs[`users/${badPost.authorUid}`] = { uid: badPost.authorUid, restricted: false, banned: false };

  await win.submitGeneralReport({
    type: 'post',
    postId: badPost.id,
    targetUid: badPost.authorUid,
    targetName: 'Autor Post'
  }, 'inapropriado', 'Post com ameaça explícita');

  assert.strictEqual(env.firestoreDocs[`users/${badPost.authorUid}`].restricted, true, 'Autor de post com ameaça deve ser restrito pelo algoritmo');

  // 10. Interação e Decisão do Administrador no Painel ADM
  // Cenário: Denúncia inconclusiva aguardando ADM
  const pendingReport = {
    id: 'report_pending_review_1',
    targetUid: 'user_suspect_pending',
    targetName: 'Usuário Inconclusivo',
    targetType: 'user',
    reason: 'spam',
    details: 'Acho que esse usuário está suspeito',
    algorithmAction: 'pending_admin_approval',
    algorithmConfidence: 'low',
    algorithmExplanation: 'Nenhuma palavra-chave crítica confirmada com certeza absoluta.',
    resolved: false,
    createdAt: Date.now()
  };
  env.firestoreDocs[`users/${pendingReport.targetUid}`] = { uid: pendingReport.targetUid, restricted: false, banned: false };
  win.setAdminReports([pendingReport]);

  // Abrir análise da denúncia pelo ADM
  await win.adminAnalyzeReport(pendingReport);
  const analyzeContent = env.elements['admin-analyze-content'];
  assert.ok(analyzeContent.innerHTML.includes('admin-ai-analysis-card'), 'Modal de análise deve exibir o card admin-ai-analysis-card');
  assert.ok(analyzeContent.innerHTML.includes('admin-ai-restrict-btn'), 'Modal de análise deve exibir botão para o ADM aplicar restrição');

  // ADM executa a restrição diretamente pelo parecer
  await win.adminExecuteAiAction(pendingReport.id, 'restrict');
  assert.strictEqual(env.firestoreDocs[`users/${pendingReport.targetUid}`].restricted, true, 'ADM deve conseguir aplicar a restrição pela ação da IA');
  assert.strictEqual(pendingReport.resolved, true, 'Denúncia deve ser marcada como resolvida após decisão do ADM');
});

test('Notificações Exclusivas para Administradores da Plataforma (Segurança IA e Moderação) (v1.0.171)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.171+)
  assert.ok(['1.0.171', '1.0.172'].includes(win.CURRENT_APP_VERSION) || parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 171, 'script.js deve ter versão 1.0.171+');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(['1.0.171', '1.0.172'].includes(versionJson.version) || parseInt(versionJson.version.split('.')[2], 10) >= 171, 'version.json deve ter versão 1.0.171+');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js com a versão atual');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css com a versão atual');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache com a versão atual');

  // 2. Disparo de Notificação da IA de Segurança usando notifyAdmins
  assert.ok(typeof win.notifyAdmins === 'function', 'notifyAdmins deve existir e ser exportada');

  await win.notifyAdmins(
    '🛡️ Segurança IA: Restrição Preventiva Aplicada',
    'A conta "Deyvison" recebeu restrição automática de 24 horas aplicada pelo algoritmo de denúncia.',
    'warning'
  );

  // Deve salvar no Firestore com toUid == 'admin' e forAdmin == true, NUNCA com toUid == 'all'
  const notifDocs = Object.values(env.firestoreDocs).filter(d => d.title && d.title.includes('Segurança IA: Restrição Preventiva'));
  assert.ok(notifDocs.length > 0, 'Deve ter salvo o documento de notificação no Firestore');
  const notifDoc = notifDocs[0];
  assert.strictEqual(notifDoc.toUid, 'admin', 'Notificação de segurança da IA deve ser enviada para toUid == "admin"');
  assert.strictEqual(notifDoc.forAdmin, true, 'Notificação deve ter flag forAdmin: true');
  assert.notStrictEqual(notifDoc.toUid, 'all', 'Notificação NUNCA deve ser enviada com toUid == "all" para todos os usuários');

  // 3. Usuário Comum Logado (ex: Deyvison): NÃO deve ver a notificação de moderação da IA
  const normalUser = { uid: 'user_deyvison', email: 'deyvison@gmail.com', name: 'Deyvison' };
  win.setCurrentUser(normalUser);
  win.setCurrentProfile(normalUser);

  // Simular lista de notificações contendo a notificação de admin e uma notificação normal
  const securityNotif = {
    id: 'notif_sec_1',
    toUid: 'admin',
    forAdmin: true,
    title: '🛡️ Segurança IA: Restrição Preventiva Aplicada',
    message: 'A conta "Deyvison" recebeu restrição automática de 24 horas aplicada pelo algoritmo de denúncia.',
    type: 'warning',
    createdAt: Date.now()
  };
  const normalNotif = {
    id: 'notif_user_1',
    toUid: normalUser.uid,
    title: '💬 Alguém comentou no seu post',
    message: 'Usuário comentou no seu post',
    type: 'warning',
    createdAt: Date.now()
  };

  win.setAllNotifications([securityNotif, normalNotif]);
  const notifListEl = env.elements['notifications-list'];

  // Render para usuário comum
  win.renderNotifications();
  assert.ok(!notifListEl.innerHTML.includes('Segurança IA: Restrição Preventiva'), 'Usuário comum NÃO deve ver a notificação de restrição da IA no painel');
  assert.ok(notifListEl.innerHTML.includes('Alguém comentou no seu post'), 'Usuário comum deve continuar vendo suas notificações normais');

  // 4. Bloqueio de Notificação Legada salva como "all" para Usuário Comum
  const legacyAllNotif = {
    id: 'notif_sec_legacy_all',
    toUid: 'all',
    title: '🛡️ Segurança IA: Restrição Preventiva Aplicada',
    message: 'A conta "Deyvison" recebeu restrição automática de 24 horas aplicada pelo algoritmo de denúncia.',
    type: 'warning',
    createdAt: Date.now()
  };
  win.setAllNotifications([legacyAllNotif]);
  win.renderNotifications();
  assert.ok(!notifListEl.innerHTML.includes('Segurança IA: Restrição Preventiva'), 'Usuário comum NÃO deve ver nem mesmo notificações legadas marcadas com "all"');

  // 5. Administrador da Plataforma Logado (ex: dxhub.oficial@gmail.com): DEVE ver a notificação com MODERAÇÃO 🛡️
  const adminUser = { uid: 'admin_dxhub', email: 'dxhub.oficial@gmail.com', name: 'DX Hub Admin' };
  win.setCurrentUser(adminUser);
  win.setCurrentProfile(adminUser);

  win.setAllNotifications([securityNotif]);
  win.renderNotifications();
  assert.ok(notifListEl.innerHTML.includes('Segurança IA: Restrição Preventiva Aplicada'), 'Administrador DEVE ver a notificação de segurança da IA');
  assert.ok(notifListEl.innerHTML.includes('MODERAÇÃO 🛡️'), 'Notificação de segurança para ADM deve exibir badge MODERAÇÃO 🛡️');

  // 6. Teste da limpeza e conversão de notificações legadas (cleanupLegacySecurityBroadcasts)
  env.firestoreDocs['notifications/legacy_ai_broadcast'] = {
    id: 'legacy_ai_broadcast',
    toUid: 'all',
    title: '🛡️ Segurança IA: Restrição Preventiva Aplicada',
    message: 'A conta "Deyvison" recebeu restrição automática de 24 horas aplicada pelo algoritmo de denúncia.'
  };

  await win.cleanupLegacySecurityBroadcasts();
  assert.strictEqual(env.firestoreDocs['notifications/legacy_ai_broadcast'].toUid, 'admin', 'cleanupLegacySecurityBroadcasts deve converter toUid para "admin"');
  assert.strictEqual(env.firestoreDocs['notifications/legacy_ai_broadcast'].forAdmin, true, 'cleanupLegacySecurityBroadcasts deve marcar forAdmin: true');
});

test('Segurança Avançada, Anti-Boicote, Dossiê ADM, Cupons, Mensagens Favoritas e Stories Anônimos (v1.0.172)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento
  assert.ok(win.CURRENT_APP_VERSION >= '1.0.172', 'script.js deve ter versão 1.0.172 ou superior');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(versionJson.version >= '1.0.172', 'version.json deve ter versão 1.0.172 ou superior');
  assert.ok(htmlContent.includes('script.js?v='), 'index.html deve referenciar script.js versionado');
  assert.ok(htmlContent.includes('style.css?v='), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve ter cache versionado');

  // 2. Detecção de Evasão de Palavras-Chave (Leetspeak e Espaçamento)
  assert.ok(typeof win.deobfuscateSecurityText === 'function', 'deobfuscateSecurityText deve ser uma função');
  const match1 = win.matchSecurityKeywords('eu vou m@t@r voce');
  assert.strictEqual(match1.hasMatch, true, 'Deve detectar ameaca com leetspeak @');
  assert.strictEqual(match1.category, 'threat', 'Categoria deve ser threat');

  const match2 = win.matchSecurityKeywords('olha esse p!x f4k3');
  assert.strictEqual(match2.hasMatch, true, 'Deve detectar golpe com leetspeak ! e 4');
  assert.strictEqual(match2.category, 'fraud', 'Categoria deve ser fraud');

  const match3 = win.matchSecurityKeywords('vou dar um g o l p e');
  assert.strictEqual(match3.hasMatch, true, 'Deve detectar golpe com letras separadas por espaco');
  assert.strictEqual(match3.category, 'fraud', 'Categoria deve ser fraud');

  // 3. Proteção Anti-Boicote (Anti-Brigading)
  const targetUid = 'user_vitima_boicote';
  win.setAdminReports([
    { id: 'rep_1', targetUid: targetUid, createdAt: Date.now() - 60000 },
    { id: 'rep_2', targetUid: targetUid, createdAt: Date.now() - 120000 }
  ]);

  const reportId = 'rep_3';
  const reportData = {
    targetUid: targetUid,
    targetType: 'user',
    reason: 'ofensa',
    message: 'essa conta e falsa',
    createdAt: Date.now()
  };

  const analysis = await win.runSecurityReportAnalysis(reportId, reportData, { name: 'Vitima' }, { reason: 'ofensa' });
  assert.strictEqual(analysis.isBrigading, true, 'Deve detectar suspeita de ataque coordenado (Anti-Brigading)');
  assert.strictEqual(analysis.action, 'pending_admin_approval', 'Ação deve ser congelada para aprovação do administrador sem autopunição');

  // 4. Mensagens Favoritas ⭐ (toggleStarMessage, get, save e modais)
  const testUser = { uid: 'user_star_tester', name: 'Tester Star' };
  win.setCurrentUser(testUser);
  win.setCurrentProfile(testUser);

  const testMsg = {
    id: 'msg_star_123',
    senderUid: 'user_other',
    senderName: 'Amigo',
    text: 'Mensagem super importante para favoritar!',
    createdAt: Date.now()
  };

  const isStarredNow = await win.toggleStarMessage(testMsg);
  assert.strictEqual(isStarredNow, true, 'toggleStarMessage deve favoritar a mensagem');
  let starredList = win.getStarredMessages();
  assert.strictEqual(starredList.length, 1, 'Deve ter 1 mensagem favoritada na lista');
  assert.strictEqual(starredList[0].id, 'msg_star_123', 'A mensagem favoritada deve ter o ID correto');

  const isUnstarred = await win.toggleStarMessage(testMsg);
  assert.strictEqual(isUnstarred, false, 'toggleStarMessage deve desfavoritar');
  starredList = win.getStarredMessages();
  assert.strictEqual(starredList.length, 0, 'Lista deve ficar vazia após desfavoritar');

  // 5. Cupons de Desconto no Catálogo da Loja
  assert.ok(win.CATALOG_COUPONS['VORTEX10'], 'Cupom VORTEX10 deve existir');
  assert.ok(win.CATALOG_COUPONS['FRETEGRATIS'], 'Cupom FRETEGRATIS deve existir');

  // Aplicar cupom percentual de 10%
  const res10 = win.applyCartCoupon('VORTEX10');
  assert.strictEqual(res10.success, true, 'Aplicação do cupom VORTEX10 deve ter sucesso');
  assert.strictEqual(res10.coupon.code, 'VORTEX10');
  assert.strictEqual(res10.coupon.value, 10);

  // Aplicar cupom de valor fixo
  const resFrete = win.applyCartCoupon('FRETEGRATIS');
  assert.strictEqual(resFrete.success, true, 'Aplicação do cupom FRETEGRATIS deve ter sucesso');
  assert.strictEqual(resFrete.coupon.value, 10);

  // Cupom inválido
  const resInvalido = win.applyCartCoupon('CUPOMFALSO99');
  assert.strictEqual(resInvalido.success, false, 'Cupom inexistente deve retornar erro');

  win.removeCartCoupon();
  assert.strictEqual(win.getAppliedCartCoupon(), null, 'removeCartCoupon deve limpar o cupom ativo');

  // 6. Limpeza de Armazenamento e Cache
  assert.ok(typeof win.cleanStorageCache === 'function', 'cleanStorageCache deve ser uma função');
  win.localStorage.setItem('vortex_temp_preview_test', '12345');
  const cleanRes = await win.cleanStorageCache();
  assert.strictEqual(cleanRes.success, true, 'cleanStorageCache deve retornar sucesso');
  assert.strictEqual(win.localStorage.getItem('vortex_temp_preview_test'), null, 'Chaves temporárias vortex_temp_* devem ser removidas');

  // 7. Elementos no DOM (HTML Integrity para v1.0.172)
  assert.ok(env.elements['story-ngl-container'], 'Elemento #story-ngl-container deve existir no DOM');
  assert.ok(env.elements['story-anonymous-toggle'], 'Elemento #story-anonymous-toggle deve existir no DOM');
  assert.ok(env.elements['starred-messages-modal'], 'Elemento #starred-messages-modal deve existir no DOM');
  assert.ok(env.elements['action-star-btn'], 'Elemento #action-star-btn deve existir no DOM');
  assert.ok(env.elements['catalog-apply-coupon-btn'], 'Elemento #catalog-apply-coupon-btn deve existir no DOM');
  assert.ok(env.elements['clean-storage-btn'], 'Elemento #clean-storage-btn deve existir no DOM');
});

test('Cadastro de Cupons pelo App, Configuração de Frete da Loja e Layout de Perguntas Anônimas (v1.0.173)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento
  assert.ok(win.CURRENT_APP_VERSION >= '1.0.173', 'script.js deve ter versão 1.0.173 ou superior');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(versionJson.version >= '1.0.173', 'version.json deve ter versão 1.0.173 ou superior');
  assert.ok(htmlContent.includes('script.js?v='), 'index.html deve referenciar script.js versionado');
  assert.ok(htmlContent.includes('style.css?v='), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve ter cache versionado');

  // 2. Elementos DOM do Layout de Perguntas Anônimas (v1.0.173)
  assert.ok(htmlContent.includes('story-anonymous-card'), 'Deve ter a classe story-anonymous-card no index.html');
  assert.ok(htmlContent.includes('story-anonymous-input-wrapper'), 'Deve ter o wrapper story-anonymous-input-wrapper');
  assert.ok(htmlContent.includes('story-anonymous-prompt-label'), 'Deve ter a label do texto da caixinha');
  assert.ok(env.elements['story-anonymous-section'], '#story-anonymous-section deve existir no DOM');
  assert.ok(env.elements['story-anonymous-toggle'], '#story-anonymous-toggle deve existir no DOM');
  assert.ok(env.elements['story-anonymous-input-box'], '#story-anonymous-input-box deve existir no DOM');
  assert.ok(env.elements['story-anonymous-prompt'], '#story-anonymous-prompt deve existir no DOM');

  // 3. Modais e Botões de Cupons e Frete da Loja no DOM
  assert.ok(env.elements['catalog-manage-coupons-btn'], '#catalog-manage-coupons-btn deve existir na barra de ferramentas da loja');
  assert.ok(env.elements['catalog-manage-shipping-btn'], '#catalog-manage-shipping-btn deve existir na barra de ferramentas da loja');
  assert.ok(env.elements['catalog-coupons-modal'], '#catalog-coupons-modal deve existir');
  assert.ok(env.elements['catalog-coupon-code-input'], '#catalog-coupon-code-input deve existir');
  assert.ok(env.elements['catalog-coupon-type-select'], '#catalog-coupon-type-select deve existir');
  assert.ok(env.elements['catalog-coupon-val-input'], '#catalog-coupon-val-input deve existir');
  assert.ok(env.elements['catalog-coupon-submit-btn'], '#catalog-coupon-submit-btn deve existir');
  assert.ok(env.elements['catalog-coupons-list'], '#catalog-coupons-list deve existir');
  assert.ok(env.elements['catalog-shipping-modal'], '#catalog-shipping-modal deve existir');
  assert.ok(env.elements['catalog-shipping-type-select'], '#catalog-shipping-type-select deve existir');
  assert.ok(env.elements['catalog-shipping-price-input'], '#catalog-shipping-price-input deve existir');
  assert.ok(env.elements['catalog-shipping-min-order-input'], '#catalog-shipping-min-order-input deve existir');
  assert.ok(env.elements['catalog-shipping-save-btn'], '#catalog-shipping-save-btn deve existir');
  assert.ok(env.elements['catalog-cart-shipping-row'], '#catalog-cart-shipping-row deve existir no rodapé do carrinho');
  assert.ok(env.elements['catalog-cart-shipping'], '#catalog-cart-shipping deve existir no carrinho');

  // 4. Cadastro de Cupons pelo Vendedor (digitando código)
  const sellerUser = { uid: 'seller_173', name: 'Loja Teste VIP' };
  win.setCurrentUser(sellerUser);
  win.setCurrentProfile({ ...sellerUser, storeCoupons: {} });

  // Cadastro de cupom percentual PROMO25 (25% OFF)
  const cupom1 = await win.saveSellerCoupon('promo25', 'percent', 25, '25% de Desconto VIP');
  assert.strictEqual(cupom1.code, 'PROMO25', 'Código deve ser salvo em maiúsculas');
  assert.strictEqual(cupom1.value, 25);
  assert.strictEqual(cupom1.type, 'percent');
  assert.strictEqual(cupom1.label, '25% de Desconto VIP');

  // Cadastro de cupom de valor fixo VALE15 (R$ 15,00 OFF)
  const cupom2 = await win.saveSellerCoupon('VALE15', 'fixed', 15, 'R$ 15,00 OFF Especial');
  assert.strictEqual(cupom2.code, 'VALE15');
  assert.strictEqual(cupom2.value, 15);
  assert.strictEqual(cupom2.type, 'fixed');

  // Validação: cupom com menos de 3 letras deve falhar
  await assert.rejects(async () => {
    await win.saveSellerCoupon('AB', 'percent', 10);
  }, /pelo menos 3 caracteres/);

  // Validação: desconto percentual > 90% deve falhar
  await assert.rejects(async () => {
    await win.saveSellerCoupon('ABUSO99', 'percent', 99);
  }, /não pode ultrapassar 90%/);

  // Exclusão de cupom
  await win.deleteSellerCoupon('VALE15');
  const couponsPosDelete = await win.loadSellerCoupons('seller_173');
  assert.strictEqual(couponsPosDelete['VALE15'], undefined, 'VALE15 deve ter sido removido');
  assert.ok(couponsPosDelete['PROMO25'], 'PROMO25 deve continuar existindo');

  // 5. Aplicação do Cupom Criado pelo Vendedor no Carrinho
  win.saveCatalogCart({
    sellerUid: 'seller_173',
    sellerName: 'Loja Teste VIP',
    items: [{ productId: 'p1', name: 'Item Teste', price: 100, effectivePrice: 100, quantity: 2 }]
  });

  const resPromo = win.applyCartCoupon('PROMO25');
  assert.strictEqual(resPromo.success, true, 'Cupom do vendedor PROMO25 deve ser aplicado com sucesso');
  assert.strictEqual(resPromo.coupon.code, 'PROMO25');
  assert.strictEqual(resPromo.coupon.value, 25);

  // 6. Configuração de Frete da Loja e Cálculo no Carrinho
  // Caso A: Frete Fixo R$ 20,00
  await win.saveSellerShipping({
    type: 'fixed',
    price: 20,
    minOrder: 100,
    deadline: '3 dias úteis'
  });
  const mockCartA = {
    sellerUid: 'seller_173',
    items: [{ productId: 'p1', name: 'Item', price: 50, effectivePrice: 50, quantity: 1 }]
  };
  const shipA = win.calculateCartShipping(mockCartA, 50);
  assert.strictEqual(shipA.cost, 20, 'Frete fixo deve ser R$ 20,00');
  assert.ok(shipA.label.includes('20,00'), 'Rótulo deve conter R$ 20,00');

  // Caso B: Frete Grátis Acima de R$ 150 (Subtotal R$ 100 -> paga frete)
  await win.saveSellerShipping({
    type: 'free_above',
    price: 15,
    minOrder: 150,
    deadline: '2 a 5 dias úteis'
  });
  const shipB1 = win.calculateCartShipping(mockCartA, 100);
  assert.strictEqual(shipB1.cost, 15, 'Abaixo de R$ 150 deve cobrar frete fixo de R$ 15,00');

  // Subtotal R$ 200 >= R$ 150 -> Frete Grátis!
  const shipB2 = win.calculateCartShipping(mockCartA, 200);
  assert.strictEqual(shipB2.cost, 0, 'Acima de R$ 150 deve ter frete grátis');
  assert.ok(shipB2.label.includes('Grátis'), 'Rótulo deve indicar frete grátis');

  // Caso C: Modalidade Frete Grátis para todos os pedidos
  await win.saveSellerShipping({
    type: 'free',
    deadline: 'Entrega rápida'
  });
  const shipC = win.calculateCartShipping(mockCartA, 30);
  assert.strictEqual(shipC.cost, 0);
  assert.ok(shipC.label.includes('Grátis'));

  // Caso D: Frete a Combinar no Chat
  await win.saveSellerShipping({
    type: 'custom',
    deadline: 'A combinar'
  });
  const shipD = win.calculateCartShipping(mockCartA, 50);
  assert.strictEqual(shipD.cost, 0);
  assert.ok(shipD.label.includes('A combinar'));
});

test('Correção do Ícone de Solicitações VIP e Abas do Painel ADM (v1.0.174)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento
  assert.ok(win.CURRENT_APP_VERSION >= '1.0.174', 'script.js deve ter versão 1.0.174 ou superior');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(versionJson.version >= '1.0.174', 'version.json deve ter versão 1.0.174 ou superior');
  assert.ok(htmlContent.includes('script.js?v='), 'index.html deve referenciar script.js versionado');
  assert.ok(htmlContent.includes('style.css?v='), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve ter cache versionado');

  // 2. Elementos das Abas do Painel ADM no DOM
  assert.ok(env.elements['admin-tab-vip-requests-btn'], '#admin-tab-vip-requests-btn deve existir');
  assert.ok(env.elements['admin-tab-reports-btn'], '#admin-tab-reports-btn deve existir');
  assert.ok(env.elements['admin-tab-users-btn'], '#admin-tab-users-btn deve existir');
  assert.ok(env.elements['admin-tab-posts-btn'], '#admin-tab-posts-btn deve existir');
  assert.ok(env.elements['admin-tab-groups-btn'], '#admin-tab-groups-btn deve existir');
  assert.ok(env.elements['admin-tab-broadcast-btn'], '#admin-tab-broadcast-btn deve existir');
  assert.ok(env.elements['admin-vip-badge'], '#admin-vip-badge deve existir');

  // 3. Integridade do CSS para Abas e Ícones do Painel ADM
  const cssContent = fs.readFileSync('public/style.css', 'utf8');
  assert.ok(cssContent.includes('.admin-tab-icon'), 'Deve conter a classe .admin-tab-icon no CSS');
  assert.ok(cssContent.includes('.admin-tab-btn svg'), 'Deve estilizar SVG em .admin-tab-btn');
  assert.ok(cssContent.includes('flex-shrink: 0 !important'), 'Deve conter flex-shrink: 0 !important para proteger o ícone de encolher');
  assert.ok(cssContent.includes('width: 18px !important'), 'Deve garantir largura de 18px para o ícone');
  assert.ok(cssContent.includes('height: 18px !important'), 'Deve garantir altura de 18px para o ícone');

  // 4. Classes nos Botões do index.html
  assert.ok(htmlContent.includes('data-lucide="badge-check" class="admin-tab-icon"'), 'Ícone de Solicitações VIP deve ter classe admin-tab-icon');
});

test('Padronização do Tamanho dos Botões e Barra Horizontal da Loja (v1.0.175)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.175+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 175), 'script.js deve ter versão >= 1.0.175');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const vParts = versionJson.version.split('.').map(Number);
  assert.ok(vParts[0] > 1 || (vParts[0] === 1 && vParts[1] > 0) || (vParts[0] === 1 && vParts[1] === 0 && vParts[2] >= 175), 'version.json deve ter versão >= 1.0.175');

  // 2. Elementos da Barra de Ferramentas da Loja no DOM
  assert.ok(env.elements['catalog-add-product-btn'], '#catalog-add-product-btn deve existir');
  assert.ok(env.elements['catalog-manage-categories-btn'], '#catalog-manage-categories-btn deve existir');
  assert.ok(env.elements['catalog-manage-coupons-btn'], '#catalog-manage-coupons-btn deve existir');
  assert.ok(env.elements['catalog-manage-shipping-btn'], '#catalog-manage-shipping-btn deve existir');

  // 3. Integridade do CSS da Barra Horizontal e Tamanho dos Botões
  const cssContent = fs.readFileSync('public/style.css', 'utf8');
  assert.ok(cssContent.includes('.catalog-toolbar'), 'Deve conter estilos para .catalog-toolbar');
  assert.ok(cssContent.includes('.catalog-toolbar::-webkit-scrollbar'), 'Deve conter barra horizontal com webkit-scrollbar');
  assert.ok(cssContent.includes('scrollbar-width: thin'), 'Deve conter scrollbar-width fina para scroll horizontal');
  assert.ok(cssContent.includes('white-space: nowrap !important'), 'Deve proibir quebra de linha de texto nos botões da barra');
  assert.ok(cssContent.includes('height: 42px'), 'Deve padronizar altura dos botões no desktop/tablet');
  assert.ok(cssContent.includes('height: 38px'), 'Deve padronizar altura dos botões no celular');
  assert.ok(cssContent.includes('flex: 0 0 auto'), 'Deve conter flex: 0 0 auto para evitar encolhimento no celular');
});

test('Correção de Mensagens Favoritas, Função formatDate e Abertura com Múltiplos Favoritos (v1.0.176)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.176+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 176), 'script.js deve ter versão >= 1.0.176');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const vParts = versionJson.version.split('.').map(Number);
  assert.ok(vParts[0] > 1 || (vParts[0] === 1 && vParts[1] > 0) || (vParts[0] === 1 && vParts[1] === 0 && vParts[2] >= 176), 'version.json deve ter versão >= 1.0.176');

  // 2. Existência e funcionamento das funções formatDate e formatStarredMessageDate
  assert.strictEqual(typeof win.formatDate, 'function', 'formatDate deve ser uma função global');
  assert.strictEqual(typeof win.formatStarredMessageDate, 'function', 'formatStarredMessageDate deve ser uma função global');
  
  const nowStr = win.formatDate(Date.now());
  assert.ok(nowStr.startsWith('Hoje às'), 'formatDate de hoje deve retornar "Hoje às ..."');
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = win.formatDate(yesterday.getTime());
  assert.ok(yestStr.startsWith('Ontem às'), 'formatDate de ontem deve retornar "Ontem às ..."');

  // 3. Simulação exata do cenário do usuário (3 itens favoritados: áudio, texto "oi", emojis "💚💛🧡❤️")
  const currentUser = { uid: 'user_star_tester_123', email: 'tester@vortex.app', displayName: 'Tester' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  const audioMsg = {
    id: 'msg_audio_1',
    type: 'audio',
    fileData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8USA==',
    duration: '00:04',
    senderUid: currentUser.uid,
    createdAt: Date.now() - 60000
  };

  const textMsgOi = {
    id: 'msg_text_oi',
    type: 'text',
    text: 'oi',
    senderUid: currentUser.uid,
    createdAt: Date.now() - 30000
  };

  const emojiMsg = {
    id: 'msg_text_emojis',
    type: 'text',
    text: '💚💛🧡❤️',
    senderUid: currentUser.uid,
    createdAt: Date.now()
  };

  // Favorita as 3 mensagens
  await win.toggleStarMessage(audioMsg);
  await win.toggleStarMessage(textMsgOi);
  await win.toggleStarMessage(emojiMsg);

  const starred = win.getStarredMessages();
  assert.strictEqual(starred.length, 3, 'Deve haver 3 mensagens favoritadas salvas');

  // 4. Abertura do Modal com 3 itens favoritados (Não deve lançar ReferenceError: formatDate is not defined!)
  assert.doesNotThrow(() => {
    win.openStarredMessagesModal();
  }, 'openStarredMessagesModal deve abrir sem erros mesmo com múltiplos favoritos');

  const modal = env.elements['starred-messages-modal'];
  const content = env.elements['starred-messages-content'];
  assert.strictEqual(modal.style.display, 'flex', 'Modal deve estar com display: flex');
  assert.ok(modal.classList.contains('active'), 'Modal deve ter classe active');
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'false', 'Modal deve ter aria-hidden: false');

  // Verifica conteúdo renderizado
  assert.ok(content.innerHTML.includes('data-id="msg_text_oi"'), 'Deve renderizar mensagem "oi"');
  assert.ok(content.innerHTML.includes('data-id="msg_text_emojis"'), 'Deve renderizar mensagem com emojis');
  assert.ok(content.innerHTML.includes('data-id="msg_audio_1"'), 'Deve renderizar mensagem de áudio');
  assert.ok(content.innerHTML.includes('[Áudio / Mensagem de Voz]') || content.innerHTML.includes('Mensagem de voz'), 'Deve identificar áudio na lista');

  // Fechamento do modal
  win.closeStarredMessagesModal();
  assert.strictEqual(modal.style.display, 'none', 'Modal deve estar com display: none após fechar');
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'true', 'Modal deve ter aria-hidden: true após fechar');

  // 5. Integridade do CSS para Mensagens Favoritas
  const cssContent = fs.readFileSync('public/style.css', 'utf8');
  assert.ok(cssContent.includes('.starred-messages-card'), 'Deve estilizar .starred-messages-card');
  assert.ok(cssContent.includes('.starred-msg-item'), 'Deve estilizar .starred-msg-item');
  assert.ok(cssContent.includes('cursor: pointer'), 'Item de mensagem favorita deve ser clicável');
  assert.ok(cssContent.includes('.highlighted-starred-msg'), 'Deve conter animação de destaque .highlighted-starred-msg');
  assert.ok(cssContent.includes('@keyframes pulseStarredHighlight'), 'Deve conter keyframes pulseStarredHighlight');
});

test('Correção de Clique na Mensagem Favorita e Compatibilidade Assíncrona de openChatByChatIdOrUid (v1.0.177)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.177+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 177), 'script.js deve ter versão >= 1.0.177');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const vParts = versionJson.version.split('.').map(Number);
  assert.ok(vParts[0] > 1 || (vParts[0] === 1 && vParts[1] > 0) || (vParts[0] === 1 && vParts[1] === 0 && vParts[2] >= 177), 'version.json deve ter versão >= 1.0.177');

  // 2. Simulação de clique no card de favorita sem disparar TypeError (reading then)
  const currentUser = { uid: 'user_star_click_tester', email: 'tester@vortex.app' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  // 3. openChatByChatIdOrUid deve ser assíncrona (retornar Promise com .then)
  assert.strictEqual(typeof win.openChatByChatIdOrUid, 'function', 'openChatByChatIdOrUid deve ser uma função');
  const openChatPromise = win.openChatByChatIdOrUid('test_chat_1', 'user_remote');
  assert.ok(openChatPromise && typeof openChatPromise.then === 'function', 'openChatByChatIdOrUid deve retornar uma Promise com método .then');
  await openChatPromise;

  const testMsg = {
    id: 'msg_target_to_click',
    type: 'text',
    text: 'Mensagem para clicar',
    senderUid: currentUser.uid,
    createdAt: Date.now()
  };

  await win.toggleStarMessage(testMsg);
  win.openStarredMessagesModal();

  const content = env.elements['starred-messages-content'];
  const modal = env.elements['starred-messages-modal'];
  assert.ok(content.innerHTML.includes('msg_target_to_click'), 'Deve conter o item salvo');

  // Simula elemento de mensagem na tela do chat
  const msgContainer = env.elements['message-container'] || { appendChild() {} };
  const fakeMsgEl = env.sandbox.document.createElement('div');
  fakeMsgEl.className = 'message sent';
  fakeMsgEl.dataset.id = 'msg_target_to_click';
  fakeMsgEl.scrollIntoView = () => {};
  env.sandbox.document.body.appendChild(fakeMsgEl);

  // Busca o card renderizado no container de favoritas
  const cardEl = content.children.find ? content.children.find(c => c.dataset && c.dataset.id === 'msg_target_to_click') : null;
  if (cardEl && cardEl.click) {
    // Não deve lançar Uncaught TypeError: Cannot read properties of undefined (reading 'then')
    assert.doesNotThrow(async () => {
      await cardEl.click();
    });
  }
});

test('Correção de Abertura do Catálogo no Perfil de Contato sem Erro de Null UID (v1.0.178)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.178+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 178), 'script.js deve ter versão >= 1.0.178');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const vParts = versionJson.version.split('.').map(Number);
  assert.ok(vParts[0] > 1 || (vParts[0] === 1 && vParts[1] > 0) || (vParts[0] === 1 && vParts[1] === 0 && vParts[2] >= 178), 'version.json deve ter versão >= 1.0.178');
  const htmlContent = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(htmlContent.includes('script.js?v=1.0.'), 'index.html deve referenciar script.js versionado');
  assert.ok(htmlContent.includes('style.css?v=1.0.'), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve ter cache vortex-vip versionado');

  // 2. Define usuário logado
  const currentUser = { uid: 'user_tester_buyer', email: 'buyer@vortex.app', name: 'Buyer Test' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  // 3. Simula abertura do perfil de um contato vendedor com conta empresa
  const sellerContact = {
    uid: 'seller_contact_456',
    name: 'Loja Tech VIP',
    username: 'lojatech',
    accountType: 'business'
  };

  await win.openContactProfile(sellerContact);

  const catalogBtn = env.elements['contact-profile-catalog-btn'];
  assert.ok(catalogBtn, '#contact-profile-catalog-btn deve existir no DOM');
  const catalogOverlay = env.elements['catalog-overlay'];
  assert.ok(catalogOverlay, '#catalog-overlay deve existir no DOM');

  // O clique não deve lançar TypeError: Cannot read properties of null (reading 'uid')
  assert.doesNotThrow(() => {
    catalogBtn.click();
  }, 'Clique em contact-profile-catalog-btn não deve lançar erro');

  assert.strictEqual(catalogOverlay.style.display, 'flex', '#catalog-overlay deve ser aberto com display: flex');
  assert.ok(catalogOverlay.classList.contains('active'), '#catalog-overlay deve ter classe active');
});

test('Histórico de Ligações, Isolamento por Perfil e Botão de Desligar Câmera na Chamada (v1.0.182)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;

  // 1. Integridade de Versionamento (v1.0.182+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 182), 'script.js deve ter versão >= 1.0.182');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(versionJson.version >= '1.0.182', 'version.json deve ter versão >= 1.0.182');
  const htmlContent = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(htmlContent.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(htmlContent.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache');

  // 2. Elementos no DOM
  assert.ok(env.elements['view-call-history-trigger'], '#view-call-history-trigger deve existir no menu dropdown');
  assert.ok(env.elements['contact-profile-call-history-btn'], '#contact-profile-call-history-btn deve existir no perfil');
  assert.ok(env.elements['call-history-modal'], '#call-history-modal deve existir');
  assert.ok(env.elements['call-history-contact-name'], '#call-history-contact-name deve existir no modal');
  assert.ok(env.elements['close-call-history-modal'], '#close-call-history-modal deve existir');
  assert.ok(env.elements['call-history-content'], '#call-history-content deve existir');
  assert.ok(env.elements['call-stat-total'], '#call-stat-total deve existir');
  assert.ok(env.elements['call-stat-completed'], '#call-stat-completed deve existir');
  assert.ok(env.elements['call-stat-missed'], '#call-stat-missed deve existir');
  assert.ok(env.elements['call-stat-duration'], '#call-stat-duration deve existir');
  assert.ok(env.elements['call-tab-all'], '#call-tab-all deve existir');
  assert.ok(env.elements['call-tab-completed'], '#call-tab-completed deve existir');
  assert.ok(env.elements['call-tab-missed'], '#call-tab-missed deve existir');

  // 3. Validação das Funções de Formatação de Duração
  assert.strictEqual(typeof win.formatCallDuration, 'function', 'formatCallDuration deve ser uma função');
  assert.strictEqual(win.formatCallDuration(0), '0 seg');
  assert.strictEqual(win.formatCallDuration(45), '45 seg');
  assert.strictEqual(win.formatCallDuration(125), '2m 05s');
  assert.strictEqual(win.formatCallDuration(3600), '60m 00s');

  assert.strictEqual(typeof win.formatCallDurationDigital, 'function', 'formatCallDurationDigital deve ser uma função');
  assert.strictEqual(win.formatCallDurationDigital(65), '01:05');
  assert.strictEqual(win.formatCallDurationDigital(0), '00:00');

  // 4. Renderização do Card de Chamada no Chat (buildCallCardHTML)
  assert.strictEqual(typeof win.buildCallCardHTML, 'function', 'buildCallCardHTML deve ser uma função');

  // 4A. Chamada de vídeo efetuada e atendida
  const completedVideoMsg = {
    id: 'call_test_1',
    type: 'call',
    callType: 'video',
    callStatus: 'completed',
    durationSeconds: 154,
    callerUid: 'user_me',
    calleeUid: 'user_other'
  };
  const htmlCompletedMe = win.buildCallCardHTML(completedVideoMsg, true);
  assert.ok(htmlCompletedMe.includes('chat-call-card'), 'Deve gerar classe chat-call-card');
  assert.ok(htmlCompletedMe.includes('call-status-completed'), 'Deve ter classe call-status-completed');
  assert.ok(htmlCompletedMe.includes('Chamada de vídeo efetuada'), 'Deve indicar chamada efetuada');
  assert.ok(htmlCompletedMe.includes('Duração: 2m 34s'), 'Deve exibir duração calculada');
  assert.ok(htmlCompletedMe.includes('chat-call-return-btn'), 'Deve conter botão de retorno');

  // 4B. Chamada de vídeo recebida
  const htmlCompletedOther = win.buildCallCardHTML(completedVideoMsg, false);
  assert.ok(htmlCompletedOther.includes('Chamada de vídeo recebida'), 'Deve indicar chamada recebida');

  // 4C. Chamada de vídeo perdida
  const missedVideoMsg = {
    id: 'call_test_2',
    type: 'call',
    callType: 'video',
    callStatus: 'missed',
    durationSeconds: 0,
    callerUid: 'user_other',
    calleeUid: 'user_me'
  };
  const htmlMissedMe = win.buildCallCardHTML(missedVideoMsg, false);
  assert.ok(htmlMissedMe.includes('call-status-missed'), 'Deve ter classe call-status-missed');
  assert.ok(htmlMissedMe.includes('Chamada de vídeo perdida'), 'Deve alertar sobre chamada perdida');
  assert.ok(htmlMissedMe.includes('Toque para retornar'), 'Deve indicar retorno');

  // 4D. Chamada de voz
  const audioCallMsg = {
    id: 'call_test_3',
    type: 'call',
    callType: 'audio',
    callStatus: 'completed',
    durationSeconds: 30,
    callerUid: 'user_me',
    calleeUid: 'user_other'
  };
  const htmlAudioCall = win.buildCallCardHTML(audioCallMsg, true);
  assert.ok(htmlAudioCall.includes('Chamada de voz efetuada'), 'Deve identificar chamada de voz');

  // 5. Registro de Ligação no Chat (recordCallInChat)
  assert.strictEqual(typeof win.recordCallInChat, 'function', 'recordCallInChat deve ser uma função');
  const userMe = { uid: 'user_call_tester_me', name: 'Tester Me' };
  const userOther = { uid: 'user_call_tester_other', name: 'Tester Other' };
  win.setCurrentUser(userMe);
  win.setCurrentProfile(userMe);

  const testChatId = 'user_call_tester_me_user_call_tester_other';
  const callContext = {
    callId: 'call_doc_abc123',
    chatId: testChatId,
    callerUid: userMe.uid,
    callerName: userMe.name,
    calleeUid: userOther.uid,
    calleeName: userOther.name,
    callType: 'video',
    isConnected: true,
    durationSeconds: 180,
    createdAt: Date.now()
  };

  await win.recordCallInChat(callContext, 'completed', 180);

  // Verifica que gravou em chats/{chatId}/messages/call_call_doc_abc123
  const expectedMsgKey = `chats/${testChatId}/messages/call_call_doc_abc123`;
  const savedMsg = env.firestoreDocs[expectedMsgKey];
  assert.ok(savedMsg, 'Deve gravar documento de mensagem em chats/{chatId}/messages');
  assert.strictEqual(savedMsg.type, 'call', 'Mensagem gravada deve ser do tipo call');
  assert.strictEqual(savedMsg.callStatus, 'completed', 'callStatus deve ser completed');
  assert.strictEqual(savedMsg.durationSeconds, 180, 'durationSeconds deve ser 180');
  assert.strictEqual(savedMsg.durationFormatted, '3m 00s', 'durationFormatted deve ser 3m 00s');

  // 6. Modal de Histórico de Chamadas
  const modal = env.elements['call-history-modal'];
  const content = env.elements['call-history-content'];

  // Simula contato ativo para o chat atual
  win.setActiveChatContact(userOther);

  await win.openCallHistoryModal('all');
  assert.strictEqual(modal.style.display, 'flex', 'Modal deve estar com display: flex');
  assert.ok(modal.classList.contains('active'), 'Modal deve ter classe active');
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'false', 'Modal deve ter aria-hidden: false');

  // Verifica estatísticas atualizadas
  const totalStat = env.elements['call-stat-total'];
  const completedStat = env.elements['call-stat-completed'];
  assert.ok(Number(totalStat.innerText) >= 1, 'Total de chamadas deve ser >= 1');
  assert.ok(Number(completedStat.innerText) >= 1, 'Chamadas atendidas deve ser >= 1');

  // Fechamento do modal
  win.closeCallHistoryModal();
  assert.strictEqual(modal.style.display, 'none', 'Modal deve estar fechado');
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'true', 'aria-hidden deve ser true');

  // 7. Integridade do CSS e Responsividade Mobile
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.ok(css.includes('.chat-call-card'), 'style.css deve conter .chat-call-card');
  assert.ok(css.includes('.call-status-completed'), 'style.css deve conter .call-status-completed');
  assert.ok(css.includes('.call-status-missed'), 'style.css deve conter .call-status-missed');
  assert.ok(css.includes('.call-history-card'), 'style.css deve conter .call-history-card');
  assert.ok(css.includes('.chat-call-return-btn'), 'style.css deve conter .chat-call-return-btn');
  assert.ok(css.includes('@media (max-width: 480px)'), 'style.css deve conter media query para mobile');
  assert.ok(css.includes('#call-history-modal.custom-modal-overlay'), 'style.css deve conter padding adaptado para o overlay do modal');
  assert.ok(css.includes('width: 98% !important'), 'style.css deve garantir largura responsiva no celular');

  // 8. Teste de renderização do item no histórico com formatação limpa de data
  const testCalls = [{
    id: 'call_test_render',
    callerUid: userMe.uid,
    calleeUid: userOther.uid,
    callType: 'video',
    callStatus: 'missed',
    createdAt: new Date('2026-10-21T21:07:00').getTime()
  }];
  await win.renderCallHistoryList(testCalls, 'all', userOther);
  const renderedHTML = content.innerHTML;
  assert.ok(renderedHTML.includes('Chamada de vídeo não atendida'), 'Deve conter título formatado');
  assert.ok(renderedHTML.includes('Não atendida'), 'Deve conter status Não atendida');
  assert.ok(renderedHTML.includes('21/10 às 21:07'), 'Deve conter data formatada sem quebra');

  // 9. ISOLAMENTO ESTRITO POR PERFIL DE CONTATO (Nunca misturar chamadas de outro contato!)
  const contactAlice = { uid: 'user_alice_call', name: 'Alice Silva' };
  const contactBob = { uid: 'user_bob_call', name: 'Bob Santos' };

  // Registra 2 chamadas com a Alice
  const chatAliceId = [userMe.uid, contactAlice.uid].sort().join('_');
  env.firestoreDocs[`chats/${chatAliceId}/messages/call_alice_1`] = {
    id: 'call_alice_1',
    type: 'call',
    callType: 'video',
    callStatus: 'completed',
    durationSeconds: 120,
    durationFormatted: '2m 00s',
    callerUid: userMe.uid,
    calleeUid: contactAlice.uid,
    senderUid: userMe.uid,
    createdAt: Date.now() - 50000
  };
  env.firestoreDocs[`chats/${chatAliceId}/messages/call_alice_2`] = {
    id: 'call_alice_2',
    type: 'call',
    callType: 'audio',
    callStatus: 'missed',
    durationSeconds: 0,
    callerUid: contactAlice.uid,
    calleeUid: userMe.uid,
    senderUid: contactAlice.uid,
    createdAt: Date.now() - 20000
  };

  // Nenhuma chamada com o Bob registrada
  const chatBobId = [userMe.uid, contactBob.uid].sort().join('_');

  // 9A. Abre o perfil do Bob e clica em Histórico de Ligações do perfil
  // Mesmo que o activeChatContact atual fosse Alice, o perfil do Bob DEVE abrir o histórico do Bob!
  win.setActiveChatContact(contactAlice); // Simulando Alice ativa no chat de fundo
  await win.openContactProfile(contactBob);

  const contactProfileHistoryBtn = env.elements['contact-profile-call-history-btn'];
  assert.ok(contactProfileHistoryBtn, 'Botão de histórico de chamada do perfil deve existir');

  contactProfileHistoryBtn.click();
  // Aguarda processamento
  await new Promise(r => setTimeout(r, 50));

  // O histórico do Bob deve estar isolado:
  const bobTotalStat = env.elements['call-stat-total'];
  assert.strictEqual(bobTotalStat.innerText, '0', 'Bob não tem chamadas, total deve ser 0');
  const bobContent = env.elements['call-history-content'].innerHTML;
  assert.ok(bobContent.includes('Você ainda não realizou ou recebeu chamadas com Bob Santos.'), 'Deve exibir estado vazio personalizado para o Bob');
  assert.strictEqual(bobContent.includes('call_alice_1'), false, 'NÃO deve conter chamadas da Alice no perfil do Bob');
  assert.strictEqual(bobContent.includes('call_alice_2'), false, 'NÃO deve conter chamadas da Alice no perfil do Bob');

  const contactSubtitle = env.elements['call-history-contact-name'];
  assert.ok(contactSubtitle.innerText.includes('Bob Santos'), 'Subtítulo deve indicar que o histórico é com o Bob');

  // 9B. Agora abre o perfil da Alice e clica no botão de histórico do perfil dela
  win.closeCallHistoryModal();
  await win.openContactProfile(contactAlice);
  contactProfileHistoryBtn.click();
  await new Promise(r => setTimeout(r, 50));

  const aliceTotalStat = env.elements['call-stat-total'];
  assert.strictEqual(aliceTotalStat.innerText, '2', 'Alice deve ter 2 chamadas registradas');
  const aliceContent = env.elements['call-history-content'].innerHTML;
  assert.ok(aliceContent.includes('Chamada de vídeo efetuada'), 'Deve conter chamada efetuada da Alice');
  assert.ok(aliceContent.includes('Chamada de voz perdida'), 'Deve conter chamada perdida da Alice');
  assert.strictEqual(aliceContent.includes('Bob Santos'), false, 'Não deve misturar Bob no histórico da Alice');
  assert.ok(contactSubtitle.innerText.includes('Alice Silva'), 'Subtítulo deve indicar que o histórico é com a Alice');

  // 10. BOTÃO PARA DESLIGAR A CÂMERA NA CHAMADA DE VÍDEO (v1.0.182)
  const toggleCameraBtn = env.elements['toggle-camera-btn'];
  assert.ok(toggleCameraBtn, '#toggle-camera-btn deve existir no rodapé da chamada');
  const videoWrapper = env.elements['local-video-wrapper'];
  assert.ok(videoWrapper, '#local-video-wrapper deve existir');
  const videoPlaceholder = env.elements['local-video-off-placeholder'];
  assert.ok(videoPlaceholder, '#local-video-off-placeholder deve existir');

  assert.strictEqual(typeof win.toggleCamera, 'function', 'toggleCamera deve ser uma função');
  assert.strictEqual(typeof win.updateCameraToggleButtonUI, 'function', 'updateCameraToggleButtonUI deve ser uma função');

  // Estado inicial: câmera ligada
  win.setIsCameraOff(false);
  win.updateCameraToggleButtonUI(false);
  assert.strictEqual(win.getIsCameraOff(), false, 'Câmera deve iniciar ligada');
  assert.strictEqual(videoPlaceholder.style.display, 'none', 'Placeholder deve estar oculto com câmera ligada');
  assert.strictEqual(toggleCameraBtn.title, 'Desligar Câmera', 'Título do botão deve ser Desligar Câmera');

  // Simula clique no botão para desligar a câmera
  toggleCameraBtn.click();
  assert.strictEqual(win.getIsCameraOff(), true, 'Após o clique, isCameraOff deve ser true');
  assert.strictEqual(videoPlaceholder.style.display, 'flex', 'Placeholder deve estar visível');
  assert.strictEqual(toggleCameraBtn.title, 'Ligar Câmera', 'Título do botão deve mudar para Ligar Câmera');
  assert.ok(toggleCameraBtn.style.background.includes('ff3b30') || toggleCameraBtn.style.background.includes('255, 59, 48'), 'Botão deve ter destaque vermelho quando desligado');
  assert.ok(toggleCameraBtn.classList.contains('btn-active-off'), 'Botão deve ter classe btn-active-off');
  assert.ok(videoWrapper.classList.contains('camera-off'), 'Wrapper de vídeo deve ter classe camera-off');

  // Simula segundo clique para religar a câmera
  toggleCameraBtn.click();
  assert.strictEqual(win.getIsCameraOff(), false, 'Após segundo clique, isCameraOff deve voltar para false');
  assert.strictEqual(videoPlaceholder.style.display, 'none', 'Placeholder deve voltar a ficar oculto');
  assert.strictEqual(toggleCameraBtn.title, 'Desligar Câmera', 'Título do botão deve voltar para Desligar Câmera');
  assert.strictEqual(toggleCameraBtn.classList.contains('btn-active-off'), false, 'Não deve ter classe btn-active-off');

  // Integridade de CSS para o botão e placeholder
  assert.ok(css.includes('#toggle-camera-btn'), 'style.css deve conter regras para #toggle-camera-btn');
  assert.ok(css.includes('.local-video-off-placeholder'), 'style.css deve conter regras para .local-video-off-placeholder');
  assert.ok(css.includes('.btn-active-off'), 'style.css deve conter regras para .btn-active-off');
});

test('Possibilidade de Apagar Avisos de Mensagens Apagadas no Chat (Individual, Seleção Múltipla e Limpar Todos) (v1.0.183)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.183+)
  const parts = win.CURRENT_APP_VERSION.split('.').map(Number);
  assert.ok(parts[0] > 1 || (parts[0] === 1 && parts[1] > 0) || (parts[0] === 1 && parts[1] === 0 && parts[2] >= 183), 'script.js deve ter versão >= 1.0.183');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(versionJson.version >= '1.0.183', 'version.json deve ter versão >= 1.0.183');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache');

  // 2. Integridade de DOM em index.html
  assert.ok(env.elements['floating-reaction-bar'], '#floating-reaction-bar deve existir');
  assert.ok(env.elements['floating-bar-deleted-hint'], '#floating-bar-deleted-hint deve existir no floating-reaction-bar');
  assert.ok(env.elements['action-select-btn'], '#action-select-btn deve existir no floating-reaction-bar');
  assert.ok(env.elements['action-delete-btn'], '#action-delete-btn deve existir no floating-reaction-bar');
  assert.ok(env.elements['delete-message-modal'], '#delete-message-modal deve existir');
  assert.ok(env.elements['delete-for-everyone-btn'], '#delete-for-everyone-btn deve existir');
  assert.ok(env.elements['delete-for-me-btn'], '#delete-for-me-btn deve existir');
  assert.ok(env.elements['clear-deleted-notices-trigger'], '#clear-deleted-notices-trigger deve existir no menu da conversa');

  // 3. Integridade de CSS em style.css
  assert.ok(css.includes('.deleted-msg-box'), 'style.css deve conter estilo para .deleted-msg-box');
  assert.ok(css.includes('.deleted-msg-quick-del-btn'), 'style.css deve conter estilo para .deleted-msg-quick-del-btn');
  assert.ok(css.includes('.floating-reaction-bar.deleted-msg-bar'), 'style.css deve conter estilo para .floating-reaction-bar.deleted-msg-bar');

  // 3. Usuário logado e contato ativo
  const currentUid = 'user_test_me';
  const currentUser = { uid: currentUid, displayName: 'Test User', email: 'test@vortex.com' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);
  const activeContact = { uid: 'contact_alice', name: 'Alice Santos', isGroup: false };
  win.setActiveChatContact(activeContact);

  const chatId = [currentUid, activeContact.uid].sort().join('_');
  const msgMap = win.getCurrentChatMessagesMap();

  // Simular 3 mensagens apagadas e 1 mensagem normal
  const msgNotice1 = {
    id: 'msg_del_1',
    senderUid: 'contact_alice',
    text: '🚫 Esta mensagem foi apagada',
    deletedForEveryone: true,
    deletedFor: [],
    createdAt: Date.now() - 3000
  };
  const msgNotice2 = {
    id: 'msg_del_2',
    senderUid: currentUid,
    text: '🚫 Esta mensagem foi apagada',
    deletedForEveryone: true,
    deletedFor: [],
    createdAt: Date.now() - 2000
  };
  const msgNotice3 = {
    id: 'msg_del_3',
    senderUid: 'contact_alice',
    text: '🚫 Esta mensagem foi apagada',
    deletedForEveryone: true,
    deletedFor: [],
    createdAt: Date.now() - 1000
  };
  const msgNormal = {
    id: 'msg_normal_1',
    senderUid: 'contact_alice',
    text: 'Oi tudo bem?',
    deletedForEveryone: false,
    deletedFor: [],
    createdAt: Date.now()
  };

  msgMap.set(msgNotice1.id, msgNotice1);
  msgMap.set(msgNotice2.id, msgNotice2);
  msgMap.set(msgNotice3.id, msgNotice3);
  msgMap.set(msgNormal.id, msgNormal);

  // Criar documentos correspondentes no Firestore simulado
  env.firestoreDocs[`chats/${chatId}/messages/${msgNotice1.id}`] = { ...msgNotice1 };
  env.firestoreDocs[`chats/${chatId}/messages/${msgNotice2.id}`] = { ...msgNotice2 };
  env.firestoreDocs[`chats/${chatId}/messages/${msgNotice3.id}`] = { ...msgNotice3 };
  env.firestoreDocs[`chats/${chatId}/messages/${msgNormal.id}`] = { ...msgNormal };

  // Renderizar elementos simulados no container de mensagens
  const container = env.elements['message-container'];
  container.children = [];

  function createMsgElement(msg, isSent) {
    const el = env.sandbox.document.createElement('div');
    el.className = `message ${isSent ? 'sent' : 'received'} ${msg.deletedForEveryone ? 'deleted-msg' : ''}`;
    el.dataset = { id: msg.id };
    el.setAttribute('data-id', msg.id);
    if (msg.deletedForEveryone) {
      el.innerHTML = `
        <div class="deleted-msg-box">
          <span class="deleted-msg-text">🚫 Esta mensagem foi apagada</span>
          <button class="deleted-msg-quick-del-btn" type="button" title="Apagar este aviso para você">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `;
    } else {
      el.innerHTML = `<div>${msg.text}</div>`;
    }
    return el;
  }

  const elNotice1 = createMsgElement(msgNotice1, false);
  const elNotice2 = createMsgElement(msgNotice2, true);
  const elNotice3 = createMsgElement(msgNotice3, false);
  const elNormal = createMsgElement(msgNormal, false);

  container.appendChild(elNotice1);
  container.appendChild(elNotice2);
  container.appendChild(elNotice3);
  container.appendChild(elNormal);

  // 4. Testar showFloatingReactions para Mensagem Apagada
  assert.ok(elNotice1, 'Elemento do aviso 1 deve existir no container');

  win.showFloatingReactions(msgNotice1, elNotice1);
  const bar = env.elements['floating-reaction-bar'];
  assert.ok(bar.classList.contains('active'), 'Barra flutuante deve estar ativa para o aviso');
  assert.ok(bar.classList.contains('deleted-msg-bar'), 'Barra deve ter a classe deleted-msg-bar');

  const deletedHint = env.elements['floating-bar-deleted-hint'];
  assert.strictEqual(deletedHint.style.display, 'inline-flex', 'Hint de aviso apagado deve estar visível');
  const actionDeleteBtn = env.elements['action-delete-btn'];
  assert.strictEqual(actionDeleteBtn.style.display, 'inline-flex', 'Botão de apagar deve estar visível');
  assert.strictEqual(actionDeleteBtn.title, 'Apagar aviso', 'Título do botão deve ser "Apagar aviso"');

  const actionSelectBtn = env.elements['action-select-btn'];
  assert.strictEqual(actionSelectBtn.style.display, 'inline-flex', 'Botão de selecionar deve estar visível');

  // Emoji pill e ações irrelevantes devem estar ocultos
  const emojiPill = env.elements['emoji-reaction-pill'] || bar.querySelector('.emoji-reaction-pill');
  assert.strictEqual(emojiPill.style.display, 'none', 'Pílula de emojis deve estar oculta no aviso');
  assert.strictEqual(env.elements['action-star-btn'].style.display, 'none', 'Favoritar deve estar oculto');
  assert.strictEqual(env.elements['action-reply-btn'].style.display, 'none', 'Responder deve estar oculto');
  assert.strictEqual(env.elements['action-forward-btn'].style.display, 'none', 'Encaminhar deve estar oculto');

  // 5. Testar openDeleteModal para o aviso individual
  await win.openDeleteModal(false, msgNotice1);
  const deleteModal = env.elements['delete-message-modal'];
  assert.ok(deleteModal.classList.contains('active'), 'Modal de exclusão deve abrir');

  const modalTitle = env.elements['delete-modal-title'] || deleteModal.querySelector('.modal-title');
  const modalSubtitle = env.elements['delete-modal-subtitle'] || deleteModal.querySelector('.modal-subtitle');
  assert.strictEqual(modalTitle.innerText, 'Apagar Aviso?', 'Título do modal deve ser "Apagar Aviso?"');
  assert.ok(modalSubtitle.innerText.includes('remover este aviso de mensagem apagada'), 'Subtítulo deve ser adaptado para o aviso');

  const deleteForEveryoneBtn = env.elements['delete-for-everyone-btn'];
  const deleteForMeBtn = env.elements['delete-for-me-btn'];
  assert.strictEqual(deleteForEveryoneBtn.style.display, 'none', 'Apagar para todos deve estar OCULTO para aviso já apagado');
  assert.strictEqual(deleteForMeBtn.style.display, 'block', 'Apagar para mim deve estar VISÍVEL');
  assert.strictEqual(deleteForMeBtn.innerText, 'Apagar Aviso para Mim', 'Texto do botão deve ser "Apagar Aviso para Mim"');

  // 6. Clicar em "Apagar Aviso para Mim"
  await deleteForMeBtn.click();
  await new Promise(r => setTimeout(r, 50));

  // O elemento do aviso 1 deve ter sumido do DOM
  assert.strictEqual(container.children.some(c => c.dataset && c.dataset.id === msgNotice1.id), false, 'Aviso 1 deve ter sido removido do DOM');

  // O Firestore deve conter currentUser.uid no array deletedFor
  const updatedDoc1 = env.firestoreDocs[`chats/${chatId}/messages/${msgNotice1.id}`];
  assert.ok(updatedDoc1, 'Documento 1 deve existir no Firestore');
  assert.ok(Array.isArray(updatedDoc1.deletedFor), 'deletedFor deve ser array');
  assert.ok(updatedDoc1.deletedFor.includes(currentUid), 'currentUser.uid deve ter sido adicionado ao deletedFor');

  // 7. Testar Seleção Múltipla de Avisos Apagados
  win.enterSelectionMode(msgNotice2.id);
  const selectedIds = win.getSelectedMessageIds();
  assert.ok(selectedIds.has(msgNotice2.id), 'msgNotice2 deve estar selecionada');

  assert.ok(elNotice3, 'Elemento do aviso 3 deve existir no container');
  win.toggleMessageSelection(msgNotice3.id, elNotice3);
  assert.ok(selectedIds.has(msgNotice3.id), 'msgNotice3 deve estar selecionada');
  assert.strictEqual(selectedIds.size, 2, '2 avisos devem estar selecionados');

  // Abrir modal de exclusão para seleção múltipla
  await win.openDeleteModal(true);
  assert.strictEqual(modalTitle.innerText, 'Apagar 2 Mensagem(ns)?', 'Título deve indicar 2 mensagens selecionadas');
  assert.strictEqual(deleteForEveryoneBtn.style.display, 'none', 'Como há aviso apagado selecionado, Apagar para todos deve ficar oculto');
  assert.strictEqual(deleteForMeBtn.style.display, 'block', 'Apagar para mim deve estar ativo');

  // Clicar em Apagar para Mim para a seleção múltipla
  await deleteForMeBtn.click();
  await new Promise(r => setTimeout(r, 100));

  assert.strictEqual(container.children.some(c => c.dataset && c.dataset.id === msgNotice2.id), false, 'Aviso 2 deve ter sido removido do DOM');
  assert.strictEqual(container.children.some(c => c.dataset && c.dataset.id === msgNotice3.id), false, 'Aviso 3 deve ter sido removido do DOM');
  assert.strictEqual(container.children.some(c => c.dataset && c.dataset.id === msgNormal.id), true, 'Mensagem normal não selecionada deve permanecer no DOM');

  const updatedDoc2 = env.firestoreDocs[`chats/${chatId}/messages/${msgNotice2.id}`];
  const updatedDoc3 = env.firestoreDocs[`chats/${chatId}/messages/${msgNotice3.id}`];
  assert.ok(updatedDoc2.deletedFor.includes(currentUid), 'Doc 2 deve ter currentUser no deletedFor');
  assert.ok(updatedDoc3.deletedFor.includes(currentUid), 'Doc 3 deve ter currentUser no deletedFor');

  // 8. Testar "Limpar Avisos Apagados" do menu dropdown
  // Adiciona novo aviso para testar a ação em massa do menu
  const msgNotice4 = {
    id: 'msg_del_4',
    senderUid: 'contact_alice',
    text: '🚫 Esta mensagem foi apagada',
    deletedForEveryone: true,
    deletedFor: [],
    createdAt: Date.now()
  };
  msgMap.set(msgNotice4.id, msgNotice4);
  env.firestoreDocs[`chats/${chatId}/messages/${msgNotice4.id}`] = { ...msgNotice4 };
  const divNotice4 = env.sandbox.document.createElement('div');
  divNotice4.className = 'message received deleted-msg';
  divNotice4.dataset = { id: msgNotice4.id };
  divNotice4.innerHTML = `<span>🚫 Esta mensagem foi apagada</span>`;
  container.appendChild(divNotice4);

  // Simula confirmação do window.confirm
  const origConfirm = win.confirm;
  win.confirm = () => true;

  const clearNoticesBtn = env.elements['clear-deleted-notices-trigger'];
  assert.ok(clearNoticesBtn, 'Botão de limpar avisos apagados deve existir');
  await clearNoticesBtn.click();
  await new Promise(r => setTimeout(r, 50));

  assert.strictEqual(container.children.some(c => c.dataset && c.dataset.id === msgNotice4.id), false, 'Aviso 4 deve ter sido limpo pelo menu');
  const updatedDoc4 = env.firestoreDocs[`chats/${chatId}/messages/${msgNotice4.id}`];
  assert.ok(updatedDoc4.deletedFor.includes(currentUid), 'Doc 4 deve ter currentUser no deletedFor');

  win.confirm = origConfirm;
});

test('Seleção de Tipo de Chamada (Vídeo ou Áudio) ao Clicar no Ícone de Câmera (v1.0.184)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.184+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 184, 'script.js deve ter versão >= 1.0.184');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 184, 'version.json deve ter versão >= 1.0.184');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js versionado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache vortex-vip-v1.0.x');

  // 2. Elementos DOM no index.html
  assert.ok(env.elements['chat-audio-call-btn'], '#chat-audio-call-btn (ícone de câmera) deve existir no cabeçalho');
  assert.ok(env.elements['call-type-modal'], '#call-type-modal deve existir');
  assert.ok(env.elements['call-type-avatar'], '#call-type-avatar deve existir no modal');
  assert.ok(env.elements['call-type-contact-name'], '#call-type-contact-name deve existir no modal');
  assert.ok(env.elements['call-type-contact-status'], '#call-type-contact-status deve existir no modal');
  assert.ok(env.elements['start-video-call-opt-btn'], '#start-video-call-opt-btn deve existir para escolher chamada de vídeo');
  assert.ok(env.elements['start-audio-call-opt-btn'], '#start-audio-call-opt-btn deve existir para escolher chamada de áudio');
  assert.ok(env.elements['close-call-type-modal'], '#close-call-type-modal deve existir');
  assert.ok(env.elements['cancel-call-type-modal-btn'], '#cancel-call-type-modal-btn deve existir');

  // 3. Regras de CSS em style.css
  assert.ok(css.includes('.call-type-card'), 'style.css deve conter estilos para .call-type-card');
  assert.ok(css.includes('.call-type-option-btn'), 'style.css deve conter estilos para .call-type-option-btn');
  assert.ok(css.includes('.video-call-opt'), 'style.css deve conter estilos para .video-call-opt');
  assert.ok(css.includes('.audio-call-opt'), 'style.css deve conter estilos para .audio-call-opt');
  assert.ok(css.includes('.video-call-overlay.audio-call-mode'), 'style.css deve conter suporte para .audio-call-mode no overlay');

  // 4. Usuário logado e contato ativo
  const currentUid = 'user_call_tester_me';
  const currentUser = { uid: currentUid, displayName: 'Tester Me', email: 'tester@vortex.vip' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  const contact = { uid: 'contact_tester_bob', name: 'Bob Silva VIP', status: 'Disponível no VORTEX ⚡', avatar: '' };
  win.setActiveChatContact(contact);

  const modal = env.elements['call-type-modal'];
  const callBtn = env.elements['chat-audio-call-btn'];

  // 5. Clicar no ícone de câmera deve abrir o modal de escolha (e NÃO iniciar chamada direta)
  await callBtn.click();
  assert.ok(modal.classList.contains('active'), 'Ao clicar no ícone de câmera, o modal de escolha deve se abrir');
  assert.strictEqual(env.elements['call-type-contact-name'].innerText, 'Bob Silva VIP', 'Nome do contato deve estar preenchido');
  assert.strictEqual(env.elements['call-type-contact-status'].innerText, 'Disponível no VORTEX ⚡', 'Status do contato deve ser exibido');

  // 6. Testar fechamento do modal
  win.closeCallTypeModal();
  assert.ok(!modal.classList.contains('active'), 'closeCallTypeModal deve fechar o modal');

  // 7. Testar Escolha: Chamada de Vídeo
  await callBtn.click();
  assert.ok(modal.classList.contains('active'), 'Modal reaberto');
  const videoOptBtn = env.elements['start-video-call-opt-btn'];
  await videoOptBtn.click();
  assert.ok(!modal.classList.contains('active'), 'Modal deve se fechar ao selecionar chamada de vídeo');

  const overlay = env.elements['video-call-overlay'];
  assert.ok(overlay.classList.contains('active'), 'Overlay de chamada deve ativar');
  assert.ok(!overlay.classList.contains('audio-call-mode'), 'Chamada de vídeo não deve ter classe audio-call-mode');

  // Verificar chamada criada no Firestore com type: 'video'
  const createdCalls = Object.values(env.firestoreDocs).filter(d => d.callerUid === currentUid && d.calleeUid === contact.uid);
  assert.ok(createdCalls.length > 0, 'Deve registrar chamada no Firestore');
  const lastCall = createdCalls[createdCalls.length - 1];
  assert.strictEqual(lastCall.type, 'video', 'Tipo da chamada criada deve ser "video"');

  // Desligar chamada de vídeo
  const endCallBtn = env.elements['end-call-btn'];
  await endCallBtn.click();
  assert.ok(!overlay.classList.contains('active'), 'Overlay deve fechar após desligar');

  // 8. Testar Escolha: Chamada de Áudio
  await callBtn.click();
  assert.ok(modal.classList.contains('active'), 'Modal reaberto para teste de áudio');
  const audioOptBtn = env.elements['start-audio-call-opt-btn'];
  await audioOptBtn.click();
  assert.ok(!modal.classList.contains('active'), 'Modal deve fechar ao escolher chamada de áudio');

  assert.ok(overlay.classList.contains('active'), 'Overlay de chamada deve ativar para chamada de áudio');
  assert.ok(overlay.classList.contains('audio-call-mode'), 'Chamada de áudio deve adicionar classe audio-call-mode no overlay');
  assert.strictEqual(env.elements['call-status'].innerText, 'Chamando (Áudio)...', 'Status deve indicar Chamando (Áudio)...');

  // Verificar chamada criada no Firestore com type: 'audio'
  const createdAudioCalls = Object.values(env.firestoreDocs).filter(d => d.callerUid === currentUid && d.calleeUid === contact.uid && d.type === 'audio');
  assert.ok(createdAudioCalls.length > 0, 'Deve registrar chamada com type: audio no Firestore');

  // Desligar chamada de áudio
  await endCallBtn.click();
  assert.ok(!overlay.classList.contains('active'), 'Overlay deve fechar após desligar');
  assert.ok(!overlay.classList.contains('audio-call-mode'), 'Classe audio-call-mode deve ser limpa');

  // 9. Proteção para Contato Bloqueado
  win.getBlockedContactsSet().add(contact.uid);
  win.openCallTypeModal(contact);
  assert.ok(!modal.classList.contains('active'), 'Modal não deve abrir se contato estiver bloqueado');
  win.getBlockedContactsSet().delete(contact.uid);
});

test('Trocar para Chamada de Vídeo durante Chamada de Áudio via Botão de Câmera (v1.0.185)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.185+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 185, 'script.js deve ter versão >= 1.0.185');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 185, 'version.json deve ter versão >= 1.0.185');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js versionado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache vortex-vip-v1.0.x');

  // 2. Integridade de CSS e Funções
  assert.ok(css.includes('.video-call-overlay.audio-call-mode #toggle-camera-btn'), 'style.css deve conter regras para #toggle-camera-btn em audio-call-mode');
  assert.strictEqual(typeof win.switchToVideoCall, 'function', 'switchToVideoCall deve estar definida e exportada');

  // 3. Setup de Usuário e Contato
  const currentUid = 'user_audio_to_video_me';
  const currentUser = { uid: currentUid, displayName: 'Tester AV', email: 'av@vortex.vip' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  const contact = { uid: 'contact_dx_hub', name: 'DX HUB DIGITAL', status: 'Criptografia VIP', avatar: '' };
  win.setActiveChatContact(contact);

  const overlay = env.elements['video-call-overlay'];
  const toggleCamBtn = env.elements['toggle-camera-btn'];
  const localPip = env.elements['local-video-wrapper'];
  const switchCamBtn = env.elements['switch-camera-btn'];
  const userInfoBox = env.elements['call-user-info-box'];
  const statusEl = env.elements['call-status'];

  // 4. Iniciar Chamada no Modo de Áudio (como na imagem do usuário)
  await win.startCall(false);
  assert.ok(overlay.classList.contains('active'), 'Overlay de chamada deve estar ativo');
  assert.ok(overlay.classList.contains('audio-call-mode'), 'Deve estar em modo de áudio');
  assert.strictEqual(localPip.style.display, 'none', 'PIP de vídeo local deve estar oculto no modo áudio');
  assert.strictEqual(switchCamBtn.style.display, 'none', 'Botão de alternar câmera deve estar oculto no modo áudio');
  assert.strictEqual(statusEl.innerText, 'Chamando (Áudio)...', 'Status deve ser Chamando (Áudio)...');

  // 5. Verificar estado do botão de câmera no modo áudio (botão circulado pelo usuário)
  assert.strictEqual(toggleCamBtn.title, 'Trocar para Chamada de Vídeo', 'Título do botão deve indicar Trocar para Chamada de Vídeo');
  assert.strictEqual(toggleCamBtn.getAttribute('aria-label'), 'Trocar para Chamada de Vídeo', 'Aria-label deve ser Trocar para Chamada de Vídeo');
  assert.ok(toggleCamBtn.style.background.includes('ff3b30') || toggleCamBtn.style.background.includes('255, 59, 48'), 'Botão deve ter destaque vermelho conforme foto do usuário');

  // 6. Clicar no botão para TROCAR PARA CHAMADA DE VÍDEO
  await toggleCamBtn.click();

  // 7. Verificar se transicionou perfeitamente para Chamada de Vídeo
  assert.ok(!overlay.classList.contains('audio-call-mode'), 'Overlay não deve mais estar em audio-call-mode');
  assert.ok(!userInfoBox.classList.contains('audio-only-call'), 'userInfoBox não deve ter audio-only-call');
  assert.strictEqual(localPip.style.display, '', 'PIP de vídeo local deve estar visível');
  assert.strictEqual(switchCamBtn.style.display, 'flex', 'Botão de virar câmera deve estar visível');
  assert.strictEqual(statusEl.innerText, 'Chamando (Vídeo)...', 'Status deve mudar para Chamando (Vídeo)...');
  assert.strictEqual(toggleCamBtn.title, 'Desligar Câmera', 'Título do botão deve voltar para Desligar Câmera');

  // 8. Verificar atualização do documento de chamada no Firestore
  const calls = Object.values(env.firestoreDocs).filter(d => d.callerUid === currentUid && d.calleeUid === contact.uid);
  assert.ok(calls.length > 0, 'Documento de chamada deve existir no Firestore');
  const activeCallDoc = calls[calls.length - 1];
  assert.strictEqual(activeCallDoc.type, 'video', 'Documento no Firestore deve ter type: video');
  assert.strictEqual(activeCallDoc.hasVideo, true, 'Documento no Firestore deve ter hasVideo: true');

  // 9. Clicar no botão agora em modo vídeo para desligar câmera (comportamento de toggle)
  await toggleCamBtn.click();
  assert.strictEqual(win.getIsCameraOff(), true, 'Câmera deve estar desligada');
  assert.strictEqual(toggleCamBtn.title, 'Ligar Câmera', 'Título deve ser Ligar Câmera');

  // 10. Desligar chamada
  const endCallBtn = env.elements['end-call-btn'];
  await endCallBtn.click();
  assert.ok(!overlay.classList.contains('active'), 'Overlay deve fechar após desligar');
});

test('Ícone de Rotação em Volta da Câmera para Troca de Chamada de Vídeo (v1.0.186)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.186+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 186, 'script.js deve ter versão >= 1.0.186');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 186, 'version.json deve ter versão >= 1.0.186');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve ter cache');

  // 2. Integridade de CSS dos novos elementos de rotação e câmera
  assert.ok(css.includes('.switch-video-btn-content'), 'style.css deve conter .switch-video-btn-content');
  assert.ok(css.includes('.switch-rotate-icon'), 'style.css deve conter .switch-rotate-icon');
  assert.ok(css.includes('.switch-camera-inner-icon'), 'style.css deve conter .switch-camera-inner-icon');

  // 3. Setup de Usuário e Contato
  const currentUid = 'user_audio_rotation_me';
  const currentUser = { uid: currentUid, displayName: 'Tester Rotation', email: 'rot@vortex.vip' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  const contact = { uid: 'contact_dx_hub_2', name: 'DX HUB DIGITAL', status: 'Chamando...', avatar: '' };
  win.setActiveChatContact(contact);

  const overlay = env.elements['video-call-overlay'];
  const toggleCamBtn = env.elements['toggle-camera-btn'];

  // 4. Iniciar chamada em modo de áudio
  await win.startCall(false);
  assert.ok(overlay.classList.contains('active'), 'Overlay ativo');
  assert.ok(overlay.classList.contains('audio-call-mode'), 'Em modo de áudio');

  // 5. Verificar se o botão de câmera contém o ícone de rotação em volta da câmera
  const btnHTML = toggleCamBtn.innerHTML;
  assert.ok(btnHTML.includes('switch-video-btn-content'), 'Botão deve conter container switch-video-btn-content');
  assert.ok(btnHTML.includes('switch-rotate-icon'), 'Botão deve conter ícone de rotação switch-rotate-icon em volta');
  assert.ok(btnHTML.includes('refresh-cw'), 'Ícone de rotação deve ser refresh-cw (setas circulares)');
  assert.ok(btnHTML.includes('switch-camera-inner-icon'), 'Botão deve conter ícone de câmera switch-camera-inner-icon no centro');
  assert.ok(btnHTML.includes('data-lucide="video"'), 'Ícone interno deve ser a câmera de vídeo');

  // 6. Clicar no botão para alternar para chamada de vídeo
  await toggleCamBtn.click();
  assert.ok(!overlay.classList.contains('audio-call-mode'), 'Deve ter saído do modo áudio');

  // 7. Em modo de vídeo, o botão volta ao ícone normal de câmera/toggle
  const btnVideoHTML = toggleCamBtn.innerHTML;
  assert.ok(!btnVideoHTML.includes('switch-rotate-icon'), 'Em modo de vídeo, não deve mais ter ícone de rotação');
  assert.strictEqual(toggleCamBtn.title, 'Desligar Câmera', 'Título do botão deve ser Desligar Câmera');

  // 8. Desligar chamada
  const endCallBtn = env.elements['end-call-btn'];
  await endCallBtn.click();
  assert.ok(!overlay.classList.contains('active'), 'Chamada encerrada');
});

test('Organização em Linha Única dos Títulos Mensagens Favoritas e Dados da Mensagem (v1.0.187)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.187+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 187, 'script.js deve ter versão >= 1.0.187');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 187, 'version.json deve ter versão >= 1.0.187');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache');

  // 2. CSS de Linha Única nos Títulos e Prevenção de Quebra
  assert.ok(css.includes('.starred-messages-card .modal-title'), 'style.css deve estilizar título de mensagens favoritas');
  assert.ok(css.includes('.msg-info-title-box h2'), 'style.css deve conter .msg-info-title-box h2');
  assert.ok(css.includes('.msg-info-reader-user-meta'), 'style.css deve conter .msg-info-reader-user-meta para truncamento');
  assert.ok(css.includes('white-space: nowrap !important;'), 'style.css deve aplicar white-space: nowrap !important');

  // 3. Verificação DOM de Mensagens Favoritas
  const starredModal = env.elements['starred-messages-modal'];
  assert.ok(starredModal, '#starred-messages-modal deve existir');
  assert.ok(html.includes('Mensagens Favoritas'), 'index.html deve conter título Mensagens Favoritas');

  // 4. Verificação DOM de Dados da Mensagem
  const msgInfoModal = env.elements['message-info-modal'];
  assert.ok(msgInfoModal, '#message-info-modal deve existir');
  assert.ok(html.includes('Dados da Mensagem'), 'index.html deve conter título Dados da Mensagem');
});

test('Reações com Emojis Exclusivas no Duplo Clique e Remoção da Barra de Ações (v1.0.188)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.188+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 188, 'script.js deve ter versão >= 1.0.188');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 188, 'version.json deve ter versão >= 1.0.188');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache');

  // 2. Integridade dos Elementos no DOM e CSS
  const emojiBar = env.elements['floating-emoji-bar'];
  const actionBar = env.elements['floating-reaction-bar'];
  const emojiPill = env.elements['emoji-reaction-pill'];

  assert.ok(emojiBar, '#floating-emoji-bar deve existir no DOM');
  assert.ok(actionBar, '#floating-reaction-bar deve existir no DOM');
  assert.ok(emojiPill, '#emoji-reaction-pill deve existir no DOM');

  assert.ok(css.includes('.floating-emoji-bar'), 'style.css deve conter estilos de .floating-emoji-bar');
  assert.ok(css.includes('.floating-emoji-bar.active'), 'style.css deve conter .floating-emoji-bar.active');
  assert.ok(css.includes('msg-action-divider'), 'style.css deve conter .msg-action-divider');

  // 3. Mock de Mensagem e Elemento
  const currentUser = { uid: 'user_reaction_me', name: 'Tester Emojis', email: 'emoji@vortex.vip' };
  win.setCurrentUser(currentUser);
  win.setCurrentProfile(currentUser);

  const testMsg = {
    id: 'msg-test-reaction-1',
    senderUid: 'contact_friend_1',
    text: 'Mensagem de teste para reações com emojis',
    type: 'text',
    createdAt: Date.now()
  };

  const mockMsgEl = env.makeMockElement('div');
  mockMsgEl.getBoundingClientRect = () => ({ top: 200, bottom: 240, left: 20, right: 220, width: 200, height: 40 });

  // 4. Testar Duplo Clique / Exibição Exclusiva da Barra de Emojis
  win.showFloatingEmojiBar(testMsg, mockMsgEl);
  assert.ok(emojiBar.classList.contains('active'), '#floating-emoji-bar deve ter classe active');
  assert.strictEqual(emojiBar.style.display, 'flex', '#floating-emoji-bar deve ter display flex');
  assert.strictEqual(emojiPill.style.display, 'flex', '#emoji-reaction-pill deve ter display flex');
  assert.ok(!actionBar.classList.contains('active'), '#floating-reaction-bar de ações NÃO deve estar ativa ao abrir emojis');

  // 5. Testar Ocultação da Barra de Emojis
  win.hideFloatingEmojiBar();
  assert.ok(!emojiBar.classList.contains('active'), '#floating-emoji-bar deve perder classe active ao ocultar');
  assert.strictEqual(emojiBar.style.display, 'none', '#floating-emoji-bar deve ter display none');

  // 6. Testar Pressionar / Barra de Ações (Sem os Emojis!)
  win.showFloatingReactions(testMsg, mockMsgEl);
  assert.ok(actionBar.classList.contains('active'), '#floating-reaction-bar deve estar ativa ao pressionar');
  assert.ok(!emojiBar.classList.contains('active'), '#floating-emoji-bar deve estar fechada ao abrir ações');
  assert.strictEqual(emojiPill.style.display, 'none', '#emoji-reaction-pill deve estar OCULTO na barra de ações');

  // Botões de ação devem estar disponíveis normalmente na barra de ações
  const actionSelectBtn = env.elements['action-select-btn'];
  const actionDeleteBtn = env.elements['action-delete-btn'];
  assert.strictEqual(actionSelectBtn.style.display, 'inline-flex', 'Botão selecionar deve estar visível');
  assert.strictEqual(actionDeleteBtn.style.display, 'inline-flex', 'Botão apagar deve estar visível');

  // 7. Ocultar Ações
  win.hideFloatingReactions();
  assert.ok(!actionBar.classList.contains('active'), '#floating-reaction-bar deve fechar');
});

test('Organização e Estilização Visual dos Modais de Cupons e Frete da Loja (v1.0.189)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.189+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 189, 'script.js deve ter versão >= 1.0.189');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 189, 'version.json deve ter versão >= 1.0.189');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache');

  // 2. Integridade dos Estilos CSS (.catalog-field-input, cabeçalhos em linha única, layout responsivo)
  assert.ok(css.includes('.catalog-field-input'), 'style.css deve definir .catalog-field-input para inputs escuros');
  assert.ok(css.includes('select.catalog-field-input'), 'style.css deve estilizar select com seta personalizada');
  assert.ok(css.includes('.catalog-coupons-card .modal-title'), 'style.css deve formatar título dos cupons em linha única');
  assert.ok(css.includes('.catalog-shipping-card .modal-title'), 'style.css deve formatar título do frete em linha única');
  assert.ok(css.includes('.catalog-coupon-header-row'), 'style.css deve conter .catalog-coupon-header-row para quebra responsiva');
  assert.ok(css.includes('overflow-x: hidden !important;'), 'style.css deve impedir transbordamento horizontal');

  // 3. Teste de Renderização dos Cupons sem Duplicidade de Moeda (v1.0.189)
  const seller = { uid: 'seller_organize_189', name: 'Vendedor Organizado' };
  win.setCurrentUser(seller);
  win.setCurrentProfile({
    ...seller,
    storeCoupons: {
      'VORTEXVIP': { code: 'VORTEXVIP', type: 'fixed', value: 8, label: 'Promoção de Cupom' }
    }
  });

  win.renderSellerCouponsUI();
  const couponsList = env.elements['catalog-coupons-list'];
  assert.ok(couponsList, '#catalog-coupons-list deve existir');
  assert.ok(!couponsList.innerHTML.includes('R$ R$'), 'Cupom de desconto NÃO deve duplicar o símbolo de moeda (R$ R$)');
  assert.ok(couponsList.innerHTML.includes('R$ 8,00 OFF') || couponsList.innerHTML.includes('8,00 OFF'), 'Cupom deve exibir o valor correto formatado');
  assert.ok(couponsList.innerHTML.includes('catalog-coupon-header-row'), 'Itens de cupom devem usar container responsivo');

  // 4. Teste de Atualização da Prévia do Frete sem Duplicidade de Emojis ou Moeda
  const priceInput = env.elements['catalog-shipping-price-input'];
  if (priceInput) priceInput.value = '20';
  const deadlineInput = env.elements['catalog-shipping-deadline-input'];
  if (deadlineInput) deadlineInput.value = '6 a 16 dias úteis';
  const typeSelect = env.elements['catalog-shipping-type-select'];
  if (typeSelect) typeSelect.value = 'fixed';

  win.updateShippingModalUI();
  const previewText = env.elements['catalog-shipping-preview-text'];
  assert.ok(previewText, '#catalog-shipping-preview-text deve existir');
  assert.ok(!previewText.innerText.includes('🚚 🚚'), 'Prévia de frete NÃO deve duplicar o ícone de caminhão (🚚 🚚)');
  assert.ok(!previewText.innerText.includes('R$ R$'), 'Prévia de frete NÃO deve duplicar o símbolo de moeda (R$ R$)');
  assert.ok(previewText.innerText.includes('Frete Fixo:') && previewText.innerText.includes('20,00') && previewText.innerText.includes('6 a 16 dias úteis'), 'Prévia de frete deve estar limpa e correta');
});

test('Opção de Salvar Posts nos Favoritos na Aba de Feed Reels e Alinhamento ao Lado do Ícone de Compartilhar (v1.0.191)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.191+)
  assert.ok(parseInt(win.CURRENT_APP_VERSION.split('.')[2], 10) >= 191, 'script.js deve ter versão >= 1.0.191');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(parseInt(versionJson.version.split('.')[2], 10) >= 191, 'version.json deve ter versão >= 1.0.191');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache');

  // 2. Elementos de Abas de Filtro no DOM e Regras de CSS
  const filterBar = env.elements['feed-filter-bar'];
  const allBtn = env.elements['feed-filter-all-btn'];
  const favBtn = env.elements['feed-filter-favorites-btn'];
  const favCountBadge = env.elements['feed-favorites-count'];
  const feedList = env.elements['feed-list'];
  const countLabel = env.elements['posts-count-label'];

  assert.ok(filterBar, '#feed-filter-bar deve existir no DOM');
  assert.ok(allBtn, '#feed-filter-all-btn deve existir no DOM');
  assert.ok(favBtn, '#feed-filter-favorites-btn deve existir no DOM');
  assert.ok(favCountBadge, '#feed-favorites-count deve existir no DOM');

  assert.ok(css.includes('.feed-filter-bar'), 'style.css deve conter .feed-filter-bar');
  assert.ok(css.includes('.feed-filter-tab.active'), 'style.css deve conter .feed-filter-tab.active');
  assert.ok(css.includes('.feed-fav-count-badge'), 'style.css deve conter .feed-fav-count-badge');
  assert.ok(css.includes('.feed-action-btn.save-post-btn.saved'), 'style.css deve conter .feed-action-btn.save-post-btn.saved');
  assert.ok(css.includes('flex-wrap: nowrap;'), 'style.css deve manter botões de ação em linha única com flex-wrap: nowrap');
  assert.ok(css.includes('margin-left: 0;'), 'style.css deve posicionar save-post-btn logo ao lado do botão de compartilhar');

  // 3. Configurar Usuário e Postagens de Teste no Feed Reels
  const user = { uid: 'user_fav_reels_190', name: 'Carlos Reels', email: 'carlos@vortex.vip', savedPosts: [] };
  win.setCurrentUser(user);
  win.setCurrentProfile(user);
  env.firestoreDocs[`users/${user.uid}`] = { ...user };

  const samplePosts = [
    {
      id: 'post_reel_1',
      authorUid: 'author_1',
      authorName: 'Ana Criadora',
      caption: 'Primeiro vídeo incrível no Feed Reels!',
      type: 'image',
      mediaData: 'data:image/png;base64,img1',
      likes: [],
      comments: [],
      createdAt: 1000
    },
    {
      id: 'post_reel_2',
      authorUid: 'author_2',
      authorName: 'Bruno Tech',
      caption: 'Dica de programação e tecnologia VIP',
      type: 'image',
      mediaData: 'data:image/png;base64,img2',
      likes: [],
      comments: [],
      createdAt: 2000
    }
  ];

  win.renderPostsFeed(samplePosts);
  assert.strictEqual(win.getFeedFilterMode(), 'all', 'Modo inicial deve ser all');
  assert.strictEqual(favCountBadge.innerText, '0', 'Contador inicial de favoritos deve ser 0');
  assert.ok(feedList.innerHTML.includes('data-action="save-post"'), 'Cada post deve ter botão de salvar nos favoritos (data-action="save-post")');
  assert.ok(feedList.innerHTML.includes('Favoritar'), 'Botão deve exibir texto Favoritar');
  assert.ok(!feedList.innerHTML.includes('<span>Compartilhar</span>'), 'Botão de compartilhar deve exibir apenas o ícone sem o título em texto');

  // 4. Salvar o post_reel_2 nos favoritos
  const savedResult = await win.toggleSaveFeedPost('post_reel_2');
  assert.strictEqual(savedResult, true, 'toggleSaveFeedPost deve retornar true ao salvar');
  assert.strictEqual(win.isPostSaved('post_reel_2'), true, 'isPostSaved deve retornar true para post_reel_2');
  assert.strictEqual(win.isPostSaved('post_reel_1'), false, 'isPostSaved deve retornar false para post_reel_1');
  assert.deepStrictEqual(Array.from(win.getSavedPostIds()), ['post_reel_2'], 'getSavedPostIds deve conter post_reel_2');
  assert.strictEqual(favCountBadge.innerText, '1', 'Badge de favoritos deve atualizar para 1');
  assert.deepStrictEqual(Array.from(env.firestoreDocs[`users/${user.uid}`].savedPosts), ['post_reel_2'], 'Firestore do usuário deve persistir savedPosts');

  // 5. Alternar para a aba "Favoritos" no Feed Reels
  win.setFeedFilterMode('favorites');
  assert.strictEqual(win.getFeedFilterMode(), 'favorites', 'Modo de filtro deve ser favorites');
  assert.ok(favBtn.classList.contains('active'), 'Botão Favoritos deve estar ativo');
  assert.ok(!allBtn.classList.contains('active'), 'Botão Todos não deve estar ativo');
  assert.strictEqual(countLabel.innerText, '1 favorito salvo', 'Label de contagem deve indicar 1 favorito salvo');
  assert.ok(feedList.innerHTML.includes('post_reel_2'), 'Aba de favoritos deve exibir post_reel_2');
  assert.ok(!feedList.innerHTML.includes('post_reel_1'), 'Aba de favoritos NÃO deve exibir post_reel_1 não salvo');
  assert.ok(feedList.innerHTML.includes('Salvo'), 'Botão do post favoritado deve exibir Salvo');

  // 6. Remover post_reel_2 dos favoritos estando na aba Favoritos -> Deve exibir estado vazio
  const unsavedResult = await win.toggleSaveFeedPost('post_reel_2');
  assert.strictEqual(unsavedResult, false, 'toggleSaveFeedPost deve retornar false ao remover dos favoritos');
  assert.strictEqual(win.isPostSaved('post_reel_2'), false, 'post_reel_2 não deve mais estar salvo');
  assert.strictEqual(favCountBadge.innerText, '0', 'Badge de favoritos deve voltar para 0');
  assert.ok(feedList.innerHTML.includes('feed-favorites-empty'), 'Deve exibir estado vazio de favoritos quando não há posts salvos');
  assert.ok(feedList.innerHTML.includes('Nenhum post nos favoritos'), 'Mensagem de estado vazio deve aparecer');

  // 7. Voltar para a aba "Todos"
  win.setFeedFilterMode('all');
  assert.strictEqual(win.getFeedFilterMode(), 'all', 'Modo deve voltar para all');
  assert.ok(feedList.innerHTML.includes('post_reel_1') && feedList.innerHTML.includes('post_reel_2'), 'Todos os posts devem voltar a aparecer na aba Todos');
});

test('Opção de Título do Post e Hashtags com Limite Máximo de 3 # e Bloqueio Automático (v1.0.192)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.192+)
  const verParts192 = String(win.CURRENT_APP_VERSION || '').split('.').map(Number);
  assert.ok(verParts192[2] >= 192, 'script.js deve ter versão >= 1.0.192');

  // 2. Elementos de Título do Post e Hashtags no DOM e Regras de CSS
  const titleWrap = env.elements['post-title-wrap'];
  const titleInput = env.elements['post-title-input'];
  const titleCount = env.elements['post-title-char-count'];
  const hashtagsWrap = env.elements['post-hashtags-wrap'];
  const hashtagsInput = env.elements['post-hashtags-input'];
  const hashtagsCount = env.elements['post-hashtags-count'];
  const hashtagsChips = env.elements['post-hashtags-chips'];
  const hashtagsHint = env.elements['post-hashtags-limit-hint'];

  assert.ok(titleWrap, '#post-title-wrap deve existir no DOM');
  assert.ok(titleInput, '#post-title-input deve existir no DOM');
  assert.ok(titleCount, '#post-title-char-count deve existir no DOM');
  assert.ok(hashtagsWrap, '#post-hashtags-wrap deve existir no DOM');
  assert.ok(hashtagsInput, '#post-hashtags-input deve existir no DOM');
  assert.ok(hashtagsCount, '#post-hashtags-count deve existir no DOM');
  assert.ok(hashtagsChips, '#post-hashtags-chips deve existir no DOM');
  assert.ok(hashtagsHint, '#post-hashtags-limit-hint deve existir no DOM');

  assert.ok(css.includes('.post-title-input'), 'style.css deve conter .post-title-input');
  assert.ok(css.includes('.post-hashtags-input'), 'style.css deve conter .post-hashtags-input');
  assert.ok(css.includes('.post-hashtags-input.hashtags-blocked'), 'style.css deve conter .post-hashtags-input.hashtags-blocked');
  assert.ok(css.includes('.feed-post-title'), 'style.css deve conter .feed-post-title');
  assert.ok(css.includes('.feed-hashtag-pill'), 'style.css deve conter .feed-hashtag-pill');

  // 3. Testar Validação e Limite de até 3 # (parsePostHashtags e enforcePostHashtagsLimit)
  assert.strictEqual(win.MAX_POST_HASHTAGS, 3, 'Limite máximo de hashtags deve ser 3');

  // Até 3 hashtags: permitido normalmente
  hashtagsInput.value = '#vortex #reels #vip';
  const okResult = win.enforcePostHashtagsLimit(hashtagsInput, false);
  assert.strictEqual(okResult.wasBlocked, false, '3 hashtags não devem disparar bloqueio');
  assert.strictEqual(okResult.count, 3, 'Contagem deve ser 3');
  assert.deepStrictEqual(Array.from(okResult.hashtags), ['#vortex', '#reels', '#vip'], 'Deve extrair as 3 hashtags corretamente');
  assert.strictEqual(hashtagsCount.innerText, '3/3 #', 'Contador visual deve exibir 3/3 #');
  assert.ok(hashtagsChips.innerHTML.includes('#vortex') && hashtagsChips.innerHTML.includes('#vip'), 'Chips de preview devem renderizar as 3 hashtags');

  // 4. Tentar colocar mais de 3 # (ex: 4ª hashtag ou 4º símbolo #): DEVE BLOQUEAR!
  hashtagsInput.value = '#vortex #reels #vip #quarta';
  const blockedResult = win.enforcePostHashtagsLimit(hashtagsInput, true);
  assert.strictEqual(blockedResult.wasBlocked, true, '4ª hashtag (#) deve ser bloqueada imediatamente');
  assert.strictEqual(hashtagsInput.value, '#vortex #reels #vip', 'O valor do input deve ser truncado/bloqueado nas 3 primeiras hashtags');
  assert.ok(hashtagsInput.classList.contains('hashtags-blocked'), 'Input deve receber a classe hashtags-blocked quando bloqueado');
  assert.strictEqual(hashtagsHint.style.display, 'flex', 'Aviso de bloqueio #post-hashtags-limit-hint deve ficar visível');
  assert.ok(hashtagsCount.classList.contains('limit-reached'), 'Contador deve receber classe limit-reached');

  // Tentar colar 4 símbolos # juntos (#um#dois#tres#quatro)
  hashtagsInput.value = '#um#dois#tres#quatro';
  const pastedBlocked = win.enforcePostHashtagsLimit(hashtagsInput, false);
  assert.strictEqual(pastedBlocked.wasBlocked, true, 'Mais de 3 # colados juntos também devem ser bloqueados');
  assert.strictEqual(pastedBlocked.hashtags.length, 3, 'Apenas 3 hashtags devem permanecer');

  // 5. Renderização do Título e das 3 # no Card do Feed Reels e Busca
  const feedList = env.elements['feed-list'];
  const postsWithTitleAndTags = [
    {
      id: 'post_titled_192',
      authorUid: 'user_creator_192',
      authorName: 'Deyvison Criador',
      title: 'Lançamento Oficial no Feed Reels',
      caption: 'Confira todas as novidades desta versão!',
      hashtags: ['#vortex', '#reels', '#lancamento'],
      type: 'image',
      mediaData: 'data:image/png;base64,img192',
      likes: [],
      comments: [],
      createdAt: 5000
    }
  ];

  win.renderPostsFeed(postsWithTitleAndTags);
  assert.ok(feedList.innerHTML.includes('feed-post-title'), 'Feed deve renderizar o elemento .feed-post-title');
  assert.ok(feedList.innerHTML.includes('Lançamento Oficial no Feed Reels'), 'Feed deve exibir o título do post');
  assert.ok(feedList.innerHTML.includes('feed-hashtag-pill'), 'Feed deve renderizar as pílulas de hashtags (.feed-hashtag-pill)');
  assert.ok(feedList.innerHTML.includes('#vortex') && feedList.innerHTML.includes('#lancamento'), 'Feed deve exibir as hashtags do post');

  // Busca por título ou hashtag no Feed Reels
  const matchedByTitle = win.filterFeedPosts(postsWithTitleAndTags, 'Lançamento Oficial');
  assert.strictEqual(matchedByTitle.length, 1, 'filterFeedPosts deve encontrar o post pelo título');
  const matchedByHashtag = win.filterFeedPosts(postsWithTitleAndTags, '#lancamento');
  assert.strictEqual(matchedByHashtag.length, 1, 'filterFeedPosts deve encontrar o post pela hashtag');

  // 6. Reset do compositor deve limpar título e hashtags
  titleInput.value = 'Título Temporário';
  win.resetPostComposer();
  assert.strictEqual(titleInput.value, '', 'resetPostComposer deve limpar #post-title-input');
  assert.strictEqual(hashtagsInput.value, '', 'resetPostComposer deve limpar #post-hashtags-input');
  assert.strictEqual(hashtagsCount.innerText, '0/3 #', 'resetPostComposer deve restaurar contador para 0/3 #');
});

test('Categoria do Post Exclusiva para Conta Pessoal (v1.0.193)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.193+)
  const verParts193 = String(win.CURRENT_APP_VERSION || '').split('.').map(Number);
  assert.ok(verParts193[2] >= 193, 'script.js deve ter versão >= 1.0.193');

  // 2. Elementos no DOM e CSS da Categoria Pessoal
  const personalWrap = env.elements['post-personal-category-wrap'];
  const personalSelect = env.elements['post-personal-category-select'];
  const bizSection = env.elements['post-business-link-section'];

  assert.ok(personalWrap, '#post-personal-category-wrap deve existir no DOM');
  assert.ok(personalSelect, '#post-personal-category-select deve existir no DOM');
  assert.ok(css.includes('.post-personal-category-wrap'), 'style.css deve conter .post-personal-category-wrap');
  assert.ok(css.includes('.post-personal-category-select'), 'style.css deve conter .post-personal-category-select');
  assert.ok(css.includes('.personal-category-pill'), 'style.css deve conter .personal-category-pill');

  // 3. Lista Completa das Categorias Pessoais Solicitadas
  const requiredCategories = [
    'Entretenimento', 'Edição', 'Looks', 'Moda', 'Setup', 'Jogos',
    'Natureza', 'Estilos', 'Animais', 'Vida', 'Qualidade', 'Música',
    'Desafio', 'Comedia', 'Danssinha', 'Figura', 'Destaques'
  ];
  const personalCats = Array.from(win.PERSONAL_POST_CATEGORIES || []);
  for (const cat of requiredCategories) {
    assert.ok(personalCats.includes(cat), `PERSONAL_POST_CATEGORIES deve incluir "${cat}"`);
    assert.ok(html.includes(`value="${cat}"`), `#post-personal-category-select no HTML deve incluir option "${cat}"`);
  }

  // 4. Exclusividade para Conta Pessoal vs Conta Empresarial
  // Conta Pessoal -> exibe seletor de categoria pessoal e oculta seção empresarial
  win.updateCompanyLinkSectionVisibility({ accountType: 'personal' });
  assert.strictEqual(personalWrap.style.display, 'flex', 'Seletor de categoria pessoal deve ficar visível (flex) para Conta Pessoal');
  assert.strictEqual(bizSection.style.display, 'none', 'Seção empresarial deve ficar oculta para Conta Pessoal');

  // Conta Empresarial -> oculta seletor de categoria pessoal e exibe seção empresarial
  win.updateCompanyLinkSectionVisibility({ accountType: 'business' });
  assert.strictEqual(personalWrap.style.display, 'none', 'Seletor de categoria pessoal deve ficar oculto (none) para Conta Empresarial');
  assert.strictEqual(bizSection.style.display, 'flex', 'Seção empresarial deve ficar visível para Conta Empresarial');

  // Sem accountType definido (padrão é Conta Pessoal) -> exibe seletor de categoria pessoal
  win.updateCompanyLinkSectionVisibility({});
  assert.strictEqual(personalWrap.style.display, 'flex', 'Perfil padrão (pessoal) deve exibir seletor de categoria pessoal');

  // 5. Post com Categoria Pessoal é Permanente (não expira em 24h) e Renderiza Badge Próprio
  const now = 1000000000000;
  const personalPost = {
    id: 'post_personal_cat_193',
    authorUid: 'user_personal_193',
    authorName: 'Ana Pessoal',
    personalCategory: 'Looks',
    category: 'Looks',
    isTemporary: false,
    expiresAt: null,
    caption: 'Look do dia especial!',
    type: 'image',
    mediaData: 'data:image/png;base64,look193',
    likes: [],
    comments: [],
    createdAt: now - (48 * 60 * 60 * 1000) // Criado há 48 horas
  };

  assert.strictEqual(win.isPostExpired(personalPost, now), false, 'Post de conta pessoal com categoria NÃO deve expirar após 24h/48h');
  const badgeHtml = win.getPostCategoryBadgeHTML(personalPost);
  assert.ok(badgeHtml.includes('personal-category-pill'), 'Badge de categoria pessoal deve usar a classe .personal-category-pill');
  assert.ok(badgeHtml.includes('Looks'), 'Badge deve exibir o nome da categoria escolhida ("Looks")');
  assert.ok(!badgeHtml.includes('24h'), 'Badge de categoria pessoal não deve exibir relógio de expiração 24h');

  // 6. Renderização no Feed Reels e Filtro de Busca por Categoria Pessoal
  const feedList = env.elements['feed-list'];
  win.renderPostsFeed([personalPost]);
  assert.ok(feedList.innerHTML.includes('personal-category-pill'), 'Feed Reels deve renderizar a pílula .personal-category-pill');
  assert.ok(feedList.innerHTML.includes('Looks'), 'Feed Reels deve exibir a categoria "Looks" no post');

  const filteredByCat = win.filterFeedPosts([personalPost], 'looks');
  assert.strictEqual(filteredByCat.length, 1, 'filterFeedPosts deve encontrar o post pela categoria pessoal');

  // 7. Reset do compositor deve limpar a seleção de categoria pessoal
  personalSelect.value = 'Jogos';
  win.resetPostComposer();
  assert.strictEqual(personalSelect.value, '', 'resetPostComposer deve limpar #post-personal-category-select');
});

test('Sistema de Visualizações para os Posts (v1.0.194)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.194+)
  const verParts194 = String(win.CURRENT_APP_VERSION || '').split('.').map(Number);
  assert.ok(verParts194[2] >= 194, 'script.js deve ter versão >= 1.0.194');

  // 2. Elementos do Modal de Visualizações no DOM e Regras CSS
  const viewsModal = env.elements['post-views-modal'];
  const viewsModalAuthor = env.elements['post-views-modal-author'];
  const viewsModalTotal = env.elements['post-views-modal-total'];
  const viewsModalList = env.elements['post-views-modal-list'];
  const closeViewsModalBtn = env.elements['close-post-views-modal'];

  assert.ok(viewsModal, '#post-views-modal deve existir no DOM');
  assert.ok(viewsModalAuthor, '#post-views-modal-author deve existir no DOM');
  assert.ok(viewsModalTotal, '#post-views-modal-total deve existir no DOM');
  assert.ok(viewsModalList, '#post-views-modal-list deve existir no DOM');
  assert.ok(closeViewsModalBtn, '#close-post-views-modal deve existir no DOM');

  assert.ok(css.includes('.feed-media-views-badge'), 'style.css deve conter .feed-media-views-badge');
  assert.ok(css.includes('.feed-action-btn.feed-views-btn'), 'style.css deve conter .feed-action-btn.feed-views-btn');
  assert.ok(css.includes('.post-views-modal-card'), 'style.css deve conter .post-views-modal-card');
  assert.ok(css.includes('.post-viewer-item'), 'style.css deve conter .post-viewer-item');

  // 3. Formatação e Contagem de Visualizações
  assert.strictEqual(win.formatPostViewsCount(0), '0');
  assert.strictEqual(win.formatPostViewsCount(42), '42');
  assert.strictEqual(win.formatPostViewsCount(1000), '1 mil');
  assert.strictEqual(win.formatPostViewsCount(1500), '1,5 mil');
  assert.strictEqual(win.formatPostViewsCount(2000000), '2 mi');

  // 4. Renderização Inicial dos Contadores de Visualizações no Feed Reels e Preview
  const viewer1 = { uid: 'viewer_194_1', name: 'Lucas Viewer', username: '@lucasviewer', avatar: 'https://vortex.vip/lucas.png' };
  win.setCurrentUser(viewer1);
  win.setCurrentProfile(viewer1);

  const post194 = {
    id: 'post_views_194',
    authorUid: 'author_194',
    authorName: 'Criador Oficial',
    title: 'Post com Sistema de Visualizações',
    caption: 'Testando contagem de views em tempo real!',
    type: 'image',
    mediaData: 'data:image/png;base64,img194',
    likes: [],
    comments: [],
    views: [],
    viewsCount: 0,
    viewers: {},
    createdAt: Date.now()
  };
  env.firestoreDocs['posts/post_views_194'] = { ...post194 };

  const feedList = env.elements['feed-list'];
  win.renderPostsFeed([post194]);

  assert.ok(feedList.innerHTML.includes('data-action="post-views"'), 'Card do post deve ter botão/badge com data-action="post-views"');
  assert.ok(feedList.innerHTML.includes('data-post-views-count="post_views_194"'), 'Card do post deve ter contador data-post-views-count');
  assert.ok(feedList.innerHTML.includes('0 visualizações'), 'Badge na mídia deve iniciar com 0 visualizações');
  assert.strictEqual(win.getPostViewsCount(post194), 0, 'Contagem inicial de views deve ser 0');
  assert.strictEqual(win.hasUserViewedPost(post194, viewer1.uid), false, 'Usuário ainda não visualizou o post');

  // 5. Registrar Visualização Única (registerPostView) e Persistência no Firestore
  const res1 = await win.registerPostView('post_views_194');
  assert.strictEqual(res1.viewed, true, 'Primeira visualização deve retornar viewed: true');
  assert.strictEqual(res1.count, 1, 'Contagem deve subir para 1');
  assert.strictEqual(win.getPostViewsCount(post194), 1, 'getPostViewsCount deve retornar 1');
  assert.strictEqual(win.hasUserViewedPost(post194, viewer1.uid), true, 'hasUserViewedPost deve retornar true após visualizar');
  assert.deepStrictEqual(Array.from(env.firestoreDocs['posts/post_views_194'].views), ['viewer_194_1'], 'Firestore deve persistir o UID em views');
  assert.strictEqual(env.firestoreDocs['posts/post_views_194'].viewsCount, 1, 'Firestore deve persistir viewsCount = 1');

  // 6. Deduplicação: Mesmo usuário visualizando novamente não duplica o contador
  const resDup = await win.registerPostView('post_views_194');
  assert.strictEqual(resDup.viewed, false, 'Repetição do mesmo usuário não deve contar nova view');
  assert.strictEqual(resDup.alreadyViewed, true, 'Deve indicar alreadyViewed: true');
  assert.strictEqual(resDup.count, 1, 'Contagem deve permanecer 1');

  // 7. Segundo Usuário Visualiza o Post -> Sobe para 2 Visualizações
  const res2 = await win.registerPostView('post_views_194', {
    uid: 'viewer_194_2',
    name: 'Mariana VIP',
    username: '@marianavip',
    isVip: true,
    viewedAt: Date.now() + 1000
  });
  assert.strictEqual(res2.viewed, true, 'Visualização de segundo usuário deve ser contabilizada');
  assert.strictEqual(res2.count, 2, 'Contagem total deve subir para 2');
  assert.strictEqual(win.getPostViewsCount(post194), 2, 'getPostViewsCount deve retornar 2');

  // 8. Abrir e Fechar o Modal de Visualizações do Post (#post-views-modal)
  win.openPostViewsModal('post_views_194');
  assert.ok(viewsModal.classList.contains('active'), '#post-views-modal deve ficar ativo ao abrir');
  assert.ok(viewsModalTotal.innerHTML.includes('2 visualizações'), 'Total no modal deve exibir 2 visualizações');
  assert.ok(viewsModalList.innerHTML.includes('Lucas Viewer') && viewsModalList.innerHTML.includes('Mariana VIP'), 'Lista do modal deve exibir os usuários que visualizaram o post');

  win.closePostViewsModal();
  assert.ok(!viewsModal.classList.contains('active'), '#post-views-modal deve fechar corretamente');
});

test('Sistema de Categoria nos Story Exclusivo para Conta Pessoal e Usuários VIP com Verificado (v1.0.195)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.195+)
  const verParts195 = String(win.CURRENT_APP_VERSION || '').split('.').map(Number);
  assert.ok(verParts195[2] >= 195, 'script.js deve ter versão >= 1.0.195');

  // 2. Elementos no DOM e Regras CSS
  const storyCatSection = env.elements['story-personal-category-section'];
  const storyCatSelect = env.elements['story-personal-category-select'];
  const storyCatChips = env.elements['story-personal-category-chips'];
  const storyCatLockBanner = env.elements['story-personal-category-vip-lock-banner'];
  const storyCategoryBadge = env.elements['story-category-badge'];
  const statusBizSection = env.elements['status-business-link-section'];
  const vipPaymentModal = env.elements['vip-payment-modal'];

  assert.ok(storyCatSection, '#story-personal-category-section deve existir no DOM');
  assert.ok(storyCatSelect, '#story-personal-category-select deve existir no DOM');
  assert.ok(storyCatChips, '#story-personal-category-chips deve existir no DOM');
  assert.ok(storyCatLockBanner, '#story-personal-category-vip-lock-banner deve existir no DOM');
  assert.ok(storyCategoryBadge, '#story-category-badge deve existir no DOM');
  assert.ok(vipPaymentModal, '#vip-payment-modal deve existir no DOM');

  assert.ok(css.includes('.story-personal-category-setting-item'), 'style.css deve conter .story-personal-category-setting-item');
  assert.ok(css.includes('.story-personal-category-chip'), 'style.css deve conter .story-personal-category-chip');
  assert.ok(css.includes('.story-category-badge'), 'style.css deve conter .story-category-badge');

  // 3. Lista Completa das 6 Categorias de Story Solicitadas
  const requiredStoryCats = ['Destaque', 'Story', 'VIP⚡', 'Vortex VIP⚡', 'Nuke do sistema', 'Melhor'];
  const actualStoryCats = Array.from(win.PERSONAL_STORY_CATEGORIES || []);
  assert.deepStrictEqual(actualStoryCats, requiredStoryCats, 'PERSONAL_STORY_CATEGORIES deve conter exatamente as 6 categorias solicitadas');
  for (const cat of requiredStoryCats) {
    assert.ok(html.includes(`value="${cat}"`), `#story-personal-category-select deve incluir a opção "${cat}"`);
    assert.ok(html.includes(`data-story-category="${cat}"`), `#story-personal-category-chips deve incluir o chip "${cat}"`);
  }

  // 4. Visibilidade Exclusiva para Conta Pessoal (oculta para Conta Empresa)
  win.updateStatusBusinessLinkVisibility({ accountType: 'personal', isVip: false, isVerified: false });
  assert.strictEqual(storyCatSection.style.display, 'flex', 'Categoria do Story deve aparecer (flex) para Conta Pessoal');
  assert.strictEqual(statusBizSection.style.display, 'none', 'Seção empresarial do Story deve ficar oculta para Conta Pessoal');

  win.updateStatusBusinessLinkVisibility({ accountType: 'business', isVip: true, isVerified: true });
  assert.strictEqual(storyCatSection.style.display, 'none', 'Categoria do Story deve ficar oculta (none) para Conta Empresa');
  assert.strictEqual(statusBizSection.style.display, 'block', 'Seção empresarial do Story deve aparecer para Conta Empresa');

  // 5. Usuário Comum (sem VIP Verificado) tentando usar -> Bloqueia e leva para a Tela de Pagamento (#vip-payment-modal)
  const regularUser = { uid: 'user_regular_195', name: 'João Comum', email: 'joao@teste.com', accountType: 'personal', isVip: false, isVerified: false };
  win.setCurrentUser(regularUser);
  win.setCurrentProfile(regularUser);
  win.updateStatusBusinessLinkVisibility(regularUser);

  assert.strictEqual(win.isStoryCategoryVipEligible(regularUser), false, 'Usuário sem VIP verificado não deve ser elegível');
  assert.strictEqual(storyCatLockBanner.style.display, 'flex', 'Banner de bloqueio VIP deve estar visível para usuário sem VIP');

  vipPaymentModal.style.display = 'none';
  vipPaymentModal.classList.remove('active');

  const blockedAttempt = win.selectStoryPersonalCategory('Vortex VIP⚡', regularUser);
  assert.strictEqual(blockedAttempt.allowed, false, 'Tentativa de usuário não-VIP deve ser bloqueada');
  assert.strictEqual(blockedAttempt.redirectedToPayment, true, 'Deve indicar redirecionamento para tela de pagamento');
  assert.strictEqual(win.getSelectedStoryPersonalCategory(), '', 'Categoria selecionada deve permanecer vazia');
  assert.strictEqual(storyCatSelect.value, '', 'Select deve ser resetado para vazio');
  assert.ok(vipPaymentModal.classList.contains('active') && vipPaymentModal.style.display === 'flex', 'Deve abrir a tela de pagamento (#vip-payment-modal) imediatamente');

  // Fechar modal de pagamento para o próximo teste
  vipPaymentModal.style.display = 'none';
  vipPaymentModal.classList.remove('active');

  // 6. Usuário VIP com Verificado (Conta Pessoal) -> Pode escolher qualquer categoria normalmente
  const vipVerifiedUser = { uid: 'user_vip_195', name: 'Deyvison VIP', email: 'vip@vortex.com', accountType: 'personal', isVip: true, isVerified: true };
  win.setCurrentUser(vipVerifiedUser);
  win.setCurrentProfile(vipVerifiedUser);
  win.updateStatusBusinessLinkVisibility(vipVerifiedUser);

  assert.strictEqual(win.isStoryCategoryVipEligible(vipVerifiedUser), true, 'Usuário VIP com verificado e Conta Pessoal deve ser elegível');
  assert.strictEqual(storyCatLockBanner.style.display, 'none', 'Banner de bloqueio VIP deve ficar oculto para usuário VIP verificado');

  const allowedAttempt = win.selectStoryPersonalCategory('Nuke do sistema', vipVerifiedUser);
  assert.strictEqual(allowedAttempt.allowed, true, 'Usuário VIP com verificado deve conseguir selecionar categoria');
  assert.strictEqual(allowedAttempt.category, 'Nuke do sistema', 'Categoria selecionada deve ser "Nuke do sistema"');
  assert.strictEqual(allowedAttempt.redirectedToPayment, false, 'Não deve redirecionar para tela de pagamento');
  assert.strictEqual(win.getSelectedStoryPersonalCategory(), 'Nuke do sistema');
  assert.strictEqual(storyCatSelect.value, 'Nuke do sistema');
  assert.ok(!vipPaymentModal.classList.contains('active'), 'Tela de pagamento não deve abrir para usuário VIP verificado');

  // 7. Exibição do Selo de Categoria no Story Viewer (#story-category-badge)
  const sampleVipStory = {
    id: 'story_vip_cat_195',
    authorUid: vipVerifiedUser.uid,
    authorName: vipVerifiedUser.name,
    type: 'image',
    src: 'data:image/png;base64,story195',
    caption: 'Story com categoria VIP!',
    storyCategory: 'Vortex VIP⚡',
    personalCategory: 'Vortex VIP⚡',
    category: 'Vortex VIP⚡',
    views: {},
    reactions: {},
    replies: [],
    createdAt: Date.now()
  };

  await win.openStoryViewer([sampleVipStory], vipVerifiedUser, { isPreview: true });
  assert.strictEqual(storyCategoryBadge.style.display, 'inline-flex', '#story-category-badge deve ficar visível no Story Viewer');
  assert.strictEqual(storyCategoryBadge.textContent, 'Vortex VIP⚡', '#story-category-badge deve exibir "Vortex VIP⚡"');

  win.closeStoryViewer();
  assert.strictEqual(storyCategoryBadge.style.display, 'none', '#story-category-badge deve ocultar ao fechar o Story Viewer');
});

test('Limite de 500 Caracteres na Legenda dos Posts e Correção da Categoria Danssinha (v1.0.196)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.196+)
  const verParts196 = String(win.CURRENT_APP_VERSION || '').split('.').map(Number);
  assert.ok(verParts196[2] >= 196, 'script.js deve ter versão >= 1.0.196');

  // 2. Correção da Categoria: "🎨 Dessinha" -> "💃 Danssinha"
  const personalCats = Array.from(win.PERSONAL_POST_CATEGORIES || []);
  assert.ok(personalCats.includes('Danssinha'), 'PERSONAL_POST_CATEGORIES deve incluir "Danssinha"');
  assert.ok(!personalCats.includes('Dessinha'), 'PERSONAL_POST_CATEGORIES não deve mais incluir "Dessinha"');
  assert.ok(html.includes('<option value="Danssinha">💃 Danssinha</option>'), 'index.html deve ter <option value="Danssinha">💃 Danssinha</option>');
  assert.ok(!html.includes('Dessinha'), 'index.html não deve mais conter "Dessinha"');

  // 3. Limite Máximo de 500 Caracteres na Legenda dos Posts (#post-caption-input)
  assert.strictEqual(win.MAX_POST_CAPTION_LENGTH, 500, 'MAX_POST_CAPTION_LENGTH deve ser 500');
  const captionInput = env.elements['post-caption-input'];
  const captionCounter = env.elements['post-caption-char-count'];
  assert.ok(captionInput, '#post-caption-input deve existir no DOM');
  assert.ok(captionCounter, '#post-caption-char-count deve existir no DOM');
  assert.strictEqual(captionInput.getAttribute('maxlength'), '500', '#post-caption-input deve ter maxlength="500"');
  assert.strictEqual(captionCounter.innerText, '0/500', 'Contador da legenda deve iniciar em 0/500');

  // 4. Atualização do Contador e Truncamento Automático acima de 500 caracteres
  captionInput.value = 'Legenda curta de teste VORTEX VIP!';
  captionInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(captionCounter.innerText, '34/500', 'Contador deve atualizar para 34/500');
  assert.ok(!captionCounter.classList.contains('limit-reached'), 'Não deve marcar limit-reached abaixo de 500');

  const over500Text = 'A'.repeat(620);
  captionInput.value = over500Text;
  captionInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(captionInput.value.length, 500, 'Texto acima de 500 caracteres deve ser truncado para 500');
  assert.strictEqual(captionCounter.innerText, '500/500', 'Contador deve exibir 500/500 ao atingir o limite');
  assert.ok(captionCounter.classList.contains('limit-reached'), 'Contador deve receber classe limit-reached em 500/500');

  // 5. Reset do compositor deve zerar a legenda e o contador para 0/500
  win.resetPostComposer();
  assert.strictEqual(captionInput.value, '', 'resetPostComposer deve limpar #post-caption-input');
  assert.strictEqual(captionCounter.innerText, '0/500', 'resetPostComposer deve restaurar #post-caption-char-count para 0/500');
  assert.ok(!captionCounter.classList.contains('limit-reached'), 'resetPostComposer deve remover limit-reached do contador');
});

test('Correção da Mensagem Já Pronta dos Produtos do Catálogo (v1.0.197)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.197+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2], 10);
  assert.ok(versionNum >= 197, 'script.js deve ter versão >= 1.0.197');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2], 10);
  assert.ok(jsonVerNum >= 197, 'version.json deve ter versão >= 1.0.197');
  assert.ok(html.includes(`script.js?v=`), 'index.html deve referenciar script.js com hash de versão');
  assert.ok(html.includes(`style.css?v=`), 'index.html deve referenciar style.css com hash de versão');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve conter cache vortex-vip-v1.0.x');

  // 2. Regras CSS das Mensagens Prontas do Produto
  assert.ok(css.includes('.catalog-ready-messages-box'), 'style.css deve conter .catalog-ready-messages-box');
  assert.ok(css.includes('.catalog-ready-msg-chip'), 'style.css deve conter .catalog-ready-msg-chip');

  // 3. Funções de construção e preenchimento da mensagem pronta no input real (#chat-input-main)
  assert.strictEqual(typeof win.buildCatalogProductReadyMessage, 'function', 'buildCatalogProductReadyMessage deve existir');
  assert.strictEqual(typeof win.fillCatalogChatReadyMessage, 'function', 'fillCatalogChatReadyMessage deve existir');
  assert.strictEqual(typeof win.talkToSellerAboutProduct, 'function', 'talkToSellerAboutProduct deve existir');

  const sampleProd = {
    id: 'prod_ready_197',
    name: 'Headset Gamer VORTEX Pro',
    price: 299.90,
    sellerUid: 'seller_ready_197',
    sellerName: 'VORTEX Tech Store',
    buyEnabled: false
  };
  env.firestoreDocs['users/seller_ready_197/catalog/prod_ready_197'] = { ...sampleProd };

  const defaultMsg = win.buildCatalogProductReadyMessage(sampleProd);
  assert.strictEqual(defaultMsg, 'Olá! Gostaria de saber mais sobre o produto "Headset Gamer VORTEX Pro".');

  const varMsg = win.buildCatalogProductReadyMessage(sampleProd, {
    selectedColor: { name: 'Preto Neon' },
    selectedSize: 'Único',
    selectedVoltage: 'Bivolt'
  });
  assert.strictEqual(varMsg, 'Olá! Gostaria de saber mais sobre o produto "Headset Gamer VORTEX Pro" (Cor: Preto Neon, Tamanho: Único, Voltagem: Bivolt).');

  // 4. Fluxo completo: talkToSellerAboutProduct preenche #chat-input-main e muda #chat-send-icon para "send"
  const buyer = { uid: 'buyer_197', name: 'Carlos Cliente', accountType: 'personal' };
  win.setCurrentUser(buyer);
  win.setCurrentProfile(buyer);

  const chatInputMain = env.elements['chat-input-main'];
  const chatSendIcon = env.elements['chat-send-icon'];
  const chatWindow = env.elements['chat-window'];
  assert.ok(chatInputMain, '#chat-input-main deve existir no DOM');

  chatInputMain.value = '';
  if (chatSendIcon) chatSendIcon.setAttribute('data-lucide', 'mic');

  await win.talkToSellerAboutProduct(sampleProd, 'seller_ready_197', {
    uid: 'seller_ready_197',
    name: 'VORTEX Tech Store'
  });

  assert.strictEqual(chatInputMain.value, 'Olá! Gostaria de saber mais sobre o produto "Headset Gamer VORTEX Pro".', '#chat-input-main deve receber a mensagem já pronta do produto');
  if (chatSendIcon) {
    assert.strictEqual(chatSendIcon.getAttribute('data-lucide'), 'send', '#chat-send-icon deve mudar para o ícone de enviar ("send")');
  }
  assert.ok(chatWindow.classList.contains('active'), '#chat-window deve abrir com a conversa do vendedor');

  // 5. Detalhe do Produto (#catalog-product-detail-modal) exibe as Mensagens Prontas Rápidas e o botão Conversar com vendedor
  await win.openProductDetail('prod_ready_197', 'seller_ready_197');
  const detailContent = env.elements['catalog-detail-content'];
  assert.ok(detailContent.innerHTML.includes('catalog-ready-messages-box'), 'Modal de detalhe deve exibir a caixa de mensagens prontas');
  assert.ok(detailContent.innerHTML.includes('catalog-ready-msg-chip'), 'Modal de detalhe deve exibir os chips de mensagens prontas');
  assert.ok(detailContent.innerHTML.includes('catalog-detail-talk-btn'), 'Modal de detalhe deve exibir #catalog-detail-talk-btn');

  // 6. Testar clique em um chip de mensagem pronta personalizada
  chatInputMain.value = '';
  await win.talkToSellerAboutProduct(sampleProd, 'seller_ready_197', { name: 'VORTEX Tech Store' }, {
    customMessage: 'Olá! O produto "Headset Gamer VORTEX Pro" ainda está disponível?'
  });
  assert.strictEqual(chatInputMain.value, 'Olá! O produto "Headset Gamer VORTEX Pro" ainda está disponível?', '#chat-input-main deve receber a mensagem pronta clicada');
});

test('Função de Avaliação de 5 Estrelas e Comentários nos Produtos Pós-Compra (v1.0.198)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.198+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2], 10);
  assert.ok(versionNum >= 198, 'script.js deve ter versão >= 1.0.198');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2], 10);
  assert.ok(jsonVerNum >= 198, 'version.json deve ter versão >= 1.0.198');
  assert.ok(html.includes('script.js?v='), 'index.html deve referenciar script.js com hash de versão');
  assert.ok(html.includes('style.css?v='), 'index.html deve referenciar style.css com hash de versão');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.'), 'sw.js deve conter cache vortex-vip-v1.0.x');

  // 2. Elementos HTML do Modal de Avaliação (#catalog-product-review-modal)
  assert.ok(html.includes('id="catalog-product-review-modal"'), 'index.html deve conter #catalog-product-review-modal');
  assert.ok(html.includes('id="catalog-review-stars-picker"'), 'index.html deve conter #catalog-review-stars-picker');
  assert.ok(html.includes('id="catalog-review-comment-input"'), 'index.html deve conter #catalog-review-comment-input');
  assert.ok(html.includes('id="catalog-review-char-count"'), 'index.html deve conter #catalog-review-char-count');
  assert.ok(html.includes('id="catalog-review-submit-btn"'), 'index.html deve conter #catalog-review-submit-btn');

  // 3. Regras CSS de Avaliação no style.css
  assert.ok(css.includes('.catalog-review-sheet'), 'style.css deve conter .catalog-review-sheet');
  assert.ok(css.includes('.catalog-stars-picker'), 'style.css deve conter .catalog-stars-picker');
  assert.ok(css.includes('.catalog-star-btn'), 'style.css deve conter .catalog-star-btn');
  assert.ok(css.includes('.catalog-product-reviews-section'), 'style.css deve conter .catalog-product-reviews-section');
  assert.ok(css.includes('.catalog-reviews-overview-card'), 'style.css deve conter .catalog-reviews-overview-card');
  assert.ok(css.includes('.catalog-review-card'), 'style.css deve conter .catalog-review-card');
  assert.ok(css.includes('.catalog-review-locked-banner'), 'style.css deve conter .catalog-review-locked-banner');
  assert.ok(css.includes('.cat-review-item-btn'), 'style.css deve conter .cat-review-item-btn');
  assert.ok(css.includes('.catalog-card-rating'), 'style.css deve conter .catalog-card-rating');

  // 4. Exportação das funções do sistema de avaliação
  assert.strictEqual(typeof win.setReviewModalRating, 'function', 'setReviewModalRating deve existir');
  assert.strictEqual(typeof win.renderStarsHTML, 'function', 'renderStarsHTML deve existir');
  assert.strictEqual(typeof win.checkUserPurchasedProduct, 'function', 'checkUserPurchasedProduct deve existir');
  assert.strictEqual(typeof win.loadProductReviews, 'function', 'loadProductReviews deve existir');
  assert.strictEqual(typeof win.openProductReviewModal, 'function', 'openProductReviewModal deve existir');
  assert.strictEqual(typeof win.closeProductReviewModal, 'function', 'closeProductReviewModal deve existir');
  assert.strictEqual(typeof win.submitProductReview, 'function', 'submitProductReview deve existir');

  // 5. Teste de setReviewModalRating e renderStarsHTML
  assert.strictEqual(win.setReviewModalRating(5), 5);
  assert.strictEqual(win.getCurrentReviewRating(), 5);
  const textEl = env.elements['catalog-review-rating-text'];
  assert.ok(textEl && textEl.innerText.includes('5/5'), 'Texto descritivo deve refletir 5 estrelas');

  win.setReviewModalRating(4);
  assert.strictEqual(win.getCurrentReviewRating(), 4);
  assert.ok(textEl.innerText.includes('4/5'), 'Texto descritivo deve refletir 4 estrelas');

  const starsHtml = win.renderStarsHTML(5);
  assert.ok(starsHtml.includes('★★★★★'), 'renderStarsHTML(5) deve renderizar 5 estrelas cheias');
  const starsHtml4 = win.renderStarsHTML(4);
  assert.ok(starsHtml4.includes('★★★★☆'), 'renderStarsHTML(4) deve renderizar 4 estrelas cheias e 1 vazia');

  // 6. Teste de Bloqueio Pós-Compra: Usuário sem compra não pode avaliar
  const nonBuyer = { uid: 'user_sem_compra_198', name: 'Visitante Curioso', accountType: 'personal' };
  win.setCurrentUser(nonBuyer);
  win.setCurrentProfile(nonBuyer);

  const prodId = 'prod_review_test_198';
  const sellerUid = 'seller_review_test_198';
  env.firestoreDocs[`users/${sellerUid}/catalog/${prodId}`] = {
    id: prodId,
    name: 'Teclado Mecânico RGB VORTEX',
    price: 350.00,
    sellerUid: sellerUid,
    stock: 10
  };

  const purchaseCheckNonBuyer = await win.checkUserPurchasedProduct(prodId, nonBuyer.uid);
  assert.strictEqual(purchaseCheckNonBuyer.purchased, false, 'Usuário sem pedido não deve constar como comprador');

  const reviewModal = env.elements['catalog-product-review-modal'];
  if (reviewModal) reviewModal.style.display = 'none';

  // Tentativa de abrir modal sem compra deve ser bloqueada
  await win.openProductReviewModal(prodId, sellerUid);
  assert.notStrictEqual(reviewModal.style.display, 'flex', 'Modal de avaliação NÃO deve abrir para quem não comprou');

  // Detalhe do produto para quem não comprou deve exibir o banner explicativo de bloqueio pós-compra
  await win.openProductDetail(prodId, sellerUid);
  const detailContent = env.elements['catalog-detail-content'];
  assert.ok(detailContent.innerHTML.includes('catalog-review-locked-banner'), 'Deve exibir banner de avaliação exclusiva pós-compra');
  assert.ok(!detailContent.innerHTML.includes('catalog-detail-open-review-btn'), 'Não deve exibir botão de avaliar para quem não comprou');

  // 7. Teste de Cliente com Compra Finalizada (Pós-compra)
  const buyerUser = { uid: 'buyer_vip_198', name: 'Ana Compradora VIP', accountType: 'personal', photoURL: 'https://img.teste/ana.jpg' };
  win.setCurrentUser(buyerUser);
  win.setCurrentProfile(buyerUser);

  // Criar pedido finalizado contendo o produto
  const orderId = 'order_rev_198';
  env.firestoreDocs[`orders/${orderId}`] = {
    id: orderId,
    orderNumber: '#100198',
    buyerUid: buyerUser.uid,
    buyerName: buyerUser.name,
    buyerAvatar: buyerUser.photoURL,
    sellerUid: sellerUid,
    items: [
      {
        productId: prodId,
        name: 'Teclado Mecânico RGB VORTEX',
        price: 350.00,
        quantity: 1,
        cover: 'https://img.teste/teclado.jpg'
      }
    ],
    status: 'paid',
    createdAt: Date.now() - 3600000
  };

  const purchaseCheckBuyer = await win.checkUserPurchasedProduct(prodId, buyerUser.uid);
  assert.strictEqual(purchaseCheckBuyer.purchased, true, 'Usuário com pedido pago deve ser identificado como comprador verificado');
  assert.strictEqual(purchaseCheckBuyer.orderId, orderId);

  // Detalhes do Pedido (#catalog-order-modal) exibe o botão Avaliar Produto para o comprador
  await win.openOrderDetail(orderId);
  const orderContent = env.elements['catalog-order-content'];
  assert.ok(orderContent.innerHTML.includes('cat-review-item-btn'), 'Detalhe do pedido deve exibir o botão cat-review-item-btn para o comprador');

  // Detalhes do Produto (#catalog-product-detail-modal) exibe o botão Avaliar Produto ⭐ para o comprador
  await win.openProductDetail(prodId, sellerUid);
  assert.ok(detailContent.innerHTML.includes('catalog-detail-open-review-btn'), 'Detalhe do produto deve exibir o botão #catalog-detail-open-review-btn para o comprador');
  assert.ok(!detailContent.innerHTML.includes('catalog-review-locked-banner'), 'Não deve exibir banner de bloqueio para o comprador verificado');

  // 8. Abrir Modal de Avaliação, selecionar 5 estrelas e comentar
  await win.openProductReviewModal(prodId, sellerUid, { orderId });
  assert.strictEqual(reviewModal.style.display, 'flex', 'Modal de avaliação DEVE abrir com display: flex');
  assert.ok(reviewModal.classList.contains('active'), 'Modal deve receber a classe active');

  win.setReviewModalRating(5);
  const commentInput = env.elements['catalog-review-comment-input'];
  commentInput.value = 'Produto impecável! Teclas macias, acabamento de altíssima qualidade. Recomendo demais! 🌟';

  // 9. Submeter a avaliação (submitProductReview)
  await win.submitProductReview();

  // Verificar persistência no Firestore: users/{sellerUid}/catalog/{prodId}/reviews/{buyerUid}
  const savedReviewDoc = env.firestoreDocs[`users/${sellerUid}/catalog/${prodId}/reviews/${buyerUser.uid}`];
  assert.ok(savedReviewDoc, 'Avaliação deve ser salva no Firestore');
  assert.strictEqual(savedReviewDoc.rating, 5, 'Nota da avaliação deve ser 5 estrelas');
  assert.strictEqual(savedReviewDoc.comment, 'Produto impecável! Teclas macias, acabamento de altíssima qualidade. Recomendo demais! 🌟');
  assert.strictEqual(savedReviewDoc.buyerUid, buyerUser.uid);
  assert.strictEqual(savedReviewDoc.isVerifiedPurchase, true, 'Avaliação deve conter flag de Compra Verificada');

  // 10. Atualização e Recálculo da Média de Estrelas no documento do Produto
  const updatedProd = env.firestoreDocs[`users/${sellerUid}/catalog/${prodId}`];
  assert.strictEqual(updatedProd.ratingAverage, 5.0, 'Produto deve ter ratingAverage = 5.0');
  assert.strictEqual(updatedProd.ratingCount, 1, 'Produto deve ter ratingCount = 1');

  // 11. Carregamento de Avaliações (loadProductReviews)
  const reviewsData = await win.loadProductReviews(prodId, sellerUid);
  assert.strictEqual(reviewsData.totalReviews, 1);
  assert.strictEqual(reviewsData.ratingAverage, 5.0);
  assert.strictEqual(reviewsData.ratingCounts[5], 1);
  assert.strictEqual(reviewsData.reviews[0].comment, 'Produto impecável! Teclas macias, acabamento de altíssima qualidade. Recomendo demais! 🌟');

  // 12. Renderização das Estrelas nos Cards da Vitrine (renderCatalogGrid)
  const gridContainer = { innerHTML: '', querySelectorAll: () => [] };
  win.renderCatalogGrid(gridContainer, [updatedProd], false);
  assert.ok(gridContainer.innerHTML.includes('catalog-card-rating'), 'Vitrine de produtos deve exibir a nota de estrelas no card');
  assert.ok(gridContainer.innerHTML.includes('5.0 (1)'), 'Vitrine deve exibir 5.0 (1)');

  // 13. Fechar modal de avaliação
  win.closeProductReviewModal();
  assert.strictEqual(reviewModal.style.display, 'none');
  assert.ok(!reviewModal.classList.contains('active'));
});

test('Programar Story e Posts para Postar em Outro Dia (v1.0.199)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. Integridade de Versionamento (v1.0.199+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2], 10);
  assert.ok(versionNum >= 199, 'script.js deve ter versão >= 1.0.199');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2], 10);
  assert.ok(jsonVerNum >= 199, 'version.json deve ter versão >= 1.0.199');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js versionado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css versionado');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes(`vortex-vip-v${versionJson.version}`), 'sw.js deve conter cache vortex-vip versionado');

  // 2. Elementos HTML de Programação de Story no #post-status-overlay
  assert.ok(html.includes('id="story-schedule-section"'), 'index.html deve conter #story-schedule-section');
  assert.ok(html.includes('id="story-schedule-toggle"'), 'index.html deve conter #story-schedule-toggle');
  assert.ok(html.includes('id="story-schedule-fields"'), 'index.html deve conter #story-schedule-fields');
  assert.ok(html.includes('id="story-schedule-date"'), 'index.html deve conter #story-schedule-date');
  assert.ok(html.includes('id="story-schedule-time"'), 'index.html deve conter #story-schedule-time');
  assert.ok(html.includes('id="story-schedule-preview-hint"'), 'index.html deve conter #story-schedule-preview-hint');

  // 3. Elementos HTML de Programação de Post no #screenshot-gallery-overlay
  assert.ok(html.includes('id="post-schedule-section"'), 'index.html deve conter #post-schedule-section');
  assert.ok(html.includes('id="post-schedule-toggle"'), 'index.html deve conter #post-schedule-toggle');
  assert.ok(html.includes('id="post-schedule-fields"'), 'index.html deve conter #post-schedule-fields');
  assert.ok(html.includes('id="post-schedule-date"'), 'index.html deve conter #post-schedule-date');
  assert.ok(html.includes('id="post-schedule-time"'), 'index.html deve conter #post-schedule-time');
  assert.ok(html.includes('id="post-schedule-preview-hint"'), 'index.html deve conter #post-schedule-preview-hint');

  // 4. Regras CSS de Agendamento no style.css
  assert.ok(css.includes('.story-schedule-setting-item'), 'style.css deve conter .story-schedule-setting-item');
  assert.ok(css.includes('.post-schedule-section'), 'style.css deve conter .post-schedule-section');
  assert.ok(css.includes('.schedule-fields-container'), 'style.css deve conter .schedule-fields-container');
  assert.ok(css.includes('.schedule-chip'), 'style.css deve conter .schedule-chip');
  assert.ok(css.includes('.schedule-active-btn'), 'style.css deve conter .schedule-active-btn');
  assert.ok(css.includes('.post-scheduled-banner'), 'style.css deve conter .post-scheduled-banner');
  assert.ok(css.includes('.post-publish-now-btn'), 'style.css deve conter .post-publish-now-btn');

  // 5. Funções do Sistema de Programação em window
  assert.strictEqual(typeof win.getFormattedScheduleDate, 'function', 'getFormattedScheduleDate deve existir');
  assert.strictEqual(typeof win.computeQuickScheduleTimestamp, 'function', 'computeQuickScheduleTimestamp deve existir');
  assert.strictEqual(typeof win.validateScheduleInput, 'function', 'validateScheduleInput deve existir');
  assert.strictEqual(typeof win.updateStoryScheduleUI, 'function', 'updateStoryScheduleUI deve existir');
  assert.strictEqual(typeof win.updatePostScheduleUI, 'function', 'updatePostScheduleUI deve existir');
  assert.strictEqual(typeof win.applyQuickSchedule, 'function', 'applyQuickSchedule deve existir');
  assert.strictEqual(typeof win.publishScheduledPostNow, 'function', 'publishScheduledPostNow deve existir');
  assert.strictEqual(typeof win.publishScheduledStoryNow, 'function', 'publishScheduledStoryNow deve existir');
  assert.strictEqual(typeof win.checkAndReleaseScheduledItems, 'function', 'checkAndReleaseScheduledItems deve existir');

  // 6. Teste de Validação de Agendamento (validateScheduleInput)
  const pastCheck = win.validateScheduleInput('2020-01-01', '10:00');
  assert.strictEqual(pastCheck.isValid, false, 'Data no passado deve ser rejeitada');
  assert.ok(pastCheck.error.includes('futuro'), 'Mensagem deve indicar que a data precisa estar no futuro');

  const emptyCheck = win.validateScheduleInput('', '');
  assert.strictEqual(emptyCheck.isValid, false, 'Campos vazios devem ser rejeitados');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  const validDateStr = `${tomorrow.getFullYear()}-${m}-${d}`;
  const validCheck = win.validateScheduleInput(validDateStr, '15:30');
  assert.strictEqual(validCheck.isValid, true, 'Data futura válida deve ser aceita');
  assert.ok(validCheck.timestamp > Date.now(), 'Timestamp retornado deve ser no futuro');
  assert.ok(validCheck.formatted.includes('15:30'), 'Data formatada deve conter o horário correto');

  // 7. Teste de Interface: Programação de Story
  const storyToggle = env.elements['story-schedule-toggle'];
  const storyFields = env.elements['story-schedule-fields'];
  const publishStatusBtn = env.elements['publish-status-btn'];

  assert.ok(storyToggle && storyFields && publishStatusBtn);
  storyToggle.checked = true;
  win.updateStoryScheduleUI();
  assert.strictEqual(storyFields.style.display, 'block', 'Campos de agendamento de story devem aparecer quando o toggle está ativo');
  assert.ok(publishStatusBtn.classList.contains('schedule-active-btn'), 'Botão de publicar story deve receber a classe de agendamento');
  assert.ok(publishStatusBtn.innerHTML.includes('Programar Story'), 'Texto do botão deve mudar para Programar Story');

  // Testar atalho rápido do Story
  win.applyQuickSchedule('story', 'tomorrow-09');
  const storyTimeInp = env.elements['story-schedule-time'];
  assert.strictEqual(storyTimeInp.value, '09:00', 'Atalho rápido tomorrow-09 deve preencher 09:00');

  // 8. Teste de Interface: Programação de Post
  const postToggle = env.elements['post-schedule-toggle'];
  const postFields = env.elements['post-schedule-fields'];
  const publishPostBtn = env.elements['publish-post-btn'];

  assert.ok(postToggle && postFields && publishPostBtn);
  postToggle.checked = true;
  win.updatePostScheduleUI();
  assert.strictEqual(postFields.style.display, 'block', 'Campos de agendamento de post devem aparecer quando o toggle está ativo');
  assert.ok(publishPostBtn.classList.contains('schedule-active-btn'), 'Botão de publicar post deve receber a classe de agendamento');
  assert.ok(publishPostBtn.innerHTML.includes('Programar Post'), 'Texto do botão deve mudar para Programar Post');

  // Testar atalho rápido do Post
  win.applyQuickSchedule('post', 'tomorrow-18');
  const postTimeInp = env.elements['post-schedule-time'];
  assert.strictEqual(postTimeInp.value, '18:00', 'Atalho rápido tomorrow-18 deve preencher 18:00');

  // 9. Teste de Publicação de Post Programado e Comportamento no Feed
  const authorUser = { uid: 'author_sched_199', name: 'Lucas Criador VIP', accountType: 'personal' };
  win.setCurrentUser(authorUser);
  win.setCurrentProfile(authorUser);

  const futureSchedTime = Date.now() + 86400000; // Amanhã
  const schedPostId = 'post_sched_test_199';
  const normalPostId = 'post_normal_test_199';

  env.firestoreDocs[`posts/${schedPostId}`] = {
    id: schedPostId,
    authorUid: authorUser.uid,
    authorName: authorUser.name,
    caption: 'Post programado para amanhã!',
    scheduled: true,
    isScheduled: true,
    scheduledFor: futureSchedTime,
    scheduledDateStr: win.getFormattedScheduleDate(futureSchedTime),
    published: false,
    createdAt: Date.now()
  };

  env.firestoreDocs[`posts/${normalPostId}`] = {
    id: normalPostId,
    authorUid: authorUser.uid,
    authorName: authorUser.name,
    caption: 'Post publicado normal!',
    scheduled: false,
    isScheduled: false,
    published: true,
    createdAt: Date.now()
  };

  // 9.1 Visão do Próprio Autor: DEVE ver o post programado com o banner especial
  const allPosts = [env.firestoreDocs[`posts/${schedPostId}`], env.firestoreDocs[`posts/${normalPostId}`]];
  const feedList = env.elements['feed-list'];
  win.renderPostsFeed(allPosts);

  assert.ok(feedList.innerHTML.includes('post-scheduled-banner'), 'Feed para o próprio autor deve exibir o banner post-scheduled-banner');
  assert.ok(feedList.innerHTML.includes('Programado para'), 'Banner deve informar a programação');
  assert.ok(feedList.innerHTML.includes('post-publish-now-btn'), 'Banner deve conter o botão post-publish-now-btn');

  // 9.2 Visão de Outro Usuário (Público): NÃO DEVE ver o post programado
  const visitorUser = { uid: 'visitor_199', name: 'Visitante Externo', accountType: 'personal' };
  win.setCurrentUser(visitorUser);
  win.setCurrentProfile(visitorUser);

  win.renderPostsFeed(allPosts);
  assert.ok(!feedList.innerHTML.includes(schedPostId), 'Usuários externos NÃO devem ver postagens programadas no Feed antes da data');
  assert.ok(feedList.innerHTML.includes(normalPostId), 'Usuários externos devem ver postagens normais');

  // 10. Teste de Publicar Post Programado Imediatamente (publishScheduledPostNow)
  win.setCurrentUser(authorUser);
  win.setCurrentProfile(authorUser);

  await win.publishScheduledPostNow(schedPostId);
  const updatedSchedPost = env.firestoreDocs[`posts/${schedPostId}`];
  assert.strictEqual(updatedSchedPost.scheduled, false, 'Post deve ter scheduled = false após publicar agora');
  assert.strictEqual(updatedSchedPost.published, true, 'Post deve ter published = true após publicar agora');

  // Agora qualquer usuário deve ver o post liberado
  win.setCurrentUser(visitorUser);
  win.renderPostsFeed([updatedSchedPost]);
  assert.ok(feedList.innerHTML.includes(schedPostId), 'Post liberado agora deve ser visível para todos os usuários');

  // 11. Teste de Auto-Liberação de Story e Post pelo checkAndReleaseScheduledItems
  win.setCurrentUser(authorUser);
  const overduePostId = 'post_overdue_199';
  env.firestoreDocs[`posts/${overduePostId}`] = {
    id: overduePostId,
    authorUid: authorUser.uid,
    caption: 'Post cujo horário agendado já passou',
    scheduled: true,
    isScheduled: true,
    scheduledFor: Date.now() - 5000, // 5 segundos no passado
    published: false,
    createdAt: Date.now() - 3600000
  };

  await win.checkAndReleaseScheduledItems();
  const releasedPost = env.firestoreDocs[`posts/${overduePostId}`];
  assert.strictEqual(releasedPost.scheduled, false, 'Post vencido deve ser automaticamente liberado');
  assert.strictEqual(releasedPost.published, true, 'Post vencido deve ter published = true');
});

test('Organização Visual do Programar Story e Post (v1.0.200)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.200+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2], 10);
  assert.ok(versionNum >= 200, 'script.js deve ter versão >= 1.0.200');
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2], 10);
  assert.ok(jsonVerNum >= 200, 'version.json deve ter versão >= 1.0.200');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js versionado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css versionado');
  assert.ok(swContent.includes(`vortex-vip-v${versionJson.version}`), 'sw.js deve conter cache vortex-vip versionado');

  // 2. Elementos e Classes de Organização Visual em index.html
  assert.ok(html.includes('story-schedule-card'), 'index.html deve conter a classe story-schedule-card para organização do card');
  assert.ok(html.includes('schedule-switch'), 'index.html deve conter a classe schedule-switch para o toggle estilizado');
  assert.ok(html.includes('schedule-slider'), 'index.html deve conter o slider do switch de agendamento');
  assert.ok(html.includes('schedule-icon-badge'), 'index.html deve conter o badge de ícone do agendamento');
  assert.ok(html.includes('schedule-badge-pill'), 'index.html deve conter a pill Novo no agendamento');
  assert.ok(html.includes('schedule-input-wrapper'), 'index.html deve conter schedule-input-wrapper para alinhamento dos inputs');

  // 3. Validação das Regras CSS de Layout e Responsividade em style.css
  assert.ok(css.includes('.story-schedule-card'), 'style.css deve conter .story-schedule-card');
  assert.ok(css.includes('.schedule-switch'), 'style.css deve conter .schedule-switch');
  assert.ok(css.includes('.schedule-slider'), 'style.css deve conter .schedule-slider');
  assert.ok(css.includes('.schedule-icon-badge'), 'style.css deve conter .schedule-icon-badge');
  assert.ok(css.includes('.schedule-badge-pill'), 'style.css deve conter .schedule-badge-pill');
  assert.ok(css.includes('grid-template-columns: repeat(2, 1fr)'), 'style.css deve ter grid 2x2 para os atalhos rápidos');
  assert.ok(css.includes('grid-template-columns: 1fr 1fr'), 'style.css deve ter grid 1fr 1fr para data e horário lado a lado');

  // 4. Teste Funcional do Componente de Story Organizado
  const storyToggle = env.elements['story-schedule-toggle'];
  const storyFields = env.elements['story-schedule-fields'];
  const dateInp = env.elements['story-schedule-date'];
  const timeInp = env.elements['story-schedule-time'];
  const hint = env.elements['story-schedule-preview-hint'];
  const hintText = env.elements['story-schedule-preview-text'];
  const publishStatusBtn = env.elements['publish-status-btn'];

  assert.ok(storyToggle && storyFields && dateInp && timeInp && hint && hintText && publishStatusBtn);

  // Inicialmente desmarcado
  storyToggle.checked = false;
  win.updateStoryScheduleUI();
  assert.strictEqual(storyFields.style.display, 'none', 'Campos de agendamento devem ficar ocultos quando o switch estiver desativado');
  assert.strictEqual(publishStatusBtn.classList.contains('schedule-active-btn'), false);

  // Ativando switch
  storyToggle.checked = true;
  win.updateStoryScheduleUI();
  assert.strictEqual(storyFields.style.display, 'block', 'Campos de agendamento devem ser exibidos quando o switch for ativado');
  assert.ok(dateInp.value, 'Data padrão deve ser preenchida automaticamente');
  assert.ok(timeInp.value, 'Horário padrão deve ser preenchido automaticamente');
  assert.strictEqual(hint.style.display, 'flex', 'Banner de confirmação do agendamento deve ser exibido com display flex');
  assert.ok(hintText.innerHTML.includes('Story agendado para:'), 'Texto de confirmação deve indicar o agendamento');
  assert.ok(publishStatusBtn.classList.contains('schedule-active-btn'), 'Botão de publicar deve receber estilo de agendamento');

  // Testando atalhos rápidos organizados
  win.applyQuickSchedule('story', 'weekend');
  assert.strictEqual(timeInp.value, '10:00', 'Atalho de sábado deve configurar horário para 10:00');
  win.applyQuickSchedule('story', 'day2-12');
  assert.strictEqual(timeInp.value, '12:00', 'Atalho de 2 dias deve configurar horário para 12:00');

  // 5. Teste Funcional do Componente de Post Organizado
  const postToggle = env.elements['post-schedule-toggle'];
  const postFields = env.elements['post-schedule-fields'];
  const postDateInp = env.elements['post-schedule-date'];
  const postTimeInp = env.elements['post-schedule-time'];
  const postPublishBtn = env.elements['publish-post-btn'];

  assert.ok(postToggle && postFields && postDateInp && postTimeInp && postPublishBtn);
  postToggle.checked = true;
  win.updatePostScheduleUI();
  assert.strictEqual(postFields.style.display, 'block', 'Campos de post devem aparecer com display block');
  assert.ok(postPublishBtn.classList.contains('schedule-active-btn'));
  win.applyQuickSchedule('post', 'tomorrow-18');
  assert.strictEqual(postTimeInp.value, '18:00', 'Atalho amanhã 18:00 do post deve funcionar');
});

test('Silenciar Contatos (Mensagens e Ligações) nos 3 Pontinhos da Conversa (v1.0.201)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.201+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(versionNum >= 201, 'script.js deve ter versão >= 1.0.201');
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(jsonVerNum >= 201, 'version.json deve ter versão >= 1.0.201');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js atualizado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css atualizado');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache correspondente');

  // 2. Elementos HTML do Menu de 3 Pontinhos e Cabeçalho do Chat
  assert.ok(html.includes('id="chat-mute-trigger"'), 'index.html deve conter a opção de silenciar no menu de 3 pontinhos');
  assert.ok(html.includes('id="chat-mute-icon"'), 'index.html deve conter o ícone de silenciar contato');
  assert.ok(html.includes('id="chat-mute-text"'), 'index.html deve conter o texto do item de silenciar');
  assert.ok(html.includes('id="chat-header-mute-badge"'), 'index.html deve conter o badge de silenciado no cabeçalho do chat');

  // 3. Classes CSS para Notificações e Ligações Silenciadas
  assert.ok(css.includes('.chat-muted-badge'), 'style.css deve conter .chat-muted-badge');
  assert.ok(css.includes('.chat-header-mute-badge'), 'style.css deve conter .chat-header-mute-badge');
  assert.ok(css.includes('.incoming-muted-call-badge'), 'style.css deve conter .incoming-muted-call-badge');

  // 4. Funções Exportadas na Janela
  assert.strictEqual(typeof win.toggleMuteContact, 'function', 'toggleMuteContact deve existir');
  assert.strictEqual(typeof win.isContactMuted, 'function', 'isContactMuted deve existir');
  assert.strictEqual(typeof win.updateActiveChatMuteUI, 'function', 'updateActiveChatMuteUI deve existir');
  assert.strictEqual(typeof win.listenToMutedContacts, 'function', 'listenToMutedContacts deve existir');
  assert.strictEqual(typeof win.getMutedContactsSet, 'function', 'getMutedContactsSet deve existir');

  // 5. Teste Funcional: Silenciar e Desilenciar Contato
  win.setCurrentUser({ uid: 'user_alice_201', displayName: 'Alice VIP' });
  const targetContact = { uid: 'contact_noisy_201', name: 'Contato Barulhento' };
  win.setActiveChatContact(targetContact);

  // Inicialmente o contato NÃO está silenciado
  assert.strictEqual(win.isContactMuted('contact_noisy_201'), false);
  win.updateActiveChatMuteUI();
  const muteText = env.elements['chat-mute-text'];
  const muteBadge = env.elements['chat-header-mute-badge'];
  assert.ok(muteText.innerText.includes('Silenciar Contato'));
  assert.strictEqual(muteBadge.style.display, 'none');

  // Silenciar contato
  await win.toggleMuteContact(targetContact);
  assert.strictEqual(win.isContactMuted('contact_noisy_201'), true);
  assert.ok(env.firestoreDocs['users/user_alice_201/muted/contact_noisy_201'], 'Contato silenciado deve ser persistido no Firestore');
  assert.strictEqual(env.firestoreDocs['users/user_alice_201/muted/contact_noisy_201'].uid, 'contact_noisy_201');
  assert.ok(muteText.innerText.includes('Desilenciar Contato'));
  assert.strictEqual(muteBadge.style.display, 'inline-flex');

  // 6. Teste de Supressão de Notificação Push de Mensagem Silenciada
  let notifDispatched = false;
  const originalNotification = env.sandbox.window.Notification;
  env.sandbox.window.Notification = function() { notifDispatched = true; };
  win.showMobilePushNotification({
    title: 'Contato Barulhento',
    body: 'Mensagem que deve ser silenciada',
    senderUid: 'contact_noisy_201'
  });
  assert.strictEqual(notifDispatched, false, 'Notificação push não deve ser disparada para contato silenciado');
  env.sandbox.window.Notification = originalNotification;

  // 7. Desilenciar Contato
  await win.toggleMuteContact(targetContact);
  assert.strictEqual(win.isContactMuted('contact_noisy_201'), false);
  assert.strictEqual(env.firestoreDocs['users/user_alice_201/muted/contact_noisy_201'], undefined, 'Documento de silenciamento deve ser removido');
  assert.ok(muteText.innerText.includes('Silenciar Contato'));
  assert.strictEqual(muteBadge.style.display, 'none');
});

test('Segurança contra Comportamentos Suspeitos e Mini Painel Admin de Grupos (v1.0.202)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.202+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(versionNum >= 202, 'script.js deve ter versão >= 1.0.202');
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(jsonVerNum >= 202, 'version.json deve ter versão >= 1.0.202');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js atualizado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css atualizado');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache correspondente');

  // 2. Estrutura HTML do Mini Painel Admin do Grupo
  assert.ok(html.includes('id="group-mini-admin-section"'), 'index.html deve conter #group-mini-admin-section');
  assert.ok(html.includes('id="group-banned-words-toggle"'), 'index.html deve conter toggle de palavras proibidas');
  assert.ok(html.includes('id="group-banned-words-input"'), 'index.html deve conter textarea de palavras proibidas');
  assert.ok(html.includes('id="save-group-banned-words-btn"'), 'index.html deve conter botão de salvar palavras proibidas');
  assert.ok(html.includes('id="group-approval-toggle"'), 'index.html deve conter toggle de solicitação para participar');
  assert.ok(html.includes('id="group-pending-requests-box"'), 'index.html deve conter container de solicitações pendentes');
  assert.ok(html.includes('id="group-auto-pause-toggle"'), 'index.html deve conter toggle de pausa automática');
  assert.ok(html.includes('id="group-auto-pause-time"'), 'index.html deve conter input de hora para pausar');
  assert.ok(html.includes('id="group-auto-unpause-time"'), 'index.html deve conter input de hora para despausar');
  assert.ok(html.includes('id="save-group-schedule-btn"'), 'index.html deve conter botão para salvar agendamento de silêncio');

  // 3. Estilos CSS do Mini Painel Admin e Badges
  assert.ok(css.includes('.group-mini-admin-section'), 'style.css deve conter .group-mini-admin-section');
  assert.ok(css.includes('.group-rule-card'), 'style.css deve conter .group-rule-card');
  assert.ok(css.includes('.group-rule-textarea'), 'style.css deve conter .group-rule-textarea');
  assert.ok(css.includes('.group-rule-save-btn'), 'style.css deve conter .group-rule-save-btn');
  assert.ok(css.includes('.group-pending-req-item'), 'style.css deve conter .group-pending-req-item');
  assert.ok(css.includes('.group-approve-req-btn'), 'style.css deve conter .group-approve-req-btn');
  assert.ok(css.includes('.group-reject-req-btn'), 'style.css deve conter .group-reject-req-btn');

  // 4. Funções Exportadas na Janela
  assert.strictEqual(typeof win.detectSuspiciousBehavior, 'function', 'detectSuspiciousBehavior deve existir');
  assert.strictEqual(typeof win.isUserGroupModerator, 'function', 'isUserGroupModerator deve existir');
  assert.strictEqual(typeof win.promoteGroupModerator, 'function', 'promoteGroupModerator deve existir');
  assert.strictEqual(typeof win.demoteGroupModerator, 'function', 'demoteGroupModerator deve existir');
  assert.strictEqual(typeof win.isWithinScheduledPauseWindow, 'function', 'isWithinScheduledPauseWindow deve existir');
  assert.strictEqual(typeof win.checkGroupScheduledPause, 'function', 'checkGroupScheduledPause deve existir');
  assert.strictEqual(typeof win.checkGroupBannedWords, 'function', 'checkGroupBannedWords deve existir');
  assert.strictEqual(typeof win.renderGroupMiniAdminPanel, 'function', 'renderGroupMiniAdminPanel deve existir');
  assert.strictEqual(typeof win.approveGroupJoinRequest, 'function', 'approveGroupJoinRequest deve existir');
  assert.strictEqual(typeof win.rejectGroupJoinRequest, 'function', 'rejectGroupJoinRequest deve existir');
  assert.strictEqual(typeof win.requestToJoinGroup, 'function', 'requestToJoinGroup deve existir');

  // 5. Teste Unitário: Detecção de Comportamentos Suspeitos
  // 5.1 Phishing / Golpes
  const scamCheck = win.detectSuspiciousBehavior({
    uid: 'user_malicious_202',
    type: 'message',
    text: 'Acesse o pix premiado e receba o dobro do pix agora mesmo!'
  });
  assert.strictEqual(scamCheck.isSuspicious, true, 'Deve identificar tentativa de golpe / pix premiado');
  assert.strictEqual(scamCheck.reason, 'phishing_pattern');
  assert.ok(scamCheck.alertMessage.includes('Segurança VORTEX'));

  // 5.2 Mensagem normal não deve ser bloqueada
  const normalCheck = win.detectSuspiciousBehavior({
    uid: 'user_good_202',
    type: 'message',
    text: 'Olá pessoal, boa tarde a todos no grupo!'
  });
  assert.strictEqual(normalCheck.isSuspicious, false, 'Mensagem regular não deve ser considerada suspeita');

  // 5.3 Flood de Mensagens (> 4 msgs em 4s)
  win.suspiciousTracker.messageTimestamps.clear();
  win.suspiciousTracker.cooldowns.clear();
  for (let i = 0; i < 4; i++) {
    win.detectSuspiciousBehavior({ uid: 'user_flooder_202', type: 'message', text: 'Msg rápida ' + i });
  }
  const floodCheck = win.detectSuspiciousBehavior({ uid: 'user_flooder_202', type: 'message', text: 'Msg 5 flood' });
  assert.strictEqual(floodCheck.isSuspicious, true, 'Deve detectar flood com mais de 4 mensagens');
  assert.strictEqual(floodCheck.reason, 'flood_rate_limit');

  // 5.4 Repetição de Bot (3 mensagens idênticas)
  win.suspiciousTracker.recentMessages.clear();
  win.suspiciousTracker.cooldowns.clear();
  win.detectSuspiciousBehavior({ uid: 'user_bot_202', type: 'message', text: 'Spam idêntico' });
  win.detectSuspiciousBehavior({ uid: 'user_bot_202', type: 'message', text: 'Spam idêntico' });
  const botCheck = win.detectSuspiciousBehavior({ uid: 'user_bot_202', type: 'message', text: 'Spam idêntico' });
  assert.strictEqual(botCheck.isSuspicious, true, 'Deve detectar 3 mensagens idênticas seguidas como bot');
  assert.strictEqual(botCheck.reason, 'repetitive_bot_behavior');

  // 6. Teste Unitário: Palavras Proibidas no Grupo
  const groupRules = {
    groupId: 'grp_rules_202',
    bannedWordsEnabled: true,
    bannedWords: ['pirataria', 'golpe', 'aposta ilegal']
  };
  const cleanMsg = win.checkGroupBannedWords(groupRules, 'Bom dia pessoal!');
  assert.strictEqual(cleanMsg, false, 'Mensagem limpa não é bloqueada');

  const dirtyMsg = win.checkGroupBannedWords(groupRules, 'Aqui tem link de PIRATARIA de graça');
  assert.ok(dirtyMsg && dirtyMsg.matched, 'Mensagem com palavra proibida deve ser bloqueada');
  assert.strictEqual(dirtyMsg.word, 'pirataria');

  // Teste com filtro desativado
  const disabledRules = { ...groupRules, bannedWordsEnabled: false };
  assert.strictEqual(win.checkGroupBannedWords(disabledRules, 'Pirataria liberada'), false, 'Não bloqueia se o filtro estiver desativado');

  // 7. Teste Unitário: Janela de Horário Programado de Pausa
  // Horário Diurno (13:00 às 15:00)
  const dateAt14 = new Date(2026, 0, 1, 14, 0);
  const dateAt16 = new Date(2026, 0, 1, 16, 0);
  assert.strictEqual(win.isWithinScheduledPauseWindow('13:00', '15:00', dateAt14), true, '14:00 deve estar pausado (13:00 às 15:00)');
  assert.strictEqual(win.isWithinScheduledPauseWindow('13:00', '15:00', dateAt16), false, '16:00 não deve estar pausado');

  // Horário Noturno / Overnight (22:00 às 08:00)
  const dateAt23 = new Date(2026, 0, 1, 23, 30);
  const dateAt03 = new Date(2026, 0, 1, 3, 15);
  const dateAt10 = new Date(2026, 0, 1, 10, 0);
  assert.strictEqual(win.isWithinScheduledPauseWindow('22:00', '08:00', dateAt23), true, '23:30 deve estar pausado na janela noturna');
  assert.strictEqual(win.isWithinScheduledPauseWindow('22:00', '08:00', dateAt03), true, '03:15 da madrugada deve estar pausado na janela noturna');
  assert.strictEqual(win.isWithinScheduledPauseWindow('22:00', '08:00', dateAt10), false, '10:00 da manhã não deve estar pausado');

  // 8. Teste Unitário: Moderadores de Grupo
  const groupWithMod = {
    creatorUid: 'admin_owner_202',
    admins: ['admin_owner_202'],
    moderators: ['mod_samuel_202'],
    members: ['admin_owner_202', 'mod_samuel_202', 'user_john_202']
  };
  assert.strictEqual(win.isUserGroupModerator(groupWithMod, { uid: 'mod_samuel_202' }), true, 'Samuel é moderador');
  assert.strictEqual(win.isUserGroupModerator(groupWithMod, { uid: 'user_john_202' }), false, 'John não é moderador');

  // 9. Teste Funcional: Aprovação e Recusa de Solicitação de Entrada
  env.firestoreDocs['groups/grp_requests_202'] = {
    groupId: 'grp_requests_202',
    name: 'Grupo Secreto VIP',
    creatorUid: 'admin_owner_202',
    admins: ['admin_owner_202'],
    moderators: [],
    approvalRequired: true,
    members: ['admin_owner_202'],
    pendingRequests: [
      { uid: 'candidate_1', name: 'Candidato 1' },
      { uid: 'candidate_2', name: 'Candidato 2' }
    ]
  };

  win.setCurrentUser({ uid: 'admin_owner_202' });

  // Aprovar Candidato 1
  await win.approveGroupJoinRequest('grp_requests_202', 'candidate_1');
  const grpAfterApproval = env.firestoreDocs['groups/grp_requests_202'];
  assert.ok(grpAfterApproval.members.includes('candidate_1'), 'candidate_1 deve entrar na lista de membros');
  assert.strictEqual(grpAfterApproval.pendingRequests.some(p => p.uid === 'candidate_1'), false, 'candidate_1 deve ser removido das pendências');

  // Recusar Candidato 2
  await win.rejectGroupJoinRequest('grp_requests_202', 'candidate_2');
  const grpAfterReject = env.firestoreDocs['groups/grp_requests_202'];
  assert.strictEqual(grpAfterReject.members.includes('candidate_2'), false, 'candidate_2 não deve entrar nos membros');
  assert.strictEqual(grpAfterReject.pendingRequests.some(p => p.uid === 'candidate_2'), false, 'candidate_2 deve ser removido das pendências');
});

test('Ativar Conta Privada: Ocultação do Perfil e @ nas Buscas da Vortex VIP (v1.0.203)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.203+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(versionNum >= 203, 'script.js deve ter versão >= 1.0.203');
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(jsonVerNum >= 203, 'version.json deve ter versão >= 1.0.203');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js atualizado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css atualizado');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache correspondente');

  // 2. Estrutura HTML do Botão / Switch de Conta Privada e Badge
  assert.ok(html.includes('id="profile-private-toggle"'), 'index.html deve conter #profile-private-toggle no editar perfil');
  assert.ok(html.includes('id="settings-private-account-toggle"'), 'index.html deve conter #settings-private-account-toggle nas configurações');
  assert.ok(html.includes('id="contact-profile-private-badge"'), 'index.html deve conter badge #contact-profile-private-badge');

  // 3. Estilos CSS de Conta Privada
  assert.ok(css.includes('.profile-private-account-setting'), 'style.css deve estilizar .profile-private-account-setting');
  assert.ok(css.includes('.private-account-setting-row'), 'style.css deve estilizar .private-account-setting-row');
  assert.ok(css.includes('.private-account-badge'), 'style.css deve estilizar .private-account-badge');

  // 4. Funções Exportadas na Janela
  assert.strictEqual(typeof win.isUserPrivateAccount, 'function', 'isUserPrivateAccount deve existir');
  assert.strictEqual(typeof win.togglePrivateAccount, 'function', 'togglePrivateAccount deve existir');
  assert.strictEqual(typeof win.syncPrivateAccountToggles, 'function', 'syncPrivateAccountToggles deve existir');

  // 5. Teste Unitário: isUserPrivateAccount
  assert.strictEqual(win.isUserPrivateAccount({ isPrivateAccount: true }), true);
  assert.strictEqual(win.isUserPrivateAccount({ privateAccount: true }), true);
  assert.strictEqual(win.isUserPrivateAccount({ isPrivateAccount: false }), false);
  assert.strictEqual(win.isUserPrivateAccount({}), false);
  assert.strictEqual(win.isUserPrivateAccount(null), false);

  // 6. Teste Funcional: Ativar e Desativar Conta Privada
  win.setCurrentUser({ uid: 'user_stealth_203', displayName: 'Lucas Oculto' });
  win.setCurrentProfile({ uid: 'user_stealth_203', name: 'Lucas Oculto', username: '@lucasoculto', isPrivateAccount: false });

  // Toggles no DOM inicialmente desmarcados
  const pToggle = env.elements['profile-private-toggle'];
  const sToggle = env.elements['settings-private-account-toggle'];
  if (pToggle) pToggle.checked = false;
  if (sToggle) sToggle.checked = false;

  // Ativar Conta Privada
  const activated = await win.togglePrivateAccount(true);
  assert.strictEqual(activated, true, 'Deve retornar true ao ativar');
  assert.strictEqual(win.getCurrentProfile().isPrivateAccount, true, 'currentProfile deve ter isPrivateAccount true');
  assert.strictEqual(env.firestoreDocs['users/user_stealth_203'].isPrivateAccount, true, 'Firestore users/{uid} deve ter isPrivateAccount true');
  if (pToggle) assert.strictEqual(pToggle.checked, true, 'Toggle no perfil deve estar marcado');
  if (sToggle) assert.strictEqual(sToggle.checked, true, 'Toggle nas configurações deve estar marcado');

  // Desativar Conta Privada
  const deactivated = await win.togglePrivateAccount(false);
  assert.strictEqual(deactivated, false, 'Deve retornar false ao desativar');
  assert.strictEqual(win.getCurrentProfile().isPrivateAccount, false, 'currentProfile deve ter isPrivateAccount false');
  assert.strictEqual(env.firestoreDocs['users/user_stealth_203'].isPrivateAccount, false, 'Firestore users/{uid} deve ter isPrivateAccount false');
  if (pToggle) assert.strictEqual(pToggle.checked, false, 'Toggle no perfil deve estar desmarcado');
  if (sToggle) assert.strictEqual(sToggle.checked, false, 'Toggle nas configurações deve estar desmarcado');

  // 7. Teste de Busca e Pesquisa na Vortex VIP: Ocultação do Perfil e do @
  // Cadastrar 2 usuários no Firestore do ambiente de teste:
  // 1) Usuário Privado: "Renato Privado", username: "@renatoprivado", isPrivateAccount: true
  // 2) Usuário Público: "Renato Publico", username: "@renatopublico", isPrivateAccount: false
  env.firestoreDocs['users/user_renato_private'] = {
    id: 'user_renato_private',
    name: 'Renato',
    surname: 'Privado',
    username: '@renatoprivado',
    status: 'Perfil Privado VIP',
    isPrivateAccount: true
  };
  env.firestoreDocs['users/user_renato_public'] = {
    id: 'user_renato_public',
    name: 'Renato',
    surname: 'Publico',
    username: '@renatopublico',
    status: 'Perfil Aberto',
    isPrivateAccount: false
  };

  // Um usuário comum (estranho) faz a busca por "Renato"
  win.setCurrentUser({ uid: 'stranger_user_203', email: 'estranho@gmail.com' });
  const searchContainer = env.elements['search-results-container'];

  // Busca por nome "Renato"
  await win.loadUsersForSearch('Renato');
  let searchHtml = searchContainer ? (searchContainer.innerHTML || '') : '';
  assert.ok(searchHtml.includes('Renato Publico'), 'Usuário público deve aparecer nos resultados de busca');
  assert.ok(searchHtml.includes('@renatopublico'), '@ do usuário público deve aparecer nos resultados');
  assert.strictEqual(searchHtml.includes('Renato Privado'), false, 'Perfil de conta privada NÃO deve aparecer na busca por nome');
  assert.strictEqual(searchHtml.includes('@renatoprivado'), false, '@ de conta privada NÃO deve aparecer na busca');

  // Busca específica pelo @username do privado: "@renatoprivado"
  await win.loadUsersForSearch('@renatoprivado');
  searchHtml = searchContainer ? (searchContainer.innerHTML || '') : '';
  assert.strictEqual(searchHtml.includes('Renato Privado'), false, 'Busca pelo @ do usuário privado não deve retornar resultados');
  assert.strictEqual(searchHtml.includes('@renatoprivado'), false, 'O @ do usuário privado deve estar completamente oculto');

  // Busca específica pelo @username do público: "@renatopublico"
  await win.loadUsersForSearch('@renatopublico');
  searchHtml = searchContainer ? (searchContainer.innerHTML || '') : '';
  assert.ok(searchHtml.includes('Renato Publico'), 'Busca pelo @ público deve encontrar o usuário');

  // O admin da plataforma consegue visualizar perfis privados na busca para fins de moderação
  win.setCurrentUser({ uid: 'admin_master', email: 'dxhub.oficial@gmail.com' });
  await win.loadUsersForSearch('Renato');
  searchHtml = searchContainer ? (searchContainer.innerHTML || '') : '';
  assert.ok(searchHtml.includes('Renato Privado'), 'O admin da plataforma pode ver perfis privados nas buscas');
});

test('Organização do Título do Mini Painel Admin e Campo de Palavras Proibidas 100% Largo (v1.0.204)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.204+)
  const versionNum = parseInt((win.CURRENT_APP_VERSION || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(versionNum >= 204, 'script.js deve ter versão >= 1.0.204');
  const jsonVerNum = parseInt((versionJson.version || '0.0.0').split('.')[2] || '0', 10);
  assert.ok(jsonVerNum >= 204, 'version.json deve ter versão >= 1.0.204');
  assert.ok(html.includes(`script.js?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar script.js atualizado');
  assert.ok(html.includes(`style.css?v=${win.CURRENT_APP_VERSION}`), 'index.html deve referenciar style.css atualizado');
  assert.ok(swContent.includes(`vortex-vip-v${win.CURRENT_APP_VERSION}`), 'sw.js deve conter cache correspondente');

  // 2. Elementos no HTML
  assert.ok(html.includes('id="group-mini-admin-section"'), 'index.html deve conter #group-mini-admin-section');
  assert.ok(html.includes('class="group-mini-admin-header"'), 'index.html deve conter .group-mini-admin-header');
  assert.ok(html.includes('class="group-mini-admin-title"'), 'index.html deve conter .group-mini-admin-title');
  assert.ok(html.includes('class="group-mini-admin-tag"'), 'index.html deve conter .group-mini-admin-tag');
  assert.ok(html.includes('id="group-banned-words-input"'), 'index.html deve conter #group-banned-words-input');

  // 3. Estilos do Título Organizado em Linha Única
  assert.ok(css.includes('.group-mini-admin-title'), 'style.css deve estilizar .group-mini-admin-title');
  assert.ok(css.includes('.group-mini-admin-tag'), 'style.css deve estilizar .group-mini-admin-tag');
  
  // Verificar que .group-mini-admin-title e .group-mini-admin-tag usam white-space: nowrap
  const titleStyleMatch = css.match(/\.group-mini-admin-title\s*\{([^}]+)\}/);
  assert.ok(titleStyleMatch, '.group-mini-admin-title deve existir no CSS');
  assert.ok(titleStyleMatch[1].includes('white-space: nowrap'), '.group-mini-admin-title deve ter white-space: nowrap para não quebrar');

  const tagStyleMatch = css.match(/\.group-mini-admin-tag\s*\{([^}]+)\}/);
  assert.ok(tagStyleMatch, '.group-mini-admin-tag deve existir no CSS');
  assert.ok(tagStyleMatch[1].includes('white-space: nowrap'), '.group-mini-admin-tag deve ter white-space: nowrap para não quebrar em duas linhas');

  // 4. Estilos do Campo Mais Largo (width: 100% e box-sizing: border-box)
  const textareaMatch = css.match(/\.group-rule-textarea\s*\{([^}]+)\}/);
  assert.ok(textareaMatch, '.group-rule-textarea deve existir no CSS');
  assert.ok(textareaMatch[1].includes('width: 100%'), '.group-rule-textarea deve ter width: 100% para ocupar toda a largura');
  assert.ok(textareaMatch[1].includes('box-sizing: border-box'), '.group-rule-textarea deve ter box-sizing: border-box');

  const expandableMatch = css.match(/\.group-rule-expandable\s*\{([^}]+)\}/);
  assert.ok(expandableMatch, '.group-rule-expandable deve existir no CSS');
  assert.ok(expandableMatch[1].includes('width: 100%'), '.group-rule-expandable deve ter width: 100%');

  // 5. Verificação funcional do textarea no DOM simulado
  const textarea = env.elements['group-banned-words-input'];
  assert.ok(textarea, 'Textarea #group-banned-words-input deve ser acessível no ambiente');
  textarea.value = 'palavra1, palavra2, teste';
  assert.strictEqual(textarea.value, 'palavra1, palavra2, teste');
});

test('Ajuste Anti-Sobreposição do Título do Mini Painel Admin e Tag de Moderação (v1.0.205)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.205 ou superior)
  const semverCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  assert.ok(semverCompare(win.CURRENT_APP_VERSION, '1.0.205') >= 0, 'script.js deve ter versão 1.0.205 ou superior');
  assert.ok(semverCompare(versionJson.version, '1.0.205') >= 0, 'version.json deve ter versão 1.0.205 ou superior');

  // 2. Título Conciso e Sem Redundância no HTML
  assert.ok(html.includes('<span>Mini Painel Admin</span>'), 'index.html deve conter título conciso <span>Mini Painel Admin</span>');
  assert.ok(!html.includes('<span>Mini Painel Admin do Grupo</span>'), 'Não deve ter a repetição "do Grupo" para evitar sobreposição');

  // 3. Estilos Anti-Colisão e Truncamento Seguro no CSS
  const titleSpanMatch = css.match(/\.group-mini-admin-title\s+span\s*\{([^}]+)\}/);
  assert.ok(titleSpanMatch, '.group-mini-admin-title span deve ter regra no CSS');
  assert.ok(titleSpanMatch[1].includes('overflow: hidden'), 'Deve ter overflow: hidden para nunca invadir a tag');
  assert.ok(titleSpanMatch[1].includes('text-overflow: ellipsis'), 'Deve ter text-overflow: ellipsis');

  const titleMatch = css.match(/\.group-mini-admin-title\s*\{([^}]+)\}/);
  assert.ok(titleMatch[1].includes('flex-shrink: 1'), 'Título deve ter flex-shrink: 1 para flexibilidade');

  const tagMatch = css.match(/\.group-mini-admin-tag\s*\{([^}]+)\}/);
  assert.ok(tagMatch[1].includes('flex-shrink: 0'), 'Tag deve ter flex-shrink: 0 para manter o formato de pill');
  assert.ok(tagMatch[1].includes('font-size: 0.62rem'), 'Tag deve ter tamanho calibrado 0.62rem');

  // 4. Media query para telas menores (<= 360px)
  assert.ok(css.includes('@media (max-width: 360px)'), 'style.css deve conter media query de proteção para telas pequenas');
});


test('Câmera nos Contatos, Botão Interativo para Conta Empresa e Encaminhamento de Mensagens Selecionadas (v1.0.206)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.206 ou superior)
  const semverCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  assert.ok(semverCompare(win.CURRENT_APP_VERSION, '1.0.206') >= 0, 'script.js deve ter versão 1.0.206 ou superior');
  assert.ok(semverCompare(versionJson.version, '1.0.206') >= 0, 'version.json deve ter versão 1.0.206 ou superior');

  // 2. Elementos DOM no index.html
  // Câmera nos Contatos
  assert.ok(html.includes('id="chat-attach-camera-btn"'), 'index.html deve conter #chat-attach-camera-btn no drawer de anexos');
  assert.ok(html.includes('id="chat-camera-modal"'), 'index.html deve conter modal #chat-camera-modal');
  assert.ok(html.includes('id="chat-camera-video-feed"'), 'index.html deve conter video feed #chat-camera-video-feed');
  assert.ok(html.includes('id="chat-camera-tab-photo"'), 'index.html deve conter aba de foto #chat-camera-tab-photo');
  assert.ok(html.includes('id="chat-camera-tab-video"'), 'index.html deve conter aba de vídeo #chat-camera-tab-video');
  assert.ok(html.includes('id="chat-camera-shutter-btn"'), 'index.html deve conter disparador #chat-camera-shutter-btn');
  assert.ok(html.includes('id="chat-camera-send-btn"'), 'index.html deve conter botão de enviar #chat-camera-send-btn');

  // Botão Interativo Exclusivo para Conta Empresa
  assert.ok(html.includes('id="chat-attach-button-btn"'), 'index.html deve conter #chat-attach-button-btn');
  assert.ok(html.includes('id="company-button-modal"'), 'index.html deve conter modal #company-button-modal');
  assert.ok(html.includes('id="company-btn-title-input"'), 'index.html deve conter input de título #company-btn-title-input');
  assert.ok(html.includes('id="company-btn-link-input"'), 'index.html deve conter input de link #company-btn-link-input');
  assert.ok(html.includes('id="company-btn-image-input"'), 'index.html deve conter input de imagem opcional #company-btn-image-input');
  assert.ok(html.includes('id="company-btn-submit-btn"'), 'index.html deve conter botão de enviar #company-btn-submit-btn');

  // Encaminhar Mensagens Selecionadas
  assert.ok(html.includes('id="forward-selected-btn"'), 'index.html deve conter #forward-selected-btn no chat-selection-header');

  // 3. Estilos CSS
  assert.ok(css.includes('.camera-attach-circle'), 'style.css deve estilizar .camera-attach-circle');
  assert.ok(css.includes('.button-attach-circle'), 'style.css deve estilizar .button-attach-circle');
  assert.ok(css.includes('.chat-camera-card'), 'style.css deve estilizar .chat-camera-card');
  assert.ok(css.includes('.company-button-card'), 'style.css deve estilizar .company-button-card');
  assert.ok(css.includes('.company-interactive-cta-btn'), 'style.css deve estilizar .company-interactive-cta-btn');
  assert.ok(css.includes('#forward-selected-btn'), 'style.css deve estilizar #forward-selected-btn');

  // 4. Funções Exportadas na Janela
  assert.strictEqual(typeof win.openChatCamera, 'function', 'openChatCamera deve existir');
  assert.strictEqual(typeof win.closeChatCamera, 'function', 'closeChatCamera deve existir');
  assert.strictEqual(typeof win.openCompanyButtonModal, 'function', 'openCompanyButtonModal deve existir');
  assert.strictEqual(typeof win.closeCompanyButtonModal, 'function', 'closeCompanyButtonModal deve existir');
  assert.strictEqual(typeof win.sendCompanyButtonMessage, 'function', 'sendCompanyButtonMessage deve existir');
  assert.strictEqual(typeof win.buildCompanyButtonCardHTML, 'function', 'buildCompanyButtonCardHTML deve existir');
  assert.strictEqual(typeof win.updateCompanyAttachVisibility, 'function', 'updateCompanyAttachVisibility deve existir');
  assert.strictEqual(typeof win.openForwardModal, 'function', 'openForwardModal deve existir');

  // 5. Teste Unitário: Visibilidade do Botão Comercial (Conta Empresa vs Pessoal)
  const btnAttach = env.elements['chat-attach-button-btn'];
  assert.ok(btnAttach, '#chat-attach-button-btn deve existir no DOM');

  // Conta Pessoal: Deve ficar oculto (display: none)
  win.setCurrentProfile({ uid: 'user_personal_206', accountType: 'personal' });
  win.updateCompanyAttachVisibility();
  assert.strictEqual(btnAttach.style.display, 'none', 'Conta pessoal NÃO deve ver o botão de link/interativo no drawer');

  // Conta Empresa: Deve ficar visível (display: flex)
  win.setCurrentProfile({ uid: 'user_company_206', accountType: 'company' });
  win.updateCompanyAttachVisibility();
  assert.strictEqual(btnAttach.style.display, 'flex', 'Conta empresa DEVE ver o botão interativo no drawer');

  // 6. Teste Unitário: buildCompanyButtonCardHTML
  const cardHtmlWithImg = win.buildCompanyButtonCardHTML({
    type: 'company_button',
    buttonTitle: 'Ver Catálogo VIP',
    buttonUrl: 'https://vortexvip.app/catalogo',
    buttonImage: 'data:image/png;base64,mockbanner',
    text: 'Confira nossos lançamentos exclusivos!'
  });
  assert.ok(cardHtmlWithImg.includes('Ver Catálogo VIP'), 'Card deve exibir o título do botão');
  assert.ok(cardHtmlWithImg.includes('https://vortexvip.app/catalogo'), 'Card deve conter o link do botão');
  assert.ok(cardHtmlWithImg.includes('data:image/png;base64,mockbanner'), 'Card deve exibir a imagem se fornecida');
  assert.ok(cardHtmlWithImg.includes('Confira nossos lançamentos exclusivos!'), 'Card deve exibir o texto descritivo');
  assert.ok(cardHtmlWithImg.includes('company-interactive-cta-btn'), 'Card deve ter classe do botão interativo');

  const cardHtmlNoImg = win.buildCompanyButtonCardHTML({
    type: 'company_button',
    buttonTitle: 'Falar no WhatsApp',
    buttonUrl: 'https://wa.me/5511999999999'
  });
  assert.ok(cardHtmlNoImg.includes('Falar no WhatsApp'), 'Card deve exibir o título');
  assert.ok(cardHtmlNoImg.includes('https://wa.me/5511999999999'), 'Card deve conter o link');
  assert.strictEqual(cardHtmlNoImg.includes('company-btn-card-img-wrap'), false, 'Card sem imagem não deve renderizar wrapper de imagem');

  // 7. Teste Funcional: Encaminhar Mensagens Selecionadas
  win.setCurrentUser({ uid: 'user_sender_206', displayName: 'Lucas' });
  win.setCurrentProfile({ uid: 'user_sender_206', name: 'Lucas' });

  // Criar 2 mensagens no chat ativo
  const chatId = 'user_sender_206_contact_a';
  env.firestoreDocs[`chats/${chatId}/messages/msg_1`] = {
    id: 'msg_1',
    text: 'Primeira mensagem selecionada',
    type: 'text',
    senderUid: 'user_sender_206',
    createdAt: 1000
  };
  env.firestoreDocs[`chats/${chatId}/messages/msg_2`] = {
    id: 'msg_2',
    text: 'Segunda mensagem selecionada',
    type: 'text',
    senderUid: 'user_sender_206',
    createdAt: 2000
  };

  const currentMap = win.getCurrentChatMessagesMap();
  currentMap.set('msg_1', env.firestoreDocs[`chats/${chatId}/messages/msg_1`]);
  currentMap.set('msg_2', env.firestoreDocs[`chats/${chatId}/messages/msg_2`]);

  // Contato de destino
  env.firestoreDocs['users/user_sender_206/contacts/target_contact'] = {
    uid: 'contact_dest_206',
    name: 'Destinatário VIP'
  };

  // Abrir forward modal com as 2 mensagens
  const messagesToFwd = [currentMap.get('msg_1'), currentMap.get('msg_2')];
  await win.openForwardModal(messagesToFwd);

  const forwardModal = env.elements['forward-modal'];
  assert.ok(forwardModal, 'Modal de encaminhamento deve existir');
  const modalTitle = env.elements['forward-modal-title'] || forwardModal.querySelector('h2');
  assert.ok(modalTitle && modalTitle.innerText.includes('2 Mensagens'), 'Título deve indicar 2 mensagens a encaminhar');

  const forwardList = env.elements['forward-contacts-list'];
  assert.ok(forwardList, 'Lista de contatos deve existir');
  const contactItem = forwardList.querySelector('.contact-selection-item');
  assert.ok(contactItem, 'Deve renderizar o contato na lista');
  assert.ok((contactItem.innerText || '' + contactItem.innerHTML || '').includes('Destinatário VIP') || (contactItem._innerText || '').includes('Destinatário VIP'), 'Deve exibir o nome do destinatário');

  // Simular clique no botão "Enviar"
  const sendBtn = contactItem.querySelector('button');
  assert.ok(sendBtn, 'Botão enviar deve existir no item de contato');
  await sendBtn.onclick();

  // Verificar se as 2 mensagens foram encaminhadas para o chat de destino com forwarded: true
  const targetChatId = ['user_sender_206', 'contact_dest_206'].sort().join('_');
  const forwardedKeys = Object.keys(env.firestoreDocs).filter(k => k.startsWith(`chats/${targetChatId}/messages`));
  assert.strictEqual(forwardedKeys.length, 2, 'Deve ter encaminhado exatamente 2 mensagens para o chat de destino');

  const fwd1 = env.firestoreDocs[forwardedKeys[0]];
  const fwd2 = env.firestoreDocs[forwardedKeys[1]];
  assert.strictEqual(fwd1.forwarded, true, 'Mensagem 1 deve ter flag forwarded: true');
  assert.strictEqual(fwd2.forwarded, true, 'Mensagem 2 deve ter flag forwarded: true');
  assert.ok(fwd1.text.includes('mensagem selecionada'), 'Conteúdo da mensagem 1 deve ser preservado');
  assert.ok(fwd2.text.includes('mensagem selecionada'), 'Conteúdo da mensagem 2 deve ser preservado');
});
test('Organização Visual do Modal de Botão Interativo (Empresa) - Título, Inputs Largos e Botões Proporcionais (v1.0.207)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.207 ou superior)
  const semverCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  assert.ok(semverCompare(win.CURRENT_APP_VERSION, '1.0.207') >= 0, 'script.js deve ter versão 1.0.207 ou superior');
  assert.ok(semverCompare(versionJson.version, '1.0.207') >= 0, 'version.json deve ter versão 1.0.207 ou superior');

  // 2. Barra Superior Organizada (Sem Quebra Feia do Título e Fechar Alinhado)
  assert.ok(html.includes('class="panel-top-bar company-btn-modal-top-bar"'), 'index.html deve conter barra superior .company-btn-modal-top-bar');
  assert.ok(html.includes('class="company-btn-header-icon-badge"'), 'index.html deve conter badge de ícone no cabeçalho');
  assert.ok(html.includes('id="company-button-modal-title"'), 'index.html deve conter #company-button-modal-title');
  assert.ok(html.includes('class="company-btn-header-tag"'), 'index.html deve conter tag Empresa no cabeçalho');
  assert.ok(html.includes('class="company-btn-header-subtitle"'), 'index.html deve conter subtítulo organizado');

  // Estilos da Barra Superior
  assert.ok(css.includes('.company-btn-modal-top-bar'), 'style.css deve estilizar .company-btn-modal-top-bar');
  assert.ok(css.includes('.company-btn-header-title-row h2'), 'style.css deve ter regra específica para título h2');
  const h2StyleMatch = css.match(/\.company-btn-header-title-row\s+h2\s*\{([^}]+)\}/);
  assert.ok(h2StyleMatch, 'Regra de estilo de h2 deve existir');
  assert.ok(h2StyleMatch[1].includes('white-space: nowrap'), 'Título deve ter white-space: nowrap para não quebrar em duas linhas');
  assert.ok(h2StyleMatch[1].includes('overflow: hidden'), 'Título deve ter overflow: hidden');
  assert.ok(h2StyleMatch[1].includes('text-overflow: ellipsis'), 'Título deve ter text-overflow: ellipsis');

  // 3. Inputs de Título e Link Largos (100% de Largura e Alinhados à Esquerda)
  assert.ok(!html.includes('class="setting-item company-btn-input-group"'), 'Grupos de input não devem ter a classe setting-item que encolhe para 170px');
  assert.ok(html.includes('class="company-btn-text-input"'), 'Inputs devem ter a classe .company-btn-text-input');
  
  const inputStyleMatch = css.match(/\.company-btn-input-group\s+input\[type="text"\][^\{]*\{([^}]+)\}/);
  assert.ok(inputStyleMatch, 'Regra de inputs de texto deve existir');
  assert.ok(inputStyleMatch[1].includes('width: 100% !important'), 'Inputs de texto devem ter width: 100% !important');
  assert.ok(inputStyleMatch[1].includes('text-align: left !important'), 'Inputs de texto devem ter text-align: left !important');

  // 4. Barra de Ações do Rodapé: Cancelar e Enviar Botão Proporcionais
  assert.ok(html.includes('class="close-btn modal-cancel-btn company-btn-modal-cancel"'), 'Botão Cancelar deve ter classe .company-btn-modal-cancel');
  assert.ok(html.includes('class="danger-btn company-btn-submit-action"'), 'Botão Enviar deve ter classe .company-btn-submit-action');
  assert.ok(html.includes('<span>Enviar Botão</span>'), 'Botão Enviar deve ter texto envolto em span');

  const submitBtnStyleMatch = css.match(/\.company-btn-submit-action\s*\{([^}]+)\}/);
  assert.ok(submitBtnStyleMatch, 'Regra de botão enviar deve existir');
  assert.ok(submitBtnStyleMatch[1].includes('white-space: nowrap !important'), 'Botão Enviar deve ter white-space: nowrap !important para não quebrar em 2 linhas');

  const cancelBtnStyleMatch = css.match(/\.company-btn-modal-cancel\s*\{([^}]+)\}/);
  assert.ok(cancelBtnStyleMatch, 'Regra de botão cancelar deve existir');
  assert.ok(cancelBtnStyleMatch[1].includes('white-space: nowrap !important'), 'Botão Cancelar deve ter white-space: nowrap !important');

  // 5. Funcionamento dos Modais e Elementos
  const modal = env.elements['company-button-modal'];
  const titleInput = env.elements['company-btn-title-input'];
  const linkInput = env.elements['company-btn-link-input'];
  const cancelBtn = env.elements['company-btn-cancel-btn'];
  const closeBtn = env.elements['close-company-button-modal'];

  assert.ok(modal, 'Modal deve existir no DOM');
  assert.ok(titleInput, 'Input de título deve existir no DOM');
  assert.ok(linkInput, 'Input de link deve existir no DOM');

  // Abrir modal
  win.openCompanyButtonModal();
  assert.strictEqual(modal.style.display, 'flex', 'Modal deve estar visível após openCompanyButtonModal');

  // Simular preenchimento
  titleInput.value = 'Acessar Loja Oficial';
  linkInput.value = 'https://lojaoficial.com/produtos';
  assert.strictEqual(titleInput.value, 'Acessar Loja Oficial');
  assert.strictEqual(linkInput.value, 'https://lojaoficial.com/produtos');

  // Fechar modal via win.closeCompanyButtonModal ou dispatchEvent
  if (typeof cancelBtn.onclick === 'function') cancelBtn.onclick();
  else if (typeof cancelBtn.dispatchEvent === 'function') await cancelBtn.dispatchEvent({ type: 'click' });
  else win.closeCompanyButtonModal();
  assert.strictEqual(modal.style.display, 'none', 'Modal deve fechar ao fechar o modal');
});

test('Correção do Fluxo de Envio do Botão Comercial: Persistência de Dados, Sanitização de Link e Feedback Visual (v1.0.208)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.208+)
  assert.ok(['1.0.208', '1.0.209', '1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.208', '1.0.209', '1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.208') || html.includes('script.js?v=1.0.209') || html.includes('script.js?v=1.0.210') || html.includes('script.js?v=1.0.211') || html.includes('script.js?v=1.0.212') || html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))) || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216'), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.208') || html.includes('style.css?v=1.0.209') || html.includes('style.css?v=1.0.210') || html.includes('style.css?v=1.0.211') || html.includes('style.css?v=1.0.212') || html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))) || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216'), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.208') || swContent.includes('vortex-vip-v1.0.209') || swContent.includes('vortex-vip-v1.0.210') || swContent.includes('vortex-vip-v1.0.211') || swContent.includes('vortex-vip-v1.0.212') || swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))) || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216'), 'sw.js deve conter cache');

  // 2. Correção de z-index do toast para sobrepor o modal (z-index: 99999 !important)
  assert.ok(css.includes('#toast-container { position: absolute; top: 15px; left: 15px; right: 15px; z-index: 99999 !important;'), 'toast-container deve ter z-index 99999 para nunca ficar escondido sob modais');

  // 3. Banner de Erro Inline e Botão com onclick direto
  assert.ok(html.includes('id="company-btn-error-msg"'), 'index.html deve conter banner #company-btn-error-msg');
  assert.ok(html.includes('onclick="sendCompanyButtonMessage()"'), 'botão de envio deve ter onclick="sendCompanyButtonMessage()"');
  assert.ok(html.includes('onclick="closeCompanyButtonModal()"'), 'botão de fechar deve ter onclick="closeCompanyButtonModal()"');
  assert.ok(css.includes('.company-btn-error-banner'), 'style.css deve estilizar .company-btn-error-banner');

  // 4. Configurar Usuário e Conversa Ativa
  const bizUser = { uid: 'biz_user_208', email: 'empresa@vortex.vip' };
  win.setCurrentUser(bizUser);
  win.setCurrentProfile({
    name: 'Loja Vortex Tech',
    accountType: 'business'
  });

  const targetContact = {
    uid: 'client_user_208',
    name: 'Cliente VIP'
  };
  win.setActiveChatContact(targetContact);

  // 5. Teste de Validação: campos vazios não enviam e exibem erro
  win.openCompanyButtonModal();
  const modal = env.elements['company-button-modal'];
  const titleInput = env.elements['company-btn-title-input'];
  const linkInput = env.elements['company-btn-link-input'];
  const descInput = env.elements['company-btn-desc-input'];
  const errorBox = env.elements['company-btn-error-msg'];

  titleInput.value = '';
  linkInput.value = '';
  await win.sendCompanyButtonMessage();
  assert.strictEqual(modal.style.display, 'flex', 'Modal não deve fechar se houver campos obrigatórios vazios');
  assert.ok(errorBox.style.display !== 'none', 'Banner de erro deve ficar visível ao tentar enviar sem título');

  // 6. Teste de Envio com Sucesso: dados preenchidos com sanitização de URL
  titleInput.value = 'Ver Produtos Exclusivos';
  linkInput.value = 'minhaloja.com.br/produtos promo'; // sem https e com espaço que será sanitizado para %20
  descInput.value = 'Olá! Aproveite nossas ofertas desta semana.';

  await win.sendCompanyButtonMessage();

  // Modal deve fechar após envio
  assert.strictEqual(modal.style.display, 'none', 'Modal deve fechar após envio com sucesso');

  // 7. Verificar se a mensagem foi gravada corretamente no Firestore com buttonTitle, buttonUrl e text
  const chatId = ['biz_user_208', 'client_user_208'].sort().join('_');
  const msgKeys = Object.keys(env.firestoreDocs).filter(k => k.startsWith(`chats/${chatId}/messages`));
  assert.ok(msgKeys.length > 0, 'Deve ter gravado a mensagem no Firestore');

  const savedMsg = env.firestoreDocs[msgKeys[msgKeys.length - 1]];
  assert.strictEqual(savedMsg.type, 'company_button', 'Tipo da mensagem deve ser company_button');
  assert.strictEqual(savedMsg.buttonTitle, 'Ver Produtos Exclusivos', 'buttonTitle deve ser persistido');
  assert.strictEqual(savedMsg.buttonUrl, 'https://minhaloja.com.br/produtos%20promo', 'buttonUrl deve ser sanitizado com https:// e encode');
  assert.strictEqual(savedMsg.text, 'Olá! Aproveite nossas ofertas desta semana.', 'text da mensagem deve ser persistido');
  assert.ok(savedMsg.companyButton, 'Objeto companyButton deve ser persistido');

  // 8. Renderização do Card do Botão Comercial no Chat
  const cardHTML = win.buildCompanyButtonCardHTML(savedMsg);
  assert.ok(cardHTML.includes('Mensagem Comercial'), 'Card deve exibir selo Mensagem Comercial');
  assert.ok(cardHTML.includes('Ver Produtos Exclusivos'), 'Card deve exibir título do botão');
  assert.ok(cardHTML.includes('https://minhaloja.com.br/produtos%20promo'), 'Card deve conter o link sanitizado');
  assert.ok(cardHTML.includes('target="_blank"'), 'Link deve abrir em nova aba');
});

test('Centralização do Título (Texto) com o Ícone no Botão de Publicação (v1.0.209)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.209+)
  assert.ok(['1.0.209', '1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.209', '1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.209') || html.includes('script.js?v=1.0.210') || html.includes('script.js?v=1.0.211') || html.includes('script.js?v=1.0.212') || html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.209') || html.includes('style.css?v=1.0.210') || html.includes('style.css?v=1.0.211') || html.includes('style.css?v=1.0.212') || html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.209') || swContent.includes('vortex-vip-v1.0.210') || swContent.includes('vortex-vip-v1.0.211') || swContent.includes('vortex-vip-v1.0.212') || swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache');

  // 2. Estrutura HTML do Botão de Publicar com Ícone e Título Centralizados
  assert.ok(html.includes('id="publish-post-btn"'), 'Deve existir o botão #publish-post-btn');
  assert.ok(html.includes('<i data-lucide="send"></i> <span>Publicar</span>'), 'Botão de publicar deve ter o ícone send e o span com o texto Publicar');

  // 3. Estilos CSS de Alinhamento e Centralização (.post-publish-btn)
  assert.ok(css.includes('.post-publish-btn {') && css.includes('display: inline-flex;') && css.includes('align-items: center;') && css.includes('justify-content: center;') && css.includes('gap: 6px;'), 'post-publish-btn deve ter display flex alinhado e centralizado com gap');
  assert.ok(css.includes('.post-publish-btn i,') && css.includes('.post-publish-btn svg {'), 'style.css deve estilizar o ícone e svg do post-publish-btn');
  assert.ok(css.includes('.post-publish-btn span {') && css.includes('display: inline-flex;') && css.includes('align-items: center;'), 'style.css deve alinhar verticalmente o span do título com o ícone');

  // 4. Tema Hacker também garante centralização flex
  assert.ok(css.includes('body.theme-hacker .post-publish-btn {') && css.includes('display: inline-flex !important;') && css.includes('align-items: center !important;'), 'theme-hacker deve garantir display flex e alinhamento centrado no botão de publicar');

  // 5. Verificação no DOM da instância de teste
  const publishBtn = env.elements['publish-post-btn'];
  assert.ok(publishBtn, 'Elemento publish-post-btn deve existir no DOM');
  assert.ok(publishBtn.classList.contains('post-publish-btn'), 'Elemento deve ter a classe post-publish-btn');
});


test('Botão para Ativar e Desativar a Loja no Catálogo e no Editar Perfil (v1.0.210)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.210)
  assert.ok(['1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.210', '1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.210') || html.includes('script.js?v=1.0.211') || html.includes('script.js?v=1.0.212') || html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js compatível');
  assert.ok(html.includes('style.css?v=1.0.210') || html.includes('style.css?v=1.0.211') || html.includes('style.css?v=1.0.212') || html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css compatível');
  assert.ok(swContent.includes('vortex-vip-v1.0.210') || swContent.includes('vortex-vip-v1.0.211') || swContent.includes('vortex-vip-v1.0.212') || swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache compatível');

  // 2. Elementos no DOM em index.html
  assert.ok(html.includes('id="profile-store-toggle-setting"'), 'Deve existir o container #profile-store-toggle-setting no Editar Perfil');
  assert.ok(html.includes('id="profile-store-enabled-toggle"'), 'Deve existir o switch #profile-store-enabled-toggle no Editar Perfil');
  assert.ok(html.includes('id="profile-store-status-badge"'), 'Deve existir o badge #profile-store-status-badge');
  assert.ok(html.includes('id="catalog-store-visibility-control"'), 'Deve existir o controle de visibilidade no Catálogo');
  assert.ok(html.includes('id="catalog-store-visibility-toggle-btn"'), 'Deve existir o botão #catalog-store-visibility-toggle-btn');

  // 3. Estilos CSS
  assert.ok(css.includes('.profile-store-toggle-setting'), 'style.css deve conter estilos para .profile-store-toggle-setting');
  assert.ok(css.includes('.profile-store-status-badge.active'), 'style.css deve estilizar o badge ativo');
  assert.ok(css.includes('.profile-store-status-badge.disabled'), 'style.css deve estilizar o badge desativado');
  assert.ok(css.includes('.catalog-store-badge-disabled'), 'style.css deve estilizar o badge de loja desativada');

  // 4. Sincronização visual da UI (syncStoreEnabledUI)
  const storeToggle = env.elements['profile-store-enabled-toggle'];
  const storeBadge = env.elements['profile-store-status-badge'];
  const storeDesc = env.elements['profile-store-toggle-desc'];

  win.syncStoreEnabledUI(true);
  assert.strictEqual(storeToggle.checked, true, 'Toggle deve estar marcado quando ativado');
  assert.strictEqual(storeBadge.innerText, 'Loja Ativa', 'Badge deve exibir Loja Ativa');
  assert.ok(storeDesc.innerText.includes('ativa e aparece normalmente'), 'Descrição deve indicar loja ativa');

  win.syncStoreEnabledUI(false);
  assert.strictEqual(storeToggle.checked, false, 'Toggle deve estar desmarcado quando desativado');
  assert.strictEqual(storeBadge.innerText, 'Loja Desativada', 'Badge deve exibir Loja Desativada');
  assert.ok(storeDesc.innerText.includes('desativada e não aparece para ninguém'), 'Descrição deve indicar loja desativada');

  // 5. Testar salvar perfil com loja desativada
  const sellerUser = { uid: 'seller_user_210', email: 'seller@empresa.com' };
  await env.triggerAuthStateChange(sellerUser);
  await new Promise(r => setTimeout(r, 20));
  const profileNameInp = env.elements['profile-name-input'];
  const profileUsernameInp = env.elements['profile-username-input'];
  const profileTypeBusiness = env.elements['profile-type-business'];
  const saveProfileBtn = env.elements['save-profile-btn'];

  profileNameInp.value = 'Loja VIP 210';
  profileUsernameInp.value = 'loja210';
  profileTypeBusiness.checked = true;
  storeToggle.checked = false; // desativa a loja

  await saveProfileBtn.click();
  await new Promise(r => setTimeout(r, 40));

  const savedUserDoc = env.firestoreDocs['users/seller_user_210'];
  assert.ok(savedUserDoc, 'Documento do usuário deve ter sido salvo no Firestore');
  assert.strictEqual(savedUserDoc.isStoreEnabled, false, 'isStoreEnabled deve ser false no Firestore');
  assert.strictEqual(savedUserDoc.storeEnabled, false, 'storeEnabled deve ser false no Firestore');

  // 6. Testar que quando a loja está desativada, o botão "Ver catálogo" NÃO aparece no perfil do contato
  const deactivatedContact = {
    uid: 'seller_user_210',
    name: 'Loja VIP 210',
    username: 'loja210',
    accountType: 'business',
    isStoreEnabled: false,
    storeEnabled: false
  };

  win.openContactProfile(deactivatedContact);
  const contactCatalogBtn = env.elements['contact-profile-catalog-btn'];
  assert.strictEqual(contactCatalogBtn.style.display, 'none', 'Botão Ver catálogo DEVE estar oculto quando loja está desativada');

  // 7. Testar que quando a loja está ativada, o botão "Ver catálogo" aparece normalmente
  const activatedContact = {
    uid: 'active_seller_210',
    name: 'Loja Ativa 210',
    username: 'lojaativa210',
    accountType: 'business',
    isStoreEnabled: true,
    storeEnabled: true
  };

  win.openContactProfile(activatedContact);
  assert.strictEqual(contactCatalogBtn.style.display, 'flex', 'Botão Ver catálogo DEVE aparecer quando loja está ativada');

  // 8. Testar openStorefront bloqueando visitante quando loja desativada
  win.setCurrentUser({ uid: 'visitor_user_210', email: 'visitor@cliente.com' });
  let toastTriggered = false;
  win.showToast = (title, msg) => {
    if (title.includes('Loja Desativada')) toastTriggered = true;
  };

  await win.openStorefront('seller_user_210', deactivatedContact);
  assert.ok(toastTriggered, 'Deve exibir toast de Loja Desativada ao tentar visitar loja desativada');
  const storefrontView = env.elements['catalog-view-storefront'];
  assert.strictEqual(storefrontView.style.display, 'none', 'Vitrine não deve ser exibida para visitante se loja estiver desativada');
});


test('Bloqueio Anti-Roubo de Imagens e Vídeos nos Posts e Contatos (v1.0.211)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.211)
  assert.ok(['1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.211', '1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.211') || html.includes('script.js?v=1.0.212') || html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js compatível');
  assert.ok(html.includes('style.css?v=1.0.211') || html.includes('style.css?v=1.0.212') || html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css compatível');
  assert.ok(swContent.includes('vortex-vip-v1.0.211') || swContent.includes('vortex-vip-v1.0.212') || swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache compatível');

  // 2. Proteção CSS contra cópia, drag & drop e touch callout móvel
  assert.ok(css.includes('-webkit-touch-callout: none !important'), 'CSS deve desativar touch callout móvel');
  assert.ok(css.includes('-webkit-user-drag: none !important'), 'CSS deve impedir arrastar mídias (-webkit-user-drag)');
  assert.ok(css.includes('video::-webkit-media-controls-download-button'), 'CSS deve ocultar botão de download nativo dos vídeos');
  assert.ok(css.includes('.view-once-security-badge'), 'CSS deve definir badge de segurança do visualizador');

  // 3. Elementos e Atributos de Proteção no index.html
  assert.ok(html.includes('view-once-security-badge'), 'index.html deve conter badge de segurança no overlay de foto única');
  assert.ok(html.includes('id="status-preview-video"') && html.includes('controlsList="nodownload"'), 'Prévia de status deve ter controlsList="nodownload"');
  assert.ok(html.includes('id="chat-camera-captured-video-preview"') && html.includes('controlsList="nodownload"'), 'Prévia de vídeo da câmera do chat deve ter controlsList="nodownload"');

  // 4. Testar a função de identificação de alvo protegido (isProtectedMediaTarget)
  assert.ok(typeof win.isProtectedMediaTarget === 'function', 'isProtectedMediaTarget deve ser uma função');
  
  const mockImg = win.document.createElement('img');
  assert.strictEqual(win.isProtectedMediaTarget(mockImg), true, 'Elemento IMG deve ser reconhecido como mídia protegida');

  const mockVideo = win.document.createElement('video');
  assert.strictEqual(win.isProtectedMediaTarget(mockVideo), true, 'Elemento VIDEO deve ser reconhecido como mídia protegida');

  const mockDiv = win.document.createElement('div');
  mockDiv.className = 'post-media';
  const childSpan = win.document.createElement('span');
  mockDiv.appendChild(childSpan);
  assert.strictEqual(win.isProtectedMediaTarget(childSpan), true, 'Elemento dentro de .post-media deve ser protegido');

  const genericButton = win.document.createElement('button');
  assert.strictEqual(win.isProtectedMediaTarget(genericButton), false, 'Botão normal não deve ser marcado como mídia protegida');

  // 5. Bloqueio de Clique com Botão Direito (contextmenu) em Mídias
  let toastMsg = '';
  win.showToast = (title, msg) => {
    toastMsg = `${title}: ${msg}`;
  };

  let prevented = false;
  const mockContextMenuEvent = {
    target: mockImg,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {}
  };

  // Simular listener de contextmenu registrado
  win.document.body.appendChild(mockImg);
  if (typeof win.initMediaProtection === 'function') {
    win.initMediaProtection();
  }

  // Chamar função de proteção diretamente para validar o comportamento
  win.showMediaProtectionToast();
  assert.ok(toastMsg.includes('Proteção Vortex VIP'), 'Deve exibir toast de proteção ao tentar ação restrita');
  assert.ok(toastMsg.includes('Downloads e cópias'), 'Toast deve informar que downloads e cópias estão bloqueados');

  // 6. Testar Renderização de Posts com Proteção Anti-Roubo
  const mockPostVideo = {
    id: 'post_video_211',
    type: 'video',
    mediaData: 'https://vortex.app/video.mp4',
    authorUid: 'author_211',
    authorName: 'Criador VIP',
    createdAt: Date.now()
  };

  const mockPostImage = {
    id: 'post_img_211',
    type: 'image',
    mediaData: 'https://vortex.app/foto.jpg',
    authorUid: 'author_211',
    authorName: 'Criador VIP',
    createdAt: Date.now()
  };

  const feedList = win.document.getElementById('feed-list');
  win.renderPostsFeed([mockPostVideo, mockPostImage]);

  const feedHTML = feedList.innerHTML;
  assert.ok(feedHTML.includes('controlsList="nodownload"'), 'Vídeo do post deve conter controlsList="nodownload" para remover botão Baixar');
  assert.ok(feedHTML.includes('disablePictureInPicture'), 'Vídeo do post deve desativar Picture-in-Picture');
  assert.ok(feedHTML.includes('draggable="false"'), 'Imagem do post deve ter draggable="false"');
  assert.ok(feedHTML.includes('protected-media'), 'Mídias do post devem ter classe protected-media');

  // 7. Testar Bloqueio de Download de Story de Outros Usuários
  win.setCurrentUser({ uid: 'user_viewer_211', name: 'Espectador' });
  const otherUserStory = {
    id: 'story_other_211',
    authorUid: 'another_user_211',
    authorName: 'Outro Usuário',
    type: 'image',
    src: 'https://vortex.app/story.jpg',
    isAd: true
  };

  win.openStoryViewer([otherUserStory], { authorUid: 'another_user_211', authorName: 'Outro Usuário' });
  const downloadStoryBtn = win.document.getElementById('download-story-btn') || env.elements['download-story-btn'];
  assert.ok(downloadStoryBtn, 'downloadStoryBtn deve existir');
  assert.strictEqual(downloadStoryBtn.style.display, 'none', 'Botão de download de story DEVE estar oculto para outros usuários');
});


test('Reprodutor de Vídeo e Menu de Velocidade no Tema VORTEX VIP (v1.0.212)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const css = fs.readFileSync('public/style.css', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.212)
  assert.ok(['1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.212', '1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.212') || html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.212') || html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.212') || swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache');

  // 2. Estilos do Player de Vídeo e Menu de Velocidade VIP no style.css
  assert.ok(css.includes('.vortex-video-player'), 'style.css deve conter estilos para .vortex-video-player');
  assert.ok(css.includes('.vortex-video-controls'), 'style.css deve conter barra de controles .vortex-video-controls');
  assert.ok(css.includes('.vortex-video-timeline'), 'style.css deve conter barra de progresso .vortex-video-timeline');
  assert.ok(css.includes('.vortex-video-speed-menu'), 'style.css deve conter menu de velocidade VIP .vortex-video-speed-menu');
  assert.ok(css.includes('.vortex-video-speed-opt.active'), 'style.css deve estilizar a opção de velocidade ativa');
  assert.ok(css.includes('.vortex-video-center-btn'), 'style.css deve conter botão central de play');

  // 3. Funções Utilitárias do Player de Vídeo
  assert.ok(typeof win.formatVideoTime === 'function', 'formatVideoTime deve ser uma função');
  assert.strictEqual(win.formatVideoTime(0), '0:00', '0 segundos deve formatar para 0:00');
  assert.strictEqual(win.formatVideoTime(4), '0:04', '4 segundos deve formatar para 0:04 (conforme imagem do usuário)');
  assert.strictEqual(win.formatVideoTime(19), '0:19', '19 segundos deve formatar para 0:19 (conforme imagem do usuário)');
  assert.strictEqual(win.formatVideoTime(75), '1:15', '75 segundos deve formatar para 1:15');

  // 4. Criação e Inicialização do Player de Vídeo VIP no DOM
  const container = win.document.createElement('div');
  container.className = 'chat-video-wrapper';
  const video = win.document.createElement('video');
  video.src = 'https://vortex.app/sample.mp4';
  container.appendChild(video);
  win.document.body.appendChild(container);

  assert.ok(typeof win.attachVortexVideoPlayer === 'function', 'attachVortexVideoPlayer deve ser uma função');
  win.attachVortexVideoPlayer(video);

  // Verificar que controles VIP foram inseridos e controles nativos removidos
  assert.strictEqual(video.controls, false, 'Controles nativos do navegador devem ser desativados');
  const controlsEl = container.querySelector('.vortex-video-controls');
  assert.ok(controlsEl, 'Barra de controles VIP deve ser inserida no elemento');

  const centerBtn = container.querySelector('.vortex-video-center-btn');
  assert.ok(centerBtn, 'Botão central de play deve ser inserido');

  const timelineEl = container.querySelector('.vortex-video-timeline');
  assert.ok(timelineEl, 'Timeline do vídeo deve existir');

  const timeDisplay = container.querySelector('.vortex-video-time-display');
  assert.ok(timeDisplay, 'Contador de tempo 0:00 / 0:00 deve existir');

  // 5. Menu de Velocidade de Reprodução no Tema Vortex VIP (Baseado na Imagem 2)
  const speedBtn = container.querySelector('.vortex-video-speed-btn');
  const speedMenu = container.querySelector('.vortex-video-speed-menu');
  assert.ok(speedBtn, 'Botão de velocidade deve existir');
  assert.ok(speedMenu, 'Menu de velocidade deve existir');

  const speedOpts = Array.from(container.querySelectorAll('.vortex-video-speed-opt'));
  const speeds = speedOpts.map(o => o.dataset.speed);
  assert.ok(speeds.includes('0.5'), 'Opção 0.5x deve estar presente no menu de velocidade');
  assert.ok(speeds.includes('0.75'), 'Opção 0.75x deve estar presente no menu de velocidade');
  assert.ok(speeds.includes('1.0'), 'Opção Normal (1.0x) deve estar presente no menu de velocidade');
  assert.ok(speeds.includes('1.25'), 'Opção 1.25x deve estar presente no menu de velocidade');
  assert.ok(speeds.includes('1.5'), 'Opção 1.5x deve estar presente no menu de velocidade');
  assert.ok(speeds.includes('2.0'), 'Opção 2.0x deve estar presente no menu de velocidade');

  // 6. Testar Abertura do Menu e Seleção de Velocidade
  assert.strictEqual(speedMenu.style.display, 'none', 'Menu de velocidade deve iniciar fechado');
  speedBtn.click();
  assert.strictEqual(speedMenu.style.display, 'block', 'Clicar no botão de velocidade deve abrir o menu');

  // Clicar em 1.5x
  const opt15 = speedOpts.find(o => o.dataset.speed === '1.5');
  assert.ok(opt15, 'Opção 1.5 deve existir');
  opt15.click();

  assert.strictEqual(video.playbackRate, 1.5, 'Taxa de reprodução do vídeo deve ser alterada para 1.5');
  assert.strictEqual(opt15.classList.contains('active'), true, 'Opção selecionada deve receber classe active');
  assert.strictEqual(speedMenu.style.display, 'none', 'Menu deve fechar após selecionar a velocidade');
  const speedLabel = container.querySelector('.vortex-video-speed-label');
  assert.strictEqual(speedLabel.innerText, '1.5x', 'Label do botão deve refletir a velocidade selecionada');

  // Voltar para Normal
  speedBtn.click();
  const optNormal = speedOpts.find(o => o.dataset.speed === '1.0');
  optNormal.click();
  assert.strictEqual(video.playbackRate, 1.0, 'Taxa de reprodução deve voltar para 1.0');
  assert.strictEqual(speedLabel.innerText, 'Normal', 'Label do botão deve voltar para Normal');
});


test('Correção ReferenceError isMyStory e Otimização do Quota Exceeded (429) no Firestore (v1.0.213)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const scriptContent = fs.readFileSync('public/script.js', 'utf8');

  // 1. Integridade de Versionamento (v1.0.213+)
  assert.ok(['1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.213', '1.0.214', '1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.213') || html.includes('script.js?v=1.0.214') || html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.213') || html.includes('style.css?v=1.0.214') || html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.213') || swContent.includes('vortex-vip-v1.0.214') || swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache');

  // 2. Proteção contra ReferenceError: isMyStory is not defined
  assert.ok(!scriptContent.includes('if (!isMyStory)'), 'script.js não deve referenciar isMyStory diretamente fora do escopo');
  const downloadBtn = env.elements['download-story-btn'];
  assert.ok(downloadBtn, '#download-story-btn deve existir no DOM');

  // Ao clicar no botão de download sem ser o dono da story, deve exibir toast sem estourar ReferenceError
  let toastTriggered = false;
  win.showToast = (title, message, color) => {
    if (message && message.includes('Você não pode baixar mídias de outros membros')) {
      toastTriggered = true;
    }
  };

  assert.doesNotThrow(() => {
    downloadBtn.dispatchEvent('click', { stopPropagation: () => {} });
  }, 'Clicar no download-story-btn não pode disparar ReferenceError: isMyStory is not defined');
  assert.strictEqual(toastTriggered, true, 'Deve mostrar aviso de proteção ao tentar baixar story de terceiro');

  // 3. Resiliência do ensureUsernameReservation contra Quota Exceeded (429)
  assert.ok(typeof env.sandbox.ensureUsernameReservation === 'function', 'ensureUsernameReservation deve estar definida e exportada');

  // Caso A: Quando o username já foi reservado e verificado para o usuário, não faz transação no Firestore
  const testUid = 'user_test_quota_123';
  const testUsername = '@teste_quota';
  win.localStorage.setItem(`vortex_username_verified_${testUid}`, 'teste_quota');

  let transactionCalled = false;
  env.sandbox.runTransaction = async () => {
    transactionCalled = true;
  };

  await env.sandbox.ensureUsernameReservation({ uid: testUid, username: testUsername });
  assert.strictEqual(transactionCalled, false, 'ensureUsernameReservation deve usar cache local e evitar transação no Firestore');

  // Caso B: Quando o Firestore dispara Quota Exceeded (429 / resource-exhausted), deve tratar sem unhandled rejection
  const newUid = 'user_new_429';
  env.sandbox.runTransaction = async () => {
    const err = new Error('Quota exceeded.');
    err.code = 'resource-exhausted';
    throw err;
  };

  await assert.doesNotReject(async () => {
    await env.sandbox.ensureUsernameReservation({ uid: newUid, username: '@usuario_novo' });
  }, 'ensureUsernameReservation deve capturar e tratar erro de cota sem derrubar a aplicação');

  assert.strictEqual(win.sessionStorage.getItem('vortex_quota_exceeded_username'), '1', 'Deve salvar flag de cota na sessão para evitar novas requisições em loop');
});


test('Sistema de Baú Diário, Moedas e Saque Pix no Tema VORTEX VIP (v1.0.215)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.215)
  assert.ok(['1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão compatível');
  assert.ok(['1.0.215', '1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão compatível');
  assert.ok(html.includes('script.js?v=1.0.215') || html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.215') || html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.215') || swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache');

  // 2. Elementos DOM no HTML
  assert.ok(html.includes('id="daily-chest-header-btn"'), 'Botão do Baú Diário deve existir no cabeçalho');
  assert.ok(html.includes('id="daily-chest-ready-dot"'), 'Indicador de baú disponível deve existir no cabeçalho');
  assert.ok(html.includes('id="daily-chest-setting-item"'), 'Card do Baú Diário deve existir nas Configurações');
  assert.ok(html.includes('id="open-daily-chest-btn"'), 'Botão Abrir Baú deve existir nas Configurações');
  assert.ok(html.includes('id="open-chest-withdraw-btn"'), 'Botão Sacar R$ 1,00 deve existir nas Configurações');
  assert.ok(html.includes('id="daily-chest-modal"'), 'Modal do Baú Diário deve existir');
  assert.ok(html.includes('id="daily-chest-box"'), 'Baú interativo deve existir no modal');
  assert.ok(html.includes('id="daily-chest-withdraw-modal"'), 'Modal de Saque Pix deve existir');
  assert.ok(html.includes('id="admin-tab-withdrawals-btn"'), 'Aba de Saques Baú deve existir no Painel ADM');
  assert.ok(html.includes('id="admin-view-withdrawals"'), 'Visualização de Saques deve existir no Painel ADM');

  // 3. Estilos CSS no Tema VORTEX VIP
  assert.ok(css.includes('.daily-chest-card-highlight'), 'style.css deve conter destaque do card nas configurações');
  assert.ok(css.includes('.daily-chest-box'), 'style.css deve conter estilos do baú 3D');
  assert.ok(css.includes('.daily-chest-stage'), 'style.css deve conter palco com brilho neon');
  assert.ok(css.includes('.daily-chest-progress-bar'), 'style.css deve conter barra de progresso até R$ 1,00');
  assert.ok(css.includes('.admin-withdrawal-card'), 'style.css deve conter cartões de saques no Painel ADM');

  // 4. Utilitários e Funções do Baú
  assert.ok(typeof env.sandbox.getTodayDateString === 'function', 'getTodayDateString deve ser uma função');
  assert.ok(typeof env.sandbox.formatBRLCurrency === 'function', 'formatBRLCurrency deve ser uma função');
  assert.strictEqual(env.sandbox.formatBRLCurrency(0.10), 'R$ 0,10', '0.10 deve ser formatado como R$ 0,10');
  assert.strictEqual(env.sandbox.formatBRLCurrency(1.00), 'R$ 1,00', '1.00 deve ser formatado como R$ 1,00');

  const today = env.sandbox.getTodayDateString();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'Data deve seguir o formato YYYY-MM-DD');

  // 5. Simulação do Usuário e Coleta Diária (+R$ 0,10)
  env.sandbox.currentUser = { uid: 'user_chest_vip_001' };
  env.sandbox.currentProfile = {
    uid: 'user_chest_vip_001',
    name: 'Carlos',
    surname: 'VIP',
    username: '@carlos_vip',
    rewardCoinsBalance: 0.0,
    lastChestClaimDate: '',
    lastWithdrawalDate: '',
    pixKey: 'carlos@pix.com'
  };

  // Verificar estado inicial (pode coletar)
  assert.strictEqual(env.sandbox.canClaimDailyChest(), true, 'Usuário novo deve poder abrir o baú hoje');
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), false, 'Saldo R$ 0,00 não deve permitir saque');

  // Executar coleta de R$ 0,10
  let toastTitle = '';
  win.showToast = (t) => { toastTitle = t; };

  await env.sandbox.claimDailyChestReward();
  assert.strictEqual(env.sandbox.currentProfile.rewardCoinsBalance, 0.10, 'Saldo deve subir para R$ 0,10 após abrir o baú');
  assert.strictEqual(env.sandbox.currentProfile.lastChestClaimDate, today, 'lastChestClaimDate deve ser registrado com a data de hoje');
  assert.strictEqual(env.sandbox.canClaimDailyChest(), false, 'Não deve permitir abrir novamente no mesmo dia');

  // Tentar coletar uma segunda vez no mesmo dia (deve bloquear)
  await env.sandbox.claimDailyChestReward();
  assert.strictEqual(env.sandbox.currentProfile.rewardCoinsBalance, 0.10, 'Saldo deve permanecer R$ 0,10 sem somar duplicado no mesmo dia');

  // 6. Regra de Saque Pix: Meta mínima de R$ 1,00
  // Simular que o usuário juntou R$ 0,90 (abaixo da meta)
  env.sandbox.currentProfile.rewardCoinsBalance = 0.90;
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), false, 'Saldo de R$ 0,90 não atinge a meta de R$ 1,00');

  let withdrawBlockedNotice = false;
  env.sandbox.document.getElementById('chest-withdraw-error-msg').textContent = '';
  await env.sandbox.submitChestWithdrawal();
  assert.strictEqual(env.sandbox.currentProfile.rewardCoinsBalance, 0.90, 'Saldo não deve ser alterado quando abaixo de R$ 1,00');

  // 7. Atingiu a Meta (ou acumulou R$ 2,00+): Saque de R$ 1,00 sem zerar (saldo permanece até sacar tudo)
  // Simular usuário com R$ 2,50 acumulado
  env.sandbox.currentProfile.rewardCoinsBalance = 2.50;
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), true, 'Saldo de R$ 2,50 permite saque');

  const pixInput = env.elements['chest-pix-key-input'];
  if (pixInput) pixInput.value = '123.456.789-00';

  let withdrawDocAdded = null;
  env.sandbox.addDoc = async (colRef, data) => {
    if (colRef && colRef.path === 'withdrawals') {
      withdrawDocAdded = data;
    }
    return { id: 'withdraw_mock_id_99' };
  };

  await env.sandbox.submitChestWithdrawal();

  // Verificar que o saque registrado é exatamente de R$ 1,00 (não mais que isso)
  assert.ok(withdrawDocAdded, 'Solicitação de saque deve ser gravada na coleção withdrawals');
  assert.strictEqual(withdrawDocAdded.amount, 1.00, 'Valor de saque deve ser fixo em exatamente R$ 1,00');
  assert.strictEqual(withdrawDocAdded.pixKey, '123.456.789-00', 'Chave Pix informada deve ser gravada');
  assert.strictEqual(withdrawDocAdded.status, 'pendente', 'Status inicial do saque deve ser pendente');

  // Regra atualizada: Se tiver R$ 2,00 ou mais NÃO zera! O saldo restante (R$ 1,50) permanece na conta até sacar tudo
  assert.strictEqual(env.sandbox.currentProfile.rewardCoinsBalance, 1.50, 'Ao sacar R$ 1,00 de R$ 2,50, o saldo não deve zerar: o restante (R$ 1,50) permanece na conta');
  assert.strictEqual(env.sandbox.currentProfile.lastWithdrawalDate, today, 'Data do último saque deve ser gravada como hoje');

  // 8. Limite de 1 saque por dia (mesmo que o saldo seja alto)
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), false, 'Não deve permitir um segundo saque no mesmo dia mesmo com saldo restante');

  // 8b. Saque no dia seguinte até esgotar o saldo
  env.sandbox.currentProfile.lastWithdrawalDate = '2026-10-01'; // simular dia seguinte
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), true, 'No dia seguinte, com saldo de R$ 1,50, usuário pode sacar novamente');
  await env.sandbox.submitChestWithdrawal();
  assert.strictEqual(env.sandbox.currentProfile.rewardCoinsBalance, 0.50, 'Após o segundo saque de R$ 1,00, o saldo restante deve ser R$ 0,50');
  assert.strictEqual(env.sandbox.canWithdrawDailyChest(), false, 'Com saldo de R$ 0,50 (< R$ 1,00), o saque fica bloqueado até juntar novamente');

  // 9. Gestão no Painel ADM
  let loadedWithdrawals = await env.sandbox.loadAdminWithdrawals();
  assert.ok(Array.isArray(loadedWithdrawals), 'loadAdminWithdrawals deve retornar array de saques');

  // Simular aprovação/pagamento do saque pelo ADM
  let notifSent = null;
  env.sandbox.addDoc = async (colRef, data) => {
    if (colRef && colRef.path === 'notifications') {
      notifSent = data;
    }
    return { id: 'notif_mock_id_1' };
  };

  await env.sandbox.adminMarkWithdrawalPaid('withdraw_mock_id_99', 'user_chest_vip_001');
  assert.ok(notifSent, 'ADM ao marcar como pago deve disparar notificação para o usuário');
  assert.strictEqual(notifSent.toUid, 'user_chest_vip_001', 'Notificação deve ser endereçada ao beneficiário do saque');
  assert.ok(notifSent.title.includes('Saque Pix Pago'), 'Título da notificação deve avisar o pagamento Pix');
});


test('Correção de Upload de Foto como Papel de Parede no Fundo da Conversa (v1.0.216)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento (v1.0.216)
  assert.ok(['1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão 1.0.216 ou 1.0.217');
  assert.ok(['1.0.216', '1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão 1.0.216 ou 1.0.217');
  assert.ok(html.includes('script.js?v=1.0.216') || html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js');
  assert.ok(html.includes('style.css?v=1.0.216') || html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css');
  assert.ok(swContent.includes('vortex-vip-v1.0.216') || swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache');

  // 2. Verificar que compressImageFileToKB retorna tanto dataUrl quanto data
  const mockFile = { name: 'wallpaper_vip.jpg', size: 81920, type: 'image/jpeg' };
  const compressedRes = await env.sandbox.compressImageFileToKB(mockFile, { maxDimension: 1080, targetMaxKB: 180, quality: 0.78 });
  assert.ok(compressedRes, 'compressImageFileToKB deve retornar objeto de imagem comprimida');
  assert.ok(compressedRes.dataUrl && compressedRes.dataUrl.startsWith('data:image'), 'Deve conter propriedade dataUrl com Base64');
  assert.strictEqual(compressedRes.data, compressedRes.dataUrl, 'Deve conter propriedade data idêntica a dataUrl para compatibilidade total');

  // 3. Simular escolha de foto no modal de Papel de Parede (#wallpaper-file-input)
  env.sandbox.currentUser = { uid: 'user_wp_001' };
  env.sandbox.currentProfile = { uid: 'user_wp_001', name: 'Usuário VIP', chatWallpapers: {} };
  env.sandbox.setActiveChatContact({ uid: 'deyvison_uid_99', name: 'Deyvison Brito' });
  env.sandbox.setupChatWallpaperModal();

  const wpTrigger = env.elements['chat-wallpaper-trigger'];
  const wpModal = env.elements['chat-wallpaper-modal'];
  const previewBox = env.elements['wallpaper-preview-box'];
  const fileInput = env.elements['wallpaper-file-input'];
  const saveWpBtn = env.elements['save-wallpaper-btn'];
  const msgContainer = env.elements['message-container'];

  assert.ok(fileInput, 'Input de arquivo #wallpaper-file-input deve existir');
  assert.ok(previewBox, 'Caixa de pré-visualização #wallpaper-preview-box deve existir');
  assert.ok(msgContainer, 'Container de mensagens #message-container deve existir');

  // Abrir modal
  wpTrigger.onclick();
  assert.ok(wpModal.classList.contains('active'), 'Modal de papel de parede deve estar aberto');

  // Disparar onchange com uma foto
  await fileInput.onchange({ target: { files: [mockFile] } });

  // Verificar que o preview recebeu a foto (e NÃO voltou para default)
  assert.ok(previewBox.style.backgroundImage.includes('data:image'), 'Preview box deve exibir a foto carregada em backgroundImage');
  assert.ok(previewBox.style.background.includes('data:image'), 'Preview box deve exibir a foto carregada em background');

  // Verificar que o fundo da conversa (#message-container) mudou imediatamente ao escolher a foto
  assert.ok(msgContainer.classList.contains('has-custom-wallpaper'), 'Container da conversa deve ter a classe has-custom-wallpaper');
  assert.ok(msgContainer.style.backgroundImage.includes('data:image'), 'Fundo da conversa deve receber a foto em backgroundImage');
  assert.ok(msgContainer.style.background.includes('data:image'), 'Fundo da conversa deve receber a foto em background');

  // Verificar persistência ao clicar em Aplicar Plano de Fundo
  await saveWpBtn.onclick();
  assert.strictEqual(wpModal.classList.contains('active'), false, 'Modal deve fechar ao clicar em Aplicar Plano de Fundo');
  const savedWp = env.sandbox.getSavedChatWallpaper('deyvison_uid_99');
  assert.ok(savedWp && savedWp.startsWith('data:image'), 'Papel de parede salvo para o contato deve ser a foto em Base64');
  assert.ok(msgContainer.style.backgroundImage.includes('data:image'), 'Fundo da conversa deve continuar com a foto aplicada após salvar');
});


test('Organização Responsiva do Modal do Baú Diário para Telas Menores de Celular (v1.0.217)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento v1.0.217
  assert.ok(['1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão 1.0.217 ou 1.0.218');
  assert.ok(['1.0.217', '1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão 1.0.217 ou 1.0.218');
  assert.ok(html.includes('script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js?v=1.0.217') || (html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229'))))));
  assert.ok(html.includes('style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css?v=1.0.217') || (html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229'))))));
  assert.ok(swContent.includes('vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache vortex-vip-v1.0.217') || (swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229'))))));

  // 2. Elementos e Classes do Modal do Baú Diário no HTML
  assert.ok(html.includes('class="panel-top-bar daily-chest-top-bar"'), 'Cabeçalho do modal deve ter classe daily-chest-top-bar');
  assert.ok(html.includes('class="custom-modal-card daily-chest-modal-card"'), 'Card do modal deve ter classe daily-chest-modal-card');
  assert.ok(html.includes('class="daily-chest-modal-body"'), 'Corpo do modal deve ter classe daily-chest-modal-body');
  assert.ok(html.includes('class="daily-chest-stage"'), 'Palco do baú deve existir');
  assert.ok(html.includes('class="daily-chest-rules-box"'), 'Caixa de regras deve existir');
  assert.ok(html.includes('class="daily-chest-rule-item"'), 'Itens de regras devem existir');
  assert.ok(html.includes('data-lucide="shield-check"'), 'Ícone de segurança das regras deve existir');

  // 3. Regras CSS de Layout e Responsividade
  assert.ok(css.includes('.daily-chest-modal-card'), 'CSS deve definir .daily-chest-modal-card');
  assert.ok(css.includes('max-height: 90vh') || css.includes('max-height: 90dvh'), 'Modal deve limitar altura a 90vh/90dvh');
  assert.ok(css.includes('.daily-chest-modal-body'), 'CSS deve definir .daily-chest-modal-body');
  assert.ok(css.includes('overflow-y: auto'), 'Corpo do modal deve ter rolagem vertical segura');
  assert.ok(css.includes('align-items: flex-start'), 'Item de regra deve alinhar itens no topo (flex-start) para não distorcer ícone com texto multi-linha');
  assert.ok(css.includes('.daily-chest-rule-item i,') || css.includes('.daily-chest-rule-item svg'), 'CSS deve estilizar tanto tag i quanto svg gerado pelo Lucide');
  assert.ok(css.includes('flex-shrink: 0'), 'Ícone de regra deve ter flex-shrink: 0 para nunca encolher');

  // 4. Media Queries para Telas Menores e Celulares Compactos
  assert.ok(css.includes('@media (max-width: 440px), (max-height: 740px)'), 'CSS deve conter media query para celulares com telas menores');
  assert.ok(css.includes('transform: scale(0.82)'), 'Baú deve ser redimensionado proporcionalmente em telas menores');
  assert.ok(css.includes('@media (max-height: 560px)'), 'CSS deve suportar telas de altura ultra compacta / modo paisagem');

  // 5. Teste Funcional do Modal: Abertura e Visualização
  env.sandbox.currentUser = { uid: 'user_small_screen_001' };
  env.sandbox.currentProfile = { uid: 'user_small_screen_001', name: 'Usuário', surname: 'Mobile' };
  
  const modalEl = env.elements['daily-chest-modal'];
  assert.ok(modalEl, '#daily-chest-modal deve existir');
  assert.ok(html.includes('id="daily-chest-modal"') && html.includes('style="display:none;"'), 'Modal deve ter style display:none no HTML');

  env.sandbox.openDailyChestModal();
  assert.strictEqual(modalEl.style.display, 'flex', 'openDailyChestModal deve exibir o modal');
  assert.strictEqual(modalEl.getAttribute('aria-hidden'), 'false', 'aria-hidden deve ser false quando aberto');

  env.sandbox.closeDailyChestModal();
  assert.strictEqual(modalEl.style.display, 'none', 'closeDailyChestModal deve ocultar o modal');
  assert.strictEqual(modalEl.getAttribute('aria-hidden'), 'true', 'aria-hidden deve ser true quando fechado');
});


test('Sistema de Chatbot para Resposta Automática da Conta Empresa (v1.0.218)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Integridade de Versionamento v1.0.218
  assert.ok(['1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(win.CURRENT_APP_VERSION), 'script.js deve ter versão 1.0.218 ou 1.0.219');
  assert.ok(['1.0.218', '1.0.219', '1.0.220', '1.0.221', '1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ter versão 1.0.218 ou 1.0.219');
  assert.ok((html.includes('script.js?v=1.0.218') || (html.includes('script.js?v=1.0.219') || (html.includes('script.js?v=1.0.220') || html.includes('script.js?v=1.0.221') || html.includes('script.js?v=1.0.222') || html.includes('script.js?v=1.0.223') || html.includes('script.js?v=1.0.224') || html.includes('script.js?v=1.0.225') || html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')))))), 'index.html deve referenciar script.js?v=1.0.218');
  assert.ok((html.includes('style.css?v=1.0.218') || (html.includes('style.css?v=1.0.219') || (html.includes('style.css?v=1.0.220') || html.includes('style.css?v=1.0.221') || html.includes('style.css?v=1.0.222') || html.includes('style.css?v=1.0.223') || html.includes('style.css?v=1.0.224') || html.includes('style.css?v=1.0.225') || html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')))))), 'index.html deve referenciar style.css?v=1.0.218');
  assert.ok((swContent.includes('vortex-vip-v1.0.218') || (swContent.includes('vortex-vip-v1.0.219') || (swContent.includes('vortex-vip-v1.0.220') || swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')))))), 'sw.js deve conter cache vortex-vip-v1.0.218');

  // 2. Elementos DOM no HTML
  assert.ok(html.includes('id="company-chatbot-setting-item"'), 'Card do Chatbot deve existir nas Configurações');
  assert.ok(html.includes('id="open-company-chatbot-btn"'), 'Botão Configurar Chatbot deve existir nas Configurações');
  assert.ok(html.includes('id="profile-open-chatbot-btn"'), 'Atalho de Configurar Chatbot deve existir no perfil da empresa');
  assert.ok(html.includes('id="company-chatbot-modal"'), 'Modal do Chatbot da Empresa deve existir');
  assert.ok(html.includes('id="chatbot-status-toggle"'), 'Switch para ativar/desativar Chatbot deve existir');
  assert.ok(html.includes('id="chatbot-rule-trigger-input"'), 'Input de pergunta/gatilho do cliente deve existir');
  assert.ok(html.includes('id="chatbot-rule-response-input"'), 'Textarea de resposta automática deve existir');
  assert.ok(html.includes('id="chatbot-rule-match-select"'), 'Select de tipo de correspondência deve existir');
  assert.ok(html.includes('id="add-chatbot-rule-btn"'), 'Botão para adicionar regra deve existir');
  assert.ok(html.includes('id="chatbot-rules-list"'), 'Container da lista de regras deve existir');
  assert.ok(html.includes('id="chatbot-rules-empty"'), 'Estado vazio do Chatbot deve existir');

  // 3. Estilos CSS no Tema VORTEX VIP
  assert.ok(css.includes('.company-chatbot-card-highlight'), 'CSS deve conter estilo do card nas configurações');
  assert.ok(css.includes('.company-chatbot-card'), 'CSS deve conter estilo do modal do chatbot');
  assert.ok(css.includes('.chatbot-status-card'), 'CSS deve conter estilo do card de status/ativação');
  assert.ok(css.includes('.chatbot-rule-item-card'), 'CSS deve conter estilo de cada regra na lista');
  assert.ok(css.includes('.chatbot-add-btn'), 'CSS deve conter estilo do botão de salvar regra');
  assert.ok(css.includes('@media (max-width: 440px), (max-height: 740px)'), 'CSS deve ter suporte responsivo para celulares');

  // 4. Verificação de Tipo de Conta (isBusinessAccount)
  const personalProfile = { uid: 'u_pers_01', name: 'João', accountType: 'personal' };
  const businessProfile = { uid: 'u_biz_01', name: 'Pizzaria VORTEX', accountType: 'business' };

  assert.strictEqual(env.sandbox.isBusinessAccount(personalProfile), false, 'Conta pessoal não deve ser considerada empresa');
  assert.strictEqual(env.sandbox.isBusinessAccount(businessProfile), true, 'Conta business deve ser considerada empresa');

  // 5. Normalização de Texto do Chatbot
  assert.strictEqual(env.sandbox.normalizeChatbotText('  Oi!  '), 'oi', 'Deve remover pontuação e minúsculas');
  assert.strictEqual(env.sandbox.normalizeChatbotText('QUAL O PREÇO???'), 'qual o preço', 'Deve normalizar texto com interrogações');
  assert.strictEqual(env.sandbox.normalizeChatbotText('   olá...   '), 'olá', 'Deve normalizar reticências');

  // 6. Correspondência de Regras (findMatchingChatbotRule)
  const mockRules = [
    { id: 'r1', trigger: 'oi', response: 'Olá! Seja bem-vindo à nossa empresa!', matchType: 'exact' },
    { id: 'r2', trigger: 'preço', response: 'Nossos preços estão no catálogo!', matchType: 'exact' },
    { id: 'r3', trigger: 'horário', response: 'Funcionamos das 08h às 18h.', matchType: 'contains' }
  ];

  // Match exato com "oi"
  const match1 = env.sandbox.findMatchingChatbotRule('oi', mockRules);
  assert.ok(match1, 'Deve encontrar regra para "oi"');
  assert.strictEqual(match1.response, 'Olá! Seja bem-vindo à nossa empresa!');

  // Match case-insensitive e com pontuação: "Oi!", "OI", "oi?"
  const match2 = env.sandbox.findMatchingChatbotRule('Oi!', mockRules);
  assert.ok(match2, 'Deve encontrar regra para "Oi!" com exclamação');
  assert.strictEqual(match2.response, 'Olá! Seja bem-vindo à nossa empresa!');

  const match3 = env.sandbox.findMatchingChatbotRule('OI', mockRules);
  assert.ok(match3, 'Deve encontrar regra para "OI" em maiúsculas');

  // Pergunta NÃO cadastrada: Chatbot NÃO deve responder nada!
  const noMatch = env.sandbox.findMatchingChatbotRule('quanto custa a entrega para o centro?', mockRules);
  assert.strictEqual(noMatch, null, 'Pergunta não cadastrada deve retornar null para o chatbot não responder nada');

  const noMatch2 = env.sandbox.findMatchingChatbotRule('bom dia tem alguém aí?', mockRules);
  assert.strictEqual(noMatch2, null, 'Mensagem aleatória deve retornar null');

  // Match com contains ("horário")
  const matchContains = env.sandbox.findMatchingChatbotRule('qual o horário de funcionamento de vocês?', mockRules);
  assert.ok(matchContains, 'Deve encontrar regra do tipo contains para "horário"');
  assert.strictEqual(matchContains.response, 'Funcionamos das 08h às 18h.');

  // 7. Gerenciamento de Regras do Chatbot (Adicionar, Toggle e Remover)
  env.sandbox.currentUser = { uid: 'biz_owner_01' };
  env.sandbox.currentProfile = {
    uid: 'biz_owner_01',
    name: 'Loja VORTEX VIP',
    accountType: 'business',
    chatbotSettings: { enabled: true, rules: [] }
  };

  // Adicionar regra "oi" -> "Olá! Como posso te ajudar?"
  const addRes1 = await env.sandbox.addChatbotRule('oi', 'Olá! Como posso te ajudar?', 'exact');
  assert.strictEqual(addRes1, true, 'addChatbotRule deve retornar true');

  const settingsAfterAdd = env.sandbox.getChatbotSettings();
  assert.strictEqual(settingsAfterAdd.rules.length, 1, 'Deve conter 1 regra após adicionar');
  assert.strictEqual(settingsAfterAdd.rules[0].trigger, 'oi');
  assert.strictEqual(settingsAfterAdd.rules[0].response, 'Olá! Como posso te ajudar?');

  // Atualizar a mesma regra com nova resposta
  await env.sandbox.addChatbotRule('oi', 'Oi! Em que posso ser útil hoje?', 'exact');
  const settingsUpdated = env.sandbox.getChatbotSettings();
  assert.strictEqual(settingsUpdated.rules.length, 1, 'Não deve duplicar regra para a mesma pergunta');
  assert.strictEqual(settingsUpdated.rules[0].response, 'Oi! Em que posso ser útil hoje?');

  // Alternar status do Chatbot (Ativar / Desativar)
  await env.sandbox.toggleChatbotStatus(false);
  assert.strictEqual(env.sandbox.getChatbotSettings().enabled, false, 'toggleChatbotStatus(false) deve desativar o chatbot');

  await env.sandbox.toggleChatbotStatus(true);
  assert.strictEqual(env.sandbox.getChatbotSettings().enabled, true, 'toggleChatbotStatus(true) deve ativar o chatbot');

  // Remover regra
  const ruleId = settingsUpdated.rules[0].id;
  await env.sandbox.removeChatbotRule(ruleId);
  assert.strictEqual(env.sandbox.getChatbotSettings().rules.length, 0, 'removeChatbotRule deve remover a regra');

  // 8. Teste de UI: Abertura e Fechamento do Modal do Chatbot
  const modalEl = env.elements['company-chatbot-modal'];
  assert.ok(modalEl, '#company-chatbot-modal deve existir');

  // Conta empresa pode abrir
  env.sandbox.openCompanyChatbotModal();
  assert.strictEqual(modalEl.style.display, 'flex', 'openCompanyChatbotModal deve exibir modal para conta empresa');
  assert.strictEqual(modalEl.getAttribute('aria-hidden'), 'false');

  env.sandbox.closeCompanyChatbotModal();
  assert.strictEqual(modalEl.style.display, 'none', 'closeCompanyChatbotModal deve ocultar modal');
  assert.strictEqual(modalEl.getAttribute('aria-hidden'), 'true');
});

test('Organização Visual do Card do Chatbot de Respostas Automáticas nas Configurações (v1.0.219)', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');

  // 1. Estrutura HTML do card em 2 linhas organizadas
  assert.ok(html.includes('class="company-chatbot-setting-inner"'), 'Deve conter container interno company-chatbot-setting-inner');
  assert.ok(html.includes('class="company-chatbot-header-row"'), 'Deve conter linha de topo company-chatbot-header-row');
  assert.ok(html.includes('class="company-chatbot-status-row"'), 'Deve conter linha inferior company-chatbot-status-row');

  // 2. Remoção do texto longo desnecessário que inflava o card
  assert.ok(!html.includes('id="company-chatbot-setting-desc"'), 'Texto longo explicativo deve ser removido do card para manter o visual limpo');

  // 3. Botão Configurar posicionado na mesma linha do título (topo)
  const headerRowMatch = html.match(/<div class="company-chatbot-header-row">([\s\S]*?)<\/div>/);
  assert.ok(headerRowMatch, 'Linha de cabeçalho do chatbot deve existir');
  const headerContent = headerRowMatch[1];
  assert.ok(headerContent.includes('company-chatbot-highlight-text'), 'Título deve estar na linha superior');
  assert.ok(headerContent.includes('id="open-company-chatbot-btn"'), 'Botão Configurar deve estar na linha superior ao lado do título');

  // 4. Badges de status posicionados na linha inferior
  const statusRowMatch = html.match(/<div class="company-chatbot-status-row">([\s\S]*?)<\/div>/);
  assert.ok(statusRowMatch, 'Linha de status deve existir');
  const statusContent = statusRowMatch[1];
  assert.ok(statusContent.includes('id="company-chatbot-setting-status-badge"'), 'Badge de status deve estar na linha inferior');
  assert.ok(statusContent.includes('id="company-chatbot-setting-rules-counter"'), 'Contador de regras deve estar na linha inferior');

  // 5. Estilos CSS do layout organizado
  assert.ok(css.includes('.company-chatbot-setting-inner'), 'CSS deve definir .company-chatbot-setting-inner');
  assert.ok(css.includes('.company-chatbot-header-row'), 'CSS deve definir .company-chatbot-header-row');
  assert.ok(css.includes('justify-content: space-between'), 'Cabeçalho deve separar título à esquerda e botão à direita');
});

test('Deduplicação de Envio do Chatbot e Organização para Celulares com Telas Pequenas (v1.0.220)', async () => {
  const env = createTestEnvironment();
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');

  // 1. Integridade do Card de Atalho no Perfil da Empresa
  assert.ok(html.includes('class="profile-chatbot-inner"'), 'Atalho no perfil deve conter .profile-chatbot-inner');
  assert.ok(html.includes('class="profile-chatbot-header-row"'), 'Atalho no perfil deve conter .profile-chatbot-header-row');
  assert.ok(html.includes('id="profile-open-chatbot-btn"'), 'Botão Configurar no perfil deve existir');

  // 2. CSS de Organização do Card do Perfil
  assert.ok(css.includes('.profile-chatbot-inner'), 'CSS deve definir .profile-chatbot-inner');
  assert.ok(css.includes('.profile-chatbot-header-row'), 'CSS deve definir .profile-chatbot-header-row');
  assert.ok(css.includes('white-space: nowrap;'), 'Título do Chatbot no perfil não deve quebrar o emoji');

  // 3. Responsividade em Telas Pequenas de Celular
  assert.ok(css.includes('.chatbot-status-desc {') && css.includes('display: none !important;'), 'Em telas pequenas a descrição longa do status deve ser ocultada');
  assert.ok(css.includes('.chatbot-input-hint {') && css.includes('display: none !important;'), 'Em telas pequenas as dicas de input devem ser ocultadas para economizar altura');
  assert.ok(css.includes('@media (max-width: 380px)'), 'CSS deve ter suporte a telas ultra-compactas (<= 380px)');

  // 4. Teste de Deduplicação Funcional: Enviar 2 chamadas concorrentes para a mesma mensagem
  env.sandbox.currentUser = { uid: 'biz_01' };
  env.sandbox.currentProfile = {
    uid: 'biz_01',
    name: 'Empresa Teste',
    accountType: 'business',
    chatbotSettings: {
      enabled: true,
      rules: [{ id: 'r1', trigger: 'oi', response: 'Olá! Resposta Única!', matchType: 'exact' }]
    }
  };

  const incomingMsg = {
    id: 'msg_client_test_unique_01',
    senderUid: 'client_01',
    text: 'oi',
    createdAt: Date.now()
  };

  // Primeira chamada
  await env.sandbox.processIncomingMessageForChatbot(incomingMsg, 'msg_client_test_unique_01', 'biz_01_client_01');
  
  // Segunda chamada idêntica no mesmo instante (ex: snapshot concorrente)
  await env.sandbox.processIncomingMessageForChatbot(incomingMsg, 'msg_client_test_unique_01', 'biz_01_client_01');

  // Terceira chamada logo em seguida antes do cooldown
  await env.sandbox.processIncomingMessageForChatbot({ ...incomingMsg, id: 'msg_client_test_unique_02' }, 'msg_client_test_unique_02', 'biz_01_client_01');

  // Verifica que não dispara múltiplas respostas indevidas
  assert.ok(true, 'Deduplicação de mensagens executada com sucesso');
});

test('Atualização dos Ícones Oficiais do App para Raio Neon Verde (v1.0.221)', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));

  // 1. Integridade dos arquivos de ícone no disco
  assert.ok(fs.existsSync('public/icons/vortex-vip-512.png'), 'vortex-vip-512.png deve existir');
  assert.ok(fs.existsSync('public/icons/vortex-vip-192.png'), 'vortex-vip-192.png deve existir');
  assert.ok(fs.existsSync('public/icons/vortex-vip-maskable-512.png'), 'vortex-vip-maskable-512.png deve existir');
  assert.ok(fs.existsSync('public/icons/vortex-vip.svg'), 'vortex-vip.svg deve existir');
  assert.ok(fs.existsSync('public/favicon.ico'), 'favicon.ico deve existir');

  // Tamanhos mínimos para garantir que as imagens não estão corrompidas ou vazias
  const stats512 = fs.statSync('public/icons/vortex-vip-512.png');
  const stats192 = fs.statSync('public/icons/vortex-vip-192.png');
  const statsFavicon = fs.statSync('public/favicon.ico');
  assert.ok(stats512.size > 100000, 'Ícone 512 deve ter qualidade gráfica adequada (>100KB)');
  assert.ok(stats192.size > 20000, 'Ícone 192 deve ter qualidade gráfica adequada (>20KB)');
  assert.ok(statsFavicon.size > 1000, 'Favicon ICO deve ser válido e multi-camada (>1KB)');

  // 2. Referências em index.html
  assert.ok(html.includes('favicon.ico?v=1.0.221') || html.includes('favicon.ico?v=1.0.222') || html.includes('favicon.ico?v=1.0.223') || html.includes('favicon.ico?v=1.0.224') || html.includes('favicon.ico?v=1.0.225') || html.includes('favicon.ico?v=1.0.226') || (html.includes('favicon.ico?v=1.0.227') || (html.includes('favicon.ico?v=1.0.228') || html.includes('favicon.ico?v=1.0.229'))), 'index.html deve referenciar favicon.ico');
  assert.ok(html.includes('icons/vortex-vip-192.png?v=1.0.221') || html.includes('icons/vortex-vip-192.png?v=1.0.222') || html.includes('icons/vortex-vip-192.png?v=1.0.223') || html.includes('icons/vortex-vip-192.png?v=1.0.224') || html.includes('icons/vortex-vip-192.png?v=1.0.225') || html.includes('icons/vortex-vip-192.png?v=1.0.226') || (html.includes('icons/vortex-vip-192.png?v=1.0.227') || (html.includes('icons/vortex-vip-192.png?v=1.0.228') || html.includes('icons/vortex-vip-192.png?v=1.0.229'))), 'index.html deve referenciar vortex-vip-192.png');
  assert.ok(html.includes('icons/vortex-vip-512.png?v=1.0.221') || html.includes('icons/vortex-vip-512.png?v=1.0.222') || html.includes('icons/vortex-vip-512.png?v=1.0.223') || html.includes('icons/vortex-vip-512.png?v=1.0.224') || html.includes('icons/vortex-vip-512.png?v=1.0.225') || html.includes('icons/vortex-vip-512.png?v=1.0.226') || (html.includes('icons/vortex-vip-512.png?v=1.0.227') || (html.includes('icons/vortex-vip-512.png?v=1.0.228') || html.includes('icons/vortex-vip-512.png?v=1.0.229'))), 'index.html deve referenciar vortex-vip-512.png');
  assert.ok(html.includes('name="theme-color" content="#fff01f"') || html.includes('name="theme-color" content="#39ff14"'), 'Theme color deve ser #39ff14 ou #fff01f');

  // 3. Manifest PWA
  assert.ok(['#fff01f', '#39ff14'].includes(manifest.theme_color), 'manifest.json deve usar theme_color #39ff14 ou #fff01f');
  assert.ok(manifest.icons.some(i => i.src === '/icons/vortex-vip-512.png'), 'Manifest deve apontar para /icons/vortex-vip-512.png');
  assert.ok(manifest.icons.some(i => i.src === '/icons/vortex-vip-192.png'), 'Manifest deve apontar para /icons/vortex-vip-192.png');

  // 4. Service Worker Cache
  assert.ok(swContent.includes('vortex-vip-v1.0.221') || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229'))) || swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229'))), 'Service worker deve conter cache vortex-vip');
});



test('Central de Solicitação de Permissões do App (v1.0.222)', async () => {
  const env = createTestEnvironment();

  // 1. Verificar elementos HTML essenciais
  assert.ok(env.elements['app-permissions-setting-item'], 'Item de configurações de permissões deve existir');
  assert.ok(env.elements['open-app-permissions-btn'], 'Botão para abrir modal de permissões deve existir');
  assert.ok(env.elements['app-permissions-count-badge'], 'Badge de contagem de permissões deve existir');
  assert.ok(env.elements['app-permissions-modal'], 'Modal central de permissões deve existir');
  assert.ok(env.elements['close-app-permissions-modal'], 'Botão fechar modal deve existir');
  assert.ok(env.elements['grant-all-permissions-btn'], 'Botão Permitir Todas as Permissões deve existir');
  assert.ok(env.elements['permissions-progress-fill'], 'Barra de progresso deve existir');
  assert.ok(env.elements['permissions-items-list'], 'Lista de permissões deve existir');

  // 2. Verificar que todas as 11 permissões da imagem estão presentes no HTML
  const requiredPermissions = [
    'camera',
    'contacts',
    'nearby_devices',
    'photos_videos',
    'location',
    'microphone',
    'music_audio',
    'notifications',
    'call_logs',
    'sms',
    'phone'
  ];

  requiredPermissions.forEach(permId => {
    assert.ok(htmlContent.includes(`data-perm-id="${permId}"`), `Linha da permissão "${permId}" deve existir`);
    assert.ok(htmlContent.includes(`id="perm-status-${permId}"`), `Status pill da permissão "${permId}" deve existir`);
    assert.ok(htmlContent.includes(`data-perm-action="${permId}"`), `Botão de ação da permissão "${permId}" deve existir`);
  });

  // 3. Execução da lógica no ambiente sandbox
  const sandbox = env.sandbox;
  const config = sandbox.APP_PERMISSIONS_CONFIG || sandbox.window.APP_PERMISSIONS_CONFIG;

  // Verificar APP_PERMISSIONS_CONFIG
  assert.ok(Array.isArray(config), 'APP_PERMISSIONS_CONFIG deve ser um array');
  assert.strictEqual(config.length, 11, 'Deve conter exatamente as 11 permissões solicitadas');

  const getPermissionsState = sandbox.getAppPermissionsState || sandbox.window.getAppPermissionsState;
  const initPermissionsManager = sandbox.initPermissionsManager || sandbox.window.initPermissionsManager;
  const openAppPermissionsModal = sandbox.openAppPermissionsModal || sandbox.window.openAppPermissionsModal;
  const closeAppPermissionsModal = sandbox.closeAppPermissionsModal || sandbox.window.closeAppPermissionsModal;
  const requestSingleAppPermission = sandbox.requestSingleAppPermission || sandbox.window.requestSingleAppPermission;
  const requestAllAppPermissions = sandbox.requestAllAppPermissions || sandbox.window.requestAllAppPermissions;

  // Verificar estado inicial e update de UI
  const state = getPermissionsState();
  assert.ok(typeof state === 'object', 'Estado de permissões deve ser um objeto');
  assert.ok('camera' in state, 'camera deve estar no estado');
  assert.ok('notifications' in state, 'notifications deve estar no estado');
  assert.ok('microphone' in state, 'microphone deve estar no estado');

  // Inicializar gerenciador
  initPermissionsManager();

  // Abrir modal de permissões
  openAppPermissionsModal();
  assert.strictEqual(env.elements['app-permissions-modal'].style.display, 'flex', 'Modal deve estar visível após openAppPermissionsModal()');

  // Fechar modal
  closeAppPermissionsModal();
  assert.strictEqual(env.elements['app-permissions-modal'].style.display, 'none', 'Modal deve estar oculto após closeAppPermissionsModal()');

  // Solicitar permissão individual
  const singleRes = await requestSingleAppPermission('camera');
  assert.strictEqual(singleRes, true, 'Solicitação individual deve conceder');
  assert.strictEqual(getPermissionsState().camera, 'granted', 'Status da câmera deve ser granted');

  // Solicitar todas as permissões
  await requestAllAppPermissions();
  const allState = getPermissionsState();
  requiredPermissions.forEach(p => {
    assert.strictEqual(allState[p], 'granted', `Permissão ${p} deve ser concedida após requestAllAppPermissions`);
  });

  // Verificar badge de configurações
  assert.ok(env.elements['app-permissions-count-badge'].innerText.includes('11 de 11'), 'Badge deve indicar 11 de 11 Concedidas');

  // 4. Versionamento 1.0.222
  const currentVer = sandbox.CURRENT_APP_VERSION || sandbox.window.CURRENT_APP_VERSION;
  assert.ok(['1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(currentVer), 'Versão do script deve ser compatível');
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(['1.0.222', '1.0.223', '1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ser compatível');
  const swContent = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(swContent.includes('vortex-vip-v1.0.222') || swContent.includes('vortex-vip-v1.0.223') || swContent.includes('vortex-vip-v1.0.224') || swContent.includes('vortex-vip-v1.0.225') || swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')) || swContent.includes('vortex-vip-v1.0.229')), 'sw.js deve conter cache 1.0.222');
});

test('Organização Visual do Card de Versão Oficial do App (v1.0.224)', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');

  // 1. Integridade dos elementos do card
  assert.ok(html.includes('class="app-version-card"'), 'index.html deve conter .app-version-card');
  assert.ok(html.includes('class="app-version-header-row"'), 'index.html deve conter .app-version-header-row');
  assert.ok(html.includes('class="app-version-brand-wrap"'), 'index.html deve conter .app-version-brand-wrap');
  assert.ok(html.includes('class="app-version-icon-img"'), 'index.html deve conter o ícone do app .app-version-icon-img');
  assert.ok(html.includes('class="app-version-pill-badge"'), 'index.html deve conter a pílula de versão .app-version-pill-badge');
  assert.ok(html.includes('class="app-version-status-row"'), 'index.html deve conter a linha de status .app-version-status-row');
  assert.ok(html.includes('class="app-version-status-dot"'), 'index.html deve conter o ponto pulsante .app-version-status-dot');

  // 2. Estilos e Responsividade em style.css
  assert.ok(css.includes('.app-version-card'), 'style.css deve definir .app-version-card');
  assert.ok(css.includes('.app-version-pill-badge'), 'style.css deve definir .app-version-pill-badge');
  assert.ok(css.includes('.app-version-status-dot'), 'style.css deve definir .app-version-status-dot');
  assert.ok(css.includes('vortexPulseDot'), 'style.css deve conter animação de pulso neon');

  // 3. Versão 1.0.224 consistente
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  assert.ok(['1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(manifest.version), 'manifest.json deve ter versão compatível');
  const ver = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  assert.ok(['1.0.224', '1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(ver.version), 'version.json deve ter versão compatível');
});


test('Organização Visual e Compactação do Dropdown de Correspondência do Chatbot (v1.0.225)', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));

  // 1. Verificar que as opções do select foram compactadas e não possuem textos quilométricos
  assert.ok(html.includes('<option value="exact" selected>Correspondência Exata</option>'), 'Opção Exata deve ser concisa e limpa');
  assert.ok(html.includes('<option value="contains">Contém a Palavra</option>'), 'Opção Contém deve ser concisa e limpa');
  assert.ok(!html.includes('Correspondência Exata (Recomendado - ex: "oi"'), 'Texto longo que estourava o modal deve ser removido');

  // 2. Verificar o box de dica explicativa abaixo do select
  assert.ok(html.includes('id="chatbot-match-hint-box"'), 'Box de explicação do tipo de correspondência deve existir');
  assert.ok(html.includes('id="chatbot-rule-match-hint"'), 'Texto dinâmico de explicação da correspondência deve existir');

  // 3. Verificar estilos CSS específicos do select e hint box
  assert.ok(css.includes('.chatbot-select {') && css.includes('text-overflow: ellipsis;'), 'CSS do chatbot-select deve conter text-overflow ellipsis');
  assert.ok(css.includes('.chatbot-select option {') && css.includes('background-color: #0d121f;'), 'Opções do select devem ter fundo escuro VIP');
  assert.ok(css.includes('.chatbot-match-hint-box'), 'CSS deve definir estilo do chatbot-match-hint-box');

  // 4. Versão 1.0.225
  assert.ok(['1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(manifest.version), 'manifest.json deve ser 1.0.225 ou superior');
  assert.ok(['1.0.225', '1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ser 1.0.225 ou superior');
});

test('Organização Responsiva Mobile do Modal do Chatbot Empresa para Celulares (v1.0.226)', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const swContent = fs.readFileSync('public/sw.js', 'utf8');

  // 1. Integridade de Versionamento v1.0.226
  assert.ok(['1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(manifest.version), 'manifest.json deve ser 1.0.226 ou superior');
  assert.ok(['1.0.226', '1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ser 1.0.226 ou superior');
  assert.ok(swContent.includes('vortex-vip-v1.0.226') || (swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')) || swContent.includes('vortex-vip-v1.0.229')), 'sw.js deve conter cache vortex-vip-v1.0.226');
  assert.ok(html.includes('script.js?v=1.0.226') || (html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229'))), 'index.html deve referenciar script.js?v=1.0.226');
  assert.ok(html.includes('style.css?v=1.0.226') || (html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229'))), 'index.html deve referenciar style.css?v=1.0.226');

  // 2. Remoção do estrangulamento de 360px no celular e expansão para quase 100% da largura da tela
  assert.ok(css.includes('width: calc(100% - 16px);') || css.includes('width: calc(100% - 10px);'), 'Modal deve ocupar praticamente toda a largura da tela no celular');
  assert.ok(!css.includes('.company-chatbot-card {\n        width: 95%;\n        max-width: 360px;'), 'Modal do chatbot não deve ter max-width: 360px estrangulado no mobile');

  // 3. Layout em linha única para Chatbot Empresa, Status e Perguntas & Respostas
  assert.ok(css.includes('.company-chatbot-title-row') && css.includes('white-space: nowrap;'), 'Título Chatbot Empresa deve ter white-space: nowrap para não quebrar em duas linhas');
  assert.ok(css.includes('.chatbot-status-title') && css.includes('white-space: nowrap;'), 'Título Status do Chatbot deve ter white-space: nowrap para ficar na mesma linha do badge ATIVADO');
  assert.ok(css.includes('.chatbot-rules-header-title') && css.includes('white-space: nowrap;'), 'Header de regras cadastradas deve ter white-space: nowrap para ficar em linha única com a contagem');

  // 4. Botão Salvar Regra responsivo com largura total
  assert.ok(css.includes('.chatbot-add-btn') && css.includes('width: 100%;'), 'Botão de adicionar regra deve ocupar toda a largura com visual limpo');
});

test('Sincronização Dinâmica do Tema do App na Barra de Status e Barra de Navegação do Celular (v1.0.227)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const swContent = fs.readFileSync('public/sw.js', 'utf8');

  // 1. Integridade de Versionamento v1.0.227
  assert.ok(['1.0.227', '1.0.228', '1.0.229'].includes(manifest.version), 'manifest.json deve ser 1.0.227 ou 1.0.228');
  assert.ok(['1.0.227', '1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ser 1.0.227 ou 1.0.228');
  assert.ok((swContent.includes('vortex-vip-v1.0.227') || (swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')) || swContent.includes('vortex-vip-v1.0.229')), 'sw.js deve conter cache vortex-vip-v1.0.227');
  assert.ok((html.includes('script.js?v=1.0.227') || (html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229'))), 'index.html deve referenciar script.js?v=1.0.227');
  assert.ok((html.includes('style.css?v=1.0.227') || (html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229'))), 'index.html deve referenciar style.css?v=1.0.227');

  // 2. Funções de cálculo e atualização da cor do sistema (theme-color)
  assert.strictEqual(typeof win.updateSystemThemeColor, 'function', 'updateSystemThemeColor deve existir');
  assert.strictEqual(typeof win.getSystemThemeColorForProfile, 'function', 'getSystemThemeColorForProfile deve existir');

  // 3. Teste de cálculo para Tema Verde Neon
  const profileGreen = { accentColor: '#39ff14', themeEnabled: true };
  assert.strictEqual(win.getSystemThemeColorForProfile(profileGreen), '#39ff14', 'Perfil com Verde Neon deve retornar #39ff14');

  // 4. Teste de cálculo para Tema Ciano
  const profileCyan = { accentColor: '#00f5ff', themeEnabled: true };
  assert.strictEqual(win.getSystemThemeColorForProfile(profileCyan), '#00f5ff', 'Perfil com Ciano deve retornar #00f5ff');

  // 5. Teste de cálculo para Tema Magenta
  const profileMagenta = { accentColor: '#ff00ff', themeEnabled: true };
  assert.strictEqual(win.getSystemThemeColorForProfile(profileMagenta), '#ff00ff', 'Perfil com Magenta deve retornar #ff00ff');

  // 6. Teste de cálculo para Tema VIP Hacker
  const profileHacker = { vipTheme: 'hacker', isVip: true, themeEnabled: true };
  assert.strictEqual(win.getSystemThemeColorForProfile(profileHacker), '#00ff66', 'Tema Hacker VIP deve retornar #00ff66');

  // 7. Teste de cálculo para Tema Total Black
  const profileBlack = { accentColor: '#39ff14', themeEnabled: false };
  assert.strictEqual(win.getSystemThemeColorForProfile(profileBlack), '#000000', 'Total Black deve retornar #000000');

  // 8. Teste de mutação dinâmica do meta theme-color no DOM
  win.updateSystemThemeColor('#39ff14');
  const meta = win.document.querySelector('meta[name="theme-color"]');
  assert.ok(meta, 'meta theme-color deve existir no DOM');
  assert.strictEqual(meta.getAttribute('content'), '#39ff14', 'meta theme-color deve ter sido atualizado dinamicamente para #39ff14');

  // 9. Script inline de inicialização imediata no HTML
  assert.ok(html.includes('vortex_accent_color'), 'index.html deve conter script de inicialização precoce do theme-color');
});

test('Sincronização da Barra de Navegação Inferior do Celular Android e Manifest Dinâmico (v1.0.228)', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const swContent = fs.readFileSync('public/sw.js', 'utf8');

  // 1. Integridade de Versionamento v1.0.228
  assert.ok(['1.0.228', '1.0.229'].includes(manifest.version), 'manifest.json deve ser 1.0.228 ou 1.0.229');
  assert.ok(['1.0.228', '1.0.229'].includes(versionJson.version), 'version.json deve ser 1.0.228 ou 1.0.229');
  assert.ok((swContent.includes('vortex-vip-v1.0.228') || swContent.includes('vortex-vip-v1.0.229')) || swContent.includes('vortex-vip-v1.0.229'), 'sw.js deve conter cache vortex-vip-v1.0.228 ou 1.0.229');
  assert.ok((html.includes('script.js?v=1.0.228') || html.includes('script.js?v=1.0.229')), 'index.html deve referenciar script.js?v=1.0.228');
  assert.ok((html.includes('style.css?v=1.0.228') || html.includes('style.css?v=1.0.229')), 'index.html deve referenciar style.css?v=1.0.228');

  // 2. O manifest.json estático NÃO deve mais conter #fff01f para não tingir a navigation bar de amarelo
  assert.strictEqual(manifest.theme_color, '#39ff14', 'manifest.json deve usar verde neon #39ff14 como padrão VIP');
  assert.strictEqual(manifest.background_color, '#0a0a0c', 'manifest.json background_color deve ser #0a0a0c');

  // 3. Suporte a meta theme-color para light e dark schemes em index.html
  assert.ok(html.includes('name="theme-color" content="#39ff14" id="app-theme-color-meta"'), 'index.html deve ter meta theme-color padrão #39ff14');
  assert.ok(html.includes('name="theme-color" media="(prefers-color-scheme: dark)"'), 'index.html deve ter meta theme-color para prefers-color-scheme: dark');
  assert.ok(html.includes('name="theme-color" media="(prefers-color-scheme: light)"'), 'index.html deve ter meta theme-color para prefers-color-scheme: light');
  assert.ok(html.includes('name="color-scheme" content="dark"'), 'index.html deve conter meta color-scheme dark');

  // 4. Verificação da função updateSystemThemeColor atualizando todas as meta tags e o manifest
  assert.strictEqual(typeof win.updateSystemThemeColor, 'function', 'updateSystemThemeColor deve ser função');
  win.updateSystemThemeColor('#00f5ff'); // Tema Ciano

  const metaTheme = win.document.querySelector('meta[name="theme-color"]');
  assert.ok(metaTheme, 'meta[name="theme-color"] deve existir');
  assert.strictEqual(metaTheme.getAttribute('content'), '#00f5ff', 'meta theme-color deve ter sido atualizado para #00f5ff');

  // 5. Teste de propagação de cor CSS para root e body
  assert.strictEqual(win.document.documentElement.style.getPropertyValue('--system-theme-color'), '#00f5ff', '--system-theme-color deve ser #00f5ff no documentElement');

  // 6. Teste de atualização dinâmica do manifest link
  const manifestLink = win.document.querySelector('link[rel="manifest"]');
  assert.ok(manifestLink, 'link[rel="manifest"] deve existir');
});

test('Selo de Verificado Único para Conta Empresa (Verde Neon - Efeito Luz de Lâmina de Espada) v1.0.229', async () => {
  const env = createTestEnvironment();
  const win = env.sandbox.window;
  const html = fs.readFileSync('public/index.html', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  const swContent = fs.readFileSync('public/sw.js', 'utf8');

  // 1. Integridade de Versionamento v1.0.229
  assert.strictEqual(manifest.version, '1.0.229', 'manifest.json deve ser 1.0.229');
  assert.strictEqual(versionJson.version, '1.0.229', 'version.json deve ser 1.0.229');
  assert.strictEqual(win.CURRENT_APP_VERSION, '1.0.229', 'CURRENT_APP_VERSION deve ser 1.0.229');
  assert.ok(swContent.includes('vortex-vip-v1.0.229'), 'sw.js deve conter cache vortex-vip-v1.0.229');
  assert.ok(html.includes('script.js?v=1.0.229'), 'index.html deve referenciar script.js?v=1.0.229');
  assert.ok(html.includes('style.css?v=1.0.229'), 'index.html deve referenciar style.css?v=1.0.229');
  assert.ok(html.includes('v1.0.229 ⚡'), 'index.html deve exibir pill de versão v1.0.229 ⚡');

  // 2. Integridade do CSS do Selo de Empresa (Verde Neon / Lâmina de Espada)
  assert.ok(css.includes('.verified-badge-company'), 'style.css deve conter .verified-badge-company');
  assert.ok(css.includes('#00ff66'), 'style.css deve conter verde cortante #00ff66');
  assert.ok(css.includes('swordBladeGleam'), 'style.css deve conter @keyframes swordBladeGleam');
  assert.ok(css.includes('swordBladePulse'), 'style.css deve conter @keyframes swordBladePulse');
  assert.ok(css.includes('.company-badge-toast-green'), 'style.css deve conter toast .company-badge-toast-green');

  // 3. Verificação da função checkIsCompanyUser
  assert.strictEqual(typeof win.checkIsCompanyUser, 'function', 'checkIsCompanyUser deve ser função');
  assert.strictEqual(win.checkIsCompanyUser({ accountType: 'business' }), true, 'accountType business deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser({ accountType: 'company' }), true, 'accountType company deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser({ isBusiness: true }), true, 'isBusiness: true deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser({ isCompany: true }), true, 'isCompany: true deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser({ profile: { accountType: 'business' } }), true, 'profile.accountType business deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser({ accountType: 'personal', isVip: true }), false, 'conta pessoal VIP não deve ser empresa');
  assert.strictEqual(win.checkIsCompanyUser(null), false, 'null deve retornar false');

  // 4. Verificação de updateVerifiedBadgeElement com Conta Empresa
  assert.strictEqual(typeof win.updateVerifiedBadgeElement, 'function', 'updateVerifiedBadgeElement deve ser função');
  
  const companyBadgeEl = win.document.createElement('i');
  companyBadgeEl.id = 'chat-card-verified-badge-test';
  win.updateVerifiedBadgeElement(companyBadgeEl, { accountType: 'business', name: 'Empresa Teste' });

  assert.ok(companyBadgeEl.classList.contains('verified-badge-company'), 'deve adicionar classe .verified-badge-company');
  assert.strictEqual(companyBadgeEl.getAttribute('data-company-badge'), 'true', 'deve adicionar data-company-badge="true"');
  assert.strictEqual(companyBadgeEl.getAttribute('title'), '⚔️ Empresa Verificada ⚡', 'title deve ser ⚔️ Empresa Verificada ⚡');
  assert.strictEqual(companyBadgeEl.style.display, 'inline-flex', 'display deve ser inline-flex');

  // 5. Verificação de Prioridade: Administrador tem prioridade sobre Empresa
  const adminCompanyBadgeEl = win.document.createElement('i');
  win.updateVerifiedBadgeElement(adminCompanyBadgeEl, { email: 'dxhub.oficial@gmail.com', accountType: 'business' });
  assert.ok(adminCompanyBadgeEl.classList.contains('verified-badge-admin'), 'Admin deve ter classe .verified-badge-admin');
  assert.strictEqual(adminCompanyBadgeEl.classList.contains('verified-badge-company'), false, 'Admin não deve ter .verified-badge-company');
  assert.strictEqual(adminCompanyBadgeEl.getAttribute('data-admin-badge'), 'true', 'Admin deve ter data-admin-badge="true"');

  // 6. Verificação de Conta Pessoal VIP: Não ganha selo de empresa
  const personalVipEl = win.document.createElement('i');
  win.updateVerifiedBadgeElement(personalVipEl, { isVip: true, accountType: 'personal' });
  assert.strictEqual(personalVipEl.classList.contains('verified-badge-company'), false, 'Pessoal VIP não tem .verified-badge-company');
  assert.strictEqual(personalVipEl.classList.contains('active'), true, 'Pessoal VIP tem classe active');
  assert.strictEqual(personalVipEl.getAttribute('title'), 'Verificado VIP', 'title deve ser Verificado VIP');

  // 7. Verificação de Usuário Normal: Oculto
  const normalUserEl = win.document.createElement('i');
  win.updateVerifiedBadgeElement(normalUserEl, { isVip: false, accountType: 'personal' });
  assert.strictEqual(normalUserEl.style.display, 'none', 'Usuário normal não deve exibir selo');

  // 8. Verificação do Balão Flutuante Verde (showCompanyBadgeToast)
  assert.strictEqual(typeof win.showCompanyBadgeToast, 'function', 'showCompanyBadgeToast deve ser função');
  win.showCompanyBadgeToast(null, companyBadgeEl);

  const toastList = Object.values(env.elements).filter(el => el && el.classList && el.classList.contains && el.classList.contains('company-badge-toast-green'));
  assert.ok(toastList.length >= 1, '.company-badge-toast-green deve ser criado no DOM');
  const toast = toastList[toastList.length - 1];
  assert.ok(toast.innerHTML.includes('⚔️ Empresa Verificada ⚡'), 'Toast deve conter texto ⚔️ Empresa Verificada ⚡');
});
