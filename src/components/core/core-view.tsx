'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { TalkPanel } from './talk-panel'
import { DictionaryPanel } from './dictionary-panel'
import { MailboxesPanel } from './mailboxes-panel'
import { useNavigateToPanel } from '@/lib/navigation'
import { useMissionControl } from '@/store'
import { apiFetch } from '@/lib/api-client'
import { SNAPSHOT, opsSummary, type OpsFeed } from './core-snapshot'

// The v13 command room (artifact 7r6nd3aRiqhFX7NGdVKW9K). Styles live in src/app/core.css.

type Surface = { h: number; s: number; l: number; tex: string; depth: number }
const DEFAULT_SURFACE: Surface = { h: 42, s: 26, l: 88, tex: 'grain', depth: 0.5 }
const SURFACE_KEY = 'core-surface'

const TEX: Record<string, string> = {
  grain: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23g)'/%3E%3C/svg%3E\")",
  stucco: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.05' numOctaves='4' seed='9'/%3E%3CfeDiffuseLighting lighting-color='white' surfaceScale='2.4' diffuseConstant='1'%3E%3CfeDistantLight azimuth='235' elevation='55'/%3E%3C/feDiffuseLighting%3E%3C/filter%3E%3Crect width='280' height='280' filter='url(%23s)'/%3E%3C/svg%3E\")",
  linen: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='l'%3E%3CfeTurbulence type='turbulence' baseFrequency='.012 .35' numOctaves='2' seed='3'/%3E%3CfeDiffuseLighting lighting-color='white' surfaceScale='1.3' diffuseConstant='1.1'%3E%3CfeDistantLight azimuth='225' elevation='62'/%3E%3C/feDiffuseLighting%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23l)'/%3E%3C/svg%3E\")",
  atlas: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='420'%3E%3Cdefs%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='3' seed='11' result='n'/%3E%3CfeDisplacementMap in='SourceGraphic' in2='n' scale='34'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23w)' fill='none' stroke='%23555' stroke-width='.7' opacity='.6'%3E%3Ccircle cx='210' cy='210' r='28'/%3E%3Ccircle cx='210' cy='210' r='52'/%3E%3Ccircle cx='210' cy='210' r='76'/%3E%3Ccircle cx='210' cy='210' r='100'/%3E%3Ccircle cx='210' cy='210' r='124'/%3E%3Ccircle cx='210' cy='210' r='148'/%3E%3Ccircle cx='210' cy='210' r='172'/%3E%3Ccircle cx='210' cy='210' r='196'/%3E%3Ccircle cx='210' cy='210' r='220'/%3E%3C/g%3E%3C/svg%3E\")",
  smooth: 'none',
  glass: 'none',
}
const TEX_NAMES = ['grain', 'stucco', 'linen', 'atlas', 'glass', 'smooth']
const PRESETS: { name: string; h: number; s: number; l: number }[] = [
  { name: 'Sand', h: 42, s: 26, l: 88 },
  { name: 'Clay', h: 18, s: 30, l: 78 },
  { name: 'Mist', h: 210, s: 14, l: 86 },
  { name: 'Night', h: 36, s: 18, l: 18 },
]

