// The run itself, with nothing of the pane in it: the game steps through it,
// and the leaderboard's server plays a run again from its seed and its moves.
// Both must reach the same score, so neither keeps rules of its own.

export type Sprite = readonly string[]
export type Obstacle = {
  x: number
  y: number
  kind: 'cactus' | 'bird' | 'crate'
  shape: number
}
export type Cloud = { x: number; y: number }
// The counts the props carry that a game has already acted on.
export type Seen = {
  jumps: number
  ducks: number
  pauses: number
  tops: number
  tools: number
  fails: number
  alerts: number
}
export type Game = Seen & {
  phase: 'ready' | 'run' | 'paused' | 'over'
  // Why the run is paused: the person's key, or Claude asking for them.
  note: 'key' | 'done' | 'ask'
  ticks: number
  y: number
  vy: number
  duck: number
  speed: number
  dist: number
  obstacles: Obstacle[]
  gap: number
  // Pixels run since the last obstacle came in.
  since: number
  // Obstacles Claude's tool calls queued: a crate a call, a bird a failure.
  crates: number
  birds: number
  // The tool behind the latest queued obstacle, and the ticks its name shows.
  label: string
  labelTicks: number
  // The round score the tally blinks, and the ticks it still blinks for.
  milestone: number
  flash: number
  clouds: Cloud[]
  seed: number
  hi: number
  // The best score before this run: a run that ends past it is a new best.
  was: number
  // Whether the global top is shown over the field, as it can be between runs.
  isTop: boolean
  // The seed the run started on and its moves since, each stamped with the
  // ticks since the one before: what plays the run again, tick for tick.
  start: number
  log: string
  // The tick of the last move in the log.
  noted: number
  // The field's width at the last step: obstacles come in at its right end.
  columns: number
}
// How far ahead the nearest obstacle was at a jump, in pixels and in ticks.
export type Lead = { pixels: number; ticks: number }
export type Replay = { score: number; ticks: number; leads: Lead[] }

// Which rules these are. A change to how a run steps makes an older log play
// out differently, so it takes a new number here and the server deployed anew.
export const RULES = 1
// Cells across are pixels across; every text row holds two pixel rows (▀ ▄ █),
// so a pixel is about square. Heights count pixels up from the ground.
export const TICK_MS = 40
const DT = TICK_MS / 1000
const GRAVITY = 354
export const JUMP = 110
const DROP = -220
const START_SPEED = 38
const MAX_SPEED = 90
const ACCELERATION = 1.2
export const DINO_X = 3
const DUCK_TICKS = 12
export const RESTART_TICKS = 12
export const MAX_COLUMNS = 160
export const MIN_COLUMNS = 30
const PIXELS_PER_POINT = 4
const BIRDS_FROM = 150
const TRIPLES_FROM = 55
// The closest two obstacles come, as a share of the pixels run in a second.
const MIN_GAP = 0.9
const MAX_QUEUED = 3
const MILESTONE = 100
const FLASH_TICKS = 24
// Half an hour of ticks, and the log that long a run could fill: a longer run
// is not played again.
const MAX_TICKS = 45_000
const MAX_LOG = 60_000
// One move of a log: the ticks since the last one, then a jump, a duck, the
// field's new width, or the crates and birds Claude's work queued.
const MOVE = /^(\d{1,5})(?:([jd])|c(\d{1,3})|f([0-3])\.([0-3]))$/
const UNSEEN: Seen = {
  jumps: 0,
  ducks: 0,
  pauses: 0,
  tops: 0,
  tools: 0,
  fails: 0,
  alerts: 0,
}

const BODY: Sprite = [
  '       ######',
  '      ## ####',
  '      #######',
  '      ####   ',
  '      ###### ',
  '#    ####    ',
  '##  ######   ',
  '######## #   ',
  ' #######     ',
  '  #####      ',
]
const STAND: Sprite = [...BODY, '   #  #      ', '   ## ##     ']
const RUN_A: Sprite = [...BODY, '   #  ##     ', '   ##        ']
const RUN_B: Sprite = [...BODY, '   ## #      ', '      ##     ']
const LOW: Sprite = [
  '#          ######',
  '##  ##### ## ####',
  '#################',
  ' ############    ',
  '  ######### #####',
]
const DUCK_A: Sprite = [...LOW, '   #  ##         ', '   ##            ']
const DUCK_B: Sprite = [...LOW, '   ## #          ', '      ##         ']

