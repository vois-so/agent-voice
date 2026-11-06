#!/usr/bin/env node
// agent-voice: your AI agent speaks at the end of a task, in a Vois Studio voice.
// MIT License. Source: the vois-so/agent-voice repository.
//
// The script has three modes:
//   hook <agent> <event>   Read the hook JSON on stdin and speak in the background.
//   <command> [args]       Change or show the settings (status, on, off, voice, ...).
//   __speak                Internal: the background worker that calls vois-cli.
//
// It needs Node.js 18 or later and Vois Studio. It has no dependencies.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
const SCRIPT = fileURLToPath(import.meta.url);

export const SONIC_VOICES = [
  "sonic_cedar", "sonic_harbor", "sonic_slate", "sonic_ridge", "sonic_ember",
  "sonic_coral", "sonic_meadow", "sonic_juniper", "sonic_sage", "sonic_willow",
];

export const LENGTHS = {
  short: { sentences: 1, words: 25 },
  medium: { sentences: 2, words: 50 },
  long: { sentences: 4, words: 100 },
};

export const DEFAULTS = Object.freeze({
  enabled: true,
  voice: "sonic_cedar",
  speed: 1.0,
  length: "short",
  language: "English",
  done: true,
  waiting: true,
});

const AGENT_NAMES = { claude: "Claude", codex: "Codex", cursor: "Cursor", gemini: "Gemini" };

// Plain-words help for each vois-cli exit code.
export const EXIT_HELP = {
  1: "Vois Studio did not answer. Open Vois Studio and try again.",
  2: "Vois Studio is not open. Open Vois Studio, or start the service with: vois-cli service start",
  3: "vois-cli did not accept the settings. Run: agent-voice status",
  7: "A Vois Studio license is necessary. Get a Free license at https://vois.so/download, then open Vois Studio.",
  9: "Vois Studio did not answer in time. Open Vois Studio and try again.",
  10: "The Sonic queue was full. The next message tries again.",
  11: "The computer did not have sufficient free memory for Sonic.",
  12: "The Sonic download failed. Open Vois Studio and download Sonic.",
  13: "Sonic is not available to download yet.",
  64: "vois-cli did not accept the voice or the language. Run: agent-voice status",
  130: "The speech was stopped.",
  ENOENT: "vois-cli was not found. Install Vois Studio from https://vois.so/download, or set VOIS_CLI to the full path of vois-cli.",
  TIMEOUT: "The speech took too long and was stopped.",
};

// ---------------------------------------------------------------- settings

/** Only the environment values that agent-voice reads. */
export function envVars() {
  const e = process.env;
  return {
    VOIS_CLI: e.VOIS_CLI,
    AGENT_VOICE_HOME: e.AGENT_VOICE_HOME,
    APPDATA: e.APPDATA,
    LOCALAPPDATA: e.LOCALAPPDATA,
    XDG_CONFIG_HOME: e.XDG_CONFIG_HOME,
  };
}

export function configDir(env = envVars(), platform = process.platform) {
  if (env.AGENT_VOICE_HOME) return env.AGENT_VOICE_HOME;
  if (platform === "win32") {
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "agent-voice");
  }
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-voice");
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function loadConfig(dir = configDir()) {
  const raw = readJson(join(dir, "config.json"), {});
  return {
    default: raw && typeof raw.default === "object" ? raw.default : {},
    projects: raw && typeof raw.projects === "object" ? raw.projects : {},
  };
}

export function saveConfig(config, dir = configDir()) {
  writeJsonAtomic(join(dir, "config.json"), config);
}

