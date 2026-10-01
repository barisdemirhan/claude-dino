import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { replayed } from '../hooks/sim'

const PANE = {
  plugin: 'dino',
  component: 'Pane',
  requestId: 'dino',
  props: {
    title: 'Dino',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 17 },
    view: {},
  },
  viewport: { columns: 80, rows: 40 },
} as const
const FIELD = { columns: 80, rows: 16 }
const GAME = { type: 'Text', in: 'game' } as const
// `/dino stats` as the person types it at the prompt.
const STATS = {
  command: 'dino',
  args: 'stats',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const
// `/dino name ...`, `/dino top` and `/dino leave`, the same way.
const said = (args: string) => ({ ...STATS, args })
const OFFER = { type: 'Text', text: /enter sends this name/ } as const

/**
 * The leaderboard's server, answered from memory: each path's status and
 * body, a 404 for any other. Answers the list of what was asked of it.
 */
const board = (
  on: On,
  replies: Readonly<Record<string, readonly [number, unknown]>>,
): { path: string; body: Record<string, unknown> }[] => {
  const asked: { path: string; body: Record<string, unknown> }[] = []

  on('http.fetch', (_$, e) => {
    const path = new URL(e.url).pathname
    const [status, body] = replies[path] ?? [404, { error: 'not-found' }]
    asked.push({ path, body: JSON.parse(e.init?.body ?? '{}') })

    return {
      value: {
        status,
        ok: status === 200,
        headers: {},
        text: JSON.stringify(body),
      },
    }
  })

  return asked
}

test('a run starts on space, ends on the first cactus and keeps the best score', async ($, on) => {
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(FIELD)
    expect(await ui.find({ ...GAME, text: 'PRESS SPACE TO PLAY' })).toBeDefined()

    await ui.key({ key: ' ' })
    await ui.advance(1000)
    expect(await ui.find({ ...GAME, text: 'PRESS SPACE TO PLAY' })).toBeUndefined()
    expect(await ui.find({ ...GAME, text: 'G A M E' })).toBeUndefined()

    // Nobody jumps again, so the first cactus ends the run.
    await ui.advance(20_000)
    expect(await ui.find({ ...GAME, text: 'G A M E   O V E R' })).toBeDefined()
    await ui.unmount()

    const reopened = await $.ui.mount({ ...PANE, surface })
    await reopened.resize(FIELD)
    expect(await reopened.find({ ...GAME, text: /HI \d{5}/ })).toBeDefined()
    await reopened.unmount()
  }
})

test('space lifts the dino off the ground and gravity brings it back', async ($, on) => {
  mock.store(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  // The text row the dino's feet stand in, over the columns the dino takes.
  const feet = async () =>
    (await ui.findAll(GAME)).at(-2)?.text?.slice(3, 16).trim()

  expect(await feet()).not.toBe('')

  await ui.key({ key: ' ' })
  await ui.advance(280)
  expect(await feet()).toBe('')

  await ui.advance(600)
  expect(await feet()).not.toBe('')

  await ui.key({ key: 'up' })
  await ui.advance(120)
  await ui.key({ key: 'down' })
  await ui.advance(120)
  expect(await feet()).not.toBe('')
  await ui.unmount()
})

test('a space typed into the keys field makes the dino jump, an s brings it down', async ($, on) => {
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(FIELD)
    const feet = async () =>
      (await ui.findAll(GAME)).at(-2)?.text?.slice(3, 16).trim()

    await ui.input({ key: 'keys', text: ' ', kind: 'change' })
    expect(await ui.find({ ...GAME, text: 'PRESS SPACE TO PLAY' })).toBeUndefined()
    await ui.advance(280)
    expect(await feet()).toBe('')

    await ui.advance(600)
    await ui.input({ key: 'keys', text: 'x', kind: 'change' })
    await ui.advance(120)
    expect(await feet()).not.toBe('')

    await ui.input({ key: 'keys', text: '' })
    await ui.advance(120)
    await ui.input({ key: 'keys', text: 's', kind: 'change' })
    await ui.advance(120)
    expect(await feet()).not.toBe('')
    await ui.unmount()
  }
})

