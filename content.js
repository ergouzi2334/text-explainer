(function () {
  let bubble = null;
  let bubbleBody = null;
  let bubbleInput = null;
  let conversation = [];       // [{role:'user'|'assistant', content}]
  let multiMode = false;
  let pendingWords = [];
  let highlights = [];
  let greenDot = null;
  let countBadge = null;
  let lastSelection = '';
  let lastRange = null;
  let lastCtrlTime = 0;
  let currentMode = 'word';    // 'word' | 'passage'

  // ======== Markdown 渲染 ========
  function renderMarkdown(text) {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3 class="te-md-h3">$1</h3>');
    // 加粗
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code class="te-md-code">$1</code>');
    // 列表项
    html = html.replace(/^- (.+)$/gm, '<li class="te-md-li">$1</li>');
    // 包裹连续 <li>
    html = html.replace(/(<li class="te-md-li">.*<\/li>\n?)+/g, '<ul class="te-md-ul">$&</ul>');
    // 段落（至少两个连续换行）
    html = html.replace(/\n\n+/g, '</p><p>');
    // 单个换行转 <br>
    html = html.replace(/\n/g, '<br>');
    // 包裹
    html = '<p>' + html + '</p>';
    // 修复空的 <p></p>
    html = html.replace(/<p><\/p>/g, '');
    return html;
  }

  // ======== 知识库存储 ========
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

  async function saveToKnowledge(text, explanation) {
    try {
      const db = await openDB();
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      store.add({
        text,
        explanation,
        conversation: [...conversation],
        createdAt: Date.now(),
      });
      return new Promise((resolve) => {
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      });
    } catch (e) {
      console.error('知识库保存失败:', e);
      return false;
    }
  }

  // ======== 小绿点 ========
  function createGreenDot() {
    if (greenDot) return;
    const dot = document.createElement('div');
    dot.id = 'te-green-dot';
    document.body.appendChild(dot);
    greenDot = dot;
  }

  function moveGreenDot(x, y) {
    if (!greenDot) return;
    greenDot.style.left = (x + 8) + 'px';
    greenDot.style.top = (y + 8) + 'px';
  }

  function removeGreenDot() {
    if (greenDot) { greenDot.remove(); greenDot = null; }
  }

  // ======== 计数徽章 ========
  function updateBadge() {
    if (pendingWords.length === 0) {
      if (countBadge) { countBadge.remove(); countBadge = null; }
      return;
    }
    if (!countBadge) {
      countBadge = document.createElement('div');
      countBadge.id = 'te-count-badge';
      document.body.appendChild(countBadge);
    }
    countBadge.textContent = `已选 ${pendingWords.length} 个 · Enter 解释 · Esc 退出`;
  }

  function removeBadge() {
    if (countBadge) { countBadge.remove(); countBadge = null; }
  }

  // ======== 气泡 ========
  function removeBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
    bubbleBody = null;
    bubbleInput = null;
    conversation = [];
  }

  function createBubble(x, y) {
    removeBubble();
    conversation = [];

    const div = document.createElement('div');
    div.className = 'text-explainer-bubble';

    div.innerHTML = `
      <div class="te-header">
        <span>解释中...</span>
        <button class="te-close">&times;</button>
      </div>
      <div class="te-body">
        <div class="te-loading">正在请教 AI...</div>
      </div>
      <div class="te-input-bar" style="display:none">
        <input type="text" class="te-input" placeholder="输入追问...">
        <button class="te-send-btn">发送</button>
      </div>
      <div class="te-bubble-actions" style="display:none">
        <button class="te-save-btn">⭐ 收藏到知识库</button>
      </div>`;

    document.body.appendChild(div);

    const bw = 380;
    let left = Math.min(x, window.innerWidth - bw - 10);
    left = Math.max(left, 10);
    div.style.left = left + 'px';
    div.style.top = Math.min(y + 10, window.innerHeight - 300) + 'px';

    bubble = div;
    bubbleBody = div.querySelector('.te-body');

    // 关闭按钮
    div.querySelector('.te-close').addEventListener('click', removeBubble);

    // 追问输入
    bubbleInput = div.querySelector('.te-input');
    bubbleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const q = bubbleInput.value.trim();
        if (!q) return;
        bubbleInput.value = '';
        addUserMessage(q);
        doFollowup(q);
      }
    });

    // 发送按钮
    div.querySelector('.te-send-btn').addEventListener('click', () => {
      const q = bubbleInput.value.trim();
      if (!q) return;
      bubbleInput.value = '';
      addUserMessage(q);
      doFollowup(q);
    });

    // 收藏按钮
    div.querySelector('.te-save-btn').addEventListener('click', async () => {
      const originalText = conversation[0]?.content || '';
      const explanation = conversation[1]?.content || '';
      const ok = await saveToKnowledge(originalText, explanation);
      const btn = div.querySelector('.te-save-btn');
      if (ok) {
        btn.textContent = '✅ 已收藏';
        btn.disabled = true;
      } else {
        btn.textContent = '❌ 收藏失败';
        setTimeout(() => { btn.textContent = '⭐ 收藏到知识库'; }, 1500);
      }
    });

    return div;
  }

  function showResult(content) {
    if (!bubble) return;
    conversation.push({ role: 'assistant', content });

    bubble.querySelector('.te-header span').textContent = currentMode === 'word' ? '解释' : '深度解读';
    bubbleBody.innerHTML = '';
    addBubbleMessage('assistant', content);

    // 显示追问栏和收藏按钮
    bubble.querySelector('.te-input-bar').style.display = 'flex';
    bubble.querySelector('.te-bubble-actions').style.display = 'flex';
    bubbleInput.focus();
  }

  function addBubbleMessage(role, content) {
    if (!bubbleBody) return;
    const msg = document.createElement('div');
    msg.className = role === 'user' ? 'te-msg te-msg-user' : 'te-msg te-msg-ai';

    if (role === 'user') {
      msg.innerHTML = `<span class="te-msg-label">追问</span><p>${content}</p>`;
    } else {
      msg.innerHTML = `<span class="te-msg-label">AI</span><div class="te-msg-content">${renderMarkdown(content)}</div>`;
    }

    // 分隔线
    if (conversation.filter(c => c.role === 'user').length > 1) {
      const divider = document.createElement('div');
      divider.className = 'te-msg-divider';
      bubbleBody.appendChild(divider);
    }

    bubbleBody.appendChild(msg);
    bubbleBody.scrollTop = bubbleBody.scrollHeight;
  }

  function addUserMessage(text) {
    conversation.push({ role: 'user', content: text });
    addBubbleMessage('user', text);

    // 显示加载状态
    const loading = document.createElement('div');
    loading.className = 'te-msg-loading';
    loading.textContent = 'AI 思考中...';
    bubbleBody.appendChild(loading);
    bubbleBody.scrollTop = bubbleBody.scrollHeight;
  }

  function removeLastLoading() {
    const loadings = bubbleBody.querySelectorAll('.te-msg-loading');
    loadings.forEach(el => el.remove());
  }

  function showError(msg) {
    if (!bubble) return;
    bubble.querySelector('.te-header span').textContent = '出错了';
    bubbleBody.innerHTML = `<div class="te-error-msg"><p>${msg}</p></div>`;
  }

  // ======== 高亮选中 ========
  function highlightSelection(range) {
    try {
      const span = document.createElement('span');
      span.className = 'te-highlight';
      range.surroundContents(span);
      highlights.push(span);
    } catch (e) {
      // 跨元素选中时 surroundContents 会失败，忽略
    }
  }

  function removeAllHighlights() {
    highlights.forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        parent.normalize();
      }
    });
    highlights = [];
  }

  // ======== 关闭多词模式 ========
  function exitMultiMode() {
    multiMode = false;
    pendingWords = [];
    lastSelection = '';
    lastRange = null;
    removeAllHighlights();
    removeGreenDot();
    removeBadge();
    removeBubble();
  }

  // ======== 触发解释 ========
  function triggerExplain(text) {
    const sel = window.getSelection();
    let x = window.innerWidth / 2;
    let y = window.scrollY + 100;

    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.bottom + window.scrollY;
    }

    currentMode = text.length <= 10 ? 'word' : 'passage';
    bubble = createBubble(x, y);

    conversation.push({ role: 'user', content: text });

    chrome.runtime.sendMessage({ type: 'explain', text, mode: currentMode }, (res) => {
      if (chrome.runtime.lastError) { showError('通信失败，请刷新页面后重试'); return; }
      if (res.success) { showResult(res.content); }
      else { showError(res.error); }
    });
  }

  // ======== 追问 ========
  function doFollowup(question) {
    const history = [
      { role: 'system', content: '继续对话' },
      ...conversation.map(c => ({ role: c.role, content: c.content })),
    ];

    chrome.runtime.sendMessage({ type: 'followup', history }, (res) => {
      removeLastLoading();
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) {
        conversation.push({ role: 'assistant', content: res.content });
        addBubbleMessage('assistant', res.content);
      } else {
        const errMsg = document.createElement('div');
        errMsg.className = 'te-error-msg';
        errMsg.innerHTML = `<p>追问失败：${res.error}</p>`;
        bubbleBody.appendChild(errMsg);
      }
    });
  }

  function explainBatch() {
    if (pendingWords.length === 0) return;
    const words = [...pendingWords];
    const text = words.join('、');
    pendingWords = [];
    removeBadge();

    currentMode = 'word';
    const x = window.innerWidth / 2;
    const y = window.scrollY + 20;
    bubble = createBubble(x, y);
    conversation.push({ role: 'user', content: text });

    chrome.runtime.sendMessage({ type: 'explain', text, mode: 'batch' }, (res) => {
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) {
        conversation.push({ role: 'assistant', content: res.content });
        bubble.querySelector('.te-header span').textContent = '多词解释';
        bubbleBody.innerHTML = '';
        const lines = res.content.split('\n').filter(l => l.trim());
        bubbleBody.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
        bubble.querySelector('.te-input-bar').style.display = 'flex';
        bubble.querySelector('.te-bubble-actions').style.display = 'flex';
      } else {
        showError(res.error);
      }
    });
  }

  // ======== 鼠标事件 ========
  document.addEventListener('mousemove', (e) => {
    if (multiMode) moveGreenDot(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', (e) => {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text || text.length > 2000) return;
    if (bubble && bubble.contains(e.target)) return;

    if (multiMode) {
      lastSelection = text;
      try { lastRange = sel.getRangeAt(0).cloneRange(); } catch (e) { lastRange = null; }
      e.preventDefault();
      e.stopPropagation();
    } else {
      triggerExplain(text);
    }
  });

  // ======== 键盘事件 ========
  document.addEventListener('keydown', (e) => {
    // 双击 Ctrl：切换多词模式
    if (e.key === 'Control' && !e.repeat) {
      const now = Date.now();
      if (now - lastCtrlTime < 500) {
        e.preventDefault();
        e.stopPropagation();
        if (multiMode) {
          exitMultiMode();
        } else {
          multiMode = true;
          pendingWords = [];
          lastSelection = '';
          createGreenDot();
        }
        lastCtrlTime = 0;
        return;
      }
      lastCtrlTime = now;
      return;
    }

    if (e.ctrlKey) { lastCtrlTime = 0; }
    if (!multiMode) return;

    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection && !pendingWords.includes(lastSelection)) {
        pendingWords.push(lastSelection);
        if (lastRange) highlightSelection(lastRange);
        lastSelection = '';
        lastRange = null;
        updateBadge();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      explainBatch();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitMultiMode();
      return;
    }
  }, true);

  // ======== 点击气泡外关闭 ========
  document.addEventListener('mousedown', (e) => {
    if (bubble && !bubble.contains(e.target)) {
      removeBubble();
    }
  });
})();
