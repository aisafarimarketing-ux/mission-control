// Safari Core talk bridge — runs on the VM host next to Claude Code (founder's subscription, no API keys).
// Each agent gets a WARM `claude -p` process (stream-json in/out), so replies start in ~1 s instead of ~4 s cold.
// Answers stream to the Core as server-sent events; Kamanda and Watchman get a live situation report every turn.
// Env: BRIDGE_KEY (required), BRIDGE_HOST (172.17.0.1), BRIDGE_PORT (3031), CLAUDE_BIN, AGENTS_HOME (~/agents),
//      TALK_MODEL (sonnet), WARM_MAX (2), IDLE_MIN (15).
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const KEY = process.env.BRIDGE_KEY
if (!KEY) { console.error('BRIDGE_KEY is required'); process.exit(1) }
const HOST = process.env.BRIDGE_HOST || '172.17.0.1'
const PORT = Number(process.env.BRIDGE_PORT || 3031)
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude')
const HOME = process.env.AGENTS_HOME || path.join(os.homedir(), 'agents')
const MODEL = process.env.TALK_MODEL || 'sonnet'
const WARM_MAX = Number(process.env.WARM_MAX || 2) // ponytail: VM has ~1 GB free; raise after the 8 GB upgrade
const IDLE_MS = Number(process.env.IDLE_MIN || 15) * 60_000
const HERE = path.dirname(new URL(import.meta.url).pathname)
fs.mkdirSync(HOME, { recursive: true })

const SESSIONS = path.join(HOME, 'sessions.json')
const LEDGER = path.join(HOME, 'ledger.jsonl')
const PROPOSALS = path.join(HOME, 'proposals.json')
const ROSTER = path.join(HOME, 'roster.json')
const LEXICON = path.join(HOME, 'lexicon.json')
const VOICE_PICKS = path.join(HOME, 'voices.json')
// First run: start the pronunciation dictionary from the shipped seed (safari circuit names, Swahili rules).
if (!fs.existsSync(LEXICON)) fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'lexicon-seed.json'), LEXICON)
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1))
const ledgerRows = () => fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []

function persona(agent) {
  const common = fs.readFileSync(path.join(HERE, 'agents', '_common.md'), 'utf8')
  const file = path.join(HERE, 'agents', `${agent}.md`)
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8') + common
  const r = readJson(ROSTER, {})[agent]
  return r ? `You are ${r.name}, ${r.role} at Safari Tech Lab. Playbook: ${r.playbook}\n` + common : null
}

// ---------- live situation report (refreshed every minute) ----------
const SERVICES = [
  ['Safari HQ', 'https://hq.safaritechlab.com/api/health'], ['Public site', 'https://safaritechlab.com'],
  ['Safari Studio', 'https://app.safaristudio.co'], ['KaribuLink', 'https://www.karibulink.com'],
  ['Property Hub', 'https://safaripropertyhub.com'], ['Mail Agent', 'https://safari-mail-agent.aisafarimarketing.workers.dev'],
  ['Safari Video Studio', 'https://safarivideostudio.com'], ['Safari Core', 'https://core.safaritechlab.com'],
]
const sh = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 8000 }, (e, out) => r(e ? '' : String(out).trim())))
let situation = 'Situation report is still loading.'
async function refreshSituation() {
  const eat = new Date(Date.now() + 3 * 3600_000).toISOString().slice(11, 16)
  const checks = await Promise.all(SERVICES.map(async ([name, url]) => {
    const t = Date.now()
    try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) }); return `${name}: ${r.status < 500 ? 'up' : 'DOWN'} (${r.status}, ${Date.now() - t} ms)` }
    catch (e) { return `${name}: DOWN (${e.name === 'TimeoutError' ? 'timed out' : 'unreachable'})` }
  }))
  const mem = await sh('free', ['-m']); const m = mem.split('\n')[1]?.split(/\s+/) ?? []; const sw = mem.split('\n')[2]?.split(/\s+/) ?? []
  const disk = (await sh('df', ['-h', '/'])).split('\n')[1]?.split(/\s+/) ?? []
  const containers = await sh('docker', ['ps', '--format', '{{.Names}} {{.Status}}'])
  const units = ['paperclipai', 'core-bridge', 'safari-desk-remote']
  const unitState = await Promise.all(units.map(async u => `${u}: ${(await sh('systemctl', ['--user', 'is-active', u])) || 'unknown'}`))
  const today = new Date().toISOString().slice(0, 10)
  const runs = ledgerRows().filter(r => r.at.startsWith(today))
  const byAgent = {}
  for (const r of runs) { const a = (byAgent[r.agent] ||= { runs: 0, failed: 0, cost: 0 }); a.runs++; if (!r.ok) a.failed++; a.cost += r.cost_usd || 0 }
  const proposals = Object.values(readJson(PROPOSALS, {}))
  situation = [
    `Live situation at ${eat} EAT (checked every minute by the bridge on the VM).`,
    `Services: ${checks.join('; ')}.`,
    `VM safari-core (Hetzner CX23): memory ${m[6] || '?'} MB available of ${m[1] || '?'} MB; swap used ${sw[2] || '?'} of ${sw[1] || '?'} MB; disk ${disk[4] || '?'} used, ${disk[3] || '?'} free.`,
    `Containers: ${containers.replace(/\n/g, '; ') || 'none'}. Services on the VM: ${unitState.join(', ')}.`,
    `Agent runs today: ${Object.entries(byAgent).map(([a, s]) => `${a} ${s.runs} runs, ${s.failed} failed, about $${s.cost.toFixed(2)} equivalent (paid by subscription)`).join('; ') || 'none yet'}.`,
    `Agent proposals waiting for the founder: ${proposals.map(p => p.name).join(', ') || 'none'}.`,
    `Not wired yet (say so if asked): HQ contacts and Radar numbers, inbox counts, social replies — they arrive with the HQ live feed.`,
  ].join('\n')
  fs.writeFileSync(path.join(HOME, 'STATE.md'), situation + '\n')
}
refreshSituation(); setInterval(refreshSituation, 60_000)
const SEES_SITUATION = new Set(['kamanda', 'watchman'])

