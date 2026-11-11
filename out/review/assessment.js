"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessmentInstructions = exports.assessmentFormat = exports.conceptIds = void 0;
exports.submittedAnswers = submittedAnswers;
exports.assessIndependently = assessIndependently;
exports.visibleReply = visibleReply;
exports.parseAssessment = parseAssessment;
const assessment_1 = require("../prompts/assessment");
exports.conceptIds = ['purpose', 'behavior', 'effect', 'edge'];
function submittedAnswers(submission) {
    try {
        const answers = JSON.parse(submission);
        if (exports.conceptIds.every(id => typeof answers?.[id] === 'string')) {
            return exports.conceptIds.map(id => answers[id]);
        }
    }
    catch { /* Older conversation entries use a labelled text submission. */ }
    return [submission];
}
// Each request sees just one answer. Blank fields never reach the judge.
async function assessIndependently(submission, evaluate) {
    const answers = submittedAnswers(submission);
    if (answers.length !== exports.conceptIds.length) {
        throw new Error('Could not read the four answers. Submit the check again.');
    }
    const concepts = [];
    const feedback = [];
    const uncertainties = [];
    for (const [index, id] of exports.conceptIds.entries()) {
        const answer = answers[index].trim();
        if (!answer) {
            concepts.push({ id, status: 'unexplored' });
            continue;
        }
        const raw = await evaluate(answer, id);
        const assessment = parseAssessment(raw, [answer]);
        const value = JSON.parse(raw);
        if (!assessment || typeof value.feedback !== 'string' || !value.feedback.trim()) {
            throw new Error('The model did not return a usable assessment. Your answers are saved; retry the check.');
        }
        concepts.push(assessment.concepts.find(concept => concept.id === id));
        feedback.push('### ' + id[0].toUpperCase() + id.slice(1) + '\n' + value.feedback.trim());
        uncertainties.push(...assessment.uncertainties);
    }
    return JSON.stringify({ feedback: feedback.join('\n\n') || 'No answers yet. Try one area or return to the discussion for help.',
        concepts, uncertainties: [...new Set(uncertainties)] });
}
exports.assessmentFormat = {
    type: 'object', required: ['feedback', 'concepts', 'uncertainties'], additionalProperties: false,
    properties: {
        feedback: { type: 'string', minLength: 1 },
        concepts: { type: 'array', minItems: 4, maxItems: 4, items: {
                type: 'object', required: ['id', 'status', 'quote'], additionalProperties: false,
                properties: { id: { type: 'string', enum: exports.conceptIds },
                    status: { type: 'string', enum: ['unexplored', 'discussed', 'demonstrated'] }, quote: { type: 'string' } }
            } },
        uncertainties: { type: 'array', items: { type: 'string' } }
    }
};
exports.assessmentInstructions = (0, assessment_1.buildAssessmentInstructions)(exports.assessmentFormat);
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
function parseAssessment(raw, answers, expectedIds = exports.conceptIds) {
    const match = raw.match(/<review-state>([\s\S]*?)<\/review-state>\s*$/);
    try {
        const value = JSON.parse(match ? match[1] : raw);
        if (!Array.isArray(value.concepts) || value.concepts.length !== expectedIds.length || !expectedIds.length || !Array.isArray(value.uncertainties)) {
            return;
        }
        const concepts = [];
        for (const id of expectedIds) {
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
//# sourceMappingURL=assessment.js.map