import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { Session, CodeContext } from '../session';
import { readReply } from '../stream';
import { parseNumstat } from '../changes';

const code: CodeContext = {
	label: 'Selected code', sources: [{
		name: 'retry.ts', content: 'const pending = request();\nreturn pending;', language: 'typescript', startLine: 10
	}]
};

function streamedResponse(text: string, byteByByte = false): NonNullable<Response['body']> {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			if (byteByByte) {
				for (const byte of bytes) { controller.enqueue(Uint8Array.of(byte)); }
			} else {
				controller.enqueue(bytes);
			}
			controller.close();
		}
	});
}

suite('Ollama streaming', () => {
	test('delivers content before completion, including split UTF-8 and a final line without a newline', async () => {
		const chunks: string[] = [];
		const body = streamedResponse('\n{"message":{"thinking":"hidden"}}\n{"message":{"content":"Café "}}\n{"message":{"content":"[[1:10]]"}}\n{"done":true}', true);
		const reply = await readReply(body, text => { chunks.push(text); });
		assert.deepEqual(chunks, ['Café ', '[[1:10]]']);
		assert.equal(reply, 'Café [[1:10]]');
	});
	test('does not accept a partial answer as a completed reply', async () => {
		await assert.rejects(readReply(streamedResponse('{"message":{"content":"Partial"}}\n'), () => {}), /interrupted/);
	});
	test('reports Ollama errors, empty replies, malformed JSON, and aborted streams', async () => {
		await assert.rejects(readReply(streamedResponse('{"error":"model unavailable"}\n'), () => {}), /model unavailable/);
		await assert.rejects(readReply(streamedResponse('{"done":true}\n'), () => {}), /empty response/);
		await assert.rejects(readReply(streamedResponse('invalid\n'), () => {}), SyntaxError);
		const aborted = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('aborted')); } });
		await assert.rejects(readReply(aborted, () => {}), /aborted/);
	});
});

suite('Walkthrough session', () => {
	test('code ranges must be ordered and entirely inside the supplied snapshot', () => {
		const session = new Session(code);
		assert.equal(session.reference(1, 10, 11)?.name, 'retry.ts');
		for (const [start, end] of [[9, 11], [10, 12], [11, 10], [10, 10.5], [10, NaN]]) {
			assert.equal(session.reference(1, start, end), undefined);
		}
	});
	test('preserves the assistant question and a correction in subsequent requests', () => {
		const session = new Session(code);
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
	test('failed or cancelled requests do not enter history; retry has one pending turn', () => {
		const session = new Session(code);
		const before = session.messages('Explain.');
		session.messages('Explain.');
		assert.deepEqual(session.messages('Explain.'), before);
		session.complete('Explain.', 'Explanation.');
		assert.equal(session.messages('Next.').length, 5);
	});
	test('only references inside the supplied snapshot resolve, using original line numbers', () => {
		const session = new Session(code);
		assert.equal(session.reference(1, 10)?.name, 'retry.ts');
		assert.equal(session.reference(1, 11)?.name, 'retry.ts');
		for (const [id, line] of [[1, 9], [1, 12], [2, 10], [0, 10], [1, 10.5], [1, NaN]]) {
			assert.equal(session.reference(id, line), undefined);
		}
		assert.match(session.messages('Explain.')[1]!.content, /10: const pending/);
	});
	test('new sessions have no old conversation and keep their own code scope', () => {
		const old = new Session(code);
		old.complete('Old goal', 'Old explanation');
		const fresh = new Session({ label: 'New scope', sources: [] });
		assert.equal(fresh.messages('New goal').length, 3);
		assert.match(fresh.messages('New goal')[1]!.content, /New scope/);
		assert.equal(fresh.reference(1, 10), undefined);
	});
	test('oversized context fails explicitly rather than dropping history or code', () => {
		const session = new Session({ label: 'Large diff', diff: 'x'.repeat(120_000), sources: [] });
		assert.throws(() => session.messages('Explain.'), /too large/);
	});
});

suite('Staged line counts', () => {
	test('preserves literal paths and distinguishes binary, added, and deleted files', () => {
		assert.deepEqual(parseNumstat(['3\t2\tsrc/main.ts', '-\t-\timage.png', '0\t5\tremoved.ts', '7\t0\tnew\tfile\nname.ts', ''].join('\0')), [
			{ name: 'src/main.ts', added: 3, deleted: 2 },
			{ name: 'image.png', added: null, deleted: null },
			{ name: 'removed.ts', added: 0, deleted: 5 },
			{ name: 'new\tfile\nname.ts', added: 7, deleted: 0 }
		]);
		assert.deepEqual(parseNumstat(''), []);
	});
});
