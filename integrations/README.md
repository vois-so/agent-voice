# Integrations

Each folder has an example hook file. The commands use `$HOME/.agent-voice`, the folder of step 1 in the README. On Windows, `node scripts/agent-voice.mjs setup <agent>` gives the settings with the full path for your computer. Use these settings.

| Agent | Settings file | Hooks |
| --- | --- | --- |
| Codex | `~/.codex/hooks.json` | `Stop` and `PermissionRequest`. Give approval to the hooks with `/hooks` in Codex. |
| Cursor | `~/.cursor/hooks.json` | `afterAgentResponse`. The Cursor CLI does not use this hook at this time. |
| Gemini CLI | `~/.gemini/settings.json` | `AfterAgent` and `Notification`. Put the `hooks` object into your settings file. |

If the file has hooks, add the agent-voice entries to the lists. Do not replace the file.
