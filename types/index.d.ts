/**
 * How many jumps, ducks and pauses the person has keyed so far, and how many
 * keys in all: the game acts on a count that moved, the field is cleared on
 * `typed`.
 */
export type DinoInput = {
  jumps: number
  ducks: number
  pauses: number
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

/** What the person switched with `/dino mini` and `/dino sound`. */
export type DinoSettings = { isMini: boolean; isMuted: boolean }

declare module 'claude-code' {
  interface PluginState {
    dino: {
      input: DinoInput
      feed: DinoFeed
      alert: DinoAlert
      settings: DinoSettings
      /** The best score so far, as the prompt footer shows it. */
      best: number
    }
  }
}
