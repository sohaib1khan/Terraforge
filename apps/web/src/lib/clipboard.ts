/**
 * Clipboard write that also works outside a secure context.
 *
 * navigator.clipboard is only defined on https:// or localhost, so opening the
 * app over a LAN IP leaves it undefined. Fall back to a hidden textarea and
 * document.execCommand('copy') in that case.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the textarea approach */
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)

    const selection = document.getSelection()
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)

    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    return ok
  } catch {
    return false
  }
}

/** Select an element's contents so the user can press Ctrl+C manually. */
export function selectElementContents(el: HTMLElement | null): void {
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
