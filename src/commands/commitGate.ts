import * as vscode from 'vscode';
import { git } from '../git/client';
import { installCommitGate, removeCommitGate } from '../git/commitGate';

export async function configureCommitGate(enable: boolean): Promise<void> {
	try {
		if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before changing Git hooks.'); }
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) { throw new Error('Open a Git project first.'); }
		const selected = folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(
			folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
			{ title: 'Choose the repository for the commit review gate' }))?.folder;
		if (!selected) { return; }
		const root = (await git(selected.uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
		const action = enable ? 'Enable gate' : 'Disable gate';
		const accepted = await vscode.window.showWarningMessage(enable
			? 'Install a local pre-commit hook for ' + root + '? Commits in this repository and linked worktrees will require explicit approval after a submitted all-staged quiz. Existing hooks are never overwritten.'
			: 'Remove the CodeTogether pre-commit hook for ' + root + '? This also affects linked worktrees. Other hooks are never removed.',
			{ modal: true }, action);
		if (accepted !== action) { return; }
		if (enable) { await installCommitGate(root); }
		else { await removeCommitGate(root); }
		void vscode.window.showInformationMessage(enable
			? 'Commit review gate enabled. Run CodeTogether: Open Review to review all staged changes. No commit was attempted.'
			: 'CodeTogether commit review gate disabled. Any approval record remains in Git metadata.');
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not change the commit review gate.');
	}
}
