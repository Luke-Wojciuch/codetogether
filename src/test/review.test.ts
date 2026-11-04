import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suite, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { conceptIds, parseAssessment, visibleReply } from '../review';
import { Session } from '../session';

const answer = 'A failed request can retry the same write twice.';
const state = {
	concepts: conceptIds.map(id => ({ id, status: id === 'effect' ? 'demonstrated' : 'discussed', ...(id === 'effect' ? { quote: answer } : {}) })),
	uncertainties: ['Whether the caller handles duplicate writes.']
};
const reply = 'The retry can repeat a write. [[1:10-11]]\n<review-state>' + JSON.stringify(state) + '</review-state>';

suite('Review evidence', () => {
	test('only accepts demonstrated claims backed by exact developer quotes', () => {
		assert.equal(parseAssessment(reply, [answer])?.concepts[2].status, 'demonstrated');
		assert.equal(parseAssessment(reply, [])?.concepts[2].status, 'discussed');
		assert.equal(parseAssessment(reply, ['An unrelated answer'])?.concepts[2].quote, undefined);
		assert.equal(parseAssessment(reply.replace(answer, 'yes'), ['yes'])?.concepts[2].status, 'discussed');
	});
	test('missing, malformed, or incomplete assessments are unavailable', () => {
		for (const raw of ['Plain explanation', '<review-state>{broken}</review-state>', '<review-state>null</review-state>', '<review-state>{"concepts":[],"uncertainties":[]}</review-state>', reply.replace('"id":"edge"', '"id":"purpose"')]) {
			assert.equal(parseAssessment(raw, [answer]), undefined);
		}
	});
	test('hides metadata across every network chunk boundary', () => {
		let displayed = '';
		for (let n = 1; n <= reply.length; n++) {
			const visible = visibleReply(reply.slice(0, n));
			if (visible.length > displayed.length) { displayed += visible.slice(displayed.length); }
			assert.ok(!displayed.includes('<review-state>'));
			assert.ok(!displayed.includes('"concepts"'));
		}
		assert.equal(displayed.trim(), 'The retry can repeat a write. [[1:10-11]]');
	});
	test('goals and recap requests are excluded from evidence; changing the goal resets evidence', () => {
		const session = new Session({ label: 'Test', sources: [] });
		session.complete(answer, reply, 'goal');
		assert.equal(session.assessment?.concepts[2].status, 'discussed');
		session.complete(answer, reply);
		assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
		session.complete('Recap', reply, 'recap');
		assert.equal(session.assessment?.concepts[2].status, 'demonstrated');
		assert.ok(session.messages('Continue').every(message => !message.content.includes('<review-state>{')));
		session.complete('Different goal', reply, 'goal');
		assert.equal(session.assessment?.concepts[2].status, 'discussed');
		session.complete('Continue', 'No metadata today.');
		assert.equal(session.assessment, undefined);
	});
	test('an empty explanation cannot commit history or evidence', () => {
		const session = new Session({ label: 'Test', sources: [] });
		const before = session.messages('Continue');
		assert.throws(() => session.complete(answer, reply.slice(reply.indexOf('<review-state>'))), /no explanation/);
		assert.deepEqual(session.messages('Continue'), before);
		assert.equal(session.assessment, undefined);
	});
});

// Small DOM stand-in exercises actual panel event handlers without a model or VS Code.
class Element {
	children: Element[] = [];
	parentElement?: Element;
	dataset: Record<string, string> = {};
	attributes: Record<string, string> = {};
	style: Record<string, string> = {};
	listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
	textContent = '';
	value = '';
	className = '';
	hidden = false;
	disabled = false;
	nodeType = 1;
	classList = { toggle: (name: string, on: boolean) => {
		const classes = this.className.split(' ').filter(item => item !== name);
		if (on) { classes.push(name); }
		this.className = classes.join(' ');
	} };
	append(...items: Element[]) {
		for (const item of items) {
			item.remove();
			item.parentElement = this;
			this.children.push(item);
		}
	}
	insertBefore(item: Element, before: Element) {
		item.remove();
		item.parentElement = this;
		const index = this.children.indexOf(before);
		this.children.splice(index < 0 ? this.children.length : index, 0, item);
	}
	remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(item => item !== this); } }
	replaceChildren() { this.children = []; }
	addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) { this.listeners[type] = listener; }
	setAttribute(name: string, value: string) { this.attributes[name] = value; }
	removeAttribute(name: string) { delete this.attributes[name]; }
	contains(node: Element): boolean { return node === this || this.children.some(child => child.contains(node)); }
	closest(): Element | undefined { return this.className.split(' ').includes('code-line') ? this : this.parentElement?.closest(); }
	get previousElementSibling(): Element | undefined { return this.parentElement?.children[(this.parentElement?.children.indexOf(this) ?? 0) - 1]; }
	focus() { /* No layout in this harness. */ }
	scrollIntoView() { /* No layout in this harness. */ }
}

