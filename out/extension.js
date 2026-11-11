"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const llm_1 = require("./models/llm");
const context_1 = require("./git/context");
const session_1 = require("./review/session");
const quiz_1 = require("./review/quiz");
const assessment_1 = require("./prompts/assessment");
const settings_1 = require("./commands/settings");
const commitGate_1 = require("./git/commitGate");
function activate(context) {
    (0, settings_1.registerSettingsCommand)(context);
    const snapshots = new Map();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('codetogether-snapshot', {
        provideTextDocumentContent: uri => snapshots.get(uri.toString()) ?? ''
    }));
    async function openReview(selectionMode = false, uri) {
        const requireAllQuestions = () => vscode.workspace.getConfiguration('codetogether').get('requireAllQuizQuestions', false);
        let repositoryFolder;
        if (!selectionMode && !uri && (vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
            const selected = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders.map(folder => ({
                label: folder.name, description: folder.uri.fsPath, folder
            })), { title: 'Choose the repository to review all staged changes' });
            if (!selected) {
                return;
            }
            repositoryFolder = selected.folder.uri;
        }
        const editor = vscode.window.activeTextEditor;
        if (selectionMode && (!editor || editor.selection.isEmpty)) {
            void vscode.window.showInformationMessage('Select the code you want to work through first.');
            return;
        }
        // Capture the original document and range before opening the panel.
        const document = selectionMode ? editor.document : undefined;
        const selection = selectionMode ? editor.selection : undefined;
        const capture = async () => {
            if (!document || !selection) {
                return (0, context_1.getStagedContext)(uri, repositoryFolder);
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
        let session;
        let pending;
        const snapshotUris = [];
        const post = (message) => panel.webview.postMessage(message);
        const policyListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('codetogether.requireAllQuizQuestions')) {
                void post({ type: 'commit-gate-policy', requireAllQuestions: requireAllQuestions() });
            }
        });
        const listener = panel.webview.onDidReceiveMessage(async (message) => {
            if (message?.type === 'cancel') {
                pending?.abort();
                return;
            }
            if (message?.type === 'reference' && session) {
                const source = session.reference(message.sourceId, message.line, message.endLine);
                if (source) {
                    // Open supplied content, never a model-provided URI or a changed working-tree file.
                    const uri = vscode.Uri.from({ scheme: 'codetogether-snapshot', path: `/${(0, node_crypto_1.randomBytes)(8).toString('hex')}/${source.name}` });
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
                    if (!vscode.workspace.isTrusted) {
                        throw new Error('Trust this workspace before approving commits.');
                    }
                    if (!session || typeof message.answers !== 'string') {
                        throw new Error('Load and submit a review quiz first.');
                    }
                    await (0, commitGate_1.approveStagedCommit)(session, message.answers, controller.signal, requireAllQuestions());
                    await post({ type: 'commit-approved', text: 'This staged snapshot is approved. Retry your Git commit; no commit or push was made by CodeTogether.' });
                }
                catch (error) {
                    await post({ type: 'commit-approval-error', text: error instanceof Error ? error.message : 'Could not approve this staged snapshot.' });
                }
                finally {
                    pending = undefined;
                }
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
                    session = new session_1.Session(code);
                    await post({ type: 'context', context: code, requireAllQuestions: requireAllQuestions() });
                }
                catch (error) {
                    await post({ type: 'error', text: error instanceof Error ? error.message : 'Could not load code.' });
                }
                finally {
                    pending = undefined;
                }
                return;
            }
            if (message?.type !== 'send' || typeof message.text !== 'string' || !message.text.trim()) {
                return;
            }
            const answer = message.text.trim();
            const kind = message.kind === 'goal' || message.kind === 'recap' || message.kind === 'test' || message.kind === 'quiz' ? message.kind : 'discussion';
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
                    const raw = await (0, llm_1.askModel)(session.messages(answer, 'quiz'), controller.signal, () => { }, quiz_1.quizFormat, context.secrets);
                    if (controller.signal.aborted) {
                        throw new Error('Request cancelled or timed out.');
                    }
                    const quiz = session.setQuiz(answer, raw);
                    await post({ type: 'quiz', ...quiz });
                    return;
                }
                if (kind === 'test') {
                    if (!session.quiz) {
                        throw new Error('Generate a review quiz before submitting answers.');
                    }
                    (0, quiz_1.requireQuizAnswers)(answer, session.quiz.questions);
                }
                const reply = kind === 'test' ? await (0, quiz_1.assessQuiz)(activeSession.quiz, answer, async (question, areaAnswer) => {
                    const messages = activeSession.messages(JSON.stringify({ goal: activeSession.quiz.goal, question, answer: areaAnswer }), 'test');
                    messages[0].content = assessment_1.quizAssessmentInstructions + '\nRequired JSON schema: ' + JSON.stringify(quiz_1.quizAssessmentFormat);
                    return (0, llm_1.askModel)(messages, controller.signal, () => { }, quiz_1.quizAssessmentFormat, context.secrets);
                }) : await (0, llm_1.askModel)(session.messages(answer, kind), controller.signal, () => { }, false, context.secrets);
                if (controller.signal.aborted) {
                    throw new Error('Request cancelled or timed out.');
                }
                const text = session.complete(answer, reply, kind);
                await post({ type: 'reply', text, assessment: session.assessment });
            }
            catch (error) {
                await post({
                    type: 'error',
                    text: controller.signal.aborted ? 'Request cancelled or timed out. You can retry.' :
                        error instanceof Error ? error.message : 'Could not connect to the model provider. Check your model configuration.'
                });
            }
            finally {
                clearTimeout(timeout);
                pending = undefined;
            }
        });
        panel.onDidDispose(() => {
            pending?.abort();
            listener.dispose();
            policyListener.dispose();
            for (const uri of snapshotUris) {
                snapshots.delete(uri);
            }
        });
        const ui = vscode.Uri.joinPath(context.extensionUri, 'UI');
        const html = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ui, 'review.html'));
        panel.webview.html = new TextDecoder().decode(html)
            .replaceAll('{{nonce}}', (0, node_crypto_1.randomBytes)(16).toString('hex'))
            .replaceAll('{{cspSource}}', panel.webview.cspSource)
            .replaceAll('{{styleUri}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(ui, 'review.css')).toString())
            .replaceAll('{{scriptUri}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(ui, 'review.js')).toString());
    }
    for (const id of ['codetogether.openReview', 'codetogether.explainChanges']) {
        context.subscriptions.push(vscode.commands.registerCommand(id, (resource) => openReview(false, resource instanceof vscode.Uri ? resource : resource?.resourceUri)));
    }
    context.subscriptions.push(vscode.commands.registerCommand('codetogether.understandCode', () => openReview(true)));
}
//# sourceMappingURL=extension.js.map