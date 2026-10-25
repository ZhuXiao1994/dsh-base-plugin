# DSH Thinking Depth

English | [中文](README.zh-CN.md)

DSH Thinking Depth is a **host-only plugin** with two independent jobs. It gives
the **third-party models** a DeepSeek Harness profile declares by hand their
**native** reasoning levels — the effort control inside the composer's model
picker — and it raises a **desktop reminder** when a task ends or the agent needs
a human decision. It ships no interface of its own.

## Why a hand-declared model has no levels

The native effort control is driven by the capability the adapter reports, and
the pi-ai adapter looks models up in the installed catalog under the **route's
own name**:

```js
const defaults = catalogModels(provider)   // provider == route name, e.g. "commandcode"
const base = defaults.get(entry.id)        // a hand-declared route is not in the catalog → undefined
// → reasoning: false
```

So every model behind a custom gateway looks like a non-reasoning model, and the
control offers nothing. The ids themselves *are* described by the shipped pi-ai
catalog — just under other provider names, which a hand-declared route cannot
reach.

This plugin writes that capability into the configuration at startup, and the
native control starts working.

## What it does

- **A route is judged whole.** As soon as any of its models declares
  `reasoningEfforts`, that route counts as **hand-maintained** and is skipped
  entirely — its blanks are your decision.
- Only a route that declares **nothing at all** is handled, and it is filled in
  whole: each model gets the levels it offers, plus `compat.thinkingFormat` where
  that applies.
- It only ever **adds**. A model that already declares `reasoningEfforts` — a
  level map, or `false` for a model that cannot think — is left untouched, so the
  native Settings → Models page stays the final authority.
- **When it runs:** at startup, on configuration-change events (debounced), and
  once every 60 seconds as a safety net. A configuration changed behind the
  host's back — a directly edited profile patch, for one — produces no event, so
  the safety net is what catches it, within a minute.
- It is idempotent: once filled in, a later sweep finds nothing to write.

## One consequence worth knowing

The plugin's own writes look like declarations to itself, so **a route it has
filled once counts as hand-maintained from then on**: a model you add to that
route later is *not* auto-filled. To hand a route back to the plugin, clear
`reasoningEfforts` from all of its models; to give one new model levels, ticking
them in the native Settings → Models page is quicker.

Under that rule every route in the current Profile already declares levels, so the
plugin will not rewrite anything from now on — its job becomes "a brand-new route
is filled in once, automatically".

## The shipped rules

Exact entries are taken from the installed pi-ai catalog's own record for that
id:

| Model id | Catalog source | `reasoningEfforts` written | `thinkingFormat` |
|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | openrouter (protocol matches) | `off: none, low, high, max` | `openrouter` |
| `inclusionai/ling-3.0-flash-sante:free` | openrouter (protocol matches) | `off, minimal, low, medium, high` | `openrouter` |
| `poolside/laguna-s-2.1-free` | vercel-ai-gateway (other protocol) | `off, minimal, low, medium, high` | none |
| `claude-opus-5-5` | anthropic (other protocol) | `off, low, medium, high, xhigh, max` | none |

A `thinkingFormat` is written only when the catalog record speaks the same
protocol as the route — the same test `llm-pi-ai` itself applies before
inheriting a catalog compat block.

Models without an exact entry fall to family rules (`claude`, `deepseek`,
`gpt-*`/`o1+`, `gemini`, `glm`/`zai`, `kimi`/`moonshot`, `grok`, `mistral`),
mined from every `openai-completions` reasoning model in the catalog. Family
rules add levels only and never a wire format. Anything else gets the common
OpenAI-compatible core, `off, low, medium, high`.

## Overriding it

Every override is a native mechanism:

