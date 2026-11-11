"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const node_vm_1 = require("node:vm");
const assessment_1 = require("../review/assessment");
const session_1 = require("../review/session");
const stream_1 = require("../models/stream");
const quiz_1 = require("../review/quiz");
const assessment_2 = require("../prompts/assessment");
const commitGate_1 = require("../git/commitGate");
const quizCode = { label: 'Selected request', sources: [{ name: 'retry.ts', content: 'const pending = request();\nreturn pending;', language: 'typescript', startLine: 10 }] };
const quizPrompts = [
    'Why does this code return pending instead of starting a second request?',
    'If request() returns a pending promise, what does return pending give the caller?',
    'If the returned promise rejects, what outcome can the caller observe from these lines?',
    'What can these two lines tell us about handling two separate calls to request()?'
];
const quizQuestions = assessment_1.conceptIds.map((id, index) => ({ id, prompt: quizPrompts[index], sourceId: 1, line: 10, endLine: 11 }));
const quizRaw = JSON.stringify({ questions: quizQuestions });
const answer = 'A failed request can retry the same write twice.';
const state = {
    concepts: assessment_1.conceptIds.map(id => ({ id, status: id === 'effect' ? 'demonstrated' : 'discussed', ...(id === 'effect' ? { quote: answer } : {}) })),
    uncertainties: ['Whether the caller handles duplicate writes.']
};
const reply = 'The retry can repeat a write. [[1:10-11]]\n<review-state>' + JSON.stringify(state) + '</review-state>';
(0, node_test_1.suite)('Review evidence', () => {
    (0, node_test_1.test)('each blank field is skipped without affecting the other three judgments', async () => {
        for (const blank of assessment_1.conceptIds) {
            const answers = Object.fromEntries(assessment_1.conceptIds.map(id => [id, id === blank ? '' : 'answer for "' + id + '"']));
            const calls = [];
            const submission = JSON.stringify(answers);
            const result = await (0, assessment_1.assessIndependently)(submission, async (answer, id) => {
                calls.push(id);
                assert.notEqual(id, blank);
                assert.equal(answer, answers[id]);
                return JSON.stringify({ feedback: 'This idea is correct.', concepts: assessment_1.conceptIds.map(area => ({
                        id: area, status: area === id ? 'demonstrated' : 'unexplored', quote: area === id ? answer : ''
                    })), uncertainties: [] });
            });
            assert.equal(calls.length, 3);
            const session = new session_1.Session({ label: 'Independent areas', sources: [] });
            session.complete(submission, result, 'test');
            for (const concept of session.assessment.concepts) {
                assert.equal(concept.status, concept.id === blank ? 'unexplored' : 'demonstrated');
            }
        }
    });
    (0, node_test_1.test)('four blank answers need no model request and produce four unexplored areas', async () => {
        const result = await (0, assessment_1.assessIndependently)(JSON.stringify({ purpose: '', behavior: '', effect: '', edge: '' }), async () => {
            assert.fail('Blank answers must not call the model.');
        });
        assert.ok((0, assessment_1.parseAssessment)(result, [])?.concepts.every(concept => concept.status === 'unexplored'));
    });
    (0, node_test_1.test)('assessment requests enforce structured output and return feedback with validated evidence', async () => {
        const structured = JSON.stringify({ feedback: 'You understand the retry.', ...state });
        let request = {};
        const sandbox = (0, node_vm_1.createContext)({
            exports: {},
            require: (name) => name === 'vscode' ? { workspace: { getConfiguration: () => ({
                        get: (key) => key === 'model' ? 'test-model' : false
                    }) } } : name === './stream' ? { readReply: stream_1.readReply } : { assessmentFormat: assessment_1.assessmentFormat },
            fetch: async (_url, init) => {
                request = JSON.parse(init.body);
                return new Response(JSON.stringify({ message: { content: structured }, done: true }) + '\n');
            }
        });
        (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../models/llm.js'), 'utf8'), sandbox);
        const session = new session_1.Session({ label: 'Selected retry', sources: [{ name: 'retry.ts', content: 'retry();', language: 'typescript' }] });
        const messages = session.messages(answer, 'test');
        assert.ok(messages[1].content.includes('retry();'));
        assert.ok(!messages[0].content.includes('Be a code tutor'));
        const ask = sandbox.exports.askModel;
        const raw = await ask(messages, new AbortController().signal, () => { }, true);
        assert.deepEqual(request.format, assessment_1.assessmentFormat);
        assert.equal(session.complete(answer, raw, 'test'), 'You understand the retry.');
        assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
        assert.equal((0, assessment_1.parseAssessment)(structured, ['unrelated'])?.concepts[2].status, 'discussed');
        await ask(messages, new AbortController().signal, () => { }, false);
        assert.equal(request.format, undefined);
        await ask(messages, new AbortController().signal, () => { }, quiz_1.quizFormat);
        assert.deepEqual(request.format, quiz_1.quizFormat);
    });
    (0, node_test_1.test)('only accepts demonstrated claims backed by exact developer quotes', () => {
        assert.equal((0, assessment_1.parseAssessment)(reply, [answer])?.concepts[2].status, 'demonstrated');
        assert.equal((0, assessment_1.parseAssessment)(reply, [])?.concepts[2].status, 'discussed');
        assert.equal((0, assessment_1.parseAssessment)(reply, ['An unrelated answer'])?.concepts[2].quote, undefined);
        assert.equal((0, assessment_1.parseAssessment)(reply.replace(answer, ''), [''])?.concepts[2].status, 'discussed');
    });
    (0, node_test_1.test)('credits a short purpose answer independently of three blank fields', () => {
        const shortAnswer = 'a working calculator';
        const submission = 'Understanding test answers for my current goal:\n\nPurpose:\n' + shortAnswer +
            '\n\nBehavior:\nNot answered\n\nEffect:\nNot answered\n\nEdge cases:\nNot answered';
        const session = new session_1.Session({ label: 'Calculator', sources: [] });
        const result = JSON.stringify({ feedback: 'You identified its purpose.', concepts: assessment_1.conceptIds.map(id => ({
                id, status: id === 'purpose' ? 'demonstrated' : 'unexplored', quote: id === 'purpose' ? shortAnswer : ''
            })), uncertainties: [] });
        session.complete(submission, result, 'test');
        assert.equal(session.assessment?.concepts[0].status, 'demonstrated');
        assert.equal(session.assessment?.concepts[0].quote, shortAnswer);
        assert.ok(session.assessment?.concepts.slice(1).every(concept => concept.status === 'unexplored'));
    });
    (0, node_test_1.test)('short evidence is accepted without a character threshold; fabricated and blank evidence are rejected', () => {
        for (const quote of ['Retries', '空', 'same ID']) {
            const shortReply = reply.replace(answer, quote);
            assert.equal((0, assessment_1.parseAssessment)(shortReply, [quote])?.concepts[2].status, 'demonstrated');
            assert.equal((0, assessment_1.parseAssessment)(shortReply, ['An unrelated response'])?.concepts[2].status, 'discussed');
        }
        assert.equal((0, assessment_1.parseAssessment)(reply.replace(answer, '   '), ['   '])?.concepts[2].status, 'discussed');
    });
    (0, node_test_1.test)('missing, malformed, or incomplete assessments are unavailable', () => {
        for (const raw of ['Plain explanation', '<review-state>{broken}</review-state>', '<review-state>null</review-state>', '<review-state>{"concepts":[],"uncertainties":[]}</review-state>', reply.replace('"id":"edge"', '"id":"purpose"')]) {
            assert.equal((0, assessment_1.parseAssessment)(raw, [answer]), undefined);
        }
    });
    (0, node_test_1.test)('hides metadata across every network chunk boundary', () => {
        let displayed = '';
        for (let n = 1; n <= reply.length; n++) {
            const visible = (0, assessment_1.visibleReply)(reply.slice(0, n));
            if (visible.length > displayed.length) {
                displayed += visible.slice(displayed.length);
            }
            assert.ok(!displayed.includes('<review-state>'));
            assert.ok(!displayed.includes('"concepts"'));
        }
        assert.equal(displayed.trim(), 'The retry can repeat a write. [[1:10-11]]');
    });
    (0, node_test_1.test)('only the latest test supplies evidence; discussion and recap preserve it; a new goal clears it', () => {
        const session = new session_1.Session({ label: 'Test', sources: [] });
        session.complete(answer, reply, 'goal');
        assert.equal(Boolean(session.assessment), false);
        session.complete(answer, reply);
        assert.equal(Boolean(session.assessment), false);
        session.complete(answer, reply, 'test');
        assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
        session.complete('Recap', 'Recap without metadata', 'recap');
        assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
        session.complete('More help', 'Explanation without metadata');
        assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
        assert.ok(session.messages('Continue').every(message => !message.content.includes('<review-state>{')));
        session.complete('I do not know.', reply, 'test');
        assert.equal(session.assessment?.concepts[2].status, 'discussed');
        session.complete('Different goal', reply, 'goal');
        assert.equal(session.assessment, undefined);
        session.complete(answer, reply, 'test');
        const before = session.messages('Continue');
        assert.throws(() => session.complete('Try again', 'No metadata today.', 'test'), /usable assessment/);
        assert.deepEqual(session.assessment, state);
        assert.deepEqual(session.messages('Continue'), before);
    });
    (0, node_test_1.test)('an empty explanation cannot commit history or evidence', () => {
        const session = new session_1.Session({ label: 'Test', sources: [] });
        const before = session.messages('Continue');
        assert.throws(() => session.complete(answer, reply.slice(reply.indexOf('<review-state>'))), /no explanation/);
        assert.deepEqual(session.messages('Continue'), before);
        assert.equal(session.assessment, undefined);
    });
    (0, node_test_1.test)('the next request includes validated checks and a new goal receives none', () => {
        const session = new session_1.Session({ label: 'Test', sources: [] });
        session.complete(answer, reply, 'test');
        assert.ok(session.messages('Continue')[0].content.endsWith(JSON.stringify(session.assessment)));
        assert.ok(session.messages('New goal', 'goal')[0].content.endsWith('null'));
        // The model cannot carry a fabricated pass into its next decision.
        session.complete('I am not sure.', reply.replace(answer, 'Words the developer never said'), 'test');
        assert.equal(session.assessment?.concepts[2].status, 'discussed');
        assert.ok(session.messages('Try again')[0].content.endsWith(JSON.stringify(session.assessment)));
    });
});
(0, node_test_1.suite)('Generated review quiz', () => {
    (0, node_test_1.test)('the extension generates before assessing, refuses incomplete submissions, and checks for changed code', async () => {
        let currentContext = quizCode;
        let generatedQuestions = quizQuestions;
        let receive = async (_message) => { };
        const commands = new Map();
        const posted = [];
        const requests = [];
        class Uri {
            static joinPath() { return new Uri(); }
        }
        const api = {
            Uri, ViewColumn: { Beside: 2 },
            workspace: {
                isTrusted: true,
                getConfiguration: () => ({ get: () => false }),
                onDidChangeConfiguration: () => ({ dispose: () => { } }),
                registerTextDocumentContentProvider: () => ({}),
                fs: { readFile: async () => new TextEncoder().encode('<html>{{nonce}}</html>') }
            },
            window: { createWebviewPanel: () => ({
                    webview: { cspSource: 'vscode-webview:', asWebviewUri: () => 'resource',
                        onDidReceiveMessage: (handler) => { receive = handler; return {}; },
                        postMessage: async (message) => { posted.push(message); } },
                    onDidDispose: () => ({})
                }) },
            commands: { registerCommand: (id, handler) => { commands.set(id, handler); return {}; } }
        };
        const sandbox = (0, node_vm_1.createContext)({
            exports: {}, Error, AbortController, TextDecoder, setTimeout, clearTimeout,
            require: (name) => {
                if (name === 'vscode') {
                    return api;
                }
                if (name === './commands/settings') {
                    return { registerSettingsCommand: () => { } };
                }
                if (name === './git/commitGate') {
                    return { approveStagedCommit: commitGate_1.approveStagedCommit };
                }
                if (name === 'node:crypto') {
                    return { randomBytes: () => ({ toString: () => 'nonce' }) };
                }
                if (name === './git/context') {
                    return { getStagedContext: async () => currentContext };
                }
                if (name === './review/session') {
                    return { Session: session_1.Session };
                }
                if (name === './review/assessment') {
                    return { assessIndependently: assessment_1.assessIndependently };
                }
                if (name === './review/quiz') {
                    return { assessQuiz: quiz_1.assessQuiz, quizAssessmentFormat: quiz_1.quizAssessmentFormat, quizFormat: quiz_1.quizFormat, requireQuizAnswers: quiz_1.requireQuizAnswers };
                }
                if (name === './prompts/assessment') {
                    return { quizAssessmentInstructions: assessment_2.quizAssessmentInstructions };
                }
                if (name === './models/llm') {
                    return { askModel: async (messages, _signal, _onText, structured) => {
                            requests.push({ messages, structured });
                            if (structured === quiz_1.quizFormat) {
                                return JSON.stringify({ questions: generatedQuestions });
                            }
                            return JSON.stringify({ feedback: 'This needs more exploration.', status: 'unexplored', quote: '', uncertainties: [] });
                        } };
                }
                throw new Error('Unexpected module: ' + name);
            }
        });
        (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../extension.js'), 'utf8'), sandbox);
        sandbox.exports.activate({ subscriptions: [], extensionUri: new Uri() });
        await commands.get('codetogether.openReview')();
        await receive({ type: 'init' });
        await receive({ type: 'send', kind: 'test', text: JSON.stringify({ purpose: answer, behavior: '', effect: '', edge: '' }) });
        assert.equal(requests.length, 0);
        assert.match(posted.at(-1)?.text ?? '', /Generate a review quiz/);
        await receive({ type: 'send', kind: 'quiz', text: 'Understand this promise.' });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].structured, quiz_1.quizFormat);
        assert.equal(posted.at(-1)?.type, 'quiz');
        assert.deepEqual(posted.at(-1)?.questions, quizQuestions);
        await receive({ type: 'send', kind: 'test', text: JSON.stringify({ purpose: answer, behavior: '', effect: '', edge: '' }) });
        assert.equal(requests.length, 1);
        assert.match(posted.at(-1)?.text ?? '', /every question/);
        await receive({ type: 'send', kind: 'test', text: JSON.stringify(Object.fromEntries(assessment_1.conceptIds.map(id => [id, 'My reasoning about ' + id]))) });
        assert.equal(requests.length, 5);
        for (const [index, request] of requests.slice(1).entries()) {
            assert.equal(request.structured, quiz_1.quizAssessmentFormat);
            assert.equal(JSON.parse(request.messages.at(-1).content).question.id, assessment_1.conceptIds[index]);
            assert.match(request.messages[0].content, /single supplied review quiz question/);
            assert.ok(request.messages.some(message => message.content.includes(quizPrompts[index])));
        }
        assert.equal(posted.at(-1)?.type, 'reply');
        assert.ok(posted.at(-1)?.assessment);
        currentContext = { ...quizCode, label: 'Different snapshot' };
        await receive({ type: 'send', kind: 'quiz', text: 'Another goal' });
        assert.equal(requests.length, 5);
        assert.match(posted.at(-1)?.text ?? '', /Code context changed/);
        currentContext = quizCode;
        generatedQuestions = [{ ...quizQuestions[1], line: 999, endLine: 999 }];
        await receive({ type: 'send', kind: 'quiz', text: 'Understand the return value.' });
        assert.equal(requests.length, 6);
        assert.deepEqual(posted.at(-1)?.questions, [{ ...quizQuestions[1], sourceId: 0, line: 0, endLine: 0 }]);
        await receive({ type: 'send', kind: 'test', text: JSON.stringify({ behavior: 'It returns a promise.' }) });
        assert.equal(requests.length, 7);
        assert.equal(posted.at(-1)?.type, 'reply');
        assert.equal((posted.at(-1)?.assessment).concepts.length, 1);
        await receive({ type: 'approve-commit', answers: JSON.stringify({ behavior: 'It returns a promise.' }) });
        assert.equal(posted.at(-1)?.type, 'commit-approval-error');
        assert.match(posted.at(-1)?.text ?? '', /ALL staged changes/);
        assert.equal(requests.length, 7);
    });
    (0, node_test_1.test)('question-specific grading assigns the topic in code and validates evidence against only its own answer', async () => {
        const quiz = { goal: 'Understand the request.', questions: quizQuestions };
        const answers = { purpose: 'return a promise', behavior: 'preserves the promise', effect: 'propagates rejection', edge: 'The caller is outside this function.' };
        const raw = await (0, quiz_1.assessQuiz)(quiz, JSON.stringify(answers), async (question, answer) => {
            assert.equal(answer, answers[question.id]);
            return JSON.stringify({ feedback: 'Feedback on ' + question.id, status: question.id === 'edge' ? 'unexplored' : 'demonstrated',
                quote: question.id === 'behavior' ? answers.purpose : question.id === 'edge' ? '' : answer,
                uncertainties: question.id === 'edge' ? ['Caller is unseen.'] : [] });
        });
        const result = (0, assessment_1.parseAssessment)(raw, Object.values(answers));
        assert.deepEqual(result.concepts.map(concept => concept.status), ['demonstrated', 'discussed', 'demonstrated', 'unexplored']);
        assert.equal(result.concepts[1].quote, undefined);
        assert.deepEqual(result.uncertainties, ['Caller is unseen.']);
        const session = new session_1.Session(quizCode);
        session.setQuiz(quiz.goal, quizRaw);
        assert.match(session.complete(JSON.stringify(answers), raw, 'test'), /Feedback on purpose/);
    });
    (0, node_test_1.test)('invalid per-question feedback fails without accepting a partial quiz result', async () => {
        const session = new session_1.Session(quizCode);
        session.setQuiz('Understand the promise.', quizRaw);
        for (const response of ['null', '{bad', '{}', JSON.stringify({ feedback: 'Okay', status: 'passed', quote: answer, uncertainties: [] })]) {
            await assert.rejects((0, quiz_1.assessQuiz)(session.quiz, JSON.stringify(Object.fromEntries(assessment_1.conceptIds.map(id => [id, answer]))), async () => response), /usable quiz feedback/);
            assert.equal(session.assessment, undefined);
        }
    });
    (0, node_test_1.test)('explicit uncertainty records gaps without asking the model or awarding credit', async () => {
        const raw = await (0, quiz_1.assessQuiz)({ goal: 'Understand the request.', questions: quizQuestions }, JSON.stringify({ purpose: "I'm not sure yet.", behavior: "I don't know", effect: 'I do not know.', edge: 'I’m not sure' }), async () => { assert.fail('Explicit uncertainty should not be sent for grading.'); });
        assert.ok((0, assessment_1.parseAssessment)(raw, [])?.concepts.every(concept => concept.status === 'unexplored'));
        assert.match(JSON.parse(raw).feedback, /gap recorded/);
    });
    (0, node_test_1.test)('bare verdict feedback cannot replace a previous explained assessment', async () => {
        const session = new session_1.Session(quizCode);
        const quiz = session.setQuiz('Understand the request.', JSON.stringify({ questions: [quizQuestions[0]] }));
        const submission = JSON.stringify({ purpose: 'It returns the pending request.' });
        const good = await (0, quiz_1.assessQuiz)(quiz, submission, async () => JSON.stringify({
            status: 'demonstrated', quote: 'returns the pending request',
            feedback: 'You identified that the existing request is returned rather than started again.', uncertainties: []
        }));
        session.complete(submission, good, 'test');
        const previous = session.assessment;
        for (const feedback of ['demonstrated', '**demonstrated**', 'Purpose: demonstrated', 'discussed', 'unexplored', 'correct', 'Needs clarification']) {
            for (const status of ['discussed', 'demonstrated']) {
                await assert.rejects((0, quiz_1.assessQuiz)(quiz, submission, async () => JSON.stringify({
                    status, quote: status === 'demonstrated' ? 'returns the pending request' : '', feedback, uncertainties: []
                })), /only a verdict, not an explanation/);
                assert.equal(session.assessment, previous);
            }
        }
    });
    (0, node_test_1.test)('accepts one to four distinct questions with references in the supplied snapshot', () => {
        assert.deepEqual((0, quiz_1.parseQuiz)(quizRaw, quizCode), quizQuestions);
        assert.deepEqual((0, quiz_1.parseQuiz)(JSON.stringify({ questions: [...quizQuestions].reverse() }), quizCode), quizQuestions);
        for (const questions of [[quizQuestions[1]], [quizQuestions[1], quizQuestions[3]], quizQuestions.slice(1)]) {
            assert.deepEqual((0, quiz_1.parseQuiz)(JSON.stringify({ questions }), quizCode), questions);
        }
        for (const raw of ['null', '{bad', '{}', JSON.stringify({ questions: [] }), JSON.stringify({ questions: [...quizQuestions, quizQuestions[0]] }),
            JSON.stringify({ questions: quizQuestions.map(question => ({ ...question, id: 'purpose' })) }),
            JSON.stringify({ questions: quizQuestions.map(question => ({ ...question, prompt: 'One repeated question' })) }),
            JSON.stringify({ questions: [{ ...quizQuestions[0], prompt: ' ' }] }),
            JSON.stringify({ questions: [{ ...quizQuestions[0], id: 'unknown' }] })]) {
            assert.throws(() => (0, quiz_1.parseQuiz)(raw, quizCode), /invalid quiz/);
        }
    });
    (0, node_test_1.test)('reports malformed JSON, invalid counts, and repeated topics distinctly', () => {
        assert.throws(() => (0, quiz_1.parseQuiz)('{bad', quizCode), /not valid JSON/);
        assert.throws(() => (0, quiz_1.parseQuiz)('{"questions":[]}', quizCode), /between 1 and 4/);
        assert.throws(() => (0, quiz_1.parseQuiz)(JSON.stringify({ questions: [quizQuestions[0], quizQuestions[0]] }), quizCode), /same topic/);
    });
    (0, node_test_1.test)('invalid or missing citations do not discard usable questions or guess replacement locations', () => {
        const question = quizQuestions[0];
        for (const citation of [
            { sourceId: 1, line: 10, endLine: 12 }, { sourceId: 1, line: 9, endLine: 11 },
            { sourceId: 2, line: 10, endLine: 11 }, { sourceId: 1, line: 999, endLine: 999 },
            { sourceId: 1, line: 1, endLine: 2 }, { sourceId: 1, line: 11, endLine: 10 },
            { sourceId: -1, line: -10, endLine: -1 }, { sourceId: 1.5, line: 10, endLine: 11 },
            { sourceId: 1, line: 10.5, endLine: 11 }, { sourceId: '1', line: '10', endLine: '11' },
            { sourceId: 0, line: 0, endLine: 0 }, { sourceId: 1 }, {}
        ]) {
            const raw = JSON.stringify({ questions: [{ id: question.id, prompt: question.prompt, ...citation }, quizQuestions[1]] });
            const session = new session_1.Session(quizCode);
            const quiz = session.setQuiz('Understand this request.', raw);
            assert.deepEqual(quiz.questions, [{ ...question, sourceId: 0, line: 0, endLine: 0 }, quizQuestions[1]]);
            assert.equal(session.reference(quiz.questions[0].sourceId, quiz.questions[0].line, quiz.questions[0].endLine), undefined);
            assert.equal(session.reference(quiz.questions[1].sourceId, quiz.questions[1].line, quiz.questions[1].endLine), quizCode.sources[0]);
        }
    });
    (0, node_test_1.test)('diff-only questions work for deleted files, but cannot invent a text reference', () => {
        const context = { label: 'Deleted file', sources: [], diff: '-const pending = request();' };
        const questions = quizQuestions.map(question => ({ ...question, sourceId: 0, line: 0, endLine: 0 }));
        assert.deepEqual((0, quiz_1.parseQuiz)(JSON.stringify({ questions }), context), questions);
        assert.deepEqual((0, quiz_1.parseQuiz)(quizRaw, context), questions);
        assert.deepEqual((0, quiz_1.parseQuiz)(JSON.stringify({ questions: [{ id: 'purpose', prompt: quizPrompts[0] }] }), context), [questions[0]]);
        assert.throws(() => (0, quiz_1.parseQuiz)(JSON.stringify({ questions }), { ...context, diff: '' }), /no code was supplied/);
    });
    (0, node_test_1.test)('generation has its own prompt and assessments receive the generated questions and goal', () => {
        const session = new session_1.Session(quizCode);
        const generation = session.messages('Understand this promise.', 'quiz');
        assert.match(generation[0].content, /Create a short code review quiz/);
        assert.ok(!generation[0].content.includes('Be a code tutor'));
        assert.match(generation[1].content, /10: const pending/);
        assert.match(generation[1].content, /sourceId=1; original lines 10-11/);
        assert.equal(generation.at(-1)?.content, 'Understand this promise.');
        session.setQuiz('Understand this promise.', quizRaw);
        const assessment = session.messages('behavior:\nIt returns the promise.', 'test');
        assert.match(assessment[0].content, /Assess the developer/);
        assert.ok(assessment.some(message => message.content.includes(quizPrompts[1])));
        assert.ok(assessment.some(message => message.content.includes('Understand this promise.')));
        assert.equal(session.messages('Help me.')[0].content.startsWith('Be a code tutor'), true);
    });
    (0, node_test_1.test)('quiz completion requires all responses and accepts explicitly recorded uncertainty', () => {
        assert.throws(() => (0, quiz_1.requireQuizAnswers)(JSON.stringify({ purpose: 'A request', behavior: '', effect: '', edge: '' }), quizQuestions), /every question/);
        assert.throws(() => (0, quiz_1.requireQuizAnswers)('I understand it', quizQuestions), /every question/);
        assert.doesNotThrow(() => (0, quiz_1.requireQuizAnswers)(JSON.stringify(Object.fromEntries(assessment_1.conceptIds.map(id => [id, "I'm not sure yet."]))), quizQuestions));
        const session = new session_1.Session(quizCode);
        session.setQuiz('Understand the promise', quizRaw);
        assert.throws(() => session.complete(JSON.stringify({ purpose: answer, behavior: '', effect: '', edge: '' }), reply, 'test'), /every question/);
        assert.equal(session.assessment, undefined);
    });
    (0, node_test_1.test)('failed generation preserves the current quiz and history; a successful goal change clears it', () => {
        const session = new session_1.Session(quizCode);
        session.complete('My goal', 'Trace the promise.', 'goal');
        const quiz = session.setQuiz('My goal', quizRaw);
        const before = session.messages('Continue.');
        assert.throws(() => session.setQuiz('Different goal', '{}'), /between 1 and 4/);
        assert.equal(session.quiz, quiz);
        assert.deepEqual(session.messages('Continue.'), before);
        session.complete('New goal', 'Let us look at the caller.', 'goal');
        assert.equal(session.quiz, undefined);
        assert.equal(session.assessment, undefined);
    });
    (0, node_test_1.test)('short quizzes require and assess only their selected topics, without inventing omitted gaps', async () => {
        for (const questions of [[quizQuestions[1]], [quizQuestions[1], quizQuestions[3]], quizQuestions.slice(0, 3)]) {
            const session = new session_1.Session(quizCode);
            const quiz = session.setQuiz('Understand the promise.', JSON.stringify({ questions }));
            const answers = Object.fromEntries(questions.map(question => [question.id, 'My answer to ' + question.id]));
            const calls = [];
            const raw = await (0, quiz_1.assessQuiz)(quiz, JSON.stringify(answers), async (question, answer) => {
                calls.push(question.id);
                assert.equal(answer, answers[question.id]);
                return JSON.stringify({ feedback: 'Correct central idea.', status: 'demonstrated', quote: answer, uncertainties: [] });
            });
            assert.deepEqual(calls, questions.map(question => question.id));
            session.complete(JSON.stringify(answers), raw, 'test');
            assert.equal(session.assessment?.concepts.length, questions.length);
            assert.ok(session.assessment?.concepts.every(concept => concept.status === 'demonstrated'));
            assert.deepEqual(session.assessment?.concepts.map(concept => concept.id), questions.map(question => question.id));
            assert.equal((0, assessment_1.parseAssessment)(raw, Object.values(answers), assessment_1.conceptIds), undefined);
            const missing = { ...answers };
            delete missing[questions[0].id];
            assert.throws(() => (0, quiz_1.requireQuizAnswers)(JSON.stringify(missing), questions), /every question/);
            assert.throws(() => (0, quiz_1.requireQuizAnswers)(JSON.stringify({ ...answers, unrelated: 'Stale answer' }), questions), /every question/);
        }
    });
});
// Small DOM stand-in exercises actual panel event handlers without a model or VS Code.
class Element {
    tagName = 'DIV';
    type = '';
    max = 1;
    children = [];
    parentElement;
    dataset = {};
    attributes = {};
    style = {};
    listeners = {};
    textContent = '';
    value = '';
    className = '';
    hidden = false;
    disabled = false;
    nodeType = 1;
    classList = { toggle: (name, on) => {
            const classes = this.className.split(' ').filter(item => item !== name);
            if (on) {
                classes.push(name);
            }
            this.className = classes.join(' ');
        } };
    append(...items) {
        for (const item of items) {
            item.remove();
            item.parentElement = this;
            this.children.push(item);
        }
    }
    insertBefore(item, before) {
        item.remove();
        item.parentElement = this;
        const index = this.children.indexOf(before);
        this.children.splice(index < 0 ? this.children.length : index, 0, item);
    }
    remove() { if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(item => item !== this);
    } }
    replaceChildren() { this.children = []; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest() { return this.className.split(' ').includes('code-line') ? this : this.parentElement?.closest(); }
    get previousElementSibling() { return this.parentElement?.children[(this.parentElement?.children.indexOf(this) ?? 0) - 1]; }
    focus() { }
    scrollIntoView() { }
}
function panel() {
    let waiting;
    const elements = new Map();
    const messages = [];
    let receive = () => { };
    const get = (id) => {
        if (!elements.has(id)) {
            elements.set(id, new Element());
        }
        return elements.get(id);
    };
    const sandbox = (0, node_vm_1.createContext)({
        setInterval: (callback) => { waiting = callback; return 1; },
        clearInterval: () => { waiting = undefined; },
        Node: { TEXT_NODE: 3 },
        document: {
            getElementById: get, querySelectorAll: () => [], addEventListener: () => { },
            createElement: (tag) => Object.assign(new Element(), { tagName: tag.toUpperCase() }),
            createTextNode: (text) => Object.assign(new Element(), { textContent: text, nodeType: 3 })
        },
        window: { getSelection: () => null, addEventListener: (_, listener) => { receive = listener; } },
        acquireVsCodeApi: () => ({ postMessage: (message) => messages.push({ ...message }) })
    });
    (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../../UI/review.js'), 'utf8'), sandbox);
    const emit = (data) => receive({ data });
    const click = (id, type = 'click') => get(id).listeners[type]({ preventDefault() { } });
    const load = () => emit({ type: 'context', context: {
            label: 'Staged snapshot', changes: [{ name: 'retry.ts', added: 3, deleted: 1 }],
            sources: [{ name: 'retry.ts', content: 'const pending = request();\nreturn pending;', startLine: 10 }]
        } });
    const begin = () => { get('goal-input').value = 'Prevent duplicate writes.'; click('goal-form', 'submit'); };
    const generateQuiz = (questions = quizQuestions) => { click('nav-test'); emit({ type: 'quiz', goal: 'Prevent duplicate writes.', questions }); };
    const fillQuiz = () => { for (const id of assessment_1.conceptIds) {
        click('not-sure-' + id);
    } };
    return { get, emit, click, load, begin, generateQuiz, fillQuiz, messages, sandbox, tick: () => waiting?.() };
}
(0, node_test_1.suite)('Discussion, test, and recap', () => {
    (0, node_test_1.test)('staged approval is explicit, requires a submitted quiz, preserves gaps, and never runs a model request', () => {
        const p = panel();
        p.emit({ type: 'context', context: { ...quizCode, staged: {
                    root: '/test/repo', gitDir: '/test/repo/.git', tree: 'a'.repeat(40), head: 'b'.repeat(40), allStaged: true
                } } });
        assert.equal(p.get('approve-commit').hidden, false);
        assert.equal(p.get('approve-commit').disabled, true);
        p.get('goal-input').value = 'Understand the request.';
        p.click('begin-quiz');
        p.emit({ type: 'quiz', goal: 'Understand the request.', questions: [quizQuestions[0]] });
        p.click('not-sure-purpose');
        p.click('test-form', 'submit');
        const assessment = { concepts: [{ id: 'purpose', status: 'unexplored' }], uncertainties: [] };
        p.emit({ type: 'reply', text: 'You recorded uncertainty about the request.', assessment });
        assert.equal(p.get('approve-commit').disabled, true);
        p.click('recap');
        p.emit({ type: 'reply', text: 'Your uncertainty is recorded.', assessment });
        assert.equal(p.get('approve-commit').disabled, false);
        p.click('finish');
        assert.equal(p.messages.filter(message => message.type === 'approve-commit').length, 0);
        const requests = p.messages.length;
        p.click('approve-commit');
        assert.equal(p.messages.length, requests + 1);
        assert.equal(p.messages.at(-1)?.type, 'approve-commit');
        assert.deepEqual(JSON.parse(p.messages.at(-1).answers), { purpose: "I'm not sure yet." });
        assert.equal(p.get('approve-commit').disabled, true);
        p.emit({ type: 'commit-approval-error', text: 'Staged changes changed. Start a new review.' });
        assert.equal(p.get('approve-commit').disabled, false);
        assert.match(p.get('commit-gate-note').textContent, /Start a new review/);
        assert.equal(p.get('test-purpose').value, "I'm not sure yet.");
        p.click('approve-commit');
        p.emit({ type: 'commit-approved', text: 'Staged snapshot approved. Retry your commit.' });
        assert.equal(p.get('approve-commit').disabled, true);
        assert.match(p.get('commit-gate-note').textContent, /approved/);
    });
    (0, node_test_1.test)('strict approval toggle disables approval with gaps and updates an open review', () => {
        const p = panel();
        p.emit({ type: 'context', requireAllQuestions: true, context: { ...quizCode, staged: {
                    root: '/test/repo', gitDir: '/test/repo/.git', tree: 'a'.repeat(40), head: 'b'.repeat(40), allStaged: true
                } } });
        p.get('goal-input').value = 'Understand the request.';
        p.click('begin-quiz');
        p.emit({ type: 'quiz', goal: 'Understand the request.', questions: [quizQuestions[0]] });
        p.click('not-sure-purpose');
        p.click('test-form', 'submit');
        const assessment = { concepts: [{ id: 'purpose', status: 'unexplored' }], uncertainties: [] };
        p.emit({ type: 'reply', text: 'You recorded uncertainty.', assessment });
        p.click('recap');
        p.emit({ type: 'reply', text: 'Your uncertainty is recorded.', assessment });
        assert.equal(p.get('approve-commit').disabled, true);
        assert.match(p.get('commit-gate-note').textContent, /Strict commit approval is on/);
        const before = p.messages.length;
        p.click('approve-commit');
        assert.equal(p.messages.length, before);
        p.emit({ type: 'commit-gate-policy', requireAllQuestions: false });
        assert.equal(p.get('approve-commit').disabled, false);
    });
    (0, node_test_1.test)('single-file and selection contexts cannot request commit approval', () => {
        for (const allStaged of [undefined, false]) {
            const p = panel();
            p.emit({ type: 'context', context: { ...quizCode,
                    ...(allStaged === undefined ? {} : { staged: { allStaged } }) } });
            assert.equal(p.get('approve-commit').hidden, true);
            const requests = p.messages.length;
            p.click('approve-commit');
            assert.equal(p.messages.length, requests);
        }
    });
    (0, node_test_1.test)('one-, two-, and three-question quizzes render and finish without requiring hidden topics', () => {
        for (const questions of [[quizQuestions[1]], [quizQuestions[1], quizQuestions[3]], quizQuestions.slice(0, 3)]) {
            const p = panel();
            p.load();
            p.begin();
            p.emit({ type: 'reply', text: 'Ready.' });
            p.generateQuiz(questions);
            const ids = questions.map(question => question.id);
            assert.equal(p.get('quiz-progress').max, questions.length);
            assert.equal(p.get('quiz-heading').textContent, 'Review quiz · ' + questions.length + (questions.length === 1 ? ' question' : ' questions'));
            for (const id of assessment_1.conceptIds) {
                assert.equal(p.get('quiz-question-' + id).hidden, !ids.includes(id));
                assert.equal(p.get('test-' + id).disabled, !ids.includes(id));
                assert.equal(p.get('not-sure-' + id).disabled, !ids.includes(id));
            }
            assert.match(p.get('question-heading-' + questions[0].id).textContent, /^Question 1/);
            p.fillQuiz();
            assert.equal(p.get('check-understanding').disabled, false);
            assert.equal(p.get('nav-recap').disabled, true);
            p.click('test-form', 'submit');
            assert.deepEqual(Object.keys(JSON.parse(p.messages.at(-1).text)), ids);
            const assessment = { concepts: questions.map(question => ({ id: question.id, status: 'demonstrated', quote: 'My reasoning' })), uncertainties: [] };
            p.emit({ type: 'reply', text: 'Your responses show understanding.', assessment });
            assert.equal(p.get('test-summary').children.length, questions.length);
            assert.equal(p.get('concepts').children.length, questions.length);
            assert.equal(p.get('test-gaps').children.length, 0);
            assert.equal(p.get('brain-fill').attributes.height, '112');
            assert.match(p.get('brain-description').textContent, new RegExp('^' + questions.length + ' of ' + questions.length));
            p.click('back-to-talk');
            const requests = p.messages.length;
            p.click('nav-test');
            assert.equal(p.messages.length, requests);
            assert.equal(p.get('test-' + questions[0].id).value, "I'm not sure yet.");
            p.click('recap');
            p.emit({ type: 'reply', text: 'Quiz complete.', assessment });
            p.click('finish');
            assert.equal(p.get('finished-note').textContent, 'Review finished. No commit or push was made.');
        }
    });
    (0, node_test_1.test)('a new shorter quiz hides and disables the previous questions and clears their answers', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Ready.' });
        p.generateQuiz();
        p.fillQuiz();
        p.click('nav-goal');
        p.get('goal-input').value = 'Focus on the return value.';
        p.click('begin-quiz');
        p.emit({ type: 'quiz', goal: 'Focus on the return value.', questions: [quizQuestions[1]] });
        assert.equal(p.get('quiz-progress-text').textContent, '0 of 1 question completed');
        assert.equal(p.get('quiz-question-purpose').hidden, true);
        assert.equal(p.get('test-purpose').disabled, true);
        assert.equal(p.get('test-purpose').value, '');
        assert.equal(p.get('test-behavior').disabled, false);
        assert.equal(p.get('test-behavior').value, '');
        assert.equal(p.get('check-understanding').disabled, true);
    });
    (0, node_test_1.test)('a developer can start a quiz directly without a tutoring response', () => {
        const p = panel();
        p.load();
        p.get('goal-input').value = 'Understand the returned promise.';
        p.click('begin-quiz');
        assert.equal(p.messages.at(-1)?.kind, 'quiz');
        assert.equal(p.messages.at(-1)?.text, 'Understand the returned promise.');
        assert.equal(p.get('thread').children.length, 0);
        p.emit({ type: 'quiz', goal: 'Understand the returned promise.', questions: quizQuestions });
        assert.equal(p.get('test-view').hidden, false);
        assert.equal(p.get('test-form').hidden, false);
        assert.equal(p.get('quiz-loading').hidden, true);
        assert.equal(p.get('question-purpose').textContent, quizPrompts[0]);
        assert.equal(p.get('question-reference-purpose').children.filter(node => node.className === 'reference').length, 1);
        assert.equal(p.get('nav-recap').disabled, true);
        assert.equal(p.get('quiz-progress-text').textContent, '0 of 4 questions completed');
        p.click('not-sure-purpose');
        assert.equal(p.get('quiz-progress-text').textContent, '1 of 4 questions completed');
        assert.equal(p.get('check-understanding').disabled, true);
        p.fillQuiz();
        assert.equal(p.get('quiz-progress-text').textContent, '4 of 4 questions completed');
        assert.equal(p.get('check-understanding').disabled, false);
        assert.equal(p.get('nav-recap').disabled, true);
    });
    (0, node_test_1.test)('questions without validated references browse supplied code without losing answers or generating again', () => {
        for (const context of [quizCode, { label: 'Deleted file', sources: [], diff: '-const pending = request();' }]) {
            const p = panel();
            p.emit({ type: 'context', context });
            p.get('goal-input').value = 'Understand this request.';
            p.click('begin-quiz');
            const questions = (0, quiz_1.parseQuiz)(JSON.stringify({ questions: [{ ...quizQuestions[0], line: 999, endLine: 999 }] }), context);
            p.emit({ type: 'quiz', goal: 'Understand this request.', questions });
            p.get('test-purpose').value = 'An answer draft';
            const reference = p.get('question-reference-purpose');
            assert.equal(reference.children.length, 1);
            assert.equal(reference.children[0].textContent, 'Browse supplied code');
            assert.equal(reference.children[0].className, 'secondary');
            assert.equal(reference.children[0].type, 'button');
            const requests = p.messages.length;
            reference.children[0].listeners.click({ preventDefault() { } });
            assert.equal(p.get('goal-view').hidden, false);
            assert.equal(p.messages.length, requests);
            p.click('nav-test');
            assert.equal(p.get('test-view').hidden, false);
            assert.equal(p.get('test-purpose').value, 'An answer draft');
            assert.equal(p.messages.length, requests);
        }
    });
    (0, node_test_1.test)('a rejected verdict-only reply preserves the answer draft and previous quiz result', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Ready.' });
        p.generateQuiz([quizQuestions[0]]);
        p.get('test-purpose').value = 'It returns the pending request.';
        p.click('test-form', 'submit');
        p.emit({ type: 'reply', text: 'You identified the existing request is returned.', assessment: {
                concepts: [{ id: 'purpose', status: 'demonstrated', quote: 'returns the pending request' }], uncertainties: []
            } });
        const summary = p.get('test-summary').children[0].textContent;
        p.click('test-form', 'submit');
        p.emit({ type: 'error', text: 'The model returned only a verdict, not an explanation of your answer. Your answers and previous result are saved; submit the quiz again.' });
        assert.equal(p.get('test-purpose').value, 'It returns the pending request.');
        assert.equal(p.get('test-results').hidden, false);
        assert.equal(p.get('test-summary').children[0].textContent, summary);
        assert.equal(p.get('retry').hidden, false);
        assert.match(p.get('status').textContent, /only a verdict/);
    });
    (0, node_test_1.test)('quiz feedback is tied to the submitted answers, and a changed response requires resubmission', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Ready.' });
        p.generateQuiz();
        p.fillQuiz();
        p.click('test-form', 'submit');
        p.emit({ type: 'reply', text: 'Some gaps remain.', assessment: state });
        assert.equal(p.get('recap').disabled, false);
        p.get('test-purpose').value = 'A changed answer';
        p.click('test-purpose', 'input');
        assert.equal(p.get('recap').disabled, true);
        assert.equal(p.get('finish').disabled, true);
        assert.match(p.get('quiz-result-note').textContent, /Submit the quiz again/);
        const before = p.messages.length;
        p.click('nav-recap');
        assert.equal(p.messages.length, before);
        assert.equal(p.get('test-view').hidden, false);
        p.click('test-form', 'submit');
        p.emit({ type: 'reply', text: 'Still some gaps.', assessment: state });
        p.click('recap');
        p.emit({ type: 'reply', text: 'Gaps recorded.', assessment: state });
        p.click('finish');
        assert.equal(p.get('finished-note').hidden, false);
        assert.match(p.get('finished-note').textContent, /gaps/);
    });
    (0, node_test_1.test)('cancelled quiz generation retries the goal without adding a tutoring turn', () => {
        const p = panel();
        p.load();
        p.get('goal-input').value = 'Understand the promise';
        p.click('begin-quiz');
        p.emit({ type: 'error', text: 'Cancelled' });
        assert.equal(p.get('goal-input').value, 'Understand the promise');
        assert.equal(p.get('test-form').hidden, true);
        p.click('retry');
        assert.equal(p.messages.at(-1)?.kind, 'quiz');
        assert.equal(p.messages.at(-1)?.text, 'Understand the promise');
        p.emit({ type: 'quiz', goal: 'Understand the promise', questions: quizQuestions });
        assert.equal(p.get('test-form').hidden, false);
        assert.equal(p.get('thread').children.length, 0);
    });
    (0, node_test_1.test)('waits for formatted completion and rotates helpful messages until success or error', () => {
        const p = panel();
        p.load();
        p.begin();
        assert.match(p.get('status').className, /thinking/);
        p.emit({ type: 'chunk', text: '**raw partial' });
        assert.equal(p.get('thread').children.length, 1);
        p.tick();
        assert.match(p.get('status').textContent, /complete response/);
        p.emit({ type: 'reply', text: '**Ready**' });
        assert.equal(p.get('thread').children.length, 2);
        assert.equal(p.get('status').textContent, '');
        assert.ok(!p.get('status').className.includes('thinking'));
        p.tick();
        assert.equal(p.get('status').textContent, '');
        p.generateQuiz();
        p.fillQuiz();
        p.click('test-form', 'submit');
        p.tick();
        assert.match(p.get('status').textContent, /Short, informal/);
        p.tick();
        assert.match(p.get('status').textContent, /saved/);
        p.emit({ type: 'error', text: 'Assessment unavailable. Retry.' });
        p.tick();
        assert.equal(p.get('status').textContent, 'Assessment unavailable. Retry.');
        assert.ok(!p.get('status').className.includes('thinking'));
        assert.equal(p.get('retry').hidden, false);
    });
    (0, node_test_1.test)('formats replies, feedback, and recaps safely while preserving references and literal code', () => {
        const p = panel();
        p.load();
        p.begin();
        const markdown = '# Main idea\n\n**Retry** with `request()` [[1:10-11]]\n\n- First\n- Second\n\n3. Third\n4. Fourth\n\n```js\n<img src=x onerror=alert(1)> [[1:10]]\n```\n\n<script>alert(1)</script>';
        const descendants = (node) => [node, ...node.children.flatMap(descendants)];
        const verify = (body) => {
            const nodes = descendants(body);
            assert.equal(nodes.filter(node => node.tagName === 'H3').length, 1);
            assert.equal(nodes.filter(node => node.tagName === 'LI').length, 4);
            assert.equal(nodes.find(node => node.tagName === 'OL')?.attributes.start, '3');
            assert.ok(nodes.some(node => node.tagName === 'STRONG'));
            assert.ok(nodes.some(node => node.tagName === 'CODE' && node.textContent === 'request()'));
            assert.ok(nodes.some(node => node.tagName === 'CODE' && node.textContent === '<img src=x onerror=alert(1)> [[1:10]]'));
            assert.ok(nodes.some(node => node.nodeType === 3 && node.textContent.includes('<script>alert(1)</script>')));
            assert.equal(nodes.filter(node => node.tagName === 'SCRIPT' || node.tagName === 'IMG').length, 0);
            const references = nodes.filter(node => node.className === 'reference');
            assert.equal(references.length, 1);
            references[0].listeners.click({ preventDefault() { } });
            assert.equal(p.get('code-preview').children.length, 2);
        };
        p.emit({ type: 'chunk', text: '**Unfinished' });
        p.emit({ type: 'reply', text: markdown });
        assert.equal(p.get('thread').children.length, 2);
        verify(p.get('thread').children[1]);
        p.generateQuiz();
        p.fillQuiz();
        p.get('test-behavior').value = 'it tries again if it fails';
        p.click('test-form', 'submit');
        p.emit({ type: 'reply', text: markdown, assessment: state });
        verify(p.get('test-feedback'));
        p.click('recap');
        p.emit({ type: 'reply', text: markdown });
        verify(p.get('recap-body'));
    });
    (0, node_test_1.test)('loading needs no inference; goal, discussion, recap, finish, and resume share the session', () => {
        const p = panel();
        assert.deepEqual(p.messages, [{ type: 'init' }]);
        p.load();
        assert.equal(p.messages.length, 1);
        assert.equal(p.get('begin').disabled, false);
        p.begin();
        assert.equal(p.messages.at(-1)?.kind, 'goal');
        p.emit({ type: 'reply', text: 'Let us trace the retry.' });
        p.get('input').value = answer;
        p.click('form', 'submit');
        p.emit({ type: 'chunk', text: 'The retry ' });
        p.emit({ type: 'reply', text: 'The retry can repeat a write.', assessment: state });
        assert.equal(p.get('brain-fill').attributes.height, '28');
        p.get('input').value = 'An unsent question';
        p.click('recap');
        assert.equal(p.messages.at(-1)?.kind, 'recap');
        p.emit({ type: 'reply', text: 'We explored duplicate writes.', assessment: state });
        assert.equal(p.get('recap-view').hidden, false);
        assert.equal(p.get('recap-goal').textContent, 'Prevent duplicate writes.');
        assert.equal(p.get('finish').disabled, false);
        p.click('finish');
        assert.equal(p.get('finished-note').hidden, false);
        assert.match(p.get('finished-note').textContent, /gaps/);
        p.click('keep-studying');
        p.get('input').value = 'Further reasoning about the remaining checks.';
        p.click('form', 'submit');
        p.emit({ type: 'reply', text: 'All four checks passed.', assessment: {
                concepts: assessment_1.conceptIds.map(id => ({ id, status: 'demonstrated', quote: answer })), uncertainties: []
            } });
        assert.equal(p.get('finish').disabled, false);
        p.get('input').value = 'An unsent question';
        p.click('recap');
        p.emit({ type: 'reply', text: 'All four checks passed.', assessment: {
                concepts: assessment_1.conceptIds.map(id => ({ id, status: 'demonstrated', quote: answer })), uncertainties: []
            } });
        p.click('finish');
        assert.equal(p.get('finished-note').hidden, false);
        const requests = p.messages.length;
        p.click('keep-studying');
        assert.equal(p.get('discussion-view').hidden, false);
        assert.equal(p.get('input').value, 'An unsent question');
        p.click('nav-recap');
        assert.equal(p.messages.length, requests);
        p.click('restart');
        assert.equal(p.get('goal-view').hidden, false);
        assert.equal(p.get('brain-fill').attributes.height, '0');
    });
    (0, node_test_1.test)('a missing assessment allows finishing with uncertainty recorded', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Start with the code.' });
        p.click('nav-recap');
        p.emit({ type: 'reply', text: 'No test assessment is available.' });
        p.click('finish');
        assert.equal(p.get('finished-note').hidden, false);
        assert.match(p.get('finished-note').textContent, /unassessed/);
    });
    (0, node_test_1.test)('the quiz generates questions once, requires responses, and preserves them when asking the tutor for help', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Let us discuss.' });
        p.get('input').value = 'Unsent discussion draft';
        const requests = p.messages.length;
        p.click('test-understanding');
        assert.equal(p.get('test-view').hidden, false);
        assert.equal(p.messages.length, requests + 1);
        assert.equal(p.messages.at(-1)?.kind, 'quiz');
        p.emit({ type: 'quiz', goal: 'Prevent duplicate writes.', questions: quizQuestions });
        assert.equal(p.get('question-behavior').textContent, quizPrompts[1]);
        assert.equal(p.get('check-understanding').disabled, true);
        p.click('test-form', 'submit');
        assert.equal(p.messages.length, requests + 1);
        p.fillQuiz();
        p.get('test-effect').value = answer;
        p.click('test-form', 'submit');
        assert.equal(p.messages.at(-1)?.kind, 'test');
        assert.deepEqual(JSON.parse(p.messages.at(-1).text), { purpose: "I'm not sure yet.", behavior: "I'm not sure yet.", effect: answer, edge: "I'm not sure yet." });
        p.emit({ type: 'reply', text: 'Effect is supported; purpose, behavior, and edge cases need work.', assessment: state });
        assert.equal(p.get('test-results').hidden, false);
        assert.equal(p.get('test-gaps').children.length, 3);
        assert.equal(p.get('test-summary').children.length, 4);
        assert.equal(p.get('brain-fill').attributes.height, '28');
        p.get('test-gaps').children[0].listeners.click({ preventDefault() { } });
        assert.equal(p.get('discussion-view').hidden, false);
        assert.match(p.messages.at(-1)?.text ?? '', /Help me work on purpose/);
        p.emit({ type: 'reply', text: 'Here is a focused example.', assessment: state });
        assert.equal(p.get('input').value, 'Unsent discussion draft');
        const beforeReturn = p.messages.length;
        p.click('nav-test');
        assert.equal(p.messages.length, beforeReturn);
        assert.equal(p.get('test-effect').value, answer);
        p.click('recap');
        p.emit({ type: 'reply', text: 'Gaps remain.', assessment: state });
        p.click('finish');
        assert.equal(p.get('finished-note').hidden, false);
    });
    (0, node_test_1.test)('failed tests preserve answers and retry the same test; new goals clear them', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Ready.' });
        p.generateQuiz();
        p.fillQuiz();
        p.get('test-purpose').value = 'My purpose explanation';
        p.click('test-form', 'submit');
        const submission = p.messages.at(-1)?.text;
        p.emit({ type: 'chunk', text: 'Partial test feedback' });
        p.emit({ type: 'error', text: 'Cancelled' });
        assert.equal(p.get('test-view').hidden, false);
        assert.equal(p.get('test-purpose').value, 'My purpose explanation');
        p.click('retry');
        assert.equal(p.messages.at(-1)?.kind, 'test');
        assert.equal(p.messages.at(-1)?.text, submission);
        p.emit({ type: 'reply', text: 'No usable assessment.' });
        assert.equal(p.get('test-gaps').children.length, 4);
        p.click('edit-goal');
        p.get('goal-input').value = 'A new goal';
        p.click('goal-form', 'submit');
        p.emit({ type: 'reply', text: 'New discussion.' });
        assert.equal(p.get('test-purpose').value, '');
        assert.equal(p.get('test-results').hidden, true);
    });
    (0, node_test_1.test)('failed goals and cancelled partial replies retry without duplicate messages', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'chunk', text: 'Partial' });
        p.emit({ type: 'error', text: 'Cancelled' });
        assert.equal(p.get('thread').children.length, 0);
        assert.equal(p.get('goal-view').hidden, false);
        assert.equal(p.get('goal-input').value, 'Prevent duplicate writes.');
        p.click('retry');
        assert.equal(p.messages.at(-1)?.kind, 'goal');
        p.emit({ type: 'reply', text: 'Ready.' });
        p.get('input').value = 'Explain retries.';
        p.click('form', 'submit');
        p.emit({ type: 'chunk', text: 'Partial' });
        p.emit({ type: 'error', text: 'Cancelled' });
        assert.equal(p.get('thread').children.length, 2);
        assert.equal(p.get('input').value, 'Explain retries.');
        p.click('retry');
        assert.equal(p.messages.at(-1)?.kind, 'discussion');
    });
    (0, node_test_1.test)('code ranges still open snapshots and append scoped questions without sending', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Ready.' });
        (0, node_vm_1.runInContext)('showCode(1,10,11)', p.sandbox);
        assert.equal(p.get('code-preview').children.length, 2);
        p.click('open-snapshot');
        assert.equal(p.messages.at(-1)?.endLine, 11);
        p.get('input').value = 'Existing draft';
        const requests = p.messages.length;
        p.click('ask-code');
        assert.match(p.get('input').value, /^Existing draft\n\nHelp me reason about retry.ts lines 10-11/);
        assert.equal(p.messages.length, requests);
    });
});
//# sourceMappingURL=review.test.js.map