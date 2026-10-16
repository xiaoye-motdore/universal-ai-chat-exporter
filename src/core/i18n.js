const STRINGS = {
  en: {
    loading: 'Reading conversation…',
    unsupported: 'This site is not supported. Supported: {list}',
    planned: '{name} detected, but its exporter is not implemented yet.',
    noConversation: 'Open a conversation first (no conversation id in the URL).',
    empty: 'No messages found on this page.',
    exported: '{count} messages ready',
    partial: 'Export may be incomplete',
    source_api: 'source: API',
    source_dom: 'source: page',
    download: 'Download',
    close: 'Close',
    error: 'Export failed: {message}',
    branches: '{count} messages have other versions (edits / regenerations). Markdown shows the selected branch; JSON contains all versions.',
    dom_fallback: 'Read from the rendered page because the API was unavailable. Only loaded messages are included.',
  },
  zh: {
    loading: '正在读取对话…',
    unsupported: '当前网站不受支持。支持：{list}',
    planned: '已识别 {name}，但其导出功能尚未实现。',
    noConversation: '请先打开一个具体对话（URL 中没有对话 ID）。',
    empty: '页面上没有找到消息。',
    exported: '已读取 {count} 条消息',
    partial: '导出可能不完整',
    source_api: '来源：接口',
    source_dom: '来源：页面',
    download: '下载',
    close: '关闭',
    error: '导出失败：{message}',
    branches: '{count} 条消息存在其他版本（编辑 / 重新生成）。Markdown 只包含当前分支；JSON 包含全部版本。',
    dom_fallback: '接口不可用，已改为读取页面已渲染内容，只包含已加载的消息。',
  },
}

export function t(key, params, lang) {
  const language = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en'
  const table = STRINGS[language.toLowerCase().startsWith('zh') ? 'zh' : 'en']
  let text = table[key] || STRINGS.en[key] || key
  for (const k in params || {}) text = text.replace(`{${k}}`, String(params[k]))
  return text
}
