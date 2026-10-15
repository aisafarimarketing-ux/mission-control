import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'

// Serves our own copy of the Kokoro voice model, voices and ONNX runtime (mounted read-only at MODELS_DIR),
// so the agents' voice never depends on huggingface.co or a CDN.
//   /models/hf/<org>/<repo>/resolve/main/<file>  ->  MODELS_DIR/<org>/<repo>/<file>
//   /models/ort/<file>                           ->  MODELS_DIR/ort/<file>
const TYPES: Record<string, string> = {
  '.json': 'application/json', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.mjs': 'text/javascript',
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const root = process.env.MODELS_DIR
  if (!root) return NextResponse.json({ error: 'Voice models are not installed on this server.' }, { status: 404 })
  const parts = (await params).path
  let rel: string[]
  if (parts[0] === 'hf') rel = parts.slice(1).filter((p, i, a) => !(p === 'resolve' && a[i + 1] === 'main') && !(p === 'main' && a[i - 1] === 'resolve'))
  else if (parts[0] === 'ort') rel = parts
  else return NextResponse.json({ error: 'not found' }, { status: 404 })

  const base = path.resolve(root)
  const file = path.resolve(base, ...rel)
  if (!file.startsWith(base + path.sep)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  let size: number
  try { const st = statSync(file); if (!st.isFile()) throw new Error('dir'); size = st.size } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': String(size),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
