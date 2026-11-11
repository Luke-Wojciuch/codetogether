"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
const tutor_1 = require("../prompts/tutor");
const assessment_1 = require("./assessment");
const quiz_1 = require("../prompts/quiz");
const quiz_2 = require("./quiz");
class Session {
    context;
    history = [];
    reviewedAnswers;
    assessment;
    quiz;
    constructor(context) {
        this.context = context;
    }
    setQuiz(goal, raw) {
        const questions = (0, quiz_2.parseQuiz)(raw, this.context);
        this.quiz = { goal, questions };
        this.assessment = undefined;
        this.reviewedAnswers = undefined;
        return this.quiz;
    }
    requireReviewedQuiz(submission, requireAllQuestions = false) {
        if (!this.quiz || !this.assessment || !this.reviewedAnswers) {
            throw new Error('Submit every question in a review quiz before approving a commit. Tutor-only sessions cannot approve commits.');
        }
        const answers = (0, quiz_2.requireQuizAnswers)(submission, this.quiz.questions);
        if (JSON.stringify(this.quiz.questions.map(question => answers[question.id].trim())) !== this.reviewedAnswers) {
            throw new Error('Your quiz answers have changed. Submit them again before approving a commit.');
        }
        if (requireAllQuestions && this.quiz.questions.some(question => !this.assessment.concepts.some(concept => concept.id === question.id && concept.status === 'demonstrated' && !!concept.quote?.trim()))) {
            throw new Error('Every quiz question must show understanding before approving a commit. Get help, revise your answers, and submit the quiz again.');
        }
    }
    messages(answer, kind = 'discussion') {
        const sources = this.context.sources.map((source, index) => {
            const lines = source.content.split('\n');
            const start = source.startLine ?? 1;
            const range = kind === 'quiz' ? ` (sourceId=${index + 1}; original lines ${start}-${start + lines.length - 1})` : '';
            return `Source ${index + 1}: ${source.name}${range}\n${lines.map((line, n) => `${n + start}: ${line}`).join('\n')}`;
        });
        const messages = [
            { role: 'system', content: (kind === 'test' ? assessment_1.assessmentInstructions : kind === 'quiz' ? quiz_1.quizInstructions : tutor_1.tutorInstructions) +
                    (this.quiz && kind !== 'goal' && kind !== 'quiz' ? '\nThe current quiz contains ' + this.quiz.questions.length +
                        ' question(s). Discuss and recap only its included topics. Omitted topics were not requested and must not be described as missing answers or gaps.' : '') +
                    '\nCurrent turn: ' + kind + '. Validated assessment for this goal: ' +
                    JSON.stringify(kind === 'goal' || kind === 'quiz' ? null : this.assessment ?? null) },
            { role: 'user', content: `CODE CONTEXT (${this.context.label})\n${this.context.diff ?? ''}\n${sources.join('\n\n')}` },
            ...this.history,
            ...(this.quiz && kind !== 'quiz' && kind !== 'goal' ? [{ role: 'user',
                    content: 'REVIEW QUIZ (current goal and questions; developer answers follow):\n' + JSON.stringify(this.quiz) }] : []),
            { role: 'user', content: answer }
        ];
        // Fail explicitly rather than silently dropping earlier corrections or code.
        if (JSON.stringify(messages).length > 120_000) {
            throw new Error('Session is too large. Start a new session with a smaller selection or change.');
        }
        return messages;
    }
    complete(answer, reply, kind = 'discussion') {
        let text = (0, assessment_1.visibleReply)(reply).trim();
        if (kind === 'test') {
            const answers = this.quiz ? Object.values((0, quiz_2.requireQuizAnswers)(answer, this.quiz.questions)) : (0, assessment_1.submittedAnswers)(answer);
            const assessment = (0, assessment_1.parseAssessment)(reply, answers, this.quiz?.questions.map(question => question.id));
            if (!assessment) {
                throw new Error('The model did not return a usable assessment. Your answers are saved; retry the check.');
            }
            if (reply.trimStart().startsWith('{')) {
                const value = JSON.parse(reply);
                text = typeof value.feedback === 'string' ? value.feedback.trim() : '';
            }
            if (!text) {
                throw new Error('The model returned no assessment feedback. Your answers are saved; retry the check.');
            }
            this.assessment = assessment;
            if (this.quiz) {
                const submitted = (0, quiz_2.requireQuizAnswers)(answer, this.quiz.questions);
                this.reviewedAnswers = JSON.stringify(this.quiz.questions.map(question => submitted[question.id].trim()));
            }
        }
        if (!text) {
            throw new Error('The model returned no explanation. You can retry.');
        }
        if (kind === 'goal') {
            this.assessment = undefined;
            this.quiz = undefined;
            this.reviewedAnswers = undefined;
        }
        this.history.push({ role: 'user', content: answer }, { role: 'assistant', content: text });
        return text;
    }
    reference(sourceId, line, endLine = line) {
        const source = this.context.sources[sourceId - 1];
        const start = source?.startLine ?? 1;
        return Number.isInteger(sourceId) && Number.isInteger(line) && Number.isInteger(endLine) && line >= start && endLine >= line &&
            source && endLine < start + source.content.split('\n').length ? source : undefined;
    }
}
exports.Session = Session;
//# sourceMappingURL=session.js.map