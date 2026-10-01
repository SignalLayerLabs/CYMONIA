# Direct WebSocket topology

The canonical REST path remains:

Observer -> Pages `/api/v2/*` -> `WORLD_SERVICE` -> Sovereign Worker -> canonical Durable Object.

The real-time WebSocket path is intentionally direct:

Observer -> `wss://cymonia-sovereign-world.signallayerlabs.workers.dev/stream` -> Sovereign Worker -> canonical Durable Object.

This removes the Pages Function + service-binding proxy from the long-lived upgraded connection. The Pages route remains useful for REST, authentication and normal API calls, but it is no longer in the WebSocket data path.

The WebSocket carries only compact `world_signal` invalidations. Full canonical state is still retrieved through `/api/v2/state`.

This topology does not reset, fork or duplicate the world. Both transports reach the same `SovereignWorld` Durable Object namespace in the deployed Worker.
