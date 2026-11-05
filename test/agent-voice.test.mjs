import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULTS,
  commandMode,
  eventToSpeech,
  loadConfig,
  projectKey,
  resolveSettings,
  speakArgs,
  summarize,
  toSpeech,
} from "../scripts/agent-voice.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/agent-voice.mjs", import.meta.url));

test("toSpeech removes code, links, tables and paths", () => {
  const md = [
    "## Done",
    "I fixed the **login** bug in `src/auth/session.ts:42` and added a test.",
    "```ts",
    "const x = 1;",
    "```",
    "| a | b |",
    "|---|---|",
    "- See [the docs](https://example.com/docs) for details",
    "Run `npm test` to check.",
  ].join("\n");
  const out = toSpeech(md);
  assert.equal(
    out,
    "Done. I fixed the login bug in session.ts and added a test. See the docs for details. Run npm test to check.",
  );
});

test("summarize keeps the first sentence for short", () => {
  const reply = "I updated the parser to accept dates. Then I ran the tests. All 42 tests pass.";
  assert.equal(summarize(reply, "short"), "I updated the parser to accept dates.");
  assert.equal(summarize(reply, "medium"), "I updated the parser to accept dates. Then I ran the tests.");
  assert.equal(summarize(reply, "long"), reply);
});

test("summarize does not split a version number", () => {
  assert.equal(summarize("Released v2.6.2 today. Next is docs.", "short"), "Released v2.6.2 today.");
});

test("summarize cuts a very long first sentence at the word limit", () => {
  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  const out = summarize(`${words}.`, "short");
  assert.equal(out.split(" ").length, 25);
  assert.ok(out.endsWith("."));
});

test("eventToSpeech handles each agent", () => {
  const cwd = "/home/me/projects/shop";
  assert.deepEqual(eventToSpeech("claude", "stop", { cwd, last_assistant_message: "Fixed it. More text." }), {
    kind: "done",
    text: "Fixed it.",
  });
  assert.deepEqual(eventToSpeech("claude", "notify", { cwd, notification_type: "permission_prompt" }), {
    kind: "waiting",
    text: "Claude needs your approval in shop.",
  });
  assert.equal(eventToSpeech("claude", "notify", { cwd, notification_type: "auth_success" }), null);
  assert.equal(eventToSpeech("codex", "stop", { cwd, last_assistant_message: "Tests pass." }).text, "Tests pass.");
  assert.equal(eventToSpeech("codex", "permission", { cwd }).text, "Codex needs your approval in shop.");
  assert.equal(
    eventToSpeech("cursor", "response", { workspace_roots: [cwd], text: "Refactor complete." }).text,
    "Refactor complete.",
  );
  assert.equal(eventToSpeech("gemini", "after-agent", { cwd, prompt_response: "Done." }).text, "Done.");
  assert.equal(
    eventToSpeech("gemini", "notify", { cwd, notification_type: "ToolPermission" }).text,
    "Gemini needs your approval in shop.",
  );
});

test("an empty reply still gives a short message", () => {
  assert.equal(eventToSpeech("claude", "stop", { cwd: "/x/app", last_assistant_message: "```\ncode\n```" }).text,
    "Claude completed the task in app.");
});

test("project settings apply to subfolders and override the default", () => {
  const config = {
    default: { voice: "sonic_ember" },
    projects: { "/work/a": { voice: "sonic_sage" }, "/work/a/b": { length: "long" } },
  };
  assert.equal(projectKey(config, "/work/a/b/c"), "/work/a/b");
  assert.equal(projectKey(config, "/work/ab"), null);
  assert.equal(resolveSettings(config, "/work/a/x").voice, "sonic_sage");
  assert.equal(resolveSettings(config, "/work/a/b").length, "long");
  assert.equal(resolveSettings(config, "/other").voice, "sonic_ember");
  assert.equal(resolveSettings({ default: {}, projects: {} }, "/").voice, DEFAULTS.voice);
});

test("speakArgs uses play-only speech and adds only changed values", () => {
  assert.deepEqual(speakArgs({ ...DEFAULTS }), ["speak", "--follow", "--play", "--voice", "sonic_cedar", "--language", "English"]);
  assert.deepEqual(speakArgs({ ...DEFAULTS, speed: 1.2, language: "auto" }), [
    "speak", "--follow", "--play", "--voice", "sonic_cedar", "--speed", "1.2",
  ]);
});

test("commands change the settings of a folder or of all folders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-voice-"));
  const lines = [];
  const log = (l) => lines.push(l);
  assert.equal(await commandMode(["voice", "sonic_coral"], { cwd: "/w/p", dir, log }), 0);
  assert.equal(await commandMode(["length", "medium", "--global"], { cwd: "/w/p", dir, log }), 0);
  assert.equal(await commandMode(["off"], { cwd: "/w/q", dir, log }), 0);
  assert.equal(await commandMode(["voice", "nobody"], { cwd: "/w/p", dir, log }), 2);
  assert.equal(await commandMode(["speed", "9"], { cwd: "/w/p", dir, log }), 2);
  const config = loadConfig(dir);
  assert.equal(resolveSettings(config, "/w/p").voice, "sonic_coral");
  assert.equal(resolveSettings(config, "/w/p").length, "medium");
  assert.equal(resolveSettings(config, "/w/q").enabled, false);
  assert.equal(resolveSettings(config, "/w/p").enabled, true);
});

test("hook mode speaks through vois-cli in the background", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-voice-hook-"));
  const capture = join(dir, "capture.json");
  const fake = join(dir, "fake-vois-cli");
  writeFileSync(
    fake,
    `#!/usr/bin/env node
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  require("fs").writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), stdin: d }));
});
`,
  );
  chmodSync(fake, 0o755);
  const env = { ...process.env, VOIS_CLI: fake, AGENT_VOICE_HOME: dir };
  const input = JSON.stringify({
    hook_event_name: "Stop",
    cwd: "/tmp/demo",
    last_assistant_message: "I added the **export** button. It works.",
  });
  const started = Date.now();
  const res = spawnSync(process.execPath, [SCRIPT, "hook", "claude", "stop"], { input, env, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
  assert.ok(Date.now() - started < 3000, "the hook must return at once");
  for (let i = 0; i < 50 && !existsSync(capture); i++) await new Promise((r) => setTimeout(r, 100));
  const got = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(got.args, ["speak", "--follow", "--play", "--voice", "sonic_cedar", "--language", "English"]);
  assert.equal(got.stdin, "I added the export button.\n");
  for (let i = 0; i < 50 && !existsSync(join(dir, "last.json")); i++) await new Promise((r) => setTimeout(r, 100));
  const last = JSON.parse(readFileSync(join(dir, "last.json"), "utf8"));
  assert.equal(last.code, 0);
  assert.equal(last.agent, "claude");
});

test("hook mode stays silent when agent-voice is off", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-voice-off-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ default: { enabled: false }, projects: {} }));
  const env = { ...process.env, VOIS_CLI: "/nonexistent/vois-cli", AGENT_VOICE_HOME: dir };
  const input = JSON.stringify({ cwd: "/tmp/demo", last_assistant_message: "Hello." });
  const res = spawnSync(process.execPath, [SCRIPT, "hook", "claude", "stop"], { input, env, encoding: "utf8" });
  assert.equal(res.status, 0);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(existsSync(join(dir, "last.json")), false);
});

test("a hook with bad input exits 0 and prints nothing", () => {
  const res = spawnSync(process.execPath, [SCRIPT, "hook", "claude", "stop"], { input: "not json", encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});
