import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DinoAlert, DinoInput, DinoSettings } from '../types'

type Stats = { runs: number; points: number }
type Post = { event: string; score: number }

const PANE = 'dino'
const GAME = 'game'
const KEYS = 'keys'
const MINI = 'mini'
const HI = 'hi'
const STATS = 'stats'
const SETTINGS = 'settings'
const ROWS = 16
const MINI_ROWS = 4
// Cells kept clear after the best score: the hint line draws marks its text
// does not count, and a tail that overruns the row is cut.
const HINT_MARGIN = 6
const MIN_HINT_GAP = 2
const JUMP_KEYS = [' ', 'w', 'k']
const DUCK_KEYS = ['s', 'j']
const PAUSE_KEYS = ['p']
// What the game posts while a run is on; any other post ends or holds it.
const RUNNING = ['start', 'resume', 'jump', 'point']
const CLIPS: Readonly<Record<string, string>> = {
  start: 'sounds/jump.wav',
  jump: 'sounds/jump.wav',
  point: 'sounds/point.wav',
  over: 'sounds/hit.wav',
}
const ALERTS = {
  done: 'Claude is done · dino paused',
  ask: 'Claude needs you · dino paused',
} as const
// The notices Claude Code sends when it waits on the person's answer.
const WAITING = ['permission_prompt', 'elicitation_dialog']
const USAGE =
  'Usage: /dino [play], /dino stop, /dino mini [on|off], /dino sound [on|off] or /dino stats.'
const PLAY_WORDS = ['', 'play']
const STOP_WORDS = ['stop', 'stop-play']
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }

const input = atom({ plugin: 'dino', key: 'input' } as const, {
  jumps: 0,
  ducks: 0,
  pauses: 0,
  typed: 0,
})
const feed = atom({ plugin: 'dino', key: 'feed' } as const, {
  tools: 0,
  fails: 0,
  tool: '',
})
const alert = atom({ plugin: 'dino', key: 'alert' } as const, {
  count: 0,
  reason: 'done',
})
const settings = atom({ plugin: 'dino', key: 'settings' } as const, {
  isMini: false,
  isMuted: false,
})
const best = atom({ plugin: 'dino', key: 'best' } as const, 0)

const toScore = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

const digits = (score: number): string => String(score).padStart(5, '0')

const toStats = (value: unknown): Stats =>
  typeof value === 'object' && value !== null
    ? {
        runs: toScore('runs' in value ? value.runs : 0),
        points: toScore('points' in value ? value.points : 0),
      }
    : { runs: 0, points: 0 }

const toSettings = (value: unknown): DinoSettings =>
  typeof value === 'object' && value !== null
    ? {
        isMini: 'isMini' in value && value.isMini === true,
        isMuted: 'isMuted' in value && value.isMuted === true,
      }
    : { isMini: false, isMuted: false }

const toPost = (value: unknown): Post =>
  typeof value === 'object' && value !== null
    ? {
        event:
          'event' in value && typeof value.event === 'string' ? value.event : '',
        score: toScore('score' in value ? value.score : 0),
      }
    : { event: '', score: 0 }

/**
 * The counts as kept, each a number: a value written before a reload stays
 * in the session's state, and may predate a count this version added.
 */
const toInput = (kept: Partial<DinoInput>): DinoInput => ({
  jumps: toScore(kept.jumps),
  ducks: toScore(kept.ducks),
  pauses: toScore(kept.pauses),
  typed: toScore(kept.typed),
})

const keyed = (kept: DinoInput, key: string): DinoInput => {
  const now = toInput(kept)

  return {
    jumps: now.jumps + (JUMP_KEYS.includes(key) ? 1 : 0),
    ducks: now.ducks + (DUCK_KEYS.includes(key) ? 1 : 0),
    pauses: now.pauses + (PAUSE_KEYS.includes(key) ? 1 : 0),
    typed: now.typed + 1,
  }
}

