import { browser } from 'wxt/browser'

import { copyTextToClipboard } from '../clipboard'
import {
  COPY_VARS_LABEL,
  EXPORT_MODES_LABEL,
  EXPORT_VARS_LABEL,
  EXTENSION_SOURCE,
  FIGMA_MATCHES,
  OUTPUT_FILE_NAME,
  PAGE_SOURCE,
} from '../constants'
import { downloadTextFile } from '../download'
import { showToast } from '../toast'
import { tokensZipToCss } from '../tokens'

type VarsAction = 'copy' | 'download'

interface PendingExport {
  action: VarsAction
  originalMenuItem: HTMLElement
  readyTimer: number
  requestId: string
  timeoutTimer: number
}

const VARS_ACTION_LABELS: Record<VarsAction, string> = {
  copy: COPY_VARS_LABEL,
  download: EXPORT_VARS_LABEL,
}

type PageMessage =
  | {
      requestId: string
      source: typeof PAGE_SOURCE
      type: 'capture-ready'
    }
  | {
      fileName?: string
      requestId: string
      source: typeof PAGE_SOURCE
      type: 'zip-captured'
      zip: ArrayBuffer
    }
  | {
      message: string
      requestId: string
      source: typeof PAGE_SOURCE
      type: 'capture-error'
    }

let pendingExport: PendingExport | undefined
let scanTimer: number | undefined

export default defineContentScript({
  matches: FIGMA_MATCHES,
  runAt: 'document_idle',
  main() {
    injectPageBridge()
    window.addEventListener('message', handlePageMessage)

    const observer = new MutationObserver(scheduleScan)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })

    scheduleScan()
  },
})

function injectPageBridge(): void {
  if (document.documentElement.dataset.figmaVarExportBridgeInjected === 'true') {
    return
  }

  document.documentElement.dataset.figmaVarExportBridgeInjected = 'true'

  const script = document.createElement('script')
  script.src = browser.runtime.getURL('/page-bridge.js')
  script.async = false
  script.dataset.figmaVarExportBridge = 'true'
  script.addEventListener('load', () => script.remove(), { once: true })

  ;(document.head || document.documentElement).append(script)
}

function scheduleScan(): void {
  if (scanTimer) {
    window.clearTimeout(scanTimer)
  }

  scanTimer = window.setTimeout(() => {
    scanTimer = undefined
    installExportVarsItems()
  }, 100)
}

function installExportVarsItems(): void {
  const exportModeItems = findExportModeMenuItems()

  for (const originalItem of exportModeItems) {
    let insertAfter = originalItem

    for (const action of ['download', 'copy'] as const) {
      if (hasInjectedSibling(originalItem, action)) {
        continue
      }

      const exportVarsItem = createVarsMenuItem(originalItem, action)
      insertAfter.insertAdjacentElement('afterend', exportVarsItem)
      insertAfter = exportVarsItem
    }
  }
}

