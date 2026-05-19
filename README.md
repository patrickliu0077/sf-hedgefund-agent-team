# SimpleFunctions Hedge Fund Agent Team

Docker/Fly-ready reference app for building a full-chain prediction-market trading loop with `@spfunctions/sdk@1.0.0` and `@spfunctions/agent@1.0.0`.

It runs four roles:

- Research: quant and fundamental candidate generation from SimpleFunctions public market intelligence.
- Monitoring: manifest, runtime, portfolio, and active-intent checks.
- Risk: account-level and jurisdiction-level safety gates before any execution.
- Execution: paper, shadow, or live `execution.place` path with maker/taker styles.

The app is intentionally not a raw venue API wrapper. It uses the SDK/Agent SDK manifest, runtime checks, trace logging, unified market screens, policy gates, and one loop shape across Kalshi and Polymarket. US Polymarket live execution is blocked by default.

## Quickstart

```bash
cp .env.example .env
npm install
npm run smoke
npm run dev
```

Then in another terminal:

```bash
curl http://127.0.0.1:8787/health

curl -X POST http://127.0.0.1:8787/v1/control/tick \
  -H 'content-type: application/json' \
  -d '{"strategy":"hybrid","mode":"paper","maxCandidates":6,"maxOrdersPerTick":2}'

curl http://127.0.0.1:8787/v1/runs
```

## Agent-Native Control

No LLM or OpenRouter credits are required. The command parser is deterministic and maps desk-style commands into the same API control plane:

```bash
npm run agent -- "run quant paper once with maker and taker dual venues orders 2 markets 8"
```

Or through HTTP:

```bash
curl -X POST http://127.0.0.1:8787/v1/agent/command \
  -H 'content-type: application/json' \
  -d '{"command":"run fundamental paper once kalshi taker orders 1"}'
```

## Docker / OrbStack

```bash
cp .env.example .env
docker compose up --build
```

OrbStack will expose the service at `http://127.0.0.1:8787`.

## Fly.io

```bash
fly launch --copy-config --no-deploy
fly volumes create sf_hedgefund_agent_data --size 1
fly secrets set SF_API_KEY=... SF_CLOUD_KEY=... CONTROL_TOKEN=...
fly deploy
```

The default Fly config runs `EXECUTION_MODE=paper`. Live trading must be explicitly enabled with secrets:

```bash
fly secrets set \
  EXECUTION_MODE=live \
  ENABLE_LIVE_TRADING=true \
  CONFIRM_LIVE_TRADING=I_UNDERSTAND_THIS_PLACES_REAL_ORDERS
```

## API

- `GET /health`
- `GET /v1/status`
- `GET /v1/events` server-sent events
- `POST /v1/control/start`
- `POST /v1/control/stop`
- `POST /v1/control/tick`
- `POST /v1/agent/command`
- `GET /v1/runs`
- `GET /v1/decisions`
- `GET /v1/receipts`

If `CONTROL_TOKEN` is set, mutating endpoints require:

```text
Authorization: Bearer <CONTROL_TOKEN>
```

## Modes

- `paper`: records simulated fills locally.
- `shadow`: produces the exact `execution.place` input without mutating SimpleFunctions or venues.
- `live`: calls Agent SDK `execution.place`, which uses SDK runtime orchestration before creating executable intents.

Live mode requires all of:

- `SF_API_KEY`
- `ENABLE_LIVE_TRADING=true`
- request body `confirmLiveTrading: "I_UNDERSTAND_THIS_PLACES_REAL_ORDERS"`
- risk policy approval

## Strategy Notes

Quant research combines:

- `markets.screen`
- `regime.scan`
- `crossvenue.pairs`
- `yieldcurves.list`

Fundamental research combines:

- `world.read`
- `calendar.list`
- keyword market search for macro, policy, rates, oil, tariffs, recession, courts, and election themes

Execution supports:

- taker: immediate `execution.place`
- maker: price-triggered `execution.place` input using a one-cent passive offset

## Local Verification

```bash
npm test
npm run typecheck
npm run build
npm run smoke
docker build -t sf-hedgefund-agent-team:local .
```
