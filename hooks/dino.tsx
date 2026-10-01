import type { ClientModule, ClientSurface } from 'claude-code'

type Props = {
  hi: number
  jumps: number
  ducks: number
  pauses: number
  tools: number
  fails: number
  tool: string
  alerts: number
  alert: 'done' | 'ask'
}
type Sprite = readonly string[]
type Obstacle = {
  x: number
  y: number
  kind: 'cactus' | 'bird' | 'crate'
  shape: number
}
type Cloud = { x: number; y: number }
// The counts the props carry that a game has already acted on.
type Seen = Pick<
  Props,
  'jumps' | 'ducks' | 'pauses' | 'tools' | 'fails' | 'alerts'
>
type Game = Seen & {
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
}

// Cells across are pixels across; every text row holds two pixel rows (▀ ▄ █),
// so a pixel is about square. Heights count pixels up from the ground.
const TICK_MS = 40
const DT = TICK_MS / 1000
const GRAVITY = 354
const JUMP = 110
const DROP = -220
const START_SPEED = 38
const MAX_SPEED = 90
const ACCELERATION = 1.2
const DINO_X = 3
const GROUND = 2
const DUCK_TICKS = 12
const RESTART_TICKS = 12
const MAX_COLUMNS = 160
const MIN_COLUMNS = 30
const MIN_ROWS = 8
const PIXELS_PER_POINT = 4
const NIGHT_EVERY = 700
const NIGHT_LASTS = 250
const BIRDS_FROM = 150
const TRIPLES_FROM = 55
// The closest two obstacles come, as a share of the pixels run in a second.
const MIN_GAP = 0.9
const MAX_QUEUED = 3
const LABEL_TICKS = 40
const MILESTONE = 100
const FLASH_TICKS = 24
const JUMP_KEYS = [' ', 'space', 'up', 'return', 'w', 'k']
const DUCK_KEYS = ['down', 's', 'j']
const PAUSE_KEYS = ['p']

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
const CLOUD: Sprite = ['    ####    ', '  ##    ### ', '############']

const widthOf = (sprite: Sprite): number =>
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
const PAUSE_NOTES = {
  key: ' space or p to run on ',
  done: ' Claude is done · space to run on ',
  ask: ' Claude needs you · space to run on ',
} as const

const scoreOf = (game: Game): number => Math.floor(game.dist / PIXELS_PER_POINT)

const fresh = (hi: number, seed: number, seen: Seen): Game => ({
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
  jumps: seen.jumps,
  ducks: seen.ducks,
  pauses: seen.pauses,
  tools: seen.tools,
  fails: seen.fails,
  alerts: seen.alerts,
})

/** Advances the game's seed and answers a number in [0, 1). */
const roll = (game: Game): number => {
  game.seed = (Math.imul(game.seed, 1664525) + 1013904223) >>> 0

  return game.seed / 2 ** 32
}

const dinoSprite = (game: Game): Sprite => {
  if (game.phase !== 'run' || game.y > 0) {
    return STAND
  }

  const isFirstStride = Math.floor(game.ticks / 3) % 2 === 0

  if (game.duck > 0) {
    return isFirstStride ? DUCK_A : DUCK_B
  }

  return isFirstStride ? RUN_A : RUN_B
}

const obstacleSprite = (obstacle: Obstacle, ticks: number): Sprite => {
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
    const sprite = obstacleSprite(obstacle, game.ticks)
    const left = Math.round(obstacle.x) - DINO_X
    const bottom = obstacle.y - dinoY

    return dino.some((line, row) =>
      [...line].some(
        (pixel, column) =>
          pixel === '#' &&
          isSolid(sprite, column - left, dino.length - 1 - row - bottom),
      ),
    )
  })
}

