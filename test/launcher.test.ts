import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createApp } from '../server/api.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { startCommand } from '../server/launcher.ts'
import { Pricing } from '../server/pricing.ts'
import { PACKAGE } from '../shared/product.ts'

describe('start without a terminal', () => {
  it('runs the published package in the background, with node on the path', () => {
    const command = startCommand()
    expect(command).toContain(`--package='${PACKAGE}' ${PACKAGE} --background`)
    expect(command).toMatch(/PATH='[^']+':"\$PATH" '[^']+\/npx' -y/)
    expect(command).toMatch(/>> '[^']+server\.log' 2>&1$/)
  })

  it('takes only the two switches, as booleans, and only from the panel', async () => {
    const db = openDb(':memory:')
    const pricing = new Pricing()
    const app = createApp({
      db, pricing, indexer: new Indexer(db, pricing, { projectsDir: '/nonexistent', desktopDir: null }),
      events: new EventEmitter(), staticDir: null, allowedHosts: new Set(['localhost', '127.0.0.1', '[::1]']),
    })
    const put = (body: unknown, origin = 'http://localhost:4747') =>
      app.request('http://localhost:4747/api/startup', { method: 'PUT', headers: { host: 'localhost:4747', 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
    expect((await put({ launcher: 'yes' })).status).toBe(400)
    expect((await put({ rm: true })).status).toBe(400)
    expect((await put({ autostart: true }, 'https://evil.example')).status).toBe(403)
    const res = await app.request('http://localhost:4747/api/startup', { headers: { host: 'localhost:4747' } })
    expect(await res.json()).toMatchObject({ supported: process.platform === 'darwin' })
  })
})
