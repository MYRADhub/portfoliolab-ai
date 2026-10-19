import type { Classifier } from "./classifier";
import type { ArticleInput, Classification } from "./schema";
import { CLASSES } from "./schema";

export interface EvalExample {
  id: string;
  article: Omit<ArticleInput, "publishedAt"> & { publishedAt: string };
  label: { classification: Classification; eventType?: string };
  /** Slices to report separately, for example "adversarial". */
  tags: string[];
  /** Where the label came from. Synthetic examples are for harness development, never for headline numbers. */
  source: "synthetic" | "human";
}

export interface Prediction {
  id: string;
  tags: string[];
  expected: Classification;
  expectedEventType?: string;
  /** Null when the call failed (refusal, truncation, invalid output); counted as incorrect. */
  predicted: Classification | null;
  predictedEventType: string | null;
  confidence: number | null;
  status: string;
}

export interface ClassMetrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
}

export interface CalibrationBin {
  range: [number, number];
  n: number;
  meanConfidence: number;
  accuracy: number;
}

export interface EvalReport {
  n: number;
  failures: Record<string, number>;
  accuracy: number;
  macroF1: number | null;
  perClass: Record<Classification, ClassMetrics>;
  /** confusion[expected][predicted]; predicted "failed" counts calls that produced no label. */
  confusion: Record<string, Record<string, number>>;
  eventTypeAccuracy: number | null;
  calibration: CalibrationBin[];
  slices: Record<string, { n: number; accuracy: number }>;
}

const BINS: [number, number][] = [
  [0, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0000001],
];

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function scorePredictions(preds: readonly Prediction[]): EvalReport {
  const n = preds.length;
  const failures: Record<string, number> = {};
  const confusion: Record<string, Record<string, number>> = {};
  for (const c of CLASSES)
    confusion[c] = { ...Object.fromEntries([...CLASSES, "failed"].map((k) => [k, 0])) };

  let correct = 0;
  for (const p of preds) {
    if (p.predicted === null) failures[p.status] = (failures[p.status] ?? 0) + 1;
    confusion[p.expected]![p.predicted ?? "failed"]! += 1;
    if (p.predicted === p.expected) correct++;
  }

  const perClass = {} as Record<Classification, ClassMetrics>;
  const f1s: number[] = [];
  for (const c of CLASSES) {
    const tp = confusion[c]![c]!;
    const support = Object.values(confusion[c]!).reduce((a, b) => a + b, 0);
    const predictedAsC = CLASSES.reduce((a, e) => a + confusion[e]![c]!, 0);
    const precision = ratio(tp, predictedAsC);
    const recall = ratio(tp, support);
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : precision === null && recall === null
          ? null
          : 0;
    perClass[c] = { precision, recall, f1, support };
    if (support > 0 && f1 !== null) f1s.push(f1);
  }

  const typed = preds.filter((p) => p.expectedEventType !== undefined);
  const eventTypeAccuracy = ratio(
    typed.filter((p) => p.predictedEventType === p.expectedEventType).length,
    typed.length,
  );

  const scored = preds.filter((p) => p.predicted !== null && p.confidence !== null);
  const calibration: CalibrationBin[] = BINS.flatMap(([lo, hi]) => {
    const inBin = scored.filter((p) => p.confidence! >= lo && p.confidence! < hi);
    if (inBin.length === 0) return [];
    return [
      {
        range: [lo, Math.min(hi, 1)] as [number, number],
        n: inBin.length,
        meanConfidence: inBin.reduce((a, p) => a + p.confidence!, 0) / inBin.length,
        accuracy: inBin.filter((p) => p.predicted === p.expected).length / inBin.length,
      },
    ];
  });

  const slices: EvalReport["slices"] = {};
  for (const tag of new Set(preds.flatMap((p) => p.tags))) {
    const inSlice = preds.filter((p) => p.tags.includes(tag));
    slices[tag] = {
      n: inSlice.length,
      accuracy: inSlice.filter((p) => p.predicted === p.expected).length / inSlice.length,
    };
  }

  return {
    n,
    failures,
    accuracy: n === 0 ? 0 : correct / n,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    perClass,
    confusion,
    eventTypeAccuracy,
    calibration,
    slices,
  };
}

/** Runs the classifier over examples with bounded concurrency. API errors propagate: an eval with silent gaps is worse than a failed one. */
export async function runEval(
  classifier: Classifier,
  examples: readonly EvalExample[],
  opts: { concurrency?: number } = {},
): Promise<{ report: EvalReport; predictions: Prediction[] }> {
  const { concurrency = 4 } = opts;
  const predictions: Prediction[] = new Array(examples.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, examples.length) }, async () => {
      while (next < examples.length) {
        const i = next++;
        const ex = examples[i]!;
        const r = await classifier.classify({ ...ex.article, publishedAt: ex.article.publishedAt });
        predictions[i] = {
          id: ex.id,
          tags: ex.tags,
          expected: ex.label.classification,
          expectedEventType: ex.label.eventType,
          predicted: r.status === "ok" ? r.output.classification : null,
          predictedEventType: r.status === "ok" ? r.output.event_type : null,
          confidence: r.status === "ok" ? r.output.confidence : null,
          status: r.status,
        };
      }
    }),
  );
  return { report: scorePredictions(predictions), predictions };
}
