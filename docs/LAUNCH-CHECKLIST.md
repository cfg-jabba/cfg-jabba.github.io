# Launch checklist

Work top to bottom. Nothing below the line marked **GATE** should happen until
everything above it is done.

## Accounts to create (only you can do these)

- [ ] **Stripe** — stripe.com. Business details + bank account. Free.
- [ ] **Stripe Payment Link** — Dashboard → Payment Links → New.
      Product "Magnetic Clasp Converter Set of 3", $29, shipping address
      collection **on**, U.S. only. Enable the order bump ($19 second set).
- [ ] Paste the link into `everlygrace/index.html` — the `data-stripe-link`
      attribute on the checkout button. The button stays disabled until you do.
- [ ] **Domain** — ~$12/yr. Namecheap or Cloudflare. Something warm and
      spellable over the phone.
- [ ] **Velvet jewelry display bust** — ~$10. The only filming kit you need.
      Search "velvet necklace display bust." Everything is shot on it or
      flat on a table; no one appears on camera.
- [ ] **GitHub Pages custom domain** — repo Settings → Pages → Custom domain.
- [ ] **Google Voice** — free U.S. number for the site and for Meta.
- [ ] **Business email** — an address at your own domain. Cloudflare Email
      Routing forwards to your inbox for free.
- [ ] **Formspree** — free. Paste the form ID into `everlygrace/contact.html`.
- [ ] **MailerLite** — free to 1,000 subscribers.
- [ ] **Supplier accounts** — Trendsi / Spocket / one other. See `SUPPLIER-VETTING.md`.

## Business setup

- [ ] Decide on sole proprietorship vs LLC. An LLC (~$50–500 depending on
      state) is worth it once you're selling a magnetic product to people who
      may have medical devices. **Talk to an accountant, not to me.**
- [ ] Check your state's sales tax registration requirements.
- [ ] Business bank account, separate from personal. Do this from order one —
      untangling it later is genuinely painful.

## Fill in every placeholder

Search the repo for `[` brackets and `YOUR_`:

- [ ] `everlygrace/contact.html` — email address, phone number, Formspree ID
- [ ] `everlygrace/privacy.html` — business name, address, email, dates, ad pixel section
- [ ] `everlygrace/terms.html` — business name, address, email, state, dates
- [ ] `everlygrace/index.html` — Stripe link, footer address + phone, 5 image slots
- [ ] Footer legal line on every page

Run this to find what's left:
```
grep -rn "YOUR_\|\[your\|\[set this\|\[Your\|PASTE_" everlygrace/
```

## Product

- [ ] Samples ordered from three suppliers
- [ ] All six physical tests run and scored
- [ ] Winner chosen, blind shipping confirmed **in writing**
- [ ] Second sample ordered from the winner (batch consistency)
- [ ] Your own photos shot for all five image slots — faceless, on the bust
      or flat-lay. Never the supplier's listing photos.

---

## ═══ GATE ═══

**Do not spend a dollar on advertising until everything above is checked and
one organic video has cleared 10,000 views or 300 saves.**

---

## After the gate

- [ ] Meta Business account + pixel installed
- [ ] $10/day behind the video that already worked organically
- [ ] Email flows live in MailerLite
- [ ] Stripe abandoned-checkout emails switched on
- [ ] Day-14 review request sent manually to the first 30 buyers

## Ongoing weekly

- [ ] Post daily to Reels / TikTok / Pinterest
- [ ] Answer every customer email within one business day
- [ ] Log CPA and contribution margin — check them against `BUSINESS-PLAN.md` §1
- [ ] Add any new real review to the site (and only real ones)

## Things to deliberately not do

- Don't buy Shopify yet. GitHub Pages + Stripe costs $0 and works.
- Don't add a second product until the first one has 50 orders.
- Don't scale ad spend faster than 20% every 3 days.
- Don't write your own reviews. Not once, not "just to seed it."
- Don't remove the pacemaker warning to improve conversion.
