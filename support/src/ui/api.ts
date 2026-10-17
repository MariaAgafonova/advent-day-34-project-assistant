export class ApiError extends Error {constructor(message:string,public code:string,public requestId?:string){super(message);}}
export async function api<T>(path:string,body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(95000)});}
 catch{throw new ApiError('Связь прервалась. Проверьте историю и повторите отправку: дубликата не будет.','network');}
 const result=await response.json() as {error?:{message?:string;code?:string};request_id?:string};
 if(!response.ok)throw new ApiError(result.error?.message||'Не удалось выполнить запрос.',result.error?.code||'unknown',result.request_id);
 return result as T;
}
