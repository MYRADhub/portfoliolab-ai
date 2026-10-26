# Research study: does showing hidden exposures change how people diversify?

Status: engineering complete, study not approved. The protocol to submit for approval is `docs/study-protocol.md`. **No data may be collected from people until an ethics review (IRB or the school equivalent) has approved the protocol and the consent wording.** The module is off unless `EXPERIMENT_ENABLED=1` is set on the server.

## Question and hypothesis

People who see which hidden economic forces their portfolio depends on (not just sectors, weights, volatility and correlations) build portfolios that are less concentrated in any one force.

- H1 (primary): the treatment arm submits portfolios with a lower factor HHI than the control arm.
- Secondary: higher effective number of sectors, lower top-factor share, higher post-task perceived diversification, and change in confidence.

## Design

- Between-subjects, two arms, individually randomized.
- Control sees, for each candidate company and for the portfolio being built: sector, annualized volatility, weights, sector breakdown, average correlation, effective number of sectors.
- Treatment sees all of that plus each company's hidden exposures and the portfolio's factor loadings, effective number of hidden factors and top-factor share.
- Task: from a fixed list of companies, choose 5 to 10 and set weights adding to 100% (at least 1% each) for a hypothetical ten-year diversified portfolio. No real money, no advice.
- Randomization: minimization within experience strata (new, some, experienced). The arm with fewer participants in the stratum gets the next one; ties are broken at random. Enrollment is serialized with a database lock, so arms differ by at most one per stratum. The assignment happens on the server.

## Outcomes (pre-registered)

Primary: factor HHI of the submitted portfolio, as defined in ADR 0004 (net loadings, normalized absolute shares, sum of squares). Computed on the server from the same exposure table for both arms, so the measure is identical across arms. Record the factor taxonomy version with the data.

Secondary: effective number of sectors, top-factor share, effective number of independent bets from return covariance (a check that does not use our exposure scores), post-task perceived diversification (1 to 7), post-task confidence (1 to 7).

Covariates collected: experience stratum, age group (18 or over, or under 18), pre-task perceived diversification and confidence.

## Analysis plan

- Compare arms on the primary outcome with a permutation test (10,000 shuffles, seeded) and report Welch's t, the difference in means and Cohen's d. The permutation test makes no distributional assumption, which matters because HHI is bounded and skewed.
- Secondary outcomes are reported with the same statistics and labelled exploratory; apply a multiple-comparison correction (Holm) if any are reported as findings.
- Adjust for stratum with a stratified analysis as a sensitivity check.
- Exclude nothing after seeing outcomes. Predefined exclusion: submissions with fewer than 20 seconds between enrolment and submit are flagged and reported with and without (`primaryExcludingFast` in the results).
- Pilot participants (`EXPERIMENT_PILOT=1`) are left out of every comparison. The results report their mean and standard deviation of factor HHI, which turns the smallest difference worth detecting into an effect size for the sample-size table.
- The `GET /api/experiment/results` endpoint (researcher token) returns these statistics; `GET /api/experiment/export` returns one CSV row per participant for the notebook.

## Sample size

Two-sided test, alpha 0.05, power 0.80, normal approximation, participants per arm: d = 0.8 needs 25, d = 0.5 needs 63, d = 0.2 needs 393. The smallest effect worth acting on has not been chosen; a pilot should estimate the standard deviation of factor HHI to turn a raw difference into d. Recommended target until then: 65 per arm (130 total) with oversampling for dropouts.

## What the system enforces

- A participant (anyone holding the study cookie) can reach only the study page and the study API. Every other page redirects and every other API call returns 403, so the control arm has no route to any exposure data. A test checks this.
- The control arm's universe and preview responses contain no exposure or factor fields. A test checks the JSON.
- Events logged: enrolment, universe load, adds, removals, weight changes, previews, page hidden and visible, submit. No names, emails, IP addresses or session links are stored.
- Withdrawal deletes every row about the participant and clears the cookie.

## Ethics checklist (to be completed by the researcher)

- [ ] Ethics review submitted and approved; approved wording replaces `components/study/consent.ts`.
- [ ] Age decided: adults only, or under-18s with a signed parent or guardian form (`STUDY_ALLOW_MINORS=1`). Recruitment text reviewed.
- [ ] `STUDY_RESEARCHER`, `STUDY_APPROVAL`, `STUDY_CONTACT`, `STUDY_RETENTION` and `STUDY_END` set; the study refuses to enrol until the first four are.
- [x] Debrief text written (explains the two arms, shows the participant's own result, asks them not to discuss it) and shown after submission.
- [ ] `EXPERIMENT_ADMIN_TOKEN` set to a long random value and kept private.
- [ ] `EXPERIMENT_UNIVERSE` set to the fixed list of companies for the study (otherwise every company with exposure data is offered). Use the gold set in `packages/shared/src/gold-set.ts`, after it has been scored blind and reviewed.

## Known limitations

- The exposure data is currently AI-drafted, not reviewed. The study universe is the gold set, which is scored blind and reviewed by a person first (DECISIONS section 34), so the treatment arm sees reviewed numbers.
- The primary outcome is computed from our own exposure model, so it measures concentration in our taxonomy, not in the real world. A secondary robustness check with a different measure (for example effective number of independent bets from return covariance) is advisable.
- The study cookie is signed, so an edited id is rejected, but someone who deletes it can enroll again. Acceptable for an anonymous study, but it can inflate the sample slightly.
- Self-selected online participants are not representative of retail investors.
