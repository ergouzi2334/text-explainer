(function () {
  let bubble = null;
  let multiMode = false;
  let pendingWords = [];
  let highlights = [];
  let greenDot = null;
  let countBadge = null;
  let lastSelection = '';
  let lastRange = null;
  let lastCtrlTime = 0;

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

  // ======== 气泡 DOM ========
  function createBubble(x, y) {
    removeBubble();
    const div = document.createElement('div');
    div.className = 'text-explainer-bubble';
    div.innerHTML = '<div class="te-loading">解释中...</div>';
    document.body.appendChild(div);
    const bw = 320;
    let left = Math.min(x, window.innerWidth - bw - 10);
    left = Math.max(left, 10);
    div.style.left = left + 'px';
    div.style.top = (y + 10) + 'px';
    return div;
  }

  function showResult(content, isBatch) {
    if (!bubble) return;
    if (isBatch) {
      const lines = content.split('\n').filter(l => l.trim());
      bubble.innerHTML = `
        <div class="te-header">
          <span>解释结果</span>
          <button class="te-close">&times;</button>
        </div>
        <div class="te-body">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
    } else {
      bubble.innerHTML = `
        <div class="te-header">
          <span>解释</span>
          <button class="te-close">&times;</button>
        </div>
        <div class="te-body"><p>${content}</p></div>`;
    }
    bubble.querySelector('.te-close').addEventListener('click', removeBubble);
  }

  function showError(msg) {
    if (!bubble) return;
    bubble.innerHTML = `
      <div class="te-header">
        <span>出错了</span>
        <button class="te-close">&times;</button>
      </div>
      <div class="te-body te-error"><p>${msg}</p></div>`;
    bubble.querySelector('.te-close').addEventListener('click', removeBubble);
  }

  function removeBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
  }

  // ======== 高亮选中文字 ========
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
  function explainSingle(text) {
    const sel = window.getSelection();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.bottom + window.scrollY;
    bubble = createBubble(x, y);
    chrome.runtime.sendMessage({ type: 'explain', text, mode: 'single' }, (res) => {
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) { showResult(res.content, false); }
      else { showError(res.error); }
    });
  }

  function explainBatch() {
    if (pendingWords.length === 0) return;
    const x = window.innerWidth / 2;
    const y = window.scrollY + 20;
    bubble = createBubble(x, y);
    const words = [...pendingWords];
    pendingWords = [];
    removeBadge();
    chrome.runtime.sendMessage({ type: 'explain', text: words, mode: 'batch' }, (res) => {
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) { showResult(res.content, true); }
      else { showError(res.error); }
    });
  }

  // ======== 鼠标移动：小绿点跟随 ========
  document.addEventListener('mousemove', (e) => {
    if (multiMode) moveGreenDot(e.clientX, e.clientY);
  });

  // ======== 文本选中 ========
  document.addEventListener('mouseup', (e) => {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text || text.length > 500) return;
    if (bubble && bubble.contains(e.target)) return;

    if (multiMode) {
      // 多词模式：暂存选中文字和选区，等用户按空格确认
      lastSelection = text;
      try { lastRange = sel.getRangeAt(0).cloneRange(); } catch (e) { lastRange = null; }
      e.preventDefault();
      e.stopPropagation();
    } else {
      // 默认模式：直接解释
      explainSingle(text);
    }
  });

  // ======== 键盘操作 ========
  document.addEventListener('keydown', (e) => {
    // 双击 Ctrl：切换多词模式（只响应单独按下的 Ctrl，忽略组合键）
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

    // 按下 Ctrl 组合键（如 Ctrl+C）时重置计时，防止误触发
    if (e.ctrlKey) {
      lastCtrlTime = 0;
    }

    if (!multiMode) return;

    // Space：确认当前选中为一个词
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

    // Enter：触发批量解释
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      explainBatch();
      return;
    }

    // Esc：退出多词模式
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitMultiMode();
      return;
    }
  }, true);

  // ======== 全局关闭气泡 ========
  document.addEventListener('mousedown', (e) => {
    if (bubble && !bubble.contains(e.target)) {
      removeBubble();
    }
  });
})();
