"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quizAssessmentFormat = exports.quizFormat = void 0;
exports.assessQuiz = assessQuiz;
exports.parseQuiz = parseQuiz;
exports.requireQuizAnswers = requireQuizAnswers;
const assessment_1 = require("./assessment");
exports.quizFormat = {
    type: 'object', required: ['questions'], additionalProperties: false,
    properties: { questions: { type: 'array', minItems: 1, maxItems: 4, items: {
                type: 'object', required: ['id', 'prompt'], additionalProperties: false,
                properties: {
                    id: { type: 'string', enum: assessment_1.conceptIds }, prompt: { type: 'string', minLength: 1 },
                    sourceId: { type: 'integer', minimum: 0 }, line: { type: 'integer', minimum: 0 }, endLine: { type: 'integer', minimum: 0 }
                }
            } } }
};
exports.quizAssessmentFormat = {
    type: 'object', required: ['status', 'quote', 'feedback', 'uncertainties'], additionalProperties: false,
    properties: {
        status: { type: 'string', enum: ['unexplored', 'discussed', 'demonstrated'] },
        quote: { type: 'string' },
        feedback: { type: 'string', minLength: 1 },
        uncertainties: { type: 'array', items: { type: 'string' } }
    }
};
async function assessQuiz(quiz, submission, evaluate) {
    const answers = requireQuizAnswers(submission, quiz.questions);
    const concepts = [];
    const feedback = [];
    const uncertainties = [];
    for (const question of quiz.questions) {
        const answer = answers[question.id].trim();
        const label = question.id === 'edge' ? 'Edge cases' : question.id[0].toUpperCase() + question.id.slice(1);
        if (/^(?:i['’]m not sure(?: yet)?|i (?:do not|don['’]t) know)[.!?]?$/i.test(answer)) {
            concepts.push({ id: question.id, status: 'unexplored' });
            feedback.push('### ' + label + '\nYou recorded that you are not sure yet. You can ask the tutor for help or finish with this gap recorded.');
            continue;
        }
        const raw = await evaluate(question, answer);
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch { /* Report the same recoverable error for malformed and incomplete replies. */ }
        if (!value || typeof value.feedback !== 'string' || !value.feedback.trim() || typeof value.quote !== 'string' ||
            !['unexplored', 'discussed', 'demonstrated'].includes(value.status) || !Array.isArray(value.uncertainties) ||
            !value.uncertainties.every((item) => typeof item === 'string')) {
            throw new Error('The model did not return usable quiz feedback. Your answers are saved; retry the quiz.');
        }
        // A bare verdict is not an explanation and may contradict the structured grade.
        // Do not infer credit from prose or present it as a meaningful developer gap.
        const feedbackText = value.feedback.replace(/[*_`#.!?]/g, '').trim();
        if (/^(?:(?:purpose|behavior|effect|edge(?: cases?)?)\s*[:\u2014-]?\s*)?(?:demonstrated|discussed|unexplored|understanding (?:shown|demonstrated)|needs clarification|not yet shown|(?:partially )?(?:correct|incorrect)|pass(?:ed)?|fail(?:ed)?)$/i.test(feedbackText)) {
            throw new Error('The model returned only a verdict, not an explanation of your answer. Your answers and previous result are saved; submit the quiz again.');
        }
        const supported = value.quote.trim().length > 0 && answer.includes(value.quote);
        const status = value.status === 'demonstrated' && !supported ? 'discussed' : value.status;
        concepts.push({ id: question.id, status, ...(status === 'demonstrated' ? { quote: value.quote } : {}) });
        feedback.push('### ' + label + '\n' + (value.status === 'demonstrated' && !supported
            ? 'The model did not supply a matching quote from this answer, so its positive assessment could not be verified. You can retry the quiz or ask the tutor for help.'
            : value.feedback.trim()));
        uncertainties.push(...value.uncertainties.map((item) => item.trim()).filter(Boolean));
    }
    return JSON.stringify({ feedback: feedback.join('\n\n'), concepts, uncertainties: [...new Set(uncertainties)] });
}
function parseQuiz(raw, context) {
    const invalid = (reason) => new Error('The model returned an invalid quiz: ' + reason + '. Retry to generate your quiz.');
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        throw invalid('the response was not valid JSON');
    }
    if (!Array.isArray(value?.questions) || value.questions.length < 1 || value.questions.length > assessment_1.conceptIds.length) {
        throw invalid('expected between 1 and 4 questions');
    }
    if (!context.sources.some(source => source.content.trim()) && !context.diff?.trim()) {
        throw invalid('no code was supplied');
    }
    const questions = [];
    for (const id of assessment_1.conceptIds) {
        const matches = value.questions.filter(item => item?.id === id);
        if (matches.length > 1) {
            throw invalid('multiple questions used the same topic');
        }
        if (matches.length === 0) {
            continue;
        }
        const item = matches[0];
        if (typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 1500) {
            throw invalid('a question is missing usable text');
        }
        const source = context.sources[item.sourceId - 1];
        const start = source?.startLine ?? 1;
        const validSource = [item.sourceId, item.line, item.endLine].every(Number.isInteger) &&
            source && item.line >= start && item.endLine >= item.line &&
            item.endLine < start + source.content.split('\n').length;
        // A model's optional citation must not invalidate a usable question. Never clamp
        // or guess coordinates: discard an invalid citation rather than link unrelated code.
        questions.push({ id, prompt: item.prompt.trim(),
            ...(validSource ? { sourceId: item.sourceId, line: item.line, endLine: item.endLine }
                : { sourceId: 0, line: 0, endLine: 0 }) });
    }
    if (questions.length !== value.questions.length) {
        throw invalid('a question used an unknown topic');
    }
    if (new Set(questions.map(question => question.prompt.toLowerCase())).size !== questions.length) {
        throw invalid('the questions repeat the same prompt');
    }
    return questions;
}
function requireQuizAnswers(submission, questions) {
    let answers;
    try {
        answers = JSON.parse(submission);
    }
    catch { /* Use the same recoverable error for an incomplete or unreadable submission. */ }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
        Object.keys(answers).length !== questions.length || !questions.length ||
        questions.some(question => typeof answers[question.id] !== 'string' || !answers[question.id].trim())) {
        throw new Error('Respond to every question in this quiz. You can say "I\u2019m not sure" when you need help.');
    }
    return answers;
}
//# sourceMappingURL=quiz.js.map