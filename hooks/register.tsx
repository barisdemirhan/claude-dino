import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DinoAlert, DinoBoard, DinoInput, DinoSettings } from '../types'
import {
  NOBODY,
  enrolled,
  nameText,
  named,
  placed,
  playersOf,
  posted,
  ranked,
  refusalOf,
  rowsOf,
  runBody,
  sentText,
  toPlayer,
  topPath,
  topText,
  urlOf,
} from './board'
import type { Player, Run, Told } from './board'

type Stats = { runs: number; points: number }
type Post = { event: string; score: number; seed: number; log: string }

const PANE = 'dino'
const GAME = 'game'
const KEYS = 'keys'
const MINI = 'mini'
const HI = 'hi'
const STATS = 'stats'
const SETTINGS = 'settings'
const PLAYER = 'player'
const ROWS = 16
const MINI_ROWS = 4
// Every session looks this often at what another may have switched.
const TICK_MS = 2000
// Cells kept clear after the best score: the hint line draws marks its text
// does not count, and a tail that overruns the row is cut.
const HINT_MARGIN = 6
const MIN_HINT_GAP = 2
const JUMP_KEYS = [' ', 'w', 'k']
const DUCK_KEYS = ['s', 'j']
const PAUSE_KEYS = ['p']
const TOP_KEYS = ['t']
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
  'Usage: /dino [play], /dino stop, /dino close, /dino mini [on|off], /dino sound [on|off], /dino hi [on|off], /dino stats, /dino top, /dino name [<name>|off] or /dino leave.'
const PLAY_WORDS = ['', 'play']
const STOP_WORDS = ['stop', 'stop-play']
// Other words for closing it all: the game, the mini dino, the best score
// under the prompt and the sounds.
const CLOSE_WORDS = ['close', 'exit', 'quit']
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }

const input = atom({ plugin: 'dino', key: 'input' } as const, {
  jumps: 0,
  ducks: 0,
  pauses: 0,
  tops: 0,
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
  isHiHidden: false,
  isClosed: false,
})
const best = atom({ plugin: 'dino', key: 'best' } as const, 0)
// The lost run a name is being asked for, to put it on the global top: 0
// while nothing is asked.
const offer = atom({ plugin: 'dino', key: 'offer' } as const, { score: 0 })
// The global top as last fetched for the game to show, and the person's
// name and rank on it: no name until they join.
const NO_BOARD: DinoBoard = { state: 'idle', top: [], players: 0 }
const board = atom({ plugin: 'dino', key: 'board' } as const, NO_BOARD)
const standing = atom({ plugin: 'dino', key: 'standing' } as const, {
  name: '',
  rank: 0,
})

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
        isHiHidden: 'isHiHidden' in value && value.isHiHidden === true,
        isClosed: 'isClosed' in value && value.isClosed === true,
      }
    : { isMini: false, isMuted: false, isHiHidden: false, isClosed: false }

const toPost = (value: unknown): Post =>
  typeof value === 'object' && value !== null
    ? {
        event:
          'event' in value && typeof value.event === 'string' ? value.event : '',
        score: toScore('score' in value ? value.score : 0),
        seed: toScore('seed' in value ? value.seed : 0),
        log: 'log' in value && typeof value.log === 'string' ? value.log : '',
      }
    : { event: '', score: 0, seed: 0, log: '' }

/**
 * The counts as kept, each a number: a value written before a reload stays
 * in the session's state, and may predate a count this version added.
 */
const toInput = (kept: Partial<DinoInput>): DinoInput => ({
  jumps: toScore(kept.jumps),
  ducks: toScore(kept.ducks),
  pauses: toScore(kept.pauses),
  tops: toScore(kept.tops),
  typed: toScore(kept.typed),
})

const keyed = (kept: DinoInput, key: string): DinoInput => {
  const now = toInput(kept)

  return {
    jumps: now.jumps + (JUMP_KEYS.includes(key) ? 1 : 0),
    ducks: now.ducks + (DUCK_KEYS.includes(key) ? 1 : 0),
    pauses: now.pauses + (PAUSE_KEYS.includes(key) ? 1 : 0),
    tops: now.tops + (TOP_KEYS.includes(key) ? 1 : 0),
    typed: now.typed + 1,
  }
}

