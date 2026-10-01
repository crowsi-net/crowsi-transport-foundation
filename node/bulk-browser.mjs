// This browser port advertises STATE only. Bulk streaming remains the existing
// Node feature; it is not emulated, silently assembled or negotiated here.
import {fail} from './realtime-contract.mjs'
export const supportedClasses=Object.freeze(['STATE'])
export class BulkIntake {
  get size(){return 0}
  accept(){fail('UnsupportedClass')}
  close(){}
}
export class BulkOutput { constructor(){fail('UnsupportedClass')} }
