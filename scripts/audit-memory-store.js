import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { homedir } from 'node:os'

const MEMORY_DIR = join(homedir(), '.paloma', 'memory')
const SQLITE_PATH = join(MEMORY_DIR, 'memory.sqlite')
const LEGACY_ARCHIVE_DIR = join(MEMORY_DIR, 'legacy-json')
const outputJson = process.argv.includes('--json')

let sqliteModulePromise = null

async function loadSqliteModule () {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('node:sqlite').catch(() => null)
  }
  return sqliteModulePromise
}

async function safeStat(path) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
      .map(entry => join(dirPath, entry.name))
  } catch {
    return []
  }
}

async function inspectJsonFile(filePath) {
  const fileName = basename(filePath)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const memories = Array.isArray(parsed?.memories) ? parsed.memories : []
    return {
      file: fileName,
      path: filePath,
      valid: true,
      collection: parsed?.metadata?.collection || fileName.replace(/\.json$/i, ''),
      memoryCount: memories.length,
      metadata: parsed?.metadata || null,
      oldest: memories.length > 0
        ? memories.reduce((a, b) => new Date(a.created) < new Date(b.created) ? a : b).created
        : null,
      newest: memories.length > 0
        ? memories.reduce((a, b) => new Date(a.created) > new Date(b.created) ? a : b).created
        : null
    }
  } catch (error) {
    return {
      file: fileName,
      path: filePath,
      valid: false,
      error: error.message
    }
  }
}

async function inspectSqlite() {
  const sqlite = await loadSqliteModule()
  if (!sqlite?.DatabaseSync) {
    return {
      available: false,
      exists: existsSync(SQLITE_PATH),
      path: SQLITE_PATH,
      collections: [],
      error: 'node:sqlite unavailable'
    }
  }

  if (!existsSync(SQLITE_PATH)) {
    return {
      available: true,
      exists: false,
      path: SQLITE_PATH,
      collections: []
    }
  }

  const db = new sqlite.DatabaseSync(SQLITE_PATH, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories'").all()
    if (tables.length === 0) {
      return {
        available: true,
        exists: true,
        path: SQLITE_PATH,
        collections: [],
        warning: 'SQLite file exists but memories table is missing'
      }
    }

    const collections = db.prepare(`
      SELECT collection, COUNT(*) AS total, MIN(created) AS oldest, MAX(created) AS newest
      FROM memories
      GROUP BY collection
      ORDER BY collection ASC
    `).all()

    return {
      available: true,
      exists: true,
      path: SQLITE_PATH,
      collections: collections.map(row => ({
        collection: row.collection,
        total: row.total,
        oldest: row.oldest,
        newest: row.newest
      }))
    }
  } finally {
    db.close()
  }
}

function buildSummary(report) {
  const legacyValid = report.legacyFiles.filter(file => file.valid)
  const legacyInvalid = report.legacyFiles.filter(file => !file.valid)
  const sqliteCollections = report.sqlite.collections
  const sqliteTotal = sqliteCollections.reduce((sum, entry) => sum + entry.total, 0)

  const notes = []
  if (report.sqlite.exists && sqliteTotal > 0) {
    notes.push(`SQLite contains ${sqliteTotal} memories across ${sqliteCollections.length} collection(s).`)
  } else if (report.sqlite.exists) {
    notes.push('SQLite database exists but currently has no stored memories.')
  } else {
    notes.push('No SQLite database found yet.')
  }

  if (legacyValid.length > 0) {
    notes.push(`${legacyValid.length} legacy JSON collection file(s) remain in the live memory directory.`)
  }

  if (report.archiveFiles.length > 0) {
    notes.push(`${report.archiveFiles.length} legacy JSON archive file(s) exist in legacy-json.`)
  }

  if (legacyInvalid.length > 0) {
    notes.push(`${legacyInvalid.length} malformed legacy JSON file(s) need manual review before cleanup.`)
  }

  return notes
}

async function main () {
  const memoryDirStat = await safeStat(MEMORY_DIR)
  const sqlite = await inspectSqlite()
  const liveLegacyFiles = await Promise.all((await listJsonFiles(MEMORY_DIR)).map(inspectJsonFile))
  const archiveFiles = await Promise.all((await listJsonFiles(LEGACY_ARCHIVE_DIR)).map(inspectJsonFile))

  const report = {
    generatedAt: new Date().toISOString(),
    memoryDir: MEMORY_DIR,
    memoryDirExists: !!memoryDirStat,
    sqlite,
    legacyFiles: liveLegacyFiles,
    archiveFiles,
    summary: []
  }

  report.summary = buildSummary(report)

  if (outputJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('Paloma Memory Audit')
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Memory dir: ${report.memoryDir}`)
  console.log('')

  console.log('SQLite')
  console.log(`  Available: ${report.sqlite.available ? 'yes' : 'no'}`)
  console.log(`  Exists:    ${report.sqlite.exists ? 'yes' : 'no'}`)
  console.log(`  Path:      ${report.sqlite.path}`)
  if (report.sqlite.warning) console.log(`  Warning:   ${report.sqlite.warning}`)
  if (report.sqlite.error) console.log(`  Error:     ${report.sqlite.error}`)
  if (report.sqlite.collections.length > 0) {
    for (const collection of report.sqlite.collections) {
      console.log(`  - ${collection.collection}: ${collection.total} memories`) 
    }
  }
  console.log('')

  console.log('Live Legacy JSON Files')
  if (report.legacyFiles.length === 0) {
    console.log('  None')
  } else {
    for (const file of report.legacyFiles) {
      if (file.valid) {
        console.log(`  - ${file.file}: ${file.memoryCount} memories (${file.collection})`)
      } else {
        console.log(`  - ${file.file}: INVALID JSON (${file.error})`)
      }
    }
  }
  console.log('')

  console.log('Archived Legacy JSON Files')
  if (report.archiveFiles.length === 0) {
    console.log('  None')
  } else {
    for (const file of report.archiveFiles) {
      if (file.valid) {
        console.log(`  - ${file.file}: ${file.memoryCount} memories`) 
      } else {
        console.log(`  - ${file.file}: INVALID JSON (${file.error})`)
      }
    }
  }
  console.log('')

  console.log('Summary')
  for (const line of report.summary) {
    console.log(`  - ${line}`)
  }
}

main().catch(error => {
  console.error('Memory audit failed:', error)
  process.exit(1)
})