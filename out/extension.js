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
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const llm_1 = require("./llm");
const git_1 = require("./git");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "codetogether" is now active!');
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand('codetogether.helloWorld', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('CodeTogether is running!');
        ;
    });
    // Connect this command to the action below.
    const explain = vscode.commands.registerCommand('codetogether.explainChanges', async () => {
        // Ask the developer a question and wait for their answer.
        const answer = await vscode.window.showInputBox({
            title: 'CodeTogether',
            prompt: 'What did you change, and how does it work?',
            placeHolder: 'Explain your changes in your own words...'
        });
        // Stop if they cancel or leave the answer empty.
        if (!answer?.trim()) {
            return;
        }
        // For now, just display their answer.
        vscode.window.showInformationMessage(`Your explanation: ${answer}`);
    });
    const chooseModelCommand = vscode.commands.registerCommand('codetogether.chooseModel', async () => {
        const config = vscode.workspace.getConfiguration('codetogether');
        const model = await vscode.window.showInputBox({
            title: 'Choose your Ollama model',
            prompt: 'Enter a model name from ollama list',
            placeHolder: 'For example: qwen3:4b',
            value: config.get('model') ?? ''
        });
        // Stop if the user cancels or enters nothing.
        if (!model?.trim()) {
            return;
        }
        // Save the choice in the user's settings.
        await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`CodeTogether will use ${model.trim()}`);
    });
    const reviewCommand = vscode.commands.registerCommand('codetogether.openReview', async () => {
        const panel = vscode.window.createWebviewPanel('codetogetherReview', 'CodeTogether Review', vscode.ViewColumn.One, { enableScripts: true });
        // Find UI/review.html inside your extension.
        const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'UI', 'review.html');
        // Listen for the Submit button in your HTML.
        panel.webview.onDidReceiveMessage(async (message) => {
            // Load the staged filenames and line counts.
            if (message?.type === 'loadFiles') {
                try {
                    const files = await (0, git_1.getChangedFiles)();
                    await panel.webview.postMessage({
                        type: 'changedFiles',
                        files
                    });
                }
                catch (error) {
                    await panel.webview.postMessage({
                        type: 'feedback',
                        text: error instanceof Error
                            ? error.message
                            : 'Could not load changed files.'
                    });
                }
                return;
            }
            // Ignore messages that are not explanation submissions.
            if (message?.type !== 'submitExplanation' ||
                typeof message.answer !== 'string') {
                return;
            }
            const answer = message.answer.trim();
            if (!answer) {
                await panel.webview.postMessage({
                    type: 'feedback',
                    text: 'Please enter an explanation first.'
                });
                return;
            }
            await panel.webview.postMessage({
                type: 'feedback',
                text: 'Thinking...'
            });
            // Read the staged diff and ask Ollama for feedback.
            try {
                const diff = await (0, git_1.getStagedDiff)();
                const feedback = await (0, llm_1.askModel)(answer, diff);
                await panel.webview.postMessage({
                    type: 'feedback',
                    text: feedback
                });
            }
            catch (error) {
                await panel.webview.postMessage({
                    type: 'feedback',
                    text: error instanceof Error
                        ? error.message
                        : 'Could not review the changes. Check Git and Ollama.'
                });
            }
        }, undefined, context.subscriptions);
        // Read the HTML file and display it.
        const htmlBytes = await vscode.workspace.fs.readFile(htmlPath);
        panel.webview.html = new TextDecoder().decode(htmlBytes);
    });
    context.subscriptions.push(disposable, explain, reviewCommand, chooseModelCommand);
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map