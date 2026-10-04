# Privacy

What the Dino mod for Claude Code does with data. Last changed on 4 October 2026.

## If you never use the global top

Nothing leaves your machine. The game keeps your best score, how many runs and points you have in all, and your settings (sound, mini, whether your best score shows under the prompt and whether `/dino close` put it all away) in the plugin's own Claude Code store, on your disk.

While a run is on, the mod reads the name of each tool Claude calls and whether the call failed, to send obstacles your way. It reads nothing of a call's arguments or output, and keeps neither fact past the session.

## If you use the global top

The global top is a leaderboard everybody who joins shares. It is off until you join, and it is the only thing in the mod that makes a network request. The requests go to one server, `claude-dino-board.barisdemirhan.workers.dev`, a Cloudflare Worker over a Cloudflare D1 database that Barış Demirhan runs.

What is sent:

- **Looking at the board** (`/dino top`, or `t` in the game) asks for the top ten. If you have joined, it sends your id along to learn where you stand.
- **Joining** sends the name you chose, a random id and a random secret, both made on your machine. Pick a name you are fine with others seeing.
- **A run that beats your best there** sends its seed and its moves: when you jumped and ducked, how wide the pane was, and how many crates and birds Claude's work queued and when. The tools' names are not in it, nor anything else of your session.

What the server keeps:

- Your name, your id and a SHA-256 hash of the secret. The secret itself stays on your machine.
- Your runs: score, length, seed and moves, with the time each came in. They are kept so the server can play a run again, and so a run that looks wrong can be looked over and removed.
- To slow a flood, a salted hash of the address a write came from. A later write clears these out once they are an hour old. The address itself is not stored. Cloudflare's edge also counts requests by address over a minute, to turn a flood away before it reaches the database.

What others see: your name, your best score and your place on the board.

The server runs on Cloudflare, which handles every request to it as the host. Nothing is sold, shared with anybody else or used for advertising, and the server runs no analytics.

## Taking your data off

`/dino leave` deletes your name and every run of yours from the server, at once. Your id and secret then go from the plugin's store as well.

If you cannot run the command, [open an issue](https://github.com/barisdemirhan/claude-dino/issues) with the name on the board and it will be removed.

## Changes

This file's history in the repository is the record of what changed and when.
