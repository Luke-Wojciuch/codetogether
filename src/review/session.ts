import { tutorInstructions } from '../prompts/tutor';
import { assessmentInstructions, parseAssessment, ReviewAssessment, submittedAnswers, TurnKind, visibleReply } from './assessment';
import { quizInstructions } from '../prompts/quiz';
import { parseQuiz, Quiz, requireQuizAnswers } from './quiz';
import type { StagedSnapshot } from '../git/client';

export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface Source { name: string; content: string; language: string; startLine?: number }
export interface FileChange { name: string; added: number | null; deleted: number | null }
export interface CodeContext { label: string; diff?: string; sources: Source[]; changes?: FileChange[]; staged?: StagedSnapshot }


export class Session {
	private history: Message[] = [];
	private reviewedAnswers: string | undefined;
	assessment: ReviewAssessment | undefined;
	quiz: Quiz | undefined;
	constructor(readonly context: CodeContext) {}

	setQuiz(goal: string, raw: string): Quiz {
		const questions = parseQuiz(raw, this.context);
		this.quiz = { goal, questions };
		this.assessment = undefined;
		this.reviewedAnswers = undefined;
		return this.quiz;
	}

	requireReviewedQuiz(submission: string, requireAllQuestions = false): void {
		if (!this.quiz || !this.assessment || !this.reviewedAnswers) {
			throw new Error('Submit every question in a review quiz before approving a commit. Tutor-only sessions cannot approve commits.');
		}
		const answers = requireQuizAnswers(submission, this.quiz.questions);
		if (JSON.stringify(this.quiz.questions.map(question => answers[question.id].trim())) !== this.reviewedAnswers) {
			throw new Error('Your quiz answers have changed. Submit them again before approving a commit.');
		}
		if (requireAllQuestions && this.quiz.questions.some(question => !this.assessment!.concepts.some(concept =>
			concept.id === question.id && concept.status === 'demonstrated' && !!concept.quote?.trim()))) {
			throw new Error('Every quiz question must show understanding before approving a commit. Get help, revise your answers, and submit the quiz again.');
		}
	}

	messages(answer: string, kind: TurnKind = 'discussion'): Message[] {
		const sources = this.context.sources.map((source, index) => {
			const lines = source.content.split('\n');
			const start = source.startLine ?? 1;
			const range = kind === 'quiz' ? ` (sourceId=${index + 1}; original lines ${start}-${start + lines.length - 1})` : '';
			return `Source ${index + 1}: ${source.name}${range}\n${lines.map((line, n) => `${n + start}: ${line}`).join('\n')}`;
		});
		const messages: Message[] = [
			{ role: 'system', content: (kind === 'test' ? assessmentInstructions : kind === 'quiz' ? quizInstructions : tutorInstructions) +
				(this.quiz && kind !== 'goal' && kind !== 'quiz' ? '\nThe current quiz contains ' + this.quiz.questions.length +
					' question(s). Discuss and recap only its included topics. Omitted topics were not requested and must not be described as missing answers or gaps.' : '') +
				'\nCurrent turn: ' + kind + '. Validated assessment for this goal: ' +
					JSON.stringify(kind === 'goal' || kind === 'quiz' ? null : this.assessment ?? null) },
			{ role: 'user', content: `CODE CONTEXT (${this.context.label})\n${this.context.diff ?? ''}\n${sources.join('\n\n')}` },
			...this.history,
			...(this.quiz && kind !== 'quiz' && kind !== 'goal' ? [{ role: 'user' as const,
				content: 'REVIEW QUIZ (current goal and questions; developer answers follow):\n' + JSON.stringify(this.quiz) }] : []),
			{ role: 'user', content: answer }
		];
		// Fail explicitly rather than silently dropping earlier corrections or code.
		if (JSON.stringify(messages).length > 120_000) {
			throw new Error('Session is too large. Start a new session with a smaller selection or change.');
		}
		return messages;
	}

	complete(answer: string, reply: string, kind: TurnKind = 'discussion'): string {
		let text = visibleReply(reply).trim();
		if (kind === 'test') {
			const answers = this.quiz ? Object.values(requireQuizAnswers(answer, this.quiz.questions)) : submittedAnswers(answer);
			const assessment = parseAssessment(reply, answers, this.quiz?.questions.map(question => question.id));
			if (!assessment) { throw new Error('The model did not return a usable assessment. Your answers are saved; retry the check.'); }
			if (reply.trimStart().startsWith('{')) {
				const value = JSON.parse(reply) as { feedback?: unknown };
				text = typeof value.feedback === 'string' ? value.feedback.trim() : '';
			}
			if (!text) { throw new Error('The model returned no assessment feedback. Your answers are saved; retry the check.'); }
			this.assessment = assessment;
			if (this.quiz) {
				const submitted = requireQuizAnswers(answer, this.quiz.questions);
				this.reviewedAnswers = JSON.stringify(this.quiz.questions.map(question => submitted[question.id].trim()));
			}
		}
		if (!text) { throw new Error('The model returned no explanation. You can retry.'); }
		if (kind === 'goal') { this.assessment = undefined; this.quiz = undefined; this.reviewedAnswers = undefined; }
		this.history.push({ role: 'user', content: answer }, { role: 'assistant', content: text });
		return text;
	}

	reference(sourceId: number, line: number, endLine = line): Source | undefined {
		const source = this.context.sources[sourceId - 1];
		const start = source?.startLine ?? 1;
		return Number.isInteger(sourceId) && Number.isInteger(line) && Number.isInteger(endLine) && line >= start && endLine >= line &&
			source && endLine < start + source.content.split('\n').length ? source : undefined;
	}
}
