# claude-dino

Chrome's offline T-Rex runner, playable in a pane inside [Claude Code](https://claude.com/claude-code).

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

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287.
- The terminal or the desktop app. Other surfaces show a notice instead of the game.
- A pane at least 30 columns wide and 8 rows tall.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-dino
claude plugin validate claude-dino/plugins/dino
claude plugin test claude-dino/plugins/dino
claude --plugin-dir claude-dino/plugins/dino
```

The mod is two files: `hooks/register.tsx` registers the `/dino` command and draws the pane, `hooks/dino.tsx` is the game itself.

## License

MIT
