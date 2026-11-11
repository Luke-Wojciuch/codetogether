import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, suite, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { approveStagedCommit, commitGateHook, installCommitGate, removeCommitGate } from '../git/commitGate';
import { git, stagedSnapshot } from '../git/client';
import { Session } from '../review/session';

const source = 'export function value() { return 2; }\n';
const submission = JSON.stringify({ behavior: 'It returns 2.' });
const uncertainSubmission = JSON.stringify({ behavior: "I'm not sure yet." });

// This test file's subprocesses must not inherit the developer's hook manager or
// signing configuration. Only the child test process environment is changed.
const previousGitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('GIT_')));
before(() => {
	for (const name of Object.keys(process.env)) { if (name.startsWith('GIT_')) { delete process.env[name]; } }
	process.env.GIT_CONFIG_GLOBAL = path.join(tmpdir(), 'codetogether-no-config-' + randomUUID());
	process.env.GIT_CONFIG_NOSYSTEM = '1';
});
after(() => {
	for (const name of Object.keys(process.env)) { if (name.startsWith('GIT_')) { delete process.env[name]; } }
	Object.assign(process.env, previousGitEnvironment);
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }, initialCommit = true) {
	const root = await mkdtemp(path.join(tmpdir(), 'codetogether-gate-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await git(root, ['init', '--quiet']);
	await git(root, ['config', 'user.name', 'CodeTogether test']);
	await git(root, ['config', 'user.email', 'codetogether-test@example.invalid']);
	await git(root, ['config', 'commit.gpgsign', 'false']);
	if (initialCommit) {
		await writeFile(path.join(root, 'example.ts'), 'export function value() { return 1; }\n');
		await git(root, ['add', 'example.ts']);
		await git(root, ['commit', '--quiet', '-m', 'test baseline']);
	}
	await writeFile(path.join(root, 'example.ts'), source);
	await git(root, ['add', 'example.ts']);
	return root;
}

async function reviewed(root: string, allStaged = true) {
	const context = { label: 'Staged test snapshot', staged: await stagedSnapshot(root, allStaged),
		sources: [{ name: 'example.ts', content: source, language: 'typescript' }] };
	const session = new Session(context);
	session.setQuiz('Understand the return value.', JSON.stringify({ questions: [
		{ id: 'behavior', prompt: 'What value does value() return?' }
	] }));
	session.complete(submission, JSON.stringify({ feedback: 'You identified the return value.',
		concepts: [{ id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }], uncertainties: [] }), 'test');
	return session;
}

suite('Commit review gate (isolated temporary repositories)', () => {
	test('blocks before explicit approval, accepts a demonstrated answer, then invalidates on HEAD change', async t => {
		const root = await fixture(t);
		await installCommitGate(root);
		await assert.rejects(git(root, ['commit', '-m', 'must be blocked']), /commit blocked/);
		const session = await reviewed(root);
		await approveStagedCommit(session, submission);
		const record = path.join(session.context.staged!.gitDir, 'codetogether/approved-snapshot');
		assert.equal(await readFile(record, 'utf8'), session.context.staged!.head + ' ' + session.context.staged!.tree + '\n');
		await git(root, ['commit', '--quiet', '-m', 'reviewed change']);
		assert.notEqual((await stagedSnapshot(root)).head, session.context.staged!.head);
		await assert.rejects(git(root, ['commit', '--allow-empty', '-m', 'old approval is stale']), /commit blocked/);
	});
	test('default approval accepts a submitted quiz with a recorded gap', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const session = await reviewed(root);
		session.complete(uncertainSubmission, JSON.stringify({ feedback: 'You are unsure of the return value.',
			concepts: [{ id: 'behavior', status: 'unexplored' }], uncertainties: [] }), 'test');
		await approveStagedCommit(session, uncertainSubmission);
		await git(root, ['commit', '--quiet', '-m', 'gap recorded']);
	});
	test('strict approval rejects gaps; resubmitting a demonstrated answer can approve', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const session = await reviewed(root);
		session.complete(uncertainSubmission, JSON.stringify({ feedback: 'You are unsure of the return value.',
			concepts: [{ id: 'behavior', status: 'unexplored' }], uncertainties: [] }), 'test');
		await assert.rejects(approveStagedCommit(session, uncertainSubmission, undefined, true), /Every quiz question must show understanding/);
		await assert.rejects(readFile(path.join(session.context.staged!.gitDir, 'codetogether/approved-snapshot')), { code: 'ENOENT' });
		await assert.rejects(git(root, ['commit', '-m', 'gap remains']), /commit blocked/);
		session.complete(submission, JSON.stringify({ feedback: 'You identified the return value.',
			concepts: [{ id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }], uncertainties: [] }), 'test');
		await approveStagedCommit(session, submission, undefined, true);
		await git(root, ['commit', '--quiet', '-m', 'understanding shown']);
	});
	test('strict approval requires every generated question to be demonstrated', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const session = await reviewed(root);
		session.setQuiz('Understand the change.', JSON.stringify({ questions: [
			{ id: 'purpose', prompt: 'Why is value() here?' },
			{ id: 'behavior', prompt: 'What value does it return?' }
		] }));
		const answers = JSON.stringify({ purpose: 'It supplies a value.', behavior: 'It returns 2.' });
		session.complete(answers, JSON.stringify({ feedback: 'The behavior is clear; purpose needs clarification.', concepts: [
			{ id: 'purpose', status: 'discussed' },
			{ id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }
		], uncertainties: [] }), 'test');
		await assert.rejects(approveStagedCommit(session, answers, undefined, true), /Every quiz question must show understanding/);
		await assert.rejects(git(root, ['commit', '-m', 'one gap remains']), /commit blocked/);
	});
	test('a restaged edit invalidates the hook approval and cannot be approved from the stale session', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const session = await reviewed(root); await approveStagedCommit(session, submission);
		await writeFile(path.join(root, 'example.ts'), 'export function value() { return 3; }\n');
		await git(root, ['add', 'example.ts']);
		await assert.rejects(git(root, ['commit', '-m', 'unreviewed stage']), /commit blocked/);
		await assert.rejects(approveStagedCommit(session, submission), /Staged changes or HEAD changed/);
	});
	test('unstaged edits do not contaminate approval, while commit -a cannot introduce them unnoticed', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const session = await reviewed(root); await approveStagedCommit(session, submission);
		await writeFile(path.join(root, 'example.ts'), 'export function value() { return 999; }\n');
		await assert.rejects(git(root, ['commit', '-am', 'unreviewed working tree']), /commit blocked/);
		await git(root, ['commit', '--quiet', '-m', 'only reviewed staged content']);
		assert.equal(await git(root, ['show', 'HEAD:example.ts']), source);
	});
	test('partial commits use their actual temporary index, not the approved full index', async t => {
		const root = await fixture(t); await installCommitGate(root);
		await writeFile(path.join(root, 'other.ts'), 'const other = 1;\n');
		await git(root, ['add', 'other.ts']);
		const session = await reviewed(root); await approveStagedCommit(session, submission);
		await assert.rejects(git(root, ['commit', '--only', 'example.ts', '-m', 'different partial tree']), /commit blocked/);
	});
	test('only all-staged sessions and unchanged submitted answers qualify for approval', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const single = await reviewed(root, false);
		await assert.rejects(approveStagedCommit(single, submission), /ALL staged changes/);
		const session = await reviewed(root);
		await assert.rejects(approveStagedCommit(session, JSON.stringify({ behavior: 'Changed answer' })), /answers have changed/);
		const selection = new Session({ label: 'Selection', sources: session.context.sources });
		await assert.rejects(approveStagedCommit(selection, submission), /Submit every question/);
		const controller = new AbortController(); controller.abort();
		await assert.rejects(approveStagedCommit(session, submission, controller.signal), /cancelled/);
	});
	test('new quizzes and new goals clear eligibility; a failed assessment does not replace a good one', async t => {
		const root = await fixture(t);
		const session = await reviewed(root);
		assert.doesNotThrow(() => session.requireReviewedQuiz(submission));
		assert.throws(() => session.complete(submission, '{}', 'test'), /usable assessment/);
		assert.doesNotThrow(() => session.requireReviewedQuiz(submission));
		session.setQuiz('Another goal', JSON.stringify({ questions: [{ id: 'behavior', prompt: 'What gets returned?' }] }));
		assert.throws(() => session.requireReviewedQuiz(submission), /Submit every question/);
		const other = await reviewed(root); other.complete('New goal', 'Trace the return.', 'goal');
		assert.throws(() => other.requireReviewedQuiz(submission), /Submit every question/);
	});
	test('existing hooks and custom hook-manager configurations are never overwritten', async t => {
		const root = await fixture(t);
		const snapshot = await stagedSnapshot(root);
		const hook = path.join(snapshot.gitDir, 'hooks/pre-commit');
		const original = '#!/bin/sh\nprintf existing-hook\n';
		await writeFile(hook, original, { mode: 0o755 });
		await assert.rejects(installCommitGate(root), /already exists/);
		await assert.rejects(removeCommitGate(root), /left unchanged/);
		assert.equal(await readFile(hook, 'utf8'), original);
		await git(root, ['config', 'core.hooksPath', '.custom-hooks']);
		await assert.rejects(installCommitGate(root), /core.hooksPath/);
		assert.equal(await readFile(hook, 'utf8'), original);
	});
	test('disabling removes only the unchanged owned hook and never attempts a commit', async t => {
		const root = await fixture(t); await installCommitGate(root);
		const before = await stagedSnapshot(root);
		const hook = path.join(before.gitDir, 'hooks/pre-commit');
		assert.equal(await readFile(hook, 'utf8'), await readFile(commitGateHook, 'utf8'));
		await removeCommitGate(root);
		await assert.rejects(readFile(hook), { code: 'ENOENT' });
		assert.equal((await stagedSnapshot(root)).head, before.head);
		await assert.rejects(approveStagedCommit(await reviewed(root), submission), /CodeTogether: Settings/);
	});
	test('linked worktrees share the hook but never inherit another worktree approval', async t => {
		const root = await fixture(t); await installCommitGate(root);
		await approveStagedCommit(await reviewed(root), submission);
		await git(root, ['commit', '--quiet', '-m', 'reviewed change']);
		const linked = path.join(root, 'linked checkout');
		await git(root, ['worktree', 'add', '-b', 'linked-test', linked]);
		const linkedState = await stagedSnapshot(linked);
		assert.notEqual(linkedState.gitDir, (await stagedSnapshot(root)).gitDir);
		await assert.rejects(git(linked, ['commit', '--allow-empty', '-m', 'no linked approval']), /commit blocked/);
	});
	test('symbolic-link hook files are not followed or replaced', { skip: process.platform === 'win32' }, async t => {
		const root = await fixture(t);
		const target = path.join(root, 'user-hook');
		const original = '#!/bin/sh\nexit 0\n';
		await writeFile(target, original);
		await symlink(target, path.join((await stagedSnapshot(root)).gitDir, 'hooks/pre-commit'));
		await assert.rejects(installCommitGate(root), /not a regular file/);
		await assert.rejects(removeCommitGate(root), /not a regular file/);
		assert.equal(await readFile(target, 'utf8'), original);
	});
	test('supports approval before the first commit', async t => {
		const root = await fixture(t, false); await installCommitGate(root);
		const session = await reviewed(root); assert.equal(session.context.staged!.head, 'unborn');
		await approveStagedCommit(session, submission);
		await git(root, ['commit', '--quiet', '-m', 'reviewed first commit']);
	});
});