function surfaceVars(st: Surface): Record<string, string> {
  const { h, s, l, tex } = st
  const dark = l < 50
  const glass = tex === 'glass'
  const L = (d: number) => Math.max(4, Math.min(98, l + d))
  return {
    '--gh': String(h), '--gs': String(s), '--gl': String(l),
    '--ground': `hsl(${h},${s}%,${l}%)`,
    '--ground-deep': glass ? (dark ? 'hsla(0,0%,100%,.1)' : 'hsla(0,0%,100%,.45)') : `hsl(${h},${s}%,${L(dark ? -4 : -5)}%)`,
    '--card': glass ? (dark ? 'hsla(0,0%,100%,.1)' : 'hsla(0,0%,100%,.52)') : `hsl(${h},${Math.min(45, s + 2)}%,${L(dark ? 4 : 3)}%)`,
    '--card-hi': glass ? (dark ? 'hsla(0,0%,100%,.2)' : 'hsla(0,0%,100%,.8)') : `hsl(${h},${Math.min(48, s + 4)}%,${L(dark ? 8 : 6)}%)`,
    '--panel': glass ? (dark ? 'hsla(0,0%,8%,.42)' : 'hsla(0,0%,100%,.42)') : `hsl(${h},${s}%,${L(dark ? 2 : -2)}%)`,
    '--card-blur': glass ? '20px' : '0px',
    '--card-border': glass ? (dark ? 'hsla(0,0%,100%,.18)' : 'hsla(0,0%,100%,.65)') : 'transparent',
    '--sh-lo': glass ? 'hsla(0,0%,100%,.08)' : dark ? `hsla(${h},${Math.min(40, s + 8)}%,${L(22)}%,.09)` : `hsla(${h},${Math.min(60, s + 20)}%,99%,.9)`,
    '--sh-hi': glass ? (dark ? 'hsla(0,0%,0%,.45)' : 'hsla(220,20%,40%,.22)') : dark ? 'hsla(0,0%,0%,.55)' : `hsla(${h},${Math.max(10, s - 6)}%,${L(-34)}%,.42)`,
    '--ink': dark ? `hsl(${h},16%,93%)` : `hsl(${h},22%,14%)`,
    '--ink-2': dark ? `hsl(${h},11%,74%)` : `hsl(${h},16%,31%)`,
    '--ink-3': dark ? `hsl(${h},8%,58%)` : `hsl(${h},12%,36%)`,
    '--hair': dark ? `hsla(${h},20%,80%,.12)` : `hsla(${h},20%,30%,.16)`,
    '--tex': TEX[tex] || 'none',
    '--tex-op': String(tex === 'smooth' || glass ? 0 : (0.18 + st.depth * 0.72) * (tex === 'stucco' ? 0.8 : tex === 'atlas' ? 0.55 : 1)),
  }
}

/* ---------- icons (raw SVG, no icon library) ---------- */
const I = {
  core: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8.5" strokeDasharray="3 5" /></svg>,
  ledger: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="13" rx="3" /><path d="M8 9h8M8 13h5" /></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V5z" /></svg>,
  pulse: <svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 3 10 2.5-7 1.5 2H21" /></svg>,
  grow: <svg viewBox="0 0 24 24"><path d="M4 18 10 12l3 3 7-8" /><path d="M15 7h5v5" /></svg>,
  radar: <svg viewBox="0 0 24 24"><path d="M12 12 19 5" /><path d="M4 12a8 8 0 0 1 8-8" /><path d="M7 12a5 5 0 0 1 5-5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>,
  build: <svg viewBox="0 0 24 24"><path d="M9 8l-4 4 4 4" /><path d="M15 8l4 4-4 4" /></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M6.8 6.8 5.4 5.4M18.6 18.6l-1.4-1.4M6.8 17.2l-1.4 1.4M18.6 5.4l-1.4 1.4" /></svg>,
  gent: <svg viewBox="0 0 24 24"><use href="#agent-gent" /></svg>,
  lady: <svg viewBox="0 0 24 24"><use href="#agent-lady" /></svg>,
  humans: <svg viewBox="0 0 24 24"><circle cx="8.5" cy="7.5" r="3" /><path d="M2.5 20c.5-3.4 3-5.4 6-5.4s5.5 2 6 5.4" /><circle cx="16.5" cy="8.5" r="2.4" /><path d="M14.5 20c.3-2.8 2.2-4.6 5-4.6" /></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M21 4 10 15" /><path d="M21 4l-7 17-3-7-7-3z" /></svg>,
  shieldOk: <svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V5z" /><path d="M9.5 12l2 2 3.5-4" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M20 7 9 18l-5-5" /></svg>,
  report: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>,
  beat: <svg viewBox="0 0 24 24"><path d="M5 12h4l2-5 3 10 2-5h3" /></svg>,
}
const ICONS: Record<string, ReactNode> = I

const v = (c: string) => ({ '--c': `var(${c})` }) as CSSProperties

