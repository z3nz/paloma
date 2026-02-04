import { ref, shallowRef } from 'vue'
import { openProject as openDir, readProjectInstructions, readActivePlans } from '../services/filesystem.js'

const dirHandle = shallowRef(null)
const projectName = ref('')
const projectInstructions = ref(null)
const activePlans = ref([])

export function useProject() {
  async function openProject() {
    const handle = await openDir()
    dirHandle.value = handle
    projectName.value = handle.name
    projectInstructions.value = await readProjectInstructions(handle)
    activePlans.value = await readActivePlans(handle)
    return handle
  }

  async function refreshActivePlans() {
    if (dirHandle.value) {
      activePlans.value = await readActivePlans(dirHandle.value)
    }
  }

  function closeProject() {
    dirHandle.value = null
    projectName.value = ''
    projectInstructions.value = null
    activePlans.value = []
  }

  return {
    dirHandle,
    projectName,
    projectInstructions,
    activePlans,
    openProject,
    closeProject,
    refreshActivePlans
  }
}
