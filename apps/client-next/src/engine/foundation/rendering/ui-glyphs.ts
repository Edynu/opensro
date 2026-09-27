import type {UiQuad,UiRect} from "@/engine/contracts/ui";
export interface Glyph {x:number;y:number;width:number;height:number;originX:number;originY:number;advanceX:number}
export interface FontAtlas {image:string;atlasWidth:number;atlasHeight:number;fonts:Record<string,{recordHeight:number;ascent:number;descent:number;glyphs:Record<string,Glyph>}>}
export interface GlyphStyle {fontIndex?:number;fontStyle?:number;hAlign?:number;vAlign?:number;overflow?:'ellipsis'|'clip'|'avoid-overlap'}
// C0/C1 controls are layout directives, never drawable glyphs. Native
// CTextBoard breaks or skips them; baking the '?' replacement quad for a
// newline (as shipped guide START strings contain) invents visible glyphs.
export function drawableGlyph(glyphs:Record<string,Glyph>,c:string):Glyph|null{
 const code=c.codePointAt(0)!;
 if(code<32||(code>=0x7F&&code<=0x9F))return null;
 return glyphs[String(code)]??glyphs['63']!;
}
export function decodeUiFont(value:unknown):FontAtlas {
 const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
 const integer=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v))throw Error('Invalid retail font metric');return v;};
 if(!record(value)||typeof value.image!=='string'||!value.image.startsWith('/assets/fonts/')||!record(value.fonts))throw Error('Invalid retail font atlas');
 const atlasWidth=integer(value.atlasWidth),atlasHeight=integer(value.atlasHeight),fonts:FontAtlas['fonts']={};
 if(atlasWidth<1||atlasHeight<1||atlasWidth>8192||atlasHeight>8192)throw Error('Invalid retail font atlas extent');
 const variants=Object.entries(value.fonts).flatMap(([index,font])=>[[index,font],...(record(font)&&record(font.styles)&&font.styles['2']?[[index+':2',font.styles['2']]]:[])] as [string,unknown][]);
 for(const [index,font]of variants){
  if(!record(font)||!record(font.glyphs))throw Error('Invalid retail font');
  const recordHeight=integer(font.recordHeight),ascent=integer(font.ascent),descent=integer(font.descent),glyphs:Record<string,Glyph>={};
  if(recordHeight<1||recordHeight>256)throw Error('Invalid retail font height');
  for(const [code,g]of Object.entries(font.glyphs)){
   if(!record(g))throw Error('Invalid retail glyph');
   const glyph={x:integer(g.x),y:integer(g.y),width:integer(g.width),height:integer(g.height),originX:integer(g.originX),originY:integer(g.originY),advanceX:integer(g.advanceX)};
   if(glyph.x<0||glyph.y<0||glyph.width<0||glyph.height<0||glyph.advanceX<0||glyph.advanceX>512||glyph.x+glyph.width>atlasWidth||glyph.y+glyph.height>atlasHeight)throw Error('Retail glyph outside atlas');
   glyphs[code]=glyph;
  }
  if(!glyphs['63'])throw Error('Missing retail replacement glyph');
  fonts[index]={recordHeight,ascent,descent,glyphs};
 }
 if(!fonts['0'])throw Error('Missing retail default font');
 return {image:value.image,atlasWidth,atlasHeight,fonts};
}
// The title countdown uses the native SML2 font-color subset. Keep authored
// glyph metrics and color runs; never hand its markup to browser text shaping.
export function titleColoredText(atlas:FontAtlas,value:string,rect:UiRect,clip:UiRect,color:UiQuad['color'],style:GlyphStyle={}):UiQuad[]{
 const font=atlas.fonts[String(style.fontIndex??0)];if(!font)throw Error('Missing retail UI font');
 const colors:UiQuad['color'][]=[color],quads:UiQuad[]=[];let x=rect[0],y=rect[1];
 for(const token of value.split(/(<[^>]+>|\s+)/).filter(Boolean)){
  if(token==='<sml2>'||token==='</sml2>')continue;
  if(token==='</font>'){if(colors.length<2)throw Error('Unbalanced title color');colors.pop();continue;}
  const tag=/^<font color="(\d+),(\d+),(\d+),(\d+)">$/.exec(token);
  if(tag){const [a,r,g,b]=tag.slice(1).map(Number);if([a,r,g,b].some(n=>n!>255))throw Error('Invalid title color');colors.push([r!/255,g!/255,b!/255,a!/255*color[3]]);continue;}
  if(token.startsWith('<'))throw Error('Unsupported title markup');
  const width=Array.from(token).reduce((sum,c)=>sum+(drawableGlyph(font.glyphs,c)?.advanceX??0),0);
  if(x>rect[0]&&x+width>rect[0]+rect[2]){x=rect[0];y+=font.recordHeight+5;}
  if(x===rect[0]&&!token.trim())continue;
  quads.push(...titleGlyphs(atlas,token,[x,y,width,font.recordHeight+5],clip,colors.at(-1)!,{...style,hAlign:0,vAlign:0}));x+=width;
 }
 if(colors.length!==1)throw Error('Unbalanced title color');return quads;
}
export function titleTextBox(atlas:FontAtlas,value:string,rect:UiRect,clip:UiRect,color:UiQuad['color'],style:GlyphStyle={}):UiQuad[]{
 const font=atlas.fonts[String(style.fontIndex??0)];if(!font)throw Error('Missing retail UI font');
 const lines:string[]=[];let line='',width=0;
 for(const word of value.replace(/\r\n?/g,'\n').split(/(\n|[^\S\n]+)/)){
  if(word==='\n'){lines.push(line.trimEnd());line='';width=0;continue;}
   const advance=Array.from(word).reduce((sum,c)=>sum+(drawableGlyph(font.glyphs,c)?.advanceX??0),0);
  if(width+advance>rect[2]&&line){lines.push(line.trimEnd());line='';width=0;}
  if(!line&&!word.trim())continue;line+=word;width+=advance;
 }
 if(line)lines.push(line.trimEnd());
 const lineHeight=font.recordHeight+5;
 return lines.flatMap((text,index)=>titleGlyphs(atlas,text,[rect[0],rect[1]+index*lineHeight,rect[2],lineHeight],clip,color,{...style,vAlign:0}));
}
// Retail CTextBoard: glyph advances, raw font height + 5, integer alignment.
// Sample the published GGO_BITMAP masks directly; browser font shaping differs.
export function titleGlyphs(atlas:FontAtlas,value:string,rect:UiRect,clip:UiRect,color:UiQuad["color"],{fontIndex=0,fontStyle=0,hAlign=0,vAlign=1,overflow='avoid-overlap'}:GlyphStyle={}):UiQuad[]{
 const font=atlas.fonts[String(fontIndex)+(fontStyle===2?':2':'')];
 if(!font)throw Error("Missing retail UI font slot: "+fontIndex);
 let glyphs=Array.from(value,c=>drawableGlyph(font.glyphs,c)).filter((g):g is Glyph=>g!==null);
 // Native 7831D0 uses a glyph-width prefix plus three period glyphs. Plain
 // CIFStatic does not invoke it; applying bounded single-line presentation here
 // is an intentional port overlap repair, shared by authored and manual boxes.
 // Reserve the suffix before fitting; keep the source/semantic text untouched.
 const available=Math.max(0,rect[2]);
 if(overflow==='ellipsis'&&glyphs.reduce((sum,g)=>sum+g.advanceX,0)>available){
  const dot=drawableGlyph(font.glyphs,'.')!,suffix:Glyph[]=[];let used=0;
  for(let i=0;i<3&&used+dot.advanceX<=available;i++){suffix.push(dot);used+=dot.advanceX;}
  const prefix:Glyph[]=[];
  for(const glyph of glyphs){if(used+glyph.advanceX>available)break;prefix.push(glyph);used+=glyph.advanceX;}
  glyphs=prefix.concat(suffix);
 }
 // Horizontal containment includes glyph bearings; keep native vertical line
 // metrics (short statics can be shorter than the font's line box).
 const left=Math.max(clip[0],rect[0]),right=Math.min(clip[0]+clip[2],rect[0]+available);
 if(overflow!=='avoid-overlap')clip=[left,clip[1],Math.max(0,right-left),clip[3]];
 const width=glyphs.reduce((sum,g)=>sum+g.advanceX,0),lineHeight=font.recordHeight+5;
 const offset=(size:number,content:number,align:number)=>align===1?Math.floor((size-content)/2):align===2?Math.floor(size-content):0;
 let x=Math.round(rect[0])+offset(rect[2],width,hAlign);
 const y=Math.round(rect[1])+offset(rect[3],lineHeight,vAlign)+font.ascent;
 const quads=glyphs.map(g=>{const quad:UiQuad={rect:[x+g.originX,y-g.originY,g.width,g.height],uv:[g.x/atlas.atlasWidth,g.y/atlas.atlasHeight,g.width/atlas.atlasWidth,g.height/atlas.atlasHeight],color,texture:atlas.image,clip};x+=g.advanceX;return quad;});
 if(overflow==='ellipsis')return quads;
 const textLayout={box:rect,fitted:overflow==='avoid-overlap'&&width>available?titleGlyphs(atlas,value,rect,clip,color,{fontIndex,fontStyle,hAlign,vAlign,overflow:'ellipsis'}):undefined};
 return quads.map(q=>({...q,textLayout}));
}

