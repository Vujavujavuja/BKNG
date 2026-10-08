# BKNG

An open-source booking page you host yourself, for free, on Cloudflare. People pick a time, you both get a calendar invite, and everything from the colors to the emails is yours to change without touching code.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vujavujavuja/BKNG)

## What you get

- **A booking page** with a calendar, time slots in the visitor's timezone, and a form you design.
- **Meeting types** with their own length, weekly hours, date exceptions, notice period, buffers and daily limit.
- **Busy times blocked** from any number of calendars: Proton, Google, iCloud and Outlook by private link, or Google by direct connection.
- **Calendar invites for both sides**, attached to the confirmation emails, so the booking lands in any calendar.
- **Any meeting link**: paste a Proton Meet, Zoom, Jitsi or other link per meeting type.
- **A design editor** with live preview: logo, colors, background image, fonts, corner roundness, layout, step order, every label, and custom CSS if you want it.
- **Email templates** you can reword and restyle, with a live preview and a test button.
- **Reschedule and cancel links** for the person who booked, plus reminders.
- **A dashboard** with upcoming bookings, a 30-day chart and a setup checklist.
- **Your own domain**, as a subdomain (`book.example.com`) or a page on your site (`example.com/book`), or embedded in any website with one snippet.

## Set it up

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and a free [GitHub](https://github.com/signup) account. No terminal, no server.

1. Press **Deploy to Cloudflare** above and follow the prompts. Cloudflare copies the code to your GitHub, creates the database and puts the app online.
2. Open the address Cloudflare gives you (it ends in `workers.dev`) and add `/admin`.
3. Create your account. The first person to open a new install becomes the owner, so do this straight away.
4. Follow the checklist on the dashboard: connect a calendar, set up email, connect your domain.

### Calendars

On the **Calendars** page, paste your calendar's private link. The page shows where to find it in Proton, Google, iCloud and Outlook. The link only lets the app see when you're busy.

Bookings reach your calendar as an invite in the notification email, which Proton, Google, iCloud and Outlook all understand. If you want bookings written straight into Google Calendar, the same page has a guided Google connection.

### Email

Email needs a delivery service. On the **Emails** page, pick one and paste its key:

| Service | Cost | Notes |
| --- | --- | --- |
| Resend | Free for 3,000 emails a month | The app walks you through verifying your domain and can add the DNS records for you |
| Brevo | Free for 300 emails a day | |
| Cloudflare Email | Needs the $5 a month Workers Paid plan | |
| Postmark | Paid | |
| Any mail server (SMTP) | Depends | Proton Mail, Fastmail, Google Workspace and others |

Then set the sender, for example `bookings@yourdomain.com`, and send yourself a test.

### Your domain

On the **Domain** page, press the link to create a Cloudflare token (the permissions are pre-selected), paste it, pick your domain and choose a subdomain or a page on your existing site. This needs your domain's DNS to be on Cloudflare. If it isn't, use the `workers.dev` address or the embed snippet on the same page.

## Good to know

- **Proton Calendar has no public API**, so the app reads it through Proton's share link and writes to it by email invite. Changes you make in Proton can take a few minutes to show up as blocked time.
- **Calendars are checked every 15 minutes** and whenever someone opens the booking page.
- **Cloudflare's free plan** allows 100,000 requests a day and very little processing time per request. That is plenty for a booking page, but an unusually large calendar feed (years of history, thousands of events) may fail to sync. The Calendars page shows when that happens.
- **Passwords** are stretched in your browser before they are sent, because the free plan can't afford slow hashing on the server. Use a long password.
- **Images** you upload are stored in the database and limited to 1.5 MB each.

## What has and hasn't been tested

Tested end to end on a local Cloudflare runtime: setup, sign-in, the booking flow, double-booking protection, rescheduling, cancelling, calendar link blocking, sending through SMTP, serving under a `/book` path, the embed script and the design editor.

Written against the providers' documentation but **not yet run against the real services**: the Deploy to Cloudflare button, the Google account connection, the Cloudflare domain connection, and sending through Resend, Brevo, Postmark and Cloudflare Email. Please open an issue if one of these misbehaves.

## Working on the code

```bash
npm install
npm run dev
```

The app runs at `http://localhost:8787` with a local database. Other commands:

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run deploy
```

- `src/` is the Cloudflare Worker: API routes, booking logic, calendar sync and email.
- `ui/` is the React interface for the booking page and the admin panel.
- `shared/` holds the types and defaults both sides use.
- The database schema lives in `src/db.ts` and is applied automatically on first request.

## License

MIT
