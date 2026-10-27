export function caseDiagnosticDelta(before, after) {
    const previous = new Set(before.events.map(event => event.id));
    const events = after.events.filter(event => !previous.has(event.id));
    const documents = new Set(events.map(event => event.documentId));
    const artifacts = new Set((before.artifacts ?? []).map(artifact => artifact.path));
    return {
        firstEventId: events[0]?.id ?? null,
        lastEventId: events.at(-1)?.id ?? null,
        events,
        documents: after.documents.filter(document => documents.has(document.id)),
        artifacts: (after.artifacts ?? []).filter(artifact => !artifacts.has(artifact.path)),
        errorIds: events.filter(event => ["console-error", "page-error", "http-error", "request-failed", "diagnostic-integrity-error"].includes(event.kind)).map(event => event.id),
    };
}
