# Factor taxonomy (DRAFT for finance review)

Status: proposed, not seeded. Nothing here is in the database until reviewed.

Each factor has a slug, a category (matches the `factor_category` enum), a definition, and an explicit meaning of "rises". Company exposure direction is always relative to that rise: +1 means the company benefits when the factor rises, -1 means it is hurt.

Rules for the taxonomy:

1. A factor must be something that can move, be described in news, and be shocked in Stress Lab.
2. A factor is not a sector. "Technology" is not a factor; "enterprise IT spending" is.
3. Closed set. The LLM seeder may only choose from this list. New factors go through review.
4. Prefer fewer than 30. More factors means thinner, noisier exposure data per company.

## Macro

| Slug                   | Name                     | Rises means                                             | Typically hurt (-1)                           | Typically helped (+1)                    |
| ---------------------- | ------------------------ | ------------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `interest_rates`       | Interest rates           | Long-term government yields rise                        | long-duration growth, real estate, utilities  | banks (net interest margin), insurers    |
| `yield_curve_slope`    | Yield curve steepness    | Long yields rise relative to short yields               | -                                             | banks, lenders                           |
| `inflation`            | Inflation                | Consumer and input prices accelerate                    | low-pricing-power retailers, consumer staples | commodity producers, pricing-power firms |
| `credit_spreads`       | Credit spreads           | Corporate borrowing costs rise vs. government           | leveraged firms, lenders in credit losses     | -                                        |
| `usd_strength`         | U.S. dollar strength     | USD appreciates vs. trade partners                      | multinationals with foreign revenue           | importers, domestic-only firms           |
| `economic_growth`      | Domestic economic growth | U.S. GDP growth accelerates                             | -                                             | cyclicals, industrials, banks            |
| `labor_costs`          | Labor costs              | Wages and benefit costs rise                            | labor-intensive retail, restaurants           | staffing/payroll vendors                 |
| `equity_risk_appetite` | Equity risk appetite     | Investors accept more risk (valuation multiples expand) | defensive stocks relative to market           | high-beta growth stocks                  |

## Commodity

| Slug               | Name                     | Rises means                  | Typically hurt (-1)               | Typically helped (+1)            |
| ------------------ | ------------------------ | ---------------------------- | --------------------------------- | -------------------------------- |
| `oil_price`        | Oil price                | Crude oil price rises        | airlines, cruise lines, chemicals | oil producers, oilfield services |
| `natural_gas`      | Natural gas              | Natural gas price rises      | utilities, fertilizer users       | gas producers, LNG exporters     |
| `metals_prices`    | Industrial metals        | Copper, steel, aluminum rise | autos, appliances, construction   | miners, steel producers          |
| `agri_commodities` | Agricultural commodities | Crop prices rise             | food producers, restaurants       | farm suppliers, grain handlers   |

## Demand

| Slug                     | Name                   | Rises means                                       | Typically hurt (-1)    | Typically helped (+1)                      |
| ------------------------ | ---------------------- | ------------------------------------------------- | ---------------------- | ------------------------------------------ |
| `consumer_spending`      | Consumer spending      | Household discretionary spending grows            | -                      | retailers, consumer brands, travel         |
| `enterprise_it_spending` | Enterprise IT spending | Corporate software and IT budgets grow            | -                      | software, IT services, hardware vendors    |
| `cloud_spending`         | Cloud spending         | Cloud infrastructure and services spend grows     | -                      | hyperscalers, data-center suppliers        |
| `housing_activity`       | Housing activity       | Home sales and construction grow                  | -                      | homebuilders, building products, lenders   |
| `healthcare_spending`    | Healthcare spending    | Health utilization and spend grow                 | payers (cost pressure) | providers, devices, pharma                 |
| `china_demand`           | China demand           | Chinese end demand for U.S. firms' products grows | -                      | semiconductors, luxury, industrials, autos |
| `europe_demand`          | Europe demand          | European end demand grows                         | -                      | firms with large European revenue          |

## Theme

| Slug                      | Name                       | Rises means                                     | Typically hurt (-1)                | Typically helped (+1)                     |
| ------------------------- | -------------------------- | ----------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `ai_infrastructure_capex` | AI infrastructure capex    | Spending on AI compute, networking, power rises | -                                  | GPUs, memory, networking, power equipment |
| `ai_adoption`             | AI adoption                | Businesses and consumers use AI more            | firms whose products are displaced | software, platforms with AI revenue       |
| `energy_transition`       | Energy transition          | Investment in renewables, EVs, storage grows    | fossil-fuel-only producers         | solar, storage, EV supply chain           |
| `cybersecurity_threat`    | Cybersecurity threat level | Frequency/severity of attacks rises             | breached firms                     | security vendors                          |

## Supply chain and geography

| Slug                       | Name                     | Rises means                                                   | Typically hurt (-1)                  | Typically helped (+1)                  |
| -------------------------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| `semiconductor_demand`     | Semiconductor demand     | Global chip demand and pricing strengthen                     | -                                    | chipmakers, equipment                  |
| `taiwan_supply_chain_risk` | Taiwan supply chain risk | Probability or severity of Taiwan production disruption rises | chip designers, device makers, cloud | non-Taiwan fabs, domestic fab builders |
| `global_shipping_cost`     | Global shipping cost     | Freight rates and transit times rise                          | importers, retailers                 | shippers, logistics                    |
| `geopolitical_tension`     | Geopolitical tension     | Conflict, sanctions, trade barriers intensify                 | exporters, global supply chains      | defense, domestic producers            |

## Regulation

| Slug                       | Name                     | Rises means                                         | Typically hurt (-1)           | Typically helped (+1) |
| -------------------------- | ------------------------ | --------------------------------------------------- | ----------------------------- | --------------------- |
| `semiconductor_regulation` | Semiconductor regulation | Export controls and chip-trade restrictions tighten | chip firms with China sales   | domestic-focused fabs |
| `antitrust_scrutiny`       | Antitrust scrutiny       | Regulators challenge large platforms and mergers    | dominant platforms, acquirers | challengers           |
| `financial_regulation`     | Financial regulation     | Capital and conduct requirements tighten            | banks, brokers                | compliance vendors    |
| `drug_pricing_regulation`  | Drug pricing regulation  | Government price controls on drugs tighten          | pharma, PBMs                  | generics              |

## Open questions for review

1. Is `equity_risk_appetite` a legitimate factor or just beta in disguise? If beta, drop it and keep a separate market-beta metric.
2. Is `ai_adoption` separable from `ai_infrastructure_capex` for our universe? They move together, which makes Stress Lab results look redundant.
3. Taiwan risk: model as a single factor (as drafted) or split into a probability factor and a supply-effect factor? The first is simpler.
4. Missing: tariffs and trade policy (probably under `geopolitical_tension`), climate/physical risk, and consumer credit. Add or defer?
5. 31 factors is above the 15-30 target in the roadmap. Candidates to cut: `labor_costs`, `agri_commodities`, `cybersecurity_threat`, `europe_demand`, `drug_pricing_regulation`.

## Next steps once approved

1. Finalize the list and write definitions and a "what rising means" sentence for each (the columns above are the starting text).
2. Seed `factors` with a migration-style script reviewed in a PR.
3. Hand-author the gold set (about 25 companies) before any LLM seeding, so seeding can be evaluated against it.
