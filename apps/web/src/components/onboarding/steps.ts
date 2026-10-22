export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** The page this step belongs to; the tour navigates there first. */
  href: string;
  /** The `data-tour` value of the element to spotlight. Without one the step is shown centered. */
  target?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    href: "/dashboard",
    title: "Welcome to PortfolioLab",
    body: "Owning different stocks does not mean owning different risks. This short tour shows how PortfolioLab finds the hidden forces your portfolio depends on, and what to do with them. It takes about two minutes.",
  },
  {
    id: "portfolio",
    href: "/dashboard",
    target: "portfolio-toolbar",
    title: "Your portfolios",
    body: "Pick a portfolio here, create a new one, export its holdings or delete it. Everything you see updates for the portfolio you choose. New? Load the sample portfolios to explore.",
  },
  {
    id: "kpis",
    href: "/dashboard",
    target: "kpis",
    title: "The key numbers",
    body: "How your portfolio has done and how bumpy the ride was: recent returns, volatility, the biggest fall from a peak, and a risk-adjusted score.",
  },
  {
    id: "insights",
    href: "/dashboard",
    target: "insights",
    title: "What to know now",
    body: "Plain-language cards pick out what needs attention, most important first. Each one links to the page with the detail.",
  },
  {
    id: "exposures",
    href: "/exposures",
    target: "exposure-map",
    title: "The hidden exposure map",
    body: "This is the heart of PortfolioLab. Holdings on the left connect to the economic forces on the right: interest rates, oil, AI spending and more. Hover or focus a name to see only its connections. Few forces behind many stocks means less diversification than it looks.",
  },
  {
    id: "stress",
    href: "/stress",
    target: "stress-controls",
    title: "Stress Lab",
    body: "Push a force up or down, or pick a ready-made scenario, and see how much each holding and the whole portfolio might move. It is a what-if, not a forecast.",
  },
  {
    id: "research",
    href: "/research",
    target: "assistant",
    title: "Ask a question",
    body: "Ask about your portfolio or a company in plain English. The assistant looks things up with the app's own calculations and may only quote numbers they return, citing each one.",
  },
  {
    id: "guide",
    href: "/guide",
    target: "nav-guide",
    title: "The Guide is always here",
    body: "Every term and chart is explained in plain language in the Guide. You can replay this tour any time from the sidebar. Enjoy exploring.",
  },
];
