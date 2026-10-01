# Realtime transport quarantine

The WebSocket transport is currently not part of the production Observer path.

Production evidence on 2026-10-01 showed repeated abnormal WebSocket closure (`1006`) both through the Pages Function proxy and when connecting directly to the public Sovereign Worker. During the same runs, canonical REST health proved that the Durable Object continued to advance and persist its world successfully.

Until the platform-level WebSocket behavior is separately diagnosed, the production Observer uses its existing canonical REST polling path:

Observer -> Pages `/api/v2/state` -> `WORLD_SERVICE` -> Sovereign Worker -> canonical Durable Object.

The Observer polls every 10 seconds and retains monotonic-world validation and retry/degraded handling. Rendering continues to interpolate canonical movement between committed snapshots.

The server-side WebSocket code may remain available for isolated future diagnostics, but production correctness and deployment are not dependent on it.

This is a transport quarantine only. It does not reset, fork, mutate, or duplicate the canonical world.
