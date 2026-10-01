// The leaderboard's server: a Cloudflare Worker over a D1 database. It trusts
// no score it is told. A run arrives as its seed and its moves, and the server
// plays it again with the game's own rules to find what it came to.

import { RULES, replayed } from '../hooks/sim'
import type { Lead } from '../hooks/sim'

type Env = {
  DB: D1Database
  ADMIN_TOKEN?: string
  WRITES: RateLimit
  READS: RateLimit
}
type Player = {
  id: string
  key_hash: string
  name: string
  name_key: string
  best: number
  best_at: number
  banned: number
}
type Body = Record<string, unknown>

const TOP = 10
const MAX_BODY = 100_000
const NAME = /^[\p{L}\p{N}_-]{2,16}$/u
const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const KEY = /^[0-9a-f-]{32,64}$/
// The writes one address may make in ten minutes.
const HITS = 30
const HITS_WINDOW = 600
const HITS_KEPT = 3600
// A person's jumps scatter; a script's land on the same pixel or the same
// tick. Over this many jumps, a spread this small is taken for a script.
const MECHANICAL_FROM = 40
const MECHANICAL_PIXELS = 2
const MECHANICAL_TICKS = 1

const answer = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

const refusal = (error: string, status: number): Response =>
  answer({ error }, status)

const now = (): number => Math.floor(Date.now() / 1000)

const digestOf = async (text: string): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )

  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const spreadOf = (values: readonly number[]): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length

  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  )
}

const isMechanical = (leads: readonly Lead[]): boolean =>
  leads.length >= MECHANICAL_FROM &&
  (spreadOf(leads.map(lead => lead.pixels)) < MECHANICAL_PIXELS ||
    spreadOf(leads.map(lead => lead.ticks)) < MECHANICAL_TICKS)

const bodyOf = async (request: Request): Promise<Body | undefined> => {
  const text = await request.text()

  if (text.length > MAX_BODY) {
    return undefined
  }

  try {
    const body: unknown = JSON.parse(text)

    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Body)
      : undefined
  } catch {
    return undefined
  }
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** Where a player stands: null until a run of theirs counts. */
const rankOf = async (env: Env, player: Player): Promise<number | null> => {
  if (player.best === 0 || player.banned !== 0) {
    return null
  }

  const ahead = await env.DB.prepare(
    `SELECT count(*) AS ahead FROM players
     WHERE banned = 0 AND (best > ?1 OR (best = ?1 AND best_at < ?2))`,
  )
    .bind(player.best, player.best_at)
    .first<number>('ahead')

  return (ahead ?? 0) + 1
}

const playerOf = (env: Env, id: string): Promise<Player | null> =>
  env.DB.prepare('SELECT * FROM players WHERE id = ?1').bind(id).first<Player>()

/** The player the body's id and key name, or the refusal it earns. */
const known = async (env: Env, body: Body): Promise<Player | Response> => {
  const player = await playerOf(env, textOf(body.id))

  if (player === null || player.key_hash !== (await digestOf(textOf(body.key)))) {
    return refusal('forbidden', 403)
  }

  return player.banned === 0 ? player : refusal('banned', 403)
}

const addressOf = (request: Request): string =>
  request.headers.get('CF-Connecting-IP') ?? ''

/**
 * Counts a write against its address in the database, over a longer stretch
 * than the edge counts, which lets a good share of a flood through: true
 * once the address wrote too much. A write refused here is not counted, so
 * a flood reads the database and never writes to it.
 */
const isFlooding = async (env: Env, request: Request): Promise<boolean> => {
  const address = addressOf(request)
  const ip = await digestOf(`${env.ADMIN_TOKEN ?? ''}:${address}`)
  const at = now()
  const [, recent] = await env.DB.batch<{ hits: number }>([
    env.DB.prepare('DELETE FROM hits WHERE at < ?1').bind(at - HITS_KEPT),
    env.DB.prepare(
      'SELECT count(*) AS hits FROM hits WHERE ip = ?1 AND at > ?2',
    ).bind(ip, at - HITS_WINDOW),
  ])

  if ((recent?.results[0]?.hits ?? 0) >= HITS) {
    return true
  }

  await env.DB.prepare('INSERT INTO hits (ip, at) VALUES (?1, ?2)')
    .bind(ip, at)
    .run()

  return false
}

