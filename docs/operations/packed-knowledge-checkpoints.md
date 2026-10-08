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
