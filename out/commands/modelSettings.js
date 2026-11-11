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
exports.setOpenAIKey = setOpenAIKey;
exports.removeOpenAIKey = removeOpenAIKey;
exports.chooseModel = chooseModel;
const vscode = __importStar(require("vscode"));
const llm_1 = require("../models/llm");
async function setOpenAIKey(context) {
    const key = await vscode.window.showInputBox({
        title: 'Set OpenAI API key', password: true, ignoreFocusOut: true,
        prompt: 'Stored in VS Code secret storage, not settings or this repository. Used only when OpenAI is selected.',
        placeHolder: 'Paste your OpenAI API key',
        validateInput: value => !value.trim() || /\s/.test(value.trim()) ? 'Enter a nonempty API key without whitespace.' : undefined
    });
    if (key === undefined || !key.trim() || /\s/.test(key.trim())) {
        return false;
    }
    await context.secrets.store(llm_1.openAIApiKeySecret, key.trim());
    void vscode.window.showInformationMessage('OpenAI API key saved. No request was sent.');
    return true;
}
async function removeOpenAIKey(context) {
    await context.secrets.delete(llm_1.openAIApiKeySecret);
    void vscode.window.showInformationMessage('OpenAI API key removed from VS Code secret storage.');
}
async function chooseModel(context) {
    const config = vscode.workspace.getConfiguration('codetogether');
    const selected = await vscode.window.showQuickPick([
        { label: 'Ollama', provider: 'ollama', description: 'Your Ollama model at localhost:11434' },
        { label: 'OpenAI (GPT)', provider: 'openai', description: 'Cloud API; sends supplied code and conversation to OpenAI' }
    ], { title: 'Choose your model provider', placeHolder: 'Ollama or OpenAI (GPT)' });
    if (!selected) {
        return;
    }
    const openai = selected.provider === 'openai';
    if (openai && await vscode.window.showWarningMessage('Using OpenAI sends supplied code and conversation to the OpenAI API and may incur API usage charges. Choosing a provider does not send a request.', { modal: true }, 'Use OpenAI') !== 'Use OpenAI') {
        return;
    }
    const model = await vscode.window.showInputBox({
        title: openai ? 'Choose your OpenAI model' : 'Choose your Ollama model',
        prompt: openai ? 'Enter a model ID available to your OpenAI API account that supports Responses and structured outputs' : 'Enter an exact model name from ollama list',
        value: openai ? config.get('openaiModel', 'gpt-5-mini') : config.get('model') ?? ''
    });
    if (model?.trim()) {
        if (openai && !await context.secrets.get(llm_1.openAIApiKeySecret) && !await setOpenAIKey(context)) {
            return;
        }
        await config.update(openai ? 'openaiModel' : 'model', model.trim(), vscode.ConfigurationTarget.Global);
        await config.update('provider', selected.provider, vscode.ConfigurationTarget.Global);
    }
}
//# sourceMappingURL=modelSettings.js.map