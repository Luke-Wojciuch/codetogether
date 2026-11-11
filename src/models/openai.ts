import type { Message } from '../review/session';

// OpenAI strict schemas require every property. Preserve optional fields as nullable
// without changing the schemas used by Ollama or the application's validators.
export function openAISchema(schema: object): Record<string, unknown> {
	const result = { ...schema } as Record<string, unknown>;
	if (result.properties && typeof result.properties === 'object') {
		const required = Array.isArray(result.required) ? result.required : [];
		const properties = Object.entries(result.properties).map(([name, child]): [string, Record<string, unknown>] => {
			const converted = openAISchema(child as object);
			return [name, required.includes(name) ? converted : { anyOf: [converted, { type: 'null' }] }];
		});
		result.properties = Object.fromEntries(properties);
		result.required = properties.map(([name]) => name);
		result.additionalProperties = false;
	}
	if (result.items && typeof result.items === 'object') { result.items = openAISchema(result.items); }
	return result;
}

interface OpenAIResponse {
	status?: string;
	output?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

export async function askOpenAI(messages: Message[], model: string, apiKey: string, signal: AbortSignal,
	onText: (text: string) => void | Promise<void>, schema?: object): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST', signal,
		headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
		body: JSON.stringify({ model, input: messages, stream: false, store: false,
			...(schema ? { text: { format: { type: 'json_schema', name: 'codetogether_review', strict: true, schema: openAISchema(schema) } } } : {}) })
	}).catch(error => {
		if (signal.aborted) { throw error; }
		throw new Error('Could not reach OpenAI. Check your network connection.');
	});
	// Do not echo arbitrary API errors: they can contain submitted data or credentials.
	if (!response.ok) {
		if (response.status === 401) { throw new Error('OpenAI rejected the API key. Open CodeTogether: Settings to replace it.'); }
		if (response.status === 403 || response.status === 404) { throw new Error('OpenAI model access was denied or the model was not found. Open CodeTogether: Settings and check your API account access.'); }
		if (response.status === 429) { throw new Error('OpenAI rate or quota limit reached. Check your API billing and limits, then retry.'); }
		throw new Error('OpenAI returned HTTP ' + response.status + '. Check the model supports the Responses API and structured output, then retry.');
	}
	const value = await response.json() as OpenAIResponse;
	if (signal.aborted) { throw new Error('Request cancelled or timed out.'); }
	if (value.status !== 'completed' || !Array.isArray(value.output)) {
		throw new Error('OpenAI did not complete the response. Your draft is saved; retry.');
	}
	const content = value.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
	if (content.some(item => item.type === 'refusal')) {
		throw new Error('OpenAI declined this request. Your draft is saved; try a different scope or question.');
	}
	const text = content.filter(item => item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
	if (!text.trim()) { throw new Error('OpenAI returned an empty response. Your draft is saved; retry.'); }
	await onText(text);
	return text;
}
