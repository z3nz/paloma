import { ref, shallowRef } from 'vue'
import { openProject as openDir, readProjectInstructions } from '../services/filesystem.js'

const dirHandle = shallowRef(null)
const projectName = ref('')
const projectInstructions = ref(null)

export function useProject() {
  async function openProject() {
    const handle = await openDir()
    dirHandle.value = handle
    projectName.value = handle.name
    projectInstructions.value = await readProjectInstructions(handle)
    return handle
  }

  function closeProject() {
    dirHandle.value = null
    projectName.value = ''
    projectInstructions.value = null
  }

  return {
    dirHandle,
    projectName,
    projectInstructions,
    openProject,
    closeProject
  }
}
