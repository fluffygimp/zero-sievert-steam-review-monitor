# ZERO Sievert Steam Review Monitor

A dependency-free local dashboard for monitoring ZERO Sievert's Steam review label risk, 30-day review trend, developer-response gaps, and latest Steam community announcement signals.

## Run

```powershell
npm start
```

Open http://localhost:4173.

## What It Tracks

- Last-30-day review score calculated from public Steam review data.
- Steam-style label thresholds for Mixed, Mostly Positive, Very Positive, and Overwhelmingly Positive.
- A no-new-reviews projection showing how the label changes as current reviews age out of the 30-day window.
- Positive-review KPI needed to reach the next threshold.
- Negative-review budget before the current threshold drops.
- Recent positive/negative reviews, including developer-response status.
- Latest Steam community announcement metadata and recurring post topics.

## Source Notes

- Reviews use Steam's public `store.steampowered.com/appreviews/<appid>` endpoint documented by Steamworks.
- Community posts use `ISteamNews/GetNewsForApp/v2` plus public Steam announcement page metadata for counts.
- Steam exposes announcement comment counts in public event metadata. Comment text itself is less reliably available without authenticated community-thread access, so this prototype records availability and counts rather than pretending the text scrape is guaranteed.
