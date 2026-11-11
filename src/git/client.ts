import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface StagedSnapshot {
	root: string;
	gitDir: string;
	head: string;
	tree: string;
	allStaged: boolean;
}

export async function git(cwd: string, args: string[]): Promise<string> {
	return (await run('git', args, { cwd, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', timeout: 10_000 })).stdout;
}

export async function optionalGit(cwd: string, args: string[]): Promise<string | undefined> {
	try { return await git(cwd, args); }
	catch (error) {
		if ((error as { code?: unknown }).code === 1) { return undefined; }
		throw error;
	}
}

export async function stagedSnapshot(cwd: string, allStaged = true): Promise<StagedSnapshot> {
	const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
	const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
	const head = (await optionalGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.trim() ?? 'unborn';
	const tree = (await git(root, ['write-tree'])).trim();
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree) ||
		!/^(?:unborn|[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) {
		throw new Error('Could not identify the staged Git snapshot.');
	}
	return { root, gitDir, head, tree, allStaged };
}

export function sameSnapshot(left: StagedSnapshot, right: StagedSnapshot): boolean {
	return left.root === right.root && left.gitDir === right.gitDir && left.head === right.head && left.tree === right.tree;
}
