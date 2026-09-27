// Catalog identity and caller-supplied format arguments stay separate from text.
export interface CatalogMessage {readonly key:string;readonly suffix:string;readonly args?:readonly number[];}
