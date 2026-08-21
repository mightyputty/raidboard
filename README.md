# Tarkov Raid Board

Ranks Escape from Tarkov maps by how much quest progress one raid there is worth, and gives you a
per-map checklist of every objective, key and item to bring. It fills in your journal by reading
the game's own log files, the same trick TarkovMonitor uses — nothing to tick off by hand.

## Running it

```
node board.js
```

That reads your EFT logs, starts a local server on `http://127.0.0.1:8778/` and opens it. Nothing
leaves your machine and nothing is written to the game folder — the logs are opened read-only.

```
node board.js --port 9000                 use a different port
node board.js --logs "D:/EFT/Logs"        point at a different install
node board.js --no-open                   don't launch a browser
```

It can run alongside TarkovMonitor; both just read the same files.

## What it reads, and how

Two chat messages in `push-notifications_*.log` carry quest state. When a trader hands you a
briefing the client logs a message of type **10** with `templateId: "<questId> description"`; when
you turn a quest in it logs type **12** with `"<questId> successMessageText"`. Latest event per
quest wins, so accept-then-complete resolves correctly. Neither field is documented by BSG, but
both have been stable and they reconstruct your journal exactly.

Raids come from `application_*.log`: `RaidMode: Online, ... Location: bigmap, ...` on the way in
and a `RaidEnd` line on the way out. When you load into a raid the board jumps straight to that
map's plan (Setup → **Follow me into raids** turns it off).

There is a **Sync** button in the top bar, next to the green pill, because the moment you want it
is the moment you are back from a raid — you should not have to go to Setup to find it. It re-reads
every log folder on demand; the green pill and the button in Setup do the same thing. The page also
syncs automatically whenever it reconnects to the watcher, so a restarted or briefly-stopped watcher
no longer leaves the page showing stale progress. A live event always beats a value you set by hand,
since the game just told us what actually happened.

**The limit worth knowing:** the logs only reach back as far as the session folders the game has
kept. Quests you finished before the oldest folder show as *not started*, because nothing in the
logs mentions them. Fix those by hand in the Quests tab — anything you set yourself always beats
the logs, and those rows are tagged `manual`. Setup → **Clear manual changes** hands control back.

PMC level and faction are not in the logs; set them in the header. They only affect the optional
*Everything unlocked* planning mode.

## What to bring

The four columns at the top of a Map Plan are shopping lists, not per-quest notes: three quests
each wanting two markers add up to one line reading **5× MS2000 Marker**, biggest quantities first,
so you can stock up in one pass. Objectives that accept any of several items read
`any of: A / B` and are never multiplied together. The found-in-raid list on the Raid Board totals
the same way.

## Where to go

The Map Plan draws the actual map with every objective pinned and numbered. The numbers match
the checklist underneath: click a number in the list to flash its pin, click a pin to jump to its
row. Scroll to zoom, drag to pan, **Reset view** to fit.

Hover any pin and a tooltip names the quest it belongs to and the objective in full, so you can read
the map without hunting for the matching row in the list below.

Tick an objective off and its pin leaves the map straight away, so what is left on screen is only
what you still have to do; the pinned count in the header follows. Untick it and the pin comes
back. Nothing else moves while you do this — the list deliberately does not re-sort under your
cursor mid-raid.

## Screenshots from the wiki

Every quest on a Map Plan has a **Screenshots** button that opens the location shots from the
Escape from Tarkov wiki — the "the container is on this shelf" pictures, and the annotated floor
maps that go with them.

The page never talks to the wiki. The local server fetches a quest's images the first time you ask
for one, scales them down, writes them to `data/wiki/`, and serves them from disk from then on — so
they open instantly the second time and still work with no connection. Only the quests you actually
open are ever fetched, and the browser only ever sends the server a quest id, so it cannot be
talked into fetching something else. Delete `data/wiki/` any time to reclaim the space.

Quests whose wiki page carries no location shots say so rather than showing an empty strip.

Pins are not screenshots — they are the real in-game coordinates that ship with tarkov.dev's data,
projected onto the vector maps from
[tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps). Zones are drawn as their
true polygon, so a pin shows the *area* the game accepts, not a guessed dot. 534 of 1455 objectives
have coordinates — the "go to this spot" kinds (visit, find item, plant, mark). Kill and extract
objectives have nothing to pin and simply get no number.

