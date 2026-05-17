// ======== 标签页切换 ========
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
    if (tab.dataset.panel === 'fav-panel') loadFavorites();
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
const translateToggle = document.getElementById('translateToggle');
const pinToggle = document.getElementById('pinToggle');
chrome.storage.sync.get(['apiKey', 'translateMode', 'pinMode'], ({ apiKey, translateMode, pinMode }) => {
  // 开关初始状态
  translateToggle.checked = translateMode || false;
  pinToggle.checked = pinMode || false;

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

// 开关变化时保存
translateToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ translateMode: translateToggle.checked });
});

pinToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ pinMode: pinToggle.checked });
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

// ======== 收藏夹逻辑 ========
async function loadFavorites() {
  const list = document.getElementById('favList');
  try {
    const data = await chrome.storage.local.get('favorites');
    const entries = data.favorites || [];

    if (entries.length === 0) {
      list.innerHTML = '<div class="fav-empty">还没有收藏的词汇<br>翻译模式下点击 ☆ 即可收藏</div>';
    } else {
      list.innerHTML = entries.map((e, i) => `
        <div class="fav-item">
          <div class="fav-word">${escapeHtml(e.word)}</div>
          <div class="fav-translation">${escapeHtml(e.translation)}</div>
          <div class="fav-meta">
            <span>${formatDate(e.createdAt)}</span>
            <button class="fav-delete" data-index="${i}">删除</button>
          </div>
        </div>
      `).join('');
    }

    list.querySelectorAll('.fav-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.index);
        const data2 = await chrome.storage.local.get('favorites');
        const list2 = data2.favorites || [];
        list2.splice(idx, 1);
        await chrome.storage.local.set({ favorites: list2 });
        loadFavorites();
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="fav-empty">加载失败，请重试</div>';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
