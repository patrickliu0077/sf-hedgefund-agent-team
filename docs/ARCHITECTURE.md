# Architecture

## Control Plane

The app exposes one control plane through HTTP and a deterministic agent-native command parser. Both paths call the same `HedgeFundOrchestrator`, so CLI, API, and future LLM agents cannot bypass risk checks.

## Data Plane

The data plane is SDK-first:

- public intelligence uses `SimpleFunctions` SDK resources,
- tool descriptions and live execution policy use `SimpleFunctionsAgent`,
- traces are written through Agent SDK `FileTraceStore`,
- every run, decision, and receipt is appended to JSONL for replay and audit.

## Roles

Research generates candidates. Monitoring checks runtime and account surfaces. Risk converts candidates into approved or blocked orders. Execution records paper/shadow receipts or submits live `execution.place` calls.

## Why This Beats Raw Venue APIs

Raw venue APIs expose order entry and market data. This service composes higher-level capabilities that are tedious to rebuild per venue:

- one contract manifest for SDK and Agent tools,
- unified Kalshi/Polymarket candidate model,
- runtime discovery/start checks before execution,
- policy gates for side effects, cost, quantity, venue, jurisdiction, and confirmation,
- traceable paper/shadow/live execution using the same order shape,
- research tools that combine screen, regime, cross-venue, yield-curve, world, and calendar context.

## Safety

The app defaults to paper mode. Live mode fails closed unless all gates are satisfied. Polymarket live execution is blocked in US jurisdiction by default; change `JURISDICTION` and `BLOCK_POLYMARKET_LIVE` only if the operator is legally allowed to trade there.
