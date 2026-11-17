const PREFIX='Skill Tree: ';
const equipmentNames=new Set();
const clean=text=>String(text??'').replace(/[\[\]\r\n<>]/g,' ').trim();

/** Standard Foundry term flavors also work without a breakdown module installed. */
export function equipmentBonusFormula(enhancement,item,actor,{dice=false}={}){
 const label=clean(item.name);equipmentNames.add(label);
 return (enhancement.sources??[{node:'Equipment enhancement',value:enhancement.value}]).map(source=>{
  let value=source.value;
  if(!dice)value=new Roll(value,actor.getRollData()).evaluateSync().total;
  const expression=dice&&/^\d*d\d+(?:[a-z]+\d*)*$/i.test(String(value).trim())?String(value):`(${value})`;
  return `${expression}[${label}]`;
 }).join(' + ');
}

/** The dnd5e adapter resolves numeric bonuses by actor fields, overriding ordinary flavors. Restore only ours. */
export function labelEquipmentBreakdowns(breakdowns,rolls){
 for(const breakdown of breakdowns??[]){
  const roll=rolls?.[breakdown.rollIndex??0];if(!roll)continue;
  let die=0;
  for(const term of roll.terms??[]){
   const flavor=term.flavor??term.options?.flavor;
   const directDie=typeof term.faces==='number';const dieIndex=directDie?die++:-1;
   const label=term.options?.kgstEquipmentSource??(equipmentNames.has(flavor)?flavor:null)
    ??(typeof flavor==='string'&&flavor.startsWith(PREFIX)?[...equipmentNames].sort((a,b)=>b.length-a.length).find(name=>flavor.startsWith(`${PREFIX}${name}: `)):null);
   if(!label)continue;
   const expression=String(term.formula??term.expression??'').replace(/\s+/g,'');
   const entry=directDie?breakdown.diceTerms?.[dieIndex]:[...(breakdown.modifiers??[]),...(breakdown.computedTerms??[]),...(breakdown.unresolvedTerms??[])].find(e=>String(e.expression??'').replace(/\s+/g,'').includes(expression));
   if(!entry)continue;
   entry.sourceLabel=label;entry.sourceType='item';entry.confidence='exact';
  }
 }
 return breakdowns;
}

export function registerEquipmentBreakdown(){
 Hooks.on('dnd5e.postRollConfiguration',rolls=>{
  for(const roll of [rolls].flat())for(const term of roll?.terms??[]){
   const flavor=term.flavor??term.options?.flavor;
   if(equipmentNames.has(flavor)){term.options??={};term.options.kgstEquipmentSource=flavor;}
  }
 });
 Hooks.once('ready',()=>{
  const module=game.modules.get('sephrals-roll-breakdown'),api=module?.api,adapter=api?.getAdapter?.('dnd5e');
  if(!module?.active)return;
  if(!adapter||typeof api.registerAdapter!=='function'){
   if(game.user.isGM)ui.notifications.warn("Update Sephral's Roll Breakdown to 1.0.19 or newer to identify equipment bonuses in its breakdown.");
   return;
  }
  const wrapped=Object.create(adapter);
  wrapped.buildBreakdowns=async function(message){
   const breakdowns=await adapter.buildBreakdowns(message);
   return labelEquipmentBreakdowns(breakdowns,adapter.getMessageRolls?.(message)??message.rolls);
  };
  api.registerAdapter('dnd5e',wrapped);
 });
}