function normalizePath(p) {
  const abs = resolve(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/** The project key whose folder holds cwd, the longest match first. */
export function projectKey(config, cwd) {
  const here = normalizePath(cwd);
  let best = null;
  for (const key of Object.keys(config.projects)) {
    const k = normalizePath(key);
    if (here === k || here.startsWith(k.endsWith(sep) ? k : k + sep)) {
      if (!best || k.length > normalizePath(best).length) best = key;
    }
  }
  return best;
}

export function resolveSettings(config, cwd) {
  const key = projectKey(config, cwd);
  return { ...DEFAULTS, ...config.default, ...(key ? config.projects[key] : {}) };
}

// ---------------------------------------------------------------- text

function speakableCode(code) {
  const c = code.trim();
  if (/^[\w@-]+( [\w@.-]+){0,2}$/.test(c) && c.length <= 32 && !/[/\\]/.test(c) && !/\.\w+$/.test(c)) return c;
  if (/[\\/]/.test(c) && !/\s/.test(c)) return basename(c.replace(/:\d+(:\d+)?$/, ""));
  return "";
}

/** Turns Markdown from an agent into plain text that a voice can read. */
export function toSpeech(markdown) {
  let t = String(markdown ?? "").replace(/\r\n?/g, "\n");
  t = t.replace(/```[\s\S]*?(?:```|$)/g, "\n");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/`([^`\n]*)`/g, (_, c) => speakableCode(c));
  const lines = [];
  for (let line of t.split("\n")) {
    if (/^\s*\|/.test(line) || /^\s*([-*_]\s*){3,}$/.test(line)) continue;
    line = line
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/(\*\*|__)(\S[\s\S]*?\S|\S)\1/g, "$2")
      .replace(/(^|[^\w*])[*_](\S[^*_]*?\S|\S)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/(?:^|\s)(?:[\w.-]+[\\/])+[\w.-]+(?::\d+)*(?=[\s,.;:!?)]|$)/g, (m) => {
        const lead = m.match(/^\s*/)[0];
        return lead + basename(m.trim().replace(/:\d+(:\d+)?$/, ""));
      })
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (!/[.!?:;]$/.test(line)) line += ".";
    lines.push(line.replace(/:$/, "."));
  }
  return lines.join(" ").replace(/\s+([,.;!?])/g, "$1").replace(/\.{2,}/g, ".").trim();
}

/** The first sentences of the text, as the length setting allows. */
export function summarize(text, length = "short") {
  const limit = LENGTHS[length] || LENGTHS.short;
  const plain = toSpeech(text);
  if (!plain) return "";
  const sentences = plain.split(/(?<=[.!?])\s+/);
  const out = [];
  let words = 0;
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const w = s.split(/\s+/);
    if (words + w.length > limit.words) {
      if (out.length === 0) out.push(`${w.slice(0, limit.words).join(" ").replace(/[,;:]$/, "")}.`);
      break;
    }
    out.push(s);
    words += w.length;
    if (out.length >= limit.sentences) break;
  }
  return out.join(" ");
}

function projectName(input) {
  const dir = input?.cwd || input?.workspace_roots?.[0] || process.cwd();
  return basename(String(dir)) || "your project";
}

/**
 * Maps one hook event to { kind, text }. kind is "done" or "waiting".
 * Returns null for an event that has nothing to say.
 */
export function eventToSpeech(agent, event, input, length = "short") {
  const name = AGENT_NAMES[agent] || "The agent";
  const where = projectName(input);
  const waiting = (what) => ({ kind: "waiting", text: `${name} ${what} in ${where}.` });
  const done = (reply) => {
    const text = summarize(reply, length);
    return { kind: "done", text: text || `${name} completed the task in ${where}.` };
  };
  switch (`${agent}:${event}`) {
    case "claude:stop":
    case "codex:stop":
      return done(input?.last_assistant_message);
    case "cursor:response":
      return done(input?.text);
    case "gemini:after-agent":
      return done(input?.prompt_response);
    case "claude:notify": {
      const type = input?.notification_type;
      if (type === "permission_prompt") return waiting("needs your approval");
      if (type === "idle_prompt" || type === "agent_needs_input") return waiting("waits for your answer");
      if (type === "elicitation_dialog" || type === "elicitation_url_dialog") return waiting("has a question for you");
      return null;
    }
    case "codex:permission":
      return waiting("needs your approval");
    case "gemini:notify":
      return input?.notification_type === "ToolPermission" ? waiting("needs your approval") : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- vois-cli

export function cliCandidates(env = envVars(), platform = process.platform) {
  const list = [];
  if (env.VOIS_CLI) list.push(env.VOIS_CLI);
  if (platform === "darwin") {
    list.push("/Applications/Vois.app/Contents/MacOS/vois-cli");
    list.push(join(homedir(), "Applications", "Vois.app", "Contents", "MacOS", "vois-cli"));
  } else if (platform === "win32") {
    const local = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    list.push(join(local, "Vois", "vois-cli.exe"));
  }
  return list;
}

export function findCli(env = envVars(), platform = process.platform) {
  for (const c of cliCandidates(env, platform)) if (c && existsSync(c)) return c;
  return null;
}

export function speakArgs(settings) {
  const args = ["speak", "--follow", "--play", "--voice", settings.voice];
  const speed = Number(settings.speed);
  if (Number.isFinite(speed) && speed !== 1) args.push("--speed", String(speed));
  if (settings.language && settings.language !== "auto") args.push("--language", settings.language);
  return args;
}

/** Runs vois-cli speak and waits. Resolves to { code, message }. */
export function runSpeak(text, settings, { timeoutMs = 120000 } = {}) {
  return new Promise((done) => {
    const cli = findCli();
    if (!cli) return done({ code: "ENOENT", message: EXIT_HELP.ENOENT });
    let stderr = "";
    let settled = false;
    const finish = (code, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const help = EXIT_HELP[code];
      done({ code, message: help || extra || stderr.trim().slice(-400) || `vois-cli stopped with code ${code}.` });
    };
    const child = spawn(cli, speakArgs(settings), {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      finish("TIMEOUT");
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on("error", (err) => finish(err.code === "ENOENT" ? "ENOENT" : 1, err.message));
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(`${text}\n`);
  });
}

function recordResult(result, meta, dir = configDir()) {
  try {
    writeJsonAtomic(join(dir, "last.json"), { at: new Date().toISOString(), ...meta, ...result });
  } catch {
    // The result is only a help for "status". Never fail the speech for it.
  }
}

/** Starts the background worker, so that the hook returns at once. */
function speakInBackground(payload) {
  const child = spawn(process.execPath, [SCRIPT, "__speak"], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(payload));
  child.unref();
}

// ---------------------------------------------------------------- modes

function readStdin(timeoutMs = 3000) {
  return new Promise((done) => {
    if (process.stdin.isTTY) return done("");
    let data = "";
    const timer = setTimeout(() => done(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      done(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      done(data);
    });
  });
}

async function hookMode(agent, event) {
  const raw = await readStdin();
  process.stdin.destroy();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return;
  }
  const cwd = input.cwd || input.workspace_roots?.[0] || process.cwd();
  const settings = resolveSettings(loadConfig(), cwd);
  if (!settings.enabled) return;
  const speech = eventToSpeech(agent, event, input, settings.length);
  if (!speech || !speech.text || settings[speech.kind] === false) return;
  speakInBackground({ text: speech.text, settings, meta: { agent, event, kind: speech.kind } });
}

async function workerMode() {
  const raw = await readStdin(10000);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const result = await runSpeak(payload.text, payload.settings);
  recordResult(result, payload.meta);
}

// ---------------------------------------------------------------- commands

const USAGE = `agent-voice ${VERSION}: your AI agent speaks at the end of a task, in a Vois Studio voice.

