import * as vscode from 'vscode';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodeContext } from './session';
import { parseNumstat } from './changes';

const run = promisify(execFile);

export async function getStagedContext(uri?: vscode.Uri): Promise<CodeContext> {
	const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
	if (!folder || (!uri && vscode.workspace.workspaceFolders?.length !== 1)) {
		throw new Error('Open one Git project, or start from a specific Source Control file.');
	}
	const git = async (args: string[]) => (await run('git', args, {
		cwd: folder.uri.fsPath, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', timeout: 10_000
	})).stdout;
	const root = (await git(['rev-parse', '--show-toplevel'])).trim();
	const scope = uri ? [path.relative(root, uri.fsPath).replace(/\\/g, '/')] : [];
	const diff = await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--function-context', '--', ...scope]);
	if (!diff.trim()) {
		throw new Error('No staged changes in this scope. Stage a change or select code in the editor.');
	}
	const names = (await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMT', '--', ...scope])).split('\0').filter(Boolean);
	const changes = parseNumstat(await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--', ...scope]));
	const sources = [];
	let size = diff.length;
	for (const name of names) {
		const content = await git(['-C', root, 'show', `:${name}`]);
		size += content.length;
		if (size > 100_000) {
			throw new Error('Changes are too large. Start from one staged file or select code in the editor.');
		}
		if (!content.includes('\0')) {
			sources.push({ name, content, language: 'plaintext' });
		}
	}
	return { label: 'Staged snapshot (not working-tree files); deleted/binary content may only appear in the diff', diff, sources, changes };
}
