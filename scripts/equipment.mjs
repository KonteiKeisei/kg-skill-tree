import { MODULE_ID, activeGM, wrapMethod } from './util.mjs';
import { getTree } from './trees.mjs';
import { currentStats, rulePoints } from './events.mjs';
import { nodeStatus, refundPlan, grantItemData } from './progress.mjs';
import { buildEquipmentGrants, syncEquipmentGrantDefinitions, reconcileEquipmentCastActivities, reconcileEquipmentGrants, removeEquipmentGrants, registerEquipmentGrantHooks, recoverEquipmentResources } from './equipment-grants.mjs';
import {equipmentActors,isEquipmentPile,registerEquipmentTransfers} from './equipment-transfers.mjs';
import {equipmentBonusFormula,registerEquipmentBreakdown} from './equipment-breakdown.mjs';

const CHANNEL = `module.${MODULE_ID}`;
const cache = new Map(), pending = new Map(), queues = new Map(), projections = new WeakMap();
let sequence = 0;
const copy = x => foundry.utils.deepClone(x);
const addBonus=(base,formula)=>{const current=String(base??'').trim();return !current||Number(current)===0?formula:`${current} + ${formula}`;};
export const equipmentItems = actor => [...(actor?.items ?? [])].filter(i => i.getFlag(MODULE_ID, 'equipment')?.instanceId);
export function allEquipmentItems() {
  return [...game.items, ...equipmentActors().flatMap(a => [...a.items])].filter(i => i.getFlag(MODULE_ID, 'equipment')?.instanceId);
}
const marker = item => item?.getFlag(MODULE_ID, 'equipment');
const header = ledger => ledger?.getFlag(MODULE_ID, 'equipmentLedger');
const bondData = page => page?.getFlag(MODULE_ID, 'equipmentBond');
const ledgerFor = async item => marker(item)?.ledgerUuid ? fromUuid(marker(item).ledgerUuid) : null;
const pageFor = (ledger, actor) => actor && ledger?.pages.find(p => bondData(p)?.actorUuid === actor.uuid);
const log = (data, entry) => [...(data.log ?? []), { ...entry, at: Date.now() }].slice(-100);
const writeHeader=(ledger,data)=>{const clean=copy(data);delete clean.grantUsage;return ledger.setFlag(MODULE_ID,'equipmentLedger',clean);};
export function equipmentType(item){return item?.type==='weapon'?'weapon':item?.type==='equipment'&&['light','medium','heavy','shield'].includes(item.system?.type?.value)?'armor':'equipment';}
function assertType(item,tree){assert(equipmentType(item)===(tree.equipmentType||'weapon'),`This ${tree.equipmentType||'weapon'} tree cannot attach to ${equipmentType(item)}.`);}
function assert(ok, message) { if (!ok) throw new Error(message); }
/** An attunement tree makes its physical item magical, without attuning it for its bearer. */
async function configureAttunement(item,tree){
  if(tree.activation?.attuned===false||item.pack)return;
  const properties=new Set(item._source.system.properties??item.system.properties??[]),updates={};
  if(!properties.has('mgc')){properties.add('mgc');updates['system.properties']=[...properties];}
  const attunement=item._source.system.attunement??item.system.attunement;
  if(typeof attunement==='number'){
    if(attunement!==1&&attunement!==2)updates['system.attunement']=1;
  }else if(attunement!=='required')updates['system.attunement']='required';
  if(Object.keys(updates).length)await item.update(updates,{kgstEquipmentProjection:true});
}
export function activation(item, tree) {
  if (!item?.actor) return { active: false, reason: 'Not carried by a character.' };
  if(isEquipmentPile(item.actor))return {active:false,reason:'Stored in an Item Pile.'};
  if (tree.activation?.equipped !== false && !item.system.equipped) return {active:false, reason:'Equip this item.'};
  const attuned = item.system.attuned === true || item.system.attunement === 2;
  if (tree.activation?.attuned !== false && !attuned) return {active:false, reason:'Attune to this item.'};
  return {active:true, reason:'Equipped and attuned requirements met.'};
}
function summary(actor, tree, bond) {
  const stats = { ...progressStats(actor), ...(bond?.stats ?? {}) };
  const earned = tree.rules.reduce((sum, rule) => sum + rulePoints(rule.weaponOnly ? {...rule,event:`weapon:${rule.event}`} : rule, stats, bond?.baseline ?? null), 0) + (bond?.adjust ?? 0);
  const spent = (bond?.owned ?? []).reduce((sum, n) => sum + n.cost, 0);
  return {earned, spent, available: earned - spent};
}
function progressStats(actor) {
  return Object.fromEntries(Object.entries(currentStats(actor)).filter(([k]) => k==='level'||k==='xp'||k.startsWith('class:')));
}
async function view(item, actor, gm = true) {
  const ledger = await ledgerFor(item), meta = header(ledger), tree = getTree(meta?.treeId);
  if (!ledger || !meta || !tree) return null;
  assert(meta.instanceId === marker(item).instanceId && meta.itemUuid === item.uuid, 'Item identity conflict. Use the GM transfer or attach this copy as a new item.');
  const bond = copy(bondData(pageFor(ledger, actor)) ?? {actorUuid:actor?.uuid, owned:[],adjust:0,baseline:progressStats(actor),stats:{}});
  const permanent = meta.permanent ?? [];
  const owned = [...bond.owned, ...permanent.filter(n => !bond.owned.some(b => b.id === n.id))];
  return {tree, state:{...bond,unlocked:true,owned}, summary:summary(actor,tree,bond), permanent:copy(permanent), ...activation(item,tree),
    ledger: gm ? { uuid:ledger.uuid, flags:copy(ledger.flags), pages:ledger.pages.map(p => ({flags:copy(p.flags)})) } : null};
}
export async function equipmentView(item, actor = item?.actor) {
  if (!item || !marker(item)) return null;
  if (game.user.isGM) return view(item, actor);
  const result = await equipmentRequest('view', {itemUuid:item.uuid});
  cache.set(item.uuid, result);
  return result;
}
async function ensureBond(ledger, actor, tree) {
  let page = pageFor(ledger,actor);
  if (!page) {
    [page] = await ledger.createEmbeddedDocuments('JournalEntryPage', [{name:actor.name,type:'text',text:{content:''},flags:{[MODULE_ID]:{equipmentBond:{actorUuid:actor.uuid,owned:[],adjust:0,baseline:progressStats(actor),stats:{},log:[]}}}}]);
  }
  return page;
}
export async function equipmentRequest(action, args = {}) {
  const requestId = args.requestId || `${game.user.id}-${Date.now()}-${++sequence}`;
  if (game.user.isGM && activeGM()?.id === game.user.id) return dispatch(action,{...args,requestId},game.user);
  assert(activeGM(), 'An active GM is required for equipment tree operations.');
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Equipment tree request timed out. Re-open the tree before retrying.'));},20000);
    pending.set(requestId,{resolve,reject,timer});
    // Foundry's document hooks include the server-authenticated acting user. Raw module sockets do not.
    ChatMessage.implementation.create({content:`Equipment tree: ${action}`,whisper:[game.user.id,activeGM().id],flags:{[MODULE_ID]:{equipmentRequest:{action,args:{...args,requestId}}}}})
      .catch(err=>{clearTimeout(timer);pending.delete(requestId);reject(err);});
  });
}
async function dispatch(action,args,user) {
  const item = await fromUuid(args.itemUuid);
  assert(item?.documentName === 'Item' && !item.pack, 'Select a physical world or character item.');
  assert(user?.active && (user.isGM || item.actor?.testUserPermission(user,action==='view'?'OBSERVER':'OWNER')), 'You do not own this item.');
  if (action === 'view') return view(item,item.actor,user.isGM);
  const key=action==='recover' ? header(await fromUuid(args.ledgerUuid))?.instanceId : marker(item)?.instanceId || item.uuid;
  const work=(queues.get(key) ?? Promise.resolve()).catch(()=>{}).then(()=>mutate(action,args,user,item));
  queues.set(key,work);try{return await work;}finally{if(queues.get(key)===work)queues.delete(key);}
}
async function mutate(action,args,user,item) {
  if(action==='recover') {
    assert(user.isGM,'Only the GM can recover an equipment record.');assert(!marker(item),'Detach this item before recovering another identity.');
    const ledger=await fromUuid(args.ledgerUuid);await recover(ledger);const meta=copy(header(ledger));
    assert(meta&&getTree(meta.treeId),'Select a valid equipment record with an existing tree.');
    assertType(item,getTree(meta.treeId));
    assert(!await fromUuid(meta.itemUuid),'That physical item still exists. Transfer it instead of restoring its identity onto a copy.');
    await item.setFlag(MODULE_ID,'equipment',{instanceId:meta.instanceId,ledgerUuid:ledger.uuid,treeId:meta.treeId});
    meta.itemUuid=item.uuid;meta.archived=false;meta.revision++;await writeHeader(ledger,meta);
    if(item.actor)await ensureBond(ledger,item.actor,getTree(meta.treeId));await changed(item);return view(item,item.actor);
  }
    if (action === 'attach') {
    assert(user.isGM,'Only the GM can attach equipment trees.');
    const tree=getTree(args.treeId);assert(tree?.kind === 'equipment','Select an equipment tree.');
    assertType(item,tree);
    assert(!marker(item),'This physical item already has a tree. Detach it first to archive its progress.');
    await configureAttunement(item,tree);
    if(args.name!==undefined){assert(typeof args.name==='string'&&args.name.trim(),'Enter an item name.');await item.update({name:args.name.trim()});}
    let folder=game.folders.find(f=>f.type==='JournalEntry'&&f.getFlag(MODULE_ID,'equipmentRecords'));
    if(!folder)folder=await Folder.implementation.create({name:'KG Equipment Records',type:'JournalEntry',flags:{[MODULE_ID]:{equipmentRecords:true}}});
    const instanceId=foundry.utils.randomID(), ledger = await JournalEntry.implementation.create({name:`[Skill Tree] ${item.name}`,folder:folder.id,ownership:{default:0},flags:{[MODULE_ID]:{equipmentLedger:{version:1,instanceId,treeId:tree.id,itemUuid:item.uuid,revision:0,permanent:[],transactions:[]}}}});
    await item.setFlag(MODULE_ID,'equipment',{instanceId,ledgerUuid:ledger.uuid,treeId:tree.id});
    if (item.actor) await ensureBond(ledger,item.actor,tree);
    await changed(item);return view(item,item.actor);
  }
  const ledger=await ledgerFor(item);
  if(action==='detach'&&user.isGM&&(!ledger||!header(ledger)||!getTree(header(ledger)?.treeId))){await removeEquipmentGrants(marker(item).instanceId);await item.unsetFlag(MODULE_ID,'equipment');await changed(item);return true;}
  await recover(ledger);
  const meta=copy(header(ledger)), tree=getTree(meta?.treeId);
  assert(ledger && meta && tree,'Equipment tree record is missing.');
  assert(meta.itemUuid === item.uuid,'Duplicate identity detected. Attach this copy as a new physical item.');
  if ((meta.transactions ?? []).includes(args.requestId)) return {duplicate:true};
  if (action === 'transfer') {
    const target=await fromUuid(args.targetActorUuid);assert(target?.documentName==='Actor','Choose an actor.');
    assert(user.isGM||target.testUserPermission(user,'OWNER'),'You must own the destination actor. Use Send or Item Piles to give equipment to another player.');
    assert(target !== item.actor,'This actor already holds the item.');
    const data=item.toObject();delete data._id;delete data.folder;data.system.equipped=false;
    if ('attuned' in data.system) data.system.attuned=false;
    if ('attunement' in data.system && typeof data.system.attunement==='number') data.system.attunement=data.system.attunement ? 1 : 0;
    let moved;
    try {
      [moved]=await target.createEmbeddedDocuments('Item',[data],{kgstTransfer:true});
      assert(moved,'Destination item creation was cancelled.');
      meta.itemUuid=moved.uuid;meta.revision++;meta.transactions=[...(meta.transactions??[]),args.requestId].slice(-200);
      await writeHeader(ledger,meta);
      await item.delete({kgstTransfer:true});
      assert(!(item.actor?.items.get(item.id)||game.items.get(item.id)),'Source item deletion was cancelled. The transfer was rolled back.');
    } catch(err) {
      if(moved && (item.actor?.items.get(item.id)||game.items.get(item.id))) {meta.itemUuid=item.uuid;meta.transactions=meta.transactions.filter(id=>id!==args.requestId);await writeHeader(ledger,meta);await moved.delete({kgstTransfer:true});}
      throw err;
    }
    await ensureBond(ledger,target,tree);await changed(moved);return {itemUuid:moved.uuid};
  }
  if (action === 'detach') {
    assert(user.isGM,'Only the GM can detach equipment trees.');
    await removeEquipmentGrants(marker(item).instanceId);await reconcileEquipmentCastActivities(item,{active:false});await item.unsetFlag(MODULE_ID,'equipment');meta.archived=true;await writeHeader(ledger,meta);await changed(item);return true;
  }
  assert(item.actor && !item.actor.isToken,'Equipment progress requires a world actor in this test build.');
  if(action==='rest'){await recoverEquipmentResources(ledger,item.actor,args);return true;}
  const actor=item.actor,page=await ensureBond(ledger,actor,tree),bond=copy(bondData(page));
  const result=await view(item,actor), node=tree.nodes[args.nodeId];
  if (action === 'award') {
    assert(user.isGM,'Only the GM can award equipment points.');assert(Number.isFinite(Number(args.amount)),'Enter a point amount.');
    bond.adjust+=Number(args.amount);bond.log=log(bond,{type:'award',amount:Number(args.amount),by:user.id});
  } else if(action === 'count') {
    assert(result.active,'Equipment events only count while active.');
    const allowed=new Set(['attack','crit','damage','skill','tool','save','check','spell','shortRest','longRest','combat','defeat','nat20','nat1','milestone']);
    for(const [key,value] of Object.entries(args.deltas??{})) {if(!allowed.has(key.split(':')[0]))continue;assert(Number.isFinite(value) && value>=0 && value<=100000,'Invalid event count.');bond.stats[key]=(bond.stats[key]??0)+value;
      if(args.sourceItemUuid===item.uuid&&['attack','crit','damage','nat20','nat1'].includes(key))bond.stats[`weapon:${key}`]=(bond.stats[`weapon:${key}`]??0)+value;
    }
  } else if(action === 'buy'||action === 'grant') {
    const gmGrant=action==='grant';if(gmGrant)assert(user.isGM,'Only the GM can grant equipment nodes.');
    assert(node,'Node not found.');
    assert(tree.equipmentType==='weapon'||!node.enhancements.some(e=>e.target==='weapon'),'This node contains weapon-only enhancements on a nonweapon tree. Edit the node before purchasing.');
    const status=nodeStatus(actor,tree,result.state,node.id,result.summary);
    assert(!status.owned,'This node is already unlocked.');
    if(!gmGrant)assert(status.available,'Requirements not met or insufficient equipment points.');
    const grants=await buildEquipmentGrants(node);
    const cost=gmGrant&&args.free!==false?0:node.cost;
    const purchase={id:node.id,token:foundry.utils.randomID(),cost,at:Date.now(),by:user.id,actorUuid:actor.uuid,requestId:args.requestId,grants,
      ...(gmGrant?{gm:true,free:cost===0,level:Math.max(0,Math.floor(Number(args.level)||progressStats(actor).level||0)),note:String(args.note??'').trim()}: {})};
    if(node.ownership==='permanent')meta.permanent.push(purchase);
    bond.owned.push(purchase);bond.log=log(bond,{type:gmGrant?'grant':'buy',node:node.id,cost,by:user.id,...(gmGrant?{level:purchase.level,note:purchase.note,text:`GM granted ${node.name}${purchase.note?`: ${purchase.note}`:''}`}:{})});
  } else if(action === 'refund') {
    assert(node,'Node not found.');const purchase=bond.owned.find(n=>n.id===node.id);
    assert(purchase,'Only the purchasing bond can receive a refund.');
    assert(node.ownership!=='permanent'||user.isGM,'Only the GM can refund permanent upgrades.');
    const plan=refundPlan(actor,tree,result.state,node.id,{gm:user.isGM});assert(plan.ok && !plan.extra.length,'Refund dependent nodes first.');
    if(node.ownership==='permanent') {
      for(const p of ledger.pages){const b=bondData(p);if(b && b.actorUuid!==actor.uuid){
        const remaining=new Set([...b.owned,...meta.permanent].filter(x=>x.id!==node.id).map(x=>x.id));
        for(const own of b.owned){const n=tree.nodes[own.id];const required=Object.values(tree.links).filter(l=>l.kind==='require'&&l.to===own.id).map(l=>l.from);if(required.includes(node.id)&&!(n?.requireMode==='any'&&required.some(id=>remaining.has(id))))throw new Error('Another bond depends on this permanent node. Refund its dependents first.');}
      }}
      meta.permanent=meta.permanent.filter(n=>n.id!==node.id);
    }
    const spentAfter=bond.owned.filter(n=>n.id!==node.id).reduce((s,n)=>s+n.cost,0);
    assert(!bond.owned.some(o=>o.id!==node.id&&(tree.nodes[o.id]?.minSpent??0)>spentAfter),'Another personal node requires these spent points. Refund it first.');
    bond.owned=bond.owned.filter(n=>n.id!==node.id);bond.log=log(bond,{type:'refund',node:node.id});
  } else throw new Error('Unknown equipment operation.');
  // Header transaction envelope is authoritative, including the pending bond. Recovery can replay it once.
  meta.revision++;meta.transactions=[...(meta.transactions??[]),args.requestId].slice(-200);meta.pending={pageId:page.id,bond};
  await writeHeader(ledger,meta);
  await page.setFlag(MODULE_ID,'equipmentBond',bond);
  meta.pending=null;await writeHeader(ledger,meta);
  await changed(item);return view(item,actor,user.isGM);
}
async function changed(item) {
  if(item.actor&&!isEquipmentPile(item.actor)){const ledger=await ledgerFor(item),tree=getTree(header(ledger)?.treeId);if(ledger&&tree)await ensureBond(ledger,item.actor,tree);}
  cache.delete(item.uuid);game.socket.emit(CHANNEL,{kind:'equipment-changed',itemUuid:item.uuid});
  await refreshEquipment();Hooks.callAll(`${MODULE_ID}.equipmentChanged`,item);
}
let refreshQueue=Promise.resolve();
export function refreshEquipment(){const work=refreshQueue.catch(()=>{}).then(refreshEquipmentNow);refreshQueue=work;return work;}
async function refreshEquipmentNow() {
  if(activeGM()?.id===game.user.id)for(const item of allEquipmentItems())try{
    const ledger=await ledgerFor(item),tree=getTree(header(ledger)?.treeId);
    if(ledger&&tree&&header(ledger).itemUuid===item.uuid){
      await configureAttunement(item,tree);
      try{await syncEquipmentGrantDefinitions(ledger,tree);}catch(err){console.warn('Equipment grant source unavailable; retaining saved rewards.',err);}
    }
    await reconcileEquipmentGrants(item,await view(item,item.actor));
  }catch(err){console.warn('Equipment grant reconciliation',err);}
  for(const actor of equipmentActors()) {
    if(!game.user.isGM&&!actor.testUserPermission(game.user,'OBSERVER'))continue;
    if(!equipmentItems(actor).length && !(projections.get(actor)?.length))continue;
    for(const item of equipmentItems(actor)) {
      try{cache.set(item.uuid,await equipmentView(item,actor));}catch(err){console.warn('Equipment view unavailable; keeping last confirmed projection.',err.message);}
    }
    actor.reset();
  }
  for(const app of foundry.applications.instances.values())if(app.constructor?.name==='EquipmentViewer'&&app.rendered)app.render();
}

