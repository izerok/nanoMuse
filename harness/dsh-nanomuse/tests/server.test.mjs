// Fork-only: Settings → nanoMuse Cloud, the server picker. The address rules mirror the
// phone's "Use a different server" sheet (a scheme added when none was given, https
// required unless the host is on one's own network, no userinfo), the check is the
// relay's health route, and the choice is kept in server.json next to the account
// snapshot until the desktop app restarts into it. No relay, no network beyond a
// loopback server the test itself runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Service } from '@deepseek-ai/cordis'
import NanomuseCloud, { API_PREFIX, LLM_ROW, isPrivateHost, normalizeServerAddress, readServerOverride, serverProblem, writeServerOverride } from '../lib/cloud.js'

test('the server address normalizes like the phone sheet', () => {
  assert.equal(normalizeServerAddress('relay.example.org'), 'https://relay.example.org')
  assert.equal(normalizeServerAddress('  https://relay.example.org/  '), 'https://relay.example.org')
  assert.equal(normalizeServerAddress('http://192.168.1.2:8787/'), 'http://192.168.1.2:8787')
  assert.equal(normalizeServerAddress(''), null)
  assert.equal(normalizeServerAddress('not a url'), null)
  assert.equal(normalizeServerAddress('ftp://relay.example.org'), null)
})

test('the server problem follows the phone rule: https, or http on one own network', () => {
  assert.equal(serverProblem('https://relay.example.org'), null)
  assert.equal(serverProblem('http://192.168.1.2:8787'), null)
  assert.equal(serverProblem('http://10.0.0.5'), null)
  assert.equal(serverProblem('http://localhost:8787'), null)
  assert.equal(serverProblem('http://myrelay'), null)
  assert.equal(serverProblem('http://relay.example.org'), 'Use https unless the server is on your own network.')
  assert.equal(serverProblem('https://user:pass@relay.example.org'), 'The address must not carry a user name or password (user:pass@host); put the key in the key field instead')
})

test('a private host is parsed, not prefix-matched', () => {
  assert.equal(isPrivateHost('10.1.2.3'), true)
  assert.equal(isPrivateHost('172.16.0.1'), true)
  assert.equal(isPrivateHost('172.31.255.255'), true)
  assert.equal(isPrivateHost('172.32.0.1'), false)
  assert.equal(isPrivateHost('192.168.0.1'), true)
  assert.equal(isPrivateHost('127.0.0.1'), true)
  assert.equal(isPrivateHost('169.254.1.2'), true)
  assert.equal(isPrivateHost('100.64.0.1'), true)
  assert.equal(isPrivateHost('100.128.0.1'), false)
  assert.equal(isPrivateHost('8.8.8.8'), false)
  assert.equal(isPrivateHost('localhost'), true)
  assert.equal(isPrivateHost('myrelay'), true)
  assert.equal(isPrivateHost('relay.local'), true)
  assert.equal(isPrivateHost('relay.ts.net'), true)
  assert.equal(isPrivateHost('relay.example.org'), false)
  assert.equal(isPrivateHost('::1'), true)
  assert.equal(isPrivateHost('fd12::1'), true)
  assert.equal(isPrivateHost('fe80::1'), true)
  assert.equal(isPrivateHost('2001:db8::1'), false)
})

