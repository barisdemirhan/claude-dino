// The global top as the plugin sees it: who the person is there, what to ask
// the leaderboard's server, and how to read what it says. Nothing here reaches
// the network or the store; the hooks module does, with what this hands it.

import { RULES } from './sim'

// The person on the global top: the name they took, and the id and the secret
// that make a run theirs. Nobody until they take a name; isOff once they have
// said not to be asked for one.
export type Player = {
  id: string
  key: string
  name: string
  best: number
  // Where they stand on it, as the server last said: 0 until a run counts.
  rank: number
  isOff: boolean
}
/** One line of the board. */
export type Row = { name: string; score: number }
/** A finished run: what it scored here, and what plays it again elsewhere. */
export type Run = { seed: number; log: string; score: number }
/** What the leaderboard said: whether it did as asked, and a line on it. */
export type Told = { isDone: boolean; text: string }

const BOARD = 'https://claude-dino-board.barisdemirhan.workers.dev'
export const NOBODY: Player = {
  id: '',
  key: '',
  name: '',
  best: 0,
  rank: 0,
  isOff: false,
}
// What the server refuses with, as the person reads it.
const REFUSALS: Readonly<Record<string, string>> = {
  'bad-name': 'A name takes 2 to 16 letters, digits, - or _.',
  'name-taken': 'That name is taken. Try another.',
  'slow-down': 'The leaderboard is busy. Try again in a few minutes.',
  'bad-run': 'The leaderboard could not play that run again, so it does not count.',
  'other-rules':
    'The leaderboard plays by another version. Update the dino plugin to send runs.',
  duplicate: 'The leaderboard already has that run.',
  banned: 'This name was taken off the leaderboard.',
  forbidden:
    'The leaderboard does not know this player any more. /dino leave, then join again.',
}
const SILENT = 'The leaderboard did not answer. Your scores stay on this machine.'

const digits = (score: number): string => String(score).padStart(5, '0')

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

export const toPlayer = (value: unknown): Player => ({
  id: textOf(fieldOf(value, 'id')),
  key: textOf(fieldOf(value, 'key')),
  name: textOf(fieldOf(value, 'name')),
  best: countOf(fieldOf(value, 'best')),
  rank: countOf(fieldOf(value, 'rank')),
  isOff: fieldOf(value, 'isOff') === true,
})

/** The player with the id and the secret their runs go under, made once. */
export const enrolled = (player: Player): Player =>
  player.id === ''
    ? { ...player, id: crypto.randomUUID(), key: crypto.randomUUID() }
    : player

/** Where on the server a path is. */
export const urlOf = (path: string): string => `${BOARD}${path}`

/** A write to the server, as `$.http.fetch` takes it. */
export const posted = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const runBody = (player: Player, run: Run): Record<string, unknown> => ({
  id: player.id,
  key: player.key,
  rules: RULES,
  seed: run.seed,
  log: run.log,
})

/** The board's path, with the id that asks where this person stands on it. */
export const topPath = (player: Player): string =>
  player.id === '' ? '/top' : `/top?id=${encodeURIComponent(player.id)}`

export const refusalOf = (said: unknown): string =>
  REFUSALS[textOf(fieldOf(said, 'error'))] ?? SILENT

const standing = (rank: number, best: number): string =>
  `#${rank} on the global top with ${digits(best)}`

/** The player as the server took them under a name. */
export const named = (player: Player, said: unknown): Player => ({
  ...player,
  name: textOf(fieldOf(said, 'name')),
  best: countOf(fieldOf(said, 'best')),
  rank: countOf(fieldOf(said, 'rank')),
  isOff: false,
})

/** The player once the server has counted `run`: nothing lower goes up again. */
export const ranked = (player: Player, run: Run, said: unknown): Player => ({
  ...player,
  best: Math.max(run.score, countOf(fieldOf(said, 'best'))),
  // A run held back to be looked over comes with no rank: the last one stands.
  rank: countOf(fieldOf(said, 'rank')) || player.rank,
})

/** The board's rows as the server sent them, or undefined when it sent none. */
export const rowsOf = (said: unknown): Row[] | undefined => {
  const top = fieldOf(said, 'top')

  return Array.isArray(top)
    ? top.map((row: unknown) => ({
        name: textOf(fieldOf(row, 'name')),
        score: countOf(fieldOf(row, 'score')),
      }))
    : undefined
}

/** How many players the board holds in all. */
export const playersOf = (said: unknown): number =>
  countOf(fieldOf(said, 'players'))

/** The player with where the board says they stand now. */
export const placed = (player: Player, said: unknown): Player => {
  const you = fieldOf(said, 'you')

  return you === null || you === undefined
    ? player
    : {
        ...player,
        best: countOf(fieldOf(you, 'best')),
        rank: countOf(fieldOf(you, 'rank')),
      }
}

export const sentText = (said: unknown): string => {
  const rank = countOf(fieldOf(said, 'rank'))

  if (fieldOf(said, 'held') === true) {
    return 'Run sent. It shows on the global top once it has been looked over.'
  }

  return rank > 0
    ? `You are ${standing(rank, countOf(fieldOf(said, 'best')))}.`
    : 'Run sent.'
}

/** Whether this person is on the leaderboard, in a line. */
export const nameText = ({ name, best }: Player): string => {
  if (name === '') {
    return 'You are not on the global top. /dino name <name> joins it.'
  }

  return best > 0
    ? `You are on the global top as ${name}, with ${digits(best)}.`
    : `You are on the global top as ${name}. Your next best run goes up.`
}

/** The board's first ten, and where this person stands. */
export const topText = (status: number, said: unknown): string => {
  const top = rowsOf(said)

  if (status !== 200 || top === undefined) {
    return SILENT
  }

  if (top.length === 0) {
    return 'Nobody is on the global top yet. Finish a run and enter a name to be the first.'
  }

  const players = playersOf(said)
  const rows = top.map(
    ({ name, score }, at) =>
      `${String(at + 1).padStart(2)} · ${digits(score)} · ${name}`,
  )
  const you = fieldOf(said, 'you')
  const rank = countOf(fieldOf(you, 'rank'))
  const yours =
    rank > 0 ? [`You are ${standing(rank, countOf(fieldOf(you, 'best')))}.`] : []

  return [
    `Dino global top · ${players} ${players === 1 ? 'player' : 'players'}`,
    ...rows,
    ...yours,
  ].join('\n')
}
