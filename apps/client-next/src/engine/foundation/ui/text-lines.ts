// Measure with the same bitmap glyph advances used for rendering. Long tokens
// must wrap too (chat links/names and translated tips need not contain spaces).
export function textLines(value:string,width:number,measure:(value:string)=>number,preserveLeadingSpaces=false):string[]{
 const lines:string[]=[];
 for(const paragraph of value.split('\n')){
  const leading=preserveLeadingSpaces?/^[ \t]*/.exec(paragraph)![0]:'';let line=leading;
  for(const token of paragraph.slice(leading.length).split(/(\s+)/)){
   if(!token)continue;
   if(line.trim()&&measure(line+token)>width){lines.push(line.trimEnd());line='';}
   if(!line&&!token.trim())continue;
   for(const char of token){if(line&&measure(line+char)>width){lines.push(line);line='';}line+=char;}
  }
  lines.push(line.trimEnd());
 }
 return lines;
}

// CIFTextBox 5395A0..5395DD: raw LF and backslash+'n' end a logical
// segment; backslash+raw LF is a swallowed source continuation. Do not
// normalize these escapes in the localization owner: other controls have
// different grammars and must retain their original authored text.
export function textBoxParagraphs(value:string):string[] {
 const paragraphs:string[]=[];let paragraph='';
 for(let i=0;i<value.length;i++){
  const char=value[i]!;
  if(char==='\\'&&value[i+1]==='\n'){i++;continue;}
  if(char==='\n'||char==='\\'&&value[i+1]==='n'){paragraphs.push(paragraph);paragraph='';if(char==='\\')i++;}
  else paragraph+=char;
 }
 paragraphs.push(paragraph);return paragraphs;
}

// CIFTextBox 5394A0 + 782AC0 (western word-break mode). Wrapping preserves
// whitespace; continuation spaces are inserted AFTER splitting, as native does.
export function textBoxLines(value:string,width:number,measure:(value:string)=>number,indent=false):string[]{
 const rows:string[]=[],space=measure(' '),prefix=indent?' '.repeat(Math.max(1,space>0?Math.trunc(20/space):1)):'';
 for(const paragraph of textBoxParagraphs(value)){
  const glyphs=Array.from(paragraph);let start=0,continuation=false;
  do {
   let end=start,advance=0,breakAt=-1;
   while(end<glyphs.length){const next=measure(glyphs[end]!);if(end>start&&advance+next>width)break;advance+=next;if(glyphs[end]===' ')breakAt=end+1;end++;}
   if(end<glyphs.length&&breakAt>start)end=breakAt;
   rows.push((continuation?prefix:'')+glyphs.slice(start,end).join(''));start=end;continuation=true;
  }while(start<glyphs.length);
 }
 return rows;
}

// 7824F0 / 7832C0: text boards wrap at glyph boundaries, preserving spaces.
// This differs from paragraph layout used by tooltips and guide prose.
export function textBoardLines(value:string,width:number,measure:(value:string)=>number):string[]{
 const lines:string[]=[];let line='',advance=0;
 for(const glyph of value){
  if(glyph==='\n'){lines.push(line);line='';advance=0;continue;}
  const next=measure(glyph);
  if(advance+next>width){lines.push(line);line='';advance=0;}
  line+=glyph;advance+=next;
 }
 lines.push(line);return lines;
}
