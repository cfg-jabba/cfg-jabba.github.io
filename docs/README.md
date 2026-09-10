# Everly Grace — start here

A dropshipping storefront and operating plan for magnetic clasp converters,
targeting U.S. women aged 50–65.

## What's in here

| File | What it's for |
|---|---|
| [`BUSINESS-PLAN.md`](BUSINESS-PLAN.md) | Unit economics, the $250 budget, 30-day plan, go/kill criteria, risks |
| [`SUPPLIER-VETTING.md`](SUPPLIER-VETTING.md) | Where to source, what to demand in writing, the six physical tests, scorecard |
| [`AD-CREATIVE.md`](AD-CREATIVE.md) | Six video scripts, where to post, ad copy, the compliance line |
| [`EMAIL-FLOWS.md`](EMAIL-FLOWS.md) | Post-purchase, abandoned checkout, welcome sequences |
| [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md) | Every account to open and placeholder to fill, in order |

The storefront itself is in [`../everlygrace/`](../everlygrace/).

## The three numbers that matter

- **$16.86** — contribution margin per order, and therefore your break-even CPA.
- **8 oz** — minimum magnet pull strength. Below 6 oz, reject the supplier.
- **10,000 views** — the organic gate. No ad spend before one video clears it.

## Stack, and why

Everything is chosen to cost $0/month, because the budget is $250 and a
$39/month subscription is 16% of it before a single sale.

| Need | Choice | Cost |
|---|---|---|
| Hosting | GitHub Pages | $0 |
| Checkout | Stripe Payment Links | $0/mo, 2.9% + 30¢ per sale |
| Contact form | Formspree free tier | $0 |
| Email | MailerLite free tier | $0 to 1,000 subscribers |
| Fulfillment | U.S. blind-dropship supplier | per-order only |
| Domain | Namecheap / Cloudflare | ~$12/yr |

Revisit Shopify at ~100 orders/month, when the $39 stops mattering and you
want a real cart with variants.

## A note on what's deliberately unfinished

Three things are left as marked placeholders rather than filled in, on purpose:

1. **Product photography.** Five image slots in `index.html`. Shoot these
   yourself with the winning sample — using the supplier's own listing photos
   is the single clearest tell of a dropshipper, and this audience spots it.
2. **Customer reviews.** Three placeholder slots, with a comment explaining
   why they must not be filled with invented quotes. Real ones only, via the
   day-14 email.
3. **Business identity** — address, phone, entity name, and the legal-page
   blanks. These need to be real before any ad runs.

## Important

This repository also serves the legal pages and TikTok developer verification
file for **Clipper Studio Co** at the site root (`/index.html`, `/terms.html`,
`/privacy.html`, `/tiktok*.txt`). Those are untouched and must stay that way —
overwriting the root `index.html` would break that app's domain verification.
The store lives at `/everlygrace/` and has its own privacy and terms pages.

If you later want the store at the domain root, move the Clipper Studio pages
into a `/clipper/` subdirectory *first*, and re-verify the TikTok file location
before deleting anything.

## Legal

The privacy policy and terms of sale are working drafts written to match how
the store actually operates. They are not legal advice. Have a lawyer review
them before scaling, and talk to an accountant about entity structure and
sales tax — selling a magnetic product to a demographic that may have
implanted medical devices is a real reason to take that seriously.
