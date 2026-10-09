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

Bin staging and bounded batches of up to four hot snapshot parts have separate
atomic quota charges. Each part batch charges its rows and one shared budget row.
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

## Warm autonomous runtime

The production three-minute quiet gate passed after bounded attention, but its
following canonical-progress gate failed: scheduler arrivals remained fresh
while storage alarms were over a minute late. A bounded post-failure diagnostic
recorded scheduler requests and no delivered alarms. Between those arrivals an
otherwise idle Durable Object can hibernate, discarding unsaved in-memory work.

A single pending local timer now keeps the active simulation warm. Each callback
registers its asynchronous work with `ctx.waitUntil`; it rearms only after that
phase completes. Timer and alarm callbacks share one in-flight phase, so they
cannot queue extra writers. Storage alarms remain a durable restart mechanism
and commit their successor before recovery or physical work. Private scheduled
heartbeats activate the loop; public Observer reads do not activate or advance it.
This follows Cloudflare's documented
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

Timers do not renew Cloudflare's cumulative CPU window. A stale incoming request
pauses physical work until a genuine request arrives; encoding and cold recovery
require twelve seconds of remaining window. The post-decode challenge is retained.
Failed cold reloads retain a fifteen-second timer backoff even when no world graph
is resident. A skipped recovery alarm still leaves its successor and timer armed.

Checkpoint part staging shares one quota update per bounded four-part transaction,
retaining at most 6 MiB of ASCII parts before flush. Final partial batches flush
before manifest publication. Atomic charges, UTC rollover, incomplete staging and
the previous authoritative slot retain their existing semantics. Cadence and
reservation estimates include the actual shared charges. Twenty hot parts now
permit a 96-world-minute cadence, leaving room inside the unchanged 120-second
saved-state freshness window without raising the 40k/60k admission budgets.

A five-minute local native run with all storage alarm callbacks suppressed saved
289 world minutes, with lag 16, all 108 Citizen IDs, 37 moved Citizens, 108 changed
actions and 108 changed biological states. It retained 55,296 memories and grew
from 1,083,471 to 1,880,342 knowledge records; the original private source remained
readable. This verifies the timer driver with mature history; production must
still pass the unchanged CI gates and a separate ten-minute quiet proof.

The final batched native run cold-loaded 1,880,342 records and retained 2,016,419
by its end. Five alarm-free minutes saved another 225 world minutes, with lag 87,
all 108 IDs, 11 moved Citizens and 108 changed actions/biological states. The two
checkpoint commit gaps were 117.94 and 116.50 seconds. Incoming private scheduler
samples saw at most 103.06 seconds of checkpoint age and 118 committed lag.
Cadence ended at 110 minutes, without deferral, missing sources or memory failure.
The compressed durable archive held 61.8 MB while the bounded bin cache held
8.18 MB. This includes the four-part staging buffer in native workerd.

