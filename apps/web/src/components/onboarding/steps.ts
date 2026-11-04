export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Something to try on this step, shown highlighted under the text. */
  hint?: string;
  /** The page this step belongs to; the tour navigates there first. */
  href: string;
  /** The `data-tour` value of the element to spotlight. Without one the step is shown centered. */
  target?: string;
}

/** The company the fit step opens: not in the example portfolio, and it has an exposure profile. */
export const TOUR_FIT_TICKER = "AMD";

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    href: "/dashboard",
    title: "Welcome to PortfolioLab",
    body: "You are looking at an example portfolio built from real prices, SEC filings and this week's news. This two-minute tour points out what to use first. Skip it whenever you like, or press Escape.",
  },
  {
    id: "portfolio",
    href: "/dashboard",
    target: "portfolio-toolbar",
    title: "Your portfolios",
    body: "An example portfolio and five samples are already loaded. Switch between them here, or create or import your own. Every page follows the portfolio you pick.",
    hint: "Open the list and choose a sample, such as the AI boom bet.",
  },
  {
    id: "summary",
    href: "/dashboard",
    target: "summary",
    title: "How you are doing, in plain words",
    body: "The summary is written from the portfolio's own figures: how the month went, how that compares with the S&P 500, which holdings helped, which held you back, and where the risk really sits.",
  },
  {
    id: "insights",
    href: "/dashboard",
    target: "insights",
    title: "What to know now",
    body: "Cards pick out what needs attention, most important first, each with the page that has the detail.",
  },
  {
    id: "news",
    href: "/news",
    target: "news-story",
    title: "News ranked for your holdings",
    body: "Stories from a news feed and the web, grouped across outlets, linked to the companies they are about, classified by AI and ranked by how much they matter to this portfolio.",
    hint: "Press “How we judged this” on a story to see its sources, why it is linked to each holding, and the score worked out step by step.",
  },
  {
    id: "research",
    href: "/research",
    target: "assistant",
    title: "Ask the research assistant",
    body: "Ask about any S&P 500 company or your portfolio. It looks things up with about thirty tools, and every number in an answer is checked against a cited source before you see it.",
    hint: "Ask “How would AMD fit my portfolio?”, then press Visualize or Presentation under the answer.",
  },
  {
    id: "fit",
    href: `/research/${TOUR_FIT_TICKER}`,
    target: "portfolio-fit",
    title: "Test a company before you add it",
    body: "Every company page runs your portfolio with and without the company over the last year: return, ups and downs, worst fall and how it moves with each holding. History, not a forecast.",
  },
  {
    id: "tools",
    href: "/dashboard",
    target: "nav-tools",
    title: "More analysis tools",
    body: "Exposures, Stress Lab, Correlation, Rebalance Lab and more are grouped here. Pages built on exposure profiles cover the holdings that have one and say which they leave out.",
  },
  {
    id: "guide",
    href: "/guide",
    target: "nav-guide",
    title: "Help is always here",
    body: "The Guide explains every term and chart in plain language. Replay this tour any time with Tutorial in the sidebar.",
  },
];
