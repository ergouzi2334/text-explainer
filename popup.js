// ======== 标签页切换 ========
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
    if (tab.dataset.panel === 'kb-panel') loadKnowledge();
  });
});

// ======== 配置面板逻辑 ========
const statusEl = document.getElementById('status');
const configuredEl = document.getElementById('configured');
const setupEl = document.getElementById('setup');
const input = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const changeBtn = document.getElementById('changeBtn');
const msg = document.getElementById('msg');

chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) {
    statusEl.textContent = '已配置 · 就绪';
    statusEl.className = 'status';
    configuredEl.style.display = 'block';
    setupEl.style.display = 'none';
    input.value = apiKey;
  } else {
    statusEl.textContent = '请先配置 API Key';
    statusEl.className = 'status warn';
    configuredEl.style.display = 'none';
    setupEl.style.display = 'block';
  }
});

saveBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) { msg.textContent = '请输入 API Key'; msg.className = 'msg err'; return; }
  if (!key.startsWith('sk-')) { msg.textContent = '格式不正确，应以 sk- 开头'; msg.className = 'msg err'; return; }
  chrome.storage.sync.set({ apiKey: key }, () => {
    msg.textContent = '保存成功';
    msg.className = 'msg ok';
    setTimeout(() => {
      statusEl.textContent = '已配置 · 就绪';
      statusEl.className = 'status';
      configuredEl.style.display = 'block';
      setupEl.style.display = 'none';
    }, 600);
  });
});

changeBtn.addEventListener('click', () => {
  configuredEl.style.display = 'none';
  setupEl.style.display = 'block';
  input.focus();
});

// ======== 知识库逻辑 ========
const DB_NAME = 'te-knowledge';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('text', 'text', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadKnowledge(searchText) {
  const list = document.getElementById('kbList');
  try {
    const db = await openDB();
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const entries = await new Promise((resolve) => {
      const req = store.index('createdAt').openCursor(null, 'prev');
      const results = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const q = (searchText || '').toLowerCase();
          const item = cursor.value;
          if (!q || item.text.toLowerCase().includes(q) || item.explanation.toLowerCase().includes(q)) {
            results.push(item);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve([]);
    });
    db.close();

    if (entries.length === 0) {
      list.innerHTML = '<div class="kb-empty">还没有收藏的词汇<br>在解释气泡中点击 ⭐ 即可收藏</div>';
    } else {
      list.innerHTML = entries.map(e => `
        <div class="kb-item">
          <div class="kb-word">${escapeHtml(e.text)}</div>
          <div class="kb-explain">${escapeHtml(e.explanation)}</div>
          <div class="kb-meta">
            <span>${formatDate(e.createdAt)}</span>
            <button class="kb-delete" data-id="${e.id}">删除</button>
          </div>
        </div>
      `).join('');
    }

    // 删除按钮事件
    list.querySelectorAll('.kb-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const db2 = await openDB();
        const tx2 = db2.transaction('entries', 'readwrite');
        tx2.objectStore('entries').delete(id);
        tx2.oncomplete = () => { db2.close(); loadKnowledge(getSearchText()); };
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="kb-empty">加载失败，请重试</div>';
  }
}

function getSearchText() {
  return document.getElementById('kbSearch').value.trim();
}

document.getElementById('kbSearch').addEventListener('input', () => {
  loadKnowledge(getSearchText());
});

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
