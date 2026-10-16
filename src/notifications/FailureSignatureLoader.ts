/**
 * Reads the tracked signature registry (failureSignatures.json) for FailureClassifier. Kept apart from the pure
 * classifier so that module stays free of fs. A missing or invalid file degrades to an EMPTY registry — every failure
 * then stays 'unclassified' — and never blocks the notification email (same graceful-absence rule as
 * loadKnownIssuesIndex()).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EMPTY_REGISTRY, SignatureRegistry, parseSignatureRegistry } from './FailureClassifier';

export const SIGNATURE_REGISTRY_PATH = path.join(__dirname, 'failureSignatures.json');

/** Strict variant for the check script: throws on a missing or invalid registry. */
export function readSignatureRegistryStrict(file: string = SIGNATURE_REGISTRY_PATH): SignatureRegistry {
  return parseSignatureRegistry(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

export function loadSignatureRegistry(file: string = SIGNATURE_REGISTRY_PATH): { registry: SignatureRegistry; error?: string } {
  try {
    return { registry: readSignatureRegistryStrict(file) };
  } catch (err) {
    return { registry: EMPTY_REGISTRY, error: err instanceof Error ? err.message : String(err) };
  }
}
