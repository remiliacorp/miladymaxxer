# Feature Backlog

## Planned

### Quote Tweet Draft Button
- Inline button on milady posts (next to like/retweet/reply)
- Opens QT compose modal with pre-filled content (copies original tweet text)
- User reviews and clicks Post — no auto-posting
- Technical: DOM manipulation → click retweet → click Quote → insert text into compose textarea
- Risk: Low (just drafting, user retains control)
- Effort: ~2-3 hours

### Auto-Reply "milady" Button
- Inline button on milady posts
- Clicks reply → types "milady" → clicks send, all instantly
- Needs cooldown (max 1/min) to avoid spam flags
- Should be off by default, opt-in in settings
- First-time confirmation dialog
- Technical: same DOM manipulation pattern as QT, plus auto-send
- Risk: Medium (automated posting — X could rate-limit or flag)
- Effort: ~2-3 hours

### Timeline Thread Margin Tightening
- Currently only tightens in /status/ thread view
- Would be nice to also tighten on timeline reply chains
- Challenge: reliably detecting reply chains vs independent posts on timeline
- Previous attempts using border-bottom check had false positives
- Needs a more robust signal (e.g., "Show this thread" text, or "Replying to" indicator)

### Popup Avatar Preloading
- Account PFPs don't load in popup until tab switch
- Partially fixed with referrerPolicy="no-referrer" and reactive getAvatarUrl
- May need background script fetch + caching for full reliability

### Remote Milady Database
- Opt-in sync of caught miladys to a central database
- Requires RemiliaNet API integration
- Would enable global leaderboards and milady verification
- Scoped for future when API is available