// ---------- warm agent processes ----------
const warm = new Map() // agent -> { p, buf, turn, queue, last, idle }
function spawnAgent(agent) {
  const sessions = readJson(SESSIONS, {})
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', MODEL, '--append-system-prompt', persona(agent), '--allowedTools', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']
  if (sessions[agent]) args.push('--resume', sessions[agent])
  const cwd = path.join(HOME, agent); fs.mkdirSync(cwd, { recursive: true })
  const p = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const w = { p, buf: '', turn: null, queue: [], last: Date.now(), idle: null, err: '' }
  p.stderr.on('data', d => (w.err = (w.err + d).slice(-500)))
  p.stdout.on('data', d => {
    w.buf += d
    let i
    while ((i = w.buf.indexOf('\n')) >= 0) {
      const line = w.buf.slice(0, i); w.buf = w.buf.slice(i + 1)
      let j; try { j = JSON.parse(line) } catch { continue }
      const t = w.turn; if (!t) continue
      if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') { t.text += j.event.delta.text; t.onDelta(j.event.delta.text) }
      if (j.type === 'result') finishTurn(agent, w, j)
    }
  })
  p.on('close', () => {
    warm.delete(agent)
    if (w.turn) { w.turn.onError(`The agent stopped unexpectedly. ${w.err.slice(-200)}`); w.turn = null }
    for (const q of w.queue) q.onError('The agent restarted; please say that again.')
  })
  warm.set(agent, w)
  // keep at most WARM_MAX warm: retire the least recently used idle one
  if (warm.size > WARM_MAX) {
    const [oldAgent, old] = [...warm.entries()].filter(([a, x]) => a !== agent && !x.turn).sort((a, b) => a[1].last - b[1].last)[0] || []
    if (old) { old.p.stdin.end(); warm.delete(oldAgent) }
  }
  return w
}
function finishTurn(agent, w, j) {
  const t = w.turn; w.turn = null; w.last = Date.now()
  if (j.session_id) { const s = readJson(SESSIONS, {}); s[agent] = j.session_id; writeJson(SESSIONS, s) }
  const row = { at: new Date().toISOString(), agent, ok: !j.is_error, ms: Date.now() - t.started, first_ms: t.firstMs, cost_usd: j.total_cost_usd,
    in: j.usage?.input_tokens, out: j.usage?.output_tokens, cache_read: j.usage?.cache_read_input_tokens }
  fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n')
  t.onDone({ ...row, reply: t.text || j.result || '' })
  clearTimeout(w.idle); w.idle = setTimeout(() => { if (!w.turn) w.p.stdin.end() }, IDLE_MS)
  const next = w.queue.shift(); if (next) startTurn(agent, w, next)
}
function startTurn(agent, w, turn) {
  w.turn = turn; turn.started = Date.now()
  const d = turn.onDelta; turn.onDelta = x => { if (turn.firstMs == null) turn.firstMs = Date.now() - turn.started; d(x) }
  w.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: turn.prompt } }) + '\n')
}
function talk(agent, prompt, handlers) {
  const w = warm.get(agent) || spawnAgent(agent)
  const turn = { prompt, text: '', ...handlers }
  if (w.turn) w.queue.push(turn); else startTurn(agent, w, turn)
}