/** Everything the game module draws from, as its props. */
const propsOf = async ($: EngineInterface) => {
  const { jumps, ducks, pauses, tops } = toInput(await read($, input))
  const { tools, fails, tool } = await read($, feed)
  const { count, reason } = await read($, alert)
  const { name, rank } = await read($, standing)
  const { state, top, players } = await read($, board)
  const hi = toScore(await $.store.get(HI))

  return {
    hi,
    jumps,
    ducks,
    pauses,
    tops,
    tools,
    fails,
    tool,
    alerts: count,
    alert: reason,
    name,
    rank,
    isAsked: (await read($, offer)).score > 0,
    board: state,
    top,
    players,
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

const playerOf = async ($: EngineInterface): Promise<Player> =>
  toPlayer(await $.store.get(PLAYER))

/** Keeps the player, and hands the game their name and rank to show. */
const filed = async ($: EngineInterface, player: Player): Promise<void> => {
  await $.store.set(PLAYER, player)
  await update($, standing, () => ({ name: player.name, rank: player.rank }))
}

/**
 * Asks the leaderboard's server, and answers its status and what it said:
 * status 0 when it could not be reached or said nothing a board would say.
 */
const asked = async (
  $: EngineInterface,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; said: unknown }> => {
  try {
    const { status, text } = await $.http.fetch(
      urlOf(path),
      body === undefined ? undefined : posted(body),
    )
    const said: unknown = JSON.parse(text)

    return { status, said }
  } catch {
    return { status: 0, said: undefined }
  }
}

/**
 * Takes `name` on the global top for this person, or changes the name they
 * have there. The first time, it makes the id and the secret their runs go
 * under, and keeps them once the server has taken the name.
 */
const joined = async ($: EngineInterface, name: string): Promise<Told> => {
  const player = enrolled(await playerOf($))
  const { status, said } = await asked($, '/players', {
    id: player.id,
    key: player.key,
    name,
  })

  if (status !== 200) {
    return { isDone: false, text: refusalOf(said) }
  }

  const taken = named(player, said)
  await filed($, taken)

  return {
    isDone: true,
    text: `You are on the global top as ${taken.name}. Your best runs go up from here on.`,
  }
}

/** Sends a run for the server to play again and count. */
const sent = async ($: EngineInterface, run: Run): Promise<Told> => {
  const player = await playerOf($)
  const { status, said } = await asked($, '/runs', runBody(player, run))

  if (status !== 200) {
    return { isDone: false, text: refusalOf(said) }
  }

  await filed($, ranked(player, run, said))

  return { isDone: true, text: sentText(said) }
}

/** `/dino leave`: takes this person and their runs off the global top. */
const leftText = async ($: EngineInterface): Promise<string> => {
  const player = await playerOf($)

  if (player.name === '') {
    return 'You are not on the global top.'
  }

  const { status, said } = await asked($, '/leave', {
    id: player.id,
    key: player.key,
  })

  // A player the server no longer knows is as gone as one it just removed.
  if (status !== 200 && status !== 403) {
    return refusalOf(said)
  }

  await filed($, { ...NOBODY, isOff: true })

  return 'You are off the global top, and your runs there are deleted.'
}

/** `/dino name off`: the game stops asking for a name after a lost run. */
const declinedText = async ($: EngineInterface): Promise<string> => {
  const player = await playerOf($)

  if (player.name !== '') {
    return `You are on the global top as ${player.name}. /dino leave takes you off it.`
  }

  await $.store.set(PLAYER, { ...player, isOff: true })

  return 'Dino will not ask for a name again. /dino name <name> joins the global top.'
}

/**
 * Fetches the global top for the game to show. What it showed before stays
 * up while the server is asked, and after a silence.
 */
const boarded = async ($: EngineInterface): Promise<void> => {
  await update($, board, (now): DinoBoard => ({ ...now, state: 'asking' }))
  const player = await playerOf($)
  const { status, said } = await asked($, topPath(player))
  const top = rowsOf(said)

  if (status !== 200 || top === undefined) {
    await update($, board, (now): DinoBoard => ({ ...now, state: 'silent' }))

    return
  }

  await update(
    $,
    board,
    (): DinoBoard => ({ state: 'ready', top, players: playersOf(said) }),
  )

  if (player.name !== '') {
    await filed($, placed(player, said))
  }
}

/**
 * What a lost run means for the global top. A player's run that beats the
 * one they have there is sent; a run of somebody who is not on it, and has
 * not said to be left alone, opens the offer of a name.
 */
const topped = async ($: EngineInterface, run: Run): Promise<void> => {
  const player = await playerOf($)

  if (player.name !== '') {
    if (run.score > player.best) {
      $.ui.toast((await sent($, run)).text)
    }
  } else if (!player.isOff) {
    await update($, offer, () => ({ score: run.score }))
  }
}

/**
 * Joins the global top under `name` and sends `run`, the latest one, if it
 * beats what the player has there. Answers whether the name was taken, and
 * what to tell the person.
 */
const join = async (
  $: EngineInterface,
  name: string,
  run: Run | undefined,
): Promise<Told> => {
  const told = await joined($, name)

  if (!told.isDone || run === undefined) {
    return told
  }

  return run.score > (await playerOf($)).best
    ? { isDone: true, text: (await sent($, run)).text }
    : told
}

const play = async ($: EngineInterface, event: string): Promise<void> => {
  const asset = CLIPS[event]
  const { isMuted, isClosed } = await read($, settings)

  if (asset !== undefined && !isMuted && !isClosed) {
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

/**
 * Changes a setting for this session and keeps it for the next ones, and for
 * the others open now, which take it up at their next look.
 */
const stored = async (
  $: EngineInterface,
  change: Partial<DinoSettings>,
): Promise<DinoSettings> => {
  // Closed is every part of the dino away together: a change that shows one
  // of them again leaves it closed no longer.
  const changed =
    change.isClosed === undefined &&
    (change.isMini === true || change.isHiHidden === false)
      ? { ...change, isClosed: false }
      : change
  // Another session may have switched the rest since this one last looked.
  const next = { ...toSettings(await $.store.get(SETTINGS)), ...changed }
  await update($, settings, () => next)
  await $.store.set(SETTINGS, next)

  return next
}

/**
 * Takes up what another session switched. The settings are one for every
 * session, kept in the store, and a `/dino close` taken up from there closes
 * the game here too. Answers whether it did.
 */
const synced = async ($: EngineInterface): Promise<boolean> => {
  const shared = toSettings(await $.store.get(SETTINGS))
  const held = await read($, settings)
  const isHeld =
    held.isMini === shared.isMini &&
    held.isMuted === shared.isMuted &&
    held.isHiHidden === shared.isHiHidden &&
    held.isClosed === shared.isClosed

  if (isHeld) {
    return false
  }

  await update($, settings, () => shared)

  if (!shared.isClosed || held.isClosed) {
    return false
  }

  await $.ui.close({ id: PANE })

  return true
}

/** True while the mini dino is on, and not closed with the rest. */
const isMiniShown = (now: DinoSettings): boolean => now.isMini && !now.isClosed

/** True while the best score shows under the prompt: kept, and not closed. */
const isHiShown = (now: DinoSettings): boolean =>
  !now.isHiHidden && !now.isClosed

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

/** `/dino hi [on|off]`: the word's way, or the other way with no word. */
const hiText = async ($: EngineInterface, word: string): Promise<string> => {
  const isOn = word === '' ? !isHiShown(await read($, settings)) : SWITCH[word]

  if (isOn === undefined) {
    return USAGE
  }

  await stored($, { isHiHidden: !isOn })

  return isOn
    ? 'Your best score shows under the prompt.'
    : 'Your best score is off the line under the prompt.'
}

/**
 * `/dino close`: the game, the mini dino and the best score under the prompt
 * away together, and so the sounds, where `/dino stop` closes only the game.
 * `/dino` brings them back as they were; the other sessions follow at their
 * next look at the store.
 */
const closedText = async ($: EngineInterface): Promise<string> => {
  await $.ui.close({ id: PANE })
  await stored($, { isClosed: true })

  return 'Dino is closed: the game, the mini dino, your best score under the prompt and the sounds are away. /dino brings them back.'
}

/** Holds the run and says why: Claude is done, or waits on the person. */
const alerted = async (
  $: EngineInterface,
  reason: DinoAlert['reason'],
): Promise<void> => {
  await update($, alert, now => ({ count: now.count + 1, reason }))
  $.ui.toast(ALERTS[reason])
}

/**
 * A change of the keys field. While a name is asked for, the field takes
 * the name, and only a space with nothing before it is still a move: the
 * one that runs again.
 */
const typed = async ($: EngineInterface, value: string): Promise<void> => {
  const isAsked = (await read($, offer)).score > 0

  if (!isAsked) {
    await update($, input, now => keyed(now, value.at(-1)?.toLowerCase() ?? ''))
  } else if (value !== '' && value.trim() === '') {
    await update($, input, now => keyed(now, ' '))
  }
}

/**
 * Enter in the keys field: a jump. While a name is asked for, the name
 * joins the global top with the latest run, and enter alone shows the top.
 */
const entered = async (
  $: EngineInterface,
  value: string,
  latest: Run | undefined,
): Promise<void> => {
  const name = value.trim()
  const isAsked = (await read($, offer)).score > 0

  if (!isAsked || name === '') {
    await update($, input, now => keyed(now, isAsked ? 't' : ' '))

    return
  }

  const told = await join($, name, latest)
  $.ui.toast(told.text)

  if (told.isDone) {
    await update($, offer, () => ({ score: 0 }))
    // A key that is no move: it only empties the field of the name.
    await update($, input, now => keyed(now, ''))
  }
}

export const register: Register = on => {
  // Whether a run is on, as the game last posted: Claude's work reaches the
  // game only then, and nothing else of this module looks at it.
  let isRunning = false
  // The latest finished run, kept for a name that comes after it.
  let latest: Run | undefined
  // The look at the store for what another session switched.
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dino',
      description: 'Play a T-Rex runner in a pane while Claude works',
      argumentHint: '[play|stop|close|mini|sound|hi|stats|top|name|leave]',
    })
    const saved = toSettings(await $.store.get(SETTINGS))
    const hi = toScore(await $.store.get(HI))
    const { name, rank } = await playerOf($)
    await update($, settings, () => saved)
    await update($, best, () => hi)
    await update($, standing, () => ({ name, rank }))
    // A close another session made ends a run here, as one made here does.
    ticker ??= $.clock.every(TICK_MS, async () => {
      if (await synced($)) {
        isRunning = false
      }
    })

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

    if (verb === 'hi') {
      return { text: await hiText($, word) }
    }

    if (verb === 'name' && word === 'off') {
      await update($, offer, () => ({ score: 0 }))

      return { text: await declinedText($) }
    }

    if (verb === 'name' && word !== '') {
      // The name as typed: the words above are lowered to match commands.
      const told = await join($, e.args.trim().split(/\s+/)[1] ?? '', latest)

      if (told.isDone) {
        await update($, offer, () => ({ score: 0 }))
      }

      return { text: told.text }
    }

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === 'name') {
      return { text: nameText(await playerOf($)) }
    }

    if (verb === 'top') {
      const { status, said } = await asked($, topPath(await playerOf($)))

      return { text: topText(status, said) }
    }

    if (verb === 'leave') {
      return { text: await leftText($) }
    }

    if (verb === 'stats') {
      return { text: await statsText($) }
    }

    if (STOP_WORDS.includes(verb)) {
      isRunning = false
      await $.ui.close({ id: PANE })

      return {
        text: 'The game is closed. /dino opens it again, and /dino close takes the mini dino and your best score away too.',
      }
    }

    if (CLOSE_WORDS.includes(verb)) {
      isRunning = false

      return { text: await closedText($) }
    }

    if (!PLAY_WORDS.includes(verb)) {
      return { text: USAGE }
    }

    // The game brings back what `/dino close` took away, as it was.
    await stored($, { isClosed: false })

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
      latest = { seed: post.seed, log: post.log, score: post.score }
      await record($, post.score)
      void topped($, latest)
    } else if (post.event === 'top') {
      void boarded($)
    } else if (post.event === 'start' && (await read($, offer)).score > 0) {
      // The person ran again instead of taking a name.
      await update($, offer, () => ({ score: 0 }))
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

    if (hi === 0 || !isHiShown(await read($, settings))) {
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

    if (!isOffered || !isMiniShown(await read($, settings))) {
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
    const { typed: keys } = toInput(await read($, input))
    const { score: offered } = await read($, offer)
    const isAsked = offered > 0
    const hint = e.props.isFocused
      ? 'space/w jump · s duck · p pause · t top · esc gives the keys back to the prompt'
      : 'ctrl+x tab gives the game the keys · then space/w jump · s duck · p pause · t top'

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
        {/* After a lost run by somebody not on the global top, the same field
            asks for a name: it keeps the focus, and a space still runs again. */}
        <Input
          key={KEYS}
          label={isAsked ? 'name' : 'keys'}
          placeholder={
            isAsked
              ? 'a name for the global top'
              : 'space jump · s duck · p pause · t top'
          }
          submitLabel={isAsked ? 'join' : 'jump'}
          value={keys % 2 === 0 ? '' : ' '}
          autoFocus
          onInput={value => typed($, value)}
          onSubmit={value => entered($, value, latest)}
        />
        <Text dimColor>
          {isAsked
            ? `enter sends this name and your ${digits(offered)} run to the global top · space runs again · enter alone shows the top`
            : hint}
        </Text>
      </Box>
    )
  })
}
