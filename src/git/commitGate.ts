import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { git, optionalGit, sameSnapshot, stagedSnapshot } from './client';
import type { StagedSnapshot } from './client';
import type { Session } from '../review/session';

export const commitGateHook = path.resolve(__dirname, '../../hooks/pre-commit');

async function readRegularFile(file: string): Promise<string | undefined> {
	try {
		if (!(await lstat(file)).isFile()) { throw new Error('Refusing to change a hook or approval path that is not a regular file: ' + file); }
		return await readFile(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
		throw error;
	}
}

async function layout(cwd: string) {
	const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
	if (await optionalGit(root, ['config', '--get', 'core.hooksPath']) !== undefined) {
		throw new Error('This repository configures core.hooksPath. CodeTogether left your hook manager unchanged. Automatic integration with hook managers is not supported yet.');
	}
	const common = (await git(root, ['rev-parse', '--git-common-dir'])).trim();
	const hook = path.resolve(root, common, 'hooks/pre-commit');
	try {
		const directory = await lstat(path.dirname(hook));
		if (!directory.isDirectory() || directory.isSymbolicLink()) {
			throw new Error('The Git hooks directory is not a regular directory. It was left unchanged.');
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
	}
	return { root, hook };
}

export async function installCommitGate(cwd: string): Promise<void> {
	const { hook } = await layout(cwd);
	const expected = await readFile(commitGateHook, 'utf8');
	const current = await readRegularFile(hook);
	if (current !== undefined && current !== expected) {
		throw new Error('A pre-commit hook already exists and was left unchanged. Automatic hook chaining is not supported yet.');
	}
	await mkdir(path.dirname(hook), { recursive: true });
	if (current === undefined) { await writeFile(hook, expected, { flag: 'wx', mode: 0o755 }); }
	else { await chmod(hook, 0o755); }
}

export async function isCommitGateEnabled(cwd: string): Promise<boolean> {
	const { hook } = await layout(cwd);
	if (await readRegularFile(hook) !== await readFile(commitGateHook, 'utf8')) { return false; }
	return !!((await lstat(hook)).mode & 0o111);
}

export async function removeCommitGate(cwd: string): Promise<void> {
	const { hook } = await layout(cwd);
	const current = await readRegularFile(hook);
	if (current === undefined) { return; }
	if (current !== await readFile(commitGateHook, 'utf8')) {
		throw new Error('The pre-commit hook is not the unmodified CodeTogether hook. It was left unchanged.');
	}
	await unlink(hook);
}

export async function approveStagedCommit(session: Session, submission: string, signal?: AbortSignal, requireAllQuestions = false): Promise<StagedSnapshot> {
	session.requireReviewedQuiz(submission, requireAllQuestions);
	const reviewed = session.context.staged;
	if (!reviewed?.allStaged) {
		throw new Error('Only a review of ALL staged changes can approve a commit. Run CodeTogether: Open Review, not a selection or single-file review.');
	}
	const { hook } = await layout(reviewed.root);
	if (await readRegularFile(hook) !== await readFile(commitGateHook, 'utf8')) {
		throw new Error('Enable the commit gate first in CodeTogether: Settings.');
	}
	const current = await stagedSnapshot(reviewed.root);
	if (!sameSnapshot(reviewed, current)) { throw new Error('Staged changes or HEAD changed. Start a new review before approving this commit.'); }
	if (signal?.aborted) { throw new Error('Commit approval cancelled.'); }
	const folder = path.join(current.gitDir, 'codetogether');
	await mkdir(folder, { recursive: true, mode: 0o700 });
	if (!(await lstat(folder)).isDirectory() || (await lstat(folder)).isSymbolicLink()) {
		throw new Error('Commit approval storage must be a real directory.');
	}
	const temporary = path.join(folder, 'approval-' + randomUUID());
	try {
		await writeFile(temporary, current.head + ' ' + current.tree + '\n', { flag: 'wx', mode: 0o600 });
		if (signal?.aborted || !sameSnapshot(current, await stagedSnapshot(current.root))) {
			throw new Error('Commit approval cancelled or staged changes changed. Start a new review.');
		}
		await rename(temporary, path.join(folder, 'approved-snapshot'));
	} finally {
		try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
	}
	return current;
}
