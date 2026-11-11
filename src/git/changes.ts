import { FileChange } from '../review/session';

// Used with --numstat -z --no-renames so paths (including tabs/newlines) stay literal.
export function parseNumstat(output: string): FileChange[] {
	return output.split('\0').filter(Boolean).map(record => {
		const first = record.indexOf('\t');
		const second = record.indexOf('\t', first + 1);
		return {
			name: record.slice(second + 1),
			added: record.slice(0, first) === '-' ? null : Number(record.slice(0, first)),
			deleted: record.slice(first + 1, second) === '-' ? null : Number(record.slice(first + 1, second))
		};
	});
}