The projection is `bounds[0]` → viewBox top-left, `bounds[1]` → bottom-right, in raw game units.
That was verified rather than assumed: rasterising each map and testing every known extract, spawn
and quest zone against it puts 97–100% of points on drawn geometry on nine of the ten maps, and no
other orientation comes close. Factory is inconclusive (it is small and heavily multi-level) so it
follows the same convention as the rest.

Extract names are labelled too, so the pins have landmarks to sit between — PMC and shared exits in
bone, scav exits dimmer, transits to other maps in cyan as `→ Woods`, all of them behind the quest
pins because they are context rather than the thing you came to read. **Exits & transits** in the
card header turns them off. Labels hold a constant size on screen however far you zoom, and ones
near the right edge hang to the left of their marker so nothing runs off the drawing.

Quest objectives that name a specific extract are *not* linked to those labels: the game writes
internal ids in the objective (`Sandbox_VExit`, `E9_sniper`) that do not match the extract records,
and guessing the mapping would be worse than leaving it alone.

Ten maps have drawings. **The Lab, The Labyrinth and Icebreaker do not** — those say so instead of
showing an empty frame. Terminal and Icebreaker have no extract data upstream either.

## Parking a quest

Every quest has an **Ignore** button — on the Quests page and on each quest in a Map Plan, so you
can park one the moment you notice it while planning a raid. An ignored quest keeps whatever status
it has, but counts for nothing: not the map scores, not the quest and objective totals, not the
keys and loot lists, and it gets no pin on the map. For the ones you cannot do yet, will not do, or
are saving for a friend.

They do not vanish, though. A Map Plan lists its ignored quests at the bottom under a divider,
greyed out with their tick boxes disabled and an **Un-ignore** button, so you can see what you have
parked on that map and put one back in a single click. The Quests page also has an **Ignored**
filter, and the count shows under the journal tile.

## Story chapters

The ten chapters that lead to an ending — Tour, Boreas, The Ticket and the rest — get their own
tab. They are a different animal from trader quests:

- **They have no trader.** The game hands them to you and they sit in your journal all wipe, so
  the board treats them as permanently active until you mark one finished.
- **tarkov.dev does not carry them at all.** Not under those names, not under any — every one of
  the 517 quests it ships has a trader. The chapters are read from the wiki at `--refresh` time
  instead, 461 objectives across the ten.
- **Nothing in the game logs reports their progress.** The only trace the client leaves is a
  `chapters_icon/<id>.png` texture load, which proves a chapter exists and says nothing about how
  far through it you are. Chapter progress lives server-side in your profile, and the log's API
  response bodies are blanked. So these are ticked by hand — there is no honest way to automate it.

They score by exactly the same rule as everything else, which means most of a chapter scores
nothing: only objectives that name a map count, so "Talk to Skier" and "Hand over 5 PMC dogtags"
are worth zero, the same as any trader turn-in. 76 of the 461 objectives carry a map. In practice
the chapters add between 2 and 8.5 points to a map's score.

Objectives that do name a map appear on that map's plan alongside your trader quests, so a Woods
raid shows Tour's "Eliminate any 3 targets on Woods" next to everything else you were going there
for. Sub-objectives are indented under their heading; headings themselves are not tickable and
never score, because the work is in their children.

### What to do, and where

A chapter of 118 objectives is no use as a bare list, so each objective carries the wiki's own
directions for that step. Anything with a **Guide** button opens the paragraph the wiki wrote for
it plus its location screenshots — the button reads `Guide · 6` when there are six pictures.

The pictures are the good part. The wiki keeps them in captioned galleries under each step, so
"Hand over the AMG-10 fluid to Prapor" opens six numbered spawn shots, each captioned with where
it is: *"3: On the pallet with the spotlight in the northern storage area of the black bishop
building basement"*. 172 of the 461 objectives have directions and 107 have screenshots.

Matching a guide section to an objective is done on the wording. Exact matches are claimed first,
so pages that repeat the objective verbatim (Boreas does, for 60 of its 91) are never guessed at;
the rest are scored on word overlap, which catches "Search the top management offices" against
"Search the top management offices in The Lab". Sections that still match nothing — pages like
Tour label them by trader and map instead, "Ragman - Interchange" — are listed under **Also in the
guide** at the foot of the chapter rather than being attached to the wrong step.

