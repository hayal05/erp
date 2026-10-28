import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isFkViolation} from '../src/services/dbErrors.js';
test('assigned-record deletion recognizes foreign-key and RESTRICT SQLSTATEs without masking unrelated errors',()=>{
 assert.equal(isFkViolation({code:'23503'}),true);assert.equal(isFkViolation({code:'23001'}),true);
 for(const error of[null,{}, {code:'23514'}, {code:'23505'}, {code:'ECONNRESET'}])assert.equal(isFkViolation(error),false);
});
