# Contributing

Bug reports and pull requests are welcome. A few things worth knowing before you start.

## Running it

```
npm install       # there are no dependencies, but this creates the lockfile
node build.js     # rebuild the pages from cached data
node board.js     # start the local server on 127.0.0.1:8778
```

`node build.js --refresh` re-downloads everything: quest data from tarkov.dev, the vector maps,
the story chapters and the wiki guides. It takes a few minutes and hits third-party APIs, so use
plain `node build.js` while working on the UI.

## Where things live

```
board.js            local server and log watcher
lib/logs.js         reads the game's log files
lib/wiki.js         fetches and caches wiki screenshots
lib/story.js        story chapters and their guides, scraped from the wiki
build.js            downloads, reduces and assembles everything
src/shell.html      markup and all styles
src/app.js          scoring and UI
data/               generated; committed so the site works when upstream is down
```

## House rules

**Never write to the game folder.** The logs are opened read-only and that is the whole trust
model. A patch that writes anything into an Escape from Tarkov directory will be rejected.

**Verify claims about the logs.** The log format is undocumented and changes without notice. If
you add a parser for a new line, say in the commit message which log file and which game build you
saw it in, and how many times.

**Keep the data honest.** Where upstream data is wrong or missing, say so in the interface rather
than papering over it. There is already precedent: objectives whose map contradicts their own
description are corrected and carry a *moved from* chip.

**No telemetry, no accounts, no network calls from the page.** Progress lives in the browser.
The only thing that talks to the internet is the build, and the local server when it fetches a
screenshot you asked for.

## Data accuracy

Quest data comes from tarkov.dev and inherits their gaps. At time of writing 136 quests have no
unlock chain upstream. If you spot something wrong in the quest data itself, report it to
tarkov.dev rather than here; we pull whatever they publish.

Guides and screenshots come from the wiki. If a guide is wrong, fixing the wiki fixes it here on
the next rebuild.
