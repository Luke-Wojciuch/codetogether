import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suite, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { openAISchema } from '../models/openai';
import { assessmentFormat } from '../review/assessment';
import { quizAssessmentFormat, quizFormat, parseQuiz } from '../review/quiz';
import { readReply } from '../models/stream';
import type { Message } from '../review/session';

const messages: Message[] = [{ role: 'system', content: 'Be a code tutor.' }, { role: 'user', content: 'Explain add().'}];
const keyName = 'codetogether.openaiApiKey';
const signal = () => new AbortController().signal;

function openAIHarness(reply: () => Promise<Response>) {
	const requests: { url: string; init: RequestInit }[] = [];
	const sandbox = createContext({ exports: {}, fetch: async (url: string, init: RequestInit) => {
		requests.push({ url, init }); return reply();
	} });
	runInContext(readFileSync(resolve(__dirname, '../models/openai.js'), 'utf8'), sandbox);
	const ask = sandbox.exports.askOpenAI as (messages: Message[], model: string, key: string, signal: AbortSignal,
		onText: (text: string) => void, schema?: object) => Promise<string>;
	return { ask, requests };
}

suite('OpenAI provider', () => {
	test('uses Responses with bearer auth, no server-side response storage, and full conversation input', async () => {
		const p = openAIHarness(async () => Response.json({ status: 'completed', output: [
			{ type: 'reasoning', summary: [{ text: 'Not user-facing.' }] },
			{ type: 'message', content: [{ type: 'output_text', text: 'It adds two numbers.' }] }
		] }));
		const chunks: string[] = [];
		assert.equal(await p.ask(messages, 'test-gpt', 'fake-api-key', signal(), text => chunks.push(text)), 'It adds two numbers.');
		assert.deepEqual(chunks, ['It adds two numbers.']);
		assert.equal(p.requests[0].url, 'https://api.openai.com/v1/responses');
		assert.equal((p.requests[0].init.headers as Record<string, string>).Authorization, 'Bearer fake-api-key');
		const body = JSON.parse(p.requests[0].init.body as string);
		assert.equal(body.model, 'test-gpt');
		assert.equal(body.store, false);
		assert.equal(body.stream, false);
		assert.equal(body.text, undefined);
		assert.deepEqual(body.input, messages);
		assert.ok(!JSON.stringify(body).includes('fake-api-key'));
	});
	test('strict structured generation keeps optional citations nullable without mutating Ollama schemas', async () => {
		const before = JSON.stringify(quizFormat);
		const context = { label: 'Add', sources: [{ name: 'math.ts', content: 'return a + b;', language: 'typescript', startLine: 200 }] };
		const raw = JSON.stringify({ questions: [{ id: 'behavior', prompt: 'What is returned for a=1 and b=2?', sourceId: null, line: null, endLine: null }] });
		const p = openAIHarness(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] }));
		assert.equal(await p.ask(messages, 'test-gpt', 'fake-api-key', signal(), () => {}, quizFormat), raw);
		const format = JSON.parse(p.requests[0].init.body as string).text.format;
		assert.equal(format.type, 'json_schema');
		assert.equal(format.strict, true);
		const questionSchema = format.schema.properties.questions.items;
		assert.deepEqual(questionSchema.required, ['id', 'prompt', 'sourceId', 'line', 'endLine']);
		assert.deepEqual(questionSchema.properties.sourceId.anyOf, [{ type: 'integer', minimum: 0 }, { type: 'null' }]);
		assert.equal(format.schema.additionalProperties, false);
		assert.equal(questionSchema.additionalProperties, false);
		assert.equal(JSON.stringify(quizFormat), before);
		assert.deepEqual(openAISchema(quizAssessmentFormat), quizAssessmentFormat);
		assert.equal(parseQuiz(raw, context)[0].sourceId, 0);
	});
	test('refusals, incomplete responses, and empty output never become quiz or chat content', async () => {
		for (const [body, error] of [
			[{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }, /declined/],
			[{ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] }, /did not complete/],
			[{ status: 'failed', output: [] }, /did not complete/],
			[{ status: 'completed', output: [] }, /empty response/]
		] as const) {
			const p = openAIHarness(async () => Response.json(body));
			await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => assert.fail('Invalid output must stay hidden.')), error);
		}
	});
	test('HTTP errors give safe guidance without echoing remote error bodies', async () => {
		for (const [status, error] of [[401, /API key/], [403, /model access/], [404, /model access/], [429, /quota/], [500, /HTTP 500/]] as const) {
			const p = openAIHarness(async () => new Response('sensitive remote error body', { status }));
			await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => {}), error);
		}
	});
	test('network errors and cancellations do not retry or fall back to another provider', async () => {
		const p = openAIHarness(async () => { throw new Error('private connection details'); });
		await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => {}), /Could not reach OpenAI/);
		assert.equal(p.requests.length, 1);
		const controller = new AbortController(); controller.abort();
		const aborted = new Error('request aborted');
		const cancelled = openAIHarness(async () => { throw aborted; });
		await assert.rejects(cancelled.ask(messages, 'test-gpt', 'fake-key', controller.signal, () => {}), error => error === aborted);
	});
	test('provider routing requires a saved key and leaves existing Ollama requests unchanged', async () => {
		let provider = 'ollama';
		let key: string | undefined;
		let ollamaCalls = 0;
		const openaiCalls: unknown[][] = [];
		const sandbox = createContext({ exports: {}, require(name: string) {
			if (name === 'vscode') { return { workspace: { getConfiguration: () => ({ get: (name: string, fallback: unknown) =>
				({ provider, model: 'local-model', openaiModel: 'test-gpt', thinking: false } as Record<string, unknown>)[name] ?? fallback }) } }; }
			if (name === './openai') { return { askOpenAI: async (...args: unknown[]) => { openaiCalls.push(args); return 'GPT reply'; } }; }
			if (name === './stream') { return { readReply }; }
			return { assessmentFormat };
		}, fetch: async (_url: string, init: RequestInit) => {
			ollamaCalls++;
			const body = JSON.parse(init.body as string);
			assert.equal(body.model, 'local-model'); assert.equal(body.stream, true);
			assert.deepEqual(body.format, quizFormat);
			return new Response(JSON.stringify({ message: { content: 'Local reply' }, done: true }) + '\n');
		} });
		runInContext(readFileSync(resolve(__dirname, '../models/llm.js'), 'utf8'), sandbox);
		const ask = sandbox.exports.askModel as (messages: Message[], signal: AbortSignal, callback: () => void, schema: object,
			secrets?: { get: (name: string) => Promise<string | undefined> }) => Promise<string>;
		const secrets = { get: async (name: string) => { assert.equal(name, keyName); return key; } };
		assert.equal(await ask(messages, signal(), () => {}, quizFormat, secrets), 'Local reply');
		provider = 'openai';
		await assert.rejects(ask(messages, signal(), () => {}, quizFormat, secrets), /CodeTogether: Settings/);
		key = 'fake-key';
		assert.equal(await ask(messages, signal(), () => {}, quizFormat, secrets), 'GPT reply');
		assert.equal(openaiCalls[0][1], 'test-gpt'); assert.equal(openaiCalls[0][2], key);
		assert.equal(openaiCalls[0][5], quizFormat);
		assert.equal(ollamaCalls, 1);
		provider = 'unknown';
		await assert.rejects(ask(messages, signal(), () => {}, quizFormat, secrets), /Unknown model provider/);
	});
});

