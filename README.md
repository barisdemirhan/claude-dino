# claude-dino

A T-Rex runner you can play in a pane inside [Claude Code](https://claude.com/claude-code), inspired by Chrome's offline game.

Type `/dino`, press space, and jump the cacti while Claude works.

## Install

```sh
claude plugin marketplace add barisdemirhan/claude-dino
claude plugin install dino@claude-dino
```

Restart Claude Code, then run `/dino`.

The same two steps work from inside a session with `/plugin marketplace add barisdemirhan/claude-dino` and `/plugin install dino@claude-dino`.

## Play

| Key | Action |
| --- | --- |
| `space`, `w`, `k`, `↑` | Jump, start a run, run again after a game over, or run on after a pause |
| `s`, `j`, `↓` | Duck, or drop faster while in the air |
| `p` | Pause, and run on again |
| `esc` | Give the keys back to the prompt |
| `ctrl+x` `tab` | Give the keys back to the game |

Birds show up from 150 points, the run speeds up as it goes, and night falls every 700 points. Every 100 points the score blinks. Your best score is kept between sessions and shows at the right of the prompt footer.

| Command | What it does |
| --- | --- |
| `/dino` or `/dino play` | Opens the game |
| `/dino stop` | Closes the game |
| `/dino mini` | Turns the mini dino on: a small one that plays itself above the prompt while Claude works, hopping the cacti and ducking the birds under the clouds. `/dino mini off` turns it off |
| `/dino sound` | Turns the sounds off or on. `/dino sound on` and `/dino sound off` say which |
| `/dino stats` | Your runs so far, your best and your average |

## It plays along with Claude

- **It pauses when Claude needs you.** When Claude finishes its turn or asks for a permission in the middle of a run, the run is held and a toast says why. Space runs it on.
- **Claude's work is the obstacle course.** While a run is on, every tool call Claude makes sends a crate your way, with the tool's name in the corner, and every call that fails sends a low bird. They never come closer together than the game's own obstacles do.

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287. Mods sit behind a rollout switch, so if `/dino` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app. Other surfaces show a notice instead of the game.
- A pane at least 30 columns wide and 8 rows tall.
- Sound needs macOS, where Claude Code has a player for it. Elsewhere the game is silent.

## What it does on your machine

The mod registers one slash command, draws one pane and, if you turn it on, one band above the prompt. It makes no network requests, reads no files and runs no processes. It never changes a prompt, a tool call or a tool's result.

While a run is on, it reads two things of each tool call Claude makes: the tool's name, to show it in the game, and whether the call failed. It reads nothing of the call's arguments or output, and keeps neither fact past the session.

It saves three things in the plugin's own Claude Code store: your best score, how many runs and points you have in all, and your two settings (sound and mini).

It plays three short sounds from its own `sounds/` folder, through Claude Code's player.

Its hooks, all in `hooks/register.tsx`:

- `session.start` registers the `/dino` command and loads your settings and best score, then passes the event on unchanged.
- `command.run` answers only the `/dino` command. Other commands never reach it.
- `ui.render` draws only the mod's own pane, and the mini band while it is on and Claude is working. It also adds your best score to the mode labels of the prompt footer, leaving the labels already there as they are.
- `ui.message` acts only on what the mod's own game posts: it counts finished runs, keeps the best score and plays the sounds. Any other message is passed on untouched.
- `ui.close` notes that the mod's own pane closed, and passes every close on.
- `tool.call` counts Claude's calls while a run is on, as described above, and passes each call and its result on untouched.
- `turn.complete` and `classic.Notification` pause a run that is on and show the toast: the first when Claude's turn ends, the second when Claude Code notifies you that it waits on a permission or a question. Both pass the event on unchanged and decide nothing.

The files under `tests/` run only under `claude plugin test`. They mount the pane in the test harness and are never loaded in a session.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-dino
claude plugin validate claude-dino
claude plugin test claude-dino
claude --plugin-dir claude-dino
```

The mod is three files: `hooks/register.tsx` holds the hooks, `hooks/dino.tsx` is the game itself and `hooks/mini.tsx` is the mini dino.

## License

MIT
