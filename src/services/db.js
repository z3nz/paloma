import Dexie from 'dexie'

const db = new Dexie('paloma')

db.version(1).stores({
  sessions: '++id, projectPath, updatedAt',
  messages: '++id, sessionId, timestamp'
})

export default db
