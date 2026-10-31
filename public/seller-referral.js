(function(root){
'use strict';
const KEY='streetball_seller_referral_v1';
const MAX_AGE=30*24*60*60*1000;
const DOMAIN='https://lojastreetball.com.br/';
function normalizeCode(value){
 const code=typeof value==='string'?value.trim().toUpperCase():'';
 return /^[A-Z0-9_-]{2,32}$/.test(code)?code:'';
}
function shareUrl(code){
 const valid=normalizeCode(code);
 return valid?DOMAIN+'?cupom='+encodeURIComponent(valid):'';
}
function codeFromUrl(input){
 try{
  const url=new URL(input,DOMAIN);
  const present=url.searchParams.has('cupom');
  return {present,code:present?normalizeCode(url.searchParams.get('cupom')):''};
 }catch{return {present:false,code:''};}
}
function forget(storage){try{storage?.removeItem(KEY);}catch{}}
function remember(storage,code,now=Date.now()){
 const value=normalizeCode(code);if(!value)return false;
 try{storage?.setItem(KEY,JSON.stringify({code:value,expiresAt:now+MAX_AGE}));return true;}catch{return false;}
}
function getSaved(storage,now=Date.now()){
 try{
  const data=JSON.parse(storage?.getItem(KEY)||'null');
  const code=normalizeCode(data?.code);
  if(code&&Number.isFinite(data?.expiresAt)&&data.expiresAt>now&&data.expiresAt<=now+MAX_AGE)return code;
 }catch{}
 forget(storage);return '';
}
root.StreetballSellerLinks=Object.freeze({normalizeCode,shareUrl,codeFromUrl,getSaved,remember,forget});
})(globalThis);
