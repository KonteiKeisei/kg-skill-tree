import { writeFileSync, mkdirSync } from 'node:fs';
globalThis.foundry={utils:{randomID:()=>Math.random().toString(36).slice(2,14),deepClone:structuredClone,isEmpty:o=>!Object.keys(o).length}};
const {defaultTree,defaultNode}=await import('../scripts/trees.mjs');
const tree=defaultTree('Dawnbrand: Equipment Example');tree.id='dawnbrandexample';tree.kind='equipment';tree.rules=[];
tree.description='Example equipment tree. Attach to a magical attunable weapon and award equipment points.';
const node=(id,name,x,y,ownership,cost,enhancements)=>defaultNode(x,y,{id,name,ownership,cost,enhancements,color:ownership==='permanent'?'#c49b4b':'#5e9eba'});
const nodes=[node('familiar','Familiar Grip',.28,.3,'personal',1,[{id:'attack',target:'weapon',kind:'attack',value:'1'}]),
 node('guard','Guardian Bond',.28,.7,'personal',2,[{id:'ac',target:'actor',kind:'ac',value:'1'},{id:'save',target:'actor',kind:'save',key:'wis',value:'1'},{id:'check',target:'actor',kind:'check',key:'prc',value:'1'}]),
 node('edge','Tempered Edge',.72,.3,'permanent',2,[{id:'damage',target:'weapon',kind:'damage',value:'2'}]),
 node('ember','Ember Core',.72,.7,'permanent',2,[{id:'fire',target:'weapon',kind:'damage',value:'1d4',damageType:'fire'}])];
tree.nodes=Object.fromEntries(nodes.map(n=>[n.id,n]));tree.links={bond:{id:'bond',from:'familiar',to:'guard',kind:'require'},forging:{id:'forging',from:'edge',to:'ember',kind:'require'}};
mkdirSync(new URL('../examples/',import.meta.url),{recursive:true});
writeFileSync(new URL('../examples/equipment-sword-example.json',import.meta.url),JSON.stringify({kgSkillTree:1,tree},null,2)+'\n');
