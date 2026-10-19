# Event taxonomy (DRAFT for finance review)

Source of truth is `packages/classify/src/events.ts`; this page explains the choices. Not seeded into production data until reviewed.

Each event type has a default class used only as a prior in the classifier prompt. The classifier may override it when the article's stated mechanism says otherwise (for example, an executive departure caused by missed targets is fundamental, while a routine succession is narrative).

Classes:

- **fundamental**: may genuinely change future revenue, costs, assets, risk or cash flows.
- **narrative**: may shift expectations or sentiment, with an uncertain or indirect economic effect.
- **noise**: attention or emotion with no clear economic mechanism. A true story can still be noise.
- **unclear**: too thin or ambiguous to judge. Allowed output; preferred over guessing.

Open questions for review:

1. `product_launch` and `leadership_change` default to narrative. Is that the right prior, or should they default to fundamental with a lower confidence?
2. `analyst_action`, `index_change`, `insider_trade`: confirm these are narrative rather than noise. They move prices without changing economics, but some carry real information.
3. Is 31 types too fine for the sample sizes in the event study (Phase 15)? Small types may need merging so each has enough events.
4. Missing candidates: dividends from macro events, geopolitical events (war, sanctions beyond export controls), natural disasters unrelated to a company, short-seller reports.
5. The scores (fundamental importance, market relevance, expected persistence) are model judgments. Phase 15 replaces expected persistence with an empirical prior per event type once enough history exists.
