// Ollama sends newline-delimited JSON; network chunks may split lines or UTF-8 characters.
export async function readReply(body: NonNullable<Response['body']>, onText: (text: string) => void | Promise<void>): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let reply = '';
	let complete = false;
	async function consume(line: string) {
		if (!line.trim()) { return; }
		const data = JSON.parse(line) as { error?: string; done?: boolean; message?: { content?: string } };
		if (data.error) { throw new Error(`Ollama: ${data.error}`); }
		if (typeof data.message?.content === 'string' && data.message.content) {
			reply += data.message.content;
			await onText(data.message.content);
		}
		complete = data.done === true;
	}
	try {
		while (!complete) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let newline;
			while (!complete && (newline = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				await consume(line);
			}
			if (done) {
				if (!complete) { await consume(buffer); }
				break;
			}
		}
		if (!complete) { throw new Error('Ollama response was interrupted. You can retry.'); }
		if (!reply.trim()) { throw new Error('Ollama returned an empty response.'); }
		return reply;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