test('p holds the run where it stands and space runs it on', async ($, on) => {
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(FIELD)
    await ui.key({ key: ' ' })
    await ui.advance(400)
    await ui.key({ key: 'p' })
    expect(await ui.find({ ...GAME, text: 'P A U S E D' })).toBeDefined()

    // Long enough for the first cactus to end a run that had kept going.
    await ui.advance(20_000)
    expect(await ui.find({ ...GAME, text: 'G A M E' })).toBeUndefined()

    await ui.key({ key: ' ' })
    expect(await ui.find({ ...GAME, text: 'P A U S E D' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished run is counted in /dino stats', async ($, on) => {
  mock.store(on)

  const before = await $.command.run(STATS)
  expect(before.text).toContain('no runs yet')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  expect(await ui.find({ ...GAME, text: 'G A M E   O V E R' })).toBeDefined()
  await ui.unmount()

  const after = await $.command.run(STATS)
  expect(after.text).toContain('1 run ·')
})

test('/dino mini and /dino sound take on and off, and say what they take', async ($, on) => {
  mock.store(on)

  const run = (args: string) => $.command.run({ ...STATS, args })

  expect((await run('mini')).text).toContain('Mini dino is on')
  expect((await run('mini off')).text).toBe('Mini dino is off.')
  expect((await run('mini on')).text).toContain('Mini dino is on')
  expect((await run('sound off')).text).toBe('Dino sound is off.')
  expect((await run('sound')).text).toBe('Dino sound is on.')
  expect((await run('mini maybe')).text).toContain('Usage: /dino')
  expect((await run('jump')).text).toContain('Usage: /dino')
})

test('/dino hi takes the best score off the line under the prompt and puts it back', async ($, on) => {
  mock.store(on)

  // The engine's own drawing of the line, beneath the plugin: the hint, then
  // the tail the plugin handed it.
  on('ui.render', { component: 'PromptHint' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)

    return Text({ children: `${e.props.hint}${e.props.tail ?? ''}` })
  })
  const HINT = {
    plugin: 'dino',
    component: 'PromptHint',
    surface: 'terminal',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns: 80, rows: 40 },
  } as const
  const drawn = async () => {
    const line = await $.ui.mount(HINT)
    const text = (await line.find({ type: 'Text' }))?.text
    await line.unmount()

    return text
  }

  const game = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await game.resize(FIELD)
  await game.key({ key: ' ' })
  await game.advance(20_000)
  await game.unmount()
  expect(await drawn()).toMatch(/^\? for shortcuts +🦖 HI \d{5}$/)

  expect((await $.command.run(said('hi off'))).text).toContain('is off the line')
  expect(await drawn()).toBe('? for shortcuts')

  // With no word it goes the other way, as `/dino sound` does.
  expect((await $.command.run(said('hi'))).text).toContain('shows under')
  expect(await drawn()).toMatch(/HI \d{5}$/)
  expect((await $.command.run(said('hi maybe'))).text).toContain('Usage: /dino')
})

test('/dino stop closes the game that /dino play opened', async ($, on) => {
  mock.store(on)

  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })

  expect((await $.command.run({ ...STATS, args: 'play' })).text).toContain(
    'Dino is open',
  )
  expect(opened).toEqual(['dino'])
  expect(closed).toEqual([])

  expect((await $.command.run({ ...STATS, args: 'stop' })).text).toContain(
    'Dino is closed',
  )
  expect(closed).toEqual(['dino'])
})

