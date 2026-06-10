export declare const EXPERIMENT_TAG_PREFIX = "hootrix.experiment_id=";
export declare function parseExperimentIdFromTags(tags: readonly string[]): string | undefined;
export declare function experimentMetadataFields(experimentId: string | undefined): Record<string, string>;
