// Usage: tsx src/eval-cli.ts [--file evals/classification-dev.json] [--model gpt-6-sol]
// Needs OPENAI_API_KEY. Makes one API call per example and spends real money.
import OpenAI from "openai";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OpenAIClassifier, DEFAULT_MODEL } from "./classifier";
import { runEval, type EvalExample } from "./eval";

const { values } = parseArgs({
  options: {
    file: {
      type: "string",
      default: fileURLToPath(new URL("../evals/classification-dev.json", import.meta.url)),
    },
    model: { type: "string", default: DEFAULT_MODEL },
  },
});

const examples = JSON.parse(await readFile(values.file!, "utf8")) as EvalExample[];
const synthetic = examples.filter((e) => e.source === "synthetic").length;
if (synthetic > 0)
  console.warn(
    `${synthetic} of ${examples.length} examples are synthetic: use for harness checks, not for reported accuracy.`,
  );

const classifier = new OpenAIClassifier(new OpenAI(), values.model);
const { report, predictions } = await runEval(classifier, examples);

const outDir = fileURLToPath(new URL("../evals/out/", import.meta.url));
await mkdir(outDir, { recursive: true });
const file = `${outDir}${classifier.model}-${classifier.promptVersion}-${Date.now()}.json`;
await writeFile(
  file,
  JSON.stringify(
    { model: classifier.model, promptVersion: classifier.promptVersion, report, predictions },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      accuracy: report.accuracy,
      macroF1: report.macroF1,
      failures: report.failures,
      slices: report.slices,
    },
    null,
    2,
  ),
);
console.log(`wrote ${file}`);