/** Everything the game module draws from, as its props. */
const propsOf = async ($: EngineInterface) => {
  const { jumps, ducks, pauses } = toInput(await read($, input))
  const { tools, fails, tool } = await read($, feed)
  const { count, reason } = await read($, alert)
  const hi = toScore(await $.store.get(HI))

  return {
    hi,
    jumps,
    ducks,
    pauses,
    tools,
    fails,
    tool,
    alerts: count,
    alert: reason,
  }
}

/** Counts a finished run and keeps the best score. */
const record = async ($: EngineInterface, score: number): Promise<void> => {
  const stats = toStats(await $.store.get(STATS))
  const hi = Math.max(score, toScore(await $.store.get(HI)))
  await $.store.set(HI, hi)
  await $.store.set(STATS, {
    runs: stats.runs + 1,
    points: stats.points + score,
  })
  await update($, best, () => hi)
}

const play = async ($: EngineInterface, event: string): Promise<void> => {
  const asset = CLIPS[event]
  const { isMuted } = await read($, settings)

  if (asset !== undefined && !isMuted) {
    // A machine with no player has no sound; the game runs on without it.
    await $.audio.play({ asset }, { gain: 0.5 }).catch(() => undefined)
  }
}

const statsText = async ($: EngineInterface): Promise<string> => {
  const { runs, points } = toStats(await $.store.get(STATS))
  const hi = toScore(await $.store.get(HI))

  if (runs === 0) {
    return hi > 0
      ? `Dino: best ${digits(hi)}. Runs are counted from this version on.`
      : 'Dino: no runs yet. /dino opens the game.'
  }

  const average = Math.round(points / runs)
  const counted = `${runs} ${runs === 1 ? 'run' : 'runs'}`

  return `Dino: ${counted} · best ${digits(hi)} · average ${average} · ${points} points in all`
}

/** Changes a setting for this session and keeps it for the next ones. */
const stored = async (
  $: EngineInterface,
  change: Partial<DinoSettings>,
): Promise<DinoSettings> => {
  const next = await update($, settings, now => ({ ...now, ...change }))
  await $.store.set(SETTINGS, next)

  return next
}

/** `/dino mini [on|off]`: the mini dino on, unless the word says off. */
const miniText = async ($: EngineInterface, word: string): Promise<string> => {
  const isMini = word === '' ? true : SWITCH[word]

  if (isMini === undefined) {
    return USAGE
  }

  await stored($, { isMini })

  return isMini
    ? 'Mini dino is on: it plays itself above the prompt while Claude works.'
    : 'Mini dino is off.'
}

/** `/dino sound [on|off]`: the word's way, or the other way with no word. */
const soundText = async ($: EngineInterface, word: string): Promise<string> => {
  const isOn = word === '' ? (await read($, settings)).isMuted : SWITCH[word]

  if (isOn === undefined) {
    return USAGE
  }

  await stored($, { isMuted: !isOn })

  return `Dino sound is ${isOn ? 'on' : 'off'}.`
}

/** Holds the run and says why: Claude is done, or waits on the person. */
const alerted = async (
  $: EngineInterface,
  reason: DinoAlert['reason'],
): Promise<void> => {
  await update($, alert, now => ({ count: now.count + 1, reason }))
  $.ui.toast(ALERTS[reason])
}

