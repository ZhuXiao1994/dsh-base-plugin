# AGENTS.md

Agent-facing instructions for the `dsh-thinking-depth` plugin. Read this before
changing or installing anything here; the "Invariants" and "Traps" sections are
load-bearing.

## What this is

A **host-only** plugin bundle for DeepSeek Harness. It gives the **third-party
models** a profile declares by hand under `llm-pi-ai` their **native** reasoning
levels — the effort control inside the composer's model picker.

It ships no interface. The editing surface is the native **Settings → Models**
page. Do not add a settings page; that design was explicitly rejected by the
user as "not native enough and not dynamic enough".

- Package: `dsh-thinking-depth` (currently `0.2.2`)
- Entry: `index.js` — `export function apply(ctx)`, `export const inject = ["settings"]`
- Bundle: `cordis.patch.yml` inserts the row `dsh-thinking-depth`
- No client half: no `dsh.client` in `package.json`, no `./client` export

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

## Layout

| Path | Role |
|---|---|
| `index.js` | The whole plugin: rule tables, `capabilityFor()`, `planSweep()`, `apply()` |
| `cordis.patch.yml` | Bundle patch, inserts the row |
| `locale/{en,zh}.json` | `meta.title` / `meta.description` for the plugin inventory |
| `icon.svg` | Inventory icon (SVG, well under 256 KiB) |
| `tools/verify-host.mjs` | Offline behaviour harness — run it after every change |
| `package.json` | Manifest; `scripts.verify`, `scripts.pack` |

Exported for testing, and safe to keep exported: `capabilityFor(modelId)` and
`planSweep(descriptor)`.

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
pnpm verify        # or: node tools/verify-host.mjs
```

Drives `planSweep()` with a descriptor shaped like `settings.describe()` and
asserts the exact ops. Extend it whenever a rule changes.

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

Clean up the scratch profile afterwards.

### 3. What you cannot verify here

The rendered picker. There is no browser control in this environment and the
running app's HTTP surface needs a token you must not go looking for. State that
the visual result is unverified; do not claim otherwise.

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
