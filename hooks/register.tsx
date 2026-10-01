import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DinoInput } from '../types'

const PANE = 'dino'
const GAME = 'game'
const KEYS = 'keys'
const HI = 'hi'
const ROWS = 16
const JUMP_KEYS = [' ', 'w', 'k']
const DUCK_KEYS = ['s', 'j']

const input = atom({ plugin: 'dino', key: 'input' } as const, {
  jumps: 0,
  ducks: 0,
  typed: 0,
})

const toScore = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

const keyed = (now: DinoInput, key: string): DinoInput => ({
  jumps: now.jumps + (JUMP_KEYS.includes(key) ? 1 : 0),
  ducks: now.ducks + (DUCK_KEYS.includes(key) ? 1 : 0),
  typed: now.typed + 1,
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dino',
      description: 'Play the Chrome offline T-Rex runner in a pane',
    })

    return next(e)
  })

  on('command.run', { command: 'dino' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Dino', focus: true, rows: ROWS + 2 })

    return { text: 'Dino is open: space to jump, s to duck.' }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== GAME) {
      return next(e)
    }

    const posted =
      typeof e.data === 'object' && e.data !== null && 'score' in e.data
        ? toScore(e.data.score)
        : 0
    const hi = Math.max(posted, toScore(await $.store.get(HI)))
    await $.store.set(HI, hi)

    return { props: { hi, ...(await read($, input)) } }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Dino runs in the terminal and the desktop app.</Text>
    }

    const { Box, Client, Input, Text } = $.ui.resolve(e)
    const hi = toScore(await $.store.get(HI))
    const { jumps, ducks, typed } = await read($, input)

    return (
      <Box flexDirection="column">
        <Client
          key={GAME}
          module="./dino.tsx"
          props={{ hi, jumps, ducks }}
          width="100%"
          height={ROWS}
        />
        {/* The field is the keyboard: every key typed into it is one move, and
            drawing a value other than the last one empties it again. */}
        <Input
          key={KEYS}
          label="keys"
          placeholder="space jump · s duck"
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
            ? 'space/w jump · s duck · esc gives the keys back to the prompt'
            : 'ctrl+x tab gives the game the keys · then space/w jump · s duck'}
        </Text>
      </Box>
    )
  })
}
