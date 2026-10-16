import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

// Founder-only proxy from the Core UI to the talk bridge on the VM host (core-bridge/bridge.mjs).
const ALLOWED = new Set(['talk', 'ledger', 'situation', 'proposals', 'proposals/decide', 'roster', 'lexicon', 'voices', 'mailboxes', 'mailboxes/sync'])

async function forward(request: NextRequest, path: string[], method: 'GET' | 'POST') {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const sub = path.join('/')
  if (sub === 'ops' && method === 'GET') return opsFeed()
  if (!ALLOWED.has(sub))return NextResponse.json({ error: 'not found' }, { status: 404 })
  const base = process.env.CORE_BRIDGE_URL, key = process.env.CORE_BRIDGE_KEY
  if (!base || !key) return NextResponse.json({ error: 'The talk bridge is not configured on this server yet.' }, { status: 503 })
  try {
    const res = await fetch(`${base}/${sub}`, {
      method,
      headers: { 'x-bridge-key': key, 'content-type': 'application/json' },
      body: method === 'POST' ? await request.text() : undefined,
      signal: AbortSignal.timeout(200_000),
    })
    // Talk answers stream as server-sent events: pass the stream straight through so speech starts at the first sentence.
    if (res.headers.get('content-type')?.startsWith('text/event-stream')) {
      return new Response(res.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } })
    }
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: 'The agents are unreachable right now. Watchman will flag it if it persists.' }, { status: 502 })
  }
}

// The Watchman's latest pass from HQ (read-only /api/ops/status) for the App Health deck.
async function opsFeed() {
  const url = process.env.HQ_OPS_URL, key = process.env.HQ_OPS_KEY
  if (!url || !key) return NextResponse.json({ error: 'The HQ feed is not configured on this server yet.' }, { status: 503 })
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: 'HQ is unreachable right now.' }, { status: 502 })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path, 'GET')
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path, 'POST')
}
