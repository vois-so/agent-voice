# agent-voice

Give your AI agent a voice. When Claude Code completes a task, it speaks a short summary. When it waits for your approval or your answer, it tells you. The voice comes from Vois Studio, on your computer.

agent-voice uses `vois speak` from Vois Studio. This command operates on all plans, also on the Free plan. The audio stays on your computer, and Vois Studio does not save it.

Vois Studio is closed source. agent-voice is open source with the MIT license.

## What it does

| Agent | At the end of a task | When the agent waits for you |
| --- | --- | --- |
| Claude Code (terminal, desktop app and IDE extensions) | Yes | Yes |
| Codex | Yes | Yes |
| Gemini CLI | Yes | Yes |
| Cursor (editor) | Yes | No hook for this |

- agent-voice speaks the first sentence of the reply. You can select 1, 2 or 4 sentences.
- It removes code, tables, links and long file paths before it speaks.
- You can select a different voice for each project, and turn it off in one project.
- The hook stops in less than one second. The audio plays in the background, and the agent does not wait for it.

## Before you start

- [Vois Studio](https://vois.so/download?utm_source=github&utm_medium=agent-voice&utm_campaign=oss) on an Apple Silicon Mac or on Windows, with a license. The Free license is sufficient.
- Vois Studio must be open, or its service must be on (`vois-cli service start`).
- [Node.js](https://nodejs.org) 18 or a newer version.

## Install for Claude Code

In Claude Code, type:

```text
/plugin marketplace add vois-so/agent-voice
/plugin install agent-voice@agent-voice
```

Then type `/agent-voice:voice test`. You hear a test sentence.

## Change the settings

Type `/agent-voice:voice` and a command in Claude Code. A change applies to the current project folder. Add `--global` to change the default for all folders.

| Command | What it does |
| --- | --- |
| `/agent-voice:voice status` | Shows the settings and the result of the last audio. |
| `/agent-voice:voice off` | Stops the audio for this project. `on` starts it again. |
| `/agent-voice:voice voices` | Shows the voices. |
| `/agent-voice:voice voice sonic_ember` | Selects a voice for this project. |
| `/agent-voice:voice length medium` | Speaks 2 sentences. `short` is 1 sentence and `long` is 4 sentences. |
| `/agent-voice:voice speed 1.2` | Changes the speed of the voice, from 0.5 to 2.0. |
| `/agent-voice:voice language German` | Changes the language of the voice. `auto` finds the language. |
| `/agent-voice:voice waiting off` | Stops the audio when Claude waits for you. `done off` stops the audio at the end of a task. |
| `/agent-voice:voice test` | Speaks a test sentence and shows the result. |

The settings are in `~/.config/agent-voice/config.json`. On Windows, they are in `%APPDATA%\agent-voice\config.json`.

## Install for Codex, Cursor or Gemini CLI

1. Get agent-voice:

   ```sh
   git clone https://github.com/vois-so/agent-voice ~/.agent-voice
   ```

2. Show the hook settings for your agent. Use `codex`, `cursor` or `gemini`:

   ```sh
   node ~/.agent-voice/scripts/agent-voice.mjs setup codex
   ```

3. Copy the output into the file that the command names. In Codex, give approval to the new hooks with `/hooks`.

To change the settings, use the same commands as in Claude Code, for example `node ~/.agent-voice/scripts/agent-voice.mjs voice sonic_sage`. The [integrations](integrations/) folder has examples for each agent.

## If you hear nothing

Type `/agent-voice:voice status` in Claude Code, or use `node scripts/agent-voice.mjs status`. The last line tells you the cause:

| Message | What to do |
| --- | --- |
| "vois-cli was not found" | Install Vois Studio. If it is in a different folder, set `VOIS_CLI` to the full path of `vois-cli`. |
| "Vois Studio is not open" | Open Vois Studio, or start the service with `vois-cli service start`. |
| "A Vois Studio license is necessary" | Get a Free license at [vois.so/download](https://vois.so/download?utm_source=github&utm_medium=agent-voice&utm_campaign=oss), then open Vois Studio. |
| "vois-cli did not accept the voice or the language" | Select a voice from `voices`, and a language that Sonic speaks, or `auto`. |

## How it operates

1. The agent starts the hook at the end of a reply, or when it waits for you.
2. The hook reads the reply, and keeps the first sentences.
3. A background process gives the text to `vois speak --follow --play`. Vois Studio speaks it with a Sonic voice.

The text goes only to Vois Studio on your computer. agent-voice does not send data to a server. It writes only two files: its settings and the result of the last audio.

## Problems and ideas

Open an [issue](https://github.com/vois-so/agent-voice/issues). For a problem in Vois Studio, use [vois-so/vois-studio](https://github.com/vois-so/vois-studio/issues).

## License

MIT. See [LICENSE](LICENSE).
