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
exports.configureCommitGate = configureCommitGate;
const vscode = __importStar(require("vscode"));
const client_1 = require("../git/client");
const commitGate_1 = require("../git/commitGate");
async function configureCommitGate(enable) {
    try {
        if (!vscode.workspace.isTrusted) {
            throw new Error('Trust this workspace before changing Git hooks.');
        }
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            throw new Error('Open a Git project first.');
        }
        const selected = folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { title: 'Choose the repository for the commit review gate' }))?.folder;
        if (!selected) {
            return;
        }
        const root = (await (0, client_1.git)(selected.uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
        const action = enable ? 'Enable gate' : 'Disable gate';
        const accepted = await vscode.window.showWarningMessage(enable
            ? 'Install a local pre-commit hook for ' + root + '? Commits in this repository and linked worktrees will require explicit approval after a submitted all-staged quiz. Existing hooks are never overwritten.'
            : 'Remove the CodeTogether pre-commit hook for ' + root + '? This also affects linked worktrees. Other hooks are never removed.', { modal: true }, action);
        if (accepted !== action) {
            return;
        }
        if (enable) {
            await (0, commitGate_1.installCommitGate)(root);
        }
        else {
            await (0, commitGate_1.removeCommitGate)(root);
        }
        void vscode.window.showInformationMessage(enable
            ? 'Commit review gate enabled. Run CodeTogether: Open Review to review all staged changes. No commit was attempted.'
            : 'CodeTogether commit review gate disabled. Any approval record remains in Git metadata.');
    }
    catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not change the commit review gate.');
    }
}
//# sourceMappingURL=commitGate.js.map