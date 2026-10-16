/**
 * Builds `<platform>-<YYYY-MM-DD>-<title>.<ext>`.
 * Keeps Unicode letters (CJK titles stay readable); strips only characters that are
 * unsafe in file names on Windows/macOS/Linux.
 */
export function safeTitle(title, maxLength) {
  const cleaned = String(title || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .replace(/ /g, '-')
  return cleaned.slice(0, maxLength || 80) || 'conversation'
}

export function buildFilename(platform, title, ext, date) {
  const d = date || new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${platform}-${stamp}-${safeTitle(title)}.${ext}`
}
