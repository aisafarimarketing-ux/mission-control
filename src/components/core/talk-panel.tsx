'use client'

// Talk to an agent: full portrait (torso on phones), our own Kokoro voice (served from our VM, runs in the browser),
// answers stream in and are spoken sentence by sentence. Speaking over the agent stops it at once, and the bridge
// is told exactly what was heard, so context is never lost.
import { useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'

type Line = { who: 'you' | 'agent'; text: string }
type Proposal = { id: string; name: string; role: string; playbook: string; look?: string; why?: string }
type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
import { VOICES, voiceLabel, DEFAULT_VOICE, loadVoice, progressListeners, respellForBrowser, audioContext, type Kokoro } from './voice'

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></svg>
)

export function TalkPanel({ agent, name, role, voice, color, onClose, onDictionary }: { agent: string; name: string; role: string; voice: 'M' | 'F'; color: string; onClose: () => void; onDictionary: () => void }) {
  const [pick, setPick] = useState(DEFAULT_VOICE[agent] || (voice === 'F' ? 'af_heart' : 'bm_george'))
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [draft, setDraft] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [note, setNote] = useState('')
  const [voicePct, setVoicePct] = useState<number | null>(null)
  const [micHelp, setMicHelp] = useState(false)
  // 'fast' = the browser's own natural voice (instant; Microsoft natural voices in Edge), 'kokoro' = our own voice.
  const [engine, setEngine] = useState<'fast' | 'kokoro'>('fast')
  const [rate, setRate] = useState(1.15) // talking speed, per device
  useEffect(() => { try { const r = Number(localStorage.getItem('core-voice-rate')); if (r >= 0.8 && r <= 1.6) setRate(r) } catch { /* blocked */ } }, [])
  function chooseRate(r: number) { setRate(r); try { localStorage.setItem('core-voice-rate', String(r)) } catch { /* blocked */ } }
  const base = useRef(0); const finEnd = useRef(0); const sessFin = useRef('') // recognition results already sent / final so far
  const pendingSpeech = useRef(''); const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // null = ready or not started
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

  useEffect(() => {
    const decide = () => { let saved: string | null = null; try { saved = localStorage.getItem('core-voice-engine') } catch { /* blocked */ }
      const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 500
      setEngine(phone ? 'fast' : saved === 'kokoro' || saved === 'fast' ? saved : hasNatural() ? 'fast' : 'kokoro') }
    decide(); speechSynthesis.addEventListener?.('voiceschanged', decide)
    return () => speechSynthesis.removeEventListener?.('voiceschanged', decide)
  }, [])
  function chooseEngine(e: 'fast' | 'kokoro') { setEngine(e); try { localStorage.setItem('core-voice-engine', e) } catch { /* blocked */ } }
  useEffect(() => { apiFetch<Record<string, string>>('/api/core/voices').then(p => { if (p[agent]) setPick(p[agent]) }).catch(() => {}) }, [agent])
  async function choose(v: string) {
    setPick(v)
    apiFetch('/api/core/voices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, voice: v }) }).catch(() => setNote('That voice choice did not save.'))
    if (tts.current) { stopSpeaking(); const id = ++turnId.current; say(`Karibu. This is how I sound now.`, id) }
  }

  // Load our voice once it is chosen (cached by the browser after the first time). Phones start on the fast voice:
  // our voice is generated on the device, and a phone makes it slower than speech, so it paused between sentences.
  useEffect(() => {
    if (engine !== 'kokoro' || tts.current) return
    const onPct = (p: number) => setVoicePct(p < 100 ? p : null)
    progressListeners.add(onPct)
    loadVoice().then(t => { tts.current = t; setVoicePct(null) }).catch(() => { setVoicePct(null); setNote('Our voice could not load here; using the browser voice for now.') })
    return () => { progressListeners.delete(onPct) }
  }, [engine])

  function audio() { ctx.current = audioContext(); return ctx.current }
  // The mic is off while the agent speaks: phone speakers leak into the mic and the agent answered its own words.
  // Tap Talk (or the portrait) to cut the agent short instead.
  function setTalking(on: boolean) {
    if (speakingRef.current === on) return
    speakingRef.current = on; setSpeaking(on)
    if (on) { if (sendTimer.current) clearTimeout(sendTimer.current); rec.current?.stop() }
    else setTimeout(() => { if (wantListen.current && !speakingRef.current) { try { rec.current?.start() } catch { /* already running */ } } }, 300)
  }

  function browserVoice() {
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
    const female = pick[1] === 'f', british = pick[0] === 'b'
    const want = female ? /(female|aria|jenny|sonia|libby|ava|emma|michelle|samantha|zira|serena|natasha)/i : /(male|guy|ryan|thomas|andrew|brian|christopher|eric|daniel|david|arthur|william)/i
    const natural = vs.filter(v => /natural|online|google/i.test(v.name))
    const gb = (l: SpeechSynthesisVoice[]) => l.filter(v => /GB/i.test(v.lang))
    return (british && gb(natural).find(v => want.test(v.name))) || natural.find(v => want.test(v.name)) || natural[0] || vs.find(v => want.test(v.name)) || vs[0]
  }
  const hasNatural = () => speechSynthesis.getVoices().some(v => v.lang.startsWith('en') && /natural|online/i.test(v.name))

  // Queue one sentence: synthesise with Kokoro (in parallel with playback of earlier ones), then play in order.
  function say(sentence: string, id: number) {
    const s = sentence.trim(); if (!s) return
    pending.current++; setTalking(true)
    const made = engine === 'kokoro' && tts.current ? tts.current.generate(s, { voice: pick, speed: rate }).catch(() => null) : Promise.resolve(null)
    chain.current = chain.current.then(async () => {
      const raw = await made
      if (id !== turnId.current) return
      current.current = s
      await new Promise<void>(done => {
        if (raw) {
          const ac = audio(); const buf = ac.createBuffer(1, raw.audio.length, raw.sampling_rate); buf.copyToChannel(new Float32Array(raw.audio), 0)
          const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.onended = () => done(); source.current = src; src.start()
        } else {
          const u = new SpeechSynthesisUtterance(respellForBrowser(s)); const v = browserVoice(); if (v) u.voice = v; u.rate = rate
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
      // speak every complete sentence as soon as it arrives; the very first chunk may stop at a comma
      // once it has about six words, so the voice starts sooner
      const rest = text_.slice(spoken)
      if (spoken === 0 && !final) {
        const c = rest.match(/^[^.!?\n]*?[,;:]\s+(?=\S)/)
        if (c && c[0].trim().split(/\s+/).length >= 6 && !/[.!?]/.test(c[0])) { say(c[0], id); spoken += c[0].length; return }
      }
      const re = /[^.!?\n]+[.!?]+["')\]]*(\s+|$)|[^\n]+\n/g
      let m: RegExpExecArray | null, last = 0
      while ((m = re.exec(rest)) && (m.index + m[0].length < rest.length || final)) { say(m[0], id); last = m.index + m[0].length }
      if (final && last < rest.length) { say(rest.slice(last), id); last = rest.length }
      spoken += last
    }
    // A finished sentence is spoken once the text pauses for a moment, without waiting for the next sentence to begin
    // (the next text can be many seconds away while the agent looks something up).
    let idle: ReturnType<typeof setTimeout> | null = null
    const flushSoon = () => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => {
        if (id !== turnId.current) return
        const m = text_.slice(spoken).match(/^[\s\S]*[.!?]["')\]]*\s*$/)
        if (m) { say(m[0], id); spoken += m[0].length }
      }, 350)
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
            if (!text_.includes('```')) { setLines(l => [...l.slice(0, -1), { who: 'agent', text: text_ }]); if (id === turnId.current) { flush(false); flushSoon() } }
          }
          if (ev.done) {
            text_ = ev.reply ?? text_
            setLines(l => [...l.slice(0, -1), { who: 'agent', text: text_ }])
            if (ev.proposal) setProposal(ev.proposal)
            if (idle) clearTimeout(idle)
            if (id === turnId.current) { spoken = Math.min(spoken, text_.length); flush(true) }
          }
        }
      }
    } catch (e) {
      setLines(l => (l[l.length - 1]?.text === '' ? l.slice(0, -1) : l))
      setNote(e instanceof ApiError ? e.message : 'The agents are unreachable right now.')
    } finally { setBusy(false) }
  }

  // First tap: ask the browser's own 'Allow microphone?' popup (one click). Blocked earlier: show the steps.
  async function askMic(): Promise<boolean> {
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName }).catch(() => null)
      if (st?.state === 'denied') { setMicHelp(true); return false }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      setMicHelp(false); return true
    } catch { setMicHelp(true); return false }
  }
  async function startListening() {
    audio()
    if (!(await askMic())) return
    const C = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
    if (!C) { setNote('Voice input needs Chrome or Edge. You can still type below.'); return }
    const r = new C(); r.continuous = true; r.interimResults = true; r.lang = 'en-GB'
    // Android's continuous mode re-sends everything heard so far as new results, which repeated each phrase many
    // times; there each phrase is its own short session. Results are read from `base` (what was already sent) onward.
    r.continuous = !/Android/i.test(navigator.userAgent)
    r.onresult = e => {
      let k = base.current, fin = '', mid = ''
      while (k < e.results.length && e.results[k].isFinal) fin += e.results[k++][0].transcript
      finEnd.current = k; sessFin.current = fin.trim()
      for (let i = k; i < e.results.length; i++) mid += e.results[i][0].transcript
      const heard = (pendingSpeech.current + ' ' + sessFin.current).trim()
      setInterim((heard + ' ' + mid).trim())
      if (sendTimer.current) clearTimeout(sendTimer.current)
      // Wait for a moment of quiet so a short pause does not cut you off.
      if (heard) sendTimer.current = setTimeout(sendHeard, mid ? 1600 : 1000)
    }
    r.onerror = e => { if (e.error === 'not-allowed') { setMicHelp(true); wantListen.current = false; setListening(false) } }
    r.onend = () => {
      pendingSpeech.current = (pendingSpeech.current + ' ' + sessFin.current).trim(); sessFin.current = ''; base.current = 0; finEnd.current = 0
      if (wantListen.current && !speakingRef.current) { try { r.start() } catch { /* already running */ } }
    }
    rec.current = r; wantListen.current = true; setListening(true)
    try { r.start() } catch { /* already running */ }
  }
  function sendHeard() {
    const t = (pendingSpeech.current + ' ' + sessFin.current).trim()
    pendingSpeech.current = ''; sessFin.current = ''; base.current = finEnd.current; setInterim('')
    if (t) send(t)
  }
  function stopListening() { wantListen.current = false; setListening(false); rec.current?.stop() }
  const toggleMic = () => (speakingRef.current ? stopSpeaking() : listening ? stopListening() : startListening())

  // Back: the phone's own back gesture or the Back button returns to the Core.
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  useEffect(() => {
    history.pushState({ coreTalk: true }, '')
    const back = () => onCloseRef.current()
    addEventListener('popstate', back)
    return () => removeEventListener('popstate', back)
  }, [])
  const close = () => (history.state?.coreTalk ? history.back() : onClose())

  async function decide(approve: boolean) {
    if (!proposal) return
    try {
      await apiFetch('/api/core/proposals/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: proposal.id, approve }) })
      setNote(approve ? `${proposal.name} has joined the team.` : `${proposal.name} is set aside.`)
      setProposal(null)
    } catch { setNote('That did not save. Try again.') }
  }

  useEffect(() => () => { wantListen.current = false; rec.current?.stop(); turnId.current++; try { source.current?.stop() } catch { /* stopped */ } speechSynthesis.cancel() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && close(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) })

  const first = name.split(' ')[0]
  return (
    <div className="core-talk" role="dialog" aria-modal="true" aria-label={`Talk to ${name}`} style={{ '--c': `var(${color})` } as React.CSSProperties}>
      <div className={`talk-portrait${speaking ? ' speaking' : ''}${busy ? ' thinking' : ''}`}>
        <button type="button" className="talk-back" onClick={close} aria-label="Back to the Core"><span aria-hidden="true">←</span> Back</button>
        {/* eslint-disable-next-line @next/next/no-img-element -- static portrait from /public, fixed size */}
        <img src={`/agents/${agent}.webp`} alt={`${name}, ${role}`} />
        <span className="talk-state">{busy && !speaking ? 'thinking' : speaking ? 'speaking' : listening ? 'listening' : 'ready'}{engine === 'kokoro' && voicePct !== null ? ` · our voice ${voicePct}%` : ''}</span>
        <button type="button" className={`talk-mic${listening ? ' on' : ''}`} aria-pressed={listening} aria-label={speaking ? `Stop ${first}` : listening ? 'Stop listening' : `Talk to ${first}`} onClick={toggleMic}>
          <MicIcon /><span>{speaking ? 'Stop' : listening ? 'Listening' : 'Talk'}</span>
        </button>
      </div>
      <div className="talk-side">
        <header>
          <div><b>{name}</b><small>{role}</small></div>
          <div className="talk-tools">
            <label className="talk-voice"><span>Voice</span>
              <select id="talk-voice" value={pick} onChange={e => choose(e.target.value)} aria-label={`${first}'s voice`}>
                {VOICES.map(v => <option key={v} value={v}>{voiceLabel(v)}</option>)}
              </select>
            </label>
            <div className="talk-engine" role="group" aria-label="Voice engine">
              <button type="button" aria-pressed={engine === 'fast'} className={engine === 'fast' ? 'on' : ''} onClick={() => chooseEngine('fast')}>Fast voice</button>
              <button type="button" aria-pressed={engine === 'kokoro'} className={engine === 'kokoro' ? 'on' : ''} onClick={() => chooseEngine('kokoro')}>Our voice</button>
            </div>
            <label className="talk-voice"><span>Speed</span>
              <select id="talk-rate" value={rate} onChange={e => chooseRate(Number(e.target.value))} aria-label="Talking speed">
                {[1, 1.1, 1.15, 1.25, 1.35, 1.5].map(r => <option key={r} value={r}>{r}×</option>)}
              </select>
            </label>
            <button type="button" className="talk-x" onClick={onDictionary}>Dictionary</button>
            <button type="button" className="talk-x" onClick={close} aria-label="Close">Close</button>
          </div>
        </header>
        <div className="talk-log" ref={logRef}>
          {lines.length === 0 && <p className="talk-hint">Tap Talk and speak, or type below. While {first} speaks the mic rests; tap Stop to cut in.</p>}
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
        {micHelp && (
          <div className="talk-proposal mic-help" role="alert">
            <span className="lab">Your microphone is blocked for this page</span>
            <p>1. Click the small icon at the left of the address bar, just before core.safaritechlab.com.</p>
            <p>2. Set <b>Microphone</b> to <b>Allow</b>.</p>
            <p>3. Press <b>Try again</b>. On Windows, also check Settings → Privacy &amp; security → Microphone is on for desktop apps.</p>
            <div className="row"><button type="button" onClick={() => { setMicHelp(false); startListening() }}>Try again</button><button type="button" className="ghost" onClick={() => setMicHelp(false)}>Type instead</button></div>
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
