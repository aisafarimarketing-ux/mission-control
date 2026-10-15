// Safari Core talk bridge — runs on the VM host next to Claude Code (founder's subscription, no API keys).
// The Core container calls it over the docker bridge; it runs `claude -p` with one persistent session per agent.
// Env: BRIDGE_KEY (shared secret, required), BRIDGE_HOST (default 172.17.0.1), BRIDGE_PORT (default 3031),
//      CLAUDE_BIN (default ~/.local/bin/claude), AGENTS_HOME (default ~/agents).
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const KEY = process.env.BRIDGE_KEY
if (!KEY) { console.error('BRIDGE_KEY is required'); process.exit(1) }
const HOST = process.env.BRIDGE_HOST || '172.17.0.1'
const PORT = Number(process.env.BRIDGE_PORT || 3031)
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude')
const HOME = process.env.AGENTS_HOME || path.join(os.homedir(), 'agents')
const HERE = path.dirname(new URL(import.meta.url).pathname)
fs.mkdirSync(HOME, { recursive: true })

const SESSIONS = path.join(HOME, 'sessions.json')
const LEDGER = path.join(HOME, 'ledger.jsonl')
const PROPOSALS = path.join(HOME, 'proposals.json')
const ROSTER = path.join(HOME, 'roster.json')
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1))

// Persona = agents/<id>.md shipped with the bridge, or a roster entry Kamanda proposed and the founder approved.
function persona(agent) {
  const common = fs.readFileSync(path.join(HERE, 'agents', '_common.md'), 'utf8')
  const file = path.join(HERE, 'agents', `${agent}.md`)
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8') + common
  const r = readJson(ROSTER, {})[agent]
  return r ? `You are ${r.name}, ${r.role} at Safari Tech Lab. Playbook: ${r.playbook}\n` + common : null
}

// ponytail: one claude process at a time — the VM has ~1 GB free; add a small pool if RAM grows.
let busy = Promise.resolve()
function ask(agent, text) {
  const run = busy.then(() => new Promise((resolve, reject) => {
    const sessions = readJson(SESSIONS, {})
    const args = ['-p', '--output-format', 'json', '--append-system-prompt', persona(agent),
      '--allowedTools', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']
    if (sessions[agent]) args.push('--resume', sessions[agent])
    const cwd = path.join(HOME, agent); fs.mkdirSync(cwd, { recursive: true })
    const p = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d))
    p.stdin.end(text)
    const t = setTimeout(() => p.kill('SIGTERM'), 180_000)
    p.on('close', code => {
      clearTimeout(t)
      let j; try { j = JSON.parse(out) } catch { return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`)) }
      if (j.session_id) { sessions[agent] = j.session_id; writeJson(SESSIONS, sessions) }
      const row = { at: new Date().toISOString(), agent, ok: !j.is_error, ms: j.duration_ms, cost_usd: j.total_cost_usd,
        in: j.usage?.input_tokens, out: j.usage?.output_tokens, cache_read: j.usage?.cache_read_input_tokens }
      fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n')
      resolve({ reply: j.result || '', ...row })
    })
  }))
  busy = run.catch(() => {})
  return run
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
      // Barge-in: the founder cut the last answer short; tell the agent exactly what was heard so nothing is lost.
      const prompt = heard ? `[You were interrupted. The founder only heard: "${heard}". Do not repeat it; respond to what they say now.]\n${text}` : text
      const r = await ask(agent, prompt)
      return send(res, 200, { ...r, ...liftProposal(r.reply) })
    }
    if (req.method === 'GET' && url.pathname === '/ledger') {
      const rows = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
      const today = new Date().toISOString().slice(0, 10)
      const t = rows.filter(r => r.at.startsWith(today))
      return send(res, 200, { today: { runs: t.length, failed: t.filter(r => !r.ok).length, cost_usd: +t.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4) }, recent: rows.slice(-50) })
    }
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
    send(res, 404, { error: 'not found' })
  } catch (e) { send(res, 500, { error: String(e.message || e) }) }
}).listen(PORT, HOST, () => console.log(`core-bridge on ${HOST}:${PORT}`))
