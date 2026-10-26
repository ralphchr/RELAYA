/**
 * See exactly what Relaya writes for a sentence, without a microphone:
 *   pnpm --filter @relaya/backend try:text "Magandang gabi po. We want to know if this works or not."
 * Several sentences in quotes test them one after another. Needs GROQ_API_KEY in backend/.env.local.
 */
import { PipelineError, rewriteText } from "./pipeline/reconstruct.js";

const sentences = process.argv.slice(2);
if (!sentences.length) {
  console.error('Usage: pnpm --filter @relaya/backend try:text "<what you said>" ["<another>" ...]');
  process.exitCode = 1;
}

for (const said of sentences) {
  try {
    const { rewrite, guard } = await rewriteText(said, "professional", []);
    console.log(`\nSaid:       ${said}`);
    console.log(`English:    ${rewrite.sentence}`);
    if (rewrite.hedgedSentence !== rewrite.sentence) console.log(`Hedged:     ${rewrite.hedgedSentence}`);
    console.log(`Languages:  ${rewrite.languages.join(", ")}   Confidence: ${rewrite.confidence}`);
    if (rewrite.unresolvedTerms.length) console.log(`Unclear:    ${rewrite.unresolvedTerms.join(", ")}`);
    console.log(`Guard:      ${guard.status}${guard.issues.map((i) => `\n            - ${i.title}: "${i.said}" → fix "${i.fix.sentence}"`).join("")}`);
  } catch (error) {
    console.log(`\nSaid:       ${said}`);
    console.log(`FAILED:     ${error instanceof PipelineError ? `${error.code}: ${error.message}` : String(error)}`);
  }
}
console.log("");
