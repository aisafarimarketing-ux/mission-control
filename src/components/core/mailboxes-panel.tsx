'use client'

// Mailboxes Kamanda may read. The founder adds each one with an app password or API key, switches it on or off,
// and sets how far back to keep. Keys go to the VM and never come back to any screen. Read-only, always.
import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'

type Box = { id: string; label: string; kind: 'imap' | 'jmap'; host?: string; port?: number; user?: string; url?: string; days?: number; enabled: boolean; hasSecret: boolean; help?: string; lastSync?: string; lastError?: string | null; lastNew?: number }

const PRESETS: Record<string, { host: string; note: string }> = {
  gmail: { host: 'imap.gmail.com', note: 'Gmail or Google Workspace: turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords.' },
  outlook: { host: 'outlook.office365.com', note: 'Outlook / Microsoft 365: create an app password in your Microsoft security settings (if your organisation allows it).' },
  zoho: { host: 'imap.zoho.com', note: 'Zoho Mail: enable IMAP in Zoho settings, then create an app-specific password.' },
  other: { host: '', note: 'Any other provider: ask for the IMAP server name and an app password.' },
}

export function MailboxesPanel({ onClose }: { onClose: () => void }) {
  const [boxes, setBoxes] = useState<Box[]>([])
  const [note, setNote] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [secret, setSecret] = useState('')
  const [form, setForm] = useState({ address: '', provider: 'gmail', host: PRESETS.gmail.host })

  useEffect(() => { apiFetch<{ boxes: Box[] }>('/api/core/mailboxes').then(j => setBoxes(j.boxes)).catch(() => setNote('Mailboxes could not load. Check the agents are reachable.')) }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])

  async function post(body: object, ok: string) {
    try {
      const j = await apiFetch<{ boxes: Box[] }>('/api/core/mailboxes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      setBoxes(j.boxes); setNote(ok); setSecret('')
    } catch (e) { setNote(e instanceof ApiError ? e.message : 'That did not save. Try again.') }
  }
  async function syncNow(id: string) {
    setNote('Checking that mailbox now…')
    try { const j = await apiFetch<{ boxes: Box[] }>('/api/core/mailboxes/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); setBoxes(j.boxes); setNote('Checked.') }
    catch { setNote('That check did not finish. Try again in a minute.') }
  }

  const connected = boxes.filter(b => b.enabled && b.hasSecret && !b.lastError).length
  return (
    <div className="core-talk core-dict" role="dialog" aria-modal="true" aria-label="Mailboxes Kamanda may read">
      <div className="dict-main">
        <header>
          <div><b>Mailboxes</b><small>{connected} of {boxes.length} connected · Kamanda reads, never sends</small></div>
          <div className="talk-tools"><button type="button" className="talk-x" onClick={onClose}>Close</button></div>
        </header>
        <p className="dict-hint">Each mailbox needs an app password (or for Mailflare an API key). It is stored on the VM and never shown again. Switch a mailbox off and its copies are removed from Kamanda straight away.</p>
        {note && <p className="talk-note">{note}</p>}

        <div className="dict-list">
          {boxes.map(b => (
            <div key={b.id} className="mbox">
              <div className="dict-row">
                <div className="dict-w"><b style={{ textTransform: 'none' }}>{b.label}</b>
                  <small>{b.kind === 'jmap' ? 'Mailflare (JMAP)' : `IMAP · ${b.host || 'server not set'}`} · last {b.days || 30} days · {b.lastError ? `problem: ${b.lastError}` : b.lastSync ? `checked ${new Date(b.lastSync).toLocaleTimeString()}${b.lastNew ? ` · ${b.lastNew} new` : ''}` : b.hasSecret ? 'waiting for first check' : 'needs its key'}</small></div>
                <label className="mbox-switch"><input type="checkbox" id={`on-${b.id}`} checked={b.enabled} disabled={!b.hasSecret} onChange={e => post({ id: b.id, enabled: e.target.checked }, e.target.checked ? `${b.label} is on. First copies arrive within a few minutes.` : `${b.label} is off. Kamanda can no longer see it.`)} /> <span>{b.enabled ? 'On' : 'Off'}</span></label>
                <button type="button" onClick={() => { setOpen(open === b.id ? null : b.id); setSecret('') }}>{b.hasSecret ? 'Settings' : 'Add key'}</button>
                {b.enabled && b.hasSecret && <button type="button" className="ghost" onClick={() => syncNow(b.id)}>Check now</button>}
              </div>
              {open === b.id && (
                <form className="dict-add" onSubmit={e => { e.preventDefault(); post({ id: b.id, secret, enabled: true, host: b.host, days: b.days }, `Saved. ${b.label} is on; Kamanda can read it within a few minutes.`); setOpen(null) }}>
                  {b.help && <p className="dict-hint">{b.help}</p>}
                  <div className="row">
                    {b.kind === 'imap' && <label><span>IMAP server</span><input id={`host-${b.id}`} defaultValue={b.host} onBlur={e => post({ id: b.id, host: e.target.value }, 'Server saved.')} placeholder="e.g. imap.gmail.com" /></label>}
                    <label><span>{b.kind === 'jmap' ? 'API key' : 'App password'}</span><input id={`key-${b.id}`} type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} placeholder={b.hasSecret ? 'Saved — type a new one to replace it' : 'Paste it here'} /></label>
                    <label style={{ flex: '0 1 140px' }}><span>Keep days</span><input id={`days-${b.id}`} type="number" min={1} max={365} defaultValue={b.days || 30} onBlur={e => post({ id: b.id, days: Number(e.target.value) }, 'Saved.')} /></label>
                  </div>
                  <div className="row actions">
                    <button type="submit" disabled={!secret.trim()}>Save and switch on</button>
                    <button type="button" className="ghost" onClick={() => post({ id: b.id, remove: true }, `${b.label} removed, with its key and copies.`)}>Remove mailbox</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>

        <form className="dict-add" onSubmit={e => { e.preventDefault(); if (!form.address.includes('@')) { setNote('Type the full email address.'); return } post({ kind: 'imap', label: form.address.trim(), user: form.address.trim(), host: form.host.trim() }, `${form.address.trim()} added. Open it to paste its app password.`); setForm({ address: '', provider: 'gmail', host: PRESETS.gmail.host }) }}>
          <div className="row">
            <label><span>Add another mailbox</span><input id="mbox-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="name@company.com" /></label>
            <label style={{ flex: '0 1 200px' }}><span>Provider</span>
              <select id="mbox-provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, host: PRESETS[e.target.value].host })}>
                <option value="gmail">Gmail / Google</option><option value="outlook">Outlook / 365</option><option value="zoho">Zoho</option><option value="other">Other</option>
              </select>
            </label>
            <label><span>IMAP server</span><input id="mbox-host" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="imap.example.com" /></label>
          </div>
          <p className="dict-hint">{PRESETS[form.provider].note} Only add mailboxes you own or have permission to read.</p>
          <div className="row actions"><button type="submit">Add mailbox</button></div>
        </form>
      </div>
    </div>
  )
}