export const register: Register = on => {
  // Whether a run is on, as the game last posted: Claude's work reaches the
  // game only then, and nothing else of this module looks at it.
  let isRunning = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dino',
      description: 'Play a T-Rex runner in a pane while Claude works',
      argumentHint: '[play|stop|mini|sound|stats]',
    })
    const saved = toSettings(await $.store.get(SETTINGS))
    const hi = toScore(await $.store.get(HI))
    await update($, settings, () => saved)
    await update($, best, () => hi)

    return next(e)
  })

  on('command.run', { command: 'dino' }, async ($, e) => {
    const [verb = '', word = '', ...rest] = e.args
      .trim()
      .toLowerCase()
      .split(/\s+/)

    if (rest.length > 0) {
      return { text: USAGE }
    }

    if (verb === 'mini') {
      return { text: await miniText($, word) }
    }

    if (verb === 'sound') {
      return { text: await soundText($, word) }
    }

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === 'stats') {
      return { text: await statsText($) }
    }

    if (STOP_WORDS.includes(verb)) {
      isRunning = false
      await $.ui.close({ id: PANE })

      return { text: 'Dino is closed. /dino opens it again.' }
    }

    if (!PLAY_WORDS.includes(verb)) {
      return { text: USAGE }
    }

    const opened = await $.ui.open({
      id: PANE,
      title: 'Dino',
      focus: true,
      rows: ROWS + 2,
    })

    return {
      text: opened.isPlaced
        ? 'Dino is open: space to jump, s to duck, p to pause.'
        : `Dino is open but has no room to show: ${opened.reason}`,
    }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== GAME) {
      return next(e)
    }

    const post = toPost(e.data)
    isRunning = RUNNING.includes(post.event)

    if (post.event === 'over') {
      await record($, post.score)
    }

    void play($, post.event)

    return { props: await propsOf($) }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) {
      isRunning = false
    }

    return next(e)
  })

  // Claude's tool calls feed a run its obstacles. The call itself is passed on
  // and answered untouched: only its name and whether it failed are read.
  on('tool.call', async ($, e, next) => {
    if (!isRunning) {
      return next(e)
    }

    const tool = (String(e.tool).split('__').at(-1) ?? '').slice(0, 24)
    await update($, feed, now => ({ ...now, tools: now.tools + 1, tool }))
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError === true) {
      await update($, feed, now => ({ ...now, fails: now.fails + 1 }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (isRunning && e.agentId === undefined) {
      isRunning = false
      await alerted($, 'done')
    }

    return next(e)
  })

  // Claude Code's own notice that it waits on the person. It is only read:
  // the notice goes on as it came, and what it asks stays theirs to answer.
  on('classic.Notification', async ($, e, next) => {
    if (isRunning && WAITING.includes(e.notification_type)) {
      isRunning = false
      await alerted($, 'ask')
    }

    return next(e)
  })

  // The best score at the right end of the hint line under the prompt, where
  // it shows with the pane closed and takes no row of its own. The hint's text
  // is the engine's to draw: this only pads a tail out to the row's end.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hi = await read($, best)

    if (hi === 0) {
      return next(e)
    }

    const label = `🦖 HI ${digits(hi)}`
    const before = `${e.props.hint}${e.props.tail ?? ''}`
    const room = (e.viewport?.columns ?? 0) - before.length - label.length
    const gap = ' '.repeat(Math.max(MIN_HINT_GAP, room - HINT_MARGIN))
    const tail = `${e.props.tail ?? ''}${gap}${label}`

    return next({ ...e, props: { ...e.props, tail } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOffered =
      e.props.isWorking &&
      !e.props.hasSurvey &&
      (e.surface === 'terminal' || e.surface === 'desktop')

    if (!isOffered || !(await read($, settings)).isMini) {
      return next(e)
    }

    const ui = $.ui.resolve(e)

    return (
      <ui.Client
        key={MINI}
        module="./mini.tsx"
        props={null}
        width="100%"
        height={MINI_ROWS}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Dino runs in the terminal and the desktop app.</Text>
    }

    const ui = $.ui.resolve(e)
    const { Box, Input, Text } = ui
    const { typed } = toInput(await read($, input))

    return (
      <Box flexDirection="column">
        <ui.Client
          key={GAME}
          module="./dino.tsx"
          props={await propsOf($)}
          width="100%"
          height={ROWS}
        />
        {/* The field is the keyboard: every key typed into it is one move, and
            drawing a value other than the last one empties it again. */}
        <Input
          key={KEYS}
          label="keys"
          placeholder="space jump · s duck · p pause"
          submitLabel="jump"
          value={typed % 2 === 0 ? '' : ' '}
          autoFocus
          onInput={value =>
            update($, input, now => keyed(now, value.at(-1)?.toLowerCase() ?? ''))
          }
          onSubmit={() => update($, input, now => keyed(now, ' '))}
        />
        <Text dimColor>
          {e.props.isFocused
            ? 'space/w jump · s duck · p pause · esc gives the keys back to the prompt'
            : 'ctrl+x tab gives the game the keys · then space/w jump · s duck · p pause'}
        </Text>
      </Box>
    )
  })
}
