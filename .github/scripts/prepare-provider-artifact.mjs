import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const directory=join(process.env.RUNNER_TEMP,'provider-release')
mkdirSync(directory,{recursive:true})
const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',directory]))
const rows=Array.isArray(result)?result:Object.values(result)
if(rows.length!==1 || !/^[a-z0-9.-]+\.tgz$/.test(rows[0].filename))throw new Error('One regular candidate required')
const sha=createHash('sha256').update(readFileSync(join(directory,rows[0].filename))).digest('hex')
writeFileSync(process.env.GITHUB_OUTPUT,`sha256=${sha}\nfilename=${rows[0].filename}\n`,{flag:'a'})
const review=JSON.parse(readFileSync('../../.github/reviewed-provider.json'))
if(review.name!==rows[0].name || review.version!==rows[0].version || review.sha256!==sha)throw new Error('Owner-reviewed candidate mismatch')
console.log(JSON.stringify({name:rows[0].name,version:rows[0].version,sha256:sha}))
