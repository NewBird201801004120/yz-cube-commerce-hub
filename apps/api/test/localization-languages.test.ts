import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportedLanguages} from '../src/localization-languages';
test('language options belong to the target market, default first, independent arrays',()=>{
 assert.deepEqual(supportedLanguages('English','PH'),['English','Filipino']);
 assert.deepEqual(supportedLanguages('ไทย','TH'),['ไทย']);
 assert.deepEqual(supportedLanguages('Bahasa Melayu','MY'),['Bahasa Melayu','English']);
 assert.deepEqual(supportedLanguages('繁體中文','TW'),['繁體中文']);
 assert.equal(supportedLanguages('English','PH').includes('简体中文'),false);
 const choices=supportedLanguages('English','PH');choices.length=0;assert.equal(supportedLanguages('English','PH').length,2);
 assert.deepEqual(supportedLanguages('English','XX'),['English']);
});
