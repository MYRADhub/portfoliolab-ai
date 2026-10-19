# ADR 0004: Hidden concentration metric

Status: accepted (2026-10-19)

## Decision

The primary (pre-registered) outcome for the experiment is the **factor HHI**:

- Portfolio loading on factor f: `L_f = sum_i w_i * s_if`, where `w_i` is the portfolio weight and `s_if = magnitude * direction` is the signed exposure (ADR 0002).
- Share: `p_f = |L_f| / sum_g |L_g|`.
- Factor HHI: `sum_f p_f^2`, ranging from `1/F` (loadings spread evenly across F factors) to 1 (a single factor).
- Effective number of factors: `1 / HHI`.

## Secondary measures (reported, not primary)

1. Effective number of independent bets from the factor covariance eigenvalues.
2. Largest single-factor share, `max_f p_f`.

## Context

The primary metric must be transparent to participants, free of estimation noise, and computable identically in both experiment arms. HHI over loadings meets that. The covariance-based measure is more principled but depends on an estimated factor covariance, which adds error and is hard to explain.

## Known limitations

- Net loadings let opposing exposures cancel (a +2 and a -2 on the same factor net to zero), which is intended for risk but can understate gross dependence. Gross (absolute-per-holding) loadings are computed alongside for inspection.
- Correlated factors are treated as separate. The taxonomy review (docs/factor-taxonomy.md) should minimize near-duplicate factors.
- The value depends on the factor list, so the taxonomy version must be recorded with every computed value.

## Consequences

Implemented in Phase 4. The experiment analysis plan (Phase 16) must cite this ADR and the taxonomy version.
