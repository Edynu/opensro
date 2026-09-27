import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedRequest} from '../server/security.mjs';
test('dashboard rejects foreign Host, Origin and forwarded requests',()=>{
 const req=headers=>({headers:{host:'localhost:5190',...headers}});
 assert.ok(allowedRequest(req({}),5190));
 assert.ok(allowedRequest(req({origin:'http://localhost:5190'}),5190));
 for(const headers of [{host:'evil.example:5190'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},{forwarded:'for=127.0.0.1'},{'x-forwarded-for':'127.0.0.1'}])assert.equal(allowedRequest(req(headers),5190),false);
});
