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

**Gives you the wiki's directions inline.** 364 quests carry the wiki's own guide and its location
screenshots, captioned, behind a Guide button — *"The docs under the bed of cabin #3"* with the
picture to match, without leaving the page. Story chapters go further and attach directions to
individual objectives.

**Covers PVP and PVE.** About 25 quests each way exist in only one mode; the Mode control in the
header switches between them. Everything else is shared.

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

### Or just download it

`raidboard.exe` is the whole thing in one file — the board, the maps, every guide, and the log
watcher. Double-click it and your browser opens. No Node, no install, no terminal.

Windows will warn you about an unrecognised app the first time. That is unavoidable without a
$200-a-year code signing certificate: the file is a copy of Node with the board injected into it,
which invalidates Node’s own signature. The source is here and `npm run package` rebuilds it
byte for byte if you would rather not take my word for it.

Build it yourself with:

```
npm install
npm run package
```

## How the tracking works

There are two ways to get your journal in, and the board picks whichever is available.

**Running it locally**, the watcher reads the logs in the background whether or not the page is
open, in any browser, with no permission prompt.

**On the hosted site**, the page asks for your `Logs` folder once through the browser's folder
picker and remembers it. It reads while the tab is open. Nothing is uploaded — on a static site
there is no server to upload to. Chrome and Edge support this; Firefox does not, and falls back
to ticking by hand.

Three chat messages in `push-notifications_*.log` carry quest state. When a trader hands you a
briefing the client logs a message of type **10**; when you turn a quest in it logs type **12**;
and when one fails it logs type **11**. That last one is worth knowing about — the message's own
`text` field still reads *quest started* on a failure, so only the type tells the truth.
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

**Not every quest has a guide.** 364 of 540 do. The wiki has not written one for the rest, and that
reads as *nothing written for this one* rather than as a broken feature.

**Screenshots come from the wiki's servers.** They are hotlinked from the Escape from Tarkov Wiki's
CDN, so opening a guide is the one thing in the app that reaches outside your machine. Your logs
and your progress never do.

**136 quests are missing their unlock chain** upstream at tarkov.dev, mostly recent additions. That
only weakens the *Still gated* filter and the cascade when you mark a quest done. What is in your
journal comes from your own logs and is unaffected.

**Faction still has to be set by hand.** USEC and BEAR appear nowhere in the logs, so the Side
control in the header is yours to set. Same for your level.

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
