import { expect, mock, test } from 'claude-code/testing'

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
