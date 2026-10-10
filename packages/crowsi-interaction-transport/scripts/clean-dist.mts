/** Remove only this package's generated output before emitting a new build. */
import { rmSync } from 'node:fs';
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