const SMALL: Sprite = [
  '  #  ',
  '# #  ',
  '# # #',
  '### #',
  '  ###',
  '  #  ',
  '  #  ',
]
const BIG: Sprite = [
  '  ##   ',
  '  ##   ',
  '# ##   ',
  '# ## # ',
  '# ## # ',
  '#### # ',
  '  #### ',
  '  ##   ',
  '  ##   ',
  '  ##   ',
]
const BIRD_UP: Sprite = [
  '    #      ',
  '  # ##     ',
  ' ## ###    ',
  '###########',
  '    ###### ',
  '           ',
]
const BIRD_DOWN: Sprite = [
  '           ',
  '  #        ',
  ' ##        ',
  '###########',
  '    ###### ',
  '    ##     ',
]
const CRATE: Sprite = ['#####', '#   #', '# # #', '#   #', '#####']
export const CLOUD: Sprite = ['    ####    ', '  ##    ### ', '############']

export const widthOf = (sprite: Sprite): number =>
  Math.max(...sprite.map(line => line.length))

const beside = (...sprites: Sprite[]): Sprite => {
  const height = Math.max(...sprites.map(sprite => sprite.length))

  return Array.from({ length: height }, (_, row) =>
    sprites
      .map(sprite =>
        (sprite[row - (height - sprite.length)] ?? '').padEnd(widthOf(sprite)),
      )
      .join(' '),
  )
}

// The last one is three cacti wide: only cleared once the run is fast enough.
const CACTI: readonly Sprite[] = [
  SMALL,
  BIG,
  beside(SMALL, SMALL),
  beside(BIG, SMALL),
  beside(SMALL, BIG, SMALL),
]
// Over a jump, under a jump or a duck, over a standing dino.
const BIRD_HEIGHTS = [1, 7, 13] as const
// The widest the dino and an obstacle get: further apart, they cannot touch.
const DINO_WIDTH = widthOf(LOW)
const WIDEST = Math.max(...[...CACTI, BIRD_UP, CRATE].map(widthOf))
const CLOUD_WIDTH = widthOf(CLOUD)

export const scoreOf = (game: Game): number =>
  Math.floor(game.dist / PIXELS_PER_POINT)

export const fresh = (hi: number, seed: number, seen: Seen): Game => ({
  phase: 'ready',
  note: 'key',
  ticks: 0,
  y: 0,
  vy: 0,
  duck: 0,
  speed: START_SPEED,
  dist: 0,
  obstacles: [],
  gap: 50,
  since: 0,
  crates: 0,
  birds: 0,
  label: '',
  labelTicks: 0,
  milestone: 0,
  flash: 0,
  clouds: [{ x: 34, y: 20 }],
  seed,
  hi,
  was: hi,
  isTop: false,
  start: seed,
  log: '',
  noted: 0,
  columns: 0,
  jumps: seen.jumps,
  ducks: seen.ducks,
  pauses: seen.pauses,
  tops: seen.tops,
  tools: seen.tools,
  fails: seen.fails,
  alerts: seen.alerts,
})

/** Advances the game's seed and answers a number in [0, 1). */
const roll = (game: Game): number => {
  game.seed = (Math.imul(game.seed, 1664525) + 1013904223) >>> 0

  return game.seed / 2 ** 32
}

/** The run with one more move in its log. */
const noted = (game: Game, move: string): Game => ({
  ...game,
  log: `${game.log}${game.log === '' ? '' : ' '}${game.ticks - game.noted}${move}`,
  noted: game.ticks,
})

export const dinoSprite = (game: Game): Sprite => {
  if (game.phase !== 'run' || game.y > 0) {
    return STAND
  }

  const isFirstStride = Math.floor(game.ticks / 3) % 2 === 0

  if (game.duck > 0) {
    return isFirstStride ? DUCK_A : DUCK_B
  }

  return isFirstStride ? RUN_A : RUN_B
}

export const obstacleSprite = (obstacle: Obstacle, ticks: number): Sprite => {
  if (obstacle.kind === 'cactus') {
    return CACTI[obstacle.shape] ?? SMALL
  }

  if (obstacle.kind === 'crate') {
    return CRATE
  }

  return Math.floor(ticks / 6) % 2 === 0 ? BIRD_UP : BIRD_DOWN
}

