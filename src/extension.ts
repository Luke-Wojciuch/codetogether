import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { askModel } from './models/llm';
import { getStagedContext } from './git/context';
import { CodeContext, Session } from './review/session';
import { TurnKind } from './review/assessment';
import { assessQuiz, quizAssessmentFormat, quizFormat, requireQuizAnswers } from './review/quiz';
import { quizAssessmentInstructions } from './prompts/assessment';
import { registerSettingsCommand } from './commands/settings';
import { approveStagedCommit } from './git/commitGate';

export function activate(context: vscode.ExtensionContext) {
	registerSettingsCommand(context);
	const snapshots = new Map<string, string>();
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('codetogether-snapshot', {
		provideTextDocumentContent: uri => snapshots.get(uri.toString()) ?? ''
	}));
	async function openReview(selectionMode = false, uri?: vscode.Uri) {
		const requireAllQuestions = () => vscode.workspace.getConfiguration('codetogether').get<boolean>('requireAllQuizQuestions', false);
		let repositoryFolder: vscode.Uri | undefined;
		if (!selectionMode && !uri && (vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
			const selected = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders!.map(folder => ({
				label: folder.name, description: folder.uri.fsPath, folder
			})), { title: 'Choose the repository to review all staged changes' });
			if (!selected) { return; }
			repositoryFolder = selected.folder.uri;
		}
		const editor = vscode.window.activeTextEditor;
		if (selectionMode && (!editor || editor.selection.isEmpty)) {
			void vscode.window.showInformationMessage('Select the code you want to work through first.');
			return;
		}
		// Capture the original document and range before opening the panel.
		const document = selectionMode ? editor!.document : undefined;
		const selection = selectionMode ? editor!.selection : undefined;
		const capture = async (): Promise<CodeContext> => {
			if (!document || !selection) {
				return getStagedContext(uri, repositoryFolder);
			}
			if (document.isClosed) {
				throw new Error('The source document was closed. Start again from a selection.');
			}
			const start = Math.max(0, selection.start.line - 40);
			const end = Math.min(document.lineCount - 1, selection.end.line + 40);
			const content = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
			if (content.length > 100_000) {
				throw new Error('Selection is too large. Select a smaller region.');
			}
			return {
				label: `Editor snapshot: selected lines ${selection.start.line + 1}-${selection.end.line + 1}, with up to 40 surrounding lines on each side; other files are not included`,
				sources: [{ name: vscode.workspace.asRelativePath(document.uri), content, language: document.languageId, startLine: start + 1 }]
			};
		};
		const panel = vscode.window.createWebviewPanel('codetogetherReview', 'CodeTogether', vscode.ViewColumn.Beside, {
			enableScripts: true, retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'UI')]
		});
		let session: Session | undefined;
		let pending: AbortController | undefined;
		const snapshotUris: string[] = [];
		const post = (message: object) => panel.webview.postMessage(message);
		const policyListener = vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('codetogether.requireAllQuizQuestions')) {
				void post({ type: 'commit-gate-policy', requireAllQuestions: requireAllQuestions() });
			}
		});
		const listener = panel.webview.onDidReceiveMessage(async message => {
			if (message?.type === 'cancel') {
				pending?.abort();
				return;
			}
			if (message?.type === 'reference' && session) {
				const source = session.reference(message.sourceId, message.line, message.endLine);
				if (source) {
					// Open supplied content, never a model-provided URI or a changed working-tree file.
					const uri = vscode.Uri.from({ scheme: 'codetogether-snapshot', path: `/${randomBytes(8).toString('hex')}/${source.name}` });
					snapshots.set(uri.toString(), source.content);
					snapshotUris.push(uri.toString());
					const snapshot = await vscode.workspace.openTextDocument(uri);
					const row = message.line - (source.startLine ?? 1);
					const lastRow = (message.endLine ?? message.line) - (source.startLine ?? 1);
					await vscode.window.showTextDocument(snapshot, {
						viewColumn: vscode.ViewColumn.One, preview: true,
						selection: new vscode.Range(row, 0, lastRow, snapshot.lineAt(lastRow).text.length)
					});
				}
				return;
			}
			if (pending) {
				return;
			}
			if (message?.type === 'approve-commit') {
				const controller = new AbortController();
				pending = controller;
				try {
					if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before approving commits.'); }
					if (!session || typeof message.answers !== 'string') { throw new Error('Load and submit a review quiz first.'); }
					await approveStagedCommit(session, message.answers, controller.signal, requireAllQuestions());
					await post({ type: 'commit-approved', text: 'This staged snapshot is approved. Retry your Git commit; no commit or push was made by CodeTogether.' });
				} catch (error) {
					await post({ type: 'commit-approval-error', text: error instanceof Error ? error.message : 'Could not approve this staged snapshot.' });
				} finally { pending = undefined; }
				return;
			}
			if (message?.type === 'init') {
				pending = new AbortController();
				session = undefined;
				try {
					const code = await capture();
					if (pending.signal.aborted) {
						throw new Error('Loading cancelled. Retry to load context.');
					}
					session = new Session(code);
					await post({ type: 'context', context: code, requireAllQuestions: requireAllQuestions() });
				} catch (error) {
					await post({ type: 'error', text: error instanceof Error ? error.message : 'Could not load code.' });
				} finally {
					pending = undefined;
				}
				return;
			}
			if (message?.type !== 'send' || typeof message.text !== 'string' || !message.text.trim()) {
				return;
			}
			const answer = message.text.trim();
			const kind: TurnKind = message.kind === 'goal' || message.kind === 'recap' || message.kind === 'test' || message.kind === 'quiz' ? message.kind : 'discussion';
			const controller = new AbortController();
			pending = controller;
			const timeout = setTimeout(() => controller.abort(), 120_000);
			try {
				if (!session) {
					throw new Error('Load the code context before sending.');
				}
				const current = await capture();
				if (controller.signal.aborted) {
					throw new Error('Request cancelled or timed out.');
				}
				if (JSON.stringify(current) !== JSON.stringify(session.context)) {
					throw new Error('Code context changed. Start a new session to use the updated code.');
				}
				const activeSession = session;
				if (kind === 'quiz') {
					const raw = await askModel(session.messages(answer, 'quiz'), controller.signal, () => {}, quizFormat, context.secrets);
					if (controller.signal.aborted) { throw new Error('Request cancelled or timed out.'); }
					const quiz = session.setQuiz(answer, raw);
					await post({ type: 'quiz', ...quiz });
					return;
				}
				if (kind === 'test') {
					if (!session.quiz) { throw new Error('Generate a review quiz before submitting answers.'); }
					requireQuizAnswers(answer, session.quiz.questions);
				}
				const reply = kind === 'test' ? await assessQuiz(activeSession.quiz!, answer, async (question, areaAnswer) => {
					const messages = activeSession.messages(JSON.stringify({ goal: activeSession.quiz!.goal, question, answer: areaAnswer }), 'test');
					messages[0].content = quizAssessmentInstructions + '\nRequired JSON schema: ' + JSON.stringify(quizAssessmentFormat);
					return askModel(messages, controller.signal, () => {}, quizAssessmentFormat, context.secrets);
				}) : await askModel(session.messages(answer, kind), controller.signal, () => {}, false, context.secrets);
				if (controller.signal.aborted) {
					throw new Error('Request cancelled or timed out.');
				}
				const text = session.complete(answer, reply, kind);
				await post({ type: 'reply', text, assessment: session.assessment });
			} catch (error) {
				await post({
					type: 'error',
					text: controller.signal.aborted ? 'Request cancelled or timed out. You can retry.' :
						error instanceof Error ? error.message : 'Could not connect to the model provider. Check your model configuration.'
				});
			} finally {
				clearTimeout(timeout);
				pending = undefined;
			}
		});
		panel.onDidDispose(() => {
			pending?.abort();
			listener.dispose();
			policyListener.dispose();
			for (const uri of snapshotUris) { snapshots.delete(uri); }
		});
		const ui = vscode.Uri.joinPath(context.extensionUri, 'UI');
		const html = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ui, 'review.html'));
		panel.webview.html = new TextDecoder().decode(html)
			.replaceAll('{{nonce}}', randomBytes(16).toString('hex'))
			.replaceAll('{{cspSource}}', panel.webview.cspSource)
			.replaceAll('{{styleUri}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(ui, 'review.css')).toString())
			.replaceAll('{{scriptUri}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(ui, 'review.js')).toString());
	}

	for (const id of ['codetogether.openReview', 'codetogether.explainChanges']) {
		context.subscriptions.push(vscode.commands.registerCommand(id, (resource?: vscode.Uri | { resourceUri: vscode.Uri }) =>
			openReview(false, resource instanceof vscode.Uri ? resource : resource?.resourceUri)));
	}
	context.subscriptions.push(vscode.commands.registerCommand('codetogether.understandCode', () => openReview(true)));
}
