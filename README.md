<h1 align="center" style="border-bottom: none">
  <div>
    <a href="https://www.hootrix.com"  target="_blank">
      <img alt="Hootrix logo" src="https://unpkg.com/openclaw-hootrix-trace/public/logo.svg" height="60" />
    </a>
    <br />
    🔭 OpenClaw Hootrix Observability Plugin
  </div>
</h1>

<p align="center">
  Official plugin for <a href="https://github.com/openclaw/openclaw"  target="_blank">OpenClaw</a> that exports agent traces to <br/>
  <a href="https://www.hootrix.com/docs/"  target="_blank">Hootrix</a> for observability and monitoring.
</p>

<div align="center">

[![License](https://img.shields.io/github/license/hootrix-ai/openclaw-hootrix-trace)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/openclaw-hootrix-trace)](https://www.npmjs.com/package/openclaw-hootrix-trace)

</div>

## Why This Plugin

[Hootrix](https://www.hootrix.com) is a leading LLM and agent observability, tracing, evaluation and optimization platform.
`@hootrix/openclaw-hootrix-trace` adds native Hootrix tracing for OpenClaw runs:

- LLM request/response spans
- Sub-agent request/response spans
- Tool call spans with inputs, outputs, and errors
- Run-level finalize metadata
- Usage and cost metadata

The plugin runs inside the OpenClaw Gateway process. If your gateway is remote, install and configure the plugin on that host.

## Install and first run

Prerequisites:

- OpenClaw `>=2026.3.2`
- Node.js `>=22.12.0`
- npm `>=10`

### 1. Install the plugin in OpenClaw

```bash
openclaw plugins install clawhub:@hootrix/openclaw-hootrix-trace
```

And for older version of OpenClaw `<2023.3.23` you can install the npm package using:
```bash
openclaw plugins install openclaw-hootrix-trace
```

If the Gateway is already running, restart it after install.

### 2. Configure the plugin

```bash
openclaw hootrix configure
```

The setup wizard validates endpoint and credentials, then writes config under `plugins.entries.openclaw-hootrix-trace`. If you choose Hootrix Cloud and don't have an account yet, the wizard will now guide you through the free registration process, and then automatically generate an API key.

### 3. Check effective settings

```bash
openclaw hootrix status
```

### 4. Send a test message

```bash
openclaw gateway run
openclaw message send "Hello! Hootrix from openclaw"
```

Then confirm traces in your project.

## Configuration

### Recommended config shape

```json
{
  "plugins": {
    "entries": {
      "openclaw-hootrix-trace": {
        "enabled": true,
        "config": {
          // base configuration
          "enabled": true,
          "apiKey": "your-api-key",
          "apiUrl": "https://www.hootrix.com/app/api",
          // optional advanced configuration
          "tags": ["openclaw"],
          "toolResultPersistSanitizeEnabled": false,
          "staleTraceCleanupEnabled": true,
          "staleTraceTimeoutMs": 300000,
          "staleSweepIntervalMs": 60000,
          "flushRetryCount": 2,
          "flushRetryBaseDelayMs": 250
        }
      }
    }
  }
}
```

### Plugin trust allowlist

OpenClaw warns when `plugins.allow` is empty and a community plugin is discovered. Pin trusted plugins explicitly:

```json
{
  "plugins": {
    "allow": ["openclaw-hootrix-trace"]
  }
}
```

### Environment fallbacks

- `HOOTRIX_API_KEY`
- `HOOTRIX_URL`

### Transcript safety default

`toolResultPersistSanitizeEnabled` is disabled by default. When enabled, the plugin rewrites local
image refs in persisted tool transcript messages via `tool_result_persist`.

## CLI commands

| Command | Description |
| --- | --- |
| `openclaw plugins install @hootrix/openclaw-hootrix-trace` | Install plugin package |
| `openclaw hootrix configure` | Interactive setup wizard |
| `openclaw hootrix status` | Print effective Hootrix configuration |

## Event mapping

| OpenClaw event | Hootrix entity | Notes |
| --- | --- | --- |
| `llm_input` | trace + llm span | starts trace and llm span |
| `llm_output` | llm span update/end | writes usage/output and closes span |
| `before_tool_call` | tool span start | captures tool name + input |
| `after_tool_call` | tool span update/end | captures output/error + duration |
| `subagent_spawning` | subagent span start | starts subagent lifecycle span on requester trace |
| `subagent_spawned` | subagent span update | enriches subagent span with run metadata |
| `subagent_ended` | subagent span update/end | finalizes subagent span with outcome/error |
| `agent_end` | trace finalize | closes pending spans and trace |

## Known limitation

No OpenClaw core changes are included in this repository and relies on native hooks within the OpenClaw ecosystem.

## Development

Prerequisites:

- Node.js `>=22.12.0`
- npm `>=10`

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm run test
npm run smoke
```

### Packaging

The package publishes built JavaScript for installed OpenClaw runtime loads while
keeping TypeScript source metadata for development and older OpenClaw fallback
loads. `openclaw.extensions` points at `./index.ts`; `openclaw.runtimeExtensions`
points at `./dist/index.js`. ClawHub also requires explicit
`openclaw.compat.pluginApi` and `openclaw.build.openclawVersion` metadata.
`npm pack` and `npm publish` run `npm run build` through `prepack`, and
`npm run pack:check` verifies the tarball contract.
Pull requests also dry-run the ClawHub package publish workflow, and GitHub
releases publish the validated package to both npm and ClawHub.

Optional live gateway E2E:

```bash
npm run test:live
```

Notes:

- uses an isolated `.artifacts/live-e2e/<run-id>/home/.openclaw` so it does not touch your normal OpenClaw config
- `HOOTRIX_API_KEY`, `HOOTRIX_URL`, `PROJECT_NAME`, and `WORKSPACE` win if set in env
- otherwise it reuses `~/.openclaw/openclaw.json -> plugins.entries.openclaw-hootrix-trace.config` for `apiUrl` / `apiKey` / project / workspace
- set `OPENCLAW_LIVE_USE_HOST_CONFIG=0` to disable reading host plugin config and require explicit env-only Opik settings
- still requires `OPENAI_API_KEY` in env for the real model call
- packs and installs the current plugin build into a fresh OpenClaw home
- falls back to `npx openclaw@${OPENCLAW_LIVE_OPENCLAW_VERSION:-latest}` when `openclaw` is not already on your `PATH`
- override the live model with `OPENCLAW_LIVE_MODEL` if `gpt-4o-mini` is not what you want to exercise

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## License

[Apache-2.0](./LICENSE)
