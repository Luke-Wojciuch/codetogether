import * as vscode from 'vscode';

export async function askModel(answer: string): Promise<string> {
	const model = vscode.workspace
		.getConfiguration('codetogether')
		.get<string>('model');

	if (!model?.trim()) {
		throw new Error('Choose an Ollama model in CodeTogether settings.');
	}

	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: model.trim(),
			stream: false,
			messages: [
				{
					role: 'system',
					content:
                    'always return "The model is connected and working." '
						/*'You are a concise coding tutor. Respond to the ' +
						'developer’s explanation with one useful follow-up ' +
						'question. You have not been given the code, so do ' +
						'not claim their explanation is correct or incorrect.'*/
				},
				{
					role: 'user',
					content: answer
				}
			]
		})
	});

	if (!response.ok) {
		throw new Error(
			`Ollama returned ${response.status}. Check that your model is installed.`
		);
	}

	const data = await response.json() as {
		message?: { content?: string };
	};

	if (!data.message?.content) {
		throw new Error('Ollama returned an empty response.');
	}

	return data.message.content;
}