/* ---------- the schematic clockwork heart (deterministic SVG) ---------- */
function machineSvg(): string {
  const C = 215, svg: string[] = []
  const P = (a: number, r: number) => [C + Math.cos(a) * r, C + Math.sin(a) * r]
  const ink = 'var(--ink-2)', ink3 = 'var(--ink-3)', gold = 'var(--glowk)'
  svg.push(`<circle cx="${C}" cy="${C}" r="196" fill="none" stroke="${ink3}" stroke-width=".7" opacity=".5"/>`)
  svg.push(`<circle cx="${C}" cy="${C}" r="186" fill="none" stroke="${ink3}" stroke-width=".5" opacity=".35" stroke-dasharray="1 5"/>`)
  svg.push(`<g class="slower"><circle cx="${C}" cy="${C}" r="168" fill="none" stroke="${ink3}" stroke-width=".8" opacity=".55" stroke-dasharray="40 8 4 8"/></g>`)
  let ticks = ''
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2, big = i % 10 === 0, [x1, y1] = P(a, 158), [x2, y2] = P(a, big ? 148 : 153)
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${big ? ink : ink3}" stroke-width="${big ? 1.1 : 0.6}" opacity="${big ? 0.75 : 0.4}"/>`
  }
  svg.push(`<g>${ticks}</g>`)
  let mods = ''
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 0.31, [x, y] = P(a, 140)
    mods += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(a * 180 / Math.PI + 90).toFixed(1)})"><rect x="-7" y="-4" width="14" height="8" rx="1.4" fill="none" stroke="${ink}" stroke-width=".9" opacity=".7"/><line x1="-4" y1="0" x2="4" y2="0" stroke="${ink3}" stroke-width=".6" opacity=".6"/><circle cx="0" cy="-7.5" r="1" fill="${ink3}" opacity=".6"/></g>`
  }
  svg.push(`<g>${mods}</g>`)
  svg.push(`<circle cx="${C}" cy="${C}" r="128" fill="none" stroke="${ink3}" stroke-width=".6" opacity=".45"/>`)
  svg.push(`<defs><path id="arcN" d="M ${C - 118} ${C} A 118 118 0 0 1 ${C + 118} ${C}"/><path id="arcS" d="M ${C - 108} ${C} A 108 108 0 0 0 ${C + 108} ${C}"/></defs>`)
  svg.push(`<text font-family="var(--mono)" font-size="9.5" letter-spacing="3.5" fill="${ink3}" opacity=".8"><textPath href="#arcN" startOffset="14%">SAFARI TECH LAB · CORE</textPath></text>`)
  svg.push(`<text font-family="var(--mono)" font-size="8" letter-spacing="3" fill="${ink3}" opacity=".6"><textPath href="#arcS" startOffset="30%">JARVIS · No. 001</textPath></text>`)
  let teeth = ''
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * 360
    teeth += `<rect x="-2.4" y="-96" width="4.8" height="7" rx="1" fill="none" stroke="${ink}" stroke-width=".9" opacity=".65" transform="rotate(${a.toFixed(1)} ${C} ${C}) translate(${C} ${C})"/>`
  }
  svg.push(`<g class="slow">${teeth}<circle cx="${C}" cy="${C}" r="89" fill="none" stroke="${ink}" stroke-width="1" opacity=".6"/></g>`)
  svg.push(`<circle cx="${C}" cy="${C}" r="78" fill="none" stroke="${ink3}" stroke-width=".5" opacity=".4" stroke-dasharray="2 4"/>`)
  const arm = (rot: number, len: number) => {
    let s = `<g transform="rotate(${rot} ${C} ${C})">`, y = 68
    for (const [w, h] of [[10, 34], [8, 22], [6, 14]]) {
      if (y + h > len) break
      s += `<rect x="${C - w / 2}" y="${C - y - h}" width="${w}" height="${h}" rx="1.5" fill="none" stroke="${ink}" stroke-width="1" opacity=".75"/>`
      s += `<line x1="${C - w / 2 - 3}" y1="${C - y - h / 2}" x2="${C + w / 2 + 3}" y2="${C - y - h / 2}" stroke="${ink3}" stroke-width=".5" opacity=".5"/>`
      y += h + 4
    }
    s += `<line x1="${C}" y1="${C - y}" x2="${C}" y2="${C - len}" stroke="${ink}" stroke-width="1" opacity=".7"/>`
    s += `<path d="M ${C - 3} ${C - len + 4} L ${C} ${C - len - 2} L ${C + 3} ${C - len + 4} Z" fill="none" stroke="${ink}" stroke-width=".9" opacity=".75"/>`
    return s + '</g>'
  }
  svg.push(arm(0, 170), arm(180, 104), arm(90, 126), arm(270, 126))
  let rosette = ''
  for (let i = 0; i < 12; i++) rosette += `<rect x="-2" y="-31" width="4" height="6" rx="1" fill="${gold}" opacity=".9" transform="rotate(${i * 30} 0 0)"/>`
  svg.push(`<g transform="translate(${C},${C})"><circle r="40" fill="none" stroke="${ink3}" stroke-width=".6" opacity=".5" stroke-dasharray="1 3"/><circle r="33" fill="var(--card)" stroke="${ink}" stroke-width="1" opacity=".95"/><g class="slow" style="transform-origin:0 0">${rosette}</g><circle r="24" fill="none" stroke="${gold}" stroke-width="1.4" opacity=".95"/><circle r="17" fill="none" stroke="${gold}" stroke-width=".7" opacity=".7" stroke-dasharray="8 3"/><circle r="9" fill="${gold}" opacity=".92"/><circle r="3.2" fill="var(--card)"/></g>`)
  const LBL = ['CAL 4.2', 'A-01', 'SEC·0', 'PX 12', 'R-36', 'Q.07', 'IO 88', 'N-24', 'GT-5', 'V 1.3', 'HB 60s', 'LD-9']
  let ann = ''
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26 + (i % 3) * 0.11
    if (Math.sin(a) > 0.72) continue // keep the south clear for the founder's gate
    const [x1, y1] = P(a, 198), dx = Math.cos(a) > 0 ? 14 : -14, [x0, y0] = P(a, 176)
    ann += `<circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="1.1" fill="${ink3}" opacity=".7"/><path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} l ${dx} 0" fill="none" stroke="${ink3}" stroke-width=".55" opacity=".5"/><text x="${(x1 + dx + (dx > 0 ? 2 : -2)).toFixed(1)}" y="${(y1 + 2).toFixed(1)}" font-family="var(--mono)" font-size="6.5" fill="${ink3}" opacity=".75" text-anchor="${dx > 0 ? 'start' : 'end'}">${LBL[i]}</text>`
  }
  svg.push(`<g>${ann}</g>`)
  return svg.join('')
}
const MACHINE = machineSvg()

