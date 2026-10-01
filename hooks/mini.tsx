import type { ClientModule, ClientSurface } from 'claude-code'

type Sprite = readonly string[]
// What comes at the dino, by its left column: a cell nearer every tick.
type Obstacle = { x: number; kind: 'cactus' | 'bird' }
type Run = {
  ticks: number
  obstacles: Obstacle[]
  // Each cloud's left column, drifting slower than the ground runs.
  clouds: number[]
  // Ticks into the hop over a cactus; -1 on the ground.
  hop: number
  // True while the dino keeps its head down for a bird.
  isDucking: boolean
  seed: number
}

// A band four text rows tall: eight pixel rows (▀ ▄ █), no ground line. The
// dino plays itself: it hops the cacti and ducks the birds.
const TICK_MS = 90
const DINO_X = 2
const MAX_COLUMNS = 120
const MIN_COLUMNS = 20
// The closest two obstacles come: room to land a hop before the next move.
const MIN_GAP = 16
const SPAWN_ODDS = 0.08
const BIRD_ODDS = 0.35
// A hop starts with the cactus this many cells ahead of the dino's column.
const HOP_AT = 7
// Pixels off the ground at each tick of a hop: over a cactus two pixels tall.
const HOP: readonly number[] = [1, 2, 2, 2, 2, 2, 2, 2, 1]
// The dino ducks from a bird this many cells ahead until it is this far past.
const DUCK_FROM = 9
const DUCK_UNTIL = -5
// A bird flies level with the standing dino's head, over the ducking one.
const BIRD_Y = 3
const CLOUD_Y = 6
const CLOUD_EVERY = 3
const CLOUD_GAP = 28
const CLOUD_ODDS = 0.03

const HEAD: Sprite = ['  ###', '# ## ', '#### ']
const STRIDE_A: Sprite = [...HEAD, ' # # ']
const STRIDE_B: Sprite = [...HEAD, '  #  ']
const LOW: Sprite = ['#   ###', '###### ']
const DUCK_A: Sprite = [...LOW, ' # #   ']
const DUCK_B: Sprite = [...LOW, '  #    ']
const CACTUS: Sprite = ['#', '#']
const BIRD_UP: Sprite = [' #  ', '####']
const BIRD_DOWN: Sprite = ['####', ' #  ']
const CLOUD: Sprite = [' ##  ', '#####']
const WIDEST = 5

const roll = (run: Run): number => {
  run.seed = (Math.imul(run.seed, 1664525) + 1013904223) >>> 0

  return run.seed / 2 ** 32
}

const hopAfter = (previous: Run, isCactusDue: boolean): number => {
  const isAirborne = previous.hop >= 0 && previous.hop < HOP.length - 1

  if (isAirborne) {
    return previous.hop + 1
  }

  return isCactusDue ? 0 : -1
}

const step = (previous: Run, columns: number): Run => {
  const run: Run = { ...previous, ticks: previous.ticks + 1 }
  const edge = columns - 1
  run.obstacles = previous.obstacles
    .map(obstacle => ({ ...obstacle, x: obstacle.x - 1 }))
    .filter(obstacle => obstacle.x > -WIDEST)
  const last = run.obstacles.at(-1)?.x ?? -MIN_GAP

  if (edge - last >= MIN_GAP && roll(run) < SPAWN_ODDS) {
    run.obstacles.push({
      x: edge,
      kind: roll(run) < BIRD_ODDS ? 'bird' : 'cactus',
    })
  }

  const drift = run.ticks % CLOUD_EVERY === 0 ? 1 : 0
  run.clouds = previous.clouds.map(x => x - drift).filter(x => x > -WIDEST)
  const lastCloud = run.clouds.at(-1) ?? -CLOUD_GAP

  if (edge - lastCloud >= CLOUD_GAP && roll(run) < CLOUD_ODDS) {
    run.clouds.push(edge)
  }

  const isCactusDue = run.obstacles.some(
    obstacle => obstacle.kind === 'cactus' && obstacle.x === DINO_X + HOP_AT,
  )
  run.hop = hopAfter(previous, isCactusDue)
  run.isDucking =
    run.hop < 0 &&
    run.obstacles.some(
      obstacle =>
        obstacle.kind === 'bird' &&
        obstacle.x <= DINO_X + DUCK_FROM &&
        obstacle.x >= DINO_X + DUCK_UNTIL,
    )

  return run
}

const dinoSprite = (run: Run): Sprite => {
  const isFirstStride = Math.floor(run.ticks / 2) % 2 === 0

  if (run.isDucking) {
    return isFirstStride ? DUCK_A : DUCK_B
  }

  return run.hop >= 0 || isFirstStride ? STRIDE_A : STRIDE_B
}

/** The band as pixel rows, bottom row first. */
const paint = (run: Run, columns: number, height: number): boolean[][] => {
  const pixels = Array.from({ length: height }, () =>
    new Array<boolean>(columns).fill(false),
  )
  const draw = (sprite: Sprite, x: number, y: number): void => {
    sprite.forEach((line, row) => {
      const target = pixels[y + sprite.length - 1 - row]

      for (const [column, pixel] of [...line].entries()) {
        const at = x + column

        if (target !== undefined && pixel === '#' && at >= 0 && at < columns) {
          target[at] = true
        }
      }
    })
  }
  const isWingUp = Math.floor(run.ticks / 3) % 2 === 0

  for (const x of run.clouds) {
    draw(CLOUD, x, CLOUD_Y)
  }

  for (const obstacle of run.obstacles) {
    if (obstacle.kind === 'cactus') {
      draw(CACTUS, obstacle.x, 0)
    } else {
      draw(isWingUp ? BIRD_UP : BIRD_DOWN, obstacle.x, BIRD_Y)
    }
  }

  draw(dinoSprite(run), DINO_X, HOP[run.hop] ?? 0)

  return pixels
}

const start = (surface: ClientSurface<Run>): Run => {
  const run: Run = {
    ticks: 0,
    obstacles: [],
    clouds: [],
    hop: -1,
    isDucking: false,
    seed: Math.floor(Math.random() * 2 ** 32),
  }
  surface.setState(run)
  surface.every(TICK_MS, () => {
    const now = surface.state

    if (now !== undefined) {
      surface.setState(step(now, Math.min(surface.columns, MAX_COLUMNS)))
    }
  })

  return run
}

const Mini: ClientModule<null, Run> = (_props, surface) => {
  const { Box, Text } = surface.elements
  const run = surface.state ?? start(surface)
  const columns = Math.min(surface.columns, MAX_COLUMNS)
  const rows = surface.rows

  if (columns < MIN_COLUMNS || rows < 1) {
    return <Text dimColor> </Text>
  }

  const pixels = paint(run, columns, rows * 2)
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

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  )
}

export default Mini
