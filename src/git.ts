import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function getStagedDiff(): Promise<string> {
	const folders = vscode.workspace.workspaceFolders;

	if (!folders || folders.length !== 1) {
		throw new Error('Open one Git project folder to review.');
	}

	const { stdout } = await run(
		'git',
		['diff', '--cached', '--no-color', '--no-ext-diff'],
		{
			cwd: folders[0].uri.fsPath,
			maxBuffer: 5 * 1024 * 1024
		}
	);

	if (!stdout.trim()) {
		throw new Error('No staged changes. Stage a file using Source Control first.');
	}

	return stdout;
}

export async function getChangedFiles() {
	const folders = vscode.workspace.workspaceFolders;

	if (!folders || folders.length !== 1) {
		throw new Error('Open one Git project folder.');
	}

	const { stdout } = await run(
		'git',
		['diff', '--cached', '--numstat', '--no-renames'],
		{ cwd: folders[0].uri.fsPath }
	);

	return stdout.trim()
		? stdout.trim().split('\n').map((line) => {
			const [added, removed, ...name] = line.split('\t');

			return {
				name: name.join('\t'),
				added,
				removed
			};
		})
		: [];
}