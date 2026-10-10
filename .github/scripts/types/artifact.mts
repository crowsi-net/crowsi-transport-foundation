/** Metadata captured from one npm pack result and tied to one reviewed Git commit. */
export interface PackFile { path: string; size: number }
export interface PackResult { name: string; version: string; filename: string; files: PackFile[] }
export interface ArtifactReceipt {
  repository: string; source_sha: string; name: string; version: string;
  sha256: string; file_count: number; provenance: string;
}
