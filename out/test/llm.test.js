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
const openai_1 = require("../models/openai");
const assessment_1 = require("../review/assessment");
const quiz_1 = require("../review/quiz");
const stream_1 = require("../models/stream");
const messages = [{ role: 'system', content: 'Be a code tutor.' }, { role: 'user', content: 'Explain add().' }];
const keyName = 'codetogether.openaiApiKey';
const signal = () => new AbortController().signal;
function openAIHarness(reply) {
    const requests = [];
    const sandbox = (0, node_vm_1.createContext)({ exports: {}, fetch: async (url, init) => {
            requests.push({ url, init });
            return reply();
        } });
    (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../models/openai.js'), 'utf8'), sandbox);
    const ask = sandbox.exports.askOpenAI;
    return { ask, requests };
}
(0, node_test_1.suite)('OpenAI provider', () => {
    (0, node_test_1.test)('uses Responses with bearer auth, no server-side response storage, and full conversation input', async () => {
        const p = openAIHarness(async () => Response.json({ status: 'completed', output: [
                { type: 'reasoning', summary: [{ text: 'Not user-facing.' }] },
                { type: 'message', content: [{ type: 'output_text', text: 'It adds two numbers.' }] }
            ] }));
        const chunks = [];
        assert.equal(await p.ask(messages, 'test-gpt', 'fake-api-key', signal(), text => chunks.push(text)), 'It adds two numbers.');
        assert.deepEqual(chunks, ['It adds two numbers.']);
        assert.equal(p.requests[0].url, 'https://api.openai.com/v1/responses');
        assert.equal(p.requests[0].init.headers.Authorization, 'Bearer fake-api-key');
        const body = JSON.parse(p.requests[0].init.body);
        assert.equal(body.model, 'test-gpt');
        assert.equal(body.store, false);
        assert.equal(body.stream, false);
        assert.equal(body.text, undefined);
        assert.deepEqual(body.input, messages);
        assert.ok(!JSON.stringify(body).includes('fake-api-key'));
    });
    (0, node_test_1.test)('strict structured generation keeps optional citations nullable without mutating Ollama schemas', async () => {
        const before = JSON.stringify(quiz_1.quizFormat);
        const context = { label: 'Add', sources: [{ name: 'math.ts', content: 'return a + b;', language: 'typescript', startLine: 200 }] };
        const raw = JSON.stringify({ questions: [{ id: 'behavior', prompt: 'What is returned for a=1 and b=2?', sourceId: null, line: null, endLine: null }] });
        const p = openAIHarness(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] }));
        assert.equal(await p.ask(messages, 'test-gpt', 'fake-api-key', signal(), () => { }, quiz_1.quizFormat), raw);
        const format = JSON.parse(p.requests[0].init.body).text.format;
        assert.equal(format.type, 'json_schema');
        assert.equal(format.strict, true);
        const questionSchema = format.schema.properties.questions.items;
        assert.deepEqual(questionSchema.required, ['id', 'prompt', 'sourceId', 'line', 'endLine']);
        assert.deepEqual(questionSchema.properties.sourceId.anyOf, [{ type: 'integer', minimum: 0 }, { type: 'null' }]);
        assert.equal(format.schema.additionalProperties, false);
        assert.equal(questionSchema.additionalProperties, false);
        assert.equal(JSON.stringify(quiz_1.quizFormat), before);
        assert.deepEqual((0, openai_1.openAISchema)(quiz_1.quizAssessmentFormat), quiz_1.quizAssessmentFormat);
        assert.equal((0, quiz_1.parseQuiz)(raw, context)[0].sourceId, 0);
    });
    (0, node_test_1.test)('refusals, incomplete responses, and empty output never become quiz or chat content', async () => {
        for (const [body, error] of [
            [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }, /declined/],
            [{ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] }, /did not complete/],
            [{ status: 'failed', output: [] }, /did not complete/],
            [{ status: 'completed', output: [] }, /empty response/]
        ]) {
            const p = openAIHarness(async () => Response.json(body));
            await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => assert.fail('Invalid output must stay hidden.')), error);
        }
    });
    (0, node_test_1.test)('HTTP errors give safe guidance without echoing remote error bodies', async () => {
        for (const [status, error] of [[401, /API key/], [403, /model access/], [404, /model access/], [429, /quota/], [500, /HTTP 500/]]) {
            const p = openAIHarness(async () => new Response('sensitive remote error body', { status }));
            await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => { }), error);
        }
    });
    (0, node_test_1.test)('network errors and cancellations do not retry or fall back to another provider', async () => {
        const p = openAIHarness(async () => { throw new Error('private connection details'); });
        await assert.rejects(p.ask(messages, 'test-gpt', 'fake-key', signal(), () => { }), /Could not reach OpenAI/);
        assert.equal(p.requests.length, 1);
        const controller = new AbortController();
        controller.abort();
        const aborted = new Error('request aborted');
        const cancelled = openAIHarness(async () => { throw aborted; });
        await assert.rejects(cancelled.ask(messages, 'test-gpt', 'fake-key', controller.signal, () => { }), error => error === aborted);
    });
    (0, node_test_1.test)('provider routing requires a saved key and leaves existing Ollama requests unchanged', async () => {
        let provider = 'ollama';
        let key;
        let ollamaCalls = 0;
        const openaiCalls = [];
        const sandbox = (0, node_vm_1.createContext)({ exports: {}, require(name) {
                if (name === 'vscode') {
                    return { workspace: { getConfiguration: () => ({ get: (name, fallback) => ({ provider, model: 'local-model', openaiModel: 'test-gpt', thinking: false }[name] ?? fallback) }) } };
                }
                if (name === './openai') {
                    return { askOpenAI: async (...args) => { openaiCalls.push(args); return 'GPT reply'; } };
                }
                if (name === './stream') {
                    return { readReply: stream_1.readReply };
                }
                return { assessmentFormat: assessment_1.assessmentFormat };
            }, fetch: async (_url, init) => {
                ollamaCalls++;
                const body = JSON.parse(init.body);
                assert.equal(body.model, 'local-model');
                assert.equal(body.stream, true);
                assert.deepEqual(body.format, quiz_1.quizFormat);
                return new Response(JSON.stringify({ message: { content: 'Local reply' }, done: true }) + '\n');
            } });
        (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../models/llm.js'), 'utf8'), sandbox);
        const ask = sandbox.exports.askModel;
        const secrets = { get: async (name) => { assert.equal(name, keyName); return key; } };
        assert.equal(await ask(messages, signal(), () => { }, quiz_1.quizFormat, secrets), 'Local reply');
        provider = 'openai';
        await assert.rejects(ask(messages, signal(), () => { }, quiz_1.quizFormat, secrets), /CodeTogether: Settings/);
        key = 'fake-key';
        assert.equal(await ask(messages, signal(), () => { }, quiz_1.quizFormat, secrets), 'GPT reply');
        assert.equal(openaiCalls[0][1], 'test-gpt');
        assert.equal(openaiCalls[0][2], key);
        assert.equal(openaiCalls[0][5], quiz_1.quizFormat);
        assert.equal(ollamaCalls, 1);
        provider = 'unknown';
        await assert.rejects(ask(messages, signal(), () => { }, quiz_1.quizFormat, secrets), /Unknown model provider/);
    });
});
function settingsHarness() {
    const secrets = new Map();
    const config = new Map([['provider', 'ollama'], ['model', 'local-model']]);
    const inputs = [];
    const answers = [];
    let provider = 'openai';
    let approved = true;
    const sandbox = (0, node_vm_1.createContext)({ exports: {}, require(name) {
            if (name === '../models/llm') {
                return { openAIApiKeySecret: keyName };
            }
            if (name !== 'vscode') {
                return {};
            }
            return {
                ConfigurationTarget: { Global: 1 },
                workspace: { registerTextDocumentContentProvider: () => ({}), getConfiguration: () => ({
                        get: (key, fallback) => config.get(key) ?? fallback,
                        update: async (key, value) => { config.set(key, value); }
                    }) },
                window: {
                    showQuickPick: async (items) => items.find(item => item.provider === provider),
                    showWarningMessage: async () => approved ? 'Use OpenAI' : undefined,
                    showInputBox: async (options) => { inputs.push(options); return answers.shift(); },
                    showInformationMessage: () => Promise.resolve()
                }
            };
        } });
    (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../commands/modelSettings.js'), 'utf8'), sandbox);
    const extensionContext = { secrets: {
            get: async (key) => secrets.get(key), store: async (key, value) => { secrets.set(key, value); },
            delete: async (key) => { secrets.delete(key); }
        } };
    return { secrets, config, inputs, answers,
        setKey: () => sandbox.exports.setOpenAIKey(extensionContext),
        removeKey: () => sandbox.exports.removeOpenAIKey(extensionContext),
        chooseModel: () => sandbox.exports.chooseModel(extensionContext),
        select: (value) => { provider = value; }, consent: (value) => { approved = value; } };
}
(0, node_test_1.suite)('Native model and API key dialogs', () => {
    (0, node_test_1.test)('keys are masked, stored only in secret storage, never prefilled, and removable', async () => {
        const p = settingsHarness();
        p.answers.push(' fake-key ');
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
    (0, node_test_1.test)('choosing GPT requests model then key and changes provider only after setup completes', async () => {
        const p = settingsHarness();
        p.answers.push('test-gpt', 'fake-key');
        await p.chooseModel();
        assert.equal(p.config.get('provider'), 'openai');
        assert.equal(p.config.get('openaiModel'), 'test-gpt');
        assert.equal(p.config.get('model'), 'local-model');
        assert.equal(p.secrets.get(keyName), 'fake-key');
        assert.equal(p.inputs[1].password, true);
        p.select('ollama');
        p.answers.push('another-local-model');
        await p.chooseModel();
        assert.equal(p.config.get('provider'), 'ollama');
        assert.equal(p.config.get('model'), 'another-local-model');
        assert.equal(p.config.get('openaiModel'), 'test-gpt');
    });
    (0, node_test_1.test)('cancelled consent or key entry does not switch the provider or overwrite the model', async () => {
        const p = settingsHarness();
        p.consent(false);
        await p.chooseModel();
        assert.equal(p.inputs.length, 0);
        p.consent(true);
        p.answers.push('test-gpt', undefined);
        await p.chooseModel();
        assert.equal(p.config.get('provider'), 'ollama');
        assert.equal(p.config.has('openaiModel'), false);
        assert.equal(p.secrets.size, 0);
    });
});
//# sourceMappingURL=llm.test.js.map