// Native statics may grow into unused space. Fit only when that ink would enter
// another disjoint text box on the same row. Overlapping boxes are intentional
// layers, not neighboring columns. Resolve once per complete UI projection.
export function resolveTextOverlaps(quads:readonly UiQuad[]):UiQuad[]{
 const groups=new Map<NonNullable<UiQuad['textLayout']>,UiQuad[]>();
 for(const q of quads)if(q.textLayout&&!q.characterAnchor&&!q.worldAnchor){const run=groups.get(q.textLayout);if(run)run.push(q);else groups.set(q.textLayout,[q]);}
 const fitted=new Set<NonNullable<UiQuad['textLayout']>>();
 for(const [layout,run]of groups){
  if(!layout.fitted)continue;
  const box=layout.box;
  for(const [neighbor]of groups){
   if(neighbor===layout)continue;
   const other=neighbor.box;
   if(!(box[0]+box[2]<=other[0]||other[0]+other[2]<=box[0]))continue;
   if(run.some(q=>Math.max(q.rect[0],q.clip[0],other[0])<Math.min(q.rect[0]+q.rect[2],q.clip[0]+q.clip[2],other[0]+other[2])&&Math.max(q.rect[1],q.clip[1],other[1])<Math.min(q.rect[1]+q.rect[3],q.clip[1]+q.clip[3],other[1]+other[3]))){fitted.add(layout);break;}
  }
 }
 const emitted=new Set<NonNullable<UiQuad['textLayout']>>(),result:UiQuad[]=[];
 for(const q of quads){
  if(q.textLayout&&fitted.has(q.textLayout)){
   if(!emitted.has(q.textLayout)){const {textLayout,...paint}=q;result.push(...textLayout.fitted!.map(f=>({...paint,...f,color:paint.color})));emitted.add(q.textLayout);}
  }else{const {textLayout,...paint}=q;result.push(paint);}
 }
 return result;
}