Usage: agent-voice <command> [--global]

  status                  Show the settings for this folder and the last result.
  on | off                Turn agent-voice on or off.
  voice <name>            Select a voice. Run "voices" for the list.
  length short|medium|long
                          How much of the reply to speak (1, 2 or 4 sentences).
  speed <0.5-2.0>         The speaking rate.
  language <name|auto>    The language of the speech, for example English or German.
  done on|off             Speak at the end of a task.
  waiting on|off          Speak when the agent waits for your answer.
  voices                  List the voices.
  test [text]             Speak a test sentence now and show the result.
  setup codex|cursor|gemini
                          Show the hook settings for a different agent.
  reset                   Remove the settings for this folder.

A change applies to the current folder and the folders in it.
Add --global to change the default for all folders.`;

function setupSnippet(agent) {
  const cmd = (a, e) => `node "${SCRIPT}" hook ${a} ${e}`;
  if (agent === "codex") {
    return {
      file: "~/.codex/hooks.json (or .codex/hooks.json in a project)",
      note: "Then approve the hooks with /hooks in Codex.",
      json: {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: cmd("codex", "stop"), timeout: 10 }] }],
          PermissionRequest: [{ hooks: [{ type: "command", command: cmd("codex", "permission"), timeout: 10 }] }],
        },
      },
    };
  }
  if (agent === "cursor") {
    return {
      file: "~/.cursor/hooks.json (or .cursor/hooks.json in a project)",
      note: "Cursor has no hook for a request for approval, so agent-voice speaks only at the end of a reply.",
      json: { version: 1, hooks: { afterAgentResponse: [{ command: cmd("cursor", "response"), timeout: 10 }] } },
    };
  }
  if (agent === "gemini") {
    return {
      file: "~/.gemini/settings.json (or .gemini/settings.json in a project)",
      note: "Merge the \"hooks\" object into your settings file.",
      json: {
        hooks: {
          AfterAgent: [{ hooks: [{ type: "command", command: cmd("gemini", "after-agent"), timeout: 10000 }] }],
          Notification: [{ hooks: [{ type: "command", command: cmd("gemini", "notify"), timeout: 10000 }] }],
        },
      },
    };
  }
  return null;
}

function explain(code) {
  return EXIT_HELP[code] || "";
}

export async function commandMode(argv, { cwd = process.cwd(), dir = configDir(), log = console.log } = {}) {
  const global = argv.includes("--global");
  const args = argv.filter((a) => a !== "--global");
  const [cmd, ...rest] = args;
  const config = loadConfig(dir);
  const target = () => {
    if (global) return config.default;
    const key = projectKey(config, cwd) || resolve(cwd);
    config.projects[key] = config.projects[key] || {};
    return config.projects[key];
  };
  const scope = global ? "all folders" : basename(resolve(cwd));
  const set = (field, value, words) => {
    target()[field] = value;
    saveConfig(config, dir);
    log(`agent-voice: ${words} for ${scope}.`);
    return 0;
  };
  const onOff = (v) => (v === "on" ? true : v === "off" ? false : null);

  switch (cmd) {
    case undefined:
    case "status": {
      const s = resolveSettings(config, cwd);
      const cli = findCli();
      const last = readJson(join(dir, "last.json"), null);
      log(`agent-voice ${VERSION}`);
      log(`  Folder:   ${resolve(cwd)}`);
      log(`  State:    ${s.enabled ? "on" : "off"} (end of task: ${s.done ? "on" : "off"}, waiting: ${s.waiting ? "on" : "off"})`);
      log(`  Voice:    ${s.voice}, speed ${s.speed}, length ${s.length}, language ${s.language}`);
      log(`  vois-cli: ${cli || "not found. " + EXIT_HELP.ENOENT}`);
      if (last) {
        const ok = last.code === 0;
        log(`  Last:     ${last.at} ${last.agent || ""} ${ok ? "spoke" : `failed (${last.code}): ${last.message}`}`.trimEnd());
      }
      return 0;
    }
    case "on":
    case "off":
      return set("enabled", cmd === "on", `turned ${cmd}`);
    case "done":
    case "waiting": {
      const v = onOff(rest[0]);
      if (v === null) return usageError(`Use: agent-voice ${cmd} on|off`, log);
      return set(cmd, v, `${cmd === "done" ? "end of task" : "waiting"} speech turned ${rest[0]}`);
    }
    case "voice": {
      const v = (rest[0] || "").trim();
      if (!/^sonic_[a-z]+$/.test(v)) {
        return usageError(`Select a Sonic voice: ${SONIC_VOICES.join(", ")}`, log);
      }
      return set("voice", v, `voice set to ${v}`);
    }
    case "length": {
      const v = rest[0];
      if (!LENGTHS[v]) return usageError("Use: agent-voice length short|medium|long", log);
      return set("length", v, `length set to ${v}`);
    }
    case "speed": {
      const v = Number(rest[0]);
      if (!Number.isFinite(v) || v < 0.5 || v > 2) return usageError("Use a speed from 0.5 to 2.0.", log);
      return set("speed", v, `speed set to ${v}`);
    }
    case "language": {
      const v = (rest.join(" ") || "").trim();
      if (!v) return usageError("Use: agent-voice language <name|auto>, for example English.", log);
      return set("language", v, `language set to ${v}`);
    }
    case "voices":
      log(SONIC_VOICES.join("\n"));
      log("\nThe Sonic voices are on all plans of Vois Studio, also on the Free plan.");
      return 0;
    case "reset": {
      if (global) config.default = {};
      else {
        const key = projectKey(config, cwd);
        if (key) delete config.projects[key];
      }
      saveConfig(config, dir);
      log(`agent-voice: settings removed for ${scope}.`);
      return 0;
    }
    case "test": {
      const s = resolveSettings(config, cwd);
      const text = rest.join(" ").trim() || "This is agent-voice. Your agent speaks with this voice.";
      const result = await runSpeak(text, s);
      recordResult(result, { agent: "test", event: "test", kind: "test" }, dir);
      if (result.code === 0) {
        log(`agent-voice: spoke with ${s.voice}.`);
        return 0;
      }
      log(`agent-voice: the test failed (${result.code}). ${result.message || explain(result.code)}`);
      return 1;
    }
    case "setup": {
      const snip = setupSnippet(rest[0]);
      if (!snip) return usageError("Use: agent-voice setup codex|cursor|gemini", log);
      log(`Add this to ${snip.file}:\n`);
      log(JSON.stringify(snip.json, null, 2));
      log(`\n${snip.note}`);
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
      log(USAGE);
      return 0;
    case "--version":
    case "-v":
      log(VERSION);
      return 0;
    default:
      return usageError(`Unknown command: ${cmd}\n\n${USAGE}`, log);
  }
}

function usageError(message, log) {
  log(`agent-voice: ${message}`);
  return 2;
}

// ---------------------------------------------------------------- main

async function main(argv) {
  if (argv[0] === "hook") {
    try {
      await hookMode(argv[1], argv[2]);
    } catch {
      // A hook must never break the agent.
    }
    return 0;
  }
  if (argv[0] === "__speak") {
    await workerMode();
    return 0;
  }
  return commandMode(argv);
}

let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(SCRIPT);
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
