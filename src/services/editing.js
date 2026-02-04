const SEARCH_MARKER = '<<<<<<< SEARCH'
const DIVIDER_MARKER = '======='
const REPLACE_MARKER = '>>>>>>> REPLACE'

export function hasSearchReplaceMarkers(code) {
  return code.includes(SEARCH_MARKER)
}

export function parseSearchReplace(code) {
  const blocks = code.split(SEARCH_MARKER)
  // First element is text before any marker — should be empty/whitespace
  blocks.shift()

  if (blocks.length === 0) {
    throw new Error('No SEARCH/REPLACE blocks found')
  }

  const pairs = []
  for (const block of blocks) {
    const dividerIdx = block.indexOf(DIVIDER_MARKER)
    if (dividerIdx === -1) {
      throw new Error('SEARCH block missing ======= divider')
    }
    const afterDivider = block.slice(dividerIdx + DIVIDER_MARKER.length)
    const replaceIdx = afterDivider.indexOf(REPLACE_MARKER)
    if (replaceIdx === -1) {
      throw new Error('SEARCH block missing >>>>>>> REPLACE marker')
    }

    let search = block.slice(0, dividerIdx)
    let replace = afterDivider.slice(0, replaceIdx)

    // Trim one leading newline (the marker line introduces it)
    if (search.startsWith('\n')) search = search.slice(1)
    if (replace.startsWith('\n')) replace = replace.slice(1)

    // Trim one trailing newline (before the marker)
    if (search.endsWith('\n')) search = search.slice(0, -1)
    if (replace.endsWith('\n')) replace = replace.slice(0, -1)

    if (search.length === 0) {
      throw new Error('Empty SEARCH block is not allowed')
    }

    pairs.push({ search, replace })
  }

  return pairs
}

export function applySearchReplace(original, pairs) {
  let result = original
  const applied = []

  for (const pair of pairs) {
    const firstIdx = result.indexOf(pair.search)
    if (firstIdx === -1) {
      throw new Error(
        `Search block not found in file:\n${pair.search.slice(0, 100)}${pair.search.length > 100 ? '...' : ''}`
      )
    }
    const lastIdx = result.lastIndexOf(pair.search)
    if (firstIdx !== lastIdx) {
      const count = result.split(pair.search).length - 1
      throw new Error(
        `Search block matches ${count} locations. Include more context to make the match unique.`
      )
    }

    result = result.slice(0, firstIdx) + pair.replace + result.slice(firstIdx + pair.search.length)
    applied.push(pair)
  }

  return { result, applied }
}

export function resolveEdit(code, originalContent) {
  if (!hasSearchReplaceMarkers(code)) {
    return { newContent: code, mode: 'full' }
  }

  if (originalContent === null) {
    throw new Error('Cannot use SEARCH/REPLACE on a new file. Use full file content instead.')
  }

  const pairs = parseSearchReplace(code)
  const { result } = applySearchReplace(originalContent, pairs)
  return { newContent: result, mode: 'search-replace' }
}
