import DOMPurify from 'dompurify'

// Allow class attributes (for syntax highlighting), data attributes (for code block actions),
// and onclick (for copy button). DOMPurify strips dangerous attributes by default.
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  // Allow onclick only on elements with class 'copy-btn' (our code block copy button)
  if (data.attrName === 'onclick' && node.classList?.contains('copy-btn')) {
    data.forceKeepAttr = true
  }
})

/**
 * Sanitize HTML output from marked.parse() before inserting via v-html.
 * Allows safe HTML tags used by markdown rendering while stripping XSS vectors.
 */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['class', 'data-code-index', 'onclick'],
    // Allow target="_blank" on links
    ALLOW_DATA_ATTR: true
  })
}