/* ---------- silk thread-bundles with breathing pulses (canvas) ---------- */
type Pt = { x: number; y: number }
type Thread = { pts: Pt[]; cum: number[]; total: number }
type Bundle = { threads: Thread[]; col: string; end: Pt }

function startSilk(root: HTMLElement, mainEl: HTMLElement, cv: HTMLCanvasElement): () => void {
  const ctx = cv.getContext('2d')
  if (!ctx) return () => {}
  let W = 0, H = 0, wires: Bundle[] = [], raf = 0
  const ripples: { x: number; y: number; t: number; col: string }[] = []
  const prevP: number[] = []
  const N_TH = 6, CYCLE = 4600
  const cardColor = (el: Element) => {
    const c = getComputedStyle(el).getPropertyValue('--c').trim()
    return c.startsWith('var(') ? getComputedStyle(root).getPropertyValue(c.slice(4, -1)).trim() : c
  }
  const bez = (a: Pt, c: Pt, b: Pt, n: number) => {
    const pts: Pt[] = []
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }) }
    return pts
  }
  const thread = (pts: Pt[]): Thread => {
    const cum = [0]; let tot = 0
    for (let i = 1; i < pts.length; i++) { tot += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(tot) }
    return { pts, cum, total: tot }
  }
  const along = (th: Thread, t: number): Pt => {
    const d = Math.max(0, Math.min(1, t)) * th.total; let i = 1
    while (i < th.cum.length && th.cum[i] < d) i++
    if (i >= th.pts.length) return th.pts[th.pts.length - 1]
    const seg = (d - th.cum[i - 1]) / ((th.cum[i] - th.cum[i - 1]) || 1)
    return { x: th.pts[i - 1].x + (th.pts[i].x - th.pts[i - 1].x) * seg, y: th.pts[i - 1].y + (th.pts[i].y - th.pts[i - 1].y) * seg }
  }
  const makeBundle = (a: Pt, b: Pt, C0: Pt, k: number, n: number, col: string, dirIn: boolean): Bundle => {
    const threads: Thread[] = []
    for (let j = 0; j < N_TH; j++) {
      const f = j - (N_TH - 1) / 2
      const ang = Math.atan2((dirIn ? a.y : b.y) - C0.y, (dirIn ? a.x : b.x) - C0.x)
      const rimPt = { x: C0.x + Math.cos(ang + f * 0.06) * 46, y: C0.y + Math.sin(ang + f * 0.06) * 46 }
      const p0 = dirIn ? { x: a.x, y: a.y + f * 7 } : rimPt, p1 = dirIn ? rimPt : { x: b.x, y: b.y + f * 7 }
      const bow = ((k - (n - 1) / 2) * 26) + f * 10 + (p1.y - p0.y) * 0.08
      threads.push(thread(bez(p0, { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 + bow }, p1, 22)))
    }
    return { threads, col, end: threads[Math.floor(N_TH / 2)].pts[22] }
  }
  const measure = () => {
    const r = mainEl.getBoundingClientRect()
    cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); W = r.width; H = r.height
    const m = root.querySelector('.machine')
    if (!m) return
    const cr = m.getBoundingClientRect()
    const C0 = { x: cr.left - r.left + cr.width / 2, y: cr.top - r.top + cr.height / 2 }
    wires = []
    const L = [...root.querySelectorAll('.rail.left .wcard')]
    L.forEach((t, i) => { const q = t.getBoundingClientRect(); wires.push(makeBundle({ x: q.right - r.left, y: q.top - r.top + q.height / 2 }, C0, C0, i, L.length, cardColor(t), true)) })
    const R = [...root.querySelectorAll('.rail.right .wcard')]
    R.forEach((t, i) => { const q = t.getBoundingClientRect(); wires.push(makeBundle(C0, { x: q.left - r.left, y: q.top - r.top + q.height / 2 }, C0, i, R.length, cardColor(t), false)) })
  }
  const hx = (c: string, a: number) => {
    c = (c || '').trim()
    if (!c || c[0] !== '#' || c.length < 7) return `rgba(160,105,14,${a})`
    const n = parseInt(c.slice(1, 7), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const easeIO = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  const tick = (now: number) => {
    ctx.clearRect(0, 0, W, H)
    const dark = root.dataset.tone === 'dark'
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    for (const w of wires) {
      ctx.strokeStyle = hx(w.col, dark ? 0.2 : 0.22); ctx.lineWidth = 0.8
      for (const th of w.threads) { ctx.beginPath(); ctx.moveTo(th.pts[0].x, th.pts[0].y); for (let i = 1; i < th.pts.length; i++) ctx.lineTo(th.pts[i].x, th.pts[i].y); ctx.stroke() }
    }
    for (let i = 0; i < wires.length; i++) {
      const w = wires[i], raw = ((now / CYCLE) + i / wires.length) % 1, p = easeIO(raw)
      if (prevP[i] !== undefined && raw < prevP[i]) ripples.push({ x: w.end.x, y: w.end.y, t: 0, col: w.col })
      prevP[i] = raw
      const LEN = 0.2, N = 10
      for (let j = 0; j < 3; j++) {
        const th = w.threads[j * 2], pp = p - j * 0.018
        for (let k = 0; k < N; k++) {
          const t0 = pp - LEN * (k + 1) / N, t1 = pp - LEN * k / N
          if (t1 <= 0) continue
          const q0 = along(th, t0), q1 = along(th, t1), f = 1 - k / N
          ctx.strokeStyle = hx(w.col, (dark ? 0.8 : 0.75) * f * f); ctx.lineWidth = 0.5 + 1.8 * f
          ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke()
        }
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]; rp.t += 0.026
      if (rp.t >= 1) { ripples.splice(i, 1); continue }
      ctx.strokeStyle = hx(rp.col, 0.45 * (1 - rp.t)); ctx.lineWidth = 1.4 * (1 - rp.t) + 0.4
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 4 + rp.t * 18, 0, 6.2832); ctx.stroke()
    }
    raf = requestAnimationFrame(tick)
  }
  measure()
  const onResize = () => measure()
  addEventListener('resize', onResize)
  // colours follow the surface: re-measure when the root's style changes
  const mo = new MutationObserver(() => measure())
  mo.observe(root, { attributes: true, attributeFilter: ['style', 'data-tone'] })
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick)
  else tick(0)
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); mo.disconnect() }
}

