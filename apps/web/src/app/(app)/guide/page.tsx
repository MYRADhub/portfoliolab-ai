import Link from "next/link";

export const metadata = { title: "Guide | PortfolioLab" };

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Item({ id, term, children }: { id: string; term: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      <dt className="font-medium">{term}</dt>
      <dd className="mt-0.5 text-muted-foreground">{children}</dd>
    </div>
  );
}

export default function Page() {
  return (
    <article className="max-w-3xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Guide</h1>
        <p className="text-muted-foreground">
          PortfolioLab helps you see what is really driving your investments. Most tools tell you
          what happened. This one tries to show you which hidden forces connect your stocks, which
          news actually matters to you, and whether a move was real or just noise.
        </p>
        <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#tour" className="underline">
            Quick tour
          </a>
          <a href="#ideas" className="underline">
            Key ideas
          </a>
          <a href="#terminal" className="underline">
            Reading the Terminal
          </a>
          <a href="#glossary" className="underline">
            Glossary
          </a>
          <a href="#data" className="underline">
            About the data
          </a>
        </nav>
      </header>

      <Section id="tour" title="Quick tour (5 minutes)">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <Link href="/portfolios/new#samples" className="underline">
              Load the sample portfolios
            </Link>
            . Five ready-made portfolios, each chosen to teach one idea. You can also build your own
            on the same page.
          </li>
          <li>
            Open the{" "}
            <Link href="/dashboard" className="underline">
              Dashboard
            </Link>
            . Start with the five numbers at the top, then press{" "}
            <strong>Explain this portfolio</strong> for a plain-English reading.
          </li>
          <li>
            Scroll to <strong>Why did my portfolio move?</strong>. Pick a day and see which holdings
            and sectors pushed the portfolio up or down.
          </li>
          <li>
            Open the{" "}
            <Link href="/terminal" className="underline">
              Terminal
            </Link>{" "}
            for the dense, all-in-one view: performance, risk, distribution, drawdowns and more.
          </li>
          <li>
            Open{" "}
            <Link href="/exposures" className="underline">
              Exposures
            </Link>{" "}
            and compare the &ldquo;Mega-cap tech&rdquo; and &ldquo;Balanced&rdquo; samples. This is
            the main idea of the app (see{" "}
            <a href="#idea-hidden-risk" className="underline">
              hidden risk
            </a>{" "}
            below).
          </li>
          <li>
            Open{" "}
            <Link href="/correlation" className="underline">
              Correlation
            </Link>{" "}
            to see which stocks move together, then{" "}
            <Link href="/news" className="underline">
              News
            </Link>{" "}
            to see the stories that matter most to the portfolio you picked.
          </li>
        </ol>
      </Section>

      <Section id="ideas" title="Key ideas">
        <dl className="space-y-4">
          <Item
            id="idea-hidden-risk"
            term="Owning different stocks is not the same as owning different risks"
          >
            Think of five friends who all work at the same company. They look like five separate
            people, but if the company has a bad year, all five feel it. Five technology stocks can
            be the same: they all depend on AI spending, cloud budgets and interest rates.
            PortfolioLab gives every company a profile of the forces it depends on and adds them up,
            so you can see the forces your whole portfolio leans on.
          </Item>
          <Item id="idea-sector-vs-factor" term="Sectors versus factors">
            A sector is a label (&ldquo;Technology&rdquo;). A factor is a real-world force
            (&ldquo;AI spending&rdquo;, &ldquo;oil price&rdquo;, &ldquo;interest rates&rdquo;). The
            Exposures page shows the effective number of each. A portfolio that looks spread over
            sectors can still rest on a few factors.
          </Item>
          <Item id="idea-correlation-vs-exposure" term="Correlation is not exposure">
            Correlation describes how two stocks moved together in the past. Exposure describes what
            they both depend on in the future. Two stocks can look unrelated today and still share
            the same weak spot, which is why the app shows both.
          </Item>
          <Item id="idea-signal-noise" term="Signal or noise?">
            Not every headline that moves a price changes a company&rsquo;s business. News is sorted
            into three kinds: <strong>fundamental</strong> (changes revenue, costs or risk),{" "}
            <strong>narrative</strong> (changes opinions, effect unclear) and <strong>noise</strong>{" "}
            (attention only, such as gossip). A true story can still be noise.
          </Item>
          <Item id="idea-relevance" term="The relevance score">
            Each news story gets a score from 0 to 10 for your portfolio: how strongly it concerns
            what you own, how much it could change a business, and how fresh it is (half the weight
            is lost every three days). Press <strong>Why am I seeing this?</strong> on any story to
            see the arithmetic.
          </Item>
          <Item id="idea-numbers-first" term="Numbers first, words last">
            Every number is computed by ordinary code. The AI only turns those numbers into
            sentences, and the app checks that every number in its answer appears in the list of
            facts it was given. If it does not, you see only the figures. The AI never tells you to
            buy or sell.
          </Item>
        </dl>
      </Section>

      <Section id="terminal" title="Reading the Terminal">
        <p className="text-muted-foreground">
          The{" "}
          <Link href="/terminal" className="underline">
            Terminal
          </Link>{" "}
          is a dark, dense dashboard. Each panel has a <strong>?</strong> that brings you back here.
          Green is up, red is down, and every colored number also shows a plus or minus sign.
        </p>
        <dl className="space-y-4">
          <Item id="terminal-index" term="Portfolio index">
            Your portfolio as a single line that starts at 100. If it ends at 125, the portfolio
            gained 25% over the window. It assumes your target weights are restored every day.
          </Item>
          <Item id="terminal-performance" term="Performance">
            Returns over standard periods: one day, week, month and so on, plus year to date.
            &ldquo;n/a&rdquo; means there is not enough history yet.
          </Item>
          <Item id="terminal-holdings" term="Holdings monitor">
            One row per stock: its weight, latest price, recent moves and a 60-day mini chart.{" "}
            <strong>Share of risk</strong> shows how much of the portfolio&rsquo;s ups and downs
            that stock is responsible for. When it is much larger than the weight, the row turns
            amber: that stock is more dangerous than its size suggests.
          </Item>
          <Item id="terminal-risk" term="Risk">
            Volatility, Sharpe, drawdown, value at risk, expected shortfall and your best and worst
            days. See the glossary below for each.
          </Item>
          <Item id="terminal-risk-weight" term="Risk versus weight">
            Two bars per stock. Grey is how much money is in it, amber is how much risk it brings. A
            small position with a long amber bar is the one to watch.
          </Item>
          <Item id="terminal-distribution" term="Daily return distribution">
            A histogram of how your portfolio did on each day. A tall, narrow shape means calm days.
            Long tails mean occasional big swings.
          </Item>
          <Item id="terminal-rolling" term="Rolling volatility">
            How bumpy the last 21 trading days were, plotted over time. Spikes show stressful
            periods.
          </Item>
          <Item id="terminal-monthly" term="Monthly returns">
            A calendar of how the portfolio did each month. Greener is better, redder is worse.
          </Item>
          <Item id="terminal-drawdowns" term="Worst drawdowns">
            The biggest falls from a peak: how deep, when they started and bottomed, and whether the
            portfolio has climbed back.
          </Item>
          <Item id="terminal-correlation" term="Correlation">
            The pairs of holdings that move most closely together. Pairs near 1.00 give you little
            diversification.
          </Item>
          <Item id="terminal-exposure" term="Hidden exposure">
            The effective number of sectors versus effective factors, and the largest economic
            forces your portfolio depends on.
          </Item>
          <Item id="terminal-news" term="Relevant news">
            The top stories for this portfolio, with their relevance score out of 10.
          </Item>
        </dl>
      </Section>

      <Section id="glossary" title="Glossary">
        <dl className="space-y-4">
          <Item id="gl-weight" term="Weight">
            The share of your portfolio in one stock. Weights add up to 100%.
          </Item>
          <Item id="gl-rebalancing" term="Rebalancing">
            Selling a little of what rose and buying what fell to restore your target weights.
            PortfolioLab assumes you do this every day, which keeps the maths simple and exact.
          </Item>
          <Item id="gl-volatility" term="Volatility">
            How much the value bounces around, shown per year. Higher means a bumpier ride, not
            necessarily a worse investment.
          </Item>
          <Item id="gl-sharpe" term="Sharpe ratio">
            Return earned per unit of bumpiness. Higher is better. This app uses a 0% risk-free rate
            for now, so the figure is a simplified one.
          </Item>
          <Item id="gl-drawdown" term="Drawdown">
            The fall from a previous high to a later low. A 20% drawdown means you were down 20%
            from the peak at the worst point.
          </Item>
          <Item id="gl-var" term="Value at risk (VaR)">
            A bad-day marker. A 1-day 95% VaR of -2% means that on 95 of every 100 days the
            portfolio lost less than 2%, and on the worst 5 it lost at least that. It is measured
            from the past, so it is not a promise.
          </Item>
          <Item id="gl-es" term="Expected shortfall">
            How bad the bad days were on average: the average result on the days at or beyond the
            VaR line.
          </Item>
          <Item id="gl-correlation" term="Correlation">
            From -1 to +1. At +1 two stocks move in lockstep, at 0 they are unrelated, at -1 they
            move opposite. In scary markets correlations tend to rise, so the Correlation page also
            shows the average on the portfolio&rsquo;s worst days.
          </Item>
          <Item id="gl-diversification-ratio" term="Diversification ratio">
            How much calmer the portfolio is than its holdings are on their own. 1.0 means no
            benefit from combining them; higher is better.
          </Item>
          <Item id="gl-contribution" term="Contribution">
            A holding&rsquo;s weight times its return that day, in percentage points. The
            contributions of all holdings add up exactly to the portfolio&rsquo;s return.
          </Item>
          <Item id="gl-factor" term="Factor">
            A real-world force a company depends on, such as interest rates, oil prices or AI
            spending. Each exposure has a size from 0 to 3 and a direction (helped or hurt).
          </Item>
          <Item id="gl-hhi" term="HHI and effective number">
            HHI measures concentration: the sum of squared shares. Its inverse, the &ldquo;effective
            number&rdquo;, answers &ldquo;how many equal pieces does this feel like?&rdquo; Ten
            equal pieces give 10, one dominant piece gives close to 1.
          </Item>
        </dl>
      </Section>

      <Section id="data" title="About the data">
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            <strong>This copy may be running on demo data.</strong> Prices come from a generator
            that makes up repeatable price paths, and news stories marked [DEMO] and the exposure
            profiles are illustrative. Look for the banner at the top of the page. Nothing here
            describes the real market.
          </li>
          <li>
            Exposure scores are judgments with a confidence, not measurements. Each one records
            where it came from so it can be reviewed.
          </li>
          <li>
            News is matched to companies by name, so it can occasionally link the wrong company. It
            may coincide with a price move without having caused it.
          </li>
          <li>
            PortfolioLab provides research information, not investment advice, and past figures do
            not predict future results.
          </li>
        </ul>
      </Section>
    </article>
  );
}
