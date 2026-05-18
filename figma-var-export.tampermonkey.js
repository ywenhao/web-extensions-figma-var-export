// ==UserScript==
// @name         figma-var-export
// @namespace    https://github.com/ywenhao/figma-var-export
// @version      0.1.0
// @description  Add an Export vars.css action to Figma's variables panel.
// @match        https://www.figma.com/*
// @match        https://figma.com/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_MODES_LABEL = 'Export modes'
  const EXPORT_VARS_LABEL = 'Export vars.css'
  const OUTPUT_FILE_NAME = 'vars.css'
  const INSTALL_KEY = '__figmaVarExportUserscriptInstalled'
  const DEFAULT_PRIMARY_MODE_NAMES = ['Light', 'Main']

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
  let hideTimer
  let pendingExport
  let scanTimer
  let toastElement

  // Workflow:
  // 1. Hook browser download primitives before Figma starts exporting.
  // 2. Watch Figma's menu DOM and clone "Export modes" as "Export vars.css".
  // 3. On click, arm a short-lived zip capture and trigger Figma's native export.
  // 4. Convert captured *.tokens.json files from theme.zip into vars.css.
  installCaptureHooks()
  startMenuObserver()

  // Tampermonkey runs this script in the page context with @grant none, so these
  // hooks can see the blob/data URLs created by Figma's own export code.
  function installCaptureHooks() {
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
        return undefined
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
  }

  // Figma renders menus dynamically. A MutationObserver lets the script add the
  // custom menu item whenever the variables panel menu is opened.
  function startMenuObserver() {
    const root = document.documentElement

    if (!root) {
      window.setTimeout(startMenuObserver, 100)
      return
    }

    const observer = new MutationObserver(scheduleScan)
    observer.observe(root, {
      childList: true,
      subtree: true,
    })

    scheduleScan()
  }

  // Debounce DOM scans because Figma updates many nodes during menu rendering.
  function scheduleScan() {
    if (scanTimer !== undefined) {
      window.clearTimeout(scanTimer)
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      installExportVarsItems()
    }, 100)
  }

  // Clone the native menu item instead of rebuilding styles; this keeps the
  // inserted action visually aligned with Figma even if their class names change.
  function installExportVarsItems() {
    const exportModeItems = findExportModeMenuItems()

    for (const originalItem of exportModeItems) {
      if (hasInjectedSibling(originalItem)) {
        continue
      }

      const exportVarsItem = createExportVarsMenuItem(originalItem)
      originalItem.insertAdjacentElement('afterend', exportVarsItem)
    }
  }

  // The menu item has no stable public selector, so locate it by visible text
  // and then walk upward to the clickable menu row.
  function findExportModeMenuItems() {
    const items = new Set()

    if (!document.body) {
      return []
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)

    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = normalizeText(node.nodeValue)

      if (text !== EXPORT_MODES_LABEL) {
        continue
      }

      const element = node.parentElement
      const menuItem = element ? findMenuItemElement(element) : undefined

      if (menuItem && isVisible(menuItem)) {
        items.add(menuItem)
      }
    }

    return [...items]
  }

  // The cloned row must stop Figma's native handlers, then run this script's
  // export flow against the original row.
  function createExportVarsMenuItem(originalItem) {
    const item = originalItem.cloneNode(true)

    removeIds(item)
    replaceText(item, EXPORT_MODES_LABEL, EXPORT_VARS_LABEL)
    item.dataset.figmaVarExportMenuItem = 'true'
    item.setAttribute('aria-label', EXPORT_VARS_LABEL)
    item.setAttribute('title', EXPORT_VARS_LABEL)

    item.addEventListener('pointerdown', stopNativeMenuPropagation, true)
    item.addEventListener('pointerup', stopNativeMenuPropagation, true)
    item.addEventListener('mousedown', stopNativeMenuPropagation, true)
    item.addEventListener('mouseup', stopNativeMenuPropagation, true)
    item.addEventListener(
      'click',
      (event) => {
        stopNativeMenuClick(event)
        beginExport(originalItem)
      },
      true,
    )

    return item
  }

  function stopNativeMenuPropagation(event) {
    event.stopImmediatePropagation()
  }

  function stopNativeMenuClick(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  // Arm capture first, then click Figma's original export action. The next zip
  // download produced by Figma is intercepted and converted instead of saved.
  function beginExport(originalMenuItem) {
    if (!getFflate()) {
      showToast('Cannot load fflate. Check Tampermonkey @require access and try again.', 'error')
      return
    }

    if (pendingExport) {
      finishPendingExport()
    }

    const requestId = createRequestId()
    const timeoutTimer = window.setTimeout(() => {
      if (pendingExport?.requestId !== requestId) {
        return
      }

      finishPendingExport()
      showToast('No theme.zip was captured. Figma may have changed its export flow.', 'error')
    }, 20000)

    pendingExport = {
      originalMenuItem,
      requestId,
      timeoutTimer,
    }

    activeCapture = {
      requestId,
    }

    showToast('Reading Figma theme.zip...')
    window.setTimeout(() => activateMenuItem(originalMenuItem), 0)
  }

  // Capture anchors, window.open, blob URLs, and data URLs because Figma's
  // export implementation may use any of these browser download paths.
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

      void finishCaptureWithBlob(blob, download)
      return true
    }

    if (url.startsWith('blob:') && isZipFileName(download)) {
      const capture = takeActiveCapture()

      if (!capture) {
        return false
      }

      fetch(url)
        .then((response) => response.blob())
        .then((blobValue) => finishCaptureWithBlob(blobValue, download, capture))
        .catch((error) => failCapture(error, capture.requestId))

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

  // Once a likely theme.zip has been found, consume the active capture so later
  // downloads on the page are not accidentally intercepted.
  function takeActiveCapture() {
    const capture = activeCapture

    if (capture) {
      activeCapture = undefined
    }

    return capture
  }

  // This is the handoff point from "intercept Figma zip" to "generate css".
  async function finishCaptureWithBlob(blob, download, capture = takeActiveCapture()) {
    if (!capture) {
      return
    }

    try {
      const zip = await blob.arrayBuffer()
      handleCapturedZip(zip, download, capture.requestId)
    } catch (error) {
      failCapture(error, capture.requestId)
    }
  }

  // Data URLs are rare for large files, but supporting them keeps the capture
  // logic aligned with the extension version.
  function finishCaptureWithDataUrl(url, download) {
    const capture = takeActiveCapture()

    if (!capture) {
      return
    }

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

      handleCapturedZip(zip.buffer, download, capture.requestId)
    } catch (error) {
      failCapture(error, capture.requestId)
    }
  }

  // Keep the final download separate from the capture hooks; by this point
  // activeCapture has already been cleared so vars.css is not intercepted.
  function handleCapturedZip(zip, download, requestId) {
    if (!pendingExport || pendingExport.requestId !== requestId) {
      return
    }

    try {
      const result = tokensZipToCss(zip)
      downloadTextFile(OUTPUT_FILE_NAME, result.css, 'text/css')
      showToast(`Downloaded ${OUTPUT_FILE_NAME}`, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(message, 'error')
    } finally {
      finishPendingExport()
    }
  }

  function failCapture(error, requestId = activeCapture?.requestId) {
    const message = error instanceof Error ? error.message : String(error)

    if (activeCapture?.requestId === requestId) {
      activeCapture = undefined
    }

    if (!pendingExport || pendingExport.requestId !== requestId) {
      return
    }

    finishPendingExport()
    showToast(message || 'Failed to capture theme.zip.', 'error')
  }

  // Figma requires a real user-like activation path here; dispatching the same
  // pointer/mouse sequence as the extension preserves the native export flow.
  function activateMenuItem(menuItem) {
    const eventInit = {
      bubbles: true,
      button: 0,
      cancelable: true,
      view: window,
    }

    dispatchPointerEvent(menuItem, 'pointerdown')
    menuItem.dispatchEvent(new MouseEvent('mousedown', eventInit))
    menuItem.dispatchEvent(new MouseEvent('mouseup', eventInit))
    menuItem.dispatchEvent(new MouseEvent('click', eventInit))
  }

  function dispatchPointerEvent(element, type) {
    if (!('PointerEvent' in window)) {
      return
    }

    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        pointerType: 'mouse',
        view: window,
      }),
    )
  }

  function finishPendingExport() {
    if (!pendingExport) {
      return
    }

    window.clearTimeout(pendingExport.timeoutTimer)

    if (activeCapture?.requestId === pendingExport.requestId) {
      activeCapture = undefined
    }

    pendingExport = undefined
  }

  function hasInjectedSibling(originalItem) {
    const parent = originalItem.parentElement

    if (!parent) {
      return false
    }

    return Boolean(parent.querySelector(':scope > [data-figma-var-export-menu-item="true"]'))
  }

  function findMenuItemElement(element) {
    let current = element
    let fallback

    for (let depth = 0; current && depth < 8; depth += 1) {
      if (normalizeText(current.textContent) === EXPORT_MODES_LABEL) {
        fallback = current
      }

      if (
        current.matches(
          '[role="menuitem"], [role="menuitemradio"], button, [tabindex], [data-testid*="menu" i]',
        )
      ) {
        return current
      }

      current = current.parentElement
    }

    return fallback
  }

  function replaceText(element, from, to) {
    let replaced = false
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

    while (walker.nextNode()) {
      const node = walker.currentNode

      if (node.nodeValue?.includes(from)) {
        node.nodeValue = node.nodeValue.replace(from, to)
        replaced = true
      }
    }

    if (!replaced) {
      element.textContent = to
    }
  }

  function removeIds(element) {
    if (element.id) {
      element.removeAttribute('id')
    }

    for (const child of element.querySelectorAll('[id]')) {
      child.removeAttribute('id')
    }
  }

  function normalizeText(text) {
    return text?.replace(/\s+/g, ' ').trim() ?? ''
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)

    return (
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    )
  }

  function createRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function downloadTextFile(fileName, content, mimeType) {
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

  function showToast(message, variant = 'info') {
    ensureToastElement()

    if (!toastElement) {
      return
    }

    toastElement.textContent = message
    toastElement.dataset.variant = variant
    toastElement.hidden = false

    if (hideTimer) {
      window.clearTimeout(hideTimer)
    }

    hideTimer = window.setTimeout(
      () => {
        if (toastElement) {
          toastElement.hidden = true
        }
      },
      variant === 'error' ? 6500 : 3000,
    )
  }

  function ensureToastElement() {
    if (toastElement) {
      return
    }

    const style = document.createElement('style')
    style.textContent = `
      #figma-var-export-toast {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        padding: 10px 12px;
        border: 1px solid rgb(36 41 47 / 14%);
        border-radius: 8px;
        box-shadow: 0 8px 26px rgb(0 0 0 / 18%);
        color: #ffffff;
        background: #24292f;
        font: 12px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      #figma-var-export-toast[hidden] {
        display: none;
      }

      #figma-var-export-toast[data-variant="success"] {
        background: #0f766e;
      }

      #figma-var-export-toast[data-variant="error"] {
        background: #b42318;
      }
    `

    toastElement = document.createElement('div')
    toastElement.id = 'figma-var-export-toast'
    toastElement.hidden = true

    document.documentElement.append(style, toastElement)
  }

  // Convert Figma's theme.zip into CSS using the same behavior as the extension:
  // sort token files, choose Light/Main as primary when present, then emit
  // :root plus per-mode override selectors.
  function tokensZipToCss(input) {
    const fflateApi = getFflate()

    if (!fflateApi) {
      throw new Error('Cannot load fflate. Check Tampermonkey @require access and try again.')
    }

    const archive = fflateApi.unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input))
    const modes = findThemeModeEntries(archive, fflateApi)
    const modeNames = modes.map((mode) => mode.modeName)
    const primaryModeName = resolvePrimaryThemeModeName(modeNames)
    const css = `${generateThemeModesCss(
      modes.map((mode) => ({
        name: mode.modeName,
        tokens: mode.tokens,
      })),
      { primaryModeName },
    )}\n`

    return {
      css,
      files: modes.map((mode) => ({
        fileName: mode.fileName,
        modeName: mode.modeName,
      })),
      modeNames,
      primaryModeName,
    }
  }

  // Figma mode files are named like "Light.tokens.json"; the basename before
  // that suffix becomes the CSS mode name.
  function findThemeModeEntries(files, fflateApi) {
    const tokenFileNames = Object.keys(files)
      .filter((name) => !name.endsWith('/'))
      .filter((name) => {
        const basename = getBasename(name).toLowerCase()
        return basename.endsWith('.tokens.json')
      })
      .toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

    if (tokenFileNames.length === 0) {
      throw new Error('Cannot find any *.tokens.json file in theme.zip.')
    }

    return tokenFileNames.map((fileName) => ({
      fileName,
      modeName: getModeName(fileName),
      tokens: parseTokenJson(files[fileName], fileName, fflateApi),
    }))
  }

  function parseTokenJson(content, fileName, fflateApi) {
    if (!content) {
      throw new Error(`Cannot read ${fileName} from theme.zip.`)
    }

    try {
      return JSON.parse(fflateApi.strFromU8(content))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Cannot parse ${fileName}: ${message}`, { cause: error })
    }
  }

  function getBasename(path) {
    return path.split(/[\\/]/).pop() ?? path
  }

  function getModeName(fileName) {
    const basename = getBasename(fileName)
    const modeName = basename.replace(/\.tokens\.json$/i, '').trim()

    if (!modeName) {
      throw new Error(`Cannot derive a mode name from ${fileName}.`)
    }

    return modeName
  }

  // Flatten nested design-token groups into CSS custom-property names.
  function generateThemeModesCss(modes, options = {}) {
    const endOfLine = options.endOfLine ?? '\n'
    const primaryModeName = resolvePrimaryThemeModeName(
      modes.map((mode) => mode.name),
      options,
    )
    const primaryFlat = flattenTokens(findModeByName(modes, primaryModeName).tokens)
    const primaryKeys = Array.from(primaryFlat.keys())
    const lines = []

    lines.push(':root {')

    for (const key of primaryKeys) {
      lines.push(`  --${normalizeTokenName(key)}: ${formatTokenValue(primaryFlat.get(key))};`)
    }

    lines.push('}')

    for (const mode of modes) {
      if (isSameModeName(mode.name, primaryModeName)) {
        continue
      }

      const modeFlat = flattenTokens(mode.tokens)
      const overrideKeys = Array.from(modeFlat.keys()).filter((key) => {
        const primaryValue = primaryFlat.get(key)
        const modeValue = modeFlat.get(key)
        return formatTokenValue(primaryValue) !== formatTokenValue(modeValue)
      })

      if (overrideKeys.length === 0) {
        continue
      }

      lines.push('')
      lines.push(`${toModeSelector(mode.name)} {`)

      for (const key of overrideKeys) {
        lines.push(`  --${normalizeTokenName(key)}: ${formatTokenValue(modeFlat.get(key))};`)
      }

      lines.push('}')
    }

    return lines.join(endOfLine)
  }

  function resolvePrimaryThemeModeName(modeNames, options = {}) {
    if (modeNames.length === 0) {
      throw new Error('At least one theme mode is required.')
    }

    if (options.primaryModeName) {
      const explicitMode = modeNames.find((modeName) =>
        isSameModeName(modeName, options.primaryModeName),
      )

      if (!explicitMode) {
        throw new Error(
          `Primary mode "${options.primaryModeName}" was not found. Available modes: ${modeNames.join(', ')}`,
        )
      }

      return explicitMode
    }

    const preferredNames = options.preferredPrimaryModeNames ?? DEFAULT_PRIMARY_MODE_NAMES

    for (const preferredName of preferredNames) {
      const preferredMode = modeNames.find((modeName) => isSameModeName(modeName, preferredName))

      if (preferredMode) {
        return preferredMode
      }
    }

    return modeNames[0]
  }

  function flattenTokens(node, pathSegments = [], result = new Map()) {
    if (!node || typeof node !== 'object') {
      return result
    }

    if (isTokenLeaf(node)) {
      result.set(pathSegments.join('-'), node.$value)
      return result
    }

    for (const [key, value] of Object.entries(node)) {
      if (isTokenMetadataKey(key)) {
        continue
      }

      flattenTokens(value, [...pathSegments, key], result)
    }

    return result
  }

  function isTokenLeaf(value) {
    if (!value || typeof value !== 'object') {
      return false
    }

    return '$type' in value && '$value' in value
  }

  function isTokenMetadataKey(key) {
    return key.startsWith('$')
  }

  function findModeByName(modes, modeName) {
    const mode = modes.find((item) => isSameModeName(item.name, modeName))

    if (!mode) {
      throw new Error(`Theme mode "${modeName}" was not found.`)
    }

    return mode
  }

  function isSameModeName(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
  }

  function normalizeTokenName(name) {
    return name.replace(/\s+/g, '-').replace(/\./g, '-')
  }

  function toModeSelector(modeName) {
    const normalizedModeName = modeName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    if (normalizedModeName.length === 0) {
      return '.theme-mode'
    }

    if (/^\d/.test(normalizedModeName)) {
      return `.theme-${normalizedModeName}`
    }

    return `.${normalizedModeName}`
  }

  function formatTokenValue(value) {
    if (typeof value === 'string') {
      const trimmedValue = value.trim()
      const referenceMatch = trimmedValue.match(/^\{(.+)\}$/)

      if (referenceMatch) {
        return `var(--${normalizeTokenName(referenceMatch[1])})`
      }

      return trimmedValue
    }

    if (!value) {
      return ''
    }

    return formatColorValue(value)
  }

  function formatColorValue(value) {
    const alpha = value.alpha ?? 1

    if (Math.abs(alpha - 1) < 1e-6) {
      return value.hex.toLowerCase()
    }

    const [red, green, blue] = value.components.map((component) => Math.round(component * 255))

    return `rgb(${red} ${green} ${blue} / ${formatAlpha(alpha)})`
  }

  function formatAlpha(alpha) {
    const percentage = Math.round(alpha * 1000) / 10
    return `${Number.isInteger(percentage) ? percentage.toFixed(0) : String(percentage)}%`
  }

  function getFflate() {
    const fflateApi = window.fflate

    if (!fflateApi?.unzipSync || !fflateApi?.strFromU8) {
      return undefined
    }

    return fflateApi
  }
})()
