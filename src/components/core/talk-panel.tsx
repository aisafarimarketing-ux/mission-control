'use client'

// Talk to an agent: full portrait (torso on phones), our own Kokoro voice (served from our VM, runs in the browser),
// answers stream in and are spoken sentence by sentence. Speaking over the agent stops it at once, and the bridge
// is told exactly what was heard, so context is never lost.
import { useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'

type Line = { who: 'you' | 'agent'; text: string }
type Proposal = { id: string; name: string; role: string; playbook: string; look?: string; why?: string }
type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
type Kokoro = { generate(text: string, o: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }> }

// Each agent's Kokoro voice (all 28 English voices live in our copy; change here to recast).
const VOICES: Record<string, string> = { kamanda: 'bm_george', 'reply-watch': 'af_heart', watchman: 'bf_emma', 'radar-scout': 'am_michael', 'mail-sync': 'am_eric' }

// One shared voice engine per page: our patched kokoro-js bundle + our model files (never huggingface.co / a CDN).
let engine: Promise<Kokoro> | null = null
const progressListeners = new Set<(pct: number) => void>()
function loadVoice(): Promise<Kokoro> {
  engine ??= (async () => {
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '/vendor/kokoro-1.2.1-safari.js' as string)
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }
    const gpu = !!(nav.gpu && (await nav.gpu.requestAdapter().catch(() => null)))
    const seen: Record<string, [number, number]> = {}
    return mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: gpu ? 'fp32' : 'q8', device: gpu ? 'webgpu' : 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file || !p.total) return
        seen[p.file] = [p.loaded || 0, p.total]
        const [l, t] = Object.values(seen).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0])
        progressListeners.forEach(f => f(Math.round((100 * l) / t)))
      },
    })
  })()
  engine.catch(() => { engine = null })
  return engine
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></svg>
)

