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
exports.getStagedDiff = getStagedDiff;
exports.getChangedFiles = getChangedFiles;
const vscode = __importStar(require("vscode"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function getStagedDiff() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length !== 1) {
        throw new Error('Open one Git project folder to review.');
    }
    const { stdout } = await run('git', ['diff', '--cached', '--no-color', '--no-ext-diff'], {
        cwd: folders[0].uri.fsPath,
        maxBuffer: 5 * 1024 * 1024
    });
    if (!stdout.trim()) {
        throw new Error('No staged changes. Stage a file using Source Control first.');
    }
    return stdout;
}
async function getChangedFiles() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length !== 1) {
        throw new Error('Open one Git project folder.');
    }
    const { stdout } = await run('git', ['diff', '--cached', '--numstat', '--no-renames'], { cwd: folders[0].uri.fsPath });
    return stdout.trim()
        ? stdout.trim().split('\n').map((line) => {
            const [added, removed, ...name] = line.split('\t');
            return {
                name: name.join('\t'),
                added,
                removed
            };
        })
        : [];
}
//# sourceMappingURL=git.js.map