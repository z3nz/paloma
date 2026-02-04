import Dexie from 'dexie'

const db = new Dexie('paloma')

db.version(1).stores({
  sessions: '++id, projectPath, updatedAt',
  messages: '++id, sessionId, timestamp'
})

db.version(2).stores({
  sessions: '++id, projectPath, updatedAt',
  messages: '++id, sessionId, timestamp',
  drafts: 'sessionId'
})

export default db
