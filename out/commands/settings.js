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
exports.registerSettingsCommand = registerSettingsCommand;
const vscode = __importStar(require("vscode"));
const llm_1 = require("../models/llm");
const commitGate_1 = require("../git/commitGate");
const modelSettings_1 = require("./modelSettings");
const commitGate_2 = require("./commitGate");
function registerSettingsCommand(context) {
    context.subscriptions.push(vscode.commands.registerCommand('codetogether.settings', async () => {
        while (true) {
            const config = vscode.workspace.getConfiguration('codetogether');
            const provider = config.get('provider', 'ollama');
            const model = provider === 'openai' ? config.get('openaiModel', 'gpt-5-mini') : config.get('model', '');
            const hasKey = !!await context.secrets.get(llm_1.openAIApiKeySecret);
            const strict = config.get('requireAllQuizQuestions', false);
            const folders = vscode.workspace.workspaceFolders;
            let gateDescription = 'Open a Git repository to configure';
            if (folders?.length === 1) {
                try {
                    gateDescription = (await (0, commitGate_1.isCommitGateEnabled)(folders[0].uri.fsPath) ? 'On' : 'Off') + ' for ' + folders[0].name;
                }
                catch {
                    gateDescription = 'Check Git repository or hook configuration';
                }
            }
            else if (folders?.length) {
                gateDescription = 'Choose a repository to enable or disable';
            }
            const settings = [
                { label: 'Model provider and model', description: `${provider === 'openai' ? 'OpenAI' : 'Ollama'} · ${model || 'model not set'}`, setting: 'model' },
                { label: 'OpenAI API key', description: hasKey ? 'Saved in VS Code secret storage' : 'Not set', setting: 'key' },
                { label: 'Commit review gate', description: gateDescription, setting: 'gate' },
                { label: 'Require all quiz questions', description: strict ? 'On · every answer must show understanding' : 'Off · recorded gaps are allowed', setting: 'strict' },
                { label: 'Done', setting: 'done' }
            ];
            const selected = await vscode.window.showQuickPick(settings, {
                title: 'CodeTogether: Settings',
                placeHolder: 'Choose a setting to change',
                ignoreFocusOut: true
            });
            if (!selected || selected.setting === 'done') {
                return;
            }
            if (selected.setting === 'model') {
                await (0, modelSettings_1.chooseModel)(context);
            }
            else if (selected.setting === 'key') {
                const keyAction = await vscode.window.showQuickPick([
                    { label: 'Set OpenAI API key', action: 'set' },
                    { label: 'Remove OpenAI API key', action: 'remove' }
                ], { title: 'OpenAI API key', placeHolder: hasKey ? 'A key is currently saved' : 'No key is saved' });
                if (keyAction?.action === 'set') {
                    await (0, modelSettings_1.setOpenAIKey)(context);
                }
                else if (keyAction?.action === 'remove') {
                    await (0, modelSettings_1.removeOpenAIKey)(context);
                }
            }
            else if (selected.setting === 'gate') {
                const gateAction = await vscode.window.showQuickPick([
                    { label: 'Enable commit review gate', enable: true },
                    { label: 'Disable commit review gate', enable: false }
                ], { title: 'Commit review gate', placeHolder: 'Choose an action for a Git repository' });
                if (gateAction) {
                    await (0, commitGate_2.configureCommitGate)(gateAction.enable);
                }
            }
            else if (selected.setting === 'strict') {
                await config.update('requireAllQuizQuestions', !strict, vscode.ConfigurationTarget.Global);
            }
        }
    }));
}
//# sourceMappingURL=settings.js.map