export function TalkPanel({ agent, name, role, voice, color, onClose }: { agent: string; name: string; role: string; voice: 'M' | 'F'; color: string; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [draft, setDraft] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [note, setNote] = useState('')
  const [voicePct, setVoicePct] = useState<number | null>(null) // null = ready or not started
  const rec = useRef<SR | null>(null)
  const wantListen = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  // speech pipeline state
  const ctx = useRef<AudioContext | null>(null)
  const tts = useRef<Kokoro | null>(null)
  const turnId = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const source = useRef<AudioBufferSourceNode | null>(null)
  const said = useRef<string[]>([])
  const current = useRef('')
  const pending = useRef(0)
  const heardOnCut = useRef<string | null>(null)
  const speakingRef = useRef(false)

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [lines, interim])

  // Start loading our voice as soon as the panel opens (cached by the browser after the first time).
  useEffect(() => {
    const onPct = (p: number) => setVoicePct(p < 100 ? p : null)
    progressListeners.add(onPct)
    loadVoice().then(t => { tts.current = t; setVoicePct(null) }).catch(() => { setVoicePct(null); setNote('Our voice could not load here; using the browser voice for now.') })
    return () => { progressListeners.delete(onPct) }
  }, [])

  function audio() {
    ctx.current ??= new AudioContext()
    if (ctx.current.state === 'suspended') ctx.current.resume()
    return ctx.current
  }
  function setTalking(on: boolean) { speakingRef.current = on; setSpeaking(on) }

  function browserVoice() {
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
    const want = voice === 'F' ? /(female|aria|jenny|sonia|libby|samantha|zira|serena)/i : /(male|guy|ryan|thomas|daniel|david|arthur)/i
    return vs.find(v => /natural|online/i.test(v.name) && want.test(v.name)) || vs.find(v => want.test(v.name)) || vs[0]
  }

  // Queue one sentence: synthesise with Kokoro (in parallel with playback of earlier ones), then play in order.
  function say(sentence: string, id: number) {
    const s = sentence.trim(); if (!s) return
    pending.current++; setTalking(true)
    const made = tts.current ? tts.current.generate(s, { voice: VOICES[agent] || (voice === 'F' ? 'af_heart' : 'bm_george') }).catch(() => null) : Promise.resolve(null)
    chain.current = chain.current.then(async () => {
      const raw = await made
      if (id !== turnId.current) return
      current.current = s
      await new Promise<void>(done => {
        if (raw) {
          const ac = audio(); const buf = ac.createBuffer(1, raw.audio.length, raw.sampling_rate); buf.copyToChannel(new Float32Array(raw.audio), 0)
          const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.onended = () => done(); source.current = src; src.start()
        } else {
          const u = new SpeechSynthesisUtterance(s); const v = browserVoice(); if (v) u.voice = v
          u.onend = () => done(); u.onerror = () => done(); speechSynthesis.speak(u)
        }
      })
      if (id !== turnId.current) return
      said.current.push(s); current.current = ''
    }).finally(() => { if (id === turnId.current && --pending.current <= 0) { pending.current = 0; setTalking(false) } })
  }

  function stopSpeaking() {
    if (!speakingRef.current) return
    turnId.current++
    try { source.current?.stop() } catch { /* already stopped */ }
    speechSynthesis.cancel()
    pending.current = 0; chain.current = Promise.resolve(); setTalking(false)
    heardOnCut.current = said.current.join(' ')
  }

  async function send(text: string) {
    const t = text.trim(); if (!t) return
    audio() // unlock audio on this user gesture
    stopSpeaking()
    const heard = heardOnCut.current; heardOnCut.current = null
    const id = ++turnId.current; said.current = []
    setLines(l => [...l, { who: 'you', text: t }, { who: 'agent', text: '' }]); setBusy(true); setNote('')
    let text_ = '', spoken = 0
    const flush = (final: boolean) => {
      // speak every complete sentence as soon as it arrives
      const rest = text_.slice(spoken)
      const re = /[^.!?\n]+[.!?]+["')\]]*(\s+|$)|[^\n]+\n/g
      let m: RegExpExecArray | null, last = 0
      while ((m = re.exec(rest)) && (m.index + m[0].length < rest.length || final)) { say(m[0], id); last = m.index + m[0].length }
      if (final && last < rest.length) { say(rest.slice(last), id); last = rest.length }
      spoken += last
    }
    try {
      const res = await apiFetch<Response>('/api/core/talk', { raw: true, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, text: t, heard }) })
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new ApiError('SERVER_ERROR', res.status, (j as { error?: string }).error || 'No answer this time.') }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        let k
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, k); buf = buf.slice(k + 2)
          if (!chunk.startsWith('data: ')) continue
          const ev = JSON.parse(chunk.slice(6)) as { d?: string; done?: boolean; reply?: string; proposal?: Proposal | null; error?: string }
          if (ev.error) throw new ApiError('SERVER_ERROR', 500, ev.error)
          if (ev.d) {
            text_ += ev.d
            if (!text_.includes('```')) { setLines(l => [...l.slice(0, -1), { who: 'agent', text: text_ }]); if (id === turnId.current) flush(false) }
          }
          if (ev.done) {
            text_ = ev.reply ?? text_
            setLines(l => [...l.slice(0, -1), { who: 'agent', text: text_ }])
            if (ev.proposal) setProposal(ev.proposal)
            if (id === turnId.current) { spoken = Math.min(spoken, text_.length); flush(true) }
          }
        }
      }
    } catch (e) {
      setLines(l => (l[l.length - 1]?.text === '' ? l.slice(0, -1) : l))
      setNote(e instanceof ApiError ? e.message : 'The agents are unreachable right now.')
    } finally { setBusy(false) }
  }

  function startListening() {
    audio()
    const C = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
    if (!C) { setNote('Voice input needs Chrome or Edge. You can still type below.'); return }
    const r = new C(); r.continuous = true; r.interimResults = true; r.lang = 'en-GB'
    r.onresult = e => {
      let fin = '', mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (mid += e.results[i][0].transcript))
      const heardNow = (mid || fin).trim().toLowerCase()
      // Barge-in: two real words from you stop the agent (ignores its own voice leaking from the speakers).
      const echo = (said.current.join(' ') + ' ' + current.current).toLowerCase()
      if (speakingRef.current && heardNow.split(/\s+/).filter(Boolean).length >= 2 && !echo.includes(heardNow)) stopSpeaking()
      setInterim(mid)
      if (fin.trim() && !(speakingRef.current && echo.includes(fin.trim().toLowerCase()))) { setInterim(''); send(fin) }
    }
    r.onerror = e => { if (e.error === 'not-allowed') { setNote('Allow the microphone to talk. You can still type below.'); wantListen.current = false; setListening(false) } }
    r.onend = () => { if (wantListen.current) { try { r.start() } catch { /* already running */ } } }
    rec.current = r; wantListen.current = true; setListening(true)
    try { r.start() } catch { /* already running */ }
  }
  function stopListening() { wantListen.current = false; setListening(false); rec.current?.stop() }
  const toggleMic = () => (listening ? stopListening() : startListening())

  async function decide(approve: boolean) {
    if (!proposal) return
    try {
      await apiFetch('/api/core/proposals/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: proposal.id, approve }) })
      setNote(approve ? `${proposal.name} has joined the team.` : `${proposal.name} is set aside.`)
      setProposal(null)
    } catch { setNote('That did not save. Try again.') }
  }

  useEffect(() => () => { wantListen.current = false; rec.current?.stop(); turnId.current++; try { source.current?.stop() } catch { /* stopped */ } speechSynthesis.cancel() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])

  const first = name.split(' ')[0]
  return (
    <div className="core-talk" role="dialog" aria-modal="true" aria-label={`Talk to ${name}`} style={{ '--c': `var(${color})` } as React.CSSProperties}>
      <div className={`talk-portrait${speaking ? ' speaking' : ''}${busy ? ' thinking' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static portrait from /public, fixed size */}
        <img src={`/agents/${agent}.webp`} alt={`${name}, ${role}`} />
        <span className="talk-state">{busy && !speaking ? 'thinking' : speaking ? 'speaking' : listening ? 'listening' : 'ready'}{voicePct !== null ? ` · voice ${voicePct}%` : ''}</span>
        <button type="button" className={`talk-mic${listening ? ' on' : ''}`} aria-pressed={listening} aria-label={listening ? 'Stop listening' : `Talk to ${first}`} onClick={toggleMic}>
          <MicIcon /><span>{listening ? 'Listening' : 'Talk'}</span>
        </button>
      </div>
      <div className="talk-side">
        <header>
          <div><b>{name}</b><small>{role}</small></div>
          <button type="button" className="talk-x" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="talk-log" ref={logRef}>
          {lines.length === 0 && <p className="talk-hint">Tap the microphone and speak, or type below. Talk over {first} any time; they stop and listen.</p>}
          {lines.map((l, i) => (l.text ? <p key={i} className={l.who}>{l.text}</p> : <p key={i} className="agent interim">…</p>))}
          {interim && <p className="you interim">{interim}</p>}
        </div>
        {proposal && (
          <div className="talk-proposal">
            <span className="lab">New agent proposed</span>
            <b>{proposal.name}</b><p>{proposal.role}</p><p className="why">{proposal.why || proposal.playbook}</p>
            <div className="row"><button type="button" onClick={() => decide(true)}>Approve</button><button type="button" className="ghost" onClick={() => decide(false)}>Not now</button></div>
          </div>
        )}
        {note && <p className="talk-note">{note}</p>}
        <form className="talk-input" onSubmit={e => { e.preventDefault(); send(draft); setDraft('') }}>
          <button type="button" className={`mic${listening ? ' on' : ''}`} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Talk'} onClick={toggleMic}><MicIcon /></button>
          <input id="talk-draft" value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Message ${first}`} aria-label={`Message ${name}`} />
          <button type="submit" disabled={!draft.trim()}>Send</button>
        </form>
      </div>
    </div>
  )
}