suite('Commit gate settings consent', () => {
	test('untrusted workspaces and cancelled dialogs cannot change hooks', async () => {
		let trusted = false;
		let accepted = false;
		let installs = 0;
		let removals = 0;
		let gitCalls = 0;
		const errors: string[] = [];
		const sandbox = createContext({ exports: {}, Error, require(name: string) {
			if (name === '../git/client') { return { git: async () => { gitCalls++; return '/test/repository\n'; } }; }
			if (name === '../git/commitGate') { return {
				installCommitGate: async () => { installs++; }, removeCommitGate: async () => { removals++; }
			}; }
			if (name === 'vscode') { return {
				workspace: { get isTrusted() { return trusted; }, workspaceFolders: [{ name: 'test', uri: { fsPath: '/test/repository' } }] },
				window: { showWarningMessage: async (_message: string, _options: object, action: string) => accepted ? action : undefined,
					showInformationMessage: async () => {}, showErrorMessage: async (error: string) => { errors.push(error); } }
			}; }
			throw new Error('Unexpected module: ' + name);
		} });
		runInContext(readFileSync(path.resolve(__dirname, '../commands/commitGate.js'), 'utf8'), sandbox);
		assert.equal(installs, 0); assert.equal(removals, 0);
		await sandbox.exports.configureCommitGate(true);
		assert.equal(installs, 0); assert.equal(gitCalls, 0); assert.match(errors[0], /Trust/);
		trusted = true;
		await sandbox.exports.configureCommitGate(true);
		assert.equal(installs, 0);
		accepted = true;
		await sandbox.exports.configureCommitGate(true);
		assert.equal(installs, 1);
		await sandbox.exports.configureCommitGate(false);
		assert.equal(removals, 1);
	});
});
