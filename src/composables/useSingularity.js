import { ref, computed } from 'vue'

function stringifyValue(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractStreamText(streamEvent = {}) {
  if (!streamEvent || typeof streamEvent !== 'object') return ''

  if (typeof streamEvent.text === 'string' && streamEvent.text) {
    return streamEvent.text
  }

  if (typeof streamEvent.content === 'string' && streamEvent.content) {
    return streamEvent.content
  }

  if (streamEvent.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta') {
    return streamEvent.delta.text || ''
  }

  if (streamEvent.type === 'assistant' && Array.isArray(streamEvent.message?.content)) {
    return streamEvent.message.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('')
  }

  if (streamEvent.type === 'agent_message' && streamEvent.text) {
    return streamEvent.text
  }

  return ''
}

function createGroup(payload = {}) {
  return {
    groupId: payload.groupId || payload.singularityGroupId || `singularity-${Date.now()}`,
    voicePillarId: payload.voicePillarId || null,
    thinkerPillarId: payload.thinkerPillarId || null,
    voiceReady: Boolean(payload.voiceReady),
    thinkerReady: Boolean(payload.thinkerReady),
    isComplete: Boolean(payload.isComplete),
    status: payload.status || 'running',
    thinkerContent: payload.thinkerContent || '',
    thinkerToolCalls: Array.isArray(payload.thinkerToolCalls) ? [...payload.thinkerToolCalls] : [],
    createdAt: payload.createdAt || new Date().toISOString(),
    completedAt: payload.completedAt || null
  }
}

function createGroupSnapshot(group) {
  if (!group) return null

  return {
    groupId: group.groupId,
    voicePillarId: group.voicePillarId,
    thinkerPillarId: group.thinkerPillarId,
    voiceReady: group.voiceReady,
    thinkerReady: group.thinkerReady,
    isComplete: group.isComplete,
    status: group.status,
    createdAt: group.createdAt,
    completedAt: group.completedAt
  }
}

function normalizeToolCall(payload = {}) {
  const source = payload.toolCall
    || payload.tool
    || payload.event?.toolCall
    || payload.event?.tool
    || payload.event?.tool_use
    || payload.tool_use
    || payload

  return {
    id: source.id || payload.toolUseId || payload.event?.toolUseId || `tool-${Date.now()}`,
    name: source.name || payload.toolName || payload.name || 'tool',
    input: source.input ?? payload.input ?? payload.args ?? source.arguments ?? {},
    output: '',
    status: payload.status || 'running',
    isError: Boolean(payload.isError),
    startedAt: payload.startedAt || new Date().toISOString(),
    completedAt: null
  }
}

let singularityStore = null

/**
 * Composable for singularity state management.
 * Call once at the app level. Returns reactive refs and methods.
 *
 * @returns {object} - {
 *   activeSingularityGroup: Ref<object|null>,
 *   thinkerContent: Ref<string>,
 *   thinkerToolCalls: Ref<Array>,
 *   voiceReady: Ref<boolean>,
 *   thinkerReady: Ref<boolean>,
 *   isComplete: Ref<boolean>,
 *   isSingularityActive: Ref<boolean>,
 *   handleSingularityEvent(event: object): void,
 *   clearSingularity(): void,
 *   getSingularityStatus(): object,
 * }
 */
export function useSingularity() {
  if (singularityStore) {
    return singularityStore
  }

  const activeSingularityGroup = ref(null)
  const thinkerContent = ref('')
  const thinkerToolCalls = ref([])
  const voiceReady = ref(false)
  const thinkerReady = ref(false)

  const groups = new Map()
  const pillarToGroup = new Map()
  let activeGroupId = null

  const isComplete = computed(() => voiceReady.value && thinkerReady.value)
  const isSingularityActive = computed(() => activeSingularityGroup.value?.status === 'running')

  function syncActiveState() {
    const group = activeGroupId ? groups.get(activeGroupId) || null : null

    if (!group) {
      activeSingularityGroup.value = null
      thinkerContent.value = ''
      thinkerToolCalls.value = []
      voiceReady.value = false
      thinkerReady.value = false
      return
    }

    activeSingularityGroup.value = createGroupSnapshot(group)
    thinkerContent.value = group.thinkerContent
    thinkerToolCalls.value = group.thinkerToolCalls.map(toolCall => ({ ...toolCall }))
    voiceReady.value = group.voiceReady
    thinkerReady.value = group.thinkerReady
  }

  function setActiveGroup(groupId) {
    if (groupId && groups.has(groupId)) {
      activeGroupId = groupId
    } else {
      activeGroupId = [...groups.keys()].at(-1) || null
    }
    syncActiveState()
  }

  function resolveGroupId(payload = {}) {
    return payload.groupId
      || payload.singularityGroupId
      || payload.event?.groupId
      || payload.event?.singularityGroupId
      || (payload.pillarId ? pillarToGroup.get(payload.pillarId) : null)
      || (payload.voicePillarId ? pillarToGroup.get(payload.voicePillarId) : null)
      || (payload.thinkerPillarId ? pillarToGroup.get(payload.thinkerPillarId) : null)
      || null
  }

  function ensureGroup(payload = {}) {
    const groupId = resolveGroupId(payload)
    if (!groupId) return null

    let group = groups.get(groupId)
    if (!group) {
      group = createGroup({
        groupId,
        voicePillarId: payload.voicePillarId,
        thinkerPillarId: payload.thinkerPillarId,
        voiceReady: payload.voiceReady,
        thinkerReady: payload.thinkerReady,
        status: payload.status
      })
      groups.set(groupId, group)
    }

    if (payload.voicePillarId) group.voicePillarId = payload.voicePillarId
    if (payload.thinkerPillarId) group.thinkerPillarId = payload.thinkerPillarId

    if (group.voicePillarId) pillarToGroup.set(group.voicePillarId, groupId)
    if (group.thinkerPillarId) pillarToGroup.set(group.thinkerPillarId, groupId)

    return group
  }

  function upsertToolCall(group, toolCall) {
    const index = group.thinkerToolCalls.findIndex(existing => existing.id === toolCall.id)

    if (index === -1) {
      group.thinkerToolCalls.push(toolCall)
      return
    }

    group.thinkerToolCalls.splice(index, 1, {
      ...group.thinkerToolCalls[index],
      ...toolCall
    })
  }

  function applyToolResult(group, payload = {}) {
    const toolId = payload.toolUseId || payload.event?.toolUseId || payload.id
    if (!toolId) return

    const content = stringifyValue(
      payload.content
      ?? payload.output
      ?? payload.result
      ?? payload.event?.content
      ?? ''
    )

    const existing = group.thinkerToolCalls.find(toolCall => toolCall.id === toolId)
    const fallback = normalizeToolCall({ id: toolId })

    upsertToolCall(group, {
      ...(existing || fallback),
      id: toolId,
      output: content,
      status: payload.isError ? 'error' : 'done',
      isError: Boolean(payload.isError),
      completedAt: new Date().toISOString()
    })
  }

  function removeGroup(groupId) {
    const group = groups.get(groupId)
    if (!group) return

    if (group.voicePillarId) pillarToGroup.delete(group.voicePillarId)
    if (group.thinkerPillarId) pillarToGroup.delete(group.thinkerPillarId)

    groups.delete(groupId)

    if (activeGroupId === groupId) {
      setActiveGroup(null)
    }
  }

  function handleSingularityEvent(event) {
    if (!event || typeof event !== 'object') return

    if (event.type === 'singularity_created') {
      const group = ensureGroup({ ...event, status: 'running' })
      if (!group) return

      group.voiceReady = false
      group.thinkerReady = false
      group.isComplete = false
      group.status = 'running'
      group.completedAt = null

      setActiveGroup(group.groupId)
      return
    }

    if (event.type === 'singularity_ready') {
      const group = ensureGroup(event)
      if (!group) return

      group.voiceReady = Boolean(event.voiceReady)
      group.thinkerReady = Boolean(event.thinkerReady)
      group.isComplete = group.voiceReady && group.thinkerReady
      group.status = group.isComplete ? 'complete' : 'running'

      if (!activeGroupId) activeGroupId = group.groupId
      syncActiveState()
      return
    }

    if (event.type === 'singularity_complete') {
      const group = ensureGroup({
        ...event,
        voiceReady: true,
        thinkerReady: true
      })
      if (!group) return

      group.voiceReady = true
      group.thinkerReady = true
      group.isComplete = true
      group.status = 'complete'
      group.completedAt = new Date().toISOString()

      if (!activeGroupId) activeGroupId = group.groupId
      syncActiveState()
      return
    }

    if (event.type === 'pillar_stream' && event.singularityRole === 'thinker') {
      const group = ensureGroup(event)
      if (!group) return

      const streamEvent = event.event || {}

      if (streamEvent.type === 'tool_use') {
        upsertToolCall(group, normalizeToolCall({ event: streamEvent }))
      }

      if (streamEvent.type === 'tool_result') {
        applyToolResult(group, { event: streamEvent })
      }

      const text = extractStreamText(streamEvent)
      if (text) {
        group.thinkerContent += text
      }

      if (!activeGroupId) activeGroupId = group.groupId
      syncActiveState()
      return
    }

    if (event.type === 'pillar_tool_call') {
      const group = ensureGroup(event)
      if (!group) return

      upsertToolCall(group, normalizeToolCall(event))

      if (!activeGroupId) activeGroupId = group.groupId
      syncActiveState()
      return
    }

    if (event.type === 'pillar_tool_result') {
      const group = ensureGroup(event)
      if (!group) return

      applyToolResult(group, event)
      syncActiveState()
      return
    }

    if (event.type === 'pillar_stopped' || (event.type === 'pillar_done' && (event.status === 'stopped' || event.status === 'error'))) {
      const groupId = resolveGroupId(event)
      if (!groupId) return

      const group = groups.get(groupId)
      if (!group) return

      const shouldRemove = event.status === 'error' || !group.isComplete
      if (shouldRemove) {
        removeGroup(groupId)
      }
    }
  }

  function clearSingularity() {
    groups.clear()
    pillarToGroup.clear()
    activeGroupId = null
    syncActiveState()
  }

  function getSingularityStatus() {
    return {
      activeGroup: activeSingularityGroup.value,
      thinkerContentLength: thinkerContent.value.length,
      thinkerToolCallCount: thinkerToolCalls.value.length,
      voiceReady: voiceReady.value,
      thinkerReady: thinkerReady.value,
      isComplete: isComplete.value,
      isSingularityActive: isSingularityActive.value
    }
  }

  singularityStore = {
    activeSingularityGroup,
    thinkerContent,
    thinkerToolCalls,
    voiceReady,
    thinkerReady,
    isComplete,
    isSingularityActive,
    handleSingularityEvent,
    clearSingularity,
    getSingularityStatus
  }

  return singularityStore
}
