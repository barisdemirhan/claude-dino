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
