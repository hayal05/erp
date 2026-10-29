import { HttpError } from './error.js';
const ALLOWED = [
  ['GET','/api/auth/me'],['POST','/api/auth/logout'],
  ['POST','/api/auth/login'],['POST','/api/auth/password'],
];
export function passwordChangeGate(req,res,next) {
  if(req.user?.role!=='employee' || !req.user.mustChangePassword)return next();
  const path=req.path.replace(/\/$/,'');
  if(ALLOWED.some(([method,url])=>method===req.method&&url===path))return next();
  next(new HttpError(403,'Change your temporary password before continuing','password_change_required'));
}
