"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLocodeStats = parseLocodeStats;
function parseLocodeStats(statsJson, mode) {
    try {
        const stats = JSON.parse(statsJson);
        return {
            mode,
            tool: 'locode',
            inputTokens: stats.total.inputTokens,
            outputTokens: stats.total.outputTokens,
            localInputTokens: stats.local.inputTokens,
            localOutputTokens: stats.local.outputTokens,
            claudeInputTokens: stats.claude.inputTokens,
            claudeOutputTokens: stats.claude.outputTokens,
            localRoutingPct: stats.localRoutingPct,
            estimatedCostUsd: stats.total.estimatedCostUsd,
            localTurns: stats.local.turns,
            claudeTurns: stats.claude.turns,
        };
    }
    catch {
        return {};
    }
}