const isSolid = (sprite: Sprite, x: number, y: number): boolean =>
  sprite[sprite.length - 1 - y]?.[x] === '#'

const isHit = (game: Game): boolean => {
  const dino = dinoSprite(game)
  const dinoY = Math.round(game.y)

  return game.obstacles.some(obstacle => {
    const left = Math.round(obstacle.x) - DINO_X

    if (left >= DINO_WIDTH || left <= -WIDEST) {
      return false
    }

    const sprite = obstacleSprite(obstacle, game.ticks)
    const bottom = obstacle.y - dinoY
    // Only the pixels both sprites cover, counted from the dino's feet: the
    // server plays whole runs again, and most ticks have nothing this near.
    const top = Math.min(dino.length, bottom + sprite.length)
    const right = Math.min(DINO_WIDTH, left + WIDEST)

    for (let y = Math.max(0, bottom); y < top; y += 1) {
      for (let x = Math.max(0, left); x < right; x += 1) {
        if (isSolid(dino, x, y) && isSolid(sprite, x - left, y - bottom)) {
          return true
        }
      }
    }

    return false
  })
}

const spawn = (game: Game): void => {
  const x = Math.max(game.columns, MIN_COLUMNS)
  const isBird = scoreOf(game) >= BIRDS_FROM && roll(game) < 0.25

  if (game.birds > 0) {
    // A failed call's bird flies low: over a jump, or under a jump or a duck.
    const y = BIRD_HEIGHTS[Math.floor(roll(game) * 2)] ?? 1
    game.obstacles.push({ x, y, kind: 'bird', shape: 0 })
    game.birds -= 1
  } else if (game.crates > 0) {
    game.obstacles.push({ x, y: 0, kind: 'crate', shape: 0 })
    game.crates -= 1
  } else if (isBird) {
    const y = BIRD_HEIGHTS[Math.floor(roll(game) * BIRD_HEIGHTS.length)] ?? 1
    game.obstacles.push({ x, y, kind: 'bird', shape: 0 })
  } else {
    const shapes = game.speed >= TRIPLES_FROM ? CACTI.length : CACTI.length - 1
    game.obstacles.push({
      x,
      y: 0,
      kind: 'cactus',
      shape: Math.floor(roll(game) * shapes),
    })
  }

  game.since = 0
  game.gap = Math.round(game.speed * (MIN_GAP + roll(game) * 1.1))
}

export const step = (previous: Game, columns: number): Game => {
  if (previous.phase !== 'run') {
    return { ...previous, ticks: previous.ticks + 1 }
  }

  const sized =
    previous.columns === columns
      ? previous
      : noted({ ...previous, columns }, `c${columns}`)
  const game: Game = { ...sized, ticks: sized.ticks + 1 }
  const isAirborne = game.y > 0 || game.vy > 0

  if (isAirborne) {
    game.y += game.vy * DT - 0.5 * GRAVITY * DT * DT
    game.vy -= GRAVITY * DT

    if (game.y <= 0) {
      game.y = 0
      game.vy = 0
    }
  }

  const moved = game.speed * DT
  game.duck = Math.max(0, game.duck - 1)
  game.speed = Math.min(MAX_SPEED, game.speed + ACCELERATION * DT)
  game.dist += moved
  game.gap -= moved
  game.since += moved
  game.labelTicks = Math.max(0, game.labelTicks - 1)
  game.flash = Math.max(0, game.flash - 1)

  const score = scoreOf(game)
  const isRound =
    Math.floor(score / MILESTONE) > Math.floor(scoreOf(previous) / MILESTONE)

  if (isRound) {
    game.milestone = score - (score % MILESTONE)
    game.flash = FLASH_TICKS
  }

  game.obstacles = previous.obstacles
    .map(obstacle => ({ ...obstacle, x: obstacle.x - moved }))
    .filter(obstacle => obstacle.x > -24)
  game.clouds = previous.clouds
    .map(cloud => ({ ...cloud, x: cloud.x - moved / 5 }))
    .filter(cloud => cloud.x > -CLOUD_WIDTH)

  const isQueued =
    game.crates + game.birds > 0 && game.since >= game.speed * MIN_GAP

  if (game.gap <= 0 || isQueued) {
    spawn(game)
  }

  if (game.clouds.length < 3 && roll(game) < 0.008) {
    game.clouds.push({ x: columns, y: 16 + Math.floor(roll(game) * 8) })
  }

  if (isHit(game)) {
    game.phase = 'over'
    game.ticks = 0
    game.hi = Math.max(game.hi, scoreOf(game))
  }

  return game
}

