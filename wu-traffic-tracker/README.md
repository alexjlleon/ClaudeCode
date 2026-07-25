# WU Traffic — visitor & funnel tracker

A small Node/Express app that logs visitor activity on weddingsunlimited.com
(page views, clicks, form/funnel milestones) and shows them in a live admin
table — same idea as the competitor panel this was modeled on, rebuilt for
your own funnel.

## What's inside

- `server.js` — API + admin auth
- `db.js` — SQLite storage (file-based, no external DB to stand up)
- `public/tracker.js` — the snippet you embed on weddingsunlimited.com
- `views/index.html` — the admin dashboard (`/admin/`)

## 1. Deploy to Railway

1. Push this folder to a new GitHub repo (or a new Railway project via CLI).
2. In Railway: **New Project → Deploy from repo**.
3. Add a **Volume**, mounted at `/app/data` — this is what makes the SQLite
   file survive redeploys. Without it, event history resets on every deploy.
4. Set these service variables (see `.env.example`):
   - `ALLOWED_ORIGINS` = `https://weddingsunlimited.com,https://www.weddingsunlimited.com`
   - `ADMIN_USER` / `ADMIN_PASS` — your dashboard login
   - `DB_PATH` = `/app/data/traffic.db` (matches the volume mount)
5. Deploy. Railway gives you a URL like `wu-traffic-tracker.up.railway.app`.

Dashboard lives at `https://<your-railway-url>/admin/`.

## 2. Embed the tracker on weddingsunlimited.com

Since this is WordPress/Avada, add the script through **Avada → Theme Options →
Scripts** (or a header/footer snippet plugin) so it loads site-wide — adding it
through post content directly won't work, since WordPress's REST API strips
`<script>` tags from post content.

```html
<script src="https://<your-railway-url>/tracker.js" async></script>
```

That's it — it auto-tracks every page view. No further setup needed for
general site traffic.

## 3. Track funnel steps

For milestones you want highlighted (like the yellow/green rows in the
reference screenshot), call `wuTrack` from anywhere on the page — e.g. a form
plugin's "on submit" hook, or inline on a button:

```html
<!-- Auto-tracked click, no JS needed -->
<a href="/book-now" data-wu-track="Clicked Book Now" data-wu-type="milestone">
  Book Now
</a>
```

```js
// Manual call, e.g. after a Gravity Forms / CF7 submit event
wuTrack('Submitted DJ inquiry form', {
  type: 'success',
  meta: { service: 'DJ', event_date: '2026-10-03' }
});

wuTrack('Inquiry form validation failed', { type: 'error' });
```

`type` controls the row color in the dashboard:
- `success` → green (bookings, completed inquiries)
- `milestone` → yellow (checkout/summary-type steps worth noticing)
- `error` → red
- anything else → plain row

## Notes / next steps

- IP + a persistent session id are captured automatically, so you can click
  an IP in the dashboard to see everything that visitor did across pages.
- This is intentionally minimal — no dashboards/charts yet, just the raw feed,
  matching what you saw. Happy to add daily/weekly rollups, funnel drop-off
  charts, or hook it into the chatbot or staff-tools admin instead of a
  separate URL, once this is live and you know what you actually want to see.
