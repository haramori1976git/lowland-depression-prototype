'use strict';

// Improved Priority-Flood: a binary min-heap for the frontier and a FIFO
// queue for cells flooded at the current spill elevation.
// Finite cells beside missing DEM values are open outlets, as are the edges.
function priorityFlood(values, width, height, onProgress = () => {}) {
  const length = width * height;
  if (values.length !== length || !width || !height) throw Error('DEM dimensions do not match');
  const filled = new Float32Array(length);
  filled.fill(NaN);
  const seen = new Uint8Array(length);
  const heapIndex = new Int32Array(length);
  const heapLevel = new Float32Array(length);
  const pit = new Int32Array(length);
  let heapSize = 0, pitRead = 0, pitWrite = 0, visited = 0, valid = 0, reported = 0;
  function push(index, level) {
    let i = heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapLevel[p] <= level) break;
      heapIndex[i] = heapIndex[p]; heapLevel[i] = heapLevel[p]; i = p;
    }
    heapIndex[i] = index; heapLevel[i] = level;
  }
  function pop() {
    const index = heapIndex[0], level = heapLevel[0];
    const lastIndex = heapIndex[--heapSize], lastLevel = heapLevel[heapSize];
    if (heapSize) {
      let i = 0;
      while (i * 2 + 1 < heapSize) {
        let child = i * 2 + 1;
        if (child + 1 < heapSize && heapLevel[child + 1] < heapLevel[child]) child++;
        if (lastLevel <= heapLevel[child]) break;
        heapIndex[i] = heapIndex[child]; heapLevel[i] = heapLevel[child]; i = child;
      }
      heapIndex[i] = lastIndex; heapLevel[i] = lastLevel;
    }
    return [index, level];
  }
  // Eight-neighbour connectivity: any missing sample is treated as a drain.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, z = values[i];
    if (!Number.isFinite(z)) continue;
    valid++;
    let outlet = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (!outlet) for (let dy = -1; dy <= 1 && !outlet; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && !Number.isFinite(values[i + dy * width + dx])) {outlet = true; break;}
      }
    }
    if (outlet) {seen[i] = 1; filled[i] = z; push(i, z); visited++;}
  }
  if (!valid) throw Error('有効なDEM画素がありません');
  while (heapSize || pitRead < pitWrite) {
    // Pit cells take priority; their filled elevation has already been set.
    const fromPit = pitRead < pitWrite;
    const entry = fromPit ? pit[pitRead++] : pop()[0];
    const level = filled[entry], x = entry % width, y = (entry / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; if ((!dx && !dy) || nx < 0 || nx >= width) continue;
        const n = ny * width + nx, z = values[n];
        if (seen[n] || !Number.isFinite(z)) continue;
        seen[n] = 1; visited++;
        filled[n] = Math.max(level, z);
        if (z <= level) pit[pitWrite++] = n;
        else push(n, z);
      }
    }
    if (visited - reported >= 65536) {reported=visited;onProgress(visited, valid);}
  }
  onProgress(valid, valid);
  return filled;
}


self.onmessage = ({data}) => {
  try {
    const {values, width, height, x0, y0, visible, spacing, slopeLimit, reliefLimit} = data;
    const DEM = new Float32Array(values);
    const filled = priorityFlood(DEM, width, height, (done, total) => {
      self.postMessage({type:'progress', stage:'凹地・出口の探索', done, total});
    });
    const vw = visible.x1 - visible.x0, vh = visible.y1 - visible.y0;
    const depth = new Float32Array(vw * vh);
    const flags = new Uint8Array(vw * vh);
    const slopeSpan = Math.max(1, Math.round(50 / spacing));
    const reliefSpan = Math.max(1, Math.round(150 / spacing));
    const bearings = Array.from({length:16}, (_,i) => [Math.cos(i*Math.PI/8)*reliefSpan, Math.sin(i*Math.PI/8)*reliefSpan]);
    const sample = (x,y) => x<0 || y<0 || x>=width || y>=height ? NaN : DEM[Math.floor(y)*width+Math.floor(x)];
    let colored = 0, mountains = 0, flats = 0, unknown = 0, deepest = 0;
    for (let row = 0; row < vh; row++) {
      const y = visible.y0 + row - y0;
      for (let col = 0; col < vw; col++) {
        const x = visible.x0 + col - x0, i = y*width+x, out = row*vw+col, z = DEM[i];
        if (!Number.isFinite(z)) {unknown++;continue;}
        const east=sample(x+slopeSpan,y),west=sample(x-slopeSpan,y),north=sample(x,y-slopeSpan),south=sample(x,y+slopeSpan);
        if (![east,west,north,south].every(Number.isFinite)) {unknown++;continue;}
        const angle=Math.atan(Math.hypot((east-west)/(2*slopeSpan*spacing),(south-north)/(2*slopeSpan*spacing)))*180/Math.PI;
        let flat=false,classified=false;
        if(angle>slopeLimit)classified=true;
        else {
          let lo=z,hi=z,complete=true;
          for(const [dx,dy] of bearings){const value=sample(x+dx,y+dy);if(!Number.isFinite(value)){complete=false;break;}lo=Math.min(lo,value);hi=Math.max(hi,value);}
          classified=complete;flat=complete && hi-lo<=reliefLimit;
        }
        if(flat){
          flags[out]=1;flats++;
          const d=Math.max(0,filled[i]-z);depth[out]=d;
          if(d>=.5){colored++;deepest=Math.max(deepest,d);}
        }else if(classified){flags[out]=2;mountains++;}
        else unknown++;
      }
      if(row%64===0)self.postMessage({type:'progress',stage:'平地判定',done:row+1,total:vh});
    }
    self.postMessage({type:'result', depth:depth.buffer, flags:flags.buffer, colored,mountains,flats,unknown,deepest, width:vw,height:vh},[depth.buffer,flags.buffer]);
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
