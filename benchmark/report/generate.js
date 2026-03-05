"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReport = generateReport;
const handlebars_1 = __importDefault(require("handlebars"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Pricing per million tokens (USD) - claude-sonnet-4-6
const PRICING = { input: 3.0, output: 15.0 };
function calcCost(inputTokens, outputTokens) {
    return (inputTokens / 1_000_000) * PRICING.input + (outputTokens / 1_000_000) * PRICING.output;
}
function generateReport(results, outputPath) {
    const templateSrc = fs_1.default.readFileSync(path_1.default.join(__dirname, 'template.html'), 'utf8');
    handlebars_1.default.registerHelper('ifCond', function (v1, v2, options) {
        return v1 === v2 ? options.fn(this) : options.inverse(this);
    });
    const template = handlebars_1.default.compile(templateSrc);
    const claudeOnly = results.find(r => r.mode === 'claude-only');
    const hybrid = results.find(r => r.mode === 'hybrid');
    const claudeOnlyCost = calcCost(claudeOnly.claudeInputTokens, claudeOnly.claudeOutputTokens);
    const hybridCost = calcCost(hybrid.claudeInputTokens, hybrid.claudeOutputTokens);
    const savedDollars = claudeOnlyCost - hybridCost;
    const savingsPct = claudeOnlyCost > 0
        ? ((savedDollars / claudeOnlyCost) * 100).toFixed(1)
        : '0.0';
    const modes = [
        {
            mode: 'claude-only',
            claudeInputTokens: claudeOnly.claudeInputTokens.toLocaleString(),
            claudeOutputTokens: claudeOnly.claudeOutputTokens.toLocaleString(),
            cost: claudeOnlyCost.toFixed(4),
            badgeClass: 'badge-red',
            best: false,
            savingsClass: 'red',
            savingsLabel: 'baseline',
        },
        {
            mode: 'hybrid',
            claudeInputTokens: hybrid.claudeInputTokens.toLocaleString(),
            claudeOutputTokens: hybrid.claudeOutputTokens.toLocaleString(),
            cost: hybridCost.toFixed(4),
            badgeClass: 'badge-yellow',
            best: true,
            savingsClass: 'green',
            savingsLabel: `−${savingsPct}% ($${savedDollars.toFixed(4)} saved)`,
        },
        {
            mode: 'local-only',
            claudeInputTokens: '0',
            claudeOutputTokens: '0',
            cost: '0.0000',
            badgeClass: 'badge-green',
            best: false,
            savingsClass: 'green',
            savingsLabel: '100% saved (no Claude)',
        },
    ];
    const html = template({
        generatedAt: new Date().toLocaleString(),
        taskName: 'Todo Webapp',
        claudeModel: 'claude-sonnet-4-6',
        hybridCost: hybridCost.toFixed(4),
        claudeOnlyCost: claudeOnlyCost.toFixed(4),
        savingsPct,
        savedDollars: savedDollars.toFixed(4),
        modes,
        hybridLocalTurns: hybrid.localTurns,
        hybridClaudeTurns: hybrid.claudeTurns,
        hybridLocalTokens: (hybrid.localInputTokens + hybrid.localOutputTokens).toLocaleString(),
        hybridClaudeTokens: (hybrid.claudeInputTokens + hybrid.claudeOutputTokens).toLocaleString(),
    });
    fs_1.default.writeFileSync(outputPath, html);
}
