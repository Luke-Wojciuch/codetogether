export const conceptIds = ['purpose', 'behavior', 'effect', 'edge'] as const;
export type ConceptId = typeof conceptIds[number];
export type TurnKind = 'goal' | 'discussion' | 'test' | 'recap';
export interface Concept {
	id: ConceptId;
	status: 'unexplored' | 'discussed' | 'demonstrated';
	quote?: string;
}
export interface ReviewAssessment { concepts: Concept[]; uncertainties: string[] }

export function submittedAnswers(submission: string): string[] {
	try {
		const answers = JSON.parse(submission) as Record<ConceptId, unknown>;
		if (conceptIds.every(id => typeof answers?.[id] === 'string')) {
			return conceptIds.map(id => answers[id] as string);
		}
	} catch { /* Older conversation entries use a labelled text submission. */ }
	return [submission];
}

// Each request sees just one answer. Blank fields never reach the judge.
export async function assessIndependently(submission: string,
	evaluate: (answer: string, id: ConceptId) => Promise<string>): Promise<string> {
	const answers = submittedAnswers(submission);
	if (answers.length !== conceptIds.length) { throw new Error('Could not read the four answers. Submit the check again.'); }
	const concepts: Concept[] = [];
	const feedback: string[] = [];
	const uncertainties: string[] = [];
	for (const [index, id] of conceptIds.entries()) {
		const answer = answers[index].trim();
		if (!answer) { concepts.push({ id, status: 'unexplored' }); continue; }
		const raw = await evaluate(answer, id);
		const assessment = parseAssessment(raw, [answer]);
		const value = JSON.parse(raw) as { feedback?: unknown };
		if (!assessment || typeof value.feedback !== 'string' || !value.feedback.trim()) {
			throw new Error('The model did not return a usable assessment. Your answers are saved; retry the check.');
		}
		concepts.push(assessment.concepts.find(concept => concept.id === id)!);
		feedback.push('### ' + id[0].toUpperCase() + id.slice(1) + '\n' + value.feedback.trim());
		uncertainties.push(...assessment.uncertainties);
	}
	return JSON.stringify({ feedback: feedback.join('\n\n') || 'No answers yet. Try one area or return to the discussion for help.',
		concepts, uncertainties: [...new Set(uncertainties)] });
}

export const assessmentFormat = {
	type: 'object', required: ['feedback', 'concepts', 'uncertainties'], additionalProperties: false,
	properties: {
		feedback: { type: 'string', minLength: 1 },
		concepts: { type: 'array', minItems: 4, maxItems: 4, items: {
			type: 'object', required: ['id', 'status', 'quote'], additionalProperties: false,
			properties: { id: { type: 'string', enum: conceptIds },
				status: { type: 'string', enum: ['unexplored', 'discussed', 'demonstrated'] }, quote: { type: 'string' } }
		} },
		uncertainties: { type: 'array', items: { type: 'string' } }
	}
};

