const statusEl = document.getElementById('status');
const configuredEl = document.getElementById('configured');
const setupEl = document.getElementById('setup');
const input = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const changeBtn = document.getElementById('changeBtn');
const msg = document.getElementById('msg');

// 加载状态
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

// 保存 Key
saveBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) {
    msg.textContent = '请输入 API Key';
    msg.className = 'msg err';
    return;
  }
  if (!key.startsWith('sk-')) {
    msg.textContent = '格式不正确，应以 sk- 开头';
    msg.className = 'msg err';
    return;
  }
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

// 更换 Key
changeBtn.addEventListener('click', () => {
  configuredEl.style.display = 'none';
  setupEl.style.display = 'block';
  input.focus();
});
