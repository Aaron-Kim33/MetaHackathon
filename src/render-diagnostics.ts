import {initialConnection,request} from './client';
import type {Connection} from './client';
export function reportSpatialDiagnostic(event:string,details:Record<string,string|number|boolean>,connection:Connection=initialConnection) {
  void request(connection,'/diagnostics/spatial',{event,details}).catch(()=>{});
}
export function reportCutoutDiagnostic(event:string,details:Record<string,string|number|boolean>,connection:Connection=initialConnection) {
  void request(connection,'/diagnostics/cutout',{event,details}).catch(()=>{});
}
