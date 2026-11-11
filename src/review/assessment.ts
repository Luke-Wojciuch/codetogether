import { buildAssessmentInstructions } from '../prompts/assessment';
export const conceptIds = ['purpose', 'behavior', 'effect', 'edge'] as const;
export type ConceptId = typeof conceptIds[number];
export type TurnKind = 'goal' | 'discussion' | 'quiz' | 'test' | 'recap';
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

export const assessmentInstructions = buildAssessmentInstructions(assessmentFormat);

// Do not stream metadata, including a partially received opening tag, into the chat.
export function visibleReply(raw: string): string {
	const start = raw.indexOf('<review-state>');
	if (start >= 0) { return raw.slice(0, start).trimEnd(); }
	for (let length = '<review-state>'.length - 1; length > 0; length--) {
		if (raw.endsWith('<review-state>'.slice(0, length))) { return raw.slice(0, -length); }
	}
	return raw;
}

export function parseAssessment(raw: string, answers: string[], expectedIds: readonly ConceptId[] = conceptIds): ReviewAssessment | undefined {
	const match = raw.match(/<review-state>([\s\S]*?)<\/review-state>\s*$/);
	try {
		const value = JSON.parse(match ? match[1] : raw) as { concepts?: unknown; uncertainties?: unknown };
		if (!Array.isArray(value.concepts) || value.concepts.length !== expectedIds.length || !expectedIds.length || !Array.isArray(value.uncertainties)) { return; }
		const concepts: Concept[] = [];
		for (const id of expectedIds) {
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