// Kamanda proposes agents inside his reply as a fenced ```agent-proposal {json}``` block; we lift it out for the founder's tap.
function liftProposal(reply) {
  const m = reply.match(/```agent-proposal\s*([\s\S]*?)```/)
  if (!m) return { reply, proposal: null }
  let proposal = null
  try { proposal = JSON.parse(m[1]); proposal.id = proposal.id || proposal.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); proposal.at = new Date().toISOString() } catch { /* malformed: leave text as is */ }
  if (proposal) { const all = readJson(PROPOSALS, {}); all[proposal.id] = proposal; writeJson(PROPOSALS, all) }
  return { reply: reply.replace(m[0], '').trim(), proposal }
}

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) })

http.createServer(async (req, res) => {
  if (req.headers['x-bridge-key'] !== KEY) return send(res, 401, { error: 'unauthorised' })
  const url = new URL(req.url, 'http://x')
  try {
    if (req.method === 'POST' && url.pathname === '/talk') {
      const { agent = 'kamanda', text = '', heard } = await body(req)
      if (!/^[a-z0-9-]{2,40}$/.test(agent) || !persona(agent)) return send(res, 404, { error: `no agent ${agent}` })
      if (!text.trim()) return send(res, 400, { error: 'say something' })
      let prompt = heard ? `[You were interrupted. The founder only heard: "${heard}". Do not repeat it; respond to what they say now.]\n${text}` : text
      if (SEES_SITUATION.has(agent)) prompt = `[${situation}]\n\n${prompt}`
      // Server-sent events: {d} text deltas as they arrive, then {done, ...ledger row, reply, proposal} or {error}.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const ev = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
      talk(agent, prompt, {
        onDelta: d => ev({ d }),
        onDone: row => { const lifted = liftProposal(row.reply); ev({ done: true, ...row, ...lifted }); res.end() },
        onError: e => { ev({ error: e }); res.end() },
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/ledger') {
      const rows = ledgerRows(); const today = new Date().toISOString().slice(0, 10)
      const t = rows.filter(r => r.at.startsWith(today))
      return send(res, 200, { today: { runs: t.length, failed: t.filter(r => !r.ok).length, cost_usd: +t.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4) }, recent: rows.slice(-50) })
    }
    if (req.method === 'GET' && url.pathname === '/situation') return send(res, 200, { situation, warm: [...warm.keys()] })
    if (req.method === 'GET' && url.pathname === '/proposals') return send(res, 200, readJson(PROPOSALS, {}))
    if (req.method === 'POST' && url.pathname === '/proposals/decide') {
      const { id, approve } = await body(req)
      const all = readJson(PROPOSALS, {}); const p = all[id]
      if (!p) return send(res, 404, { error: 'no such proposal' })
      delete all[id]; writeJson(PROPOSALS, all)
      if (approve) { const r = readJson(ROSTER, {}); r[p.id] = p; writeJson(ROSTER, r) }
      return send(res, 200, { ok: true, joined: !!approve, agent: p })
    }
    if (req.method === 'GET' && url.pathname === '/roster') return send(res, 200, readJson(ROSTER, {}))
    // Pronunciation dictionary: { entries: { "<word or phrase, lowercase>": { ipa?, sayLike?, kind?, by?, at? } } }
    if (url.pathname === '/lexicon') {
      const lex = readJson(LEXICON, { entries: {} })
      if (req.method === 'GET') return send(res, 200, lex)
      const { word, ipa, sayLike, kind, remove } = await body(req)
      const key = String(word || '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (!key || key.length > 60) return send(res, 400, { error: 'Give the word or phrase (up to 60 letters).' })
      if (remove) delete lex.entries[key]
      else {
        if (!ipa && !sayLike) return send(res, 400, { error: 'Add how it should sound.' })
        lex.entries[key] = { ...(ipa ? { ipa: String(ipa).slice(0, 120) } : {}), ...(sayLike ? { sayLike: String(sayLike).slice(0, 120) } : {}), kind: kind || lex.entries[key]?.kind || 'word', by: 'founder', at: new Date().toISOString() }
      }
      writeJson(LEXICON, lex)
      return send(res, 200, { ok: true, entries: lex.entries })
    }
    // Which of the 28 voices each agent uses (the founder's choice, shared across devices).
    if (url.pathname === '/voices') {
      const picks = readJson(VOICE_PICKS, {})
      if (req.method === 'GET') return send(res, 200, picks)
      const { agent, voice } = await body(req)
      if (!/^[a-z0-9-]{2,40}$/.test(agent || '') || !/^[ab][fm]_[a-z]+$/.test(voice || '')) return send(res, 400, { error: 'bad voice choice' })
      picks[agent] = voice; writeJson(VOICE_PICKS, picks)
      return send(res, 200, { ok: true, picks })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) { if (!res.headersSent) send(res, 500, { error: String(e.message || e) }); else res.end() }
}).listen(PORT, HOST, () => console.log(`core-bridge on ${HOST}:${PORT} (model ${MODEL}, warm max ${WARM_MAX})`))