/* ---------- the view ---------- */
export function CoreView() {
  const navigate = useNavigateToPanel()
  const currentUser = useMissionControl(s => s.currentUser)
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [surface, setSurface] = useState<Surface>(DEFAULT_SURFACE)
  const [popOpen, setPopOpen] = useState(false)
  const [talk, setTalk] = useState<(typeof SNAPSHOT.workers)[number] | null>(null)
  const [dict, setDict] = useState(false)
  const [mail, setMail] = useState(false)
  const [full, setFull] = useState(false) // phones open on the heart alone; 'Show everything' reveals the rest
  const [ops, setOps] = useState<OpsFeed | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // The Watchman's latest pass from HQ, every 30 s. On failure the screen keeps the last good pass (or the dated snapshot).
    const pull = () => apiFetch<OpsFeed>('/api/core/ops', { cache: 'no-store' }).then(d => { if (d?.services) setOps(d) }).catch(() => {})
    pull()
    const t = setInterval(() => { pull(); setNow(Date.now()) }, 30_000)
    return () => clearInterval(t)
  }, [])
  const health = ops && opsSummary(ops, now)

  useEffect(() => {
    try { const saved = localStorage.getItem(SURFACE_KEY); if (saved) setSurface({ ...DEFAULT_SURFACE, ...JSON.parse(saved) }) } catch { /* storage blocked */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(SURFACE_KEY, JSON.stringify(surface)) } catch { /* storage blocked */ }
  }, [surface])
  useEffect(() => {
    if (!rootRef.current || !mainRef.current || !cvRef.current) return
    return startSilk(rootRef.current, mainRef.current, cvRef.current)
  }, [])
  useEffect(() => {
    // Phone turned sideways: lay the page out at 1280px and let the phone scale it, so it gets the real desktop bowtie.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return
    const original = meta.content
    const land = matchMedia('(orientation: landscape)')
    const apply = () => {
      const phone = Math.min(screen.width, screen.height) < 500 && matchMedia('(pointer: coarse)').matches
      meta.content = phone && land.matches ? 'width=1280, viewport-fit=cover' : original
    }
    apply()
    land.addEventListener('change', apply)
    return () => { land.removeEventListener('change', apply); meta.content = original }
  }, [])
  useEffect(() => {
    if (!popOpen) return
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest('.surface')) setPopOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [popOpen])

  const go = (target: string) => {
    if (target === 'dictionary') setDict(true)
    else if (target === 'mailboxes') setMail(true)
    else if (target.startsWith('http')) window.open(target, '_blank', 'noopener')
    else navigate(target)
  }
  const set = (patch: Partial<Surface>) => setSurface(s => ({ ...s, ...patch }))
  const initials = (currentUser?.display_name || currentUser?.username || 'CK').slice(0, 2).toUpperCase()

  return (
    <div
      ref={rootRef}
      className={`core-root${full ? ' full' : ''}`}
      data-tone={surface.l < 50 ? 'dark' : undefined}
      data-mat={surface.tex === 'glass' ? 'glass' : undefined}
      style={surfaceVars(surface) as CSSProperties}
    >
      {/* suited agents with armoured visor faces */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <g id="agent-gent">
            <path d="M8.2 3.6h7.6v4.2a3.8 3.8 0 0 1-7.6 0z" /><path d="M9.6 6.4h4.8" strokeWidth="2.1" />
            <path d="M12 12.6v1.6" /><path d="M3.8 21c.5-3.8 3.9-6 8.2-6s7.7 2.2 8.2 6" />
            <path d="M9.6 15.6 12 18.2l2.4-2.6" /><path d="M12 18.2v2.8" />
          </g>
          <g id="agent-lady">
            <path d="M8.2 3.6h7.6v4.2a3.8 3.8 0 0 1-7.6 0z" /><path d="M9.6 6.4h4.8" strokeWidth="2.1" />
            <path d="M7.6 5.4c-1.2 2.2-1.2 4.6-.3 6.6M16.4 5.4c1.2 2.2 1.2 4.6.3 6.6" />
            <path d="M12 12.6v1.6" /><path d="M3.8 21c.5-3.8 3.9-6 8.2-6s7.7 2.2 8.2 6" />
            <path d="M9.8 15.8 12 18l2.2-2.2" /><circle cx="12" cy="19.3" r=".9" fill="currentColor" stroke="none" />
          </g>
        </defs>
      </svg>

      <aside className="side">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8c-4 1-7 2-9 4M14 11c-1-2 0-4 2-6M12 12c-3 0-5 1-7 3M12 12c-1 2-1 4 0 6M8 13l-2 3" /></svg>
          Safari Core
        </div>
        <nav className="nav">
          {SNAPSHOT.nav.map(group => (
            <div key={group.title}>
              <h5>{group.title}</h5>
              {group.items.map(i => ({ ...i, badge: i.label === 'App Health' && health ? health.down.length : i.badge })).map(item => (
                <button key={item.label} type="button" className={`ni${item.target === 'overview' ? ' on' : ''}`} style={item.color ? v(item.color) : undefined} onClick={() => go(item.target)}>
                  {ICONS[item.icon]}<span>{item.label}</span>{item.badge !== undefined && <em>{item.badge}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="me">
          <span className="avme">{initials}</span>
          <span><b>Founder</b><small>the only gate</small></span>
          <span className="lock" title="Founder-only — workers never see this surface">
            <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          </span>
        </div>
      </aside>

      <div className="main" ref={mainRef}>
        <canvas className="flow" ref={cvRef} />

        <div className="top">
          <div className="kpis">
            {SNAPSHOT.kpis.map(k => (health && k.icon === 'beat' ? { ...k, value: String(health.total), label: 'services watched · live' } : k)).map(k => (
              <div key={k.label} className="kpi" style={v(k.color)}>
                <span className="chip">{ICONS[k.icon]}</span>
                <span><b>{k.value}</b><small>{k.label}</small></span>
              </div>
            ))}
          </div>
          <div className="surface">
            <button type="button" className="surf-btn" onClick={() => setPopOpen(o => !o)}><span className="dotc" />Surface</button>
            {popOpen && (
              <div className="surf-pop">
                <h6>Material</h6>
                <div className="texes">
                  {TEX_NAMES.map(t => (
                    <button key={t} type="button" className={surface.tex === t ? 'on' : ''} onClick={() => set({ tex: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
                <h6>Colour</h6>
                <input type="range" min={0} max={360} value={surface.h} aria-label="Surface hue" onChange={e => set({ h: +e.target.value })} />
                <div className="lab-row"><span>hue</span><span>{surface.h}°</span></div>
                <input type="range" min={0} max={45} value={surface.s} aria-label="Surface warmth" onChange={e => set({ s: +e.target.value })} />
                <div className="lab-row"><span>warmth</span><span>{surface.s}%</span></div>
                <input type="range" min={14} max={94} value={surface.l} aria-label="Surface tone" onChange={e => set({ l: +e.target.value })} />
                <div className="lab-row"><span>tone</span><span>{surface.l}</span></div>
                <h6>Texture depth</h6>
                <input type="range" min={0} max={100} value={Math.round(surface.depth * 100)} aria-label="Texture depth" onChange={e => set({ depth: +e.target.value / 100 })} />
                <h6>Presets</h6>
                <div className="swatches">
                  {PRESETS.map(p => (
                    <button key={p.name} type="button" title={p.name} aria-label={p.name} style={{ '--sw': `hsl(${p.h},${p.s}%,${p.l}%)` } as CSSProperties} onClick={() => set({ h: p.h, s: p.s, l: p.l })} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="stage">
          <aside className="rail left">
            <h4>On shift now <i /></h4>
            {SNAPSHOT.workers.map(w => (health && w.agent === 'watchman' ? { ...w, role: `${health.total} services · incident ladder`, status: health.stale ? 'quiet' : w.status } : w)).map(w => (
              <div key={w.name} className="wcard" style={v(w.color)} onClick={() => (w.agent ? setTalk(w) : go(w.target))}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static avatar from /public */}
                <span className="ic">{w.agent ? <img src={`/agents/${w.agent}-avatar.webp`} alt="" /> : ICONS[w.icon]}</span>
                <span className="tx"><b>{w.name}</b><small>{w.role}</small></span>
                <span className="st"><u className={w.live ? 'pulse' : undefined} />{w.status}</span>
              </div>
            ))}
          </aside>

          <div className="core">
            <span className="halo" />
            <svg className="machine" viewBox="0 0 430 430" aria-label="The schematic clockwork heart of Safari Tech Lab" dangerouslySetInnerHTML={{ __html: MACHINE }} />
            <div className="orbit">
              {SNAPSHOT.decks.map(d => (health && d.label === 'App Health' ? { ...d, badge: `${health.up}/${health.total}` } : d)).map((d, i) => (
                <div key={d.label} className="tile" style={{ '--a': `${d.angle}deg`, '--c': `var(${d.color})`, '--d': `${i * 0.5}s` } as CSSProperties} onClick={() => go(d.target)}>
                  {ICONS[d.icon]}<i>{d.badge}</i><b>{d.label}</b>
                </div>
              ))}
            </div>
          </div>

          <button type="button" className="more" aria-expanded={full} onClick={() => setFull(f => !f)}>
            {full ? 'Show the heart only' : 'Show everything'}
          </button>

          <div className="gate" onClick={() => go('tasks')}>
            <span className="avme" style={{ width: 30, height: 30, fontSize: 12 }}>{initials}</span>
            <span><b>You — the gate</b><br /><small>approve · reassign · redo</small></span>
          </div>

          <aside className="rail right">
            <h4><i /> Flowing out</h4>
            {SNAPSHOT.outputs.map(o => (
              <div key={o.name} className="wcard" style={v(o.color)} onClick={() => go(o.target)}>
                <span className="ic">{ICONS[o.icon]}</span>
                <span className="tx"><b>{o.name}</b><small>{o.role}</small></span>
                <span className="st"><u className={o.live ? 'pulse' : undefined} />{o.status}</span>
              </div>
            ))}
          </aside>
        </div>
      </div>

      {talk?.agent && (
        <TalkPanel agent={talk.agent} name={talk.name.replace(' · Claude', '')} role={talk.role} voice={(talk.voice as 'M' | 'F') || 'M'} color={talk.color} onClose={() => setTalk(null)} onDictionary={() => setDict(true)} />
      )}
      {dict && <DictionaryPanel onClose={() => setDict(false)} />}
      {mail && <MailboxesPanel onClose={() => setMail(false)} />}

      <div className="bot">
        {health
          ? <span className={health.down.length || health.stale ? 'ok down' : 'ok'}><u />{health.down.length ? `${health.down.length} down: ${health.down.join(', ')}` : health.stale ? 'Watchman is quiet' : `all ${health.up} services up`}</span>
          : <span className="ok"><u />{SNAPSHOT.bar.gates}</span>}
        <span>heartbeat <b>{health ? health.heartbeat : SNAPSHOT.bar.heartbeat}</b></span>
        <span>reply watch <b>{SNAPSHOT.bar.replyWatch}</b></span>
        <span>leaks found today <b>{SNAPSHOT.bar.leaks}</b></span>
        <span className="sp" />
        {health ? <span>live from HQ <b>{health.at}</b> EAT</span> : <span>snapshot <b>{SNAPSHOT.asOf}</b> · live feed next</span>}
        <span className="cost">PRs merged today <b style={{ color: 'inherit' }}>{SNAPSHOT.bar.prsMerged}</b></span>
      </div>
    </div>
  )
}
