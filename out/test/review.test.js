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
const review_1 = require("../review");
const session_1 = require("../session");
const stream_1 = require("../stream");
const answer = 'A failed request can retry the same write twice.';
const state = {
    concepts: review_1.conceptIds.map(id => ({ id, status: id === 'effect' ? 'demonstrated' : 'discussed', ...(id === 'effect' ? { quote: answer } : {}) })),
    uncertainties: ['Whether the caller handles duplicate writes.']
};
const reply = 'The retry can repeat a write. [[1:10-11]]\n<review-state>' + JSON.stringify(state) + '</review-state>';
(0, node_test_1.suite)('Review evidence', () => {
    (0, node_test_1.test)('each blank field is skipped without affecting the other three judgments', async () => {
        for (const blank of review_1.conceptIds) {
            const answers = Object.fromEntries(review_1.conceptIds.map(id => [id, id === blank ? '' : 'answer for "' + id + '"']));
            const calls = [];
            const submission = JSON.stringify(answers);
            const result = await (0, review_1.assessIndependently)(submission, async (answer, id) => {
                calls.push(id);
                assert.notEqual(id, blank);
                assert.equal(answer, answers[id]);
                return JSON.stringify({ feedback: 'This idea is correct.', concepts: review_1.conceptIds.map(area => ({
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
        const result = await (0, review_1.assessIndependently)(JSON.stringify({ purpose: '', behavior: '', effect: '', edge: '' }), async () => {
            assert.fail('Blank answers must not call the model.');
        });
        assert.ok((0, review_1.parseAssessment)(result, [])?.concepts.every(concept => concept.status === 'unexplored'));
    });
    (0, node_test_1.test)('assessment requests enforce structured output and return feedback with validated evidence', async () => {
        const structured = JSON.stringify({ feedback: 'You understand the retry.', ...state });
        let request = {};
        const sandbox = (0, node_vm_1.createContext)({
            exports: {},
            require: (name) => name === 'vscode' ? { workspace: { getConfiguration: () => ({
                        get: (key) => key === 'model' ? 'test-model' : false
                    }) } } : name === './stream' ? { readReply: stream_1.readReply } : { assessmentFormat: review_1.assessmentFormat },
            fetch: async (_url, init) => {
                request = JSON.parse(init.body);
                return new Response(JSON.stringify({ message: { content: structured }, done: true }) + '\n');
            }
        });
        (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../llm.js'), 'utf8'), sandbox);
        const session = new session_1.Session({ label: 'Selected retry', sources: [{ name: 'retry.ts', content: 'retry();', language: 'typescript' }] });
        const messages = session.messages(answer, 'test');
        assert.ok(messages[1].content.includes('retry();'));
        assert.ok(!messages[0].content.includes('Be a code tutor'));
        const ask = sandbox.exports.askModel;
        const raw = await ask(messages, new AbortController().signal, () => { }, true);
        assert.deepEqual(request.format, review_1.assessmentFormat);
        assert.equal(session.complete(answer, raw, 'test'), 'You understand the retry.');
        assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
        assert.equal((0, review_1.parseAssessment)(structured, ['unrelated'])?.concepts[2].status, 'discussed');
        await ask(messages, new AbortController().signal, () => { }, false);
        assert.equal(request.format, undefined);
    });
    (0, node_test_1.test)('only accepts demonstrated claims backed by exact developer quotes', () => {
        assert.equal((0, review_1.parseAssessment)(reply, [answer])?.concepts[2].status, 'demonstrated');
        assert.equal((0, review_1.parseAssessment)(reply, [])?.concepts[2].status, 'discussed');
        assert.equal((0, review_1.parseAssessment)(reply, ['An unrelated answer'])?.concepts[2].quote, undefined);
        assert.equal((0, review_1.parseAssessment)(reply.replace(answer, ''), [''])?.concepts[2].status, 'discussed');
    });
    (0, node_test_1.test)('credits a short purpose answer independently of three blank fields', () => {
        const shortAnswer = 'a working calculator';
        const submission = 'Understanding test answers for my current goal:\n\nPurpose:\n' + shortAnswer +
            '\n\nBehavior:\nNot answered\n\nEffect:\nNot answered\n\nEdge cases:\nNot answered';
        const session = new session_1.Session({ label: 'Calculator', sources: [] });
        const result = JSON.stringify({ feedback: 'You identified its purpose.', concepts: review_1.conceptIds.map(id => ({
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
            assert.equal((0, review_1.parseAssessment)(shortReply, [quote])?.concepts[2].status, 'demonstrated');
            assert.equal((0, review_1.parseAssessment)(shortReply, ['An unrelated response'])?.concepts[2].status, 'discussed');
        }
        assert.equal((0, review_1.parseAssessment)(reply.replace(answer, '   '), ['   '])?.concepts[2].status, 'discussed');
    });
    (0, node_test_1.test)('missing, malformed, or incomplete assessments are unavailable', () => {
        for (const raw of ['Plain explanation', '<review-state>{broken}</review-state>', '<review-state>null</review-state>', '<review-state>{"concepts":[],"uncertainties":[]}</review-state>', reply.replace('"id":"edge"', '"id":"purpose"')]) {
            assert.equal((0, review_1.parseAssessment)(raw, [answer]), undefined);
        }
    });
    (0, node_test_1.test)('hides metadata across every network chunk boundary', () => {
        let displayed = '';
        for (let n = 1; n <= reply.length; n++) {
            const visible = (0, review_1.visibleReply)(reply.slice(0, n));
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
// Small DOM stand-in exercises actual panel event handlers without a model or VS Code.
class Element {
    tagName = 'DIV';
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
    return { get, emit, click, load, begin, messages, sandbox, tick: () => waiting?.() };
}
(0, node_test_1.suite)('Discussion, test, and recap', () => {
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
        p.click('nav-test');
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
        p.click('nav-test');
        p.get('test-behavior').value = 'it tries again if it fails';
        p.click('test-form', 'submit');
        p.emit({ type: 'reply', text: markdown });
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
                concepts: review_1.conceptIds.map(id => ({ id, status: 'demonstrated', quote: answer })), uncertainties: []
            } });
        assert.equal(p.get('finish').disabled, false);
        p.get('input').value = 'An unsent question';
        p.click('recap');
        p.emit({ type: 'reply', text: 'All four checks passed.', assessment: {
                concepts: review_1.conceptIds.map(id => ({ id, status: 'demonstrated', quote: answer })), uncertainties: []
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
    (0, node_test_1.test)('the test covers four areas without inference on entry and offers focused help or an end', () => {
        const p = panel();
        p.load();
        p.begin();
        p.emit({ type: 'reply', text: 'Let us discuss.' });
        p.get('input').value = 'Unsent discussion draft';
        const requests = p.messages.length;
        p.click('test-understanding');
        assert.equal(p.get('test-view').hidden, false);
        assert.equal(p.messages.length, requests);
        p.get('test-effect').value = answer;
        p.click('test-form', 'submit');
        assert.equal(p.messages.at(-1)?.kind, 'test');
        assert.deepEqual(JSON.parse(p.messages.at(-1).text), { purpose: '', behavior: '', effect: answer, edge: '' });
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
        p.click('nav-test');
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
        p.click('nav-test');
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