test('a lost run asks for a name, and the name sends a run that plays again to its score', async ($, on) => {
  mock.store(on)

  const asked = board(on, {
    '/players': [200, { name: 'Rex', best: 0, rank: null }],
    '/runs': [200, { score: 29, best: 29, rank: 1, held: false }],
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  // A jump and a duck on open ground, so the run has moves to play again.
  await ui.advance(1000)
  await ui.key({ key: ' ' })
  await ui.advance(800)
  await ui.key({ key: 'down' })
  await ui.advance(20_000)
  expect(await ui.find(OFFER)).toBeDefined()
  // Nothing leaves the machine before the person gives a name.
  expect(asked).toEqual([])

  await ui.input({ key: 'keys', text: 'Rex' })
  expect(asked.map(({ path }) => path)).toEqual(['/players', '/runs'])
  expect(asked[0]?.body.name).toBe('Rex')

  const { seed, log } = asked[1]?.body ?? {}
  const shown = (await ui.find({ ...GAME, text: /HI \d{5}/ }))?.text ?? ''
  const best = Number(/HI (\d{5})/.exec(shown)?.[1])
  expect(best).toBeGreaterThan(0)
  expect(String(log)).toMatch(/^0c80 \d+j \d+d$/)
  expect(replayed(Number(seed), String(log))?.score).toBe(best)
  // A jump in mid-air is no move of the game: a log holding one is no run's.
  expect(replayed(Number(seed), String(log).replace('j', 'j 1j'))).toBeUndefined()

  expect(toasts.at(-1)).toContain('#1 on the global top')
  expect(await ui.find(OFFER)).toBeUndefined()
  // The lost run now says who ran it and where that put them.
  expect(
    await ui.find({ ...GAME, text: 'Rex · #1 on the global top' }),
  ).toBeDefined()
  await ui.unmount()
})

test('a run past the old best says by how much', async ($, on) => {
  mock.store(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // In a narrow field the first cactus comes in nearer, and ends the run sooner.
  await ui.resize({ columns: 30, rows: 16 })
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  // A first run beats nothing.
  expect(await ui.find({ ...GAME, text: 'G A M E   O V E R' })).toBeDefined()

  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  expect(await ui.find({ ...GAME, text: 'N E W   B E S T' })).toBeDefined()
  expect(
    await ui.find({ ...GAME, text: /\d+ past your old best of \d{5}/ }),
  ).toBeDefined()
  await ui.unmount()
})

test('t shows the global top over the field, fetched only when asked for', async ($, on) => {
  mock.store(on)

  const asked = board(on, {
    '/top': [
      200,
      {
        top: [
          { name: 'Rex', score: 1234 },
          { name: 'Ada', score: 99 },
        ],
        players: 2,
        you: null,
      },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(FIELD)
    const before = asked.length

    await ui.key({ key: 't' })
    expect(asked.length).toBe(before + 1)
    expect(asked.at(-1)?.path).toBe('/top')
    expect(
      await ui.find({ ...GAME, text: 'G L O B A L   T O P · 2 players' }),
    ).toBeDefined()
    expect(await ui.find({ ...GAME, text: ' 1  01234  Rex' })).toBeDefined()
    expect(await ui.find({ ...GAME, text: ' 2  00099  Ada' })).toBeDefined()

    // The same key typed into the field takes the board away again.
    await ui.input({ key: 'keys', text: 't', kind: 'change' })
    expect(await ui.find({ ...GAME, text: 'G L O B A L' })).toBeUndefined()
    expect(await ui.find({ ...GAME, text: 'PRESS SPACE TO PLAY' })).toBeDefined()
    await ui.unmount()
  }
})

test('enter alone where the name is asked for shows the global top', async ($, on) => {
  mock.store(on)

  const asked = board(on, {
    '/top': [200, { top: [{ name: 'Rex', score: 1234 }], players: 1, you: null }],
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  expect(await ui.find(OFFER)).toBeDefined()

  await ui.input({ key: 'keys', text: '' })
  expect(asked.map(({ path }) => path)).toEqual(['/top'])
  expect(await ui.find({ ...GAME, text: ' 1  01234  Rex' })).toBeDefined()
  await ui.unmount()
})

test('a space where the name is asked for runs again and sends nothing', async ($, on) => {
  mock.store(on)

  const asked = board(on, {})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  expect(await ui.find(OFFER)).toBeDefined()

  await ui.input({ key: 'keys', text: ' ', kind: 'change' })
  expect(await ui.find({ ...GAME, text: 'G A M E' })).toBeUndefined()
  expect(await ui.find(OFFER)).toBeUndefined()
  expect(asked).toEqual([])
  await ui.unmount()
})

test('/dino name off stops the game asking for a name', async ($, on) => {
  mock.store(on)

  const asked = board(on, {})
  expect((await $.command.run(said('name off'))).text).toContain(
    'will not ask for a name again',
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(FIELD)
  await ui.key({ key: ' ' })
  await ui.advance(20_000)
  expect(await ui.find({ ...GAME, text: 'G A M E   O V E R' })).toBeDefined()
  expect(await ui.find(OFFER)).toBeUndefined()
  expect(asked).toEqual([])
  await ui.unmount()
})

test('/dino top lists the board, /dino name joins it and /dino leave leaves it', async ($, on) => {
  mock.store(on)

  const asked = board(on, {
    '/top': [
      200,
      {
        top: [
          { name: 'Rex', score: 1234 },
          { name: 'Ada', score: 99 },
        ],
        players: 2,
        you: null,
      },
    ],
    '/players': [200, { name: 'Ada', best: 0, rank: null }],
    '/leave': [200, { left: 'Ada' }],
  })

  const top = (await $.command.run(said('top'))).text
  expect(top).toContain('Dino global top · 2 players')
  expect(top).toContain(' 1 · 01234 · Rex')
  expect(top).toContain(' 2 · 00099 · Ada')

  expect((await $.command.run(said('name'))).text).toContain(
    'not on the global top',
  )
  expect((await $.command.run(said('name Ada'))).text).toContain(
    'on the global top as Ada',
  )
  // The name goes up as typed, not lowered as the command's words are.
  expect(asked.at(-1)?.body.name).toBe('Ada')
  expect((await $.command.run(said('name'))).text).toContain('as Ada')

  expect((await $.command.run(said('leave'))).text).toContain(
    'off the global top',
  )
  expect(asked.at(-1)?.path).toBe('/leave')
  expect((await $.command.run(said('name'))).text).toContain(
    'not on the global top',
  )
})

test('a refusal or a silent leaderboard is told, and joins nothing', async ($, on) => {
  mock.store(on)

  board(on, { '/players': [409, { error: 'name-taken' }] })
  expect((await $.command.run(said('name Rex'))).text).toBe(
    'That name is taken. Try another.',
  )
  expect((await $.command.run(said('name'))).text).toContain(
    'not on the global top',
  )
  // No route answers for the board itself here: the server's 404 is no board.
  expect((await $.command.run(said('top'))).text).toContain('did not answer')
})
