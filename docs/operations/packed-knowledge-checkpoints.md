# Packed canonical knowledge checkpoints

The October 8 runtime had a live scheduler but excessive simulation lag. Native
production checkpoints still took 32–36 seconds, and the compressed RAM archive
occupied 32,491,639 of its 33,554,432-byte limit. Processing the complete private
history at every checkpoint was unsustainable. Observer animations are unchanged.

## Durable format and recovery

Immutable compressed knowledge pages are packed into SHA-256-addressed SQLite
BLOB bins, normally at most 1 MiB. An individually oversized page remains below
the existing 1.5 MB record admission bound and SQLite's 2 MB row limit. The hot
gzip checkpoint stores ordered logical indices, page boundaries, provenance
counts and bin digests. Its seal covers these descriptors. Default JSON and
standalone streamed exports still contain every logical record and private source.

New or changed pages are staged once. Checkpointing unchanged history never
inflates its pages. Cold recovery restores compact indices, validates all
referenced bins by SHA-256 through primary-key loads, and leaves historical
records compressed until accessed. The compressed bin cache is bounded to 8 MiB;
decoded/raw text caches retain the existing eight-page/512 Ki code-unit bounds.
Only pending uncommitted compressed pages use the existing 32 MiB admission cap.
No bin subarray is retained in page descriptors after cache eviction.

Legacy ordinary-array snapshots remain readable. Their first wake stages bins
and publishes the new hot snapshot at the same guarded world minute. The old
manifest remains authoritative until publication. Missing or corrupt archive
data at the clock guard fails closed; it never causes a new Genesis, an older
world, or omission of private history.

Bin staging and each hot snapshot part have separate atomic quota charges.
Failed publication retains those charges. The manifest, slot metadata, clock
guard and slot-level bin inventory publish in one transaction. Collection retains
both snapshot inventories and live/in-flight references; it visits at most 16
primary-key rows and removes at most two unreferenced bins per checkpoint. Its
charged cursor survives eviction. Collection failure cannot undo publication.

The 40k normal/60k emergency admission limits and free-tier account limits remain
unchanged. Cadence includes staged parts, new bins and maintenance costs. There
are no per-record SQL rows or scratch rebuilds. Durable history still consumes
the platform's storage allowance; this removes the lifetime RAM limit, not that
allowance. Logical index size remains proportional to the number of records.

After a packed checkpoint commits, runtime rollback must use this reader or a
later compatible reader. Redeploy the retained source commit from this change
for rollback; pre-packed binaries cannot interpret the new checkpoint. The
monotonic clock guard must never be relaxed to load an old-format older slot.

## Verification

The local native workerd fixture migrates 675,000 records with 675,000 private
sources. Independent streamed SHA-256 comparisons match both the original
records and 1,700 fragmented confidence mutations after restart. The full-array
fixture used 122 parts; the hot checkpoint uses six. Native encoding took
2.1–2.3 seconds and packed cold recovery 1.58 seconds. An unchanged checkpoint,
including projection, used 66 SQL row reads and 23 writes; the persisted budget
charged the same 23 writes. A 30-world-minute physical pulse used 59 ms and
zero SQL operations. Growth to 825,000 records retained 38.4 MB of compressed
durable history with an approximately 8 MB compressed cache. These are local
measurements. Production clearance
still requires the unchanged unattended clock/identity/physical-state CI gate.

Regression coverage includes legacy migration, lazy cold records, complete
logical exports, cache bounds, private source mutations, missing/corrupt bins,
interrupted publication, durable staging charges and collection across eviction.

## Compact directory v2

The first production migration committed the packed history, but its next alarm
exceeded memory with 791,410 records, 53,322 memories and 11,158 objects. V1
restored a second complete concept-string index in page directories alongside
the logical index; numeric columns also used ordinary JavaScript arrays.

V2 writes each logical concept once, reconstructs page identities from guarded
logical references, and detaches index strings from parsed Citizen buffers.
Rows, offsets and source counts use geometric Uint32 backing; active flags use
Uint8 backing. Cold columns allocate their actual length; growth adds at most
50% spare capacity. Their array-compatible readers preserve append, iteration and
JSON semantics, with bounded per-field JSON conversion. Large arrays bypass
the small-record classifier before it can enumerate all their keys.

Both packed v1 and legacy full-array snapshots remain readable. V1 page
identities are validated before releasing their duplicate strings. After v2
publication, rollback requires this v2-compatible reader; the PR54 v1-only
runtime cannot read v2 descriptors. No canonical records or sources are dropped.

