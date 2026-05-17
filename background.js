const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const TIMEOUT_MS = 20000;

// ======== 消息路由 ========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'explain') {
    explainText(request.text, request.mode).then(sendResponse);
    return true;
  }
  if (request.type === 'followup') {
    followupChat(request.history).then(sendResponse);
    return true;
  }
});

// ======== 词模式 Prompt ========
const WORD_PROMPT = `你是一个博学的老师。用户选中了一个词或短语，请用通俗易懂的语言解释它。

要求：
- 1-3句话解释清楚（80字以内）
- 语言通俗生动，避免学术腔
- 只输出解释本身，不要前缀后缀`;

// ======== 句段模式 Prompt ========
const PASSAGE_PROMPT = `你是一个博学的老师。用户选中了一段文字，请帮他理解这段话。

要求：
- 先简要概括这段话的核心意思（1-2句）
- 然后重点介绍怎么实际运用、具体怎么操作
- 最后举一个贴近生活的实例
- 控制在150字以内
- 语言通俗直接，偏实战，不要学术腔
- 可用 Markdown 格式：**加粗**强调重点、- 列表分点`;

// ======== 翻译 Prompt ========
const TRANSLATE_PROMPT = `你是一个专业的英中翻译。请将以下英文翻译成中文。

要求：
- 翻译准确自然，符合中文表达习惯
- 单词或短语：给出最贴切的中文对应
- 句子：保持原意和语气，可适当意译
- 只输出翻译结果本身，不要前缀后缀`;

// ======== 追问 Prompt ========
const FOLLOWUP_PROMPT = `你是一个博学的老师。用户刚才向你请教了一段文字的解释，现在他有了追问。请结合之前的对话上下文，回答他的追问。

要求：
- 视问题的难易程度控制回答长度：简单问题一两句说清即可，不要复杂化
- 回答要结合上文已经讨论过的内容
- 通俗易懂，必要时可举例子
- 控制在120字以内
- 可用 Markdown 格式`;

// ======== 单次解释 ========
async function explainText(text, mode) {
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey) {
    return { success: false, error: '请先点插件图标配置 API Key' };
  }

  const isTranslate = mode === 'translate';
  const isWord = mode === 'word';
  let systemPrompt, content;
  if (isTranslate) {
    systemPrompt = TRANSLATE_PROMPT;
    content = `请翻译：\n\n"${text}"`;
  } else if (isWord) {
    systemPrompt = WORD_PROMPT;
    content = text;
  } else {
    systemPrompt = PASSAGE_PROMPT;
    content = `请解释以下这段话：\n\n"${text}"`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        temperature: 0.5,
        max_tokens: (isTranslate || isWord) ? 200 : 500,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err.error?.message || `请求失败 (${resp.status})`;
      return { success: false, error: msg };
    }

    const data = await resp.json();
    return { success: true, content: data.choices[0].message.content.trim() };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return { success: false, error: '请求超时，请检查网络后重试' };
    }
    return { success: false, error: `网络异常：${e.message}` };
  }
}

// ======== 追问 ========
async function followupChat(history) {
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey) {
    return { success: false, error: '请先配置 API Key' };
  }

  // history 格式: [{role, content}, ...]
  // 在开头插入 system prompt
  const messages = [{ role: 'system', content: FOLLOWUP_PROMPT }, ...history];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.5,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err.error?.message || `请求失败 (${resp.status})`;
      return { success: false, error: msg };
    }

    const data = await resp.json();
    return { success: true, content: data.choices[0].message.content.trim() };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return { success: false, error: '请求超时' };
    }
    return { success: false, error: `网络异常：${e.message}` };
  }
}