function settingsHarness() {
	const secrets = new Map<string, string>();
	const config = new Map<string, unknown>([['provider', 'ollama'], ['model', 'local-model']]);
	const inputs: { password?: boolean; value?: string; validateInput?: (value: string) => string | undefined }[] = [];
	const answers: (string | undefined)[] = [];
	let provider = 'openai';
	let approved = true;
	const sandbox = createContext({ exports: {}, require(name: string) {
		if (name === '../models/llm') { return { openAIApiKeySecret: keyName }; }
		if (name !== 'vscode') { return {}; }
		return {
			ConfigurationTarget: { Global: 1 },
			workspace: { registerTextDocumentContentProvider: () => ({}), getConfiguration: () => ({
				get: (key: string, fallback: unknown) => config.get(key) ?? fallback,
				update: async (key: string, value: unknown) => { config.set(key, value); }
			}) },
			window: {
				showQuickPick: async (items: { provider: string }[]) => items.find(item => item.provider === provider),
				showWarningMessage: async () => approved ? 'Use OpenAI' : undefined,
				showInputBox: async (options: typeof inputs[number]) => { inputs.push(options); return answers.shift(); },
				showInformationMessage: () => Promise.resolve()
			}
		};
	} });
	runInContext(readFileSync(resolve(__dirname, '../commands/modelSettings.js'), 'utf8'), sandbox);
	const extensionContext = { secrets: {
		get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); },
		delete: async (key: string) => { secrets.delete(key); }
	} };
	return { secrets, config, inputs, answers,
		setKey: () => sandbox.exports.setOpenAIKey(extensionContext),
		removeKey: () => sandbox.exports.removeOpenAIKey(extensionContext),
		chooseModel: () => sandbox.exports.chooseModel(extensionContext),
		select: (value: string) => { provider = value; }, consent: (value: boolean) => { approved = value; } };
}

suite('Native model and API key dialogs', () => {
	test('keys are masked, stored only in secret storage, never prefilled, and removable', async () => {
		const p = settingsHarness(); p.answers.push(' fake-key ');
		await p.setKey();
		assert.equal(p.inputs[0].password, true);
		assert.equal(p.inputs[0].value, undefined);
		assert.ok(p.inputs[0].validateInput?.(''));
		assert.ok(p.inputs[0].validateInput?.('bad key'));
		assert.equal(p.secrets.get(keyName), 'fake-key');
		assert.equal(p.config.get('provider'), 'ollama');
		assert.ok(![...p.config.values()].includes('fake-key'));
		p.answers.push(undefined);
		await p.setKey();
		assert.equal(p.inputs[1].value, undefined);
		assert.equal(p.secrets.get(keyName), 'fake-key');
		await p.removeKey();
		assert.equal(p.secrets.has(keyName), false);
	});
	test('choosing GPT requests model then key and changes provider only after setup completes', async () => {
		const p = settingsHarness(); p.answers.push('test-gpt', 'fake-key');
		await p.chooseModel();
		assert.equal(p.config.get('provider'), 'openai'); assert.equal(p.config.get('openaiModel'), 'test-gpt');
		assert.equal(p.config.get('model'), 'local-model'); assert.equal(p.secrets.get(keyName), 'fake-key');
		assert.equal(p.inputs[1].password, true);
		p.select('ollama'); p.answers.push('another-local-model');
		await p.chooseModel();
		assert.equal(p.config.get('provider'), 'ollama'); assert.equal(p.config.get('model'), 'another-local-model');
		assert.equal(p.config.get('openaiModel'), 'test-gpt');
	});
	test('cancelled consent or key entry does not switch the provider or overwrite the model', async () => {
		const p = settingsHarness(); p.consent(false);
		await p.chooseModel();
		assert.equal(p.inputs.length, 0);
		p.consent(true); p.answers.push('test-gpt', undefined);
		await p.chooseModel();
		assert.equal(p.config.get('provider'), 'ollama');
		assert.equal(p.config.has('openaiModel'), false); assert.equal(p.secrets.size, 0);
	});
});