Keeping one 128 MB Durable Object warm for 24 hours costs approximately 11,059
GB-s, within the 13,000 GB-s Free daily account allowance before other usage.
See [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
Account request, CPU, storage and row limits still apply. This change neither
upgrades the plan nor promises unlimited retention or availability on a finite
Free account.

## Shared strings and compact exact lookup directories

The main deployment from PR 59 failed its production quiet gate with HTTP 503.
A single post-failure diagnostic on October 9 recorded an actual isolate memory
reset. Cold recovery contained 875,469 knowledge records, 875,471 sources, 50,255
memories and 12,023 objects. Earlier sparse native fixtures did not reproduce
the repeated concept/entity strings and large personal membership directories.

A bounded pool now shares detached immutable concept/entity/fallback/known-entity
strings (65,536 entries and 2 Mi code units maximum). It contains neither personal
membership nor evidence. Exact per-Citizen lookup directories retain Uint32
positions into their existing string arrays rather than full Map/Set buckets.
Hash collisions compare the complete original key; append, deletion, forgetting,
first-active duplicate selection and non-string keys preserve their semantics.
No canonical knowledge, object, source, chronology or private membership is removed.
The packed-v2 durable format and backward readers are unchanged.

The controlled native fixture reconstructs the public physical shape and 875,469
private knowledge records, 50,255 initial memories and 108 Citizens. An additional
3,585 inert object-shaped records brings object count to 12,023; these are synthetic
records because the public projection omits depleted objects. The old reader
exhausts a 96 MiB V8 old-space cap during cold recovery. String sharing alone passes
the smaller fixture but exhausts an 80 MiB old-space cap in the first physical phase
with all objects. Shared strings plus numeric lookup directories pass cold recovery,
thirty chronological minutes and checkpoint publication under 80 MiB old space
and 4 MiB semi space: 4 moved Citizens, 72 changed actions, 100 changed bodies, all 108
IDs retained. Sampled JavaScript heap plus ArrayBuffer backing peaks at 112.48 MiB.
Encoding takes 4.66 seconds; first physical phase takes 11.83 seconds. A subsequent
cold restart recovers minute 177,183 with 876,938 knowledge records and both sampled
original private sources intact.

These are local controlled measurements, not an exact reproduction of Cloudflare's
128 MiB account/runtime enforcement or a guarantee of indefinite capacity. Private
sources, cold lookup semantics, collision/deletion handling and the existing
known-entity read-count gate have regression coverage. Production must pass all
unchanged gates and a separate ten-minute quiet proof before stability clearance.

## Repeated harvest growth

Compact caches alone cannot make continuous allocation sustainable. The duration
audit found that every GATHER action created another physical object, possession
and personal entity ID, prompting all nearby Citizens to acquire another concept.
Repeated ordinary harvests now add matter to one compatible personal stack from
the same deposit. Existing objects/IDs and original provenance remain intact.
Every harvest still emits its own causal receipt; the stack points to the latest
physical event, whose causes also retain the prior stack contribution (or the
original action for a legacy stack). Reserved, heated, transformed, damaged, foreign and different-source
objects are excluded. Fractional availability caps the harvested quantity exactly;
a depleted source cannot manufacture the former minimum 0.1 kg of matter.

A thousand repeated harvests retain one new object and one new personal entity,
with all thousand distinct action receipts, 2,000 kg gathered and 3,000 kg remaining
in the source. This prevents this routine activity from growing object/concept
directories with elapsed time. Other genuine discoveries, births, transformations
and preserved historical records still consume finite resources; account-level
Free quotas remain external capacity constraints.

## Shared checkpoint index dictionary

PR60 removed the reproduced isolate memory reset, but its first production quiet
gate failed the saved-progress threshold. A separate 180-second sterile proof
advanced 213 saved minutes with 39 moved Citizens, 96 changed actions and 100
changed biological states. The saved-state cadence was 105 minutes: an arbitrary
180-second window can contain only one checkpoint and fail the unchanged
120-minute advancement gate.

The private checkpoint writer now emits a bounded shared string dictionary before
streamed Citizens. Its maximum is 65,536 strings/2 Mi code units; identifiers longer
than 4,096 units or beyond either bound remain inline. Packed-v3 knowledge stores
ordered references for concept/entity/fallback indices and personal known-entity
IDs. Original non-string values use tagged literals; the existing absent-concept
mask remains authoritative. No shared membership or private evidence is added.

The streaming reader resolves each Citizen to the existing packed-v2 logical
indices before archive hydration, then releases the temporary dictionary. Full
arrays and packed-v1/v2 remain readable. Missing dictionaries, invalid references,
malformed known-entity envelopes and invalid dictionary limits fail closed before
Citizen hydration. SHA-256 seals cover the exact dictionary and reference wire
bytes; immutable evidence bins and their digests are unchanged. Ordinary exports
continue to contain complete private records. No SQL rows, budgets or CI gates
are added or relaxed. Rollback after v3 publication requires this compatible reader.

The controlled native fixture cold-loads 878,451 historical records and 12,023
objects under 80 MiB V8 old space/4 MiB semi space, advances thirty chronological
minutes, preserves 108 IDs and saves in nine parts instead of sixteen. Physics
takes 11.06 seconds, encoding 4.77 seconds, and sampled heap plus ArrayBuffer backing
peaks at 105.20 MiB (105.57 MiB including measured embedder heap). Cold restart takes
2.50 seconds and recovers 879,084 records with sampled original private sources
intact. This reduces the nine-part normal cadence to 66–71 world minutes without
raising the 40k/60k budgets. Native measurements are controlled local evidence;
all main production gates and a separate ten-minute quiet proof remain required.


## Restart-safe public checkpoints and binary SQLite rows

The PR61 production run passed real autonomous progression (+202 saved minutes in
three minutes), but a later cold wake recovered the private checkpoint after the
RAM-only public projection had disappeared. Once live physics was ahead of the
saved minute, the Observer correctly refused to fabricate a public past from the
live graph and returned HTTP503. Passing the physics gate alone did not prove
Observer continuity.

The public projection is now compressed before canonical staging and embedded as
codec metadata in the same private checkpoint. The inactive slot is published
only after all parts and the canonical manifest commit. Recovery validates the
public gzip trailer and complete JSON envelope one root-array item at a time,
checks version/world ID/minute/ledger agreement, and removes codec metadata from
the logical world. The Observer can reuse this immutable saved view even when
live physics has already advanced. An interrupted publication retains the prior
private/public pair; a projection failure retains the last valid public view
while allowing private physics to commit.

Canonical SQLite rows now contain gzip bytes directly, bounded to 1,900 KiB per
row, instead of expanding them into base64. Up to four rows share each transaction
and its quota charge. Existing base64 snapshots and fragmented binary snapshots
remain readable; mixed, missing or truncated input remains fatal. Seals cover the
exact uncompressed wire bytes. No SQL tables, migrations, budgets or CI thresholds
are added or relaxed. Deploy rollback must retain the compatible binary reader.

The encoder allocates part buffers only when needed, emits a view of its final
partial buffer, and releases the temporary shared-index lookup dictionary as soon
as JSON input is consumed. After immutable bins have staged successfully, the archive also releases its
reloadable compressed/parsed read caches before encoding directory metadata.
Pending pages and durable evidence remain intact; subsequent physics reloads
only the bins it actually reads. This avoids retaining codec and read-cache
allocations during gzip flush and final SQLite staging. Regression coverage includes real cold physics
before the first Observer read, interrupted publication, projection failure,
malformed public metadata, encoded identity/time/ledger disagreement, binary
fragmentation, cancellation, exact seals and measured staging charges.



The release fixture cold-loads 928,878 original private records, 54,418 recent
memories and 12,026 objects under 80 MiB V8 old space/4 MiB semi space. It advances
thirty chronological minutes, retains all 108 Citizen IDs, changes six positions,
66 actions and 100 biological states, and commits in seven binary parts. Sampled
heap plus ArrayBuffer backing peaks at 119.40 MiB (119.77 MiB including measured
embedder heap). Reserved heap plus backing peaks at 130.39 MiB; reserved V8 space
is not equivalent to live memory or Cloudflare enforcement. These are sampled
local measurements, not an exact reproduction of the production limit. Using
1,900 KiB rows keeps fewer SQLite writes per checkpoint; releasing read caches
provides the measured live-memory headroom. Production CI and a separate ten-minute
quiet proof remain the release acceptance gates.


## Immediate cold CPU renewal

PR62's three-minute quiet proof passed (+156 saved minutes), but a later canonical
health sample found a cold recovered object with a stale tick (71 seconds) and a
fresh scheduler. The object subsequently resumed and the recovered public view
returned HTTP200. Bounded diagnostics reported no exceptions, so the reason for
that object replacement remains unproven.

A separate reproducible recovery delay existed: the scheduler waited for another
20-second slot to echo the post-decode CPU challenge. After an initializing
response, it now starts one private readiness request and then dispatches a genuine
post-response request immediately. Only a matching challenge arriving after decode
releases the gate; waiting for readiness alone never does. Two bounded echo attempts
handle replacement between challenge and echo. All requests and body reads in one
slot share its 45-second deadline. The other20/40-second slots remain independent;
warm requests retain their original cadence. Public traffic cannot reach this route.

Regression tests cover delayed decode across a Cron boundary, stale responses,
replacement during the echo, a hung readiness request, bounded repeated replacement
and preservation of the actual physical clock. Health explicitly reports whether
cold CPU renewal is pending; stale-tick checks and all CI thresholds remain intact.


All null-world rollback callers now share one recovery promise. Overlapping
readiness heartbeats, the timer and mutation recovery cannot hydrate concurrent
canonical graphs, dispose each other's archive or rotate independent challenges.
The promise clears after success or failure so a later incoming request can retry;
already consumed inference budget remains attached to the recovered world.
