/**
 * How many jumps and ducks the person has keyed so far, and how many keys in
 * all: the game acts on a count that moved, the field is cleared on `typed`.
 */
export type DinoInput = { jumps: number; ducks: number; typed: number }

declare module 'claude-code' {
  interface PluginState {
    dino: { input: DinoInput }
  }
}
