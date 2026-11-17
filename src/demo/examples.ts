import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeContext } from '../review/session';

export const demoExamples = [
	{
		id: 'task-list', title: 'Add search and filters to a task list',
		description: 'Find tasks by title and optionally show only incomplete tasks.',
		file: 'task_list.py', test: 'test_task_list.py'
	},
	{
		id: 'checkout', title: 'Add discounts and delivery to a checkout total',
		description: 'Calculate a basket total with a discount and delivery rules.',
		file: 'checkout.py', test: 'test_checkout.py'
	},
	{
		id: 'job-scheduler', title: 'Add retries and dependencies to a job scheduler (Hard)',
		description: 'Schedule background jobs with dependencies, limited workers, and retry delays.',
		file: 'scheduler.py', test: 'test_scheduler.py'
	}
] as const;

export type DemoExample = typeof demoExamples[number];

/** Full-file hunks keep these small before/after snapshots easy to inspect. */
function fileDiff(name: string, before: string, after: string): string {
	const lines = (text: string) => text ? text.trimEnd().split('\n') : [];
	const oldLines = lines(before);
	const newLines = lines(after);
	return [
		`diff --git a/${name} b/${name}`,
		...(before ? [] : ['new file mode 100644']),
		before ? `--- a/${name}` : '--- /dev/null', `+++ b/${name}`,
		`@@ -${oldLines.length ? 1 : 0},${oldLines.length} +1,${newLines.length} @@`,
		...oldLines.map(line => '-' + line), ...newLines.map(line => '+' + line), ''
	].join('\n');
}

export async function loadDemoContext(extensionPath: string, example: DemoExample): Promise<CodeContext> {
	const folder = join(extensionPath, 'demos', example.id);
	const read = async (version: string, name: string) =>
		(await readFile(join(folder, version, name), 'utf8')).replace(/\r\n?/g, '\n');
	const [before, after, tests] = await Promise.all([
		read('before', example.file), read('after', example.file), read('after', example.test)
	]);
	const diff = fileDiff(example.file, before, after) + fileDiff(example.test, '', tests);
	return {
		label: `Demo example: ${example.title}. ${example.description} Bundled Python commit snapshot; no workspace files are included.`,
		demo: { title: example.title, description: example.description },
		diff,
		sources: [
			{ name: example.file, content: after, language: 'python' },
			{ name: example.test, content: tests, language: 'python' }
		],
		changes: [
			{ name: example.file, added: after.trimEnd().split('\n').length, deleted: before.trimEnd().split('\n').length },
			{ name: example.test, added: tests.trimEnd().split('\n').length, deleted: 0 }
		]
	};
}
