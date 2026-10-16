import { describe, expect, it } from 'vitest'
import { opsSummary } from '@/components/core/core-snapshot'

const at = '2026-10-16T09:00:00.000Z'
const now = Date.parse(at)
const svc = (name: string, ok: boolean | null, agoS = 20) => ({ key: name, name, ok, checkedAt: ok === null ? null : new Date(now - agoS * 1000).toISOString() })

describe('opsSummary', () => {
  it('counts up and down, ignores never-checked services', () => {
    const s = opsSummary({ at, services: [svc('HQ', true), svc('Studio', false), svc('New', null)], incidents: [] }, now)
    expect(s).toMatchObject({ total: 3, up: 1, down: ['Studio'], heartbeat: '20 s ago', stale: false, at: '12:00' })
  })
  it('flags a quiet Watchman', () => {
    expect(opsSummary({ at, services: [svc('HQ', true, 300)], incidents: [] }, now)).toMatchObject({ stale: true, heartbeat: '5 min ago' })
    expect(opsSummary({ at, services: [svc('HQ', null)], incidents: [] }, now)).toMatchObject({ stale: true, heartbeat: 'none yet' })
  })
})
