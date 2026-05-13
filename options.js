const input = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const msg = document.getElementById('msg');

// 加载已保存的 Key
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) input.value = apiKey;
});

saveBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) {
    msg.className = 'msg error';
    msg.textContent = '请输入 API Key';
    return;
  }
  if (!key.startsWith('sk-')) {
    msg.className = 'msg error';
    msg.textContent = 'API Key 格式不正确，应以 sk- 开头';
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => {
    msg.className = 'msg success';
    msg.textContent = '保存成功！现在可以在网页上选中文字试试了。';
  });
});
