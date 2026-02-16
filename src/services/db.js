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

db.version(3).stores({
  sessions: '++id, projectPath, updatedAt',
  messages: '++id, sessionId, timestamp',
  drafts: 'sessionId',
  projectHandles: 'name'
})

db.version(4).stores({
  sessions: '++id, projectPath, updatedAt, pillarId',
  messages: '++id, sessionId, timestamp',
  drafts: 'sessionId',
  projectHandles: 'name'
})

export default db

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
