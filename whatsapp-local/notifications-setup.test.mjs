import test from 'node:test';
import assert from 'node:assert/strict';
import {publishSalesNotifications} from './notifications-setup.mjs';
test('notification setup publishes while preserving vars, never enabling or paying anything',async()=>{
 const calls=[];const result=await publishSalesNotifications({repositoryRoot:'/fake/repo',log:()=>{},run:(...args)=>{calls.push(args);return {status:0};},request:async url=>{assert.equal(url,'https://lojastreetball.com.br/api/health/notifications');return Response.json({version:'iphone-sales-v2'});}});
 assert.equal(result.version,'iphone-sales-v2');assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['--yes','wrangler@4','deploy','--keep-vars']);
});
test('a failed deploy or old deployed version is never reported as published',async()=>{
 await assert.rejects(publishSalesNotifications({log:()=>{},run:()=>({status:1}),request:()=>assert.fail('must not inspect before deploy')}),/não foi confirmada/);
 await assert.rejects(publishSalesNotifications({log:()=>{},run:()=>({status:0}),request:async()=>Response.json({version:'old'})}),/ainda não foi confirmada/);
});
