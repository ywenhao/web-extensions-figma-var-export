export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'

  const parent = document.body || document.documentElement
  parent.append(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
