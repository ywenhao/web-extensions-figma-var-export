;(() => {
  const EXTENSION_SOURCE = 'figma-var-export-extension'
  const PAGE_SOURCE = 'figma-var-export-page'
  const INSTALL_KEY = '__figmaVarExportPageBridgeInstalled'

  if (window[INSTALL_KEY]) {
    return
  }

  window[INSTALL_KEY] = true

  const nativeCreateObjectURL = URL.createObjectURL.bind(URL)
  const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL)
  const nativeAnchorClick = HTMLAnchorElement.prototype.click
  const nativeWindowOpen = window.open.bind(window)
  const blobUrls = new Map()
  let activeCapture

  URL.createObjectURL = function createObjectURL(value) {
    const url = nativeCreateObjectURL(value)

    if (value instanceof Blob) {
      blobUrls.set(url, value)
    }

    return url
  }

  URL.revokeObjectURL = function revokeObjectURL(url) {
    window.setTimeout(() => blobUrls.delete(url), 5000)
    return nativeRevokeObjectURL(url)
  }

  HTMLAnchorElement.prototype.click = function click() {
    if (tryCaptureAnchor(this)) {
      return
    }

    return nativeAnchorClick.call(this)
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      const anchor = target instanceof Element ? target.closest('a') : undefined

      if (anchor && tryCaptureAnchor(anchor)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true,
  )

  window.open = function open(url, target, features) {
    if (typeof url === 'string' && tryCaptureUrl(url, '')) {
      return null
    }

    return nativeWindowOpen(url, target, features)
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return
    }

    const data = event.data

    if (!data || data.source !== EXTENSION_SOURCE || data.type !== 'start-capture') {
      return
    }

    startCapture(data.requestId)
  })

  function startCapture(requestId) {
    if (activeCapture?.timer) {
      window.clearTimeout(activeCapture.timer)
    }

    activeCapture = {
      requestId,
      timer: window.setTimeout(() => {
        if (activeCapture?.requestId === requestId) {
          activeCapture = undefined
        }
      }, 20000),
    }

    postToContent({
      requestId,
      source: PAGE_SOURCE,
      type: 'capture-ready',
    })
  }

  function tryCaptureAnchor(anchor) {
    if (!activeCapture) {
      return false
    }

    const download = anchor.getAttribute('download') || ''
    const href = anchor.href || anchor.getAttribute('href') || ''

    return tryCaptureUrl(href, download)
  }

  function tryCaptureUrl(url, download) {
    if (!activeCapture || !url) {
      return false
    }

    const blob = blobUrls.get(url)

    if (blob) {
      if (!isLikelyThemeZip(blob, download)) {
        return false
      }

      finishCaptureWithBlob(blob, download)
      return true
    }

    if (url.startsWith('blob:') && isZipFileName(download)) {
      fetch(url)
        .then((response) => response.blob())
        .then((blobValue) => finishCaptureWithBlob(blobValue, download))
        .catch((error) => failCapture(error))
      return true
    }

    if (url.startsWith('data:') && isLikelyZipDataUrl(url, download)) {
      finishCaptureWithDataUrl(url, download)
      return true
    }

    return false
  }

  function isLikelyThemeZip(blob, download) {
    const type = (blob.type || '').toLowerCase()

    return isZipFileName(download) || type.includes('zip') || type.includes('octet-stream')
  }

  function isZipFileName(fileName) {
    return (fileName || '').toLowerCase().endsWith('.zip')
  }

  function isLikelyZipDataUrl(url, download) {
    return (
      isZipFileName(download) ||
      /^data:application\/(?:zip|x-zip-compressed|octet-stream)/i.test(url)
    )
  }

  async function finishCaptureWithBlob(blob, download) {
    const capture = activeCapture

    if (!capture) {
      return
    }

    activeCapture = undefined
    window.clearTimeout(capture.timer)

    try {
      const zip = await blob.arrayBuffer()
      postToContent(
        {
          fileName: download || 'theme.zip',
          requestId: capture.requestId,
          source: PAGE_SOURCE,
          type: 'zip-captured',
          zip,
        },
        [zip],
      )
    } catch (error) {
      failCapture(error, capture.requestId)
    }
  }

  function finishCaptureWithDataUrl(url, download) {
    const capture = activeCapture

    if (!capture) {
      return
    }

    activeCapture = undefined
    window.clearTimeout(capture.timer)

    try {
      const commaIndex = url.indexOf(',')

      if (commaIndex === -1) {
        throw new Error('Invalid data URL.')
      }

      const meta = url.slice(0, commaIndex)
      const body = url.slice(commaIndex + 1)
      const binary = meta.endsWith(';base64') ? atob(body) : decodeURIComponent(body)
      const zip = new Uint8Array(binary.length)

      for (let index = 0; index < binary.length; index += 1) {
        zip[index] = binary.charCodeAt(index)
      }

      postToContent(
        {
          fileName: download || 'theme.zip',
          requestId: capture.requestId,
          source: PAGE_SOURCE,
          type: 'zip-captured',
          zip: zip.buffer,
        },
        [zip.buffer],
      )
    } catch (error) {
      failCapture(error, capture.requestId)
    }
  }

  function failCapture(error, requestId = activeCapture?.requestId) {
    const message = error instanceof Error ? error.message : String(error)

    if (activeCapture?.timer) {
      window.clearTimeout(activeCapture.timer)
    }

    activeCapture = undefined

    if (!requestId) {
      return
    }

    postToContent({
      message,
      requestId,
      source: PAGE_SOURCE,
      type: 'capture-error',
    })
  }

  function postToContent(message, transfer) {
    window.postMessage(message, '*', transfer || [])
  }
})()
