// v1.150 constructor admission. A resinfo file is not a display list: these
// sections describe mutually exclusive children and separately created dialogs.
export function nativeWindowSections(name:string):readonly string[]|undefined {
 switch(name){
  case 'ifitemmallconfirmbuy':case 'ifitemmallconfirmslot':return ['Create']; // 6C0540 / 6BF320
  case 'ifmessagebox':return ['Create','MsgBoxStore','MsgBoxStoreConfirm']; // 528430 / 52A2D0; renderer admits one modal branch.
  case 'ifapprenticeship':return ['Create','NotifySubBox','NotifyContents']; // 5C5B60
  case 'ifskill':return ['Create','MainSkillWnd'];
  case 'ifguild':return ['Create','GuildInfo','NotifySubBox','MemberView','Command','SortBtn']; // 5EA9D0
  case 'ifcos':case 'ifcosinventory':return ['Create']; // 6A13B0, 6A9420
  default:return undefined;
 }
}
