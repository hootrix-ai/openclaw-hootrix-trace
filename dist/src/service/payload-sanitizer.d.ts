export declare function sanitizeStringForHootrix(value: string): string;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function sanitizeValueForHootrix(value: unknown): unknown;
/** OpenClaw llm_input fields mirrored into trace/span input (presence follows the hook event). */
export type OpenClawLlmInputEventFields = {
    prompt?: unknown;
    systemPrompt?: unknown;
    imagesCount?: unknown;
    historyMessages?: unknown;
};
/**
 * Build trace/span input from an OpenClaw `llm_input` event. Only fields OpenClaw provided
 * are included; historyMessages is omitted when absent or empty (no synthetic history).
 */
export declare function buildSanitizedLlmInputFromEvent(event: OpenClawLlmInputEventFields): Record<string, unknown>;
