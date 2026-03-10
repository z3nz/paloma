import { marked } from 'marked'

export function extractAnnotatedCodeBlocks(markdown) {
  const tokens = marked.lexer(markdown)
  const blocks = []

  for (const token of tokens) {
    if (token.type !== 'code' || !token.lang) continue

    const colonIdx = token.lang.indexOf(':')
    if (colonIdx === -1) continue

    const lang = token.lang.slice(0, colonIdx).trim()
    const path = token.lang.slice(colonIdx + 1).trim()
    if (!path) continue

    // Reject paths that could escape the project root
    if (path.includes('..') || path.startsWith('/')) continue

    blocks.push({ lang, path, code: token.text })
  }

  return blocks
}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
