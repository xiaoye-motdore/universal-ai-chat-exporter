/** Saves text as a file through a temporary object URL. Nothing is stored or sent. */
export function downloadText(text, filename, mimeType, doc) {
  const d = doc || document
  const blob = new Blob([text], { type: mimeType || 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = d.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  d.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