test('the kept server choice round-trips through server.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-server-'))
  try {
    assert.equal(await readServerOverride(dir), undefined)
    await writeServerOverride(dir, 'http://192.168.1.2:8787/')
    assert.equal(await readServerOverride(dir), 'http://192.168.1.2:8787')
    await writeServerOverride(dir, null)
    assert.equal(await readServerOverride(dir), undefined)
    await writeFile(join(dir, 'server.json'), 'not json')
    assert.equal(await readServerOverride(dir), undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

function fakeContext() {
  const credentials = new Map()
  const settings = { [LLM_ROW]: { providers: {} } }
  const ctx = {
    reflect: { provide() {} },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    credentials: {
      async set(ref, value) { credentials.set(String(ref), value) },
      async resolve(ref) { return credentials.has(String(ref)) ? { value: credentials.get(String(ref)) } : undefined },
      async unset(ref) { credentials.delete(String(ref)) },
    },
    settings: {
      async update(ns, patch) {
        const row = settings[ns] ?? (settings[ns] = {})
        for (const [k, v] of Object.entries(patch)) row[k] = k === 'providers' ? { ...row.providers, ...v } : v
      },
      async mutate(ns, ops) {
        for (const op of ops) if (op.op === 'unset' && op.path[0] === 'providers') delete settings[ns].providers[op.path[1]]
      },
      describe() { return Object.entries(settings).map(([ns, value]) => ({ ns, value })) },
    },
    get(name) {
      if (name === 'llm') return { listProviders: () => Object.keys(settings[LLM_ROW].providers).map((id) => ({ id })) }
      return undefined
    },
    inject() {},
    effect(fn) { fn() },
    on() { return () => undefined },
  }
  return { ctx, credentials, settings }
}

async function cloud({ baseURL = 'https://relay.invalid', override } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'nm-server-'))
  const statePath = join(home, 'cloud.json')
  await writeFile(statePath, JSON.stringify({ update: { checkedAt: Date.now() } }))
  if (override !== undefined) await writeFile(join(home, 'server.json'), JSON.stringify({ baseURL: override }))
  const fake = fakeContext()
  const svc = new NanomuseCloud(fake.ctx, { baseURL, deviceName: 'test-desktop', statePath })
  svc.hub.start = () => undefined
  await svc[Service.init]()
  const api = async (method, route, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.url = `${API_PREFIX}${route}`
    req.headers = {}
    const res = { status: 0, body: undefined, writeHead(status) { res.status = status; return res }, end(text) { res.body = text ? JSON.parse(text) : undefined; return res } }
    await svc.handle(req, res)
    return res
  }
  return { svc, api, home, ...fake, done: () => rm(home, { recursive: true, force: true }) }
}

async function healthServer(status = 200) {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: status === 200 }))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise((r) => server.close(r)) }
}

async function closedPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((r) => server.close(r))
  return port
}

test('the check passes a healthy relay and refuses the rest without touching the network', async () => {
  const relay = await healthServer(200)
  const dead = await healthServer(404)
  const out = await cloud()
  try {
    const ok = await out.api('POST', '/server/check', { address: `${relay.base}/` })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.baseURL, relay.base)
    assert.equal(ok.body.host, new URL(relay.base).host)
    const httpPublic = await out.api('POST', '/server/check', { address: 'http://relay.example.org' })
    assert.equal(httpPublic.status, 400)
    assert.equal(httpPublic.body.error.code, 'bad_url')
    const notRelay = await out.api('POST', '/server/check', { address: dead.base })
    assert.equal(notRelay.status, 404)
    assert.equal(notRelay.body.error.code, 'http_404')
    const closed = await out.api('POST', '/server/check', { address: `http://127.0.0.1:${await closedPort()}` })
    assert.equal(closed.status, 502)
    assert.equal(closed.body.error.code, 'unreachable')
  } finally { await out.done(); await relay.close(); await dead.close() }
})

test('setting a server keeps it and reports it as pending until restart', async () => {
  const relay = await healthServer(200)
  const out = await cloud()
  try {
    const set = await out.api('POST', '/server/set', { baseURL: relay.base })
    assert.equal(set.status, 200)
    assert.equal(set.body.baseURL, relay.base)
    assert.equal(set.body.custom, true)
    assert.equal(set.body.needsRestart, true)
    assert.equal(JSON.parse(await readFile(join(out.home, 'server.json'), 'utf8')).baseURL, relay.base)
    const status = await out.api('GET', '/status')
    assert.equal(status.body.baseURL, 'https://relay.invalid')
    assert.equal(status.body.pendingBaseURL, relay.base)
    assert.equal(status.body.serverOverride, true)
    const back = await out.api('POST', '/server/set', { baseURL: null })
    assert.equal(back.status, 200)
    assert.equal(back.body.custom, false)
    assert.equal(await readServerOverride(out.home), undefined)
  } finally { await out.done(); await relay.close() }
})

test('a kept server choice is the relay the next start talks to', async () => {
  const relay = await healthServer(200)
  const out = await cloud({ override: relay.base })
  try {
    assert.equal(out.svc.baseURL, relay.base)
    const status = await out.api('GET', '/status')
    assert.equal(status.body.baseURL, relay.base)
    assert.equal(status.body.pendingBaseURL, undefined)
    assert.equal(status.body.serverOverride, true)
  } finally { await out.done(); await relay.close() }
})
