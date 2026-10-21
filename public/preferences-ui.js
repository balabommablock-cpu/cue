const fields = ['font', 'glass', 'scrollMode', 'scrollSpeed', 'style', 'auto'];
export function parsePreset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'cue.preferences' || value.version !== 1) throw new Error('Choose a Cue preferences file. Context and account files cannot be imported here.');
  if (Object.keys(value).some(k => !['kind', 'version', ...fields].includes(k))) throw new Error('This file contains unsupported fields. Export a new preferences file from Cue.');
  for (const [key, min, max] of [['font', 23, 48], ['glass', 30, 98], ['scrollSpeed', 8, 36]]) if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error('The reading settings in this file are out of range.');
  if (!['steady', 'voice', 'manual'].includes(value.scrollMode) || !['cues', 'script'].includes(value.style) || typeof value.auto !== 'boolean') throw new Error('This preferences file has an unsupported answer or scrolling option.');
  return { kind: 'cue.preferences', version: 1, ...Object.fromEntries(fields.map(k => [k, value[k]])) };
}
export function makePreset(settings) {
  return parsePreset({ kind: 'cue.preferences', version: 1, ...Object.fromEntries(fields.map(k => [k, settings[k]])) });
}
export function preferencesUI({ $, getValues, apply }) {
  const message = text => { $('presetMessage').textContent = text; };
  const presets = { compact: { font: 25, glass: 76, scrollMode: 'steady', scrollSpeed: 22 }, comfortable: { font: 31, glass: 76, scrollMode: 'steady', scrollSpeed: 18 }, large: { font: 40, glass: 90, scrollMode: 'steady', scrollSpeed: 12 } };
  for (const [name, values] of Object.entries(presets)) $('preset' + name).onclick = () => { apply({ ...makePreset(getValues()), ...values }); message('Reading preset applied. Your context and AI connection are unchanged.'); };
  $('exportPreferences').onclick = () => {
    const file = new Blob([JSON.stringify(makePreset(getValues()), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url; link.download = 'cue-preferences.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Exported reading and answer settings. No context, account or API key is included.');
  };
  $('importPreferences').onclick = () => $('preferenceFile').click();
  $('preferenceFile').onchange = async () => {
    const file = $('preferenceFile').files?.[0]; if (!file) return;
    try { if (file.size > 16384) throw new Error('Choose a Cue preferences file smaller than 16 KB.'); const settings = parsePreset(JSON.parse(await file.text())); apply(settings); message('Preferences imported. Your context and AI connection are unchanged.'); }
    catch (error) { message(error instanceof SyntaxError ? 'This file is not valid JSON. Export a new preferences file from Cue.' : error.message); }
    finally { $('preferenceFile').value = ''; }
  };
}
