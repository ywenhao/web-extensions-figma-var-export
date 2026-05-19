export async function copyTextToClipboard(content: string): Promise<void> {
  let clipboardError: unknown

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content)
      return
    } catch (error) {
      clipboardError = error
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = content
  textArea.readOnly = true
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '0'

  const parent = document.body || document.documentElement
  parent.append(textArea)
  textArea.focus()
  textArea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command was rejected.')
    }
  } catch (error) {
    throw clipboardError instanceof Error ? clipboardError : error
  } finally {
    textArea.remove()
  }
}
