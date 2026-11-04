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
exports.askModel = askModel;
const vscode = __importStar(require("vscode"));
const stream_1 = require("./stream");
async function askModel(messages, signal, onText) {
    const config = vscode.workspace.getConfiguration('codetogether');
    const model = config.get('model');
    if (!model?.trim()) {
        throw new Error('Run CodeTogether: Choose Model first.');
    }
    const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.trim(), stream: true, think: config.get('thinking', false), messages })
    }).catch(error => {
        if (signal.aborted) {
            throw error;
        }
        throw new Error('Could not reach Ollama at localhost:11434. Check that Ollama is running.');
    });
    if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}. Check your model and context size.`);
    }
    if (!response.body) {
        throw new Error('Ollama returned no response body.');
    }
    return (0, stream_1.readReply)(response.body, onText);
}
//# sourceMappingURL=llm.js.map