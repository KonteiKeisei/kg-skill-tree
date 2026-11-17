import {MODULE_ID,activeGM,h} from './util.mjs';
import {getTree} from './trees.mjs';

export function equipmentActors(){
 const actors=new Map([...game.actors].map(a=>[a.uuid,a]));
 for(const scene of game.scenes)for(const token of scene.tokens)if(token.actor?.isToken)actors.set(token.actor.uuid,token.actor);
 return [...actors.values()];
}
export const isEquipmentPile=actor=>!!actor?.flags?.['item-piles']?.data?.enabled;

/** A copy stays unbound until deletion of the original confirms an actual move. */
export function registerEquipmentTransfers({request,changed}){
 const candidates=new Map(),removed=new Map(),busy=new Set();
 const isGM=()=>game.user.id===activeGM()?.id;
 const configurePiles=async()=>{
  if(!isGM()||!game.itempiles?.API)return;
  const path=`flags.${MODULE_ID}.equipment.instanceId`,paths=game.itempiles.API.ITEM_SIMILARITIES;
  if(Array.isArray(paths)&&!paths.includes(path))await game.itempiles.API.setItemSimilarities([...paths,path]);
 };
 Hooks.on('item-piles-ready',()=>configurePiles().catch(console.error));
 Hooks.once('ready',()=>configurePiles().catch(console.error));
 const mark=data=>data.flags?.[MODULE_ID]?.equipment;
 const prepare=(data)=>{
  const marker=mark(data);if(!marker)return;
  data.flags[MODULE_ID].equipmentCandidate={...marker,at:Date.now()};delete data.flags[MODULE_ID].equipment;
  if(game.modules.get('item-piles')?.active){data.flags['item-piles']??={};data.flags['item-piles'].item??={};data.flags['item-piles'].item.canStack='no';}
 };
 const finish=async(instanceId)=>{
  if(!isGM()||busy.has(instanceId))return;busy.add(instanceId);
  try{
   const list=[...(candidates.get(instanceId)?.values()??[])];if(!list.length)return;
   const marker=list[0].getFlag(MODULE_ID,'equipmentCandidate'),ledger=await fromUuid(marker.ledgerUuid),header=ledger?.getFlag(MODULE_ID,'equipmentLedger');
   if(!header||header.instanceId!==instanceId||header.archived)return;
   if(await fromUuid(header.itemUuid))return;
   // A stale exported copy must never claim an orphaned record after a reload.
   if(!removed.has(instanceId)||Date.now()-removed.get(instanceId)>30000)return;
   const live=[];for(const item of list)if(await fromUuid(item.uuid))live.push(item);
   if(live.length!==1){if(live.length>1)ui.notifications.warn('Equipment transfer has multiple copies. Use Recover Item to choose its physical location.');return;}
   const item=live[0];
   const updates={[`flags.${MODULE_ID}.equipment`]:{instanceId,ledgerUuid:ledger.uuid,treeId:header.treeId,castActivities:marker.castActivities??{}},[`flags.${MODULE_ID}.-=equipmentCandidate`]:null,'system.equipped':false};
   if('attuned' in item.system)updates['system.attuned']=false;
   if(typeof item.system.attunement==='number')updates['system.attunement']=item.system.attunement?1:0;
   await item.update(updates);
   await ledger.update({[`flags.${MODULE_ID}.equipmentLedger.itemUuid`]:item.uuid,[`flags.${MODULE_ID}.equipmentLedger.revision`]:(header.revision??0)+1});
   candidates.delete(instanceId);removed.delete(instanceId);await changed(item);
  }catch(err){console.error('KG equipment transfer',err);ui.notifications.error(`Equipment transfer needs recovery: ${err.message}`);}finally{busy.delete(instanceId);}
 };
 const candidate=async(item)=>{
  if(!isGM())return;
  let flag=item.getFlag(MODULE_ID,'equipmentCandidate');
  if(!flag){const original=item.getFlag(MODULE_ID,'equipment');if(!original)return;const ledger=await fromUuid(original.ledgerUuid);if(ledger?.getFlag(MODULE_ID,'equipmentLedger')?.itemUuid===item.uuid)return;
   flag={...original,at:Date.now()};await item.update({[`flags.${MODULE_ID}.equipmentCandidate`]:flag,[`flags.${MODULE_ID}.-=equipment`]:null});}
  let list=candidates.get(flag.instanceId);if(!list)candidates.set(flag.instanceId,list=new Map());list.set(item.uuid,item);
  await finish(flag.instanceId);
  setTimeout(async()=>{list.delete(item.uuid);if(!list.size)candidates.delete(flag.instanceId);if(item.getFlag(MODULE_ID,'equipmentCandidate'))try{await item.unsetFlag(MODULE_ID,'equipmentCandidate');}catch{}},5000);
 };
 Hooks.on('preCreateItem',(item,data,options)=>{
  if(options.kgstTransfer||options.kgstEquipmentProjection)return;
  if(!mark(data))return;
  if(item.pack){item.updateSource({[`flags.${MODULE_ID}.-=equipment`]:null});return;}
  const copy=foundry.utils.deepClone(data);prepare(copy);
  item.updateSource({flags:copy.flags});item.updateSource({[`flags.${MODULE_ID}.-=equipment`]:null});
 });
 Hooks.on('preCreateActor',(actor,data)=>{
  if(!data.items?.some(mark))return;const items=foundry.utils.deepClone(data.items);items.forEach(prepare);actor.updateSource({items});
 });
 Hooks.on('createItem',(item,options)=>{if(!options.kgstTransfer)candidate(item);});
 Hooks.on('deleteItem',(item,options)=>{
  const flag=item.getFlag(MODULE_ID,'equipment');if(!flag||options.kgstTransfer||!isGM())return;
  removed.set(flag.instanceId,Date.now());finish(flag.instanceId);setTimeout(()=>removed.delete(flag.instanceId),30000);
 });
 Hooks.on('deleteActor',(actor)=>{if(!isGM())return;for(const item of actor.items){const flag=item.getFlag(MODULE_ID,'equipment');if(flag){removed.set(flag.instanceId,Date.now());finish(flag.instanceId);}}});
 const scan=doc=>{if(isGM())for(const item of (doc.actor??doc).items??[])candidate(item);};
 Hooks.on('createActor',scan);Hooks.on('createToken',scan);Hooks.on('item-piles-createItemPile',scan);
 for(const hook of ['item-piles-transferItems','item-piles-transferAllItems','item-piles-dropItem','item-piles-giveItem','item-piles-tradeItems'])Hooks.on(hook,async(source,target)=>{
  if(!isGM())return;
  for(const value of [source,target]){
   const doc=typeof value==='string'?await fromUuid(value):value,actor=doc?.actor??doc;
   for(const item of actor?.items??[]){
    const flag=item.getFlag(MODULE_ID,'equipmentCandidate')??item.getFlag(MODULE_ID,'equipment');if(!flag)continue;
    const ledger=await fromUuid(flag.ledgerUuid),header=ledger?.getFlag(MODULE_ID,'equipmentLedger');
    if(header&&header.itemUuid!==item.uuid&&!await fromUuid(header.itemUuid))removed.set(flag.instanceId,Date.now());
    await candidate(item);
   }
  }
 });
 // Core and Tidy both call this hook before their copy/create workflow.
 Hooks.on('dropActorSheetData',(actor,sheet,data)=>{
  if(data.type!=='Item'||!data.uuid||isEquipmentPile(actor))return;
  const item=foundry.utils.fromUuidSync(data.uuid);if(!item?.getFlag(MODULE_ID,'equipment')||item.pack||item.actor?.uuid===actor.uuid)return;
  if(!actor.isOwner||!item.isOwner)return;
  request('transfer',{itemUuid:item.uuid,targetActorUuid:actor.uuid}).catch(err=>ui.notifications.error(err.message));return false;
 });
 const badges=(app,element)=>{
  const root=element instanceof HTMLElement?element:element?.[0];if(!root?.querySelectorAll)return;
  const actor=app.actor??(app.document?.documentName==='Actor'?app.document:null);
  for(const row of root.querySelectorAll('[data-item-id],.document.item[data-document-id]')){
   const item=actor?.items.get(row.dataset.itemId)??game.items.get(row.dataset.documentId??row.dataset.itemId),flag=item?.getFlag(MODULE_ID,'equipment');
   const existing=row.querySelector('.kgst-item-badge');if(!flag){existing?.remove();continue;}
   const name=row.querySelector('.item-name,.document-name,[data-item-name]');if(!name)continue;
   const label=getTree(flag.treeId)?.name??'Skill Tree';
   if(existing){if(existing.dataset.treeLabel!==label){existing.dataset.treeLabel=label;existing.title=`Open skill tree: ${label}`;existing.replaceChildren(h('i.fa-solid.fa-diagram-project'),` ${label}`);}continue;}
   const badge=h('button.kgst-item-badge',{type:'button',title:`Open skill tree: ${getTree(flag.treeId)?.name??'Equipment'}`},h('i.fa-solid.fa-diagram-project'),` ${getTree(flag.treeId)?.name??'Skill Tree'}`);
   badge.dataset.treeLabel=label;
   badge.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();import('./apps/equipment.mjs').then(m=>m.openEquipmentItem(item));});name.append(badge);
  }
 };
 const observed=new WeakMap();
 const mountBadges=(app,element)=>{
  const root=element instanceof HTMLElement?element:element?.[0];if(!root?.querySelectorAll)return;badges(app,root);
  if(observed.has(root))return;
  let frame;const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>badges(app,root));});observer.observe(root,{childList:true,subtree:true});observed.set(root,observer);
 };
 for(const hook of ['renderItemDirectory','renderActorSheet','renderActorSheetV2','tidy5e-sheet.renderActorSheet'])Hooks.on(hook,mountBadges);
 Hooks.on('renderApplicationV2',(app,element)=>{if(app.actor||app.document?.documentName==='Actor')mountBadges(app,element);});
 for(const hook of ['closeApplication','closeApplicationV2'])Hooks.on(hook,app=>{const root=app.element instanceof HTMLElement?app.element:app.element?.[0];observed.get(root)?.disconnect();if(root)observed.delete(root);});
}
