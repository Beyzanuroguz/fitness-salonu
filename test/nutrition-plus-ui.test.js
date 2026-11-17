const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Nutrition+ renders missing values safely, opens collection products and switches charts',async()=>{
 const elements=new Map(),handlers={};const el=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',scrollIntoView(){}});return elements.get(s);};
 const p={id:1,name:'<img onerror=bad>',nutrients:{kcal:200,protein:10,carbs:null,fat:8},source:'Open Food Facts',source_url:'https://world.openfoodfacts.org/product/12345678',basis:'100g',serving_grams:40};
 const history={totals:{known:{kcal:0,protein:0,carbs:0,fat:0},missing:{kcal:0,protein:0,carbs:0,fat:0}},daily:[{date:'2026-11-17',known:{kcal:0,protein:0,carbs:0,fat:0},missing:{kcal:0,protein:0,carbs:0,fat:0}}],logs:[]};
 let cameraStops=0;
 const c={document:{querySelector:el,addEventListener:(k,v)=>handlers[k]=v},window:{addEventListener(){},FORMCLUB_CONFIG:{}},navigator:{},fetch:async url=>({ok:true,json:async()=>url.includes('/foods')?[p]:history}),Date,Number,String,Map,Math,Event,console,requestAnimationFrame:()=>0,cancelAnimationFrame:()=>cameraStops++};vm.createContext(c);vm.runInContext(fs.readFileSync('public/nutrition-plus.js','utf8'),c);await new Promise(setImmediate);
 assert.match(el('#app').innerHTML,/Kahvaltı/);assert.match(el('#app').innerHTML,/Bilinmiyor/);assert.match(el('#app').innerHTML,/&lt;img onerror=bad&gt;/);assert.doesNotMatch(el('#app').innerHTML,/<img onerror/);
 // Buttons outside a form have type=submit in browsers, but must still respond.
 handlers.click({target:{closest:()=>({type:'submit',form:null,dataset:{pick:'1'}})}});await new Promise(setImmediate);
 assert.match(el('#preview').innerHTML,/Porsiyon \(40 g\)/);assert.match(el('#preview').innerHTML,/Günlüğe ekle/);
 handlers.change({target:{id:'metric',value:'protein'}});assert.match(el('#chart').innerHTML,/2026-11-17/);assert.ok(cameraStops>0);
});
