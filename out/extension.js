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
const llm_1 = require("./llm");
const git_1 = require("./git");
const session_1 = require("./session");
const review_1 = require("./review");
function activate(context) {
    const snapshots = new Map();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('codetogether-snapshot', {
        provideTextDocumentContent: uri => snapshots.get(uri.toString()) ?? ''
    }));
    async function openReview(selectionMode = false, uri) {
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
                return (0, git_1.getStagedContext)(uri);
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
            if (message?.type === 'init') {
                pending = new AbortController();
                session = undefined;
                try {
                    const code = await capture();
                    if (pending.signal.aborted) {
                        throw new Error('Loading cancelled. Retry to load context.');
                    }
                    session = new session_1.Session(code);
                    await post({ type: 'context', context: code });
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
            const kind = message.kind === 'goal' || message.kind === 'recap' ? message.kind : 'discussion';
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
                let accumulated = '';
                let sent = '';
                const reply = await (0, llm_1.askModel)(session.messages(answer), controller.signal, async (text) => {
                    accumulated += text;
                    const visible = (0, review_1.visibleReply)(accumulated);
                    if (!controller.signal.aborted && visible.length > sent.length) {
                        await post({ type: 'chunk', text: visible.slice(sent.length) });
                        sent = visible;
                    }
                });
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
                        error instanceof Error ? error.message : 'Could not connect to Ollama. Check that it is running.'
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
    context.subscriptions.push(vscode.commands.registerCommand('codetogether.understandCode', () => openReview(true)), vscode.commands.registerCommand('codetogether.helloWorld', () => vscode.window.showInformationMessage('CodeTogether is running!')), vscode.commands.registerCommand('codetogether.chooseModel', async () => {
        const config = vscode.workspace.getConfiguration('codetogether');
        const model = await vscode.window.showInputBox({
            title: 'Choose your Ollama model', prompt: 'Enter an exact model name from ollama list',
            value: config.get('model') ?? ''
        });
        if (model?.trim()) {
            await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
        }
    }));
}
//# sourceMappingURL=extension.js.map