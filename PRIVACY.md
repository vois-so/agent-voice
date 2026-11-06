# Privacy

agent-voice operates only on your computer. It does not send data to a server.

## What agent-voice reads

- The last reply of your agent, when the agent stops.
- The type of notification, when the agent waits for you.
- Its settings file.

## What agent-voice does with the reply

agent-voice keeps the first sentences of the reply. It gives these sentences to vois-cli on your computer, and Vois Studio speaks them. Vois Studio does not save the audio.

## What agent-voice writes

- `config.json`: your settings.
- `last.json`: the result of the last audio. This file has the time, the agent, the hook name, the result code and a short error message. It does not have the text of the reply.

The two files are in `~/.config/agent-voice/`. On Windows, they are in `%APPDATA%\agent-voice\`. To remove all data of agent-voice, delete this folder.

## Vois Studio

Vois Studio has its own [privacy policy](https://vois.so/legal/privacy).
