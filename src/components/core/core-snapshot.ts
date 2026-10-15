// Snapshot of HQ facts as approved in design v13 (2026-10-13). Shown with its date on screen;
// Hour 4 replaces this with the live HQ /api/ops feed. Never edit these numbers by hand to look current.
// Targets: a panel id opens inside Core; an https URL opens HQ in a new tab.

const HQ = 'https://hq.safaritechlab.com'

export const SNAPSHOT = {
  asOf: '13 Oct',
  nav: [
    { title: 'Command', items: [
      { label: 'The Core', icon: 'core', target: 'overview', color: '--a-work' },
      { label: 'Workforce', icon: 'gent', target: 'agents', color: '--a-work', badge: 6 },
      { label: 'Ledger', icon: 'ledger', target: 'tasks' },
    ] },
    { title: 'Divisions', items: [
      { label: 'Security', icon: 'shield', target: 'security', color: '--a-sec', badge: 0 },
      { label: 'App Health', icon: 'pulse', target: 'monitor', color: '--a-health', badge: 9 },
      { label: 'Growth', icon: 'grow', target: `${HQ}/briefing`, color: '--a-grow' },
      { label: 'Radar', icon: 'radar', target: `${HQ}/radar`, color: '--a-radar', badge: 24 },
      { label: 'Builder', icon: 'build', target: 'github', color: '--a-build', badge: 2 },
    ] },
    { title: 'System', items: [
      { label: 'Settings', icon: 'gear', target: 'settings' },
    ] },
  ] as { title: string; items: { label: string; icon: string; target: string; color?: string; badge?: number }[] }[],
  kpis: [
    { value: '5', label: 'workers on shift', icon: 'core', color: '--a-work' },
    { value: '6', label: 'services watched · 30 s', icon: 'beat', color: '--a-sec' },
    { value: '25', label: 'radar routes live', icon: 'radar', color: '--a-radar' },
    { value: '4,890', label: 'contacts on the desk', icon: 'ledger', color: '--a-grow' },
  ],
  workers: [
    { name: 'Radar Scout', agent: 'radar-scout', voice: 'M', role: 'finder · writer · seller', status: '25 rt', icon: 'gent', color: '--a-radar', live: true, target: `${HQ}/radar` },
    { name: 'Reply Watch', agent: 'reply-watch', voice: 'F', role: 'replies → cards · 07–20 EAT', status: '1 m', icon: 'lady', color: '--a-grow', live: true, target: `${HQ}/contacts` },
    { name: 'Mail Sync', agent: 'mail-sync', voice: 'M', role: 'jmap inbox · continuous', status: '2 m', icon: 'gent', color: '--a-health', live: true, target: `${HQ}/mail` },
    { name: 'Watchman', agent: 'watchman', voice: 'F', role: '6 services · incident ladder', status: '30 s', icon: 'lady', color: '--a-sec', live: true, target: `${HQ}/control` },
    { name: 'Kamanda · Claude', agent: 'kamanda', voice: 'M', role: 'chief of staff · one queue', status: 'on', icon: 'gent', color: '--a-work', live: true, target: 'agents' },
    { name: 'Humans', role: 'clean task in · clean done', status: 'team', icon: 'humans', color: '--a-build', live: false, target: 'users' },
  ],
  outputs: [
    { name: 'Replies sorted', role: 'onto contact cards', status: 'live', icon: 'send', color: '--a-grow', live: true, target: `${HQ}/contacts` },
    { name: 'Incidents caught', role: 'ladder pages you first', status: 'armed', icon: 'shieldOk', color: '--a-sec', live: false, target: `${HQ}/control` },
    { name: 'Drafts for your post', role: 'writer · nothing auto-sends', status: 'queue', icon: 'ledger', color: '--a-radar', live: true, target: `${HQ}/radar` },
    { name: 'Handovers to Studio', role: 'seller → demo booked', status: 'ready', icon: 'check', color: '--a-work', live: false, target: `${HQ}/contacts` },
    { name: 'Morning report', role: 'one page · 07:00', status: '07:00', icon: 'report', color: '--a-health', live: true, target: 'standup' },
  ],
  decks: [
    { label: 'Security', icon: 'shield', angle: -90, color: '--a-sec', badge: '0', target: 'security' },
    { label: 'App Health', icon: 'pulse', angle: -45, color: '--a-health', badge: '6', target: 'monitor' },
    { label: 'Workforce', icon: 'gent', angle: -135, color: '--a-work', badge: '5', target: 'agents' },
    { label: 'Growth', icon: 'grow', angle: 0, color: '--a-grow', badge: '4.9k', target: `${HQ}/briefing` },
    { label: 'Radar', icon: 'radar', angle: 135, color: '--a-radar', badge: '25', target: `${HQ}/radar` },
    { label: 'Builder', icon: 'build', angle: 180, color: '--a-build', badge: '3', target: 'github' },
  ],
  bar: { gates: 'all gates green', heartbeat: '30 s', replyWatch: '07–20 EAT', leaks: '0', prsMerged: '3' },
}
