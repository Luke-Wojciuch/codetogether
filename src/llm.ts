import * as vscode from 'vscode';
import { Message } from './session';
import { readReply } from './stream';
import { assessmentFormat } from './review';

export async function askModel(messages: Message[], signal: AbortSignal, onText: (text: string) => void | Promise<void>, assess = false): Promise<string> {
	const config = vscode.workspace.getConfiguration('codetogether');
	const model = config.get<string>('model');
	if (!model?.trim()) {
		throw new Error('Run CodeTogether: Choose Model first.');
	}
	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST', signal,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: model.trim(), stream: true, think: config.get<boolean>('thinking', false), messages,
			...(assess ? { format: assessmentFormat, options: { temperature: 0 } } : {}) })
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
