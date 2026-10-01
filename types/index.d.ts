/**
 * How many jumps, ducks, pauses and looks at the global top the person has
 * keyed so far, and how many keys in all: the game acts on a count that
 * moved, the field is cleared on `typed`.
 */
export type DinoInput = {
  jumps: number
  ducks: number
  pauses: number
  tops: number
  typed: number
}

/**
 * What Claude's work feeds the run: how many tool calls started and how many
 * failed while a run was on, and the name of the latest one.
 */
export type DinoFeed = { tools: number; fails: number; tool: string }

/**
 * How many times Claude has asked for the person while a run was on, and why
 * the last time: its turn is done, or it waits on a permission.
 */
export type DinoAlert = { count: number; reason: 'done' | 'ask' }

/** What the person switched with `/dino mini`, `/dino sound` and `/dino hi`. */
export type DinoSettings = {
  isMini: boolean
  isMuted: boolean
  isHiHidden: boolean
}

/**
 * The best run the game offers to put on the global top, once its player
 * gives a name: 0 while it asks for none.
 */
export type DinoOffer = { score: number }

/**
 * The global top as the game last fetched it: its first rows, how many
 * players it holds, and whether it is being asked for or did not answer.
 */
export type DinoBoard = {
  state: 'idle' | 'asking' | 'ready' | 'silent'
  top: { name: string; score: number }[]
  players: number
}

/** The person's name and rank on the global top: no name until they join. */
export type DinoStanding = { name: string; rank: number }

declare module 'claude-code' {
  interface PluginState {
    dino: {
      input: DinoInput
      feed: DinoFeed
      alert: DinoAlert
      settings: DinoSettings
      /** The best score so far, as the prompt footer shows it. */
      best: number
      /** The best run a name is asked for, 0 while none is. */
      offer: DinoOffer
      /** The global top, as the game shows it. */
      board: DinoBoard
      /** Who the person is on the global top. */
      standing: DinoStanding
    }
  }
}
