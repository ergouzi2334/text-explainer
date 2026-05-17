(function () {
  let bubble = null;
  let bubbleBody = null;
  let bubbleInput = null;
  let conversation = [];
  let multiMode = false;
  let pendingWords = [];
  let highlights = [];
  let greenDot = null;
  let countBadge = null;
  let lastSelection = '';
  let lastRange = null;
  let lastCtrlTime = 0;
  let currentMode = 'word';
  let translateMode = false;
  let lastTranslatedRange = null;
  let persistentHighlights = [];

  // 拖拽
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let bubbleStartX = 0, bubbleStartY = 0;

  // 悬浮球
  let floatBall = null;
  let collapsedState = null;  // 收起时保存的对话状态

  function onDragMove(e) {
    if (!isDragging || !bubble) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    clampBubble(bubbleStartX + dx, bubbleStartY + dy);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    if (bubble) bubble.style.transition = '';
  }

  function clampBubble(left, top) {
    if (!bubble) return;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  // ======== Markdown ========
  function renderMarkdown(text) {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^### (.+)$/gm, '<h3 class="te-md-h3">$1</h3>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code class="te-md-code">$1</code>');
    html = html.replace(/^- (.+)$/gm, '<li class="te-md-li">$1</li>');
    html = html.replace(/(<li class="te-md-li">.*<\/li>\n?)+/g, '<ul class="te-md-ul">$&</ul>');
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    return html;
  }

  // ======== 知识库 ========
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
      store.add({ text, explanation, conversation: [...conversation], createdAt: Date.now() });
      return new Promise((resolve) => {
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      });
    } catch (e) { return false; }
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
    countBadge.textContent = '已选 ' + pendingWords.length + ' 个 · Enter 解释 · Esc 退出';
  }

  function removeBadge() {
    if (countBadge) { countBadge.remove(); countBadge = null; }
  }

  // ======== 悬浮球 ========
  function removeFloatBall() {
    if (floatBall) { floatBall.remove(); floatBall = null; }
    collapsedState = null;
  }

  function collapseToBall() {
    if (!bubble) return;
    var label = conversation[0] ? conversation[0].content.substring(0, 2) : '···';
    collapsedState = {
      conversation: conversation.slice(),
      currentMode: currentMode,
      translateMode: translateMode,
    };
    var bx = bubble.offsetLeft;
    var by = bubble.offsetTop;
    bubble.style.display = 'none';
    createFloatBall(bx + 170, by + 10, label);
  }

  function expandFromBall() {
    if (!floatBall || !collapsedState) return;
    var saved = collapsedState;
    var fx = floatBall.offsetLeft - 170;
    var fy = floatBall.offsetTop - 10;
    removeFloatBall();
    if (bubble) { bubble.remove(); bubble = null; }
    bubble = createBubble(fx, fy);
    conversation = saved.conversation;
    currentMode = saved.currentMode;
    translateMode = saved.translateMode || false;
    // 重建消息列表
    var headerSpan = bubble.querySelector('.te-header span');
    var modeLabels2 = { word: '解释', passage: '深度解读', translate: '翻译', batch: '多词解释' };
    headerSpan.textContent = modeLabels2[currentMode] || '解释';
    bubbleBody.innerHTML = '';
    for (var i = 1; i < conversation.length; i++) {
      // 跳过第一条 user 消息（原始文本），只显示 AI 回答和后续追问
      if (i === 1 && conversation[i].role === 'assistant') {
        addBubbleMessage('assistant', conversation[i].content);
      } else if (i > 1) {
        addBubbleMessage(conversation[i].role, conversation[i].content);
      }
    }
    bubble.querySelector('.te-input-bar').style.display = 'flex';
    bubble.querySelector('.te-bubble-actions').style.display = 'flex';
    bubbleInput = bubble.querySelector('.te-input');
    bubbleInput.focus();

    // 恢复翻译模式按钮状态
    var translateBtn2 = bubble.querySelector('.te-btn-translate');
    if (translateBtn2 && translateMode) {
      translateBtn2.classList.add('active');
      translateBtn2.title = '翻译模式：开';
    }
  }

  function createFloatBall(x, y, label) {
    removeFloatBall();
    var ball = document.createElement('div');
    ball.id = 'te-float-ball';
    ball.textContent = label;
    ball.title = '点击展开对话 · 拖拽移动 · 双击关闭';
    ball.style.left = Math.max(8, Math.min(x, window.innerWidth - 52)) + 'px';
    ball.style.top = Math.max(8, Math.min(y, window.innerHeight - 52)) + 'px';
    document.body.appendChild(ball);

    // 小关闭按钮
    var closeBtn = document.createElement('button');
    closeBtn.className = 'te-ball-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeFloatBall();
    });
    ball.appendChild(closeBtn);

    // 双击关闭
    ball.addEventListener('dblclick', function (e) {
      if (e.target === closeBtn) return;
      removeFloatBall();
    });

    // 拖拽 / 点击（统一在 mouseup 判断）
    var dragging = false, sx, sy, bx, by;
    ball.addEventListener('mousedown', function (e) {
      if (e.target === closeBtn) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      bx = ball.offsetLeft; by = ball.offsetTop;
      ball.style.transition = 'none';
      e.preventDefault();
    });

    function onBallMove(e) {
      if (!dragging) return;
      var nx = bx + e.clientX - sx;
      var ny = by + e.clientY - sy;
      nx = Math.max(8, Math.min(nx, window.innerWidth - 52));
      ny = Math.max(8, Math.min(ny, window.innerHeight - 52));
      ball.style.left = nx + 'px';
      ball.style.top = ny + 'px';
    }

    function onBallUp(e) {
      if (!dragging) return;
      dragging = false;
      ball.style.transition = '';
      expandFromBall();
    }

    document.addEventListener('mousemove', onBallMove);
    document.addEventListener('mouseup', onBallUp);

    floatBall = ball;
  }

  // ======== 气泡 ========
  function removeBubble() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    isDragging = false;
    if (bubble) { bubble.remove(); bubble = null; }
    bubbleBody = null;
    bubbleInput = null;
    conversation = [];
    removeFloatBall();
  }

  function createBubble(x, y) {
    removeBubble();
    conversation = [];

    var div = document.createElement('div');
    div.className = 'text-explainer-bubble';

    var headerHtml = '<div class="te-header">';
    headerHtml += '<span>解释中...</span>';
    headerHtml += '<div class="te-header-actions">';
    headerHtml += '<button class="te-btn-translate" title="翻译模式：点击切换">译</button>';
    headerHtml += '<button class="te-btn-collapse" title="收起为悬浮球">&minus;</button>';
    headerHtml += '<button class="te-btn-close" title="关闭">&times;</button>';
    headerHtml += '</div></div>';

    div.innerHTML = headerHtml +
      '<div class="te-body"><div class="te-loading">正在请教 AI...</div></div>' +
      '<div class="te-input-bar" style="display:none">' +
      '<input type="text" class="te-input" placeholder="输入追问...">' +
      '<button class="te-send-btn">↑</button>' +
      '</div>' +
      '<div class="te-bubble-actions" style="display:none">' +
      '<button class="te-save-btn">☆ 收藏到知识库</button>' +
      '</div>';

    document.body.appendChild(div);

    bubble = div;
    bubbleBody = div.querySelector('.te-body');

    // 初始定位
    var bw = 360;
    var left = Math.min(x, window.innerWidth - bw - 10);
    left = Math.max(left, 10);
    div.style.left = left + 'px';
    div.style.top = Math.max(10, Math.min(y, window.innerHeight - 320)) + 'px';

    // 拖拽
    var header = div.querySelector('.te-header');
    header.addEventListener('mousedown', function (e) {
      if (e.target.closest('.te-header-actions')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      bubbleStartX = div.offsetLeft;
      bubbleStartY = div.offsetTop;
      div.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // 收起按钮
    div.querySelector('.te-btn-collapse').addEventListener('click', collapseToBall);

    // 关闭按钮
    div.querySelector('.te-btn-close').addEventListener('click', function () {
      lastTranslatedRange = null;
      removeBubble();
    });

    // 翻译切换按钮
    var translateBtn = div.querySelector('.te-btn-translate');
    if (translateMode) {
      translateBtn.classList.add('active');
      translateBtn.title = '翻译模式：开';
    }
    translateBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      translateMode = !translateMode;
      if (translateMode) {
        translateBtn.classList.add('active');
        translateBtn.title = '翻译模式：开';
      } else {
        translateBtn.classList.remove('active');
        translateBtn.title = '翻译模式：关';
      }
    });

    // 追问输入
    bubbleInput = div.querySelector('.te-input');
    bubbleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var q = bubbleInput.value.trim();
        if (!q) return;
        bubbleInput.value = '';
        addUserMessage(q);
        doFollowup(q);
      }
    });

    div.querySelector('.te-send-btn').addEventListener('click', function () {
      var q = bubbleInput.value.trim();
      if (!q) return;
      bubbleInput.value = '';
      addUserMessage(q);
      doFollowup(q);
    });

    // 收藏
    div.querySelector('.te-save-btn').addEventListener('click', async function () {
      var originalText = conversation[0] ? conversation[0].content : '';
      var explanation = conversation[1] ? conversation[1].content : '';
      var ok = await saveToKnowledge(originalText, explanation);
      var btn = div.querySelector('.te-save-btn');
      if (ok) {
        btn.textContent = '★ 已收藏';
        btn.disabled = true;
      } else {
        btn.textContent = '✕ 收藏失败';
        setTimeout(function () { btn.textContent = '☆ 收藏到知识库'; }, 1500);
      }
    });

    return div;
  }

  function showResult(content) {
    if (!bubble) return;
    conversation.push({ role: 'assistant', content: content });

    var modeLabels = { word: '解释', passage: '深度解读', translate: '翻译', batch: '多词解释' };
    bubble.querySelector('.te-header span').textContent = modeLabels[currentMode] || '解释';
    bubbleBody.innerHTML = '';
    addBubbleMessage('assistant', content);

    bubble.querySelector('.te-input-bar').style.display = 'flex';
    bubble.querySelector('.te-bubble-actions').style.display = 'flex';
    bubbleInput.focus();

    // 翻译模式：荧光笔高亮原文
    if (currentMode === 'translate' && lastTranslatedRange) {
      highlightPersistent(lastTranslatedRange);
      lastTranslatedRange = null;
    }
  }

  function addBubbleMessage(role, content) {
    if (!bubbleBody) return;
    var msg = document.createElement('div');
    msg.className = role === 'user' ? 'te-msg te-msg-user' : 'te-msg te-msg-ai';

    if (role === 'user') {
      msg.innerHTML = '<span class="te-msg-label">追问</span><p>' + content + '</p>';
    } else {
      msg.innerHTML = '<span class="te-msg-label">AI</span><div class="te-msg-content">' + renderMarkdown(content) + '</div>';
    }

    if (conversation.filter(function (c) { return c.role === 'user'; }).length > 1) {
      var divider = document.createElement('div');
      divider.className = 'te-msg-divider';
      bubbleBody.appendChild(divider);
    }

    bubbleBody.appendChild(msg);
    bubbleBody.scrollTop = bubbleBody.scrollHeight;
  }

  function addUserMessage(text) {
    conversation.push({ role: 'user', content: text });
    addBubbleMessage('user', text);

    var loading = document.createElement('div');
    loading.className = 'te-msg-loading';
    loading.textContent = 'AI 思考中...';
    bubbleBody.appendChild(loading);
    bubbleBody.scrollTop = bubbleBody.scrollHeight;
  }

  function removeLastLoading() {
    var loadings = bubbleBody.querySelectorAll('.te-msg-loading');
    loadings.forEach(function (el) { el.remove(); });
  }

  function showError(msg) {
    if (!bubble) return;
    bubble.querySelector('.te-header span').textContent = '出错了';
    bubbleBody.innerHTML = '<div class="te-error-msg"><p>' + msg + '</p></div>';
  }

  // ======== 高亮 ========
  function highlightSelection(range) {
    try {
      // 检查是否已在荧光笔高亮 span 内，避免重复包裹
      var ancestor = range.commonAncestorContainer;
      var persistParent = ancestor.nodeType === 1 ? ancestor.closest('.te-hl-persist') : (ancestor.parentElement ? ancestor.parentElement.closest('.te-hl-persist') : null);
      if (persistParent) {
        // 已在荧光笔内，直接给荧光笔添加临时高亮类
        persistParent.classList.add('te-highlight');
        if (highlights.indexOf(persistParent) === -1) {
          highlights.push(persistParent);
        }
        return;
      }
      var span = document.createElement('span');
      span.className = 'te-highlight';
      safeSurround(range, span);
      highlights.push(span);
    } catch (e) {}
  }

  // 安全的 range 包裹：extractContents → span 收纳 → insertNode，失败时原样恢复
  function safeSurround(range, wrapper) {
    // 保存 extractContents 之前的边界引用，用于恢复
    var startNode = range.startContainer;
    var startOff = range.startOffset;
    var endNode = range.endContainer;
    var endOff = range.endOffset;

    var frag = range.extractContents();
    wrapper.appendChild(frag); // frag 内容移入 wrapper，frag 变空
    try {
      range.insertNode(wrapper);
    } catch (e) {
      // insertNode 失败 → 把内容从 wrapper 移回新 fragment，恢复到 range 原位
      var restoreFrag = document.createDocumentFragment();
      while (wrapper.firstChild) {
        restoreFrag.appendChild(wrapper.firstChild);
      }
      try {
        range.insertNode(restoreFrag);
      } catch (e2) {
        // range 已失效，用保存的边界引用恢复
        try {
          var parent = startNode.nodeType === 3 ? startNode.parentNode : startNode;
          if (!parent) throw e2;
          var refChild = startNode.nodeType === 3 ? startNode : startNode.childNodes[startOff] || null;
          parent.insertBefore(restoreFrag, refChild);
        } catch (e3) {
          // 彻底失败：append 到 body（保底，文字至少还在页面上）
          document.body.appendChild(restoreFrag);
        }
      }
      throw e;
    }
  }

  function removeAllHighlights() {
    highlights.forEach(function (el) {
      // 如果是荧光笔 span 被临时添加了 te-highlight 类，只移除类名
      if (el.classList.contains('te-hl-persist')) {
        el.classList.remove('te-highlight');
        return;
      }
      var parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      }
    });
    highlights = [];
  }

  // ======== 荧光笔持久高亮 ========
  function highlightPersistent(range) {
    try {
      var span = document.createElement('span');
      span.className = 'te-hl-persist';
      safeSurround(range, span);
      persistentHighlights.push(span);
    } catch (e) {
      // safeSurround 内部已处理错误恢复
    }
  }

  // ======== 多词模式 ========
  function exitMultiMode() {
    multiMode = false;
    pendingWords = [];
    lastSelection = '';
    lastRange = null;
    lastTranslatedRange = null;
    removeAllHighlights();
    removeGreenDot();
    removeBadge();
    removeBubble();
  }

  // ======== 计算气泡位置 ========
  function calcBubblePos() {
    var sel = window.getSelection();
    var BW = 370;
    var GAP = 12;

    if (sel && sel.rangeCount > 0) {
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0) {
        if (rect.right + BW + GAP < window.innerWidth) {
          return { x: rect.right + GAP, y: rect.top - 10 };
        }
        if (rect.left - BW - GAP > 0) {
          return { x: rect.left - BW - GAP, y: rect.top - 10 };
        }
        return { x: Math.max(GAP, rect.left), y: rect.bottom + GAP };
      }
      return { x: Math.max(GAP, rect.left - BW / 2), y: rect.bottom + GAP };
    }
    return { x: (window.innerWidth - BW) / 2, y: window.innerHeight / 3 };
  }

  // ======== 智能检测：名词 or 句子 ========
  function detectTextType(text) {
    // 包含中文标点 → 句子
    if (/[。！？；：，、（《【]/.test(text)) return 'passage';
    // 纯中文，8字以内 → 名词/术语
    if (/^[一-龥a-zA-Z0-9]+$/.test(text) && text.length <= 8) return 'word';
    // 有空格且超过3个单词 → 句子
    if (/\s/.test(text) && text.split(/\s+/).length > 3) return 'passage';
    // 超过20字 → 句子
    if (text.length > 20) return 'passage';
    // 其余 → 名词/术语
    return 'word';
  }

  // ======== 英文检测 ========
  function isEnglish(text) {
    return /[a-zA-Z]/.test(text);
  }

  // ======== 触发解释 ========
  function triggerExplain(text) {
    var pos = calcBubblePos();
    if (translateMode && isEnglish(text)) {
      currentMode = 'translate';
    } else {
      currentMode = detectTextType(text);
    }
    bubble = createBubble(pos.x, pos.y);
    conversation.push({ role: 'user', content: text });

    chrome.runtime.sendMessage({ type: 'explain', text: text, mode: currentMode }, function (res) {
      if (chrome.runtime.lastError) { showError('通信失败，请刷新页面后重试'); return; }
      if (res.success) { showResult(res.content); }
      else { showError(res.error); }
    });
  }

  // ======== 追问 ========
  function doFollowup(question) {
    var history = [
      { role: 'system', content: '继续对话' }
    ].concat(conversation.map(function (c) { return { role: c.role, content: c.content }; }));

    chrome.runtime.sendMessage({ type: 'followup', history: history }, function (res) {
      removeLastLoading();
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) {
        conversation.push({ role: 'assistant', content: res.content });
        addBubbleMessage('assistant', res.content);
      } else {
        var errMsg = document.createElement('div');
        errMsg.className = 'te-error-msg';
        errMsg.innerHTML = '<p>追问失败：' + res.error + '</p>';
        bubbleBody.appendChild(errMsg);
      }
    });
  }

  function explainBatch() {
    if (pendingWords.length === 0) return;
    var words = pendingWords.slice();
    var text = words.join('、');
    pendingWords = [];
    removeBadge();

    currentMode = 'word';
    var x = (window.innerWidth - 360) / 2;
    var y = 60;
    bubble = createBubble(x, y);
    conversation.push({ role: 'user', content: text });

    chrome.runtime.sendMessage({ type: 'explain', text: text, mode: 'batch' }, function (res) {
      if (chrome.runtime.lastError) { showError('通信失败'); return; }
      if (res.success) {
        conversation.push({ role: 'assistant', content: res.content });
        bubble.querySelector('.te-header span').textContent = '多词解释';
        bubbleBody.innerHTML = '';
        var lines = res.content.split('\n').filter(function (l) { return l.trim(); });
        bubbleBody.innerHTML = lines.map(function (l) { return '<p>' + l + '</p>'; }).join('');
        bubble.querySelector('.te-input-bar').style.display = 'flex';
        bubble.querySelector('.te-bubble-actions').style.display = 'flex';
      } else {
        showError(res.error);
      }
    });
  }

  // ======== 鼠标事件 ========
  document.addEventListener('mousemove', function (e) {
    if (multiMode) moveGreenDot(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', function (e) {
    var sel = window.getSelection();
    var text = (sel ? sel.toString() : '').trim();
    if (!text || text.length > 2000) return;
    if (bubble && bubble.contains(e.target)) return;
    if (floatBall && floatBall.contains(e.target)) return;

    if (multiMode) {
      lastSelection = text;
      try { lastRange = sel.getRangeAt(0).cloneRange(); } catch (e) { lastRange = null; }
      e.preventDefault();
      e.stopPropagation();
    } else {
      if (translateMode && isEnglish(text)) {
        try { lastTranslatedRange = sel.getRangeAt(0).cloneRange(); } catch (e) { lastTranslatedRange = null; }
      }
      triggerExplain(text);
    }
  });

  // ======== 键盘事件 ========
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Control' && !e.repeat) {
      var now = Date.now();
      if (now - lastCtrlTime < 500) {
        e.preventDefault();
        e.stopPropagation();
        if (multiMode) { exitMultiMode(); }
        else {
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
      if (lastSelection && pendingWords.indexOf(lastSelection) === -1) {
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

  // ======== 点击外部 ========
  document.addEventListener('mousedown', function (e) {
    if (isDragging) return;
    if (floatBall && floatBall.contains(e.target)) return;
    if (bubble && !bubble.contains(e.target)) {
      // 不关闭气泡，由用户点关闭按钮或收起控制
    }
  });
})();
