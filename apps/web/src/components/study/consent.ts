/**
 * Participant information shown before enrolment, and the debrief shown after submission. The wording must match
 * the version approved for the study (see docs/study-protocol.md); change CONSENT_VERSION on the server when it
 * changes. The researcher, approval, contact and retention lines come from the STUDY_* settings.
 */
export const CONSENT_POINTS = [
  "You will build a hypothetical stock portfolio from a fixed list of companies. It takes about 10 minutes. No real money is involved and nothing here is investment advice.",
  "We record your choices, your answers to two short questionnaires, and how you interact with the page (for example which companies you add or remove and when). We do not ask for your name, email or exact age, and we cannot link your answers to you.",
  "Taking part is voluntary and has no effect on grades or anything else. You can stop at any time and use the Withdraw button to delete everything stored about you.",
  "Results are analysed in aggregate for research on how information affects the way people diversify.",
];

export const DEBRIEF_POINTS = [
  "Participants were randomly assigned to one of two versions of this page. One version showed only sector, volatility and correlation information. The other also showed each company's hidden economic exposures: how strongly it depends on forces such as interest rates, oil prices or AI spending.",
  "The study asks whether seeing hidden exposures leads people to build portfolios that depend less on any single economic force. Your portfolio was scored on that measure after you submitted it; your own result is shown below.",
  "The exposure scores are judgements drafted by an AI model and checked by a person. You were not given advice, and nothing here predicts how any stock will perform.",
  "You can withdraw and delete your data at any time with the button below.",
];
