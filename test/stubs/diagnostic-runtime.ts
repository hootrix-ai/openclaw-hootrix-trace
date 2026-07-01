export type DiagnosticEventPayload = {
  type: string;
  sessionKey?: string;
  costUsd?: number;
  model?: string;
  provider?: string;
  durationMs?: number;
};

export function onDiagnosticEvent(_handler: (event: DiagnosticEventPayload) => void): () => void {
  return () => {};
}
