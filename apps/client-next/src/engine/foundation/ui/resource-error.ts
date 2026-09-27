// Diagnostic text uses the native glyph metrics; long filenames wrap without
// truncating their directory or basename to the text owner's 256-char run cap.
export function resourceErrorLines(message:string,width:number,measure:(value:string)=>number){
 const lines:string[]=[];let line='';
 for(const ch of message.slice(0,2048)){
  if(ch==='\n'){lines.push(line);line='';continue;}
  if(line&&(line.length>=240||measure(line+ch)>width)){lines.push(line);line='';}
  line+=ch;
 }
 if(line)lines.push(line);return lines;
}