/** Apply derived bonuses after dnd5e's normal preparation. No base values are persisted. */
export function resolvedEnhancements(info,actor){
  const families=new Map();
  for(const own of [...info.state.owned].sort((a,b)=>(a.at??0)-(b.at??0)))for(const e of info.tree.nodes[own.id]?.enhancements??[]){
    if(e.target==='weapon'&&info.tree.equipmentType!=='weapon')continue;
    const selected=e.keys?.length?e.keys:e.key?[e.key]:[''];
    const keys=selected.includes('all')?(e.kind==='save'?Object.keys(actor.system.abilities):e.kind==='check'?[...Object.keys(actor.system.skills),...Object.keys(actor.system.abilities)]:[]):selected;
    for(const key of keys){
      const family=[e.target,e.kind,e.group||'',key,e.damageType||''].join(':');
      const previous=families.get(family);
      const source={node:info.tree.nodes[own.id]?.name??'Equipment enhancement',value:String(e.value)};
      const cumulative=previous&&e.stacking!=='replace';
      families.set(family,{...e,key,value:cumulative?`(${previous.value}) + (${e.value})`:String(e.value),sources:[...(cumulative?previous.sources:[]),source]});
    }
  }
  return [...families.values()];
}
function project(actor) {
  const changes=[];projections.set(actor,changes);
  const write=(obj,key,value)=>{changes.push({obj,key,before:obj[key],after:value});obj[key]=value;};
  for(const item of equipmentItems(actor)) {
    const info=cache.get(item.uuid);if(!info?.tree||!activation(item,info.tree).active)continue;
    for(const e of resolvedEnhancements(info,actor)) {
      const raw=String(e.value??'0');let value=0;
      try { const roll=new Roll(raw,actor.getRollData());if(!roll.isDeterministic)continue;value=roll.evaluateSync().total; }catch{continue;}
      if(!Number.isFinite(value))continue;
      const formula=equipmentBonusFormula(e,item,actor);
      if(e.target==='actor') {
        if(e.kind==='ac') write(actor.system.attributes.ac,'value',actor.system.attributes.ac.value+value);
        else if(e.kind==='save'&&actor.system.abilities[e.key]) {
          const a=actor.system.abilities[e.key];
          if(a.save&&typeof a.save==='object') {write(a.save.roll,'bonus',addBonus(a.save.roll.bonus,formula));write(a.save,'bonus',(Number(a.save.bonus)||0)+value);write(a.save,'value',(Number(a.save.value)||0)+value);}
          else {write(a,'save',(Number(a.save)||0)+value);a.bonuses??={};write(a.bonuses,'save',addBonus(a.bonuses.save,formula));}
        } else if(e.kind==='check'&&actor.system.abilities[e.key]) {
          const a=actor.system.abilities[e.key];
          if(a.check&&typeof a.check==='object'){write(a.check.roll,'bonus',addBonus(a.check.roll.bonus,formula));write(a.check,'bonus',(Number(a.check.bonus)||0)+value);write(a.check,'value',(Number(a.check.value)||0)+value);}
          else {a.bonuses??={};write(a.bonuses,'check',addBonus(a.bonuses.check,formula));if(typeof a.checkBonus==='number')write(a,'checkBonus',a.checkBonus+value);}
        } else if(e.kind==='check'&&actor.system.skills[e.key]) {
          const s=actor.system.skills[e.key];
          if(s.roll&&'bonus' in s.roll)write(s.roll,'bonus',addBonus(s.roll.bonus,formula));
          else {s.bonuses??={};write(s.bonuses,'check',addBonus(s.bonuses.check,formula));}
          if(typeof s.passive==='number')write(s,'passive',s.passive+value);
          if(typeof s.total==='number')write(s,'total',s.total+value);
        }
      } else {
        for(const act of item.system.activities?.values?.()??[]) {
          if(e.kind==='attack'&&act.type==='attack')write(act.attack,'bonus',addBonus(act.attack.bonus,formula));
        }
      }
    }
  }
}

