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
| `space`, `w`, `k`, `↑` | Jump, start a run, or run again after a game over |
| `s`, `j`, `↓` | Duck, or drop faster while in the air |
| `esc` | Give the keys back to the prompt |
| `ctrl+x` `tab` | Give the keys back to the game |

Birds show up from 150 points, the run speeds up as it goes, and night falls every 700 points. Your best score is kept between sessions.

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287. Mods sit behind a rollout switch, so if `/dino` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app. Other surfaces show a notice instead of the game.
- A pane at least 30 columns wide and 8 rows tall.

## What it does on your machine

The mod registers one slash command, `/dino`, and draws one pane. It makes no network requests, reads no files, runs no processes, and never touches your prompts or tool calls. The only thing it saves is your best score, in the plugin's own Claude Code store.

Its four hooks, all in `hooks/register.tsx`:

- `session.start` registers the `/dino` command and passes the event on unchanged.
- `command.run` answers only the `/dino` command, by opening the pane. Other commands never reach it.
- `ui.render` draws only the mod's own pane.
- `ui.message` acts only on the score the mod's own game posts, keeping the highest. Any other message is passed on untouched.

The files under `tests/` run only under `claude plugin test`. They mount the pane in the test harness and are never loaded in a session.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-dino
claude plugin validate claude-dino
claude plugin test claude-dino
claude --plugin-dir claude-dino
```

The mod is two files: `hooks/register.tsx` registers the `/dino` command and draws the pane, `hooks/dino.tsx` is the game itself.

## License

MIT
