export const EXPERIMENT_TAG_PREFIX = "hootrix.experiment_id=";

export function parseExperimentIdFromTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith(EXPERIMENT_TAG_PREFIX)) {
      const id = tag.slice(EXPERIMENT_TAG_PREFIX.length).trim();
      if (id) return id;
    }
  }
  return undefined;
}

export function experimentMetadataFields(experimentId: string | undefined): Record<string, string> {
  return experimentId ? { "hootrix.experiment_id": experimentId } : {};
}
