// Condition geometry only. Photo pixels, camera motion and layer placement are
// unchanged. Remove grid-scale noise and bound slopes that stretch triangles.
export function stableSurfaceDepth(input: readonly number[], width: number, height: number, anchorBorder = false) {
  if(input.length!==width*height||width<2||height<2)throw new Error('Invalid surface depth grid');
  const clean=Float64Array.from(input),smooth=new Float64Array(input.length),weights=[1,2,1];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const neighbours:number[]=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)neighbours.push(input[(y+dy)*width+x+dx]);
    neighbours.sort((a,b)=>a-b);const i=y*width+x;
    if(Math.abs(input[i]-neighbours[4])>40)clean[i]=neighbours[4];
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let sum=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const sx=Math.max(0,Math.min(width-1,x+dx)),sy=Math.max(0,Math.min(height-1,y+dy));
      sum+=clean[sy*width+sx]*weights[dx+1]*weights[dy+1];
    }
    smooth[y*width+x]=sum/16;
  }
  // Symmetric upper/lower envelopes avoid favouring the near or far side of an
  // abrupt depth jump. Broad shape and relief remain; only steep steps spread.
  const step=1200/Math.max(width,height),upper=smooth.slice(),lower=smooth.slice();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    for(const j of [x?i-1:-1,y?i-width:-1])if(j>=0){upper[i]=Math.min(upper[i],upper[j]+step);lower[i]=Math.max(lower[i],lower[j]-step);}
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const i=y*width+x;
    for(const j of [x+1<width?i+1:-1,y+1<height?i+width:-1])if(j>=0){upper[i]=Math.min(upper[i],upper[j]+step);lower[i]=Math.max(lower[i],lower[j]-step);}
  }
  const result=Array.from(upper,(value,i)=>(value+lower[i])/2);
  // Preserve mean foreground depth, including its existing orbit pivot.
  const shift=(input.reduce((sum,value)=>sum+value,0)-result.reduce((sum,value)=>sum+value,0))/result.length;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,distance=Math.min(x,y,width-1-x,height-1-y);
    const low=anchorBorder?Math.max(0,128-distance*step):0;
    const high=anchorBorder?Math.min(255,128+distance*step):255;
    result[i]=Math.max(low,Math.min(high,result[i]+shift));
  }
  return result;
}
