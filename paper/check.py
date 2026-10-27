"""Re-derives the paper's main numbers from the exported data and writes them as LaTeX macros.

Usage: python3 paper/check.py   (standard library only)

The app computes everything in TypeScript. This script recomputes the key figures from the raw exports with a
separate implementation and stops with an error if the two disagree, so a bug in one would show up as a mismatch.
Every number in the paper is a macro from generated/numbers.tex; none is typed by hand.
"""

import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
GEN = HERE / "generated"
GEN.mkdir(exist_ok=True)

failures: list[str] = []
macros: dict[str, str] = {}


def check(name: str, ours: float, theirs: float, tol: float = 1e-9) -> None:
    if abs(ours - theirs) > tol:
        failures.append(f"{name}: python {ours!r} vs app {theirs!r}")


def macro(name: str, value: str) -> None:
    if not name.isalpha():
        raise ValueError(f"LaTeX macro names must be letters only: {name}")
    macros[name] = value


def load_json(name: str):
    return json.loads((DATA / name).read_text())


def rows(name: str) -> list[dict[str, str]]:
    with open(DATA / name, newline="") as f:
        return list(csv.DictReader(f))


def pct(x: float, digits: int = 1) -> str:
    sign = "$-$" if x < 0 else ""
    return f"{sign}{abs(x) * 100:.{digits}f}\\%"


def num(x: float, digits: int = 2) -> str:
    return f"{x:,.{digits}f}"


def ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(a: list[float], b: list[float]) -> float:
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    num_ = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num_ / den


