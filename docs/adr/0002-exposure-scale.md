# ADR 0002: Exposure scale

Status: accepted (2026-10-18)

## Decision

Each (company, factor) exposure is `magnitude` in 0..3 and `direction` in {-1, 0, +1}, where direction is the effect on the company when the factor rises. Signed exposure = magnitude * direction, range [-3, 3].

## Context

An unsigned 0-3 scale cannot express that an oil spike helps XOM and hurts DAL, which Stress Lab and the News Impact Engine require.

## Consequences

Exposures carry confidence, rationale, evidence, source, reviewer and validity dates. Changes create a new version row, never an in-place edit, so backtests can use point-in-time profiles. Implemented in `packages/shared/src/exposure.ts`.
