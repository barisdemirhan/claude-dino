import type { ClientModule, ClientSurface } from 'claude-code'

import {
  CLOUD,
  DINO_X,
  JUMP,
  MAX_COLUMNS,
  MIN_COLUMNS,
  RESTART_TICKS,
  TICK_MS,
  dinoSprite,
  ducked,
  fresh,
  jumped,
  obstacleSprite,
  paused,
  peeked,
  queued,
  scoreOf,
  step,
  toggled,
} from './sim'
import type { Game, Sprite } from './sim'

type Row = { name: string; score: number }
type Props = {
  hi: number
  jumps: number
  ducks: number
  pauses: number
  tops: number
  tools: number
  fails: number
  tool: string
  alerts: number
  alert: 'done' | 'ask'
  // The person on the global top: no name until they join, rank 0 until a
  // run of theirs counts. isAsked while the field below takes a name.
  name: string
  rank: number
  isAsked: boolean
  // The board as last fetched, and whether it is being asked for or silent.
  board: 'idle' | 'asking' | 'ready' | 'silent'
  top: Row[]
  players: number
}

const GROUND = 2
const MIN_ROWS = 8
const NIGHT_EVERY = 700
const NIGHT_LASTS = 250
const LABEL_TICKS = 40
const JUMP_KEYS = [' ', 'space', 'up', 'return', 'w', 'k']
const DUCK_KEYS = ['down', 's', 'j']
const PAUSE_KEYS = ['p']
const TOP_KEYS = ['t']
const TOP_ROWS = 10
const BOARD_NOTES = {
  idle: 'asking the leaderboard…',
  asking: 'asking the leaderboard…',
  ready: 'nobody is on it yet: finish a run and take a name',
  silent: 'the leaderboard did not answer',
} as const
const PAUSE_NOTES = {
  key: ' space or p to run on ',
  done: ' Claude is done · space to run on ',
  ask: ' Claude needs you · space to run on ',
} as const

/** The run with the obstacles Claude's new tool calls and failures queue. */
const fed = (game: Game, props: Props): Game => {
  const seen = { ...game, tools: props.tools, fails: props.fails }

  if (game.phase !== 'run') {
    return seen
  }

  return {
    ...queued(seen, props.tools - game.tools, props.fails - game.fails),
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
    [props.tops !== game.tops, now => peeked({ ...now, tops: props.tops })],
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

  if (after.isTop && !before.isTop) {
    // The hooks module fetches the board when it is asked for, not before.
    return 'top'
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

  if (event === 'over') {
    // A lost run goes with what plays it again: the leaderboard takes those.
    surface.post({
      event,
      score: scoreOf(after),
      seed: after.start,
      log: after.log,
    })
  } else if (event !== undefined) {
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
    } else if (TOP_KEYS.includes(event.key)) {
      act(surface, peeked)
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

/** The global top as text rows, in place of the field. */
const boardLines = (props: Props, columns: number, rows: number): string[] => {
  const lines = Array.from({ length: rows }, () => ' '.repeat(columns))
  const put = (row: number, text: string): void => {
    lines[row] = stamp(lines[row] ?? '', text, 2)
  }
  const shown = props.top.slice(0, Math.min(TOP_ROWS, rows - 4))
  const count = `${props.players} ${props.players === 1 ? 'player' : 'players'}`

  put(0, `G L O B A L   T O P${shown.length > 0 ? ` · ${count}` : ''}`)

  if (shown.length === 0) {
    put(2, BOARD_NOTES[props.board])
  }

  shown.forEach(({ name, score }, at) => {
    const mark = name === props.name ? '▸' : ' '
    put(2 + at, `${mark}${String(at + 1).padStart(2)}  ${digits(score)}  ${name}`)
  })

  if (props.rank > shown.length) {
    put(rows - 2, `▸ you are #${props.rank} · ${props.name}`)
  }

  put(rows - 1, 't closes · space runs')

  return lines
}

/** What a lost run says in the middle of the field, top line first. */
const overLines = (game: Game, props: Props): string[] => {
  const score = scoreOf(game)
  // A first run beats nothing: only a best that was there can be beaten.
  const isBest = game.was > 0 && score > game.was
  const standing =
    props.rank > 0 ? `#${props.rank} on the global top` : 'on the global top'

  return [
    isBest ? ' N E W   B E S T ' : ' G A M E   O V E R ',
    '',
    ...(isBest
      ? [` ${score - game.was} past your old best of ${digits(game.was)} `]
      : []),
    ...(props.name !== '' ? [` ${props.name} · ${standing} `] : []),
    ...(props.name === '' && props.isAsked
      ? [' a name below puts this run on the global top ']
      : []),
    '',
    props.isAsked ? ' space runs again ' : ' space runs again · t shows the top ',
  ]
}

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

  if (game.isTop && game.phase !== 'run') {
    return (
      <Box flexDirection="column">
        {boardLines(props, columns, rows).map(line => (
          <Text wrap="truncate-end">{line}</Text>
        ))}
      </Box>
    )
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
    lines[middle + 2] = centered(lines[middle + 2] ?? '', ' t shows the global top ')
  } else if (game.phase === 'paused') {
    lines[middle] = centered(lines[middle] ?? '', ' P A U S E D ')
    lines[middle + 2] = centered(lines[middle + 2] ?? '', PAUSE_NOTES[game.note])
  } else if (game.phase === 'over') {
    overLines(game, props).forEach((text, at) => {
      if (text !== '') {
        lines[middle + at] = centered(lines[middle + at] ?? '', text)
      }
    })
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
