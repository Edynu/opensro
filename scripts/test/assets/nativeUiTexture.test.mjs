import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runPython} from '../../build/shared/pythonRun.mjs';
test('native 16-bit UI textures retain retail channel expansion, alpha and pitch',async()=>{
 await runPython([fileURLToPath(new URL('./native_ui_texture_test.py',import.meta.url))],{task:'Native UI texture conversion tests'});
});
