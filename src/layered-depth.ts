import { stableSurfaceDepth } from './surface-depth.ts';
// Layered-depth principle: denoise within a surface, never average across an
// occlusion boundary. Independent implementation; no external model/code used.
export function layeredSurfaceDepth(input: readonly number[], width: number, height: number) {
  const clean=Float64Array.from(input), output=new Float64Array(input.length);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const values:number[]=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)values.push(input[(y+dy)*width+x+dx]);
    values.sort((a,b)=>a-b);
    const i=y*width+x;
    if(Math.abs(input[i]-values[4])>40)clean[i]=values[4];
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;let sum=0,weight=0;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const sx=Math.max(0,Math.min(width-1,x+dx)),sy=Math.max(0,Math.min(height-1,y+dy));
      const value=clean[sy*width+sx],delta=value-clean[i];
      const w=Math.exp(-(dx*dx+dy*dy)/4-delta*delta/(2*18*18));
      sum+=w*value;weight+=w;
    }
    output[i]=sum/weight;
  }
  return output;
}

export function crossesDepthBoundary(field: ArrayLike<number>, ids: readonly number[]) {
  const values=ids.map(i=>field[i]);
  return Math.max(...values)-Math.min(...values)>60;
}

// Reuse version 1's bounded-slope geometry only around the boundaries that
// previously lost triangles. Keep the new volume everywhere else.
export function repairedLayerDepth(input:readonly number[],width:number,height:number){
  const field=layeredSurfaceDepth(input,width,height),distance=new Int32Array(field.length).fill(-1),queue:number[]=[];
  const seed=(i:number)=>{if(distance[i]<0){distance[i]=0;queue.push(i);}};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    for(const j of [x+1<width?i+1:-1,y+1<height?i+width:-1])if(j>=0&&Math.abs(field[i]-field[j])>60){seed(i);seed(j);}
  }
  if(!queue.length)return field;
  const safe=stableSurfaceDepth(Array.from(field),width,height),radius=Math.max(4,Math.ceil(Math.max(width,height)*.10));
  for(let head=0;head<queue.length;head++){
    const i=queue[head],x=i%width,y=Math.floor(i/width);
    if(distance[i]>=radius)continue;
    for(const j of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])if(j>=0&&distance[j]<0){distance[j]=distance[i]+1;queue.push(j);}
  }
  return Float64Array.from(field,(value,i)=>{
    if(distance[i]<0)return value;
    const t=distance[i]/radius,weight=1-t*t*(3-2*t);
    return value+(safe[i]-value)*weight;
  });
}
