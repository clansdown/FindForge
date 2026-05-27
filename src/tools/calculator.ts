import { evaluate } from 'mathjs';
import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

export const CALCULATOR_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'scientific_calculator',
        description:
            'Evaluate mathematical expressions safely. Supports basic arithmetic, trig functions (sin, cos, tan, asin, acos, atan), logarithms (log, log10, ln), exponents, square roots (sqrt), and constants (pi, e). Use for any numerical computation.',
        parameters: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: "Math expression to evaluate, e.g. 'sqrt(2) * pi', 'log10(1000)', 'sin(pi/2) + cos(0)', '2^10'",
                },
            },
            required: ['expression'],
        },
    },
    displayName: 'Scientific Calculator',
    formatArgs(args) { return (args.expression as string) || ''; },
    formatResult(result) { return `= ${result.slice(0, 40)}`; },
};

export async function executeCalculator(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const expression = args.expression as string;
    if (!expression || typeof expression !== 'string') {
        return 'Error: No expression provided.';
    }
    try {
        const result = evaluate(expression);
        return String(result);
    } catch (e) {
        return `Error evaluating expression: ${e instanceof Error ? e.message : String(e)}`;
    }
}