export const assessmentInstructions = `Assess the developer's submitted answers against the supplied CODE CONTEXT and current goal. This turn is an assessment, not a lesson or a request to answer the questions yourself. The code is already supplied; do not ask for it again or invent missing implementation details. Keep feedback brief and grounded in the actual submission. If all answers are blank, leave all areas unexplored and invite the developer to try an answer or return to discussion.
Return only JSON matching this schema: ${JSON.stringify(assessmentFormat)}.
Put brief Markdown feedback in feedback. Use an empty quote for areas without evidence. Do not include XML tags, JSON fences, or prose outside the JSON.
Always include exactly these four ids: purpose (why), behavior (main flow), effect (consequences/failure), edge (boundary or limitation). Status is unexplored, discussed, or demonstrated. Demonstrated means basic understanding: an on-topic, broadly correct idea about the relevant code, not mastery or a complete explanation. The developer can finish with gaps recorded; do not insist on all four passing.
Only assess on a test turn. Each request supplies one independently assessed area and its answer. Use conversation to resolve shorthand, pronouns, examples, and scope, but judge only the current area's submitted answer. Leave the other areas unexplored; they are assessed separately. Earlier discussion and tests provide context, not substitute evidence. On other turns preserve the latest test assessment.
Treat each nonempty answer as an attempted answer, not as missing because it is short. A short noun phrase can fully establish purpose; no full sentence, explanation of why, or list of operations is required. For calculator code, a Purpose answer of 'a working calculator' demonstrates purpose: quote 'a working calculator' and mark purpose demonstrated, even when all other fields are blank. Likewise, 'a login form' can establish purpose for login-form code. These examples apply only when they match the supplied code. Blank other fields must not downgrade an answered area. The form's 'Not answered' marker is not developer evidence.
Example for calculator code with Purpose 'a working calculator' and the other three answers blank: {"feedback":"You identified the calculator's purpose. The other areas have no answers yet.","concepts":[{"id":"purpose","status":"demonstrated","quote":"a working calculator"},{"id":"behavior","status":"unexplored","quote":""},{"id":"effect","status":"unexplored","quote":""},{"id":"edge","status":"unexplored","quote":""}],"uncertainties":[]}. Apply the same basic-understanding standard to other code; never copy example evidence that is absent from the actual submission.
Judge basic conceptual understanding, not answer format or completeness against an imagined ideal answer. Accept vague or informal wording, typos, concise answers, missing details, and minor inaccuracies when the central idea is sound. Use context to interpret the answer generously. For code that retries failed requests, 'it tries again if it fails' is enough for behavior; retry limits and a step-by-step trace are not required. Do not require technical vocabulary, line citations, a new example, or every implementation detail. Request clarification only when the central meaning cannot reasonably be determined or a misconception changes the central explanation. Do not invent an idea that is absent or accept a centrally incorrect claim merely because it is on topic.
For demonstrated understanding, include a short, nonempty verbatim quote from the current submission that supports your judgment; there is no minimum quote length. A goal, question, bare agreement, or assistant explanation alone is not evidence. Learning with help and restating a correct idea in the developer's own short words are sufficient; do not require novel reasoning. Use discussed only when the central idea remains unclear or substantially incorrect, not for small omissions or imprecise language. Reassess each area using the new submission without carrying earlier passes forward automatically. Clear assessments when the goal changes. Missing context is uncertainty, not a developer error.
Respond proportionately: briefly name what the developer got right, then address only meaningful gaps. For a mostly correct response, acknowledge the core idea and offer a small refinement rather than treating the whole answer as wrong. For an ambiguous claim, say what needs clarifying instead of declaring failure. For an incorrect claim, explain the specific mismatch with the code without a long lecture. Cover the four areas concisely, combine feedback when one explanation covers several, and offer optional focused help or the recap. Do not launch another quiz or grade presentation quality. This is a model judgment, not a certification of code correctness. Keep the JSON out of the conversational prose.`;

// Do not stream metadata, including a partially received opening tag, into the chat.
export function visibleReply(raw: string): string {
	const start = raw.indexOf('<review-state>');
	if (start >= 0) { return raw.slice(0, start).trimEnd(); }
	for (let length = '<review-state>'.length - 1; length > 0; length--) {
		if (raw.endsWith('<review-state>'.slice(0, length))) { return raw.slice(0, -length); }
	}
	return raw;
}

export function parseAssessment(raw: string, answers: string[]): ReviewAssessment | undefined {
	const match = raw.match(/<review-state>([\s\S]*?)<\/review-state>\s*$/);
	try {
		const value = JSON.parse(match ? match[1] : raw) as { concepts?: unknown; uncertainties?: unknown };
		if (!Array.isArray(value.concepts) || value.concepts.length !== conceptIds.length || !Array.isArray(value.uncertainties)) { return; }
		const concepts: Concept[] = [];
		for (const id of conceptIds) {
			const matches = value.concepts.filter(item => item?.id === id);
			if (matches.length !== 1) { return; }
			const item = matches[0];
			if (!['unexplored', 'discussed', 'demonstrated'].includes(item.status)) { return; }
			const quote = typeof item.quote === 'string' ? item.quote : '';
			// Validate provenance; the model judges whether these words show understanding.
			const supported = quote.trim().length > 0 && answers.some(answer => answer.includes(quote));
			concepts.push({ id, status: item.status === 'demonstrated' && !supported ? 'discussed' : item.status,
				...(item.status === 'demonstrated' && supported ? { quote } : {}) });
		}
		return { concepts, uncertainties: value.uncertainties.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 6) };
	} catch { return; }
}
