# AGENTS.md

Agent-facing instructions for the `dsh-thinking-depth` plugin. Read this before
changing or installing anything here; the "Invariants" and "Traps" sections are
load-bearing.

## What this is

A **host-only** plugin bundle for DeepSeek Harness with two independent
features:

1. It gives the **third-party models** a profile declares by hand under
   `llm-pi-ai` their **native** reasoning levels — the effort control inside the
   composer's model picker.
2. It raises one **Windows toast** when a task ends or the agent needs a human
   decision. See [Attention reminders](#attention-reminders).

It ships no interface. The editing surface for feature one is the native
**Settings → Models** page. Do not add a settings page; that design was
explicitly rejected by the user as "not native enough and not dynamic enough".

- Package: `dsh-thinking-depth` (currently `0.3.0`)
- Entry: `index.js` — `export function apply(ctx, config)`, `export const inject = ["settings"]`
- Bundle: `cordis.patch.yml` inserts the row `dsh-thinking-depth`
- No client half: no `dsh.client` in `package.json`, no `./client` export
- Reminder toggle: `config.notifications: false` in a profile patch override

## The mechanism you must understand first

`llm-pi-ai` resolves a model's capability by looking it up in the installed pi-ai
catalog **under the route's own name**:

```js
const defaults = catalogModels(provider)   // provider == route name, e.g. "commandcode"
const base = defaults.get(entry.id)        // a hand-declared route is not in the catalog → undefined
// resolveModelReasoning(provider, entry, base) → { reasoning: false }
```

So every model behind a custom gateway looks like a non-reasoning model and the
native effort control offers nothing — even though the model id *is* described by
the catalog, just under another provider's name.

The plugin writes the missing capability into the profile patch at startup via
the host `settings` service. That is the only viable path; see
[Verified dead ends](#verified-dead-ends).

## Invariants — do not break these

1. **Additive only.** Never modify, replace or delete an existing
   `reasoningEfforts` or `compat`. A model that already declares anything —
   including `reasoningEfforts: false` — is final. This is what makes the native
   Settings → Models page the authority.
2. **Idempotent.** A sweep over already-filled configuration must produce zero
   ops. The rule tables use canonical keys (`off` included) precisely so that
   what the plugin writes never looks "missing" to itself.
3. **Host-only.** No `dsh.client`, no `./client`, no UI contribution.
4. **No DSH/pi-ai imports at runtime.** They are not resolvable from a
   profile-installed package. Keep the rule tables in-file.
5. **`apply()` must never throw.** A thrown `apply` fails the plugin row and
   takes the bundle down.
6. **Only the `providers.<route>.models` path is written.** Read the list from
   `descriptor.user` (the profile patch), never from `descriptor.value`
   (resolved), so an addition cannot materialize catalog defaults from a lower
   configuration layer.
7. **A reminder can never fail an agent.** Every listener catches its own errors,
   the sender is fire-and-forget, and the whole feature is optional. A broken
   toast channel is a debug log, never a thrown event handler.
8. **Remind once.** The two completion signals (`agent/status: idle` and the
   `turn/end` fallback) must collapse to one toast; question and approval ids
   must not replay within their dedupe window; a `turn/start` cancels a pending
   completion.
9. **Root sessions only.** Subagent sessions (`session.header.delegationDepth >
   0`, `parentSession`, `origin: "subagent"`, or `agent.options.subagentDepth >
   0`) must never toast. The parent's result already reports the child's work.
10. **Reminder content is inert text.** It is built from the session log and
    escaped for PowerShell/XML. Never interpolate it into a shell command
    without the escaping helpers.

## Layout

| Path | Role |
|---|---|
| `index.js` | Feature one and entry: rule tables, `capabilityFor()`, `planSweep()`, `apply()` |
| `notify.js` | Feature two: trigger classification, toast builders, dedupe, listener installation |
| `notify-windows.js` | Windows toast transport: PowerShell script builder, XML/PowerShell escaping, sender |
| `cordis.patch.yml` | Bundle patch, inserts the row |
| `locale/{en,zh}.json` | `meta.title` / `meta.description` for the plugin inventory |
| `icon.svg` | Inventory icon (SVG, well under 256 KiB) |
| `icon.png` | 64×64 toast `appLogoOverride` image, generated from `icon.svg` |
| `tools/verify-host.mjs` | Feature-one offline harness |
| `tools/verify-notify.mjs` | Feature-two offline harness (fake host event bus) |
| `tools/notify-smoke.mjs` | Manual real-toast smoke test (Windows, user-visible) |
| `package.json` | Manifest; `scripts.verify`, `scripts.pack` |

Exported for testing, and safe to keep exported from `index.js`:
`capabilityFor(modelId)` and `planSweep(descriptor)`. From `notify.js`, the pure
builders and `installAttention(ctx, options)` are exported for the harness.

## Rule tables

A route is judged whole before any model is considered: **as soon as any of its
models declares `reasoningEfforts`, the route counts as hand-maintained and is
skipped entirely** — its blanks are the user's decision. Only a route that
declares nothing at all is filled in, and it is filled in whole.

Within such a route, three tiers decide each model, first match wins:

1. `EXACT_RULES` — one entry per model id, taken from the installed pi-ai
   catalog's own record for that id. Carries `thinkingFormat` **only** when the
   catalog record speaks the same protocol as the route it is borrowed onto —
   the same test `llm-pi-ai` applies before inheriting a catalog compat block.
2. `FAMILY_RULES` — prefix patterns, mined from every `openai-completions`
   reasoning model in the catalog. Levels only; never a wire format.
3. `ASSUMED_EFFORTS` — the common OpenAI-compatible core
   (`off, low, medium, high`) for anything else.

### Extending the tables

The catalog ships inside the app archive at
`dsh/node_modules/@earendil-works/pi-ai/dist/providers/data/*.json`, shaped
`{ "<api>": { "chat:<id>": { id, api, provider, reasoning, thinkingLevelMap, compat } } }`.
It is inside `app.asar`, so extract the archive rather than reading the path
with normal tools (an ASAR header parser over the `app.asar` file works; the
archive is Electron's ASAR format).

To mine a new family, index every entry whose `api` is
`openai-completions` and `reasoning` is `true`, group by id suffix, and take the
levels the family agrees on. Put the reduction in `FAMILY_RULES`; put a single
id in `EXACT_RULES` only when you have its catalog record in hand.

## Attention reminders

`notify.js` installs two root-scoped listeners and one Windows transport. Its
contract is deliberately narrower than a general notification framework:

| Trigger | Source | Toast |
|---|---|---|
| A turn finished | `agent/status` with `status: "idle"`, reading the last `turn/end` | `任务完成` / `任务出错` / `输出达到上限` / `任务被阻塞` |
| A choice UI opened | `session/event` → `tool/call` with `name: "ask_user_question"` | `需要你的选择` |
| An approval is waiting | `session/event` → `approval/asked` | `需要你的确认` |
| A turn ended without a status event | `session/event` → `turn/end`, 2.5 s fallback | same completion text |

Key rules:

- **Completion is one toast.** `agent/status: idle` normally wins (400 ms settle)
  and replaces the `turn/end` fallback timer. `turn/start` cancels either. The
  dedupe key is `done:<sessionId>:<turn/end seq>`, so the two signals for one
  turn collapse while a later turn (a different seq) still notifies.
- **Question/approval identity is `callId` / approval `id`.** They are deduped
  for 60 s; a replay must not toast again.
- **Aborted, interrupted and forked turns are silent** — the human stopped the
  work or the app moved it. `max-tokens` is reported: a truncated answer is
  exactly something the user should see.
- **Root only.** `isRootSession()` checks `header.delegationDepth`,
  `header.parentSession` and `header.origin`; `isRootAgent()` also checks
  `options.subagentDepth`. Unknown shapes default to root (a missed completion is
  worse than one extra toast).
- **Text is a summary, not a transcript.** Body is collapsed to one line and
  capped at 160 characters. Session title folds the last `session/title`, else
  the first human `user/message`, else `会话 <8-char-id>`.
- **Transport is Windows-only.** `notify-windows.js` raises a WinRT
  `ToastText02` toast from `powershell.exe`, reuses the registered
  `Microsoft.Windows.PowerShell` AUMID, plays the default notification sound and
  adds the packaged `icon.png` as `appLogoOverride`. Every value passes through
  `escapePowerShellString()` (single-quote doubling) and, for the icon attribute,
  `escapeXmlAttribute()`. Never build a toast by string concatenation outside
  those helpers.
- **No network, no extra dependency, no shortcut registration.** The helper
  process is capped at 15 s and lingers 2 s after `Show()`; failures only reach
  `logger.debug`.
- **Opt-out is `config.notifications: false`.** There is no UI and no settings
  namespace for this; do not add one.

### Why the events, not polling

The host publishes `session/event` synchronously on every committed append and
`agent/status` on every idle/running transition. Both events bypass restored
sessions (seed events never publish on `session/event`), which is what makes the
reminders replay-safe. `session.snapshotEvents()` is used to fold the title and
the last turn; it is synchronous and available on the object the events carry.
Do not add a timer-based scan for this feature.

## Install — Desktop

`dsh` is **not on `PATH`** in this installation. Use the launcher the app ships,
or invoke the CLI through Electron in Node mode:

```powershell
$exe = "C:\Users\94438\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
$cli = "C:\Users\94438\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
$env:ELECTRON_RUN_AS_NODE = "1"

# 1. Pack (bump "version" first — see Traps)
pnpm pack --pack-destination artifacts

# 2. Stage it where a profile dependency can stay resolvable
Copy-Item artifacts\dsh-thinking-depth-<version>.tgz `
  "$env:USERPROFILE\.dsh\plugin-archives\dsh-thinking-depth\" -Force

# 3. Install: pnpm-adds it AND selects it in dsh.profile.bundles
& $exe --expose-internals $cli plugin --profile desktop add `
  "$env:USERPROFILE\.dsh\plugin-archives\dsh-thinking-depth\dsh-thinking-depth-<version>.tgz"
```

There is also `resources\runtime\cli\bin\dsh.cmd`, which is the same invocation.

`dsh plugin <args>` forwards to pnpm inside the profile directory and records
the result in that profile's `package.json`:

- `dependencies["dsh-thinking-depth"]` → the tarball path
- `dsh.profile.bundles` → `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-thinking-depth"]`

Installed files land in `<profile>/node_modules/dsh-thinking-depth`. **The user's
hand-authored `cordis.patch.yml` is not touched by the install** — the plugin row
comes from the bundle's own patch.

## Verify

Run these in order; each catches a different class of mistake.

### 1. Offline behaviour (always)

```powershell
pnpm verify        # runs verify-host.mjs and verify-notify.mjs
```

`tools/verify-host.mjs` drives `planSweep()` with a descriptor shaped like
`settings.describe()` and asserts the exact ops. `tools/verify-notify.mjs`
drives the pure toast builders and installs the notifier on a fake host event
bus, asserting the root filter, dedupe, cancellation, fallback and cleanup.
Extend both whenever a rule changes.

### 1b. Real toast delivery (manual, Windows, before shipping a reminder change)

```powershell
node tools/notify-smoke.mjs "DSH 提醒测试" "「思考深度」通知通道正常。"
```

This starts the real `powershell.exe` WinRT path, so a toast should appear on
the desktop. A successful run prints `toast handed to Windows` and exits 0; the
helper itself logs scripting failures at debug level. Do not run it in a loop —
each call raises a visible notification.

### 2. End-to-end in an isolated profile (always, before shipping)

The `desktop` profile **cannot** be booted or dumped by the CLI — it is
"managed exclusively by the Electron application" — so verify against a
throwaway profile built from the shipped `web` template:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
# a) create a scratch profile from the shipped web template
& $exe --expose-internals $cli --profile <scratch> --from-default-profile web --dump-config
# b) install this plugin into it
& $exe --expose-internals $cli plugin --profile <scratch> add <tarball>
# c) put a hand-declared route into <scratch>/cordis.patch.yml (id: llm-pi-ai)
# d) boot it, holding stdin open, then read the patch back
```

Success looks like `reasoningEfforts` appearing on the models that lacked it,
with every other field preserved. Boot it a **second** time and compare the
patch's SHA-256: it must be byte-identical (idempotence).

To check the *trigger* rather than just startup, append a **new uncurated route**
to the scratch patch while the app is still running and wait past 60 s: it must be
filled without a restart, while a route that already declares levels must stay
untouched. That is the only runnable proof of the trigger; a file edit alone never
fires an event (see Traps).

The same boot is the reminder feature's module-load check: `apply()` imports
`notify.js`/`notify-windows.js`, installs the listeners and returns without
throwing. A missing packaged file or a listener registration error would make the
boot fail or log a plugin error. A **live** reminder needs a real agent turn and
is therefore verified in the desktop profile by the user; the offline harness
covers the event logic and `tools/notify-smoke.mjs` covers the transport.

Clean up the scratch profile afterwards.

### 3. What you cannot verify here

The rendered picker. There is no browser control in this environment and the
running app's HTTP surface needs a token you must not go looking for. State that
the visual result is unverified; do not claim otherwise.

The toast's **visual** appearance is likewise unverified: the smoke helper proves
PowerShell accepted the script and exited 0, not that Windows painted the toast.
A real agent turn (and therefore a real reminder) requires a live model session;
do not fake one by writing events into a session log.

## Traps

- **A same-path tarball is not reinstalled.** pnpm answers `Already up to date`
  when the version and path are unchanged, so **bump `version` in
  `package.json` before repacking** whenever code changes.
- **Replacing an installed package needs a DSH restart.** Installing a *new*
  bundle can activate through HMR; replacing an already-installed one does not
  load a fresh JavaScript generation. The user must restart, and until then the
  previous code keeps running.
- **Triggers are three; only the interval is empirically proven.** A sweep runs
  at startup, on a debounced root-scoped `app-boot/config-reload` /
  `settings/document-updated`, and every 60 seconds. The host does **not** watch
  `cordis.patch.yml` for external edits, so neither event fires for a file edited
  behind its back: a route appended to a running scratch profile's patch stayed
  untouched until the interval fired, and was filled within it. Keep the interval
  unless you can prove an event covers that case.
- **Retries are bounded per write.** Attempts are counted per op signature, capped
  at 3, then abandoned until restart; the counter clears on success. Never go back
  to a boolean "attempted" flag set before the write — that turns one
  `SettingsConflictError` into a permanent block.
- **A filled route counts as hand-maintained afterwards.** The plugin's own writes
  look like declarations, so a route it filled once is skipped on later sweeps: a
  model added to that route later is *not* auto-filled. That is the scope the user
  chose on 2026-10-19 ("智能跳过手工维护的路由"); confirm with them before widening
  or narrowing it.
- **The fallback is aggressive.** `ASSUMED_EFFORTS` (and family rules) will fill
  every model of an *uncurated* route, including one the user deliberately left
  blank — a blank `reasoningEfforts` is ambiguous between "not configured yet" and
  "intentionally none". The native way to say "intentionally none" is
  `reasoningEfforts: false`. The route-level skip is what keeps this from touching
  a route the user is curating by hand.
- **Boot an app with the profile flag, not an app name.**
  `--profile X web` passes `web` to the app as a stray positional argument and
  fails; `--profile X` alone selects the app from the profile's bundles.
- **A dsh stdio app exits on stdin EOF.** Launching one from a background shell
  without holding a stdin pipe open makes it exit 0 immediately, silently.
- **`session/event` and `agent/status` are scoped dispatches.** The notifier is a
  root plugin, so an untagged listener also receives them, but
  `{ global: true }` makes that explicit and survives a future context change.
  A listener registered inside a session/agent context needs it.
- **`agent.session.events` does not exist in this build.** Use
  `session.snapshotEvents()` (or `ownEvents()`), as `eventsOf()` does. Do not
  copy `dsh-task-notify`'s `agent.session.events` fold; it was written against an
  older shape and silently falls back.
- **The host is a forked Node process, not the Electron main process.**
  `require('electron').Notification` is not a dependable transport here; the
  PowerShell WinRT path is the one that is known to work.
- **Never interpolate toast text into a PowerShell command string.** Use
  `execFile(file, args[])` with the fixed script and the escaping helpers. The
  session title is untrusted text.
- **The toast helper needs an interactive desktop session.** A service or
  headless run has nowhere to paint; Focus Assist and per-app notification
  settings can suppress it. There is no fallback channel by design.
- **Windows console encoding.** Chinese output in this repository is UTF-8;
  read and write files as UTF-8.

## Verified dead ends — do not retry these

- Importing `@earendil-works/pi-ai` (or any `@deepseek-ai/*` package) from a
  profile-installed plugin: `ERR_MODULE_NOT_FOUND`. The catalog is therefore
  *not* readable at runtime; that is exactly why the tables are shipped in-file.
- `ctx.llm.listModels(provider)` — requires a registered adapter, throws
  `NO_ADAPTER` for unconfigured catalog routes, and returns no reasoning
  metadata anyway (`{provider, id, name, inputModalities}` only).
- Registering a second adapter for the same route — `DUPLICATE_ADAPTER`.
- `modelOverrides` on a hand-declared route — refused by design ("the installed
  catalog does not describe this route").
- Renaming a route to a catalog provider's name so `catalogModels()` finds bases
  — works only for ids that provider actually lists, and changes credential
  references and the default model; treat as a user configuration decision, not
  a plugin behaviour.
