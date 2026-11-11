import * as vscode from 'vscode';
import { Message } from '../review/session';
import { readReply } from './stream';
import { assessmentFormat } from '../review/assessment';
import { askOpenAI } from './openai';

export const openAIApiKeySecret = 'codetogether.openaiApiKey';

export async function askModel(messages: Message[], signal: AbortSignal, onText: (text: string) => void | Promise<void>,
	structured: boolean | object = false, secrets?: Pick<vscode.SecretStorage, 'get'>): Promise<string> {
	const config = vscode.workspace.getConfiguration('codetogether');
	const provider = config.get<string>('provider', 'ollama');
	if (provider === 'openai') {
		const model = config.get<string>('openaiModel', 'gpt-5-mini').trim();
		if (!model) { throw new Error('Open CodeTogether: Settings and choose a model first.'); }
		const apiKey = (await secrets?.get(openAIApiKeySecret))?.trim();
		if (!apiKey) { throw new Error('Open CodeTogether: Settings and set an OpenAI API key first.'); }
		if (signal.aborted) { throw new Error('Request cancelled or timed out.'); }
		return askOpenAI(messages, model, apiKey, signal, onText, structured ? structured === true ? assessmentFormat : structured : undefined);
	}
	if (provider && provider !== 'ollama') { throw new Error('Unknown model provider. Open CodeTogether: Settings.'); }
	const model = config.get<string>('model');
	if (!model?.trim()) {
		throw new Error('Open CodeTogether: Settings and choose a model first.');
	}
	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST', signal,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: model.trim(), stream: true, think: config.get<boolean>('thinking', false), messages,
			...(structured ? { format: structured === true ? assessmentFormat : structured, options: { temperature: 0 } } : {}) })
	}).catch(error => {
		if (signal.aborted) { throw error; }
		throw new Error('Could not reach Ollama at localhost:11434. Check that Ollama is running.');
	});
	if (!response.ok) {
		throw new Error(`Ollama returned ${response.status}. Check your model and context size.`);
	}
	if (!response.body) {
		throw new Error('Ollama returned no response body.');
	}
	return readReply(response.body, onText);
}