const spawn = (game: Game, columns: number): void => {
  const x = Math.max(columns, MIN_COLUMNS)
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

const step = (previous: Game, columns: number): Game => {
  const game: Game = { ...previous, ticks: previous.ticks + 1 }

  if (game.phase !== 'run') {
    return game
  }

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
    .filter(cloud => cloud.x > -widthOf(CLOUD))

  const isQueued =
    game.crates + game.birds > 0 && game.since >= game.speed * MIN_GAP

  if (game.gap <= 0 || isQueued) {
    spawn(game, columns)
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

const paused = (game: Game, note: Game['note']): Game =>
  game.phase === 'run' ? { ...game, phase: 'paused', note } : game

const toggled = (game: Game): Game =>
  game.phase === 'paused' ? { ...game, phase: 'run' } : paused(game, 'key')

const jumped = (game: Game): Game => {
  const isWaiting =
    game.phase === 'ready' ||
    (game.phase === 'over' && game.ticks >= RESTART_TICKS)

  if (isWaiting) {
    return { ...fresh(game.hi, game.seed, game), phase: 'run', vy: JUMP }
  }

  if (game.phase === 'paused') {
    return { ...game, phase: 'run' }
  }

  if (game.phase === 'run' && game.y === 0) {
    return { ...game, vy: JUMP, duck: 0 }
  }

  return game
}

const ducked = (game: Game): Game => {
  if (game.phase !== 'run') {
    return game
  }

  return {
    ...game,
    duck: DUCK_TICKS,
    vy: game.y > 0 ? Math.min(game.vy, DROP) : game.vy,
  }
}

/** The run with the obstacles Claude's new tool calls and failures queue. */
const fed = (game: Game, props: Props): Game => {
  const seen = { ...game, tools: props.tools, fails: props.fails }

  if (game.phase !== 'run') {
    return seen
  }

  return {
    ...seen,
    crates: Math.min(MAX_QUEUED, game.crates + props.tools - game.tools),
    birds: Math.min(MAX_QUEUED, game.birds + props.fails - game.fails),
    label: props.tool,
    labelTicks: LABEL_TICKS,
  }
}

/** The game after every count the props carry beyond the ones seen. */
const caughtUp = (game: Game, props: Props): Game => {
  const moves: readonly [boolean, (now: Game) => Game][] = [
    [
      props.alerts !== game.alerts,
      now => paused({ ...now, alerts: props.alerts }, props.alert),
    ],
    [
      props.tools !== game.tools || props.fails !== game.fails,
      now => fed(now, props),
    ],
    [
      props.pauses !== game.pauses,
      now => toggled({ ...now, pauses: props.pauses }),
    ],
    [
      props.jumps !== game.jumps,
      now => jumped({ ...now, jumps: props.jumps }),
    ],
    [
      props.ducks !== game.ducks,
      now => ducked({ ...now, ducks: props.ducks }),
    ],
  ]

  return moves.reduce((now, [isDue, move]) => (isDue ? move(now) : now), game)
}

/** What the hooks module hears of a change, to keep scores and play sounds. */
const eventOf = (before: Game, after: Game): string | undefined => {
  if (before.phase !== after.phase) {
    if (after.phase === 'run') {
      return before.phase === 'paused' ? 'resume' : 'start'
    }

    return after.phase === 'ready' ? undefined : after.phase
  }

  if (after.phase !== 'run') {
    return undefined
  }

  if (after.flash > before.flash) {
    return 'point'
  }

  return after.vy === JUMP && before.vy !== JUMP ? 'jump' : undefined
}

const settle = (
  surface: ClientSurface<Game>,
  before: Game,
  after: Game,
): void => {
  const event = eventOf(before, after)
  surface.setState(after)

  if (event !== undefined) {
    surface.post({ event, score: scoreOf(after) })
  }
}

const act = (surface: ClientSurface<Game>, move: (game: Game) => Game): void => {
  const game = surface.state
  const next = game === undefined ? undefined : move(game)

  if (game !== undefined && next !== undefined && next !== game) {
    settle(surface, game, next)
  }
}

const tick = (surface: ClientSurface<Game>): void => {
  const game = surface.state
  const isMoving =
    game?.phase === 'run' ||
    (game?.phase === 'over' && game.ticks < RESTART_TICKS)

  if (game === undefined || !isMoving) {
    return
  }

  settle(surface, game, step(game, Math.min(surface.columns, MAX_COLUMNS)))
}

const start = (surface: ClientSurface<Game>, props: Props): Game => {
  const game = fresh(props.hi, Math.floor(Math.random() * 2 ** 32), props)
  surface.setState(game)
  surface.every(TICK_MS, () => tick(surface))
  surface.onKey(event => {
    if (JUMP_KEYS.includes(event.key)) {
      act(surface, jumped)
    } else if (DUCK_KEYS.includes(event.key)) {
      act(surface, ducked)
    } else if (PAUSE_KEYS.includes(event.key)) {
      act(surface, toggled)
    }
  })
  surface.onPointer(event => {
    if (event.type === 'down') {
      act(surface, jumped)
    }
  })

  return game
}

const isBump = (at: number): boolean => {
  const mixed = Math.imul(at ^ (at >>> 15), 2246822519)
  const scattered = Math.imul(mixed ^ (mixed >>> 13), 3266489917)

  return ((scattered ^ (scattered >>> 16)) >>> 0) % 9 === 0
}

/** The field as pixel rows, bottom row first. */
const paint = (game: Game, columns: number, height: number): boolean[][] => {
  const pixels = Array.from({ length: height }, () =>
    new Array<boolean>(columns).fill(false),
  )
  const draw = (sprite: Sprite, x: number, y: number): void => {
    sprite.forEach((line, row) => {
      const target = pixels[y + GROUND + sprite.length - 1 - row]

      for (const [column, pixel] of [...line].entries()) {
        const at = x + column

        if (target !== undefined && pixel === '#' && at >= 0 && at < columns) {
          target[at] = true
        }
      }
    })
  }
  const scrolled = Math.floor(game.dist)

  pixels[1]?.fill(true)
  pixels[0]?.forEach((_, column, row) => {
    row[column] = isBump(scrolled + column)
  })

  for (const cloud of game.clouds) {
    draw(CLOUD, Math.round(cloud.x), cloud.y)
  }

  for (const obstacle of game.obstacles) {
    draw(obstacleSprite(obstacle, game.ticks), Math.round(obstacle.x), obstacle.y)
  }

  draw(dinoSprite(game), DINO_X, Math.round(game.y))

  return pixels
}

const stamp = (line: string, text: string, at: number): string => {
  const from = Math.max(0, at)

  return line.slice(0, from) + text + line.slice(from + text.length)
}

const centered = (line: string, text: string): string =>
  stamp(line, text, Math.floor((line.length - text.length) / 2))

const digits = (score: number): string => String(score).padStart(5, '0')

const Dino: ClientModule<Props, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const known = surface.state ?? start(surface, props)
  const game = caughtUp(known, props)

  if (game !== known) {
    settle(surface, known, game)
  }

  const columns = Math.min(surface.columns, MAX_COLUMNS)
  const rows = surface.rows

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return <Text dimColor>Dino needs a little more room.</Text>
  }

  const pixels = paint(game, columns, rows * 2)
  const lines = Array.from({ length: rows }, (_, row) => {
    const upper = pixels[rows * 2 - 1 - row * 2]
    const lower = pixels[rows * 2 - 2 - row * 2]

    return Array.from({ length: columns }, (_, column) => {
      const isUpper = upper?.[column] === true
      const isLower = lower?.[column] === true

      if (isUpper) {
        return isLower ? '█' : '▀'
      }

      return isLower ? '▄' : ' '
    }).join('')
  })
  const score = scoreOf(game)
  const hi = Math.max(props.hi, game.hi)
  // A round score stays up and blinks, as the arcade's does.
  const isBlinking = game.flash > 0 && game.phase === 'run'
  const isDark = isBlinking && Math.floor(game.flash / 4) % 2 === 0
  const shown = isDark ? '     ' : digits(isBlinking ? game.milestone : score)
  const tally = `${hi > 0 ? `HI ${digits(hi)}  ` : ''}${shown} `
  const middle = Math.max(1, Math.floor(rows / 2) - 3)

  lines[0] = stamp(lines[0] ?? '', tally, columns - tally.length)

  if (game.labelTicks > 0 && game.label !== '') {
    lines[0] = stamp(lines[0] ?? '', ` ▸ ${game.label} `, 0)
  }

  if (game.phase === 'ready') {
    lines[middle] = centered(lines[middle] ?? '', ' PRESS SPACE TO PLAY ')
  } else if (game.phase === 'paused') {
    lines[middle] = centered(lines[middle] ?? '', ' P A U S E D ')
    lines[middle + 2] = centered(lines[middle + 2] ?? '', PAUSE_NOTES[game.note])
  } else if (game.phase === 'over') {
    lines[middle] = centered(lines[middle] ?? '', ' G A M E   O V E R ')
    lines[middle + 2] = centered(lines[middle + 2] ?? '', ' space to run again ')
  }

  const isNight = score >= NIGHT_EVERY && score % NIGHT_EVERY < NIGHT_LASTS

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Text inverse={isNight} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  )
}

export default Dino
