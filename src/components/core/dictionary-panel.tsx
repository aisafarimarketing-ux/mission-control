'use client'

// The pronunciation dictionary: add any word or phrase and how it should sound, hear it, save it.
// Every agent's voice uses it at once. Stored on the VM (bridge /lexicon), shared across devices.
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'
import { VOICES, voiceLabel, loadVoice, progressListeners, setLexicon, loadLexicon, playClip, type Kokoro, type LexEntry } from './voice'

export function DictionaryPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Record<string, LexEntry>>({})
  const [q, setQ] = useState('')
  const [word, setWord] = useState('')
  const [sayLike, setSayLike] = useState('')
  const [ipa, setIpa] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [voice, setVoice] = useState('bm_george')
  const [note, setNote] = useState('')
  const [pct, setPct] = useState<number | null>(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const tts = useRef<Kokoro | null>(null)
  const wordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadLexicon().then(setEntries).catch(() => setNote('The dictionary could not load. Check the agents are reachable.'))
    const onPct = (p: number) => setPct(p < 100 ? p : null)
    progressListeners.add(onPct)
    loadVoice().then(t => { tts.current = t; setPct(null) }).catch(() => { setPct(null); setNote('The voice could not load here, so Play is off. You can still add and save words.') })
    return () => { progressListeners.delete(onPct) }
  }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])

  const list = useMemo(() => Object.entries(entries).filter(([w, e]) => !q || w.includes(q.toLowerCase()) || (e.sayLike || '').toLowerCase().includes(q.toLowerCase())).sort(([a], [b]) => a.localeCompare(b)), [entries, q])

  async function play(text: string, key: string, draft?: LexEntry & { word: string }) {
    if (!tts.current) { setNote('The voice is still loading.'); return }
    // Preview an unsaved entry by putting it in the dictionary for this one clip.
    const saved = entries
    if (draft) setLexicon({ ...saved, [draft.word.toLowerCase()]: { ipa: draft.ipa || undefined, sayLike: draft.sayLike || undefined } })
    setPlaying(key)
    try { await playClip(tts.current, text, voice) } catch { setNote('That could not play.') } finally { setPlaying(null); if (draft) setLexicon(saved) }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!word.trim() || (!sayLike.trim() && !ipa.trim())) { setNote('Add the word and how it should sound.'); return }
    try {
      const j = await apiFetch<{ entries: Record<string, LexEntry> }>('/api/core/lexicon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ word, sayLike: sayLike.trim() || undefined, ipa: ipa.trim() || undefined }) })
      setEntries(j.entries); setLexicon(j.entries)
      setNote(`Saved. Every agent now says “${word.trim()}” this way.`)
      setWord(''); setSayLike(''); setIpa(''); wordRef.current?.focus()
    } catch (err) { setNote(err instanceof ApiError ? err.message : 'That did not save. Try again.') }
  }

  async function remove(w: string) {
    try {
      const j = await apiFetch<{ entries: Record<string, LexEntry> }>('/api/core/lexicon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ word: w, remove: true }) })
      setEntries(j.entries); setLexicon(j.entries); setNote(`“${w}” removed.`)
    } catch { setNote('That did not remove. Try again.') }
  }

  function edit(w: string, e: LexEntry) { setWord(w); setSayLike(e.sayLike || ''); setIpa(e.ipa || ''); setAdvanced(!!e.ipa); wordRef.current?.focus() }

  const draft = { word, sayLike, ipa }
  const ready = !!tts.current && pct === null
  return (
    <div className="core-talk core-dict" role="dialog" aria-modal="true" aria-label="Pronunciation dictionary">
      <div className="dict-main">
        <header>
          <div><b>Dictionary</b><small>{Object.keys(entries).length} words · every agent uses these</small></div>
          <div className="talk-tools">
            <label className="talk-voice"><span>Hear in</span>
              <select id="dict-voice" value={voice} onChange={e => setVoice(e.target.value)} aria-label="Voice to hear words in">
                {VOICES.map(v => <option key={v} value={v}>{voiceLabel(v)}</option>)}
              </select>
            </label>
            <button type="button" className="talk-x" onClick={onClose}>Close</button>
          </div>
        </header>

        <form className="dict-add" onSubmit={save}>
          <div className="row">
            <label><span>Word or name</span><input ref={wordRef} id="dict-word" value={word} onChange={e => setWord(e.target.value)} placeholder="e.g. Ngorongoro" /></label>
            <label><span>Sounds like</span><input id="dict-saylike" value={sayLike} onChange={e => setSayLike(e.target.value)} placeholder="e.g. ngoro-NGORO (CAPITALS = stressed)" /></label>
          </div>
          {advanced && <label><span>Exact sounds (optional, for experts)</span><input id="dict-ipa" value={ipa} onChange={e => setIpa(e.target.value)} placeholder="e.g. ŋɡoɾoŋɡˈoɾo" /></label>}
          <div className="row actions">
            <button type="button" disabled={!ready || !word.trim()} onClick={() => play(word, 'draft', draft)}>{playing === 'draft' ? 'Playing…' : 'Play'}</button>
            <button type="button" disabled={!ready || !word.trim()} onClick={() => play(`Tomorrow we drive to ${word}, and I think you will love it.`, 'draft-s', draft)}>{playing === 'draft-s' ? 'Playing…' : 'In a sentence'}</button>
            <button type="submit">Save</button>
            <button type="button" className="ghost" onClick={() => setAdvanced(a => !a)}>{advanced ? 'Hide exact sounds' : 'Exact sounds'}</button>
          </div>
          <p className="dict-hint">{pct !== null ? `Loading the voice… ${pct}%` : 'Type it the way it sounds, split by dashes, with the stressed part in CAPITALS. Play, adjust, save.'}</p>
        </form>
        {note && <p className="talk-note">{note}</p>}

        <input className="dict-search" id="dict-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search the dictionary" aria-label="Search the dictionary" />
        <div className="dict-list">
          {list.map(([w, e]) => (
            <div key={w} className="dict-row">
              <div className="dict-w"><b>{w}</b><small>{e.sayLike || e.ipa}{e.kind ? ` · ${e.kind}` : ''}</small></div>
              <button type="button" disabled={!ready} onClick={() => play(w, w)} aria-label={`Play ${w}`}>{playing === w ? '…' : 'Play'}</button>
              <button type="button" className="ghost" onClick={() => edit(w, e)} aria-label={`Edit ${w}`}>Edit</button>
              <button type="button" className="ghost" onClick={() => remove(w)} aria-label={`Remove ${w}`}>Remove</button>
            </div>
          ))}
          {list.length === 0 && <p className="dict-hint">{q ? 'No match. Add it above.' : 'No words yet. Add the first one above.'}</p>}
        </div>
      </div>
    </div>
  )
}
