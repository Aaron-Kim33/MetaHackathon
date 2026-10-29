// Keep detected faces internally rigid. This prioritises facial proportions over
// inferred facial relief; the rest of the subject retains its depth geometry.
export function rigidFaceDepth(depth:readonly number[],mask:readonly number[],width:number,height:number){
 if(mask.length!==depth.length||depth.length!==width*height)return [...depth];
 const labels=new Int32Array(depth.length),output=[...depth];let label=0;
 const neighbours=(i:number)=>{const x=i%width,y=Math.floor(i/width);return[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1];};
 for(let i=0;i<depth.length;i++)if(mask[i]>0&&!labels[i]){
  label++;const component=[i];labels[i]=label;
  for(let q=0;q<component.length;q++){const p=component[q];for(const j of neighbours(p))if(j>=0&&mask[j]>0&&!labels[j]){labels[j]=label;component.push(j);}}
  const core=component.filter(p=>mask[p]>=250);
  const values=(core.length?core:component).map(p=>depth[p]).sort((a,b)=>a-b),value=values[Math.floor(values.length/2)];
  // The mask already contains its feather. Never propagate a face target
  // outside it: doing so pulls neck, clavicle and torso toward the head plane.
  for(const p of component){const weight=Math.max(0,Math.min(1,mask[p]/255));output[p]=depth[p]+(value-depth[p])*weight;}
 }
 return output;
}
