---
description: Change or show the agent-voice settings (voice, length, on or off) for this folder
argument-hint: "[status | on | off | voice <name> | length short|medium|long | speed <0.5-2.0> | language <name> | voices | test] [--global]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/agent-voice.mjs *)
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/agent-voice.mjs $ARGUMENTS`

Show the output above to the user, without changes. Do not run other commands.
