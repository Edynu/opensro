import type {FontAtlas} from '@/engine/foundation/rendering/ui-glyphs';
import {titleGlyphs,drawableGlyph} from '@/engine/foundation/rendering/ui-glyphs';
import type {UiQuad,UiRect} from '@/engine/contracts/ui';
export type GuideToken={kind:'text';value:string;color:UiQuad['color']|null;strong:boolean}|{kind:'break'}|{kind:'image';path:string};
// The shipped event articles use SML2 text, strong, font color, BR and images.
// Unsupported markup is rejected, never rendered as text or browser HTML.
export function guideTokens(source:string):readonly GuideToken[]{
 const out:GuideToken[]=[],colors:(UiQuad['color']|null)[]=[null];let strong=0;
 for(const token of source.split(/(<[^>]*>)/).filter(Boolean)){
  if(/^<\/?sml2>$/i.test(token))continue;
  if(/^<br\s*\/?\s*>$/i.test(token)){out.push({kind:'break'});continue;}
  if(token==='<strong>'){strong++;continue;}if(token==='</strong>'){if(--strong<0)throw Error('Unbalanced guide emphasis');continue;}
  if(token==='</font>'){if(colors.length===1)throw Error('Unbalanced guide color');colors.pop();continue;}
  // 840473..8405D2 handles font attributes 0D/0E/0F/04/0A/0B.
  // line_margin (0C) affects paragraphs, but is ignored on a font scope.
  // The shipped camera descriptions use this exact no-op scope.
  if(/^<font line_margin="\d+">$/i.test(token)){colors.push(colors.at(-1)!);continue;}
  const color=/^<font color="(\d+),(\d+),(\d+),(\d+)">$/i.exec(token);
  if(color){const [a,r,g,b]=color.slice(1).map(Number);if([a,r,g,b].some(n=>n!>255))throw Error('Invalid guide color');colors.push([r!/255,g!/255,b!/255,a!/255]);continue;}
  const image=/^<img src="(interface\\[a-z0-9_\\.-]+\.ddj)"\s*>$/i.exec(token);
  if(image){if(image[1]!.includes('..'))throw Error('Invalid guide image');out.push({kind:'image',path:'/assets/images/Media_extracted/'+image[1]!.replaceAll('\\','/').replace(/\.ddj$/i,'.png')});continue;}
  if(token.startsWith('<'))throw Error('Unsupported guide markup: '+token);
  out.push({kind:'text',value:token.replace(/\r?\n/g,' '),color:colors.at(-1)!,strong:strong>0});
 }
 if(strong||colors.length!==1)throw Error('Unbalanced guide markup');return out;
}
export function guideContent(atlas:FontAtlas,tokens:readonly GuideToken[],r:UiRect,clip:UiRect,color:UiQuad['color'],size:(path:string)=>readonly[number,number]|undefined){
 const quads:UiQuad[]=[],paths:string[]=[];let x=r[0],y=r[1],line=atlas.fonts['0']!.recordHeight+5;
 const newline=()=>{x=r[0];y+=line;line=atlas.fonts['0']!.recordHeight+5;};
 for(const token of tokens){
  if(token.kind==='break'){newline();continue;}
  if(token.kind==='image'){paths.push(token.path);const extent=size(token.path);if(!extent)continue;const [w,h]=extent;if(x>r[0]&&x+w>r[0]+r[2])newline();quads.push({rect:[x,y,w,h],clip,uv:[0,0,1,1],texture:token.path,color:[1,1,1,1]});x+=w;line=Math.max(line,h+5);continue;}
  const font=atlas.fonts[token.strong?'0:2':'0'];if(!font)throw Error('Missing native emphasis font');
  for(const word of token.value.split(/(\s+)/).filter(Boolean)){
   const width=Array.from(word).reduce((n,c)=>n+(drawableGlyph(font.glyphs,c)?.advanceX??0),0);
   if(x>r[0]&&x+width>r[0]+r[2])newline();if(x===r[0]&&!word.trim())continue;
   quads.push(...titleGlyphs(atlas,word,[x,y,width,font.recordHeight+5],clip,token.color??color,{fontStyle:token.strong?2:0,vAlign:0}));x+=width;
  }
 }
 return {quads,paths,height:y-r[1]+line};
}
