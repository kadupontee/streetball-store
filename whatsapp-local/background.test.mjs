import test from 'node:test';
import assert from 'node:assert/strict';
import {enableAndStartService,unloadService} from './background.mjs';

const domain='gui/501',target=domain+'/com.streetball.whatsapp',plist='/Users/Test & Co/Library/LaunchAgents/com.streetball.whatsapp.plist';
const ok={status:0,stdout:''},missing={status:113,stderr:'Could not find specified service'};
const loaded={status:0,stdout:'service = {\n state = waiting\n}'};
const running={status:0,stdout:'service = {\n state = running\n pid = 1234\n}'};

test('starting enables only Streetball before loading and starting an unloaded job',()=>{
  let enabled=false,registered=false,started=false;
  const run=args=>{
    assert.ok(!args.includes('-k'));
    if(args[0]==='enable'){assert.equal(args[1],target);enabled=true;return ok;}
    if(args[0]==='print')return registered?(started?running:loaded):missing;
    if(args[0]==='bootstrap'){assert.equal(enabled,true);assert.deepEqual(args,['bootstrap',domain,plist]);registered=true;return ok;}
    if(args[0]==='kickstart'){assert.equal(registered,true);started=true;return ok;}
    assert.fail('Unexpected launchctl command');
  };
  enableAndStartService({run,domain,plist});
  assert.equal(started,true);
});

test('a bootstrap that reports success but leaves the job unloaded is not a successful start',()=>{
  let kicked=false;
  const run=args=>{
    if(args[0]==='print')return missing;
    if(args[0]==='kickstart')kicked=true;
    return ok;
  };
  assert.throws(()=>enableAndStartService({run,domain,plist}),/não manteve o serviço carregado.*113/);
  assert.equal(kicked,false);
});

test('enabling an already running job never bootstraps it again or replaces its process',()=>{
  const run=args=>{
    if(args[0]==='enable')return ok;
    if(args[0]==='print')return running;
    assert.fail('An active connection must not be replaced');
  };
  enableAndStartService({run,domain,plist});
});

test('a native enable failure is reported before registration',()=>{
  const run=args=>{
    assert.equal(args[0],'enable');
    return {status:1,stderr:'Operation not permitted'};
  };
  assert.throws(()=>enableAndStartService({run,domain,plist}),/não habilitou.*Operation not permitted/);
});

test('a failed service query does not attempt to start a second instance',()=>{
  const run=args=>{
    if(args[0]==='enable')return ok;
    assert.equal(args[0],'print');
    return {status:1,stderr:'Operation not permitted'};
  };
  assert.throws(()=>enableAndStartService({run,domain,plist}),/não conseguiu consultar/);
});

test('stopping waits until launchd actually removes the old registration',async()=>{
  let booted=false,polls=0,time=0;
  const run=args=>{
    if(args[0]==='bootout'){booted=true;return ok;}
    assert.deepEqual(args,['print',target]);
    return !booted || polls++<2?running:missing;
  };
  await unloadService({run,target,clock:()=>time,pause:async ms=>{time+=ms;}});
  assert.equal(time,400);
  assert.equal(booted,true);
});

test('a job that remains loaded after bootout blocks a restart',async()=>{
  let time=0;
  const run=args=>args[0]==='print'?running:ok;
  await assert.rejects(unloadService({run,target,clock:()=>time,pause:async ms=>{time+=ms;},timeoutMs:400}),/anterior ainda está carregado/);
});

test('an unloaded job needs no bootout and a permission failure is not treated as unloaded',async()=>{
  await unloadService({target,run:args=>{assert.equal(args[0],'print');return missing;}});
  await assert.rejects(unloadService({target,run:args=>{assert.equal(args[0],'print');return {status:1};}}),/não conseguiu consultar/);
});