Some of the best directions are not on the chapter page at all. The Sailor's diary has its own
page with a `==Location==` section — *"On the desk in crew room no. 18 on level 4 of Icebreaker.
A Boreas crew quarters keycard is required to access it"* — and three captioned pictures, and The
Ticket never links it. The item declares the relationship instead ("one of the minor evidence used
in The Ticket"). So candidates are gathered from both directions: pages a chapter links, and pages
that link the chapter. An item is kept only if its Location section has a gallery; without pictures
it is invariably a generic loot list ("Sport bag, Toolbox, Dead Scav") and no use to anybody.

27 items pass that bar, carrying 173 pictures. Nine are linked outright by an objective and sit
inside that objective's Guide; the other nineteen are listed under **Where to find the items** at
the foot of the chapter, since nothing says which step wants them. The Ticket gains thirteen this
way, which is most of what it has — its own guide only covers 11 of its 145 objectives.

Guides work on the Map Plan too, so a story objective there opens the same directions as the
Story tab. Trader quests do not have this yet: tarkov.dev gives us their objectives but not their
guides, and reading 517 more wiki pages is a separate job.


Chapters can be **Ignored** like any quest, which is the thing to do with the eight you are not
working on — they keep their ticks and stop counting anywhere.

## The score

| | |
|---|---|
| **3 points** | per quest the map would finish outright |
| **1 point** | per objective that can *only* be done there |
| **0.4** | per objective you could also do elsewhere |

Optional objectives count half. Trader turn-ins, trader levels and skill grinds score nothing —
they are not raid work. Sort by **Per minute** to weigh a 20-minute Factory run against 45-minute
Shoreline.

## Refreshing quest data after a wipe or patch

```
node build.js --refresh
```

Pulls current data from tarkov.dev, rebuilds `data/tarkov-data.json` and both HTML files. Plain
`node build.js` rebuilds the pages from cached data after editing `src/`.

## Known gaps in tarkov.dev's data

Their GraphQL API was returning `422 GraphQL server unavailable` when this was built, and the
static JSON dumps it feeds are only partly populated:

- **Stale maps on reworked quests.** When BSG moves an objective, tarkov.dev's description text
  follows but its `maps`, `requiredKeys` and coordinates can stay pointed at the old place. The
  build catches this by reading the objective text: if it names a map the data does not list, the
  text wins, and the keys and coordinates filed against the contradicted map are dropped with it —
  they describe somewhere the objective is not. Three objectives are corrected today (Vitamins to
  Factory, Supplements to Customs, Offensive Reconnaissance to Shoreline), and they carry a
  **moved from …** chip so you can see it happened. Vitamins was the one that used to demand the
  Health Resort west wing 112 key for a container that now sits on Factory.
- **Quest chains.** 220 quests carry their unlock requirements and 162 more were recovered from
  TarkovTracker's 2024 dump (tagged `chain: 2024 data`). **135 still have none**, mostly quests
  added since 2024. This only degrades the *Everything unlocked* mode; log-driven journal tracking
  does not use the chain at all.
- **Kappa flags.** Only 13 quests come back flagged Kappa-required, which is wrong by an order of
  magnitude, so the Kappa filters hide themselves until the count looks sane (`KAPPA_OK` in
  `src/app.js`).

Re-run `--refresh` once tarkov.dev recovers and both should heal.

## Layout

```
board.js                       run this — log watcher + local server
lib/logs.js                    log parsing and tailing
lib/story.js                   story chapters, read from the wiki
build.js                       fetch + reduce + assemble
src/shell.html                 markup and styles
src/app.js                     scoring and UI
data/tarkov-data.json          reduced dataset (517 quests, 1455 objectives, 13 maps)
data/maps/*.svg                vector maps, downloaded once by `build.js --refresh`
data/wiki/                     wiki screenshots, fetched on demand and cached
lib/wiki.js                    wiki image lookup and caching
tarkov-raid-board.local.html   the page board.js serves
tarkov-raid-board.html         same page without the <html> wrapper (used for publishing)
```

Opening `tarkov-raid-board.local.html` directly still works, but a `file://` page cannot reach the
watcher or load the map drawings — you get manual tracking and no maps. Run `node board.js`.

Map variants are merged into the map you actually load into: Night Factory → Factory, Ground Zero
21+ and the tutorial → Ground Zero, The Lab (Dark) → The Lab. Data is the PVP quest list; PVE
differs only in a few event quests.
