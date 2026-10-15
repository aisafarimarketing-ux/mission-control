'use client'

// Talk to an agent: full portrait (torso on phones), free browser voice in and out, barge-in.
// Speaking over the agent stops it at once; the bridge is told exactly what you heard, so context is never lost.
import { useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'

type Line = { who: 'you' | 'agent'; text: string }
type Proposal = { id: string; name: string; role: string; playbook: string; look?: string; why?: string }
type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

const sentences = (t: string) => t.match(/[^.!?]+[.!?]*\s*/g)?.map(s => s.trim()).filter(Boolean) ?? [t]

export function TalkPanel({ agent, name, role, voice, color, onClose }: { agent: string; name: string; role: string; voice: 'M' | 'F'; color: string; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [draft, setDraft] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [note, setNote] = useState('')
  const rec = useRef<SR | null>(null)
  const wantListen = useRef(false)
  const said = useRef<string[]>([]) // sentences already spoken aloud in the current answer
  const heardOnCut = useRef<string | null>(null)
  const speakingRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [lines, interim])

  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
    const want = voice === 'F' ? /(female|aria|jenny|sonia|libby|samantha|zira|google uk english female|serena)/i : /(male|guy|ryan|thomas|daniel|david|google uk english male|arthur)/i
    return vs.find(v => /natural|online/i.test(v.name) && want.test(v.name)) || vs.find(v => want.test(v.name)) || vs[0]
  }

  function stopSpeaking() {
    if (!speakingRef.current) return
    speechSynthesis.cancel()
    speakingRef.current = false; setSpeaking(false)
    heardOnCut.current = said.current.join(' ')
  }

  function speak(text: string) {
    speechSynthesis.cancel(); said.current = []
    const parts = sentences(text); const v = pickVoice()
    speakingRef.current = true; setSpeaking(true)
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p)
      if (v) u.voice = v
      u.rate = 1.02
      u.onend = () => { if (!speakingRef.current) return; said.current.push(p); if (i === parts.length - 1) { speakingRef.current = false; setSpeaking(false) } }
      speechSynthesis.speak(u)
    })
  }

  async function send(text: string) {
    const t = text.trim(); if (!t || busy) return
    stopSpeaking()
    const heard = heardOnCut.current; heardOnCut.current = null
    setLines(l => [...l, { who: 'you', text: t }]); setBusy(true); setNote('')
    try {
      const j = await apiFetch<{ reply: string; proposal: Proposal | null }>('/api/core/talk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, text: t, heard }) })
      setLines(l => [...l, { who: 'agent', text: j.reply }])
      if (j.proposal) setProposal(j.proposal)
      speak(j.reply)
    } catch (e) { setNote(e instanceof ApiError ? e.message : 'The agents are unreachable right now.') } finally { setBusy(false) }
  }

  function startListening() {
    const C = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
    if (!C) { setNote('Voice needs Chrome or Edge. You can still type below.'); return }
    const r = new C(); r.continuous = true; r.interimResults = true; r.lang = 'en-GB'
    r.onresult = e => {
      let fin = '', mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (mid += e.results[i][0].transcript))
      // Barge-in: two real words from you while the agent talks stops it (ignores its own voice leaking into the mic).
      const words = (mid || fin).trim().split(/\s+/).filter(Boolean)
      if (speakingRef.current && words.length >= 2 && !said.current.join(' ').toLowerCase().includes((mid || fin).trim().toLowerCase())) stopSpeaking()
      setInterim(mid)
      if (fin.trim()) { setInterim(''); send(fin) }
    }
    r.onerror = e => { if (e.error === 'not-allowed') { setNote('Allow the microphone to talk. You can still type below.'); wantListen.current = false; setListening(false) } }
    r.onend = () => { if (wantListen.current) { try { r.start() } catch { /* already running */ } } }
    rec.current = r; wantListen.current = true; setListening(true)
    try { r.start() } catch { /* already running */ }
  }
  function stopListening() { wantListen.current = false; setListening(false); rec.current?.stop() }

  async function decide(approve: boolean) {
    if (!proposal) return
    try {
      await apiFetch('/api/core/proposals/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: proposal.id, approve }) })
      setNote(approve ? `${proposal.name} has joined the team.` : `${proposal.name} is set aside.`)
      setProposal(null)
    } catch { setNote('That did not save. Try again.') }
  }

  useEffect(() => () => { wantListen.current = false; rec.current?.stop(); speechSynthesis.cancel() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])

  return (
    <div className="core-talk" role="dialog" aria-modal="true" aria-label={`Talk to ${name}`} style={{ '--c': `var(${color})` } as React.CSSProperties}>
      <div className={`talk-portrait${speaking ? ' speaking' : ''}${busy ? ' thinking' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static portrait from /public, fixed size */}
        <img src={`/agents/${agent}.webp`} alt={`${name}, ${role}`} />
        <span className="talk-state">{busy ? 'thinking' : speaking ? 'speaking' : listening ? 'listening' : 'ready'}</span>
      </div>
      <div className="talk-side">
        <header>
          <div><b>{name}</b><small>{role}</small></div>
          <button type="button" className="talk-x" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="talk-log" ref={logRef}>
          {lines.length === 0 && <p className="talk-hint">Tap <b>Talk</b> and speak, or type below. Talk over {name.split(' ')[0]} any time; they stop and listen.</p>}
          {lines.map((l, i) => <p key={i} className={l.who}>{l.text}</p>)}
          {interim && <p className="you interim">{interim}</p>}
          {busy && <p className="agent interim">…</p>}
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
          <button type="button" className={`mic${listening ? ' on' : ''}`} aria-pressed={listening} onClick={() => (listening ? stopListening() : startListening())}>{listening ? 'Listening' : 'Talk'}</button>
          <input id="talk-draft" value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Message ${name.split(' ')[0]}`} aria-label={`Message ${name}`} />
          <button type="submit" disabled={!draft.trim() || busy}>Send</button>
        </form>
      </div>
    </div>
  )
}
