import type { DocumentRequest } from "./CadViewport";

export const documentKey = (document: DocumentRequest) => JSON.stringify(document);

// A remembered, successfully rebuilt document is preferable to guessing which
// feature failed. The prefix search is only for imported/already-failed files
// that have no successful snapshot in this browser session.
export async function recoverWorkingDocument(
  failed: DocumentRequest,
  lastWorking: DocumentRequest | null,
  validate: (candidate: DocumentRequest) => Promise<boolean>,
): Promise<DocumentRequest> {
  if (lastWorking && documentKey(lastWorking) !== documentKey(failed)) return structuredClone(lastWorking);
  for (let count = failed.features.length - 1; count >= 0; count--) {
    const candidate = { ...failed, features: failed.features.slice(0, count) };
    if (await validate(candidate)) return structuredClone(candidate);
  }
  throw new Error("No working feature state could be recovered. The current project has been preserved.");
}

export function canRememberRebuild(current: DocumentRequest, rebuilt?: DocumentRequest): boolean {
  return Boolean(rebuilt && documentKey(current) === documentKey(rebuilt));
}
