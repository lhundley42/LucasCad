// Save advisory evidence without upgrading dependencies. Package names/versions
// are sent to the npm advisory service by pnpm; source code is not uploaded.
import fs from 'node:fs';
import {execSync} from 'node:child_process';
let stdout;
try { stdout=execSync('pnpm audit --json',{encoding:'utf8',maxBuffer:8*1024*1024}); }
catch(error) { if(!error.stdout)throw error;stdout=String(error.stdout); }
const npm=JSON.parse(stdout);
if(!npm.metadata?.vulnerabilities||!npm.advisories)throw new Error('Audit failed; refusing to create a clean report.');
const python=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):null;
const report={date:new Date().toISOString().slice(0,10),npm:{counts:npm.metadata.vulnerabilities,advisories:Object.values(npm.advisories).map(a=>({package:a.module_name,severity:a.severity,title:a.title,id:a.github_advisory_id,url:a.url,affected:a.vulnerable_versions,fixed:a.patched_versions,installed:a.findings}))},python:python?{findings:python.dependencies.filter(d=>d.vulns?.length),skipped:python.dependencies.filter(d=>d.skip_reason),note:'Installed site-packages scan, including pip; scanner may report duplicate advisory IDs. No result implies no KNOWN advisories, not proof of security.'}:null};
fs.mkdirSync('docs/release',{recursive:true});
fs.writeFileSync('docs/release/security-advisories.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({npm:report.npm.counts,pythonAffected:report.python?.findings.map(d=>({name:d.name,version:d.version,advisories:d.vulns.length,uniqueAdvisories:new Set(d.vulns.map(v=>v.id)).size})),pythonSkipped:report.python?.skipped.length},null,2));