export const paused = (game: Game, note: Game['note']): Game =>
  game.phase === 'run' ? { ...game, phase: 'paused', note } : game

export const toggled = (game: Game): Game =>
  game.phase === 'paused'
    ? { ...game, phase: 'run', isTop: false }
    : paused(game, 'key')

/** Shows the global top over a game that stands still, or takes it away. */
export const peeked = (game: Game): Game =>
  game.phase === 'run' ? game : { ...game, isTop: !game.isTop }

export const jumped = (game: Game): Game => {
  const isWaiting =
    game.phase === 'ready' ||
    (game.phase === 'over' && game.ticks >= RESTART_TICKS)

  if (isWaiting) {
    return { ...fresh(game.hi, game.seed, game), phase: 'run', vy: JUMP }
  }

  if (game.phase === 'paused') {
    return { ...game, phase: 'run', isTop: false }
  }

  if (game.phase === 'run' && game.y === 0) {
    return noted({ ...game, vy: JUMP, duck: 0 }, 'j')
  }

  return game
}

export const ducked = (game: Game): Game => {
  if (game.phase !== 'run') {
    return game
  }

  return noted(
    {
      ...game,
      duck: DUCK_TICKS,
      vy: game.y > 0 ? Math.min(game.vy, DROP) : game.vy,
    },
    'd',
  )
}

/** The run with the crates and birds Claude's new calls and failures queue. */
export const queued = (game: Game, calls: number, failures: number): Game => {
  const crates = Math.max(0, Math.min(MAX_QUEUED, calls))
  const birds = Math.max(0, Math.min(MAX_QUEUED, failures))

  return noted(
    {
      ...game,
      crates: Math.min(MAX_QUEUED, game.crates + crates),
      birds: Math.min(MAX_QUEUED, game.birds + birds),
    },
    `f${crates}.${birds}`,
  )
}

/** How far ahead of the dino the nearest obstacle is, if one is in the field. */
const leadOf = (game: Game): Lead | undefined => {
  const ahead = game.obstacles
    .map(obstacle => obstacle.x - DINO_X)
    .filter(pixels => pixels > 0)

  if (ahead.length === 0) {
    return undefined
  }

  const pixels = Math.min(...ahead)

  return { pixels, ticks: pixels / (game.speed * DT) }
}

/**
 * Plays a run again from the seed it started on and its log, and answers what
 * it came to: undefined unless the log is exactly the one that run would have
 * written, down to the tick it ended on an obstacle.
 */
export const replayed = (seed: number, log: string): Replay | undefined => {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) {
    return undefined
  }

  if (log.length > MAX_LOG) {
    return undefined
  }

  let game: Game = { ...fresh(0, seed, UNSEEN), phase: 'run', vy: JUMP }
  let columns = 0
  let ticks = 0
  const leads: Lead[] = []

  for (const move of log === '' ? [] : log.split(' ')) {
    const [, wait, key, width, calls, failures] = MOVE.exec(move) ?? []

    if (wait === undefined || ticks + Number(wait) > MAX_TICKS) {
      return undefined
    }

    for (let left = Number(wait); left > 0 && game.phase === 'run'; left -= 1) {
      game = step(game, columns)
      ticks += 1
    }

    if (game.phase !== 'run') {
      return undefined
    }

    if (key === 'j') {
      const lead = game.y === 0 ? leadOf(game) : undefined

      if (lead !== undefined) {
        leads.push(lead)
      }

      game = jumped(game)
    } else if (key === 'd') {
      game = ducked(game)
    } else if (width !== undefined) {
      columns = Number(width)

      if (columns > MAX_COLUMNS) {
        return undefined
      }
    } else {
      game = queued(game, Number(calls), Number(failures))
    }
  }

  while (game.phase === 'run' && ticks < MAX_TICKS) {
    game = step(game, columns)
    ticks += 1
  }

  if (game.phase !== 'over' || game.log !== log) {
    return undefined
  }

  return { score: scoreOf(game), ticks, leads }
}
