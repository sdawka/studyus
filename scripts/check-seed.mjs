import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const persist=mkdtempSync(join(tmpdir(),'studyus-seed-check-'));
function run(args,extra={}) {
  return execFileSync(process.execPath,args,{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,...extra}});
}
try {
  run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','studyus','--local','--persist-to',persist]);
  for(const email of ['student@example.com','student@example.com','second-seed@example.test']) {
    run(['--import','tsx','scripts/seed.ts','--persist-to',persist],{SEED_USER_EMAIL:email});
  }
  const output=run(['node_modules/wrangler/bin/wrangler.js','d1','execute','studyus','--local','--persist-to',persist,'--json','--command',
    "SELECT u.email,COUNT(DISTINCT c.id) courses,COUNT(DISTINCT k.id) kcs FROM users u JOIN courses c ON c.user_id=u.id JOIN kcs k ON k.course_id=c.id GROUP BY u.id ORDER BY u.email"]);
  const rows=JSON.parse(output).flatMap(result=>result.results??[]);
  if(rows.length!==2 || rows.some(row=>row.courses!==9 || row.kcs!==172)) throw new Error('Clean migrate/reseed/two-user fixture counts did not match');
  console.log('Clean migration, repeat seed and two independent learners verified (9 courses / 172 concepts each).');
} finally {rmSync(persist,{recursive:true,force:true});}
