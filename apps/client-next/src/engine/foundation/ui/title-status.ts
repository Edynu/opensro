// Internal title opcode 0xff3, sub_749550. Transport failures stay distinct
// from native credential failures; there is no invented retry count.
export function titleStatusKey(status:number|undefined,argument?:number):string|undefined {
 switch(status){
  case 2:return argument===undefined?"UIO_MSG_ERROR_PASSWORD":"UIIT_STT_GLOBAL_PASSWORD_INPUT_ERROR";
  case 3:return argument===1?"UIO_MSG_ERROR_ACCOUNT_STOP":argument===2?"UIO_MSG_ERROR_ACCOUNT_CONNECT_IMPOSSIBILE":argument===3?"UIO_MSG_ERROR_THERE_IS_NO_ACCOUNT_INFO":argument===4?"UIO_MSG_ERROR_GRATIS_USER_BLOCKED":undefined;
  case 4:return "UIO_MSG_ERROR_OVERLAP";
  case 6:return "UIO_MSG_ERROR_SERVER_BUSY_CONNECT_IMPOSSIBILE";
  case 5:case 7:case 8:case 9:case 10:return "UIO_MSG_ERROR_SEVER_CONNECT";
  case 11:return "UIO_MSG_ERROR_CONTENT_FAIL_INSUFFICIENT_IP";
  case 12:return "UIIO_CLIENT_START_CONTENT_FAIL_BILLING_FAILED";
  case 13:return "UIIO_CLIENT_START_CONTENT_FAIL_BILLING_RELATED";
  case 14:return "UIIO_SMERR_ADULT_ONLY_SERVER";
  case 15:return "UIIO_SMERR_TEENOVER_ONLY_SERVER";
  case 16:return "UITT_TEENSERVER_ERRMGS_ADULT";
 }
}
export function titleStatusMessage(status:number|undefined,argument:number|undefined,resolve:(key:string)=>string):string|undefined {
 const key=titleStatusKey(status,argument);if(!key)return;
 let message=resolve(key);
 if(status===2&&argument!==undefined){const values=[argument&0xffff,argument>>>16];let index=0;message=message.replace(/%d/g,()=>String(values[index++]));}
 if(status===5||status===7||status===8||status===9||status===10)message+=`(C${status})`;
 return message;
}
