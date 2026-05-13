const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const TIMEOUT_MS = 15000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'explain') {
    explainText(request.text, request.mode).then(sendResponse);
    return true;
  }
});

async function explainText(text, mode) {
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey) {
    return { success: false, error: '请先点插件图标配置 API Key' };
  }

  const isSingle = mode === 'single';
  const systemPrompt = isSingle
    ? '用1-2句话（60字以内）解释用户选中的词，通俗易懂。只输出解释本身，不要前缀后缀。'
    : '用简洁的语言逐个解释以下名词（每个30字以内），格式为"名词：解释"。通俗易懂。只输出解释本身。';

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
          { role: 'user', content: isSingle ? text : text.join('、') },
        ],
        temperature: 0.3,
        max_tokens: isSingle ? 150 : 400,
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
