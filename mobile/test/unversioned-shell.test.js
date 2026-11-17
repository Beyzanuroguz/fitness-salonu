const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const pub=path.join(__dirname,'../../public');
test('legacy entry points retain assets and expose only FORM CLUB feature names',()=>{
 for(const file of ['v7.html','v8.html','v9/index.html','nutrition-plus.html','nutrition/index.html']){
  const html=fs.readFileSync(path.join(pub,file),'utf8');
  const text=html.replace(/<[^>]*>/g,' ');assert.doesNotMatch(text,/\bV[789]\b/,file);
  assert.doesNotMatch(html,/onload=|onclick=|<script>/,file);
 }
 for(const file of ['v7.js','v8.js','v9/v9.js','nutrition/nutrition-views.js']){
  const js=fs.readFileSync(path.join(pub,file),'utf8');assert.doesNotMatch(js,/(?:>|['"])V[789](?:\s|<)/,file);
 }
 assert.equal(JSON.parse(fs.readFileSync(path.join(pub,'v9/manifest.webmanifest'))).name,'FORM CLUB');
 const app=fs.readFileSync(path.join(pub,'app.js'),'utf8');assert.match(app,/moduleFrame\('\/nutrition\/\?embedded=1'/);
 assert.ok(fs.existsSync(path.join(pub,'v8.js')));assert.ok(fs.existsSync(path.join(pub,'v9/v9.js')));
});
