# UX & Content Guidelines

## 1. Trust architecture — what the user sees, and where

| Moment | Trust signal |
|---|---|
| First visit (header/footer) | Pharmacy name & city, "Licensed Belgian pharmacy", EU common logo, opening hours, phone to a pharmacist |
| Product page | Leaflet link, clear usage & warnings, "Checked by pharmacist" explainer for medicines, real stock status |
| Cart | Delivery cost & date estimate, limit explanations, secure payment logos (Bancontact first) |
| Checkout | Why we ask health questions, privacy reassurance ("Only our pharmacists see your answers"), review SLA |
| After order | Named pharmacist in approval e-mail ("Checked by Sarah, pharmacist"), tracking, discreet packaging note |
| Pharmacy page | Team photos, licence/authorisation numbers, address & map, history — the physical pharmacy behind the shop |

## 2. Tone of voice

- **Warm, clear, expert.** Like a good pharmacist at the counter: kind, precise, never pushy.
- Short sentences. Plain language (B1 level). Explain medical terms the first time.
- Second person ("you"); in French use **vous**; in Dutch use **je/jij** for brand, **u** for
  legal/medical texts (decide in Phase 0 with copywriter); German **Sie**.
- Safety > sales: never "Stock up now!" for medicines.
- Refusals are empathetic and actionable ("For your safety we can't send this product with
  your current medication. Call us on … or see your doctor.").

### Microcopy examples (EN source)

| Context | Copy |
|---|---|
| Review notice | "Your order contains a medicine. One of our pharmacists will check it before we ship — usually within 30 minutes during opening hours." |
| Quantity limit | "For your safety, you can order up to 2 packs of this medicine at a time." |
| Questionnaire intro | "A few quick questions help our pharmacist make sure this is right for you. Only our pharmacists can see your answers." |
| Privacy at checkout | "We never share your health information for marketing." |
| E-mail subject (neutral) | "Your IGS-Pharma order 1234 is on its way" (never product names) |

## 3. Internationalisation

- Copy authored in EN or NL/FR as source; professional translation for NL/FR/DE; legal and
  medical texts reviewed by a native-speaking pharmacist.
- Avoid text in images. Allow +35 % text expansion (German, French).
- Formats via `Intl`: `€ 12,95` (nl-BE/fr-BE: `12,95 €` per locale rules), dates `07/10/2026`,
  Belgian phone `+32 …`, postal codes 4 digits.
- Language switcher shows language names in their own language (Nederlands, Français, Deutsch, English).

## 4. Accessibility checklist (WCAG 2.2 AA)

- [ ] Contrast per [design system](design-system.md#22-measured-contrast-wcag-22--and-the-resulting-rules).
- [ ] All interactive elements keyboard-reachable, visible focus, logical order, skip link.
- [ ] Forms: persistent labels, programmatic errors (`aria-describedby`), no time limits in checkout
      (or extendable), autocomplete attributes, no CAPTCHA puzzles (use invisible/proof-of-work).
- [ ] Target size ≥ 24 px (we use 44 px), dragging alternatives (2.5.7), focus not obscured by sticky
      headers (2.4.11), consistent help location (3.2.6), redundant entry avoided (3.3.7),
      accessible authentication — passkeys/paste allowed (3.3.8).
- [ ] Images alt text per locale; decorative images `alt=""`.
- [ ] Leaflets available as accessible HTML or tagged PDF where source permits.
- [ ] Screen-reader test (NVDA + VoiceOver) on checkout before every major release.

## 5. Conversion UX (without dark patterns)

- Search is the #1 navigation in pharmacies → prominent search, brand ↔ substance synonyms,
  "did you mean", zero-result recovery with "Ask a pharmacist".
- Mobile-first checkout: Apple/Google Pay and Bancontact app redirect; address autocomplete;
  guest checkout.
- Delivery promise visible on PDP ("Order within 2h 15m for delivery tomorrow").
- Free shipping threshold displayed honestly; never auto-add products.
- No fake scarcity, countdowns or confirm-shaming. Cookie banner: equal choices.

## 6. Usability testing plan

- Phase 0: 5–8 users (mixed ages incl. 60+, FR & NL speakers) on prototype: find product,
  understand medicine limits, complete checkout with questionnaire.
- Pre-launch: moderated test on staging, + 2 users relying on assistive technology.
- Post-launch: monthly review of funnel analytics (first-party) + session-level insights only with consent.