def quantile(xs: list[float], q: float) -> float:
    s = sorted(xs)
    pos = q * (len(s) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def inline(name: str) -> str:
    """A force name for use mid-sentence: lower-case first letter unless it starts with a name or an acronym."""
    first = name.split()[0]
    return name if first.isupper() or first in ("China", "Taiwan", "U.S.") else name[0].lower() + name[1:]


meta = load_json("meta.json")
names: dict[str, str] = load_json("forces.json")
macro("dataThrough", meta["dataThrough"])
macro("nCompanies", str(meta["companies"]))
macro("nProfiled", str(meta["profiled"]))
macro("nExposureRows", f"{meta['exposureRows']:,}")

# 1. The exposure table.
expo = rows("exposures.csv")
by_company: dict[str, dict[str, int]] = defaultdict(dict)
sector_of: dict[str, str] = {}
for r in expo:
    by_company[r["ticker"]][r["force"]] = int(r["score"])
    sector_of[r["ticker"]] = r["sector"]
forces_per = [len(v) for v in by_company.values()]
macro("forcesPerCompany", num(statistics.fmean(forces_per), 1))
scores = [int(r["score"]) for r in expo]
macro("shareNegative", pct(sum(s < 0 for s in scores) / len(scores), 0))
macro("shareStrong", pct(sum(abs(s) == 3 for s in scores) / len(scores), 0))
force_counts = Counter(r["force"] for r in expo)
with open(GEN / "force-counts.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["force", "companies", "negative"])
    for force, n in force_counts.most_common():
        neg = sum(1 for r in expo if r["force"] == force and int(r["score"]) < 0)
        w.writerow([names[force], n, neg])
top_force, top_n = force_counts.most_common(1)[0]
macro("topForce", inline(names[top_force]))
macro("topForceCompanies", str(top_n))

# 2. Random portfolios, recomputed from the exposure table (ADR 0004: net loadings, normalized absolute shares).
port = rows("random-portfolios.csv")
eff_sectors: list[float] = []
eff_forces: list[float] = []
for p in port:
    tickers = p["tickers"].split("|")
    w = 1 / len(tickers)
    sectors = Counter(sector_of.get(t, "Unclassified") for t in tickers)
    es = 1 / sum((n * w) ** 2 for n in sectors.values())
    net: dict[str, float] = defaultdict(float)
    for t in tickers:
        for force, s in by_company.get(t, {}).items():
            net[force] += w * s
    total = sum(abs(v) for v in net.values())
    shares = [abs(v) / total for v in net.values() if abs(v) > 0]
    ef = 1 / sum(s * s for s in shares)
    check(f"portfolio {p['id']} effective sectors", es, float(p["effective_sectors"]))
    check(f"portfolio {p['id']} effective forces", ef, float(p["effective_forces"]))
    check(f"portfolio {p['id']} top force share", max(shares), float(p["top_force_share"]))
    eff_sectors.append(es)
    eff_forces.append(ef)

n_port = len(port)
macro("nRandom", f"{n_port:,}")
macro("randomSize", str(meta["randomPortfolios"]["size"]))
macro("medianEffSectors", num(statistics.median(eff_sectors), 1))
macro("medianEffForces", num(statistics.median(eff_forces), 1))
macro("loEffForces", num(quantile(eff_forces, 0.1), 1))
macro("hiEffForces", num(quantile(eff_forces, 0.9), 1))
spearman = pearson(ranks(eff_sectors), ranks(eff_forces))
macro("spearmanSectorsForces", num(spearman, 2))
broad = [ef for es, ef, p in zip(eff_sectors, eff_forces, port) if int(p["sectors"]) >= 8]
macro("nBroad", f"{len(broad):,}")
macro("broadMedianForces", num(statistics.median(broad), 1))
low = sum(ef < 4 for ef in broad) / len(broad)
macro("broadShareBelowFour", pct(low, 0))
# The forces-to-sectors gap, both measured as effective numbers out of their maximum.
gap = sum(ef < es for es, ef in zip(eff_sectors, eff_forces)) / n_port
macro("shareForcesBelowSectors", pct(gap, 0))
with open(GEN / "random-scatter.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["effective_sectors", "effective_forces"])
    for es, ef in zip(eff_sectors, eff_forces):
        w.writerow([round(es, 4), round(ef, 4)])

# 3. Exposures against sectors.
fit = load_json("forces-fit.json")
macro("fitDays", str(fit["days"]))
macro("fitFrom", fit["from"])
macro("fitTo", fit["to"])
macro("fitStocks", str(fit["stocks"]))
macro("fitExposures", pct(fit["fit"]["exposures"]))
macro("fitSectors", pct(fit["fit"]["sectors"]))
macro("fitDaysBetter", pct(fit["fit"]["daysExposuresBetter"], 0))
with open(DATA / "force-returns.csv", newline="") as f:
    fr = list(csv.DictReader(f))
final = {k: float(v) for k, v in fr[-1].items() if k != "date"}
best = max(final, key=lambda k: final[k])
worst = min(final, key=lambda k: final[k])
macro("bestForce", inline(names[best]))
macro("bestForceCum", pct(final[best]))
macro("worstForce", inline(names[worst]))
macro("worstForceCum", pct(final[worst]))
# The four forces that moved most over the year, every fifth day plus the last, as percentages, for the chart.
top4 = sorted(final, key=lambda k: -abs(final[k]))[:4]
for i, slug in enumerate(top4):
    macro(f"chartForce{'ABCD'[i]}", names[slug])
with open(GEN / "force-returns-top.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["day", "a", "b", "c", "d"])
    for i, r in enumerate(fr):
        if i % 5 == 0 or i == len(fr) - 1:
            w.writerow([i] + [round(float(r[k]) * 100, 4) for k in top4])

# 3b. The same fit with the earlier scores from the model's general knowledge.
mem = load_json("forces-fit-memory.json")
macro("nGrounded", str(meta["grounded"]))
macro("nMemoryCompared", str(mem["companiesWithEarlierDraft"]))
if mem["fit"]:
    macro("memExposures", pct(mem["fit"]["exposures"]))
    macro("memSectors", pct(mem["fit"]["sectors"]))
    macro("memDaysBetter", pct(mem["fit"]["daysExposuresBetter"], 0))

# 3c. The price check, with each force's rank correlation recomputed from the per-company scores and sensitivities.
pc = load_json("price-check.json")
pc_rows = rows("price-check.csv")
checked = [f for f in pc["forces"] if f["proxy"]]
for f in checked:
    pairs = [(float(r["score"]), float(r["t"])) for r in pc_rows if r["force"] == f["slug"]]
    check(f"price-check companies {f['slug']}", len(pairs), f["companies"], 0)
    rho = pearson(ranks([a for a, _ in pairs]), ranks([b for _, b in pairs]))
    check(f"price-check spearman {f['slug']}", rho, f["spearman"], 1e-9)
    rel = [(a, b) for a, b in pairs if a != 0 and abs(b) >= 2]
    check(f"price-check reliable {f['slug']}", len(rel), f["reliable"], 0)
macro("pcFrom", pc["window"]["from"])
macro("pcTo", pc["window"]["to"])
macro("pcDays", str(pc["window"]["days"]))
macro("pcChecked", str(len(checked)))
macro("pcPositive", str(sum(f["spearman"] > 0 for f in checked)))
rhos = sorted(checked, key=lambda f: f["spearman"])
macro("pcMedianRho", num(statistics.median(f["spearman"] for f in checked), 2))
macro("pcBestForce", inline(names[rhos[-1]["slug"]]))
macro("pcBestRho", num(rhos[-1]["spearman"], 2))
macro("pcWorstForce", inline(names[rhos[0]["slug"]]))
macro("pcWorstRho", num(rhos[0]["spearman"], 2))
tot_rel = sum(f["reliable"] for f in checked)
tot_agree = sum(round(f["signAgreement"] * f["reliable"]) for f in checked if f["signAgreement"] is not None)
macro("pcReliable", f"{tot_rel:,}")
macro("pcAgreement", pct(tot_agree / tot_rel, 0))
low = [f for f in checked if f["signAgreement"] is not None and f["signAgreement"] < 0.6]
low_names = [inline(names[f["slug"]]) for f in low]
macro(
    "pcLowAgreement",
    "none" if not low_names else low_names[0] if len(low_names) == 1 else ", ".join(low_names[:-1]) + " and " + low_names[-1],
)
def tex(text: str) -> str:
    return text.replace("&", "\\&").replace("%", "\\%")


# The table body as one macro: an \\input inside a tabular breaks the rule that follows it.
table_rows = []
for x in sorted(checked, key=lambda x: -x["spearman"]):
    agree = "n/a" if x["signAgreement"] is None else f"{pct(x['signAgreement'], 0)} of {x['reliable']}"
    table_rows.append(f"{names[x['slug']]} & {tex(x['proxy'].split(',')[0])} & {num(x['spearman'], 2)} & {agree} \\\\")
macro("pcTableRows", " ".join(table_rows))

# 4. Earnings reactions, recomputed from every event.
study = load_json("event-study.json")
react = [r for r in rows("reactions.csv") if r["earnings"] == "true" and r["overlaps_earnings"] == "false"]
typed = {t["slug"]: t for t in study["byType"]}
earn = [t for slug, t in typed.items() if t["n"] > 0 and slug.startswith("earnings")]
n_app = sum(t["n"] for t in earn)
check("earnings events", len(react), n_app, 0)
unusual = sum(1 for r in react if r["z0"] and abs(float(r["z0"])) >= 2) / len(react)
typical = statistics.fmean(abs(float(r["ar0"])) for r in react)
app_unusual = sum(t["unusualShare"] * t["n"] for t in earn) / n_app
app_typical = sum(t["typicalMove"] * t["n"] for t in earn) / n_app
check("unusual share", unusual, app_unusual, 1e-6)
check("typical move", typical, app_typical, 1e-6)
macro("nEarnings", f"{len(react):,}")
macro("earningsFrom", study["window"]["from"])
macro("earningsTo", study["window"]["to"])
macro("unusualShare", pct(unusual, 0))
macro("typicalMove", pct(typical))
macro("nEarningsCompanies", str(len({r["ticker"] for r in react})))

# 5. Pooled spillover test.
sp = load_json("spillover.json")
cp = sp["clusteredPartial"]
macro("spEvents", str(sp["events"]))
macro("spCompanies", str(len(sp["companies"])))
macro("spWeeks", str(sp["clusters"]))
macro("spPartial", num(sp["partialCorrelation"]["mean"], 3))
macro("spClusteredPartial", num(cp["mean"], 3))
macro("spClusteredT", num(cp["t"], 2))
macro("spCiLo", num(cp["ci"][0], 3))
macro("spCiHi", num(cp["ci"][1], 3))
macro("spRaw", num(sp["correlation"]["mean"], 3))
macro("spShuffles", f"{sp['placebo']['permutations']:,}")
macro("spNullSd", num(sp["placebo"]["nullSd"], 4))
p_floor = 1 / (sp["placebo"]["permutations"] + 1)
p = sp["placebo"]["pPartial"]
macro("spPlacebo", f"p < {1 / sp['placebo']['permutations'] * 2:.3f}" if p <= p_floor + 1e-12 else f"p = {p:.3f}")
macro("spNullDistance", num(cp["mean"] / sp["placebo"]["nullSd"], 0))
macro("spMinStocks", str(sp["minStocks"]))
# Check the clustered mean against the event-level one: weeks with one event weigh the same either way.
if cp["n"] != sp["clusters"]:
    failures.append("clustered partial n differs from the number of weeks")

# 6. AI against blind human scores.
ag = load_json("agreement.json")
cells = rows("agreement.csv")
macro("goldSize", str(ag["goldSize"]))
macro("nBlind", str(ag["ai"]["companies"]))
if cells:
    pairs = [(int(c["ai_score"]), int(c["human_score"])) for c in cells]
    scale = list(range(-3, 4))
    k = len(scale)
    n = len(pairs)
    ra = Counter(a for a, _ in pairs)
    rb = Counter(b for _, b in pairs)
    o = sum((scale.index(a) - scale.index(b)) ** 2 for a, b in pairs) / n
    e = sum(
        (i - j) ** 2 * ra[scale[i]] * rb[scale[j]] for i in range(k) for j in range(k)
    ) / (n * n)
    kappa = 1 - o / e
    check("weighted kappa", kappa, ag["ai"]["weightedKappa"], 1e-9)
    macro("kappaValue", num(kappa, 2))
    lo, hi = ag["ai"]["kappaInterval"]
    macro("kappaLo", num(lo, 2))
    macro("kappaHi", num(hi, 2))
    macro("signAgreement", pct(ag["ai"]["signAgreement"], 0) if ag["ai"]["signAgreement"] is not None else "n/a")
    macro("aiForces", num(ag["ai"]["aiForcesPerCompany"], 1))
    macro("humanForces", num(ag["ai"]["humanForcesPerCompany"], 1))
macro("haveAgreement", "true" if cells else "false")

# 7. Verdicts as the app states them.
ev = load_json("evidence.json")
for f in ev["findings"]:
    label = {"supported": "Supported", "not_supported": "Not supported", "inconclusive": "Inconclusive", "no_data": "Not enough data"}[f["verdict"]]
    macro({"spillover": "verdictSpillover", "sectors": "verdictSectors", "earnings": "verdictEarnings", "drafts": "verdictDrafts"}[f["id"]], label)

n_blind = ag["ai"]["companies"]
macro("blindEnough", "true" if n_blind >= 10 else "false")

with open(GEN / "numbers.tex", "w") as f:
    f.write("% Generated by paper/check.py from paper/data. Do not edit.\n")
    for name, value in sorted(macros.items()):
        f.write(f"\\newcommand{{\\{name}}}{{{value}}}\n")

if failures:
    print(f"{len(failures)} mismatches between the app and this independent check:", file=sys.stderr)
    for line in failures[:20]:
        print("  " + line, file=sys.stderr)
    sys.exit(1)
print(f"all checks passed; wrote {len(macros)} macros to {GEN / 'numbers.tex'}")
