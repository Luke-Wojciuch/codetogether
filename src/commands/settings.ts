import * as vscode from 'vscode';
import { openAIApiKeySecret } from '../models/llm';
import { isCommitGateEnabled } from '../git/commitGate';
import { chooseModel, removeOpenAIKey, setOpenAIKey } from './modelSettings';
import { configureCommitGate } from './commitGate';

type Setting = 'model' | 'key' | 'gate' | 'strict' | 'done';

export function registerSettingsCommand(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('codetogether.settings', async () => {
		while (true) {
			const config = vscode.workspace.getConfiguration('codetogether');
			const provider = config.get<string>('provider', 'ollama');
			const model = provider === 'openai' ? config.get<string>('openaiModel', 'gpt-5-mini') : config.get<string>('model', '');
			const hasKey = !!await context.secrets.get(openAIApiKeySecret);
			const strict = config.get<boolean>('requireAllQuizQuestions', false);
			const folders = vscode.workspace.workspaceFolders;
			let gateDescription = 'Open a Git repository to configure';
			if (folders?.length === 1) {
				try { gateDescription = (await isCommitGateEnabled(folders[0].uri.fsPath) ? 'On' : 'Off') + ' for ' + folders[0].name; }
				catch { gateDescription = 'Check Git repository or hook configuration'; }
			} else if (folders?.length) { gateDescription = 'Choose a repository to enable or disable'; }
			const settings: Array<vscode.QuickPickItem & { setting: Setting }> = [
				{ label: 'Model provider and model', description: `${provider === 'openai' ? 'OpenAI' : 'Ollama'} · ${model || 'model not set'}`, setting: 'model' },
				{ label: 'OpenAI API key', description: hasKey ? 'Saved in VS Code secret storage' : 'Not set', setting: 'key' },
				{ label: 'Commit review gate', description: gateDescription, setting: 'gate' },
				{ label: 'Require all quiz questions', description: strict ? 'On · every answer must show understanding' : 'Off · recorded gaps are allowed', setting: 'strict' },
				{ label: 'Done', setting: 'done' }
			];
			const selected = await vscode.window.showQuickPick(settings, {
				title: 'CodeTogether: Settings',
				placeHolder: 'Choose a setting to change',
				ignoreFocusOut: true
			});
			if (!selected || selected.setting === 'done') { return; }
			if (selected.setting === 'model') {
				await chooseModel(context);
			} else if (selected.setting === 'key') {
				const keyAction = await vscode.window.showQuickPick([
					{ label: 'Set OpenAI API key', action: 'set' },
					{ label: 'Remove OpenAI API key', action: 'remove' }
				], { title: 'OpenAI API key', placeHolder: hasKey ? 'A key is currently saved' : 'No key is saved' });
				if (keyAction?.action === 'set') { await setOpenAIKey(context); }
				else if (keyAction?.action === 'remove') { await removeOpenAIKey(context); }
			} else if (selected.setting === 'gate') {
				const gateAction = await vscode.window.showQuickPick([
					{ label: 'Enable commit review gate', enable: true },
					{ label: 'Disable commit review gate', enable: false }
				], { title: 'Commit review gate', placeHolder: 'Choose an action for a Git repository' });
				if (gateAction) { await configureCommitGate(gateAction.enable); }
			} else if (selected.setting === 'strict') {
				await config.update('requireAllQuizQuestions', !strict, vscode.ConfigurationTarget.Global);
			}
		}
	}));
}
