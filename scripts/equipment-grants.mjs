import { MODULE_ID, activeGM } from './util.mjs';
import { grantItemData } from './progress.mjs';
import {equipmentActors} from './equipment-transfers.mjs';
const copy=x=>foundry.utils.deepClone(x);
export async function buildEquipmentGrants(node) {
 const grants=[];
 for(const [index,grant] of node.grants.entries()){
  if(grant.kind==='summon')throw new Error('Equipment summon grants are not supported yet.');
  const data=await grantItemData(grant);if(!data)throw new Error(`Source for ${grant.name||node.name} is missing.`);
  if(!['spell','feat'].includes(data.type))throw new Error('Equipment nodes can grant spells or simple features. Use enhancements for weapon/armor changes.');
  if(Object.keys(data.system.advancement??{}).length)throw new Error('Equipment feature grants with advancement choices require a separate character grant.');
  delete data._id;delete data.folder;delete data.ownership;
  if(data.flags?.[MODULE_ID]){delete data.flags[MODULE_ID].equipment;delete data.flags[MODULE_ID].grant;delete data.flags[MODULE_ID].equipmentGrant;}
  grants.push({index,data,sourceUuid:grant.uuid});
 }
 return grants;
}
/** Refresh owned rewards when their design changes, including purchases made before spell grants existed. */
export async function syncEquipmentGrantDefinitions(ledger,tree){
 const header=ledger.getFlag(MODULE_ID,'equipmentLedger');
 const patch=async record=>{
  const node=tree.nodes[record.id];if(!node)return false;
  const signature=JSON.stringify(node.grants??[]);
  if(record.grantSignature===signature&&record.token)return false;
  const previous=record.grants??[],grants=await buildEquipmentGrants(node);
  record.token??=foundry.utils.randomID();
  // Keep the old resource slot for the same source even when the GM reorders the grant list.
  let next=Math.max(-1,...previous.map(g=>g.resourceIndex??g.index))+1;const matched=new Set();
  for(const grant of grants){const old=previous.find(g=>!matched.has(g)&&g.index===grant.index&&(!g.sourceUuid||g.sourceUuid===grant.sourceUuid))??previous.find(g=>!matched.has(g)&&g.sourceUuid&&g.sourceUuid===grant.sourceUuid);if(old)matched.add(old);grant.resourceIndex=old?(old.resourceIndex??old.index):next++;}
  record.grants=grants;record.grantSignature=signature;return true;
 };
 const permanent=copy(header.permanent??[]);let headerChanged=false;
 for(const record of permanent)headerChanged=await patch(record)||headerChanged;
 for(const page of ledger.pages){
  const bond=copy(page.getFlag(MODULE_ID,'equipmentBond'));if(!bond)continue;let changed=false;
  for(const record of bond.owned??[]){const shared=permanent.find(p=>p.id===record.id);if(shared){if(JSON.stringify(record)!==JSON.stringify(shared)){Object.assign(record,copy(shared));changed=true;}}else changed=await patch(record)||changed;}
  if(changed)await page.setFlag(MODULE_ID,'equipmentBond',bond);
 }
 if(headerChanged)await ledger.setFlag(MODULE_ID,'equipmentLedger.permanent',permanent);
}
function usage(item){return {spent:Number(item.system.uses?.spent)||0,activities:Object.fromEntries([...item.system.activities?.values?.()??[]].map(a=>[a.id,Number(a.uses?.spent)||0]))};}
export async function captureEquipmentUsage(item){
 const g=item.getFlag(MODULE_ID,'equipmentGrant');if(!g||activeGM()?.id!==game.user.id)return;
 const ledger=await fromUuid(g.ledgerUuid);if(!ledger)return;
 const previous=ledger.getFlag(MODULE_ID,'equipmentLedger')?.grantUsage?.[g.resourceId],next=usage(item);
 if(JSON.stringify(previous)!==JSON.stringify(next))await ledger.setFlag(MODULE_ID,`equipmentLedger.grantUsage.${g.resourceId}`,next);
}
/** GM reconciles only module-owned generated items, preserving charge state in the physical item's ledger. */
export async function reconcileEquipmentGrants(item,info){
 if(activeGM()?.id!==game.user.id||!info)return;
 const marker=item.getFlag(MODULE_ID,'equipment'),ledger=await fromUuid(marker.ledgerUuid);if(!ledger)return;
 const wanted=new Map();
 if(info.active&&item.actor)for(const purchase of info.state.owned)for(const grant of purchase.grants??[]){
  const resourceId=`${purchase.token}-${grant.resourceIndex??grant.index}`;wanted.set(resourceId,{purchase,grant});
 }
 const existing=equipmentActors().flatMap(a=>[...a.items]).filter(i=>i.getFlag(MODULE_ID,'equipmentGrant')?.instanceId===marker.instanceId);
 for(const generated of existing){
  const flag=generated.getFlag(MODULE_ID,'equipmentGrant');
  if(wanted.has(flag.resourceId)&&generated.actor===item.actor){
   const {purchase,grant}=wanted.get(flag.resourceId);
   if(flag.signature!==purchase.grantSignature||flag.index!==grant.index){
    const data=copy(grant.data),saved=usage(generated);data.system.uses??={};data.system.uses.spent=saved.spent;
    for(const a of Object.values(data.system.activities??{}))if(saved.activities[a._id]!==undefined){a.uses??={};a.uses.spent=saved.activities[a._id];}
    await generated.update({name:`${data.name} (${item.name})`,img:data.img,system:data.system,
     [`flags.${MODULE_ID}.equipmentGrant`]:{...flag,index:grant.index,signature:purchase.grantSignature}},{kgstEquipmentProjection:true,kgPcHistory:true});
   }
   wanted.delete(flag.resourceId);continue;
  }
  await captureEquipmentUsage(generated);
  await generated.delete({kgstEquipmentProjection:true,kgPcHistory:true});
 }
 if(!item.actor){await reconcileEquipmentCastActivities(item,{active:false});return;}
 for(const [resourceId,{purchase,grant}] of wanted){
  const data=copy(grant.data),saved=ledger.getFlag(MODULE_ID,'equipmentLedger')?.grantUsage?.[resourceId];
  if(saved){data.system.uses.spent=saved.spent;for(const a of Object.values(data.system.activities??{}))if(saved.activities[a._id]!==undefined){a.uses??={};a.uses.spent=saved.activities[a._id];}}
  data.name=`${data.name} (${item.name})`;
  foundry.utils.setProperty(data,`flags.${MODULE_ID}.equipmentGrant`,{instanceId:marker.instanceId,ledgerUuid:ledger.uuid,treeId:info.tree.id,nodeId:purchase.id,resourceId,index:grant.index,signature:purchase.grantSignature});
  await item.actor.createEmbeddedDocuments('Item',[data],{kgstEquipmentProjection:true,kgPcHistory:true});
 }
 await reconcileEquipmentCastActivities(item,info);
}
/** Cast from either the spellbook or the equipment's Activities tab, using the same spell and charges. */
export async function reconcileEquipmentCastActivities(item,info){
 if(!CONFIG.DND5E?.activityTypes?.cast)return;
 const marker=item.getFlag(MODULE_ID,'equipment'),previous=marker.castActivities??{},next={},updates={};
 const spells=info.active?item.actor?.items.filter(i=>i.type==='spell'&&i.getFlag(MODULE_ID,'equipmentGrant')?.instanceId===marker.instanceId)??[]:[];
 for(const spell of spells){
  const grant=spell.getFlag(MODULE_ID,'equipmentGrant'),id=previous[grant.resourceId]??foundry.utils.randomID();next[grant.resourceId]=id;
  const existing=item.system.activities.get(id),activation=[...spell.system.activities.values()][0]?.activation;
  if(existing?.spell?.uuid===spell.uuid&&existing.name===spell.name)continue;
  updates[`system.activities.${id}`]={_id:id,type:'cast',name:spell.name,img:spell.img,spell:{uuid:spell.uuid,spellbook:false},...(activation?{activation:copy(activation)}:{})};
 }
 for(const [resourceId,id] of Object.entries(previous))if(!next[resourceId]){if(item.system.activities.has(id))updates[`system.activities.-=${id}`]=null;updates[`flags.${MODULE_ID}.equipment.castActivities.-=${resourceId}`]=null;}
 for(const [resourceId,id] of Object.entries(next))if(previous[resourceId]!==id)updates[`flags.${MODULE_ID}.equipment.castActivities.${resourceId}`]=id;
 if(Object.keys(updates).length)await item.update(updates,{kgstEquipmentProjection:true,kgPcHistory:true});
}
export async function removeEquipmentGrants(instanceId){
 for(const actor of game.actors)for(const item of [...actor.items])if(item.getFlag(MODULE_ID,'equipmentGrant')?.instanceId===instanceId){await captureEquipmentUsage(item);await item.delete({kgstEquipmentProjection:true,kgPcHistory:true});}
}
export async function recoverEquipmentResources(ledger,actor,{isLong=false,newDay=false,requestId}={}){
 const h=ledger.getFlag(MODULE_ID,'equipmentLedger');if(!h)return;
 const bond=ledger.pages.find(p=>p.getFlag(MODULE_ID,'equipmentBond')?.actorUuid===actor.uuid)?.getFlag(MODULE_ID,'equipmentBond');
 const purchases=[...(bond?.owned??[]),...(h.permanent??[]).filter(p=>!bond?.owned?.some(o=>o.id===p.id))];
 const reset=(uses,spent)=>{
  let next=Number(spent)||0;
  for(const r of uses?.recovery??[]){if(!((r.period==='sr')||(isLong&&r.period==='lr')||(newDay&&r.period==='day')))continue;
   if(r.type==='recoverAll'||!r.type)next=0;
   else if(r.type==='formula')try{next=Math.max(0,next-new Roll(r.formula||'0',actor.getRollData()).evaluateSync().total);}catch{}
  }return next;
 };
 const updates={};
 for(const p of purchases)for(const g of p.grants??[]){
  const key=`${p.token}-${g.resourceIndex??g.index}`,saved=copy(h.grantUsage?.[key]??{spent:0,activities:{}});
  saved.spent=reset(g.data.system.uses,saved.spent);
  for(const activity of Object.values(g.data.system.activities??{}))saved.activities[activity._id]=reset(activity.uses,saved.activities[activity._id]);
  updates[`flags.${MODULE_ID}.equipmentLedger.grantUsage.${key}`]=saved;
 }
 updates[`flags.${MODULE_ID}.equipmentLedger.revision`]=(h.revision??0)+1;
 updates[`flags.${MODULE_ID}.equipmentLedger.transactions`]=[...(h.transactions??[]),requestId].filter(Boolean).slice(-200);
 await ledger.update(updates);
}
export function registerEquipmentGrantHooks(request){
 const cast=CONFIG.DND5E?.activityTypes?.cast?.documentClass?.prototype;
 if(cast){const original=cast.use,originalCache=cast.getCachedSpellData;
  // These activities already link to our usable actor spell. A second dnd5e cache would duplicate its charges.
  cast.getCachedSpellData=function(...args){
   if(Object.values(this.item?.getFlag(MODULE_ID,'equipment')?.castActivities??{}).includes(this.id))return;
   return originalCache.apply(this,args);
  };
  cast.use=function(...args){
  const marker=this.item?.getFlag(MODULE_ID,'equipment');
  if(marker&&Object.values(marker.castActivities??{}).includes(this.id)){
   const spell=foundry.utils.fromUuidSync(this.spell.uuid),grant=spell?.getFlag(MODULE_ID,'equipmentGrant');
   if(!grant||grant.instanceId!==marker.instanceId||spell.actor!==this.actor){ui.notifications.warn('Equip and attune this item before casting its granted spell.');return;}
   return spell.use(...args);
  }
  return original.apply(this,args);
 };}
 Hooks.on('updateItem',(item,changes,options)=>{if(options.kgstEquipmentProjection||activeGM()?.id!==game.user.id)return;if(item.getFlag(MODULE_ID,'equipmentGrant'))captureEquipmentUsage(item).catch(console.error);});
 Hooks.on('dnd5e.restCompleted',async(actor,result,config)=>{
  if(!actor.isOwner)return;
  const isLong=result?.longRest??['long','longRest'].includes(config?.type);
  for(const item of actor.items)if(item.getFlag(MODULE_ID,'equipment'))request('rest',{itemUuid:item.uuid,isLong,newDay:!!(result?.newDay??config?.newDay)}).catch(console.error);
 });
}
