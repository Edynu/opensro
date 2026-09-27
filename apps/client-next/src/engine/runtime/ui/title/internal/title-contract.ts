export interface TitleNode {id:number;name:string;rect:{x:number;y:number;width:number;height:number};clientRect?:{x:number;y:number;width:number;height:number};ddj?:{publicPath:string};text?:string;fontIndex?:number;fontColor?:{r:number;g:number;b:number;a:number};hAlign?:number;vAlign?:number;}
export interface TitleLayout {controlsByName:Record<string,TitleNode>;sections:{name:string;nodes:TitleNode[]}[];}
export interface TitleInteraction {hover:string|null;pressed:string|null;focus:string|null;draft:string;offset:number;now:number;message:string;selection?:readonly number[]}
