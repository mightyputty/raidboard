# Raid Board

Ranks Escape from Tarkov's maps by how much quest progress one raid there is actually worth, then
tells you exactly what to bring and where to go once you load in.

It fills in your quest journal by reading the game's own log files, so there is nothing to tick off
by hand to get started.

> **Other trackers tell you which quests you have. This tells you which raid to run.**

## What it does

**Ranks the maps.** Every quest in your journal is broken into objectives, and each map is scored on
what it would actually finish: 3 points for a quest it completes outright, 1 for an objective that
can only be done there, 0.4 for one you could do elsewhere. Sort by total value, or by value per
minute to weigh a 20-minute Factory run against 45 minutes on Shoreline.

**Tells you what to pack.** Each map's plan opens with four shopping lists — keys, gear, loot to
find, quest items to grab — totalled across every quest you have. Three quests each wanting two
markers become one line reading **5× MS2000 Marker**, biggest quantities first.

**Shows you where to go.** The map plan draws the real vector map with every objective pinned and
numbered, using the actual in-game coordinates rather than a screenshot someone drew on. Zones are
drawn as their true polygon, so a pin shows the area the game accepts. Tick an objective off and its
pin leaves the map straight away.

**Gives you the wiki's directions inline.** Objectives carry the wiki's own instructions and its
location screenshots, captioned — six numbered spawn photos for a quest item that has six spawns,
without leaving the page.

**Tracks the story chapters.** Tour, Boreas, The Ticket and the other seven. No other tracker has
these, because they are not in tarkov.dev's data at all — they are read from the wiki.

## Running it

```
node board.js
```

That reads your Tarkov logs, starts a local server on `http://127.0.0.1:8778/` and opens it.

```
node board.js --port 9000               use a different port
node board.js --logs "D:/EFT/Logs"      point at a different install
node board.js --no-open                 do not launch a browser
```

It runs happily alongside TarkovMonitor — both only read the same files.

A hosted version and a one-file download that needs no Node install are both in progress. See
[the build plan](docs/plan.html).

## How the tracking works

Two chat messages in `push-notifications_*.log` carry quest state. When a trader hands you a
briefing the client logs a message of type **10**; when you turn a quest in it logs type **12**.
Latest event per quest wins, so accept-then-complete resolves correctly. Neither field is documented
by Battlestate, but both have been stable, and together they reconstruct your journal exactly.

Raids come from `application_*.log`, so when you load into a map the board jumps straight to that
map's plan.

There is a **Sync** button in the top bar, because the moment you want it is the moment you are back
from a raid. The page also re-syncs whenever it reconnects to the watcher.

**The limit worth knowing:** the logs only reach back as far as the session folders Tarkov has kept.
Quests you finished before the oldest folder show as not started, because nothing in the logs
mentions them. Fix those by hand in the Quests tab — anything you set yourself beats the logs, and
those rows are tagged `manual`.

Your level and faction are not in the logs at all, so those two stay manual.

## Your data

Nothing leaves your machine. The game's logs are opened **read-only** and nothing is ever written to
the Tarkov folder. Your progress lives in your browser's local storage; there is no account, no
server and no telemetry. Setup has an export button if you want a backup.

The only outbound requests the local server makes are to fetch a wiki screenshot the first time you
open one, and those are cached to disk afterwards.

Nothing is injected into the game and no game memory is read. This works the same way TarkovMonitor
does — by reading log files the game already writes.

## What it will not do

**Kill and extract objectives get no pin.** There is nowhere to put one. 534 of 1455 objectives have
real coordinates — the go-to-this-spot kinds.

**Three maps have no drawing.** The Lab, The Labyrinth and Icebreaker say so rather than showing an
empty frame.

**Some quests have no guide.** The wiki has not written one for every objective, and that reads as
*nothing written for this one* rather than as a broken feature.

**136 quests are missing their unlock chain** upstream at tarkov.dev, mostly recent additions. That
only weakens the *Still gated* filter and the cascade when you mark a quest done. What is in your
journal comes from your own logs and is unaffected.

**PVE is not distinguished yet.** The quest list is the PVP one; the two differ by about 25 quests
each way. PVE support is next.

## Where the data comes from

Quests, maps, keys and objectives come from [tarkov.dev](https://tarkov.dev). Vector maps come from
[tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps). Story chapters, quest
guides and location screenshots come from the
[Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com), used under CC BY-SA 3.0.

If a guide is wrong, fixing the wiki fixes it here on the next rebuild.

Escape from Tarkov is a trademark of Battlestate Games. This project is not affiliated with them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that matters: never write to the game folder.

MIT licensed.