The v2 native fixture includes 108 Citizens, 799,200 knowledge records and private
sources, 55,296 episodic memories and 11,158 objects. Legacy cold migration took
7.8 seconds and its first hot encoding 2.6 seconds. Packed cold recovery took
2.9–3.2 seconds; subsequent checkpoint encoding took 2.7 seconds. Independent
SHA-256 streams match all original records and all 2,052 confidence mutations
after cold restart. An ordinary save used 73 SQL row reads and 27 writes, with
the persisted budget charging the same 27 writes. Growth to 961,200 records
retained 39.4 MB of compressed history with 7.8 MB resident compressed cache;
encoding took 3.1 seconds and produced seven hot parts. With compact cold
allocation, growth recovery took 3.7 seconds and a 30-minute physical pulse
used 259 ms with zero SQL operations. These remain local measurements, with
the production unattended gate required before clearance.

## Alarm delivery and quiet verification

The requested 2.5-second alarm interval is not a delivery guarantee. Production
reported alarms 6–8 seconds overdue while active actions introduced one-minute
boundaries. Six boundaries per invocation could advance less simulated time
than elapsed real time, even after the packed archive eliminated history
re-encoding. An alarm now finishes at most 30 chronological boundaries within
the existing 30-world-minute catch-up target. Physics is unchanged and checkpoint
compression still gets a separate invocation. Recovery, clock guards and daily
quota admission remain unchanged.

Regression tests compare the dense thirty-minute pulse with the unsegmented
canonical kernel and run a sequence of alarms delivered fifteen seconds apart,
including separate checkpoint phases, real biology changes and no outage rebase.
The native workerd fixture also exercises fifteen delayed alarm invocations
against 961,200 historical records, 108 Citizens, 55,296 memories and 11,158
objects. Physical time advanced 210 minutes; committed time advanced from 90 to
300, with real biology changes and a final physical lag of 15 minutes. The
longest invocation took 4.22 seconds, including the separate durable save;
ordinary saves used 39 SQL row writes. These are local measurements; the
unchanged production quiet gate remains mandatory.

Enabling `wrangler tail` or dashboard real-time logs requires a platform software
update and can replace the Durable Object, as described in Cloudflare's
[known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/).
Repeated bounded tail sessions are therefore not passive during an autonomous
soak: they can repeatedly discard unsaved in-memory progress and force recovery.
Stop diagnostic tail sessions before starting quiet advancement verification;
inspect completed GitHub logs while it runs. A live quiet proof must not overlap
deployments, tail activation or Observer requests.

## Dense inventory CPU work

The thirty-boundary production pulse exposed another CPU limit: inventory
planning repeatedly scanned each Citizen's historical entity evidence. A native
fixture with 980,531 records and 11,483 positive held objects took 29.15 seconds
for thirty minutes, compared with the earlier sparse-object fixture. Bounded
entity-query matches now scan appended records incrementally and invalidate
relevant changes. Bounds apply per Citizen (128 queries/8,192 indices) and across
the archive (16,384 queries/65,536 indices); oversized matches remain complete
and are simply uncached. Releasing a store also releases its cached references.
This fixture takes 10.66 seconds after the change.

Alarm advancement yields through storage completion and a timer between
chronological boundaries, allowing genuinely incoming scheduler requests to
renew the platform CPU window. The original target remains fixed through these
yields. The kernel, complete private history, separate checkpoint phase and
strict quiet verification remain unchanged.

## Bounded physical attention

Concentrating all 108 Citizens in the same dense inventory scene reproduced a
remaining throughput failure: thirty world minutes took 60.32 seconds, and new
uncommitted knowledge occupied 31.4 MB. Each Citizen now examines at most 256
object candidates and records at most 32 visible object observations per physical
boundary. A persisted rotating cursor visits later objects on subsequent passes,
including after restart and appends. Visibility, ownership and personal evidence
checks still apply. This deliberately spreads new object discovery over time;
existing objects, private knowledge, provenance and history remain intact.
Resource/structure observation, chronological physics and animations are retained.

The identical dense native fixture takes 14.24 seconds for thirty minutes after
this bound, with 2.07 MB pending compressed knowledge. A separate durable save
takes 4.59 seconds and charges its measured 43 row writes. Cold recovery preserves
1,083,471 knowledge records, 55,296 memories and all 108 Citizens. These are local
measurements; production still requires the autonomous quiet gate.

## Observer delivery and sample timing

The ephemeral public gzip cache includes the complete `{ok:true,world:...}`
response envelope. Clients accepting gzip receive its bounded compressed stream
directly, using Cloudflare's
[`encodeBody: "manual"`](https://developers.cloudflare.com/workers/runtime-apis/response/).
Other clients, including `gzip;q=0`, receive ordinary JSON. Native HTTP automatic
decompression reproduces the exact previous 8.29 MB public JSON for the saved
dense fixture. Canonical checkpoint encoding and seals keep their default format.

Quiet verification samples scheduler freshness immediately after reading health,
before downloading the public state. Its sixty-second freshness threshold is
unchanged. The starting health baseline is read after the initial state download,
so pre-quiet progress cannot satisfy the advancement gate. Minimum saved progress,
checkpoint cutoff before the final read, lag and physical Citizen checks remain.
