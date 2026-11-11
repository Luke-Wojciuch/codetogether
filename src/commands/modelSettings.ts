import * as vscode from 'vscode';
import { openAIApiKeySecret } from '../models/llm';

export async function setOpenAIKey(context: vscode.ExtensionContext): Promise<boolean> {
	const key = await vscode.window.showInputBox({
		title: 'Set OpenAI API key', password: true, ignoreFocusOut: true,
		prompt: 'Stored in VS Code secret storage, not settings or this repository. Used only when OpenAI is selected.',
		placeHolder: 'Paste your OpenAI API key',
		validateInput: value => !value.trim() || /\s/.test(value.trim()) ? 'Enter a nonempty API key without whitespace.' : undefined
	});
	if (key === undefined || !key.trim() || /\s/.test(key.trim())) { return false; }
	await context.secrets.store(openAIApiKeySecret, key.trim());
	void vscode.window.showInformationMessage('OpenAI API key saved. No request was sent.');
	return true;
}

export async function removeOpenAIKey(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(openAIApiKeySecret);
	void vscode.window.showInformationMessage('OpenAI API key removed from VS Code secret storage.');
}

export async function chooseModel(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration('codetogether');
	const selected = await vscode.window.showQuickPick([
		{ label: 'Ollama', provider: 'ollama', description: 'Your Ollama model at localhost:11434' },
		{ label: 'OpenAI (GPT)', provider: 'openai', description: 'Cloud API; sends supplied code and conversation to OpenAI' }
	], { title: 'Choose your model provider', placeHolder: 'Ollama or OpenAI (GPT)' });
	if (!selected) { return; }
	const openai = selected.provider === 'openai';
	if (openai && await vscode.window.showWarningMessage(
		'Using OpenAI sends supplied code and conversation to the OpenAI API and may incur API usage charges. Choosing a provider does not send a request.',
		{ modal: true }, 'Use OpenAI') !== 'Use OpenAI') { return; }
	const model = await vscode.window.showInputBox({
		title: openai ? 'Choose your OpenAI model' : 'Choose your Ollama model',
		prompt: openai ? 'Enter a model ID available to your OpenAI API account that supports Responses and structured outputs' : 'Enter an exact model name from ollama list',
		value: openai ? config.get<string>('openaiModel', 'gpt-5-mini') : config.get<string>('model') ?? ''
	});
	if (model?.trim()) {
		if (openai && !await context.secrets.get(openAIApiKeySecret) && !await setOpenAIKey(context)) { return; }
		await config.update(openai ? 'openaiModel' : 'model', model.trim(), vscode.ConfigurationTarget.Global);
		await config.update('provider', selected.provider, vscode.ConfigurationTarget.Global);
	}
}
