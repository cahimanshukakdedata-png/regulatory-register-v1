# Regulatory Register

A register of Indian GST, Income Tax, TDS/TCS, Companies Act, ICAI/Ind AS, SEBI, RBI/FEMA, labour and Maharashtra updates. It collects them on its own. It does not use Claude or any other AI.

## How it works

```
GitHub Actions (free, runs 4 times a day)
   └─ scraper/run.mjs visits every site in scraper/sources.json
        ├─ Feeds (RSS)       RBI, SEBI, TaxGuru sections
        ├─ Page watch        CBIC, GST Council, CBDT, e-Filing, MCA, ICAI, NFRA, EPFO, ESIC, MahaGST
        └─ News search       one Google News query per section, as a safety net
   └─ takes notes: sentences mentioning notifications, amendments, dates, amounts;
      notification/circular/G.S.R. numbers; future due dates and effective dates
   └─ writes data/updates.js (last 30 days) and data/archive.js (older, kept for 100 days)
index.html reads data/updates.js. Press Refresh to load the latest collection.
The older file is loaded only when you open "Last 90 days" or pick an older date.
```

## Using the page

- **Today** opens first. It lists everything published or collected today, grouped by section, with anything due today at the top.
  - Switch to **Yesterday** or pick any date in the last 100 days.
  - Click a section chip (GST, Income Tax…) to narrow the list.
  - **Copy digest for WhatsApp** copies the day's list as a numbered message with links, ready for a client broadcast.
- **Last 90 days** shows everything from the past 90 days, grouped by month, with the same section chips.
- **Everything** and the section tabs work as before, with a 7, 30 or 90 day period filter.
- **"Changes and notifications"** (the default filter) hides case law. Choose **Case law only** or **Everything collected** to see judgments.

"Today" follows Indian time. An item counts for a day by its published date. For website links that carry no date, it counts by the day the collector first found it.

**Page watch** works like this. On its first visit to a government page, the collector saves every link on the page. On later visits it reports only the links that are new. So official websites start showing items from the **second run onward**. Feeds and news searches show items from the first run.

## Set it up (about 15 minutes, no coding)

1. **Create a GitHub account** at github.com if you don't have one.
2. **Create a repository.** Click **New repository**, name it `regulatory-register`, choose **Public**, and click **Create**.
   A public repository keeps GitHub Pages free. The page only holds public information. Your read marks, stars and own entries stay in your browser.
3. **Upload the files.** On the new repository page, click **uploading an existing file**. Unzip the download and drag **everything inside the `regulatory-register` folder** onto the page. Then click **Commit changes**.
   - Check that `.github/workflows/update.yml` appears in the repository. Folders starting with a dot are sometimes hidden and skipped.
   - If it is missing, click **Add file → Create new file**, type `.github/workflows/update.yml` as the name, paste the contents of that file, and commit.
4. **Turn on the website.** Go to **Settings → Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
5. **Run the collector once.** Go to the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**. Then select **Collect updates** and click **Run workflow**. It takes about 3 to 5 minutes and shows a green tick when done.
6. **Open your register** at `https://YOUR-USERNAME.github.io/regulatory-register/` and bookmark it. It works on phone too.
7. **Run it a second time** later that day, or wait for the next scheduled run, so that the page watchers start reporting new official links.

After this, it runs by itself at about 7 am, 11 am, 3 pm and 8 pm IST.

- **Refresh** loads the newest collection.
- **Collect now** opens the GitHub page where you can start an extra run.

## Check the Sources tab after the first run

The **Sources** tab lists every site and whether the last run worked. Government sites vary:

- **Working, read N, kept N.** The site is fine.
- **"first visit: saved N existing links".** This is normal on the first run.
- **"page returned no usable links".** The site builds its content with JavaScript, which a plain fetch cannot read. The GST portal and MCA may do this. Those sections still get updates from their feed and news-search sources.
- **Failed, HTTP 403 or timeout.** The site blocked or dropped the request. Try again on the next run. If it keeps failing, edit or disable the source.

A failing source never stops the others.

## Changing sources

Edit `scraper/sources.json` directly on GitHub: open the file and click the pencil icon. Each source looks like this:

```json
{ "id": "cbic-gst", "name": "CBIC GST", "area": "gst", "kind": "page", "official": true,
  "url": "https://cbic-gst.gov.in/", "linkInclude": "notification|circular|\\.pdf" }
```

| Field | Meaning |
|---|---|
| `area` | Tab: `gst`, `it`, `tds`, `mca`, `acc`, `sebi`, `fema`, `labour`, `mh` |
| `kind` | `rss` for a feed URL, `page` to watch a web page for new links, `gnews` for a news search using `query` |
| `official` | `true` shows the green "Official site" label |
| `include` / `exclude` | Keep or drop items whose title matches these words (separate words with `\|`) |
| `linkInclude` / `linkExclude` | For `page` sources: which links count |
| `reclassify` | `true` lets the collector move items to a better tab (for example TDS news found in an income-tax feed) |
| `requireSignal` | `true` drops explainers and keeps only items that mention notifications, circulars, extensions and similar |
| `enabled` | `false` switches a source off without deleting it |

To stop a source, add `"enabled": false`. To test one source on your own computer, run `node scraper/run.mjs --only=cbic-gst`.

To change the schedule, edit the `cron` lines in `.github/workflows/update.yml`. Times there are UTC, which is IST minus 5 hours 30 minutes.

## Key items

`data/pinned.js` holds hand-curated entries: deadlines, schemes and amendments that matter to the practice. They stay pinned in their tabs and feed the deadline strip. Edit or remove them as they go stale.

## Running on your own computer instead

1. Install Node.js 20 or newer from nodejs.org.
2. In the folder, run `npm install` once.
3. Run `npm run update` whenever you want fresh data, then open `index.html` by double-clicking it.

To automate it on Windows, create a Task Scheduler task that runs `npm run update` in this folder a few times a day.

## Limits worth knowing

- **Notes are extracted, not interpreted.** The collector picks sentences that look substantive. It can miss the key sentence or pick a weaker one. Always open the source.
- **Dates are detected by pattern.** "Date found in text" means a future date appeared next to words like *extended till*, *last date* or *with effect from*. Verify before relying on it.
- **PDFs are listed by title only.** Many CBIC and CBDT documents are PDFs, so the collector records the title and link without reading the PDF.
- **News-search links go through Google's redirect** before reaching the publisher.
- **Commentary sites are filtered.** General explainers from news and commentary sites are not stored. Case law from them is kept as title and summary only, without notes, so the data stays small enough to load quickly on a phone.
- **Websites change layout.** When a page changes a lot at once, the collector saves the new layout quietly instead of flooding the register, and notes this in the Sources tab.

## Tests

Run `npm test`. This runs the collector against saved sample feeds and pages, with no internet needed.
