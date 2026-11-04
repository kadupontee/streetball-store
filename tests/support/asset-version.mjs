import assert from 'node:assert/strict';

// Later releases must keep a cache key; an earlier feature's tests must accept newer keys.
export function assertAssetVersion(html,file,minimumDate='20261022'){
 const urls=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>new URL(m[1],'https://store.example.invalid/'));
 const asset=urls.find(url=>url.pathname==='/'+file);assert.ok(asset,'Missing asset '+file);
 const version=asset.searchParams.get('v')||'',date=version.match(/^(20\d{6})(?:-|$)/)?.[1];
 assert.ok(date&&date>=minimumDate,'Missing or outdated cache version for '+file);
 return version;
}
