# WebSocket heartbeat recovery

The production CI failure occurred after canonical simulation had already advanced and persisted successfully. The failed stage was WebSocket verification, which closed abnormally with code 1006.

This hotfix makes WebSocket transport independent from world snapshot size.

The WebSocket now carries only compact canonical invalidation signals containing:
- world ID
- world minute
- ledger head
- persisted generation
- protocol version/type

The complete state remains served by `/api/v2/state`, using the existing streamed compressed public snapshot path.

The Observer reacts to `world_signal` by refreshing canonical state over REST. This preserves authoritative state semantics while preventing WebSocket liveness and Durable Object memory pressure from growing with Citizen knowledge.

The deployment workflow also calls `/api/v2/health` immediately after the Worker deploy to wake the Durable Object and invoke existing alarm recovery logic.

This hotfix never resets the Durable Object, world snapshot, ledger, citizens, calendar or historical state.
