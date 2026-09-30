# Living World / Physical Continuity

CYMONIA should look alive because the world remembers what happened to it, not because the Observer invents decoration.

This layer adds physical continuity without scripting a society.

## What changes

### Movement becomes geography

Every completed journey leaves bounded traffic evidence. Frequently used cells gradually become visible trails and reduce movement cost a little. Traffic decays if a route stops being used.

No road is created by decree. A route becomes a path because Citizens keep walking it.

### Water is a changing physical feature

The river keeps the same deterministic course, but rain and soil moisture affect its width, depth and flow. Crossing water costs more time and energy. Wet ground remains distinct from dry ground.

### Materials have to travel

A Citizen still has to gather and carry construction inputs. When construction begins, the material is physically staged at the site and is no longer carried in the builder's inventory.

Loose material clusters are shown as observer-derived stockpiles. A stockpile is a usage pattern, not a property claim.

### Construction has phases

Projects move through:

`site → foundation → frame → roof → enclosed → complete`

The phase is derived from real accumulated work. Materials remain conserved and construction can be inspected before the final building exists.


### New buildings require observed demand

Finishing a structure is not evidence that another one should immediately be built.

The Local Brain now evaluates a bounded construction-demand signal before a **new** project can become an affordance. The signal can rise because of:

- isolation from known usable structures;
- crowding relative to local capacity;
- rain, cold or heat exposure;
- sustained use of existing structures;
- material/storage pressure.

It falls when the Citizen knows about unused local structures, when nearby construction is already in progress, or when that Citizen has only recently helped complete another structure.

This is not a housing quota. There is no canonical maximum building count, no one-house-per-person rule and no global omniscient saturation check. A distant structure the Citizen has never perceived is not used as evidence against a local need.

Demand evidence is retained with a project so the Observer can explain why the project existed.

### Structures become places

The world records how much a structure is actually used, including rest/sleep time and frequent users. This does **not** assign ownership.

Repeated use can make a structure function like a home, meeting place or shared shelter before any social concept for that use exists.

### Ecology reacts to use

Harvesting creates local ecological pressure. Renewable resources still draw matter from natural reservoirs, but heavy recent extraction slows renewal. Food renewal also follows seasonality and timber responds to moisture.

### Day and night matter

Perception range falls at night and during heavy rain. Darkness slightly increases exploration risk and makes rest more attractive, but there is no hard-coded bedtime.

### Practice and tools matter

Repeated physical work builds bounded procedural skill. Transformed artifacts with useful physical properties can reduce the time needed for gathering, cutting, digging, carrying, assembling and building.

The simulation does not need an item named `axe` to obtain an axe-like advantage: the advantage comes from the artifact's measured properties and the action being attempted.

### Reputation remains causal

Care, communication, transfer, violence and cooperative construction update relationships through canonical events. Public reputation is a summary of those relationships, not a hidden morality score.

### Settlements are observed, not declared

The kernel never creates a `village` because a threshold was crossed. The Observer may classify a persistent cluster when structures, repeated use, traffic and population coexist long enough.

The classification is explicitly `observerOnly` and cannot mutate the world.

### Knowledge stays local

Citizens keep bounded spatial memories of entities they actually encountered. Planning can use those remembered positions, while unknown distant population is not treated as omniscient information.

## Invariant

The Living World layer must stay bounded in persistent state:

- traffic cells are capped and decay;
- spatial memory is capped per Citizen;
- structure-use contributors are capped;
- stockpiles and settlements are derived projections;
- no visual classification creates canonical facts.

The rule remains:

> AI may suggest. Citizens may act. Physics decides. The Observer only describes.