| You want | Do this |
|---|---|
| A model with no thinking at all | Turn its reasoning levels off in Settings → Models (`reasoningEfforts: false`) |
| Only some levels | Pick them by hand in Settings → Models; the plugin then leaves the model alone |
| A whole route maintained by hand | Declare `reasoningEfforts` on any one of its models; the route is then skipped |
| Hand a route back to the plugin | Clear `reasoningEfforts` from all of its models |
| The plugin off entirely | Set the plugin row to `disabled: true` |
| A different wire format | Set `compat.thinkingFormat` on the model (`openai`, `deepseek`, `openrouter`, `qwen`, …) |

## Task reminders

Feature two is separate from the reasoning sweep and is on by default. It raises
one **Windows toast** when:

- a turn finishes with `completed`, `error`, `max-tokens` or `blocked` —
  the toast carries the session title, the failure detail when there is one, and
  the turn duration;
- an `ask_user_question` call opens a choice UI — the toast carries the question
  text and the first few option labels;
- an approval request is waiting — the toast names the tool and its reason.

A user-initiated stop (`aborted`), a restored session, maintenance and **subagent
sessions** are silent: the human owns the root conversation, and a chatty child
would steal the reminder. Only live event appends are observed, so a replayed
session cannot notify twice. Completion has two sources — the precise
`agent/status: idle` event and a `turn/end` fallback — and a new `turn/start`
cancels the pending one, so a task that immediately continues does not produce a
premature "finished" toast.

The reminder is delivered by Windows PowerShell's WinRT toast API, reusing
PowerShell's registered AppUserModelID and the bundled `icon.png`. It needs no
network, no extra dependency, and no Start Menu shortcut. Delivery is
fire-and-forget: a missing `powershell.exe`, a disabled toast channel, Focus
Assist, or any other failure is logged at debug level and never affects the
agent session. The feature is Windows-only; on other platforms the sender is a
no-op.

To turn reminders off without uninstalling the bundle, override the plugin row in
the profile's `cordis.patch.yml`:

```yaml
- id: dsh-thinking-depth
  config:
    notifications: false
```

## Install

```powershell
# Build the tarball from this directory, then install it into the profile.
pnpm pack --pack-destination artifacts
dsh plugin --profile desktop add "$PWD\artifacts\dsh-thinking-depth-0.3.0.tgz"
```

Restart DSH (or let the host reload its configuration). The plugin is
host-only, so there is no client bundle to refresh; the new levels may need the
picker to be reopened.

`dsh plugin` runs pnpm inside the profile, so the same proxy and registry
settings apply as to any other profile install. `$env:DSH_PROFILE` names the
profile when the shell was launched by Harness.

## Where it writes

Writes go through DSH's settings service and persist into the current profile's
configuration patch — the same path the native Settings → Models page uses. Only
the `providers.<route>.models` array is touched; every other field is preserved.

## Development

`tools/verify-host.mjs` imports `index.js` directly and drives the planning
functions with a descriptor shaped like the one `settings.describe()` returns,
asserting the exact writes the plugin would make. `tools/verify-notify.mjs` does
the same for the reminder builders and for the installer driven by a fake host
event bus.

```powershell
pnpm verify
```

To check the actual Windows toast channel, run the smoke helper. It raises a real
toast and waits for the platform to show it:

```powershell
node tools/notify-smoke.mjs "DSH 提醒测试" "「思考深度」通知通道正常。"
```

## Notes and limits

- Only routes that declare a `models` list are handled; when that list lives in a
  lower configuration layer rather than the profile patch, nothing is changed
  because there is no list to extend.
- Family and fallback rules are **inferences**. They only add picker options and
  never a route default, so the worst case is that you pick a level the gateway
  rejects: that one request fails, and you change it back.
- A pi-ai upgrade can change catalog records; the exact and family tables ship
  inside the plugin and can be updated with it.
- Reminders are **Windows-only** and intentionally non-interactive: the toast
  reports what happened but does not activate or focus the DSH window. Windows
  Focus Assist and the system notification settings can suppress it.
- Reminders are decided from the root session's own event log. A subagent's
  completion is visible in the parent's result, so it does not raise its own
  toast.

## License

MIT.
