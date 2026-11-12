import {pbkdf2Async} from '@noble/hashes/pbkdf2';
import {sha256} from '@noble/hashes/sha256';

// Cloudflare production rejects native PBKDF2 above 100,000 iterations.
// Tag new hashes so the original 140,000-iteration records remain verifiable.
const ITERATIONS=100000;
const PREFIX='pbkdf2-sha256$100000$';
const HEX=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const sameHash=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
};
async function currentHash(password,salt){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:ITERATIONS,hash:'SHA-256'},key,256);
 return hex(bits);
}
export async function hashCustomerPassword(password,salt){
 return PREFIX+await currentHash(password,salt);
}
export async function verifyCustomerPassword(password,salt,storedHash){
 if(typeof storedHash==='string'&&HEX.test(storedHash)){
  // Preserve the exact original PBKDF2-SHA256 result, including UTF-8 salt
  // encoding, without calling the unsupported native operation. Google-only
  // accounts also have a random, unusable legacy hash and cannot pass this check.
  const bytes=await pbkdf2Async(sha256,encoder.encode(password),encoder.encode(salt),{c:140000,dkLen:32});
  return sameHash(hex(bytes),storedHash);
 }
 const expected=typeof storedHash==='string'&&storedHash.startsWith(PREFIX)?storedHash.slice(PREFIX.length):'';
 // Unknown accounts and invalid records still perform the normal password work.
 const given=await currentHash(password,salt);
 return HEX.test(expected)&&sameHash(given,expected);
}
