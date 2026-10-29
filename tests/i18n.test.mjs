import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { english } from '../src/translations.ts';
import { getLanguage, languageFromLocale, setLanguage, subscribeLanguage, t, translate, translateError } from '../src/i18n.ts';

test('language follows locale and changes immediately without disturbing saved text or user content',()=>{
  assert.equal(languageFromLocale('ko-KR'),'ko');assert.equal(languageFromLocale('ko_KR'),'ko');assert.equal(languageFromLocale('en-MY'),'en');assert.equal(languageFromLocale('ja-JP'),'en');
  let changes=0;const stop=subscribeLanguage(()=>changes++);
  setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(t('저장'),'Save');
  const stored=t('사진 저장 완료');setLanguage('ko');assert.equal(t(stored),'사진 저장 완료');assert.equal(changes,2);stop();
  assert.equal(t('My own sticker 42'),'My own sticker 42');
});

test('all catalog entries have matching placeholders and dynamic notices switch both ways',()=>{
  const slots=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
  for(const [ko,en]of Object.entries(english)){assert.ok(en.trim(),ko);assert.deepEqual(slots(ko),slots(en),ko);}
  const notice=translate('사진 보관함에 저장했어요. {0}','ko','사진 앱에서 최근 추가된 사진을 확인해 주세요.');
  assert.equal(translate(notice,'en'),'Saved to Photos. Check Recently Saved in the Photos app.');
  assert.equal(translate(' 스티커 3 ','en'),' Sticker 3 ');
  assert.equal(translate('폰 {0}','en','작게 −'),'Phone Smaller −');
  setLanguage('en');assert.equal(translateError('Native error: 사진에서 피사체를 찾지 못했어요.'),'No subject found in the photo.');setLanguage('ko');
});

test('UI, API and native Korean messages cannot be added without their English catalog entry',()=>{
  const files=['App.tsx',...fs.readdirSync('src').filter(f=>/\.tsx?$/.test(f)&&!/^i18n|translations/.test(f)).map(f=>'src/'+f),...fs.readdirSync('server').filter(f=>f.endsWith('.mjs')).map(f=>'server/'+f)];
  const missing=[];
  for(const file of files){
    const source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const visit=node=>{
      let key;
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))key=node.text;
      else if(ts.isJsxText(node))key=node.text.replace(/\s+/g,' ').trim();
      else if(ts.isTemplateExpression(node))key=node.head.text+node.templateSpans.map((s,i)=>`{${i}}`+s.literal.text).join('');
      if(key&&/[가-힣]/.test(key)&&!(key in english))missing.push(`${file}: ${key}`);
      ts.forEachChild(node,visit);
    };visit(sf);
  }
  const nativeFiles=['modules/subject-lift/ios/SubjectLiftModule.swift','modules/subject-lift/android/src/main/java/expo/modules/subjectlift/SubjectLiftModule.kt'];
  for(const file of nativeFiles)for(const match of fs.readFileSync(file,'utf8').matchAll(/"([^"\n]*[가-힣][^"\n]*)"/g))if(!(match[1]in english))missing.push(`${file}: ${match[1]}`);
  assert.deepEqual(missing,[]);
});