export function registerEquipment() {
  registerEquipmentBreakdown();
  registerEquipmentGrantHooks(equipmentRequest);
  registerEquipmentTransfers({request:equipmentRequest,changed});
  wrapMethod('CONFIG.Actor.documentClass.prototype.prepareData',function(wrapped,...args){for(const c of (projections.get(this)??[]).slice().reverse())if(c.obj[c.key]===c.after)c.obj[c.key]=c.before;projections.delete(this);const result=wrapped(...args);if(game.ready)try{project(this);}catch(err){console.error('KG equipment projection',err);}return result;});
  // Flat or dice damage is injected into the weapon activity roll only; other weapons never see it.
  Hooks.on('dnd5e.preRollDamageV2',(config,dialog,message)=>{
    const item=config.subject?.item??config.subject?.parent;const info=item&&cache.get(item.uuid);if(config.subject?.type!=='attack'||!info||!activation(item,info.tree).active)return;
    const bonuses=resolvedEnhancements(info,item.actor).filter(e=>e.target==='weapon'&&e.kind==='damage');
    const base=config.rolls?.[0];if(!base)return;
    for(const e of bonuses) {
      const formula=equipmentBonusFormula(e,item,item.actor,{dice:true});
      if(e.damageType)config.rolls.push({...base,parts:[formula],options:{...base.options,type:e.damageType,critical:{...base.options?.critical,bonusDamage:'',bonusDice:0}}});
      else {base.parts??=[];base.parts.push(formula);}
    }
  });
  for(const hook of ['createItem','updateItem','deleteItem'])Hooks.on(hook,(item,changes,options)=>{
    if(!game.ready)return;
    if(marker(item)){
      if(hook==='deleteItem'&&!changes?.kgstTransfer&&activeGM()?.id===game.user.id)removeEquipmentGrants(marker(item).instanceId).catch(console.error);
      scheduleRefresh();
    }
  });
  Hooks.on(`${MODULE_ID}.counted`,(actor,deltas,context={})=>{
    if(!actor.isOwner)return;
    for(const item of equipmentItems(actor)) {
      const info=cache.get(item.uuid);if(info&&activation(item,info.tree).active&&info.tree.rules.some(r=>r.event!=='level'&&r.event!=='classLevel'&&r.event!=='xp'))equipmentRequest('count',{itemUuid:item.uuid,deltas,sourceItemUuid:context.itemUuid}).catch(()=>{});
    }
  });
  Hooks.once('ready',()=>{
    Hooks.on('createChatMessage',async(message,options,userId)=>{
      const packet=message.getFlag(MODULE_ID,'equipmentRequest');if(!packet||game.user.id!==activeGM()?.id)return;
      try {const result=await dispatch(packet.action,{...packet.args,requestId:`${userId}:${packet.args.requestId}`},game.users.get(userId));await message.setFlag(MODULE_ID,'equipmentResponse',{requestId:packet.args.requestId,result});}
      catch(err){await message.setFlag(MODULE_ID,'equipmentResponse',{requestId:packet.args.requestId,error:err.message});}
    });
    Hooks.on('updateChatMessage',(message,changes,options,userId)=>{
      if(userId!==activeGM()?.id)return;
      const response=message.getFlag(MODULE_ID,'equipmentResponse');const p=response&&pending.get(response.requestId);if(!p)return;
      clearTimeout(p.timer);pending.delete(response.requestId);response.error?p.reject(new Error(response.error)):p.resolve(response.result);
    });
    game.socket.on(CHANNEL,async msg=>{
      if(msg.kind==='equipment-changed'){scheduleRefresh();Hooks.callAll(`${MODULE_ID}.equipmentChanged`,await fromUuid(msg.itemUuid));}
    });
    (async()=>{if(game.user.id===activeGM()?.id)for(const ledger of game.journal)await recover(ledger);scheduleRefresh();})().catch(console.error);
  });
  const open=async item=>{const {openEquipmentItem}=await import('./apps/equipment.mjs');return openEquipmentItem(item);};
  Hooks.on('getHeaderControlsItemSheetV2',(app,controls)=>controls.push({label:'Skill Tree',icon:'fa-solid fa-diagram-project',onClick:()=>open(app.document)}));
  Hooks.on('getItemSheetHeaderButtons',(app,controls)=>controls.unshift({label:'Skill Tree',class:'kgst-item-tree',icon:'fas fa-diagram-project',onclick:()=>open(app.object)}));
}
let timer;
function scheduleRefresh(){clearTimeout(timer);timer=setTimeout(()=>refreshEquipment().catch(err=>console.warn('KG equipment refresh',err)),200);}
async function recover(ledger){
  const h=header(ledger);if(!h?.pending)return;
  const p=ledger.pages.get(h.pending.pageId);assert(p,'Pending equipment transaction needs its missing bond page restored.');
  await p.setFlag(MODULE_ID,'equipmentBond',h.pending.bond);
  const clean=copy(h);clean.pending=null;await writeHeader(ledger,clean);
}
