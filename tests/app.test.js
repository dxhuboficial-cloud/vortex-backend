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
        this.children.unshift(child);
        return child;
      },
      appendChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.children.push(child);
        return child;
      },
      remove() {},
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; },
      removeAttribute(k) { delete this[k]; },
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
          forEach: (fn) => docs.forEach(fn)
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
      appendChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.children.push(child);
        return child;
      },
      prepend(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.children.unshift(child);
        return child;
      },
      remove: () => {},
      querySelector(sel) {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          return this.children.find(c => c.classList && c.classList.contains && c.classList.contains(cls)) || null;
        }
        if (sel === '[data-lucide]') {
          return this.children.find(c => c['data-lucide'] !== undefined || (c.getAttribute && c.getAttribute('data-lucide') !== null)) || null;
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
      if (sel.startsWith('#')) {
        const id = sel.slice(1).split(/[\s.:>+~[]/)[0];
        return elements[id] || null;
      }
      if (sel.includes('[data-filter="nao-lidas"]')) {
        return elements['filter-pill-nao-lidas'] || null;
      }
      if (sel.includes('.chat-card[data-uid=')) {
        const uidMatch = sel.match(/data-uid="([^"]+)"/);
        if (uidMatch) {
          return Object.values(elements).find(el => el.classList && el.classList.contains && el.classList.contains('chat-card') && el.dataset && el.dataset.uid === uidMatch[1]) || null;
        }
      }
      return null;
    },
    querySelectorAll: (sel) => {
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
      }
    }
  };

  const soundPlayed = [];
  let vibrationPattern = null;
  const rtdbDocs = {};

  const storageStore = {};
  const mockLocalStorage = {
    getItem: (key) => (key in storageStore ? storageStore[key] : null),
    setItem: (key, val) => { storageStore[key] = String(val); },
    removeItem: (key) => { delete storageStore[key]; },
    clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
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

  const sandbox = {
    console,
    fetch: globalThis.fetch,
    document: mockDoc,
    history: mockHistory,
    Event: MockEvent,
    window: {
      Event: MockEvent,
      fetch: globalThis.fetch,
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
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb) => setTimeout(cb, 16),
      cancelAnimationFrame: (id) => clearTimeout(id),
      URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
      RTCPeerConnection: function() {},
      MediaStream: function() { this.getTracks = () => []; },
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
      RTCSessionDescription: function() {},
      RTCIceCandidate: function() {},
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
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
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
    navigator: {
      userAgent: 'test',
      vibrate: (pattern) => { vibrationPattern = pattern; return true; },
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => {} }] }) },
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
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    // Mock Firebase
    initializeApp: () => ({}),
    getAuth: () => ({}),
    GoogleAuthProvider: function() {},
    signInWithPopup: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onAuthStateChanged: () => {},
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
      return Promise.resolve({ id });
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
            forEach: (fn) => docs.forEach(fn)
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
            } else if (op.type === 'delete') {
              delete firestoreDocs[op.ref.path];
            } else if (op.type === 'set') {
              firestoreDocs[op.ref.path] = { ...(firestoreDocs[op.ref.path] || {}), ...op.data };
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
    rtdbDocs,
    soundPlayed,
    makeMockElement,
    notifyFirestoreListeners,
    triggerDocSnapshot: (path, data) => {
      firestoreDocs[path] = data;
      notifyFirestoreListeners(path);
    },
    getVibration: () => vibrationPattern
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
    'posts-feed-list',
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
    'vip-font-selector'
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
    '.vip-exclusive-tag'
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

  // 5. Saving profile via #save-profile-btn keeps avatar intact in Firestore
  env.elements['profile-name-input'].value = 'Alice Updated';
  env.elements['profile-lastname-input'].value = 'Silva VIP';
  env.elements['profile-username-input'].value = 'alicesilva';
  env.elements['profile-status-input'].value = 'Novo status VIP';

  await saveBtn.click();

  const savedUserDoc = env.firestoreDocs[`users/${alice.uid}`];
  assert.ok(savedUserDoc, 'User doc must exist in Firestore');
  assert.strictEqual(savedUserDoc.name, 'Alice Updated', 'Name must be updated');
  assert.strictEqual(savedUserDoc.avatar, fileEventData, 'CRITICAL: Avatar must be preserved in Firestore when saving profile');
  assert.strictEqual(env.elements['user-display-name'].innerText, 'Alice Updated Silva VIP', 'Display name in header must be refreshed');
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
    isVerified: contactMock.isVerified
  };

  await openContactProfile(contactMock);
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), true, 'Painel Dados do Contato deve abrir com classe active');
  assert.strictEqual(env.elements['contact-profile-name'].innerText, 'Mariana Souza', 'Nome do contato deve estar correto');
  assert.strictEqual(env.elements['contact-profile-verified-badge'].style.display, 'inline-flex', 'Selo de verificado deve estar visível no painel Dados do Contato');
  assert.ok(env.elements['contact-profile-username'].innerText.includes('marianas'), 'Username do contato deve conter marianas');
  assert.ok(env.elements['contact-profile-bio-text'].innerText.includes('Vivendo e aprendendo todo dia!'), 'Recado/Bio deve estar preenchido no painel');
  assert.ok(env.elements['contact-profile-avatar'].style.backgroundImage.includes('mariana.jpg'), 'Avatar deve exibir imagem do contato');

  // Fechamento manual
  closeContactProfile();
  assert.strictEqual(env.elements['contact-profile-panel'].classList.contains('active'), false, 'Painel Dados do Contato deve fechar');

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
  wpTrigger.onclick();
  assert.ok(wpModal.classList.contains('active'), 'Modal de papel de parede deve abrir ao clicar no item do menu');

  // Aplicar preset Matrix Green na conversa atual
  env.sandbox.activeChatContact = { uid: 'contact-test-123', name: 'Amigo Teste' };
  localStorage.setItem('vortex_wallpaper_contact-test-123', 'matrix-green');

  env.sandbox.applyChatWallpaper('contact-test-123');
  assert.ok(msgContainer.classList.contains('has-custom-wallpaper'), 'Container de mensagens deve indicar papel de parede ativo');
  assert.ok(msgContainer.style.background.includes('matrix') || msgContainer.style.background.includes('021a08'), 'Background do container deve aplicar o preset matrix-green');

  // Resetar papel de parede para padrão
  localStorage.removeItem('vortex_wallpaper_contact-test-123');
  env.sandbox.applyChatWallpaper('contact-test-123');
  assert.strictEqual(msgContainer.classList.contains('has-custom-wallpaper'), false, 'Ao resetar, custom wallpaper deve ser desativado');
  assert.strictEqual(msgContainer.style.background, '', 'Background do container deve voltar ao padrão vazio');
});




