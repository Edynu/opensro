// 0x8EADF0 -> 0x8E7150 resolves the weapon set first, then DEFAULT for the
// same native state. Missing state zero is legal in many weapon sets.
export function previewIdle(clips:readonly string[],set:string,deletePending:boolean){
 const role=deletePending?'charselect-state14':'preview-state0-'+set.toLowerCase().replace(/[^a-z0-9]+/g,'-');
 if(clips.includes(role))return role;
 if(!deletePending&&clips.includes('stand'))return 'stand';
 throw Error('Missing native preview state '+role);
}
