let toastElement: HTMLDivElement | undefined
let hideTimer: number | undefined

export function showToast(message: string, variant: 'error' | 'info' | 'success' = 'info'): void {
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

function ensureToastElement(): void {
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