function findExportModeMenuItems(): HTMLElement[] {
  const items = new Set<HTMLElement>()
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

function createVarsMenuItem(originalItem: HTMLElement, action: VarsAction): HTMLElement {
  const item = originalItem.cloneNode(true) as HTMLElement
  const label = VARS_ACTION_LABELS[action]

  removeIds(item)
  replaceText(item, EXPORT_MODES_LABEL, label)
  item.dataset.figmaVarExportMenuItem = action
  item.setAttribute('aria-label', label)
  item.setAttribute('title', label)

  item.addEventListener('pointerdown', stopNativeMenuPropagation, true)
  item.addEventListener('pointerup', stopNativeMenuPropagation, true)
  item.addEventListener('mousedown', stopNativeMenuPropagation, true)
  item.addEventListener('mouseup', stopNativeMenuPropagation, true)
  item.addEventListener(
    'click',
    (event) => {
      stopNativeMenuClick(event)
      beginExport(originalItem, action)
    },
    true,
  )

  return item
}

function stopNativeMenuPropagation(event: Event): void {
  event.stopImmediatePropagation()
}

function stopNativeMenuClick(event: Event): void {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function beginExport(originalMenuItem: HTMLElement, action: VarsAction): void {
  if (pendingExport) {
    finishPendingExport()
  }

  const requestId = createRequestId()
  const readyTimer = window.setTimeout(() => {
    if (pendingExport?.requestId !== requestId) {
      return
    }

    finishPendingExport()
    showToast(
      'Cannot connect to figma-var-export page bridge. Reload Figma and try again.',
      'error',
    )
  }, 3000)
  const timeoutTimer = window.setTimeout(() => {
    if (pendingExport?.requestId !== requestId) {
      return
    }

    finishPendingExport()
    showToast('No theme.zip was captured. Figma may have changed its export flow.', 'error')
  }, 20000)

  pendingExport = {
    action,
    originalMenuItem,
    readyTimer,
    requestId,
    timeoutTimer,
  }

  showToast(action === 'copy' ? 'Preparing vars.css copy...' : 'Preparing vars.css export...')
  window.postMessage(
    {
      requestId,
      source: EXTENSION_SOURCE,
      type: 'start-capture',
    },
    '*',
  )
}

function handlePageMessage(event: MessageEvent): void {
  if (event.source !== window) {
    return
  }

  const data = event.data as Partial<PageMessage> | undefined

  if (
    !data ||
    data.source !== PAGE_SOURCE ||
    !data.requestId ||
    pendingExport?.requestId !== data.requestId
  ) {
    return
  }

  if (data.type === 'capture-ready') {
    window.clearTimeout(pendingExport.readyTimer)
    activateMenuItem(pendingExport.originalMenuItem)
    showToast('Reading Figma theme.zip...')
    return
  }

  if (data.type === 'capture-error') {
    finishPendingExport()
    showToast(data.message || 'Failed to capture theme.zip.', 'error')
    return
  }

  if (data.type === 'zip-captured' && data.zip) {
    void handleCapturedZip(data.zip)
  }
}

async function handleCapturedZip(zip: ArrayBuffer): Promise<void> {
  const action = pendingExport?.action

  if (!action) {
    return
  }

  try {
    const result = tokensZipToCss(zip)
    const css = result.css.trim()

    if (action === 'copy') {
      await copyTextToClipboard(css)
      showToast(`Copied ${OUTPUT_FILE_NAME}`, 'success')
    } else {
      downloadTextFile(OUTPUT_FILE_NAME, css, 'text/css')
      showToast(`Downloaded ${OUTPUT_FILE_NAME}`, 'success')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(message, 'error')
  } finally {
    finishPendingExport()
  }
}

function activateMenuItem(menuItem: HTMLElement): void {
  const eventInit: MouseEventInit = {
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

function dispatchPointerEvent(element: HTMLElement, type: string): void {
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

function finishPendingExport(): void {
  if (!pendingExport) {
    return
  }

  window.clearTimeout(pendingExport.readyTimer)
  window.clearTimeout(pendingExport.timeoutTimer)
  pendingExport = undefined
}

function hasInjectedSibling(originalItem: HTMLElement, action: VarsAction): boolean {
  const parent = originalItem.parentElement

  if (!parent) {
    return false
  }

  if (action === 'download') {
    return Boolean(
      parent.querySelector(
        ':scope > [data-figma-var-export-menu-item="download"], :scope > [data-figma-var-export-menu-item="true"]',
      ),
    )
  }

  return Boolean(parent.querySelector(':scope > [data-figma-var-export-menu-item="copy"]'))
}

function findMenuItemElement(element: HTMLElement): HTMLElement | undefined {
  let current: HTMLElement | null = element
  let fallback: HTMLElement | undefined

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

function replaceText(element: HTMLElement, from: string, to: string): void {
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

function removeIds(element: HTMLElement): void {
  if (element.id) {
    element.removeAttribute('id')
  }

  for (const child of element.querySelectorAll('[id]')) {
    child.removeAttribute('id')
  }
}

function normalizeText(text: string | null | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() ?? ''
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)

  return (
    rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  )
}

function createRequestId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
