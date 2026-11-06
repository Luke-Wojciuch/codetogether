"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessmentInstructions = exports.conceptIds = void 0;
exports.visibleReply = visibleReply;
exports.parseAssessment = parseAssessment;
exports.conceptIds = ['purpose', 'behavior', 'effect', 'edge'];
exports.assessmentInstructions = `After the test feedback, append a separate <review-state>JSON</review-state> block for the UI.
JSON shape: {"concepts":[{"id":"purpose","status":"unexplored"},{"id":"behavior","status":"discussed"},{"id":"effect","status":"demonstrated","quote":"exact words from a developer answer"},{"id":"edge","status":"unexplored"}],"uncertainties":["A specific remaining uncertainty"]}.
Always include exactly these four ids: purpose (why), behavior (main flow), effect (consequences/failure), edge (boundary or limitation). Status is unexplored, discussed, or demonstrated. Demonstrated means supported understanding. The developer can finish with gaps recorded; do not insist on all four passing.
Only assess on a test turn. Read the submission as a whole and reason about what the developer means, using the conversation to resolve shorthand, pronouns, examples, and scope. Credit an area wherever its reasoning appears in the submitted answers, even under another heading. A blank field does not erase understanding expressed elsewhere. If an area has no evidence anywhere in the submission, leave it unexplored. Earlier discussion and tests provide context, not substitute evidence. On other turns preserve the latest test assessment.
Judge conceptual understanding, not answer format or completeness against an imagined ideal answer. Accept informal wording, typos, concise answers, equivalent explanations, and correct implications that follow clearly from their words and supplied code. Do not require technical vocabulary, line citations, a step-by-step trace, a new example, or every implementation detail when the response already establishes the relevant idea. A brief answer can be sufficient in context; never demand elaboration just to make it longer. Do not infer reasoning the developer has not expressed or overlook an actual misconception.
For demonstrated understanding, include a short, nonempty verbatim quote from the current submission that supports your judgment; there is no minimum quote length. A goal, question, bare agreement, unsupported guess, or assistant explanation alone is not evidence. Learning with help and using familiar terminology are allowed; distinguish applying an idea from simply repeating it. Use discussed when some understanding is visible but a meaningful gap or mistake remains. Reassess each area using the new submission without carrying earlier passes forward automatically. Clear assessments when the goal changes. Missing context is uncertainty, not a developer error.
Respond proportionately: briefly name what the developer got right, then address only meaningful gaps. For a mostly correct response, acknowledge the core idea and offer a small refinement rather than treating the whole answer as wrong. For an ambiguous claim, say what needs clarifying instead of declaring failure. For an incorrect claim, explain the specific mismatch with the code without a long lecture. Cover the four areas concisely, combine feedback when one explanation covers several, and offer optional focused help or the recap. Do not launch another quiz or grade presentation quality. This is a model judgment, not a certification of code correctness. Keep the JSON out of the conversational prose.`;
// Do not stream metadata, including a partially received opening tag, into the chat.
function visibleReply(raw) {
    const start = raw.indexOf('<review-state>');
    if (start >= 0) {
        return raw.slice(0, start).trimEnd();
    }
    for (let length = '<review-state>'.length - 1; length > 0; length--) {
        if (raw.endsWith('<review-state>'.slice(0, length))) {
            return raw.slice(0, -length);
        }
    }
    return raw;
}
function parseAssessment(raw, answers) {
    const match = raw.match(/<review-state>([\s\S]*?)<\/review-state>\s*$/);
    if (!match) {
        return;
    }
    try {
        const value = JSON.parse(match[1]);
        if (!Array.isArray(value.concepts) || value.concepts.length !== exports.conceptIds.length || !Array.isArray(value.uncertainties)) {
            return;
        }
        const concepts = [];
        for (const id of exports.conceptIds) {
            const matches = value.concepts.filter(item => item?.id === id);
            if (matches.length !== 1) {
                return;
            }
            const item = matches[0];
            if (!['unexplored', 'discussed', 'demonstrated'].includes(item.status)) {
                return;
            }
            const quote = typeof item.quote === 'string' ? item.quote : '';
            // Validate provenance; the model judges whether these words show understanding.
            const supported = quote.trim().length > 0 && answers.some(answer => answer.includes(quote));
            concepts.push({ id, status: item.status === 'demonstrated' && !supported ? 'discussed' : item.status,
                ...(item.status === 'demonstrated' && supported ? { quote } : {}) });
        }
        return { concepts, uncertainties: value.uncertainties.filter((item) => typeof item === 'string' && !!item.trim()).slice(0, 6) };
    }
    catch {
        return;
    }
}
//# sourceMappingURL=review.js.map