function panel() {
	const elements = new Map<string, Element>();
	const messages: { type: string; kind?: string; text?: string; line?: number; endLine?: number }[] = [];
	let receive: (event: { data: object }) => void = () => {};
	const get = (id: string) => {
		if (!elements.has(id)) { elements.set(id, new Element()); }
		return elements.get(id)!;
	};
	const sandbox = createContext({
		Node: { TEXT_NODE: 3 },
		document: {
			getElementById: get, querySelectorAll: () => [], addEventListener: () => {},
			createElement: () => new Element(),
			createTextNode: (text: string) => Object.assign(new Element(), { textContent: text, nodeType: 3 })
		},
		window: { getSelection: () => null, addEventListener: (_: string, listener: typeof receive) => { receive = listener; } },
		acquireVsCodeApi: () => ({ postMessage: (message: typeof messages[number]) => messages.push({ ...message }) })
	});
	runInContext(readFileSync(resolve(__dirname, '../../UI/review.js'), 'utf8'), sandbox);
	const emit = (data: object) => receive({ data });
	const click = (id: string, type = 'click') => get(id).listeners[type]({ preventDefault() {} });
	const load = () => emit({ type: 'context', context: {
		label: 'Staged snapshot', changes: [{ name: 'retry.ts', added: 3, deleted: 1 }],
		sources: [{ name: 'retry.ts', content: 'const pending = request();\nreturn pending;', startLine: 10 }]
	} });
	const begin = () => { get('goal-input').value = 'Prevent duplicate writes.'; click('goal-form', 'submit'); };
	return { get, emit, click, load, begin, messages, sandbox };
}

suite('Three-screen review', () => {
	test('loading needs no inference; goal, discussion, recap, finish, and resume share the session', () => {
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
	test('failed goals and cancelled partial replies retry without duplicate messages', () => {
		const p = panel(); p.load(); p.begin();
		p.emit({ type: 'chunk', text: 'Partial' });
		p.emit({ type: 'error', text: 'Cancelled' });
		assert.equal(p.get('thread').children.length, 0);
		assert.equal(p.get('goal-view').hidden, false);
		assert.equal(p.get('goal-input').value, 'Prevent duplicate writes.');
		p.click('retry');
		assert.equal(p.messages.at(-1)?.kind, 'goal');
		p.emit({ type: 'reply', text: 'Ready.' });
		p.get('input').value = 'Explain retries.'; p.click('form', 'submit');
		p.emit({ type: 'chunk', text: 'Partial' });
		p.emit({ type: 'error', text: 'Cancelled' });
		assert.equal(p.get('thread').children.length, 2);
		assert.equal(p.get('input').value, 'Explain retries.');
		p.click('retry');
		assert.equal(p.messages.at(-1)?.kind, 'discussion');
	});
	test('code ranges still open snapshots and append scoped questions without sending', () => {
		const p = panel(); p.load(); p.begin(); p.emit({ type: 'reply', text: 'Ready.' });
		runInContext('showCode(1,10,11)', p.sandbox);
		assert.equal(p.get('code-preview').children.length, 2);
		p.click('open-snapshot');
		assert.equal(p.messages.at(-1)?.endLine, 11);
		p.get('input').value = 'Existing draft';
		const requests = p.messages.length;
		p.click('ask-code');
		assert.match(p.get('input').value, /^Existing draft\n\nHelp me trace retry.ts lines 10-11/);
		assert.equal(p.messages.length, requests);
	});
});
