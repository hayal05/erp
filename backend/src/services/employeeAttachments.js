import {HttpError} from '../middleware/error.js';
import {validationError} from './dbErrors.js';
import {v} from '../middleware/validate.js';
import {pageSchema} from './sql.js';
export const MAX_ATTACHMENT_BYTES=5*1024*1024;
export const MAX_ATTACHMENT_BASE64=4*Math.ceil(MAX_ATTACHMENT_BYTES/3);
export const attachmentListQuery={...pageSchema,direction:v.enum({required:true,values:['incoming','outgoing']})};
export const attachmentParams={id:v.int({required:true,min:1}),attachmentId:v.int({required:true,min:1})};
const TYPES={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'};
export function parseAttachment(body){
 const b=body??{},fileName=typeof b.fileName==='string'?b.fileName.trim():'';
 if(!['incoming','outgoing'].includes(b.direction))throw validationError({direction:'Choose Incoming or Outgoing'});
 if(!fileName||fileName.length>180||/[\\/\x00-\x1f\x7f]/.test(fileName))throw validationError({fileName:'Use a file name of at most 180 characters without folders or control characters'});
 const extension=fileName.split('.').at(-1).toLowerCase(),mimeType=TYPES[extension];
 if(!mimeType)throw validationError({fileName:'Choose a PDF, Word, Excel, JPG, PNG, GIF or WebP file'});
 const data=b.fileBase64;
 if(typeof data!=='string'||!data.length)throw validationError({fileBase64:'Choose a file'});
 if(data.length>MAX_ATTACHMENT_BASE64)throw new HttpError(413,'Files must be 5 MB or smaller','file_too_large');
 if(data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw validationError({fileBase64:'Invalid file encoding'});
 const bytes=Buffer.from(data,'base64');
 if(bytes.length>MAX_ATTACHMENT_BYTES)throw new HttpError(413,'Files must be 5 MB or smaller','file_too_large');
 if(!bytes.length||bytes.toString('base64')!==data)throw validationError({fileBase64:'Invalid file encoding'});
 const starts=hex=>bytes.subarray(0,hex.length/2).equals(Buffer.from(hex,'hex'));
 const ole=starts('d0cf11e0a1b11ae1'),zip=starts('504b0304');
 const valid=extension==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':['doc','xls'].includes(extension)?ole:
  extension==='docx'?zip&&bytes.includes(Buffer.from('word/')):extension==='xlsx'?zip&&bytes.includes(Buffer.from('xl/')):
  ['jpg','jpeg'].includes(extension)?starts('ffd8ff'):extension==='png'?starts('89504e470d0a1a0a'):
  extension==='gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()):extension==='webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
 if(!valid)throw validationError({fileBase64:'The file content does not match its extension'});
 return {fileName,direction:b.direction,mimeType,extension,bytes,byteSize:bytes.length};
}
export function sendAttachment(res,file,bytes){
 res.set('Content-Type',file.mimeType).set('Content-Disposition',`attachment; filename="download.${file.fileName.split('.').at(-1)}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()]/g,c=>'%'+c.charCodeAt(0).toString(16))}`).set('X-Content-Type-Options','nosniff');
 res.send(bytes);
}
