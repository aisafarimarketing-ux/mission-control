#!/usr/bin/env python3
"""Read-only IMAP fetch for Kamanda's mail folder (Python standard library only).

stdin: {"host","port","user","password","days","outdir","max"} as JSON.
Opens INBOX read-only (EXAMINE + BODY.PEEK) — never marks mail read, moves or deletes anything.
Writes one Markdown file per message into outdir, prints {"ok","count","newest","error"} as JSON.
"""
import datetime, email, email.policy, html, imaplib, json, os, re, sys


def text_of(msg):
    """Best plain-text body: text/plain if present, else stripped text/html."""
    plain, rich = None, None
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == 'multipart' or part.get_filename():
            continue
        try:
            body = part.get_content()
        except Exception:
            continue
        if part.get_content_type() == 'text/plain' and plain is None:
            plain = body
        elif part.get_content_type() == 'text/html' and rich is None:
            rich = body
    if plain:
        return plain
    if rich:
        rich = re.sub(r'(?is)<(script|style).*?</\1>', ' ', rich)
        rich = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</tr>', '\n', rich)
        return html.unescape(re.sub(r'<[^>]+>', ' ', rich))
    return ''


def safe(s):
    return re.sub(r'[^A-Za-z0-9._-]+', '-', s)[:60].strip('-') or 'msg'


def write_message(outdir, uid, raw):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    when = email.utils.parsedate_to_datetime(msg['Date']) if msg['Date'] else datetime.datetime.now(datetime.timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    body = re.sub(r'\n{3,}', '\n\n', text_of(msg)).strip()[:20000]
    name = f"{when.strftime('%Y-%m-%d_%H%M')}_{safe(str(uid))}.md"
    with open(os.path.join(outdir, name), 'w', encoding='utf-8') as f:
        f.write(f"From: {msg['From'] or ''}\nTo: {msg['To'] or ''}\nCc: {msg['Cc'] or ''}\nDate: {when.isoformat()}\n"
                f"Subject: {msg['Subject'] or ''}\n\n{body}\n")
    return when


def main():
    cfg = json.load(sys.stdin)
    outdir = cfg['outdir']
    os.makedirs(outdir, exist_ok=True)
    since = (datetime.date.today() - datetime.timedelta(days=int(cfg.get('days', 30)))).strftime('%d-%b-%Y')
    imap = imaplib.IMAP4_SSL(cfg['host'], int(cfg.get('port', 993)), timeout=60)
    try:
        imap.login(cfg['user'], cfg['password'])
        imap.select('INBOX', readonly=True)  # EXAMINE: read-only
        typ, data = imap.uid('search', None, 'SINCE', since)
        uids = data[0].split()[-int(cfg.get('max', 500)):]
        have = {f.split('_', 2)[-1][:-3] for f in os.listdir(outdir) if f.endswith('.md')}
        count, newest = 0, None
        for uid in uids:
            u = uid.decode()
            if safe(u) in have:
                continue
            typ, parts = imap.uid('fetch', uid, '(BODY.PEEK[])')  # PEEK: does not set \Seen
            raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
            if not raw:
                continue
            when = write_message(outdir, u, raw)
            newest = max(newest, when) if newest else when
            count += 1
        print(json.dumps({'ok': True, 'count': count, 'total': len(uids), 'newest': newest.isoformat() if newest else None}))
    finally:
        try:
            imap.logout()
        except Exception:
            pass


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        # self-check: parse a multipart sample without touching the network
        import tempfile
        sample = (b"From: Ana <ana@example.com>\r\nTo: hello@safaritechlab.com\r\nSubject: Group rates\r\n"
                  b"Date: Thu, 15 Oct 2026 09:00:00 +0300\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=b\r\n\r\n"
                  b"--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello<br>Do you do <b>group</b> rates?</p>\r\n--b--\r\n")
        d = tempfile.mkdtemp()
        write_message(d, '42', sample)
        out = open(os.path.join(d, os.listdir(d)[0]), encoding='utf-8').read()
        assert 'Subject: Group rates' in out and 'group' in out and '<b>' not in out, out
        print('selftest ok')
        sys.exit(0)
    try:
        main()
    except Exception as e:  # report, never crash the bridge
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}))
