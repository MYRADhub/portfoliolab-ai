# Study protocol for approval

This is the document to give the person approving the study (a teacher, mentor or school ethics contact). It describes what participants do, what is stored and how they are protected. Fill in every `[bracketed]` field, have it signed, and keep a copy. The study software refuses to enrol anyone until the approval details are configured (section 9).

The design and analysis plan are in `docs/experiment-design.md`.

## 1. Title and people

- **Title:** Does seeing hidden economic exposures change how people diversify a portfolio?
- **Researcher:** [full name, school, grade]
- **Supervisor / approver:** [name, role, school]
- **Planned dates:** [start date] to [end date]

## 2. Purpose in plain words

Many people think owning companies in different industries means their risk is spread out. But companies in different industries can depend on the same economic forces, such as interest rates or oil prices. This study asks whether showing people those hidden links leads them to build portfolios that depend less on any one force.

## 3. What participants do (about 10 minutes, online)

1. Read the information screen and agree to take part (section 6).
2. Say whether they are 18 or over or under 18, and choose an experience level (new, some, experienced). No name, email or exact age is asked.
3. Answer two questions on a 1 to 7 scale (how diversified they feel, how confident they are).
4. Build a pretend portfolio: choose 5 to 10 companies from a fixed list of 33 well-known US companies and give them weights that add up to 100%. No real money is involved.
5. Answer the same two questions about the portfolio they built, then submit.
6. Read the debrief (section 7), which explains the study and shows their own result.

Participants are randomly put into one of two groups. Both groups see each company's sector and how much its price moves, and a summary of their portfolio. One group also sees each company's hidden economic exposures. The software makes sure the other group cannot reach that information during the task.

## 4. Participants and recruitment

- **Who:** [for example: students at Example High School, grades 10 to 12, and adults they invite]
- **How many:** a pilot of 5 to 10 people first, then up to 130 (65 per group).
- **Age:** [choose one] (a) adults only, or (b) under-18s allowed with a signed parent or guardian consent form (section 8). Under-18s who say they do not have the form cannot start.
- **Recruitment message** (send as written, through [class group chat / email / announcement]):

> I am running a short online study for a research project on how people build investment portfolios. It takes about 10 minutes, involves no real money and asks for no name or email. Taking part is completely voluntary and has nothing to do with grades. [If under-18s are allowed: If you are under 18, please get the attached parent or guardian form signed first.] Link: [study link]. Questions: [contact].

## 5. Risks, benefits and safeguards

- **Risks:** minimal. The task is a hypothetical exercise. The main risk is a participant mistaking it for investment advice, so every screen says it is not advice.
- **Benefits:** participants learn a concept about diversification, and the debrief shows them how diversified their own portfolio was.
- **No pressure:** participation is voluntary, unpaid and unrelated to grades. [If the researcher's classmates take part: the researcher will not ask anyone whether they took part.]
- **Not discussing:** the debrief asks participants not to talk about the study with people who may still take part until [end date], because knowing what it tests would change their answers.

## 6. What is stored, and for how long

Stored for each participant, under a random id only:

- the 18+ or under-18 answer, the experience level and whether they enrolled during the pilot;
- the four 1 to 7 answers;
- the final portfolio (companies and weights) and measures computed from it;
- interaction events such as adding or removing a company, with times.

Not stored: names, emails, exact age, IP addresses, or anything linking the id to a person. The id lives only in a cookie in the participant's browser.

- **Where:** [the database server, for example the researcher's own computer or a named hosting provider and region]
- **Who can see it:** the researcher only, through a password-protected export.
- **How long:** [for example: until 2027-06-30, then deleted]. Only group averages are published.
- **Withdrawal:** a "Withdraw and delete my data" button on every screen of the study deletes everything stored about that participant at once.

The information screen shows the participant the following, word for word (from `apps/web/src/components/study/consent.ts`), plus the researcher, approval, contact and retention lines from section 9:

1. You will build a hypothetical stock portfolio from a fixed list of companies. It takes about 10 minutes. No real money is involved and nothing here is investment advice.
2. We record your choices, your answers to two short questionnaires, and how you interact with the page (for example which companies you add or remove and when). We do not ask for your name, email or exact age, and we cannot link your answers to you.
3. Taking part is voluntary and has no effect on grades or anything else. You can stop at any time and use the Withdraw button to delete everything stored about you.
4. Results are analysed in aggregate for research on how information affects the way people diversify.

If the approver asks for different wording, change it in that file and change `CONSENT_VERSION` in `apps/web/src/server/experiment.ts`, so every participant's record shows which wording they saw.

## 7. Debrief (shown after submitting)

1. Participants were randomly assigned to one of two versions of this page. One version showed only sector, volatility and correlation information. The other also showed each company's hidden economic exposures.
2. The study asks whether seeing hidden exposures leads people to build portfolios that depend less on any single economic force. Your own result is shown below.
3. The exposure scores are judgements drafted by an AI model and checked by a person. You were not given advice, and nothing here predicts how any stock will perform.
4. You can withdraw and delete your data at any time.

It then shows which version the participant saw, how many sectors and how many independent economic forces their portfolio was spread across, and the request not to discuss the study before the end date.

## 8. Parent or guardian consent form (only if under-18s take part)

> **Parent or guardian consent: online portfolio study**
>
> [Researcher name], a student at [school], is running a 10-minute online study, supervised by [supervisor], about how people build investment portfolios. Your child would build a pretend portfolio from a list of well-known companies and answer four short questions. No real money is involved, nothing is sold or recommended, and no name, email or exact age is collected. Taking part is voluntary and unrelated to grades, and your child can stop and delete their answers at any time. Only group averages will be reported. Answers are kept until [date] and then deleted.
>
> Questions: [contact].
>
> I agree that my child may take part.
>
> Child's first name: ........................ Parent or guardian name: ........................
>
> Signature: ........................ Date: ........................

The signed forms are kept by [the supervisor] and are never linked to study answers, because the study stores no names.

## 9. Settings that put the approval into the software

The study stays closed until these are set on the server:

| Setting                  | Value                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `EXPERIMENT_ENABLED`     | `1`                                                                       |
| `EXPERIMENT_ADMIN_TOKEN` | a long random value, kept private (it also signs participant cookies)     |
| `EXPERIMENT_UNIVERSE`    | `gold` (the 33 companies in `packages/shared/src/gold-set.ts`)            |
| `STUDY_RESEARCHER`       | the researcher line from section 1                                        |
| `STUDY_APPROVAL`         | who approved it and when, for example "Ms Example, Economics, 2026-11-01" |
| `STUDY_CONTACT`          | the contact for questions or concerns                                     |
| `STUDY_RETENTION`        | the retention sentence from section 6                                     |
| `STUDY_END`              | the end date, YYYY-MM-DD (used in the "please do not discuss" request)    |
| `STUDY_ALLOW_MINORS`     | `1` only if section 4 option (b) was approved                             |
| `EXPERIMENT_PILOT`       | `1` during the pilot, then removed for the main study                     |

Before the main study: every gold-set company has been scored blind and reviewed (`/review`, gold-set filter), so the group that sees exposures sees reviewed numbers.

## 10. Approval

I have read this protocol and approve the study as described.

Name: ........................ Role: ........................ Signature: ........................ Date: ........................

Changes requested: ........................
