export async function runTest(){
 const out=document.createElement('pre');out.id='kgst-attunement-test';out.style.cssText='position:fixed;inset:12px;overflow:auto;background:#17202a;color:white;padding:20px;z-index:99999;white-space:pre-wrap;pointer-events:none';document.body.append(out);
 const log=text=>{out.textContent+=text+'\n';console.log('KGST',text);},check=(ok,text)=>{if(!ok)throw Error(text);log('PASS '+text);};
 try{
 const M='kg-skill-tree',S='sephrals-roll-breakdown';
 if(!game.modules.get(S)?.active){const config=foundry.utils.deepClone(game.settings.get('core','moduleConfiguration'));config[S]=true;await game.settings.set('core','moduleConfiguration',config);location.reload();return;}
 const {defaultTree,defaultNode,saveTree}=await import('../scripts/trees.mjs'),{equipmentRequest:req,equipmentView:view,refreshEquipment}=await import('../scripts/equipment.mjs');
 log(`Foundry ${game.version}, dnd5e ${game.system.version}, Sephral ${game.modules.get(S).version}`);
 const actor=await Actor.implementation.create({name:'Attunement and Source Regression',type:'character',system:{abilities:{wis:{value:12}}}});
 const pack=game.packs.get('dnd5e.equipment24');await pack.getIndex();const source=await pack.getDocument(pack.index.find(i=>i.name==='Longsword')._id),data=source.toObject();delete data._id;
 data.name='Regression Sword';data.system.properties=(data.system.properties??[]).filter(p=>p!=='mgc');data.system.attunement='';data.system.attuned=false;data.system.equipped=true;
 const spells=game.packs.get('dnd5e.spells24');await spells.getIndex();const spell=spells.index.find(i=>i.name==='Feather Fall');
 const tree=defaultTree('Attunement Regression','equipment','weapon');tree.rules=[];
 const node=defaultNode(.5,.5,{name:'Awakening',cost:0,enhancements:[{target:'actor',kind:'check',key:'prc',value:'1'},{target:'weapon',kind:'attack',value:'1'}],grants:[{kind:'item',type:'spell',uuid:spell.uuid,name:spell.name,spellUses:{enabled:true,max:'1',recovery:'lr'}}]});tree.nodes={[node.id]:node};await saveTree(tree);
 const [item]=await actor.createEmbeddedDocuments('Item',[data]);await req('attach',{itemUuid:item.uuid,treeId:tree.id});
 check(item.system.properties.has('mgc')&&item.system.properties.has('ver'),'attunement requirement adds mgc and preserves weapon properties');
 check(item.system.attunement==='required'&&!item.system.attuned,'item requires attunement without automatically attuning');
 await req('buy',{itemUuid:item.uuid,nodeId:node.id});check(!(await view(item)).active&&!actor.items.some(i=>i.type==='spell'),'unlock remains inactive until actual attunement');
 await item.update({'system.attuned':true});await refreshEquipment();check((await view(item)).active&&actor.items.some(i=>i.type==='spell'),'attuning activates existing spell grant');
 const rolls=await actor.rollSkill({skill:'prc'},{configure:false},{create:true}),roll=rolls[0];
 log('Perception formula '+roll.formula);check(roll.formula.includes('[Regression Sword]')&&!roll.formula.includes('Skill Tree:')&&!roll.formula.includes('Awakening'),'Perception formula shows only the sword name');
 const message=[...game.messages].reverse().find(m=>m.speaker?.actor===actor.id&&m.rolls?.length);
 const breakdown=await game.modules.get(S).api.getBreakdown(message);log('Breakdown '+JSON.stringify(breakdown.map(b=>b.modifiers.map(m=>({source:m.sourceLabel,value:m.value})))));
 check(!breakdown.some(b=>b.modifiers.some(m=>m.value===0&&!m.sourceLabel))&&!/\+\s*0\s*\+/.test(roll.formula),'equipment enhancement does not add a zero padding term');
 check(breakdown.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===1)),'actual Sephral adapter shows the sword name for +1 Perception');
 const extra=defaultNode(.7,.5,{name:'Sharper Senses',cost:8,minLevel:20,enhancements:[{target:'actor',kind:'check',key:'prc',value:'2'},{target:'actor',kind:'save',key:'wis',value:'1'},{target:'weapon',kind:'damage',value:'1d4',damageType:'fire'}]});tree.nodes[extra.id]=extra;await saveTree(tree);
 let blocked=false;try{await req('buy',{itemUuid:item.uuid,nodeId:extra.id});}catch{blocked=true;}check(blocked,'normal unlock still checks requirements and points');
 await req('grant',{itemUuid:item.uuid,nodeId:extra.id,free:true,level:3,note:'GM regression'});
 let info=await view(item);const granted=info.state.owned.find(p=>p.id===extra.id);check(granted?.gm&&granted.cost===0&&granted.level===3&&granted.note==='GM regression'&&info.summary.available===0,'GM grant bypasses requirements and records a free unlock, level and note');
 const inspectLast=async()=>game.modules.get(S).api.getBreakdown([...game.messages].reverse().find(m=>m.speaker?.actor===actor.id&&m.rolls?.length));
 await actor.rollSkill({skill:'prc'},{configure:false},{create:true});let more=await inspectLast();log('Cumulative '+JSON.stringify(more.map(b=>b.modifiers.map(m=>({source:m.sourceLabel,value:m.value})))));
 check(more.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===1)&&b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===2)),'cumulative bonuses retain separate values labeled by sword');
 await actor.rollSavingThrow({ability:'wis'},{configure:false},{create:true});more=await inspectLast();check(more.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===1)),'saving throw source is identified by Sephral');
 const attack=item.system.activities.find(a=>a.type==='attack');await attack.rollAttack({},{configure:false},{create:true});more=await inspectLast();check(more.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===1)),'weapon attack source is identified by Sephral');
 await attack.rollDamage({},{configure:false},{create:true});more=await inspectLast();log('Damage '+JSON.stringify(more.map(b=>b.diceTerms.map(m=>({source:m.sourceLabel,total:m.total})))));
 check(more.some(b=>b.diceTerms.some(m=>m.sourceLabel==='Regression Sword')),'extra damage die source is identified by Sephral');
 extra.enhancements[0].stacking='replace';await saveTree(tree);await refreshEquipment();await actor.rollSkill({skill:'prc'},{configure:false},{create:true});more=await inspectLast();
 check(more.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===2))&&!more.some(b=>b.modifiers.some(m=>m.sourceLabel==='Regression Sword'&&m.value===1)),'upgrade labels replace the earlier bonus source');
 await req('refund',{itemUuid:item.uuid,nodeId:extra.id});check((await view(item)).summary.available===0,'refunding a free GM grant does not award points');
 await req('grant',{itemUuid:item.uuid,nodeId:extra.id,free:false});check((await view(item)).summary.available===-8,'GM can choose to charge the equipment point cost');await req('refund',{itemUuid:item.uuid,nodeId:extra.id});
 const app=await game.modules.get(M).api.equipment.open(item);await new Promise(r=>setTimeout(r,250));await app.panel.select(extra.id);check(!!app.element.querySelector('[data-equipment-action="gm-grant"]'),'equipment node details expose GM grant');
 app.element.querySelector('[data-equipment-action="gm-grant"]').click();await new Promise(r=>setTimeout(r,250));
 const free=document.querySelector('.kgst-dialog input[name="free"]'),dialog=free?.closest('.application');check(!!free?.checked,'GM grant dialog defaults to free');
 dialog.querySelector('[name="note"]').value='Granted through equipment UI';dialog.querySelector('button[data-action="grant"]').click();await new Promise(r=>setTimeout(r,600));
 check((await view(item)).state.owned.some(p=>p.id===extra.id&&p.gm&&p.cost===0&&p.note==='Granted through equipment UI'),'GM grant button and dialog perform the actual unlock');await req('refund',{itemUuid:item.uuid,nodeId:extra.id});
 await item.update({'system.attunement':'','system.properties':['ver'],'system.attuned':false});await refreshEquipment();
 check(item.system.properties.has('mgc')&&item.system.attunement==='required'&&!item.system.attuned,'existing attachments repair missing magical/attunement configuration');
 tree.activation.attuned=false;await saveTree(tree);await item.update({'system.attunement':'','system.properties':['ver']});await refreshEquipment();
 check(!item.system.properties.has('mgc')&&item.system.attunement==='','tree without attunement leaves mundane item unchanged');
 tree.activation.attuned=true;await saveTree(tree);await refreshEquipment();check(item.system.properties.has('mgc')&&item.system.attunement==='required','editing tree to require attunement configures existing item');
 check(!(await pack.getDocument(source.id)).system.properties.has('mgc'),'source compendium stays unchanged');
 log('COMPLETE');
 }catch(err){log('FAIL '+err.stack);}
}
