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
const node_test_1 = require("node:test");
const session_1 = require("../review/session");
const stream_1 = require("../models/stream");
const changes_1 = require("../git/changes");
const code = {
    label: 'Selected code', sources: [{
            name: 'retry.ts', content: 'const pending = request();\nreturn pending;', language: 'typescript', startLine: 10
        }]
};
function streamedResponse(text, byteByByte = false) {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(controller) {
            if (byteByByte) {
                for (const byte of bytes) {
                    controller.enqueue(Uint8Array.of(byte));
                }
            }
            else {
                controller.enqueue(bytes);
            }
            controller.close();
        }
    });
}
(0, node_test_1.suite)('Ollama streaming', () => {
    (0, node_test_1.test)('delivers content before completion, including split UTF-8 and a final line without a newline', async () => {
        const chunks = [];
        const body = streamedResponse('\n{"message":{"thinking":"hidden"}}\n{"message":{"content":"Café "}}\n{"message":{"content":"[[1:10]]"}}\n{"done":true}', true);
        const reply = await (0, stream_1.readReply)(body, text => { chunks.push(text); });
        assert.deepEqual(chunks, ['Café ', '[[1:10]]']);
        assert.equal(reply, 'Café [[1:10]]');
    });
    (0, node_test_1.test)('does not accept a partial answer as a completed reply', async () => {
        await assert.rejects((0, stream_1.readReply)(streamedResponse('{"message":{"content":"Partial"}}\n'), () => { }), /interrupted/);
    });
    (0, node_test_1.test)('reports Ollama errors, empty replies, malformed JSON, and aborted streams', async () => {
        await assert.rejects((0, stream_1.readReply)(streamedResponse('{"error":"model unavailable"}\n'), () => { }), /model unavailable/);
        await assert.rejects((0, stream_1.readReply)(streamedResponse('{"done":true}\n'), () => { }), /empty response/);
        await assert.rejects((0, stream_1.readReply)(streamedResponse('invalid\n'), () => { }), SyntaxError);
        const aborted = new ReadableStream({ start(controller) { controller.error(new Error('aborted')); } });
        await assert.rejects((0, stream_1.readReply)(aborted, () => { }), /aborted/);
    });
});
(0, node_test_1.suite)('Walkthrough session', () => {
    (0, node_test_1.test)('code ranges must be ordered and entirely inside the supplied snapshot', () => {
        const session = new session_1.Session(code);
        assert.equal(session.reference(1, 10, 11)?.name, 'retry.ts');
        for (const [start, end] of [[9, 11], [10, 12], [11, 10], [10, 10.5], [10, NaN]]) {
            assert.equal(session.reference(1, start, end), undefined);
        }
    });
    (0, node_test_1.test)('preserves the assistant question and a correction in subsequent requests', () => {
        const session = new session_1.Session(code);
        session.complete('Prevent duplicate requests.', 'The promise is shared. What if it fails?');
        session.complete('Actually, prevent duplicate writes; show an example.', 'That needs a different guarantee.');
        assert.deepEqual(session.messages('Continue.').slice(2), [
            { role: 'user', content: 'Prevent duplicate requests.' },
            { role: 'assistant', content: 'The promise is shared. What if it fails?' },
            { role: 'user', content: 'Actually, prevent duplicate writes; show an example.' },
            { role: 'assistant', content: 'That needs a different guarantee.' },
            { role: 'user', content: 'Continue.' }
        ]);
    });
    (0, node_test_1.test)('failed or cancelled requests do not enter history; retry has one pending turn', () => {
        const session = new session_1.Session(code);
        const before = session.messages('Explain.');
        session.messages('Explain.');
        assert.deepEqual(session.messages('Explain.'), before);
        session.complete('Explain.', 'Explanation.');
        assert.equal(session.messages('Next.').length, 5);
    });
    (0, node_test_1.test)('only references inside the supplied snapshot resolve, using original line numbers', () => {
        const session = new session_1.Session(code);
        assert.equal(session.reference(1, 10)?.name, 'retry.ts');
        assert.equal(session.reference(1, 11)?.name, 'retry.ts');
        for (const [id, line] of [[1, 9], [1, 12], [2, 10], [0, 10], [1, 10.5], [1, NaN]]) {
            assert.equal(session.reference(id, line), undefined);
        }
        assert.match(session.messages('Explain.')[1].content, /10: const pending/);
    });
    (0, node_test_1.test)('new sessions have no old conversation and keep their own code scope', () => {
        const old = new session_1.Session(code);
        old.complete('Old goal', 'Old explanation');
        const fresh = new session_1.Session({ label: 'New scope', sources: [] });
        assert.equal(fresh.messages('New goal').length, 3);
        assert.match(fresh.messages('New goal')[1].content, /New scope/);
        assert.equal(fresh.reference(1, 10), undefined);
    });
    (0, node_test_1.test)('oversized context fails explicitly rather than dropping history or code', () => {
        const session = new session_1.Session({ label: 'Large diff', diff: 'x'.repeat(120_000), sources: [] });
        assert.throws(() => session.messages('Explain.'), /too large/);
    });
});
(0, node_test_1.suite)('Staged line counts', () => {
    (0, node_test_1.test)('preserves literal paths and distinguishes binary, added, and deleted files', () => {
        assert.deepEqual((0, changes_1.parseNumstat)(['3\t2\tsrc/main.ts', '-\t-\timage.png', '0\t5\tremoved.ts', '7\t0\tnew\tfile\nname.ts', ''].join('\0')), [
            { name: 'src/main.ts', added: 3, deleted: 2 },
            { name: 'image.png', added: null, deleted: null },
            { name: 'removed.ts', added: 0, deleted: 5 },
            { name: 'new\tfile\nname.ts', added: 7, deleted: 0 }
        ]);
        assert.deepEqual((0, changes_1.parseNumstat)(''), []);
    });
});
//# sourceMappingURL=extension.test.js.map