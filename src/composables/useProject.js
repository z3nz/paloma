import { ref, shallowRef } from 'vue'
import { openProject as openDir } from '../services/filesystem.js'

const dirHandle = shallowRef(null)
const projectName = ref('')

export function useProject() {
  async function openProject() {
    const handle = await openDir()
    dirHandle.value = handle
    projectName.value = handle.name
    return handle
  }

  function closeProject() {
    dirHandle.value = null
    projectName.value = ''
  }

  return {
    dirHandle,
    projectName,
    openProject,
    closeProject
  }
}