/** `POST /players`: takes a name, or changes the one a player has. */
const named = async (env: Env, body: Body): Promise<Response> => {
  const id = textOf(body.id)
  const key = textOf(body.key)
  const name = textOf(body.name).normalize('NFC')

  if (!ID.test(id) || !KEY.test(key)) {
    return refusal('bad-request', 400)
  }

  if (!NAME.test(name)) {
    return refusal('bad-name', 400)
  }

  const nameKey = name.normalize('NFKC').toLowerCase()
  const holder = await env.DB.prepare(
    'SELECT id FROM players WHERE name_key = ?1',
  )
    .bind(nameKey)
    .first<string>('id')

  if (holder !== null && holder !== id) {
    return refusal('name-taken', 409)
  }

  const existing = await playerOf(env, id)

  if (existing === null) {
    await env.DB.prepare(
      `INSERT INTO players (id, key_hash, name, name_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, await digestOf(key), name, nameKey, now())
      .run()

    return answer({ name, best: 0, rank: null })
  }

  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  await env.DB.prepare(
    'UPDATE players SET name = ?1, name_key = ?2 WHERE id = ?3',
  )
    .bind(name, nameKey, id)
    .run()

  return answer({ name, best: player.best, rank: await rankOf(env, player) })
}

/** `POST /runs`: plays a run again and counts what it came to. */
const ran = async (env: Env, body: Body): Promise<Response> => {
  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  if (body.rules !== RULES) {
    // A plugin older or newer than this server steps a run its own way.
    return refusal('other-rules', 426)
  }

  const seed = typeof body.seed === 'number' ? body.seed : -1
  const log = textOf(body.log)
  const replay = replayed(seed, log)

  if (replay === undefined) {
    return refusal('bad-run', 422)
  }

  const digest = await digestOf(`${seed}:${log}`)
  const isKnown = await env.DB.prepare('SELECT 1 AS found FROM runs WHERE digest = ?1')
    .bind(digest)
    .first<number>('found')

  if (isKnown !== null) {
    return refusal('duplicate', 409)
  }

  const at = now()
  const isFlagged = isMechanical(replay.leads)
  await env.DB.prepare(
    `INSERT INTO runs (player_id, score, ticks, seed, log, digest, flagged, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(player.id, replay.score, replay.ticks, seed, log, digest, isFlagged ? 1 : 0, at)
    .run()

  const standing =
    !isFlagged && replay.score > player.best
      ? { ...player, best: replay.score, best_at: at }
      : player

  if (standing !== player) {
    await env.DB.prepare('UPDATE players SET best = ?1, best_at = ?2 WHERE id = ?3')
      .bind(standing.best, standing.best_at, player.id)
      .run()
  }

  return answer({
    score: replay.score,
    best: standing.best,
    rank: await rankOf(env, standing),
    // Kept off the board until the keeper has watched it.
    held: isFlagged,
  })
}

/** `POST /leave`: removes a player and their runs. */
const left = async (env: Env, body: Body): Promise<Response> => {
  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs WHERE player_id = ?1').bind(player.id),
    env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(player.id),
  ])

  return answer({ left: player.name })
}

/** `GET /top`: the board, and where the asking player stands on it. */
const top = async (env: Env, id: string): Promise<Response> => {
  const { results } = await env.DB.prepare(
    `SELECT name, best AS score FROM players
     WHERE banned = 0 AND best > 0
     ORDER BY best DESC, best_at LIMIT ?1`,
  )
    .bind(TOP)
    .all<{ name: string; score: number }>()
  const players = await env.DB.prepare(
    'SELECT count(*) AS players FROM players WHERE banned = 0 AND best > 0',
  ).first<number>('players')
  const player = ID.test(id) ? await playerOf(env, id) : null

  return answer({
    top: results,
    players: players ?? 0,
    you:
      player === null
        ? null
        : { name: player.name, best: player.best, rank: await rankOf(env, player) },
  })
}

/** The keeper's own routes, behind the ADMIN_TOKEN secret. */
const kept = async (env: Env, request: Request, path: string): Promise<Response> => {
  const given = request.headers.get('Authorization') ?? ''
  const isKeeper =
    env.ADMIN_TOKEN !== undefined &&
    env.ADMIN_TOKEN !== '' &&
    (await digestOf(given)) === (await digestOf(`Bearer ${env.ADMIN_TOKEN}`))

  if (!isKeeper) {
    return refusal('not-found', 404)
  }

  if (request.method === 'GET' && path === '/admin/flagged') {
    const { results } = await env.DB.prepare(
      `SELECT runs.id AS run, players.name, runs.score, runs.ticks, runs.created_at
       FROM runs JOIN players ON players.id = runs.player_id
       WHERE runs.flagged = 1 ORDER BY runs.score DESC LIMIT 100`,
    ).all()

    return answer({ flagged: results })
  }

  const body = request.method === 'POST' ? await bodyOf(request) : undefined

  if (body === undefined) {
    return refusal('bad-request', 400)
  }

  if (path === '/admin/clear') {
    // A flagged run the keeper has watched and found honest counts after all.
    const run = await env.DB.prepare(
      'UPDATE runs SET flagged = 0 WHERE id = ?1 RETURNING player_id, score, created_at',
    )
      .bind(Number(body.run))
      .first<{ player_id: string; score: number; created_at: number }>()

    if (run === null) {
      return refusal('not-found', 404)
    }

    await env.DB.prepare(
      'UPDATE players SET best = ?1, best_at = ?2 WHERE id = ?3 AND best < ?1',
    )
      .bind(run.score, run.created_at, run.player_id)
      .run()

    return answer({ cleared: Number(body.run) })
  }

  const nameKey = textOf(body.name).normalize('NFKC').toLowerCase()
  const id = await env.DB.prepare('SELECT id FROM players WHERE name_key = ?1')
    .bind(nameKey)
    .first<string>('id')

  if (id === null) {
    return refusal('not-found', 404)
  }

  if (path === '/admin/ban') {
    const banned = body.banned === false ? 0 : 1
    await env.DB.prepare('UPDATE players SET banned = ?1 WHERE id = ?2')
      .bind(banned, id)
      .run()

    return answer({ name: body.name, banned: banned === 1 })
  }

  if (path === '/admin/remove') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM runs WHERE player_id = ?1').bind(id),
      env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(id),
    ])

    return answer({ removed: body.name })
  }

  return refusal('not-found', 404)
}

const WRITES: Readonly<
  Record<string, (env: Env, body: Body) => Promise<Response>>
> = {
  '/players': named,
  '/runs': ran,
  '/leave': left,
}

const routed = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/admin/')) {
    return kept(env, request, url.pathname)
  }

  const key = addressOf(request)

  if (request.method === 'GET' && url.pathname === '/top') {
    return (await env.READS.limit({ key })).success
      ? top(env, url.searchParams.get('id') ?? '')
      : refusal('slow-down', 429)
  }

  const write = request.method === 'POST' ? WRITES[url.pathname] : undefined

  if (write === undefined) {
    return refusal('not-found', 404)
  }

  if (!(await env.WRITES.limit({ key })).success || (await isFlooding(env, request))) {
    return refusal('slow-down', 429)
  }

  const body = await bodyOf(request)

  return body === undefined ? refusal('bad-request', 400) : write(env, body)
}

export default {
  // Two writes racing for one name or one run end on the table's own
  // uniqueness: the loser hears that it failed, never a half-written row.
  fetch: (request: Request, env: Env): Promise<Response> =>
    routed(request, env).catch(() => refusal('failed', 500)),
}
