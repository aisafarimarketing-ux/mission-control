'use client'

// Our own voice: Kokoro (Apache-2.0) from /vendor + model files from /models on our VM, plus our pronunciation
// dictionary. Shared by the talk panel and the Dictionary.
import { apiFetch } from '@/lib/api-client'

export type Kokoro = { generate(text: string, o: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }> }
export type LexEntry = { ipa?: string; sayLike?: string; kind?: string; by?: string; at?: string }

export const VOICES = [
  'af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'af_kore', 'af_sarah', 'af_nova', 'af_sky', 'af_alloy', 'af_jessica', 'af_river',
  'am_michael', 'am_fenrir', 'am_puck', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_adam', 'am_santa',
  'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel',
] as const
export const voiceLabel = (v: string) => {
  const [p, n] = v.split('_')
  return `${n[0].toUpperCase()}${n.slice(1)} · ${p[0] === 'a' ? 'American' : 'British'} ${p[1] === 'f' ? 'woman' : 'man'}`
}
export const DEFAULT_VOICE: Record<string, string> = { kamanda: 'bm_george', 'reply-watch': 'af_heart', watchman: 'bf_emma', 'radar-scout': 'am_michael', 'mail-sync': 'am_eric' }

// ---------- engine (one per page; cached by the browser after the first load) ----------
let engine: Promise<Kokoro> | null = null
export const progressListeners = new Set<(pct: number) => void>()
export function loadVoice(): Promise<Kokoro> {
  engine ??= (async () => {
    await loadLexicon().catch(() => {})
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

// ---------- pronunciation dictionary ----------
let lexicon: Record<string, LexEntry> = {}
export const getLexicon = () => lexicon
export async function loadLexicon() {
  const j = await apiFetch<{ entries: Record<string, LexEntry> }>('/api/core/lexicon')
  setLexicon(j.entries || {})
  return lexicon
}
export function setLexicon(entries: Record<string, LexEntry>) { lexicon = entries; installHook() }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
type Espeak = (text: string, lang: string) => Promise<string>

// "ah-ROO-shah" -> sounds: each syllable through espeak, stress marks stripped, stress put on the CAPITAL syllable.
export async function sayLikeToSounds(sayLike: string, lang: string, espeak: Espeak) {
  const words = sayLike.trim().split(/\s+/)
  const out: string[] = []
  for (const w of words) {
    let ph = ''
    for (const syl of w.split('-').filter(Boolean)) {
      let p = (await espeak(syl.toLowerCase(), lang)).replace(/[ˈˌ\s]/g, '')
      if (syl.length > 1 && syl === syl.toUpperCase() && /[A-Z]/.test(syl)) p = p.replace(/([aeiouæɑɐɒəɛɜɪɔʊʌ])/, 'ˈ$1')
      ph += p
    }
    out.push(ph)
  }
  return out.join(' ')
}

// Called by our patched Kokoro for every stretch of text: dictionary words use their stored sounds.
function installHook() {
  const keys = Object.keys(lexicon).sort((a, b) => b.length - a.length)
  const re = keys.length ? new RegExp(`(?<![\\p{L}])(${keys.map(esc).join('|')})(?![\\p{L}])`, 'giu') : null
  ;(self as unknown as { __kokoroLex?: unknown }).__kokoroLex = async (text: string, lang: string, espeak: Espeak) => {
    if (!re) return espeak(text, lang)
    const parts: string[] = []; let last = 0
    for (const m of text.matchAll(re)) {
      const seg = text.slice(last, m.index)
      if (seg.trim()) parts.push(await espeak(seg, lang))
      const e = lexicon[m[0].toLowerCase()]
      parts.push(e?.ipa ? e.ipa : e?.sayLike ? await sayLikeToSounds(e.sayLike, lang, espeak) : await espeak(m[0], lang))
      last = (m.index ?? 0) + m[0].length
    }
    const tail = text.slice(last)
    if (tail.trim()) parts.push(await espeak(tail, lang))
    return parts.join(' ')
  }
}

// For the browser's own voice (no sound control): swap dictionary words for their plain-letters spelling.
export function respellForBrowser(text: string) {
  const keys = Object.keys(lexicon).filter(k => lexicon[k].sayLike).sort((a, b) => b.length - a.length)
  if (!keys.length) return text
  const re = new RegExp(`(?<![\\p{L}])(${keys.map(esc).join('|')})(?![\\p{L}])`, 'giu')
  return text.replace(re, w => (lexicon[w.toLowerCase()].sayLike || w).replace(/-/g, '').toLowerCase())
}

// Play one clip through the speakers; returns a stop function.
let ac: AudioContext | null = null
export function audioContext() {
  ac ??= new AudioContext()
  if (ac.state === 'suspended') ac.resume()
  return ac
}
export async function playClip(tts: Kokoro, text: string, voice: string): Promise<void> {
  const raw = await tts.generate(text, { voice })
  const ctx = audioContext(); const buf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate)
  buf.copyToChannel(new Float32Array(raw.audio), 0)
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination)
  await new Promise<void>(done => { src.onended = () => done(); src.start() })
}
