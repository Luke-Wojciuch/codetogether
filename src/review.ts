export const conceptIds = ['purpose', 'behavior', 'effect', 'edge'] as const;
export type ConceptId = typeof conceptIds[number];
export type TurnKind = 'goal' | 'discussion' | 'recap';
export interface Concept {
	id: ConceptId;
	status: 'unexplored' | 'discussed' | 'demonstrated';
	quote?: string;
}
export interface ReviewAssessment { concepts: Concept[]; uncertainties: string[] }

export const assessmentInstructions = `After each response, append a separate <review-state>JSON</review-state> block for the UI.
JSON shape: {"concepts":[{"id":"purpose","status":"unexplored"},{"id":"behavior","status":"discussed"},{"id":"effect","status":"demonstrated","quote":"exact words from a developer answer"},{"id":"edge","status":"unexplored"}],"uncertainties":["A specific remaining uncertainty"]}.
Always include exactly these four ids: purpose (why), behavior (main flow), effect (consequences/failure), edge (boundary or limitation). Status is unexplored, discussed, or demonstrated. These are discussion topics, not required quiz questions.
Use demonstrated only when a developer answer shows correct reasoning about that topic; include a verbatim quote of at least 12 characters from that answer. A goal, question, agreement, assistant explanation, or request to finish is not evidence. Use discussed when you explained it but the developer has not shown it. Reconsider evidence after corrections; clear assessments when the goal changes. This is a tentative model assessment, not a grade or certification. Keep the JSON out of the conversational prose.`;

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
	if (!match) { return; }
	try {
		const value = JSON.parse(match[1]) as { concepts?: unknown; uncertainties?: unknown };
		if (!Array.isArray(value.concepts) || value.concepts.length !== conceptIds.length || !Array.isArray(value.uncertainties)) { return; }
		const concepts: Concept[] = [];
		for (const id of conceptIds) {
			const matches = value.concepts.filter(item => item?.id === id);
			if (matches.length !== 1) { return; }
			const item = matches[0];
			if (!['unexplored', 'discussed', 'demonstrated'].includes(item.status)) { return; }
			const quote = typeof item.quote === 'string' ? item.quote : '';
			const supported = quote.trim().length >= 12 && answers.some(answer => answer.includes(quote));
			concepts.push({ id, status: item.status === 'demonstrated' && !supported ? 'discussed' : item.status,
				...(item.status === 'demonstrated' && supported ? { quote } : {}) });
		}
		return { concepts, uncertainties: value.uncertainties.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 6) };
	} catch { return; }
}
